/**
 * 会话级传输管理：队列(并发=1)、分块发送、流控、校验、取消/拒绝、聊天与剪贴板文本
 */

import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import {
  CHUNK_SIZE,
  decodeFrame,
  encodeBinaryFrame,
  encodeJsonFrame,
  sha256Hex,
  type ControlFrame,
  type TransferEntry,
  type TransferMode
} from './transfer-protocol.ts'
import {
  cleanupDir,
  ensureDir,
  estimateFreeBytes,
  PartWriter,
  readChunk,
  scanPaths,
  sha256File,
  type TreeEntry
} from './transfer-fs.ts'
import type { ClipboardBridge } from './clipboard-bridge.ts'

export interface FrameTransport {
  send(bytes: Uint8Array): void
  bufferedAmount(): number
  isOpen(): boolean
  onFrame(cb: (bytes: Uint8Array) => void): void
}

export interface TransferPolicy {
  receiveFiles: boolean
  clipboard: { text: boolean; image: boolean; file: boolean }
}

export type TransferStatus = 'pending' | 'active' | 'done' | 'failed' | 'rejected' | 'cancelled'

export interface TransferState {
  transferId: string
  mode: TransferMode
  direction: 'outgoing' | 'incoming'
  entries: TransferEntry[]
  totalBytes: number
  transferredBytes: number
  status: TransferStatus
  message?: string
}

export interface TransferSessionOptions {
  transport: FrameTransport
  receiveDir: string
  stagingDir: string
  clipboard?: ClipboardBridge
  maxFileBytes?: number
  maxImageBytes?: number
  /** 等待对端 transfer-accept 的上限（毫秒），超时即失败；仅用于可测试性，默认 15000 */
  acceptTimeoutMs?: number
}

/**
 * 每个出站任务一份的「accept 闸门」：发送端必须等对端回 transfer-accept 后才开始推分块。
 * promise 一旦 settle 便不再改变；settled 标记用于幂等（accept/reject/cancel/dispose 可能竞争）。
 */
interface AcceptGate {
  promise: Promise<void>
  resolve: () => void
  reject: (err: Error) => void
  settled: boolean
}

interface OutgoingJob {
  state: TransferState
  sources: TreeEntry[]
  inlineBytes?: Uint8Array
  accept?: AcceptGate
}

interface IncomingJob {
  state: TransferState
  writers: Map<number, PartWriter>
  entryIndex: number
  expectedSeq: number
  targetRoot: string
  topLevelPaths: Set<string>
  /** 每个条目实际收到的字节数，用于拒绝超发（不信任对端声明） */
  entryReceived: Map<number, number>
  /** 串行化落盘：保证 complete/abort 前所有分块写入已完成 */
  writeChain: Promise<void>
}

const MAX_FILE_BYTES_DEFAULT = 2 * 1024 * 1024 * 1024
const MAX_IMAGE_BYTES_DEFAULT = 20 * 1024 * 1024
/** 对端迟迟不回 transfer-accept 时，出站任务失败而不是无限期挂起队列 */
const ACCEPT_TIMEOUT_MS_DEFAULT = 15000
// 文本帧的实际上限是 MAX_FRAME_BYTES(512KiB)。按 UTF-8 字节（而非 UTF-16 字符数）限流，
// 并留出 JSON 头部/转义余量，避免 encodeJsonFrame 抛 "frame too large" 逃逸到定时器/主进程。
const MAX_CHAT_BYTES = 4 * 1024
const MAX_CLIP_TEXT_BYTES = 400 * 1024
const FLOW_HIGH = 4 * 1024 * 1024
const FLOW_LOW = 512 * 1024

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

/** 按 UTF-8 字节长度截断字符串，且不切断多字节字符 */
function truncateToUtf8Bytes(text: string, maxBytes: number): string {
  const encoded = textEncoder.encode(text)
  if (encoded.length <= maxBytes) return text
  let end = maxBytes
  // 回退到字符起始字节，避免解码出替换符
  while (end > 0 && (encoded[end] & 0xc0) === 0x80) end--
  return textDecoder.decode(encoded.subarray(0, end))
}

function utf8ByteLength(text: string): number {
  return textEncoder.encode(text).length
}

