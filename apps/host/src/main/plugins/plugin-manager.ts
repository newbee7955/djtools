import { app } from 'electron'
import { join, resolve, normalize } from 'path'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  rmSync,
  cpSync
} from 'fs'
import extract from 'extract-zip'
import type { PluginManifest } from '@doujiao/plugin-sdk'

export interface PluginState {
  pluginId: string
  activeVersion: string
  previousVersion?: string
  installedVersions: string[]
  installedAt: number
  updatedAt: number
  enabled: boolean
}

export interface DiscoveredPlugin {
  id: string
  name: string
  version: string
  description: string
  icon?: string
  publisher?: string
  isDev: boolean
  isInstalled: boolean
  enabled: boolean
  activeVersionPath: string
  manifest: PluginManifest
}

// 安全限制常量 (根据 V2.0 规格书)
const MAX_TOTAL_UNCOMPRESSED_BYTES = 100 * 1024 * 1024 // 100 MB
const MAX_SINGLE_FILE_BYTES = 25 * 1024 * 1024        // 25 MB
const MAX_ENTRY_COUNT = 500                           // 500 个文件条目
const PROHIBITED_EXTENSIONS = /\.(exe|bat|cmd|dll|node|sh|vbs|ps1|msi|so|dylib)$/i

export class PluginManager {
  private static instance: PluginManager
  private userDataPluginsDir: string
  private cacheDir: string
  private stagingDir: string

