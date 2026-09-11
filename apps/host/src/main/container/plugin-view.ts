import { WebContentsView, BrowserWindow, app } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import { setupSecurityGuards } from '../security'

export interface PluginViewInstance {
  pluginId: string
  view: WebContentsView
  isAttached: boolean
}

const LIGHT_THEME_CSS = `
  /* 基础文档与根容器 */
  html, body, #root, .min-h-screen, .min-h-full, .h-screen {
    background-color: #f8fafc !important;
    color: #0f172a !important;
    color-scheme: light !important;
  }

  /* 页面底色类 */
  .bg-slate-950,
  .bg-\\[\\#0b0f19\\],
  .bg-\\[\\#0f172a\\],
  .bg-\\[\\#030712\\],
  .bg-\\[\\#0a0f1d\\],
  .bg-background {
    background-color: #f8fafc !important;
  }

  /* 面板、卡片与内容容器：全面支持 95/90/80/70/60/50/40/30/20 等各类半透明度 */
  .bg-slate-900,
  .bg-card,
  .bg-slate-950\\/95,
  .bg-slate-950\\/90,
  .bg-slate-950\\/85,
  .bg-slate-950\\/80,
  .bg-slate-950\\/70,
  .bg-slate-950\\/60,
  .bg-slate-950\\/50,
  .bg-slate-950\\/40,
  .bg-slate-950\\/30,
  .bg-slate-950\\/20,
  .bg-slate-900\\/95,
  .bg-slate-900\\/90,
  .bg-slate-900\\/85,
  .bg-slate-900\\/80,
  .bg-slate-900\\/70,
  .bg-slate-900\\/60,
  .bg-slate-900\\/50,
  .bg-slate-900\\/40,
  .bg-slate-900\\/30,
  .bg-slate-900\\/20 {
    background-color: #ffffff !important;
    box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.05) !important;
  }

  /* 次级内容/预览块/输入框容器：弱灰底色 */
  .bg-slate-800,
  .bg-slate-800\\/95,
  .bg-slate-800\\/90,
  .bg-slate-800\\/80,
  .bg-slate-800\\/70,
  .bg-slate-800\\/60,
  .bg-slate-800\\/50,
  .bg-slate-800\\/40,
  .bg-slate-800\\/30,
  .bg-slate-800\\/20,
  .bg-muted {
    background-color: #f1f5f9 !important;
  }

  /* 边框线条：覆盖各类透明度 */
  .border-slate-800,
  .border-slate-700,
  .border-slate-600,
  .border-slate-800\\/90,
  .border-slate-800\\/80,
  .border-slate-800\\/70,
  .border-slate-800\\/60,
  .border-slate-800\\/50,
  .border-slate-800\\/40,
  .border-slate-700\\/90,
  .border-slate-700\\/80,
  .border-slate-700\\/70,
  .border-slate-700\\/60,
  .border-slate-700\\/50,
  .border-slate-700\\/40,
  .border-slate-600\\/50,
  .border-border {
    border-color: #e2e8f0 !important;
  }

  /* 浮层半透明遮罩层保持半透明暗色，不被覆盖为纯白 */
  .fixed.inset-0:not([class*="bg-white"]):not([class*="bg-slate-50"]) {
    background-color: rgba(15, 23, 42, 0.55) !important;
  }

  /* 非彩色实心按钮的文字层级：全转为高对比深色 */
  .text-foreground {
    color: #0f172a !important;
  }

  .text-white:not(button):not(button *),
  .text-slate-100:not(button):not(button *),
  .text-slate-200:not(button):not(button *),
  .text-gray-100,
  .text-gray-200 {
    color: #0f172a !important;
  }

  .text-slate-300,
  .text-gray-300 {
    color: #334155 !important;
  }

  .text-slate-400,
  .text-gray-400,
  .text-muted-foreground {
    color: #475569 !important;
  }

  .text-slate-500,
  .text-gray-500 {
    color: #64748b !important;
  }

  /* 亮色模式下琥珀色按钮转为温暖活力的金橙渐变，杜绝暗沉泥色 */
  button[class*="bg-amber-600"],
  button[class*="bg-amber-700"] {
    background: linear-gradient(135deg, #f59e0b 0%, #ea580c 100%) !important;
    border-color: rgba(234, 88, 12, 0.4) !important;
  }
  button[class*="bg-amber-600"]:hover,
  button[class*="bg-amber-700"]:hover {
    background: linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%) !important;
  }

  /* 实心彩色按钮及其子元素文字保持纯白高对比 */
  button[class*="bg-indigo"]:not([class*="/"]):not([class*="bg-indigo-50"]):not([class*="bg-indigo-100"]),
  button[class*="bg-emerald"]:not([class*="/"]):not([class*="bg-emerald-50"]):not([class*="bg-emerald-100"]),
  button[class*="bg-rose"]:not([class*="/"]):not([class*="bg-rose-50"]):not([class*="bg-rose-100"]),
  button[class*="bg-amber"]:not([class*="/"]):not([class*="bg-amber-50"]):not([class*="bg-amber-100"]),
  button[class*="bg-blue"]:not([class*="/"]):not([class*="bg-blue-50"]):not([class*="bg-blue-100"]),
  button[class*="bg-gradient"],
  button[class*="bg-primary"]:not([class*="/"]) {
    color: #ffffff !important;
  }
  button[class*="bg-indigo"]:not([class*="/"]):not([class*="bg-indigo-50"]):not([class*="bg-indigo-100"]) *,
  button[class*="bg-emerald"]:not([class*="/"]):not([class*="bg-emerald-50"]):not([class*="bg-emerald-100"]) *,
  button[class*="bg-rose"]:not([class*="/"]):not([class*="bg-rose-50"]):not([class*="bg-rose-100"]) *,
  button[class*="bg-amber"]:not([class*="/"]):not([class*="bg-amber-50"]):not([class*="bg-amber-100"]) *,
  button[class*="bg-blue"]:not([class*="/"]):not([class*="bg-blue-50"]):not([class*="bg-blue-100"]) *,
  button[class*="bg-gradient"] *,
  button[class*="bg-primary"]:not([class*="/"]) * {
    color: #ffffff !important;
  }

  /* 弱色彩色半透明提示卡片与徽章内的文字颜色自适应深色 */
  [class*="bg-indigo-500\\/"],
  [class*="bg-indigo-600\\/"],
  [class*="bg-indigo-50"],
  [class*="bg-indigo-100"] {
    color: #4338ca !important;
  }
  [class*="bg-indigo-500\\/"] span,
  [class*="bg-indigo-500\\/"] p,
  [class*="bg-indigo-500\\/"] strong {
    color: #4338ca !important;
  }
  .text-indigo-400,
  .text-indigo-300 {
    color: #4f46e5 !important;
  }

  [class*="bg-emerald-500\\/"],
  [class*="bg-emerald-600\\/"],
  [class*="bg-emerald-50"],
  [class*="bg-emerald-100"] {
    color: #047857 !important;
  }
  [class*="bg-emerald-500\\/"] span,
  [class*="bg-emerald-500\\/"] p,
  [class*="bg-emerald-500\\/"] strong {
    color: #047857 !important;
  }
  .text-emerald-400,
  .text-emerald-300 {
    color: #059669 !important;
  }

  [class*="bg-amber-500\\/"],
  [class*="bg-amber-600\\/"],
  [class*="bg-amber-50"],
  [class*="bg-amber-100"] {
    color: #b45309 !important;
  }
  [class*="bg-amber-500\\/"] span,
  [class*="bg-amber-500\\/"] p,
  [class*="bg-amber-500\\/"] strong {
    color: #b45309 !important;
  }
  .text-amber-400,
  .text-amber-300 {
    color: #d97706 !important;
  }

  [class*="bg-rose-500\\/"],
  [class*="bg-rose-600\\/"],
  [class*="bg-rose-50"],
  [class*="bg-rose-100"] {
    color: #be123c !important;
  }
  [class*="bg-rose-500\\/"] span,
  [class*="bg-rose-500\\/"] p,
  [class*="bg-rose-500\\/"] strong {
    color: #be123c !important;
  }
  .text-rose-400,
  .text-rose-300 {
    color: #e11d48 !important;
  }

  /* 表单输入与文本框 */
  input:not([type="checkbox"]):not([type="radio"]):not([type="color"]),
  textarea,
  select {
    background-color: #ffffff !important;
    color: #0f172a !important;
    border-color: #cbd5e1 !important;
  }

  input::placeholder,
  textarea::placeholder {
    color: #94a3b8 !important;
  }

  /* 悬浮交互状态 */
  .hover\\:bg-slate-800:hover,
  .hover\\:bg-slate-700:hover,
  .hover\\:bg-slate-900:hover {
    background-color: #f1f5f9 !important;
  }

  .hover\\:text-white:hover,
  .hover\\:text-slate-200:hover {
    color: #0f172a !important;
  }

  .hover\\:border-slate-700:hover,
  .hover\\:border-slate-800:hover {
    border-color: #cbd5e1 !important;
  }

  /* 滚动条 */
  ::-webkit-scrollbar {
    width: 6px !important;
    height: 6px !important;
  }
  ::-webkit-scrollbar-track {
    background: transparent !important;
  }
  ::-webkit-scrollbar-thumb {
    background: #cbd5e1 !important;
    border-radius: 9999px !important;
  }
  ::-webkit-scrollbar-thumb:hover {
    background: #94a3b8 !important;
  }
`