function isTerminalStatus(status: TransferStatus): boolean {
  return status === 'done' || status === 'failed' || status === 'rejected' || status === 'cancelled'
}

export class TransferSession {
  private transport: FrameTransport
  private receiveDir: string
  private stagingDir: string
  private maxFileBytes: number
  private maxImageBytes: number
  private acceptTimeoutMs: number

  private policy: TransferPolicy = { receiveFiles: true, clipboard: { text: true, image: true, file: true } }
  /** 对端广播的接收策略；发送剪贴板前据此判断对端是否愿意接收。默认放行以兼容未广播的对端 */
  private peerPolicy: TransferPolicy = { receiveFiles: true, clipboard: { text: true, image: true, file: true } }
  private states = new Map<string, TransferState>()
  private outgoingQueue: OutgoingJob[] = []
  private activeOutgoing: OutgoingJob | null = null
  private incoming = new Map<string, IncomingJob>()
  private disposed = false
  /** 仅查看（view-only）会话下禁止主动发送文件/剪贴板文件/聊天；被动剪贴板文本与图片同步不受影响 */
  private outgoingAllowed = true

  private stateListeners = new Set<(s: TransferState) => void>()
  private chatListeners = new Set<(t: string) => void>()
  private clipTextListeners = new Set<(t: string) => void>()
  private clipFilesListeners = new Set<(p: string[]) => void>()
  private clipImageListeners = new Set<(png: Uint8Array) => void>()
  private policyListeners = new Set<(p: TransferPolicy) => void>()

  constructor(options: TransferSessionOptions) {
    this.transport = options.transport
    this.receiveDir = options.receiveDir
    this.stagingDir = options.stagingDir
    this.maxFileBytes = options.maxFileBytes ?? MAX_FILE_BYTES_DEFAULT
    this.maxImageBytes = options.maxImageBytes ?? MAX_IMAGE_BYTES_DEFAULT
    this.acceptTimeoutMs = options.acceptTimeoutMs ?? ACCEPT_TIMEOUT_MS_DEFAULT
    this.transport.onFrame((bytes) => this.handleFrame(bytes))
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
  }

  public getPolicy(): TransferPolicy {
    return { receiveFiles: this.policy.receiveFiles, clipboard: { ...this.policy.clipboard } }
  }

  /** 会话层设置本会话是否允许主动外发（仅查看模式置 false）；被动剪贴板文本/图片同步不受影响 */
  public setOutgoingAllowed(allowed: boolean): void {
    this.outgoingAllowed = Boolean(allowed)
  }

  public isOutgoingAllowed(): boolean {
    return this.outgoingAllowed
  }

  /** 由外部（会话层）将本端策略广播给对端 */
  public broadcastPolicy(): void {
    this.sendControl({ t: 'receive-policy', receiveFiles: this.policy.receiveFiles, clipboard: { ...this.policy.clipboard } })
  }

  public onPolicyBroadcast(cb: (p: TransferPolicy) => void): void {
    this.policyListeners.add(cb)
  }

  public onState(cb: (s: TransferState) => void): () => void {
    this.stateListeners.add(cb)
    return () => this.stateListeners.delete(cb)
  }

  public onChat(cb: (t: string) => void): void { this.chatListeners.add(cb) }
  public onClipboardText(cb: (t: string) => void): void { this.clipTextListeners.add(cb) }
  public onClipboardFiles(cb: (p: string[]) => void): void { this.clipFilesListeners.add(cb) }
  public onClipboardImage(cb: (png: Uint8Array) => void): void { this.clipImageListeners.add(cb) }

  public list(): TransferState[] {
    return Array.from(this.states.values())
  }

  public sendChat(text: string): void {
    if (!this.outgoingAllowed) return
    const clean = truncateToUtf8Bytes(String(text ?? ''), MAX_CHAT_BYTES)
    if (!clean) return
    this.sendTextWithinFrameBudget((t) => ({ t: 'chat', text: t }), clean)
  }

  public sendClipboardText(text: string): void {
    if (!this.peerPolicy.clipboard.text) return
    const clean = truncateToUtf8Bytes(String(text ?? ''), MAX_CLIP_TEXT_BYTES)
    if (!clean) return
    this.sendTextWithinFrameBudget((t) => ({ t: 'clip-text', text: t }), clean)
  }

