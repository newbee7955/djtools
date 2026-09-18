/**
 * 豆角远程协助标准契约与核心校验模块 (Remote Assist Contract)
 */

import type {
  RemoteAssistRole,
  RemoteAssistPermission,
  RemoteAssistInputEvent,
  RemoteAssistSessionPhase,
  RemoteAssistSessionStatus,
  RemoteAssistDeviceInfo,
  RemoteAssistEvent
} from '@doujiao/plugin-sdk'

export type {
  RemoteAssistRole,
  RemoteAssistPermission,
  RemoteAssistInputEvent,
  RemoteAssistSessionPhase,
  RemoteAssistSessionStatus,
  RemoteAssistDeviceInfo,
  RemoteAssistEvent
}

export const SIGNAL_PROTOCOL_VERSION = 1
export const SIGNAL_ENVELOPE_TTL_MS = 600_000 // 10 minutes
export const MAX_CLOCK_SKEW_MS = 300_000 // 5 minutes
export const MAX_INPUT_PAYLOAD_BYTES = 4096

export type RemoteAssistSignalType =
  | 'register'
  | 'registered'
  | 'session-request'
  | 'session-response'
  | 'offer'
  | 'answer'
  | 'ice-candidate'
  | 'disconnect'
  | 'ping'
  | 'pong'
  | 'error'

export interface RemoteAssistSignalEnvelope {
  v: number
  type: RemoteAssistSignalType
  from: string
  to?: string
  timestamp: number
  payload?: any
  sig?: string
}

const VALID_SIGNAL_TYPES = new Set<RemoteAssistSignalType>([
  'register',
  'registered',
  'session-request',
  'session-response',
  'offer',
  'answer',
  'ice-candidate',
  'disconnect',
  'ping',
  'pong',
  'error'
])

const VALID_BUTTONS = new Set(['left', 'middle', 'right'])

const STATE_TRANSITIONS: Record<RemoteAssistSessionPhase, ReadonlySet<RemoteAssistSessionPhase>> = {
  idle: new Set(['requesting', 'awaiting-consent']),
  requesting: new Set(['connecting', 'idle']),
  'awaiting-consent': new Set(['connecting', 'idle']),
  connecting: new Set(['connected', 'disconnecting', 'idle']),
  connected: new Set(['disconnecting', 'idle']),
  disconnecting: new Set(['idle'])
}

/**
 * 格式化 9 位设备代码，例如: "839201442" -> "839 201 442"
 */
export function formatDeviceCode(rawCode: string): string {
  if (typeof rawCode !== 'string') {
    throw new Error('Device code must be a string')
  }
  const clean = rawCode.replace(/\s+/g, '')
  if (!/^\d{9}$/.test(clean)) {
    throw new Error(`Device code must be a 9-digit numeric string, got: "${rawCode}"`)
  }
  return `${clean.slice(0, 3)} ${clean.slice(3, 6)} ${clean.slice(6, 9)}`
}

/**
 * 反格式化 9 位设备代码，清除空格并校验: "839 201 442" -> "839201442"
 */
export function unformatDeviceCode(code: string): string {
  if (typeof code !== 'string') {
    throw new Error('Device code must be a string')
  }
  const clean = code.replace(/\s+/g, '')
  if (!/^\d{9}$/.test(clean)) {
    throw new Error(`Device code must be a 9-digit numeric string, got: "${code}"`)
  }
  return clean
}

/**
 * 去除设备代码中的空白字符 (不校验格式)
 */
export function normalizeDeviceCode(code: string): string {
  return typeof code === 'string' ? code.replace(/\s+/g, '') : ''
}

/**
 * 判断任意输入是否为合法的 9 位数字设备代码 (允许空格分隔)
 */
export function isValidDeviceCode(value: unknown): value is string {
  return typeof value === 'string' && /^\d{9}$/.test(normalizeDeviceCode(value))
}

/**
 * 将任意入站权限值收敛到白名单 {view, control}，非 view 一律降级为 control
 */
export function normalizePermission(value: unknown): RemoteAssistPermission {
  return value === 'view' ? 'view' : 'control'
}

/**
 * 规范化并限制归一化指针坐标在 [0, 1] 范围
 */
export function normalizePointer(x: number, y: number): { x: number; y: number } {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error('Pointer coordinates must be finite numbers')
  }
  const clampedX = Math.min(1, Math.max(0, x))
  const clampedY = Math.min(1, Math.max(0, y))
  return {
    x: Number(clampedX.toFixed(6)),
    y: Number(clampedY.toFixed(6))
  }
}

/**
 * 校验并解析输入的远程控制事件
 */
