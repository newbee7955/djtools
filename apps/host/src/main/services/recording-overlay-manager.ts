import { app, BrowserWindow, screen, ipcMain } from 'electron'
import { join } from 'path'
import { existsSync, writeFileSync, mkdirSync } from 'fs'
import type { NormalizedRecordingOptions, RecordingBounds } from './screen-recording-core'

export interface RecordingOverlayConfig {
  recordingId: string
  bounds: RecordingBounds
  options: NormalizedRecordingOptions
  onStop: () => void
  onCancel: () => void
}

export class RecordingOverlayManager {
  private static instance: RecordingOverlayManager | null = null
  private toolbarWindow: BrowserWindow | null = null
  private drawingWindow: BrowserWindow | null = null
  private activeConfig: RecordingOverlayConfig | null = null
  private ipcRegistered = false
  private audioResolver: ((buffer: Buffer | null) => void) | null = null

  private constructor() {
    this.registerIpc()
  }

  public static getInstance(): RecordingOverlayManager {
    if (!RecordingOverlayManager.instance) {
      RecordingOverlayManager.instance = new RecordingOverlayManager()
    }
    return RecordingOverlayManager.instance
  }

  public async start(config: RecordingOverlayConfig): Promise<void> {
    this.activeConfig = config
    const { bounds, options } = config

    const cacheDir = join(app.getPath('userData'), 'cache')
    if (!existsSync(cacheDir)) {
      mkdirSync(cacheDir, { recursive: true })
    }

    const toolbarHtmlPath = join(cacheDir, 'recording-toolbar.html')
    writeFileSync(toolbarHtmlPath, this.generateToolbarHtml(), 'utf-8')

    const drawingHtmlPath = join(cacheDir, 'recording-drawing.html')
    writeFileSync(drawingHtmlPath, this.generateDrawingHtml(), 'utf-8')

    const preloadPath = this.resolvePreloadPath()
    const targetDisplay = screen.getDisplayNearestPoint({ x: bounds.x, y: bounds.y })

    // 1. 创建全屏透明画板窗口 (覆盖所在显示器)
    const drawingWin = new BrowserWindow({
      x: targetDisplay.bounds.x,
      y: targetDisplay.bounds.y,
      width: targetDisplay.bounds.width,
      height: targetDisplay.bounds.height,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      hasShadow: false,
      backgroundColor: '#00000000',
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        preload: preloadPath
      }
    })
    drawingWin.setAlwaysOnTop(true, 'screen-saver', 1)
    drawingWin.setVisibleOnAllWorkspaces(true)
    // 默认鼠标穿透 (指针模式)
    drawingWin.setIgnoreMouseEvents(true, { forward: true })
    this.drawingWindow = drawingWin

    drawingWin.loadFile(drawingHtmlPath).catch((err) => {
      console.error('[RecordingOverlayManager] 加载画板窗口失败:', err)
    })

    // 2. 创建置顶悬浮操作栏窗口 (初始紧凑折叠状态 320px，展开画笔时动态扩展至 760px)
    const initialToolbarWidth = 320
    const toolbarHeight = 52
    let tbX = targetDisplay.bounds.x + Math.max(10, Math.round((targetDisplay.bounds.width - initialToolbarWidth) / 2))
    let tbY = targetDisplay.bounds.y + targetDisplay.bounds.height - 80

    if (options.mode === 'region') {
      tbX = Math.max(
        targetDisplay.bounds.x + 10,
        Math.min(
          bounds.x + Math.round((bounds.width - initialToolbarWidth) / 2),
          targetDisplay.bounds.x + targetDisplay.bounds.width - initialToolbarWidth - 10
        )
      )
      if (bounds.y + bounds.height + toolbarHeight + 16 <= targetDisplay.bounds.y + targetDisplay.bounds.height) {
        tbY = bounds.y + bounds.height + 14
      } else if (bounds.y - toolbarHeight - 14 >= targetDisplay.bounds.y) {
        tbY = bounds.y - toolbarHeight - 14
      } else {
        tbY = targetDisplay.bounds.y + targetDisplay.bounds.height - 80
      }
    }

