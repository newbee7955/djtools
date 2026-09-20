/**
 * 远程协助核心服务 (Remote Assist Service)
 * 管理设备身份、WSS 信令调度、会话生命周期与权限约束
 */

import crypto from 'node:crypto'
import { EventEmitter } from 'node:events'
import os from 'node:os'
import path from 'node:path'
import {
  canTransition,
  formatDeviceCode,
  isValidDeviceCode,
  normalizeDeviceCode,
  normalizePermission,
  parseInputEvent,
  type RemoteAssistDeviceInfo,
  type RemoteAssistEvent,
  type RemoteAssistInputEvent,
  type RemoteAssistPermission,
  type RemoteAssistSessionPhase,
  type RemoteAssistSessionStatus,
  type RemoteAssistSignalEnvelope
} from './remote-assist-contract.ts'
import {
  DeviceIdentityStore,
  type DeviceIdentity
} from './device-identity-store.ts'
import { SignalingClient } from './signaling-client.ts'
import { RemoteInputHelper } from './remote-input-helper.ts'
import { InputSeqDedupe } from './input-seq-dedupe.ts'
import {
  buildIceServers,
  parseIceUrlHostPort,
  probeStunReachable,
  FALLBACK_STUN_URL
} from './ice-probe.ts'

export interface RemoteAssistServiceOptions {
  identityStore?: DeviceIdentityStore
  signalingClient?: SignalingClient
  inputHelper?: RemoteInputHelper
  displayName?: string
  handshakeTimeoutMs?: number
}

interface PendingIncomingRequest {
  requestId: string
  sessionId: string
  fromDeviceCode: string
  fromDisplayName: string
  permission: RemoteAssistPermission
  safetyCode: string
  providedSafetyCode?: string
  safetyCodeMatched?: boolean
  nonce: string
  timestamp: number
}

export class RemoteAssistService {
  private identityStore: DeviceIdentityStore
  private signalingClient: SignalingClient
  private inputHelper?: RemoteInputHelper
  private displayName: string
  private identity: DeviceIdentity | null = null
  private emitter = new EventEmitter()

  private state: RemoteAssistSessionStatus = {
    sessionId: '',
    role: 'controlled',
    phase: 'idle',
    permission: 'view',
    peerDeviceCode: ''
  }

  private pendingRequest: PendingIncomingRequest | null = null

  private inputWindowStartedAt = 0
  private inputWindowCount = 0
  private inputSeqDedupe = new InputSeqDedupe()
  private localOverrideSubscribed = false
  private handshakeTimer: any = null
  private handshakeTimeoutMs: number
  private consentTimer: any = null
  private requestTimer: any = null

  // 中继/兜底 STUN 可达性探测结果缓存（null 表示尚未探测）
  private turnReachable: boolean | null = null
  private fallbackStunReachable: boolean | null = null
  private relayProbeInFlight = false
  private pendingRelayCfg: { username: string; credential: string; urls: string[] } | null = null

  private static readonly MAX_INPUT_EVENTS_PER_SECOND = 200
  private static readonly DEFAULT_HANDSHAKE_TIMEOUT_MS = 30000

  private static instance: RemoteAssistService | null = null

  public static getInstance(): RemoteAssistService {
    if (!RemoteAssistService.instance) {
      let storagePath: string | undefined
      try {
        const { app } = require('electron')
        if (app && typeof app.getPath === 'function') {
          storagePath = path.join(app.getPath('userData'), 'remote-assist-identity.json')
        }
      } catch {}

      RemoteAssistService.instance = new RemoteAssistService({
        identityStore: new DeviceIdentityStore({ storagePath }),
        inputHelper: new RemoteInputHelper()
      })
      RemoteAssistService.instance.initialize().catch((err) => {
        console.error('[RemoteAssistService] 初始化异常:', err)
      })
    }
    return RemoteAssistService.instance
  }

