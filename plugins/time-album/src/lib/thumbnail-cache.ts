const DB_NAME = 'doujiao_time_album_db'
const DB_VERSION = 1
const STORE_NAME = 'thumbnails'

let dbPromise: Promise<IDBDatabase> | null = null

function openDB(): Promise<IDBDatabase> {
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

export async function getThumbnail(key: string): Promise<string | null> {
  try {
    const db = await openDB()
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const store = tx.objectStore(STORE_NAME)
      const req = store.get(key)
      req.onsuccess = () => resolve((req.result as string) || null)
      req.onerror = () => resolve(null)
    })
  } catch {
    return null
  }
}

export async function saveThumbnail(key: string, thumbDataUrl: string): Promise<void> {
  try {
    const db = await openDB()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      const req = store.put(thumbDataUrl, key)
      req.onsuccess = () => resolve()
      req.onerror = () => reject(req.error)
    })
  } catch (err) {
    console.warn('Failed to save thumbnail to cache:', err)
  }
}

export function createThumbnail(dataUrl: string, maxDim = 320): Promise<string> {
  const renderCanvas = (img: HTMLImageElement): string | null => {
    let width = img.naturalWidth || img.width
    let height = img.naturalHeight || img.height
    if (width === 0 || height === 0) return null

    if (width > maxDim || height > maxDim) {
      if (width > height) {
        height = Math.round((height * maxDim) / width)
        width = maxDim
      } else {
        width = Math.round((width * maxDim) / height)
        height = maxDim
      }
    }

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return null

    ctx.drawImage(img, 0, 0, width, height)
    return canvas.toDataURL('image/jpeg', 0.82)
  }

  return new Promise<string>((resolve) => {
    const img = new Image()
    if (!dataUrl.startsWith('data:') && !dataUrl.startsWith('blob:')) {
      img.crossOrigin = 'anonymous'
    }

    const tryFetchBlob = async () => {
      if (dataUrl.startsWith('http://') || dataUrl.startsWith('https://')) {
        try {
          const resp = await fetch(dataUrl)
          if (!resp.ok) return dataUrl
          const blob = await resp.blob()
          const objUrl = URL.createObjectURL(blob)
          const fallbackImg = new Image()
          return await new Promise<string>((res) => {
            fallbackImg.onload = () => {
              try {
                const thumb = renderCanvas(fallbackImg) || dataUrl
                URL.revokeObjectURL(objUrl)
                res(thumb)
              } catch {
                URL.revokeObjectURL(objUrl)
                res(dataUrl)
              }
            }
            fallbackImg.onerror = () => {
              URL.revokeObjectURL(objUrl)
              res(dataUrl)
            }
            fallbackImg.src = objUrl
          })
        } catch {
          return dataUrl
        }
      }
      return dataUrl
    }

    img.onload = async () => {
      try {
        const thumb = renderCanvas(img)
        if (thumb) {
          resolve(thumb)
        } else {
          resolve(await tryFetchBlob())
        }
      } catch {
        resolve(await tryFetchBlob())
      }
    }

    img.onerror = async () => {
      resolve(await tryFetchBlob())
    }

    img.src = dataUrl
  })
}

export async function clearThumbnailCache(): Promise<void> {
  try {
    const db = await openDB()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      const req = store.clear()
      req.onsuccess = () => resolve()
      req.onerror = () => reject(req.error)
    })
  } catch (err) {
    console.warn('Failed to clear thumbnail cache:', err)
  }
}
