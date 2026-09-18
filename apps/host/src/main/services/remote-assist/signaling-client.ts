/**
 * 远程协助出站 WSS 信令客户端 (Signaling Client)
 * 仅建立到公网信令服务的出站连接，零入站端口监听，规避 Windows 防火墙弹窗
 */

import { EventEmitter } from 'node:events'
import WebSocket from 'ws'
import {
  parseSignalEnvelope,
  SIGNAL_PROTOCOL_VERSION,
  type RemoteAssistSignalEnvelope,
  type RemoteAssistSignalType
} from './remote-assist-contract.ts'
import type { DeviceIdentity } from './device-identity-store.ts'

export interface SignalingClientOptions {
  signalingUrl?: string
  createWebSocket?: (url: string) => any
  heartbeatIntervalMs?: number
  livenessTimeoutMs?: number
}

export type SignalingConnectionStatus = 'connecting' | 'connected' | 'disconnected'

/**
 * 断线期间需要缓存并在重连后补发的会话关键信令。
 * 心跳 (ping/pong) 与注册 (register) 不缓存，避免重连后发出过期心跳。
 */
const QUEUEABLE_SIGNAL_TYPES = new Set<RemoteAssistSignalType>([
  'session-request',
  'session-response',
  'offer',
  'answer',
  'ice-candidate',
  'disconnect'
])

function isQueueableSignal(type: RemoteAssistSignalType): boolean {
  return QUEUEABLE_SIGNAL_TYPES.has(type)
}

export function normalizeSignalingUrl(rawUrl: string): string {
  let url = (rawUrl || '').trim()
  if (!url) return 'wss://signal.doujiao.dev/v1/signal'
  if (url.startsWith('http://')) {
    url = 'ws://' + url.slice(7)
  } else if (url.startsWith('https://')) {
    url = 'wss://' + url.slice(8)
  } else if (!url.startsWith('ws://') && !url.startsWith('wss://')) {
    url = 'ws://' + url
  }
  return url
}

export class SignalingClient {
  private signalingUrl: string
  private createWebSocketFn?: (url: string) => any
  private ws: any = null
  private status: SignalingConnectionStatus = 'disconnected'
  private identity: DeviceIdentity | null = null
  private displayName = 'Doujiao Device'
  private heartbeatIntervalMs: number
  private livenessTimeoutMs: number
  private heartbeatTimer: any = null
  private watchdogTimer: any = null
  private lastPongAt = 0
  private reconnectTimer: any = null
  private reconnectAttempts = 0
  private manualClosed = false
  private connectPromise: Promise<void> | null = null
  private pendingConnectResolve: (() => void) | null = null
  private outboundQueue: RemoteAssistSignalEnvelope[] = []

  private static readonly MAX_OUTBOUND_QUEUE = 64
  private turnConfig: { username: string; credential: string; urls: string[] } | null = null
  private emitter = new EventEmitter()

  constructor(options: SignalingClientOptions = {}) {
    this.signalingUrl = normalizeSignalingUrl(
      options.signalingUrl || process.env.DOUJIAO_SIGNAL_URL || 'ws://117.72.108.46:8080'
    )
    this.createWebSocketFn = options.createWebSocket
    this.heartbeatIntervalMs = options.heartbeatIntervalMs || 25000
    this.livenessTimeoutMs = options.livenessTimeoutMs || Math.max(15000, this.heartbeatIntervalMs * 3)
  }

  public getSignalingUrl(): string {
    return this.signalingUrl
  }

  public getTurnConfig(): { username: string; credential: string; urls: string[] } | null {
    return this.turnConfig ? { ...this.turnConfig } : null
  }

  public async setSignalingUrl(url: string): Promise<void> {
    const normalized = normalizeSignalingUrl(url)
    if (this.signalingUrl === normalized && this.status === 'connected') return
    this.signalingUrl = normalized
    this.disconnect()
    await this.connect()
  }

  public setIdentity(identity: DeviceIdentity, displayName: string = 'Doujiao Device'): void {
    this.identity = identity
    this.displayName = displayName
  }

  public getStatus(): SignalingConnectionStatus {
    return this.status
  }

  private setStatus(status: SignalingConnectionStatus): void {
    if (this.status !== status) {
      this.status = status
      this.emitter.emit('status', status)
    }
  }

  public connect(): Promise<void> {
    if (this.status === 'connected') {
      return Promise.resolve()
    }
    // 复用进行中的连接，防止 initialize / getDeviceInfo / 重连定时器并发开出多条 socket
    if (this.connectPromise) {
      return this.connectPromise
    }

    this.manualClosed = false
    this.setStatus('connecting')

    this.connectPromise = new Promise<void>((resolve) => {
      this.pendingConnectResolve = resolve
      let settled = false
      const settle = () => {
        if (settled) return
        settled = true
        this.connectPromise = null
        this.pendingConnectResolve = null
        resolve()
      }

      try {
        if (this.createWebSocketFn) {
          this.ws = this.createWebSocketFn(this.signalingUrl)
        } else if (typeof WebSocket !== 'undefined') {
          this.ws = new WebSocket(this.signalingUrl)
        } else if (typeof globalThis.WebSocket !== 'undefined') {
          this.ws = new globalThis.WebSocket(this.signalingUrl)
        } else {
          throw new Error('WebSocket is not available in current runtime environment')
        }

        this.setupSocketHandlers(settle, settle)
      } catch (err) {
        this.setStatus('disconnected')
        this.scheduleReconnect()
        settle()
      }
    })

    return this.connectPromise
  }

