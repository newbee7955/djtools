import { ipcMain, net } from 'electron'
import { PluginViewContainerManager } from '../container/plugin-view'
import { DownloadTaskManager } from '../tasks/download-manager'
import {
  getDynamicTtwid,
  getDouyinCookie,
  getDouyinLoginStatus,
  openDouyinLoginWindow
} from '../auth/douyin-auth'
import { ClipboardHistoryService } from '../services/clipboard-service'
import { SambaService } from '../services/samba-service'
import { LanTransferService } from '../services/lan-transfer-service'
import { WorkspaceService } from '../services/workspace-service'
import type { NetworkRequestOptions, DownloadTaskRequest } from '@doujiao/plugin-sdk'

/**
 * 注册插件沙箱受控 IPC 通信桥
 * 强校验 event.sender 来源身份，彻底杜绝伪造 pluginId 越权
 */
export function registerPluginIpcBridge(): void {
  const containerManager = PluginViewContainerManager.getInstance()
  const taskManager = DownloadTaskManager.getInstance()

  // 1. 受控网络请求代理
  ipcMain.handle('plugin:network:request', async (event, options: NetworkRequestOptions) => {
    const pluginId = containerManager.getPluginIdByWebContentsId(event.sender.id)
    if (!pluginId) {
      throw new Error('[Security] 未经授权的调用来源：非沙箱插件容器')
    }

    try {
      const { url, method = 'GET', headers = {}, body, timeout = 60000 } = options

      const reqHeaders: Record<string, string> = {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        ...headers
      }

      // 如果请求发往抖音生态，由宿主自动附加受控 ttwid 与安全登录凭据
      if (url.includes('douyin.com') || url.includes('douyinvod.com') || url.includes('amemv.com')) {
        const ttwid = await getDynamicTtwid()
        const userCookie = getDouyinCookie()
        const cookieParts: string[] = []

        if (ttwid) cookieParts.push(`ttwid=${ttwid}`)
        if (userCookie) cookieParts.push(userCookie)
        if (reqHeaders['Cookie']) cookieParts.push(reqHeaders['Cookie'])

        if (cookieParts.length > 0) {
          reqHeaders['Cookie'] = cookieParts.join('; ')
        }
        if (!reqHeaders['Referer']) {
          reqHeaders['Referer'] = 'https://www.douyin.com/'
        }
        if (!reqHeaders['Accept']) {
          reqHeaders['Accept'] = 'application/json, text/plain, */*'
        }
      }

      // 过滤 Chromium net.fetch 禁用的保留请求头，避免触发 net::ERR_INVALID_ARGUMENT
      const forbiddenHeaders = ['host', 'connection', 'keep-alive', 'upgrade', 'transfer-encoding', 'content-length']
      for (const k of Object.keys(reqHeaders)) {
        if (forbiddenHeaders.includes(k.toLowerCase())) {
          delete reqHeaders[k]
        }
      }

      const upperMethod = (method || 'GET').toUpperCase()
      const isBodyAllowed = !['GET', 'HEAD'].includes(upperMethod)
      let reqBody: any = undefined
      if (isBodyAllowed && body !== undefined) {
        if (Buffer.isBuffer(body)) {
          reqBody = body
        } else if (ArrayBuffer.isView(body)) {
          reqBody = Buffer.from(body.buffer, body.byteOffset, body.byteLength)
        } else if (body instanceof ArrayBuffer) {
          reqBody = Buffer.from(body)
        } else if (typeof body === 'object' && body !== null) {
          reqBody = JSON.stringify(body)
        } else {
          reqBody = body
        }
      }

      const response = await net.fetch(url, {
        method: upperMethod,
        headers: reqHeaders,
        body: reqBody,
        signal: AbortSignal.timeout(timeout)
      })

      const contentType = response.headers.get('content-type') || ''
      let data: any
      if (contentType.includes('application/json')) {
        data = await response.json()
      } else {
        data = await response.text()
      }

      const resHeaders: Record<string, string> = {}
      response.headers.forEach((val, key) => {
        resHeaders[key] = val
      })

      return {
        status: response.status,
        statusText: response.statusText,
        headers: resHeaders,
        data
      }
    } catch (err: any) {
      console.error(`[PluginBridge:${pluginId}] 网络代理请求失败:`, err)
      throw new Error(`网络请求失败: ${err?.message}`)
    }
  })

  // 2. 隔离登录请求
  ipcMain.handle('plugin:auth:request-login', async (event, domain: string) => {
    const pluginId = containerManager.getPluginIdByWebContentsId(event.sender.id)
    if (!pluginId) {
      throw new Error('[Security] 未经授权的调用来源')
    }
    if (domain.includes('douyin.com')) {
      return await openDouyinLoginWindow()
    }
    return { success: false, message: `暂不支持该域名的登录: ${domain}` }
  })

  // 3. 登录状态查询
  ipcMain.handle('plugin:auth:get-status', async (event, domain: string) => {
    const pluginId = containerManager.getPluginIdByWebContentsId(event.sender.id)
    if (!pluginId) {
      throw new Error('[Security] 未经授权的调用来源')
    }
    if (domain.includes('douyin.com')) {
      return getDouyinLoginStatus()
    }
    return { loggedIn: false }
  })

  // 2. 受控推入下载任务
  ipcMain.handle('plugin:download:enqueue', async (event, taskReq: DownloadTaskRequest) => {
    const pluginId = containerManager.getPluginIdByWebContentsId(event.sender.id)
    if (!pluginId) {
      throw new Error('[Security] 未经授权的调用来源')
    }

    const taskId = await taskManager.enqueue(taskReq, pluginId)
    return { taskId }
  })

  // 3. 打开下载目录
  ipcMain.handle('plugin:download:open-dir', async (event) => {
    const pluginId = containerManager.getPluginIdByWebContentsId(event.sender.id)
    if (!pluginId) throw new Error('[Security] 未经授权的调用来源')
    taskManager.openSaveDirectory()
  })

  // 5. 媒体处理：查询 FFmpeg 状态
  ipcMain.handle('plugin:media:check-ffmpeg', async (event) => {
    const pluginId = containerManager.getPluginIdByWebContentsId(event.sender.id)
    if (!pluginId) throw new Error('[Security] 未经授权的调用来源')
    const { FFmpegManager } = await import('../media/ffmpeg-manager')
    return await FFmpegManager.getInstance().getStatus()
  })

  // 6. 媒体处理：受控音视频混流 (需要 media.merge 权限)
  ipcMain.handle(
    'plugin:media:merge',
    async (
      event,
      options: { videoPath: string; audioPath: string; outputPath: string }
    ) => {
      const pluginId = containerManager.getPluginIdByWebContentsId(event.sender.id)
      if (!pluginId) throw new Error('[Security] 未经授权的调用来源')

      const { PluginManager } = await import('../plugins/plugin-manager')
      const plugin = PluginManager.getInstance().getPlugin(pluginId)
      const hasPermission = plugin?.manifest?.permissions?.some(
        (p: any) => p.capability === 'media.merge'
      )
      if (!hasPermission) {
        throw new Error(
          `[Security] 插件 ${pluginId} 未在 manifest.json 中声明 media.merge 权限，拒绝调用`
        )
      }

      const { FFmpegManager } = await import('../media/ffmpeg-manager')
      return await FFmpegManager.getInstance().mergeMedia(
        options.videoPath,
        options.audioPath,
        options.outputPath
      )
    }
  )

  // 7. 监听下载进度（向当前沙箱转发本插件相关的任务进度）
  taskManager.subscribe((info) => {
    eventBroadcast(info)
  })

  function eventBroadcast(info: any) {
    for (const [, instance] of (containerManager as any).views.entries()) {
      if (instance.isAttached && !instance.view.webContents.isDestroyed()) {
        instance.view.webContents.send('plugin:download:progress', info)
      }
    }
  }

  // 8. 剪贴板历史服务受控 IPC
  const clipboardService = ClipboardHistoryService.getInstance()

  ipcMain.handle('plugin:clipboard:get-history', async (event) => {
    const pluginId = containerManager.getPluginIdByWebContentsId(event.sender.id)
    if (!pluginId) throw new Error('[Security] 未经授权的调用来源')
    return clipboardService.getHistory()
  })

  ipcMain.handle('plugin:clipboard:write-text', async (event, text: string) => {
    const pluginId = containerManager.getPluginIdByWebContentsId(event.sender.id)
    if (!pluginId) throw new Error('[Security] 未经授权的调用来源')
    return clipboardService.writeText(text)
  })

  ipcMain.handle('plugin:clipboard:write-image', async (event, dataUrl: string) => {
    const pluginId = containerManager.getPluginIdByWebContentsId(event.sender.id)
    if (!pluginId) throw new Error('[Security] 未经授权的调用来源')
    return clipboardService.writeImage(dataUrl)
  })

  ipcMain.handle('plugin:clipboard:delete', async (event, id: string) => {
    const pluginId = containerManager.getPluginIdByWebContentsId(event.sender.id)
    if (!pluginId) throw new Error('[Security] 未经授权的调用来源')
    return clipboardService.deleteItem(id)
  })

  ipcMain.handle('plugin:clipboard:clear', async (event) => {
    const pluginId = containerManager.getPluginIdByWebContentsId(event.sender.id)
    if (!pluginId) throw new Error('[Security] 未经授权的调用来源')
    return clipboardService.clearHistory()
  })

  ipcMain.handle('plugin:clipboard:toggle-pin', async (event, id: string) => {
    const pluginId = containerManager.getPluginIdByWebContentsId(event.sender.id)
    if (!pluginId) throw new Error('[Security] 未经授权的调用来源')
    return clipboardService.togglePin(id)
  })

  clipboardService.on('changed', (items) => {
    for (const [, instance] of (containerManager as any).views.entries()) {
      if (instance.view?.webContents && !instance.view.webContents.isDestroyed()) {
        instance.view.webContents.send('plugin:clipboard:changed', items)
      }
    }
  })

  // ==========================================
  // 8. Samba 文件系统管理能力 (需要 samba.client 权限)
  // ==========================================
  const sambaService = SambaService.getInstance()

  const checkSambaPermission = async (senderId: number): Promise<string> => {
    const pluginId = containerManager.getPluginIdByWebContentsId(senderId)
    if (!pluginId) throw new Error('[Security] 未经授权的调用来源')
    const { PluginManager } = await import('../plugins/plugin-manager')
    const plugin = PluginManager.getInstance().getPlugin(pluginId)
    const hasPermission = plugin?.manifest?.permissions?.some(
      (p: any) => p.capability === 'samba.client'
    )
    if (!hasPermission) {
      throw new Error(`[Security] 插件 ${pluginId} 未在 manifest.json 中声明 samba.client 权限，拒绝调用`)
    }
    return pluginId
  }

  ipcMain.handle('plugin:samba:get-profiles', async (event) => {
    await checkSambaPermission(event.sender.id)
    return sambaService.getProfiles()
  })

  ipcMain.handle('plugin:samba:save-profile', async (event, profile: any) => {
    await checkSambaPermission(event.sender.id)
    return sambaService.saveProfile(profile)
  })

  ipcMain.handle('plugin:samba:delete-profile', async (event, id: string) => {
    await checkSambaPermission(event.sender.id)
    return sambaService.deleteProfile(id)
  })

  ipcMain.handle('plugin:samba:test-connection', async (event, config: any) => {
    await checkSambaPermission(event.sender.id)
    return sambaService.testConnection(config)
  })

  ipcMain.handle('plugin:samba:connect', async (event, profileId: string) => {
    await checkSambaPermission(event.sender.id)
    return sambaService.connect(profileId)
  })

  ipcMain.handle('plugin:samba:disconnect', async (event, profileId: string) => {
    await checkSambaPermission(event.sender.id)
    return sambaService.disconnect(profileId)
  })

  ipcMain.handle('plugin:samba:list-directory', async (event, profileId: string, path: string) => {
    await checkSambaPermission(event.sender.id)
    return sambaService.listDirectory(profileId, path)
  })

  ipcMain.handle('plugin:samba:create-directory', async (event, profileId: string, path: string) => {
    await checkSambaPermission(event.sender.id)
    return sambaService.createDirectory(profileId, path)
  })

  ipcMain.handle('plugin:samba:delete-item', async (event, profileId: string, path: string, isDirectory: boolean) => {
    await checkSambaPermission(event.sender.id)
    return sambaService.deleteItem(profileId, path, isDirectory)
  })

  ipcMain.handle('plugin:samba:rename-item', async (event, profileId: string, oldPath: string, newPath: string) => {
    await checkSambaPermission(event.sender.id)
    return sambaService.renameItem(profileId, oldPath, newPath)
  })

  ipcMain.handle('plugin:samba:read-file-text', async (event, profileId: string, path: string, maxBytes?: number) => {
    await checkSambaPermission(event.sender.id)
    return sambaService.readFileText(profileId, path, maxBytes)
  })

  ipcMain.handle('plugin:samba:get-thumbnail', async (event, profileId: string, path: string, mimeType: string, size: number) => {
    await checkSambaPermission(event.sender.id)
    return sambaService.getThumbnail(profileId, path, mimeType, size)
  })

  ipcMain.handle('plugin:samba:upload-file', async (event, profileId: string, localFilePath: string, remoteDirectory: string) => {
    await checkSambaPermission(event.sender.id)
    return sambaService.uploadFile(profileId, localFilePath, remoteDirectory)
  })

  ipcMain.handle('plugin:samba:download-file', async (event, profileId: string, remoteFilePath: string, localSavePath?: string) => {
    await checkSambaPermission(event.sender.id)
    return sambaService.downloadFile(profileId, remoteFilePath, localSavePath)
  })

  ipcMain.handle('plugin:samba:get-stream-url', async (event, profileId: string, path: string) => {
    await checkSambaPermission(event.sender.id)
    return sambaService.getFileStreamUrl(profileId, path)
  })

  ipcMain.handle('plugin:samba:save-thumbnail-cache', async (event, profileId: string, path: string, size: number, dataUrl: string) => {
    await checkSambaPermission(event.sender.id)
    return sambaService.saveThumbnailCache(profileId, path, size, dataUrl)
  })

  ipcMain.handle('plugin:samba:select-local-file', async (event) => {
    await checkSambaPermission(event.sender.id)
    return sambaService.selectLocalFile()
  })

  ipcMain.handle('plugin:samba:select-local-directory', async (event) => {
    await checkSambaPermission(event.sender.id)
    return sambaService.selectLocalDirectory()
  })

  sambaService.onProgress((progress) => {
    for (const [, instance] of (containerManager as any).views.entries()) {
      if (instance.isAttached && !instance.view.webContents.isDestroyed()) {
        instance.view.webContents.send('plugin:samba:transfer-progress', progress)
      }
    }
  })

  // ==========================================
  // 9. 局域网跨设备互传能力 (需要 lan.transfer 权限)
  // ==========================================
  const lanService = LanTransferService.getInstance()

  const checkLanPermission = async (senderId: number): Promise<string> => {
    const pluginId = containerManager.getPluginIdByWebContentsId(senderId)
    if (!pluginId) throw new Error('[Security] 未经授权的调用来源')
    const { PluginManager } = await import('../plugins/plugin-manager')
    const plugin = PluginManager.getInstance().getPlugin(pluginId)
    const hasPermission = plugin?.manifest?.permissions?.some(
      (p: any) => p.capability === 'lan.transfer'
    )
    if (!hasPermission) {
      throw new Error(`[Security] 插件 ${pluginId} 未在 manifest.json 中声明 lan.transfer 权限，拒绝调用`)
    }
    return pluginId
  }

  ipcMain.handle('plugin:lan:start-server', async (event, options?: any) => {
    await checkLanPermission(event.sender.id)
    return lanService.startServer(options)
  })

  ipcMain.handle('plugin:lan:stop-server', async (event) => {
    await checkLanPermission(event.sender.id)
    return lanService.stopServer()
  })

  ipcMain.handle('plugin:lan:get-status', async (event) => {
    await checkLanPermission(event.sender.id)
    return lanService.getStatus()
  })

  ipcMain.handle('plugin:lan:switch-ip', async (event, ip: string) => {
    await checkLanPermission(event.sender.id)
    return lanService.switchIp(ip)
  })

  ipcMain.handle('plugin:lan:set-auth-enabled', async (event, enabled: boolean) => {
    await checkLanPermission(event.sender.id)
    return lanService.setAuthEnabled(enabled)
  })

  ipcMain.handle('plugin:lan:refresh-pin', async (event) => {
    await checkLanPermission(event.sender.id)
    return lanService.refreshPin()
  })

  ipcMain.handle('plugin:lan:set-auto-pin-in-qr', async (event, enabled: boolean) => {
    await checkLanPermission(event.sender.id)
    return lanService.setAutoPinInQr(enabled)
  })

  ipcMain.handle('plugin:lan:add-share-files', async (event, filePaths: string[]) => {
    await checkLanPermission(event.sender.id)
    return lanService.addShareFiles(filePaths)
  })

  ipcMain.handle('plugin:lan:remove-share-file', async (event, id: string) => {
    await checkLanPermission(event.sender.id)
    return lanService.removeShareFile(id)
  })

  ipcMain.handle('plugin:lan:get-share-files', async (event) => {
    await checkLanPermission(event.sender.id)
    return lanService.getShareFiles()
  })

  ipcMain.handle('plugin:lan:get-received-files', async (event) => {
    await checkLanPermission(event.sender.id)
    return lanService.getReceivedFiles()
  })

  ipcMain.handle('plugin:lan:delete-received-file', async (event, id: string) => {
    await checkLanPermission(event.sender.id)
    return lanService.deleteReceivedFile(id)
  })

  ipcMain.handle('plugin:lan:open-file', async (event, localPath: string) => {
    await checkLanPermission(event.sender.id)
    return lanService.openFile(localPath)
  })

  ipcMain.handle('plugin:lan:show-item-in-folder', async (event, localPath: string) => {
    await checkLanPermission(event.sender.id)
    return lanService.showItemInFolder(localPath)
  })

  ipcMain.handle('plugin:lan:select-files-to-send', async (event) => {
    await checkLanPermission(event.sender.id)
    return lanService.selectFilesToSend()
  })

  ipcMain.handle('plugin:lan:select-save-directory', async (event) => {
    await checkLanPermission(event.sender.id)
    return lanService.selectSaveDirectory()
  })

  ipcMain.handle('plugin:lan:open-save-directory', async (event) => {
    await checkLanPermission(event.sender.id)
    return lanService.openSaveDirectory()
  })

  ipcMain.handle('plugin:lan:send-text-message', async (event, text: string) => {
    await checkLanPermission(event.sender.id)
    return lanService.sendTextMessage(text)
  })

  ipcMain.handle('plugin:lan:get-messages', async (event) => {
    await checkLanPermission(event.sender.id)
    return lanService.getMessages()
  })

  ipcMain.handle('plugin:lan:clear-messages', async (event) => {
    await checkLanPermission(event.sender.id)
    return lanService.clearMessages()
  })

  lanService.on('lan-event', (event) => {
    for (const [, instance] of (containerManager as any).views.entries()) {
      if (instance.isAttached && !instance.view.webContents.isDestroyed()) {
        instance.view.webContents.send('plugin:lan:event', event)
      }
    }
  })

  // ==========================================
  // 10. 本地工作目录与持久化文件管理 (独立外部存储，防卸载丢失)
  // ==========================================
  const workspaceService = WorkspaceService.getInstance()

  const getVerifiedScope = (senderId: number, requestedScope?: string): string => {
    const pluginId = containerManager.getPluginIdByWebContentsId(senderId)
    if (!pluginId) throw new Error('[Security] 未经授权的调用来源')
    return requestedScope && requestedScope.trim() ? requestedScope.trim() : pluginId
  }

  ipcMain.handle('plugin:workspace:get-directory', async (event, scope?: string) => {
    const effectiveScope = getVerifiedScope(event.sender.id, scope)
    return workspaceService.getDirectory(effectiveScope)
  })

  ipcMain.handle('plugin:workspace:set-directory', async (event, directory: string, scope?: string) => {
    const effectiveScope = getVerifiedScope(event.sender.id, scope)
    return workspaceService.setDirectory(effectiveScope, directory)
  })

  ipcMain.handle('plugin:workspace:select-directory', async (event, defaultPath?: string) => {
    getVerifiedScope(event.sender.id)
    return workspaceService.selectDirectory(defaultPath)
  })

  ipcMain.handle('plugin:workspace:list-files', async (event, scope?: string, extensions?: string[], subPath?: string, recursive?: boolean) => {
    const effectiveScope = getVerifiedScope(event.sender.id, scope)
    return workspaceService.listFiles(effectiveScope, extensions, subPath, recursive)
  })

  ipcMain.handle('plugin:workspace:read-file', async (event, relativePath: string, scope?: string) => {
    const effectiveScope = getVerifiedScope(event.sender.id, scope)
    return workspaceService.readFile(effectiveScope, relativePath)
  })

  ipcMain.handle('plugin:workspace:write-file', async (event, relativePath: string, content: string, scope?: string) => {
    const effectiveScope = getVerifiedScope(event.sender.id, scope)
    return workspaceService.writeFile(effectiveScope, relativePath, content)
  })

  ipcMain.handle('plugin:workspace:delete-file', async (event, relativePath: string, scope?: string) => {
    const effectiveScope = getVerifiedScope(event.sender.id, scope)
    return workspaceService.deleteFile(effectiveScope, relativePath)
  })

  ipcMain.handle('plugin:workspace:rename-file', async (event, oldName: string, newName: string, scope?: string) => {
    const effectiveScope = getVerifiedScope(event.sender.id, scope)
    return workspaceService.renameFile(effectiveScope, oldName, newName)
  })

  ipcMain.handle('plugin:workspace:create-directory', async (event, relativePath: string, scope?: string) => {
    const effectiveScope = getVerifiedScope(event.sender.id, scope)
    return workspaceService.createDirectory(effectiveScope, relativePath)
  })

  ipcMain.handle('plugin:workspace:open-directory', async (event, scope?: string) => {
    const effectiveScope = getVerifiedScope(event.sender.id, scope)
    return workspaceService.openDirectory(effectiveScope)
  })

  ipcMain.handle('plugin:workspace:reset-directory', async (event, scope?: string) => {
    const effectiveScope = getVerifiedScope(event.sender.id, scope)
    return workspaceService.resetDirectory(effectiveScope)
  })

  ipcMain.handle(
    'plugin:workspace:save-file-as',
    async (event, content: string, defaultName?: string, extensions?: string[]) => {
      getVerifiedScope(event.sender.id)
      return workspaceService.saveFileAs(content, defaultName, extensions)
    }
  )

  ipcMain.handle('plugin:workspace:select-file-to-open', async (event, extensions?: string[]) => {
    getVerifiedScope(event.sender.id)
    return workspaceService.selectFileToOpen(extensions)
  })

  // 13. 工作区时间轴历史快照 (Local History)
  ipcMain.handle(
    'plugin:workspace:history:save',
    async (event, relativePath: string, content: string, type?: 'auto' | 'milestone', label?: string, scope?: string) => {
      const effectiveScope = getVerifiedScope(event.sender.id, scope)
      return workspaceService.saveSnapshot(effectiveScope, relativePath, content, type, label)
    }
  )

  ipcMain.handle('plugin:workspace:history:list', async (event, relativePath: string, scope?: string) => {
    const effectiveScope = getVerifiedScope(event.sender.id, scope)
    return workspaceService.listSnapshots(effectiveScope, relativePath)
  })

  ipcMain.handle('plugin:workspace:history:get', async (event, relativePath: string, snapshotId: string, scope?: string) => {
    const effectiveScope = getVerifiedScope(event.sender.id, scope)
    return workspaceService.getSnapshot(effectiveScope, relativePath, snapshotId)
  })

  ipcMain.handle('plugin:workspace:history:delete', async (event, relativePath: string, snapshotId: string, scope?: string) => {
    const effectiveScope = getVerifiedScope(event.sender.id, scope)
    return workspaceService.deleteSnapshot(effectiveScope, relativePath, snapshotId)
  })

  // 14. 工作区专业 Git 版本控制 (Git Version Control)
  ipcMain.handle('plugin:workspace:git:status', async (event, scope?: string) => {
    const effectiveScope = getVerifiedScope(event.sender.id, scope)
    return workspaceService.gitStatus(effectiveScope)
  })

  ipcMain.handle('plugin:workspace:git:init', async (event, scope?: string) => {
    const effectiveScope = getVerifiedScope(event.sender.id, scope)
    return workspaceService.gitInit(effectiveScope)
  })

  ipcMain.handle('plugin:workspace:git:commit', async (event, message: string, files?: string[], scope?: string) => {
    const effectiveScope = getVerifiedScope(event.sender.id, scope)
    return workspaceService.gitCommit(effectiveScope, message, files)
  })

  ipcMain.handle('plugin:workspace:git:log', async (event, relativePath?: string, maxCount?: number, scope?: string) => {
    const effectiveScope = getVerifiedScope(event.sender.id, scope)
    return workspaceService.gitLog(effectiveScope, relativePath, maxCount)
  })

  ipcMain.handle('plugin:workspace:git:show', async (event, commitHash: string, relativePath: string, scope?: string) => {
    const effectiveScope = getVerifiedScope(event.sender.id, scope)
    return workspaceService.gitShowFile(effectiveScope, commitHash, relativePath)
  })

  ipcMain.handle('plugin:workspace:git:checkout', async (event, commitHash: string, relativePath: string, scope?: string) => {
    const effectiveScope = getVerifiedScope(event.sender.id, scope)
    return workspaceService.gitCheckout(effectiveScope, commitHash, relativePath)
  })
}

