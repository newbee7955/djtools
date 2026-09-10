import { app, shell } from 'electron'
import { join } from 'path'
import { createWriteStream, existsSync, mkdirSync, unlinkSync, readFileSync, writeFileSync } from 'fs'
import https from 'https'
import http from 'http'
import { URL } from 'url'
import { FFmpegManager } from '../media/ffmpeg-manager'
import type { DownloadTaskRequest, DownloadProgressInfo } from '@doujiao/plugin-sdk'

export interface ManagedTask {
  id: string;
  pluginId: string;
  filename: string;
  url: string;
  audioUrl?: string;
  downloadedBytes: number;
  totalBytes: number;
  progress: number;
  speed: string;
  status: 'pending' | 'downloading' | 'merging' | 'completed' | 'failed' | 'paused';
  error?: string;
  abortController?: AbortController;
  savePath: string;
  createdAt: number;
}

export class DownloadTaskManager {
  private static instance: DownloadTaskManager
  private tasks: Map<string, ManagedTask> = new Map()
  private listeners: Set<(info: DownloadProgressInfo) => void> = new Set()
  private downloadDir: string
  private configFile: string

  private constructor() {
    const userData = app.getPath('userData')
    this.configFile = join(userData, 'download-config.json')
    let savedDir = ''
    try {
      if (existsSync(this.configFile)) {
        const raw = JSON.parse(readFileSync(this.configFile, 'utf-8'))
        if (raw && raw.downloadDir && existsSync(raw.downloadDir)) {
          savedDir = raw.downloadDir
        }
      }
    } catch {}

    this.downloadDir = savedDir || join(app.getPath('downloads'), 'doujiao')
    if (!existsSync(this.downloadDir)) {
      mkdirSync(this.downloadDir, { recursive: true })
    }
  }

  public static getInstance(): DownloadTaskManager {
    if (!DownloadTaskManager.instance) {
      DownloadTaskManager.instance = new DownloadTaskManager()
    }
    return DownloadTaskManager.instance
  }

  public getDownloadDir(): string {
    return this.downloadDir
  }

  public setDownloadDir(dir: string): string {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    this.downloadDir = dir
    try {
      writeFileSync(this.configFile, JSON.stringify({ downloadDir: dir }, null, 2), 'utf-8')
    } catch (err) {
      console.error('[DownloadTaskManager] 保存下载配置失败:', err)
    }
    return dir
  }

  public openSaveDirectory(): void {
    if (existsSync(this.downloadDir)) {
      shell.openPath(this.downloadDir)
    }
  }

  public subscribe(callback: (info: DownloadProgressInfo) => void): () => void {
    this.listeners.add(callback)
    return () => {
      this.listeners.delete(callback)
    }
  }

  private notifyProgress(task: ManagedTask): void {
    const info: DownloadProgressInfo = {
      taskId: task.id,
      filename: task.filename,
      downloadedBytes: task.downloadedBytes,
      totalBytes: task.totalBytes,
      progress: task.progress,
      speed: task.speed,
      status: task.status,
      error: task.error
    }
    for (const listener of this.listeners) {
      try {
        listener(info)
      } catch (err) {
        console.error(`[TaskManager] 通知监听异常:`, err)
      }
    }
  }

