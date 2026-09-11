import { app, net } from 'electron'
import { join, resolve } from 'path'
import { existsSync, readFileSync, createWriteStream, mkdirSync } from 'fs'
import semver from 'semver'
import { PluginManager } from './plugin-manager'
import { verifyEd25519Signature, calculateFileSha256 } from '../security/keys'
import type { PluginCapability, PluginEngines } from '@doujiao/plugin-sdk'

export interface RegistryArtifact {
  platform: string
  arch: string
  url: string
  size: number
  sha256: string
  signature: string
}

export interface RegistryRelease {
  version: string
  channel: 'stable' | 'beta'
  publishedAt: string
  changelog: string
  engines: PluginEngines
  permissions: PluginCapability[]
  artifacts: RegistryArtifact[]
}

export interface RegistryPluginItem {
  id: string
  publisher: string
  name: string
  description: string
  icon?: string
  releases: RegistryRelease[]
}

export interface RegistryData {
  schemaVersion: number
  registryVersion: number
  updatedAt: string
  plugins: RegistryPluginItem[]
}

export interface MarketPluginView {
  id: string
  publisher: string
  name: string
  description: string
  icon?: string
  latestVersion: string
  changelog: string
  size: number
  permissions: PluginCapability[]
  isInstalled: boolean
  installedVersion?: string
  hasUpdate: boolean
  isDev?: boolean
  enabled?: boolean
}

export interface MarketFetchResult {
  plugins: MarketPluginView[]
  fromRemote: boolean
  registryVersion: number
  error?: string
}

const GITHUB_OFFICIAL_REGISTRY_URLS = [
  'https://raw.githubusercontent.com/newbee7955/djtools/main/registry/plugins-registry.json',
  'https://github.com/newbee7955/djtools/raw/main/registry/plugins-registry.json'
]

export class RegistryClient {
  private static instance: RegistryClient
  private cachedRegistry: RegistryData | null = null
  private lastFetchTime = 0
  private lastSyncFromRemote = false
  private lastSyncError: string | null = null
  private cacheDir: string

  private constructor() {
    this.cacheDir = join(app.getPath('userData'), 'cache', 'plugin-downloads')
    if (!existsSync(this.cacheDir)) {
      mkdirSync(this.cacheDir, { recursive: true })
    }
  }

  public static getInstance(): RegistryClient {
    if (!RegistryClient.instance) {
      RegistryClient.instance = new RegistryClient()
    }
    return RegistryClient.instance
  }

  /**
   * 本地索引候选探测（0ms 极速加载）
   */
  private loadLocalRegistry(): RegistryData | null {
    const candidates = [
      resolve(process.resourcesPath || '', 'registry/plugins-registry.json'),
      resolve(process.resourcesPath || '', 'plugins-registry.json'),
      resolve(process.cwd(), 'registry/plugins-registry.json'),
      resolve(app.getAppPath(), '../../registry/plugins-registry.json'),
      resolve(app.getAppPath(), '../registry/plugins-registry.json'),
      resolve(app.getAppPath(), 'registry/plugins-registry.json')
    ]

    for (const file of candidates) {
      if (existsSync(file)) {
        try {
          const raw = readFileSync(file, 'utf-8')
          const data = JSON.parse(raw) as RegistryData
          if (data && data.plugins) {
            return data
          }
        } catch {}
      }
    }
    return null
  }

  /**
   * 获取中心市场数据（直连 GitHub 官方源，15s 超时与容错）
   */
  public async fetchRegistry(forceRefresh = false): Promise<RegistryData> {
    const now = Date.now()

    // 60s 内存缓存命中（非强制），直接返回
    if (!forceRefresh && this.cachedRegistry && now - this.lastFetchTime < 60000) {
      return this.cachedRegistry
    }

    const localData = this.loadLocalRegistry()

    // 非强制刷新：本地数据立即返回，后台异步拉取远端更新内存缓存
    if (!forceRefresh && (localData || this.cachedRegistry)) {
      const base = localData || this.cachedRegistry!
      if (!this.cachedRegistry) {
        this.cachedRegistry = base
        this.lastFetchTime = now
      }
      // 后台静默刷新，下次 60s 缓存过期后生效
      this.fetchRemoteInBackground()
      return base
    }

    // 强制刷新（或无任何本地数据）：同步等待远端
    this.lastSyncFromRemote = false
    this.lastSyncError = null

    for (const registryUrl of GITHUB_OFFICIAL_REGISTRY_URLS) {
      try {
        console.log(`[RegistryClient] Fetching: ${registryUrl}`)
        const resp = await net.fetch(registryUrl, {
          headers: { 'User-Agent': 'Doujiao-Host/0.2.0' },
          signal: AbortSignal.timeout(60000)
        })
        if (resp.ok) {
          const data = (await resp.json()) as RegistryData
          if (data && Array.isArray(data.plugins)) {
            const currentVer = Math.max(this.cachedRegistry?.registryVersion || 0, localData?.registryVersion || 0)
            if ((data.registryVersion || 0) >= currentVer) {
              this.cachedRegistry = data
              this.lastFetchTime = Date.now()
              this.lastSyncFromRemote = true
              console.log(`[RegistryClient] Synced registry v${data.registryVersion} from remote`)
              return data
            } else {
              console.log(`[RegistryClient] Remote registry v${data.registryVersion} < local v${currentVer}, keeping local`)
            }
          }
        } else {
          this.lastSyncError = `HTTP ${resp.status}`
        }
      } catch (err: any) {
        this.lastSyncError = err?.message || 'timeout'
        console.warn(`[RegistryClient] Fetch failed (${this.lastSyncError}): ${registryUrl}`)
      }
    }

    // 远端全部失败或版本较低，回退本地
    if (localData) {
      console.log('[RegistryClient] Using local registry fallback')
      this.cachedRegistry = localData
      this.lastFetchTime = Date.now()
      return localData
    }

    return this.cachedRegistry || { schemaVersion: 2, registryVersion: 0, updatedAt: '', plugins: [] }
  }

