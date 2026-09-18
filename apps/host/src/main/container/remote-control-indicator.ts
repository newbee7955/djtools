/**
 * 远程协助受控端顶部常驻安全悬浮条 (Remote Control Indicator)
 * 纯前台置顶胶囊，提示被控状态，提供双向文件发送/接收入口与一键紧急断开
 */

import { BrowserWindow, screen, dialog } from 'electron'
import { TransferService } from '../services/remote-assist/transfer/transfer-service.ts'

export class RemoteControlIndicator {
  private static instance: RemoteControlIndicator | null = null
  private window: BrowserWindow | null = null
  private onDisconnectCallback: (() => void) | null = null
  private unsubTransfer: (() => void) | null = null

  private constructor() {}

  public static getInstance(): RemoteControlIndicator {
    if (!RemoteControlIndicator.instance) {
      RemoteControlIndicator.instance = new RemoteControlIndicator()
    }
    return RemoteControlIndicator.instance
  }

  public show(controllerName: string = '协助者', isControl: boolean = true, onDisconnect: () => void): void {
    this.onDisconnectCallback = onDisconnect

    if (this.window && !this.window.isDestroyed()) {
      this.window.show()
      return
    }

    const primaryDisplay = screen.getPrimaryDisplay()
    // 可控模式下容纳"发送文件"与"接收文件夹"按钮，仅查看模式保持紧凑尺寸
    const width = isControl ? 540 : 360
    const height = 48
    const x = Math.round(primaryDisplay.bounds.x + (primaryDisplay.bounds.width - width) / 2)
    const y = primaryDisplay.bounds.y + 16

    this.window = new BrowserWindow({
      width,
      height,
      x,
      y,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      focusable: false,
      show: false,
      webPreferences: {
        sandbox: true,
        contextIsolation: true
      }
    })

    const statusText = isControl ? '正在被远程控制中' : '正在被远程查看中'
    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; user-select: none; }
    body {
      background: transparent;
      overflow: hidden;
      display: flex;
      align-items: center;
      justify-content: center;
      height: 48px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }
    .pill {
      background: rgba(15, 23, 42, 0.92);
      backdrop-filter: blur(8px);
      border: 1px solid rgba(239, 68, 68, 0.5);
      box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.4), 0 0 12px rgba(239, 68, 68, 0.3);
      border-radius: 24px;
      padding: 6px 16px;
      display: flex;
      align-items: center;
      gap: 10px;
      color: #f8fafc;
      font-size: 13px;
    }
    .dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: #ef4444;
      box-shadow: 0 0 8px #ef4444;
      animation: pulse 1.5s infinite;
      flex-shrink: 0;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.4; transform: scale(0.85); }
    }
    .title {
      font-weight: 600;
      color: #fca5a5;
      white-space: nowrap;
    }
    .peer-name {
      color: #94a3b8;
      font-size: 11px;
      margin-left: 4px;
      white-space: nowrap;
    }
    .btn-action {
      background: #334155;
      color: #f8fafc;
      border: 1px solid #475569;
      padding: 4px 10px;
      border-radius: 12px;
      cursor: pointer;
      font-size: 12px;
      font-weight: 500;
      white-space: nowrap;
      transition: background-color 0.2s;
    }
    .btn-action:hover {
      background: #475569;
    }
    .btn-disconnect {
      background: #ef4444;
      color: white;
      border: none;
      padding: 4px 12px;
      border-radius: 12px;
      cursor: pointer;
      font-size: 12px;
      font-weight: 600;
      white-space: nowrap;
      transition: background-color 0.2s;
    }
    .btn-disconnect:hover {
      background: #dc2626;
    }
    #transferStatus {
      font-size: 11px;
      color: #38bdf8;
      max-width: 110px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  </style>
