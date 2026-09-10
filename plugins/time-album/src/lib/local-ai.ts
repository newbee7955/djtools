import { PhotoItem } from '../types/album'

/**
 * Local AI & Smart Scene/Portrait Tagging Module
 * 100% offline, zero network requests, zero data privacy leakage.
 */

export interface AISceneTag {
  category: string
  label: string
  confidence: number
}

/**
 * Analyze an image element or canvas for skin tones and portrait presence
 */
function detectPortraitFromImageData(
  imgData: Uint8ClampedArray,
  width: number,
  height: number
): boolean {
  let skinPixelCount = 0
  let centerSkinPixelCount = 0
  const totalPixels = width * height

  // Define center bounding box (25% to 75% horizontally and vertically)
  const minX = Math.floor(width * 0.2)
  const maxX = Math.floor(width * 0.8)
  const minY = Math.floor(height * 0.15)
  const maxY = Math.floor(height * 0.85)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4
      const r = imgData[idx]
      const g = imgData[idx + 1]
      const b = imgData[idx + 2]

      // YCbCr skin tone detection
      const Y = 0.299 * r + 0.587 * g + 0.114 * b
      const Cb = -0.1687 * r - 0.3313 * g + 0.5 * b + 128
      const Cr = 0.5 * r - 0.4187 * g - 0.0813 * b + 128

      // Typical human skin chrominance cluster
      const isSkin = Y > 50 && Cb >= 80 && Cb <= 135 && Cr >= 135 && Cr <= 180

      if (isSkin) {
        skinPixelCount++
        if (x >= minX && x <= maxX && y >= minY && y <= maxY) {
          centerSkinPixelCount++
        }
      }
    }
  }

  const overallSkinRatio = skinPixelCount / totalPixels
  const centerPixels = (maxX - minX) * (maxY - minY)
  const centerSkinRatio = centerSkinPixelCount / (centerPixels || 1)

  // Portrait criteria: either significant center skin tone or good overall skin tone
  return (centerSkinRatio > 0.07 && overallSkinRatio > 0.05 && overallSkinRatio < 0.7) ||
         (overallSkinRatio >= 0.08 && overallSkinRatio <= 0.65)
}

/**
 * Synchronous local analysis using photo metadata and optional HTMLImageElement / HTMLCanvasElement
 */
export function analyzePhotoLocally(
  photo: PhotoItem,
  img?: HTMLImageElement | HTMLCanvasElement
): string[] {
  const tags = new Set<string>()

  // 1. Time & Season analysis from Date
  const month = photo.month
  if (month >= 3 && month <= 5) tags.add('春季')
  else if (month >= 6 && month <= 8) tags.add('夏季')
  else if (month >= 9 && month <= 11) tags.add('秋季')
  else tags.add('冬季')

  const hours = photo.date.getHours()
  if (hours >= 5 && hours < 9) tags.add('清晨')
  else if (hours >= 9 && hours < 17) tags.add('白天')
  else if (hours >= 17 && hours < 19) tags.add('黄昏')
  else tags.add('夜景')

  // 2. Camera & Hardware tags
  if (photo.exif?.cameraMake) {
    tags.add(photo.exif.cameraMake)
  }
  if (photo.exif?.cameraModel) {
    tags.add(photo.exif.cameraModel)
  }
  if (photo.exif?.lensModel) {
    tags.add(photo.exif.lensModel)
  }

  // 3. Filename & Path semantic hints
  const nameLower = (photo.name + ' ' + photo.relativePath).toLowerCase()
  if (/screen|shot|截屏|截图/i.test(nameLower)) tags.add('截图')
  if (/camera|dcim|img_|dsc_/i.test(nameLower)) tags.add('实拍')
  if (/food|美食|餐|eat|dish|cake|coffee/i.test(nameLower)) tags.add('美食')
  if (/trip|travel|旅游|风景|tour|mountain|sea|beach/i.test(nameLower)) tags.add('风景')
  if (/doc|scan|文档|合同|发票|receipt|pdf/i.test(nameLower)) tags.add('文档')
  if (/portrait|people|person|face|selfie|合影|自拍|人像|肖像/i.test(nameLower)) tags.add('人像')

  // 4. Visual pixel analysis if image or canvas is available
  if (img) {
    const w = (img as HTMLImageElement).naturalWidth || img.width
    const h = (img as HTMLImageElement).naturalHeight || img.height

    if (w > 0 && h > 0) {
      const ratio = w / h
      if (ratio > 1.9) tags.add('全景')
      else if (ratio > 1.2) tags.add('横屏')
      else if (ratio < 0.8) tags.add('人像构图')
      else tags.add('正方形')

      try {
        const canvas = document.createElement('canvas')
        const sampleSize = 48
        canvas.width = sampleSize
        canvas.height = sampleSize
        const ctx = canvas.getContext('2d', { willReadFrequently: true })

        if (ctx) {
          ctx.drawImage(img, 0, 0, sampleSize, sampleSize)
          const imgData = ctx.getImageData(0, 0, sampleSize, sampleSize).data
          let rTotal = 0, gTotal = 0, bTotal = 0
          let brightnessTotal = 0
          const count = sampleSize * sampleSize

          for (let i = 0; i < imgData.length; i += 4) {
            const r = imgData[i]
            const g = imgData[i + 1]
            const b = imgData[i + 2]
            rTotal += r
            gTotal += g
            bTotal += b
            brightnessTotal += (r * 299 + g * 587 + b * 114) / 1000
          }

          const avgR = rTotal / count
          const avgG = gTotal / count
          const avgB = bTotal / count
          const avgBright = brightnessTotal / count

          // Brightness classification
          if (avgBright < 50) {
            tags.add('夜景')
          } else if (avgBright > 215) {
            tags.add('高光/亮白')
            // If near monochrome white background, likely a document or screenshot
            if (Math.abs(avgR - avgG) < 8 && Math.abs(avgG - avgB) < 8) {
              tags.add('文档')
            }
          }

          // Dominant color tone discrimination
          if (avgB > avgR * 1.22 && avgB > avgG * 1.1) {
            tags.add('蓝天/海洋')
          } else if (avgG > avgR * 1.12 && avgG > avgB * 1.08) {
            tags.add('森林/自然')
          } else if (avgR > 135 && avgR > avgB * 1.35 && avgG > avgB * 1.05) {
            tags.add('日落/晚霞')
          }

          // Skin tone portrait detection
          const isPortrait = detectPortraitFromImageData(imgData, sampleSize, sampleSize)
          if (isPortrait) {
            tags.add('人像')
          }
        }
      } catch (err) {
        // Canvas security fallback
      }
    }
  }

  return Array.from(tags)
}

