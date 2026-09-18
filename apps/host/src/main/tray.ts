import { app, BrowserWindow, Menu, Tray, nativeImage } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import { execSync } from 'child_process'
import { PluginManager } from './plugins/plugin-manager'

export class AppTrayManager {
  private static instance: AppTrayManager
  private tray: Tray | null = null
  private mainWindow: BrowserWindow | null = null
  private isQuitting = false

  private constructor() {}

  public static getInstance(): AppTrayManager {
    if (!AppTrayManager.instance) {
      AppTrayManager.instance = new AppTrayManager()
    }
    return AppTrayManager.instance
  }

  public getIsQuitting(): boolean {
    return this.isQuitting
  }

  public setQuitting(quitting: boolean): void {
    this.isQuitting = quitting
  }

  private static readonly REG_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'
  private static readonly REG_NAME = 'com.doujiao.app'

  /**
   * 获取实际应打开的可执行文件路径（生产环境用 process.execPath，开发环境尝试定位已安装的 exe）
   */
  private getAutoStartExePath(): string | null {
    if (app.isPackaged) {
      return process.execPath
    }
    // 开发环境：尝试从已有注册表项或常见安装位置定位已打包的 exe
    const candidates = [
      join(app.getPath('home'), 'AppData', 'Local', 'Programs', 'doujiao', 'doujiao.exe'),
      join('C:\\Program Files', 'doujiao', 'doujiao.exe'),
      join('D:\\Program Files', 'doujiao', 'doujiao.exe')
    ]
    for (const p of candidates) {
      if (existsSync(p)) return p
    }
    return null
  }

  public getAutoStart(): boolean {
    try {
      const output = execSync(
        `reg query "${AppTrayManager.REG_KEY}" /v "${AppTrayManager.REG_NAME}"`,
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
      )
      return output.includes(AppTrayManager.REG_NAME)
    } catch {
      return false
    }
  }