  constructor(options: RemoteAssistServiceOptions = {}) {
    this.identityStore = options.identityStore || new DeviceIdentityStore()
    this.signalingClient = options.signalingClient || new SignalingClient()
    this.inputHelper = options.inputHelper
    this.displayName = options.displayName || os.hostname() || 'Doujiao Device'
    this.handshakeTimeoutMs = options.handshakeTimeoutMs ?? RemoteAssistService.DEFAULT_HANDSHAKE_TIMEOUT_MS
  }

  public async initialize(): Promise<void> {
    this.identity = await this.identityStore.getOrCreate()
    this.signalingClient.setIdentity(this.identity, this.displayName)

    if (this.inputHelper && !this.localOverrideSubscribed && typeof this.inputHelper.onOverride === 'function') {
      this.localOverrideSubscribed = true
      this.inputHelper.onOverride(() => {
        this.emitter.emit('event', {
          type: 'local-override',
          at: Date.now()
        } as RemoteAssistEvent)
      })
    }

    const storedUrl = this.identityStore.getSignalingUrl()
    if (storedUrl) {
      await this.signalingClient.setSignalingUrl(storedUrl)
    }

    this.signalingClient.onStatus((status) => {
      this.emitter.emit('event', {
        type: 'signaling-status',
        status
      } as RemoteAssistEvent)
    })

    this.signalingClient.onMessage((envelope) => {
      this.handleIncomingSignal(envelope)
    })

    // 信令下发/续期 TURN 配置后，主动探测 TURN UDP 端点与兜底 STUN，供 ICE 列表过滤与诊断
    this.signalingClient.onTurn((cfg) => {
      void this.verifyRelayReachability(cfg)
    })

    // 自动连接公网信令网关
    void this.signalingClient.connect().catch((err) => {
      console.warn('[RemoteAssistService] 初始连接信令服务失败，将自动重试:', err)
    })
  }

  public async getDeviceInfo(): Promise<RemoteAssistDeviceInfo> {
    if (!this.identity) {
      await this.initialize()
    } else if (this.signalingClient.getStatus() === 'disconnected') {
      void this.signalingClient.connect().catch(() => {})
    }

    return {
      deviceCode: this.identity?.deviceCode || '',
      rawDeviceId: this.identity?.rawDeviceId || '',
      displayName: this.displayName,
      signalingStatus: this.signalingClient.getStatus(),
      signalingUrl: this.signalingClient.getSignalingUrl(),
      safetyCode: this.identityStore.getSafetyCode(),
      preferredFps: this.getPreferredFps()
    }
  }

  public getPreferredFps(): number {
    return this.identityStore.getPreferredFps()
  }

  public setPreferredFps(fps: number): boolean {
    this.identityStore.setPreferredFps(fps)
    return true
  }

  public refreshSafetyCode(): string {
    return this.identityStore.refreshSafetyCode()
  }

  public async setSignalingUrl(url: string): Promise<boolean> {
    this.identityStore.setSignalingUrl(url)
    await this.signalingClient.setSignalingUrl(url)
    return true
  }

  public getState(): RemoteAssistSessionStatus {
    return { ...this.state }
  }

  public getPendingRequest(): PendingIncomingRequest | null {
    return this.pendingRequest ? { ...this.pendingRequest } : null
  }

  public testSetState(partial: Partial<RemoteAssistSessionStatus>): void {
    this.state = {
      ...this.state,
      ...partial
    }
    this.emitter.emit('event', {
      type: 'session-state',
      status: this.getState()
    } as RemoteAssistEvent)
  }

  private setState(phase: RemoteAssistSessionPhase, updates: Partial<RemoteAssistSessionStatus> = {}): void {
    if (this.state.phase !== phase && !canTransition(this.state.phase, phase)) {
      console.warn(`[RemoteAssistService] 非法状态跃迁: ${this.state.phase} -> ${phase}`)
      return
    }

    const previousPhase = this.state.phase

    this.state = {
      ...this.state,
      ...updates,
      phase
    }

    this.emitter.emit('event', {
      type: 'session-state',
      status: this.getState()
    } as RemoteAssistEvent)

    if (phase === 'connecting' && previousPhase !== 'connecting') {
      this.startHandshakeTimeout()
    } else if (phase !== 'connecting') {
      this.clearHandshakeTimeout()
    }
  }

