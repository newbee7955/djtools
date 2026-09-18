import { app } from 'electron'
import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { SambaService } from './samba-service.ts'
import { ObjectStorageService, ObjectStorageProfile } from './object-storage-service.ts'
import { ProxyManager, NetworkProxyConfig } from '../network/proxy-manager.ts'
import { WorkspaceService } from './workspace-service.ts'
import { DownloadTaskManager } from '../tasks/download-manager.ts'
import { LanTransferService } from './lan-transfer-service.ts'
import { AppTrayManager } from '../tray.ts'
import { AppUpdateService } from './app-update-service.ts'
import { ConfigBackupCrypto } from './config-backup-crypto.ts'
import type { SambaProfile } from '@doujiao/plugin-sdk'

export interface CryptoMetadata {
  algorithm: 'AES-256-GCM'
  kdf: 'PBKDF2'
  iterations: number
  salt: string
  iv: string
  tag: string
}

export interface BackupFileStructure {
  magic: 'DOUJIAO_BACKUP'
  version: number
  exportedAt: string
  appVersion: string
  encrypted: boolean
  crypto: CryptoMetadata
  summary: {
    sambaCount: number
    objectStorageCount: number
    hasProxy: boolean
    hasWorkspaces: boolean
    hasLanTransfer: boolean
    hasAppPrefs: boolean
  }
  payload: string // hex ciphertext
}

export interface ExportModulesSelection {
  samba?: boolean
  objectStorage?: boolean
  proxy?: boolean
  workspaces?: boolean
  lanTransfer?: boolean
  appPrefs?: boolean
}

export interface AppPreferencesPayload {
  theme?: string
  pinnedPluginIds?: string[]
  sidebarCollapsed?: boolean
  autoStart?: boolean
  autoCheckUpdate?: boolean
}

export interface DecryptedBackupPayload {
  samba?: SambaProfile[]
  objectStorage?: ObjectStorageProfile[]
  proxy?: NetworkProxyConfig
  workspaces?: {
    downloads?: string
    notepad?: string
    markdown?: string
  }
  lanTransfer?: {
    authEnabled?: boolean
    authPin?: string
    autoPinInQr?: boolean
    saveDirectory?: string
  }
  appPrefs?: AppPreferencesPayload
}

export interface InspectBackupResult {
  valid: boolean
  encrypted: boolean
  exportedAt?: string
  appVersion?: string
  summary?: BackupFileStructure['summary']
  error?: string
  decryptedData?: DecryptedBackupPayload
}

export interface ImportOptions {
  mode: 'merge' | 'overwrite'
  modules: ExportModulesSelection
}

export interface ImportResult {
  success: boolean
  importedModules: string[]
  details: {
    sambaCount?: number
    objectStorageCount?: number
    proxyApplied?: boolean
    workspacesApplied?: boolean
    lanTransferApplied?: boolean
    appPrefs?: AppPreferencesPayload
  }
  error?: string
}

export class ConfigBackupService {
  private static instance: ConfigBackupService

  private constructor() {}

  public static getInstance(): ConfigBackupService {
    if (!ConfigBackupService.instance) {
      ConfigBackupService.instance = new ConfigBackupService()
    }
    return ConfigBackupService.instance
  }

  // --- 加密与密钥派生 (委托 ConfigBackupCrypto 纯函数执行) ---

  public static deriveKey(password: string, salt: Buffer, iterations = 100_000): Buffer {
    return ConfigBackupCrypto.deriveKey(password, salt, iterations)
  }

  public static encryptPayload(data: any, password: string): { payload: string; crypto: CryptoMetadata } {
    return ConfigBackupCrypto.encryptPayload(data, password)
  }

  public static decryptPayload(encryptedHex: string, password: string, meta: CryptoMetadata): any {
    return ConfigBackupCrypto.decryptPayload(encryptedHex, password, meta)
  }

  // --- 导出逻辑 ---