const CYBER_THEME_CSS = `
  html, body, #root, .min-h-screen, .min-h-full, .h-screen {
    background-color: #030712 !important;
    color: #f0f9ff !important;
    color-scheme: dark !important;
  }

  .bg-slate-950,
  .bg-\\[\\#0b0f19\\],
  .bg-\\[\\#0f172a\\],
  .bg-\\[\\#0a0f1d\\] {
    background-color: #030712 !important;
  }

  .bg-slate-900 {
    background-color: #0a1526 !important;
  }

  .bg-slate-800 {
    background-color: #0f223d !important;
  }

  .bg-slate-950\\/80,
  .bg-slate-950\\/60,
  .bg-slate-950\\/40 {
    background-color: #081324 !important;
  }

  .bg-slate-900\\/90,
  .bg-slate-900\\/80,
  .bg-slate-900\\/60,
  .bg-slate-900\\/40 {
    background-color: #0d1b30 !important;
  }

  .border-slate-800,
  .border-slate-700,
  .border-slate-800\\/80,
  .border-slate-800\\/60,
  .border-slate-800\\/40,
  .border-slate-700\\/50 {
    border-color: #1a365d !important;
  }

  .text-white,
  .text-slate-100 {
    color: #f0f9ff !important;
  }

  .text-slate-200,
  .text-slate-300 {
    color: #bae6fd !important;
  }

  .text-slate-400 {
    color: #7dd3fc !important;
  }

  .text-slate-500 {
    color: #38bdf8 !important;
  }

  input:not([type="checkbox"]):not([type="radio"]):not([type="color"]),
  textarea,
  select {
    background-color: #050d19 !important;
    color: #f0f9ff !important;
    border-color: #1a365d !important;
  }

  input::placeholder,
  textarea::placeholder {
    color: #0369a1 !important;
  }

  .hover\\:bg-slate-800:hover,
  .hover\\:bg-slate-700:hover,
  .hover\\:bg-slate-900:hover {
    background-color: #132a4e !important;
  }

  ::-webkit-scrollbar {
    width: 6px !important;
    height: 6px !important;
  }
  ::-webkit-scrollbar-track {
    background: transparent !important;
  }
  ::-webkit-scrollbar-thumb {
    background: #1e3f73 !important;
    border-radius: 9999px !important;
  }
  ::-webkit-scrollbar-thumb:hover {
    background: #2b6cb0 !important;
  }
`