export function parseInputEvent(value: unknown): RemoteAssistInputEvent {
  if (!value || typeof value !== 'object') {
    throw new Error('Input event must be an object')
  }

  const rawJson = JSON.stringify(value)
  if (Buffer.byteLength(rawJson, 'utf8') > MAX_INPUT_PAYLOAD_BYTES) {
    throw new Error(`Input event exceeds maximum allowed payload size of ${MAX_INPUT_PAYLOAD_BYTES} bytes`)
  }

  const event = value as Record<string, any>
  if (typeof event.sessionId !== 'string' || !event.sessionId.trim()) {
    throw new Error('Input event must include a valid non-empty sessionId string')
  }

  if (!Number.isInteger(event.seq) || event.seq < 0) {
    throw new Error('Input event sequence must be a non-negative integer')
  }

  switch (event.type) {
    case 'pointer-move': {
      if (typeof event.x !== 'number' || typeof event.y !== 'number' || !Number.isFinite(event.x) || !Number.isFinite(event.y)) {
        throw new Error('Pointer-move event requires finite x and y coordinates')
      }
      if (event.x < 0 || event.x > 1 || event.y < 0 || event.y > 1) {
        throw new Error(`Pointer-move coordinates must be normalized coordinates in [0, 1], got x=${event.x}, y=${event.y}`)
      }
      return {
        type: 'pointer-move',
        sessionId: event.sessionId,
        seq: event.seq,
        x: Number(event.x.toFixed(6)),
        y: Number(event.y.toFixed(6))
      }
    }

    case 'pointer-button': {
      if (!VALID_BUTTONS.has(event.button)) {
        throw new Error(`Pointer-button event button must be 'left' | 'middle' | 'right', got "${event.button}"`)
      }
      if (typeof event.pressed !== 'boolean') {
        throw new Error('Pointer-button event requires boolean pressed state')
      }
      return {
        type: 'pointer-button',
        sessionId: event.sessionId,
        seq: event.seq,
        button: event.button,
        pressed: event.pressed
      }
    }

    case 'wheel': {
      if (!Number.isFinite(event.deltaX) || !Number.isFinite(event.deltaY)) {
        throw new Error('Wheel event deltaX and deltaY must be finite numbers')
      }
      return {
        type: 'wheel',
        sessionId: event.sessionId,
        seq: event.seq,
        deltaX: Math.min(1000, Math.max(-1000, event.deltaX)),
        deltaY: Math.min(1000, Math.max(-1000, event.deltaY))
      }
    }

    case 'key': {
      if (typeof event.code !== 'string' || !event.code.trim()) {
        throw new Error('Key event code must be a non-empty string')
      }
      if (typeof event.pressed !== 'boolean') {
        throw new Error('Key event requires boolean pressed state')
      }
      if (!Array.isArray(event.modifiers) || !event.modifiers.every((m: unknown) => typeof m === 'string')) {
        throw new Error('Key event modifiers must be an array of strings')
      }
      return {
        type: 'key',
        sessionId: event.sessionId,
        seq: event.seq,
        code: event.code,
        pressed: event.pressed,
        modifiers: event.modifiers
      }
    }

    default:
      throw new Error(`Unsupported input event type: "${event.type}"`)
  }
}

/**
 * 状态机跃迁合法性判断
 */
export function canTransition(from: RemoteAssistSessionPhase, to: RemoteAssistSessionPhase): boolean {
  const allowed = STATE_TRANSITIONS[from]
  return allowed ? allowed.has(to) : false
}

/**
 * 校验并解析信令消息信封
 */
export function parseSignalEnvelope(value: unknown, now: number = Date.now()): RemoteAssistSignalEnvelope {
  if (!value || typeof value !== 'object') {
    throw new Error('Signal envelope must be an object')
  }

  const env = value as Record<string, any>

  if (env.v !== SIGNAL_PROTOCOL_VERSION) {
    throw new Error(`Unsupported signal protocol version: ${env.v}, expected ${SIGNAL_PROTOCOL_VERSION}`)
  }

  if (!VALID_SIGNAL_TYPES.has(env.type)) {
    throw new Error(`Invalid signal type: "${env.type}"`)
  }

  if (typeof env.from !== 'string' || !env.from.trim()) {
    throw new Error('Signal envelope must have a non-empty "from" identifier')
  }

  if (typeof env.timestamp !== 'number' || !Number.isFinite(env.timestamp)) {
    throw new Error('Signal envelope must contain a valid finite timestamp')
  }

  if (now - env.timestamp > SIGNAL_ENVELOPE_TTL_MS) {
    throw new Error(`Signal envelope [type=${env.type}, from=${env.from}] expired: age ${now - env.timestamp}ms > max ${SIGNAL_ENVELOPE_TTL_MS}ms`)
  }

  if (env.timestamp - now > MAX_CLOCK_SKEW_MS) {
    throw new Error(`Signal envelope [type=${env.type}, from=${env.from}] timestamp is too far in the future: ahead by ${env.timestamp - now}ms > max ${MAX_CLOCK_SKEW_MS}ms`)
  }

  const result: RemoteAssistSignalEnvelope = {
    v: env.v,
    type: env.type,
    from: env.from,
    timestamp: env.timestamp
  }

  if (typeof env.to === 'string') {
    result.to = env.to
  }

  if (env.payload !== undefined) {
    result.payload = env.payload
  }

  if (typeof env.sig === 'string') {
    result.sig = env.sig
  }

  return result
}