  public async generateExportData(
    password: string,
    modules: ExportModulesSelection = {},
    rendererAppPrefs?: AppPreferencesPayload
  ): Promise<BackupFileStructure> {
    const payload: DecryptedBackupPayload = {}
    const summary = {
      sambaCount: 0,
      objectStorageCount: 0,
      hasProxy: false,
      hasWorkspaces: false,
      hasLanTransfer: false,
      hasAppPrefs: false
    }

    // 1. Samba 配置 (包含主机、端口、用户名、密码)
    if (modules.samba !== false) {
      const sambaProfiles = await SambaService.getInstance().getProfiles()
      payload.samba = sambaProfiles
      summary.sambaCount = sambaProfiles.length
    }

    // 2. 对象存储配置 (包含 S3/OSS/COS/MinIO 密钥)
    if (modules.objectStorage !== false) {
      const objProfiles = await ObjectStorageService.getInstance().getProfiles()
      payload.objectStorage = objProfiles
      summary.objectStorageCount = objProfiles.length
    }

    // 3. 网络代理配置
    if (modules.proxy !== false) {
      const proxyStatus = await ProxyManager.getInstance().getStatus()
      payload.proxy = {
        mode: proxyStatus.mode,
        customProxyUrl: proxyStatus.customProxyUrl,
        bypassRules: proxyStatus.bypassRules
      }
      summary.hasProxy = true
    }

    // 4. 工作目录配置
    if (modules.workspaces !== false) {
      const ws = WorkspaceService.getInstance()
      const tm = DownloadTaskManager.getInstance()
      payload.workspaces = {
        downloads: tm.getDownloadDir(),
        notepad: ws.getDirectory('notepad'),
        markdown: ws.getDirectory('markdown-editor')
      }
      summary.hasWorkspaces = true
    }

    // 5. 局域网互传设置
    if (modules.lanTransfer !== false) {
      const lan = LanTransferService.getInstance()
      const status = await lan.getStatus()
      payload.lanTransfer = {
        authEnabled: status.authEnabled,
        authPin: status.authPin,
        autoPinInQr: status.autoPinInQr,
        saveDirectory: status.saveDirectory
      }
      summary.hasLanTransfer = true
    }

    // 6. 应用通用偏好
    if (modules.appPrefs !== false) {
      const autoStart = AppTrayManager.getInstance().getAutoStart()
      const updateConfig = AppUpdateService.getInstance().getConfig()
      payload.appPrefs = {
        autoStart,
        autoCheckUpdate: updateConfig.autoCheck,
        ...(rendererAppPrefs || {})
      }
      summary.hasAppPrefs = true
    }

    // 执行强加密
    const encrypted = ConfigBackupService.encryptPayload(payload, password)

    return {
      magic: 'DOUJIAO_BACKUP',
      version: 1,
      exportedAt: new Date().toISOString(),
      appVersion: app.getVersion() || '1.0.0',
      encrypted: true,
      crypto: encrypted.crypto,
      summary,
      payload: encrypted.payload
    }
  }

  /**
   * 写入备份文件到目标路径
   */
  public async exportToFile(
    targetPath: string,
    password: string,
    modules: ExportModulesSelection = {},
    rendererAppPrefs?: AppPreferencesPayload
  ): Promise<string> {
    const backupData = await this.generateExportData(password, modules, rendererAppPrefs)
    await fs.promises.writeFile(targetPath, JSON.stringify(backupData, null, 2), 'utf8')
    return targetPath
  }

  // --- 检查与预览备份文件 ---

  public async inspectBackupFile(filePath: string, password?: string): Promise<InspectBackupResult> {
    try {
      if (!fs.existsSync(filePath)) {
        return { valid: false, encrypted: false, error: '文件不存在' }
      }
      const raw = await fs.promises.readFile(filePath, 'utf8')
      const parsed: BackupFileStructure = JSON.parse(raw)

      if (parsed.magic !== 'DOUJIAO_BACKUP' || !parsed.crypto || !parsed.payload) {
        return { valid: false, encrypted: false, error: '无效的豆角备份文件格式' }
      }

      const res: InspectBackupResult = {
        valid: true,
        encrypted: true,
        exportedAt: parsed.exportedAt,
        appVersion: parsed.appVersion,
        summary: parsed.summary
      }

      if (password) {
        try {
          const decrypted = ConfigBackupService.decryptPayload(parsed.payload, password, parsed.crypto)
          res.decryptedData = decrypted
        } catch (err: any) {
          res.error = err.message || '密码错误或备份文件已被篡改'
        }
      }

      return res
    } catch (err: any) {
      return { valid: false, encrypted: false, error: err.message || '读取备份文件失败' }
    }
  }