  public async sendClipboardImage(png: Uint8Array): Promise<string | null> {
    if (!this.peerPolicy.clipboard.image) return null
    if (png.length > this.maxImageBytes) return null
    const file: TreeEntry = {
      relPath: `clipboard-${Date.now()}.png`,
      absPath: '',
      size: png.length,
      isDirectory: false
    }
    return this.enqueueTransfer('clipboard-image', [file], { inlineData: png })
  }

  public async sendClipboardFiles(paths: string[]): Promise<string | null> {
    if (!this.peerPolicy.clipboard.file) return null
    if (paths.length === 0) return null
    return this.enqueueSend(paths, 'clipboard-file')
  }

  public async enqueueSend(paths: string[], mode: TransferMode = 'send'): Promise<string> {
    // 仅查看会话：主动文件发送与剪贴板文件发送在任何文件扫描/哈希前直接拒绝
    if (!this.outgoingAllowed && (mode === 'send' || mode === 'clipboard-file')) {
      throw new Error('当前会话为仅查看模式，禁止发送文件')
    }
    const scanned = await scanPaths(paths)
    const files = scanned.filter((e) => !e.isDirectory)
    if (files.length === 0) {
      throw new Error('没有可传输的文件')
    }
    const oversized = files.find((f) => f.size > this.maxFileBytes)
    if (oversized) {
      throw new Error(`文件超过单文件上限: ${oversized.relPath}`)
    }
    return this.enqueueTransfer(mode, files)
  }

  public cancel(transferId: string): void {
    const state = this.states.get(transferId)
    if (!state) return
    this.sendControl({ t: 'transfer-cancel', transferId, reason: 'user-cancelled' })
    const incoming = this.incoming.get(transferId)
    if (incoming) {
      // 入站由 abortIncoming 在清理完成后置终态
      void this.abortIncoming(transferId, incoming, 'cancelled')
      return
    }
    if (this.activeOutgoing && this.activeOutgoing.state.transferId === transferId) {
      // flowChunks 观察到终态后自行返回，pumpQueue 会在其 finally 中继续
      this.setStatus(this.activeOutgoing.state, 'cancelled', 'user-cancelled')
      // 若仍在等待 accept，唤醒闸门避免 pumpQueue 悬挂到超时
      this.settleAccept(this.activeOutgoing, false, 'user-cancelled')
    } else {
      const queued = this.outgoingQueue.find((j) => j.state.transferId === transferId)
      this.outgoingQueue = this.outgoingQueue.filter((j) => j.state.transferId !== transferId)
      this.setStatus(state, 'cancelled', 'user-cancelled')
      if (queued) this.settleAccept(queued, false, 'user-cancelled')
    }
  }

  public dispose(): void {
    this.disposed = true
    for (const [id, job] of this.incoming) {
      void this.abortIncoming(id, job, 'disposed')
    }
    this.incoming.clear()
    for (const job of this.outgoingQueue) {
      this.setStatus(job.state, 'cancelled', 'disposed')
      this.settleAccept(job, false, 'disposed')
    }
    this.outgoingQueue = []
    if (this.activeOutgoing) {
      this.setStatus(this.activeOutgoing.state, 'cancelled', 'disposed')
      this.settleAccept(this.activeOutgoing, false, 'disposed')
    }
    void cleanupDir(this.stagingDir).catch(() => {})
  }

  // ---- 内部实现 ----

  private async enqueueTransfer(mode: TransferMode, files: TreeEntry[], extras?: { inlineData?: Uint8Array }): Promise<string> {
    // 双保险：enqueueSend 已在扫描前短路，这里覆盖直接调用 enqueueTransfer 的路径
    if (!this.outgoingAllowed && (mode === 'send' || mode === 'clipboard-file')) {
      throw new Error('当前会话为仅查看模式，禁止发送文件')
    }
    const transferId = `tr_${crypto.randomUUID()}`
    const entries: TransferEntry[] = await Promise.all(
      files.map(async (f) => ({
        name: path.basename(f.relPath),
        relPath: f.relPath,
        size: f.size,
        sha256: extras?.inlineData ? sha256Hex(extras.inlineData) : await sha256File(f.absPath)
      }))
    )
    const totalBytes = entries.reduce((sum, e) => sum + e.size, 0)
    const state: TransferState = {
      transferId,
      mode,
      direction: 'outgoing',
      entries,
      totalBytes,
      transferredBytes: 0,
      status: 'pending'
    }
    this.states.set(transferId, state)
    this.emitState(state)
    const job: OutgoingJob = { state, sources: files, inlineBytes: extras?.inlineData }
    // 必须在 sendControl(offer) 之前建立闸门：loopback/内联对端可能在 offer 处理中同步回 reject
    this.createAcceptGate(job)
    this.outgoingQueue.push(job)
    this.sendControl({ t: 'transfer-offer', transferId, mode, totalBytes, entries })
    void this.pumpQueue()
    return transferId
  }

