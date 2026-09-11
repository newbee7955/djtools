import {
  app,
  BrowserWindow,
  desktopCapturer,
  screen,
  clipboard,
  nativeImage,
  globalShortcut,
  dialog,
  ipcMain,
  shell
} from 'electron'
import { join } from 'path'
import { existsSync, writeFileSync, unlinkSync, mkdirSync } from 'fs'
import { exec, execFile } from 'child_process'
import { PluginViewContainerManager } from '../container/plugin-view'

export interface ScreenCaptureOptions {
  hideWindow?: boolean
  mode?: 'snip' | 'fullscreen'
  trigger?: 'shortcut' | 'manual'
}

export interface ScreenCaptureResult {
  success: boolean
  canceled?: boolean
  dataUrl?: string
  bounds?: { x: number; y: number; width: number; height: number }
  error?: string
}

export class ScreenshotService {
  private static instance: ScreenshotService
  private mainWindow: BrowserWindow | null = null
  private captureWindow: BrowserWindow | null = null
  private isCapturing = false
  private pendingResolve: ((res: ScreenCaptureResult) => void) | null = null
  private currentCaptureData: {
    bgDataUrl: string
    screenW: number
    screenH: number
    scaleFactor: number
  } | null = null

  private constructor() {
    this.registerIpcHandlers()
  }

  public cancelCapture(): void {
    if (this.captureWindow && !this.captureWindow.isDestroyed()) {
      this.captureWindow.close()
      this.captureWindow = null
    }
    this.isCapturing = false
    this.currentCaptureData = null

    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      if (this.mainWindow.isMinimized()) this.mainWindow.restore()
      this.mainWindow.show()
      this.mainWindow.focus()
    }

