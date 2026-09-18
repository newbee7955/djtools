# 远程协助 V2：传输与共享 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在已建立的远程协助会话内增加文件传输、剪贴板同步（文本/图片/文件）与文字聊天三项能力。

**Architecture:** 复用现有 WebRTC P2P：控制端在既有 `doujiao-input` 之外新建一条有序可靠通道 `doujiao-data`，用自定帧协议（JSON 控制帧 + 二进制分块帧）承载聊天、剪贴板与文件。文件字节在渲染进程与主进程间以 256KiB 分块、拉模式 + 流控方式传递；接收端主进程负责落盘/暂存与 `FileNameW` 剪贴板置入。

**Tech Stack:** Electron 33、React 18、TypeScript 5.7、Chromium WebRTC DataChannel、Node 24（`node --test` 直连 `.ts`，type stripping）、Electron `clipboard` / `nativeImage` / `webUtils`。

**Spec:** `docs/superpowers/specs/2026-09-17-remote-assist-transfer-share-design.md`

## Global Constraints

- 保持**绝对有人值守**：不做无人值守、固定密码、开机静默连入、Wake-on-LAN。
- 传输内容**全程 P2P**（WebRTC 加密），不经过信令服务器；服务器不可见内容。
- 插件渲染进程**不得**获得 Node.js / 任意文件系统 / 原生输入能力；一切文件与剪贴板操作在主进程完成。
- 新增 capability `remote.file.transfer`、`remote.clipboard.sync`，所有相关 IPC 必须经宿主 capability 校验。
- 入站文件：**会话级一次授权、可随时撤销**；剪贴板同步**默认开启**（文本/图片/文件三类各自可关），并有可见指示。
- 单文件上限 2 GB；剪贴板图片上限 20 MB；聊天文本 ≤ 4 KB；剪贴板文本 ≤ 1 MB；分块 256 KiB；单帧 ≤ 512 KiB。
- 接收端强制文件名/路径安全校验：拒绝 `..`、绝对路径、盘符、保留设备名。
- 同一时刻仅 1 个传输（其余排队）；不做断点续传。
- 既有测试必须保持通过：`node --test apps/host/tests/*.test.mjs services/remote-assist-signal/tests/*.test.mjs plugins/remote-assist/tests/*.test.mjs`。
- 测试文件为 `.mjs`，直接 `import ... from '../src/.../x.ts'`（Node 24 type stripping），不要引入新依赖。
- 保持现有代码风格：中文注释、`as const`（如适用）、显式返回类型。

## File Structure

**新增（宿主主进程）** `apps/host/src/main/services/remote-assist/transfer/`
- `transfer-protocol.ts` — 纯函数：帧编解码、`sha256Hex`、`isSafeRelPath`、`resolveWithinRoot`。
- `transfer-fs.ts` — 文件系统原语：目录准备/清理、路径树扫描（递归）、分块读取、`.part` 写入与最终化、`sha256File`。（本文件承担 spec 中 `receive-store.ts` 的落盘职责，并同时服务发送侧哈希。）
- `clipboard-bridge.ts` — 剪贴板读写（文本 / PNG 图片 / `FileNameW` 文件列表）+ `FileNameW` 编解码纯函数 + 回声抑制。
- `transfer-session.ts` — 会话级传输管理：通道抽象、队列、流控、offer/accept/chunk/complete/result、取消/拒绝、策略、聊天与剪贴板文本。
- `transfer-service.ts` — 门面：绑定会话生命周期、持有策略与设置、向 IPC 与会话窗口暴露接口。

**修改（宿主）**
- `apps/host/src/main/container/remote-assist-session-window.ts` — 新增 `doujiao-data` 通道、帧收发、传输面板与聊天面板。
- `apps/host/src/preload/remote-assist-session.ts` — 暴露传输所需的最小 API。
- `apps/host/src/main/ipc/bridge.ts` — 新增传输/剪贴板 IPC（含 capability 校验）。
- `apps/host/src/main/index.ts` — 若无需要则不改（会话窗口已由既有逻辑创建）。

**修改（SDK / 插件 / 文档）**
- `packages/plugin-sdk/src/types.ts` — 新增 capability 与传输事件类型、`RemoteAssistApi` 扩展。
- `plugins/remote-assist/manifest.json` — 增加两项权限。
- `plugins/remote-assist/src/App.tsx`、`src/index.css` — 接收设置 / 剪贴板开关 / 传输历史面板。
- `docs/remote-assistance-security.md` — 增补传输与剪贴板安全小节。

**测试** `apps/host/tests/`
- `remote-assist-transfer-protocol.test.mjs`
- `remote-assist-transfer-fs.test.mjs`
- `remote-assist-clipboard-bridge.test.mjs`
- `remote-assist-transfer-session.test.mjs`
- `remote-assist-transfer-integration.test.mjs`

---

### Task 1: 帧协议与路径安全（`transfer-protocol.ts`）

**Files:**
- Create: `apps/host/src/main/services/remote-assist/transfer/transfer-protocol.ts`
- Test: `apps/host/tests/remote-assist-transfer-protocol.test.mjs`

**Interfaces:**
- Consumes: 无。
- Produces:
  - 常量 `FRAME_JSON = 0x01`、`FRAME_BINARY = 0x02`、`CHUNK_SIZE = 262144`、`MAX_FRAME_BYTES = 524288`
  - 类型 `TransferMode`、`TransferEntry`、`ControlFrame`、`BinaryFrameHeader`、`DecodedFrame`
  - `encodeJsonFrame(frame: ControlFrame): Uint8Array`
  - `encodeBinaryFrame(header: BinaryFrameHeader, payload: Uint8Array): Uint8Array`
  - `decodeFrame(bytes: Uint8Array): DecodedFrame`
  - `sha256Hex(data: Uint8Array): string`
  - `isSafeRelPath(relPath: string): boolean`
  - `resolveWithinRoot(root: string, relPath: string): string`

- [ ] **Step 1: Write the failing test**

```javascript
import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import {
  encodeJsonFrame,
  encodeBinaryFrame,
  decodeFrame,
  sha256Hex,
  isSafeRelPath,
  resolveWithinRoot,
  CHUNK_SIZE
} from '../src/main/services/remote-assist/transfer/transfer-protocol.ts'

test('json control frame round-trips', () => {
  const frame = { t: 'chat', text: '你好' }
  const decoded = decodeFrame(encodeJsonFrame(frame))
  assert.equal(decoded.kind, 'json')
  assert.deepEqual(decoded.frame, frame)
})

test('binary frame round-trips payload bytes and header', () => {
  const payload = new Uint8Array([1, 2, 3, 4, 5])
  const header = { transferId: 'tr_1', entryIndex: 0, seq: 0, len: payload.length }
  const decoded = decodeFrame(encodeBinaryFrame(header, payload))
  assert.equal(decoded.kind, 'binary')
  assert.deepEqual(decoded.header, header)
  assert.deepEqual(Array.from(decoded.payload), [1, 2, 3, 4, 5])
})

test('decodeFrame rejects oversized, truncated and unknown frames', () => {
  assert.throws(() => decodeFrame(new Uint8Array([0x09, 0, 0, 0, 0])), /frameType/)
  assert.throws(() => decodeFrame(new Uint8Array([0x01, 0, 0])), /truncated|length/)
  const big = new Uint8Array(9)
  big[0] = 0x02
  new DataView(big.buffer).setUint32(1, 600 * 1024, false)
  assert.throws(() => decodeFrame(big), /truncated|too large|length/)
})

test('sha256Hex matches node crypto', async () => {
  const { createHash } = await import('node:crypto')
  const data = new Uint8Array([1, 2, 3])
  const expected = createHash('sha256').update(Buffer.from(data)).digest('hex')
  assert.equal(sha256Hex(data), expected)
})

test('isSafeRelPath rejects traversal, absolute paths, drives and reserved names', () => {
  assert.equal(isSafeRelPath('a/b.txt'), true)
  assert.equal(isSafeRelPath('..\\evil.txt'), false)
  assert.equal(isSafeRelPath('../evil.txt'), false)
  assert.equal(isSafeRelPath('/etc/passwd'), false)
  assert.equal(isSafeRelPath('C:\\Windows\\x.dll'), false)
  assert.equal(isSafeRelPath('a/CON.txt'), false)
  assert.equal(isSafeRelPath('a\\b.txt'), true)
})

test('resolveWithinRoot keeps paths inside root and throws on escape', () => {
  const root = process.platform === 'win32' ? 'C:\\base' : '/base'
  const ok = resolveWithinRoot(root, 'sub/file.txt')
  assert.ok(ok.startsWith(path.resolve(root)))
  assert.throws(() => resolveWithinRoot(root, '../escape.txt'), /unsafe relative path|escapes root/)
})

test('CHUNK_SIZE is 256 KiB', () => {
  assert.equal(CHUNK_SIZE, 256 * 1024)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test apps/host/tests/remote-assist-transfer-protocol.test.mjs`
Expected: FAIL（Cannot find module `transfer-protocol.ts`）

- [ ] **Step 3: Write minimal implementation**

