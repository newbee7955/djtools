import { ipcMain, BrowserWindow, dialog, shell } from 'electron'
import { existsSync } from 'fs'
import { dirname } from 'path'
import { PluginViewContainerManager } from '../container/plugin-view'
import { DownloadTaskManager } from '../tasks/download-manager'
import { PluginManager } from '../plugins/plugin-manager'
import { getDouyinLoginStatus, openDouyinLoginWindow } from '../auth/douyin-auth'
import { ProxyManager, NetworkProxyConfig } from '../network/proxy-manager'

export function registerHostIpc(mainWindow: BrowserWindow): void {
  const containerManager = PluginViewContainerManager.getInstance()
  const taskManager = DownloadTaskManager.getInstance()
  const pluginManager = PluginManager.getInstance()

  // 1. 切换视图：展示插件沙箱
  ipcMain.handle('host:plugins:show', async (_, pluginId: string) => {
    await containerManager.showPlugin(pluginId)
    return { success: true }
  })

  // 2. 切换视图：隐藏当前插件沙箱（返回市场或设置页）
  ipcMain.handle('host:plugins:hide', async () => {
    containerManager.hideCurrentPlugin()
    return { success: true }
  })

  // 3. 插件管理：获取所有插件（包含内置与已安装）
  ipcMain.handle('host:plugins:list', async () => {
    return pluginManager.listAllPlugins()
  })

  // 4. 插件管理：选择并安装本地 ZIP 插件包
  ipcMain.handle('host:plugins:install-zip', async () => {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: '选择插件安装包 (ZIP)',
      filters: [{ name: 'Zip Archive', extensions: ['zip'] }],
      properties: ['openFile']
    })

    if (res.canceled || res.filePaths.length === 0) {
      return { canceled: true }
    }

    try {
      const result = await pluginManager.installFromZip(res.filePaths[0])
      if (result.pluginId) {
        containerManager.destroyPluginView(result.pluginId)
      }
      return result
    } catch (err: any) {
      console.error('[HostApi] 安装插件失败:', err)
      return { success: false, error: err?.message || '安装失败' }
    }
  })

  // 5. 插件管理：卸载插件
  ipcMain.handle('host:plugins:uninstall', async (_, pluginId: string) => {
    containerManager.destroyPluginView(pluginId)
    const success = pluginManager.uninstallPlugin(pluginId)
    return { success }
  })

  // 6. 插件市场：拉取远端市场聚合清单 (支持强制刷新)
  ipcMain.handle('host:registry:fetch', async (_, forceRefresh?: boolean) => {
    const { RegistryClient } = await import('../plugins/registry-client')
    return await RegistryClient.getInstance().getMarketPlugins(forceRefresh)
  })

  // 7. 插件市场：一键下载、双重验签 (SHA-256 + Ed25519) 并事务安装
  ipcMain.handle(
    'host:registry:install',
    async (_, { pluginId, version }: { pluginId: string; version?: string }) => {
      try {
        containerManager.destroyPluginView(pluginId)
        const { RegistryClient } = await import('../plugins/registry-client')
        const res = await RegistryClient.getInstance().installFromRegistry(pluginId, version)
        return res
      } catch (err: any) {
        console.error(`[HostApi] 市场安装插件 ${pluginId} 失败:`, err)
        return { success: false, error: err?.message || '安装失败' }
      }
    }
  )

  // 8. 自动更新：检查更新与权限变更差异 (Permission Diff)
  ipcMain.handle('host:updates:check', async () => {
    const { PluginAutoUpdater } = await import('../plugins/auto-updater')
    return await PluginAutoUpdater.getInstance().checkForUpdates()
  })

  // 9. 自动更新：应用更新
  ipcMain.handle(
    'host:updates:apply',
    async (_, { pluginId, version }: { pluginId: string; version?: string }) => {
      try {
        containerManager.destroyPluginView(pluginId)
        const { RegistryClient } = await import('../plugins/registry-client')
        const res = await RegistryClient.getInstance().installFromRegistry(pluginId, version)
        return res
      } catch (err: any) {
        console.error(`[HostApi] 更新插件 ${pluginId} 失败:`, err)
        return { success: false, error: err?.message || '更新失败' }
      }
    }
  )

  // 10. 独立多媒体组件：FFmpeg 状态检测
  ipcMain.handle('host:ffmpeg:status', async () => {
    const { FFmpegManager } = await import('../media/ffmpeg-manager')
    return await FFmpegManager.getInstance().getStatus()
  })

  // 11. 独立多媒体组件：FFmpeg 一键安装/下载 (支持进度广播与严格状态校验)
  ipcMain.handle('host:ffmpeg:install', async () => {
    try {
      const { FFmpegManager } = await import('../media/ffmpeg-manager')
      const status = await FFmpegManager.getInstance().installFFmpeg((progress) => {
        if (!mainWindow.isDestroyed()) {
          mainWindow.webContents.send('host:ffmpeg:install-progress', progress)
        }
      })
      if (!status.installed) {
        return { success: false, error: status.error || '安装未完成，未检测到有效可执行文件' }
      }
      return { success: true, status }
    } catch (err: any) {
      return { success: false, error: err?.message || '安装失败' }
    }
  })

  // 12. 独立多媒体组件：手动选择本地现有 ffmpeg.exe 导入
  ipcMain.handle('host:ffmpeg:select-file', async () => {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: '选择本地已有的 FFmpeg 可执行文件 (ffmpeg.exe)',
      filters: [
        {
          name: 'FFmpeg Executable',
          extensions: process.platform === 'win32' ? ['exe'] : ['*']
        }
      ],
      properties: ['openFile']
    })

    if (res.canceled || res.filePaths.length === 0) {
      return { canceled: true }
    }

    try {
      const { FFmpegManager } = await import('../media/ffmpeg-manager')
      const status = await FFmpegManager.getInstance().importCustomBinary(res.filePaths[0])
      return { success: true, status }
    } catch (err: any) {
      return { success: false, error: err?.message || '导入失败' }
    }
  })

  // 12.1 独立多媒体组件：在系统文件管理器中打开 FFmpeg 目录
  ipcMain.handle('host:ffmpeg:open-dir', async () => {
    try {
      const { FFmpegManager } = await import('../media/ffmpeg-manager')
      const status = await FFmpegManager.getInstance().getStatus()
      if (status.path && existsSync(status.path)) {
        shell.showItemInFolder(status.path)
      } else {
        const target = FFmpegManager.getInstance().getTargetExecutablePath()
        shell.openPath(dirname(target))
      }
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err?.message }
    }
  })

  // 13. 抖音账号登录管理（宿主外壳层）
  ipcMain.handle('host:auth:douyin-status', async () => {
    return getDouyinLoginStatus()
  })

  ipcMain.handle('host:auth:douyin-login', async () => {
    return await openDouyinLoginWindow()
  })

  // 14. 获取所有下载任务列表
  ipcMain.handle('host:tasks:list', async () => {
    return taskManager.getAllTasks()
  })

  // 15. 取消下载任务
  ipcMain.handle('host:tasks:cancel', async (_, taskId: string) => {
    return taskManager.cancel(taskId)
  })

  // 16. 打开下载保存目录
  ipcMain.handle('host:tasks:open-dir', async () => {
    taskManager.openSaveDirectory()
  })

  // 17. 网络代理管理：获取当前代理状态与 GitHub 有效代理
  ipcMain.handle('host:proxy:get-status', async () => {
    return await ProxyManager.getInstance().getStatus()
  })

  // 18. 网络代理管理：保存并应用代理配置（系统代理 / 直连 / 自定义）
  ipcMain.handle('host:proxy:set-config', async (_, config: Partial<NetworkProxyConfig>) => {
    return await ProxyManager.getInstance().setConfig(config)
  })

  // 19. 网络代理管理：测试 GitHub 直连与连通性
  ipcMain.handle('host:proxy:test-github', async () => {
    return await ProxyManager.getInstance().testGitHubConnectivity()
  })

  // 20. 主程序版本与更新管理
  ipcMain.handle('host:app:get-version', () => {
    const { app } = require('electron')
    return app.getVersion() || '0.2.1'
  })

  ipcMain.handle('host:app-update:get-config', async () => {
    const { AppUpdateService } = await import('../services/app-update-service')
    return AppUpdateService.getInstance().getConfig()
  })

  ipcMain.handle('host:app-update:set-config', async (_, config: any) => {
    const { AppUpdateService } = await import('../services/app-update-service')
    return AppUpdateService.getInstance().setConfig(config)
  })

  ipcMain.handle('host:app-update:check', async () => {
    const { AppUpdateService } = await import('../services/app-update-service')
    return await AppUpdateService.getInstance().checkForUpdates()
  })

  ipcMain.handle('host:app-update:download', async () => {
    const { AppUpdateService } = await import('../services/app-update-service')
    return await AppUpdateService.getInstance().downloadUpdate((progress) => {
      if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send('host:app-update:progress', progress)
      }
    })
  })

  ipcMain.handle('host:app-update:install', async () => {
    const { AppUpdateService } = await import('../services/app-update-service')
    return await AppUpdateService.getInstance().installAndRestart()
  })

  // 21. 统一文件存储与工作目录管理 (用于设置中心)
  ipcMain.handle('host:workspace:get-all', async () => {
    const { WorkspaceService } = await import('../services/workspace-service')
    const ws = WorkspaceService.getInstance()
    return {
      downloads: taskManager.getDownloadDir(),
      notepad: ws.getDirectory('notepad'),
      markdown: ws.getDirectory('markdown-editor')
    }
  })

  ipcMain.handle('host:workspace:set-directory', async (_, { scope, dirPath }: { scope: string; dirPath: string }) => {
    if (scope === 'downloads') {
      return taskManager.setDownloadDir(dirPath)
    }
    const { WorkspaceService } = await import('../services/workspace-service')
    return WorkspaceService.getInstance().setDirectory(scope, dirPath)
  })

  ipcMain.handle('host:workspace:select-directory', async (_, defaultPath?: string) => {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: '选择存储目录',
      defaultPath,
      properties: ['openDirectory', 'createDirectory']
    })
    if (res.canceled || res.filePaths.length === 0) {
      return { canceled: true }
    }
    return { canceled: false, directoryPath: res.filePaths[0] }
  })

  ipcMain.handle('host:workspace:reset-directory', async (_, scope: string) => {
    if (scope === 'downloads') {
      const { app } = require('electron')
      const { join } = require('path')
      return taskManager.setDownloadDir(join(app.getPath('downloads'), 'doujiao'))
    }
    const { WorkspaceService } = await import('../services/workspace-service')
    return WorkspaceService.getInstance().resetDirectory(scope)
  })

  ipcMain.handle('host:workspace:open-directory', async (_, scope: string) => {
    if (scope === 'downloads') {
      taskManager.openSaveDirectory()
      return
    }
    const { WorkspaceService } = await import('../services/workspace-service')
    await WorkspaceService.getInstance().openDirectory(scope)
  })

  // 22. 窗口控制
  ipcMain.handle('host:window:minimize', () => mainWindow.minimize())
  ipcMain.handle('host:window:maximize', () => {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize()
    } else {
      mainWindow.maximize()
    }
  })
  ipcMain.handle('host:window:close', () => mainWindow.close())
}
