import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { TransferSession } from '../src/main/services/remote-assist/transfer/transfer-session.ts'
import { ClipboardBridge } from '../src/main/services/remote-assist/transfer/clipboard-bridge.ts'
import {
  encodeJsonFrame,
  encodeBinaryFrame,
  decodeFrame,
  CHUNK_SIZE,
  sha256Hex
} from '../src/main/services/remote-assist/transfer/transfer-protocol.ts'

class LoopbackTransport {
  constructor(opts = {}) { this.peer = null; this.frames = []; this.callbacks = []; this.corruptBinary = opts.corruptBinary ?? false }
  send(bytes) {
    let out = bytes
    if (this.corruptBinary && bytes[0] === 0x02 && bytes.length > 5) {
      out = Uint8Array.from(bytes)
      out[out.length - 1] = out[out.length - 1] ^ 0xff
    }
    this.frames.push(out)
    this.peer?.deliver(out)
  }
  bufferedAmount() { return 0 }
  isOpen() { return true }
  onFrame(cb) { this.callbacks.push(cb) }
  deliver(bytes) { for (const cb of this.callbacks) cb(bytes) }
}

function link(a, b) { a.peer = b; b.peer = a }

async function tempDir() { return fs.mkdtemp(path.join(os.tmpdir(), 'dj-sess-')) }

async function waitFor(pred, { timeoutMs = 10000, intervalMs = 5 } = {}) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await pred()) return
    await new Promise((r) => setTimeout(r, intervalMs))
  }
  throw new Error('waitFor timed out')
}

async function exists(p) { return fs.stat(p).then(() => true, () => null) }

async function cleanup(...dirs) { for (const d of dirs) await fs.rm(d, { recursive: true, force: true }) }

test('sends a file end-to-end and reports completion on both sides', async () => {
  const dirA = await tempDir()
  const dirB = await tempDir()
  const srcDir = await tempDir()
  const srcFile = path.join(srcDir, 'hello.txt')
  await fs.writeFile(srcFile, 'hello transfer')

  const ta = new LoopbackTransport()
  const tb = new LoopbackTransport()
  link(ta, tb)

  const sender = new TransferSession({ transport: ta, receiveDir: dirA, stagingDir: path.join(dirA, '.stage') })
  const receiver = new TransferSession({ transport: tb, receiveDir: dirB, stagingDir: path.join(dirB, '.stage') })
  receiver.setPolicy({ receiveFiles: true, clipboard: { text: false, image: false, file: false } })

  const senderStates = []
  sender.onState((s) => senderStates.push({ status: s.status, pct: s.transferredBytes }))
  const receiverStates = []
  receiver.onState((s) => receiverStates.push(s.status))

  const transferId = await sender.enqueueSend([srcFile])
  await new Promise((r) => setTimeout(r, 50))

  assert.ok(senderStates.some((s) => s.status === 'done'), 'sender should finish')
  assert.ok(receiverStates.includes('done'), 'receiver should finish')
  const received = await fs.readFile(path.join(dirB, 'hello.txt'), 'utf8')
  assert.equal(received, 'hello transfer')
  await fs.rm(srcDir, { recursive: true, force: true })
  await fs.rm(dirA, { recursive: true, force: true })
  await fs.rm(dirB, { recursive: true, force: true })
  assert.ok(transferId.startsWith('tr_'))
})

test('rejects inbound transfer when receiveFiles is false', async () => {
  const dirA = await tempDir()
  const dirB = await tempDir()
  const srcDir = await tempDir()
  await fs.writeFile(path.join(srcDir, 'x.txt'), 'x')

  const ta = new LoopbackTransport()
  const tb = new LoopbackTransport()
  link(ta, tb)
  const sender = new TransferSession({ transport: ta, receiveDir: dirA, stagingDir: path.join(dirA, '.s') })
  const receiver = new TransferSession({ transport: tb, receiveDir: dirB, stagingDir: path.join(dirB, '.s') })
  receiver.setPolicy({ receiveFiles: false, clipboard: { text: true, image: true, file: true } })

  const states = []
  sender.onState((s) => states.push(s.status))
  await sender.enqueueSend([path.join(srcDir, 'x.txt')])
  await new Promise((r) => setTimeout(r, 30))

  assert.ok(states.includes('rejected'), 'sender should observe rejection')
  assert.equal(await fs.stat(path.join(dirB, 'x.txt')).catch(() => null), null)
  await fs.rm(srcDir, { recursive: true, force: true }); await fs.rm(dirA, { recursive: true, force: true }); await fs.rm(dirB, { recursive: true, force: true })
})

test('chat and clipboard text are delivered to the peer', async () => {
  const dirA = await tempDir(); const dirB = await tempDir()
  const ta = new LoopbackTransport(); const tb = new LoopbackTransport(); link(ta, tb)
  const a = new TransferSession({ transport: ta, receiveDir: dirA, stagingDir: path.join(dirA, '.s') })
  const b = new TransferSession({ transport: tb, receiveDir: dirB, stagingDir: path.join(dirB, '.s') })
  const chats = []; const clips = []
  b.onChat((t) => chats.push(t)); b.onClipboardText((t) => clips.push(t))
  a.sendChat('hi'); a.sendClipboardText('clip')
  await new Promise((r) => setTimeout(r, 10))
  assert.deepEqual(chats, ['hi']); assert.deepEqual(clips, ['clip'])
  await fs.rm(dirA, { recursive: true, force: true }); await fs.rm(dirB, { recursive: true, force: true })
})