```typescript
/**
 * 远程协助传输帧协议 (纯函数，无副作用)
 * 单帧结构: [1B frameType][4B headerLen uint32BE][header JSON utf8][payload bytes]
 */

import crypto from 'node:crypto'
import path from 'node:path'

export const FRAME_JSON = 0x01
export const FRAME_BINARY = 0x02
export const CHUNK_SIZE = 256 * 1024
export const MAX_FRAME_BYTES = 512 * 1024

export type TransferMode = 'send' | 'clipboard-file' | 'clipboard-image'

export interface TransferEntry {
  name: string
  relPath: string
  size: number
  mime?: string
  sha256: string
}

export type ControlFrame =
  | { t: 'chat'; text: string }
  | { t: 'clip-text'; text: string }
  | { t: 'transfer-offer'; transferId: string; mode: TransferMode; totalBytes: number; entries: TransferEntry[] }
  | { t: 'transfer-accept'; transferId: string }
  | { t: 'transfer-reject'; transferId: string; reason: string }
  | { t: 'transfer-cancel'; transferId: string; reason: string }
  | { t: 'transfer-complete'; transferId: string }
  | { t: 'transfer-result'; transferId: string; ok: boolean; message?: string }
  | { t: 'receive-policy'; receiveFiles: boolean; clipboard: { text: boolean; image: boolean; file: boolean } }
  | { t: 'ping' }
  | { t: 'pong' }

export interface BinaryFrameHeader {
  transferId: string
  entryIndex: number
  seq: number
  len: number
}

export type DecodedFrame =
  | { kind: 'json'; frame: ControlFrame }
  | { kind: 'binary'; header: BinaryFrameHeader; payload: Uint8Array }

const RESERVED_WINDOWS_NAMES = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9'
])

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function encodeFrame(frameType: number, header: object, payload?: Uint8Array): Uint8Array {
  const headerBytes = encoder.encode(JSON.stringify(header))
  const payloadBytes = payload ?? new Uint8Array(0)
  const total = 1 + 4 + headerBytes.length + payloadBytes.length
  if (total > MAX_FRAME_BYTES) {
    throw new Error(`frame too large: ${total} > ${MAX_FRAME_BYTES}`)
  }
  const out = new Uint8Array(total)
  out[0] = frameType
  new DataView(out.buffer).setUint32(1, headerBytes.length, false)
  out.set(headerBytes, 5)
  out.set(payloadBytes, 5 + headerBytes.length)
  return out
}

export function encodeJsonFrame(frame: ControlFrame): Uint8Array {
  return encodeFrame(FRAME_JSON, frame)
}

export function encodeBinaryFrame(header: BinaryFrameHeader, payload: Uint8Array): Uint8Array {
  if (payload.length !== header.len) {
    throw new Error(`binary payload length ${payload.length} != header.len ${header.len}`)
  }
  if (payload.length > CHUNK_SIZE) {
    throw new Error(`chunk exceeds CHUNK_SIZE: ${payload.length}`)
  }
  return encodeFrame(FRAME_BINARY, header, payload)
}

export function decodeFrame(bytes: Uint8Array): DecodedFrame {
  if (bytes.length > MAX_FRAME_BYTES) {
    throw new Error(`frame too large: ${bytes.length}`)
  }
  if (bytes.length < 5) {
    throw new Error(`truncated frame: ${bytes.length} bytes`)
  }
  const frameType = bytes[0]
  if (frameType !== FRAME_JSON && frameType !== FRAME_BINARY) {
    throw new Error(`unknown frameType: ${frameType}`)
  }
  const headerLen = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(1, false)
  if (5 + headerLen > bytes.length) {
    throw new Error(`truncated header: need ${headerLen}, have ${bytes.length - 5}`)
  }
  const headerJson = decoder.decode(bytes.subarray(5, 5 + headerLen))
  const header = JSON.parse(headerJson)

  if (frameType === FRAME_JSON) {
    return { kind: 'json', frame: header as ControlFrame }
  }
  const binaryHeader = header as BinaryFrameHeader
  const payload = bytes.subarray(5 + headerLen)
  if (payload.length !== binaryHeader.len) {
    throw new Error(`binary length mismatch: payload ${payload.length} != len ${binaryHeader.len}`)
  }
  return { kind: 'binary', header: binaryHeader, payload }
}

export function sha256Hex(data: Uint8Array): string {
  return crypto.createHash('sha256').update(Buffer.from(data)).digest('hex')
}

export function isSafeRelPath(relPath: string): boolean {
  if (typeof relPath !== 'string' || relPath.length === 0 || relPath.length > 1024) return false
  const normalized = relPath.replace(/\\/g, '/')
  if (normalized.startsWith('/')) return false
  if (/^[a-zA-Z]:/.test(normalized)) return false
  if (/[\u0000-\u001f]/.test(normalized)) return false
  const segments = normalized.split('/').filter((s) => s.length > 0)
  if (segments.length === 0) return false
  for (const segment of segments) {
    if (segment === '.' || segment === '..') return false
    if (/[<>:"|?*]/.test(segment)) return false
    if (/[ .]$/.test(segment)) return false
    const base = segment.split('.')[0].toUpperCase()
    if (RESERVED_WINDOWS_NAMES.has(base)) return false
  }
  return true
}

export function resolveWithinRoot(root: string, relPath: string): string {
  if (!isSafeRelPath(relPath)) {
    throw new Error(`unsafe relative path: ${relPath}`)
  }
  const rootResolved = path.resolve(root)
  const target = path.resolve(rootResolved, relPath)
  const prefix = rootResolved.endsWith(path.sep) ? rootResolved : rootResolved + path.sep
  if (target !== rootResolved && !target.startsWith(prefix)) {
    throw new Error(`path escapes root: ${relPath}`)
  }
  return target
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test apps/host/tests/remote-assist-transfer-protocol.test.mjs`
Expected: PASS（7 tests）

- [ ] **Step 5: Commit**

```bash
git add apps/host/src/main/services/remote-assist/transfer/transfer-protocol.ts apps/host/tests/remote-assist-transfer-protocol.test.mjs
git commit -m "feat(remote-assist): add transfer frame protocol and path safety"
```

---

### Task 2: 文件系统原语（`transfer-fs.ts`）

**Files:**
- Create: `apps/host/src/main/services/remote-assist/transfer/transfer-fs.ts`
- Test: `apps/host/tests/remote-assist-transfer-fs.test.mjs`

**Interfaces:**
- Consumes: `resolveWithinRoot`、`isSafeRelPath`、`sha256Hex` from Task 1。
- Produces:
  - `interface TreeEntry { relPath: string; absPath: string; size: number; isDirectory: boolean }`
  - `scanPaths(inputs: string[]): Promise<TreeEntry[]>`（递归展开目录，返回文件条目，`relPath` 为相对输入根的安全相对路径）
  - `sha256File(absPath: string): Promise<string>`
  - `readChunk(absPath: string, offset: number, length: number): Promise<Uint8Array>`
  - `class PartWriter { static open(targetDir: string, relPath: string): Promise<PartWriter>; write(chunk: Uint8Array): Promise<void>; finalize(): Promise<string>; abort(): Promise<void>; readonly bytesWritten: number; readonly partPath: string }`
  - `estimateFreeBytes(dir: string): Promise<number>`
  - `cleanupDir(dir: string): Promise<void>`
  - `ensureDir(dir: string): Promise<void>`

- [ ] **Step 1: Write the failing test**

```javascript
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  scanPaths,
  sha256File,
  readChunk,
  PartWriter,
  cleanupDir,
  ensureDir
} from '../src/main/services/remote-assist/transfer/transfer-fs.ts'

async function tempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'dj-transfer-'))
}

test('scanPaths expands directories and computes safe relative paths', async () => {
  const root = await tempDir()
  await fs.mkdir(path.join(root, 'folder', 'sub'), { recursive: true })
  await fs.writeFile(path.join(root, 'folder', 'a.txt'), 'aaa')
  await fs.writeFile(path.join(root, 'folder', 'sub', 'b.txt'), 'bbbb')

  const entries = await scanPaths([path.join(root, 'folder')])
  const rels = entries.map((e) => e.relPath).sort()
  assert.deepEqual(rels, ['folder/a.txt', 'folder/sub/b.txt'])
  const a = entries.find((e) => e.relPath === 'folder/a.txt')
  assert.equal(a.size, 3)
  await cleanupDir(root)
})

test('sha256File and readChunk read correct bytes', async () => {
  const root = await tempDir()
  const file = path.join(root, 'x.bin')
  await fs.writeFile(file, Buffer.from([1, 2, 3, 4, 5]))
  const hash = await sha256File(file)
  assert.match(hash, /^[0-9a-f]{64}$/)
  const chunk = await readChunk(file, 1, 3)
  assert.deepEqual(Array.from(chunk), [2, 3, 4])
  await cleanupDir(root)
})

test('PartWriter writes atomically and finalizes to target path', async () => {
  const root = await tempDir()
  const writer = await PartWriter.open(root, 'out/data.bin')
  await writer.write(new Uint8Array([1, 2]))
  await writer.write(new Uint8Array([3]))
  assert.equal(writer.bytesWritten, 3)
  const finalPath = await writer.finalize()
  assert.equal(path.basename(finalPath), 'data.bin')
  const content = await fs.readFile(finalPath)
  assert.deepEqual(Array.from(content), [1, 2, 3])
  assert.equal(await fs.stat(writer.partPath).catch(() => null), null)
  await cleanupDir(root)
})

test('PartWriter.abort removes the partial file', async () => {
  const root = await tempDir()
  const writer = await PartWriter.open(root, 'bad.txt')
  await writer.write(new Uint8Array([9]))
  await writer.abort()
  assert.equal(await fs.stat(writer.partPath).catch(() => null), null)
  await cleanupDir(root)
})

test('ensureDir and cleanupDir are idempotent', async () => {
  const root = await tempDir()
  const nested = path.join(root, 'a', 'b')
  await ensureDir(nested)
  await ensureDir(nested)
  assert.ok((await fs.stat(nested)).isDirectory())
  await cleanupDir(root)
  await cleanupDir(root)
  assert.equal(await fs.stat(root).catch(() => null), null)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test apps/host/tests/remote-assist-transfer-fs.test.mjs`
Expected: FAIL（Cannot find module `transfer-fs.ts`）

- [ ] **Step 3: Write minimal implementation**

