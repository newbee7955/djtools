import path from 'node:path'

export type ScreenRecordingMode = 'region' | 'display'
export type ScreenRecordingFormat = 'mp4' | 'gif'

export interface RecordingBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface ScreenRecordingOptionsInput {
  mode?: ScreenRecordingMode
  format?: ScreenRecordingFormat
  fps?: number
  showCursor?: boolean
  crf?: number
  gifWidth?: number
  maxDurationSeconds?: number
  recordSystemAudio?: boolean
  recordMicrophone?: boolean
  showToolbar?: boolean
}

export interface NormalizedRecordingOptions {
  mode: ScreenRecordingMode
  format: ScreenRecordingFormat
  fps: number
  showCursor: boolean
  crf: number
  gifWidth: number
  maxDurationSeconds?: number
  recordSystemAudio: boolean
  recordMicrophone: boolean
  showToolbar: boolean
}

export interface RecordingPaths {
  finalPath: string
  recordingPath: string
  audioPath?: string
}

function clampInteger(value: number | undefined, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.round(value as number)))
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

export function normalizeRecordingBounds(bounds: RecordingBounds): RecordingBounds {
  if (
    !Number.isFinite(bounds.x) ||
    !Number.isFinite(bounds.y) ||
    !Number.isFinite(bounds.width) ||
    !Number.isFinite(bounds.height) ||
    bounds.width < 2 ||
    bounds.height < 2
  ) {
    throw new Error('录制区域至少需要 2×2 像素')
  }

  return {
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width: Math.floor(bounds.width / 2) * 2,
    height: Math.floor(bounds.height / 2) * 2
  }
}

export function toGlobalRecordingBounds(
  local: RecordingBounds,
  displayOrigin: Pick<RecordingBounds, 'x' | 'y'>
): RecordingBounds {
  return normalizeRecordingBounds({
    x: displayOrigin.x + local.x,
    y: displayOrigin.y + local.y,
    width: local.width,
    height: local.height
  })
}

export function normalizeRecordingOptions(
  options: ScreenRecordingOptionsInput = {}
): NormalizedRecordingOptions {
  const format: ScreenRecordingFormat = options.format === 'gif' ? 'gif' : 'mp4'
  const mode: ScreenRecordingMode = options.mode === 'display' ? 'display' : 'region'
  const maxFps = format === 'gif' ? 30 : 60
  const maxDuration = format === 'gif' ? 60 : 3600
  const isGif = format === 'gif'

  return {
    mode,
    format,
    fps: clampInteger(options.fps, format === 'gif' ? 15 : 24, 5, maxFps),
    showCursor: options.showCursor !== false,
    crf: clampInteger(options.crf, 20, 0, 51),
    gifWidth: clampInteger(options.gifWidth, 720, 240, 1920),
    maxDurationSeconds:
      Number.isFinite(options.maxDurationSeconds) && Number(options.maxDurationSeconds) > 0
        ? clampInteger(options.maxDurationSeconds, 3, 3, maxDuration)
        : undefined,
    recordSystemAudio: isGif ? false : Boolean(options.recordSystemAudio),
    recordMicrophone: isGif ? false : Boolean(options.recordMicrophone),
    showToolbar: options.showToolbar !== false
  }
}

export function createRecordingPaths(
  outputDirectory: string,
  format: ScreenRecordingFormat,
  now = new Date(),
  hasAudio = false
): RecordingPaths {
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(
    now.getHours()
  )}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  const baseName = `屏幕录制_${stamp}`
  const finalPath = path.join(outputDirectory, `${baseName}.${format}`)

  if (format === 'gif') {
    return {
      finalPath,
      recordingPath: path.join(outputDirectory, `.${baseName}.recording.mp4`)
    }
  }

  if (hasAudio) {
    return {
      finalPath,
      recordingPath: path.join(outputDirectory, `.${baseName}.video.mp4`),
      audioPath: path.join(outputDirectory, `.${baseName}.audio.webm`)
    }
  }

  return { finalPath, recordingPath: finalPath }
}

export function buildMuxAudioVideoArgs(
  videoPath: string,
  audioPath: string,
  outputPath: string
): string[] {
  return [
    '-y',
    '-i',
    videoPath,
    '-i',
    audioPath,
    '-c:v',
    'copy',
    '-c:a',
    'aac',
    '-shortest',
    '-movflags',
    '+faststart',
    outputPath
  ]
}

export function buildGdiGrabArgs(
  bounds: RecordingBounds,
  options: NormalizedRecordingOptions,
  outputPath: string
): string[] {
  const safeBounds = normalizeRecordingBounds(bounds)
  return [
    '-y',
    '-f',
    'gdigrab',
    '-framerate',
    String(options.fps),
    '-offset_x',
    String(safeBounds.x),
    '-offset_y',
    String(safeBounds.y),
    '-video_size',
    `${safeBounds.width}x${safeBounds.height}`,
    '-draw_mouse',
    options.showCursor ? '1' : '0',
    '-i',
    'desktop',
    '-an',
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-tune',
    'zerolatency',
    '-crf',
    String(options.crf),
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    outputPath
  ]
}
