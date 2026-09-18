import {
  BrowserWindow,
  screen,
  clipboard,
  nativeImage,
  ipcMain,
  globalShortcut,
  dialog,
  shell,
  app
} from 'electron'
import { join } from 'path'
import { existsSync, writeFileSync } from 'fs'
import type { PinItem, PinOptions } from '@doujiao/plugin-sdk'

export class PinManager {
  private static instance: PinManager | null = null
  private mainWindow: BrowserWindow | null = null
  private pins: Map<string, { win: BrowserWindow; item: PinItem }> = new Map()
  private pinHistory: PinItem[] = []
  private ipcRegistered = false
  private clickThroughTimer: NodeJS.Timeout | null = null
  private pinMouseIgnored: Map<string, boolean> = new Map()

  private constructor() {}

  public static getInstance(): PinManager {
    if (!PinManager.instance) {
      PinManager.instance = new PinManager()
    }
    return PinManager.instance
  }

  public init(mainWindow: BrowserWindow): void {
    this.mainWindow = mainWindow
    this.registerIpc()
    this.registerShortcuts()
  }

  /**
   * 注册全局贴图快捷键 (Alt+F3 从剪贴板贴图，Ctrl+Shift+T 取消穿透)
   */
  public registerShortcuts(): void {
    try {
      globalShortcut.register('Alt+F3', () => {
        console.log('[PinManager] 快捷键触发剪贴板贴图: Alt+F3')
        this.pinFromClipboard()
      })
    } catch (err) {
      console.warn('[PinManager] 注册全局快捷键 Alt+F3 失败:', err)
    }

    try {
      globalShortcut.register('CommandOrControl+Shift+T', () => {
        console.log('[PinManager] 快捷键触发取消所有贴图鼠标穿透: CommandOrControl+Shift+T')
        this.cancelAllClickThrough()
      })
    } catch (err) {
      console.warn('[PinManager] 注册全局快捷键 CommandOrControl+Shift+T 失败:', err)
    }
  }

  public unregisterShortcuts(): void {
    try {
      globalShortcut.unregister('Alt+F3')
    } catch {}
    try {
      globalShortcut.unregister('CommandOrControl+Shift+T')
    } catch {}
    if (this.clickThroughTimer) {
      clearInterval(this.clickThroughTimer)
      this.clickThroughTimer = null
    }
  }

  /**
   * 创建独立桌面贴图浮窗
   */
  public createPin(options: PinOptions): string {
    if (!options.dataUrl) {
      throw new Error('未提供有效图片数据，无法贴图')
    }

    const id = `pin_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
    const primaryDisplay = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    const scaleFactor = primaryDisplay.scaleFactor || 1

    // 解析尺寸与位置
    let x = options.bounds?.x
    let y = options.bounds?.y
    let width = options.bounds?.width
    let height = options.bounds?.height

    if (!width || !height || width <= 0 || height <= 0) {
      const img = nativeImage.createFromDataURL(options.dataUrl)
      const sz = img.getSize()
      width = Math.round(sz.width / scaleFactor) || 360
      height = Math.round(sz.height / scaleFactor) || 240
    }

    // 默认居中在鼠标所在屏幕
    if (x === undefined || y === undefined) {
      const workArea = primaryDisplay.workArea
      x = Math.round(workArea.x + (workArea.width - width) / 2)
      y = Math.round(workArea.y + (workArea.height - height) / 2)
    }

    const item: PinItem = {
      id,
      dataUrl: options.dataUrl,
      bounds: { x, y, width, height },
      opacity: options.opacity ?? 1,
      scale: options.scale ?? 1,
      clickThrough: false,
      createdAt: Date.now(),
      title: options.title || `贴图 #${this.pins.size + 1}`
    }

    const pluginPreloadPath = existsSync(join(__dirname, '../preload/plugin.cjs'))
      ? join(__dirname, '../preload/plugin.cjs')
      : join(app.getAppPath(), 'out/preload/plugin.cjs')

