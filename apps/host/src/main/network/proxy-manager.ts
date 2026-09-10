import { app, session, net } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'

export type ProxyMode = 'system' | 'direct' | 'custom'

export interface NetworkProxyConfig {
  mode: ProxyMode
  customProxyUrl: string
  bypassRules: string
}

export interface ProxyStatusResult extends NetworkProxyConfig {
  effectiveProxy: string
}

const DEFAULT_CONFIG: NetworkProxyConfig = {
  mode: 'system',
  customProxyUrl: 'http://127.0.0.1:7890',
  bypassRules: '<local>;localhost;127.0.0.1'
}

export class ProxyManager {
  private static instance: ProxyManager
  private config: NetworkProxyConfig = { ...DEFAULT_CONFIG }
  private configFile: string

  private constructor() {
    const configDir = join(app.getPath('userData'), 'config')
    if (!existsSync(configDir)) {
      mkdirSync(configDir, { recursive: true })
    }
    this.configFile = join(configDir, 'network-proxy.json')
    this.loadConfig()
  }

  public static getInstance(): ProxyManager {
    if (!ProxyManager.instance) {
      ProxyManager.instance = new ProxyManager()
    }
    return ProxyManager.instance
  }

  /**
   * 从磁盘读取代理配置，若不存在则使用默认值（默认跟随系统代理）
   */
  private loadConfig(): void {
    if (existsSync(this.configFile)) {
      try {
        const raw = readFileSync(this.configFile, 'utf-8')
        const parsed = JSON.parse(raw)
        this.config = {
          ...DEFAULT_CONFIG,
          ...parsed
        }
      } catch (err) {
        console.warn('[ProxyManager] 读取代理配置文件失败，使用默认配置:', err)
        this.config = { ...DEFAULT_CONFIG }
      }
    } else {
      this.saveConfig()
    }
  }

  /**
   * 将当前配置写入磁盘
   */
  private saveConfig(): void {
    try {
      writeFileSync(this.configFile, JSON.stringify(this.config, null, 2), 'utf-8')
    } catch (err) {
      console.error('[ProxyManager] 保存代理配置失败:', err)
    }
  }

  /**
   * 在 app ready 之后初始化并应用代理
   */
  public async init(): Promise<void> {
    await this.applyProxy()
    const effective = await this.resolveProxy('https://github.com')
    console.log(`[ProxyManager] Initialized (mode: ${this.config.mode}, effective for GitHub: ${effective})`)
  }

  /**
   * 应用代理策略到 Electron session.defaultSession
   */
  public async applyProxy(): Promise<void> {
    try {
      if (this.config.mode === 'direct') {
        // 关闭代理：直接连接
        await session.defaultSession.setProxy({
          mode: 'direct'
        })
        console.log('[ProxyManager] Switched to direct mode (proxy disabled)')
      } else if (this.config.mode === 'custom' && this.config.customProxyUrl) {
        // 自定义代理服务器
        await session.defaultSession.setProxy({
          mode: 'fixed_servers',
          proxyRules: this.config.customProxyUrl.trim(),
          proxyBypassRules: this.config.bypassRules || '<local>;localhost;127.0.0.1'
        })
        console.log(`[ProxyManager] Switched to custom proxy: ${this.config.customProxyUrl}`)
      } else {
        // 默认：跟随系统代理 (system)
        await session.defaultSession.setProxy({
          mode: 'system'
        })
        console.log('[ProxyManager] Switched to system proxy mode')
      }
    } catch (err) {
      console.error('[ProxyManager] Failed to apply proxy config:', err)
    }
  }

  /**
   * 获取当前代理配置与当前 GitHub 域名的实际生效代理
   */
  public async getStatus(): Promise<ProxyStatusResult> {
    const effective = await this.resolveProxy('https://github.com')
    return {
      ...this.config,
      effectiveProxy: effective
    }
  }

  /**
   * 更新代理设置
   */
  public async setConfig(newConfig: Partial<NetworkProxyConfig>): Promise<ProxyStatusResult> {
    this.config = {
      ...this.config,
      ...newConfig
    }
    this.saveConfig()
    await this.applyProxy()
    return await this.getStatus()
  }

  /**
   * 解析指定 URL 实际通过的代理字符串
   */
  public async resolveProxy(targetUrl = 'https://github.com'): Promise<string> {
    try {
      const proxyStr = await session.defaultSession.resolveProxy(targetUrl)
      return proxyStr || 'DIRECT'
    } catch (err) {
      return 'DIRECT'
    }
  }

  /**
   * 测试直连 GitHub 与官方插件源连通性并测量延迟
   */
  public async testGitHubConnectivity(): Promise<{
    success: boolean
    latencyMs?: number
    effectiveProxy: string
    error?: string
  }> {
    const testUrl = 'https://raw.githubusercontent.com/newbee7955/djtools/main/registry/plugins-registry.json'
    const effective = await this.resolveProxy('https://github.com')
    const startTime = Date.now()

    try {
      const resp = await net.fetch(testUrl, {
        method: 'GET',
        headers: { 'User-Agent': 'Doujiao-Host/0.2.0' },
        signal: AbortSignal.timeout(10000)
      })

      const latencyMs = Date.now() - startTime
      if (resp.ok) {
        return {
          success: true,
          latencyMs,
          effectiveProxy: effective
        }
      } else {
        return {
          success: false,
          effectiveProxy: effective,
          error: `HTTP ${resp.status} ${resp.statusText}`
        }
      }
    } catch (err: any) {
      return {
        success: false,
        effectiveProxy: effective,
        error: err?.message || '连接超时或网络不可达'
      }
    }
  }
}
