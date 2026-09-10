import { WebContentsView, BrowserWindow, app } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import { setupSecurityGuards } from '../security'

export interface PluginViewInstance {
  pluginId: string
  view: WebContentsView
  isAttached: boolean
}

export class PluginViewContainerManager {
  private static instance: PluginViewContainerManager
  private views: Map<string, PluginViewInstance> = new Map()
  private mainWindow: BrowserWindow | null = null
  private activePluginId: string | null = null
  private currentBounds: Electron.Rectangle = { x: 220, y: 50, width: 980, height: 750 }

  private constructor() {}

  public static getInstance(): PluginViewContainerManager {
    if (!PluginViewContainerManager.instance) {
      PluginViewContainerManager.instance = new PluginViewContainerManager()
    }
    return PluginViewContainerManager.instance
  }

  public init(mainWindow: BrowserWindow): void {
    this.mainWindow = mainWindow

    // 监听主窗口 resize 自动更新当前活跃 view 的 bounds
    mainWindow.on('resize', () => {
      this.updateViewBounds()
    })
  }

  public setBounds(bounds: Electron.Rectangle): void {
    this.currentBounds = bounds
    this.updateViewBounds()
  }

  private updateViewBounds(): void {
    if (!this.mainWindow || !this.activePluginId) return
    const instance = this.views.get(this.activePluginId)
    if (instance && instance.isAttached) {
      const windowBounds = this.mainWindow.getContentBounds()
      // 侧边栏宽度 240px，顶部标题栏 50px
      const targetBounds = {
        x: 240,
        y: 50,
        width: Math.max(400, windowBounds.width - 240),
        height: Math.max(300, windowBounds.height - 50)
      }
      instance.view.setBounds(targetBounds)
    }
  }

  public getPluginIdByWebContentsId(webContentsId: number): string | null {
    for (const [pluginId, instance] of this.views.entries()) {
      if (instance.view.webContents.id === webContentsId) {
        return pluginId
      }
    }
    return null
  }

  /**
   * 挂载或切换到指定插件的沙箱视图
   */
  public async showPlugin(pluginId: string): Promise<void> {
    if (!this.mainWindow) return

    // 1. 如果已有其他插件正在显示，先移除其 View
    if (this.activePluginId && this.activePluginId !== pluginId) {
      const current = this.views.get(this.activePluginId)
      if (current && current.isAttached) {
        this.mainWindow.contentView.removeChildView(current.view)
        current.isAttached = false
      }
    }

    // 2. 检查或新建目标插件的 View
    let instance = this.views.get(pluginId)
    if (!instance) {
      instance = this.createPluginView(pluginId)
      this.views.set(pluginId, instance)
    }

    // 3. 挂载到主窗口
    if (!instance.isAttached) {
      this.mainWindow.contentView.addChildView(instance.view)
      instance.isAttached = true
    }

    this.activePluginId = pluginId
    this.updateViewBounds()
  }

  /**
   * 隐藏当前插件沙箱（例如切回“插件市场”或“设置”页时）
   */
  public hideCurrentPlugin(): void {
    if (!this.mainWindow || !this.activePluginId) return
    const instance = this.views.get(this.activePluginId)
    if (instance && instance.isAttached) {
      this.mainWindow.contentView.removeChildView(instance.view)
      instance.isAttached = false
    }
    this.activePluginId = null
  }

  /**
   * 销毁指定插件沙箱视图
   */
  public destroyPluginView(pluginId: string): void {
    const instance = this.views.get(pluginId)
    if (instance) {
      if (instance.isAttached && this.mainWindow) {
        this.mainWindow.contentView.removeChildView(instance.view)
      }
      instance.view.webContents.close()
      this.views.delete(pluginId)
      if (this.activePluginId === pluginId) {
        this.activePluginId = null
      }
    }
  }

  /**
   * 销毁所有插件沙箱视图（主窗口退出或关闭时彻底释放资源，防止孤儿进程残留）
   */
  public destroyAll(): void {
    for (const [pluginId, instance] of this.views.entries()) {
      try {
        if (instance.isAttached && this.mainWindow) {
          this.mainWindow.contentView.removeChildView(instance.view)
        }
        if (!instance.view.webContents.isDestroyed()) {
          instance.view.webContents.close()
        }
      } catch (err) {
        console.warn(`[PluginView] 销毁插件视图 ${pluginId} 异常:`, err)
      }
    }
    this.views.clear()
    this.activePluginId = null
  }

  private createPluginView(pluginId: string): PluginViewInstance {
    const pluginPreloadPath = existsSync(join(__dirname, '../preload/plugin.cjs'))
      ? join(__dirname, '../preload/plugin.cjs')
      : join(app.getAppPath(), 'out/preload/plugin.cjs')

    const view = new WebContentsView({
      webPreferences: {
        sandbox: true,
        nodeIntegration: false,
        contextIsolation: true,
        preload: pluginPreloadPath,
        webSecurity: true,
        allowRunningInsecureContent: false,
        spellcheck: false,
        webviewTag: true
      }
    })

    // 挂载安全边界防护
    setupSecurityGuards(view.webContents, true)

    // 对内置 webview 挂载安全限制
    view.webContents.on('will-attach-webview', (_, webPreferences) => {
      delete (webPreferences as any).preload
      webPreferences.nodeIntegration = false
      webPreferences.contextIsolation = true
      webPreferences.sandbox = true
      webPreferences.allowRunningInsecureContent = false
    })

    // 加载自定义安全协议页面
    const pluginUrl = `doujiao-plugin://${pluginId}/index.html`
    view.webContents.loadURL(pluginUrl).catch((err) => {
      console.warn(`[PluginView] 加载插件页面失败 (${pluginUrl}):`, err.message)
    })

    return {
      pluginId,
      view,
      isAttached: false
    }
  }
}