test('view-only gate: outgoing file/chat sends are blocked but clipboard text still syncs', async () => {
  const dirA = await tempDir(); const dirB = await tempDir(); const srcDir = await tempDir()
  const srcFile = path.join(srcDir, 'blocked.txt')
  await fs.writeFile(srcFile, 'should-not-send')

  const ta = new LoopbackTransport(); const tb = new LoopbackTransport(); link(ta, tb)
  const sender = new TransferSession({ transport: ta, receiveDir: dirA, stagingDir: path.join(dirA, '.s') })
  const receiver = new TransferSession({ transport: tb, receiveDir: dirB, stagingDir: path.join(dirB, '.s') })
  receiver.setPolicy({ receiveFiles: true, clipboard: { text: true, image: true, file: true } })

  const chats = []; const clips = []
  receiver.onChat((t) => chats.push(t)); receiver.onClipboardText((t) => clips.push(t))

  sender.setOutgoingAllowed(false)
  assert.equal(sender.isOutgoingAllowed(), false)

  const err = await sender.enqueueSend([srcFile]).catch((e) => e)
  assert.match(String(err && err.message), /仅查看/, 'view-only send must be rejected with the gate error')

  sender.sendChat('blocked-chat')
  sender.sendClipboardText('passive-clip')
  await new Promise((r) => setTimeout(r, 30))

  assert.deepEqual(chats, [], 'chat must not be delivered while outgoing is disallowed')
  assert.deepEqual(clips, ['passive-clip'], 'passive clipboard text must still sync while outgoing is disallowed')

  // clipboard-file sends are gated too
  const fileErr = await sender.sendClipboardFiles([srcFile]).catch((e) => e)
  assert.match(String(fileErr && fileErr.message), /仅查看/)

  // 闸门需在文件系统扫描前短路：即使路径不存在，也应先报"仅查看"而非 fs 错误
  const missingErr = await sender.enqueueSend([path.join(srcDir, 'does-not-exist.txt')]).catch((e) => e)
  assert.match(String(missingErr && missingErr.message), /仅查看/, 'gate must short-circuit before the filesystem scan')

  await cleanup(srcDir, dirA, dirB)
})

test('multi-entry (2 files) transfer lands both files with correct content', async () => {
  const dirA = await tempDir(); const dirB = await tempDir(); const srcDir = await tempDir()
  const f1 = path.join(srcDir, 'a.txt')
  const f2 = path.join(srcDir, 'b.txt')
  const body1 = 'alpha-content'
  const body2 = 'beta-content-is-longer-than-alpha'
  await fs.writeFile(f1, body1)
  await fs.writeFile(f2, body2)

  const ta = new LoopbackTransport(); const tb = new LoopbackTransport(); link(ta, tb)
  const sender = new TransferSession({ transport: ta, receiveDir: dirA, stagingDir: path.join(dirA, '.stage') })
  const receiver = new TransferSession({ transport: tb, receiveDir: dirB, stagingDir: path.join(dirB, '.stage') })
  receiver.setPolicy({ receiveFiles: true, clipboard: { text: false, image: false, file: false } })

  await sender.enqueueSend([f1, f2])
  await waitFor(async () => receiver.list().some((s) => s.status === 'done'))

  assert.equal(await fs.readFile(path.join(dirB, 'a.txt'), 'utf8'), body1)
  assert.equal(await fs.readFile(path.join(dirB, 'b.txt'), 'utf8'), body2)
  assert.equal(await exists(path.join(dirB, 'a.txt.doujiao.part')), null)
  assert.equal(await exists(path.join(dirB, 'b.txt.doujiao.part')), null)
  await cleanup(srcDir, dirA, dirB)
})

test('enforces inbound caps: oversized chat/clipboard text ignored, oversized image offer rejected', async () => {
  const dirA = await tempDir(); const dirB = await tempDir()
  const ta = new LoopbackTransport(); const tb = new LoopbackTransport(); link(ta, tb)
  const a = new TransferSession({ transport: ta, receiveDir: dirA, stagingDir: path.join(dirA, '.s') })
  const b = new TransferSession({ transport: tb, receiveDir: dirB, stagingDir: path.join(dirB, '.s'), maxImageBytes: 1024 })
  b.setPolicy({ receiveFiles: true, clipboard: { text: true, image: true, file: false } })
  const chats = []; const clips = []
  b.onChat((t) => chats.push(t)); b.onClipboardText((t) => clips.push(t))

  // 正常长度仍可送达
  a.sendChat('ok-short')
  await waitFor(async () => chats.length === 1)
  assert.deepEqual(chats, ['ok-short'])

  // 超长入站内容直接在接收端丢弃（sendChat 发送端会截断，故直接注入控制帧验证接收端）
  b.handleControl({ t: 'chat', text: 'x'.repeat(4 * 1024 + 1) })
  b.handleControl({ t: 'clip-text', text: 'y'.repeat(1024 * 1024 + 1) })
  await new Promise((r) => setTimeout(r, 10))
  assert.deepEqual(chats, ['ok-short'], 'oversized chat must not be delivered')
  assert.deepEqual(clips, [], 'oversized clipboard text must not be delivered')

  // 超限图片 offer 被接收端拒绝
  const imageId = await a.sendClipboardImage(new Uint8Array(4096))
  assert.ok(imageId)
  await waitFor(async () => b.list().some((s) => s.transferId === imageId && s.status === 'rejected'))
  await waitFor(async () => a.list().some((s) => s.transferId === imageId && s.status === 'rejected'))
  assert.equal(await exists(path.join(dirB, '.s', imageId)), null, 'no staging dir for rejected image')
  await cleanup(dirA, dirB)
})