</head>
<body>
  <div class="pill">
    <div class="dot"></div>
    <div style="display: flex; align-items: center;">
      <span class="title">${statusText}</span>
      <span class="peer-name">(${controllerName})</span>
    </div>
    ${isControl ? `
    <span id="transferStatus"></span>
    <button class="btn-action" id="sendFilesBtn" title="选择文件发送给控制端">发送文件</button>
    <button class="btn-action" id="openFolderBtn" title="打开接收到的文件所在目录">接收文件夹</button>
    ` : ''}
    <button class="btn-disconnect" id="disconnectBtn">断开</button>
  </div>
  <script>
    if (document.getElementById('sendFilesBtn')) {
      document.getElementById('sendFilesBtn').addEventListener('click', () => {
        window.location.href = 'https://doujiao.internal/send-files';
      });
    }
    if (document.getElementById('openFolderBtn')) {
      document.getElementById('openFolderBtn').addEventListener('click', () => {
        window.location.href = 'https://doujiao.internal/open-folder';
      });
    }
    document.getElementById('disconnectBtn').addEventListener('click', () => {
      window.location.href = 'https://doujiao.internal/disconnect';
    });
  </script>
</body>
</html>`

    this.window.webContents.on('will-navigate', (event, url) => {
      event.preventDefault()
      if (url.includes('doujiao.internal/disconnect')) {
        this.onDisconnectCallback?.()
      } else if (url.includes('doujiao.internal/send-files')) {
        void this.pickAndSendFiles()
      } else if (url.includes('doujiao.internal/open-folder')) {
        void TransferService.getInstance().openReceiveFolder()
      }
    })

    // 订阅传输状态并在浮条上回显进度与结果
    if (isControl) {
      this.unsubTransfer = TransferService.getInstance().onEvent((event) => {
        if (event.type === 'transfer-state' && this.window && !this.window.isDestroyed()) {
          const s = event.state
          let text = ''
          if (s.status === 'active' || s.status === 'pending') {
            const pct = s.totalBytes > 0 ? Math.round((s.transferredBytes / s.totalBytes) * 100) : 0
            text = (s.direction === 'outgoing' ? '发送 ' : '接收 ') + pct + '%'
          } else if (s.status === 'done') {
            text = (s.direction === 'outgoing' ? '已发送' : '已接收')
          } else if (s.status === 'failed' || s.status === 'rejected' || s.status === 'cancelled') {
            text = '传输中断'
          }
          this.window.webContents.executeJavaScript(`
            const el = document.getElementById('transferStatus');
            if (el) { el.textContent = ${JSON.stringify(text)}; }
          `).catch(() => {})
        }
      })
    }

    this.window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)

    this.window.once('ready-to-show', () => {
      this.window?.show()
    })
  }

  private async pickAndSendFiles(): Promise<void> {
    try {
      if (!TransferService.getInstance().getSession()) {
        throw new Error('传输通道未建立（等待连接），暂时无法发送')
      }
      const options: Electron.OpenDialogOptions = {
        title: '选择要发送给控制端的文件',
        properties: ['openFile', 'multiSelections']
      }
      const result = this.window && !this.window.isDestroyed()
        ? await dialog.showOpenDialog(this.window, options)
        : await dialog.showOpenDialog(options)
      if (result.canceled || !result.filePaths || result.filePaths.length === 0) return
      await TransferService.getInstance().sendPaths(result.filePaths)
    } catch (err: any) {
      console.warn('[RemoteControlIndicator] 选择/发送文件失败:', err)
      if (this.window && !this.window.isDestroyed()) {
        const msg = err?.message || '发送失败'
        this.window.webContents.executeJavaScript(`
          const el = document.getElementById('transferStatus');
          if (el) { el.textContent = ${JSON.stringify(msg)}; el.style.color = '#ef4444'; }
        `).catch(() => {})
      }
    }
  }

  public hide(): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.hide()
    }
  }

  public destroy(): void {
    if (this.unsubTransfer) {
      this.unsubTransfer()
      this.unsubTransfer = null
    }
    if (this.window && !this.window.isDestroyed()) {
      this.window.destroy()
      this.window = null
    }
    this.onDisconnectCallback = null
  }
}
