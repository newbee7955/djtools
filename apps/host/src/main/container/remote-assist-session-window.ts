/**
 * 远程协助可信会话窗口管理器 (Remote Assist Session Window)
 * 运行在独立的 'persist:remote-assist' 分区沙箱中，严格隔离宿主主进程与普通插件环境
 */

import { app, BrowserWindow, dialog, ipcMain, type IpcMainEvent } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { RemoteAssistRole, RemoteAssistPermission, RemoteAssistSignalEnvelope } from '../services/remote-assist/remote-assist-contract.ts'
import { isValidDeviceCode, normalizePermission } from '../services/remote-assist/remote-assist-contract.ts'
import type { RemoteAssistService } from '../services/remote-assist/remote-assist-service.ts'
import { DisplayMediaController } from '../services/remote-assist/display-media-controller.ts'
import { TransferService } from '../services/remote-assist/transfer/transfer-service.ts'
import type { TransferSession, FrameTransport } from '../services/remote-assist/transfer/transfer-session.ts'
import sessionRuntime from './remote-assist-session-runtime.js?raw'

/**
 * 转义插入到 HTML 文本/属性上下文的任意网络输入，防止脚本注入
 */
function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export interface SessionWindowOptions {
  role: RemoteAssistRole
  sessionId: string
  permission: RemoteAssistPermission
  peerDeviceCode: string
  safetyCode?: string
  iceServers?: any[]
  service: RemoteAssistService
  onDestroy?: () => void
}

/**
 * 把 TransferSession 的帧桥接到会话窗口渲染进程的 `doujiao-data` DataChannel。
 * 帧的实际发送/接收由渲染进程完成（见窗口脚本的 wireDataChannel），
 * 主进程只负责中转并维护通道就绪状态与背压水位。
 */
class RendererFrameTransport implements FrameTransport {
  private open = false
  private buffered = 0
  private frameCallbacks: Array<(bytes: Uint8Array) => void> = []
  constructor(private readonly getWindow: () => BrowserWindow | null) {}
  send(bytes: Uint8Array): void {
    const win = this.getWindow()
    if (!win || win.isDestroyed()) return
    win.webContents.send('remote-assist:transfer:outgoing-chunk', Buffer.from(bytes))
  }
  bufferedAmount(): number { return this.buffered }
  isOpen(): boolean { return this.open }
  onFrame(cb: (bytes: Uint8Array) => void): void { this.frameCallbacks.push(cb) }
  notifyReady(): void { this.open = true }
  notifyClosed(): void { this.open = false }
  updateBuffered(n: number): void { this.buffered = Number.isFinite(n) ? n : 0 }
  dispatch(bytes: Uint8Array): void { for (const cb of this.frameCallbacks) cb(bytes) }
  /**
   * 丢弃所有已注册的帧回调。重复 `ready` 时为防止旧（已 dispose 但回调未摘除）的
   * TransferSession 与新会话同时收到入站帧，必须在 attach 新会话前清空回调表。
   * 注意：不改变 FrameTransport 导出接口（onFrame 仍返回 void）。
   */
  resetFrameCallbacks(): void { this.frameCallbacks = [] }
}

export class RemoteAssistSessionWindow {
  private static displayMediaController: DisplayMediaController | null = null
  private static getInfoRegistered = false
  private window: BrowserWindow | null = null
  private options: SessionWindowOptions
  private isDestroyed = false
  private isDomReady = false
  private pendingSignals: any[] = []
  private unsubWebRtc: (() => void) | null = null
  private sessionHtmlPath: string | null = null
  private ipcOnBindings: Array<{ channel: string; handler: (event: IpcMainEvent, ...args: any[]) => void }> = []
  private registeredGetInfo = false
  private transferTransport: RendererFrameTransport | null = null
  private transferSession: TransferSession | null = null
  private transferAttachedSessionId: string | null = null
  private unsubTransfer: (() => void) | null = null

  constructor(options: SessionWindowOptions) {
    this.options = options
    if (!RemoteAssistSessionWindow.displayMediaController) {
      RemoteAssistSessionWindow.displayMediaController = new DisplayMediaController('persist:remote-assist')
    }
    this.createWindow()
    this.setupIpc()
  }