test('cancel mid-transfer stops the receiver, removes .part files and keeps the receive dir', async () => {
  const dirA = await tempDir(); const dirB = await tempDir(); const srcDir = await tempDir()
  const srcFile = path.join(srcDir, 'big.bin')
  await fs.writeFile(srcFile, Buffer.alloc(2 * 1024 * 1024, 9))

  // 发送端 transport：放行首个分块后夹断（bufferedAmount 进入高水位），模拟网卡停滞
  class BackpressureTransport extends LoopbackTransport {
    constructor() { super(); this.binarySent = 0; this.gated = false }
    send(bytes) {
      if (bytes[0] === 0x02) {
        this.binarySent++
        if (this.binarySent > 1) this.gated = true
      }
      if (this.gated && bytes[0] === 0x02) return
      this.frames.push(bytes)
      this.peer?.deliver(bytes)
    }
    bufferedAmount() { return this.gated ? 16 * 1024 * 1024 : 0 }
  }

  const ta = new BackpressureTransport(); const tb = new LoopbackTransport(); link(ta, tb)
  const sender = new TransferSession({ transport: ta, receiveDir: dirA, stagingDir: path.join(dirA, '.s') })
  const receiver = new TransferSession({ transport: tb, receiveDir: dirB, stagingDir: path.join(dirB, '.s') })
  receiver.setPolicy({ receiveFiles: true, clipboard: { text: false, image: false, file: false } })

  const transferId = await sender.enqueueSend([srcFile])
  // 接收端已落下一个 .part（首个分块），发送端随后被流控卡住
  await waitFor(async () => exists(path.join(dirB, 'big.bin.doujiao.part')))
  await waitFor(async () => ta.gated)

  sender.cancel(transferId)
  // 卡在流控中的发送循环必须能在取消后退出，而不是悬挂
  await waitFor(async () => sender.list().some((s) => s.transferId === transferId && s.status === 'cancelled'))
  await waitFor(async () => receiver.list().some((s) => s.transferId === transferId && s.status === 'cancelled'))

  assert.equal(await exists(path.join(dirB, 'big.bin.doujiao.part')), null, 'no leftover .part')
  assert.equal(await exists(path.join(dirB, 'big.bin')), null, 'no finalized file')
  assert.ok(await exists(dirB), 'mode:send receive dir must NOT be deleted')
  await cleanup(srcDir, dirA, dirB)
})

test('checksum mismatch removes the corrupt final file and fails the transfer', async () => {
  const dirA = await tempDir(); const dirB = await tempDir(); const srcDir = await tempDir()
  const srcFile = path.join(srcDir, 'corrupt-me.bin')
  await fs.writeFile(srcFile, Buffer.alloc(4096, 7))

  const ta = new LoopbackTransport({ corruptBinary: true }); const tb = new LoopbackTransport(); link(ta, tb)
  const sender = new TransferSession({ transport: ta, receiveDir: dirA, stagingDir: path.join(dirA, '.s') })
  const receiver = new TransferSession({ transport: tb, receiveDir: dirB, stagingDir: path.join(dirB, '.s') })
  receiver.setPolicy({ receiveFiles: true, clipboard: { text: false, image: false, file: false } })

  await sender.enqueueSend([srcFile])
  await waitFor(async () => receiver.list().some((s) => s.status === 'failed'))
  await waitFor(async () => sender.list().some((s) => s.status === 'failed'))

  assert.equal(await exists(path.join(dirB, 'corrupt-me.bin')), null, 'corrupt final file must be removed')
  assert.equal(await exists(path.join(dirB, 'corrupt-me.bin.doujiao.part')), null, 'no leftover .part')
  assert.ok(await exists(dirB), 'receive dir must NOT be deleted')
  await cleanup(srcDir, dirA, dirB)
})

import { TransferService } from '../src/main/services/remote-assist/transfer/transfer-service.ts'

test('TransferService attaches a session, applies policy and tears down staging', async () => {
  const root = await tempDir()
  const service = new TransferService({ receiveDir: path.join(root, 'recv'), stagingRoot: path.join(root, 'stage') })
  const ta = new LoopbackTransport(); const tb = new LoopbackTransport(); link(ta, tb)

  service.setPolicy({ receiveFiles: true, clipboard: { text: true, image: true, file: true } })
  const session = service.attach(ta, 's_1')
  assert.equal(service.getSession(), session)
  assert.equal(service.getSettings().policy.receiveFiles, true)
  assert.ok(service.getSettings().receiveDir.endsWith('recv'))

  service.detach()
  assert.equal(service.getSession(), null)
  await fs.rm(root, { recursive: true, force: true })
})

