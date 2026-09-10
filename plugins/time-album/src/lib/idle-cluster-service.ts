import { PhotoItem, PersonProfile } from '../types/album'
import { isFaceModelReady } from './face-model-storage'
import {
  detectFacesInImage,
  loadFaceApiModels,
  clusterFaces,
  findBestMatchingPerson,
  PhotoFaceRecord
} from './face-recognition'
import {
  getAnalyzedPhotoIdSet,
  savePhotoFaces,
  getAllCachedFaceRecords,
  getCachedPhotoFace,
  deletePhotoFaces,
  CachedPhotoFaceRecord
} from './face-cache-store'
import { getThumbnail } from './thumbnail-cache'
import { createPerson, getStoredPeople, saveAllPeople } from './people-store'

export type IdleClusterStatus =
  | 'uninitialized'
  | 'no_model'
  | 'idle'
  | 'analyzing'
  | 'paused'
  | 'completed'
  | 'error'

export interface IdleClusterState {
  enabled: boolean
  status: IdleClusterStatus
  processedCount: number
  totalCount: number
  facesFoundCount: number
  currentPhotoName?: string
  lastActiveTime: number
  isUserInteracting: boolean
}

type StateListener = (state: IdleClusterState) => void

const STORAGE_KEY_ENABLED = 'doujiao_album_idle_cluster_enabled'
const DEBOUNCE_IDLE_MS = 4000 // 4 秒无交互判定为交互空闲
const GUARANTEED_TICK_MS = 15000 // 15 秒保底心跳机制，确保流水线永不卡死

export class IdleClusterService {
  private static instance: IdleClusterService
  private enabled: boolean = true
  private status: IdleClusterStatus = 'uninitialized'
  private photos: PhotoItem[] = []
  private listeners: Set<StateListener> = new Set()

  private processedCount = 0
  private totalCount = 0
  private facesFoundCount = 0
  private currentPhotoName = ''

  private isRunningLoop = false
  private isPaused = false
  private isUserInteracting = false
  private lastInteractionTime = Date.now()
  private lastProcessedTime = Date.now()
  private idleTimer: any = null
  private heartbeatTimer: any = null

  private onPeopleUpdatedCallback?: (people: PersonProfile[]) => void

  // 内存中缓存的已知人物特征向量库（用于 O(K) 极速增量匹配）
  private knownPeopleIndex: Array<{ personId: string; descriptors: Float32Array[] }> = []
  // 暂存本次会话中未匹配到已知人物的新面孔记录（用于后续增量微聚类）
  private unassignedFacesBuffer: PhotoFaceRecord[] = []
  private isIndexInitialized = false
  private sourceGeneration = 0

  private constructor() {
    const storedEnabled = localStorage.getItem(STORAGE_KEY_ENABLED)
    this.enabled = storedEnabled !== null ? storedEnabled === 'true' : true
    this.setupInteractionListeners()
    this.setupGuaranteedHeartbeat()
  }

  public static getInstance(): IdleClusterService {
    if (!IdleClusterService.instance) {
      IdleClusterService.instance = new IdleClusterService()
    }
    return IdleClusterService.instance
  }

  /**
   * 监听用户全量交互事件（鼠标/滚轮/按键/触控），实现极速避让
   */
  private setupInteractionListeners(): void {
    if (typeof window === 'undefined') return

    const handleUserAction = () => {
      this.lastInteractionTime = Date.now()

      if (!this.isUserInteracting) {
        this.isUserInteracting = true
        this.notify()
      }

      if (this.idleTimer) {
        clearTimeout(this.idleTimer)
      }

      // 静止 4 秒后恢复空闲状态并唤醒处理
      this.idleTimer = setTimeout(() => {
        this.isUserInteracting = false
        this.notify()
        this.triggerNextSlice()
      }, DEBOUNCE_IDLE_MS)
    }

    const eventNames = ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart', 'scroll']
    for (const evt of eventNames) {
      window.addEventListener(evt, handleUserAction, { passive: true, capture: true })
    }
  }

  /**
   * 建立保底心跳机制：每隔 15 秒检查一次，若长时间未执行则强行插入单张切片，绝不永远卡死
   */
  private setupGuaranteedHeartbeat(): void {
    if (typeof window === 'undefined') return

    this.heartbeatTimer = setInterval(() => {
      if (!this.enabled || this.isPaused || this.photos.length === 0) return

      const elapsed = Date.now() - this.lastProcessedTime
      if (elapsed >= GUARANTEED_TICK_MS && !this.isRunningLoop) {
        console.log('[IdleCluster] 触发 15s 保底推进心跳切片')
        this.triggerNextSlice()
      }
    }, 5000)
  }