  private resolvePreloadPath(): string {
    const candidates = [
      path.join(__dirname, '../preload/remoteAssistSession.cjs'),
      path.join(__dirname, '../../preload/remoteAssistSession.cjs'),
      path.resolve(__dirname, '../../../../out/preload/remoteAssistSession.cjs')
    ]
    for (const c of candidates) {
      try {
        if (require('fs').existsSync(c)) return c
      } catch {}
    }
    return candidates[0]
  }

  private createWindow(): void {
    const isController = this.options.role === 'controller'

    this.window = new BrowserWindow({
      width: isController ? 1280 : 400,
      height: isController ? 768 : 300,
      show: isController,
      title: `豆角远程协助 - ${isController ? '控制远程设备' : '受控会话'}`,
      backgroundColor: '#1e1e1e',
      autoHideMenuBar: true,
      webPreferences: {
        partition: 'persist:remote-assist',
        preload: this.resolvePreloadPath(),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false
      }
    })

    this.window.webContents.once('dom-ready', () => {
      this.isDomReady = true
      this.flushPendingSignals()
    })

    this.window.webContents.on('console-message', (_, level, message, line, sourceId) => {
      console.log(`[SessionWindow Console] [${level}] ${message} (${sourceId}:${line})`)
    })

    const htmlContent = this.generateSessionHtml()
    try {
      const sessionHtmlDir = path.join(app.getPath('userData'), 'remote-assist')
      if (!fs.existsSync(sessionHtmlDir)) {
        fs.mkdirSync(sessionHtmlDir, { recursive: true })
      }
      this.sessionHtmlPath = path.join(sessionHtmlDir, `session-${this.options.sessionId || Date.now()}.html`)
      fs.writeFileSync(this.sessionHtmlPath, htmlContent, 'utf8')
      this.window.loadFile(this.sessionHtmlPath)
    } catch (err) {
      console.error('[RemoteAssistSessionWindow] 写入会话文件失败，降级使用数据URL:', err)
      this.window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}`)
    }

    this.window.on('closed', () => {
      this.window = null
      this.destroy()
      void this.options.service.disconnect('window-closed')
    })
  }

  private flushPendingSignals(): void {
    if (!this.window || this.window.isDestroyed() || !this.isDomReady) return
    while (this.pendingSignals.length > 0) {
      const sig = this.pendingSignals.shift()
      this.window.webContents.send('remote-assist:session:signal', sig)
    }
  }

  private generateSessionHtml(): string {
    const { role, safetyCode, peerDeviceCode, iceServers } = this.options
    const isController = role === 'controller'
    // 远端来源字段一律先经白名单/转义收敛，杜绝注入 HTML/JS 上下文
    const permission = normalizePermission(this.options.permission)
    const safePeerDeviceCode = isValidDeviceCode(peerDeviceCode) ? peerDeviceCode : '未知设备'
    // 剪贴板同步指示灯的初始状态：任一类型启用即视为「同步中」
    const clipboardPolicy = TransferService.getInstance().getSettings().policy.clipboard
    const clipboardEnabled = Boolean(clipboardPolicy.text || clipboardPolicy.image || clipboardPolicy.file)
    const clipboardBadgeText = clipboardEnabled ? '剪贴板同步中' : '剪贴板同步关闭'
    const iceMode = process.env.DOUJIAO_REMOTE_ICE_MODE === 'direct-only' ? 'direct-only' : 'auto'
    const iceServersJson = JSON.stringify(
      (iceServers && iceServers.length > 0)
        ? iceServers
        : [
            { urls: 'stun:stun.douyucdn.cn:18000' },
            { urls: 'stun:stun.hitv.com:3478' },
            { urls: 'stun:stun.miwifi.com:3478' },
            { urls: 'stun:stun.chat.bilibili.com:3478' },
            { urls: 'stun:stun.cloudflare.com:3478' }
          ]
    )

    const sessionConfigJson = JSON.stringify({
      isController,
      permission,
      clipboardEnabled,
      iceMode,
      preferredFps: this.options.service.getPreferredFps(),
      iceServers: JSON.parse(iceServersJson)
    })

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>豆角远程协助会话</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; user-select: none; }
    body {
      background: #0f172a;
      color: #f8fafc;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      height: 100vh;
    }
    .titlebar {
      height: 40px;
      background: #1e293b;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 16px;
      font-size: 13px;
      border-bottom: 1px solid #334155;
    }
    .badge {
      background: #3b82f6;
      color: white;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 600;
    }
    .btn-disconnect {
      background: #ef4444;
      color: white;
      border: none;
      padding: 4px 12px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
    }
    .btn-disconnect:hover { background: #dc2626; }
    .viewport {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      position: relative;
      background: #000;
      overflow: hidden;
    }
    video {
      width: 100%;
      height: 100%;
      object-fit: contain;
      display: block;
      cursor: ${permission === 'control' ? 'none' : 'default'};
    }
    .quality-select {
      background: #0f172a;
      color: #f8fafc;
      border: 1px solid #334155;
      border-radius: 4px;
      padding: 4px 6px;
      font-size: 12px;
    }
    /* 全屏时悬浮条：顶部居中（Top Center），默认完全隐藏在屏幕顶外，鼠标滑到屏幕顶部时丝滑滑出 */
    .fs-hud { display: none; }
    body.fs-active .fs-hud {
      display: flex;
      align-items: center;
      position: fixed;
      top: 0;
      left: 50%;
      transform: translate(-50%, -100%);
      z-index: 10000;
      gap: 10px;
      padding: 6px 14px 8px;
      background: rgba(15, 23, 42, 0.92);
      backdrop-filter: blur(10px);
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-top: none;
      border-radius: 0 0 10px 10px;
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.5);
      opacity: 0;
      pointer-events: none;
      transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.2s ease;
    }
    body.fs-active .fs-hud.visible {
      transform: translate(-50%, 0);
      opacity: 1;
      pointer-events: auto;
    }
    .fs-hud button {
      background: rgba(30, 41, 59, 0.85);
      border: 1px solid rgba(255, 255, 255, 0.2);
      color: #f8fafc;
      padding: 4px 10px;
      border-radius: 4px;
      font-size: 12px;
      cursor: pointer;
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
    }
    .fs-hud button:hover {
      background: rgba(51, 65, 85, 0.95);
    }
    /* 聊天消息单行滚动提示 */
    .chat-panel {
      border-bottom: 1px solid #334155;
    }
    #chatLog {
      color: #cbd5e1;
      font-family: monospace;
    }
    /* 传输面板状态微调 */
    #transferStatus {
      font-family: monospace;
      padding: 2px 6px;
      background: rgba(15, 23, 42, 0.6);
      border-radius: 4px;
      font-size: 11px;
      color: #94a3b8;
    }
    .stats {
      font-size: 11px;
      color: #94a3b8;
      pointer-events: none !important;
      user-select: none;
    }
    /* 真·全屏：隐藏所有页内标题栏/面板，只保留远端画面 */
    body.fs-active .titlebar, body.fs-active .transfer-panel, body.fs-active .chat-panel { display: none !important; }
    /* 无全屏权限时的降级方案：把视口铺满整个窗口 */
    body.pseudo-fs .viewport { position: fixed; inset: 0; z-index: 9999; background: #000; }
  </style>
</head>
<body>
  ${isController ? `
  <div class="titlebar">
    <div style="display: flex; align-items: center; gap: 8px; flex: 1; overflow: hidden;">
      <span>正在协助伙伴: <strong>${escapeHtml(safePeerDeviceCode)}</strong></span>
      <span class="badge">${permission === 'control' ? '可控' : '仅看'}</span>
      <span class="badge" id="connModeBadge" style="background: #3b82f6;">连接中...</span>
      <span class="badge" id="clipboardBadge" style="background: #0ea5e9;">${clipboardBadgeText}</span>
      <span class="stats" id="statsBar" style="margin-left: 8px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">WebRTC 握手中...</span>
    </div>
    <div style="display: flex; align-items: center; gap: 8px; flex-shrink: 0;">
      <label for="qualitySelect" style="font-size: 12px; color: #94a3b8;">画质</label>
      <select id="qualitySelect" class="quality-select" title="选择传给本机的画面分辨率">
        <option value="native">原始</option>
        <option value="1080p" selected>高清 1080p</option>
        <option value="720p">流畅 720p</option>
        <option value="540p">省流 540p</option>
      </select>
      <span id="qualityStatus" style="font-size:12px;color:#94a3b8;min-width:72px;"></span>
      <label for="fpsSelect" style="font-size: 12px; color: #94a3b8;">帧率</label>
      <select id="fpsSelect" class="quality-select" title="选择画面传输帧率">
        <option value="60">60 FPS</option>
        <option value="30">30 FPS</option>
        <option value="15">15 FPS</option>
      </select>
      <span id="fpsStatus" style="font-size:12px;color:#94a3b8;min-width:60px;"></span>
      <button class="btn-disconnect" id="cursorModeBtn" style="background: #334155;" title="切换光标模式：仅远端光标(默认无重影) 或 开启本地即时光标">光标: 仅远端</button>
      <button class="btn-disconnect" id="fullscreenBtn" style="background: #334155;" title="全屏显示 (F11)">全屏</button>
      <button class="btn-disconnect" id="disconnectBtn">断开连接</button>
    </div>
  </div>
  <div class="transfer-panel" id="transferPanel" style="display:${isController && permission === 'control' ? 'flex' : 'none'};gap:8px;align-items:center;padding:6px 12px;background:#1e293b;border-bottom:1px solid #334155;">
    <button class="btn-disconnect" id="sendFilesBtn" style="background:#334155;">发送文件</button>
    <span id="transferStatus" style="font-size:12px;color:#94a3b8;">就绪</span>
    <button class="btn-disconnect" id="openFolderBtn" style="background:#334155;">打开接收文件夹</button>
  </div>
  <div class="chat-panel" id="chatPanel" style="display:${isController && permission === 'control' ? 'flex' : 'none'};gap:6px;align-items:center;height:32px;padding:0 12px;background:#0f172a;border-bottom:1px solid #334155;">
    <div id="chatLog" style="flex:1;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-size:12px;"></div>
    <input id="chatInput" placeholder="输入消息后回车" style="width:220px;background:#020617;color:#f8fafc;border:1px solid #334155;border-radius:4px;padding:3px 6px;font-size:12px;" />
  </div>
  <div class="fs-hud" id="fsHud">
    <span class="stats" id="fsHudStats" style="margin-right: 6px;"></span>
    <button id="fsHudExit">退出全屏 (Esc)</button>
    <button id="fsHudDisconnect" style="background: rgba(153, 27, 27, 0.9);">断开连接</button>
  </div>
  <div class="viewport" id="viewport">
    <video id="remoteVideo" autoplay playsinline muted></video>
  </div>
  ` : `
  <div style="padding: 20px; text-align: center;">
    <h3>远程协助受控运行中</h3>
    <p style="margin-top: 10px; color: #94a3b8;">此窗口在后台负责 WebRTC 桌面捕获与传输</p>
    <p style="margin-top: 12px;"><span class="badge" id="clipboardBadge" style="background: #0ea5e9;">${clipboardBadgeText}</span></p>
  </div>
  `}

  <script>window.__RA_SESSION__=${sessionConfigJson};</script>
  <script>` + sessionRuntime + `</script>
</body>
</html>`
  }