test('detach does not wipe the shared stagingRoot and a throwing listener cannot break the frame handler', async () => {
  const root = await tempDir()
  const stagingRoot = path.join(root, 'stage')
  const service = new TransferService({ receiveDir: path.join(root, 'recv'), stagingRoot })
  const ta = new LoopbackTransport(); const tb = new LoopbackTransport(); link(ta, tb)

  // A sibling session's staging dir under the same stagingRoot must survive detach().
  const sibling = path.join(stagingRoot, 's_other')
  await fs.mkdir(sibling, { recursive: true })
  await fs.writeFile(path.join(sibling, 'keep.bin'), 'keep')

  service.setPolicy({ receiveFiles: true, clipboard: { text: true, image: true, file: true } })
  service.attach(ta, 's_1')

  // A throwing event listener must not propagate into the frame handler.
  service.onEvent(() => { throw new Error('listener boom') })
  const peer = new TransferSession({ transport: tb, receiveDir: path.join(root, 'recv2'), stagingDir: path.join(root, 'stg2') })
  peer.sendChat('hi')
  await new Promise((r) => setTimeout(r, 20))

  service.detach()
  assert.equal(service.getSession(), null)
  assert.equal(await fs.readFile(path.join(sibling, 'keep.bin'), 'utf8'), 'keep', 'sibling staging dir must survive detach')
  await fs.rm(root, { recursive: true, force: true })
})

test('bridge exposes transfer IPC guarded by the new capabilities', async () => {
  const source = await fs.readFile(new URL('../src/main/ipc/bridge.ts', import.meta.url), 'utf8')
  assert.match(source, /plugin:remote-assist:transfer:send-paths/)
  assert.match(source, /plugin:remote-assist:transfer:set-policy/)
  assert.match(source, /remote\.file\.transfer/)
  assert.match(source, /remote\.clipboard\.sync/)
  const preload = await fs.readFile(new URL('../src/preload/remote-assist-session.ts', import.meta.url), 'utf8')
  assert.match(preload, /transfer:/)
})

// ---- final-branch review fixes ----

test('C1: receiver aborts when a chunk exceeds the entry declared size (under-declared offer)', async () => {
  const dirB = await tempDir()
  const tb = new LoopbackTransport()
  const receiver = new TransferSession({
    transport: tb,
    receiveDir: dirB,
    stagingDir: path.join(dirB, '.s'),
    maxFileBytes: 8 * 1024 * 1024
  })
  receiver.setPolicy({ receiveFiles: true, clipboard: { text: false, image: false, file: false } })

  const transferId = 'tr_evil_underdeclare'
  // 声明 1 字节，随后发送多个 CHUNK_SIZE 分块（远超声明）
  tb.deliver(encodeJsonFrame({
    t: 'transfer-offer',
    transferId,
    mode: 'send',
    totalBytes: 1,
    entries: [{ name: 'evil.bin', relPath: 'evil.bin', size: 1, sha256: sha256Hex(new Uint8Array(0)) }]
  }))
  for (let seq = 0; seq < 3; seq++) {
    tb.deliver(encodeBinaryFrame(
      { transferId, entryIndex: 0, seq, len: CHUNK_SIZE },
      new Uint8Array(CHUNK_SIZE).fill(seq + 1)
    ))
  }

  await waitFor(async () =>
    receiver.list().some((s) => s.transferId === transferId && (s.status === 'failed' || s.status === 'cancelled'))
  )
  const st = receiver.list().find((s) => s.transferId === transferId)
  assert.ok(st.status === 'failed' || st.status === 'cancelled', `unexpected status: ${st.status}`)
  assert.equal(await exists(path.join(dirB, 'evil.bin')), null, 'oversized data must not be finalized')
  assert.equal(await exists(path.join(dirB, 'evil.bin.doujiao.part')), null, 'no leftover .part')
  await cleanup(dirB)
})

test('C2: oversized clipboard text is truncated below the frame budget and never throws', async () => {
  const dirA = await tempDir(); const dirB = await tempDir()
  const ta = new LoopbackTransport(); const tb = new LoopbackTransport(); link(ta, tb)
  const a = new TransferSession({ transport: ta, receiveDir: dirA, stagingDir: path.join(dirA, '.s') })
  const b = new TransferSession({ transport: tb, receiveDir: dirB, stagingDir: path.join(dirB, '.s') })
  b.setPolicy({ receiveFiles: false, clipboard: { text: true, image: false, file: false } })
  const clips = []
  b.onClipboardText((t) => clips.push(t))

  const big = 'a'.repeat(600 * 1024)
  assert.doesNotThrow(() => a.sendClipboardText(big), 'oversized clipboard text must not throw')
  await new Promise((r) => setTimeout(r, 20))

  assert.equal(clips.length, 1, 'text should be delivered truncated, not crash')
  const bytes = Buffer.byteLength(clips[0], 'utf8')
  assert.ok(bytes <= 400 * 1024, `delivered text must stay under cap, got ${bytes}`)
  assert.ok(bytes < Buffer.byteLength(big, 'utf8'))
  await cleanup(dirA, dirB)
})