  public async enqueue(taskReq: DownloadTaskRequest, pluginId: string): Promise<string> {
    const taskId = `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    
    // 清理文件名非法字符
    const sanitizedFilename = (taskReq.filename || `download_${taskId}.mp4`)
      .replace(/[\\/:*?"<>|]/g, '_')
      .trim()
    const savePath = join(this.downloadDir, sanitizedFilename)

    const managedTask: ManagedTask = {
      id: taskId,
      pluginId,
      filename: sanitizedFilename,
      url: taskReq.url,
      audioUrl: taskReq.audioUrl,
      downloadedBytes: 0,
      totalBytes: 0,
      progress: 0,
      speed: '0 KB/s',
      status: 'pending',
      savePath,
      createdAt: Date.now()
    }

    this.tasks.set(taskId, managedTask)
    this.notifyProgress(managedTask)

    // 异步启动下载流程
    this.startDownload(managedTask, taskReq.headers)

    return taskId
  }

  public cancel(taskId: string): boolean {
    const task = this.tasks.get(taskId)
    if (!task) return false

    if (task.abortController) {
      task.abortController.abort()
    }
    task.status = 'failed'
    task.error = '用户取消下载'
    this.notifyProgress(task)
    return true
  }

  public getAllTasks(): ManagedTask[] {
    return Array.from(this.tasks.values()).sort((a, b) => b.createdAt - a.createdAt)
  }

  private async startDownload(task: ManagedTask, customHeaders?: Record<string, string>): Promise<void> {
    task.status = 'downloading'
    task.abortController = new AbortController()
    this.notifyProgress(task)

    // 场景 A：音视频分离流（DASH 格式），需下载双轨并由 FFmpeg 混流
    if (task.audioUrl) {
      const ffmpegManager = FFmpegManager.getInstance()
      const ffmpegStatus = await ffmpegManager.getStatus()
      if (!ffmpegStatus.installed) {
        task.status = 'failed'
        task.error = '检测到音视频分离流，但宿主未配置 FFmpeg。请在宿主设置中一键下载或手动导入 FFmpeg。'
        this.notifyProgress(task)
        return
      }

      const videoPart = `${task.savePath}.video.part`
      const audioPart = `${task.savePath}.audio.part`

      try {
        let videoBytes = 0
        let audioBytes = 0
        let videoTotal = 0
        let audioTotal = 0

        // 1. 下载视频轨
        await this.streamToFile(task.url, videoPart, customHeaders, task.abortController.signal, (downloaded, total, speed) => {
          videoBytes = downloaded
          videoTotal = total
          task.downloadedBytes = videoBytes + audioBytes
          task.totalBytes = (videoTotal + audioTotal) || total
          task.progress = task.totalBytes > 0 ? Math.min(49, Math.round((task.downloadedBytes / task.totalBytes) * 50)) : 25
          task.speed = `视频流: ${speed}`
          this.notifyProgress(task)
        })

        // 2. 下载音频轨
        await this.streamToFile(task.audioUrl, audioPart, customHeaders, task.abortController.signal, (downloaded, total, speed) => {
          audioBytes = downloaded
          audioTotal = total
          task.downloadedBytes = videoBytes + audioBytes
          task.totalBytes = videoTotal + audioTotal
          task.progress = task.totalBytes > 0 ? Math.min(95, 50 + Math.round((audioBytes / audioTotal) * 45)) : 75
          task.speed = `音频流: ${speed}`
          this.notifyProgress(task)
        })

        // 3. FFmpeg 自动混流
        task.status = 'merging'
        task.speed = '音视频混流中...'
        task.progress = 98
        this.notifyProgress(task)

        await ffmpegManager.mergeMedia(videoPart, audioPart, task.savePath)

        // 清理分段文件
        if (existsSync(videoPart)) unlinkSync(videoPart)
        if (existsSync(audioPart)) unlinkSync(audioPart)

        task.progress = 100
        task.status = 'completed'
        task.speed = '完成'
        this.notifyProgress(task)
        return
      } catch (err: any) {
        if (existsSync(videoPart)) {
          try { unlinkSync(videoPart) } catch {}
        }
        if (existsSync(audioPart)) {
          try { unlinkSync(audioPart) } catch {}
        }
        task.status = 'failed'
        task.error = task.abortController.signal.aborted ? '已取消下载' : (err?.message || '音视频合成下载失败')
        this.notifyProgress(task)
        return
      }
    }

    // 场景 B：单流直接下载
    try {
      await this.streamToFile(task.url, task.savePath, customHeaders, task.abortController.signal, (downloaded, total, speed) => {
        task.downloadedBytes = downloaded
        task.totalBytes = total
        task.progress = total > 0 ? Math.min(99, Math.round((downloaded / total) * 100)) : 50
        task.speed = speed
        this.notifyProgress(task)
      })

      task.progress = 100
      task.status = 'completed'
      task.speed = '完成'
      this.notifyProgress(task)
    } catch (err: any) {
      task.status = 'failed'
      task.error = task.abortController.signal.aborted ? '已取消下载' : (err?.message || '下载失败')
      this.notifyProgress(task)
    }
  }

  /**
   * 通用流式网络写入底层实现
   */
  private streamToFile(
    url: string,
    destPath: string,
    customHeaders?: Record<string, string>,
    abortSignal?: AbortSignal,
    onProgress?: (downloaded: number, total: number, speed: string) => void
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(url)
      const isHttps = parsedUrl.protocol === 'https:'
      const requestModule = isHttps ? https : http

      const headers: Record<string, string> = {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        ...customHeaders
      }

      const req = requestModule.get(
        url,
        {
          headers,
          signal: abortSignal
        },
        (res) => {
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            const redirectUrl = new URL(res.headers.location, url).href
            return this.streamToFile(redirectUrl, destPath, customHeaders, abortSignal, onProgress)
              .then(resolve)
              .catch(reject)
          }

          if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
            return reject(new Error(`HTTP 状态异常: ${res.statusCode}`))
          }

          const contentLength = res.headers['content-length']
          const total = contentLength ? parseInt(contentLength, 10) : 0

          const fileStream = createWriteStream(destPath)
          let downloaded = 0
          let lastBytes = 0
          let lastTime = Date.now()

          res.on('data', (chunk: Buffer) => {
            downloaded += chunk.length

            const now = Date.now()
            if (now - lastTime >= 400) {
              const deltaBytes = downloaded - lastBytes
              const deltaTime = (now - lastTime) / 1000
              const bytesPerSec = deltaBytes / deltaTime
              const speed =
                bytesPerSec > 1024 * 1024
                  ? `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`
                  : `${(bytesPerSec / 1024).toFixed(0)} KB/s`

              lastBytes = downloaded
              lastTime = now
              if (onProgress) onProgress(downloaded, total, speed)
            }
          })

          res.pipe(fileStream)

          fileStream.on('finish', () => {
            fileStream.close()
            resolve()
          })

          fileStream.on('error', reject)
        }
      )

      req.on('error', reject)
    })
  }
}