  private isFromThisWindow(event: { sender: Electron.WebContents }): boolean {
    return Boolean(this.window && !this.window.isDestroyed() && event.sender === this.window.webContents)
  }

  private setupIpc(): void {
    // 仅查看（view-only）会话：禁止主动发送文件与聊天，并把闸门下发给 TransferService
    const canSend = this.options.permission === 'control'
    // 监听服务层从远端接收到的 WebRTC 信令，转发给会话窗口渲染进程
    this.unsubWebRtc = this.options.service.onWebRtcSignal((envelope: RemoteAssistSignalEnvelope) => {
      const sig = {
        type: envelope.type,
        from: envelope.from,
        ...(envelope.payload || {})
      }
      this.sendSignal(sig)
    })

    // 绑定按窗口隔离的 IPC：仅接受来自本会话窗口 webContents 的消息，
    // 并在销毁时用 removeListener 精确解绑，避免多窗口互相覆盖监听器
    const bind = (channel: string, handler: (event: IpcMainEvent, ...args: any[]) => void) => {
      const wrapped = (event: IpcMainEvent, ...args: any[]) => {
        if (!this.isFromThisWindow(event)) return
        handler(event, ...args)
      }
      ipcMain.on(channel, wrapped)
      this.ipcOnBindings.push({ channel, handler: wrapped })
    }

    bind('remote-assist:session:signal', (_event, sig: any) => {
      if (sig && sig.type) {
        this.options.service.sendWebRtcSignal(sig.type, sig)
      }
    })

    bind('remote-assist:session:input', (_event, inputEvent: any) => {
      try {
        this.options.service.handleRemoteInput({
          ...inputEvent,
          sessionId: this.options.sessionId
        })
      } catch (err) {
        console.warn('[RemoteAssistSessionWindow] 忽略无效远程输入:', err)
      }
    })

    bind('remote-assist:session:hide-cursor', (_event, hidden: boolean) => {
      this.options.service.setRemoteCursorHidden(Boolean(hidden))
    })

    bind('remote-assist:session:disconnect', (_event, reason?: string) => {
      this.options.service.disconnect(reason || 'window-closed')
    })

    bind('remote-assist:session:connected', () => {
      this.options.service.setConnected()
    })

    bind('remote-assist:session:stats', (_event, stats: any) => {
      this.options.service.updateConnectionStats(stats)
    })

    bind('remote-assist:session:set-preferred-fps', (_event, fps: number) => {
      this.options.service.setPreferredFps(fps)
    })

    // 传输/聊天：把会话窗口的 `doujiao-data` DataChannel 桥接到 TransferService
    const transport = new RendererFrameTransport(() => this.window)
    this.transferTransport = transport

    bind('remote-assist:transfer:ready', () => {
      transport.notifyReady()
      // 重复 `ready` 幂等：同一会话已 attach 则直接复用，避免在同一个 transport 上
      // 叠加出多个 TransferSession（旧会话虽已 dispose，但其 onFrame 回调仍在表内，
      // 会导致入站帧被重复派发到已处置会话）。仅当会话标识变化时才重新 attach。
      if (this.transferSession && this.transferAttachedSessionId === this.options.sessionId) return
      // attach 新会话前清空旧回调，确保只有最新会话接收入站帧
      transport.resetFrameCallbacks()
      this.transferSession = TransferService.getInstance().attach(transport, this.options.sessionId)
      // 远程协助会话连接就绪：确保默认放行文件接收与剪贴板同步
      TransferService.getInstance().setPolicy({
        receiveFiles: true,
        clipboard: { text: true, image: true, file: true }
      })
      // attach 后下发外发闸门：仅查看会话下会话层直接禁止主动发送
      TransferService.getInstance().setOutgoingAllowed(canSend)
      this.transferAttachedSessionId = this.options.sessionId
    })
    bind('remote-assist:transfer:closed', () => transport.notifyClosed())
    bind('remote-assist:transfer:incoming-chunk', (_event, bytes: Uint8Array) => transport.dispatch(new Uint8Array(bytes)))
    bind('remote-assist:transfer:backpressure', (_event, n: number) => transport.updateBuffered(n))
    bind('remote-assist:transfer:chat-from-window', (_event, text: string) => {
      if (!canSend) {
        console.warn('[RemoteAssistSessionWindow] 仅查看会话禁止发送聊天消息')
        return
      }
      this.transferSession?.sendChat(text)
    })
    bind('remote-assist:transfer:request-send', () => {
      if (!canSend) {
        console.warn('[RemoteAssistSessionWindow] 仅查看会话禁止发送文件')
        return
      }
      void this.pickAndSendFiles()
    })
    // 打开接收文件夹：会话窗口不是插件容器，plugin: 前缀的通道会被拒绝，
    // 因此改用会话作用域通道（bind 已带 isFromThisWindow 发送方校验）
    bind('remote-assist:transfer:open-receive-folder', () => {
      void TransferService.getInstance().openReceiveFolder().catch((err) => {
        console.warn('[RemoteAssistSessionWindow] 打开接收文件夹失败:', err)
      })
    })

    this.unsubTransfer = TransferService.getInstance().onEvent((event) => {
      const win = this.window
      if (!win || win.isDestroyed()) return
      if (event.type === 'transfer-state') win.webContents.send('remote-assist:transfer:state', event.state)
      else if (event.type === 'transfer-chat') win.webContents.send('remote-assist:transfer:chat', event.text)
      else if (event.type === 'clipboard-applied') win.webContents.send('remote-assist:transfer:clipboard-applied', event.kind)
    })

    if (!RemoteAssistSessionWindow.getInfoRegistered) {
      ipcMain.handle('remote-assist:session:get-info', (event) => {
        if (!this.isFromThisWindow(event)) return null
        return {
          sessionId: this.options.sessionId,
          role: this.options.role,
          permission: normalizePermission(this.options.permission),
          peerDeviceCode: this.options.peerDeviceCode,
          safetyCode: this.options.safetyCode
        }
      })
      RemoteAssistSessionWindow.getInfoRegistered = true
      this.registeredGetInfo = true
    }
  }