test('C2: clipboard watcher never lets an oversized frame error escape the poll timer', async () => {
  const root = await tempDir()
  const fake = {
    _text: '',
    readText() { return this._text },
    readImage() { return { isEmpty: () => true, toPNG: () => Buffer.alloc(0) } },
    readBuffer() { return Buffer.alloc(0) },
    writeText(t) { this._text = t },
    writeImage() {},
    writeBuffer() {}
  }
  const bridge = new ClipboardBridge({ clipboard: fake, pollIntervalMs: 1000 })
  const service = new TransferService({
    receiveDir: path.join(root, 'recv'),
    stagingRoot: path.join(root, 'stage'),
    clipboard: bridge
  })
  const ta = new LoopbackTransport(); const tb = new LoopbackTransport(); link(ta, tb)
  service.setPolicy({ receiveFiles: true, clipboard: { text: true, image: true, file: true } })
  service.attach(ta, 's_cap')

  fake._text = 'a'.repeat(600 * 1024)
  assert.doesNotThrow(() => bridge.pollOnce(), 'watcher poll must swallow oversized-frame errors')

  service.detach()
  await fs.rm(root, { recursive: true, force: true })
})

test('I3: empty files are created and every entry is verified against its declared size', async () => {
  const dirA = await tempDir(); const dirB = await tempDir(); const srcDir = await tempDir()
  const empty = path.join(srcDir, 'empty.txt')
  const nonEmpty = path.join(srcDir, 'data.txt')
  await fs.writeFile(empty, '')
  await fs.writeFile(nonEmpty, 'non-empty-content')

  const ta = new LoopbackTransport(); const tb = new LoopbackTransport(); link(ta, tb)
  const sender = new TransferSession({ transport: ta, receiveDir: dirA, stagingDir: path.join(dirA, '.s') })
  const receiver = new TransferSession({ transport: tb, receiveDir: dirB, stagingDir: path.join(dirB, '.s') })
  receiver.setPolicy({ receiveFiles: true, clipboard: { text: false, image: false, file: false } })

  await sender.enqueueSend([empty, nonEmpty])
  await waitFor(async () => receiver.list().some((s) => s.status === 'done'))

  assert.equal(await fs.readFile(path.join(dirB, 'empty.txt'), 'utf8'), '', 'empty file must exist')
  assert.equal(await fs.readFile(path.join(dirB, 'data.txt'), 'utf8'), 'non-empty-content')
  assert.equal(await exists(path.join(dirB, 'empty.txt.doujiao.part')), null)
  await cleanup(srcDir, dirA, dirB)
})

test('I4: inbound clip-text is dropped when local receive policy disables text sync', async () => {
  const dirA = await tempDir(); const dirB = await tempDir()
  const ta = new LoopbackTransport(); const tb = new LoopbackTransport(); link(ta, tb)
  const a = new TransferSession({ transport: ta, receiveDir: dirA, stagingDir: path.join(dirA, '.s') })
  const b = new TransferSession({ transport: tb, receiveDir: dirB, stagingDir: path.join(dirB, '.s') })
  b.setPolicy({ receiveFiles: false, clipboard: { text: false, image: false, file: false } })
  const clips = []
  b.onClipboardText((t) => clips.push(t))
  const wire = []
  tb.onFrame((bytes) => wire.push(bytes))

  a.sendClipboardText('secret')
  await new Promise((r) => setTimeout(r, 10))

  assert.ok(wire.some((f) => Buffer.from(f).includes('clip-text')), 'frame must reach the peer transport')
  assert.deepEqual(clips, [], 'local policy must drop inbound clip-text')
  await cleanup(dirA, dirB)
})

test('I4: outgoing clip-text is suppressed when the peer broadcasts text=false', async () => {
  const dirA = await tempDir(); const dirB = await tempDir()
  const ta = new LoopbackTransport(); const tb = new LoopbackTransport(); link(ta, tb)
  const a = new TransferSession({ transport: ta, receiveDir: dirA, stagingDir: path.join(dirA, '.s') })
  const b = new TransferSession({ transport: tb, receiveDir: dirB, stagingDir: path.join(dirB, '.s') })
  b.setPolicy({ receiveFiles: false, clipboard: { text: true, image: false, file: false } })
  const clips = []
  b.onClipboardText((t) => clips.push(t))

  // 对端广播 receive-policy（text=false），本端本地策略仍允许发送
  a.handleControl({ t: 'receive-policy', receiveFiles: false, clipboard: { text: false, image: false, file: false } })
  const wire = []
  tb.onFrame((bytes) => wire.push(bytes))
  a.sendClipboardText('should-not-send')
  await new Promise((r) => setTimeout(r, 10))

  assert.equal(wire.filter((f) => Buffer.from(f).includes('clip-text')).length, 0, 'no clip-text frame may be sent')
  assert.deepEqual(clips, [])
  await cleanup(dirA, dirB)
})