    if (this.pendingResolve) {
      const cb = this.pendingResolve
      this.pendingResolve = null
      cb({ success: false, canceled: true })
    }
  }

  public static getInstance(): ScreenshotService {
    if (!ScreenshotService.instance) {
      ScreenshotService.instance = new ScreenshotService()
    }
    return ScreenshotService.instance
  }

  public init(mainWindow: BrowserWindow): void {
    this.mainWindow = mainWindow
    this.registerGlobalShortcuts()
  }

  /**
   * 注册全局快捷键 (默认 Alt+Shift+A 及 QQ截图习惯 Ctrl+Alt+A)
   */
  public registerGlobalShortcuts(): void {
    try {
      // 1. 默认快捷键 Alt + Shift + A
      const ok1 = globalShortcut.register('Alt+Shift+A', () => {
        console.log('[ScreenshotService] 触发全局截图快捷键: Alt+Shift+A')
        this.capture({ hideWindow: true, mode: 'snip', trigger: 'shortcut' })
      })
      if (!ok1) {
        console.warn('[ScreenshotService] 注册快捷键 Alt+Shift+A 失败 (可能被其他程序占用)')
      }

      // 2. 备用习惯快捷键 Ctrl + Alt + A (在 Windows / Linux 上广受欢迎)
      const ok2 = globalShortcut.register('CommandOrControl+Alt+A', () => {
        console.log('[ScreenshotService] 触发全局截图快捷键: Ctrl+Alt+A')
        this.capture({ hideWindow: true, mode: 'snip', trigger: 'shortcut' })
      })
      if (!ok2) {
        console.warn('[ScreenshotService] 注册快捷键 CommandOrControl+Alt+A 失败')
      }
    } catch (err) {
      console.error('[ScreenshotService] 注册全局截图快捷键异常:', err)
    }
  }

  public unregisterGlobalShortcuts(): void {
    try {
      globalShortcut.unregister('Alt+Shift+A')
      globalShortcut.unregister('CommandOrControl+Alt+A')
    } catch {}
  }

  /**
   * 核心截图入口方法 (供全局快捷键、宿主 IPC 与插件 SDK 统一调用)
   */
  public async capture(options?: ScreenCaptureOptions): Promise<ScreenCaptureResult> {
    if (this.isCapturing) {
      if (this.captureWindow && !this.captureWindow.isDestroyed()) {
        this.captureWindow.focus()
      }
      return { success: false, error: '截图进行中，请勿重复唤起' }
    }

    this.isCapturing = true
    const wasMainWindowVisible = Boolean(this.mainWindow && !this.mainWindow.isDestroyed() && this.mainWindow.isVisible())

    // 1. 如果需要隐藏主窗口，先隐藏并等待重绘
    if (options?.hideWindow !== false && wasMainWindowVisible && this.mainWindow) {
      this.mainWindow.hide()
      await new Promise((resolve) => setTimeout(resolve, 200))
    }

    try {
      // 2. 获取鼠标所在显示器
      const cursorPoint = screen.getCursorScreenPoint()
      const display = screen.getDisplayNearestPoint(cursorPoint)
      const { bounds, scaleFactor } = display

      // 3. 截取当前屏幕原生底图
      const fullImageDataUrl = await this.captureDisplay(display)
      if (!fullImageDataUrl) {
        throw new Error('未获取到有效屏幕截图数据')
      }

      // 4. 全屏直截模式 (不弹出选区遮罩)
      if (options?.mode === 'fullscreen') {
        const img = nativeImage.createFromDataURL(fullImageDataUrl)
        clipboard.writeImage(img)

        // 恢复主窗口
        if (wasMainWindowVisible || options?.trigger === 'shortcut') {
          this.mainWindow?.show()
          this.mainWindow?.focus()
        }
        const result: ScreenCaptureResult = { success: true, dataUrl: fullImageDataUrl }
        this.notifyActivePlugin(result)
        this.isCapturing = false
        return result
      }

      // 5. 交互式划选截图模式 (唤起全屏无边框置顶窗口)
      return await new Promise<ScreenCaptureResult>((resolve) => {
        this.pendingResolve = resolve
        this.currentCaptureData = {
          bgDataUrl: fullImageDataUrl,
          screenW: bounds.width,
          screenH: bounds.height,
          scaleFactor
        }

        const preloadPath = existsSync(join(__dirname, '../preload/screenshot.cjs'))
          ? join(__dirname, '../preload/screenshot.cjs')
          : existsSync(join(app.getAppPath(), 'out/preload/screenshot.cjs'))
          ? join(app.getAppPath(), 'out/preload/screenshot.cjs')
          : join(app.getAppPath(), 'apps/host/out/preload/screenshot.cjs')

        const captureWin = new BrowserWindow({
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height,
          frame: false,
          transparent: true,
          alwaysOnTop: true,
          skipTaskbar: true,
          resizable: false,
          movable: false,
          fullscreen: false,
          hasShadow: false,
          enableLargerThanScreen: true,
          backgroundColor: '#00000000',
          webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false,
            preload: preloadPath
          }
        })

        captureWin.setAlwaysOnTop(true, 'screen-saver')
        captureWin.setVisibleOnAllWorkspaces(true)
        this.captureWindow = captureWin

        // 安全防护 1：主进程级键盘事件监听，按 Esc 键保证 100% 立即退出，绝不卡死桌面
        captureWin.webContents.on('before-input-event', (_, input) => {
          if (input.key === 'Escape' && input.type === 'keyDown') {
            console.log('[ScreenshotService] 接收到底层 Esc 按键，退出截图模式')
            this.cancelCapture()
          }
        })

        // 安全防护 2：加载失败与崩溃守护
        captureWin.webContents.on('did-fail-load', (_, errorCode, errorDescription) => {
          console.error('[ScreenshotService] 截图层加载失败:', errorCode, errorDescription)
          this.cancelCapture()
        })
        captureWin.webContents.on('render-process-gone', (_, details) => {
          console.error('[ScreenshotService] 截图层渲染进程异常终止:', details)
          this.cancelCapture()
        })

        // 将轻量静态 HTML 模板写入 userData 缓存并以本地文件形式加载 (仅 ~25KB，彻底解决超长 data: URL 导致 Chromium 报错卡死的问题)
        const cacheDir = join(app.getPath('userData'), 'cache')
        if (!existsSync(cacheDir)) {
          mkdirSync(cacheDir, { recursive: true })
        }
        const overlayHtml = this.generateScreenshotHtml()
        const overlayHtmlPath = join(cacheDir, 'screenshot-overlay.html')
        writeFileSync(overlayHtmlPath, overlayHtml, 'utf-8')

        captureWin.loadFile(overlayHtmlPath).catch((loadErr) => {
          console.error('[ScreenshotService] 加载截图层文件失败:', loadErr)
          this.cancelCapture()
        })

        captureWin.on('closed', () => {
          this.captureWindow = null
          this.isCapturing = false
          this.currentCaptureData = null
          if (this.pendingResolve) {
            const cb = this.pendingResolve
            this.pendingResolve = null
            cb({ success: false, canceled: true })
          }
        })
      })
    } catch (err: any) {
      console.error('[ScreenshotService] 截图流程失败:', err)
      this.isCapturing = false
      if (wasMainWindowVisible && this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.show()
        this.mainWindow.focus()
      }
      return { success: false, error: err?.message || '屏幕捕获失败' }
    }
  }

  /**
   * 屏幕捕获引擎 (优先使用 Electron desktopCapturer，若异常自动回退至 Windows GDI BitBlt)
   */
  private async captureDisplay(display: Electron.Display): Promise<string | null> {
    const { bounds, scaleFactor } = display
    const captureW = Math.round(bounds.width * scaleFactor)
    const captureH = Math.round(bounds.height * scaleFactor)

    // 引擎 1: Electron desktopCapturer (附带 1.5 秒快速熔断)
    try {
      const getSourcesPromise = desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: captureW, height: captureH }
      })
      const timeoutPromise = new Promise<any[]>((_, reject) =>
        setTimeout(() => reject(new Error('desktopCapturer timeout')), 1500)
      )
      const sources = await Promise.race([getSourcesPromise, timeoutPromise])

      if (sources && sources.length > 0) {
        const target = sources.find((s) => s.display_id === String(display.id)) || sources[0]
        if (target && !target.thumbnail.isEmpty()) {
          const sz = target.thumbnail.getSize()
          if (sz.width > 0 && sz.height > 0) {
            const dataUrl = target.thumbnail.toDataURL()
            if (dataUrl && dataUrl.length > 500) {
              return dataUrl
            }
          }
        }
      }
    } catch (err: any) {
      console.warn('[ScreenshotService] desktopCapturer 捕获失败或超时，正在切换至 Windows GDI 引擎:', err?.message)
    }

    // 引擎 2: Windows GDI BitBlt 强力引擎 (使用 -EncodedCommand 杜绝任何字符与换行转义错误)
    if (process.platform === 'win32') {
      try {
        const gdiDataUrl = await this.captureViaGdi(bounds.width, bounds.height)
        if (gdiDataUrl) return gdiDataUrl
      } catch (gdiErr) {
        console.error('[ScreenshotService] GDI 引擎捕获失败:', gdiErr)
      }
    }

    return null
  }

  /**
   * Windows GDI BitBlt 屏幕捕获回退
   */
  private captureViaGdi(w: number, h: number): Promise<string | null> {
    return new Promise((resolve) => {
      const tempPng = join(app.getPath('temp'), `dj_cap_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.png`)
      const psScript = `
$code = @"
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
public class GdiCap {
    [DllImport("user32.dll")] public static extern IntPtr GetDesktopWindow();
    [DllImport("user32.dll")] public static extern IntPtr GetDC(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern int ReleaseDC(IntPtr hWnd, IntPtr hDC);
    [DllImport("gdi32.dll")] public static extern IntPtr CreateCompatibleDC(IntPtr hdc);
    [DllImport("gdi32.dll")] public static extern IntPtr CreateCompatibleBitmap(IntPtr hdc, int nWidth, int nHeight);
    [DllImport("gdi32.dll")] public static extern IntPtr SelectObject(IntPtr hdc, IntPtr hgdiobj);
    [DllImport("gdi32.dll")] public static extern bool BitBlt(IntPtr hdcDest, int nXDest, int nYDest, int nWidth, int nHeight, IntPtr hdcSrc, int nXSrc, int nYSrc, int dwRop);
    [DllImport("gdi32.dll")] public static extern bool DeleteDC(IntPtr hdc);
    [DllImport("gdi32.dll")] public static extern bool DeleteObject(IntPtr hObject);
    [DllImport("user32.dll")] public static extern int GetSystemMetrics(int nIndex);
    public static Bitmap Capture() {
        int w = GetSystemMetrics(0);
        int h = GetSystemMetrics(1);
        IntPtr desk = GetDesktopWindow();
        IntPtr hdcSrc = GetDC(desk);
        IntPtr hdcDest = CreateCompatibleDC(hdcSrc);
        IntPtr hBmp = CreateCompatibleBitmap(hdcSrc, w, h);
        IntPtr hOld = SelectObject(hdcDest, hBmp);
        BitBlt(hdcDest, 0, 0, w, h, hdcSrc, 0, 0, 0x00CC0020);
        SelectObject(hdcDest, hOld);
        DeleteDC(hdcDest);
        ReleaseDC(desk, hdcSrc);
        Bitmap bmp = Image.FromHbitmap(hBmp);
        DeleteObject(hBmp);
        return bmp;
    }
}
"@
Add-Type -TypeDefinition $code -ReferencedAssemblies System.Drawing
$b = [GdiCap]::Capture()
$b.Save('${tempPng.replace(/\\/g, '\\\\')}', [System.Drawing.Imaging.ImageFormat]::Png)
$b.Dispose()
`
      const encoded = Buffer.from(psScript, 'utf16le').toString('base64')
      execFile(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
        { timeout: 8000 },
        (err) => {
          if (!err && existsSync(tempPng)) {
            try {
              const img = nativeImage.createFromPath(tempPng)
              unlinkSync(tempPng)
              if (!img.isEmpty()) {
                resolve(img.toDataURL())
                return
              }
            } catch (readErr) {
              console.error('[ScreenshotService] 读取 GDI 截图文件失败:', readErr)
            }
          } else {
            console.error('[ScreenshotService] GDI 截图执行失败:', err)
          }
          resolve(null)
        }
      )
    })
  }

  /**
   * 将截图数据通知给当前处于活跃展示状态的插件（不切换视图，不强制改变用户当前所在页面）
   */
  public notifyActivePlugin(result: ScreenCaptureResult): void {
    try {
      const containerManager = PluginViewContainerManager.getInstance()
      const activeInstance = containerManager.getActivePluginView()
      if (activeInstance?.view?.webContents && !activeInstance.view.webContents.isDestroyed()) {
        activeInstance.view.webContents.send('plugin:screen:captured', result)
      }
    } catch (err) {
      console.error('[ScreenshotService] 通知当前活跃插件截图失败:', err)
    }
  }

  /**
   * @deprecated 兼容保留旧方法签名，仅通知活跃插件而不再执行强制切换
   */
  public async activateImageEditor(result: ScreenCaptureResult): Promise<void> {
    this.notifyActivePlugin(result)
  }

  /**
   * 注册主进程与截图弹窗 / 插件之间的通信事件
   */
  private registerIpcHandlers(): void {
    // 0. 获取截图初始底图与尺寸 (通过 IPC 安全传递，避免超长 URL 崩溃卡死)
    ipcMain.handle('host:screenshot:get-initial-data', async () => {
      return this.currentCaptureData
    })

    // 截图完成 (带选区裁剪后结果)
    ipcMain.handle(
      'host:screenshot:finish',
      async (_, payload: { dataUrl: string; bounds?: { x: number; y: number; width: number; height: number } }) => {
        const { dataUrl, bounds } = payload

        // 1. 自动存入系统剪贴板
        if (dataUrl) {
          const img = nativeImage.createFromDataURL(dataUrl)
          clipboard.writeImage(img)
        }

        // 2. 关闭截图选区窗口
        if (this.captureWindow && !this.captureWindow.isDestroyed()) {
          this.captureWindow.close()
          this.captureWindow = null
        }
        this.isCapturing = false
        this.currentCaptureData = null

        // 3. 唤醒并聚焦主窗口
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          if (this.mainWindow.isMinimized()) this.mainWindow.restore()
          this.mainWindow.show()
          this.mainWindow.focus()
        }

        // 4. 通知当前活跃视图（若有），不再强制跳转切入图片编辑插件
        const result: ScreenCaptureResult = { success: true, dataUrl, bounds }
        this.notifyActivePlugin(result)

        // 5. 回调 resolve (如由插件 API 调用)
        if (this.pendingResolve) {
          const cb = this.pendingResolve
          this.pendingResolve = null
          cb(result)
        }
        return { success: true }
      }
    )

    // 取消截图
    ipcMain.handle('host:screenshot:cancel', async () => {
      this.cancelCapture()
      return { success: true }
    })

    // 单独写入剪贴板并退出截图
    ipcMain.handle('host:screenshot:copy', async (_, dataUrl: string) => {
      if (dataUrl) {
        const img = nativeImage.createFromDataURL(dataUrl)
        clipboard.writeImage(img)
      }
      if (this.captureWindow && !this.captureWindow.isDestroyed()) {
        this.captureWindow.close()
        this.captureWindow = null
      }
      this.isCapturing = false

      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.show()
        this.mainWindow.focus()
      }

      if (this.pendingResolve) {
        const cb = this.pendingResolve
        this.pendingResolve = null
        cb({ success: true, dataUrl })
      }
      return { success: true }
    })

    // 另存为文件并退出截图
    ipcMain.handle('host:screenshot:save-as', async (_, dataUrl: string) => {
      if (!dataUrl) return { canceled: true }
      const res = await dialog.showSaveDialog({
        title: '保存截图为图片',
        defaultPath: `截图_${Date.now()}.png`,
        filters: [{ name: 'PNG Image', extensions: ['png'] }]
      })
      if (!res.canceled && res.filePath) {
        const base64Data = dataUrl.replace(/^data:image\/\w+;base64,/, '')
        writeFileSync(res.filePath, Buffer.from(base64Data, 'base64'))
        shell.showItemInFolder(res.filePath)
      }

      if (this.captureWindow && !this.captureWindow.isDestroyed()) {
        this.captureWindow.close()
        this.captureWindow = null
      }
      this.isCapturing = false

      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.show()
        this.mainWindow.focus()
      }

      if (this.pendingResolve) {
        const cb = this.pendingResolve
        this.pendingResolve = null
        cb({ success: true, dataUrl })
      }
      return { success: true }
    })
  }

  /**
   * 生成交互式全屏划选截图 HTML
   */
  private generateScreenshotHtml(): string {
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <title>Screen Capture Overlay</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; user-select: none; }
    html, body {
      width: 100vw; height: 100vh;
      overflow: hidden;
      background: transparent;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif;
    }
    #canvas, #anno-canvas {
      position: absolute;
      left: 0; top: 0;
      width: 100vw; height: 100vh;
      display: block;
    }
    #anno-canvas { z-index: 10; pointer-events: none; }
    #toolbar, #anno-toolbar {
      position: absolute;
      display: none;
      align-items: center;
      gap: 5px;
      padding: 6px 10px;
      background: rgba(255, 255, 255, 0.98);
      border: 1px solid rgba(203, 213, 225, 0.95);
      border-radius: 12px;
      box-shadow: 0 10px 30px -5px rgba(0,0,0,0.22), 0 2px 8px rgba(0,0,0,0.06);
      backdrop-filter: blur(16px);
      z-index: 100;
      color: #1e293b;
      font-size: 12px;
      pointer-events: auto;
    }
    .btn {
      display: inline-flex; align-items: center; gap: 5px;
      padding: 5px 10px; border-radius: 8px; border: 1px solid transparent;
      cursor: pointer; font-size: 12px; font-weight: 500;
      transition: all .15s; line-height: 1;
    }
    .btn:active { transform: scale(.96); }
    .btn svg { width: 14px; height: 14px; flex-shrink: 0; pointer-events: none; }
    .btn-primary {
      background: #0284c7; color: #ffffff;
      border-color: #0284c7;
      box-shadow: 0 1px 3px rgba(2, 132, 199, 0.35);
    }
    .btn-primary:hover { background: #0369a1; border-color: #0369a1; }
    .btn-secondary {
      background: #f8fafc; color: #334155;
      border-color: #cbd5e1;
    }
    .btn-secondary:hover {
      background: #f1f5f9; color: #0f172a;
      border-color: #94a3b8;
    }
    .btn-danger {
      background: #fef2f2; color: #ef4444;
      border-color: #fecaca;
    }
    .btn-danger:hover {
      background: #ef4444; color: #ffffff;
      border-color: #ef4444;
    }
    .btn-tool {
      display: inline-flex; align-items: center; justify-content: center;
      width: 30px; height: 30px; border-radius: 8px;
      border: 1px solid #e2e8f0;
      cursor: pointer; background: #f8fafc; color: #334155;
      transition: all .15s; flex-shrink: 0;
    }
    .btn-tool svg {
      width: 16px; height: 16px; flex-shrink: 0; pointer-events: none;
    }
    .btn-tool:hover {
      background: #f1f5f9; color: #0f172a;
      border-color: #cbd5e1;
    }
    .btn-tool.active {
      background: #0284c7; color: #ffffff;
      border-color: #0284c7;
      box-shadow: 0 2px 6px rgba(2, 132, 199, 0.35);
    }
    .divider {
      width: 1px; height: 18px; background: #e2e8f0;
      margin: 0 3px; flex-shrink: 0;
    }
    .color-dot {
      width: 18px; height: 18px; border-radius: 50%; cursor: pointer;
      border: 2px solid rgba(0, 0, 0, 0.15);
      transition: all .15s; flex-shrink: 0;
    }
    .color-dot:hover { transform: scale(1.2); }
    .color-dot.active {
      border-color: #0284c7;
      transform: scale(1.18);
      box-shadow: 0 0 0 2px #bae6fd, 0 1px 4px rgba(0,0,0,0.2);
    }
    .width-btn {
      cursor: pointer; border-radius: 6px; padding: 3px 8px;
      background: #f8fafc; border: 1px solid #e2e8f0; color: #475569;
      font-size: 11px; font-weight: 600; transition: all .15s;
    }
    .width-btn:hover {
      background: #f1f5f9; color: #0f172a;
      border-color: #cbd5e1;
    }
    .width-btn.active {
      background: #0284c7; border-color: #0284c7; color: #ffffff;
      box-shadow: 0 1px 3px rgba(2, 132, 199, 0.3);
    }
    #size-badge {
      position: absolute; display: none;
      padding: 4px 8px; background: #0284c7; color: #fff;
      border-radius: 6px; font-size: 11px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-weight: 600; box-shadow: 0 4px 12px rgba(2, 132, 199, 0.35);
      pointer-events: none; z-index: 90; white-space: nowrap;
    }
    #magnifier {
      position: absolute; flex-direction: column;
      width: 128px; height: 146px; border-radius: 10px;
      border: 2px solid #0284c7; background: rgba(255, 255, 255, 0.98);
      box-shadow: 0 10px 25px rgba(0,0,0,0.25);
      pointer-events: none; z-index: 80; overflow: hidden; display: none;
    }
    #mag-canvas { width: 128px; height: 96px; background: #000; }
    #mag-info {
      padding: 5px 8px; font-size: 10px; color: #475569;
      display: flex; flex-direction: column; gap: 2px; background: #ffffff;
      border-top: 1px solid #e2e8f0;
    }
    #mag-info .coords { color: #0284c7; font-family: monospace; font-weight: 600; }
    #guide-banner {
      position: absolute; top: 18px; left: 50%; transform: translateX(-50%);
      padding: 7px 20px; background: rgba(255, 255, 255, 0.96);
      border: 1px solid rgba(203, 213, 225, 0.9); border-radius: 24px;
      color: #1e293b; font-size: 12px; font-weight: 500;
      box-shadow: 0 8px 30px rgba(0,0,0,0.18); backdrop-filter: blur(16px);
      pointer-events: none; z-index: 100;
      display: flex; align-items: center; gap: 10px;
    }
    .kbd {
      padding: 2px 7px; background: #f1f5f9;
      border: 1px solid #cbd5e1; border-radius: 5px;
      font-size: 11px; font-family: monospace; color: #0284c7;
      font-weight: 600;
    }
    #text-input-overlay {
      position: absolute; display: none; z-index: 250;
      pointer-events: auto;
    }
    #text-input-overlay textarea {
      background: rgba(255, 255, 255, 0.98); border: 2px dashed #0284c7;
      border-radius: 6px; color: #f43f5e; caret-color: #0284c7;
      outline: none; resize: both;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif;
      font-weight: bold; min-width: 140px; min-height: 38px; padding: 6px 10px;
      user-select: text !important; -webkit-user-select: text !important;
      box-shadow: 0 6px 20px rgba(0,0,0,0.2); backdrop-filter: blur(8px);
    }
    #text-input-overlay textarea::placeholder {
      color: rgba(148, 163, 184, 0.8); font-weight: normal;
    }
  </style>