```typescript
/**
 * 传输用文件系统原语：目录、路径树扫描、分块读取、原子落盘、哈希
 */

import fs from 'node:fs/promises'
import { createReadStream, createWriteStream } from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { isSafeRelPath, resolveWithinRoot } from './transfer-protocol.ts'

export interface TreeEntry {
  relPath: string
  absPath: string
  size: number
  isDirectory: boolean
}

export async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true })
}

async function walk(rootDir: string, currentDir: string, out: TreeEntry[]): Promise<void> {
  const dirents = await fs.readdir(currentDir, { withFileTypes: true })
  for (const dirent of dirents) {
    const absPath = path.join(currentDir, dirent.name)
    if (dirent.isSymbolicLink()) continue
    if (dirent.isDirectory()) {
      await walk(rootDir, absPath, out)
      continue
    }
    if (!dirent.isFile()) continue
    const relPath = path.relative(rootDir, absPath).replace(/\\/g, '/')
    if (!isSafeRelPath(relPath)) continue
    const stat = await fs.stat(absPath)
    out.push({ relPath, absPath, size: stat.size, isDirectory: false })
  }
}

export async function scanPaths(inputs: string[]): Promise<TreeEntry[]> {
  const out: TreeEntry[] = []
  for (const input of inputs) {
    const abs = path.resolve(input)
    const stat = await fs.stat(abs)
    if (stat.isDirectory()) {
      const rootDir = path.dirname(abs)
      await walk(rootDir, abs, out)
    } else if (stat.isFile()) {
      out.push({ relPath: path.basename(abs), absPath: abs, size: stat.size, isDirectory: false })
    }
  }
  return out
}

export function sha256File(absPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    const stream = createReadStream(absPath)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

export async function readChunk(absPath: string, offset: number, length: number): Promise<Uint8Array> {
  const handle = await fs.open(absPath, 'r')
  try {
    const buffer = Buffer.alloc(length)
    const { bytesRead } = await handle.read(buffer, 0, length, offset)
    return new Uint8Array(buffer.subarray(0, bytesRead))
  } finally {
    await handle.close()
  }
}

export class PartWriter {
  readonly partPath: string
  private readonly targetPath: string
  private stream: ReturnType<typeof createWriteStream>
  private finished = false
  bytesWritten = 0

  private constructor(targetPath: string) {
    this.targetPath = targetPath
    this.partPath = `${targetPath}.doujiao.part`
    this.stream = createWriteStream(this.partPath)
  }

  static async open(targetDir: string, relPath: string): Promise<PartWriter> {
    const targetPath = resolveWithinRoot(targetDir, relPath)
    await ensureDir(path.dirname(targetPath))
    const writer = new PartWriter(targetPath)
    await new Promise<void>((resolve, reject) => {
      writer.stream.once('open', () => resolve())
      writer.stream.once('error', reject)
    })
    return writer
  }

  write(chunk: Uint8Array): Promise<void> {
    this.bytesWritten += chunk.length
    return new Promise((resolve, reject) => {
      this.stream.write(Buffer.from(chunk), (err) => (err ? reject(err) : resolve()))
    })
  }

  async finalize(): Promise<string> {
    await new Promise<void>((resolve, reject) => {
      this.stream.end((err?: Error | null) => (err ? reject(err) : resolve()))
    })
    this.finished = true
    await fs.rename(this.partPath, this.targetPath)
    return this.targetPath
  }

  async abort(): Promise<void> {
    if (!this.finished) {
      await new Promise<void>((resolve) => this.stream.close(() => resolve()))
    }
    await fs.rm(this.partPath, { force: true })
  }
}

export async function estimateFreeBytes(dir: string): Promise<number> {
  try {
    const stat = await fs.statfs(dir)
    return Number(stat.bsize) * Number(stat.bavail)
  } catch {
    return Number.MAX_SAFE_INTEGER
  }
}

export async function cleanupDir(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test apps/host/tests/remote-assist-transfer-fs.test.mjs`
Expected: PASS（5 tests）

- [ ] **Step 5: Commit**

```bash
git add apps/host/src/main/services/remote-assist/transfer/transfer-fs.ts apps/host/tests/remote-assist-transfer-fs.test.mjs
git commit -m "feat(remote-assist): add transfer filesystem primitives"
```

---

### Task 3: 剪贴板桥（`clipboard-bridge.ts`）

**Files:**
- Create: `apps/host/src/main/services/remote-assist/transfer/clipboard-bridge.ts`
- Test: `apps/host/tests/remote-assist-clipboard-bridge.test.mjs`

**Interfaces:**
- Consumes: Task 1 `sha256Hex`。
- Produces:
  - `encodeFileNameW(paths: string[]): Uint8Array`
  - `decodeFileNameW(buffer: Uint8Array): string[]`
  - `interface ClipboardBridgeOptions { clipboard?: ClipboardLike; pollIntervalMs?: number }`
  - `interface ClipboardSnapshot { kind: 'text' | 'image' | 'files'; text?: string; png?: Uint8Array; files?: string[]; hash: string }`
  - `class ClipboardBridge { read(): ClipboardSnapshot | null; writeText(text: string): void; writeImage(png: Uint8Array): void; writeFiles(paths: string[]): void; start(onChange: (snap: ClipboardSnapshot) => void): void; stop(): void; markRemoteWrite(hash: string): void }`
  - `interface ClipboardLike { readText(): string; readImage(): { toPNG(): Buffer; isEmpty(): boolean }; readBuffer(format: string): Buffer; writeText(t: string): void; writeImage(img: any): void; writeBuffer(format: string, buf: Buffer): void; createImageFromBuffer?(buf: Buffer): any }`

- [ ] **Step 1: Write the failing test**

```javascript
import test from 'node:test'
import assert from 'node:assert/strict'
import { encodeFileNameW, decodeFileNameW, ClipboardBridge } from '../src/main/services/remote-assist/transfer/clipboard-bridge.ts'

test('encodeFileNameW produces UTF-16LE null-separated list with double null', () => {
  const bytes = encodeFileNameW(['C:\\a.txt', 'C:\\b.txt'])
  const expected = Buffer.from('C:\\a.txt\0C:\\b.txt\0\0', 'ucs2')
  assert.deepEqual(Buffer.from(bytes), expected)
})

test('decodeFileNameW round-trips', () => {
  const paths = ['C:\\a.txt', 'D:\\目录\\b.txt']
  assert.deepEqual(decodeFileNameW(encodeFileNameW(paths)), paths)
})

test('ClipboardBridge suppresses echo of remotely-written content', () => {
  const text = 'remote-value'
  const fake = {
    _text: '',
    readText() { return this._text },
    readImage() { return { isEmpty: () => true, toPNG: () => Buffer.alloc(0) } },
    readBuffer() { return Buffer.alloc(0) },
    writeText(t) { this._text = t },
    writeImage() {},
    writeBuffer() {}
  }
  const bridge = new ClipboardBridge({ clipboard: fake, pollIntervalMs: 5 })
  const events = []
  bridge.start((snap) => events.push(snap))

  // 远端写入（模拟对端内容落到本机剪贴板）
  bridge.writeText(text)
  bridge.markRemoteWrite(text)

  // 模拟轮询捕获该变化
  bridge.pollOnce()
  assert.equal(events.length, 0, 'echo of remote write must be suppressed')

  // 本机新内容应被上报
  fake._text = 'local-new'
  bridge.pollOnce()
  assert.equal(events.length, 1)
  assert.equal(events[0].kind, 'text')
  assert.equal(events[0].text, 'local-new')
  bridge.stop()
})
```

> 注：为便于测试，`ClipboardBridge` 暴露 `pollOnce()`（供内部定时器调用，也供测试直接驱动）。

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test apps/host/tests/remote-assist-clipboard-bridge.test.mjs`
Expected: FAIL（Cannot find module `clipboard-bridge.ts`）

- [ ] **Step 3: Write minimal implementation**

```typescript
/**
 * 剪贴板桥：文本 / PNG 图片 / FileNameW 文件列表的读写与变化轮询（含回声抑制）
 */

import crypto from 'node:crypto'

export interface ClipboardLike {
  readText(): string
  readImage(): { isEmpty(): boolean; toPNG(): Buffer }
  readBuffer(format: string): Buffer
  writeText(text: string): void
  writeImage(image: any): void
  writeBuffer(format: string, buffer: Buffer): void
}

export interface ClipboardSnapshot {
  kind: 'text' | 'image' | 'files'
  text?: string
  png?: Uint8Array
  files?: string[]
  hash: string
}

export interface ClipboardBridgeOptions {
  clipboard?: ClipboardLike
  pollIntervalMs?: number
}

const FILENAME_W = 'FileNameW'

export function encodeFileNameW(paths: string[]): Uint8Array {
  const serialized = paths.join('\0') + '\0\0'
  return new Uint8Array(Buffer.from(serialized, 'ucs2'))
}

export function decodeFileNameW(buffer: Uint8Array): string[] {
  const buf = Buffer.from(buffer)
  if (buf.length < 2) return []
  const text = buf.toString('ucs2')
  return text.split('\0').filter((p) => p.length > 0)
}

function resolveClipboard(injected?: ClipboardLike): ClipboardLike | null {
  if (injected) return injected
  try {
    const electron = require('electron')
    return electron?.clipboard ?? null
  } catch {
    return null
  }
}

export class ClipboardBridge {
  private clipboard: ClipboardLike | null
  private pollIntervalMs: number
  private timer: any = null
  private lastHash: string | null = null
  private suppressedHashes = new Set<string>()
  private onChange: ((snap: ClipboardSnapshot) => void) | null = null

  constructor(options: ClipboardBridgeOptions = {}) {
    this.clipboard = resolveClipboard(options.clipboard)
    this.pollIntervalMs = options.pollIntervalMs ?? 700
  }

  public start(onChange: (snap: ClipboardSnapshot) => void): void {
    this.onChange = onChange
    this.lastHash = this.computeHash()
    this.stop()
    this.timer = setInterval(() => this.pollOnce(), this.pollIntervalMs)
    if (this.timer?.unref) this.timer.unref()
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    this.onChange = null
  }

  public pollOnce(): void {
    const snap = this.read()
    if (!snap) return
    if (snap.hash === this.lastHash) return
    this.lastHash = snap.hash
    if (this.suppressedHashes.has(snap.hash)) {
      return
    }
    this.onChange?.(snap)
  }

  public markRemoteWrite(content: string | Uint8Array): void {
    const hash = typeof content === 'string' ? this.hashText(content) : crypto.createHash('sha256').update(Buffer.from(content)).digest('hex')
    this.suppressedHashes.add(hash)
    if (this.suppressedHashes.size > 32) {
      const first = this.suppressedHashes.values().next().value
      if (first) this.suppressedHashes.delete(first)
    }
    this.lastHash = hash
  }

  public read(): ClipboardSnapshot | null {
    if (!this.clipboard) return null
    try {
      const files = decodeFileNameW(this.clipboard.readBuffer(FILENAME_W))
      if (files.length > 0) {
        return { kind: 'files', files, hash: crypto.createHash('sha256').update(files.join('|')).digest('hex') }
      }
      const image = this.clipboard.readImage()
      if (image && !image.isEmpty()) {
        const png = image.toPNG()
        if (png.length > 0) {
          return { kind: 'image', png: new Uint8Array(png), hash: crypto.createHash('sha256').update(png).digest('hex') }
        }
      }
      const text = this.clipboard.readText()
      if (text) {
        return { kind: 'text', text, hash: this.hashText(text) }
      }
      return null
    } catch {
      return null
    }
  }

  public writeText(text: string): void {
    this.clipboard?.writeText(text)
    this.markRemoteWrite(text)
  }

  public writeImage(png: Uint8Array): void {
    if (!this.clipboard) return
    try {
      const electron = require('electron')
      const image = electron?.nativeImage?.createFromBuffer(Buffer.from(png))
      if (image) this.clipboard.writeImage(image)
      this.markRemoteWrite(png)
    } catch {}
  }