    const toolbarWin = new BrowserWindow({
      x: tbX,
      y: tbY,
      width: initialToolbarWidth,
      height: toolbarHeight,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      hasShadow: false,
      backgroundColor: '#00000000',
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        preload: preloadPath
      }
    })
    toolbarWin.setAlwaysOnTop(true, 'screen-saver', 2)
    toolbarWin.setVisibleOnAllWorkspaces(true)
    this.toolbarWindow = toolbarWin

    toolbarWin.loadFile(toolbarHtmlPath).catch((err) => {
      console.error('[RecordingOverlayManager] 加载悬浮操作栏失败:', err)
    })

    if (!options.showToolbar) {
      toolbarWin.hide()
    }
  }

  public async stop(): Promise<{ audioBuffer?: Buffer }> {
    let audioBuffer: Buffer | undefined

    if (this.toolbarWindow && !this.toolbarWindow.isDestroyed()) {
      try {
        const audioPromise = new Promise<Buffer | null>((resolve) => {
          this.audioResolver = resolve
          setTimeout(() => resolve(null), 2500)
        })

        // 通知工具栏停止音频录制并回传数据
        this.toolbarWindow.webContents.send('host:recording-overlay:event', {
          event: 'stop-audio'
        })

        const res = await audioPromise
        if (res && res.length > 0) {
          audioBuffer = res
        }
      } catch (err) {
        console.warn('[RecordingOverlayManager] 提取录制音频异常:', err)
      }
    }

    this.closeWindows()
    return { audioBuffer }
  }

  public cancel(): void {
    this.closeWindows()
  }

  private closeWindows(): void {
    if (this.audioResolver) {
      const resolve = this.audioResolver
      this.audioResolver = null
      resolve(null)
    }

    if (this.toolbarWindow && !this.toolbarWindow.isDestroyed()) {
      this.toolbarWindow.close()
      this.toolbarWindow = null
    }

    if (this.drawingWindow && !this.drawingWindow.isDestroyed()) {
      this.drawingWindow.close()
      this.drawingWindow = null
    }

    this.activeConfig = null
  }

  private resolvePreloadPath(): string {
    const candidates = [
      join(__dirname, '../preload/recordingOverlay.cjs'),
      join(__dirname, '../preload/recording-overlay.cjs'),
      join(app.getAppPath(), 'out/preload/recordingOverlay.cjs'),
      join(app.getAppPath(), 'out/preload/recording-overlay.cjs'),
      join(app.getAppPath(), 'apps/host/out/preload/recordingOverlay.cjs')
    ]
    for (const c of candidates) {
      if (existsSync(c)) return c
    }
    return candidates[0]
  }

  private registerIpc(): void {
    if (this.ipcRegistered) return
    this.ipcRegistered = true

    ipcMain.handle('host:recording-overlay:get-state', () => {
      if (!this.activeConfig) return null
      return {
        recordingId: this.activeConfig.recordingId,
        bounds: this.activeConfig.bounds,
        format: this.activeConfig.options.format,
        startedAt: Date.now(),
        recordSystemAudio: this.activeConfig.options.recordSystemAudio,
        recordMicrophone: this.activeConfig.options.recordMicrophone,
        showToolbar: this.activeConfig.options.showToolbar
      }
    })

    ipcMain.handle('host:recording-overlay:action', (_, payload: { action: string; payload?: any }) => {
      const { action, payload: data } = payload || {}

      if (action === 'setToolbarExpanded') {
        const expanded = Boolean(data?.expanded)
        if (this.toolbarWindow && !this.toolbarWindow.isDestroyed()) {
          const currentBounds = this.toolbarWindow.getBounds()
          const targetWidth = expanded ? 760 : 320
          const deltaW = targetWidth - currentBounds.width
          let newX = Math.round(currentBounds.x - deltaW / 2)
          const display = screen.getDisplayNearestPoint({ x: newX, y: currentBounds.y })
          if (newX < display.bounds.x + 10) {
            newX = display.bounds.x + 10
          } else if (newX + targetWidth > display.bounds.x + display.bounds.width - 10) {
            newX = display.bounds.x + display.bounds.width - targetWidth - 10
          }
          this.toolbarWindow.setBounds({
            x: newX,
            y: currentBounds.y,
            width: targetWidth,
            height: 52
          })
          this.toolbarWindow.setAlwaysOnTop(true, 'screen-saver', 2)
          this.toolbarWindow.moveTop()
        }
      } else if (action === 'setTool') {
        const isPointer = data?.tool === 'pointer'
        if (this.drawingWindow && !this.drawingWindow.isDestroyed()) {
          if (isPointer) {
            this.drawingWindow.setIgnoreMouseEvents(true, { forward: true })
          } else {
            this.drawingWindow.setIgnoreMouseEvents(false)
          }
          this.drawingWindow.webContents.send('host:recording-overlay:event', {
            event: 'setTool',
            payload: data
          })
        }
        if (this.toolbarWindow && !this.toolbarWindow.isDestroyed()) {
          this.toolbarWindow.webContents.send('host:recording-overlay:event', {
            event: 'setTool',
            payload: data
          })
          this.toolbarWindow.setAlwaysOnTop(true, 'screen-saver', 2)
          this.toolbarWindow.moveTop()
        }
      } else if (action === 'undo' || action === 'clear' || action === 'setColor' || action === 'setWidth') {
        if (this.drawingWindow && !this.drawingWindow.isDestroyed()) {
          this.drawingWindow.webContents.send('host:recording-overlay:event', {
            event: action,
            payload: data
          })
        }
        if (this.toolbarWindow && !this.toolbarWindow.isDestroyed()) {
          this.toolbarWindow.setAlwaysOnTop(true, 'screen-saver', 2)
          this.toolbarWindow.moveTop()
        }
      }
      return { success: true }
    })

    ipcMain.handle('host:recording-overlay:submit-audio', (_, base64Audio: string) => {
      if (this.audioResolver) {
        try {
          const buf = Buffer.from(base64Audio, 'base64')
          this.audioResolver(buf)
        } catch {
          this.audioResolver(null)
        }
        this.audioResolver = null
      }
      return true
    })

    ipcMain.handle('host:recording-overlay:stop', () => {
      this.activeConfig?.onStop()
      return true
    })

    ipcMain.handle('host:recording-overlay:cancel', () => {
      this.activeConfig?.onCancel()
      return true
    })
  }

  /**
   * 生成悬浮胶囊操作栏 HTML
   */
  private generateToolbarHtml(): string {
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>Recording Toolbar</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; user-select: none; }
    html, body {
      width: 100vw; height: 100vh;
      overflow: hidden; background: transparent;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif;
      display: flex; align-items: center; justify-content: center;
    }
    .bar {
      display: flex; align-items: center; gap: 6px;
      padding: 6px 12px;
      background: rgba(15, 23, 42, 0.94);
      border: 1px solid rgba(255, 255, 255, 0.16);
      border-radius: 9999px;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5), 0 2px 8px rgba(0,0,0,0.3);
      backdrop-filter: blur(16px);
      color: #f8fafc; font-size: 12px;
      -webkit-app-region: drag;
      max-width: 100%;
    }
    .drag-handle {
      cursor: grab; display: flex; align-items: center; justify-content: center;
      color: #94a3b8; padding: 0 2px; flex-shrink: 0;
    }
    .drag-handle svg { width: 13px; height: 13px; pointer-events: none; }
    .status-badge {
      display: flex; align-items: center; gap: 6px;
      padding-right: 4px; font-variant-numeric: tabular-nums;
      font-weight: 600; font-size: 12px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      -webkit-app-region: no-drag;
      flex-shrink: 0;
    }
    .pulse-dot {
      width: 8px; height: 8px; border-radius: 50%;
      background: #ef4444;
      box-shadow: 0 0 8px rgba(239, 68, 68, 0.8);
      animation: pulse 1.2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
    }
    @keyframes pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: .4; transform: scale(.85); } }
    .divider {
      width: 1px; height: 18px; background: rgba(255, 255, 255, 0.15); margin: 0 2px;
      flex-shrink: 0;
    }
    .btn {
      -webkit-app-region: no-drag;
      display: inline-flex; align-items: center; justify-content: center;
      height: 28px; border-radius: 7px; border: 1px solid transparent;
      cursor: pointer; background: rgba(255, 255, 255, 0.08); color: #cbd5e1;
      font-size: 12px; font-weight: 500; padding: 0 8px; gap: 4px;
      transition: all .15s ease;
      flex-shrink: 0;
    }
    .btn:hover { background: rgba(255, 255, 255, 0.16); color: #ffffff; }
    .btn:active { transform: scale(0.96); }
    .btn.active {
      background: #0284c7; color: #ffffff; border-color: #38bdf8;
      box-shadow: 0 0 10px rgba(56, 189, 248, 0.4);
    }
    .btn-icon { width: 28px; padding: 0; }
    .btn-icon svg { width: 15px; height: 15px; pointer-events: none; }
    .btn-stop {
      background: #dc2626; color: #ffffff; border-color: #ef4444;
      font-weight: 600; padding: 0 10px;
    }
    .btn-stop:hover { background: #b91c1c; border-color: #f87171; }
    .btn-cancel {
      background: transparent; color: #94a3b8;
    }
    .btn-cancel:hover { background: rgba(255, 255, 255, 0.1); color: #f87171; }
    .audio-badge {
      display: inline-flex; align-items: center; gap: 3px; font-size: 11px;
      padding: 0 6px; height: 26px; border-radius: 6px; background: rgba(255, 255, 255, 0.06);
      color: #94a3b8; -webkit-app-region: no-drag;
      flex-shrink: 0;
    }
    .audio-badge.active { color: #38bdf8; background: rgba(56, 189, 248, 0.12); }
    .audio-badge svg { width: 13px; height: 13px; }
    .tool-group {
      display: none; align-items: center; gap: 4px;
      -webkit-app-region: no-drag;
      flex-shrink: 0;
    }
    .tool-group.show { display: flex; }
    .color-pill {
      width: 15px; height: 15px; border-radius: 50%; cursor: pointer;
      border: 2px solid rgba(0,0,0,0.3); transition: transform .15s;
      -webkit-app-region: no-drag;
      flex-shrink: 0;
    }
    .color-pill:hover { transform: scale(1.25); }
    .color-pill.active { border-color: #ffffff; transform: scale(1.25); box-shadow: 0 0 6px rgba(255,255,255,0.7); }
  </style>
</head>
<body>
  <div class="bar">
    <div class="drag-handle" title="拖动操作栏">
      <svg viewBox="0 0 24 24" fill="currentColor">
        <circle cx="8" cy="6" r="2"/><circle cx="16" cy="6" r="2"/>
        <circle cx="8" cy="12" r="2"/><circle cx="16" cy="12" r="2"/>
        <circle cx="8" cy="18" r="2"/><circle cx="16" cy="18" r="2"/>
      </svg>
    </div>

    <div class="status-badge">
      <span class="pulse-dot"></span>
      <span id="timerText">00:00</span>
    </div>

    <!-- 音频状态展示与麦克风静音切换 -->
    <div class="audio-badge" id="badgeSysAudio" title="系统声音">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
        <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
      </svg>
    </div>
    <button class="btn btn-icon audio-badge" id="btnMic" title="麦克风 (点击切换静音)">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
        <path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>
      </svg>
    </button>

    <div class="divider"></div>

    <!-- 画笔展开开关 -->
    <button class="btn btn-icon" id="btnTogglePen" title="屏幕批注/画笔工具">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>
      </svg>
    </button>

    <!-- 画笔展开后的工具箱 -->
    <div class="tool-group" id="penToolGroup">
      <button class="btn btn-icon active" id="toolPointer" title="鼠标指针模式 (可正常操作下方软件)">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="m3 3 7 18 3-7 7-3L3 3z"/>
        </svg>
      </button>
      <button class="btn btn-icon" id="toolBrush" title="自由画笔">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/>
        </svg>
      </button>
      <button class="btn btn-icon" id="toolHighlighter" title="荧光高亮笔">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="m9 11-6 6v3h3l6-6"/><path d="m22 2-2.5 2.5a2.12 2.12 0 0 1-3 0L15 3l-4 4 6 6 4-4-1.5-1.5a2.12 2.12 0 0 1 0-3L22 2Z"/>
        </svg>
      </button>
      <button class="btn btn-icon" id="toolRect" title="矩形框">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2"/>
        </svg>
      </button>
      <button class="btn btn-icon" id="toolArrow" title="箭头指示">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
        </svg>
      </button>

      <div class="divider"></div>

      <!-- 调色板 -->
      <div class="color-pill active" style="background:#ef4444" data-color="#ef4444" title="红色"></div>
      <div class="color-pill" style="background:#f59e0b" data-color="#f59e0b" title="黄色"></div>
      <div class="color-pill" style="background:#10b981" data-color="#10b981" title="绿色"></div>
      <div class="color-pill" style="background:#3b82f6" data-color="#3b82f6" title="蓝色"></div>
      <div class="color-pill" style="background:#ffffff" data-color="#ffffff" title="白色"></div>

      <div class="divider"></div>

      <!-- 撤销与清屏 -->
      <button class="btn btn-icon" id="btnUndo" title="撤销 (Ctrl+Z)">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5 5.5 5.5 0 0 1-5.5 5.5H11"/>
        </svg>
      </button>
      <button class="btn btn-icon" id="btnClear" title="清屏所有批注">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
        </svg>
      </button>
    </div>

    <div class="divider"></div>

    <button class="btn btn-stop" id="btnStop" title="停止录制并保存视频">
      <svg viewBox="0 0 24 24" fill="currentColor" style="width:11px;height:11px;margin-right:2px"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>
      停止
    </button>
    <button class="btn btn-icon btn-cancel" id="btnCancel" title="取消录制">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
      </svg>
    </button>
  </div>

  <script>
    (async function() {
      let attempts = 0;
      while (!window.recordingOverlayAPI?.getInitialState && attempts < 50) {
        await new Promise((r) => setTimeout(r, 40));
        attempts++;
      }
      const api = window.recordingOverlayAPI;
      if (!api) return;

      const state = await api.getInitialState();
      if (!state) return;

      // ── 计时器 ──────────────────────────────────────────────────────────
      const startTime = state.startedAt || Date.now();
      const timerEl = document.getElementById('timerText');
      function updateTimer() {
        const diff = Math.max(0, Math.floor((Date.now() - startTime) / 1000));
        const m = String(Math.floor(diff / 60)).padStart(2, '0');
        const s = String(diff % 60).padStart(2, '0');
        timerEl.textContent = m + ':' + s;
      }
      setInterval(updateTimer, 500);
      updateTimer();

      // ── 音频采集引擎 (WebRTC & MediaRecorder) ───────────────────────────
      let audioStream = null;
      let mediaRecorder = null;
      let recordedChunks = [];
      let micTrack = null;
      let systemTrack = null;
      let micMuted = false;

      const badgeSysAudio = document.getElementById('badgeSysAudio');
      const btnMic = document.getElementById('btnMic');

      if (!state.recordSystemAudio) {
        badgeSysAudio.style.display = 'none';
      } else {
        badgeSysAudio.classList.add('active');
      }

      if (!state.recordMicrophone) {
        btnMic.style.display = 'none';
      } else {
        btnMic.classList.add('active');
      }

      async function initAudioEngine() {
        if (!state.recordSystemAudio && !state.recordMicrophone) return;
        try {
          const audioTracks = [];
          const withTimeout = (promise, ms = 2500) =>
            Promise.race([
              promise,
              new Promise((_, reject) => setTimeout(() => reject(new Error('AUDIO_TIMEOUT')), ms))
            ]);

          // 1. 系统声音 loopback 捕获
          if (state.recordSystemAudio) {
            try {
              const desktopStream = await withTimeout(navigator.mediaDevices.getUserMedia({
                audio: { mandatory: { chromeMediaSource: 'desktop' } },
                video: { mandatory: { chromeMediaSource: 'desktop' } }
              }));
              systemTrack = desktopStream.getAudioTracks()[0];
              desktopStream.getVideoTracks().forEach(t => t.stop());
              if (systemTrack) audioTracks.push(systemTrack);
            } catch (err) {
              console.warn('[AudioEngine] 捕获系统扬声器声音失败:', err);
            }
          }

          // 2. 麦克风捕获
          if (state.recordMicrophone) {
            try {
              const micStream = await withTimeout(navigator.mediaDevices.getUserMedia({ audio: true }));
              micTrack = micStream.getAudioTracks()[0];
              if (micTrack) audioTracks.push(micTrack);
            } catch (err) {
              console.warn('[AudioEngine] 捕获麦克风声音失败:', err);
            }
          }

          if (audioTracks.length === 0) return;

          // 3. AudioContext 混音
          const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
          const dest = audioCtx.createMediaStreamDestination();
          audioTracks.forEach(track => {
            const src = audioCtx.createMediaStreamSource(new MediaStream([track]));
            src.connect(dest);
          });

          audioStream = dest.stream;
          mediaRecorder = new MediaRecorder(audioStream, {
            mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
              ? 'audio/webm;codecs=opus'
              : 'audio/webm'
          });
          recordedChunks = [];
          mediaRecorder.ondataavailable = (e) => {
            if (e.data && e.data.size > 0) recordedChunks.push(e.data);
          };
          mediaRecorder.start(200);
        } catch (err) {
          console.error('[AudioEngine] 初始化混音录音器异常:', err);
        }
      }

      initAudioEngine();

      btnMic.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!micTrack) return;
        micMuted = !micMuted;
        micTrack.enabled = !micMuted;
        if (micMuted) {
          btnMic.classList.remove('active');
          btnMic.title = '麦克风已静音 (点击开启)';
        } else {
          btnMic.classList.add('active');
          btnMic.title = '麦克风 (点击切换静音)';
        }
      });

      api.onEvent(async (event, payload) => {
        if (event === 'stop-audio') {
          if (!mediaRecorder || mediaRecorder.state === 'inactive') {
            api.submitAudio('');
            return;
          }
          mediaRecorder.onstop = async () => {
            if (audioStream) audioStream.getTracks().forEach(t => t.stop());
            if (systemTrack) systemTrack.stop();
            if (micTrack) micTrack.stop();

            const blob = new Blob(recordedChunks, { type: 'audio/webm' });
            const arrayBuf = await blob.arrayBuffer();
            const bytes = new Uint8Array(arrayBuf);
            let binary = '';
            for (let i = 0; i < bytes.byteLength; i++) {
              binary += String.fromCharCode(bytes[i]);
            }
            const base64 = btoa(binary);
            api.submitAudio(base64);
          };
          mediaRecorder.stop();
        } else if (event === 'setTool') {
          const tool = payload?.tool;
          if (tool === 'pointer') {
            isPenOpen = false;
            btnTogglePen.classList.remove('active');
            penToolGroup.classList.remove('show');
            api.sendAction('setToolbarExpanded', { expanded: false });
            Object.keys(toolButtons).forEach(name => {
              toolButtons[name]?.classList.toggle('active', name === 'pointer');
            });
          }
        }
      });

      // ── 画笔工具组交互 ──────────────────────────────────────────────────
      const btnTogglePen = document.getElementById('btnTogglePen');
      const penToolGroup = document.getElementById('penToolGroup');
      let isPenOpen = false;
      let activeTool = 'pointer';
      let activeColor = '#ef4444';
      let activeWidth = 3;

      btnTogglePen.addEventListener('click', (e) => {
        e.stopPropagation();
        isPenOpen = !isPenOpen;
        if (isPenOpen) {
          btnTogglePen.classList.add('active');
          penToolGroup.classList.add('show');
          api.sendAction('setToolbarExpanded', { expanded: true });
          selectTool('brush');
        } else {
          btnTogglePen.classList.remove('active');
          penToolGroup.classList.remove('show');
          api.sendAction('setToolbarExpanded', { expanded: false });
          selectTool('pointer');
        }
      });

      const toolButtons = {
        pointer: document.getElementById('toolPointer'),
        brush: document.getElementById('toolBrush'),
        highlighter: document.getElementById('toolHighlighter'),
        rect: document.getElementById('toolRect'),
        arrow: document.getElementById('toolArrow')
      };

      function selectTool(toolName) {
        activeTool = toolName;
        Object.keys(toolButtons).forEach(name => {
          toolButtons[name]?.classList.toggle('active', name === toolName);
        });
        api.sendAction('setTool', {
          tool: activeTool,
          color: activeColor,
          width: activeTool === 'highlighter' ? 12 : activeWidth
        });
      }

      Object.keys(toolButtons).forEach(name => {
        toolButtons[name]?.addEventListener('click', (e) => {
          e.stopPropagation();
          selectTool(name);
        });
      });

      // 颜色切换
      const colorPills = document.querySelectorAll('.color-pill');
      colorPills.forEach(pill => {
        pill.addEventListener('click', (e) => {
          e.stopPropagation();
          colorPills.forEach(p => p.classList.remove('active'));
          pill.classList.add('active');
          activeColor = pill.dataset.color || '#ef4444';
          api.sendAction('setColor', { color: activeColor });
          if (activeTool === 'pointer') selectTool('brush');
        });
      });

      // 撤销与清屏
      document.getElementById('btnUndo').addEventListener('click', (e) => {
        e.stopPropagation();
        api.sendAction('undo');
      });
      document.getElementById('btnClear').addEventListener('click', (e) => {
        e.stopPropagation();
        api.sendAction('clear');
      });

      // 快捷键监听
      window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          if (isPenOpen) {
            isPenOpen = false;
            btnTogglePen.classList.remove('active');
            penToolGroup.classList.remove('show');
            api.sendAction('setToolbarExpanded', { expanded: false });
            selectTool('pointer');
          } else {
            api.cancelRecording();
          }
        } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
          api.sendAction('undo');
        }
      });

      // 停止与取消
      document.getElementById('btnStop').addEventListener('click', (e) => {
        e.stopPropagation();
        api.stopRecording();
      });
      document.getElementById('btnCancel').addEventListener('click', (e) => {
        e.stopPropagation();
        api.cancelRecording();
      });
    })();
  </script>
