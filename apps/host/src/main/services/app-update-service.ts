import { app, net } from 'electron'
import { join, resolve } from 'path'
import { existsSync, readFileSync, writeFileSync, mkdirSync, createWriteStream } from 'fs'
import { spawn } from 'child_process'
import semver from 'semver'

export interface AppUpdateInfo {
  hasUpdate: boolean
  currentVersion: string
  latestVersion: string
  changelog: string
  releaseDate: string
  downloadUrl: string
  fallbackUrls?: string[]
  size?: number
}

export interface AppUpdateProgress {
  percent: number
  transferred: number
  total: number
  speed: string
  status: 'downloading' | 'completed' | 'failed'
  error?: string
}

export interface AppUpdateConfig {
  autoCheck: boolean
}

const GITHUB_VERSION_ENDPOINTS = [
  'https://cdn.jsdelivr.net/gh/newbee7955/djtools@main/registry/app-version.json',
  'https://fastly.jsdelivr.net/gh/newbee7955/djtools@main/registry/app-version.json',
  'https://gcore.jsdelivr.net/gh/newbee7955/djtools@main/registry/app-version.json',
  'https://raw.githubusercontent.com/newbee7955/djtools/main/registry/app-version.json',
  'https://ghproxy.net/https://raw.githubusercontent.com/newbee7955/djtools/main/registry/app-version.json'
]

export class AppUpdateService {
  private static instance: AppUpdateService
  private configFile: string
  private updateDir: string
  private downloadedInstallerPath: string | null = null
  private config: AppUpdateConfig = { autoCheck: true }

  private constructor() {
    const userData = app.getPath('userData')
    this.configFile = join(userData, 'app-update-config.json')
    this.updateDir = join(userData, 'updates')
    if (!existsSync(this.updateDir)) {
      mkdirSync(this.updateDir, { recursive: true })
    }
    this.loadConfig()
  }

  public static getInstance(): AppUpdateService {
    if (!AppUpdateService.instance) {
      AppUpdateService.instance = new AppUpdateService()
    }
    return AppUpdateService.instance
  }

  private loadConfig(): void {
    try {
      if (existsSync(this.configFile)) {
        this.config = JSON.parse(readFileSync(this.configFile, 'utf-8'))
      }
    } catch {
      this.config = { autoCheck: true }
    }
  }

  public getConfig(): AppUpdateConfig {
    return { ...this.config }
  }

  public setConfig(cfg: Partial<AppUpdateConfig>): AppUpdateConfig {
    this.config = { ...this.config, ...cfg }
    try {
      writeFileSync(this.configFile, JSON.stringify(this.config, null, 2), 'utf-8')
    } catch (err) {
      console.error('[AppUpdateService] 保存更新配置失败:', err)
    }
    return this.getConfig()
  }

  /**
   * 检查主程序是否有最新版本
   */
  public async checkForUpdates(): Promise<AppUpdateInfo> {
    const currentVersion = app.getVersion() || '0.2.1'
    let remoteData: any = null

    // 1. 尝试远端多 CDN 源
    for (const url of GITHUB_VERSION_ENDPOINTS) {
      try {
        console.log(`[AppUpdateService] 正在获取主程序版本信息: ${url}`)
        const resp = await net.fetch(url, {
          headers: { 'User-Agent': `Doujiao-Host/${currentVersion}` },
          signal: AbortSignal.timeout(10000)
        })
        if (resp.ok) {
          remoteData = await resp.json()
          if (remoteData && remoteData.version) {
            console.log(`[AppUpdateService] 成功拉取版本信息: v${remoteData.version}`)
            break
          }
        }
      } catch (err: any) {
        console.warn(`[AppUpdateService] 源拉取失败 (${url}):`, err?.message)
      }
    }

    // 2. 本地包内兜底
    if (!remoteData) {
      const localCandidates = [
        resolve(process.resourcesPath || '', 'registry/app-version.json'),
        resolve(process.cwd(), 'registry/app-version.json'),
        resolve(app.getAppPath(), '../../registry/app-version.json'),
        resolve(app.getAppPath(), 'registry/app-version.json')
      ]
      for (const loc of localCandidates) {
        if (existsSync(loc)) {
          try {
            remoteData = JSON.parse(readFileSync(loc, 'utf-8'))
            break
          } catch {}
        }
      }
    }

    if (!remoteData || !remoteData.version) {
      return {
        hasUpdate: false,
        currentVersion,
        latestVersion: currentVersion,
        changelog: '无法连接到更新服务器，请检查网络设置。',
        releaseDate: '',
        downloadUrl: ''
      }
    }

    const latestVersion = remoteData.version
    const hasUpdate = semver.gt(latestVersion, currentVersion)

    return {
      hasUpdate,
      currentVersion,
      latestVersion,
      changelog: remoteData.changelog || '最新优化与缺陷修复',
      releaseDate: remoteData.releaseDate || '',
      downloadUrl: remoteData.downloadUrl || '',
      fallbackUrls: remoteData.fallbackUrls || [],
      size: remoteData.size || 0
    }
  }