  /**
   * 用 STUN Binding 探测信令下发的 TURN UDP 端点与自建兜底 STUN 是否响应。
   * 这不能证明 TURN Allocate/鉴权成功；中继最终可用性必须由 WebRTC ICE 验证。
   * 结果缓存到 turnReachable / fallbackStunReachable，供 getIceServers() 过滤死节点与诊断超时原因。
   */
  private async verifyRelayReachability(
    cfg: { username: string; credential: string; urls: string[] } | null
  ): Promise<void> {
    if (!cfg) {
      this.turnReachable = null
      return
    }

    // 在途时记录最新配置，本轮探测结束后立即用最新配置补探，避免新中继被旧的探测结果覆盖
    if (this.relayProbeInFlight) {
      this.pendingRelayCfg = cfg
      return
    }
    this.relayProbeInFlight = true
    try {
      const turnUrl = (cfg.urls || []).find(
        (url) => typeof url === 'string' && /^turns?:/i.test(url.trim())
      )
      const turnHostPort = turnUrl ? parseIceUrlHostPort(turnUrl) : null
      if (turnHostPort) {
        const reachable = await probeStunReachable(turnHostPort.host, turnHostPort.port)
        this.turnReachable = reachable
        if (reachable) {
          console.info(
            '[RemoteAssistService] TURN UDP 端点可达（中继分配由 ICE 验证）: ' +
              turnHostPort.host +
              ':' +
              turnHostPort.port
          )
        } else {
          console.warn(
            '[RemoteAssistService] TURN UDP 端点无 STUN 响应: ' +
              turnHostPort.host +
              ':' +
              turnHostPort.port +
              ' —— 将跳过 UDP TURN；显式 TCP/TLS TURN 仍会保留。请检查 coturn 与 3478/UDP、49152-65535/UDP 放行情况'
          )
        }
      } else {
        // 新配置里没有可解析的 TURN 地址：重置为「未知」，避免旧的 false 继续把中继过滤掉
        this.turnReachable = null
      }

      const fallbackHostPort = parseIceUrlHostPort(FALLBACK_STUN_URL)
      if (fallbackHostPort) {
        const fallbackReachable = await probeStunReachable(fallbackHostPort.host, fallbackHostPort.port)
        this.fallbackStunReachable = fallbackReachable
        if (!fallbackReachable) {
          console.warn('[RemoteAssistService] 自建兜底 STUN 不可达: ' + FALLBACK_STUN_URL)
        }
      }
    } finally {
      this.relayProbeInFlight = false
      const next = this.pendingRelayCfg
      this.pendingRelayCfg = null
      if (next) {
        void this.verifyRelayReachability(next)
      }
    }
  }

  /**
   * 进入 WebRTC 握手后启动总超时，避免 offer/answer/ICE 丢包或捕获挂起导致永久卡在 connecting
   */
  private startHandshakeTimeout(): void {
    this.clearHandshakeTimeout()
    this.handshakeTimer = setTimeout(() => {
      this.handshakeTimer = null
      if (this.state.phase !== 'connecting') return
      const turn = this.signalingClient.getTurnConfig()
      let relayStatusText: string
      if (!turn) {
        relayStatusText = '未下发 TURN'
      } else if (this.turnReachable === false) {
        relayStatusText = 'TURN UDP 端点无响应（仍保留 TCP/TLS 中继）'
      } else if (this.turnReachable === true) {
        relayStatusText = 'TURN UDP 端点可达（中继分配由 ICE 验证）'
      } else {
        relayStatusText = 'TURN UDP 端点探测中'
      }
      console.warn(
        `[RemoteAssistService] WebRTC 握手超时 (${this.handshakeTimeoutMs}ms)，主动断开。` +
          `中继状态: ${relayStatusText}`
      )
      void this.disconnect('handshake-timeout')
    }, this.handshakeTimeoutMs)
    if (this.handshakeTimer?.unref) {
      this.handshakeTimer.unref()
    }
  }

