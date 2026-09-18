/**
 * 信令服务侧设备身份校验 (Ed25519 签名 + 9 位设备代码派生)
 * 与客户端 apps/host/src/main/services/remote-assist/device-identity-store.ts 的派生算法保持一致
 */

import crypto from 'node:crypto'

/** 注册报文允许的最大时钟偏移 */
export const MAX_REGISTER_CLOCK_SKEW_MS = 5 * 60 * 1000

/** 去除设备代码中的空白字符 */
export function normalizeDeviceCode(code: unknown): string {
  return typeof code === 'string' ? code.replace(/\s+/g, '') : ''
}

/** 判断是否为合法 9 位数字设备代码 */
export function isValidDeviceCode(code: unknown): code is string {
  return typeof code === 'string' && /^\d{9}$/.test(normalizeDeviceCode(code))
}

/**
 * 由公钥 (base64 SPKI DER) 确定性派生 9 位设备代码，算法必须与客户端完全一致:
 * sha256(DER) -> 取 hex 前 12 字符 -> % 900000000 + 100000000 -> 9 位数字
 */
export function deriveDeviceCodeFromPublicKey(publicKeyBase64: string): string {
  const der = Buffer.from(publicKeyBase64, 'base64')
  const hash = crypto.createHash('sha256').update(der).digest('hex')
  const num = (BigInt('0x' + hash.slice(0, 12)) % 900000000n) + 100000000n
  const raw = num.toString()
  return `${raw.slice(0, 3)} ${raw.slice(3, 6)} ${raw.slice(6, 9)}`
}

/**
 * 校验注册签名: Ed25519 签名内容为 `${deviceCode}:${timestamp}`
 */
export function verifyRegisterSignature(params: {
  deviceCode: string
  publicKeyBase64: string
  timestamp: number
  sigBase64: string
}): boolean {
  const { deviceCode, publicKeyBase64, timestamp, sigBase64 } = params
  if (!deviceCode || !publicKeyBase64 || !sigBase64 || !Number.isFinite(timestamp)) {
    return false
  }
  try {
    const key = crypto.createPublicKey({
      key: Buffer.from(publicKeyBase64, 'base64'),
      format: 'der',
      type: 'spki'
    })
    const payload = Buffer.from(`${deviceCode}:${timestamp}`, 'utf8')
    return crypto.verify(null, payload, key, Buffer.from(sigBase64, 'base64'))
  } catch {
    return false
  }
}

export interface RegisterIdentity {
  deviceCode: string
  publicKey?: string
  sig?: string
  timestamp?: number
  displayName?: string
}

/**
 * 完整校验注册报文: 设备代码格式 + 签名有效性 + 公钥派生的设备代码与声明一致
 */
export function verifyRegisterIdentity(identity: RegisterIdentity): { ok: boolean; reason?: string } {
  const { deviceCode, publicKey, sig, timestamp } = identity

  if (!isValidDeviceCode(deviceCode)) {
    return { ok: false, reason: 'INVALID_DEVICE_CODE' }
  }
  if (typeof publicKey !== 'string' || publicKey.length === 0) {
    return { ok: false, reason: 'MISSING_PUBLIC_KEY' }
  }
  if (typeof sig !== 'string' || sig.length === 0) {
    return { ok: false, reason: 'MISSING_SIGNATURE' }
  }
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) {
    return { ok: false, reason: 'MISSING_TIMESTAMP' }
  }
  if (Math.abs(Date.now() - timestamp) > MAX_REGISTER_CLOCK_SKEW_MS) {
    return { ok: false, reason: 'STALE_TIMESTAMP' }
  }
  if (!verifyRegisterSignature({ deviceCode, publicKeyBase64: publicKey, timestamp, sigBase64: sig })) {
    return { ok: false, reason: 'BAD_SIGNATURE' }
  }

  let derived: string
  try {
    derived = deriveDeviceCodeFromPublicKey(publicKey)
  } catch {
    return { ok: false, reason: 'INVALID_PUBLIC_KEY' }
  }
  if (normalizeDeviceCode(derived) !== normalizeDeviceCode(deviceCode)) {
    return { ok: false, reason: 'DEVICE_CODE_MISMATCH' }
  }

  return { ok: true }
}
