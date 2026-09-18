import {
  BrowserWindow,
  screen,
  clipboard,
  nativeImage,
  ipcMain,
  globalShortcut,
  dialog,
  shell,
  app,
  type IpcMainInvokeEvent
} from 'electron'
import { join, basename, extname } from 'path'
import {
  existsSync,
  readFileSync,
  writeFileSync,
  statSync,
  mkdirSync,
  createWriteStream,
  copyFileSync,
  cpSync,
  rmSync
} from 'fs'
// @ts-ignore
import archiver from 'archiver'
import type { ShelfItem, ShelfConfig } from '@doujiao/plugin-sdk'

export class ShelfManager {
  private static instance: ShelfManager | null = null
  private mainWindow: BrowserWindow | null = null
  private shelfWindow: BrowserWindow | null = null
  private shelfItems: ShelfItem[] = []
  private ipcRegistered = false
  private storageFile: string = ''
  private configFile: string = ''
  private isCollapsed = false
  private collapsedY: number | null = null
  private drawerWidth = 380
  private tabWidth = 44
  private tabHeight = 160
  private config: ShelfConfig = {
    shortcut: 'Alt+Shift+D',
    copyFiles: true,
    autoDock: true,
    dockSide: 'right'
  }

  private constructor() {
    try {
      const dir = join(app.getPath('userData'), 'shelf')
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true })
      }
      this.storageFile = join(dir, 'shelf-items.json')
      this.configFile = join(dir, 'shelf-config.json')

      if (existsSync(this.configFile)) {
        try {
          const rawCfg = readFileSync(this.configFile, 'utf-8')
          this.config = { ...this.config, ...JSON.parse(rawCfg) }
        } catch {}
      }

      if (existsSync(this.storageFile)) {
        const raw = readFileSync(this.storageFile, 'utf-8')
        this.shelfItems = JSON.parse(raw)
      }
    } catch (err) {
      console.warn('[ShelfManager] 加载暂存岛历史记录失败:', err)
      this.shelfItems = []
    }
  }

  public static getInstance(): ShelfManager {
    if (!ShelfManager.instance) {
      ShelfManager.instance = new ShelfManager()
    }
    return ShelfManager.instance
  }

  public init(mainWindow: BrowserWindow): void {
    this.mainWindow = mainWindow
    this.registerIpc()
    this.registerShortcuts()
  }

  public getConfig(): ShelfConfig {
    return { ...this.config }
  }

  public setConfig(newConfig: Partial<ShelfConfig>): ShelfConfig {
    if (newConfig.shortcut && newConfig.shortcut !== this.config.shortcut) {
      this.unregisterShortcuts()
      this.config.shortcut = newConfig.shortcut
      this.registerShortcuts()
    }
    if (newConfig.copyFiles !== undefined) {
      this.config.copyFiles = newConfig.copyFiles
    }
    if (newConfig.autoDock !== undefined) {
      this.config.autoDock = newConfig.autoDock
    }
    if (newConfig.dockSide && newConfig.dockSide !== this.config.dockSide) {
      this.config.dockSide = newConfig.dockSide
      if (this.shelfWindow && !this.shelfWindow.isDestroyed()) {
        const bounds = this.isCollapsed ? this.getCollapsedBounds() : this.getExpandedBounds()
        this.shelfWindow.setBounds(bounds)
      }
    }
    try {
      writeFileSync(this.configFile, JSON.stringify(this.config, null, 2), 'utf-8')
    } catch (err) {
      console.error('[ShelfManager] 保存暂存岛配置失败:', err)
    }
    return { ...this.config }
  }

  public registerShortcuts(): void {
    try {
      const sc = this.config.shortcut || 'Alt+Shift+D'
      const ok = globalShortcut.register(sc, () => {
        console.log(`[ShelfManager] 快捷键触发暂存岛窗口: ${sc}`)
        this.toggleWindow()
      })
      if (!ok) {
        console.warn(`[ShelfManager] 注册快捷键 ${sc} 失败 (可能被占用)`)
      }
    } catch (err) {
      console.warn('[ShelfManager] 注册快捷键异常:', err)
    }
  }

  public unregisterShortcuts(): void {
    try {
      const sc = this.config.shortcut || 'Alt+Shift+D'
      globalShortcut.unregister(sc)
    } catch {}
  }

  private persistItems(): void {
    try {
      if (this.storageFile) {
        writeFileSync(this.storageFile, JSON.stringify(this.shelfItems, null, 2), 'utf-8')
      }
    } catch (err) {
      console.error('[ShelfManager] 保存暂存列表失败:', err)
    }
    this.notifyShelfChanged()
  }

  private notifyShelfChanged(): void {
    const list = [...this.shelfItems]
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('plugin:shelf:changed', list)
    }
    if (this.shelfWindow && !this.shelfWindow.isDestroyed()) {
      this.shelfWindow.webContents.send('plugin:shelf:changed', list)
    }
  }

  public getShelfItems(): ShelfItem[] {
    return [...this.shelfItems]
  }

  public addItem(itemInput: Partial<ShelfItem>): ShelfItem {
    const id = `shelf_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
    let path = itemInput.path || ''
    const originalPath = itemInput.originalPath || path
    let name = itemInput.name || ''
    let size = itemInput.size || 0
    let type = itemInput.type || 'file'
    let thumbnail = itemInput.thumbnail
    let isCopy = false

    // 若通过绝对文件路径添加
    if (path && existsSync(path)) {
      try {
        const stat = statSync(path)
        size = stat.size
        name = name || basename(path)
        const isDir = stat.isDirectory()
        if (isDir) {
          type = 'directory'
        } else {
          const ext = extname(path).toLowerCase()
          if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg'].includes(ext)) {
            type = 'image'
            if (!thumbnail && stat.size < 10 * 1024 * 1024) {
              const img = nativeImage.createFromPath(path)
              if (!img.isEmpty()) {
                const resized = img.resize({ width: 128, height: 128 })
                thumbnail = resized.toDataURL()
              }
            }
          } else {
            type = 'file'
          }
        }

        // 核心支持：若开启了「独立副本复制模式 (默认)」，将文件/目录复制一份到暂存岛持久缓存区
        const storageDir = join(app.getPath('userData'), 'shelf', 'storage')
        if (!existsSync(storageDir)) mkdirSync(storageDir, { recursive: true })

        if (this.config.copyFiles && !path.startsWith(storageDir)) {
          const safeName = name.replace(/[\\/:*?"<>|]/g, '_')
          const destPath = join(storageDir, `${id}_${safeName}`)
          if (isDir) {
            cpSync(path, destPath, { recursive: true })
          } else {
            copyFileSync(path, destPath)
          }
          path = destPath
          isCopy = true
        }
      } catch (e) {
        console.warn('[ShelfManager] 复制或获取文件信息失败:', e)
      }
    } else if (itemInput.content) {
      // 纯文本、URL或代码片段暂存
      const content = itemInput.content
      const isUrl = /^https?:\/\//i.test(content.trim())
      type = isUrl ? 'url' : 'text'
      name = name || (isUrl ? '网页链接' : `便签_${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`)
      size = Buffer.byteLength(content, 'utf-8')
      isCopy = true

      // 创建对应临时文本文件方便拖拽导出
      try {
        const cacheDir = join(app.getPath('userData'), 'shelf', 'cache')
        if (!existsSync(cacheDir)) mkdirSync(cacheDir, { recursive: true })
        const tempFilePath = join(cacheDir, `${name.replace(/[\\/:*?"<>|]/g, '_')}_${Date.now()}.${isUrl ? 'url' : 'txt'}`)
        if (isUrl) {
          writeFileSync(tempFilePath, `[InternetShortcut]\r\nURL=${content.trim()}\r\n`, 'utf-8')
        } else {
          writeFileSync(tempFilePath, content, 'utf-8')
        }
        path = tempFilePath
      } catch (err) {
        console.warn('[ShelfManager] 创建临时文件失败:', err)
      }
    }

    const item: ShelfItem = {
      id,
      name: name || '未命名暂存项',
      path,
      originalPath: originalPath || path,
      isCopy,
      size,
      type,
      thumbnail,
      content: itemInput.content,
      createdAt: Date.now()
    }

    // 相同原始路径的项移到最前端更新
    this.shelfItems = this.shelfItems.filter((it) => it.originalPath !== item.originalPath || !item.originalPath)
    this.shelfItems.unshift(item)
    if (this.shelfItems.length > 200) {
      const removed = this.shelfItems.pop()
      if (removed?.isCopy && removed.path && existsSync(removed.path)) {
        try { rmSync(removed.path, { recursive: true, force: true }) } catch {}
      }
    }

    this.persistItems()

    // 若暂存抽屉未开启，自动弹出提示用户文件已入岛
    if (!this.shelfWindow || !this.shelfWindow.isVisible()) {
      this.toggleWindow(true)
    } else if (this.isCollapsed) {
      // 若当前处于贴边折叠状态，收到新文件时自动展开让用户清晰感知
      this.setCollapsed(false)
    }

    return item
  }

  public removeItems(ids: string[]): boolean {
    const idSet = new Set(ids)
    const toRemove = this.shelfItems.filter((it) => idSet.has(it.id))
    for (const it of toRemove) {
      if (it.isCopy && it.path && existsSync(it.path)) {
        try {
          rmSync(it.path, { recursive: true, force: true })
        } catch (err) {
          console.warn('[ShelfManager] 清理已删除的暂存文件失败:', err)
        }
      }
    }

    this.shelfItems = this.shelfItems.filter((it) => !idSet.has(it.id))
    this.persistItems()
    return true
  }

  public clearShelf(): boolean {
    for (const it of this.shelfItems) {
      if (it.isCopy && it.path && existsSync(it.path)) {
        try {
          rmSync(it.path, { recursive: true, force: true })
        } catch {}
      }
    }
    this.shelfItems = []
    this.persistItems()
    return true
  }

  private getShelfDisplay(): Electron.Display {
    if (this.shelfWindow && !this.shelfWindow.isDestroyed()) {
      return screen.getDisplayMatching(this.shelfWindow.getBounds())
    }
    const cursorPoint = screen.getCursorScreenPoint()
    return screen.getDisplayNearestPoint(cursorPoint)
  }

  private getExpandedBounds() {
    const display = this.getShelfDisplay()
    const { workArea } = display
    const width = this.drawerWidth
    const height = Math.min(680, Math.round(workArea.height * 0.82))
    const isLeft = this.config.dockSide === 'left'
    const x = isLeft ? workArea.x : workArea.x + workArea.width - width
    const y = workArea.y + Math.round((workArea.height - height) / 2)
    return { x, y, width, height }
  }

  private getCollapsedBounds() {
    const display = this.getShelfDisplay()
    const { workArea } = display
    const width = this.tabWidth
    const height = this.tabHeight
    const isLeft = this.config.dockSide === 'left'
    const x = isLeft ? workArea.x : workArea.x + workArea.width - width
    const minY = workArea.y + 10
    const maxY = workArea.y + workArea.height - height - 10
    const defaultY = workArea.y + Math.round((workArea.height - height) / 2)
    const y = this.collapsedY !== null ? Math.max(minY, Math.min(maxY, this.collapsedY)) : defaultY
    return { x, y, width, height }
  }

  public setCollapsed(collapsed: boolean): boolean {
    if (!this.shelfWindow || this.shelfWindow.isDestroyed()) {
      this.isCollapsed = collapsed
      this.createShelfWindow()
    }
    if (!this.shelfWindow || this.shelfWindow.isDestroyed()) return false

    this.isCollapsed = collapsed
    const targetBounds = collapsed ? this.getCollapsedBounds() : this.getExpandedBounds()
    this.shelfWindow.setBounds(targetBounds)
    if (!this.shelfWindow.isVisible()) {
      this.shelfWindow.show()
    }
    if (!collapsed) {
      this.shelfWindow.focus()
    }
    this.shelfWindow.webContents.send('plugin:shelf:collapse-changed', collapsed)
    return this.isCollapsed
  }

  public setTabY(newY: number): boolean {
    this.collapsedY = newY
    if (this.isCollapsed && this.shelfWindow && !this.shelfWindow.isDestroyed()) {
      const bounds = this.getCollapsedBounds()
      this.shelfWindow.setBounds(bounds)
      return true
    }
    return false
  }

  public toggleWindow(visible?: boolean): boolean {
    if (!this.shelfWindow || this.shelfWindow.isDestroyed()) {
      this.createShelfWindow()
    }

    if (!this.shelfWindow || this.shelfWindow.isDestroyed()) return false

    if (visible !== undefined) {
      if (visible) {
        this.shelfWindow.show()
        if (!this.isCollapsed) {
          this.shelfWindow.focus()
        }
      } else {
        this.shelfWindow.hide()
      }
      return visible
    }

    // 快捷键触发：
    if (!this.shelfWindow.isVisible()) {
      this.setCollapsed(false)
      this.shelfWindow.show()
      this.shelfWindow.focus()
      return true
    } else {
      if (this.config.autoDock !== false) {
        if (!this.isCollapsed) {
          // 当前展开 -> 折叠停靠到屏幕边缘
          this.setCollapsed(true)
          return true
        } else {
          // 当前停靠折叠 -> 展开为抽屉
          this.setCollapsed(false)
          return true
        }
      } else {
        this.shelfWindow.hide()
        return false
      }
    }
  }

  private createShelfWindow(): void {
    const bounds = this.isCollapsed ? this.getCollapsedBounds() : this.getExpandedBounds()

    const pluginPreloadPath = existsSync(join(__dirname, '../preload/plugin.cjs'))
      ? join(__dirname, '../preload/plugin.cjs')
      : join(app.getAppPath(), 'out/preload/plugin.cjs')

    this.shelfWindow = new BrowserWindow({
      width: bounds.width,
      height: bounds.height,
      x: bounds.x,
      y: bounds.y,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      hasShadow: true,
      resizable: true,
      minWidth: 36,
      minHeight: 100,
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

    this.shelfWindow.setAlwaysOnTop(true, 'floating')

    const shelfUrl = 'doujiao-plugin://drop-shelf/index.html?mode=drawer'
    this.shelfWindow.loadURL(shelfUrl).catch((err) => {
      console.warn('[ShelfManager] 加载暂存岛插件页面失败:', err.message)
    })

    this.shelfWindow.webContents.on('did-finish-load', () => {
      this.shelfWindow?.webContents.send('plugin:shelf:collapse-changed', this.isCollapsed)
    })

    this.shelfWindow.on('closed', () => {
      this.shelfWindow = null
    })
  }

  public async packToZip(
    filePaths: string[],
    zipName?: string
  ): Promise<{ success: boolean; zipPath?: string; error?: string }> {
    const validPaths = filePaths.filter((p) => existsSync(p))
    if (validPaths.length === 0) {
      return { success: false, error: '无可打包的有效文件' }
    }

    try {
      const outDir = join(app.getPath('userData'), 'shelf', 'export')
      if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })
      const fileName = zipName || `暂存导出_${new Date().toISOString().slice(0, 10)}_${Date.now().toString().slice(-4)}.zip`
      const zipPath = join(outDir, fileName)

      await new Promise<void>((resolve, reject) => {
        const output = createWriteStream(zipPath)
        const archive = archiver('zip', { zlib: { level: 8 } })

        output.on('close', () => resolve())
        archive.on('error', (err: any) => reject(err))

        archive.pipe(output)

        for (const fpath of validPaths) {
          const stat = statSync(fpath)
          const name = basename(fpath)
          if (stat.isDirectory()) {
            archive.directory(fpath, name)
          } else {
            archive.file(fpath, { name })
          }
        }

        archive.finalize()
      })

      return { success: true, zipPath }
    } catch (err: any) {
      console.error('[ShelfManager] 压缩打包失败:', err)
      return { success: false, error: err?.message || '压缩打包失败' }
    }
  }

  private registerIpc(): void {
    if (this.ipcRegistered) return
    this.ipcRegistered = true

    // 1. 获取暂存列表
    ipcMain.handle('plugin:shelf:get-items', () => {
      return this.getShelfItems()
    })

    // 2. 添加暂存项
    ipcMain.handle('plugin:shelf:add-item', (_, item: Partial<ShelfItem>) => {
      return this.addItem(item)
    })

    // 3. 删除暂存项
    ipcMain.handle('plugin:shelf:remove-items', (_, ids: string[]) => {
      return this.removeItems(ids)
    })

    // 4. 清空暂存
    ipcMain.handle('plugin:shelf:clear', () => {
      return this.clearShelf()
    })

    // 5. 拖拽出 Electron 窗口至操作系统桌面或其它应用 (核心功能)
    ipcMain.on('plugin:shelf:start-drag', (event: IpcMainInvokeEvent, filePaths: string[]) => {
      const valid = (filePaths || []).filter((p) => existsSync(p))
      if (valid.length === 0) return

      // 生成拖拽指示图标
      const icon = nativeImage.createFromDataURL(
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAACXBIWXMAAAsTAAALEwEAmpwYAAAAVUlEQVR42u3TMRGAQBAEwR8WwA90IAc5iEIOCPBBqS1hU4zTzbvvdc+c93oE8AEBAAAAAEAAfK1yKj9K7fB5zN8BAAAAAABAJ6B04QICBAgQIEAAAeAEUjACi4n0+gAAAABJRU5ErkJggg=='
      )

      event.sender.startDrag({
        file: valid[0],
        files: valid,
        icon
      })
    })

    // 6. 打包导出为 ZIP
    ipcMain.handle('plugin:shelf:pack-zip', async (_, filePaths: string[], zipName?: string) => {
      return await this.packToZip(filePaths, zipName)
    })

    // 7. 复制文件路径到剪贴板
    ipcMain.handle('plugin:shelf:copy-paths', (_, filePaths: string[]) => {
      if (filePaths && filePaths.length > 0) {
        clipboard.writeText(filePaths.join('\n'))
        return true
      }
      return false
    })

    // 8. 显隐暂存抽屉浮窗
    ipcMain.handle('plugin:shelf:toggle-window', (_, visible?: boolean) => {
      return this.toggleWindow(visible)
    })

    // 9. 打开文件或在文件夹中定位
    ipcMain.handle('plugin:shelf:open-file', async (_, filePath: string) => {
      if (existsSync(filePath)) {
        await shell.openPath(filePath)
        return true
      }
      return false
    })

    ipcMain.handle('plugin:shelf:show-in-folder', (_, filePath: string) => {
      if (existsSync(filePath)) {
        shell.showItemInFolder(filePath)
        return true
      }
      return false
    })

    // 10. 选择外部文件加入暂存岛
    ipcMain.handle('plugin:shelf:select-files', async () => {
      const res = await dialog.showOpenDialog({
        title: '选择文件加入暂存岛',
        properties: ['openFile', 'openDirectory', 'multiSelections']
      })
      if (!res.canceled && res.filePaths.length > 0) {
        for (const fp of res.filePaths) {
          this.addItem({ path: fp })
        }
        return { success: true, count: res.filePaths.length }
      }
      return { canceled: true }
    })

    // 11. 读取/更新暂存岛配置 (快捷键与复制策略)
    ipcMain.handle('plugin:shelf:get-config', () => {
      return this.getConfig()
    })

    ipcMain.handle('plugin:shelf:set-config', (_, newCfg: Partial<ShelfConfig>) => {
      return this.setConfig(newCfg)
    })

    // 12. 停靠折叠状态管理与标签垂直定位
    ipcMain.handle('plugin:shelf:set-collapsed', (_, collapsed: boolean) => {
      return this.setCollapsed(collapsed)
    })

    ipcMain.handle('plugin:shelf:is-collapsed', () => {
      return this.isCollapsed
    })

    ipcMain.handle('plugin:shelf:set-tab-y', (_, y: number) => {
      return this.setTabY(y)
    })

    // 13. 从剪贴板主动粘贴 (文件、图片、文本)
    ipcMain.handle('plugin:shelf:paste-clipboard', async () => {
      return await this.pasteFromClipboard()
    })
  }

  public async pasteFromClipboard(): Promise<{ success: boolean; count: number; message?: string }> {
    // 1. 优先检查剪贴板中的图片 (截屏、复制图片等)
    const img = clipboard.readImage()
    if (!img.isEmpty()) {
      try {
        const storageDir = join(app.getPath('userData'), 'shelf', 'storage')
        if (!existsSync(storageDir)) mkdirSync(storageDir, { recursive: true })
        const id = `shelf_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
        const timeStr = new Date().toLocaleTimeString('zh-CN', { hour12: false }).replace(/:/g, '')
        const fileName = `剪贴板图片_${timeStr}.png`
        const destPath = join(storageDir, `${id}_${fileName}`)
        writeFileSync(destPath, img.toPNG())

        let thumbnail: string | undefined
        const resized = img.resize({ width: 128, height: 128 })
        if (!resized.isEmpty()) {
          thumbnail = resized.toDataURL()
        }

        this.addItem({
          path: destPath,
          name: fileName,
          type: 'image',
          thumbnail,
          size: statSync(destPath).size,
          isCopy: true
        })

        return { success: true, count: 1, message: '已从剪贴板粘贴图片' }
      } catch (err: any) {
        console.warn('[ShelfManager] 暂存剪贴板图片失败:', err)
      }
    }

    // 2. 检查 Windows 剪贴板文件列表 (FileDropList)
    if (process.platform === 'win32') {
      try {
        const { execSync } = await import('child_process')
        const raw = execSync('powershell -NoProfile -Command "(Get-Clipboard -Format FileDropList).FullName"', {
          encoding: 'utf-8',
          timeout: 2000,
          windowsHide: true
        }).trim()
        if (raw) {
          const paths = raw
            .split(/\r?\n/)
            .map((p) => p.trim())
            .filter((p) => p && existsSync(p))
          if (paths.length > 0) {
            for (const p of paths) {
              this.addItem({ path: p })
            }
            return {
              success: true,
              count: paths.length,
              message: this.config.copyFiles
                ? `已从剪贴板复制并暂存 ${paths.length} 个文件`
                : `已从剪贴板暂存 ${paths.length} 个文件路径`
            }
          }
        }
      } catch {
        // 忽略 powershell 异常
      }
    }

    // 3. 检查是否有文本或 URL
    const text = clipboard.readText().trim()
    if (text) {
      this.addItem({ content: text })
      return { success: true, count: 1, message: '已从剪贴板暂存便签文本' }
    }

    return { success: false, count: 0, message: '剪贴板中无文件、图片或文本内容' }
  }
}