  private clearHandshakeTimeout(): void {
    if (this.handshakeTimer) {
      clearTimeout(this.handshakeTimer)
      this.handshakeTimer = null
    }
  }

  private startConsentTimeout(): void {
    this.clearConsentTimeout()
    this.consentTimer = setTimeout(() => {
      if (this.state.phase === 'awaiting-consent') {
        console.log('[RemoteAssistService] 等待用户授权超时 (60s)，自动取消并重置为 idle')
        this.pendingRequest = null
        this.setState('idle', { sessionId: '', peerDeviceCode: '' })
        this.emitter.emit('event', {
          type: 'session-ended',
          sessionId: '',
          reason: 'consent-timeout'
        } as RemoteAssistEvent)
      }
    }, 60000)
    if (this.consentTimer?.unref) {
      this.consentTimer.unref()
    }
  }

  private clearConsentTimeout(): void {
    if (this.consentTimer) {
      clearTimeout(this.consentTimer)
      this.consentTimer = null
    }
  }

  private startRequestTimeout(): void {
    this.clearRequestTimeout()
    this.requestTimer = setTimeout(() => {
      if (this.state.phase === 'requesting') {
        console.log('[RemoteAssistService] 请求对方协助超时 (45s)，自动重置为 idle')
        const currentSid = this.state.sessionId
        this.setState('idle', { sessionId: '', peerDeviceCode: '' })
        this.emitter.emit('event', {
          type: 'session-ended',
          sessionId: currentSid,
          reason: 'request-timeout'
        } as RemoteAssistEvent)
      }
    }, 45000)
    if (this.requestTimer?.unref) {
      this.requestTimer.unref()
    }
  }

  private clearRequestTimeout(): void {
    if (this.requestTimer) {
      clearTimeout(this.requestTimer)
      this.requestTimer = null
    }
  }

  public async requestSession(
    targetDeviceCode: string,
    permission: RemoteAssistPermission,
    targetSafetyCode?: string
  ): Promise<RemoteAssistSessionStatus> {
    if (this.state.phase !== 'idle') {
      console.warn(`[RemoteAssistService] 发起新会话前重置既有未结束会话 (${this.state.phase}) -> idle`)
      await this.disconnect('new-request-override')
    }
    this.signalingClient.clearOutboundQueue()
    const formattedTarget = formatDeviceCode(targetDeviceCode)
    const sessionId = `s_${crypto.randomUUID()}`
    const nonce = crypto.randomBytes(16).toString('hex')
    const now = Date.now()

    const cleanSafetyCode = (targetSafetyCode || '').trim()
    const requestedPermission = normalizePermission(permission)

    this.setState('requesting', {
      sessionId,
      role: 'controller',
      permission: requestedPermission,
      peerDeviceCode: formattedTarget,
      safetyCode: cleanSafetyCode || undefined,
      startedAt: now
    })

    this.signalingClient.sendSignal('session-request', formattedTarget, {
      sessionId,
      fromDisplayName: this.displayName,
      permission: requestedPermission,
      safetyCode: cleanSafetyCode || undefined,
      nonce,
      timestamp: now
    })

    this.startRequestTimeout()

    return this.getState()
  }