test('consecutive leading empty entries do not abort the transfer ([empty, empty, data])', async () => {
  const dirA = await tempDir(); const dirB = await tempDir(); const srcDir = await tempDir()
  const e1 = path.join(srcDir, 'e1.txt')
  const e2 = path.join(srcDir, 'e2.txt')
  const data = path.join(srcDir, 'data.txt')
  await fs.writeFile(e1, '')
  await fs.writeFile(e2, '')
  await fs.writeFile(data, 'payload-after-two-empties')

  const ta = new LoopbackTransport(); const tb = new LoopbackTransport(); link(ta, tb)
  const sender = new TransferSession({ transport: ta, receiveDir: dirA, stagingDir: path.join(dirA, '.s') })
  const receiver = new TransferSession({ transport: tb, receiveDir: dirB, stagingDir: path.join(dirB, '.s') })
  receiver.setPolicy({ receiveFiles: true, clipboard: { text: false, image: false, file: false } })

  const senderStates = []
  sender.onState((s) => senderStates.push(s.status))
  const receiverStates = []
  receiver.onState((s) => receiverStates.push(s.status))

  await sender.enqueueSend([e1, e2, data])
  await waitFor(async () => receiver.list().some((s) => s.status === 'done'))
  await waitFor(async () => sender.list().some((s) => s.status === 'done'))

  assert.ok(senderStates.includes('done'), 'sender must finish')
  assert.ok(receiverStates.includes('done'), 'receiver must finish')
  assert.equal(await fs.readFile(path.join(dirB, 'e1.txt'), 'utf8'), '', 'first empty file must exist')
  assert.equal(await fs.readFile(path.join(dirB, 'e2.txt'), 'utf8'), '', 'second empty file must exist')
  assert.equal(await fs.readFile(path.join(dirB, 'data.txt'), 'utf8'), 'payload-after-two-empties')
  assert.equal(await exists(path.join(dirB, 'e1.txt.doujiao.part')), null)
  await cleanup(srcDir, dirA, dirB)
})

test('consecutive interior empty entries do not abort the transfer ([data, empty, empty, data2])', async () => {
  const dirA = await tempDir(); const dirB = await tempDir(); const srcDir = await tempDir()
  const d1 = path.join(srcDir, 'first.txt')
  const e1 = path.join(srcDir, 'mid1.txt')
  const e2 = path.join(srcDir, 'mid2.txt')
  const d2 = path.join(srcDir, 'second.txt')
  await fs.writeFile(d1, 'first-payload')
  await fs.writeFile(e1, '')
  await fs.writeFile(e2, '')
  await fs.writeFile(d2, 'second-payload-is-longer')

  const ta = new LoopbackTransport(); const tb = new LoopbackTransport(); link(ta, tb)
  const sender = new TransferSession({ transport: ta, receiveDir: dirA, stagingDir: path.join(dirA, '.s') })
  const receiver = new TransferSession({ transport: tb, receiveDir: dirB, stagingDir: path.join(dirB, '.s') })
  receiver.setPolicy({ receiveFiles: true, clipboard: { text: false, image: false, file: false } })

  const senderStates = []
  sender.onState((s) => senderStates.push(s.status))
  const receiverStates = []
  receiver.onState((s) => receiverStates.push(s.status))

  await sender.enqueueSend([d1, e1, e2, d2])
  await waitFor(async () => receiver.list().some((s) => s.status === 'done'))
  await waitFor(async () => sender.list().some((s) => s.status === 'done'))

  assert.ok(senderStates.includes('done'), 'sender must finish')
  assert.ok(receiverStates.includes('done'), 'receiver must finish')
  assert.equal(await fs.readFile(path.join(dirB, 'first.txt'), 'utf8'), 'first-payload')
  assert.equal(await fs.readFile(path.join(dirB, 'mid1.txt'), 'utf8'), '', 'first interior empty must exist')
  assert.equal(await fs.readFile(path.join(dirB, 'mid2.txt'), 'utf8'), '', 'second interior empty must exist')
  assert.equal(await fs.readFile(path.join(dirB, 'second.txt'), 'utf8'), 'second-payload-is-longer')
  assert.equal(await exists(path.join(dirB, 'mid1.txt.doujiao.part')), null)
  await cleanup(srcDir, dirA, dirB)
})

test('backwards or out-of-range entry jumps are still sequence errors', async () => {
  const dirB = await tempDir()
  const tb = new LoopbackTransport()
  const receiver = new TransferSession({ transport: tb, receiveDir: dirB, stagingDir: path.join(dirB, '.s') })
  receiver.setPolicy({ receiveFiles: true, clipboard: { text: false, image: false, file: false } })

  const transferId = 'tr_bad_jump'
  const body = new Uint8Array([1, 2, 3])
  tb.deliver(encodeJsonFrame({
    t: 'transfer-offer',
    transferId,
    mode: 'send',
    totalBytes: 6,
    entries: [
      { name: 'a.bin', relPath: 'a.bin', size: 3, sha256: sha256Hex(body) },
      { name: 'b.bin', relPath: 'b.bin', size: 3, sha256: sha256Hex(body) }
    ]
  }))
  // 越界跳跃：entryIndex 2 超出声明的 2 个条目
  tb.deliver(encodeBinaryFrame({ transferId, entryIndex: 2, seq: 0, len: body.length }, body))

  await waitFor(async () =>
    receiver.list().some((s) => s.transferId === transferId && (s.status === 'failed' || s.status === 'cancelled'))
  )
  await cleanup(dirB)
})

