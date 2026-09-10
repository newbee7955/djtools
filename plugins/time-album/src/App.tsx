import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { getSDK } from '@doujiao/plugin-sdk'
import {
  AlbumViewMode,
  DateGroup,
  GridSize,
  MonthGroup,
  OnThisDayMemory,
  PersonProfile,
  PhotoItem
} from './types/album'
import type { AlbumSource, S3AlbumSource } from './lib/s3-types'
import {
  getActiveAlbumSource,
  saveActiveAlbumSource,
  getStoredS3Profiles
} from './lib/s3-profile-store'
import { S3Client } from './lib/s3-client'
import { StorageSourceModal } from './components/StorageSourceModal'
import { parseExifFromDataUrl } from './lib/exif-parser'
import {
  clearThumbnailCache,
  createThumbnail,
  getThumbnail,
  saveThumbnail
} from './lib/thumbnail-cache'
import {
  analyzePhotoLocally,
  analyzePhotoWithDataUrl,
  matchPhotoQuery
} from './lib/local-ai'
import {
  getStoredPeople,
  getStoredUserTags,
  saveAllPeople
} from './lib/people-store'
import { OnThisDayBanner } from './components/OnThisDayBanner'
import { TimelineGallery } from './components/TimelineGallery'
import { PeopleView } from './components/PeopleView'
import { PhotoViewerModal } from './components/PhotoViewerModal'
import { SlideshowModal } from './components/SlideshowModal'
import { IdleClusterService, IdleClusterState } from './lib/idle-cluster-service'
import { clearAllCachedFaceRecords } from './lib/face-cache-store'
import { reconcilePeopleForPhotos, switchAlbumSource } from './lib/album-source-change'

