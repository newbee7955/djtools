import { screen, shell, type BrowserWindow } from 'electron'
import { existsSync, mkdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import type {
  ScreenRecordingEvent,
  ScreenRecordingOptions,
  ScreenRecordingResult,
  ScreenRecordingStatus,
  ScreenRecordingSupport
} from '@doujiao/plugin-sdk'
import { FFmpegManager } from '../media/ffmpeg-manager'
import { WorkspaceService } from './workspace-service'
import { ScreenshotService } from './screenshot-service'
import { RecordingWindowGuard } from './recording-window-guard'
import { RecordingOverlayManager } from './recording-overlay-manager'
import {
  buildGdiGrabArgs,
  buildMuxAudioVideoArgs,
  createRecordingPaths,
  normalizeRecordingBounds,
  normalizeRecordingOptions,
  type NormalizedRecordingOptions,
  type RecordingBounds,
  type RecordingPaths
} from './screen-recording-core'

interface ActiveRecording {
  ownerPluginId: string
  recordingId: string
  options: NormalizedRecordingOptions
  bounds: RecordingBounds
  paths: RecordingPaths
  process: ChildProcessWithoutNullStreams
  startedAt: number
  phase: ScreenRecordingStatus['phase']
  progress?: number
  error?: string
  stopRequested: boolean
  canceled: boolean
  durationTimer?: NodeJS.Timeout
  emit: (event: ScreenRecordingEvent) => void
  closePromise: Promise<number | null>
}

export class ScreenRecordingService {
  private static instance: ScreenRecordingService
  private active: ActiveRecording | null = null
  private readonly windowGuard = new RecordingWindowGuard()
  private readonly overlayManager = RecordingOverlayManager.getInstance()

  private constructor() {}

  public static getInstance(): ScreenRecordingService {
    if (!ScreenRecordingService.instance) {
      ScreenRecordingService.instance = new ScreenRecordingService()
    }
    return ScreenRecordingService.instance
  }

  public init(mainWindow: BrowserWindow): void {
    this.windowGuard.init(mainWindow)
  }

  public async start(
    ownerPluginId: string,
    input: ScreenRecordingOptions,
    emit: (event: ScreenRecordingEvent) => void
  ): Promise<ScreenRecordingStatus> {
    if (process.platform !== 'win32') {
      throw new Error('屏幕录制当前仅支持 Windows')
    }
    if (this.active) {
      throw new Error('已有录制任务正在运行，请先停止当前任务')
    }

    const options = normalizeRecordingOptions(input as any)
    const ffmpegStatus = await FFmpegManager.getInstance().getStatus()
    if (!ffmpegStatus.installed || !ffmpegStatus.path) {
      throw new Error('未检测到 FFmpeg 组件，请先在应用设置中完成安装配置')
    }

    emit({ active: false, phase: 'selecting', format: options.format })
    const bounds = await this.resolveBounds(options)
    if (!bounds) {
      return { active: false, phase: 'canceled', format: options.format }
    }

    const outputDirectory = WorkspaceService.getInstance().getDirectory(ownerPluginId)
    mkdirSync(outputDirectory, { recursive: true })
    const hasAudio =
      options.format === 'mp4' && (options.recordSystemAudio || options.recordMicrophone)
    const paths = createRecordingPaths(outputDirectory, options.format, new Date(), hasAudio)
    const recordingId = `recording_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
    const args = buildGdiGrabArgs(bounds, options, paths.recordingPath)
    this.windowGuard.hideForRecording()
    let child: ChildProcessWithoutNullStreams
    try {
      child = spawn(ffmpegStatus.path, args, {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe']
      })
    } catch (error) {
      this.windowGuard.restoreAfterRecording()
      this.safeUnlink(paths.recordingPath)
      throw error
    }

    let resolveClose: (code: number | null) => void = () => {}
    const closePromise = new Promise<number | null>((resolve) => {
      resolveClose = resolve
    })

    const active: ActiveRecording = {
      ownerPluginId,
      recordingId,
      options,
      bounds,
      paths,
      process: child,
      startedAt: Date.now(),
      phase: 'starting',
      stopRequested: false,
      canceled: false,
      emit,
      closePromise
    }
    this.active = active

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString()
      const timeMatch = text.match(/time=\s*(\d+):(\d+):(\d+\.?\d*)/)
      if (!timeMatch || !this.active || this.active.recordingId !== recordingId) return
      const elapsedSeconds =
        Number(timeMatch[1]) * 3600 + Number(timeMatch[2]) * 60 + Number(timeMatch[3])
      if (active.options.maxDurationSeconds !== undefined) {
        active.progress = Math.min(
          99,
          Math.round((elapsedSeconds / active.options.maxDurationSeconds) * 100)
        )
      }
      this.emitCurrent(active)
    })

    child.once('close', (code) => {
      resolveClose(code)
      if (!active.stopRequested && !active.canceled && this.active?.recordingId === recordingId) {
        active.phase = 'failed'
        active.error = `录制进程意外退出（代码 ${code ?? 'unknown'}）`
        this.emitCurrent(active)
        this.active = null
        this.windowGuard.restoreAfterRecording()
      }
    })

    await new Promise<void>((resolve, reject) => {
      const onSpawn = () => {
        child.removeListener('error', onError)
        resolve()
      }
      const onError = (error: Error) => {
        child.removeListener('spawn', onSpawn)
        reject(error)
      }
      child.once('spawn', onSpawn)
      child.once('error', onError)
    }).catch((error) => {
      this.active = null
      this.windowGuard.restoreAfterRecording()
      this.safeUnlink(paths.recordingPath)
      throw new Error(`启动 FFmpeg 录制失败: ${error.message}`)
    })

    active.phase = 'recording'
    void this.overlayManager
      .start({
        recordingId,
        bounds,
        options,
        onStop: () => {
          void this.stop(ownerPluginId).catch((error) => {
            console.error('[ScreenRecordingService] 工具栏触发停止录制失败:', error)
          })
        },
        onCancel: () => {
          void this.cancel(ownerPluginId).catch((error) => {
            console.error('[ScreenRecordingService] 工具栏触发取消录制失败:', error)
          })
        }
      })
      .catch((err) => {
        console.warn('[ScreenRecordingService] 启动录屏悬浮工具栏失败:', err)
      })

    if (options.maxDurationSeconds !== undefined) {
      active.durationTimer = setTimeout(() => {
        void this.stop(ownerPluginId).catch((error) => {
          console.error('[ScreenRecordingService] 自动停止录制失败:', error)
        })
      }, options.maxDurationSeconds * 1000)
    }
    this.emitCurrent(active)
    return this.toStatus(active)
  }

  public async stop(ownerPluginId: string): Promise<ScreenRecordingResult> {
    const active = this.requireOwnedActive(ownerPluginId)
    if (active.stopRequested) {
      throw new Error('录制任务正在停止，请勿重复操作')
    }

    active.stopRequested = true
    active.phase = 'stopping'
    if (active.durationTimer) clearTimeout(active.durationTimer)
    this.emitCurrent(active)

    const overlayResult: any = await this.overlayManager.stop().catch(() => ({}))
    if (overlayResult?.audioBuffer && active.paths.audioPath) {
      try {
        writeFileSync(active.paths.audioPath, overlayResult.audioBuffer)
      } catch (err) {
        console.warn('[ScreenRecordingService] 保存临时音频文件失败:', err)
      }
    }

    try {
      active.process.stdin?.write('q\n')
    } catch {
      active.process.kill('SIGTERM')
    }

    let closeCode = await Promise.race([
      active.closePromise,
      new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 5000))
    ])
    if (closeCode === 'timeout') {
      active.process.kill('SIGTERM')
      closeCode = await active.closePromise
    }

    if (closeCode !== 0 || !existsSync(active.paths.recordingPath)) {
      active.phase = 'failed'
      active.error = `录制输出失败（FFmpeg 退出码 ${closeCode ?? 'unknown'}）`
      this.emitCurrent(active)
      this.active = null
      this.windowGuard.restoreAfterRecording()
      if (active.paths.audioPath) this.safeUnlink(active.paths.audioPath)
      throw new Error(active.error)
    }

    this.windowGuard.restoreAfterRecording()

    let outputPath = active.paths.recordingPath
    if (
      active.options.format === 'mp4' &&
      active.paths.audioPath &&
      existsSync(active.paths.audioPath)
    ) {
      const ffmpegStatus = await FFmpegManager.getInstance().getStatus()
      if (ffmpegStatus.path) {
        const muxArgs = buildMuxAudioVideoArgs(
          active.paths.recordingPath,
          active.paths.audioPath,
          active.paths.finalPath
        )
        await new Promise<void>((resolve, reject) => {
          const muxProc = spawn(ffmpegStatus.path!, muxArgs, { windowsHide: true })
          muxProc.on('close', (code) => {
            if (code === 0) resolve()
            else reject(new Error(`音视频混流失败（代码 ${code}）`))
          })
          muxProc.on('error', reject)
        }).catch((err) => {
          console.warn('[ScreenRecordingService] 音视频混流失败，降级保留纯视频文件:', err)
        })
      }
      this.safeUnlink(active.paths.recordingPath)
      this.safeUnlink(active.paths.audioPath)
      outputPath = active.paths.finalPath
    } else if (active.options.format === 'gif') {
      active.phase = 'converting'
      active.progress = 0
      this.emitCurrent(active)
      try {
        await FFmpegManager.getInstance().convertMedia(
          {
            inputPath: active.paths.recordingPath,
            outputPath: active.paths.finalPath,
            isGif: true,
            fps: active.options.fps,
            scale: `${active.options.gifWidth}:-1`
          },
          (progress) => {
            if (this.active?.recordingId !== active.recordingId) return
            active.progress = progress.percent
            this.emitCurrent(active)
          }
        )
        this.safeUnlink(active.paths.recordingPath)
        outputPath = active.paths.finalPath
      } catch (error) {
        active.phase = 'failed'
        active.error = error instanceof Error ? error.message : 'GIF 转换失败'
        this.emitCurrent(active)
        this.safeUnlink(active.paths.recordingPath)
        this.safeUnlink(active.paths.finalPath)
        this.active = null
        throw error
      }
    }

    const durationMs = Math.max(0, Date.now() - active.startedAt)
    active.phase = 'completed'
    active.progress = 100
    this.emitCurrent(active, outputPath)
    this.active = null

    return {
      success: true,
      recordingId: active.recordingId,
      format: active.options.format,
      outputPath,
      durationMs
    }
  }

  public async cancel(ownerPluginId: string): Promise<boolean> {
    const active = this.active
    if (!active) return false
    if (active.ownerPluginId !== ownerPluginId) {
      throw new Error('无权取消其他插件启动的录制任务')
    }

    this.overlayManager.cancel()
    active.canceled = true
    active.stopRequested = true
    active.phase = 'canceled'
    if (active.durationTimer) clearTimeout(active.durationTimer)
    try {
      active.process.kill('SIGTERM')
    } catch {}
    await Promise.race([
      active.closePromise,
      new Promise<void>((resolve) => setTimeout(resolve, 2000))
    ])
    this.safeUnlink(active.paths.recordingPath)
    if (active.paths.finalPath !== active.paths.recordingPath) {
      this.safeUnlink(active.paths.finalPath)
    }
    if (active.paths.audioPath) {
      this.safeUnlink(active.paths.audioPath)
    }
    this.emitCurrent(active)
    this.active = null
    this.windowGuard.restoreAfterRecording()
    return true
  }

  public getStatus(ownerPluginId: string): ScreenRecordingStatus {
    if (!this.active || this.active.ownerPluginId !== ownerPluginId) {
      return { active: false, phase: 'idle' }
    }
    return this.toStatus(this.active)
  }

  public async getSupport(): Promise<ScreenRecordingSupport> {
    const ffmpegStatus = await FFmpegManager.getInstance().getStatus()
    const supported = process.platform === 'win32' && ffmpegStatus.installed
    return {
      supported,
      platform: process.platform,
      ffmpegInstalled: ffmpegStatus.installed,
      ffmpegVersion: ffmpegStatus.version,
      reason:
        process.platform !== 'win32'
          ? '屏幕录制当前仅支持 Windows'
          : ffmpegStatus.installed
            ? undefined
            : '未检测到 FFmpeg 组件'
    }
  }

  public async openRecording(ownerPluginId: string, localPath: string): Promise<boolean> {
    this.assertRecordingPath(ownerPluginId, localPath)
    if (!existsSync(localPath)) return false
    return (await shell.openPath(localPath)) === ''
  }

  public showInFolder(ownerPluginId: string, localPath: string): boolean {
    this.assertRecordingPath(ownerPluginId, localPath)
    if (!existsSync(localPath)) return false
    shell.showItemInFolder(localPath)
    return true
  }

  public shutdown(): void {
    this.overlayManager.cancel()
    this.windowGuard.clearWithoutRestore()
    const active = this.active
    if (!active) return
    if (active.durationTimer) clearTimeout(active.durationTimer)
    active.stopRequested = true
    active.canceled = true
    try {
      active.process.kill('SIGTERM')
    } catch {}
    this.safeUnlink(active.paths.recordingPath)
    if (active.paths.audioPath) {
      this.safeUnlink(active.paths.audioPath)
    }
    this.active = null
  }

  private async resolveBounds(options: NormalizedRecordingOptions): Promise<RecordingBounds | null> {
    if (options.mode === 'region') {
      const selection = await ScreenshotService.getInstance().selectRegion()
      if (selection.canceled) return null
      if (!selection.success || !selection.bounds) {
        throw new Error(selection.error || '未选择有效的录制区域')
      }
      return normalizeRecordingBounds(selection.bounds)
    }

    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    return normalizeRecordingBounds(display.bounds)
  }

  private requireOwnedActive(ownerPluginId: string): ActiveRecording {
    if (!this.active) throw new Error('当前没有正在进行的录制任务')
    if (this.active.ownerPluginId !== ownerPluginId) {
      throw new Error('无权操作其他插件启动的录制任务')
    }
    return this.active
  }

  private assertRecordingPath(ownerPluginId: string, localPath: string): void {
    const outputDirectory = WorkspaceService.getInstance().getDirectory(ownerPluginId)
    const normalizedOutput = normalizePathForComparison(outputDirectory)
    const normalizedTarget = normalizePathForComparison(localPath)
    if (!normalizedTarget.startsWith(`${normalizedOutput}\\`) && normalizedTarget !== normalizedOutput) {
      throw new Error('只能访问当前插件工作目录中的录制文件')
    }
  }

  private toStatus(active: ActiveRecording, outputPath?: string): ScreenRecordingStatus {
    return {
      active: !['completed', 'failed', 'canceled'].includes(active.phase),
      phase: active.phase,
      recordingId: active.recordingId,
      format: active.options.format,
      bounds: active.bounds,
      startedAt: active.startedAt,
      elapsedMs: Math.max(0, Date.now() - active.startedAt),
      outputPath,
      progress: active.progress,
      error: active.error
    }
  }

  private emitCurrent(active: ActiveRecording, outputPath?: string): void {
    active.emit(this.toStatus(active, outputPath))
  }

  private safeUnlink(filePath: string): void {
    try {
      if (existsSync(filePath) && statSync(filePath).isFile()) unlinkSync(filePath)
    } catch (error) {
      console.warn('[ScreenRecordingService] 清理临时录制文件失败:', filePath, error)
    }
  }
}

function normalizePathForComparison(filePath: string): string {
  return filePath.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()
}
