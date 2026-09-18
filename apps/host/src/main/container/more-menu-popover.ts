import { BrowserWindow, ipcMain } from 'electron'

export interface PopoverPluginItem {
  id: string
  name: string
  icon?: string
  enabled?: boolean
  isDev?: boolean
}

export interface ShowPopoverParams {
  top: number
  left: number
  plugins: PopoverPluginItem[]
  activeTab: string
  theme: string
}

export class MoreMenuPopoverManager {
  private static instance: MoreMenuPopoverManager | null = null
  private mainWindow: BrowserWindow | null = null
  private popoverWin: BrowserWindow | null = null
  private hideTimeout: NodeJS.Timeout | null = null
  private isVisible = false
  private ipcRegistered = false

  public static getInstance(): MoreMenuPopoverManager {
    if (!MoreMenuPopoverManager.instance) {
      MoreMenuPopoverManager.instance = new MoreMenuPopoverManager()
    }
    return MoreMenuPopoverManager.instance
  }

  public init(mainWindow: BrowserWindow): void {
    this.mainWindow = mainWindow
    this.createWindow()
    this.registerIpc()
  }

  private createWindow(): void {
    if (!this.mainWindow || (this.popoverWin && !this.popoverWin.isDestroyed())) return

    this.popoverWin = new BrowserWindow({
      parent: this.mainWindow,
      width: 276,
      height: 380,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      hasShadow: false,
      show: false,
      webPreferences: {
        contextIsolation: false,
        nodeIntegration: true
      }
    })

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          * { box-sizing: border-box; margin: 0; padding: 0; }
          html, body {
            background: transparent;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
            user-select: none;
            overflow: hidden;
            width: 100%;
            height: 100%;
            padding: 6px;
          }
          .card {
            border-radius: 16px;
            padding: 10px;
            display: flex;
            flex-direction: column;
            height: calc(100% - 12px);
            box-shadow: 0 16px 36px rgba(0,0,0,0.65), 0 0 0 1px rgba(255,255,255,0.08);
            transition: background 0.2s, border-color 0.2s;
          }
          /* Dark theme */
          .theme-dark {
            background: rgba(15, 23, 42, 0.96);
            backdrop-filter: blur(20px);
            border: 1px solid rgba(51, 65, 85, 0.9);
            color: #f8fafc;
          }
          .theme-dark .header { border-bottom: 1px solid rgba(51, 65, 85, 0.8); }
          .theme-dark .header-tip { color: #64748b; }
          .theme-dark .item { color: #cbd5e1; }
          .theme-dark .item:hover { background: rgba(30, 41, 59, 0.85); color: #fff; }
          .theme-dark .action-btn { color: #94a3b8; }
          .theme-dark .action-btn:hover { background: rgba(51, 65, 85, 0.7); color: #fff; }

          /* Light theme */
          .theme-light {
            background: rgba(255, 255, 255, 0.98);
            backdrop-filter: blur(20px);
            border: 1px solid rgba(203, 213, 225, 0.9);
            color: #0f172a;
            box-shadow: 0 16px 36px rgba(0,0,0,0.18), 0 0 0 1px rgba(0,0,0,0.06);
          }
          .theme-light .header { border-bottom: 1px solid rgba(226, 232, 240, 0.9); }
          .theme-light .header-tip { color: #94a3b8; }
          .theme-light .item { color: #334155; }
          .theme-light .item:hover { background: rgba(241, 245, 249, 0.95); color: #0f172a; }
          .theme-light .action-btn { color: #64748b; }
          .theme-light .action-btn:hover { background: rgba(226, 232, 240, 0.85); color: #0f172a; }

          /* Cyber theme */
          .theme-cyber {
            background: rgba(10, 19, 36, 0.96);
            backdrop-filter: blur(20px);
            border: 1px solid rgba(26, 54, 93, 0.9);
            color: #f0f9ff;
          }
          .theme-cyber .header { border-bottom: 1px solid rgba(26, 54, 93, 0.8); }
          .theme-cyber .header-tip { color: #38bdf8; opacity: 0.7; }
          .theme-cyber .item { color: #bae6fd; }
          .theme-cyber .item:hover { background: rgba(16, 34, 61, 0.85); color: #fff; }
          .theme-cyber .action-btn { color: #7dd3fc; }
          .theme-cyber .action-btn:hover { background: rgba(26, 54, 93, 0.85); color: #fff; }

          .header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding-bottom: 8px;
            font-size: 12px;
          }
          .header-title {
            font-weight: 600;
            display: flex;
            align-items: center;
            gap: 6px;
          }
          .badge-count {
            font-size: 10px;
            padding: 1px 6px;
            border-radius: 999px;
            background: rgba(16, 185, 129, 0.15);
            color: #10b981;
            font-family: monospace;
            font-weight: 600;
          }
          .header-tip { font-size: 10px; }
          .list {
            flex: 1;
            overflow-y: auto;
            margin-top: 6px;
            display: flex;
            flex-direction: column;
            gap: 3px;
            padding-right: 2px;
          }
          .list::-webkit-scrollbar { width: 4px; }
          .list::-webkit-scrollbar-thumb {
            background: rgba(100, 116, 139, 0.4);
            border-radius: 4px;
          }
          .item {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 6px 8px;
            border-radius: 10px;
            cursor: pointer;
            transition: all 0.15s ease;
            border: 1px solid transparent;
            font-size: 12px;
          }
          .item.active {
            background: rgba(16, 185, 129, 0.12) !important;
            border-color: rgba(16, 185, 129, 0.35) !important;
            color: #10b981 !important;
            font-weight: 600;
          }
          .item.disabled { opacity: 0.55; }
          .item-info {
            display: flex;
            align-items: center;
            gap: 8px;
            min-width: 0;
            flex: 1;
          }
          .item-emoji {
            font-size: 16px;
            flex-shrink: 0;
            position: relative;
          }
          .item-name {
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            font-weight: 500;
          }
          .tag {
            font-size: 9px;
            padding: 1px 4px;
            border-radius: 4px;
            margin-left: 4px;
            font-family: monospace;
          }
          .tag-disabled { background: rgba(100, 116, 139, 0.3); color: #94a3b8; }
          .tag-dev { background: rgba(245, 158, 11, 0.15); color: #f59e0b; }
          .actions {
            display: flex;
            align-items: center;
            gap: 2px;
            flex-shrink: 0;
          }
          .action-btn {
            padding: 3px 5px;
            border-radius: 6px;
            background: transparent;
            border: none;
            cursor: pointer;
            font-size: 11px;
            transition: all 0.15s ease;
          }
          .action-btn.pin:hover { color: #10b981 !important; }
          .footer {
            padding-top: 6px;
            margin-top: 4px;
            border-top: 1px solid rgba(51, 65, 85, 0.8);
            text-align: center;
            flex-shrink: 0;
          }
          .theme-light .footer { border-top: 1px solid rgba(226, 232, 240, 0.9); }
          .theme-cyber .footer { border-top: 1px solid rgba(26, 54, 93, 0.8); }
          .footer-link {
            font-size: 11px;
            color: #10b981;
            text-decoration: none;
            cursor: pointer;
            transition: opacity 0.15s;
          }
          .footer-link:hover { text-decoration: underline; opacity: 0.85; }
        </style>
      </head>
      <body>
        <div class="card theme-dark" id="card">
          <div class="header">
            <div class="header-title">
              <span style="font-size: 14px;">🧩</span>
              <span>更多插件</span>
              <span class="badge-count" id="count">0</span>
            </div>
            <span class="header-tip">点 📌 置顶</span>
          </div>
          <div class="list" id="list"></div>
          <div class="footer">
            <a href="javascript:void(0)" class="footer-link" onclick="ipcRenderer.send('popover:action', { action: 'select', pluginId: 'market' })">浏览插件市场 →</a>
          </div>
        </div>
        <script>
          const { ipcRenderer } = require('electron');

          document.body.addEventListener('mouseenter', () => {
            ipcRenderer.send('popover:mouse-enter');
          });
          document.body.addEventListener('mouseleave', () => {
            ipcRenderer.send('popover:mouse-leave');
          });

          function getEmoji(plugin) {
            if (plugin.icon && !plugin.icon.includes('/')) return plugin.icon;
            const id = plugin.id || '';
            if (id.includes('douyin')) return '🎵';
            if (id.includes('bilibili')) return '📺';
            if (id.includes('markdown')) return '📝';
            if (id.includes('notepad')) return '🗒️';
            if (id.includes('clipboard')) return '📋';
            if (id.includes('browser')) return '🌐';
            if (id.includes('samba')) return '🗄️';
            if (id.includes('dev-toys') || id.includes('devtoys')) return '🛠️';
            if (id.includes('ocr')) return '🔍';
            if (id.includes('media-converter') || id.includes('convert')) return '🎬';
            if (id.includes('album') || id.includes('photo')) return '📸';
            if (id.includes('image-editor')) return '🎨';
            return '🧩';
          }

          ipcRenderer.on('popover:render', (_, data) => {
            const { plugins, activeTab, theme } = data;
            const card = document.getElementById('card');
            card.className = 'card theme-' + (theme || 'dark');

            document.getElementById('count').textContent = plugins ? plugins.length : 0;
            const listEl = document.getElementById('list');
            listEl.innerHTML = '';

            if (!plugins || plugins.length === 0) {
              listEl.innerHTML = '<div style="font-size: 11px; text-align: center; padding: 20px 0; color: #94a3b8;">暂无未置顶插件</div>';
              return;
            }

            plugins.forEach(p => {
              const item = document.createElement('div');
              const isActive = activeTab === p.id;
              const isDisabled = p.enabled === false;
              item.className = 'item' + (isActive ? ' active' : '') + (isDisabled ? ' disabled' : '');

              item.onclick = () => {
                ipcRenderer.send('popover:action', { action: 'select', pluginId: p.id });
              };

              const emoji = getEmoji(p);
              item.innerHTML = \`
                <div class="item-info">
                  <span class="item-emoji">\${emoji}</span>
                  <span class="item-name">\${p.name}</span>
                  \${isDisabled ? '<span class="tag tag-disabled">已禁用</span>' : ''}
                  \${p.isDev ? '<span class="tag tag-dev">开发</span>' : ''}
                </div>
                <div class="actions">
                  <button class="action-btn" title="\${isDisabled ? '启用插件' : '禁用插件'}">\${isDisabled ? '▶️' : '⏸️'}</button>
                  <button class="action-btn pin" title="置顶到主侧边栏">📌</button>
                  \${!p.isDev ? '<button class="action-btn uninstall" title="卸载插件">🗑️</button>' : ''}
                </div>
              \`;

              const btns = item.querySelectorAll('.action-btn');
              // toggle enable button
              btns[0].onclick = (e) => {
                e.stopPropagation();
                ipcRenderer.send('popover:action', { action: 'toggle', pluginId: p.id, enabled: isDisabled });
              };
              // pin button
              btns[1].onclick = (e) => {
                e.stopPropagation();
                ipcRenderer.send('popover:action', { action: 'pin', pluginId: p.id });
              };
              // uninstall button
              if (btns[2]) {
                btns[2].onclick = (e) => {
                  e.stopPropagation();
                  ipcRenderer.send('popover:action', { action: 'uninstall', pluginId: p.id, name: p.name });
                };
              }

              listEl.appendChild(item);
            });
          });
        </script>
      </body>
      </html>
    `

    this.popoverWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))

    this.mainWindow.on('move', () => this.hide())
    this.mainWindow.on('resize', () => this.hide())
    this.mainWindow.on('minimize', () => this.hide())
    this.popoverWin.on('blur', () => this.hide())
  }

  private registerIpc(): void {
    if (this.ipcRegistered) return
    this.ipcRegistered = true

    ipcMain.on('popover:mouse-enter', () => {
      this.cancelHide()
    })

    ipcMain.on('popover:mouse-leave', () => {
      this.scheduleHide(220)
    })

    ipcMain.on('popover:action', (_, data) => {
      if (!this.mainWindow || this.mainWindow.isDestroyed()) return
      if (data.action === 'select') {
        this.hide()
      }
      // 通知宿主渲染进程执行对应动作
      this.mainWindow.webContents.send('host:more-menu:action', data.action, data)
    })
  }

  public show(params: ShowPopoverParams): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return
    if (!this.popoverWin || this.popoverWin.isDestroyed()) {
      this.createWindow()
    }
    if (!this.popoverWin || this.popoverWin.isDestroyed()) return

    this.cancelHide()

    const { top, left, plugins, activeTab, theme } = params
    const mainBounds = this.mainWindow.getBounds()
    const screenX = mainBounds.x + left
    const popoverHeight = Math.min(380, Math.max(140, 80 + plugins.length * 42))
    let screenY = mainBounds.y + top
    if (screenY + popoverHeight > mainBounds.y + mainBounds.height - 15) {
      screenY = Math.max(mainBounds.y + 55, mainBounds.y + mainBounds.height - popoverHeight - 15)
    }

    this.popoverWin.setBounds({
      x: Math.round(screenX),
      y: Math.round(screenY),
      width: 276,
      height: Math.round(popoverHeight)
    })

    this.popoverWin.webContents.send('popover:render', { plugins, activeTab, theme })
    this.popoverWin.showInactive()
    this.isVisible = true
  }

  public hide(): void {
    this.cancelHide()
    if (this.popoverWin && !this.popoverWin.isDestroyed()) {
      this.popoverWin.hide()
    }
    this.isVisible = false
  }

  public scheduleHide(delayMs = 250): void {
    this.cancelHide()
    this.hideTimeout = setTimeout(() => {
      this.hide()
    }, delayMs)
  }

  public cancelHide(): void {
    if (this.hideTimeout) {
      clearTimeout(this.hideTimeout)
      this.hideTimeout = null
    }
  }

  public destroy(): void {
    this.cancelHide()
    if (this.popoverWin && !this.popoverWin.isDestroyed()) {
      this.popoverWin.destroy()
      this.popoverWin = null
    }
  }
}
