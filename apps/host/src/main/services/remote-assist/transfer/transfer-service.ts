/**
 * 传输门面：持有设置与策略、绑定/解绑会话、向 IPC 与会话窗口暴露统一入口
 */

import path from 'node:path'
import { ensureDir } from './transfer-fs.ts'
import { ClipboardBridge } from './clipboard-bridge.ts'
import { TransferSession, type FrameTransport, type TransferPolicy, type TransferState } from './transfer-session.ts'

export interface TransferSettings {
  receiveDir: string
  policy: TransferPolicy
}

export type TransferEvent =
  | { type: 'transfer-state'; state: TransferState }
  | { type: 'transfer-chat'; text: string }
  | { type: 'clipboard-applied'; kind: 'text' | 'image' | 'files' }

export interface TransferServiceOptions {
  receiveDir?: string
  stagingRoot?: string
  clipboard?: ClipboardBridge
}

function resolveDownloadsDir(): string {
  try {
    const electron = require('electron')
    const app = electron?.app
    if (app && typeof app.getPath === 'function') {
      return path.join(app.getPath('downloads'), '豆角远程传输')
    }
  } catch {}
  return path.join(process.cwd(), 'doujiao-transfer')
}

function resolveStagingRoot(): string {
  try {
    const electron = require('electron')
    const app = electron?.app
    if (app && typeof app.getPath === 'function') {
      return path.join(app.getPath('userData'), 'remote-transfer')
    }
  } catch {}
  return path.join(process.cwd(), '.doujiao-transfer-staging')
}

export class TransferService {
  private receiveDir: string
  private stagingRoot: string
  private policy: TransferPolicy = { receiveFiles: true, clipboard: { text: true, image: true, file: true } }
  private clipboard: ClipboardBridge
  private session: TransferSession | null = null
  private listeners = new Set<(e: TransferEvent) => void>()
  /** 仅查看会话下禁止主动发送；未 attach 时先记住，attach 时下发给会话 */
  private outgoingAllowed = true

  private static instance: TransferService | null = null

  public static getInstance(): TransferService {
    if (!TransferService.instance) {
      TransferService.instance = new TransferService()
    }
    return TransferService.instance
  }

  constructor(options: TransferServiceOptions = {}) {
    this.receiveDir = options.receiveDir ?? resolveDownloadsDir()
    this.stagingRoot = options.stagingRoot ?? resolveStagingRoot()
    this.clipboard = options.clipboard ?? new ClipboardBridge()
  }

  public getSettings(): TransferSettings {
    return { receiveDir: this.receiveDir, policy: { receiveFiles: this.policy.receiveFiles, clipboard: { ...this.policy.clipboard } } }
  }

  public setReceiveDir(dir: string): void {
    this.receiveDir = dir
  }

  public getPolicy(): TransferPolicy {
    return { receiveFiles: this.policy.receiveFiles, clipboard: { ...this.policy.clipboard } }
  }

  public setPolicy(policy: TransferPolicy): void {
    this.policy = {
      receiveFiles: Boolean(policy.receiveFiles),
      clipboard: {
        text: Boolean(policy.clipboard?.text),
        image: Boolean(policy.clipboard?.image),
        file: Boolean(policy.clipboard?.file)
      }
    }
    this.session?.setPolicy(this.policy)
    this.session?.broadcastPolicy()
  }

  public onEvent(cb: (e: TransferEvent) => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  public setOutgoingAllowed(allowed: boolean): void {
    this.outgoingAllowed = Boolean(allowed)
    this.session?.setOutgoingAllowed(this.outgoingAllowed)
  }

  public isOutgoingAllowed(): boolean {
    return this.session ? this.session.isOutgoingAllowed() : this.outgoingAllowed
  }

  public attach(transport: FrameTransport, sessionId: string): TransferSession {
    this.detach()
    const session = new TransferSession({
      transport,
      receiveDir: this.receiveDir,
      stagingDir: path.join(this.stagingRoot, sessionId),
      clipboard: this.clipboard
    })
    session.setPolicy(this.policy)
    // 重新 attach 时继承当前外发闸门（仅查看会话必须保持禁止发送）
    session.setOutgoingAllowed(this.outgoingAllowed)
    session.broadcastPolicy()
    session.onState((state) => this.emit({ type: 'transfer-state', state }))
    session.onChat((text) => this.emit({ type: 'transfer-chat', text }))
    session.onClipboardText((text) => {
      // 仅在剪贴板确实写入成功后才广播 clipboard-applied
      if (this.clipboard.writeText(text)) this.emit({ type: 'clipboard-applied', kind: 'text' })
    })
    session.onClipboardFiles((paths) => {
      if (this.clipboard.writeFiles(paths)) this.emit({ type: 'clipboard-applied', kind: 'files' })
    })
    session.onClipboardImage((png) => {
      if (this.clipboard.writeImage(png)) this.emit({ type: 'clipboard-applied', kind: 'image' })
    })
    this.session = session
    this.startClipboardWatcher(session)
    return session
  }

  public detach(): void {
    this.clipboard.stop()
    if (this.session) {
      // TransferSession.dispose() cleans exactly this session's own staging dir
      // (path.join(stagingRoot, sessionId)). Do NOT recursively delete the whole
      // stagingRoot here: on a fast re-attach that in-flight delete could race the
      // new session's staging files and silently lose inbound data.
      this.session.dispose()
      this.session = null
    }
  }

  public getSession(): TransferSession | null {
    return this.session
  }

  public async sendPaths(paths: string[]): Promise<string> {
    if (!this.session) throw new Error('传输通道未建立（等待连接），暂时无法发送')
    // 收件目录是入站关注点，由真正需要它的接收路径按需创建，这里不再预建
    return this.session.enqueueSend(paths)
  }

  public cancel(transferId: string): void {
    this.session?.cancel(transferId)
  }

  public async openReceiveFolder(): Promise<void> {
    await ensureDir(this.receiveDir)
    try {
      const electron = require('electron')
      await electron?.shell?.openPath?.(this.receiveDir)
    } catch {}
  }

  private startClipboardWatcher(session: TransferSession): void {
    this.clipboard.start((snap) => {
      // 轮询回调运行在 setInterval 内：任何异常都必须就地吞掉，绝不能逃逸成未捕获异常
      try {
        const policy = this.policy
        if (snap.kind === 'text' && policy.clipboard.text && snap.text) {
          session.sendClipboardText(snap.text)
        } else if (snap.kind === 'image' && policy.clipboard.image && snap.png) {
          void session.sendClipboardImage(snap.png).catch((err) => {
            console.warn('[remote-assist] clipboard image send failed', err)
          })
        } else if (snap.kind === 'files' && policy.clipboard.file && snap.files) {
          void session.sendClipboardFiles(snap.files).catch((err) => {
            console.warn('[remote-assist] clipboard file send failed', err)
          })
        }
      } catch (err) {
        console.warn('[remote-assist] clipboard watcher failed', err)
      }
    })
  }

  private emit(event: TransferEvent): void {
    for (const cb of this.listeners) {
      try {
        cb(event)
      } catch (err) {
        console.warn('[remote-assist] transfer event listener threw', err)
      }
    }
  }
}
