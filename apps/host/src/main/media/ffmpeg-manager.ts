import { app, net } from 'electron'
import { join, dirname } from 'path'
import { existsSync, mkdirSync, copyFileSync, unlinkSync, createWriteStream, renameSync, statSync } from 'fs'
import { exec, spawn, type ChildProcess } from 'child_process'
import { promisify } from 'util'
import zlib from 'zlib'
import { once } from 'events'
import type { FFmpegConvertOptions, FFmpegConvertProgress, MediaProbeInfo } from '@doujiao/plugin-sdk'

const execAsync = promisify(exec)

export interface FFmpegStatus {
  installed: boolean
  version?: string
  path?: string
  source: 'builtin' | 'system' | 'custom' | 'none'
  error?: string
}

export interface FFmpegInstallProgress {
  percent: number
  speed?: string
  text?: string
}

export class FFmpegManager {
  private static instance: FFmpegManager
  private baseDir: string
  private customPath: string | null = null
  private activeTasks = new Map<string, ChildProcess>()

  private constructor() {
    this.baseDir = join(
      app.getPath('userData'),
      'bin',
      'ffmpeg',
      '7.0.1',
      `${process.platform}-${process.arch}`
    )
    if (!existsSync(this.baseDir)) {
      mkdirSync(this.baseDir, { recursive: true })
    }
  }

  public static getInstance(): FFmpegManager {
    if (!FFmpegManager.instance) {
      FFmpegManager.instance = new FFmpegManager()
    }
    return FFmpegManager.instance
  }

  public getTargetExecutablePath(): string {
    const exeName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
    return join(this.baseDir, exeName)
  }

  /**
   * 检测 FFmpeg 运行组件状态（优先检测 userData 共享池，其次检测系统 PATH）
   */
  public async getStatus(): Promise<FFmpegStatus> {
    // 1. 检测自定义指定路径
    if (this.customPath && existsSync(this.customPath)) {
      const ver = await this.queryVersion(this.customPath)
      if (ver) {
        return {
          installed: true,
          version: ver,
          path: this.customPath,
          source: 'custom'
        }
      }
    }

    // 2. 检测 userData 独立共享池路径: userData/bin/ffmpeg/.../ffmpeg.exe
    const exeName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
    const builtinCandidates = [
      this.getTargetExecutablePath(),
      join(app.getPath('userData'), 'bin', 'ffmpeg', '7.0.1', `${process.platform}-${process.arch}`, exeName),
      join(app.getPath('userData'), 'bin', 'ffmpeg', exeName)
    ]

    for (const builtinPath of builtinCandidates) {
      if (existsSync(builtinPath)) {
        const ver = await this.queryVersion(builtinPath)
        if (ver) {
          return {
            installed: true,
            version: ver,
            path: builtinPath,
            source: 'builtin'
          }
        }
      }
    }

    // 3. 检测系统 PATH
    try {
      const cmd = process.platform === 'win32' ? 'where ffmpeg' : 'which ffmpeg'
      const { stdout } = await execAsync(cmd)
      const systemPath = stdout.trim().split(/\r?\n/)[0]
      if (systemPath && existsSync(systemPath)) {
        const ver = await this.queryVersion(systemPath)
        if (ver) {
          return {
            installed: true,
            version: ver,
            path: systemPath,
            source: 'system'
          }
        }
      }
    } catch {
      // 系统未找到 ffmpeg
    }

    return {
      installed: false,
      source: 'none',
      error: '未检测到 FFmpeg 组件'
    }
  }

  /**
   * 查询指定可执行文件的 FFmpeg 版本号
   */
  private async queryVersion(binPath: string): Promise<string | null> {
    try {
      const { stdout, stderr } = await execAsync(`"${binPath}" -version`, { timeout: 3000 })
      const out = stdout || stderr
      const match = out.match(/ffmpeg version\s+([^\s]+)/i)
      return match ? match[1] : '已检测'
    } catch {
      return null
    }
  }