export const App: React.FC = () => {
  const sdk = (() => {
    try {
      return getSDK()
    } catch {
      return (window as any).doujiaoSDK || null
    }
  })()

  // Navigation State
  const [viewMode, setViewMode] = useState<AlbumViewMode>('timeline')

  // Album Source & Directory State
  const [albumSource, setAlbumSource] = useState<AlbumSource>(() => getActiveAlbumSource())
  const [isSourceModalOpen, setIsSourceModalOpen] = useState(false)
  const [directory, setDirectory] = useState<string>('')
  const [photos, setPhotos] = useState<PhotoItem[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [activeFilterTag, setActiveFilterTag] = useState<string | null>(null)
  const [dateFrom, setDateFrom] = useState<string>('') // YYYY-MM-DD
  const [dateTo, setDateTo] = useState<string>('') // YYYY-MM-DD
  const [showDateFilter, setShowDateFilter] = useState(false)
  const [gridSize, setGridSize] = useState<GridSize>('medium')
  const [enableAiTags, setEnableAiTags] = useState<boolean>(() => {
    return localStorage.getItem('doujiao_album_ai_enabled') === 'true'
  })

  // People & Custom Tags State
  const [people, setPeople] = useState<PersonProfile[]>(() => getStoredPeople())
  const [toastMessage, setToastMessage] = useState<string | null>(null)

  // Modals
  const [selectedPhoto, setSelectedPhoto] = useState<PhotoItem | null>(null)
  const [slideshowPhotos, setSlideshowPhotos] = useState<PhotoItem[] | null>(null)
  const mainScrollRef = useRef<HTMLElement>(null)

  // Loading & AI progress
  const [scanProgress, setScanProgress] = useState<{ processed: number; total: number } | null>(null)
  const [isAnalyzingAi, setIsAnalyzingAi] = useState(false)

  // Show Toast
  const showToast = (msg: string) => {
    setToastMessage(msg)
    setTimeout(() => {
      setToastMessage((prev) => (prev === msg ? null : prev))
    }, 4000)
  }

  // 点击顶部时间轴：平滑回到顶部并还原全部照片
  const handleTimelineClick = () => {
    if (viewMode !== 'timeline') {
      setViewMode('timeline')
      setTimeout(() => {
        mainScrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
      }, 50)
    } else {
      mainScrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
      if (searchQuery || activeFilterTag || dateFrom || dateTo) {
        setSearchQuery('')
        setActiveFilterTag(null)
        setDateFrom('')
        setDateTo('')
        showToast('已还原为时间轴全部照片')
      } else {
        showToast('已回到相册时间轴顶部')
      }
    }
  }

  // Background Idle Clustering State & Subscription
  const [idleClusterState, setIdleClusterState] = useState<IdleClusterState>(() =>
    IdleClusterService.getInstance().getState()
  )

  useEffect(() => {
    const service = IdleClusterService.getInstance()
    const unsubscribe = service.subscribe((state) => {
      setIdleClusterState(state)
    })
    service.setOnPeopleUpdated((updatedPeople) => {
      setPeople(updatedPeople)
      showToast(`✨ 后台空闲人脸聚类已完成，已更新人物分类库 (${updatedPeople.length} 位人物)`)
    })
    return () => {
      unsubscribe()
    }
  }, [])

  // Track photo IDs so metadata updates don't repeatedly trigger IdleClusterService.setPhotos
  const photoIdsKey = useMemo(() => photos.map((p) => p.id).join(','), [photos])

  useEffect(() => {
    if (photos.length > 0) {
      IdleClusterService.getInstance().setPhotos(photos)
    }
  }, [photoIdsKey])

  useEffect(() => {
    const service = IdleClusterService.getInstance()
    if (selectedPhoto || slideshowPhotos || isSourceModalOpen) {
      service.pause()
    } else {
      service.resume()
    }
  }, [selectedPhoto, slideshowPhotos, isSourceModalOpen])

  // Stable key for current album source to prevent infinite re-fetching
  const albumSourceKey = useMemo(() => {
    return albumSource.type === 'local'
      ? `local:${albumSource.path || ''}`
      : `s3:${albumSource.profileId}:${albumSource.bucket}:${albumSource.prefix || ''}`
  }, [albumSource])

  // Sequence token for canceling stale scans
  const scanSessionRef = useRef<number>(0)

  // Fast mapping: people names
  const peopleNamesMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const p of people) {
      map.set(p.id, p.name)
    }
    return map
  }, [people])

  const loadPeopleForCurrentPhotos = async (photoIds: readonly string[]) => {
    const storedPeople = getStoredPeople()
    const reconciled = reconcilePeopleForPhotos(storedPeople, photoIds)

    if (reconciled.removedStaleSource) {
      IdleClusterService.getInstance().resetForSourceChange()
      saveAllPeople([])
      await clearAllCachedFaceRecords()
      showToast('已清理上一数据源遗留的人物分类，正在按当前相册重新识别')
    } else if (reconciled.people.length !== storedPeople.length) {
      saveAllPeople(reconciled.people)
    }

    setPeople(reconciled.people)
    return reconciled.people
  }

  // Fast mapping: photoId -> peopleIds
  const photoPeopleMap = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const p of people) {
      for (const pid of p.photoIds) {
        const existing = map.get(pid) || []
        existing.push(p.id)
        map.set(pid, existing)
      }
    }
    return map
  }, [people])

  // Date parsing helper
  const parsePhotoDate = (dateVal: number | string): Date => {
    const d = new Date(dateVal)
    return isNaN(d.getTime()) ? new Date() : d
  }

  // Process S3 thumbnails & EXIF in background chunks
  const processS3PhotosMetadata = async (
    items: PhotoItem[],
    client: S3Client,
    bucket: string,
    sessionId: number
  ) => {
    const total = items.length
    if (total === 0) return

    setScanProgress({ processed: 0, total })
    const chunkSize = 4

    for (let i = 0; i < items.length; i += chunkSize) {
      if (sessionId !== scanSessionRef.current) return
      const chunk = items.slice(i, i + chunkSize)
      const updates = await Promise.all(
        chunk.map(async (photo) => {
          try {
            // Check IndexedDB thumbnail first
            let thumb = await getThumbnail(photo.id)
            if (!thumb && photo.dataUrl) {
              thumb = await createThumbnail(photo.dataUrl, 320)
              if (thumb && thumb.startsWith('data:image/')) {
                await saveThumbnail(photo.id, thumb)
              }
            }

            // Local AI analysis if enabled
            let aiTags = photo.aiTags || []
            if (enableAiTags && aiTags.length === 0 && thumb) {
              aiTags = await analyzePhotoWithDataUrl(photo, thumb)
            }

            const userTags = photo.userTags || []
            const combinedTags = Array.from(new Set([...userTags, ...aiTags]))

            return { id: photo.id, thumb, aiTags, combinedTags }
          } catch (e) {
            console.warn('S3 metadata processing error for', photo.name, e)
            return null
          }
        })
      )

      if (sessionId !== scanSessionRef.current) return

      const validUpdates = updates.filter(Boolean) as {
        id: string
        thumb: string | null
        aiTags: string[]
        combinedTags: string[]
      }[]

      if (validUpdates.length > 0) {
        const updateMap = new Map(validUpdates.map((u) => [u.id, u]))
        setPhotos((prev) =>
          prev.map((p) => {
            const u = updateMap.get(p.id)
            if (!u) return p
            return {
              ...p,
              thumbnailUrl: u.thumb || p.thumbnailUrl,
              aiTags: u.aiTags.length > 0 ? u.aiTags : p.aiTags,
              tags: u.combinedTags
            }
          })
        )
      }

      setScanProgress({ processed: Math.min(i + chunkSize, total), total })
    }
    setScanProgress(null)
  }

  // Load photos based on active albumSource (local or S3)
  const loadPhotos = useCallback(async () => {
    const sessionId = ++scanSessionRef.current
    const currentSource = albumSource

    if (currentSource.type === 'local') {
      if (!sdk?.workspace) {
        setLoading(false)
        return
      }

      setLoading(true)
      try {
        const currentDir = await sdk.workspace.getDirectory('time-album')
        if (sessionId !== scanSessionRef.current) return
        setDirectory(currentDir)

        const files = await sdk.workspace.listFiles(
          'time-album',
          ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'avif'],
          '',
          true
        )
        if (sessionId !== scanSessionRef.current) return

        const storedTags = getStoredUserTags()
        const storedPeople = await loadPeopleForCurrentPhotos(
          files.map((file) => file.relativePath)
        )
        if (sessionId !== scanSessionRef.current) return

        const currentPhotoPeopleMap = new Map<string, string[]>()
        for (const p of storedPeople) {
          for (const pid of p.photoIds) {
            const list = currentPhotoPeopleMap.get(pid) || []
            list.push(p.id)
            currentPhotoPeopleMap.set(pid, list)
          }
        }

        // Convert WorkspaceFileItem[] to PhotoItem[]
        const rawPhotos: PhotoItem[] = files.map((file) => {
          const date = parsePhotoDate(file.updatedAt)
          const year = date.getFullYear()
          const month = date.getMonth() + 1
          const day = date.getDate()
          const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
          const userTags = storedTags[file.relativePath] || []
          const peopleIds = currentPhotoPeopleMap.get(file.relativePath) || []

          return {
            id: file.relativePath,
            name: file.name,
            relativePath: file.relativePath,
            size: file.size,
            updatedAt: file.updatedAt,
            date,
            dateStr,
            year,
            month,
            day,
            userTags,
            peopleIds,
            tags: [...userTags]
          }
        })

        if (sessionId !== scanSessionRef.current) return

        // Sort by date descending
        rawPhotos.sort((a, b) => b.date.getTime() - a.date.getTime())

        setPhotos(rawPhotos)
        setLoading(false)

        // Process thumbnails & metadata in background
        processPhotosMetadata(rawPhotos, sessionId)
      } catch (err) {
        console.error('Failed to load local photos:', err)
        if (sessionId === scanSessionRef.current) {
          setLoading(false)
        }
      }
    } else if (currentSource.type === 's3') {
      const profiles = getStoredS3Profiles()
      const profile = profiles.find((p) => p.id === currentSource.profileId)
      if (!profile) {
        setLoading(false)
        setIsSourceModalOpen(true)
        showToast('找不到指定的对象存储配置，请重新选择')
        return
      }

      setLoading(true)
      try {
        const client = new S3Client(profile)
        // 确保存储桶具备 CORS 跨域配置，以便端侧神经网络分析面部特征与渲染
        client.ensureBucketCors(currentSource.bucket).catch(() => {})
        const storedTags = getStoredUserTags()
        const s3Objects = await client.listAllImageObjects(
          currentSource.bucket,
          currentSource.prefix
        )
        if (sessionId !== scanSessionRef.current) return

        const storedPeople = await loadPeopleForCurrentPhotos(
          s3Objects.map((item) => item.key)
        )
        if (sessionId !== scanSessionRef.current) return

        const currentPhotoPeopleMap = new Map<string, string[]>()
        for (const p of storedPeople) {
          for (const pid of p.photoIds) {
            const list = currentPhotoPeopleMap.get(pid) || []
            list.push(p.id)
            currentPhotoPeopleMap.set(pid, list)
          }
        }

        // Concurrently resolve presigned URLs and cached thumbnails
        const rawPhotos: PhotoItem[] = await Promise.all(
          s3Objects.map(async (item) => {
            const date = item.lastModified ? new Date(item.lastModified) : new Date()
            const year = date.getFullYear()
            const month = date.getMonth() + 1
            const day = date.getDate()
            const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
            const userTags = storedTags[item.key] || []
            const peopleIds = currentPhotoPeopleMap.get(item.key) || []
            const presignedUrl = await client.getPresignedUrl(currentSource.bucket, item.key)
            const cachedThumb = await getThumbnail(item.key)

            return {
              id: item.key,
              name: item.name,
              relativePath: item.key,
              size: item.size,
              updatedAt: date.getTime(),
              date,
              dateStr,
              year,
              month,
              day,
              userTags,
              peopleIds,
              tags: [...userTags],
              dataUrl: presignedUrl,
              thumbnailUrl: cachedThumb || presignedUrl
            }
          })
        )

        if (sessionId !== scanSessionRef.current) return

        rawPhotos.sort((a, b) => b.date.getTime() - a.date.getTime())
        setPhotos(rawPhotos)
        setLoading(false)

        processS3PhotosMetadata(rawPhotos, client, currentSource.bucket, sessionId)
      } catch (err: any) {
        console.error('Failed to load S3 photos:', err)
        showToast('加载对象存储相册失败: ' + (err.message || '网络连接异常'))
        if (sessionId === scanSessionRef.current) {
          setLoading(false)
        }
      }
    }
  }, [sdk, albumSourceKey])

  // Process thumbnails & EXIF in background chunks for local photos
  const processPhotosMetadata = async (items: PhotoItem[], sessionId: number) => {
    if (!sdk?.workspace) return
    const total = items.length
    if (total === 0) return

    setScanProgress({ processed: 0, total })

    const chunkSize = 4
    for (let i = 0; i < items.length; i += chunkSize) {
      if (sessionId !== scanSessionRef.current) return
      const chunk = items.slice(i, i + chunkSize)
      const updates = await Promise.all(
        chunk.map(async (photo) => {
          try {
            // Check IndexedDB thumbnail first
            let thumb = await getThumbnail(photo.relativePath)
            let dataUrl: string | undefined = undefined

            if (!thumb) {
              dataUrl = await sdk.workspace!.readFile(photo.relativePath, 'time-album')
              if (!dataUrl) return null
              thumb = await createThumbnail(dataUrl, 320)
              await saveThumbnail(photo.relativePath, thumb)
            }

            // Parse EXIF
            let exif = photo.exif
            let date = photo.date
            if (!exif && (dataUrl || thumb)) {
              exif = parseExifFromDataUrl(dataUrl || thumb!)
              if (exif.dateTimeOriginal) {
                const parts = exif.dateTimeOriginal.split(' ')
                if (parts.length >= 1) {
                  const dateParts = parts[0].split(':')
                  if (dateParts.length === 3) {
                    const y = parseInt(dateParts[0], 10)
                    const m = parseInt(dateParts[1], 10)
                    const d = parseInt(dateParts[2], 10)
                    if (!isNaN(y) && !isNaN(m) && !isNaN(d)) {
                      date = new Date(y, m - 1, d)
                    }
                  }
                }
              }
            }

            const year = date.getFullYear()
            const month = date.getMonth() + 1
            const day = date.getDate()
            const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`

            // Local AI analysis if enabled
            let aiTags = photo.aiTags || []
            if (enableAiTags && aiTags.length === 0) {
              aiTags = await analyzePhotoWithDataUrl(
                { ...photo, exif, date, year, month, day },
                thumb
              )
            }

            const userTags = photo.userTags || []
            const combinedTags = Array.from(new Set([...userTags, ...aiTags]))

            return {
              id: photo.id,
              thumb,
              exif,
              date,
              dateStr,
              year,
              month,
              day,
              aiTags,
              combinedTags
            }
          } catch (err) {
            console.warn(`Error processing metadata for ${photo.name}:`, err)
            return null
          }
        })
      )

      if (sessionId !== scanSessionRef.current) return

      const validUpdates = updates.filter(Boolean) as {
        id: string
        thumb: string | null
        exif: any
        date: Date
        dateStr: string
        year: number
        month: number
        day: number
        aiTags: string[]
        combinedTags: string[]
      }[]

      if (validUpdates.length > 0) {
        const updateMap = new Map(validUpdates.map((u) => [u.id, u]))
        setPhotos((prev) =>
          prev.map((p) => {
            const u = updateMap.get(p.id)
            if (!u) return p
            return {
              ...p,
              thumbnailUrl: u.thumb || p.thumbnailUrl,
              exif: u.exif || p.exif,
              date: u.date || p.date,
              dateStr: u.dateStr || p.dateStr,
              year: u.year || p.year,
              month: u.month || p.month,
              day: u.day || p.day,
              aiTags: u.aiTags.length > 0 ? u.aiTags : p.aiTags,
              tags: u.combinedTags
            }
          })
        )
      }

      setScanProgress({ processed: Math.min(i + chunkSize, total), total })
    }

    setScanProgress(null)
  }

  // Initial load or when albumSourceKey changes
  useEffect(() => {
    loadPhotos()
  }, [loadPhotos])

  // Run AI analysis on all current photos
  const runBatchAiAnalysis = async (photoList: PhotoItem[]) => {
    setIsAnalyzingAi(true)
    let totalTagsCount = 0
    let portraitCount = 0

    const updatedList = [...photoList]
    const chunkSize = 6

    for (let i = 0; i < updatedList.length; i += chunkSize) {
      const chunk = updatedList.slice(i, i + chunkSize)
      await Promise.all(
        chunk.map(async (photo, chunkIdx) => {
          const globalIdx = i + chunkIdx
          try {
            const thumb = photo.thumbnailUrl || (await getThumbnail(photo.relativePath))
            const tags = await analyzePhotoWithDataUrl(photo, thumb || undefined)
            if (tags.includes('人像')) portraitCount++
            totalTagsCount += tags.length

            const userTags = photo.userTags || []
            const combinedTags = Array.from(new Set([...userTags, ...tags]))

            updatedList[globalIdx] = {
              ...photo,
              aiTags: tags,
              tags: combinedTags
            }
          } catch (e) {
            console.warn('AI analyze failed for:', photo.name, e)
          }
        })
      )
    }

    setPhotos(updatedList)
    setIsAnalyzingAi(false)

    showToast(
      `✨ 本地智能检索分析完成！已识别 ${totalTagsCount} 个场景标签${
        portraitCount > 0 ? `，发现 ${portraitCount} 张人像照片` : ''
      }`
    )
  }

  // Toggle AI features
  const handleToggleAi = () => {
    const nextVal = !enableAiTags
    setEnableAiTags(nextVal)
    localStorage.setItem('doujiao_album_ai_enabled', String(nextVal))

    if (nextVal) {
      showToast('🤖 已启用本地智能检索，正在对照片进行离线色彩与人像分析...')
      runBatchAiAnalysis(photos)
    } else {
      showToast('已关闭智能检索')
      setActiveFilterTag(null)
    }
  }

  // Compute all available tags for the filter bar
  const availableTags = useMemo(() => {
    const tagCountMap = new Map<string, number>()
    for (const p of photos) {
      if (p.tags) {
        for (const t of p.tags) {
          tagCountMap.set(t, (tagCountMap.get(t) || 0) + 1)
        }
      }
    }

    // Sort by count descending
    return Array.from(tagCountMap.entries())
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => {
        // Keep '人像' near the top
        if (a.tag === '人像') return -1
        if (b.tag === '人像') return 1
        return b.count - a.count
      })
  }, [photos])

  // Filtered photos based on search query, date range & active tag chip
  const filteredPhotos = useMemo(() => {
    return photos.filter((p) => {
      // 1. Tag chip filter
      if (activeFilterTag) {
        if (!p.tags || !p.tags.includes(activeFilterTag)) {
          return false
        }
      }

      // 2. Date range filter
      if (dateFrom && p.dateStr < dateFrom) return false
      if (dateTo && p.dateStr > dateTo) return false

      // 3. Text query filter
      if (searchQuery.trim()) {
        return matchPhotoQuery(p, searchQuery, peopleNamesMap)
      }

      return true
    })
  }, [photos, searchQuery, activeFilterTag, dateFrom, dateTo, peopleNamesMap])

  // Compute "那年今日" memories
  const memories: OnThisDayMemory[] = useMemo(() => {
    const today = new Date()
    const todayMonth = today.getMonth() + 1
    const todayDay = today.getDate()
    const currentYear = today.getFullYear()

    const memMap = new Map<number, PhotoItem[]>()

    for (const photo of photos) {
      if (
        photo.month === todayMonth &&
        photo.day === todayDay &&
        photo.year < currentYear
      ) {
        if (!memMap.has(photo.year)) {
          memMap.set(photo.year, [])
        }
        memMap.get(photo.year)!.push(photo)
      }
    }

    const result: OnThisDayMemory[] = []
    memMap.forEach((pList, yr) => {
      const yearsAgo = currentYear - yr
      result.push({
        yearsAgo,
        year: yr,
        dateStr: `${yr}年${todayMonth}月${todayDay}日`,
        label: `${yearsAgo}年前的今天`,
        photos: pList
      })
    })

    return result.sort((a, b) => b.year - a.year)
  }, [photos])

  // Group photos into MonthGroup and DateGroup
  const monthGroups: MonthGroup[] = useMemo(() => {
    const monthsMap = new Map<string, Map<string, PhotoItem[]>>()

    for (const photo of filteredPhotos) {
      const mStr = `${photo.year}-${String(photo.month).padStart(2, '0')}`
      if (!monthsMap.has(mStr)) {
        monthsMap.set(mStr, new Map())
      }
      const daysMap = monthsMap.get(mStr)!
      if (!daysMap.has(photo.dateStr)) {
        daysMap.set(photo.dateStr, [])
      }
      daysMap.get(photo.dateStr)!.push(photo)
    }

    const res: MonthGroup[] = []
    monthsMap.forEach((daysMap, mStr) => {
      const [y, m] = mStr.split('-')
      const dateGroups: DateGroup[] = []
      let totalCount = 0

      daysMap.forEach((pList, dStr) => {
        totalCount += pList.length
        const sampleDate = pList[0].date
        const weekDayNames = ['日', '一', '二', '三', '四', '五', '六']
        const weekDay = weekDayNames[sampleDate.getDay()]
        dateGroups.push({
          dateStr: dStr,
          label: `${parseInt(m, 10)}月${sampleDate.getDate()}日 星期${weekDay}`,
          photos: pList
        })
      })

      res.push({
        monthStr: mStr,
        label: `${y}年 ${parseInt(m, 10)}月`,
        count: totalCount,
        dateGroups
      })
    })

    return res
  }, [filteredPhotos])

  // Photo viewer select handler
  const handleSelectPhoto = async (photo: PhotoItem) => {
    if (!photo.dataUrl && sdk?.workspace) {
      try {
        const fullUrl = await sdk.workspace.readFile(photo.relativePath, 'time-album')
        photo = { ...photo, dataUrl: fullUrl }
      } catch (err) {
        console.warn('Failed to load full image:', err)
      }
    }
    setSelectedPhoto(photo)
  }

  // Update single photo in list
  const handleUpdatePhoto = (updated: PhotoItem) => {
    setPhotos((prev) => prev.map((p) => (p.id === updated.id ? updated : p)))
    if (selectedPhoto?.id === updated.id) {
      setSelectedPhoto(updated)
    }
  }

  // Update people list and sync to state
  const handleUpdatePeople = (newPeople: PersonProfile[]) => {
    setPeople(newPeople)
    saveAllPeople(newPeople)
  }

  // Switch album source handlers
  const applyAlbumSource = async (newSource: AlbumSource, successMessage: string) => {
    const changed = await switchAlbumSource(albumSource, newSource, {
      cancelPendingLoads: () => {
        scanSessionRef.current++
        setLoading(true)
        setScanProgress(null)
      },
      resetClusterRuntime: () => IdleClusterService.getInstance().resetForSourceChange(),
      clearPeople: () => {
        saveAllPeople([])
        setPeople([])
      },
      clearPhotos: () => setPhotos([]),
      clearFaceRecords: clearAllCachedFaceRecords,
      activateSource: (source) => {
        saveActiveAlbumSource(source)
        setAlbumSource(source)
      }
    })

    if (changed) showToast(successMessage)
  }

  const handleSwitchToLocal = async () => {
    const newSource: AlbumSource = { type: 'local', path: directory }
    await applyAlbumSource(newSource, '📁 已切换至本地相册，人物分类将按新数据源重新生成')
  }

  const handleSwitchToS3 = async (newSource: S3AlbumSource) => {
    await applyAlbumSource(
      newSource,
      `🪣 已切换至对象存储: ${newSource.bucket}/${newSource.prefix || ''}，人物分类将重新生成`
    )
  }

  const handleSelectLocalDirectory = async () => {
    if (!sdk?.workspace) return
    const res = await sdk.workspace.selectDirectory(directory)
    if (!res.canceled && res.directoryPath) {
      await sdk.workspace.setDirectory(res.directoryPath, 'time-album')
      setDirectory(res.directoryPath)
      const newSource: AlbumSource = { type: 'local', path: res.directoryPath }
      await applyAlbumSource(newSource, '📁 已更换本地相册目录，人物分类将按新目录重新生成')
    }
  }

  const handleOpenLocalDirectory = async () => {
    if (!sdk?.workspace) return
    await sdk.workspace.openDirectory('time-album')
  }

  // Calculate total file size
  const totalSizeStr = useMemo(() => {
    const totalBytes = photos.reduce((acc, cur) => acc + cur.size, 0)
    if (totalBytes < 1024 * 1024) return `${(totalBytes / 1024).toFixed(1)} KB`
    if (totalBytes < 1024 * 1024 * 1024)
      return `${(totalBytes / (1024 * 1024)).toFixed(1)} MB`
    return `${(totalBytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
  }, [photos])

  return (
    <div className="flex flex-col h-screen w-screen bg-background text-foreground select-none overflow-hidden">
      {/* Top Navigation & Toolbar */}
      <header className="flex-shrink-0 border-b border-border/60 bg-background/90 backdrop-blur-md px-4 py-2 z-30 flex flex-wrap items-center justify-between gap-3">
        {/* Left: Brand, Views Switcher & Directory */}
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-primary/10 text-primary flex items-center justify-center text-lg shadow-xs shrink-0">
              📸
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <h1 className="text-sm font-bold tracking-tight text-foreground truncate">
                  时光相册
                </h1>
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground font-medium shrink-0">
                  {photos.length} 张 • {totalSizeStr}
                </span>
              </div>
              {albumSource.type === 'local' ? (
                <p
                  className="text-[11px] text-muted-foreground/80 truncate max-w-[150px] cursor-pointer hover:underline"
                  onClick={handleOpenLocalDirectory}
                  title={`本地相册目录: ${directory}。点击在系统资源管理器中打开`}
                >
                  📁 {directory ? (directory.split(/[/\\]/).filter(Boolean).pop() || directory) : '本地相册'}
                </p>
              ) : (
                <div
                  className="flex items-center gap-1 cursor-pointer hover:underline max-w-[180px]"
                  onClick={() => setIsSourceModalOpen(true)}
                  title={`对象存储: ${albumSource.bucket}/${albumSource.prefix || ''}。点击切换相册源`}
                >
                  <span className="text-[10px] px-1.5 py-0.2 rounded bg-amber-500/15 text-amber-500 font-medium shrink-0">
                    S3/云端
                  </span>
                  <p className="text-[11px] text-muted-foreground/80 truncate">
                    {albumSource.bucket}{albumSource.prefix ? `/${albumSource.prefix}` : ''}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Primary View Switcher: [时间轴] | [人物] */}
          <div className="flex items-center bg-muted/60 p-0.5 rounded-xl border border-border/40 shrink-0">
            <button
              onClick={handleTimelineClick}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
                viewMode === 'timeline'
                  ? 'bg-background shadow-xs text-foreground font-semibold'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              title="切换至相册时间轴视图，再次点击平滑回到顶部并还原全部照片"
            >
              <span>📅</span>
              <span>时间轴</span>
            </button>
            <button
              onClick={() => setViewMode('people')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
                viewMode === 'people'
                  ? 'bg-background shadow-xs text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <span>👥</span>
              <span>人物 ({people.length})</span>
            </button>
          </div>

          {/* Global Face Scanning & Clustering Status Pill */}
          {photos.length > 0 && (
            <div
              onClick={() => setViewMode('people')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-medium cursor-pointer transition-all border shadow-2xs shrink-0 select-none ${
                idleClusterState.status === 'completed' || (idleClusterState.processedCount >= photos.length && photos.length > 0)
                  ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/25'
                  : idleClusterState.status === 'analyzing'
                  ? 'bg-primary/15 border-primary/30 text-primary hover:bg-primary/25 animate-pulse'
                  : idleClusterState.status === 'no_model'
                  ? 'bg-amber-500/15 border-amber-500/30 text-amber-600 dark:text-amber-400 hover:bg-amber-500/25'
                  : 'bg-muted/70 border-border/60 text-muted-foreground hover:text-foreground hover:bg-muted'
              }`}
              title={
                idleClusterState.status === 'completed' || (idleClusterState.processedCount >= photos.length && photos.length > 0)
                  ? `人脸扫描归类已全部完成 (${idleClusterState.processedCount}/${photos.length} 张，共识别 ${idleClusterState.facesFoundCount} 处面孔)。点击查看人物相册`
                  : idleClusterState.status === 'analyzing'
                  ? `正在后台空闲扫描人脸特征: ${idleClusterState.processedCount}/${photos.length} 张 (${Math.round((idleClusterState.processedCount / Math.max(1, photos.length)) * 100)}%)。点击进入人物相册`
                  : idleClusterState.status === 'no_model'
                  ? '端侧人脸识别模型尚未下载，点击进入人物相册一键下载'
                  : `后台空闲聚类就绪: ${idleClusterState.processedCount}/${photos.length} 张已扫描。点击进入人物相册`
              }
            >
              {(idleClusterState.status === 'completed' || (idleClusterState.processedCount >= photos.length && photos.length > 0)) ? (
                <>
                  <span className="w-3.5 h-3.5 rounded-full bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 flex items-center justify-center text-[10px] font-bold">
                    ✓
                  </span>
                  <span>人脸已归类 ({idleClusterState.processedCount}/{photos.length})</span>
                </>
              ) : idleClusterState.status === 'analyzing' ? (
                <>
                  <span className="text-xs">🍃</span>
                  <span>人脸扫描中 {idleClusterState.processedCount}/{photos.length}</span>
                  <span className="text-[10px] opacity-80">
                    ({Math.round((idleClusterState.processedCount / Math.max(1, photos.length)) * 100)}%)
                  </span>
                </>
              ) : idleClusterState.status === 'no_model' ? (
                <>
                  <span className="text-xs">⚠️</span>
                  <span>人脸模型未下载</span>
                </>
              ) : (
                <>
                  <span className="text-xs">🍃</span>
                  <span>人脸扫描: {idleClusterState.processedCount}/{photos.length}</span>
                  {photos.length > 0 && (
                    <span className="text-[10px] opacity-75">
                      ({Math.round((idleClusterState.processedCount / photos.length) * 100)}%)
                    </span>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {/* Center: Search Bar + Date Filter Toggle */}
        <div className="flex items-center gap-1.5 flex-shrink min-w-0">
          <div className="relative min-w-[140px] w-40 sm:w-56 flex-shrink">
            <svg
              className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <circle cx="11" cy="11" r="8" strokeWidth="2" />
              <path strokeLinecap="round" strokeWidth="2" d="M21 21l-4.35-4.35" />
            </svg>
            <input
              type="text"
              placeholder="搜索照片、人物、标签..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-7 py-1 rounded-xl text-xs bg-muted/60 hover:bg-muted/80 focus:bg-background border border-border/60 focus:border-primary focus:outline-none transition-all shadow-2xs"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground text-xs"
              >
                ✕
              </button>
            )}
          </div>

          {/* Date Range Filter Toggle Button */}
          {viewMode === 'timeline' && (
            <button
              onClick={() => setShowDateFilter((v) => !v)}
              title="按时间段筛选"
              className={`flex items-center gap-1 px-2 py-1 rounded-xl text-xs border transition-colors shadow-2xs shrink-0 ${
                showDateFilter || dateFrom || dateTo
                  ? 'bg-primary/15 text-primary border-primary/30'
                  : 'bg-muted/40 hover:bg-muted/70 text-muted-foreground border-border/40'
              }`}
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <rect x="3" y="4" width="18" height="18" rx="2" strokeWidth="2" />
                <path strokeLinecap="round" strokeWidth="2" d="M16 2v4M8 2v4M3 10h18" />
              </svg>
              {(dateFrom || dateTo) ? (
                <span className="hidden sm:inline max-w-[80px] truncate">
                  {dateFrom || '…'} ~ {dateTo || '…'}
                </span>
              ) : (
                <span className="hidden sm:inline">时间段</span>
              )}
            </button>
          )}
        </div>

        {/* Right: Controls & Toggles */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* AI Toggle Button */}
          <button
            onClick={handleToggleAi}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-medium border transition-colors shadow-2xs shrink-0 ${
              enableAiTags
                ? 'bg-primary/15 text-primary border-primary/30 hover:bg-primary/20'
                : 'bg-muted/40 hover:bg-muted/70 text-muted-foreground border-border/40'
            }`}
            title={`端侧AI智能检索 (${enableAiTags ? '已开启' : '已关闭'})`}
          >
            {isAnalyzingAi ? (
              <div className="w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            ) : (
              <span>🤖</span>
            )}
            <span>智能检索</span>
            <span className={`w-1.5 h-1.5 rounded-full ${enableAiTags ? 'bg-emerald-400' : 'bg-slate-500'}`} />
          </button>

          {/* Grid Size Switch (Timeline only) */}
          {viewMode === 'timeline' && (
            <div className="flex items-center bg-muted/50 p-0.5 rounded-xl border border-border/40 shrink-0">
              {(['small', 'medium', 'large'] as GridSize[]).map((size) => (
                <button
                  key={size}
                  onClick={() => setGridSize(size)}
                  className={`px-2 py-0.5 rounded-lg text-xs transition-colors ${
                    gridSize === size
                      ? 'bg-background shadow-xs text-foreground font-medium'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                  title={`网格视图: ${size === 'small' ? '小' : size === 'medium' ? '中' : '大'}`}
                >
                  {size === 'small' ? '小' : size === 'medium' ? '中' : '大'}
                </button>
              ))}
            </div>
          )}

          {/* Slideshow Button */}
          <button
            onClick={() => setSlideshowPhotos(filteredPhotos)}
            disabled={filteredPhotos.length === 0}
            className="flex items-center gap-1 px-2.5 py-1 rounded-xl bg-muted/50 hover:bg-muted text-foreground border border-border/50 text-xs font-medium transition-colors shadow-2xs disabled:opacity-40 shrink-0"
            title="全屏幻灯片播放当前相册"
          >
            <span>▶</span>
            <span className="hidden md:inline">幻灯片</span>
          </button>

          {/* Choose Folder / Source Button */}
          <button
            onClick={() => setIsSourceModalOpen(true)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-muted/50 hover:bg-muted text-foreground border border-border/50 text-xs font-medium transition-colors shadow-2xs shrink-0"
            title={
              albumSource.type === 'local'
                ? `当前相册目录: ${directory}。点击切换相册源`
                : `当前对象存储: ${albumSource.bucket}/${albumSource.prefix || ''}。点击切换相册源`
            }
          >
            <span>{albumSource.type === 'local' ? '📁' : '🪣'}</span>
            <span>切换相册源</span>
          </button>

          {/* Refresh Button */}
          <button
            onClick={loadPhotos}
            disabled={loading}
            className="p-1 rounded-xl bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground border border-border/50 transition-colors disabled:opacity-50 shrink-0"
            title="重新扫描相册"
          >
            <svg
              className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
          </button>
        </div>
      </header>

      {/* Date Range Filter Row (collapsible) */}
      {viewMode === 'timeline' && showDateFilter && (
        <div className="flex-shrink-0 bg-muted/20 border-b border-border/40 px-5 py-2.5 flex flex-wrap items-center gap-3 z-20">
          <span className="text-[11px] text-muted-foreground font-semibold flex items-center gap-1 flex-shrink-0">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <rect x="3" y="4" width="18" height="18" rx="2" strokeWidth="2" />
              <path strokeLinecap="round" strokeWidth="2" d="M16 2v4M8 2v4M3 10h18" />
            </svg>
            时间段:
          </span>

          <div className="flex items-center gap-2 flex-wrap">
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="px-2 py-1 rounded-lg text-xs bg-background border border-border/60 focus:border-primary focus:outline-none text-foreground"
              title="起始日期"
            />
            <span className="text-muted-foreground text-xs">至</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="px-2 py-1 rounded-lg text-xs bg-background border border-border/60 focus:border-primary focus:outline-none text-foreground"
              title="结束日期"
            />

            {/* Quick presets */}
            {[
              { label: '今年', from: `${new Date().getFullYear()}-01-01`, to: `${new Date().getFullYear()}-12-31` },
              { label: '去年', from: `${new Date().getFullYear() - 1}-01-01`, to: `${new Date().getFullYear() - 1}-12-31` },
              { label: '近3年', from: `${new Date().getFullYear() - 2}-01-01`, to: `${new Date().getFullYear()}-12-31` },
            ].map(({ label, from, to }) => (
              <button
                key={label}
                onClick={() => { setDateFrom(from); setDateTo(to) }}
                className={`px-2 py-0.5 rounded-md text-[11px] border transition-colors ${
                  dateFrom === from && dateTo === to
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-background hover:bg-muted text-muted-foreground border-border/40'
                }`}
              >
                {label}
              </button>
            ))}

            {(dateFrom || dateTo) && (
              <button
                onClick={() => { setDateFrom(''); setDateTo('') }}
                className="text-[11px] text-muted-foreground hover:text-destructive underline ml-1"
              >
                清除日期
              </button>
            )}
          </div>

          {filteredPhotos.length > 0 && (dateFrom || dateTo) && (
            <span className="text-[11px] text-muted-foreground ml-auto flex-shrink-0">
              共 {filteredPhotos.length} 张
            </span>
          )}
        </div>
      )}

      {/* Interactive Smart Tag Filter Bar (Shown when AI tags or custom tags exist) */}
      {viewMode === 'timeline' && availableTags.length > 0 && (
        <div className="flex-shrink-0 bg-muted/30 border-b border-border/40 px-5 py-2 flex items-center gap-2 overflow-x-auto custom-scrollbar text-xs z-20">
          <span className="text-[11px] text-muted-foreground font-semibold flex-shrink-0 flex items-center gap-1">
            <span>🏷️ 智能筛选:</span>
          </span>

          {/* All chip */}
          <button
            onClick={() => setActiveFilterTag(null)}
            className={`px-2.5 py-1 rounded-lg text-xs font-medium flex-shrink-0 transition-colors ${
              activeFilterTag === null
                ? 'bg-primary text-primary-foreground shadow-2xs'
                : 'bg-background hover:bg-muted text-muted-foreground hover:text-foreground border border-border/40'
            }`}
          >
            全部 ({photos.length})
          </button>

          {/* Tag pills */}
          {availableTags.map(({ tag, count }) => {
            const isSelected = activeFilterTag === tag
            const isPortrait = tag === '人像'
            return (
              <button
                key={tag}
                onClick={() => setActiveFilterTag(isSelected ? null : tag)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium flex-shrink-0 transition-all flex items-center gap-1.5 ${
                  isSelected
                    ? 'bg-primary text-primary-foreground shadow-2xs'
                    : isPortrait
                    ? 'bg-primary/10 hover:bg-primary/20 text-primary border border-primary/30'
                    : 'bg-background hover:bg-muted text-muted-foreground hover:text-foreground border border-border/40'
                }`}
              >
                <span>{isPortrait ? '👤' : '#'}</span>
                <span>{tag}</span>
                <span className={`text-[10px] opacity-75 ${isSelected ? 'text-primary-foreground' : ''}`}>
                  {count}
                </span>
              </button>
            )
          })}

          {/* Clear filter button if active */}
          {(activeFilterTag || searchQuery || dateFrom || dateTo) && (
            <button
              onClick={() => {
                setActiveFilterTag(null)
                setSearchQuery('')
                setDateFrom('')
                setDateTo('')
              }}
              className="text-[11px] text-muted-foreground hover:text-destructive underline flex-shrink-0 ml-1"
            >
              清除全部筛选
            </button>
          )}
        </div>
      )}

      {/* Scanning / Analyzing Progress Indicator */}
      {(scanProgress || isAnalyzingAi) && (
        <div className="h-0.5 w-full bg-primary/20">
          <div
            className={`h-full bg-primary transition-all duration-300 ${
              isAnalyzingAi ? 'animate-pulse w-full' : ''
            }`}
            style={{
              width: scanProgress
                ? `${Math.round((scanProgress.processed / scanProgress.total) * 100)}%`
                : '100%'
            }}
          />
        </div>
      )}

      {/* Floating Toast Feedback */}
      {toastMessage && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 bg-foreground/95 text-background px-4 py-2 rounded-xl text-xs font-medium shadow-xl border border-border/20 flex items-center gap-2 animate-in fade-in slide-in-from-bottom-3 duration-200">
          <span>{toastMessage}</span>
          <button
            onClick={() => setToastMessage(null)}
            className="text-background/60 hover:text-background text-xs ml-1"
          >
            ✕
          </button>
        </div>
      )}

      {/* Main Content Area */}
      <main ref={mainScrollRef} className="flex-1 overflow-y-auto px-6 py-6 custom-scrollbar">
        {viewMode === 'timeline' ? (
          <>
            {/* On This Day Memories Banner (Shown when not searching or tag-filtering) */}
            {!searchQuery && !activeFilterTag && (
              <OnThisDayBanner
                memories={memories}
                onSelectPhoto={handleSelectPhoto}
                onPlaySlideshow={(mPhotos) => setSlideshowPhotos(mPhotos)}
              />
            )}

            {/* Timeline Gallery Grid */}
            {loading ? (
              <div className="flex flex-col items-center justify-center py-24 text-muted-foreground gap-3">
                <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                <p className="text-xs">正在扫描相册文件与建立缩略图缓存...</p>
              </div>
            ) : (
              <TimelineGallery
                monthGroups={monthGroups}
                gridSize={gridSize}
                onSelectPhoto={handleSelectPhoto}
                onPlaySlideshow={(mPhotos) => setSlideshowPhotos(mPhotos)}
                onTagClick={(tag) => setActiveFilterTag(tag)}
                onScrollTop={() => mainScrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
              />
            )}
          </>
        ) : (
          /* People View */
          <PeopleView
            people={people}
            photos={photos}
            idleState={idleClusterState}
            onUpdatePeople={handleUpdatePeople}
            onSelectPhoto={handleSelectPhoto}
            onPlaySlideshow={(pPhotos) => setSlideshowPhotos(pPhotos)}
            onToast={showToast}
          />
        )}
      </main>

      {/* Photo Viewer Modal */}
      {selectedPhoto && (
        <PhotoViewerModal
          photo={selectedPhoto}
          photos={filteredPhotos}
          people={people}
          onClose={() => setSelectedPhoto(null)}
          onSelectPhoto={handleSelectPhoto}
          onUpdatePeople={handleUpdatePeople}
          onUpdatePhoto={handleUpdatePhoto}
        />
      )}

      {/* Slideshow Modal */}
      {slideshowPhotos && (
        <SlideshowModal
          photos={slideshowPhotos}
          onClose={() => setSlideshowPhotos(null)}
        />
      )}

      {/* Storage Source Modal */}
      <StorageSourceModal
        isOpen={isSourceModalOpen}
        onClose={() => setIsSourceModalOpen(false)}
        currentSource={albumSource}
        localDirectory={directory}
        onSelectLocalDirectory={handleSelectLocalDirectory}
        onOpenLocalDirectory={handleOpenLocalDirectory}
        onSwitchToLocal={handleSwitchToLocal}
        onSwitchToS3={handleSwitchToS3}
      />
    </div>
  )
}

export default App