  private setupSocketHandlers(onOpened?: () => void, onFailed?: () => void): void {
    if (!this.ws) return
    // 捕获当前 socket，所有回调只在它仍是「当前 socket」时生效，
    // 避免重连时旧 socket 的 close/error 覆盖新连接状态
    const socket = this.ws

    const onOpen = () => {
      if (this.ws !== socket) return
      this.reconnectAttempts = 0
      this.lastPongAt = Date.now()
      this.setStatus('connected')
      this.startHeartbeat()
      this.registerDevice()
      this.flushOutboundQueue()
      onOpened?.()
    }

    const onMessage = (data: any) => {
      if (this.ws !== socket) return
      let parsed: any = undefined
      try {
        const raw = typeof data === 'string' ? data : data.toString('utf8')
        parsed = JSON.parse(raw)
        const envelope = parseSignalEnvelope(parsed)
        if (envelope.type === 'ping') {
          this.sendSignal('pong', envelope.from)
          return
        }
        if (envelope.type === 'pong') {
          this.lastPongAt = Date.now()
          return
        }
        this.lastPongAt = Date.now()
        if (envelope.type === 'registered' && envelope.payload?.turn) {
          this.turnConfig = envelope.payload.turn
          this.emitter.emit('turn', this.getTurnConfig())
        }
        this.emitter.emit('message', envelope)
      } catch (err: any) {
        const errorMsg = err?.message || String(err)
        console.warn(`[SignalingClient] 丢弃非法或解析失败的信令报文: ${errorMsg}`, parsed ?? data)
      }
    }

    const onPong = () => {
      if (this.ws !== socket) return
      this.lastPongAt = Date.now()
    }

    const onClose = () => {
      if (this.ws !== socket) return
      this.stopHeartbeat()
      this.setStatus('disconnected')
      this.ws = null
      onFailed?.()
      if (!this.manualClosed) {
        this.scheduleReconnect()
      }
    }

    const onError = (err: any) => {
      if (this.ws !== socket) return
      this.emitter.emit('error', err)
      onFailed?.()
    }

    if (typeof socket.on === 'function') {
      socket.on('open', onOpen)
      socket.on('message', onMessage)
      socket.on('pong', onPong)
      socket.on('close', onClose)
      socket.on('error', onError)
    } else {
      socket.onopen = onOpen
      socket.onmessage = (event: any) => onMessage(event.data)
      socket.onclose = onClose
      socket.onerror = onError
    }
  }

  private registerDevice(): void {
    if (!this.identity) return

    const now = Date.now()
    const signPayload = `${this.identity.deviceCode}:${now}`
    const sig = this.identity.sign(signPayload)

    const envelope: RemoteAssistSignalEnvelope = {
      v: SIGNAL_PROTOCOL_VERSION,
      type: 'register',
      from: this.identity.deviceCode,
      timestamp: now,
      sig,
      payload: {
        rawDeviceId: this.identity.rawDeviceId,
        publicKey: this.identity.publicKey,
        displayName: this.displayName
      }
    }

    this.send(envelope)
  }

  private startHeartbeat(): void {
    this.stopHeartbeat()
    if (this.heartbeatIntervalMs <= 0) return
    this.lastPongAt = Date.now()

    this.heartbeatTimer = setInterval(() => {
      if (this.status === 'connected' && this.identity) {
        if (this.ws && typeof this.ws.ping === 'function') {
          try {
            this.ws.ping()
          } catch {}
        }
        this.send({
          v: SIGNAL_PROTOCOL_VERSION,
          type: 'ping',
          from: this.identity.deviceCode,
          timestamp: Date.now()
        })
        this.ensureTurnFresh()
      }
    }, this.heartbeatIntervalMs)

    // 心跳存活看门狗：超过 livenessTimeoutMs 未收到任何服务端报文则强制重连
    const watchdogInterval = Math.max(200, Math.min(this.heartbeatIntervalMs, this.livenessTimeoutMs))
    this.watchdogTimer = setInterval(() => {
      if (this.status !== 'connected') return
      if (Date.now() - this.lastPongAt > this.livenessTimeoutMs) {
        console.warn('[SignalingClient] 心跳超时，强制断开并重连信令服务')
        this.forceClose()
      }
    }, watchdogInterval)

    if (this.heartbeatTimer?.unref) this.heartbeatTimer.unref()
    if (this.watchdogTimer?.unref) this.watchdogTimer.unref()
  }

