import { DetectedFace, PhotoFaceRecord } from './face-recognition'

const DB_NAME = 'doujiao_face_descriptors_db'
const DB_VERSION = 1
const STORE_NAME = 'photo_faces'

export interface CachedFaceData {
  descriptor: number[] // 128D array
  score: number
  box: { x: number; y: number; width: number; height: number }
}

export interface CachedPhotoFaceRecord {
  photoId: string
  hasFace: boolean
  faces: CachedFaceData[]
  analyzedAt: number
}

let dbPromise: Promise<IDBDatabase> | null = null

function openFaceCacheDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'photoId' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => {
      dbPromise = null
      reject(req.error)
    }
  })
  return dbPromise
}

/**
 * 获取单张照片的人脸检测缓存记录（存在则返回，包含 0 个人脸的标记记录）
 */
export async function getCachedPhotoFace(photoId: string): Promise<CachedPhotoFaceRecord | null> {
  try {
    const db = await openFaceCacheDB()
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const store = tx.objectStore(STORE_NAME)
      const req = store.get(photoId)
      req.onsuccess = () => resolve(req.result || null)
      req.onerror = () => resolve(null)
    })
  } catch (err) {
    console.warn('[FaceCache] 读取人脸缓存失败:', photoId, err)
    return null
  }
}

/**
 * 批量检查照片是否已分析（返回已分析过的 photoId 集合）
 */
export async function getAnalyzedPhotoIdSet(): Promise<Set<string>> {
  try {
    const db = await openFaceCacheDB()
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const store = tx.objectStore(STORE_NAME)
      const req = store.getAllKeys()
      req.onsuccess = () => {
        const keys = req.result as string[]
        resolve(new Set(keys))
      }
      req.onerror = () => resolve(new Set())
    })
  } catch {
    return new Set()
  }
}

/**
 * 保存某张照片的人脸检测结果（即使 faces 为空也会保存标记，避免重复检测）
 */
export async function savePhotoFaces(
  photoId: string,
  faces: DetectedFace[]
): Promise<void> {
  try {
    const db = await openFaceCacheDB()
    const record: CachedPhotoFaceRecord = {
      photoId,
      hasFace: faces.length > 0,
      faces: faces.map((f) => ({
        descriptor: Array.from(f.descriptor),
        score: f.score,
        box: f.box
      })),
      analyzedAt: Date.now()
    }

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      const req = store.put(record)
      req.onsuccess = () => resolve()
      req.onerror = () => reject(req.error)
    })
  } catch (err) {
    console.warn('[FaceCache] 写入人脸缓存失败:', photoId, err)
  }
}

/**
 * 获取所有检测到人脸的照片记录（用于全库毫秒级向量聚类）
 */
export async function getAllCachedFaceRecords(): Promise<PhotoFaceRecord[]> {
  try {
    const db = await openFaceCacheDB()
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const store = tx.objectStore(STORE_NAME)
      const req = store.getAll()
      req.onsuccess = () => {
        const list = req.result as CachedPhotoFaceRecord[]
        const records: PhotoFaceRecord[] = []
        for (const item of list) {
          if (item.hasFace && item.faces) {
            for (const f of item.faces) {
              records.push({
                photoId: item.photoId,
                descriptor: new Float32Array(f.descriptor),
                score: f.score
              })
            }
          }
        }
        resolve(records)
      }
      req.onerror = () => resolve([])
    })
  } catch (err) {
    console.warn('[FaceCache] 获取所有面部特征失败:', err)
    return []
  }
}

/**
 * 清空人脸特征向量缓存
 */
export async function clearAllCachedFaceRecords(): Promise<void> {
  try {
    const db = await openFaceCacheDB()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      const req = store.clear()
      req.onsuccess = () => resolve()
      req.onerror = () => reject(req.error)
    })
  } catch (err) {
    console.error('[FaceCache] 清空人脸特征缓存失败:', err)
  }
}

/**
 * 批量删除指定照片的人脸特征记录（用于相册全量重新聚类时推倒重来）
 */
export async function deletePhotoFaces(photoIds: string[]): Promise<void> {
  if (!photoIds || photoIds.length === 0) return
  try {
    const db = await openFaceCacheDB()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      for (const id of photoIds) {
        store.delete(id)
      }
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch (err) {
    console.warn('[FaceCache] 批量删除人脸特征记录失败:', err)
  }
}
