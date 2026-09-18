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

function parseHeader(bytes: Uint8Array, headerLen: number): unknown {
  const headerJson = decoder.decode(bytes.subarray(5, 5 + headerLen))
  return JSON.parse(headerJson)
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

/** 二进制帧头部结构校验：不信任对端，任一项非法都拒绝而不是让 undefined 参与运算 */
function validateBinaryHeader(header: unknown): BinaryFrameHeader {
  if (header === null || typeof header !== 'object' || Array.isArray(header)) {
    throw new Error('invalid binary frame header: expected object')
  }
  const h = header as Record<string, unknown>
  if (typeof h.transferId !== 'string' || h.transferId.length === 0) {
    throw new Error('invalid binary frame header: transferId must be a non-empty string')
  }
  if (!isNonNegativeInteger(h.entryIndex)) {
    throw new Error('invalid binary frame header: entryIndex must be a non-negative integer')
  }
  if (!isNonNegativeInteger(h.seq)) {
    throw new Error('invalid binary frame header: seq must be a non-negative integer')
  }
  if (!isNonNegativeInteger(h.len)) {
    throw new Error('invalid binary frame header: len must be a non-negative integer')
  }
  if (h.len > CHUNK_SIZE) {
    throw new Error('chunk exceeds CHUNK_SIZE: ' + h.len)
  }
  return { transferId: h.transferId, entryIndex: h.entryIndex, seq: h.seq, len: h.len }
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

  if (frameType === FRAME_JSON) {
    // JSON 控制帧不携带 payload：头部长度必须精确等于帧体长度，拒绝尾部多余字节
    if (5 + headerLen !== bytes.length) {
      throw new Error(`trailing bytes after header: ${bytes.length - 5 - headerLen}`)
    }
    const header = parseHeader(bytes, headerLen)
    if (header === null || typeof header !== 'object' || Array.isArray(header) || typeof (header as Record<string, unknown>).t !== 'string') {
      throw new Error('invalid control frame header: expected object with string t')
    }
    return { kind: 'json', frame: header as ControlFrame }
  }

  const binaryHeader = validateBinaryHeader(parseHeader(bytes, headerLen))
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