  /**
   * TURN 临时凭据临近过期时(默认剩余 60s)通过重新注册向服务端续期
   */
  private ensureTurnFresh(): void {
    const cfg = this.turnConfig
    if (!cfg || typeof cfg.username !== 'string') return
    const expiry = Number.parseInt(cfg.username.split(':')[0], 10)
    if (!Number.isFinite(expiry)) return
    const nowSec = Math.floor(Date.now() / 1000)
    if (expiry - nowSec <= 60) {
      this.turnConfig = null
      this.registerDevice()
    }
  }

  /**
   * 心跳超时后的强制断开：关闭底层 socket，由 onClose 统一完成状态迁移与重连
   */
  private forceClose(): void {
    this.stopHeartbeat()
    this.pendingConnectResolve?.()
    this.connectPromise = null
    const ws = this.ws
    if (ws) {
      try {
        ws.close()
      } catch {}
      return
    }
    this.setStatus('disconnected')
    if (!this.manualClosed) {
      this.scheduleReconnect()
    }
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer)
      this.watchdogTimer = null
    }
  }

  private scheduleReconnect(): void {
    if (this.manualClosed || this.reconnectTimer) return

    this.reconnectAttempts++
    const delay = Math.min(30000, 1000 * Math.pow(1.5, this.reconnectAttempts - 1))
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, delay)

    if (this.reconnectTimer?.unref) {
      this.reconnectTimer.unref()
    }
  }

  public send(envelope: RemoteAssistSignalEnvelope): void {
    if (!this.ws || this.status !== 'connected') {
      // 连接不可用时，仅缓存会话关键信令，待重连后按序补发，避免丢包导致握手永久卡住
      if (isQueueableSignal(envelope.type)) {
        this.enqueueOutbound(envelope)
      }
      return
    }

    try {
      const data = JSON.stringify(envelope)
      this.ws.send(data)
    } catch (err) {
      console.error('[SignalingClient] 发送信令失败:', err)
      if (isQueueableSignal(envelope.type)) {
        this.enqueueOutbound(envelope)
      }
    }
  }

  private enqueueOutbound(envelope: RemoteAssistSignalEnvelope): void {
    const now = Date.now()
    // 入队前清理已超时的陈旧报文，防止离线队列累积
    this.outboundQueue = this.outboundQueue.filter((env) => now - env.timestamp <= 30_000)
    if (this.outboundQueue.length >= SignalingClient.MAX_OUTBOUND_QUEUE) {
      this.outboundQueue.shift()
    }
    this.outboundQueue.push(envelope)
  }

  private flushOutboundQueue(): void {
    if (this.status !== 'connected' || !this.ws) return
    const pending = this.outboundQueue
    this.outboundQueue = []
    const now = Date.now()
    for (const envelope of pending) {
      // 丢弃离线积压超过 30 秒的过期信令，防止重连后误发陈旧信令
      if (now - envelope.timestamp > 30_000) {
        console.warn(
          `[SignalingClient] 丢弃离线队列中超时的陈旧信令: type=${envelope.type}, to=${envelope.to}, age=${now - envelope.timestamp}ms`
        )
        continue
      }
      try {
        this.ws.send(JSON.stringify(envelope))
      } catch {}
    }
  }

  /**
   * 清除离线出站队列，可传入 filter 函数只清除匹配项，未传参则全量清空
   */
  public clearOutboundQueue(predicate?: (envelope: RemoteAssistSignalEnvelope) => boolean): void {
    if (!predicate) {
      this.outboundQueue = []
    } else {
      this.outboundQueue = this.outboundQueue.filter((env) => !predicate(env))
    }
  }

  public sendSignal(type: RemoteAssistSignalType, to: string, payload?: any): void {
    if (!this.identity) return

    const envelope: RemoteAssistSignalEnvelope = {
      v: SIGNAL_PROTOCOL_VERSION,
      type,
      from: this.identity.deviceCode,
      to,
      timestamp: Date.now(),
      payload
    }

    this.send(envelope)
  }

  public disconnect(): void {
    this.manualClosed = true
    this.pendingConnectResolve?.()
    this.connectPromise = null
    this.outboundQueue = []
    this.stopHeartbeat()
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.ws) {
      try {
        this.ws.close()
      } catch {}
      this.ws = null
    }
    this.setStatus('disconnected')
  }

  public onStatus(cb: (status: SignalingConnectionStatus) => void): () => void {
    this.emitter.on('status', cb)
    return () => this.emitter.removeListener('status', cb)
  }

  public onMessage(cb: (envelope: RemoteAssistSignalEnvelope) => void): () => void {
    this.emitter.on('message', cb)
    return () => this.emitter.removeListener('message', cb)
  }

  public onError(cb: (err: any) => void): () => void {
    this.emitter.on('error', cb)
    return () => this.emitter.removeListener('error', cb)
  }

  public onTurn(cb: (config: { username: string; credential: string; urls: string[] } | null) => void): () => void {
    this.emitter.on('turn', cb)
    return () => this.emitter.removeListener('turn', cb)
  }
}