  /**
   * 注册更新人物库的回调
   */
  public setOnPeopleUpdated(callback: (people: PersonProfile[]) => void): void {
    this.onPeopleUpdatedCallback = callback
  }

  /**
   * 订阅状态变化
   */
  public subscribe(listener: StateListener): () => void {
    this.listeners.add(listener)
    listener(this.getState())
    return () => {
      this.listeners.delete(listener)
    }
  }

  public getState(): IdleClusterState {
    return {
      enabled: this.enabled,
      status: this.status,
      processedCount: this.processedCount,
      totalCount: this.totalCount,
      facesFoundCount: this.facesFoundCount,
      currentPhotoName: this.currentPhotoName,
      lastActiveTime: this.lastProcessedTime,
      isUserInteracting: this.isUserInteracting
    }
  }

  private notify(): void {
    const state = this.getState()
    for (const listener of this.listeners) {
      try {
        listener(state)
      } catch (err) {
        console.error('[IdleCluster] 通知监听器异常:', err)
      }
    }
  }

  /**
   * 切换启用/禁用后台空闲聚类
   */
  public setEnabled(enabled: boolean): void {
    this.enabled = enabled
    localStorage.setItem(STORAGE_KEY_ENABLED, String(enabled))
    this.notify()
    if (enabled) {
      this.triggerNextSlice()
    }
  }

  /**
   * 暂停（如大图全屏播放、幻灯片播放、打开切换相册源弹窗时主动避让）
   */
  public pause(): void {
    this.isPaused = true
    if (this.status === 'analyzing') {
      this.status = 'paused'
      this.notify()
    }
  }

  /**
   * 恢复运行
   */
  public resume(): void {
    this.isPaused = false
    if (this.status === 'paused') {
      this.status = 'idle'
      this.notify()
      this.triggerNextSlice()
    }
  }

  /**
   * 切换相册源时丢弃所有仅属于旧照片命名空间的运行态。
   * sourceGeneration 用于让已经开始的异步识别任务在回写前自动失效。
   */
  public resetForSourceChange(): void {
    this.sourceGeneration++
    this.photos = []
    this.processedCount = 0
    this.totalCount = 0
    this.facesFoundCount = 0
    this.currentPhotoName = ''
    this.knownPeopleIndex = []
    this.unassignedFacesBuffer = []
    this.isIndexInitialized = false
    this.status = 'uninitialized'

    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
      this.idleTimer = null
    }

