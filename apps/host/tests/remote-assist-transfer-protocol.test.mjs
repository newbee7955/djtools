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

// ---- 加固：decodeFrame 头部形状与长度校验 ----

const FRAME_JSON = 0x01
const FRAME_BINARY = 0x02

/** 手工拼帧（绕过 encodeBinaryFrame 的上限校验），用于构造非法输入 */
function rawFrame(frameType, headerObj, payloadBytes = new Uint8Array(0)) {
  const header = new TextEncoder().encode(JSON.stringify(headerObj))
  const out = new Uint8Array(1 + 4 + header.length + payloadBytes.length)
  out[0] = frameType
  new DataView(out.buffer).setUint32(1, header.length, false)
  out.set(header, 5)
  out.set(payloadBytes, 5 + header.length)
  return out
}

test('decodeFrame rejects a JSON frame with trailing bytes after the header', () => {
  const clean = encodeJsonFrame({ t: 'chat', text: 'hi' })
  const withTrailing = new Uint8Array(clean.length + 3)
  withTrailing.set(clean, 0)
  withTrailing.set([9, 9, 9], clean.length)
  assert.throws(() => decodeFrame(withTrailing), /trailing bytes after header/)
  // 无尾随字节的同一帧仍可正常解析
  assert.equal(decodeFrame(clean).frame.t, 'chat')
})

test('decodeFrame rejects a JSON frame whose header is not an object with string t', () => {
  assert.throws(() => decodeFrame(rawFrame(FRAME_JSON, { foo: 'bar' })), /invalid control frame header/)
  assert.throws(() => decodeFrame(rawFrame(FRAME_JSON, [1, 2, 3])), /invalid control frame header/)
  assert.throws(() => decodeFrame(rawFrame(FRAME_JSON, null)), /invalid control frame header/)
})

test('decodeFrame rejects a binary header whose len exceeds CHUNK_SIZE', () => {
  const frame = rawFrame(FRAME_BINARY, { transferId: 'tr_1', entryIndex: 0, seq: 0, len: CHUNK_SIZE + 1 })
  assert.throws(() => decodeFrame(frame), /chunk exceeds CHUNK_SIZE/)
})

test('decodeFrame rejects a malformed binary header shape', () => {
  // 缺失 seq
  assert.throws(
    () => decodeFrame(rawFrame(FRAME_BINARY, { transferId: 'tr_1', entryIndex: 0, len: 0 })),
    /seq must be a non-negative integer/
  )
  // 负数 seq
  assert.throws(
    () => decodeFrame(rawFrame(FRAME_BINARY, { transferId: 'tr_1', entryIndex: 0, seq: -1, len: 0 })),
    /seq must be a non-negative integer/
  )
  // 空 transferId
  assert.throws(
    () => decodeFrame(rawFrame(FRAME_BINARY, { transferId: '', entryIndex: 0, seq: 0, len: 0 })),
    /transferId must be a non-empty string/
  )
  // 非整数 entryIndex
  assert.throws(
    () => decodeFrame(rawFrame(FRAME_BINARY, { transferId: 'tr_1', entryIndex: 0.5, seq: 0, len: 0 })),
    /entryIndex must be a non-negative integer/
  )
  // len 非数字
  assert.throws(
    () => decodeFrame(rawFrame(FRAME_BINARY, { transferId: 'tr_1', entryIndex: 0, seq: 0, len: 'x' })),
    /len must be a non-negative integer/
  )
})

test('decodeFrame accepts a binary header at exactly CHUNK_SIZE', () => {
  const payload = new Uint8Array(CHUNK_SIZE)
  const header = { transferId: 'tr_full', entryIndex: 0, seq: 0, len: CHUNK_SIZE }
  const decoded = decodeFrame(encodeBinaryFrame(header, payload))
  assert.equal(decoded.kind, 'binary')
  assert.equal(decoded.payload.length, CHUNK_SIZE)
})