  /**
   * 用户手动导入现有的 ffmpeg.exe 文件
   */
  public async importCustomBinary(sourcePath: string): Promise<FFmpegStatus> {
    if (!existsSync(sourcePath)) {
      throw new Error(`指定的文件不存在: ${sourcePath}`)
    }

    const ver = await this.queryVersion(sourcePath)
    if (!ver) {
      throw new Error(`该文件无法识别为有效的 FFmpeg 可执行文件: ${sourcePath}`)
    }

    const targetPath = this.getTargetExecutablePath()
    mkdirSync(dirname(targetPath), { recursive: true })
    copyFileSync(sourcePath, targetPath)

    if (process.platform !== 'win32') {
      const fs = await import('fs')
      fs.chmodSync(targetPath, 0o755)
    }

    console.log(`[FFmpegManager] 成功导入 FFmpeg 扩展组件: ${targetPath} (v${ver})`)
    return {
      installed: true,
      version: ver,
      path: targetPath,
      source: 'builtin'
    }
  }

  /**
   * 根据当前系统与架构获取 ffmpeg-static 资源文件名
   */
  private getPlatformAsset(): string | null {
    const p = process.platform
    const a = process.arch
    if (p === 'win32' && (a === 'x64' || a === 'ia32')) return 'ffmpeg-win32-x64.gz'
    if (p === 'darwin' && a === 'arm64') return 'ffmpeg-darwin-arm64.gz'
    if (p === 'darwin' && a === 'x64') return 'ffmpeg-darwin-x64.gz'
    if (p === 'linux' && a === 'x64') return 'ffmpeg-linux-x64.gz'
    if (p === 'linux' && a === 'arm64') return 'ffmpeg-linux-arm64.gz'
    return null
  }

  /**
   * 在线一键按需下载并安装 FFmpeg 独立组件
   */
  public async installFFmpeg(
    onProgress?: (progress: FFmpegInstallProgress) => void
  ): Promise<FFmpegStatus> {
    const current = await this.getStatus()
    if (current.installed) {
      onProgress?.({ percent: 100, text: 'FFmpeg 组件已就绪' })
      return current
    }

    const targetPath = this.getTargetExecutablePath()
    mkdirSync(dirname(targetPath), { recursive: true })

    console.log('[FFmpegManager] 准备安装 FFmpeg 独立组件至:', targetPath)

    // 1. 检测本地常见路径是否有候选文件
    const candidateLocalPaths = [
      'C:\\ffmpeg\\bin\\ffmpeg.exe',
      'D:\\ffmpeg\\bin\\ffmpeg.exe',
      'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe'
    ]

    for (const p of candidateLocalPaths) {
      if (existsSync(p)) {
        onProgress?.({ percent: 100, text: '检测到本地候选组件，正在导入...' })
        return await this.importCustomBinary(p)
      }
    }

    // 2. 获取当前平台对应架构的归档文件名
    const assetName = this.getPlatformAsset()
    if (!assetName) {
      throw new Error(
        `当前平台架构 (${process.platform}-${process.arch}) 暂不支持自动在线下载，请通过「手动导入」选择本地 ffmpeg 可执行文件`
      )
    }

    // 3. 配置双镜像源：首选阿里云 open-source npmmirror 国内 CDN，备选 GitHub 官方源
    const mirrors = [
      {
        name: '国内高速镜像 (npmmirror)',
        url: `https://registry.npmmirror.com/-/binary/ffmpeg-static/b6.1.1/${assetName}`
      },
      {
        name: 'GitHub 官方源',
        url: `https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/${assetName}`
      }
    ]

    const tempPath = targetPath + '.download.tmp'
    let lastError: any = null

    for (const mirror of mirrors) {
      try {
        console.log(`[FFmpegManager] 尝试从 ${mirror.name} 下载: ${mirror.url}`)
        onProgress?.({ percent: 0, text: `正在连接 ${mirror.name}...` })

        await this.downloadAndExtractGz(mirror.url, tempPath, onProgress)

        // 下载解压校验成功，替换目标文件
        if (existsSync(targetPath)) {
          try {
            unlinkSync(targetPath)
          } catch {}
        }
        renameSync(tempPath, targetPath)

        if (process.platform !== 'win32') {
          const fs = await import('fs')
          fs.chmodSync(targetPath, 0o755)
        }

        onProgress?.({ percent: 99, text: '正在验证组件可用性...' })
        const ver = await this.queryVersion(targetPath)
        if (!ver) {
          throw new Error('下载解压后的文件无法被识别为有效的 FFmpeg 可执行文件')
        }

        console.log(`[FFmpegManager] FFmpeg 组件安装成功: ${targetPath} (v${ver})`)
        onProgress?.({ percent: 100, text: 'FFmpeg 组件安装就绪！' })

        return {
          installed: true,
          version: ver,
          path: targetPath,
          source: 'builtin'
        }
      } catch (err: any) {
        lastError = err
        console.warn(`[FFmpegManager] 从 ${mirror.name} 安装失败:`, err?.message)
        if (existsSync(tempPath)) {
          try {
            unlinkSync(tempPath)
          } catch {}
        }
      }
    }

    throw new Error(
      `在线下载 FFmpeg 失败 (${lastError?.message || '网络连接受限'})。建议：检查网络代理，或点击「手动导入」直接选择本地现有的 ffmpeg.exe。`
    )
  }

