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
  ensureDir,
  estimateFreeBytes
} from '../src/main/services/remote-assist/transfer/transfer-fs.ts'
import { isSafeRelPath } from '../src/main/services/remote-assist/transfer/transfer-protocol.ts'

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

// ---- 加固批次 A ----

test('scanPaths filters unsafe single-file basenames (symmetric with the directory branch)', async () => {
  const root = await tempDir()
  const safe = path.join(root, 'normal.txt')
  await fs.writeFile(safe, 'ok')
  const entries = await scanPaths([safe])
  assert.deepEqual(entries.map((e) => e.relPath), ['normal.txt'], 'normally-named single file must still be returned')

  // Windows 保留名（如 CON）无法作为普通文件创建，无法端到端构造该输入，
  // 因此直接断言单文件分支所用的过滤函数行为：保留名 / 非法字符 basename 一律不安全。
  assert.equal(isSafeRelPath(path.basename('CON')), false, 'reserved Windows basename must be unsafe')
  assert.equal(isSafeRelPath(path.basename('C:\\tmp\\CON.txt')), false)
  assert.equal(isSafeRelPath(path.basename('/tmp/a:b.txt')), false, 'illegal basename char must be unsafe')
  assert.equal(isSafeRelPath('normal.txt'), true)
  await cleanupDir(root)
})

test('PartWriter.bytesWritten increments only after the write callback succeeds', async () => {
  const root = await tempDir()
  const writer = await PartWriter.open(root, 'order.bin')
  const pending = writer.write(new Uint8Array([1, 2, 3]))
  assert.equal(writer.bytesWritten, 0, 'bytes must not be counted before the write callback confirms success')
  await pending
  assert.equal(writer.bytesWritten, 3)
  await writer.finalize()
  await cleanupDir(root)
})

test('PartWriter records a post-open stream error and rejects write/finalize instead of hanging', async () => {
  const root = await tempDir()
  const writer = await PartWriter.open(root, 'err.bin')
  // 打开后制造流错误：残留的 once('error') 不得把它吞掉
  const errored = new Promise((resolve) => writer.stream.once('error', resolve))
  writer.stream.destroy(new Error('post-open-boom'))
  await errored
  await assert.rejects(writer.write(new Uint8Array([1])), /post-open-boom/)
  await assert.rejects(writer.finalize(), /post-open-boom/)
  await cleanupDir(root)
})

test('estimateFreeBytes warns and returns a permissive fallback when statfs fails', async () => {
  const missing = path.join(os.tmpdir(), `dj-missing-${Date.now()}`, 'sub')
  const warnings = []
  const originalWarn = console.warn
  console.warn = (...args) => warnings.push(args.map(String).join(' '))
  try {
    const free = await estimateFreeBytes(missing)
    assert.equal(free, Number.MAX_SAFE_INTEGER, 'must keep the permissive fallback')
    assert.ok(
      warnings.some((w) => /statfs failed/.test(w) && w.includes(missing)),
      `must warn that the disk precheck is skipped, got: ${JSON.stringify(warnings)}`
    )
  } finally {
    console.warn = originalWarn
  }
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

test('PartWriter.abort settles a concurrently pending write instead of hanging', async () => {
  const root = await tempDir()
  const writer = await PartWriter.open(root, 'abort-race.bin')
  // 先发起一笔写入，再立刻 abort：二者竞态时挂起的 write 必须被拒绝
  const pending = writer.write(new Uint8Array([1, 2, 3]))
  const settled = pending.then(
    () => 'resolved',
    (err) => `rejected:${err?.message ?? String(err)}`
  )
  await writer.abort()
  // 用短计时器兜底，确保测试本身永不悬挂
  const guard = new Promise((resolve) => setTimeout(() => resolve('timeout'), 500))
  const outcome = await Promise.race([settled, guard])
  assert.equal(outcome, 'rejected:writer aborted', `pending write must reject on abort, got: ${outcome}`)
  assert.equal(await fs.stat(writer.partPath).catch(() => null), null, 'abort must still remove the partial file')
  await cleanupDir(root)
})

// ---- 加固批次 C ----

test('PartWriter.open rejects a relPath that escapes the root via a symlink/junction', async (t) => {
  const root = await tempDir()
  const outside = await tempDir()
  const linkPath = path.join(root, 'link')
  // Windows 用 junction（无需管理员权限），其它平台用目录符号链接
  const linkType = process.platform === 'win32' ? 'junction' : 'dir'
  try {
    await fs.symlink(outside, linkPath, linkType)
  } catch {
    t.skip('symlink not permitted in this environment')
    await cleanupDir(root)
    await cleanupDir(outside)
    return
  }

  await assert.rejects(
    PartWriter.open(root, 'link/evil.txt'),
    /escapes root/,
    'writing through a symlinked directory must be rejected as a root escape'
  )
  // 被拒之后不得在 root 之外留下任何文件
  assert.equal(await fs.stat(path.join(outside, 'evil.txt')).catch(() => null), null, 'no file may land outside the root')

  // 对照：正常的 root 内路径仍可正常写入
  const writer = await PartWriter.open(root, 'ok/good.txt')
  await writer.write(new Uint8Array([1, 2, 3]))
  await writer.finalize()
  assert.deepEqual(Array.from(await fs.readFile(path.join(root, 'ok', 'good.txt'))), [1, 2, 3], 'in-root writes must still work')

  await cleanupDir(root)
  await cleanupDir(outside)
})