  private async pumpQueue(): Promise<void> {
    if (this.activeOutgoing || this.disposed) return
    let job = this.outgoingQueue.shift()
    // 跳过已被取消/拒绝/失败的任务，避免把它们重新置为 active 后照常发送
    while (job && isTerminalStatus(job.state.status)) {
      job = this.outgoingQueue.shift()
    }
    if (!job) return
    this.activeOutgoing = job
    this.setStatus(job.state, 'active')
    try {
      // 先等对端 transfer-accept 再推分块：被拒绝则一个字节都不上传
      await this.waitForAccept(job)
      if (this.canContinueSending(job)) {
        await this.flowChunks(job)
      }
    } catch (err: any) {
      // 被拒绝时状态已是 rejected（终态保护），此处不会覆盖；超时则置 failed
      this.setStatus(job.state, 'failed', err?.message)
    } finally {
      this.activeOutgoing = null
      void this.pumpQueue()
    }
  }

  /** 为出站任务建立 accept 闸门；立即挂一个空 catch，避免 reject 在无人 await 时触发 unhandledRejection */
  private createAcceptGate(job: OutgoingJob): void {
    let resolveFn: () => void = () => {}
    let rejectFn: (err: Error) => void = () => {}
    const promise = new Promise<void>((resolve, reject) => {
      resolveFn = resolve
      rejectFn = reject
    })
    promise.catch(() => {})
    job.accept = { promise, resolve: resolveFn, reject: rejectFn, settled: false }
  }

  /** 幂等 settle 闸门：accept/reject/cancel/dispose 竞争时只有第一个生效 */
  private settleAccept(job: OutgoingJob, ok: boolean, reason?: string): void {
    const gate = job.accept
    if (!gate || gate.settled) return
    gate.settled = true
    if (ok) gate.resolve()
    else gate.reject(new Error(reason ?? 'rejected'))
  }

  /** 在队列与当前活动任务中按 transferId 查找出站任务 */
  private findOutgoingJob(transferId: string): OutgoingJob | null {
    if (this.activeOutgoing && this.activeOutgoing.state.transferId === transferId) return this.activeOutgoing
    return this.outgoingQueue.find((j) => j.state.transferId === transferId) ?? null
  }