  /** 后台静默拉取远端 registry，成功后更新内存缓存（不阻塞调用方） */
  private fetchRemoteInBackground(): void {
    ;(async () => {
      for (const registryUrl of GITHUB_OFFICIAL_REGISTRY_URLS) {
        try {
          const resp = await net.fetch(registryUrl, {
            headers: { 'User-Agent': 'Doujiao-Host/0.2.0' },
            signal: AbortSignal.timeout(60000)
          })
          if (resp.ok) {
            const data = (await resp.json()) as RegistryData
            if (data && Array.isArray(data.plugins)) {
              const localData = this.loadLocalRegistry()
              const currentVer = Math.max(this.cachedRegistry?.registryVersion || 0, localData?.registryVersion || 0)
              if ((data.registryVersion || 0) >= currentVer) {
                this.cachedRegistry = data
                this.lastFetchTime = Date.now()
                this.lastSyncFromRemote = true
                console.log(`[RegistryClient] Background sync done: v${data.registryVersion}`)
              } else {
                console.log(`[RegistryClient] Remote registry v${data.registryVersion} < current v${currentVer}, skipping overwrite`)
              }
              return
            }
          }
        } catch {}
      }
    })()
  }


  /**
   * 获取面向渲染层的市场插件聚合视图（整合本地安装状态与更新提示）
   */
  public async getMarketPlugins(forceRefresh = false): Promise<MarketFetchResult> {
    const registry = await this.fetchRegistry(forceRefresh)
    const pluginManager = PluginManager.getInstance()
    const installed = pluginManager.listAllPlugins()
    const hostVersion = app.getVersion() || '0.2.0'

    const views: MarketPluginView[] = []

    for (const plugin of registry.plugins) {
      // 筛选与当前宿主版本兼容的最高版本
      const compatibleRelease = plugin.releases.find((r) => {
        if (!r.engines?.doujiao) return true
        return semver.satisfies(hostVersion, r.engines.doujiao, { loose: true })
      }) || plugin.releases[0]

      if (!compatibleRelease) continue

      const local = installed.find((p) => p.id === plugin.id)
      const isInstalled = !!local
      const installedVersion = local?.version
      const latestVersion = compatibleRelease.version
      const hasUpdate = isInstalled && semver.gt(latestVersion, installedVersion || '0.0.0')

      const artifact = compatibleRelease.artifacts?.[0]

      views.push({
        id: plugin.id,
        publisher: plugin.publisher,
        name: plugin.name,
        description: plugin.description,
        icon: plugin.icon,
        latestVersion,
        changelog: compatibleRelease.changelog,
        size: artifact?.size || 0,
        permissions: compatibleRelease.permissions || [],
        isInstalled,
        installedVersion,
        hasUpdate,
        isDev: local?.isDev,
        enabled: local ? local.enabled !== false : undefined
      })
    }

    return {
      plugins: views,
      fromRemote: this.lastSyncFromRemote,
      registryVersion: registry.registryVersion || 0,
      error: this.lastSyncError || undefined
    }
  }

