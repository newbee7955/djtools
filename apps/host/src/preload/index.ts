import { contextBridge, ipcRenderer } from 'electron'

// 仅向宿主外壳渲染页面暴露特权管理 API
const hostAPI = {
  // 插件容器切换与管理
  showPlugin: (pluginId: string) => ipcRenderer.invoke('host:plugins:show', pluginId),
  hidePlugin: () => ipcRenderer.invoke('host:plugins:hide'),
  setSidebarWidth: (width: number) => ipcRenderer.invoke('host:view:set-sidebar-width', width),
  setRightDrawerWidth: (width: number) => ipcRenderer.invoke('host:view:set-right-drawer-width', width),
  setLeftOverlayWidth: (width: number) => ipcRenderer.invoke('host:view:set-left-overlay-width', width),
  showMoreMenuPopover: (params: { top: number; left: number; plugins: any[]; activeTab: string; theme: string }) =>
    ipcRenderer.invoke('host:more-menu:show', params),
  hideMoreMenuPopover: () => ipcRenderer.invoke('host:more-menu:hide'),
  scheduleHideMoreMenuPopover: (delayMs?: number) =>
    ipcRenderer.invoke('host:more-menu:schedule-hide', delayMs),
  onMoreMenuAction: (callback: (action: string, data: any) => void) => {
    const handler = (_: any, action: string, data: any) => callback(action, data)
    ipcRenderer.on('host:more-menu:action', handler)
    return () => {
      ipcRenderer.removeListener('host:more-menu:action', handler)
    }
  },
  setTheme: (theme: string) => ipcRenderer.invoke('host:view:set-theme', theme),
  listPlugins: () => ipcRenderer.invoke('host:plugins:list'),
  installPluginZip: () => ipcRenderer.invoke('host:plugins:install-zip'),
  uninstallPlugin: (pluginId: string) => ipcRenderer.invoke('host:plugins:uninstall', pluginId),
  togglePlugin: (pluginId: string, enabled: boolean) =>
    ipcRenderer.invoke('host:plugins:toggle', { pluginId, enabled }),

  // 市场与远端安装
  fetchMarketPlugins: (forceRefresh?: boolean) =>
    ipcRenderer.invoke('host:registry:fetch', forceRefresh),
  installMarketPlugin: (pluginId: string, version?: string) =>
    ipcRenderer.invoke('host:registry:install', { pluginId, version }),

  // 自动更新与权限差异审计
  checkPluginUpdates: () => ipcRenderer.invoke('host:updates:check'),
  applyPluginUpdate: (pluginId: string, version?: string) =>
    ipcRenderer.invoke('host:updates:apply', { pluginId, version }),

  // 独立多媒体组件 FFmpeg 管理
  getFFmpegStatus: () => ipcRenderer.invoke('host:ffmpeg:status'),
  installFFmpeg: () => ipcRenderer.invoke('host:ffmpeg:install'),
  selectFFmpegFile: () => ipcRenderer.invoke('host:ffmpeg:select-file'),
  openFFmpegDir: () => ipcRenderer.invoke('host:ffmpeg:open-dir'),
  onFFmpegInstallProgress: (callback: (progress: any) => void) => {
    const handler = (_: any, p: any) => callback(p)
    ipcRenderer.on('host:ffmpeg:install-progress', handler)
    return () => {
      ipcRenderer.removeListener('host:ffmpeg:install-progress', handler)
    }
  },

  // 网络代理与 GitHub 连通性管理
  getProxyStatus: () => ipcRenderer.invoke('host:proxy:get-status'),
  setProxyConfig: (config: any) => ipcRenderer.invoke('host:proxy:set-config', config),
  testGitHubConnectivity: () => ipcRenderer.invoke('host:proxy:test-github'),

  // 抖音鉴权管理
  getDouyinStatus: () => ipcRenderer.invoke('host:auth:douyin-status'),
  loginDouyin: () => ipcRenderer.invoke('host:auth:douyin-login'),

  // 任务管理
  listTasks: () => ipcRenderer.invoke('host:tasks:list'),
  cancelTask: (taskId: string) => ipcRenderer.invoke('host:tasks:cancel', taskId),
  openDownloadDir: () => ipcRenderer.invoke('host:tasks:open-dir'),

  // 主程序版本与更新管理
  getHostVersion: () => ipcRenderer.invoke('host:app:get-version'),
  getAppUpdateConfig: () => ipcRenderer.invoke('host:app-update:get-config'),
  setAppUpdateConfig: (config: any) => ipcRenderer.invoke('host:app-update:set-config', config),
  checkAppUpdate: () => ipcRenderer.invoke('host:app-update:check'),
  downloadAppUpdate: () => ipcRenderer.invoke('host:app-update:download'),
  installAppUpdate: () => ipcRenderer.invoke('host:app-update:install'),
  onAppUpdateProgress: (callback: (progress: any) => void) => {
    const handler = (_: any, p: any) => callback(p)
    ipcRenderer.on('host:app-update:progress', handler)
    return () => {
      ipcRenderer.removeListener('host:app-update:progress', handler)
    }
  },
  onAppUpdateAvailable: (callback: (info: any) => void) => {
    const handler = (_: any, info: any) => callback(info)
    ipcRenderer.on('host:app-update:available', handler)
    return () => {
      ipcRenderer.removeListener('host:app-update:available', handler)
    }
  },

  // 文件存储与工作目录管理 (用于设置中心)
  getWorkspaceDirectories: () => ipcRenderer.invoke('host:workspace:get-all'),
  setWorkspaceDirectory: (scope: string, dirPath: string) =>
    ipcRenderer.invoke('host:workspace:set-directory', { scope, dirPath }),
  selectWorkspaceDirectory: (defaultPath?: string) =>
    ipcRenderer.invoke('host:workspace:select-directory', defaultPath),
  resetWorkspaceDirectory: (scope: string) =>
    ipcRenderer.invoke('host:workspace:reset-directory', scope),
  openWorkspaceDirectory: (scope: string) =>
    ipcRenderer.invoke('host:workspace:open-directory', scope),

  // 导航监听
  onNavigate: (callback: (tab: string) => void) => {
    const handler = (_: any, tab: string) => callback(tab)
    ipcRenderer.on('host:navigate', handler)
    return () => {
      ipcRenderer.removeListener('host:navigate', handler)
    }
  },

  // 窗口控制
  minimize: () => ipcRenderer.invoke('host:window:minimize'),
  maximize: () => ipcRenderer.invoke('host:window:maximize'),
  close: () => ipcRenderer.invoke('host:window:close')
}

contextBridge.exposeInMainWorld('hostAPI', hostAPI)

declare global {
  interface Window {
    hostAPI: typeof hostAPI
  }
}