  public async respondToSession(requestId: string, decision: 'view' | 'control' | 'deny'): Promise<boolean> {
    if (!this.pendingRequest || this.pendingRequest.requestId !== requestId) {
      return false
    }

    this.clearConsentTimeout()
    this.signalingClient.clearOutboundQueue()
    const { sessionId, fromDeviceCode } = this.pendingRequest

    if (decision === 'deny') {
      this.signalingClient.sendSignal('session-response', fromDeviceCode, {
        sessionId,
        accepted: false
      })
      this.pendingRequest = null
      this.setState('idle', {
        sessionId: '',
        peerDeviceCode: ''
      })
      return true
    }

    // 接受会话请求 (view 或 control)，决策值收敛到白名单
    const grantedPermission = normalizePermission(decision)
    const sessionToken = crypto.randomBytes(32).toString('hex')
    if (grantedPermission === 'control' && this.inputHelper) {
      try {
        await this.inputHelper.start(sessionToken)
      } catch (err) {
        console.error('[RemoteAssistService] 启动原生输入助手失败:', err)
      }
    }

    this.setState('connecting', {
      sessionId,
      role: 'controlled',
      permission: grantedPermission,
      peerDeviceCode: fromDeviceCode,
      safetyCode: this.pendingRequest.safetyCode
    })

    this.signalingClient.sendSignal('session-response', fromDeviceCode, {
      sessionId,
      accepted: true,
      permission: grantedPermission,
      safetyCode: this.pendingRequest.safetyCode
    })

    this.pendingRequest = null
    return true
  }

  public handleRemoteInput(rawEvent: unknown): void {
    if (this.state.phase !== 'connected' || this.state.role !== 'controlled') {
      return
    }

    if (this.state.permission === 'view') {
      throw new Error('[Security] 当前会话为 view-only 仅查看模式，严禁注入键盘与鼠标输入')
    }

    const event: RemoteAssistInputEvent = parseInputEvent(rawEvent)

    // pointer-move 已在控制端通过 rAF 合并到 ~60Hz，无需再限流（限流会导致间歇性丢坐标卡顿）
    if (event.type !== 'pointer-move' && !this.allowInputEvent()) {
      return
    }

    // 点击/滚轮双通道发送：同一 seq 只注入一次（必须在限流通过之后记账，避免快通道被限流后备份也被丢掉）
    if (this.inputSeqDedupe.isDuplicate(event.type, event.seq)) {
      return
    }

    if (this.inputHelper) {
      this.inputHelper.send(event)
    }
  }

  public setRemoteCursorHidden(hidden: boolean): void {
    if (this.inputHelper && this.inputHelper.isStarted()) {
      this.inputHelper.setCursorHidden(hidden)
    }
  }

  /**
   * 每秒输入事件限流，防止恶意控制端洪泛输入注入 (DoS)
   */
  private allowInputEvent(): boolean {
    const now = Date.now()
    if (now - this.inputWindowStartedAt >= 1000) {
      this.inputWindowStartedAt = now
      this.inputWindowCount = 0
    }
    this.inputWindowCount++
    if (this.inputWindowCount > RemoteAssistService.MAX_INPUT_EVENTS_PER_SECOND) {
      if (this.inputWindowCount === RemoteAssistService.MAX_INPUT_EVENTS_PER_SECOND + 1) {
        console.warn('[Security] 远程输入速率超限，已开始丢弃多余事件')
      }
      return false
    }
    return true
  }

  /**
   * 校验入站信令确实来自当前会话对端设备
   */
  private isFromCurrentPeer(envelope: RemoteAssistSignalEnvelope): boolean {
    if (!this.state.peerDeviceCode) return false
    return normalizeDeviceCode(envelope.from) === normalizeDeviceCode(this.state.peerDeviceCode)
  }

  /**
   * 校验入站信令携带的 sessionId 与当前活跃会话一致
   */
  private isEnvelopeForCurrentSession(envelope: RemoteAssistSignalEnvelope): boolean {
    const sid = envelope.payload?.sessionId
    return typeof sid === 'string' && sid.length > 0 && sid === this.state.sessionId
  }

