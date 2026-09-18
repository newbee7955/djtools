import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  DoujiaoSDK,
  NetworkRequestOptions,
  DownloadTaskRequest,
  DownloadProgressInfo,
  PluginLifecycle,
  WorkspaceFileItem,
  ScreenRecordingEvent,
  ScreenRecordingOptions,
  RemoteAssistPermission,
  RemoteAssistEvent
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
    },
    convert: (options: any) => {
      return ipcRenderer.invoke('plugin:media:convert', options)
    },
    probe: (filePath: string) => {
      return ipcRenderer.invoke('plugin:media:probe', filePath)
    },
    cancelConvert: (taskId: string) => {
      return ipcRenderer.invoke('plugin:media:cancel', taskId)
    },
    showItemInFolder: (localPath: string) => {
      return ipcRenderer.invoke('plugin:media:show-in-folder', localPath)
    },
    openPath: (localPath: string) => {
      return ipcRenderer.invoke('plugin:media:open-path', localPath)
    },
    onProgress: (callback: (progress: any) => void) => {
      const handler = (_: any, progress: any) => {
        try {
          callback(progress)
        } catch (err) {
          console.error('[DoujiaoSDK] 媒体转码进度监听异常:', err)
        }
      }
      ipcRenderer.on('plugin:media:progress', handler)
      return () => {
        ipcRenderer.removeListener('plugin:media:progress', handler)
      }
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

  objectStorage: {
    getProfiles: () => ipcRenderer.invoke('plugin:object-storage:get-profiles'),
    saveProfiles: (profiles: any[]) => ipcRenderer.invoke('plugin:object-storage:save-profiles', profiles),
    saveProfile: (profile: any) => ipcRenderer.invoke('plugin:object-storage:save-profile', profile),
    deleteProfile: (id: string) => ipcRenderer.invoke('plugin:object-storage:delete-profile', id),
    onProfilesUpdated: (callback: () => void) => {
      const handler = () => {
        try {
          callback()
        } catch (err) {
          console.error('[DoujiaoSDK] 对象存储配置更新回调异常:', err)
        }
      }
      ipcRenderer.on('plugin:object-storage:profiles-updated', handler)
      return () => {
        ipcRenderer.removeListener('plugin:object-storage:profiles-updated', handler)
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

  screen: {
    capture: (options?: any) => ipcRenderer.invoke('plugin:screen:capture', options),
    onCaptured: (callback: (result: any) => void) => {
      const handler = (_: any, res: any) => {
        try {
          callback(res)
        } catch (err) {
          console.error('[DoujiaoSDK] 屏幕截图监听回调异常:', err)
        }
      }
      ipcRenderer.on('plugin:screen:captured', handler)
      return () => {
        ipcRenderer.removeListener('plugin:screen:captured', handler)
      }
    },
    startRecording: (options: ScreenRecordingOptions) =>
      ipcRenderer.invoke('plugin:screen-recording:start', options),
    stopRecording: () => ipcRenderer.invoke('plugin:screen-recording:stop'),
    cancelRecording: () => ipcRenderer.invoke('plugin:screen-recording:cancel'),
    getRecordingStatus: () => ipcRenderer.invoke('plugin:screen-recording:status'),
    getRecordingSupport: () => ipcRenderer.invoke('plugin:screen-recording:support'),
    openRecording: (localPath: string) =>
      ipcRenderer.invoke('plugin:screen-recording:open', localPath),
    showRecordingInFolder: (localPath: string) =>
      ipcRenderer.invoke('plugin:screen-recording:show-in-folder', localPath),
    onRecordingEvent: (callback: (event: ScreenRecordingEvent) => void) => {
      const handler = (_: any, event: ScreenRecordingEvent) => {
        try {
          callback(event)
        } catch (err) {
          console.error('[DoujiaoSDK] 屏幕录制事件监听异常:', err)
        }
      }
      ipcRenderer.on('plugin:screen-recording:event', handler)
      return () => {
        ipcRenderer.removeListener('plugin:screen-recording:event', handler)
      }
    }
  },

  pin: {
    createPin: (options: any) => ipcRenderer.invoke('plugin:pin:create', options),
    closePin: (pinId: string) => ipcRenderer.invoke('plugin:pin:close', pinId),
    closeAllPins: () => ipcRenderer.invoke('plugin:pin:close-all'),
    getPinnedList: () => ipcRenderer.invoke('plugin:pin:list'),
    pinFromClipboard: () => ipcRenderer.invoke('plugin:pin:from-clipboard'),
    setPinOpacity: (pinId: string, opacity: number) =>
      ipcRenderer.invoke('plugin:pin:set-opacity', pinId, opacity),
    setPinScale: (pinId: string, scale: number) =>
      ipcRenderer.invoke('plugin:pin:set-scale', pinId, scale),
    setPinClickThrough: (pinId: string, clickThrough: boolean) =>
      ipcRenderer.invoke('plugin:pin:set-click-through', pinId, clickThrough),
    cancelAllClickThrough: () => ipcRenderer.invoke('plugin:pin:cancel-all-click-through'),
    getPinData: (pinId: string) => ipcRenderer.invoke('plugin:pin:get-data', pinId),
    movePin: (pinId: string, deltaX: number, deltaY: number) =>
      ipcRenderer.invoke('plugin:pin:move', pinId, deltaX, deltaY),
    resizePin: (pinId: string, width: number, height: number) =>
      ipcRenderer.invoke('plugin:pin:resize', pinId, width, height),
    copyImage: (dataUrl: string) => ipcRenderer.invoke('plugin:pin:copy-image', dataUrl),
    saveAs: (dataUrl: string, defaultName?: string) =>
      ipcRenderer.invoke('plugin:pin:save-as', dataUrl, defaultName),
    onPinsChanged: (callback: (pins: any[]) => void) => {
      const handler = (_: any, pins: any[]) => {
        try {
          callback(pins)
        } catch (err) {
          console.error('[DoujiaoSDK] 贴图状态变更监听异常:', err)
        }
      }
      ipcRenderer.on('plugin:pin:changed', handler)
      return () => {
        ipcRenderer.removeListener('plugin:pin:changed', handler)
      }
    }
  },

  shelf: {
    getItems: () => ipcRenderer.invoke('plugin:shelf:get-items'),
    addItem: (item: any) => ipcRenderer.invoke('plugin:shelf:add-item', item),
    removeItems: (ids: string[]) => ipcRenderer.invoke('plugin:shelf:remove-items', ids),
    clearShelf: () => ipcRenderer.invoke('plugin:shelf:clear'),
    startDrag: (filePaths: string[]) => {
      ipcRenderer.send('plugin:shelf:start-drag', filePaths)
      return Promise.resolve()
    },
    packToZip: (filePaths: string[], zipName?: string) =>
      ipcRenderer.invoke('plugin:shelf:pack-zip', filePaths, zipName),
    copyPaths: (filePaths: string[]) =>
      ipcRenderer.invoke('plugin:shelf:copy-paths', filePaths),
    toggleShelfWindow: (visible?: boolean) =>
      ipcRenderer.invoke('plugin:shelf:toggle-window', visible),
    openFile: (filePath: string) => ipcRenderer.invoke('plugin:shelf:open-file', filePath),
    showItemInFolder: (filePath: string) =>
      ipcRenderer.invoke('plugin:shelf:show-in-folder', filePath),
    selectFiles: () => ipcRenderer.invoke('plugin:shelf:select-files'),
    getConfig: () => ipcRenderer.invoke('plugin:shelf:get-config'),
    setConfig: (config: any) => ipcRenderer.invoke('plugin:shelf:set-config', config),
    setCollapsed: (collapsed: boolean) => ipcRenderer.invoke('plugin:shelf:set-collapsed', collapsed),
    isCollapsed: () => ipcRenderer.invoke('plugin:shelf:is-collapsed'),
    setTabY: (y: number) => ipcRenderer.invoke('plugin:shelf:set-tab-y', y),
    onCollapseChanged: (callback: (collapsed: boolean) => void) => {
      const handler = (_: any, collapsed: boolean) => {
        try {
          callback(collapsed)
        } catch (err) {
          console.error('[DoujiaoSDK] 折叠状态监听异常:', err)
        }
      }
      ipcRenderer.on('plugin:shelf:collapse-changed', handler)
      return () => {
        ipcRenderer.removeListener('plugin:shelf:collapse-changed', handler)
      }
    },
    pasteFromClipboard: () => ipcRenderer.invoke('plugin:shelf:paste-clipboard'),
    onShelfChanged: (callback: (items: any[]) => void) => {
      const handler = (_: any, items: any[]) => {
        try {
          callback(items)
        } catch (err) {
          console.error('[DoujiaoSDK] 暂存岛变更监听异常:', err)
        }
      }
      ipcRenderer.on('plugin:shelf:changed', handler)
      return () => {
        ipcRenderer.removeListener('plugin:shelf:changed', handler)
      }
    }
  },

  remoteAssist: {
    getDeviceInfo: () => ipcRenderer.invoke('plugin:remote-assist:get-device-info'),
    setSignalingUrl: (url: string) => ipcRenderer.invoke('plugin:remote-assist:set-signaling-url', url),
    refreshSafetyCode: () => ipcRenderer.invoke('plugin:remote-assist:refresh-safety-code'),
    setPreferredFps: (fps: number) => ipcRenderer.invoke('plugin:remote-assist:set-preferred-fps', fps),
    requestSession: (targetDeviceCode: string, permission: RemoteAssistPermission, safetyCode?: string) =>
      ipcRenderer.invoke('plugin:remote-assist:request-session', targetDeviceCode, permission, safetyCode),
    respondToSession: (requestId: string, decision: 'view' | 'control' | 'deny') =>
      ipcRenderer.invoke('plugin:remote-assist:respond-to-session', requestId, decision),
    disconnect: (sessionId: string) =>
      ipcRenderer.invoke('plugin:remote-assist:disconnect', sessionId),
    transfer: {
      getSettings: () => ipcRenderer.invoke('plugin:remote-assist:transfer:get-settings'),
      setReceiveDir: (dir: string) => ipcRenderer.invoke('plugin:remote-assist:transfer:set-receive-dir', dir),
      setPolicy: (policy: any) => ipcRenderer.invoke('plugin:remote-assist:transfer:set-policy', policy),
      sendPaths: (paths: string[]) => ipcRenderer.invoke('plugin:remote-assist:transfer:send-paths', paths),
      chooseAndSend: () => ipcRenderer.invoke('plugin:remote-assist:transfer:choose-and-send'),
      cancel: (transferId: string) => ipcRenderer.invoke('plugin:remote-assist:transfer:cancel', transferId),
      openReceiveFolder: () => ipcRenderer.invoke('plugin:remote-assist:transfer:open-receive-folder'),
      sendChat: (text: string) => ipcRenderer.invoke('plugin:remote-assist:transfer:send-chat', text)
    },
    onEvent: (callback: (event: RemoteAssistEvent) => void) => {
      const handler = (_: any, event: RemoteAssistEvent) => {
        try {
          callback(event)
        } catch (err) {
          console.error('[DoujiaoSDK] 远程协助事件监听异常:', err)
        }
      }
      ipcRenderer.on('plugin:remote-assist:event', handler)
      return () => {
        ipcRenderer.removeListener('plugin:remote-assist:event', handler)
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