  /**
   * 等待对端 accept。超时则发送 transfer-cancel(accept-timeout) 并抛错，
   * 使任务置 failed，避免对端不回包时队列无限期挂起。
   */
  private async waitForAccept(job: OutgoingJob): Promise<void> {
    const gate = job.accept
    if (!gate) return
    let timer: ReturnType<typeof setTimeout> | null = null
    const timeout = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), this.acceptTimeoutMs)
    })
    const outcome = await Promise.race([
      gate.promise.then(() => 'accepted' as const).catch(() => 'rejected' as const),
      timeout
    ])
    if (timer) clearTimeout(timer)
    if (outcome === 'timeout') {
      this.sendControl({ t: 'transfer-cancel', transferId: job.state.transferId, reason: 'accept-timeout' })
      throw new Error('accept-timeout')
    }
    if (outcome === 'rejected') {
      // 状态已由 handleControl 置 rejected
      throw new Error('rejected')
    }
  }

  private async flowChunks(job: OutgoingJob): Promise<void> {
    for (let entryIndex = 0; entryIndex < job.state.entries.length; entryIndex++) {
      const entry = job.state.entries[entryIndex]
      const source = job.sources[entryIndex]
      let seq = 0
      for (let offset = 0; offset < entry.size; offset += CHUNK_SIZE) {
        if (!this.canContinueSending(job)) return
        const length = Math.min(CHUNK_SIZE, entry.size - offset)
        const chunk = job.inlineBytes
          ? job.inlineBytes.subarray(offset, offset + length)
          : await readChunk(source.absPath, offset, length)
        await this.waitForCapacity(job)
        if (!this.canContinueSending(job)) return
        this.transport.send(encodeBinaryFrame({ transferId: job.state.transferId, entryIndex, seq, len: chunk.length }, chunk))
        job.state.transferredBytes += chunk.length
        this.emitState(job.state)
        seq++
      }
    }
    if (!this.canContinueSending(job)) return
    this.sendControl({ t: 'transfer-complete', transferId: job.state.transferId })
  }

  private canContinueSending(job: OutgoingJob): boolean {
    return !this.disposed && this.transport.isOpen() && !isTerminalStatus(job.state.status)
  }

  /**
   * 流控迟滞：缓冲 > FLOW_HIGH 时暂停，恢复到 < FLOW_LOW 才继续。
   * 传输被取消/拒绝/失败、会话 dispose、或 transport 关闭时立即退出，
   * 避免网卡停滞导致 cancel()/dispose() 悬挂。
   */
  private async waitForCapacity(job: OutgoingJob): Promise<void> {
    if (this.transport.bufferedAmount() <= FLOW_HIGH) return
    while (this.transport.bufferedAmount() > FLOW_LOW && this.canContinueSending(job)) {
      await new Promise((r) => setTimeout(r, 10))
    }
  }

  /**
   * 构造保证单帧可编码的文本控制帧并发送。
   * 首轮已按 UTF-8 字节上限裁剪，但 JSON 转义会把部分字符（如控制字符）放大到每个 6 字节，
   * 使转义后体积超过 MAX_FRAME_BYTES。这里实测 encodeJsonFrame 的编码长度，
   * 对码点长度做二分收缩，始终发送「能放下的最长前缀」，不再静默丢弃。
   */
  private sendTextWithinFrameBudget(buildFrame: (text: string) => ControlFrame, text: string): void {
    const prefix = this.largestFittingText(buildFrame, text)
    if (prefix === null) return
    this.sendControl(buildFrame(prefix))
  }

  /** 二分搜索能完整编码进单帧的最长码点前缀；若空串都无法编码（实践中不会发生）则返回 null */
  private largestFittingText(buildFrame: (text: string) => ControlFrame, text: string): string | null {
    // 按码点切分，避免把代理对截成孤立的半个字符
    const codePoints = Array.from(text)
    const fits = (count: number): boolean => {
      try {
        encodeJsonFrame(buildFrame(codePoints.slice(0, count).join('')))
        return true
      } catch {
        return false
      }
    }
    if (!fits(0)) return null
    if (fits(codePoints.length)) return text
    let low = 0
    let high = codePoints.length
    while (low < high) {
      const mid = Math.floor((low + high + 1) / 2)
      if (fits(mid)) low = mid
      else high = mid - 1
    }
    return codePoints.slice(0, low).join('')
  }

  private sendControl(frame: ControlFrame): void {
    if (!this.transport.isOpen()) return
    let bytes: Uint8Array
    try {
      bytes = encodeJsonFrame(frame)
    } catch (err) {
      // 帧超限时丢弃而不是抛给调用方（剪贴板轮询回调在 setInterval 内，绝不能逃逸）
      console.warn('[remote-assist] dropped oversized control frame', err)
      return
    }
    this.transport.send(bytes)
  }

  private handleFrame(bytes: Uint8Array): void {
    let decoded
    try {
      decoded = decodeFrame(bytes)
    } catch {
      return
    }
    if (decoded.kind === 'json') {
      this.handleControl(decoded.frame)
      return
    }
    this.handleBinary(decoded.header, decoded.payload)
  }

  private handleControl(frame: ControlFrame): void {
    switch (frame.t) {
      case 'chat':
        // 入站限流：超长直接丢弃，不信任对端（按 UTF-8 字节计）
        if (typeof frame.text === 'string' && utf8ByteLength(frame.text) <= MAX_CHAT_BYTES) {
          for (const cb of this.chatListeners) cb(frame.text)
        }
        break
      case 'clip-text':
        // 本端接收策略未开启文本同步时丢弃；同时按字节限流
        if (!this.policy.clipboard.text) break
        if (typeof frame.text === 'string' && utf8ByteLength(frame.text) <= MAX_CLIP_TEXT_BYTES) {
          for (const cb of this.clipTextListeners) cb(frame.text)
        }
        break
      case 'transfer-offer':
        void this.handleOffer(frame)
        break
      case 'transfer-accept': {
        // 对端同意接收：放行该出站任务的 accept 闸门，开始推分块
        const job = this.findOutgoingJob(frame.transferId)
        if (job) this.settleAccept(job, true)
        break
      }
      case 'transfer-reject': {
        // 拒绝即终态：移出队列；若正在发送，flowChunks 会观察到并停止发送
        const state = this.states.get(frame.transferId)
        if (state) this.setStatus(state, 'rejected', frame.reason)
        const job = this.findOutgoingJob(frame.transferId)
        this.outgoingQueue = this.outgoingQueue.filter((j) => j.state.transferId !== frame.transferId)
        if (job) this.settleAccept(job, false, frame.reason)
        break
      }
      case 'transfer-cancel': {
        const incoming = this.incoming.get(frame.transferId)
        if (incoming) {
          // 由 abortIncoming 在清理完成后置终态，避免 .part 未删就宣告 cancelled
          void this.abortIncoming(frame.transferId, incoming, frame.reason)
        } else {
          const state = this.states.get(frame.transferId)
          if (state) this.setStatus(state, 'cancelled', frame.reason)
        }
        break
      }
      case 'transfer-complete':
        void this.completeIncoming(frame.transferId)
        break
      case 'transfer-result': {
        const state = this.states.get(frame.transferId)
        if (state) this.setStatus(state, frame.ok ? 'done' : 'failed', frame.message)
        break
      }
      case 'receive-policy': {
        const policy: TransferPolicy = { receiveFiles: frame.receiveFiles, clipboard: { ...frame.clipboard } }
        this.peerPolicy = {
          receiveFiles: Boolean(policy.receiveFiles),
          clipboard: {
            text: Boolean(policy.clipboard?.text),
            image: Boolean(policy.clipboard?.image),
            file: Boolean(policy.clipboard?.file)
          }
        }
        for (const cb of this.policyListeners) cb(policy)
        break
      }
      case 'ping':
        this.sendControl({ t: 'pong' })
        break
      case 'pong':
        break
    }
  }

  private async handleOffer(frame: Extract<ControlFrame, { t: 'transfer-offer' }>): Promise<void> {
    const state: TransferState = {
      transferId: frame.transferId,
      mode: frame.mode,
      direction: 'incoming',
      entries: frame.entries,
      totalBytes: frame.totalBytes,
      transferredBytes: 0,
      status: 'pending'
    }
    this.states.set(frame.transferId, state)

    const allowed =
      frame.mode === 'send' ? this.policy.receiveFiles :
      frame.mode === 'clipboard-file' ? this.policy.clipboard.file :
      this.policy.clipboard.image
    if (!allowed) {
      this.sendControl({ t: 'transfer-reject', transferId: frame.transferId, reason: 'not-authorized' })
      this.setStatus(state, 'rejected', 'not-authorized')
      return
    }
    const total = frame.entries.reduce((sum, e) => sum + e.size, 0)
    // 入站图片独立上限：不信任对端自报，超限直接拒绝
    if (frame.mode === 'clipboard-image' && total > this.maxImageBytes) {
      this.sendControl({ t: 'transfer-reject', transferId: frame.transferId, reason: 'too-large' })
      this.setStatus(state, 'rejected', 'too-large')
      return
    }
    if (total > this.maxFileBytes) {
      this.sendControl({ t: 'transfer-reject', transferId: frame.transferId, reason: 'too-large' })
      this.setStatus(state, 'rejected', 'too-large')
      return
    }
    const targetRoot = frame.mode === 'send'
      ? this.receiveDir
      : path.join(this.stagingDir, frame.transferId)
    const job: IncomingJob = {
      state,
      writers: new Map(),
      entryIndex: 0,
      expectedSeq: 0,
      targetRoot,
      topLevelPaths: new Set(),
      entryReceived: new Map(),
      writeChain: Promise.resolve()
    }
    // 同步登记再执行 await：发送端在 offer 之后立即发分块，异步登记会丢帧
    this.incoming.set(frame.transferId, job)
    await ensureDir(targetRoot)
    const free = await estimateFreeBytes(targetRoot)
    if (free < total * 1.1) {
      this.incoming.delete(frame.transferId)
      await this.cleanupIncoming(job)
      this.sendControl({ t: 'transfer-reject', transferId: frame.transferId, reason: 'disk' })
      this.setStatus(state, 'rejected', 'disk')
      return
    }

    this.sendControl({ t: 'transfer-accept', transferId: frame.transferId })
    this.setStatus(state, 'active')
  }

  private handleBinary(header: { transferId: string; entryIndex: number; seq: number; len: number }, payload: Uint8Array): void {
    const job = this.incoming.get(header.transferId)
    if (!job) return
    // 单帧不得超过协议分块大小：不信任对端，超限立即中止
    if (header.len > CHUNK_SIZE || payload.length > CHUNK_SIZE) {
      this.failIncomingOverflow(job, 'chunk-too-large')
      return
    }
    // 多条目传输：发送端每个条目重新从 seq=0 开始，收到新条目时推进并复位序号。
    // 允许向前跳跃：size===0 的条目不产生任何二进制帧（flowChunks 跳过其分块循环），
    // 因此对端可能直接跳过它们；只要目标条目在当前声明范围内即视为合法推进。
    // 回退（< 当前索引）、越界（>= entries.length）与重复旧条目仍是序列错误。
    if (header.entryIndex !== job.entryIndex) {
      const forwardJump =
        header.entryIndex > job.entryIndex && header.entryIndex < job.state.entries.length
      if (!forwardJump) {
        this.failIncomingSequence(header.transferId, job)
        return
      }
      job.entryIndex = header.entryIndex
      job.expectedSeq = 0
    }
    if (header.seq !== job.expectedSeq) {
      this.failIncomingSequence(header.transferId, job)
      return
    }
    // 同步推进序号，落盘串行排队，避免与 transfer-complete/abort 竞态
    job.expectedSeq += 1
    job.writeChain = job.writeChain.then(() => this.writeChunk(job, header.entryIndex, payload))
  }

  private failIncomingSequence(transferId: string, job: IncomingJob): void {
    this.sendControl({ t: 'transfer-cancel', transferId, reason: 'sequence-error' })
    void this.abortIncoming(transferId, job, 'sequence-error')
  }

  /**
   * 收到超出声明/上限的数据：立即中止。发送 transfer-cancel + transfer-result{ok:false}，
   * 并复用失败清理路径（删 .part、坏文件、暂存目录），状态置 failed。
   */
  private failIncomingOverflow(job: IncomingJob, reason: string): void {
    const transferId = job.state.transferId
    if (!this.incoming.has(transferId)) return
    this.incoming.delete(transferId)
    this.sendControl({ t: 'transfer-cancel', transferId, reason })
    this.sendControl({ t: 'transfer-result', transferId, ok: false, message: reason })
    void this.cleanupIncoming(job).then(() => {
      this.setStatus(job.state, 'failed', reason)
    })
  }

  private async writeChunk(job: IncomingJob, entryIndex: number, payload: Uint8Array): Promise<void> {
    // 已被中止（取消/超限/失败）的任务不再落盘
    if (!this.incoming.has(job.state.transferId)) return
    const entry = job.state.entries[entryIndex]
    if (!entry) {
      this.failIncomingOverflow(job, 'bad-entry')
      return
    }
    const already = job.entryReceived.get(entryIndex) ?? 0
    // 单条目不得超出其声明大小
    if (already + payload.length > entry.size) {
      this.failIncomingOverflow(job, 'entry-overflow')
      return
    }
    // 任务总量不得超出接收上限
    if (job.state.transferredBytes + payload.length > this.maxFileBytes) {
      this.failIncomingOverflow(job, 'total-overflow')
      return
    }
    let writer = job.writers.get(entryIndex)
    if (!writer) {
      writer = await PartWriter.open(job.targetRoot, entry.relPath)
      job.writers.set(entryIndex, writer)
      const top = entry.relPath.split('/')[0]
      job.topLevelPaths.add(path.join(job.targetRoot, top))
    }
    await writer.write(payload)
    job.entryReceived.set(entryIndex, already + payload.length)
    job.state.transferredBytes += payload.length
    this.emitState(job.state)
  }

  private async completeIncoming(transferId: string): Promise<void> {
    const job = this.incoming.get(transferId)
    if (!job) return
    const corruptPaths: string[] = []
    let ok = false
    try {
      // 等待所有已入队的分块写入完成，否则可能用空的 writers 提前收尾
      await job.writeChain
      // 每个条目（含零字节的空文件）都必须有写入器并落盘
      for (let i = 0; i < job.state.entries.length; i++) {
        if (!job.writers.has(i)) {
          const writer = await PartWriter.open(job.targetRoot, job.state.entries[i].relPath)
          job.writers.set(i, writer)
          const top = job.state.entries[i].relPath.split('/')[0]
          job.topLevelPaths.add(path.join(job.targetRoot, top))
        }
      }
      for (let i = 0; i < job.state.entries.length; i++) {
        const entry = job.state.entries[i]
        // 收齐性校验：实际字节数必须与声明一致，否则不允许宣告成功
        const received = job.entryReceived.get(i) ?? 0
        if (received !== entry.size) {
          throw new Error(`size mismatch: ${entry.relPath} received ${received} != declared ${entry.size}`)
        }
        const writer = job.writers.get(i)
        if (!writer) throw new Error(`missing writer: ${entry.relPath}`)
        const finalPath = await writer.finalize()
        const actual = await sha256File(finalPath)
        if (actual !== entry.sha256) {
          corruptPaths.push(finalPath)
          throw new Error(`checksum mismatch: ${entry.relPath}`)
        }
      }
      // 完成后的模式特定动作
      if (job.state.mode === 'clipboard-file') {
        for (const cb of this.clipFilesListeners) cb(Array.from(job.topLevelPaths))
      } else if (job.state.mode === 'clipboard-image') {
        const firstEntry = job.state.entries[0]
        const pngPath = path.join(job.targetRoot, firstEntry.relPath)
        const png = new Uint8Array(await fs.readFile(pngPath))
        for (const cb of this.clipImageListeners) cb(png)
      }
      this.sendControl({ t: 'transfer-result', transferId, ok: true })
      this.setStatus(job.state, 'done')
      ok = true
    } catch (err: any) {
      this.sendControl({ t: 'transfer-result', transferId, ok: false, message: err?.message })
      this.setStatus(job.state, 'failed', err?.message)
    } finally {
      this.incoming.delete(transferId)
      if (!ok) {
        // 失败：删除已定型的坏文件、中止剩余 .part 写入、清理暂存目录
        await this.cleanupIncoming(job, corruptPaths)
      } else if (job.state.mode === 'clipboard-image') {
        await cleanupDir(job.targetRoot).catch(() => {})
      }
    }
  }

  /**
   * 中止写入并清理：仅暂存目录可整目录删除，接收目录可能含用户既有文件，绝不能整目录删除。
   * corruptPaths 为已定型但校验失败的目标文件，需单独删除。
   */
  private async cleanupIncoming(job: IncomingJob, corruptPaths: string[] = []): Promise<void> {
    await job.writeChain.catch(() => {})
    for (const p of corruptPaths) {
      await fs.rm(p, { force: true }).catch(() => {})
    }
    for (const writer of job.writers.values()) {
      await writer.abort().catch(() => {})
    }
    if (path.resolve(job.targetRoot) !== path.resolve(this.receiveDir)) {
      await cleanupDir(job.targetRoot).catch(() => {})
    }
  }

  private async abortIncoming(transferId: string, job: IncomingJob, reason: string): Promise<void> {
    this.incoming.delete(transferId)
    await this.cleanupIncoming(job)
    this.setStatus(job.state, 'cancelled', reason)
  }

  private setStatus(state: TransferState, status: TransferStatus, message?: string): void {
    // 终态不可被改写：取消不得把已 done/failed/rejected/cancelled 的传输再置为 cancelled
    if (status !== state.status && isTerminalStatus(state.status)) return
    state.status = status
    if (message !== undefined) state.message = message
    this.emitState(state)
  }

  private emitState(state: TransferState): void {
    for (const cb of this.stateListeners) cb({ ...state, entries: state.entries })
  }
}