  public async disconnect(reason: string = 'user-initiated'): Promise<boolean> {
    const { peerDeviceCode, sessionId } = this.state
    this.clearHandshakeTimeout()
    this.clearConsentTimeout()
    this.clearRequestTimeout()

    if (peerDeviceCode && this.state.phase !== 'idle') {
      this.signalingClient.sendSignal('disconnect', peerDeviceCode, {
        sessionId,
        reason
      })
    }
    // 会话断开后，清理离线队列中属于旧会话的信令（除刚发出的 disconnect 外）
    this.signalingClient.clearOutboundQueue((env) => env.type !== 'disconnect')

    if (this.inputHelper) {
      if (typeof this.inputHelper.setCursorHidden === 'function') {
        this.inputHelper.setCursorHidden(false)
      }
      await this.inputHelper.releaseAll()
      await this.inputHelper.stop()
    }
    this.inputSeqDedupe.reset()

    this.pendingRequest = null
    this.setState('idle', {
      sessionId: '',
      peerDeviceCode: '',
      safetyCode: undefined,
      connectionMode: undefined,
      connectionModeText: undefined,
      rttMs: undefined,
      error: undefined
    })

    this.emitter.emit('event', {
      type: 'session-ended',
      sessionId,
      reason
    } as RemoteAssistEvent)

    return true
  }

  private handleIncomingSignal(envelope: RemoteAssistSignalEnvelope): void {
    switch (envelope.type) {
      case 'session-request': {
        // 如果当前处于 awaiting-consent 状态：
        // 允许来自相同对端的新请求（例如对端重新点击发起请求，覆盖刷新），来自其他设备的请求一律拒绝
        if (this.state.phase === 'awaiting-consent') {
          const isSamePeer = Boolean(this.state.peerDeviceCode && normalizeDeviceCode(envelope.from) === normalizeDeviceCode(this.state.peerDeviceCode))
          if (isSamePeer) {
            console.log(`[RemoteAssistService] 收到来自相同对端 ${envelope.from} 的新协助请求，覆盖既有待确认状态`)
            this.clearConsentTimeout()
          } else {
            console.warn(`[Security] 已处于待确认状态且来自其他设备 (${envelope.from} !== ${this.state.peerDeviceCode})，忽略请求`)
            return
          }
        } else if (this.state.phase !== 'idle') {
          console.warn(`[Security] 已处于会话状态 (${this.state.phase})，忽略新的协助请求`)
          return
        }

        const payload = envelope.payload || {}
        const { sessionId, fromDisplayName, nonce, timestamp, safetyCode: providedSafetyCode } = payload
        if (!sessionId || !nonce) return

        // 来源设备代码必须为合法 9 位数字，杜绝将任意字符串当作设备标识透传
        if (!isValidDeviceCode(envelope.from)) {
          console.warn('[Security] 拒绝来源非法的协助请求:', envelope.from)
          return
        }

        const permission = normalizePermission(payload.permission)

        const localSafetyCode = this.identityStore.getSafetyCode()
        const cleanProvided = typeof providedSafetyCode === 'string' && providedSafetyCode.trim().length > 0
          ? providedSafetyCode.trim().replace(/\s+/g, '')
          : undefined
        const cleanLocal = localSafetyCode.trim().replace(/\s+/g, '')
        const safetyCodeMatched = cleanProvided !== undefined ? cleanProvided === cleanLocal : undefined

        const requestId = `req_${crypto.randomUUID()}`

        this.pendingRequest = {
          requestId,
          sessionId,
          fromDeviceCode: envelope.from,
          fromDisplayName: fromDisplayName || 'Remote Device',
          permission,
          safetyCode: localSafetyCode,
          providedSafetyCode: cleanProvided,
          safetyCodeMatched,
          nonce,
          timestamp
        }

        this.setState('awaiting-consent', {
          sessionId,
          role: 'controlled',
          permission,
          peerDeviceCode: envelope.from,
          peerDisplayName: fromDisplayName,
          safetyCode: localSafetyCode
        })

        this.startConsentTimeout()

        this.emitter.emit('event', {
          type: 'incoming-request',
          requestId,
          fromDeviceCode: envelope.from,
          fromDisplayName: fromDisplayName || 'Remote Device',
          permission,
          safetyCode: localSafetyCode,
          providedSafetyCode: cleanProvided,
          safetyCodeMatched
        } as RemoteAssistEvent)
        break
      }

      case 'session-response': {
        this.clearRequestTimeout()
        if (this.state.role !== 'controller' || this.state.phase !== 'requesting') {
          return
        }
        if (!this.isFromCurrentPeer(envelope) || !this.isEnvelopeForCurrentSession(envelope)) {
          console.warn('[Security] 忽略来源或会话不匹配的 session-response')
          return
        }
        const payload = envelope.payload || {}
        if (payload.accepted) {
          this.setState('connecting', {
            permission: normalizePermission(payload.permission),
            safetyCode: undefined
          })
        } else {
          this.disconnect('request-denied')
        }
        break
      }

      case 'disconnect': {
        if (!this.isFromCurrentPeer(envelope) || !this.isEnvelopeForCurrentSession(envelope)) {
          console.warn('[Security] 忽略来源或会话不匹配的 disconnect')
          return
        }
        this.signalingClient.clearOutboundQueue()
        this.disconnect('peer-disconnected')
        break
      }

      case 'offer':
      case 'answer':
      case 'ice-candidate': {
        // 仅接受当前会话对端设备发来的 WebRTC 握手信令
        if (!this.isFromCurrentPeer(envelope) || !this.isEnvelopeForCurrentSession(envelope)) {
          console.warn('[Security] 忽略来源或会话不匹配的 WebRTC 信令:', envelope.type)
          return
        }
        this.emitter.emit('webrtc-signal', envelope)
        break
      }

      case 'error': {
        const payload = envelope.payload || {}
        console.warn(`[RemoteAssistService] 收到信令服务错误响应: [${payload.code || 'UNKNOWN'}] ${payload.message || ''}`)
        if (payload.code === 'PEER_OFFLINE') {
          if (this.state.phase === 'requesting' || this.state.phase === 'connecting') {
            this.signalingClient.clearOutboundQueue()
            void this.disconnect('peer-offline')
          }
        }
        break
      }
    }
  }

