import { app } from 'electron'
import * as path from 'node:path'
import * as fs from 'node:fs'
import { PluginViewContainerManager } from '../container/plugin-view'

export type ObjectStorageProviderType = 's3' | 'oss' | 'cos' | 'minio' | 'r2' | 'custom'

export interface ObjectStorageProfile {
  id: string
  name: string
  provider: ObjectStorageProviderType
  endpoint: string
  region: string
  accessKeyId: string
  secretAccessKey: string
  defaultBucket?: string
  pathStyle?: boolean
  customDomain?: string
  useSSL?: boolean
  createdAt: number
  lastUsedAt?: number
}

export class ObjectStorageService {
  private static instance: ObjectStorageService
  private profilesPath: string

  private constructor() {
    const userData = app.getPath('userData')
    this.profilesPath = path.join(userData, 'object-storage-profiles.json')
  }

  public static getInstance(): ObjectStorageService {
    if (!ObjectStorageService.instance) {
      ObjectStorageService.instance = new ObjectStorageService()
    }
    return ObjectStorageService.instance
  }

  public getProfilesPath(): string {
    return this.profilesPath
  }

  /**
   * 获取所有对象存储配置
   */
  public async getProfiles(): Promise<ObjectStorageProfile[]> {
    try {
      if (!fs.existsSync(this.profilesPath)) {
        return []
      }
      const raw = await fs.promises.readFile(this.profilesPath, 'utf8')
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed : []
    } catch (err) {
      console.error('[ObjectStorageService] 读取对象存储配置失败:', err)
      return []
    }
  }

  /**
   * 保存或更新单个配置
   */
  public async saveProfile(profile: ObjectStorageProfile): Promise<boolean> {
    try {
      const profiles = await this.getProfiles()
      const idx = profiles.findIndex((p) => p.id === profile.id)
      if (idx >= 0) {
        profiles[idx] = profile
      } else {
        profiles.push(profile)
      }
      await this.saveProfiles(profiles)
      return true
    } catch (err) {
      console.error('[ObjectStorageService] 保存对象存储配置失败:', err)
      return false
    }
  }

  /**
   * 批量保存/覆盖所有配置
   */
  public async saveProfiles(profiles: ObjectStorageProfile[]): Promise<boolean> {
    try {
      await fs.promises.writeFile(this.profilesPath, JSON.stringify(profiles, null, 2), 'utf8')
      this.broadcastProfilesUpdated()
      return true
    } catch (err) {
      console.error('[ObjectStorageService] 批量保存对象存储配置失败:', err)
      return false
    }
  }

  /**
   * 删除指定配置
   */
  public async deleteProfile(id: string): Promise<boolean> {
    try {
      const profiles = await this.getProfiles()
      const filtered = profiles.filter((p) => p.id !== id)
      await this.saveProfiles(filtered)
      return true
    } catch (err) {
      console.error('[ObjectStorageService] 删除对象存储配置失败:', err)
      return false
    }
  }

  /**
   * 向插件容器广播配置已更新事件
   */
  public broadcastProfilesUpdated(): void {
    try {
      PluginViewContainerManager.getInstance().broadcastToPlugins('plugin:object-storage:profiles-updated')
    } catch (err) {
      console.warn('[ObjectStorageService] 广播配置更新失败:', err)
    }
  }
}