test('TransferService emits clipboard-applied only when the clipboard write succeeds', async () => {
  const root = await tempDir()
  const events = []
  const failingBridge = {
    start() {},
    stop() {},
    pollOnce() {},
    writeText() { return false },
    writeFiles() { return false },
    writeImage() { return false },
    markRemoteWrite() {}
  }
  const service = new TransferService({
    receiveDir: path.join(root, 'recv'),
    stagingRoot: path.join(root, 'stage'),
    clipboard: failingBridge
  })
  const ta = new LoopbackTransport(); const tb = new LoopbackTransport(); link(ta, tb)
  service.setPolicy({ receiveFiles: false, clipboard: { text: true, image: true, file: true } })
  service.attach(ta, 's_clip_fail')
  service.onEvent((e) => events.push(e))

  const peer = new TransferSession({ transport: tb, receiveDir: path.join(root, 'recv2'), stagingDir: path.join(root, 'stg2') })
  peer.sendClipboardText('hello')
  await new Promise((r) => setTimeout(r, 30))
  assert.equal(
    events.filter((e) => e.type === 'clipboard-applied').length,
    0,
    'a failed clipboard write must not emit clipboard-applied'
  )
  service.detach()

  // 对照：写入成功时应当发出 clipboard-applied
  const okEvents = []
  const okBridge = { start() {}, stop() {}, pollOnce() {}, writeText() { return true }, writeFiles() { return true }, writeImage() { return true }, markRemoteWrite() {} }
  const service2 = new TransferService({
    receiveDir: path.join(root, 'recv3'),
    stagingRoot: path.join(root, 'stage2'),
    clipboard: okBridge
  })
  const ta2 = new LoopbackTransport(); const tb2 = new LoopbackTransport(); link(ta2, tb2)
  service2.setPolicy({ receiveFiles: false, clipboard: { text: true, image: true, file: true } })
  service2.attach(ta2, 's_clip_ok')
  service2.onEvent((e) => okEvents.push(e))
  const peer2 = new TransferSession({ transport: tb2, receiveDir: path.join(root, 'recv4'), stagingDir: path.join(root, 'stg4') })
  peer2.sendClipboardText('world')
  await new Promise((r) => setTimeout(r, 30))
  assert.equal(okEvents.filter((e) => e.type === 'clipboard-applied' && e.kind === 'text').length, 1)
  service2.detach()

  await fs.rm(root, { recursive: true, force: true })
})

test('I5: cancel cannot overwrite an already-terminal transfer status', async () => {
  const dirA = await tempDir(); const dirB = await tempDir()
  const ta = new LoopbackTransport(); const tb = new LoopbackTransport(); link(ta, tb)
  const a = new TransferSession({ transport: ta, receiveDir: dirA, stagingDir: path.join(dirA, '.s') })
  const b = new TransferSession({ transport: tb, receiveDir: dirB, stagingDir: path.join(dirB, '.s') })
  b.setPolicy({ receiveFiles: false, clipboard: { text: true, image: false, file: false } })

  const state = { transferId: 'tr_terminal', status: 'done' }
  a.states.set('tr_terminal', state)
  a.cancel('tr_terminal')
  assert.equal(state.status, 'done', 'terminal status must not be overwritten by cancel')
  await cleanup(dirA, dirB)
})

// ---- Batch B: 发送端必须等 transfer-accept 后才推分块 ----

test('B1: sender uploads 0 bytes until the peer accepts, then completes', async () => {
  const dirA = await tempDir(); const dirB = await tempDir(); const srcDir = await tempDir()
  const srcFile = path.join(srcDir, 'gated.txt')
  await fs.writeFile(srcFile, 'gated-payload')

  // 接收端 transport：把 transfer-accept 延迟 200ms，模拟慢 accept
  class DelayedAcceptTransport extends LoopbackTransport {
    constructor(delayMs) { super(); this.acceptDelayMs = delayMs; this.acceptDelayed = false }
    send(bytes) {
      const isAccept = bytes[0] === 0x01 && Buffer.from(bytes).includes('transfer-accept')
      if (isAccept && !this.acceptDelayed) {
        this.acceptDelayed = true
        setTimeout(() => { super.send(bytes) }, this.acceptDelayMs)
        return
      }
      super.send(bytes)
    }
  }

  const ta = new LoopbackTransport()
  const tb = new DelayedAcceptTransport(200)
  link(ta, tb)
  const sender = new TransferSession({ transport: ta, receiveDir: dirA, stagingDir: path.join(dirA, '.s') })
  const receiver = new TransferSession({ transport: tb, receiveDir: dirB, stagingDir: path.join(dirB, '.s') })
  receiver.setPolicy({ receiveFiles: true, clipboard: { text: false, image: false, file: false } })

  await sender.enqueueSend([srcFile])
  // accept 延迟期间不能有任何一个字节被上传
  await new Promise((r) => setTimeout(r, 80))
  const beforeAccept = sender.list()[0]
  assert.equal(beforeAccept.transferredBytes, 0, 'no bytes may be uploaded before accept')
  assert.equal(ta.frames.filter((f) => f[0] === 0x02).length, 0, 'no binary chunk before accept')

  await waitFor(async () => sender.list().some((s) => s.status === 'done'), { timeoutMs: 3000 })
  await waitFor(async () => receiver.list().some((s) => s.status === 'done'))

  const finished = sender.list()[0]
  assert.ok(finished.transferredBytes > 0, 'bytes must flow after accept')
  assert.equal(await fs.readFile(path.join(dirB, 'gated.txt'), 'utf8'), 'gated-payload')
  await cleanup(srcDir, dirA, dirB)
})

