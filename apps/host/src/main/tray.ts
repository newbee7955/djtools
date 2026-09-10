import { app, BrowserWindow, Menu, Tray, nativeImage } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'

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

  public init(mainWindow: BrowserWindow): void {
    this.mainWindow = mainWindow
    if (this.tray) return

    const iconPath = this.getTrayIconPath()
    const icon = nativeImage.createFromPath(iconPath)
    this.tray = new Tray(icon)

    this.tray.setToolTip('豆角工具箱')

    const contextMenu = Menu.buildFromTemplate([
      {
        label: '打开豆角工具箱',
        click: () => this.showWindow()
      },
      { type: 'separator' },
      {
        label: '退出应用',
        click: () => {
          this.isQuitting = true
          app.quit()
        }
      }
    ])

    this.tray.setContextMenu(contextMenu)

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