  /**
   * 弹出系统文件选择框并把选中的路径交给 TransferService 发送。
   * 选好后同时回传渲染进程用于 UI 反馈（preload 的 onPickResult）。
   */
  private async pickAndSendFiles(): Promise<void> {
    const win = this.window
    try {
      // 容错自愈：若发送时发现当前 TransferSession 尚未 attach，但底层 transport 存在，
      // 主动补位 attach，消除主进程与渲染进程 ready IPC 之间的微小竞态
      if (!this.transferSession && this.transferTransport) {
        this.transferTransport.notifyReady()
        this.transferTransport.resetFrameCallbacks()
        this.transferSession = TransferService.getInstance().attach(this.transferTransport, this.options.sessionId)
        TransferService.getInstance().setPolicy({
          receiveFiles: true,
          clipboard: { text: true, image: true, file: true }
        })
        TransferService.getInstance().setOutgoingAllowed(this.options.permission === 'control')
        this.transferAttachedSessionId = this.options.sessionId
      }
      const options: Electron.OpenDialogOptions = {
        title: '选择要发送的文件',
        properties: ['openFile', 'multiSelections']
      }
      const result = win && !win.isDestroyed()
        ? await dialog.showOpenDialog(win, options)
        : await dialog.showOpenDialog(options)
      if (result.canceled || !result.filePaths || result.filePaths.length === 0) return
      if (win && !win.isDestroyed()) {
        win.webContents.send('host:transfer:pick-files', result.filePaths)
      }
      await TransferService.getInstance().sendPaths(result.filePaths)
    } catch (err) {
      console.warn('[RemoteAssistSessionWindow] 选择/发送文件失败:', err)
      // 把失败原因回传会话窗口，让 UI 有可见反馈（而非仅 console.warn 后"点了没反应"）
      const message = String(err && (err as any).message ? (err as any).message : err)
      if (win && !win.isDestroyed()) {
        win.webContents.send('remote-assist:transfer:error', message)
      }
    }
  }