    const win = new BrowserWindow({
      width: Math.max(80, width),
      height: Math.max(60, height),
      x,
      y,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: false,
      hasShadow: true,
      resizable: true,
      minWidth: 60,
      minHeight: 40,
      show: false,
      backgroundColor: '#00000000',
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        preload: pluginPreloadPath,
        webSecurity: true
      }
    })

    // 置于最高层级，防止被普通全屏窗以外的应用遮盖
    win.setAlwaysOnTop(true, 'screen-saver')
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

    // 加载 screen-pin 插件的桌面贴图视图
    const pinUrl = `doujiao-plugin://screen-pin/index.html?mode=pin&pinId=${id}`
    win.loadURL(pinUrl).catch((err) => {
      console.warn(`[PinManager] 加载贴图插件页面失败:`, err.message)
    })

    win.once('ready-to-show', () => {
      if (!win.isDestroyed()) {
        win.show()
        win.focus()
      }
    })

    // 监听移动与尺寸调整
    win.on('moved', () => {
      if (win.isDestroyed()) return
      const [curX, curY] = win.getPosition()
      if (item.bounds) {
        item.bounds.x = curX
        item.bounds.y = curY
      }
      this.notifyPinsChanged()
    })

    win.on('resized', () => {
      if (win.isDestroyed()) return
      const [curW, curH] = win.getSize()
      if (item.bounds) {
        item.bounds.width = curW
        item.bounds.height = curH
      }
      this.notifyPinsChanged()
    })

    win.on('closed', () => {
      this.pins.delete(id)
      this.pinMouseIgnored.delete(id)
      this.updateCursorTracking()
      this.notifyPinsChanged()
    })

    this.pins.set(id, { win, item })
    this.pinHistory.unshift({ ...item })
    if (this.pinHistory.length > 30) {
      this.pinHistory.pop()
    }

    this.notifyPinsChanged()
    return id
  }

  /**
   * 从剪贴板直接贴图
   */
  public pinFromClipboard(): string | null {
    const img = clipboard.readImage()
    if (img.isEmpty()) {
      return null
    }

    const dataUrl = img.toDataURL()
    if (!dataUrl || dataUrl.length < 100) return null

    return this.createPin({
      dataUrl,
      title: `剪贴板贴图 #${this.pins.size + 1}`
    })
  }

  public closePin(id: string): boolean {
    const entry = this.pins.get(id)
    if (entry && !entry.win.isDestroyed()) {
      entry.win.close()
      this.pins.delete(id)
      this.pinMouseIgnored.delete(id)
      this.updateCursorTracking()
      this.notifyPinsChanged()
      return true
    }
    return false
  }

  public closeAllPins(): boolean {
    for (const [, { win }] of this.pins) {
      if (!win.isDestroyed()) {
        win.close()
      }
    }
    this.pins.clear()
    this.pinMouseIgnored.clear()
    this.updateCursorTracking()
    this.notifyPinsChanged()
    return true
  }

  public getPinnedList(): PinItem[] {
    return Array.from(this.pins.values()).map((p) => ({ ...p.item }))
  }

  public getPinHistory(): PinItem[] {
    return [...this.pinHistory]
  }

  public setPinOpacity(id: string, opacity: number): boolean {
    const entry = this.pins.get(id)
    if (entry && !entry.win.isDestroyed()) {
      const clamped = Math.max(0.1, Math.min(1, opacity))
      entry.win.setOpacity(clamped)
      entry.item.opacity = clamped
      this.notifyPinsChanged()
      return true
    }
    return false
  }

  public setPinClickThrough(id: string, clickThrough: boolean): boolean {
    const entry = this.pins.get(id)
    if (entry && !entry.win.isDestroyed()) {
      entry.win.setIgnoreMouseEvents(clickThrough, { forward: true })
      entry.item.clickThrough = clickThrough
      this.pinMouseIgnored.set(id, clickThrough)
      this.updateCursorTracking()
      this.notifyPinsChanged()
      return true
    }
    return false
  }

  public cancelAllClickThrough(): boolean {
    let changed = false
    for (const [id, { win, item }] of this.pins) {
      if (!win.isDestroyed() && item.clickThrough) {
        win.setIgnoreMouseEvents(false)
        item.clickThrough = false
        this.pinMouseIgnored.set(id, false)
        changed = true
      }
    }
    if (changed) {
      this.updateCursorTracking()
      this.notifyPinsChanged()
    }
    return changed
  }

  /**
   * 动态监测鼠标光标位置：当鼠标移入贴图浮动控制栏时，临时取消穿透，确保关闭与控制按钮可点击
   */
  private updateCursorTracking(): void {
    const hasClickThrough = Array.from(this.pins.values()).some((p) => p.item.clickThrough)
    if (hasClickThrough && !this.clickThroughTimer) {
      this.clickThroughTimer = setInterval(() => {
        this.checkCursorForClickThrough()
      }, 70)
    } else if (!hasClickThrough && this.clickThroughTimer) {
      clearInterval(this.clickThroughTimer)
      this.clickThroughTimer = null
    }
  }

  private checkCursorForClickThrough(): void {
    try {
      const cursor = screen.getCursorScreenPoint()
      for (const [id, { win, item }] of this.pins) {
        if (win.isDestroyed() || !item.clickThrough) continue

        const bounds = win.getBounds()
        // 浮动控制工具栏位于右下角，设置感应区域 (宽约280px，高约70px)
        const barWidth = 280
        const barHeight = 70
        const barLeft = Math.max(bounds.x, bounds.x + bounds.width - barWidth)
        const barTop = Math.max(bounds.y, bounds.y + bounds.height - barHeight)
        const isHoveringBar =
          cursor.x >= barLeft &&
          cursor.x <= bounds.x + bounds.width &&
          cursor.y >= barTop &&
          cursor.y <= bounds.y + bounds.height

        const currentlyIgnored = this.pinMouseIgnored.get(id) ?? true
        if (isHoveringBar && currentlyIgnored) {
          // 悬停在右下角控制栏上：恢复鼠标事件，使得关闭按钮、取消穿透按钮可点击
          win.setIgnoreMouseEvents(false)
          this.pinMouseIgnored.set(id, false)
        } else if (!isHoveringBar && !currentlyIgnored) {
          // 移出控制栏：恢复穿透状态
          win.setIgnoreMouseEvents(true, { forward: true })
          this.pinMouseIgnored.set(id, true)
        }
      }
    } catch {
      // 忽略光标检查过程中的窗口释放异常
    }
  }

  private notifyPinsChanged(): void {
    const list = this.getPinnedList()
    // 通知主窗口渲染层
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('plugin:pin:changed', list)
    }
    // 通知所有贴图窗口
    for (const [, { win }] of this.pins) {
      if (!win.isDestroyed()) {
        win.webContents.send('plugin:pin:changed', list)
      }
    }
  }

  private registerIpc(): void {
    if (this.ipcRegistered) return
    this.ipcRegistered = true

    // 1. 创建贴图
    ipcMain.handle('plugin:pin:create', (_, options: PinOptions) => {
      return this.createPin(options)
    })

    // 2. 从剪贴板贴图
    ipcMain.handle('plugin:pin:from-clipboard', () => {
      return this.pinFromClipboard()
    })

    // 3. 关闭指定贴图
    ipcMain.handle('plugin:pin:close', (_, id: string) => {
      return this.closePin(id)
    })

    // 4. 关闭所有贴图
    ipcMain.handle('plugin:pin:close-all', () => {
      return this.closeAllPins()
    })

    // 5. 获取当前贴图列表
    ipcMain.handle('plugin:pin:list', () => {
      return this.getPinnedList()
    })

    // 6. 获取贴图历史
    ipcMain.handle('plugin:pin:history', () => {
      return this.getPinHistory()
    })

    // 7. 获取单个贴图元数据
    ipcMain.handle('plugin:pin:get-data', (_, pinId: string) => {
      const entry = this.pins.get(pinId)
      return entry ? { ...entry.item } : null
    })

    // 8. 设置贴图透明度
    ipcMain.handle('plugin:pin:set-opacity', (_, id: string, opacity: number) => {
      return this.setPinOpacity(id, opacity)
    })

    // 9. 设置贴图鼠标穿透
    ipcMain.handle('plugin:pin:set-click-through', (_, id: string, clickThrough: boolean) => {
      return this.setPinClickThrough(id, clickThrough)
    })

    // 10. 平移贴图位置 (供贴图内鼠标拖拽)
    ipcMain.handle('plugin:pin:move', (_, id: string, deltaX: number, deltaY: number) => {
      const entry = this.pins.get(id)
      if (entry && !entry.win.isDestroyed()) {
        const [x, y] = entry.win.getPosition()
        entry.win.setPosition(Math.round(x + deltaX), Math.round(y + deltaY))
        return true
      }
      return false
    })

    // 11. 缩放贴图窗口尺寸
    ipcMain.handle('plugin:pin:resize', (_, id: string, newWidth: number, newHeight: number) => {
      const entry = this.pins.get(id)
      if (entry && !entry.win.isDestroyed()) {
        entry.win.setSize(Math.round(newWidth), Math.round(newHeight))
        return true
      }
      return false
    })

    // 12. 复制当前贴图图片到剪贴板
    ipcMain.handle('plugin:pin:copy-image', (_, dataUrl: string) => {
      if (dataUrl) {
        const img = nativeImage.createFromDataURL(dataUrl)
        clipboard.writeImage(img)
        return true
      }
      return false
    })

    // 13. 另存当前贴图图片
    ipcMain.handle('plugin:pin:save-as', async (_, dataUrl: string, defaultName?: string) => {
      if (!dataUrl) return { canceled: true }
      const res = await dialog.showSaveDialog({
        title: '保存贴图为图片',
        defaultPath: defaultName || `贴图_${Date.now()}.png`,
        filters: [
          { name: 'PNG Image', extensions: ['png'] },
          { name: 'JPEG Image', extensions: ['jpg', 'jpeg'] }
        ]
      })
      if (!res.canceled && res.filePath) {
        const base64Data = dataUrl.replace(/^data:image\/\w+;base64,/, '')
        writeFileSync(res.filePath, Buffer.from(base64Data, 'base64'))
        shell.showItemInFolder(res.filePath)
        return { success: true, filePath: res.filePath }
      }
      return { canceled: true }
    })

    // 14. 取消所有贴图的鼠标穿透
    ipcMain.handle('plugin:pin:cancel-all-click-through', () => {
      return this.cancelAllClickThrough()
    })
  }
}