export class PluginViewContainerManager {
  private static instance: PluginViewContainerManager
  private views: Map<string, PluginViewInstance> = new Map()
  private mainWindow: BrowserWindow | null = null
  private activePluginId: string | null = null
  private currentBounds: Electron.Rectangle = { x: 220, y: 50, width: 980, height: 750 }
  private currentTheme: string = 'dark'

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

  public setTheme(theme: string): void {
    this.currentTheme = theme
    for (const instance of this.views.values()) {
      this.applyThemeToView(instance.view, theme)
    }
  }

  private getThemeScript(theme: string): string {
    const css = theme === 'light' ? LIGHT_THEME_CSS : theme === 'cyber' ? CYBER_THEME_CSS : ''
    const escapedCss = JSON.stringify(css)
    const escapedTheme = JSON.stringify(theme)
    return `
      (function() {
        try {
          const THEME_STYLE_ID = 'doujiao-injected-theme-style';
          document.documentElement.setAttribute('data-theme', ${escapedTheme});
          document.body.setAttribute('data-theme', ${escapedTheme});

          let styleEl = document.getElementById(THEME_STYLE_ID);
          if (${escapedTheme} === 'dark') {
            if (styleEl) styleEl.remove();
            return;
          }

          if (!styleEl) {
            styleEl = document.createElement('style');
            styleEl.id = THEME_STYLE_ID;
            document.head.appendChild(styleEl);
          }
          styleEl.textContent = ${escapedCss};
        } catch (e) {
          console.error('[Theme] 注入插件主题失败:', e);
        }
      })();
    `
  }