  public onEvent(callback: (event: RemoteAssistEvent) => void): () => void {
    this.emitter.on('event', callback)
    return () => this.emitter.removeListener('event', callback)
  }

  public onWebRtcSignal(callback: (envelope: RemoteAssistSignalEnvelope) => void): () => void {
    this.emitter.on('webrtc-signal', callback)
    return () => this.emitter.removeListener('webrtc-signal', callback)
  }

  public sendWebRtcSignal(type: 'offer' | 'answer' | 'ice-candidate', payload: any): void {
    const { peerDeviceCode, sessionId } = this.state
    if (!peerDeviceCode) {
      console.warn('[RemoteAssistService] 未指定对端设备代码，丢弃 WebRTC 信号:', type)
      return
    }
    this.signalingClient.sendSignal(type, peerDeviceCode, {
      sessionId,
      ...payload
    })
  }

  public setConnected(): void {
    if (this.state.phase === 'connecting') {
      this.setState('connected')
    }
  }

  public updateConnectionStats(stats: { connectionMode?: 'p2p-lan' | 'p2p-wan' | 'relay', connectionModeText?: string, rttMs?: number }): void {
    if (this.state.phase === 'connected' || this.state.phase === 'connecting') {
      this.setState(this.state.phase, {
        connectionMode: stats.connectionMode,
        connectionModeText: stats.connectionModeText,
        rttMs: stats.rttMs
      })
    }
  }

  public getIceServers(): any[] {
    // 同步返回缓存的可达性探测结果：不可达的 TURN/兜底 STUN 会被剔除，避免死候选拖慢 ICE
    return buildIceServers({
      turn: this.signalingClient.getTurnConfig(),
      turnReachable: this.turnReachable,
      fallbackStunReachable: this.fallbackStunReachable
    })
  }
}