  private constructor() {
    const userData = app.getPath('userData')
    this.userDataPluginsDir = join(userData, 'plugins')
    this.cacheDir = join(userData, 'cache', 'plugin-downloads')
    this.stagingDir = join(userData, 'cache', 'staging')

    // 确保基础目录存在
    for (const dir of [this.userDataPluginsDir, this.cacheDir, this.stagingDir]) {
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true })
      }
    }
  }

  public static getInstance(): PluginManager {
    if (!PluginManager.instance) {
      PluginManager.instance = new PluginManager()
    }
    return PluginManager.instance
  }

  /**
   * 自动探测开发环境的 plugins 根目录
   */
  private getDevPluginsRoot(): string {
    const candidates = [
      resolve(app.getAppPath(), '../../plugins'),
      resolve(app.getAppPath(), '../plugins'),
      resolve(app.getAppPath(), 'plugins'),
      resolve(process.cwd(), 'plugins'),
      resolve(process.cwd(), '../../plugins')
    ]
    for (const p of candidates) {
      if (existsSync(p)) return p
    }
    return candidates[0]
  }

  /**
   * 获取指定插件当前激活版本的根目录
   * 遵循开发环境优先与生产不可变指针机制，准确根据 manifest.id 匹配
   */
  public getActiveVersionDir(pluginId: string): string | null {
    // 1. 优先从已安装插件列表中准确匹配 manifest.id
    const allPlugins = this.listAllPlugins()
    const match = allPlugins.find((p) => p.id === pluginId)
    if (match && match.activeVersionPath && existsSync(match.activeVersionPath)) {
      return match.activeVersionPath
    }

    // 2. 检查 userData/plugins/<pluginId>/versions/<activeVersion>
    const state = this.getPluginState(pluginId)
    if (state && state.enabled && state.activeVersion) {
      const versionDir = join(this.userDataPluginsDir, pluginId, 'versions', state.activeVersion)
      if (existsSync(versionDir)) {
        const distDir = join(versionDir, 'dist')
        return existsSync(distDir) ? distDir : versionDir
      }
    }

    return null
  }

  /**
   * 获取指定插件的信息与清单
   */
  public getPlugin(pluginId: string): DiscoveredPlugin | undefined {
    return this.listAllPlugins().find((p) => p.id === pluginId)
  }

  /**
   * 读取指定插件的 state.json
   */
  public getPluginState(pluginId: string): PluginState | null {
    const stateFile = join(this.userDataPluginsDir, pluginId, 'state.json')
    if (existsSync(stateFile)) {
      try {
        const raw = readFileSync(stateFile, 'utf-8')
        return JSON.parse(raw) as PluginState
      } catch (err) {
        console.error(`[PluginManager] 读取 state.json 失败 (${pluginId}):`, err)
      }
    }
    return null
  }

  /**
   * 写入或更新插件的 state.json
   */
  public savePluginState(pluginId: string, state: PluginState): void {
    const pluginDir = join(this.userDataPluginsDir, pluginId)
    if (!existsSync(pluginDir)) {
      mkdirSync(pluginDir, { recursive: true })
    }
    const stateFile = join(pluginDir, 'state.json')
    writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf-8')
  }

  /**
   * 事务式安装 ZIP 插件包 (防范 ZipSlip / 炸弹 / 危险执行模块)
   */
  public async installFromZip(zipFilePath: string): Promise<{ success: boolean; pluginId: string; version: string }> {
    if (!existsSync(zipFilePath)) {
      throw new Error(`找不到 ZIP 文件: ${zipFilePath}`)
    }

    const stageId = `stage_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const targetStageDir = join(this.stagingDir, stageId)
    mkdirSync(targetStageDir, { recursive: true })

    let totalExtractedBytes = 0
    let entryCount = 0

    try {
      // 1. 安全防御解压
      await extract(zipFilePath, {
        dir: targetStageDir,
        onEntry: (entry) => {
          entryCount++
          if (entryCount > MAX_ENTRY_COUNT) {
            throw new Error(`[Security] 拦截解压炸弹：压缩包内文件数量超过最大限制 (${MAX_ENTRY_COUNT})`)
          }

          if (entry.uncompressedSize > MAX_SINGLE_FILE_BYTES) {
            throw new Error(
              `[Security] 拦截超大文件：条目 "${entry.fileName}" 解压体积超过上限 (${MAX_SINGLE_FILE_BYTES / 1024 / 1024}MB)`
            )
          }

          totalExtractedBytes += entry.uncompressedSize
          if (totalExtractedBytes > MAX_TOTAL_UNCOMPRESSED_BYTES) {
            throw new Error(
              `[Security] 拦截解压炸弹：解压总体积超过上限 (${MAX_TOTAL_UNCOMPRESSED_BYTES / 1024 / 1024}MB)`
            )
          }

          // 防范 ZipSlip 路径穿越
          const safeTarget = normalize(targetStageDir)
          const resolvedEntryPath = normalize(join(targetStageDir, entry.fileName))
          if (!resolvedEntryPath.startsWith(safeTarget)) {
            throw new Error(`[Security] 拦截 ZipSlip 路径穿越攻击: "${entry.fileName}"`)
          }

          // 禁止任何可执行二进制/脚本模块
          if (PROHIBITED_EXTENSIONS.test(entry.fileName)) {
            throw new Error(`[Security] 拦截高危二进制文件: "${entry.fileName}"`)
          }
        }
      })

      // 2. 定位 manifest.json (支持根目录或单个嵌套目录打包)
      let manifestPath = join(targetStageDir, 'manifest.json')
      let extractedRoot = targetStageDir

      if (!existsSync(manifestPath)) {
        const subdirs = readdirSync(targetStageDir, { withFileTypes: true })
          .filter((d) => d.isDirectory())
          .map((d) => d.name)
        if (subdirs.length === 1) {
          const nestedManifest = join(targetStageDir, subdirs[0], 'manifest.json')
          if (existsSync(nestedManifest)) {
            manifestPath = nestedManifest
            extractedRoot = join(targetStageDir, subdirs[0])
          }
        }
      }

      if (!existsSync(manifestPath)) {
        throw new Error('插件包中缺少必需的 manifest.json 规格文件')
      }

      const manifest: PluginManifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
      if (!manifest.id || !manifest.version) {
        throw new Error('manifest.json 格式不合法：缺少 id 或 version 字段')
      }

      // 3. 校验 entrypoints.ui 入口文件
      const uiEntry = manifest.entrypoints?.ui || 'index.html'
      const uiEntryPath = join(extractedRoot, uiEntry)
      if (!existsSync(uiEntryPath)) {
        throw new Error(`插件清单声明的 UI 入口文件不存在: ${uiEntry}`)
      }

      // 4. 原子移动到不可变版本目录: userData/plugins/<pluginId>/versions/<version>/
      const versionTargetDir = join(this.userDataPluginsDir, manifest.id, 'versions', manifest.version)
      if (existsSync(versionTargetDir)) {
        rmSync(versionTargetDir, { recursive: true, force: true })
      }
      mkdirSync(versionTargetDir, { recursive: true })
      cpSync(extractedRoot, versionTargetDir, { recursive: true })

      // 5. 更新不可变状态指针 state.json
      const oldState = this.getPluginState(manifest.id)
      const installedVersions = new Set(oldState?.installedVersions || [])
      installedVersions.add(manifest.version)

      const newState: PluginState = {
        pluginId: manifest.id,
        activeVersion: manifest.version,
        previousVersion: oldState?.activeVersion || undefined,
        installedVersions: Array.from(installedVersions),
        installedAt: oldState?.installedAt || Date.now(),
        updatedAt: Date.now(),
        enabled: true
      }
      this.savePluginState(manifest.id, newState)

      console.log(`[PluginManager] 插件 ${manifest.id}@${manifest.version} 事务安装成功！`)
      return { success: true, pluginId: manifest.id, version: manifest.version }
    } finally {
      // 清理 staging 临时目录
      try {
        if (existsSync(targetStageDir)) {
          rmSync(targetStageDir, { recursive: true, force: true })
        }
      } catch (err) {
        console.warn(`[PluginManager] 清理 staging 临时目录失败:`, err)
      }
    }
  }

  /**
   * 卸载插件（销毁沙箱实例、移除版本目录与状态指针）
   */
  public uninstallPlugin(pluginId: string): boolean {
    const pluginDir = join(this.userDataPluginsDir, pluginId)
    if (existsSync(pluginDir)) {
      try {
        rmSync(pluginDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 })
        console.log(`[PluginManager] 插件 ${pluginId} 已彻底卸载并清理文件目录`)
        return true
      } catch (err) {
        console.error(`[PluginManager] 卸载插件失败 (${pluginId}):`, err)
        return false
      }
    }
    return false
  }

  /**
   * 获取所有已安装的插件清单（默认纯净微内核模式，不默认预装任何插件，由用户手动从市场或本地安装）
   */
  public listAllPlugins(): DiscoveredPlugin[] {
    const result: Map<string, DiscoveredPlugin> = new Map()

    // 1. 仅在显式声明环境变量 DOUJIAO_DEV_PLUGINS=true 时自动探测源码 plugins/* 目录
    if (process.env.DOUJIAO_DEV_PLUGINS === 'true') {
      try {
        const devPluginsRoot = this.getDevPluginsRoot()
        if (existsSync(devPluginsRoot)) {
          const dirs = readdirSync(devPluginsRoot, { withFileTypes: true })
          for (const dirent of dirs) {
            if (!dirent.isDirectory()) continue
            const manifestFile = join(devPluginsRoot, dirent.name, 'manifest.json')
            if (existsSync(manifestFile)) {
              try {
                const manifest: PluginManifest = JSON.parse(readFileSync(manifestFile, 'utf-8'))
                const distDir = join(devPluginsRoot, dirent.name, 'dist')
                result.set(manifest.id, {
                  id: manifest.id,
                  name: manifest.name,
                  version: manifest.version,
                  description: manifest.description,
                  icon: manifest.icon,
                  publisher: manifest.publisher,
                  isDev: true,
                  isInstalled: true,
                  enabled: true,
                  activeVersionPath: existsSync(distDir) ? distDir : join(devPluginsRoot, dirent.name),
                  manifest
                })
              } catch (err) {
                console.warn(`[PluginManager] 解析开发插件清单失败 (${dirent.name}):`, err)
              }
            }
          }
        }
      } catch (err) {
        console.warn(`[PluginManager] 扫描开发插件目录失败:`, err)
      }
    }

    // 2. 扫描用户实际安装的 userData/plugins/* 目录
    try {
      if (existsSync(this.userDataPluginsDir)) {
        const dirs = readdirSync(this.userDataPluginsDir, { withFileTypes: true })
        for (const dirent of dirs) {
          if (!dirent.isDirectory()) continue
          const pluginId = dirent.name
          const state = this.getPluginState(pluginId)
          if (!state || !state.activeVersion) continue

          const versionDir = join(this.userDataPluginsDir, pluginId, 'versions', state.activeVersion)
          const manifestFile = join(versionDir, 'manifest.json')

          if (existsSync(manifestFile)) {
            try {
              const manifest: PluginManifest = JSON.parse(readFileSync(manifestFile, 'utf-8'))
              const distDir = join(versionDir, 'dist')
              const activeVersionPath = existsSync(distDir) ? distDir : versionDir

              if (!result.has(manifest.id)) {
                result.set(manifest.id, {
                  id: manifest.id,
                  name: manifest.name,
                  version: manifest.version,
                  description: manifest.description,
                  icon: manifest.icon,
                  publisher: manifest.publisher,
                  isDev: false,
                  isInstalled: true,
                  enabled: state.enabled,
                  activeVersionPath,
                  manifest
                })
              }
            } catch (err) {
              console.warn(`[PluginManager] 解析已安装插件清单失败 (${pluginId}):`, err)
            }
          }
        }
      }
    } catch (err) {
      console.warn(`[PluginManager] 扫描已安装插件目录失败:`, err)
    }

    return Array.from(result.values())
  }
}