  /**
   * 在线一键下载、双重安全验签（SHA-256 + Ed25519）并事务安装插件
   */
  public async installFromRegistry(pluginId: string, version?: string): Promise<{ success: boolean; pluginId: string; version: string }> {
    const registry = await this.fetchRegistry()
    const plugin = registry.plugins.find((p) => p.id === pluginId)
    if (!plugin) {
      throw new Error(`在插件市场中未找到插件: ${pluginId}`)
    }

    let release = version
      ? plugin.releases.find((r) => r.version === version)
      : plugin.releases[0]

    if (!release) {
      const localData = this.loadLocalRegistry()
      const localPlugin = localData?.plugins.find((p) => p.id === pluginId)
      if (localPlugin) {
        release = version
          ? localPlugin.releases.find((r) => r.version === version)
          : localPlugin.releases[0]
      }
    }

    if (!release) {
      throw new Error(`未找到插件版本: ${pluginId} @ ${version || 'latest'}`)
    }

    const artifact = release.artifacts?.[0]
    if (!artifact) {
      throw new Error(`插件发布信息缺少安装构件 (artifacts)`)
    }

    const zipFileName = `${pluginId}-v${release.version}.zip`
    const targetZipPath = join(this.cacheDir, zipFileName)

    console.log(`\n[RegistryClient] 开始下载插件: ${pluginId}@${release.version}`)
    console.log(`[RegistryClient] 下载来源: ${artifact.url}`)

    // 1. 如果本地开发或安装包内已有预置的 release 包，优先使用本地包提速 (0ms 离线安装)
    let downloaded = false
    const localReleaseCandidates = [
      resolve(process.resourcesPath || '', 'registry/releases', zipFileName),
      resolve(process.resourcesPath || '', 'releases', zipFileName),
      resolve(process.cwd(), 'registry/releases', zipFileName),
      resolve(app.getAppPath(), '../../registry/releases', zipFileName),
      resolve(app.getAppPath(), '../registry/releases', zipFileName),
      resolve(app.getAppPath(), 'registry/releases', zipFileName)
    ]
    for (const localZip of localReleaseCandidates) {
      if (existsSync(localZip)) {
        const buf = readFileSync(localZip)
        const fs = await import('fs')
        fs.writeFileSync(targetZipPath, buf)
        downloaded = true
        console.log(`[RegistryClient] Using local/bundled release archive: ${localZip}`)
        break
      }
    }

    if (!downloaded) {
      // 直连 GitHub 下载
      const candidateUrls = Array.from(
        new Set([
          artifact.url,
          `https://raw.githubusercontent.com/newbee7955/djtools/main/registry/releases/${zipFileName}`,
          `https://github.com/newbee7955/djtools/raw/main/registry/releases/${zipFileName}`
        ])
      )

      let lastError = ''
      let fetchSuccess = false

      for (const downloadUrl of candidateUrls) {
        console.log(`[RegistryClient] 尝试下载插件包: ${downloadUrl}`)
        try {
          const resp = await net.fetch(downloadUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Doujiao-Host/0.2.0'
            },
            signal: AbortSignal.timeout(20000)
          })

          if (resp && resp.ok) {
            const fileStream = createWriteStream(targetZipPath)
            const reader = resp.body?.getReader()
            if (!reader) {
              throw new Error('无法创建网络数据流')
            }

            while (true) {
              const { done, value } = await reader.read()
              if (done) break
              fileStream.write(Buffer.from(value))
            }
            fileStream.end()

            await new Promise<void>((resolve) => fileStream.on('finish', () => resolve()))
            fetchSuccess = true
            console.log(`[RegistryClient] 插件包下载完成 (${downloadUrl})`)
            break
          } else {
            lastError = `HTTP ${resp?.status || '连接超时'}`
            console.warn(`[RegistryClient] 下载源返回状态异常: ${downloadUrl} (${lastError})`)
          }
        } catch (err: any) {
          lastError = err?.message || '网络连接异常'
          console.warn(`[RegistryClient] 下载连接失败: ${downloadUrl} (${lastError})`)
        }
      }

      if (!fetchSuccess) {
        throw new Error(`下载插件安装包失败: ${lastError}。请检查系统代理设置或网络是否畅通。`)
      }
    }

    console.log(`[RegistryClient] 插件包下载完毕，开始双重密码学生命线安全校验...`)

    // 2. 校验文件完整性 (SHA-256)
    const actualSha256 = await calculateFileSha256(targetZipPath)
    if (actualSha256.toLowerCase() !== artifact.sha256.toLowerCase()) {
      throw new Error(
        `[Security] 拦截篡改包：SHA-256 校验失败 (预期: ${artifact.sha256}, 实际: ${actualSha256})`
      )
    }
    console.log(`[RegistryClient] ✓ SHA-256 完整性哈希校验通过`)

    // 3. 校验官方 Ed25519 数字签名
    const isSignatureValid = verifyEd25519Signature(
      Buffer.from(actualSha256, 'utf-8'),
      artifact.signature
    )
    if (!isSignatureValid) {
      throw new Error(`[Security] 拦截非官方或伪造包：Ed25519 数字签名验证未通过！`)
    }
    console.log(`[RegistryClient] ✓ 官方 Ed25519 数字验签通过，证明来源完全可信`)

    // 4. 移交 PluginManager 执行安全解压与不可变事务切换
    const pluginManager = PluginManager.getInstance()
    const result = await pluginManager.installFromZip(targetZipPath)
    console.log(`[RegistryClient] ✓ 插件 ${pluginId}@${release.version} 事务加载完成！`)

    return result
  }
}