  public sendSignal(envelope: any): void {
    if (!this.window || this.window.isDestroyed()) return
    if (!this.isDomReady) {
      this.pendingSignals.push(envelope)
      return
    }
    this.window.webContents.send('remote-assist:session:signal', envelope)
  }

  public destroy(): void {
    if (this.isDestroyed) return
    this.isDestroyed = true

    this.options.onDestroy?.()

    if (this.unsubWebRtc) {
      this.unsubWebRtc()
      this.unsubWebRtc = null
    }

    for (const { channel, handler } of this.ipcOnBindings) {
      ipcMain.removeListener(channel, handler)
    }
    this.ipcOnBindings = []

    if (this.unsubTransfer) {
      this.unsubTransfer()
      this.unsubTransfer = null
    }
    if (this.transferSession) {
      TransferService.getInstance().detach()
      this.transferSession = null
      this.transferAttachedSessionId = null
    }
    this.transferTransport = null

    if (this.registeredGetInfo) {
      ipcMain.removeHandler('remote-assist:session:get-info')
      RemoteAssistSessionWindow.getInfoRegistered = false
      this.registeredGetInfo = false
    }

    if (this.window && !this.window.isDestroyed()) {
      this.window.destroy()
      this.window = null
    }

    if (this.sessionHtmlPath) {
      try {
        if (fs.existsSync(this.sessionHtmlPath)) {
          fs.unlinkSync(this.sessionHtmlPath)
        }
      } catch {}
      this.sessionHtmlPath = null
    }
  }
}