  /**
   * 下载安装包并实时报告进度
   */
  public async downloadUpdate(
    onProgress: (progress: AppUpdateProgress) => void
  ): Promise<{ success: boolean; installerPath?: string; error?: string }> {
    const updateInfo = await this.checkForUpdates()
    if (!updateInfo.hasUpdate && !updateInfo.downloadUrl) {
      return { success: false, error: '当前已是最新版本，无需下载' }
    }

    const candidateUrls = [
      updateInfo.downloadUrl,
      ...(updateInfo.fallbackUrls || []),
      `https://ghproxy.net/${updateInfo.downloadUrl}`
    ].filter(Boolean)

    const targetInstaller = join(this.updateDir, `Doujiao-Setup-${updateInfo.latestVersion}.exe`)

    let downloaded = false
    let lastError = ''

    for (const dUrl of candidateUrls) {
      try {
        console.log(`[AppUpdateService] 正在下载主程序更新: ${dUrl}`)
        const resp = await net.fetch(dUrl, {
          headers: { 'User-Agent': `Doujiao-Host/${updateInfo.currentVersion}` },
          signal: AbortSignal.timeout(30000)
        })

        if (!resp.ok) {
          lastError = `HTTP ${resp.status}`
          continue
        }

        const totalBytes =
          parseInt(resp.headers.get('content-length') || '0', 10) || updateInfo.size || 0
        let transferred = 0
        let lastTransferred = 0
        let lastTime = Date.now()

        const fileStream = createWriteStream(targetInstaller)
        const reader = resp.body?.getReader()
        if (!reader) throw new Error('无法初始化流式读取器')

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          fileStream.write(Buffer.from(value))
          transferred += value.length

          const now = Date.now()
          const durationSec = (now - lastTime) / 1000
          if (durationSec > 0.3) {
            const bytesPerSec = (transferred - lastTransferred) / durationSec
            const speed =
              bytesPerSec > 1024 * 1024
                ? `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`
                : `${(bytesPerSec / 1024).toFixed(0)} KB/s`

            const percent = totalBytes > 0 ? Math.min(100, Math.round((transferred / totalBytes) * 100)) : 0

            onProgress({
              percent,
              transferred,
              total: totalBytes,
              speed,
              status: 'downloading'
            })

            lastTransferred = transferred
            lastTime = now
          }
        }

        fileStream.end()
        await new Promise<void>((res) => fileStream.on('finish', () => res()))

        this.downloadedInstallerPath = targetInstaller
        downloaded = true

        onProgress({
          percent: 100,
          transferred: totalBytes || transferred,
          total: totalBytes || transferred,
          speed: '完成',
          status: 'completed'
        })
        break
      } catch (err: any) {
        lastError = err?.message || '下载异常'
        console.warn(`[AppUpdateService] 当前源下载失败: ${dUrl}`, err)
      }
    }

    if (!downloaded) {
      onProgress({
        percent: 0,
        transferred: 0,
        total: 0,
        speed: '0 KB/s',
        status: 'failed',
        error: lastError
      })
      return { success: false, error: `下载失败: ${lastError}` }
    }

    return { success: true, installerPath: targetInstaller }
  }

  /**
   * 执行安装并退出当前程序
   */
  public async installAndRestart(customPath?: string): Promise<boolean> {
    const installer = customPath || this.downloadedInstallerPath
    if (!installer || !existsSync(installer)) {
      throw new Error('未找到已下载的安装包，请先下载更新')
    }

    console.log(`[AppUpdateService] 正在拉起安装程序: ${installer}`)
    // Windows 环境下通过分离进程启动安装器
    const proc = spawn(installer, [], {
      detached: true,
      stdio: 'ignore'
    })
    proc.unref()

    // 延迟 500ms 后安全退出当前程序
    setTimeout(() => {
      app.quit()
    }, 500)

    return true
  }

  /**
   * 应用启动静默检测（延时 4 秒，不阻塞启动首屏）
   */
  public startAutoCheck(onAvailable: (info: AppUpdateInfo) => void): void {
    if (!this.config.autoCheck) return
    setTimeout(async () => {
      try {
        const info = await this.checkForUpdates()
        if (info.hasUpdate) {
          onAvailable(info)
        }
      } catch (err) {
        console.warn('[AppUpdateService] 静默检查更新失败:', err)
      }
    }, 4000)
  }
}