</head>
<body>
  <div id="guide-banner">
    <span>拖拽鼠标划选截图区域</span>
    <span class="kbd">Enter 完成</span>
    <span class="kbd">Space 全屏</span>
    <span class="kbd">Esc 取消</span>
  </div>

  <canvas id="canvas"></canvas>
  <canvas id="anno-canvas"></canvas>
  <div id="size-badge">0 × 0</div>

  <div id="magnifier">
    <canvas id="mag-canvas" width="120" height="90"></canvas>
    <div id="mag-info">
      <span class="coords" id="mag-coords">X: 0, Y: 0</span>
      <span id="mag-color">RGB: --</span>
    </div>
  </div>

  <!-- 标注工具栏 (划选后出现在选区上方) -->
  <div id="anno-toolbar">
    <button class="btn-tool active" id="tool-rect" title="矩形框选">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2"/>
      </svg>
    </button>
    <button class="btn-tool" id="tool-arrow" title="箭头">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M5 12h14M13 6l6 6-6 6"/>
      </svg>
    </button>
    <button class="btn-tool" id="tool-pen" title="画笔涂鸦">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>
      </svg>
    </button>
    <button class="btn-tool" id="tool-text" title="文字输入">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="4 7 4 4 20 4 20 7"/>
        <line x1="9" y1="20" x2="15" y2="20"/>
        <line x1="12" y1="4" x2="12" y2="20"/>
      </svg>
    </button>
    <button class="btn-tool" id="tool-mosaic" title="马赛克遮罩">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="3" width="7" height="7" rx="1" fill="currentColor"/>
        <rect x="14" y="3" width="7" height="7" rx="1"/>
        <rect x="3" y="14" width="7" height="7" rx="1"/>
        <rect x="14" y="14" width="7" height="7" rx="1" fill="currentColor"/>
      </svg>
    </button>
    <div class="divider"></div>
    <div class="color-dot active" style="background:#f43f5e" data-color="#f43f5e" title="红色"></div>
    <div class="color-dot" style="background:#f97316" data-color="#f97316" title="橙色"></div>
    <div class="color-dot" style="background:#eab308" data-color="#eab308" title="黄色"></div>
    <div class="color-dot" style="background:#22c55e" data-color="#22c55e" title="绿色"></div>
    <div class="color-dot" style="background:#3b82f6" data-color="#3b82f6" title="蓝色"></div>
    <div class="color-dot" style="background:#a855f7" data-color="#a855f7" title="紫色"></div>
    <div class="color-dot" style="background:#ffffff;border:2px solid #cbd5e1" data-color="#ffffff" title="白色"></div>
    <div class="color-dot" style="background:#000000;border:2px solid #94a3b8" data-color="#000000" title="黑色"></div>
    <div class="divider"></div>
    <span class="width-btn active" data-w="2">细</span>
    <span class="width-btn" data-w="4">中</span>
    <span class="width-btn" data-w="7">粗</span>
    <div class="divider"></div>
    <button class="btn-tool" id="btn-undo" title="撤销 (Ctrl+Z)">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M9 14 4 9l5-5"/>
        <path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5 5.5 5.5 0 0 1-5.5 5.5H11"/>
      </svg>
    </button>
  </div>

  <!-- 主操作工具栏 (划选后出现在选区下方) -->
  <div id="toolbar">
    <button class="btn btn-secondary" id="btn-fullscreen" title="全屏 (Space)">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
      </svg>
      全屏
    </button>
    <button class="btn btn-secondary" id="btn-save" title="另存为 (Ctrl+S)">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
        <polyline points="17 21 17 13 7 13 7 21"/>
        <polyline points="7 3 7 8 15 8"/>
      </svg>
      另存
    </button>
    <button class="btn btn-secondary" id="btn-copy" title="复制到剪贴板 (Ctrl+C)">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="9" y="9" width="13" height="13" rx="2"/>
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
      </svg>
      复制
    </button>
    <div class="divider"></div>
    <button class="btn btn-primary" id="btn-finish" title="完成并复制 (Enter)">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="20 6 9 17 4 12"/>
      </svg>
      完成
    </button>
    <button class="btn btn-danger" id="btn-cancel" title="取消 (Esc)">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <line x1="18" y1="6" x2="6" y2="18"/>
        <line x1="6" y1="6" x2="18" y2="18"/>
      </svg>
    </button>
  </div>

  <div id="text-input-overlay">
    <textarea id="text-input" placeholder="输入文字 (Enter提交)" rows="1" cols="14"></textarea>
  </div>

  <script>
    (async function() {
      let attempts = 0;
      while (!window.screenshotAPI?.getInitialData && attempts < 30) {
        await new Promise((r) => setTimeout(r, 40));
        attempts++;
      }

      let bgDataUrl = '';
      let screenW = window.innerWidth;
      let screenH = window.innerHeight;
      let scaleFactor = window.devicePixelRatio || 1;

      try {
        if (window.screenshotAPI?.getInitialData) {
          const initData = await window.screenshotAPI.getInitialData();
          if (initData && initData.bgDataUrl) {
            bgDataUrl = initData.bgDataUrl;
            screenW = initData.screenW || screenW;
            screenH = initData.screenH || screenH;
            scaleFactor = initData.scaleFactor || scaleFactor;
          }
        }
      } catch (err) {
        console.error('获取截图初始数据失败:', err);
      }

      if (!bgDataUrl) {
        if (window.screenshotAPI?.cancel) {
          window.screenshotAPI.cancel();
        } else {
          window.close();
        }
        return;
      }

    // ── DOM 引用 ─────────────────────────────────────────────────────────
    const canvas      = document.getElementById('canvas');
    const ctx         = canvas.getContext('2d');
    const annoCanvas  = document.getElementById('anno-canvas');
    const annoCtx     = annoCanvas.getContext('2d');
    const toolbar     = document.getElementById('toolbar');
    const annoToolbar = document.getElementById('anno-toolbar');
    const sizeBadge   = document.getElementById('size-badge');
    const guideBanner = document.getElementById('guide-banner');
    const magnifier   = document.getElementById('magnifier');
    const magCanvas   = document.getElementById('mag-canvas');
    const magCtx      = magCanvas.getContext('2d');
    const magCoords   = document.getElementById('mag-coords');
    const magColor    = document.getElementById('mag-color');
    const textOverlay = document.getElementById('text-input-overlay');
    const textInput   = document.getElementById('text-input');

    // ── 底图加载 ──────────────────────────────────────────────────────────
    const bgImg = new Image();
    let isImgLoaded = false;
    bgImg.onload = () => { isImgLoaded = true; resizeCanvases(); };
    bgImg.src = bgDataUrl;
    window.addEventListener('resize', resizeCanvases);

    function resizeCanvases() {
      const dpr = window.devicePixelRatio || 1;
      const w = window.innerWidth * dpr;
      const h = window.innerHeight * dpr;
      canvas.width = w; canvas.height = h;
      ctx.scale(dpr, dpr);
      annoCanvas.width = w; annoCanvas.height = h;
      annoCtx.scale(dpr, dpr);
      render();
    }

    // ── 选区状态 ──────────────────────────────────────────────────────────
    let isSelecting = false, isMoving = false, isResizing = false;
    let activeHandle = null;
    let startX = 0, startY = 0, moveStartX = 0, moveStartY = 0;
    let rectStartX = 0, rectStartY = 0;
    let cropRect = { x: 0, y: 0, width: 0, height: 0 };
    const HANDLE_SIZE = 8;

    // ── 标注工具状态 ───────────────────────────────────────────────────────
    let phase = 'select'; // 'select' | 'edit'
    let currentTool = 'rect';
    let drawColor = '#f43f5e';
    let drawWidth = 2;
    let isDrawing = false;
    let drawX0 = 0, drawY0 = 0;
    let drawSnapshot = null; // ImageData for rect/arrow preview
    let annoHistory = [];    // undo stack (max 20)
    let penPath = [];        // points for pen tool

    // ── 主 Canvas 渲染 ────────────────────────────────────────────────────
    function render() {
      if (!isImgLoaded) return;
      const w = window.innerWidth, h = window.innerHeight;
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(bgImg, 0, 0, w, h);
      ctx.fillStyle = 'rgba(0,0,0,.45)';
      ctx.fillRect(0, 0, w, h);
      if (cropRect.width > 0 && cropRect.height > 0) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(cropRect.x, cropRect.y, cropRect.width, cropRect.height);
        ctx.clip();
        ctx.drawImage(bgImg, 0, 0, w, h);
        ctx.restore();
        ctx.strokeStyle = '#0284c7'; ctx.lineWidth = 2;
        ctx.strokeRect(cropRect.x, cropRect.y, cropRect.width, cropRect.height);
        if (phase === 'select') {
          const handles = getHandles();
          ctx.fillStyle = '#38bdf8'; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5;
          for (const k in handles) {
            const p = handles[k];
            ctx.fillRect(p.x - HANDLE_SIZE/2, p.y - HANDLE_SIZE/2, HANDLE_SIZE, HANDLE_SIZE);
            ctx.strokeRect(p.x - HANDLE_SIZE/2, p.y - HANDLE_SIZE/2, HANDLE_SIZE, HANDLE_SIZE);
          }
        }
      }
    }

    function getHandles() {
      const { x, y, width: w, height: h } = cropRect;
      return {
        nw:{x,y}, n:{x:x+w/2,y}, ne:{x:x+w,y},
        e:{x:x+w,y:y+h/2}, se:{x:x+w,y:y+h},
        s:{x:x+w/2,y:y+h}, sw:{x,y:y+h}, w:{x,y:y+h/2}
      };
    }

    function hitTestHandle(mx, my) {
      if (cropRect.width <= 0) return null;
      const handles = getHandles(), r = HANDLE_SIZE + 4;
      for (const k in handles) {
        const p = handles[k];
        if (Math.abs(mx - p.x) <= r && Math.abs(my - p.y) <= r) return k;
      }
      return null;
    }
    function hitTestInside(mx, my) {
      return mx >= cropRect.x && mx <= cropRect.x + cropRect.width &&
             my >= cropRect.y && my <= cropRect.y + cropRect.height;
    }

    // ── 进入编辑阶段 ───────────────────────────────────────────────────────
    function enterEditMode() {
      phase = 'edit';
      annoCanvas.style.pointerEvents = 'auto';
      document.body.style.cursor = 'crosshair';
      guideBanner.style.display = 'none';
      annoToolbar.style.display = 'flex';
      toolbar.style.display = 'flex';
      updateAnnoToolbarPos();
      updateToolbarPos();
      // Remove selection handles from bg canvas
      render();
    }

    function updateAnnoToolbarPos() {
      const tbW = annoToolbar.offsetWidth || 500;
      let left = cropRect.x;
      let top = cropRect.y - 48;
      if (top < 8) top = cropRect.y + cropRect.height + 10;
      if (left + tbW > window.innerWidth - 8) left = window.innerWidth - tbW - 8;
      if (left < 8) left = 8;
      annoToolbar.style.left = left + 'px';
      annoToolbar.style.top  = top + 'px';
    }

    function updateToolbarPos() {
      const tbW = toolbar.offsetWidth || 340, tbH = toolbar.offsetHeight || 42;
      let left = cropRect.x + cropRect.width - tbW;
      let top  = cropRect.y + cropRect.height + (phase === 'edit' ? 52 : 10);
      if (left < 8) left = 8;
      if (left + tbW > window.innerWidth - 8) left = window.innerWidth - tbW - 8;
      if (top + tbH > window.innerHeight - 8) top = cropRect.y - tbH - 10;
      if (top < 8) top = cropRect.y + 8;
      toolbar.style.left = left + 'px';
      toolbar.style.top  = top + 'px';
    }

    function updateSizeBadge() {
      const rW = Math.round(cropRect.width * scaleFactor);
      const rH = Math.round(cropRect.height * scaleFactor);
      sizeBadge.textContent = rW + ' × ' + rH + ' px';
      let top = cropRect.y - 26;
      if (top < 10) top = cropRect.y + 8;
      sizeBadge.style.left = cropRect.x + 'px';
      sizeBadge.style.top  = top + 'px';
    }

    // ── 标注历史 ──────────────────────────────────────────────────────────
    function pushAnnoHistory() {
      if (annoHistory.length >= 20) annoHistory.shift();
      annoHistory.push(annoCtx.getImageData(0, 0, annoCanvas.width, annoCanvas.height));
    }

    function undoAnno() {
      if (annoHistory.length === 0) { annoCtx.clearRect(0, 0, window.innerWidth, window.innerHeight); return; }
      const prev = annoHistory.pop();
      annoCtx.putImageData(prev, 0, 0);
    }

    // ── 标注绘制核心 ───────────────────────────────────────────────────────
    // Clip annoCtx to cropRect so drawing doesn't go outside the selection
    function clipAnno() {
      annoCtx.save();
      annoCtx.beginPath();
      annoCtx.rect(cropRect.x, cropRect.y, cropRect.width, cropRect.height);
      annoCtx.clip();
    }

    function drawArrowhead(ctx2, x1, y1, x2, y2, size) {
      const angle = Math.atan2(y2 - y1, x2 - x1);
      const a = Math.PI / 7;
      ctx2.beginPath();
      ctx2.moveTo(x2, y2);
      ctx2.lineTo(x2 - size * Math.cos(angle - a), y2 - size * Math.sin(angle - a));
      ctx2.moveTo(x2, y2);
      ctx2.lineTo(x2 - size * Math.cos(angle + a), y2 - size * Math.sin(angle + a));
      ctx2.stroke();
    }

    function drawMosaicBlock(cx, cy, blockSize) {
      // Sample background at the block's center and fill rectangle
      const ratioX = bgImg.naturalWidth / window.innerWidth;
      const ratioY = bgImg.naturalHeight / window.innerHeight;
      const offTemp = document.createElement('canvas');
      offTemp.width = 1; offTemp.height = 1;
      const tmpCtx = offTemp.getContext('2d');
      tmpCtx.drawImage(bgImg,
        Math.max(0, cx * ratioX - 1), Math.max(0, cy * ratioY - 1), 2, 2,
        0, 0, 1, 1);
      const px = tmpCtx.getImageData(0, 0, 1, 1).data;
      annoCtx.fillStyle = 'rgb(' + px[0] + ',' + px[1] + ',' + px[2] + ')';
      annoCtx.fillRect(cx - blockSize/2, cy - blockSize/2, blockSize, blockSize);
    }

    function applyMosaicInRect(x1, y1, x2, y2) {
      const block = Math.max(10, Math.min(20, drawWidth * 4));
      const lx = Math.min(x1, x2), ly = Math.min(y1, y2);
      const rx = Math.max(x1, x2), ry = Math.max(y1, y2);
      const ratioX = bgImg.naturalWidth / window.innerWidth;
      const ratioY = bgImg.naturalHeight / window.innerHeight;
      const offTemp = document.createElement('canvas');
      offTemp.width = annoCanvas.width; offTemp.height = annoCanvas.height;
      const tctx = offTemp.getContext('2d');
      tctx.drawImage(bgImg, 0, 0, window.innerWidth, window.innerHeight);
      clipAnno();
      for (let bx = lx; bx < rx; bx += block) {
        for (let by = ly; by < ry; by += block) {
          const bw = Math.min(block, rx - bx);
          const bh = Math.min(block, ry - by);
          const cx = bx + bw / 2, cy = by + bh / 2;
          const data = tctx.getImageData(
            Math.round(cx / window.innerWidth * offTemp.width),
            Math.round(cy / window.innerHeight * offTemp.height),
            1, 1).data;
          annoCtx.fillStyle = 'rgb(' + data[0] + ',' + data[1] + ',' + data[2] + ')';
          annoCtx.fillRect(bx, by, bw, bh);
        }
      }
      annoCtx.restore();
    }

    // ── Anno Canvas 鼠标事件 ───────────────────────────────────────────────
    let textJustOpened = false;

    annoCanvas.addEventListener('mousedown', (e) => {
      if (phase !== 'edit' || e.button !== 0) return;
      if (annoToolbar.contains(e.target) || toolbar.contains(e.target)) return;
      if (textOverlay.contains(e.target)) return;

      if (currentTool === 'text') {
        commitTextIfActive();
        if (!hitTestInside(e.clientX, e.clientY)) return;
        e.preventDefault();
        e.stopPropagation();
        openTextInput(e.clientX, e.clientY);
        return;
      }

      isDrawing = true;
      drawX0 = e.clientX; drawY0 = e.clientY;
      penPath = [{ x: e.clientX, y: e.clientY }];

      if (currentTool !== 'pen' && currentTool !== 'mosaic') {
        pushAnnoHistory();
        drawSnapshot = annoCtx.getImageData(0, 0, annoCanvas.width, annoCanvas.height);
      } else if (currentTool === 'pen' || currentTool === 'mosaic') {
        pushAnnoHistory();
      }
    });

    annoCanvas.addEventListener('mousemove', (e) => {
      if (!isDrawing || phase !== 'edit') return;
      if (currentTool === 'text') return;
      const mx = e.clientX, my = e.clientY;

      if (currentTool === 'pen') {
        penPath.push({ x: mx, y: my });
        clipAnno();
        annoCtx.strokeStyle = drawColor;
        annoCtx.lineWidth = drawWidth;
        annoCtx.lineCap = 'round'; annoCtx.lineJoin = 'round';
        annoCtx.beginPath();
        const prev = penPath[penPath.length - 2];
        annoCtx.moveTo(prev.x, prev.y);
        annoCtx.lineTo(mx, my);
        annoCtx.stroke();
        annoCtx.restore();
        return;
      }

      if (currentTool === 'mosaic') {
        const block = Math.max(10, Math.min(20, drawWidth * 4));
        clipAnno();
        drawMosaicBlock(mx, my, block);
        annoCtx.restore();
        return;
      }

      // rect / arrow: preview on top of snapshot
      if (drawSnapshot) {
        annoCtx.putImageData(drawSnapshot, 0, 0);
      }
      clipAnno();
      annoCtx.strokeStyle = drawColor;
      annoCtx.lineWidth = drawWidth;
      annoCtx.lineCap = 'round'; annoCtx.lineJoin = 'round';

      if (currentTool === 'rect') {
        const rx = Math.min(drawX0, mx), ry = Math.min(drawY0, my);
        const rw = Math.abs(mx - drawX0), rh = Math.abs(my - drawY0);
        annoCtx.strokeRect(rx, ry, rw, rh);
      } else if (currentTool === 'arrow') {
        const headSize = Math.max(12, drawWidth * 5);
        annoCtx.beginPath();
        annoCtx.moveTo(drawX0, drawY0);
        annoCtx.lineTo(mx, my);
        annoCtx.stroke();
        drawArrowhead(annoCtx, drawX0, drawY0, mx, my, headSize);
      }
      annoCtx.restore();
    });

    annoCanvas.addEventListener('mouseup', (e) => {
      if (!isDrawing || phase !== 'edit') return;
      isDrawing = false;
      drawSnapshot = null;

      if (currentTool === 'mosaic') {
        applyMosaicInRect(drawX0, drawY0, e.clientX, e.clientY);
      }
    });

    // ── 文字工具 ───────────────────────────────────────────────────────────
    function openTextInput(x, y) {
      const minX = cropRect.x + 4;
      const maxX = Math.max(minX, cropRect.x + cropRect.width - 150);
      const minY = cropRect.y + 4;
      const maxY = Math.max(minY, cropRect.y + cropRect.height - 44);
      const posX = Math.max(minX, Math.min(maxX, x));
      const posY = Math.max(minY, Math.min(maxY, y));

      const size = Math.max(14, drawWidth * 5);
      textInput.style.fontSize = size + 'px';
      textInput.style.color = drawColor;
      textInput.style.borderColor = drawColor;
      textInput.style.caretColor = drawColor;
      textOverlay.style.left = posX + 'px';
      textOverlay.style.top  = posY + 'px';
      textOverlay.style.display = 'block';
      textInput.value = '';

      textJustOpened = true;
      setTimeout(() => {
        textInput.focus();
        setTimeout(() => { textJustOpened = false; }, 150);
      }, 30);
    }

    function commitTextIfActive() {
      if (textOverlay.style.display === 'none') return;
      const text = textInput.value.trim();
      if (text) {
        const x = parseFloat(textOverlay.style.left) || 0;
        const y = parseFloat(textOverlay.style.top)  || 0;
        const size = Math.max(14, drawWidth * 5);
        const lineHeight = size * 1.35;
        const lines = text.split(String.fromCharCode(10));

        pushAnnoHistory();
        clipAnno();
        annoCtx.font = 'bold ' + size + 'px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif';
        annoCtx.fillStyle = drawColor;
        annoCtx.shadowColor = 'rgba(0,0,0,.75)';
        annoCtx.shadowBlur = 3;

        lines.forEach((line, idx) => {
          annoCtx.fillText(line, x + 10, y + size + 6 + idx * lineHeight);
        });

        annoCtx.shadowBlur = 0;
        annoCtx.restore();
      }
      textInput.value = '';
      textOverlay.style.display = 'none';
    }

    textInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        textInput.value = '';
        textOverlay.style.display = 'none';
        e.stopPropagation();
      } else if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        commitTextIfActive();
      }
    });

    textInput.addEventListener('blur', () => {
      if (textJustOpened) return;
      setTimeout(() => {
        if (!textJustOpened) {
          commitTextIfActive();
        }
      }, 150);
    });

    // ── 工具栏选择 ────────────────────────────────────────────────────────
    ['tool-rect', 'tool-arrow', 'tool-pen', 'tool-text', 'tool-mosaic'].forEach(id => {
      const el = document.getElementById(id);
      el.addEventListener('mousedown', (e) => e.preventDefault());
      el.addEventListener('click', () => {
        commitTextIfActive();
        currentTool = id.replace('tool-', '');
        document.querySelectorAll('.btn-tool').forEach(b => b.classList.remove('active'));
        el.classList.add('active');
        annoCanvas.style.cursor = currentTool === 'text' ? 'text' : 'crosshair';
      });
    });

    document.getElementById('btn-undo').addEventListener('mousedown', (e) => e.preventDefault());
    document.getElementById('btn-undo').addEventListener('click', () => {
      commitTextIfActive();
      undoAnno();
    });

    document.querySelectorAll('.color-dot').forEach(dot => {
      dot.addEventListener('mousedown', (e) => e.preventDefault());
      dot.addEventListener('click', () => {
        drawColor = dot.dataset.color;
        document.querySelectorAll('.color-dot').forEach(d => d.classList.remove('active'));
        dot.classList.add('active');
        if (textOverlay.style.display === 'block') {
          textInput.style.color = drawColor;
          textInput.style.borderColor = drawColor;
          textInput.style.caretColor = drawColor;
        }
      });
    });

    document.querySelectorAll('.width-btn').forEach(btn => {
      btn.addEventListener('mousedown', (e) => e.preventDefault());
      btn.addEventListener('click', () => {
        drawWidth = parseInt(btn.dataset.w, 10);
        document.querySelectorAll('.width-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        if (textOverlay.style.display === 'block') {
          const size = Math.max(14, drawWidth * 5);
          textInput.style.fontSize = size + 'px';
        }
      });
    });

    // ── 选区事件 (phase === 'select') ────────────────────────────────────
    window.addEventListener('mousedown', (e) => {
      if (phase !== 'select') return;
      if (e.button === 2) {
        if (cropRect.width > 0) {
          cropRect = { x:0, y:0, width:0, height:0 };
          toolbar.style.display = 'none';
          sizeBadge.style.display = 'none';
          render();
        } else { doCancel(); }
        return;
      }
      if (e.button !== 0) return;
      if (toolbar.contains(e.target)) return;

      const mx = e.clientX, my = e.clientY;
      const handle = hitTestHandle(mx, my);
      if (handle) { isResizing = true; activeHandle = handle; startX = mx; startY = my; rectStartX = cropRect.x; rectStartY = cropRect.y; return; }
      if (hitTestInside(mx, my)) { isMoving = true; moveStartX = mx; moveStartY = my; rectStartX = cropRect.x; rectStartY = cropRect.y; return; }
      isSelecting = true; startX = mx; startY = my;
      cropRect = { x:mx, y:my, width:0, height:0 };
      toolbar.style.display = 'none'; sizeBadge.style.display = 'none';
      guideBanner.style.display = 'none'; magnifier.style.display = 'none';
      render();
    });

    window.addEventListener('mousemove', (e) => {
      if (phase !== 'select') return;
      const mx = e.clientX, my = e.clientY;

      if (isSelecting) {
        cropRect = { x: Math.min(startX,mx), y: Math.min(startY,my), width: Math.abs(mx-startX), height: Math.abs(my-startY) };
        render(); updateSizeBadge(); return;
      }
      if (isMoving) {
        const dx = mx-moveStartX, dy = my-moveStartY;
        cropRect.x = Math.max(0, Math.min(window.innerWidth  - cropRect.width,  rectStartX + dx));
        cropRect.y = Math.max(0, Math.min(window.innerHeight - cropRect.height, rectStartY + dy));
        render(); updateToolbarPos(); updateSizeBadge(); return;
      }
      if (isResizing && activeHandle) { resizeByHandle(mx, my); render(); updateToolbarPos(); updateSizeBadge(); return; }

      const handle = hitTestHandle(mx, my);
      if (handle) {
        const cm = {nw:'nwse-resize',se:'nwse-resize',ne:'nesw-resize',sw:'nesw-resize',n:'ns-resize',s:'ns-resize',w:'ew-resize',e:'ew-resize'};
        document.body.style.cursor = cm[handle]; magnifier.style.display = 'none';
      } else if (hitTestInside(mx, my)) {
        document.body.style.cursor = 'move'; magnifier.style.display = 'none';
      } else {
        document.body.style.cursor = 'crosshair';
        if (cropRect.width === 0) updateMagnifier(mx, my); else magnifier.style.display = 'none';
      }
    });

    function resizeByHandle(mx, my) {
      let { x, y, width: w, height: h } = cropRect;
      if (activeHandle.includes('e')) w = Math.max(10, mx - x);
      if (activeHandle.includes('s')) h = Math.max(10, my - y);
      if (activeHandle.includes('w')) { const nw = Math.max(10, x+w-mx); x = x+w-nw; w = nw; }
      if (activeHandle.includes('n')) { const nh = Math.max(10, y+h-my); y = y+h-nh; h = nh; }
      cropRect = { x, y, width: w, height: h };
    }

    window.addEventListener('mouseup', () => {
      if (phase !== 'select') return;
      if (isSelecting || isMoving || isResizing) {
        isSelecting = isMoving = isResizing = false; activeHandle = null;
        if (cropRect.width > 5 && cropRect.height > 5) {
          sizeBadge.style.display = 'block'; updateSizeBadge();
          enterEditMode();
        } else {
          cropRect = { x:0, y:0, width:0, height:0 };
          toolbar.style.display = 'none'; sizeBadge.style.display = 'none';
          guideBanner.style.display = 'flex';
        }
        render();
      }
    });

    window.addEventListener('dblclick', (e) => {
      if (phase === 'select' && cropRect.width > 10 && hitTestInside(e.clientX, e.clientY)) doFinish();
    });

    // ── 放大镜 ────────────────────────────────────────────────────────────
    function updateMagnifier(mx, my) {
      if (!isImgLoaded) return;
      magnifier.style.display = 'flex';
      let left = mx+20, top = my+20;
      if (left+140 > window.innerWidth)  left = mx-140;
      if (top+160 > window.innerHeight)  top  = my-160;
      magnifier.style.left = left+'px'; magnifier.style.top = top+'px';
      magCoords.textContent = 'X: '+Math.round(mx*scaleFactor)+', Y: '+Math.round(my*scaleFactor);
      const srcSize = 30, mW = magCanvas.width, mH = magCanvas.height;
      magCtx.imageSmoothingEnabled = false; magCtx.clearRect(0,0,mW,mH);
      const rX = bgImg.naturalWidth/window.innerWidth, rY = bgImg.naturalHeight/window.innerHeight;
      magCtx.drawImage(bgImg, Math.max(0,mx*rX-srcSize/2), Math.max(0,my*rY-srcSize/2), srcSize, srcSize, 0, 0, mW, mH);
      magCtx.strokeStyle='#38bdf8'; magCtx.lineWidth=1;
      magCtx.beginPath(); magCtx.moveTo(mW/2,0); magCtx.lineTo(mW/2,mH); magCtx.moveTo(0,mH/2); magCtx.lineTo(mW,mH/2); magCtx.stroke();
      try {
        const px = magCtx.getImageData(mW/2,mH/2,1,1).data;
        const hex = '#'+((1<<24)+(px[0]<<16)+(px[1]<<8)+px[2]).toString(16).slice(1).toUpperCase();
        magColor.textContent = hex+' ('+px[0]+','+px[1]+','+px[2]+')';
      } catch {}
    }

    // ── 截图导出 (合成背景 + 标注层) ─────────────────────────────────────
    function getCroppedDataUrl() {
      const rX = bgImg.naturalWidth  / window.innerWidth;
      const rY = bgImg.naturalHeight / window.innerHeight;
      const cropX = Math.round(cropRect.x * rX);
      const cropY = Math.round(cropRect.y * rY);
      const cropW = Math.round(cropRect.width  * rX);
      const cropH = Math.round(cropRect.height * rY);
      if (cropW <= 0 || cropH <= 0) return null;

      const off = document.createElement('canvas');
      off.width = cropW; off.height = cropH;
      const offCtx = off.getContext('2d');

      // 1. 背景裁剪
      offCtx.drawImage(bgImg, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

      // 2. 标注层裁剪 (anno-canvas 是 CSS 像素坐标，需映射到自然像素)
      const dpr = window.devicePixelRatio || 1;
      const aX = Math.round(cropRect.x * dpr);
      const aY = Math.round(cropRect.y * dpr);
      const aW = Math.round(cropRect.width  * dpr);
      const aH = Math.round(cropRect.height * dpr);
      if (aW > 0 && aH > 0) {
        offCtx.drawImage(annoCanvas, aX, aY, aW, aH, 0, 0, cropW, cropH);
      }

      return off.toDataURL('image/png', 0.98);
    }

    // ── 主操作 ─────────────────────────────────────────────────────────────
    function doFinish() {
      commitTextIfActive();
      const dataUrl = getCroppedDataUrl() || bgDataUrl;
      if (window.screenshotAPI?.finish) {
        window.screenshotAPI.finish({ dataUrl, bounds: { x:cropRect.x, y:cropRect.y, width:cropRect.width, height:cropRect.height } });
      } else {
        window.close();
      }
    }
    function doCopy() {
      commitTextIfActive();
      const d = getCroppedDataUrl() || bgDataUrl;
      if (window.screenshotAPI?.copy) {
        window.screenshotAPI.copy(d);
      } else {
        window.close();
      }
    }
    function doSave() {
      commitTextIfActive();
      const d = getCroppedDataUrl() || bgDataUrl;
      if (window.screenshotAPI?.saveAs) {
        window.screenshotAPI.saveAs(d);
      } else {
        window.close();
      }
    }
    function doCancel() {
      if (window.screenshotAPI?.cancel) {
        window.screenshotAPI.cancel();
      } else {
        window.close();
      }
    }
    function doFullscreen() {
      cropRect = { x:0, y:0, width:window.innerWidth, height:window.innerHeight };
      annoCtx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      annoHistory = [];
      guideBanner.style.display = 'none'; magnifier.style.display = 'none';
      sizeBadge.style.display = 'block'; updateSizeBadge();
      render(); enterEditMode();
    }

    document.getElementById('btn-finish').onclick    = doFinish;
    document.getElementById('btn-copy').onclick      = doCopy;
    document.getElementById('btn-save').onclick      = doSave;
    document.getElementById('btn-cancel').onclick    = doCancel;
    document.getElementById('btn-fullscreen').onclick = doFullscreen;

    // ── 键盘快捷键 ────────────────────────────────────────────────────────
    window.addEventListener('keydown', (e) => {
      if (e.target === textInput) return;
      if (e.key === 'Escape') {
        if (phase === 'edit' && annoHistory.length > 0) { undoAnno(); return; }
        if (cropRect.width > 0) {
          phase = 'select';
          cropRect = { x:0, y:0, width:0, height:0 };
          annoCtx.clearRect(0,0,window.innerWidth,window.innerHeight);
          annoHistory = []; toolbar.style.display = 'none';
          annoToolbar.style.display = 'none'; sizeBadge.style.display = 'none';
          annoCanvas.style.pointerEvents = 'none'; render();
        } else { doCancel(); }
      } else if (e.key === 'Enter' && !e.shiftKey) {
        doFinish();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
        doCopy();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        doSave();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        if (phase === 'edit') undoAnno();
      } else if (e.code === 'Space') {
        doFullscreen();
      }
    });
  })();
  </script>
</body>
</html>`
  }
}