test('B2: a peer that rejects before accepting receives no binary chunks and ends rejected', async () => {
  const dirA = await tempDir(); const srcDir = await tempDir()
  const srcFile = path.join(srcDir, 'nope.bin')
  await fs.writeFile(srcFile, Buffer.alloc(4096, 3))

  const ta = new LoopbackTransport()
  const tb = new LoopbackTransport()
  link(ta, tb)
  const sender = new TransferSession({ transport: ta, receiveDir: dirA, stagingDir: path.join(dirA, '.s') })

  // 脚本化对端：收到 offer 后延迟 40ms 回 transfer-reject，从不 accept
  tb.onFrame((bytes) => {
    let decoded
    try { decoded = decodeFrame(bytes) } catch { return }
    if (decoded.kind === 'json' && decoded.frame.t === 'transfer-offer') {
      const id = decoded.frame.transferId
      setTimeout(() => {
        tb.send(encodeJsonFrame({ t: 'transfer-reject', transferId: id, reason: 'declined' }))
      }, 40)
    }
  })

  await sender.enqueueSend([srcFile])
  await waitFor(async () => sender.list().some((s) => s.status === 'rejected'), { timeoutMs: 3000 })

  assert.equal(ta.frames.filter((f) => f[0] === 0x02).length, 0, 'no binary chunk may be sent to a rejecting peer')
  assert.ok(
    !ta.frames.some((f) => f[0] === 0x01 && Buffer.from(f).includes('transfer-complete')),
    'no transfer-complete may be sent on rejection'
  )
  await cleanup(srcDir, dirA)
})

test('B3: a peer that never answers accept-times-out and fails instead of hanging', async () => {
  const dirA = await tempDir(); const srcDir = await tempDir()
  const srcFile = path.join(srcDir, 'silent.bin')
  await fs.writeFile(srcFile, Buffer.alloc(1024, 7))

  const ta = new LoopbackTransport()
  const tb = new LoopbackTransport() // 静默对端：不回任何帧
  link(ta, tb)
  const sender = new TransferSession({
    transport: ta,
    receiveDir: dirA,
    stagingDir: path.join(dirA, '.s'),
    acceptTimeoutMs: 60
  })

  await sender.enqueueSend([srcFile])
  await waitFor(async () => sender.list().some((s) => s.status === 'failed'), { timeoutMs: 3000 })

  const st = sender.list().find((s) => s.status === 'failed')
  assert.match(String(st.message || ''), /accept-timeout/)
  assert.ok(
    ta.frames.some((f) => f[0] === 0x01 && Buffer.from(f).includes('accept-timeout')),
    'sender must announce accept-timeout via transfer-cancel'
  )
  assert.equal(ta.frames.filter((f) => f[0] === 0x02).length, 0, 'no binary chunk on accept timeout')
  await cleanup(srcDir, dirA)
})

// ---- Batch C: JSON 转义膨胀的文本必须截断送达，而不是被丢帧 ----

test('C3: escape-inflated clipboard text is truncated to fit the frame budget instead of being dropped', async () => {
  const dirA = await tempDir(); const dirB = await tempDir()
  const ta = new LoopbackTransport(); const tb = new LoopbackTransport(); link(ta, tb)
  const a = new TransferSession({ transport: ta, receiveDir: dirA, stagingDir: path.join(dirA, '.s') })
  const b = new TransferSession({ transport: tb, receiveDir: dirB, stagingDir: path.join(dirB, '.s') })
  b.setPolicy({ receiveFiles: false, clipboard: { text: true, image: false, file: false } })
  const clips = []
  b.onClipboardText((t) => clips.push(t))

  // 每个 '\u0000' 的 UTF-8 仅 1 字节（首轮裁剪不会缩短），但 JSON.stringify 会转义成 6 字节，
  // 使转义后体积远超 MAX_FRAME_BYTES(512KiB)
  const big = '\u0000'.repeat(400 * 1024 - 100)
  assert.ok(Buffer.byteLength(big, 'utf8') < 400 * 1024, 'test input must be just under the raw-byte cap')
  assert.doesNotThrow(() => a.sendClipboardText(big), 'escape-inflated text must never throw')

  await new Promise((r) => setTimeout(r, 20))
  assert.equal(clips.length, 1, 'a truncated frame must still be delivered instead of being dropped')
  assert.ok(clips[0].length > 0, 'delivered text must be non-empty')
  assert.ok(clips[0].length < big.length, 'delivered text must be truncated below the original length')
  assert.ok(Buffer.byteLength(clips[0], 'utf8') <= 400 * 1024, 'delivered text must stay under the raw-byte cap')

  // 对照：正常短文本必须原样送达
  const short = 'hello-clip'
  a.sendClipboardText(short)
  await new Promise((r) => setTimeout(r, 20))
  assert.equal(clips.length, 2, 'second clip must be delivered')
  assert.equal(clips[1], short, 'short text must be delivered unchanged')

  await cleanup(dirA, dirB)
})
