import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  DoujiaoSDK,
  NetworkRequestOptions,
  DownloadTaskRequest,
  DownloadProgressInfo,
  PluginLifecycle,
  WorkspaceFileItem
} from '@doujiao/plugin-sdk'

let registeredLifecycle: PluginLifecycle | null = null

// 从沙箱自定义协议 URL (如 doujiao-plugin://<plugin-id>/index.html) 动态解析宿主分配的真实 pluginId
const currentPluginId =
  typeof globalThis !== 'undefined' && (globalThis as any).window?.location?.hostname
    ? (globalThis as any).window.location.hostname
    : 'plugin-sandbox'

const sdk: DoujiaoSDK = {
  version: '2.0.0',
  pluginId: currentPluginId,

  getPathForFile: (file: File) => {
    try {
      if (webUtils && typeof webUtils.getPathForFile === 'function') {
        return webUtils.getPathForFile(file)
      }
    } catch {}
    return (file as any)?.path || ''
  },

  workspace: {
    getDirectory: (scope?: string) => ipcRenderer.invoke('plugin:workspace:get-directory', scope),
    setDirectory: (directory: string, scope?: string) =>
      ipcRenderer.invoke('plugin:workspace:set-directory', directory, scope),
    selectDirectory: (defaultPath?: string) =>
      ipcRenderer.invoke('plugin:workspace:select-directory', defaultPath),
    listFiles: (scope?: string, extensions?: string[], subPath?: string, recursive?: boolean) =>
      ipcRenderer.invoke('plugin:workspace:list-files', scope, extensions, subPath, recursive),
    readFile: (relativePath: string, scope?: string) =>
      ipcRenderer.invoke('plugin:workspace:read-file', relativePath, scope),
    writeFile: (relativePath: string, content: string, scope?: string) =>
      ipcRenderer.invoke('plugin:workspace:write-file', relativePath, content, scope),
    deleteFile: (relativePath: string, scope?: string) =>
      ipcRenderer.invoke('plugin:workspace:delete-file', relativePath, scope),
    renameFile: (oldName: string, newName: string, scope?: string) =>
      ipcRenderer.invoke('plugin:workspace:rename-file', oldName, newName, scope),
    createDirectory: (relativePath: string, scope?: string) =>
      ipcRenderer.invoke('plugin:workspace:create-directory', relativePath, scope),
    openDirectory: (scope?: string) =>
      ipcRenderer.invoke('plugin:workspace:open-directory', scope),
    resetDirectory: (scope?: string) =>
      ipcRenderer.invoke('plugin:workspace:reset-directory', scope),
    saveFileAs: (content: string, defaultName?: string, extensions?: string[]) =>
      ipcRenderer.invoke('plugin:workspace:save-file-as', content, defaultName, extensions),
    selectFileToOpen: (extensions?: string[]) =>
      ipcRenderer.invoke('plugin:workspace:select-file-to-open', extensions),

    history: {
      saveSnapshot: (scope: string, relativePath: string, content: string, type?: 'auto' | 'milestone', label?: string) =>
        ipcRenderer.invoke('plugin:workspace:history:save', relativePath, content, type, label, scope),
      listSnapshots: (scope: string, relativePath: string) =>
        ipcRenderer.invoke('plugin:workspace:history:list', relativePath, scope),
      getSnapshot: (scope: string, relativePath: string, snapshotId: string) =>
        ipcRenderer.invoke('plugin:workspace:history:get', relativePath, snapshotId, scope),
      deleteSnapshot: (scope: string, relativePath: string, snapshotId: string) =>
        ipcRenderer.invoke('plugin:workspace:history:delete', relativePath, snapshotId, scope)
    },

    git: {
      getStatus: (scope: string) => ipcRenderer.invoke('plugin:workspace:git:status', scope),
      init: (scope: string) => ipcRenderer.invoke('plugin:workspace:git:init', scope),
      commit: (scope: string, message: string, files?: string[]) =>
        ipcRenderer.invoke('plugin:workspace:git:commit', message, files, scope),
      getLog: (scope: string, relativePath?: string, maxCount?: number) =>
        ipcRenderer.invoke('plugin:workspace:git:log', relativePath, maxCount, scope),
      showFile: (scope: string, commitHash: string, relativePath: string) =>
        ipcRenderer.invoke('plugin:workspace:git:show', commitHash, relativePath, scope),
      checkout: (scope: string, commitHash: string, relativePath: string) =>
        ipcRenderer.invoke('plugin:workspace:git:checkout', commitHash, relativePath, scope)
    }
  },

  network: {
    request: <T = any>(options: NetworkRequestOptions) => {
      return ipcRenderer.invoke('plugin:network:request', options) as Promise<{
        status: number;
        statusText: string;
        headers: Record<string, string>;
        data: T;
      }>
    }
  },

  download: {
    enqueue: (task: DownloadTaskRequest) => {
      return ipcRenderer.invoke('plugin:download:enqueue', task)
    },
    onProgress: (callback: (info: DownloadProgressInfo) => void) => {
      const handler = (_: any, info: DownloadProgressInfo) => {
        try {
          callback(info)
        } catch (err) {
          console.error('[DoujiaoSDK] 进度监听执行错误:', err)
        }
      }
      ipcRenderer.on('plugin:download:progress', handler)
      // 返回取消订阅函数 (避免重复监听或内存泄漏)
      return () => {
        ipcRenderer.removeListener('plugin:download:progress', handler)
      }
    },
    openSaveDirectory: () => {
      return ipcRenderer.invoke('plugin:download:open-dir')
    }
  },

  auth: {
    requestLogin: (domain: string) => {
      return ipcRenderer.invoke('plugin:auth:request-login', domain)
    },
    getStatus: (domain: string) => {
      return ipcRenderer.invoke('plugin:auth:get-status', domain)
    }
  },

  media: {
    merge: (options: { videoPath: string; audioPath: string; outputPath: string }) => {
      return ipcRenderer.invoke('plugin:media:merge', options)
    },
    checkFFmpeg: () => {
      return ipcRenderer.invoke('plugin:media:check-ffmpeg')
    }
  },

  clipboard: {
    getHistory: () => ipcRenderer.invoke('plugin:clipboard:get-history'),
    writeText: (text: string) => ipcRenderer.invoke('plugin:clipboard:write-text', text),
    writeImage: (dataUrl: string) => ipcRenderer.invoke('plugin:clipboard:write-image', dataUrl),
    deleteItem: (id: string) => ipcRenderer.invoke('plugin:clipboard:delete', id),
    clearHistory: () => ipcRenderer.invoke('plugin:clipboard:clear'),
    togglePin: (id: string) => ipcRenderer.invoke('plugin:clipboard:toggle-pin', id),
    onChanged: (callback: (items: any[]) => void) => {
      const handler = (_: any, items: any[]) => {
        try {
          callback(items)
        } catch (err) {
          console.error('[DoujiaoSDK] 剪贴板监听回调异常:', err)
        }
      }
      ipcRenderer.on('plugin:clipboard:changed', handler)
      return () => {
        ipcRenderer.removeListener('plugin:clipboard:changed', handler)
      }
    }
  },

  samba: {
    getProfiles: () => ipcRenderer.invoke('plugin:samba:get-profiles'),
    saveProfile: (profile: any) => ipcRenderer.invoke('plugin:samba:save-profile', profile),
    deleteProfile: (id: string) => ipcRenderer.invoke('plugin:samba:delete-profile', id),
    testConnection: (config: any) => ipcRenderer.invoke('plugin:samba:test-connection', config),
    connect: (profileId: string) => ipcRenderer.invoke('plugin:samba:connect', profileId),
    disconnect: (profileId: string) => ipcRenderer.invoke('plugin:samba:disconnect', profileId),
    listDirectory: (profileId: string, path: string) =>
      ipcRenderer.invoke('plugin:samba:list-directory', profileId, path),
    createDirectory: (profileId: string, path: string) =>
      ipcRenderer.invoke('plugin:samba:create-directory', profileId, path),
    deleteItem: (profileId: string, path: string, isDirectory: boolean) =>
      ipcRenderer.invoke('plugin:samba:delete-item', profileId, path, isDirectory),
    renameItem: (profileId: string, oldPath: string, newPath: string) =>
      ipcRenderer.invoke('plugin:samba:rename-item', profileId, oldPath, newPath),
    readFileText: (profileId: string, path: string, maxBytes?: number) =>
      ipcRenderer.invoke('plugin:samba:read-file-text', profileId, path, maxBytes),
    getThumbnail: (profileId: string, path: string, mimeType: string, size: number) =>
      ipcRenderer.invoke('plugin:samba:get-thumbnail', profileId, path, mimeType, size),
    uploadFile: (profileId: string, localFilePath: string, remoteDirectory: string) =>
      ipcRenderer.invoke('plugin:samba:upload-file', profileId, localFilePath, remoteDirectory),
    downloadFile: (profileId: string, remoteFilePath: string, localSavePath?: string) =>
      ipcRenderer.invoke('plugin:samba:download-file', profileId, remoteFilePath, localSavePath),
    getFileStreamUrl: (profileId: string, path: string) =>
      ipcRenderer.invoke('plugin:samba:get-stream-url', profileId, path),
    saveThumbnailCache: (profileId: string, path: string, size: number, dataUrl: string) =>
      ipcRenderer.invoke('plugin:samba:save-thumbnail-cache', profileId, path, size, dataUrl),
    selectLocalFile: () => ipcRenderer.invoke('plugin:samba:select-local-file'),
    selectLocalDirectory: () => ipcRenderer.invoke('plugin:samba:select-local-directory'),
    onTransferProgress: (callback: (progress: any) => void) => {
      const handler = (_: any, progress: any) => {
        try {
          callback(progress)
        } catch (err) {
          console.error('[DoujiaoSDK] Samba 传输进度回调异常:', err)
        }
      }
      ipcRenderer.on('plugin:samba:transfer-progress', handler)
      return () => {
        ipcRenderer.removeListener('plugin:samba:transfer-progress', handler)
      }
    }
  },

  lan: {
    startServer: (options?: any) => ipcRenderer.invoke('plugin:lan:start-server', options),
    stopServer: () => ipcRenderer.invoke('plugin:lan:stop-server'),
    getStatus: () => ipcRenderer.invoke('plugin:lan:get-status'),
    switchIp: (ip: string) => ipcRenderer.invoke('plugin:lan:switch-ip', ip),
    setAuthEnabled: (enabled: boolean) => ipcRenderer.invoke('plugin:lan:set-auth-enabled', enabled),
    refreshPin: () => ipcRenderer.invoke('plugin:lan:refresh-pin'),
    setAutoPinInQr: (enabled: boolean) => ipcRenderer.invoke('plugin:lan:set-auto-pin-in-qr', enabled),
    addShareFiles: (filePaths: string[]) => ipcRenderer.invoke('plugin:lan:add-share-files', filePaths),
    removeShareFile: (id: string) => ipcRenderer.invoke('plugin:lan:remove-share-file', id),
    getShareFiles: () => ipcRenderer.invoke('plugin:lan:get-share-files'),
    getReceivedFiles: () => ipcRenderer.invoke('plugin:lan:get-received-files'),
    deleteReceivedFile: (id: string) => ipcRenderer.invoke('plugin:lan:delete-received-file', id),
    openFile: (localPath: string) => ipcRenderer.invoke('plugin:lan:open-file', localPath),
    showItemInFolder: (localPath: string) => ipcRenderer.invoke('plugin:lan:show-item-in-folder', localPath),
    selectFilesToSend: () => ipcRenderer.invoke('plugin:lan:select-files-to-send'),
    selectSaveDirectory: () => ipcRenderer.invoke('plugin:lan:select-save-directory'),
    openSaveDirectory: () => ipcRenderer.invoke('plugin:lan:open-save-directory'),
    sendTextMessage: (text: string) => ipcRenderer.invoke('plugin:lan:send-text-message', text),
    getMessages: () => ipcRenderer.invoke('plugin:lan:get-messages'),
    clearMessages: () => ipcRenderer.invoke('plugin:lan:clear-messages'),
    onEvent: (callback: (event: any) => void) => {
      const handler = (_: any, event: any) => {
        try {
          callback(event)
        } catch (err) {
          console.error('[DoujiaoSDK] 局域网传输事件监听回调异常:', err)
        }
      }
      ipcRenderer.on('plugin:lan:event', handler)
      return () => {
        ipcRenderer.removeListener('plugin:lan:event', handler)
      }
    }
  },

  ui: {
    notify: (options) => {
      console.log(`[PluginToast] [${options.type || 'info'}] ${options.message}`)
    }
  },

  lifecycle: {
    register: (hooks: PluginLifecycle) => {
      registeredLifecycle = hooks
      if (hooks.activate) {
        hooks.activate({ pluginId: currentPluginId, version: '2.0.0' })
      }
    }
  }
}

// 仅向沙箱暴露经过封装的受控 SDK，严禁暴露 ipcRenderer 和 Node 原始能力
contextBridge.exposeInMainWorld('doujiaoSDK', sdk)