  public writeFiles(paths: string[]): void {
    if (!this.clipboard || paths.length === 0) return
    const encoded = Buffer.from(encodeFileNameW(paths))
    this.clipboard.writeBuffer(FILENAME_W, encoded)
    this.clipboard.writeBuffer('FileName', Buffer.from(paths.join('\r\n') + '\r\n\0', 'latin1'))
    this.markRemoteWrite(paths.join('|'))
  }

  private computeHash(): string | null {
    const snap = this.read()
    return snap ? snap.hash : null
  }

  private hashText(text: string): string {
    return crypto.createHash('sha256').update(text, 'utf8').digest('hex')
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test apps/host/tests/remote-assist-clipboard-bridge.test.mjs`
Expected: PASS（3 tests）

- [ ] **Step 5: Commit**

```bash
git add apps/host/src/main/services/remote-assist/transfer/clipboard-bridge.ts apps/host/tests/remote-assist-clipboard-bridge.test.mjs
git commit -m "feat(remote-assist): add clipboard bridge with FileNameW support"
```

---

### Task 4: 传输会话核心（`transfer-session.ts`）

**Files:**
- Create: `apps/host/src/main/services/remote-assist/transfer/transfer-session.ts`
- Test: `apps/host/tests/remote-assist-transfer-session.test.mjs`

**Interfaces:**
- Consumes: Task 1 全部；Task 2 `scanPaths`/`sha256File`/`readChunk`/`PartWriter`/`ensureDir`/`estimateFreeBytes`/`cleanupDir`；Task 3 `ClipboardBridge`。
- Produces:
  - `interface FrameTransport { send(bytes: Uint8Array): void; bufferedAmount(): number; isOpen(): boolean; onFrame(cb: (bytes: Uint8Array) => void): void }`
  - `interface TransferPolicy { receiveFiles: boolean; clipboard: { text: boolean; image: boolean; file: boolean } }`
  - `interface TransferState { transferId: string; mode: TransferMode; direction: 'outgoing' | 'incoming'; entries: TransferEntry[]; totalBytes: number; transferredBytes: number; status: 'pending' | 'active' | 'done' | 'failed' | 'rejected' | 'cancelled'; message?: string }`
  - `interface TransferSessionOptions { transport: FrameTransport; receiveDir: string; stagingDir: string; clipboard?: ClipboardBridge; maxFileBytes?: number; maxImageBytes?: number }`
  - `class TransferSession { setPolicy(p: TransferPolicy): void; getPolicy(): TransferPolicy; onPolicyBroadcast(cb: (p: TransferPolicy) => void): void; onState(cb: (s: TransferState) => void): () => void; onChat(cb: (text: string) => void): () => void; onClipboardText(cb: (t: string) => void): () => void; onClipboardFiles(cb: (paths: string[]) => void): () => void; onClipboardImage(cb: (png: Uint8Array) => void): () => void; enqueueSend(paths: string[]): Promise<string>; sendChat(text: string): void; sendClipboardText(text: string): void; sendClipboardFiles(paths: string[]): Promise<string | null>; sendClipboardImage(png: Uint8Array): Promise<string | null>; cancel(transferId: string): void; list(): TransferState[]; dispose(): void }`

- [ ] **Step 1: Write the failing test**

```javascript
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { encodeJsonFrame } from '../src/main/services/remote-assist/transfer/transfer-protocol.ts'
import { TransferSession } from '../src/main/services/remote-assist/transfer/transfer-session.ts'

class LoopbackTransport {
  constructor() { this.peer = null; this.frames = []; this.callbacks = [] }
  send(bytes) { this.frames.push(bytes); this.peer?.deliver(bytes) }
  bufferedAmount() { return 0 }
  isOpen() { return true }
  onFrame(cb) { this.callbacks.push(cb) }
  deliver(bytes) { for (const cb of this.callbacks) cb(bytes) }
}

function link(a, b) { a.peer = b; b.peer = a }

async function tempDir() { return fs.mkdtemp(path.join(os.tmpdir(), 'dj-sess-')) }

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test apps/host/tests/remote-assist-transfer-session.test.mjs`
Expected: FAIL（Cannot find module `transfer-session.ts`）

- [ ] **Step 3: Write minimal implementation**

```typescript
/**
 * 会话级传输管理：队列(并发=1)、分块发送、流控、校验、取消/拒绝、聊天与剪贴板文本
 */

import crypto from 'node:crypto'
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
}

interface OutgoingJob {
  state: TransferState
  sources: TreeEntry[]
  inlineBytes?: Uint8Array
}

interface IncomingJob {
  state: TransferState
  writers: Map<number, PartWriter>
  entryIndex: number
  expectedSeq: number
  doneBytes: number
  targetRoot: string
  topLevelPaths: Set<string>
}

const MAX_FILE_BYTES_DEFAULT = 2 * 1024 * 1024 * 1024
const MAX_IMAGE_BYTES_DEFAULT = 20 * 1024 * 1024
const FLOW_HIGH = 4 * 1024 * 1024
const FLOW_LOW = 512 * 1024

export class TransferSession {
  private transport: FrameTransport
  private receiveDir: string
  private stagingDir: string
  private clipboard?: ClipboardBridge
  private maxFileBytes: number
  private maxImageBytes: number

  private policy: TransferPolicy = { receiveFiles: false, clipboard: { text: true, image: true, file: true } }
  private states = new Map<string, TransferState>()
  private outgoingQueue: OutgoingJob[] = []
  private activeOutgoing: OutgoingJob | null = null
  private incoming = new Map<string, IncomingJob>()
  private disposed = false

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
    this.clipboard = options.clipboard
    this.maxFileBytes = options.maxFileBytes ?? MAX_FILE_BYTES_DEFAULT
    this.maxImageBytes = options.maxImageBytes ?? MAX_IMAGE_BYTES_DEFAULT
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
    const clean = String(text ?? '').slice(0, 4096)
    if (!clean) return
    this.sendControl({ t: 'chat', text: clean })
  }

  public sendClipboardText(text: string): void {
    const clean = String(text ?? '').slice(0, 1024 * 1024)
    if (!clean) return
    this.sendControl({ t: 'clip-text', text: clean })
  }

  public async sendClipboardImage(png: Uint8Array): Promise<string | null> {
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
    if (paths.length === 0) return null
    return this.enqueueSend(paths, 'clipboard-file')
  }

