/// <reference types="vite/client" />

export interface HostAPI {
  showPlugin: (pluginId: string) => Promise<{ success: boolean }>
  hidePlugin: () => Promise<{ success: boolean }>
  setSidebarWidth?: (width: number) => Promise<{ success: boolean }>
  setRightDrawerWidth?: (width: number) => Promise<{ success: boolean }>
  setLeftOverlayWidth?: (width: number) => Promise<{ success: boolean }>
  setTheme?: (theme: string) => Promise<{ success: boolean }>
  listPlugins: () => Promise<any[]>
  installPluginZip: () => Promise<{ success?: boolean; canceled?: boolean; pluginId?: string; version?: string; error?: string }>
  uninstallPlugin: (pluginId: string) => Promise<{ success: boolean }>
  togglePlugin?: (pluginId: string, enabled: boolean) => Promise<{ success: boolean; enabled?: boolean; error?: string }>

  fetchMarketPlugins: (forceRefresh?: boolean) => Promise<any>
  installMarketPlugin: (pluginId: string, version?: string) => Promise<{ success: boolean; pluginId?: string; version?: string; error?: string }>
  checkPluginUpdates: () => Promise<any[]>
  applyPluginUpdate: (pluginId: string, version?: string) => Promise<{ success: boolean; pluginId?: string; version?: string; error?: string }>

  getProxyStatus?: () => Promise<any>
  setProxyConfig?: (config: any) => Promise<any>
  testGitHubConnectivity?: () => Promise<any>

  getFFmpegStatus: () => Promise<{ installed: boolean; version?: string; path?: string; source?: string; error?: string }>
  installFFmpeg: () => Promise<{ success: boolean; status?: any; error?: string }>
  selectFFmpegFile: () => Promise<{ success?: boolean; canceled?: boolean; status?: any; error?: string }>
  openFFmpegDir: () => Promise<{ success: boolean; error?: string }>
  onFFmpegInstallProgress?: (callback: (progress: { percent: number; speed?: string; text?: string }) => void) => () => void

  getDouyinStatus: () => Promise<{ loggedIn: boolean }>
  loginDouyin: () => Promise<{ success: boolean; message?: string }>
  listTasks: () => Promise<any[]>
  cancelTask: (taskId: string) => Promise<boolean>
  openDownloadDir: () => Promise<void>
  // 主程序版本与在线更新
  getHostVersion?: () => Promise<string>
  getAppUpdateConfig?: () => Promise<{ autoCheck: boolean }>
  setAppUpdateConfig?: (config: { autoCheck: boolean }) => Promise<any>
  checkAppUpdate?: () => Promise<any>
  downloadAppUpdate?: () => Promise<{ success: boolean; installerPath?: string; error?: string }>
  installAppUpdate?: (customPath?: string) => Promise<boolean>
  onAppUpdateProgress?: (callback: (progress: any) => void) => () => void
  onAppUpdateAvailable?: (callback: (info: any) => void) => () => void

  // 统一文件存储与工作目录管理
  getWorkspaceDirectories?: () => Promise<{ downloads: string; notepad: string; markdown: string }>
  setWorkspaceDirectory?: (scope: string, dirPath: string) => Promise<string>
  selectWorkspaceDirectory?: (defaultPath?: string) => Promise<{ canceled: boolean; directoryPath?: string }>
  resetWorkspaceDirectory?: (scope: string) => Promise<string>
  openWorkspaceDirectory?: (scope: string) => Promise<void>

  onNavigate?: (callback: (tab: string) => void) => () => void

  minimize: () => Promise<void>
  maximize: () => Promise<void>
  close: () => Promise<void>
}

declare global {
  interface Window {
    hostAPI?: HostAPI
  }
}