  /**
   * 从网络流实时解压 .gz 归档并写入本地可执行文件
   */
  private async downloadAndExtractGz(
    fileUrl: string,
    destPath: string,
    onProgress?: (progress: FFmpegInstallProgress) => void
  ): Promise<void> {
    const resp = await net.fetch(fileUrl, {
      headers: { 'User-Agent': 'Doujiao-Host/0.2.0' },
      signal: AbortSignal.timeout(180000)
    })

    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status} ${resp.statusText}`)
    }

    const totalBytes = Number(resp.headers.get('content-length') || 0)
    const reader = resp.body?.getReader()
    if (!reader) {
      throw new Error('无法建立网络数据流')
    }

    const gunzip = zlib.createGunzip()
    const outStream = createWriteStream(destPath)

    const streamPromise = new Promise<void>((resolve, reject) => {
      gunzip.on('error', reject)
      outStream.on('error', reject)
      outStream.on('finish', resolve)
    })

    gunzip.pipe(outStream)

    let downloadedBytes = 0
    let lastTime = Date.now()
    let lastBytes = 0

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) {
          gunzip.end()
          break
        }

        downloadedBytes += value.length

        const canWrite = gunzip.write(Buffer.from(value))
        if (!canWrite) {
          await once(gunzip, 'drain')
        }

        const now = Date.now()
        if (now - lastTime >= 200) {
          const deltaBytes = downloadedBytes - lastBytes
          const deltaTime = (now - lastTime) / 1000
          const speed = deltaBytes / (deltaTime || 1)
          const speedStr =
            speed > 1024 * 1024
              ? `${(speed / (1024 * 1024)).toFixed(1)} MB/s`
              : `${Math.round(speed / 1024)} KB/s`

          lastTime = now
          lastBytes = downloadedBytes

          const percent =
            totalBytes > 0
              ? Math.min(98, Math.round((downloadedBytes / totalBytes) * 100))
              : 0
          const mbDownloaded = (downloadedBytes / 1024 / 1024).toFixed(1)
          const mbTotal = totalBytes > 0 ? (totalBytes / 1024 / 1024).toFixed(1) : '28.2'

          onProgress?.({
            percent,
            speed: speedStr,
            text: `正在极速下载并解压 (${mbDownloaded}MB / ${mbTotal}MB, ${speedStr})`
          })
        }
      }

      await streamPromise
    } catch (err) {
      gunzip.destroy()
      outStream.destroy()
      throw err
    }
  }

  /**
   * 受控执行音视频无损快速合并 (Remux)
   * 采用 -c:v copy -c:a aac 极其高效且不损失原画质
   */
  public async mergeMedia(
    videoPath: string,
    audioPath: string,
    outputPath: string
  ): Promise<{ success: boolean; outputPath: string }> {
    const status = await this.getStatus()
    if (!status.installed || !status.path) {
      throw new Error('未检测到 FFmpeg 独立组件，无法执行音视频流合成。请先在「应用设置」中完成 FFmpeg 安装配置。')
    }

    if (!existsSync(videoPath)) {
      throw new Error(`视频源文件不存在: ${videoPath}`)
    }
    if (!existsSync(audioPath)) {
      throw new Error(`音频源文件不存在: ${audioPath}`)
    }

    console.log(`[FFmpegManager] 开始音视频流合并:`)
    console.log(`  视频源: ${videoPath}`)
    console.log(`  音频源: ${audioPath}`)
    console.log(`  输出至: ${outputPath}`)

    return new Promise((resolve, reject) => {
      const args = [
        '-y',
        '-i',
        videoPath,
        '-i',
        audioPath,
        '-c:v',
        'copy',
        '-c:a',
        'aac',
        '-strict',
        'experimental',
        outputPath
      ]

      const proc = spawn(status.path!, args, {
        windowsHide: true
      })

      let stderr = ''
      proc.stderr.on('data', (data) => {
        stderr += data.toString()
      })

      proc.on('close', (code) => {
        if (code === 0 && existsSync(outputPath)) {
          console.log(`[FFmpegManager] ✓ 音视频合成成功: ${outputPath}`)
          resolve({ success: true, outputPath })
        } else {
          console.error(`[FFmpegManager] 合成失败 (exit ${code}):`, stderr)
          reject(new Error(`FFmpeg 合成失败 (退出码 ${code}): ${stderr.slice(-300)}`))
        }
      })

      proc.on('error', (err) => {
        reject(new Error(`启动 FFmpeg 进程失败: ${err.message}`))
      })
    })
  }

  /**
   * 取消正在执行的转码任务
   */
  public cancelConvertTask(taskId: string): boolean {
    const proc = this.activeTasks.get(taskId)
    if (proc && !proc.killed) {
      try {
        proc.kill('SIGTERM')
        this.activeTasks.delete(taskId)
        return true
      } catch {
        return false
      }
    }
    return false
  }

  /**
   * 快速探测媒体元数据（分辨率、时长、格式、音视频编码）
   */
  public async probeMedia(filePath: string): Promise<MediaProbeInfo> {
    const status = await this.getStatus()
    if (!status.installed || !status.path) {
      throw new Error('未检测到 FFmpeg 独立组件，无法探测媒体信息')
    }
    if (!existsSync(filePath)) {
      throw new Error(`文件不存在: ${filePath}`)
    }

    const fileSize = existsSync(filePath) ? statSync(filePath).size : 0

    return new Promise((resolve) => {
      exec(`"${status.path}" -hide_banner -i "${filePath}"`, { timeout: 10000 }, (_err, _stdout, stderr) => {
        const out = stderr || ''
        const result: MediaProbeInfo = {
          size: fileSize
        }

        // 解析时长: Duration: 00:01:23.45, start: 0.000000, bitrate: 1200 kb/s
        const durationMatch = out.match(/Duration:\s*(\d+):(\d+):(\d+\.?\d*)/)
        if (durationMatch) {
          const hours = parseFloat(durationMatch[1])
          const minutes = parseFloat(durationMatch[2])
          const seconds = parseFloat(durationMatch[3])
          result.duration = hours * 3600 + minutes * 60 + seconds
        }

        // 解析码率: bitrate: 1200 kb/s
        const bitrateMatch = out.match(/bitrate:\s*(\d+)\s*kb\/s/i)
        if (bitrateMatch) {
          result.bitrate = parseInt(bitrateMatch[1], 10)
        }

        // 解析视频流: Stream #0:0...: Video: h264 ..., 1920x1080 ..., 30 fps
        const videoMatch = out.match(/Stream #\d+:\d+.*?: Video:\s*([a-zA-Z0-9_-]+)/i)
        if (videoMatch) {
          result.videoCodec = videoMatch[1]
        }

        const resMatch = out.match(/Video:.*?,\s*(\d{2,5})x(\d{2,5})/i)
        if (resMatch) {
          result.width = parseInt(resMatch[1], 10)
          result.height = parseInt(resMatch[2], 10)
        }

        const fpsMatch = out.match(/(\d+(?:\.\d+)?)\s*fps/i)
        if (fpsMatch) {
          result.fps = parseFloat(fpsMatch[1])
        }

        // 解析音频流: Stream #0:1...: Audio: aac ..., 48000 Hz, stereo
        const audioMatch = out.match(/Stream #\d+:\d+.*?: Audio:\s*([a-zA-Z0-9_-]+)/i)
        if (audioMatch) {
          result.audioCodec = audioMatch[1]
        }

        const rateMatch = out.match(/(\d+)\s*Hz/i)
        if (rateMatch) {
          result.sampleRate = parseInt(rateMatch[1], 10)
        }

        if (out.includes('stereo')) {
          result.channels = 2
        } else if (out.includes('mono')) {
          result.channels = 1
        } else if (out.includes('5.1')) {
          result.channels = 6
        }

        resolve(result)
      })
    })
  }

  /**
   * 通用多媒体格式转码、音频提取、视频快剪、GIF 动图生成与压缩
   */
  public async convertMedia(
    options: FFmpegConvertOptions,
    onProgress?: (progress: FFmpegConvertProgress) => void
  ): Promise<{ success: boolean; taskId: string; outputPath: string; size?: number }> {
    const status = await this.getStatus()
    if (!status.installed || !status.path) {
      throw new Error('未检测到 FFmpeg 独立组件，无法执行转码任务。请先在「应用设置」中配置 FFmpeg。')
    }

    const { inputPath, outputPath } = options
    if (!existsSync(inputPath)) {
      throw new Error(`输入文件不存在: ${inputPath}`)
    }

    const taskId = 'task_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7)
    mkdirSync(dirname(outputPath), { recursive: true })

    // 获取时长辅助计算精确百分比
    let totalDuration = 0
    if (options.duration) {
      totalDuration = typeof options.duration === 'number' ? options.duration : parseFloat(String(options.duration))
    } else {
      try {
        const probe = await this.probeMedia(inputPath)
        totalDuration = probe.duration || 0
      } catch {}
    }

    return new Promise((resolve, reject) => {
      const args: string[] = ['-y']

      // 截取起始时间 (放在 -i 前提高寻道速度)
      if (options.startTime !== undefined && options.startTime !== '') {
        args.push('-ss', String(options.startTime))
      }

      args.push('-i', inputPath)

      // 截取时长
      if (options.duration !== undefined && options.duration !== '') {
        args.push('-t', String(options.duration))
      }

      const isGif = options.isGif || outputPath.toLowerCase().endsWith('.gif')
      const isAudioOnly =
        options.videoCodec === 'none' ||
        ['.mp3', '.wav', '.aac', '.flac', '.m4a', '.ogg'].some((ext) =>
          outputPath.toLowerCase().endsWith(ext)
        )

      if (isGif) {
        const fps = options.fps || 15
        const scale = options.scale || '-1:-1'
        // 高保真调色板渲染滤镜
        args.push(
          '-filter_complex',
          `[0:v] fps=${fps},scale=${scale}:flags=lanczos,split [a][b];[a] palettegen=reserve_transparent=on:transparency_color=ffffff [p];[b][p] paletteuse`
        )
      } else if (isAudioOnly) {
        args.push('-vn')
        if (options.audioCodec && options.audioCodec !== 'none') {
          args.push('-c:a', options.audioCodec)
        } else {
          if (outputPath.endsWith('.mp3')) args.push('-c:a', 'libmp3lame')
          else if (outputPath.endsWith('.aac') || outputPath.endsWith('.m4a')) args.push('-c:a', 'aac')
          else if (outputPath.endsWith('.flac')) args.push('-c:a', 'flac')
          else if (outputPath.endsWith('.wav')) args.push('-c:a', 'pcm_s16le')
          else if (outputPath.endsWith('.ogg')) args.push('-c:a', 'libvorbis')
        }
        if (options.audioBitrate) {
          args.push('-b:a', options.audioBitrate)
        }
      } else {
        if (options.videoCodec) {
          args.push('-c:v', options.videoCodec)
        } else {
          args.push('-c:v', 'libx264')
        }

        if (options.crf !== undefined) {
          args.push('-crf', String(options.crf))
        }

        if (options.fps) {
          args.push('-r', String(options.fps))
        }

        if (options.scale) {
          args.push('-vf', `scale=${options.scale}`)
        }

        if (options.videoBitrate) {
          args.push('-b:v', options.videoBitrate)
        }

        if (options.audioCodec) {
          args.push('-c:a', options.audioCodec)
        } else {
          args.push('-c:a', 'aac')
        }

        if (options.audioBitrate) {
          args.push('-b:a', options.audioBitrate)
        }
      }

      if (options.extraArgs && Array.isArray(options.extraArgs)) {
        args.push(...options.extraArgs)
      }

      args.push(outputPath)

      console.log(`[FFmpegManager] 启动转码任务 [${taskId}]:`)
      console.log(`  命令: ${status.path} ${args.join(' ')}`)

      const proc = spawn(status.path!, args, { windowsHide: true })
      this.activeTasks.set(taskId, proc)

      let stderrOutput = ''

      proc.stderr.on('data', (chunk) => {
        const text = chunk.toString()
        stderrOutput += text

        const timeMatch = text.match(/time=\s*(\d+):(\d+):(\d+\.?\d*)/)
        const speedMatch = text.match(/speed=\s*([0-9.]+)x/)
        const fpsMatch = text.match(/fps=\s*([0-9.]+)/)
        const bitrateMatch = text.match(/bitrate=\s*([0-9.]+kbits\/s)/)

        let percent = 0
        let timemark: string | undefined

        if (timeMatch) {
          const h = parseFloat(timeMatch[1])
          const m = parseFloat(timeMatch[2])
          const s = parseFloat(timeMatch[3])
          const currentSeconds = h * 3600 + m * 60 + s
          timemark = `${timeMatch[1]}:${timeMatch[2]}:${timeMatch[3]}`

          if (totalDuration > 0) {
            percent = Math.min(99, Math.max(0, Math.round((currentSeconds / totalDuration) * 100)))
          }
        }

        if (onProgress && (timeMatch || speedMatch)) {
          onProgress({
            taskId,
            percent,
            timemark,
            fps: fpsMatch ? parseFloat(fpsMatch[1]) : undefined,
            speed: speedMatch ? `${speedMatch[1]}x` : undefined,
            bitrate: bitrateMatch ? bitrateMatch[1] : undefined,
            status: 'running'
          })
        }
      })

      proc.on('close', (code) => {
        this.activeTasks.delete(taskId)
        if (code === 0 && existsSync(outputPath)) {
          const fileSize = statSync(outputPath).size
          if (onProgress) {
            onProgress({
              taskId,
              percent: 100,
              status: 'completed',
              outputPath
            })
          }
          resolve({ success: true, taskId, outputPath, size: fileSize })
        } else {
          if (onProgress) {
            onProgress({
              taskId,
              percent: 0,
              status: 'failed',
              error: `转码失败 (退出码 ${code})`
            })
          }
          reject(new Error(`FFmpeg 转码失败 (退出码 ${code}): ${stderrOutput.slice(-300)}`))
        }
      })

      proc.on('error', (err) => {
        this.activeTasks.delete(taskId)
        if (onProgress) {
          onProgress({
            taskId,
            percent: 0,
            status: 'failed',
            error: err.message
          })
        }
        reject(new Error(`启动 FFmpeg 进程失败: ${err.message}`))
      })
    })
  }
}