/**
 * Asynchronously analyze a photo from its dataUrl or thumbnail
 */
export function analyzePhotoWithDataUrl(
  photo: PhotoItem,
  imgDataUrl?: string
): Promise<string[]> {
  return new Promise((resolve) => {
    const url = imgDataUrl || photo.thumbnailUrl || photo.dataUrl
    if (!url) {
      resolve(analyzePhotoLocally(photo))
      return
    }

    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      try {
        const tags = analyzePhotoLocally(photo, img)
        resolve(tags)
      } catch {
        resolve(analyzePhotoLocally(photo))
      }
    }
    img.onerror = () => {
      resolve(analyzePhotoLocally(photo))
    }
    img.src = url
  })
}

/**
 * Smart query matching:
 * Matches filenames, dates, EXIF camera models, AI tags, and custom user tags
 */
export function matchPhotoQuery(
  photo: PhotoItem,
  query: string,
  peopleNamesMap?: Map<string, string> // personId -> name
): boolean {
  if (!query.trim()) return true
  const q = query.trim().toLowerCase()

  // Match filename
  if (photo.name.toLowerCase().includes(q)) return true

  // Match relative path
  if (photo.relativePath.toLowerCase().includes(q)) return true

  // Match year / date
  if (photo.dateStr.includes(q)) return true
  if (photo.year.toString() === q) return true
  if (`${photo.year}年`.includes(q)) return true
  if (`${photo.month}月`.includes(q)) return true

  // Match EXIF
  if (photo.exif?.cameraMake?.toLowerCase().includes(q)) return true
  if (photo.exif?.cameraModel?.toLowerCase().includes(q)) return true
  if (photo.exif?.lensModel?.toLowerCase().includes(q)) return true

  // Match AI tags
  if (photo.aiTags && photo.aiTags.some((t) => t.toLowerCase().includes(q))) {
    return true
  }

  // Match User custom tags
  if (photo.userTags && photo.userTags.some((t) => t.toLowerCase().includes(q))) {
    return true
  }

  // Match combined tags
  if (photo.tags && photo.tags.some((t) => t.toLowerCase().includes(q))) {
    return true
  }

  // Match associated People names
  if (photo.peopleIds && peopleNamesMap) {
    for (const pid of photo.peopleIds) {
      const pName = peopleNamesMap.get(pid)
      if (pName && pName.toLowerCase().includes(q)) {
        return true
      }
    }
  }

  return false
}