  public async enqueueSend(paths: string[], mode: TransferMode = 'send'): Promise<string> {
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
      void this.abortIncoming(transferId, incoming, 'cancelled')
    }
    if (this.activeOutgoing && this.activeOutgoing.state.transferId === transferId) {
      this.setStatus(this.activeOutgoing.state, 'cancelled')
      this.activeOutgoing = null
      void this.pumpQueue()
    } else {
      this.outgoingQueue = this.outgoingQueue.filter((j) => j.state.transferId !== transferId)
      this.setStatus(state, 'cancelled')
    }
  }

  public dispose(): void {
    this.disposed = true
    for (const [id, job] of this.incoming) {
      void this.abortIncoming(id, job, 'disposed')
    }
    this.incoming.clear()
    this.outgoingQueue = []
    this.activeOutgoing = null
    void cleanupDir(this.stagingDir).catch(() => {})
  }

  // ---- 内部实现 ----

  private async enqueueTransfer(mode: TransferMode, files: TreeEntry[], extras?: { inlineData?: Uint8Array }): Promise<string> {
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
    this.outgoingQueue.push({ state, sources: files, inlineBytes: extras?.inlineData })
    this.sendControl({ t: 'transfer-offer', transferId, mode, totalBytes, entries })
    void this.pumpQueue()
    return transferId
  }

  private async pumpQueue(): Promise<void> {
    if (this.activeOutgoing || this.disposed) return
    const job = this.outgoingQueue.shift()
    if (!job) return
    this.activeOutgoing = job
    this.setStatus(job.state, 'active')
    try {
      await this.flowChunks(job)
    } catch (err: any) {
      this.setStatus(job.state, 'failed', err?.message)
    } finally {
      this.activeOutgoing = null
      void this.pumpQueue()
    }
  }

  private async flowChunks(job: OutgoingJob): Promise<void> {
    for (let entryIndex = 0; entryIndex < job.state.entries.length; entryIndex++) {
      const entry = job.state.entries[entryIndex]
      const source = job.sources[entryIndex]
      let seq = 0
      for (let offset = 0; offset < entry.size; offset += CHUNK_SIZE) {
        if (job.state.status === 'cancelled') return
        const length = Math.min(CHUNK_SIZE, entry.size - offset)
        const chunk = job.inlineBytes
          ? job.inlineBytes.subarray(offset, offset + length)
          : await readChunk(source.absPath, offset, length)
        await this.waitForCapacity()
        this.transport.send(encodeBinaryFrame({ transferId: job.state.transferId, entryIndex, seq, len: chunk.length }, chunk))
        job.state.transferredBytes += chunk.length
        this.emitState(job.state)
        seq++
      }
    }
    this.sendControl({ t: 'transfer-complete', transferId: job.state.transferId })
  }

  private async waitForCapacity(): Promise<void> {
    while (this.transport.bufferedAmount() > FLOW_HIGH && this.transport.isOpen()) {
      await new Promise((r) => setTimeout(r, 10))
    }
  }

  private sendControl(frame: ControlFrame): void {
    if (!this.transport.isOpen()) return
    this.transport.send(encodeJsonFrame(frame))
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
        for (const cb of this.chatListeners) cb(frame.text)
        break
      case 'clip-text':
        for (const cb of this.clipTextListeners) cb(frame.text)
        break
      case 'transfer-offer':
        void this.handleOffer(frame)
        break
      case 'transfer-accept':
        // 发送侧在收到 accept 后已可继续（本实现逐块即发，accept 仅用于状态）
        break
      case 'transfer-reject': {
        const state = this.states.get(frame.transferId)
        if (state) this.setStatus(state, 'rejected', frame.reason)
        if (this.activeOutgoing?.state.transferId === frame.transferId) this.activeOutgoing = null
        break
      }
      case 'transfer-cancel': {
        const incoming = this.incoming.get(frame.transferId)
        if (incoming) void this.abortIncoming(frame.transferId, incoming, frame.reason)
        const state = this.states.get(frame.transferId)
        if (state) this.setStatus(state, 'cancelled', frame.reason)
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
    if (total > this.maxFileBytes) {
      this.sendControl({ t: 'transfer-reject', transferId: frame.transferId, reason: 'too-large' })
      this.setStatus(state, 'rejected', 'too-large')
      return
    }
    const targetRoot = frame.mode === 'send'
      ? this.receiveDir
      : path.join(this.stagingDir, frame.transferId)
    await ensureDir(targetRoot)
    const free = await estimateFreeBytes(targetRoot)
    if (free < total * 1.1) {
      this.sendControl({ t: 'transfer-reject', transferId: frame.transferId, reason: 'disk' })
      this.setStatus(state, 'rejected', 'disk')
      return
    }

    this.incoming.set(frame.transferId, {
      state,
      writers: new Map(),
      entryIndex: 0,
      expectedSeq: 0,
      doneBytes: 0,
      targetRoot,
      topLevelPaths: new Set()
    })
    this.sendControl({ t: 'transfer-accept', transferId: frame.transferId })
    this.setStatus(state, 'active')
  }

  private handleBinary(header: { transferId: string; entryIndex: number; seq: number; len: number }, payload: Uint8Array): void {
    const job = this.incoming.get(header.transferId)
    if (!job) return
    if (header.entryIndex !== job.entryIndex || header.seq !== job.expectedSeq) {
      this.sendControl({ t: 'transfer-cancel', transferId: header.transferId, reason: 'sequence-error' })
      void this.abortIncoming(header.transferId, job, 'sequence-error')
      return
    }
    void this.writeChunk(job, header.entryIndex, payload)
  }

  private async writeChunk(job: IncomingJob, entryIndex: number, payload: Uint8Array): Promise<void> {
    const entry = job.state.entries[entryIndex]
    let writer = job.writers.get(entryIndex)
    if (!writer) {
      writer = await PartWriter.open(job.targetRoot, entry.relPath)
      job.writers.set(entryIndex, writer)
      const top = entry.relPath.split('/')[0]
      job.topLevelPaths.add(path.join(job.targetRoot, top))
    }
    await writer.write(payload)
    job.state.transferredBytes += payload.length
    job.doneBytes += payload.length
    job.expectedSeq += 1
    this.emitState(job.state)
  }

  private async completeIncoming(transferId: string): Promise<void> {
    const job = this.incoming.get(transferId)
    if (!job) return
    try {
      for (const [entryIndex, writer] of job.writers) {
        const entry = job.state.entries[entryIndex]
        const finalPath = await writer.finalize()
        const actual = await sha256File(finalPath)
        if (actual !== entry.sha256) {
          this.sendControl({ t: 'transfer-result', transferId, ok: false, message: `checksum mismatch: ${entry.relPath}` })
          this.setStatus(job.state, 'failed', 'checksum')
          this.incoming.delete(transferId)
          return
        }
      }
      // 完成后的模式特定动作
      if (job.state.mode === 'clipboard-file') {
        for (const cb of this.clipFilesListeners) cb(Array.from(job.topLevelPaths))
      } else if (job.state.mode === 'clipboard-image') {
        const firstEntry = job.state.entries[0]
        const pngPath = path.join(job.targetRoot, firstEntry.relPath)
        const fsmod = await import('node:fs/promises')
        const png = new Uint8Array(await fsmod.readFile(pngPath))
        for (const cb of this.clipImageListeners) cb(png)
      }
      this.sendControl({ t: 'transfer-result', transferId, ok: true })
      this.setStatus(job.state, 'done')
    } catch (err: any) {
      this.sendControl({ t: 'transfer-result', transferId, ok: false, message: err?.message })
      this.setStatus(job.state, 'failed', err?.message)
    } finally {
      this.incoming.delete(transferId)
    }
  }

  private async abortIncoming(transferId: string, job: IncomingJob, reason: string): Promise<void> {
    for (const writer of job.writers.values()) {
      await writer.abort().catch(() => {})
    }
    await cleanupDir(job.targetRoot).catch(() => {})
    this.incoming.delete(transferId)
    this.setStatus(job.state, 'cancelled', reason)
  }

  private setStatus(state: TransferState, status: TransferStatus, message?: string): void {
    state.status = status
    if (message !== undefined) state.message = message
    this.emitState(state)
  }

  private emitState(state: TransferState): void {
    for (const cb of this.stateListeners) cb({ ...state, entries: state.entries })
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test apps/host/tests/remote-assist-transfer-session.test.mjs`
Expected: PASS（3 tests）

- [ ] **Step 5: Commit**

```bash
git add apps/host/src/main/services/remote-assist/transfer/transfer-session.ts apps/host/tests/remote-assist-transfer-session.test.mjs
git commit -m "feat(remote-assist): add transfer session core with flow control"
```

---

### Task 5: 传输门面与会话生命周期（`transfer-service.ts`）

**Files:**
- Create: `apps/host/src/main/services/remote-assist/transfer/transfer-service.ts`
- Test: `apps/host/tests/remote-assist-transfer-session.test.mjs`（追加 `TransferService` 用例）

**Interfaces:**
- Consumes: Task 4 `TransferSession`、`TransferPolicy`、`TransferState`；Task 3 `ClipboardBridge`；Task 2 `cleanupDir`/`ensureDir`。
- Produces:
  - `interface TransferServiceOptions { receiveDir?: string; stagingRoot?: string }`
  - `class TransferService { getSettings(): TransferSettings; setReceiveDir(dir: string): void; setPolicy(policy: TransferPolicy): void; getPolicy(): TransferPolicy; attach(transport: FrameTransport, sessionId: string): TransferSession; detach(): void; getSession(): TransferSession | null; onEvent(cb: (e: TransferEvent) => void): () => void; sendPaths(paths: string[]): Promise<string>; cancel(id: string): void; openReceiveFolder(): Promise<void> }`
  - `interface TransferSettings { receiveDir: string; policy: TransferPolicy }`
  - `type TransferEvent = { type: 'transfer-state'; state: TransferState } | { type: 'transfer-chat'; text: string } | { type: 'clipboard-applied'; kind: 'text' | 'image' | 'files' }`

- [ ] **Step 1: Write the failing test**（追加到 `remote-assist-transfer-session.test.mjs`）

```javascript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test apps/host/tests/remote-assist-transfer-session.test.mjs`
Expected: FAIL（Cannot find module `transfer-service.ts`）

- [ ] **Step 3: Write minimal implementation**

```typescript
/**
 * 传输门面：持有设置与策略、绑定/解绑会话、向 IPC 与会话窗口暴露统一入口
 */

import path from 'node:path'
import { cleanupDir, ensureDir } from './transfer-fs.ts'
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
  private policy: TransferPolicy = { receiveFiles: false, clipboard: { text: true, image: true, file: true } }
  private clipboard: ClipboardBridge
  private session: TransferSession | null = null
  private listeners = new Set<(e: TransferEvent) => void>()

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

  public attach(transport: FrameTransport, sessionId: string): TransferSession {
    this.detach()
    const session = new TransferSession({
      transport,
      receiveDir: this.receiveDir,
      stagingDir: path.join(this.stagingRoot, sessionId),
      clipboard: this.clipboard
    })
    session.setPolicy(this.policy)
    session.onState((state) => this.emit({ type: 'transfer-state', state }))
    session.onChat((text) => this.emit({ type: 'transfer-chat', text }))
    session.onClipboardText((text) => {
      this.clipboard.writeText(text)
      this.emit({ type: 'clipboard-applied', kind: 'text' })
    })
    session.onClipboardFiles((paths) => {
      this.clipboard.writeFiles(paths)
      this.emit({ type: 'clipboard-applied', kind: 'files' })
    })
    session.onClipboardImage((png) => {
      this.clipboard.writeImage(png)
      this.emit({ type: 'clipboard-applied', kind: 'image' })
    })
    this.session = session
    this.startClipboardWatcher(session)
    return session
  }

  public detach(): void {
    this.clipboard.stop()
    if (this.session) {
      this.session.dispose()
      this.session = null
    }
    void cleanupDir(this.stagingRoot).catch(() => {})
  }

  public getSession(): TransferSession | null {
    return this.session
  }

  public async sendPaths(paths: string[]): Promise<string> {
    if (!this.session) throw new Error('no active transfer session')
    await ensureDir(this.receiveDir)
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
      const policy = this.policy
      if (snap.kind === 'text' && policy.clipboard.text && snap.text) {
        session.sendClipboardText(snap.text)
      } else if (snap.kind === 'image' && policy.clipboard.image && snap.png) {
        void session.sendClipboardImage(snap.png)
      } else if (snap.kind === 'files' && policy.clipboard.file && snap.files) {
        void session.sendClipboardFiles(snap.files)
      }
    })
  }

  private emit(event: TransferEvent): void {
    for (const cb of this.listeners) cb(event)
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test apps/host/tests/remote-assist-transfer-session.test.mjs`
Expected: PASS（4 tests）

- [ ] **Step 5: Commit**

```bash
git add apps/host/src/main/services/remote-assist/transfer/transfer-service.ts apps/host/tests/remote-assist-transfer-session.test.mjs
git commit -m "feat(remote-assist): add transfer service facade"
```

---

### Task 6: SDK 能力与类型

**Files:**
- Modify: `packages/plugin-sdk/src/types.ts`
- Modify: `plugins/remote-assist/manifest.json`
- Test: `plugins/remote-assist/tests/remote-assist-plugin.test.mjs`（追加断言）

**Interfaces:**
- Consumes: 无。
- Produces: capability `'remote.file.transfer' | 'remote.clipboard.sync'`；事件类型 `'transfer-state' | 'transfer-chat' | 'clipboard-applied'`；`RemoteAssistApi` 新方法签名。

- [ ] **Step 1: Write the failing test**（追加到 `plugins/remote-assist/tests/remote-assist-plugin.test.mjs`）

```javascript
test('manifest declares file transfer and clipboard sync capabilities', async () => {
  const manifest = JSON.parse(await read('../manifest.json'))
  const caps = manifest.permissions.map((p) => p.capability)
  assert.ok(caps.includes('remote.file.transfer'))
  assert.ok(caps.includes('remote.clipboard.sync'))
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test plugins/remote-assist/tests/remote-assist-plugin.test.mjs`
Expected: FAIL（未包含 `remote.file.transfer`）

- [ ] **Step 3: Write minimal implementation**

`packages/plugin-sdk/src/types.ts` — 扩展 capability 联合与接口：

```typescript
export interface RemoteFileTransferCapability {
  capability: 'remote.file.transfer';
}

export interface RemoteClipboardSyncCapability {
  capability: 'remote.clipboard.sync';
}

export interface RemoteAssistCapability {
  capability: 'remote.desktop.view' | 'remote.desktop.control';
}
```

在 `PluginCapability` 联合中加入 `RemoteFileTransferCapability | RemoteClipboardSyncCapability`；在 `RemoteAssistEvent` 联合中加入：

```typescript
  | { type: 'transfer-state'; state: { transferId: string; mode: 'send' | 'clipboard-file' | 'clipboard-image'; direction: 'outgoing' | 'incoming'; totalBytes: number; transferredBytes: number; status: string; message?: string } }
  | { type: 'transfer-chat'; text: string }
  | { type: 'clipboard-applied'; kind: 'text' | 'image' | 'files' }
```

`RemoteAssistApi` 新增：

```typescript
  transfer?: {
    getSettings(): Promise<{ receiveDir: string; policy: { receiveFiles: boolean; clipboard: { text: boolean; image: boolean; file: boolean } } }>;
    setReceiveDir(dir: string): Promise<boolean>;
    setPolicy(policy: { receiveFiles: boolean; clipboard: { text: boolean; image: boolean; file: boolean } }): Promise<boolean>;
    sendPaths(paths: string[]): Promise<string>;
    chooseAndSend(): Promise<string | null>;
    cancel(transferId: string): Promise<boolean>;
    openReceiveFolder(): Promise<boolean>;
    sendChat(text: string): Promise<boolean>;
  };
```

`plugins/remote-assist/manifest.json` — `permissions` 增加：

```json
    {
      "capability": "remote.file.transfer"
    },
    {
      "capability": "remote.clipboard.sync"
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test plugins/remote-assist/tests/remote-assist-plugin.test.mjs`
Expected: PASS（4 tests）

- [ ] **Step 5: Commit**

```bash
git add packages/plugin-sdk/src/types.ts plugins/remote-assist/manifest.json plugins/remote-assist/tests/remote-assist-plugin.test.mjs
git commit -m "feat(remote-assist): add file transfer and clipboard sync capabilities"
```

---

### Task 7: 宿主 IPC 与 preload 扩展

**Files:**
- Modify: `apps/host/src/main/ipc/bridge.ts`
- Modify: `apps/host/src/preload/plugin.ts`
- Modify: `apps/host/src/preload/remote-assist-session.ts`
- Test: `apps/host/tests/remote-assist-transfer-session.test.mjs`（追加 bridge 能力校验的源码断言）

**Interfaces:**
- Consumes: Task 5 `TransferService`；既有 `checkRemoteAssistPermission`、`RemoteAssistService`。
- Produces: IPC 通道 `plugin:remote-assist:transfer:*`；插件 SDK `remoteAssist.transfer.*`；会话窗口 preload API `transfer.{...}`。

- [ ] **Step 1: Write the failing test**（追加到 `remote-assist-transfer-session.test.mjs`）

```javascript
test('bridge exposes transfer IPC guarded by the new capabilities', async () => {
  const source = await fs.readFile(new URL('../src/main/ipc/bridge.ts', import.meta.url), 'utf8')
  assert.match(source, /plugin:remote-assist:transfer:send-paths/)
  assert.match(source, /plugin:remote-assist:transfer:set-policy/)
  assert.match(source, /remote\.file\.transfer/)
  assert.match(source, /remote\.clipboard\.sync/)
  const preload = await fs.readFile(new URL('../src/preload/remote-assist-session.ts', import.meta.url), 'utf8')
  assert.match(preload, /transfer:/)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test apps/host/tests/remote-assist-transfer-session.test.mjs`
Expected: FAIL（bridge 尚无 transfer IPC）

- [ ] **Step 3: Write minimal implementation**

`apps/host/src/main/ipc/bridge.ts` — 在 `checkRemoteAssistPermission` 附近新增能力校验并注册 IPC（放在文件末尾 `}` 之前）：

```typescript
  const checkRemoteTransferPermission = async (senderId: number, capability: 'remote.file.transfer' | 'remote.clipboard.sync'): Promise<string> => {
    const pluginId = containerManager.getPluginIdByWebContentsId(senderId)
    if (!pluginId) throw new Error('[Security] 未经授权的调用来源：非沙箱插件容器')
    const { PluginManager } = await import('../plugins/plugin-manager')
    const plugin = PluginManager.getInstance().getPlugin(pluginId)
    const hasPermission = plugin?.manifest?.permissions?.some((p: any) => p.capability === capability)
    if (!hasPermission) throw new Error(`[Security] 插件 ${pluginId} 未声明 ${capability} 权限，拒绝调用`)
    return pluginId
  }

  // 传输与剪贴板事件转发到插件页
  const transferListeners = new Set<Electron.WebContents>()
  ;(async () => {
    const { TransferService } = await import('../services/remote-assist/transfer/transfer-service')
    TransferService.getInstance().onEvent((transferEvent) => {
      for (const wc of transferListeners) {
        if (!wc.isDestroyed()) wc.send('plugin:remote-assist:event', transferEvent)
        else transferListeners.delete(wc)
      }
    })
  })().catch(console.error)

  ipcMain.handle('plugin:remote-assist:transfer:get-settings', async (event) => {
    await checkRemoteTransferPermission(event.sender.id, 'remote.file.transfer')
    transferListeners.add(event.sender)
    const { TransferService } = await import('../services/remote-assist/transfer/transfer-service')
    return TransferService.getInstance().getSettings()
  })

  ipcMain.handle('plugin:remote-assist:transfer:set-receive-dir', async (event, dir: string) => {
    await checkRemoteTransferPermission(event.sender.id, 'remote.file.transfer')
    const { TransferService } = await import('../services/remote-assist/transfer/transfer-service')
    TransferService.getInstance().setReceiveDir(dir)
    return true
  })

  ipcMain.handle('plugin:remote-assist:transfer:set-policy', async (event, policy: any) => {
    await checkRemoteTransferPermission(event.sender.id, 'remote.clipboard.sync')
    const { TransferService } = await import('../services/remote-assist/transfer/transfer-service')
    TransferService.getInstance().setPolicy(policy)
    return true
  })

  ipcMain.handle('plugin:remote-assist:transfer:choose-and-send', async (event) => {
    const pluginId = await checkRemoteTransferPermission(event.sender.id, 'remote.file.transfer')
    const { dialog } = await import('electron')
    const { BrowserWindow } = await import('electron')
    const win = BrowserWindow.fromWebContents(event.sender)
    const result = await dialog.showOpenDialog(win ?? undefined as any, {
      title: '选择要发送的文件或文件夹',
      properties: ['openFile', 'openDirectory', 'multiSelections']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const { TransferService } = await import('../services/remote-assist/transfer/transfer-service')
    return TransferService.getInstance().sendPaths(result.filePaths)
  })

  ipcMain.handle('plugin:remote-assist:transfer:send-paths', async (event, paths: string[]) => {
    await checkRemoteTransferPermission(event.sender.id, 'remote.file.transfer')
    const { TransferService } = await import('../services/remote-assist/transfer/transfer-service')
    return TransferService.getInstance().sendPaths(paths)
  })

  ipcMain.handle('plugin:remote-assist:transfer:cancel', async (event, transferId: string) => {
    await checkRemoteTransferPermission(event.sender.id, 'remote.file.transfer')
    const { TransferService } = await import('../services/remote-assist/transfer/transfer-service')
    TransferService.getInstance().cancel(transferId)
    return true
  })

  ipcMain.handle('plugin:remote-assist:transfer:open-receive-folder', async (event) => {
    await checkRemoteTransferPermission(event.sender.id, 'remote.file.transfer')
    const { TransferService } = await import('../services/remote-assist/transfer/transfer-service')
    await TransferService.getInstance().openReceiveFolder()
    return true
  })
```

`TransferService` 需加单例静态方法（在 Task 5 文件中补充）：

```typescript
  private static instance: TransferService | null = null

  public static getInstance(): TransferService {
    if (!TransferService.instance) {
      TransferService.instance = new TransferService()
    }
    return TransferService.instance
  }
```

`apps/host/src/preload/plugin.ts` — 在既有 `remoteAssist: { ... }` 对象内追加 `transfer` 映射（插件页通过 `sdk.remoteAssist.transfer` 调用）：

```typescript
    transfer: {
      getSettings: () => ipcRenderer.invoke('plugin:remote-assist:transfer:get-settings'),
      setReceiveDir: (dir: string) => ipcRenderer.invoke('plugin:remote-assist:transfer:set-receive-dir', dir),
      setPolicy: (policy: any) => ipcRenderer.invoke('plugin:remote-assist:transfer:set-policy', policy),
      sendPaths: (paths: string[]) => ipcRenderer.invoke('plugin:remote-assist:transfer:send-paths', paths),
      chooseAndSend: () => ipcRenderer.invoke('plugin:remote-assist:transfer:choose-and-send'),
      cancel: (transferId: string) => ipcRenderer.invoke('plugin:remote-assist:transfer:cancel', transferId),
      openReceiveFolder: () => ipcRenderer.invoke('plugin:remote-assist:transfer:open-receive-folder'),
      sendChat: (text: string) => ipcRenderer.invoke('plugin:remote-assist:transfer:send-chat', text)
    },
```

并在 `bridge.ts` 补齐 `send-chat` 处理器：

```typescript
  ipcMain.handle('plugin:remote-assist:transfer:send-chat', async (event, text: string) => {
    await checkRemoteTransferPermission(event.sender.id, 'remote.file.transfer')
    const { TransferService } = await import('../services/remote-assist/transfer/transfer-service')
    TransferService.getInstance().getSession()?.sendChat(text)
    return true
  })
```

`apps/host/src/preload/remote-assist-session.ts` — 在 `sessionApi` 内新增（并随既有 `contextBridge.exposeInMainWorld('remoteAssistSession', sessionApi)` 一起暴露）。这是会话窗口渲染进程与主进程之间的**帧桥** API：

```typescript
  transfer: {
    // 主进程 -> 渲染进程：把要发送到对端的帧交给 DataChannel
    onOutgoingChunk: (cb: (bytes: Uint8Array) => void) => {
      const handler = (_: any, bytes: Uint8Array) => cb(new Uint8Array(bytes))
      ipcRenderer.on('remote-assist:transfer:outgoing-chunk', handler)
      return () => ipcRenderer.removeListener('remote-assist:transfer:outgoing-chunk', handler)
    },
    // 渲染进程 -> 主进程：DataChannel 收到的帧回传
    sendIncomingChunk: (bytes: Uint8Array) => ipcRenderer.send('remote-assist:transfer:incoming-chunk', bytes),
    // 通道就绪/关闭与背压上报
    notifyReady: () => ipcRenderer.send('remote-assist:transfer:ready'),
    notifyClosed: () => ipcRenderer.send('remote-assist:transfer:closed'),
    reportBackpressure: (bufferedAmount: number) => ipcRenderer.send('remote-assist:transfer:backpressure', bufferedAmount),
    // UI 事件
    onState: (cb: (state: any) => void) => {
      const handler = (_: any, state: any) => cb(state)
      ipcRenderer.on('remote-assist:transfer:state', handler)
      return () => ipcRenderer.removeListener('remote-assist:transfer:state', handler)
    },
    onChat: (cb: (text: string) => void) => {
      const handler = (_: any, text: string) => cb(text)
      ipcRenderer.on('remote-assist:transfer:chat', handler)
      return () => ipcRenderer.removeListener('remote-assist:transfer:chat', handler)
    },
    sendChat: (text: string) => ipcRenderer.send('remote-assist:transfer:chat-from-window', text)
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test apps/host/tests/remote-assist-transfer-session.test.mjs`
Expected: PASS（5 tests）

- [ ] **Step 5: Commit**

```bash
git add apps/host/src/main/ipc/bridge.ts apps/host/src/preload/plugin.ts apps/host/src/preload/remote-assist-session.ts apps/host/src/main/services/remote-assist/transfer/transfer-service.ts apps/host/tests/remote-assist-transfer-session.test.mjs
git commit -m "feat(remote-assist): wire transfer IPC and preload bridges"
```

---

### Task 8: 会话窗口 `doujiao-data` 通道与传输/聊天面板

**Files:**
- Modify: `apps/host/src/main/container/remote-assist-session-window.ts`
- Test: `apps/host/tests/remote-assist-session-window.test.mjs`（追加断言）

**Interfaces:**
- Consumes: Task 5 `TransferService`；Task 4 `TransferSession`（通过 IPC 主进程桥接）。
- Produces: 渲染进程内的 `doujiao-data` 通道；`window.remoteAssistSession.transfer` 使用。

- [ ] **Step 1: Write the failing test**（追加到 `remote-assist-session-window.test.mjs`）

```javascript
test('session window wires the doujiao-data channel and transfer/chat panels', async () => {
  const source = await read('../src/main/container/remote-assist-session-window.ts')
  assert.match(source, /doujiao-data/)
  assert.match(source, /transferPanel/)
  assert.match(source, /chatPanel/)
  assert.match(source, /FrameTransport|createDataChannelTransport/)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test apps/host/tests/remote-assist-session-window.test.mjs`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

在 `initWebRTC()` 控制端分支中，创建第二条通道：

```javascript
        dataChannel = pc.createDataChannel('doujiao-input', { ordered: true });
        dataChannel.onopen = () => {
          console.log('[WebRTC] 控制端 DataChannel 打开');
          notifyConnected();
          sendQuality(desiredQuality);
        };

        // 新增：传输/聊天数据通道
        dataDataChannel = pc.createDataChannel('doujiao-data', { ordered: true });
        wireDataChannel(dataDataChannel);
```

受控端分支的 `pc.ondatachannel` 按 `label` 分流：

```javascript
        pc.ondatachannel = (event) => {
          const channel = event.channel;
          if (channel.label === 'doujiao-data') {
            dataDataChannel = channel;
            wireDataChannel(channel);
            return;
          }
          // 既有 doujiao-input 处理（键鼠 / 画质）保持不变
          channel.onopen = () => { console.log('[WebRTC] 受控端 DataChannel 打开'); notifyConnected(); };
          channel.onmessage = (msg) => { /* 既有逻辑保持不变 */ };
        };
```

顶部声明新增 `let dataDataChannel = null;`，并新增帧桥接线（双向 + 背压 + 状态，使用 Task 7 的 preload API）：

```javascript
    function wireDataChannel(channel) {
      channel.binaryType = 'arraybuffer';
      channel.onopen = () => window.remoteAssistSession.transfer.notifyReady();
      channel.onclose = () => window.remoteAssistSession.transfer.notifyClosed();
      channel.onmessage = (event) => {
        window.remoteAssistSession.transfer.sendIncomingChunk(new Uint8Array(event.data));
      };
      window.remoteAssistSession.transfer.onOutgoingChunk((bytes) => {
        if (channel.readyState === 'open') {
          channel.send(bytes);
          window.remoteAssistSession.transfer.reportBackpressure(channel.bufferedAmount);
        }
      });
    }
```

在标题栏下方新增面板（仅控制端显示）：

```html
  <div class="transfer-panel" id="transferPanel" style="display:${isController ? 'flex' : 'none'};gap:8px;align-items:center;padding:6px 12px;background:#1e293b;border-bottom:1px solid #334155;">
    <button class="btn-disconnect" id="sendFilesBtn" style="background:#334155;">发送文件</button>
    <span id="transferStatus" style="font-size:12px;color:#94a3b8;">就绪</span>
    <button class="btn-disconnect" id="openFolderBtn" style="background:#334155;">打开接收文件夹</button>
  </div>
  <div class="chat-panel" id="chatPanel" style="display:flex;gap:6px;align-items:center;height:32px;padding:0 12px;background:#0f172a;border-bottom:1px solid #334155;">
    <div id="chatLog" style="flex:1;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-size:12px;"></div>
    <input id="chatInput" placeholder="输入消息后回车" style="width:220px;background:#020617;color:#f8fafc;border:1px solid #334155;border-radius:4px;padding:3px 6px;font-size:12px;" />
  </div>
```

面板交互（`setupControllerInput()` 内，添加到既有 disconnect/quality/fullscreen 绑定之后）：

```javascript
      const sendFilesBtn = document.getElementById('sendFilesBtn');
      if (sendFilesBtn) {
        sendFilesBtn.addEventListener('click', () => window.remoteAssistSession.transfer.requestSendFiles());
      }
      const openFolderBtn = document.getElementById('openFolderBtn');
      if (openFolderBtn) {
        openFolderBtn.addEventListener('click', () => window.remoteAssistSession.transfer.openReceiveFolder());
      }
      const chatInput = document.getElementById('chatInput');
      const chatLog = document.getElementById('chatLog');
      if (chatInput) {
        chatInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && chatInput.value.trim()) {
            window.remoteAssistSession.transfer.sendChat(chatInput.value.trim());
            appendChat('我: ' + chatInput.value.trim());
            chatInput.value = '';
          }
        });
      }
      window.remoteAssistSession.transfer.onState((state) => {
        const status = document.getElementById('transferStatus');
        if (status) {
          status.textContent = `${state.direction === 'outgoing' ? '发送' : '接收'} ${state.transferredBytes}/${state.totalBytes} · ${state.status}`;
        }
      });
      window.remoteAssistSession.transfer.onChat((text) => appendChat('对方: ' + text));
      function appendChat(line) {
        if (!chatLog) return;
        chatLog.textContent = line;
        chatLog.title = line;
      }
```

**主进程侧（`remote-assist-session-window.ts`）** — 新增 `FrameTransport` 实现与 IPC 绑定：

在文件顶部导入：

```typescript
import { TransferService } from '../services/remote-assist/transfer/transfer-service.ts'
import type { TransferSession, FrameTransport } from '../services/remote-assist/transfer/transfer-session.ts'
```

在类外新增：

```typescript
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
}
```

类字段新增：`private transferTransport: RendererFrameTransport | null = null`、`private transferSession: TransferSession | null = null`、`private unsubTransfer: (() => void) | null = null`。

在 `setupIpc()` 中，`bind(...)` 定义之后新增：

```typescript
    const transport = new RendererFrameTransport(() => this.window)
    this.transferTransport = transport

    bind('remote-assist:transfer:ready', () => {
      transport.notifyReady()
      this.transferSession = TransferService.getInstance().attach(transport, this.options.sessionId)
    })
    bind('remote-assist:transfer:closed', () => transport.notifyClosed())
    bind('remote-assist:transfer:incoming-chunk', (_event, bytes: Uint8Array) => transport.dispatch(new Uint8Array(bytes)))
    bind('remote-assist:transfer:backpressure', (_event, n: number) => transport.updateBuffered(n))
    bind('remote-assist:transfer:chat-from-window', (_event, text: string) => this.transferSession?.sendChat(text))
    bind('remote-assist:transfer:request-send', () => {
      const win = this.window
      if (!win || win.isDestroyed()) return
      win.webContents.send('host:transfer:pick-files')
    })
    bind('remote-assist:transfer:send-paths', (_event, paths: string[]) => {
      void TransferService.getInstance().sendPaths(paths).catch((err) => {
        console.warn('[RemoteAssistSessionWindow] 发送文件失败:', err)
      })
    })

    this.unsubTransfer = TransferService.getInstance().onEvent((event) => {
      const win = this.window
      if (!win || win.isDestroyed()) return
      if (event.type === 'transfer-state') win.webContents.send('remote-assist:transfer:state', event.state)
      else if (event.type === 'transfer-chat') win.webContents.send('remote-assist:transfer:chat', event.text)
    })
```

在 `destroy()` 中，`ipcOnBindings` 解绑之后新增：

```typescript
    if (this.unsubTransfer) {
      this.unsubTransfer()
      this.unsubTransfer = null
    }
    if (this.transferSession) {
      TransferService.getInstance().detach()
      this.transferSession = null
    }
    this.transferTransport = null
```

`preload` 侧再补三个方法（追加到 Task 7 的 `transfer` 对象）：

```typescript
    requestSendFiles: () => ipcRenderer.send('remote-assist:transfer:request-send'),
    openReceiveFolder: () => ipcRenderer.invoke('plugin:remote-assist:transfer:open-receive-folder'),
    // 主进程选中文件后回传路径，由窗口脚本再次发起
    onPickResult: (cb: (paths: string[]) => void) => {
      const handler = (_: any, paths: string[]) => cb(paths)
      ipcRenderer.on('host:transfer:pick-files', handler)
      return () => ipcRenderer.removeListener('host:transfer:pick-files', handler)
    },
```

> 说明：`requestSendFiles` 走主进程 `dialog`，选好后由窗口脚本调用 `sendPaths`。简化实现：主进程 `bind('remote-assist:transfer:request-send')` 直接弹出 `dialog.showOpenDialog`，选好后调用 `TransferService.getInstance().sendPaths(paths)`，无需回传渲染进程。上述 `onPickResult` 为可选的 UI 反馈通道，可按需保留或删除。

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test apps/host/tests/remote-assist-session-window.test.mjs`
Expected: PASS（含新断言；既有语法解析测试仍需通过）

- [ ] **Step 5: Commit**

```bash
git add apps/host/src/main/container/remote-assist-session-window.ts apps/host/src/preload/remote-assist-session.ts apps/host/tests/remote-assist-session-window.test.mjs
git commit -m "feat(remote-assist): add doujiao-data channel and transfer/chat panels"
```

---

### Task 9: 插件页设置与历史面板

**Files:**
- Modify: `plugins/remote-assist/src/App.tsx`
- Modify: `plugins/remote-assist/src/index.css`
- Test: `plugins/remote-assist/tests/remote-assist-plugin.test.mjs`（追加断言）

**Interfaces:**
- Consumes: Task 6 `RemoteAssistApi.transfer`；Task 7 事件 `transfer-state`/`transfer-chat`/`clipboard-applied`。
- Produces: 插件页 UI。

- [ ] **Step 1: Write the failing test**（追加）

```javascript
test('plugin UI exposes receive settings, clipboard toggles and transfer history', async () => {
  const app = await read('../src/App.tsx')
  assert.match(app, /是否允许接收文件/)
  assert.match(app, /剪贴板同步/)
  assert.match(app, /传输历史|传输记录/)
  assert.match(app, /sdk\.remoteAssist\.transfer/)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test plugins/remote-assist/tests/remote-assist-plugin.test.mjs`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

在 `App.tsx` 中新增状态与事件处理：`transferPolicy`（receiveFiles + 三类剪贴板开关）、`receiveDir`、`transfers`（列表）、`chats`。`onEvent` 中处理 `transfer-state`（更新列表）、`transfer-chat`（追加）、`clipboard-applied`（提示"已应用剪贴板"）。渲染一个「传输与共享」卡片：

- 复选框「是否允许接收文件」（默认取 `getSettings().policy.receiveFiles`）；
- 三个开关「剪贴板同步：文本 / 图片 / 文件」（默认开）；
- 只读显示接收目录 + 「更改目录」（调用 `dialog` 由宿主提供，或允许手填路径后 `setReceiveDir`）+ 「打开接收文件夹」；
- 传输列表：文件名、方向、进度条、状态、取消按钮；
- 「发送文件」按钮（`chooseAndSend`，需在宿主 bridge 增加 `plugin:remote-assist:transfer:choose-and-send`，用 `dialog.showOpenDialog` 选路径后 `sendPaths`）。

`index.css` 增加 `.transfer-list`、`.transfer-item`、`.progress-bar`、`.switch-row` 的基础样式，暗/亮主题各一套。

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test plugins/remote-assist/tests/remote-assist-plugin.test.mjs`
Expected: PASS（5 tests）

- [ ] **Step 5: Commit**

```bash
git add plugins/remote-assist/src/App.tsx plugins/remote-assist/src/index.css plugins/remote-assist/tests/remote-assist-plugin.test.mjs
git commit -m "feat(remote-assist): add transfer settings and history panel"
```

---

### Task 10: 端到端集成测试与文档

**Files:**
- Create: `apps/host/tests/remote-assist-transfer-integration.test.mjs`
- Modify: `docs/remote-assistance-security.md`

**Interfaces:**
- Consumes: Task 4 `TransferSession`；Task 2 `PartWriter` 等。
- Produces: 集成回归与文档。

- [ ] **Step 1: Write the failing test**

```javascript
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { TransferSession } from '../src/main/services/remote-assist/transfer/transfer-session.ts'

class LoopbackTransport {
  constructor() { this.peer = null; this.callbacks = [] }
  send(bytes) { this.peer?.deliver(bytes) }
  bufferedAmount() { return 0 }
  isOpen() { return true }
  onFrame(cb) { this.callbacks.push(cb) }
  deliver(bytes) { for (const cb of this.callbacks) cb(bytes) }
}

test('transfers a nested folder between two sessions preserving structure', async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'dj-int-'))
  const src = path.join(base, 'src')
  await fs.mkdir(path.join(src, 'pics', 'raw'), { recursive: true })
  await fs.writeFile(path.join(src, 'pics', 'a.png'), 'AAA')
  await fs.writeFile(path.join(src, 'pics', 'raw', 'b.png'), 'BBBB')

  const ta = new LoopbackTransport(); const tb = new LoopbackTransport(); ta.peer = tb; tb.peer = ta
  const sender = new TransferSession({ transport: ta, receiveDir: path.join(base, 'a'), stagingDir: path.join(base, 'as') })
  const receiver = new TransferSession({ transport: tb, receiveDir: path.join(base, 'b'), stagingDir: path.join(base, 'bs') })
  receiver.setPolicy({ receiveFiles: true, clipboard: { text: false, image: false, file: false } })

  await sender.enqueueSend([path.join(src, 'pics')])
  await new Promise((r) => setTimeout(r, 100))
  assert.equal(await fs.readFile(path.join(base, 'b', 'pics', 'a.png'), 'utf8'), 'AAA')
  assert.equal(await fs.readFile(path.join(base, 'b', 'pics', 'raw', 'b.png'), 'utf8'), 'BBBB')
  await fs.rm(base, { recursive: true, force: true })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test apps/host/tests/remote-assist-transfer-integration.test.mjs`
Expected: FAIL（若实现尚未支持多级目录则会失败；本任务同时修复 `scanPaths` 的根目录相对化以通过）

- [ ] **Step 3: 实现/修正并补文档**

确认 `scanPaths` 对目录输入以"输入目录的父目录"为根（Task 2 已如此实现，故本测试应通过）；若失败则修正根计算，保证 `pics/a.png`、`pics/raw/b.png` 的相对结构。

在 `docs/remote-assistance-security.md` 第 5 节后追加：

```markdown
6. **传输与剪贴板（V2）**：
   - 文件/图片/剪贴板内容走独立的 `doujiao-data` 有序通道，全程 P2P（DTLS/SCTP）加密，不经信令服务器。
   - 入站文件默认需会话级授权，可在插件页或悬浮条一键撤销；撤销后所有入站 `transfer-offer` 一律拒绝。
   - 受控端对接收路径做强制校验（拒绝 `..`、绝对路径、盘符、保留设备名），并对单文件大小与磁盘空间做预检。
   - 剪贴板同步默认开启（文本/图片/文件三类各自可关），并有可见指示；剪贴板内容可能包含敏感信息，用户可随时关闭。
   - 剪贴板文件采用"暂存 + `FileNameW` 置入系统剪贴板"的方式，落点由用户在接收端粘贴时决定；会话结束清理暂存。
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test apps/host/tests/remote-assist-transfer-integration.test.mjs`
Expected: PASS

- [ ] **Step 5: 全量回归并提交**

```bash
node --test apps/host/tests/*.test.mjs services/remote-assist-signal/tests/*.test.mjs plugins/remote-assist/tests/*.test.mjs
npx tsc --noEmit -p plugins/remote-assist/tsconfig.json
npx tsc --noEmit -p services/remote-assist-signal/tsconfig.json
git add apps/host/tests/remote-assist-transfer-integration.test.mjs docs/remote-assistance-security.md
git commit -m "test(remote-assist): add transfer integration coverage and docs"
```

---

## Self-Review

**Spec coverage**
- 文件传输（显式发送到目录）：Task 4（`enqueueSend`/`send` 模式）+ Task 5（`sendPaths`）+ Task 8/9（UI）。
- 剪贴板文件（暂存 + `FileNameW` 粘贴）：Task 3（编码/置入）+ Task 4（`clipboard-file` 模式完成回调）+ Task 1（路径安全）。
- 剪贴板文本/图片：Task 3 + Task 4（`clip-text`、`clipboard-image`）+ Task 5（监听回写）。
- 文字聊天：Task 4（`chat`）+ Task 8（聊天面板）+ Task 9（历史）。
- 会话级授权可撤销：Task 4（`policy` + `receive-policy` 广播）+ Task 5（`setPolicy`）+ Task 9（UI）。
- 剪贴板默认开、可关、可见：Task 4 默认值 + Task 5/9。
- capability 门控：Task 6 + Task 7。
- 路径安全/超限/磁盘预检/流控/校验/取消/排队：Task 1、2、4。
- 测试策略：Task 1–5、7–10 的单测与集成；Task 10 全量回归。
- 文档：Task 10。

**Placeholder scan**
- 全文无 TBD/TODO；每个 code step 均给出可粘贴代码。
- Task 8 的 HTML/JS 以"插入片段 + 锚点"形式给出可执行内容（因会话窗口为模板字符串，逐行全文替换成本高且易冲突）；实现者按锚点插入即可。

**命名与通道一致性**
- `TransferMode` 在 Task 1 定义，Task 4/5/6 一致使用 `'send' | 'clipboard-file' | 'clipboard-image'`。
- `TransferEntry { name, relPath, size, mime?, sha256 }` 在 Task 1 定义，Task 4 一致；`sendClipboardImage` 构造的 `TreeEntry` 使用 `absPath: ''` 并由 `OutgoingJob.inlineBytes` 提供内存源，`flowChunks` 对 `inlineBytes` 走 `subarray` 分支。
- `BinaryFrameHeader { transferId, entryIndex, seq, len }` 在 Task 1 定义，Task 4 一致。
- `TransferPolicy { receiveFiles, clipboard:{text,image,file} }` 在 Task 4 定义，Task 5/6/7/9 一致。
- `TransferState` 字段在 Task 4/5/6 一致。
- `FrameTransport` 在 Task 4 定义，Task 5（`attach` 入参）、Task 8（`RendererFrameTransport implements FrameTransport`）一致。
- 渲染进程↔主进程帧桥方法名在 Task 7（preload）与 Task 8（窗口脚本）严格对应：`onOutgoingChunk` / `sendIncomingChunk` / `notifyReady` / `notifyClosed` / `reportBackpressure` / `sendChat` / `onState` / `onChat` / `requestSendFiles` / `openReceiveFolder`。
- IPC 通道名在 Task 7（插件↔主进程 `plugin:remote-assist:transfer:*`）、Task 8（会话窗口↔主进程 `remote-assist:transfer:*`）分别独立、不重名。
- `receive-store.ts`（spec 命名）在实现中拆为 `transfer-fs.ts`；spec 的落盘职责全部落在 Task 2，属有意细化。
