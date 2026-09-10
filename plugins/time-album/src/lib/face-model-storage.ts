/**
 * IndexedDB storage & downloader for Offline Face Recognition Models
 * Models: TinyFaceDetector + FaceLandmark68Tiny + FaceRecognitionNet (Total ~6.6MB)
 */

export interface ModelFileInfo {
  name: string
  size: number
}

export const FACE_MODEL_FILES: ModelFileInfo[] = [
  { name: 'tiny_face_detector_model-weights_manifest.json', size: 3219 },
  { name: 'tiny_face_detector_model.bin', size: 193321 },
  { name: 'face_landmark_68_tiny_model-weights_manifest.json', size: 4806 },
  { name: 'face_landmark_68_tiny_model.bin', size: 77224 },
  { name: 'face_recognition_model-weights_manifest.json', size: 19615 },
  { name: 'face_recognition_model.bin', size: 6444032 }
]

export const TOTAL_MODEL_BYTES = FACE_MODEL_FILES.reduce((acc, f) => acc + f.size, 0)

const DB_NAME = 'doujiao_face_ai_db'
const DB_VERSION = 1
const STORE_NAME = 'face_models'

let dbPromise: Promise<IDBDatabase> | null = null

function openFaceModelDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

/**
 * Check if all required model files are present in IndexedDB
 */
export async function isFaceModelReady(): Promise<boolean> {
  try {
    const db = await openFaceModelDB()
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const store = tx.objectStore(STORE_NAME)
      let missing = false
      let checked = 0

      for (const file of FACE_MODEL_FILES) {
        const req = store.get(file.name)
        req.onsuccess = () => {
          if (!req.result) missing = true
          checked++
          if (checked === FACE_MODEL_FILES.length) {
            resolve(!missing)
          }
        }
        req.onerror = () => {
          missing = true
          checked++
          if (checked === FACE_MODEL_FILES.length) {
            resolve(false)
          }
        }
      }
    })
  } catch (err) {
    console.error('Failed to check face model status:', err)
    return false
  }
}

/**
 * Get a model file buffer from IndexedDB
 */
export async function getModelFile(name: string): Promise<ArrayBuffer | null> {
  try {
    const db = await openFaceModelDB()
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const store = tx.objectStore(STORE_NAME)
      const req = store.get(name)
      req.onsuccess = () => resolve((req.result as ArrayBuffer) || null)
      req.onerror = () => resolve(null)
    })
  } catch {
    return null
  }
}

/**
 * Save a model file buffer to IndexedDB
 */
export async function saveModelFile(name: string, data: ArrayBuffer): Promise<void> {
  const db = await openFaceModelDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    const req = store.put(data, name)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}

/**
 * Clear all cached model files from IndexedDB
 */
export async function clearFaceModelCache(): Promise<void> {
  try {
    const db = await openFaceModelDB()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      const req = store.clear()
      req.onsuccess = () => resolve()
      req.onerror = () => reject(req.error)
    })
  } catch (err) {
    console.warn('Failed to clear model cache:', err)
  }
}

/**
 * Candidate URLs for model download (CDN with GitHub Raw fallback)
 */
const CDN_BASE_URLS = [
  'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.15/model/',
  'https://raw.githubusercontent.com/newbee7955/djtools/main/registry/models/face/'
]

/**
 * Download all model files with progress reporting
 */
export async function downloadFaceModels(
  onProgress: (info: {
    loadedBytes: number
    totalBytes: number
    percentage: number
    currentFileName: string
  }) => void
): Promise<boolean> {
  let overallLoaded = 0

  for (const file of FACE_MODEL_FILES) {
    let downloaded = false

    for (const baseUrl of CDN_BASE_URLS) {
      const url = `${baseUrl}${file.name}`
      try {
        onProgress({
          loadedBytes: overallLoaded,
          totalBytes: TOTAL_MODEL_BYTES,
          percentage: Math.min(Math.round((overallLoaded / TOTAL_MODEL_BYTES) * 100), 99),
          currentFileName: file.name
        })

        const res = await fetch(url)
        if (!res.ok) continue

        const buffer = await res.arrayBuffer()
        await saveModelFile(file.name, buffer)
        overallLoaded += file.size
        downloaded = true
        break
      } catch (e) {
        console.warn(`Download failed from ${url}, trying next mirror...`, e)
      }
    }

    if (!downloaded) {
      throw new Error(`无法从镜像源下载模型权重文件: ${file.name}，请检查网络连接`)
    }
  }

  onProgress({
    loadedBytes: TOTAL_MODEL_BYTES,
    totalBytes: TOTAL_MODEL_BYTES,
    percentage: 100,
    currentFileName: '下载完成'
  })

  return true
}