  // --- 执行配置导入 ---

  public async importFromFile(
    filePath: string,
    password: string,
    options: ImportOptions
  ): Promise<ImportResult> {
    const inspect = await this.inspectBackupFile(filePath, password)
    if (!inspect.valid || !inspect.decryptedData) {
      return {
        success: false,
        importedModules: [],
        details: {},
        error: inspect.error || '无法解密备份文件'
      }
    }

    const data = inspect.decryptedData
    const importedModules: string[] = []
    const details: ImportResult['details'] = {}
    const isOverwrite = options.mode === 'overwrite'

    // 1. 恢复 Samba 配置
    if (options.modules.samba !== false && data.samba && Array.isArray(data.samba)) {
      const sambaSvc = SambaService.getInstance()
      if (isOverwrite) {
        await sambaSvc.saveProfiles(data.samba)
        details.sambaCount = data.samba.length
      } else {
        const existing = await sambaSvc.getProfiles()
        const mergedMap = new Map<string, SambaProfile>()
        for (const p of existing) mergedMap.set(p.id, p)
        for (const p of data.samba) mergedMap.set(p.id, p)
        const mergedList = Array.from(mergedMap.values())
        await sambaSvc.saveProfiles(mergedList)
        details.sambaCount = mergedList.length
      }
      importedModules.push('samba')
    }

    // 2. 恢复对象存储配置
    if (options.modules.objectStorage !== false && data.objectStorage && Array.isArray(data.objectStorage)) {
      const objSvc = ObjectStorageService.getInstance()
      if (isOverwrite) {
        await objSvc.saveProfiles(data.objectStorage)
        details.objectStorageCount = data.objectStorage.length
      } else {
        const existing = await objSvc.getProfiles()
        const mergedMap = new Map<string, ObjectStorageProfile>()
        for (const p of existing) mergedMap.set(p.id, p)
        for (const p of data.objectStorage) mergedMap.set(p.id, p)
        const mergedList = Array.from(mergedMap.values())
        await objSvc.saveProfiles(mergedList)
        details.objectStorageCount = mergedList.length
      }
      importedModules.push('objectStorage')
    }

    // 3. 恢复网络代理配置
    if (options.modules.proxy !== false && data.proxy) {
      await ProxyManager.getInstance().setConfig(data.proxy)
      details.proxyApplied = true
      importedModules.push('proxy')
    }

    // 4. 恢复工作目录
    if (options.modules.workspaces !== false && data.workspaces) {
      const ws = WorkspaceService.getInstance()
      const tm = DownloadTaskManager.getInstance()
      if (data.workspaces.downloads) tm.setDownloadDir(data.workspaces.downloads)
      if (data.workspaces.notepad) ws.setDirectory('notepad', data.workspaces.notepad)
      if (data.workspaces.markdown) ws.setDirectory('markdown-editor', data.workspaces.markdown)
      details.workspacesApplied = true
      importedModules.push('workspaces')
    }

    // 5. 恢复局域网互传设置
    if (options.modules.lanTransfer !== false && data.lanTransfer) {
      const lan = LanTransferService.getInstance()
      if (typeof data.lanTransfer.authEnabled === 'boolean') {
        await lan.setAuthEnabled(data.lanTransfer.authEnabled)
      }
      if (typeof data.lanTransfer.autoPinInQr === 'boolean') {
        await lan.setAutoPinInQr(data.lanTransfer.autoPinInQr)
      }
      if (data.lanTransfer.saveDirectory) {
        await lan.setSaveDirectory(data.lanTransfer.saveDirectory)
      }
      details.lanTransferApplied = true
      importedModules.push('lanTransfer')
    }

    // 6. 应用偏好
    if (options.modules.appPrefs !== false && data.appPrefs) {
      if (typeof data.appPrefs.autoStart === 'boolean') {
        AppTrayManager.getInstance().updateAutoStart(data.appPrefs.autoStart)
      }
      if (typeof data.appPrefs.autoCheckUpdate === 'boolean') {
        await AppUpdateService.getInstance().setConfig({ autoCheck: data.appPrefs.autoCheckUpdate })
      }
      details.appPrefs = data.appPrefs
      importedModules.push('appPrefs')
    }

    return {
      success: true,
      importedModules,
      details
    }
  }
}
