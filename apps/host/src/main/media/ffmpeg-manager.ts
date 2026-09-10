import { app, net } from 'electron'
import { join, dirname } from 'path'
import { existsSync, mkdirSync, copyFileSync, unlinkSync, createWriteStream, renameSync } from 'fs'
import { exec, spawn } from 'child_process'
import { promisify } from 'util'
import zlib from 'zlib'
import { once } from 'events'

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
}