  public updateAutoStart(openAtLogin: boolean): void {
    try {
      if (openAtLogin) {
        const exePath = this.getAutoStartExePath()
        if (!exePath) {
          console.warn('[Tray] 开发环境未找到已安装的应用，开机自启设置跳过')
          return
        }
        // 使用带引号的路径 + --hidden 参数写入注册表
        const value = `"${exePath}" --hidden`
        execSync(
          `reg add "${AppTrayManager.REG_KEY}" /v "${AppTrayManager.REG_NAME}" /t REG_SZ /d "${value}" /f`,
          { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
        )
        console.log('[Tray] 开机自启已启用:', value)
      } else {
        execSync(
          `reg delete "${AppTrayManager.REG_KEY}" /v "${AppTrayManager.REG_NAME}" /f`,
          { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
        )
        console.log('[Tray] 开机自启已禁用')
      }
    } catch (err) {
      console.error('[Tray] 设置开机自启失败:', err)
    }
    this.rebuildContextMenu()
  }

  private hasActiveRemoteSession = false

  public updateRemoteAssistState(hasActive: boolean): void {
    this.hasActiveRemoteSession = hasActive
    this.rebuildContextMenu()
  }

  public rebuildContextMenu(): void {
    if (!this.tray) return

    const template: Electron.MenuItemConstructorOptions[] = []

    if (this.hasActiveRemoteSession) {
      template.push(
        {
          label: '断开当前远程协助',
          click: async () => {
            const { RemoteAssistService } = await import('./services/remote-assist/remote-assist-service')
            await RemoteAssistService.getInstance().disconnect('tray-clicked')
          }
        },
        { type: 'separator' }
      )
    }

    template.push({
      label: '打开豆角工具箱',
      click: () => this.showWindow()
    })

    const isPluginAvailable = (id: string) => {
      try {
        return PluginManager.getInstance().isPluginAvailable(id)
      } catch {
        return false
      }
    }

    const featureItems: Electron.MenuItemConstructorOptions[] = [
      {
        label: '截取屏幕 (Ctrl+Alt+A)',
        click: async () => {
          const { ScreenshotService } = await import('./services/screenshot-service')
          ScreenshotService.getInstance().capture({ hideWindow: true, mode: 'snip' })
        }
      }
    ]

    // 只有在安装并启用了 screen-pin 贴图插件时，才显示贴图功能选项
    if (isPluginAvailable('screen-pin')) {
      featureItems.push(
        {
          label: '剪贴板贴图 (Alt+F3)',
          click: async () => {
            const { PinManager } = await import('./container/pin-manager')
            PinManager.getInstance().pinFromClipboard()
          }
        },
        {
          label: '取消贴图鼠标穿透 (Ctrl+Shift+T)',
          click: async () => {
            const { PinManager } = await import('./container/pin-manager')
            PinManager.getInstance().cancelAllClickThrough()
          }
        },
        {
          label: '关闭所有桌面贴图',
          click: async () => {
            const { PinManager } = await import('./container/pin-manager')
            PinManager.getInstance().closeAllPins()
          }
        }
      )
    }

    // 只有在安装并启用了 drop-shelf 暂存岛插件时，才显示打开/隐藏暂存岛选项
    if (isPluginAvailable('drop-shelf')) {
      featureItems.push({
        label: '打开/隐藏暂存岛 (Alt+Shift+D)',
        click: async () => {
          const { ShelfManager } = await import('./container/shelf-manager')
          ShelfManager.getInstance().toggleWindow()
        }
      })
    }

    if (featureItems.length > 0) {
      template.push({ type: 'separator' }, ...featureItems)
    }

    template.push(
      { type: 'separator' },
      {
        label: '开机自动启动',
        type: 'checkbox',
        checked: this.getAutoStart(),
        click: () => {
          const current = this.getAutoStart()
          this.updateAutoStart(!current)
        }
      },
      { type: 'separator' },
      {
        label: '退出应用',
        click: () => {
          this.isQuitting = true
          app.quit()
        }
      }
    )

    this.tray.setContextMenu(Menu.buildFromTemplate(template))
  }

  public init(mainWindow: BrowserWindow): void {
    this.mainWindow = mainWindow
    if (this.tray) return

    const iconPath = this.getTrayIconPath()
    const icon = nativeImage.createFromPath(iconPath)
    this.tray = new Tray(icon)

    this.tray.setToolTip('豆角工具箱')
    this.rebuildContextMenu()

    // 点击托盘图标：切换显示/激活
    this.tray.on('click', () => {
      this.toggleWindow()
    })

    // 双击托盘图标：始终展示并聚焦主窗口
    this.tray.on('double-click', () => {
      this.showWindow()
    })
  }

  public showWindow(): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return
    if (this.mainWindow.isMinimized()) {
      this.mainWindow.restore()
    }
    this.mainWindow.show()
    this.mainWindow.focus()
  }

  public toggleWindow(): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return
    if (this.mainWindow.isVisible()) {
      if (this.mainWindow.isMinimized()) {
        this.mainWindow.restore()
        this.mainWindow.focus()
      } else {
        this.mainWindow.focus()
      }
    } else {
      this.showWindow()
    }
  }

  public destroy(): void {
    if (this.tray && !this.tray.isDestroyed()) {
      this.tray.destroy()
      this.tray = null
    }
  }

  public getTrayIconPath(): string {
    const appPath = app.getAppPath()
    const candidates = [
      join(app.getPath('userData'), 'icon.ico'),
      join(process.resourcesPath || '', 'build/icon.ico'),
      join(appPath, 'build/icon.ico'),
      join(appPath, 'build/icon.png'),
      join(__dirname, '../../build/icon.ico'),
      join(__dirname, '../../build/icon.png')
    ]
    for (const cand of candidates) {
      if (existsSync(cand)) {
        return cand
      }
    }
    return candidates[candidates.length - 1]
  }
}
