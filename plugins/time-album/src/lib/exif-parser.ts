import { PhotoExif } from '../types/album'

/**
 * Pure JavaScript zero-dependency EXIF parser
 * Parses standard TIFF/EXIF tags from JPEG images
 */
export function parseExifFromDataUrl(dataUrl: string): PhotoExif {
  try {
    const commaIdx = dataUrl.indexOf(',')
    if (commaIdx === -1) return {}
    const base64 = dataUrl.slice(commaIdx + 1)
    // Only decode first 128KB which contains all APP1 / EXIF metadata
    const sliceLen = Math.min(base64.length, 175000)
    const binary = atob(base64.slice(0, sliceLen))
    const len = binary.length
    const bytes = new Uint8Array(len)
    for (let i = 0; i < len; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    return parseExifFromBytes(bytes)
  } catch (err) {
    console.warn('Failed to parse EXIF from data URL:', err)
    return {}
  }
}

export function parseExifFromBytes(bytes: Uint8Array): PhotoExif {
  const result: PhotoExif = {}
  if (bytes.length < 14) return result

  // JPEG SOI check: 0xFF, 0xD8
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return result
  }

  let offset = 2
  const length = bytes.length

  while (offset < length - 4) {
    if (bytes[offset] !== 0xff) {
      offset++
      continue
    }

    const marker = bytes[offset + 1]
    // APP1 marker 0xFFE1
    if (marker === 0xe1) {
      const app1Length = (bytes[offset + 2] << 8) | bytes[offset + 3]
      const app1Start = offset + 4
      // Check Exif header: 'Exif\0\0'
      if (
        bytes[app1Start] === 0x45 &&
        bytes[app1Start + 1] === 0x78 &&
        bytes[app1Start + 2] === 0x69 &&
        bytes[app1Start + 3] === 0x66 &&
        bytes[app1Start + 4] === 0x00 &&
        bytes[app1Start + 5] === 0x00
      ) {
        const tiffStart = app1Start + 6
        readTiffData(bytes, tiffStart, app1Start + app1Length, result)
      }
      break
    } else if (marker === 0xda || marker === 0xd9) {
      // Start of scan or end of image
      break
    } else {
      // Skip other segments
      const segmentLen = (bytes[offset + 2] << 8) | bytes[offset + 3]
      offset += 2 + segmentLen
    }
  }

  return result
}

function readTiffData(
  bytes: Uint8Array,
  tiffStart: number,
  maxOffset: number,
  exif: PhotoExif
) {
  if (tiffStart + 8 > maxOffset) return

  // Endianness: 'II' (0x4949) = little-endian, 'MM' (0x4D4D) = big-endian
  const isLittle = bytes[tiffStart] === 0x49 && bytes[tiffStart + 1] === 0x49
  const view = new DataView(
    bytes.buffer,
    bytes.byteOffset + tiffStart,
    Math.min(bytes.length - tiffStart, maxOffset - tiffStart)
  )

  const get16 = (pos: number) => view.getUint16(pos, isLittle)
  const get32 = (pos: number) => view.getUint32(pos, isLittle)

  const firstIFDOffset = get32(4)
  if (firstIFDOffset < 8 || firstIFDOffset >= view.byteLength) return

  const subIfdOffsets: number[] = []

  // Read IFD0
  readIFD(view, firstIFDOffset, (tag, _type, _count, valOffset) => {
    switch (tag) {
      case 0x010f: // Make
        exif.cameraMake = readString(view, valOffset, _count)
        break
      case 0x0110: // Model
        exif.cameraModel = readString(view, valOffset, _count)
        break
      case 0x0131: // Software
        exif.software = readString(view, valOffset, _count)
        break
      case 0x8769: // Exif SubIFD offset
        subIfdOffsets.push(valOffset)
        break
    }
  })

  // Read Exif SubIFD
  for (const subOffset of subIfdOffsets) {
    if (subOffset < view.byteLength) {
      readIFD(view, subOffset, (tag, _type, count, valOffset) => {
        switch (tag) {
          case 0x9003: // DateTimeOriginal
          case 0x9004: // DateTimeDigitized
            if (!exif.dateTimeOriginal) {
              const str = readString(view, valOffset, count)
              if (str) {
                // EXIF date format is YYYY:MM:DD HH:MM:SS
                exif.dateTimeOriginal = str.trim()
              }
            }
            break
          case 0x829a: { // ExposureTime (rational)
            const [num, den] = readRational(view, valOffset, isLittle)
            if (den && den > 0) {
              if (num < den) {
                exif.shutterSpeed = `1/${Math.round(den / num)}s`
              } else {
                exif.shutterSpeed = `${(num / den).toFixed(1)}s`
              }
            }
            break
          }
          case 0x829d: { // FNumber (rational)
            const [num, den] = readRational(view, valOffset, isLittle)
            if (den && den > 0) {
              const f = (num / den).toFixed(1).replace(/\.0$/, '')
              exif.aperture = `f/${f}`
            }
            break
          }
          case 0x8827: // ISO
            exif.iso = get16(valOffset)
            break
          case 0x920a: { // FocalLength (rational)
            const [num, den] = readRational(view, valOffset, isLittle)
            if (den && den > 0) {
              const fl = (num / den).toFixed(0)
              exif.focalLength = `${fl}mm`
            }
            break
          }
          case 0xa434: // LensModel
            exif.lensModel = readString(view, valOffset, count)
            break
          case 0xa002: // PixelXDimension
            exif.width = count === 1 ? get32(valOffset) : undefined
            break
          case 0xa003: // PixelYDimension
            exif.height = count === 1 ? get32(valOffset) : undefined
            break
        }
      })
    }
  }
}

function readIFD(
  view: DataView,
  offset: number,
  callback: (tag: number, type: number, count: number, valOffset: number) => void
) {
  if (offset + 2 > view.byteLength) return
  const isLittle = view.getUint16(0, false) === 0x4949
  const numEntries = view.getUint16(offset, isLittle)
  let pos = offset + 2

  for (let i = 0; i < numEntries; i++) {
    if (pos + 12 > view.byteLength) break
    const tag = view.getUint16(pos, isLittle)
    const type = view.getUint16(pos + 2, isLittle)
    const count = view.getUint32(pos + 4, isLittle)

    // Value or offset
    let valOffset = pos + 8
    const typeSize = getTypeSize(type)
    const totalBytes = typeSize * count
    if (totalBytes > 4) {
      valOffset = view.getUint32(pos + 8, isLittle)
    }

    callback(tag, type, count, valOffset)
    pos += 12
  }
}

function getTypeSize(type: number): number {
  switch (type) {
    case 1: // BYTE
    case 2: // ASCII
    case 7: // UNDEFINED
      return 1
    case 3: // SHORT
      return 2
    case 4: // LONG
      return 4
    case 5: // RATIONAL
      return 8
    default:
      return 1
  }
}

function readString(view: DataView, offset: number, count: number): string {
  if (offset + count > view.byteLength) return ''
  let str = ''
  for (let i = 0; i < count; i++) {
    const code = view.getUint8(offset + i)
    if (code === 0) break // null-terminated
    str += String.fromCharCode(code)
  }
  return str.trim()
}

function readRational(view: DataView, offset: number, isLittle: boolean): [number, number] {
  if (offset + 8 > view.byteLength) return [0, 1]
  const num = view.getUint32(offset, isLittle)
  const den = view.getUint32(offset + 4, isLittle)
  return [num, den]
}