  private applyThemeToView(view: WebContentsView, theme: string): void {
    if (view.webContents.isDestroyed()) return
    const script = this.getThemeScript(theme)
    if (view.webContents.isLoading()) {
      view.webContents.once('did-finish-load', () => {
        if (!view.webContents.isDestroyed()) {
          view.webContents.executeJavaScript(script).catch(() => {})
        }
      })
    } else {
      view.webContents.executeJavaScript(script).catch(() => {})
    }
  }

  public setBounds(bounds: Electron.Rectangle): void {
    this.currentBounds = bounds
    this.updateViewBounds()
  }

  private sidebarWidth: number = 240
  private rightDrawerWidth: number = 0
  private leftOverlayWidth: number = 0

  public setSidebarWidth(width: number): void {
    if (typeof width === 'number' && width > 0) {
      this.sidebarWidth = width
      this.updateViewBounds()
    }
  }

  public setRightDrawerWidth(width: number): void {
    if (typeof width === 'number' && width >= 0) {
      this.rightDrawerWidth = width
      this.updateViewBounds()
    }
  }

  public setLeftOverlayWidth(_width: number): void {
    // 更多插件现已升级为完全悬浮在插件上方的浮动窗口，不再挤压或挪动主插件视口
    this.leftOverlayWidth = 0
  }

  private updateViewBounds(): void {
    if (!this.mainWindow || !this.activePluginId) return
    const instance = this.views.get(this.activePluginId)
    if (instance && instance.isAttached) {
      const windowBounds = this.mainWindow.getContentBounds()
      const effectiveLeft = this.sidebarWidth
      // 侧边栏宽度动态适配 (展开 240px，折叠 68px)，右侧抽屉动态适配 (打开 384px，关闭 0px)，顶部标题栏 50px
      const targetBounds = {
        x: effectiveLeft,
        y: 50,
        width: Math.max(100, windowBounds.width - effectiveLeft - this.rightDrawerWidth),
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
    this.applyThemeToView(instance.view, this.currentTheme)
  }

  public getActivePluginId(): string | null {
    return this.activePluginId
  }

  public getActivePluginView(): PluginViewInstance | undefined {
    if (!this.activePluginId) return undefined
    return this.views.get(this.activePluginId)
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

    // 监听页面加载完成，自动注入当前宿主主题样式
    view.webContents.on('did-finish-load', () => {
      this.applyThemeToView(view, this.currentTheme)
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