    this.notify()
  }

  /**
   * 注入或更新相册照片池
   */
  /**
   * 构建并刷新已知人物的特征向量内存索引（各人物取代表性样本人脸）
   */
  public async refreshPeopleIndex(): Promise<void> {
    const generation = this.sourceGeneration
    try {
      const people = getStoredPeople()
      if (people.length === 0) {
        if (generation !== this.sourceGeneration) return
        this.knownPeopleIndex = []
        this.isIndexInitialized = true
        return
      }

      const index: Array<{ personId: string; descriptors: Float32Array[] }> = []
      for (const p of people) {
        const descriptors: Float32Array[] = []
        // 优先采纳头像照片，其余取至多 8 张样本照片构建特征库
        const sampleIds = p.avatarPhotoId
          ? [p.avatarPhotoId, ...p.photoIds.filter((id) => id !== p.avatarPhotoId).slice(0, 7)]
          : p.photoIds.slice(0, 8)

        for (const pid of sampleIds) {
          const rec = await getCachedPhotoFace(pid)
          if (generation !== this.sourceGeneration) return
          if (rec?.faces) {
            for (const f of rec.faces) {
              descriptors.push(new Float32Array(f.descriptor))
            }
          }
        }
        if (descriptors.length > 0) {
          index.push({ personId: p.id, descriptors })
        }
      }
      if (generation !== this.sourceGeneration) return
      this.knownPeopleIndex = index
      this.isIndexInitialized = true
    } catch (err) {
      console.warn('[IdleCluster] 构建人物特征索引失败:', err)
    }
  }

  /**
   * 注入或更新相册照片池
   */
  public async setPhotos(photos: PhotoItem[]): Promise<void> {
    const generation = this.sourceGeneration
    // 快速幂等检查：若照片列表相同（ID一致），仅更新引用，避免重复触发计算与循环
    if (
      this.photos.length === photos.length &&
      photos.length > 0 &&
      this.photos.every((p, i) => p.id === photos[i].id) &&
      this.status !== 'uninitialized'
    ) {
      this.photos = photos
      return
    }

    this.photos = photos
    this.totalCount = photos.length

    // 预热并刷新已知人物特征索引
    this.refreshPeopleIndex()

    if (photos.length === 0) {
      this.status = 'completed'
      this.processedCount = 0
      this.notify()
      return
    }

    // 快速拉取当前已有缓存的分析进度与已发现面孔数
    const analyzedSet = await getAnalyzedPhotoIdSet()
    if (generation !== this.sourceGeneration) return
    let count = 0
    for (const p of photos) {
      if (analyzedSet.has(p.id)) count++
    }
    this.processedCount = count

    // 同步人脸特征面孔数
    const records = await getAllCachedFaceRecords()
    if (generation !== this.sourceGeneration) return
    const currentPhotoIdSet = new Set(photos.map((p) => p.id))
    const validRecords = records.filter((r) => currentPhotoIdSet.has(r.photoId))
    this.facesFoundCount = validRecords.length

    const modelReady = await isFaceModelReady()
    if (generation !== this.sourceGeneration) return
    if (!modelReady) {
      this.status = 'no_model'
      this.notify()
      return
    }

    if (this.processedCount >= this.totalCount) {
      this.status = 'completed'
      const existingPeople = getStoredPeople()
      const currentPhotoIdSet = new Set(photos.map((p) => p.id))
      const hasAnyCurrent = existingPeople.some((p) =>
        p.photoIds.some((id) => currentPhotoIdSet.has(id))
      )
      // 若已有全量人脸特征但人物库尚为空（首次冷启动），或现有分类皆为其他相册遗留，立即执行基础聚类
      if (existingPeople.length === 0 || !hasAnyCurrent) {
        this.runInitialClustering(generation)
      }
    } else {
      this.status = 'idle'
    }
    this.notify()

    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
    }

    // 延迟 5 秒后尝试第一次空闲切片
    this.idleTimer = setTimeout(() => {
      this.triggerNextSlice()
    }, 5000)
  }

  /**
   * 触发一次单张照片分析切片
   */
  public async triggerNextSlice(): Promise<void> {
    if (this.isRunningLoop) return
    if (!this.enabled || this.isPaused) return
    if (this.photos.length === 0) return

    const generation = this.sourceGeneration

    // 检查模型是否就绪
    const modelReady = await isFaceModelReady()
    if (generation !== this.sourceGeneration) return
    if (!modelReady) {
      this.status = 'no_model'
      this.notify()
      return
    }

    this.isRunningLoop = true
    try {
      await this.runIdleSlice()
    } finally {
      this.isRunningLoop = false
    }
  }

  /**
   * 针对新照片提取的人脸执行毫秒级增量匹配：
   * 1. 若命中已有已知人物，立即将该照片加入该人物，并更新 UI（照片数实时 +1）
   * 2. 若无法匹配任何已知人物，暂存至 unassignedFacesBuffer，留待增量微聚类
   */
  private async handleIncrementalFaceMatching(
    photoId: string,
    photoName: string,
    detectedFaces: Array<{ descriptor: Float32Array; score: number }>,
    generation: number
  ): Promise<void> {
    if (generation !== this.sourceGeneration) return
    if (detectedFaces.length === 0) return

    if (!this.isIndexInitialized) {
      await this.refreshPeopleIndex()
      if (generation !== this.sourceGeneration) return
    }

    const matchedPersonIds = new Set<string>()

    for (const f of detectedFaces) {
      // 欧氏距离 <= 0.53 判定为同一人物
      const match = findBestMatchingPerson(f.descriptor, this.knownPeopleIndex, 0.53)
      if (match) {
        matchedPersonIds.add(match.personId)
        // 动态丰富内存索引样本
        const personEntry = this.knownPeopleIndex.find((p) => p.personId === match.personId)
        if (personEntry && personEntry.descriptors.length < 15) {
          personEntry.descriptors.push(f.descriptor)
        }
      } else {
        // 未匹配新人脸
        this.unassignedFacesBuffer.push({
          photoId,
          descriptor: f.descriptor,
          score: f.score
        })
      }
    }

    // 若命中了已有已知人物，立即增量追加关联该照片！
    if (matchedPersonIds.size > 0) {
      if (generation !== this.sourceGeneration) return
      const existingPeople = getStoredPeople()
      let updated = false
      for (const pid of matchedPersonIds) {
        const p = existingPeople.find((x) => x.id === pid)
        if (p && !p.photoIds.includes(photoId)) {
          p.photoIds.push(photoId)
          p.updatedAt = Date.now()
          updated = true
        }
      }
      if (updated) {
        if (generation !== this.sourceGeneration) return
        saveAllPeople(existingPeople)
        this.onPeopleUpdatedCallback?.(existingPeople)
        console.log(
          `[IdleCluster] ⚡ 增量匹配命中！照片「${photoName}」已自动归入 ${matchedPersonIds.size} 位已知人物相册`
        )
      }
    }
  }

  /**
   * 执行单个空闲切片流水线（增量模式）
   */
  private async runIdleSlice(): Promise<void> {
    const generation = this.sourceGeneration

    // 获取已处理过的 photoId 集合
    const analyzedSet = await getAnalyzedPhotoIdSet()
    if (generation !== this.sourceGeneration) return
    const pendingPhotos = this.photos.filter((p) => !analyzedSet.has(p.id))

    if (pendingPhotos.length === 0) {
      this.status = 'completed'
      this.processedCount = this.photos.length
      this.notify()

      // 未匹配新人脸的增量微聚类
      await this.runIncrementalClusteringForUnmatched(generation)
      return
    }

    // 确保深度离线模型已装载
    try {
      await loadFaceApiModels()
      if (generation !== this.sourceGeneration) return
    } catch (err) {
      console.warn('[IdleCluster] 装载人脸模型失败:', err)
      this.status = 'error'
      this.notify()
      return
    }

    this.status = 'analyzing'
    this.lastProcessedTime = Date.now()

    // 取 1 张待检测照片（单切片极轻量原则）
    const targetPhoto = pendingPhotos[0]
    this.currentPhotoName = targetPhoto.name
    this.notify()

    const sdk = (window as any).doujiaoSDK || null
    let imgUrl = targetPhoto.thumbnailUrl || targetPhoto.dataUrl

    if (!imgUrl) {
      imgUrl = (await getThumbnail(targetPhoto.id)) || (await getThumbnail(targetPhoto.relativePath)) || undefined
      if (generation !== this.sourceGeneration) return
    }
    if (!imgUrl && sdk?.workspace) {
      try {
        imgUrl = (await sdk.workspace.readFile(targetPhoto.relativePath, 'time-album')) || undefined
        if (generation !== this.sourceGeneration) return
      } catch {}
    }

    if (imgUrl) {
      try {
        const detectedFaces = await detectFacesInImage(imgUrl)
        if (generation !== this.sourceGeneration) return
        await savePhotoFaces(targetPhoto.id, detectedFaces)
        if (generation !== this.sourceGeneration) return

        if (detectedFaces.length > 0) {
          this.facesFoundCount += detectedFaces.length
          console.log(
            `[IdleCluster] 🍃 照片「${targetPhoto.name}」检测到 ${detectedFaces.length} 处人脸，已存入向量缓存`
          )
          // ⚡ 增量匹配：毫秒级归入已知人物
          await this.handleIncrementalFaceMatching(
            targetPhoto.id,
            targetPhoto.name,
            detectedFaces,
            generation
          )
        }
      } catch (err) {
        if (generation !== this.sourceGeneration) return
        console.warn(`[IdleCluster] 人脸提取异常 (${targetPhoto.name}):`, err)
        // 标记为空，避免单张损坏图片导致死循环
        await savePhotoFaces(targetPhoto.id, [])
      }
    } else {
      if (generation !== this.sourceGeneration) return
      // 无法获取图片，标记免死
      await savePhotoFaces(targetPhoto.id, [])
    }

    if (generation !== this.sourceGeneration) return
    this.processedCount++
    this.lastProcessedTime = Date.now()

    if (this.processedCount >= this.totalCount) {
      this.status = 'completed'
      this.notify()
      await this.runIncrementalClusteringForUnmatched(generation)
      return
    }

    this.status = 'idle'
    this.notify()

    // 若用户正在连续交互，主动让出主线程退避；若完全静止，温和让出 1200ms 让 CPU 与内存休整，绝不高负载抢占
    const delay = this.isUserInteracting ? DEBOUNCE_IDLE_MS : 1200
    setTimeout(() => {
      if (!this.isUserInteracting && !this.isPaused && this.enabled) {
        this.triggerNextSlice()
      }
    }, delay)
  }

  /**
   * 增量微聚类：仅对本次扫描中未匹配到任何已知人物的新人脸进行聚类
   */
  public async runIncrementalClusteringForUnmatched(
    generation: number = this.sourceGeneration
  ): Promise<void> {
    if (generation !== this.sourceGeneration) return
    const existingPeople = getStoredPeople()
    const currentPhotoIdSet = new Set(this.photos.map((p) => p.id))
    const hasAnyCurrent = existingPeople.some((p) =>
      p.photoIds.some((id) => currentPhotoIdSet.has(id))
    )

    // 冷启动或上一数据源遗留残留：若相册尚无人物，或所有人物均不属于当前照片池，执行全量基础聚类
    if (existingPeople.length === 0 || !hasAnyCurrent) {
      await this.runInitialClustering(generation)
      return
    }

    // 增量模式：检查未分配缓冲池
    if (this.unassignedFacesBuffer.length === 0) {
      console.log('[IdleCluster] ⚡ 增量聚类完成：所有新照片均已精准归入已知人物相册')
      return
    }

    console.log(
      `[IdleCluster] ⚡ 正在对 ${this.unassignedFacesBuffer.length} 处未匹配的新人脸执行增量微聚类...`
    )
    const clusters = clusterFaces(this.unassignedFacesBuffer, 0.56)
    // 仅保留属于当前相册的人物，剔除旧数据源幽灵人物
    const updatedPeople = existingPeople.filter((p) =>
      p.photoIds.some((id) => currentPhotoIdSet.has(id))
    )
    let newCount = 0

    for (const cluster of clusters) {
      const defaultName = `人物 ${updatedPeople.length + 1}`
      const newP = createPerson(defaultName, cluster.photoIds)
      newP.avatarPhotoId = cluster.representativePhotoId
      updatedPeople.push(newP)
      newCount++
    }

    this.unassignedFacesBuffer = []
    if (generation !== this.sourceGeneration) return
    saveAllPeople(updatedPeople)
    await this.refreshPeopleIndex()
    if (generation !== this.sourceGeneration) return
    this.onPeopleUpdatedCallback?.(updatedPeople)
    console.log(`[IdleCluster] 🎉 增量微聚类完毕！已自动归整 ${newCount} 位新人物`)
  }

  /**
   * 首次全量基础聚类（仅在相册全新冷启动或用户手动推倒重来时执行）
   */
  public async runInitialClustering(
    generation: number = this.sourceGeneration
  ): Promise<void> {
    try {
      const records = await getAllCachedFaceRecords()
      if (generation !== this.sourceGeneration) return
      if (records.length === 0) {
        console.log('[IdleCluster] 当前相册中未检测到清晰人脸记录')
        saveAllPeople([])
        this.onPeopleUpdatedCallback?.([])
        return
      }

      const currentPhotoIdSet = new Set(this.photos.map((p) => p.id))
      const validRecords = records.filter((r) => currentPhotoIdSet.has(r.photoId))
      if (validRecords.length === 0) {
        console.log('[IdleCluster] 当前相册照片中未匹配到有效人脸向量')
        saveAllPeople([])
        this.onPeopleUpdatedCallback?.([])
        return
      }

      console.log(`[IdleCluster] 正在对 ${validRecords.length} 处人脸特征向量执行基础聚类...`)
      const clusters = clusterFaces(validRecords, 0.56)

      const existingPeople = getStoredPeople()
      // 仅保留属于当前相册的人物，彻底剔除旧数据源的幽灵分类
      const updatedPeople = existingPeople.filter((p) =>
        p.photoIds.some((id) => currentPhotoIdSet.has(id))
      )
      let newCount = 0

      for (const cluster of clusters) {
        let matchedPerson: PersonProfile | null = null
        for (const person of updatedPeople) {
          const hasCommon = cluster.photoIds.some((id) => person.photoIds.includes(id))
          if (hasCommon) {
            matchedPerson = person
            break
          }
        }

        if (matchedPerson) {
          const mergedIds = Array.from(new Set([...matchedPerson.photoIds, ...cluster.photoIds]))
          matchedPerson.photoIds = mergedIds
          matchedPerson.updatedAt = Date.now()
        } else {
          const defaultName = `人物 ${updatedPeople.length + 1}`
          const newP = createPerson(defaultName, cluster.photoIds)
          newP.avatarPhotoId = cluster.representativePhotoId
          updatedPeople.push(newP)
          newCount++
        }
      }

      if (generation !== this.sourceGeneration) return
      saveAllPeople(updatedPeople)
      await this.refreshPeopleIndex()
      if (generation !== this.sourceGeneration) return
      this.onPeopleUpdatedCallback?.(updatedPeople)
      console.log(`[IdleCluster] 🎉 基础人脸聚类完成！共归整 ${updatedPeople.length} 位人物 (新增 ${newCount})`)
    } catch (err) {
      console.error('[IdleCluster] 基础聚类异常:', err)
    }
  }

  /**
   * 重置并全量重新聚类（用户手动推倒重来时调用）
   */
  public async resetAndReclusterAll(onProgress?: (p: number, t: number) => void): Promise<void> {
    if (this.photos.length === 0) return
    const generation = this.sourceGeneration

    // 1. 立即清空所有存储和内存的人物分类
    saveAllPeople([])
    this.knownPeopleIndex = []
    this.unassignedFacesBuffer = []
    this.isIndexInitialized = false
    this.onPeopleUpdatedCallback?.([])

    // 2. 彻底清除当前相册所有照片在 IndexedDB 中的特征缓存记录，推倒重来
    const photoIds = this.photos.map((p) => p.id)
    await deletePhotoFaces(photoIds)
    if (generation !== this.sourceGeneration) return

    this.processedCount = 0
    this.facesFoundCount = 0
    this.currentPhotoName = ''
    this.notify()

    console.log(`[IdleCluster] 已清空人脸特征缓存，正在全速分析 ${this.photos.length} 张照片...`)
    await this.forceRunAll(onProgress)
  }

  /**
   * 用户点击“立即全速聚类”：跳过空闲避让，增量全速跑完剩余照片
   */
  public async forceRunAll(onProgress?: (p: number, t: number) => void): Promise<void> {
    if (this.photos.length === 0) return
    const generation = this.sourceGeneration
    const modelReady = await isFaceModelReady()
    if (generation !== this.sourceGeneration) return
    if (!modelReady) throw new Error('离线人脸识别模型尚未下载')

    await loadFaceApiModels()
    if (generation !== this.sourceGeneration) return
    this.status = 'analyzing'
    this.notify()

    await this.refreshPeopleIndex()
    if (generation !== this.sourceGeneration) return

    const analyzedSet = await getAnalyzedPhotoIdSet()
    if (generation !== this.sourceGeneration) return
    const pendingPhotos = this.photos.filter((p) => !analyzedSet.has(p.id))

    // 准确初始化当前已处理的照片数
    this.processedCount = this.photos.length - pendingPhotos.length
    this.notify()

    const sdk = (window as any).doujiaoSDK || null

    for (let i = 0; i < pendingPhotos.length; i++) {
      if (generation !== this.sourceGeneration) return
      const p = pendingPhotos[i]
      this.currentPhotoName = p.name
      onProgress?.(i, pendingPhotos.length)
      this.notify()

      let imgUrl = p.thumbnailUrl || p.dataUrl
      if (!imgUrl) {
        imgUrl = (await getThumbnail(p.id)) || (await getThumbnail(p.relativePath)) || undefined
        if (generation !== this.sourceGeneration) return
      }
      if (!imgUrl && sdk?.workspace) {
        try {
          imgUrl = (await sdk.workspace.readFile(p.relativePath, 'time-album')) || undefined
          if (generation !== this.sourceGeneration) return
        } catch {}
      }

      if (imgUrl) {
        try {
          const faces = await detectFacesInImage(imgUrl)
          if (generation !== this.sourceGeneration) return
          await savePhotoFaces(p.id, faces)
          if (generation !== this.sourceGeneration) return
          if (faces.length > 0) {
            this.facesFoundCount += faces.length
            // ⚡ 增量匹配：直接匹配已有归类
            await this.handleIncrementalFaceMatching(p.id, p.name, faces, generation)
          }
        } catch (err) {
          console.warn(`[IdleCluster] 照片 ${p.name} 人脸提取失败:`, err)
          if (generation !== this.sourceGeneration) return
          await savePhotoFaces(p.id, [])
        }
      } else {
        if (generation !== this.sourceGeneration) return
        await savePhotoFaces(p.id, [])
      }

      if (generation !== this.sourceGeneration) return
      this.processedCount++
      await new Promise((r) => setTimeout(r, 20)) // 极短让出保持 UI 响应
    }

    this.status = 'completed'
    this.notify()
    await this.runIncrementalClusteringForUnmatched(generation)
  }
}