</body>
</html>`
  }

  /**
   * 生成全屏/选区透明批注画板 HTML
   */
  private generateDrawingHtml(): string {
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>Recording Drawing Overlay</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; user-select: none; }
    html, body {
      width: 100vw; height: 100vh;
      overflow: hidden; background: transparent;
    }
    #canvas {
      position: absolute; left: 0; top: 0;
      width: 100vw; height: 100vh; display: block;
      cursor: default;
      touch-action: none;
    }
  </style>
</head>
<body>
  <canvas id="canvas"></canvas>

  <script>
    (async function() {
      let attempts = 0;
      while (!window.recordingOverlayAPI?.onEvent && attempts < 50) {
        await new Promise((r) => setTimeout(r, 40));
        attempts++;
      }
      const api = window.recordingOverlayAPI;
      if (!api) return;

      const canvas = document.getElementById('canvas');
      const ctx = canvas.getContext('2d');

      let currentTool = 'pointer';
      let currentColor = '#ef4444';
      let currentWidth = 3;
      let isDrawing = false;
      let startX = 0, startY = 0;
      let currentStroke = null;
      const history = [];

      function drawArrow(context, fromX, fromY, toX, toY, color, width) {
        const headlen = Math.max(12, width * 3);
        const angle = Math.atan2(toY - fromY, toX - fromX);
        context.save();
        context.strokeStyle = color;
        context.fillStyle = color;
        context.lineWidth = width;
        context.lineCap = 'round';
        context.lineJoin = 'round';

        context.beginPath();
        context.moveTo(fromX, fromY);
        context.lineTo(toX, toY);
        context.stroke();

        context.beginPath();
        context.moveTo(toX, toY);
        context.lineTo(toX - headlen * Math.cos(angle - Math.PI / 6), toY - headlen * Math.sin(angle - Math.PI / 6));
        context.lineTo(toX - headlen * Math.cos(angle + Math.PI / 6), toY - headlen * Math.sin(angle + Math.PI / 6));
        context.closePath();
        context.fill();
        context.restore();
      }

      function renderItem(context, item) {
        context.save();
        context.strokeStyle = item.color;
        context.fillStyle = item.color;
        context.lineWidth = item.width;
        context.lineCap = 'round';
        context.lineJoin = 'round';

        if (item.type === 'brush') {
          if (item.points.length < 2) return;
          context.beginPath();
          context.moveTo(item.points[0].x, item.points[0].y);
          for (let i = 1; i < item.points.length; i++) {
            context.lineTo(item.points[i].x, item.points[i].y);
          }
          context.stroke();
        } else if (item.type === 'highlighter') {
          if (item.points.length < 2) return;
          context.globalAlpha = 0.35;
          context.beginPath();
          context.moveTo(item.points[0].x, item.points[0].y);
          for (let i = 1; i < item.points.length; i++) {
            context.lineTo(item.points[i].x, item.points[i].y);
          }
          context.stroke();
        } else if (item.type === 'rect') {
          const w = item.x2 - item.x1;
          const h = item.y2 - item.y1;
          context.strokeRect(item.x1, item.y1, w, h);
        } else if (item.type === 'arrow') {
          drawArrow(context, item.x1, item.y1, item.x2, item.y2, item.color, item.width);
        }
        context.restore();
      }

      function redraw() {
        ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
        history.forEach(item => renderItem(ctx, item));
        if (currentStroke) renderItem(ctx, currentStroke);
      }

      function resize() {
        const dpr = window.devicePixelRatio || 1;
        canvas.width = Math.round(window.innerWidth * dpr);
        canvas.height = Math.round(window.innerHeight * dpr);
        ctx.resetTransform();
        ctx.scale(dpr, dpr);
        redraw();
      }
      window.addEventListener('resize', resize);
      resize();

      api.onEvent((event, payload) => {
        if (event === 'setTool') {
          currentTool = payload?.tool || 'pointer';
          currentColor = payload?.color || currentColor;
          currentWidth = payload?.width || currentWidth;
          canvas.style.cursor = currentTool === 'pointer' ? 'default' : 'crosshair';
        } else if (event === 'setColor') {
          currentColor = payload?.color || currentColor;
        } else if (event === 'setWidth') {
          currentWidth = payload?.width || currentWidth;
        } else if (event === 'undo') {
          history.pop();
          redraw();
        } else if (event === 'clear') {
          history.length = 0;
          redraw();
        }
      });

      canvas.addEventListener('pointerdown', (e) => {
        if (currentTool === 'pointer' || e.button !== 0) return;
        isDrawing = true;
        startX = e.clientX;
        startY = e.clientY;
        try { canvas.setPointerCapture(e.pointerId); } catch {}

        if (currentTool === 'brush' || currentTool === 'highlighter') {
          currentStroke = {
            type: currentTool,
            color: currentColor,
            width: currentTool === 'highlighter' ? 14 : currentWidth,
            points: [{ x: startX, y: startY }]
          };
        } else if (currentTool === 'rect' || currentTool === 'arrow') {
          currentStroke = {
            type: currentTool,
            color: currentColor,
            width: currentWidth,
            x1: startX, y1: startY,
            x2: startX, y2: startY
          };
        }
        redraw();
      });

      canvas.addEventListener('pointermove', (e) => {
        if (!isDrawing || !currentStroke) return;
        const cx = e.clientX;
        const cy = e.clientY;

        if (currentStroke.type === 'brush' || currentStroke.type === 'highlighter') {
          currentStroke.points.push({ x: cx, y: cy });
        } else if (currentStroke.type === 'rect' || currentStroke.type === 'arrow') {
          currentStroke.x2 = cx;
          currentStroke.y2 = cy;
        }
        redraw();
      });

      const endDrawing = (e) => {
        if (!isDrawing) return;
        isDrawing = false;
        try { if (e && e.pointerId !== undefined) canvas.releasePointerCapture(e.pointerId); } catch {}
        if (currentStroke) {
          history.push(currentStroke);
          currentStroke = null;
        }
        redraw();
      };

      canvas.addEventListener('pointerup', endDrawing);
      canvas.addEventListener('pointercancel', endDrawing);

      window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          if (isDrawing) {
            isDrawing = false;
            currentStroke = null;
            redraw();
          } else {
            api.sendAction('setTool', { tool: 'pointer' });
          }
        } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
          api.sendAction('undo');
        }
      });
    })();
  </script>
</body>
</html>`
  }
}
