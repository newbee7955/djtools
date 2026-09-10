/**
 * 记事本端侧文件加密解密核心模块
 * 基于原生 Web Crypto API (SubtleCrypto)，无第三方依赖，纯本地执行
 * - 算法：AES-GCM 256位
 * - 密钥派生：PBKDF2-HMAC-SHA256 (100,000次迭代)
 * - 格式：独立 Armored 容器，保全磁盘物理文本文件的可识别性与安全性
 */

export const ENCRYPTED_HEADER = '---BEGIN DOUJIAO ENCRYPTED NOTE v1---'
export const ENCRYPTED_FOOTER = '---END DOUJIAO ENCRYPTED NOTE v1---'

export interface EncryptedPayload {
  version: 1
  salt: string // base64, 16 bytes
  iv: string // base64, 12 bytes
  ciphertext: string // base64
}

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

/**
 * 辅助函数：Uint8Array 转 Base64
 */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const len = bytes.byteLength
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

/**
 * 辅助函数：Base64 转 Uint8Array
 */
function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

/**
 * 通过 PBKDF2 从密码与 Salt 派生 AES-GCM 256 位密钥
 */
async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  )

  return await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as any,
      iterations: 100000,
      hash: 'SHA-256'
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

/**
 * 检查文本是否为已加密的便签内容
 */
export function isEncryptedContent(content: string): boolean {
  if (!content) return false
  const trimmed = content.trim()
  return trimmed.startsWith(ENCRYPTED_HEADER) && trimmed.includes(ENCRYPTED_FOOTER)
}

/**
 * 使用指定密码加密便签正文，返回可安全存盘的封装文本
 */
export async function encryptNoteContent(plainText: string, password: string): Promise<string> {
  if (!password) {
    throw new Error('加密密码不能为空')
  }

  // 1. 生成 16 字节安全随机 Salt 与 12 字节 AES-GCM IV
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))

  // 2. 派生加密密钥
  const key = await deriveKey(password, salt)

  // 3. 执行 AES-GCM 加密
  const cipherBuffer = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: iv as any
    },
    key,
    textEncoder.encode(plainText)
  )

  const payload: EncryptedPayload = {
    version: 1,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(cipherBuffer))
  }

  return `${ENCRYPTED_HEADER}\n${JSON.stringify(payload, null, 2)}\n${ENCRYPTED_FOOTER}`
}

/**
 * 使用指定密码解密便签内容，失败抛出密码错误异常
 */
export async function decryptNoteContent(armoredContent: string, password: string): Promise<string> {
  if (!password) {
    throw new Error('请输入访问密码')
  }

  const trimmed = armoredContent.trim()
  if (!isEncryptedContent(trimmed)) {
    // 若本非密文，直接返回原文本
    return armoredContent
  }

  // 提取 JSON Payload
  const startIdx = trimmed.indexOf(ENCRYPTED_HEADER) + ENCRYPTED_HEADER.length
  const endIdx = trimmed.indexOf(ENCRYPTED_FOOTER)
  const jsonStr = trimmed.slice(startIdx, endIdx).trim()

  let payload: EncryptedPayload
  try {
    payload = JSON.parse(jsonStr)
  } catch {
    throw new Error('密文数据损坏，无法解析')
  }

  if (payload.version !== 1 || !payload.salt || !payload.iv || !payload.ciphertext) {
    throw new Error('未知的加密格式版本')
  }

  const salt = base64ToBytes(payload.salt)
  const iv = base64ToBytes(payload.iv)
  const cipherBytes = base64ToBytes(payload.ciphertext)

  try {
    const key = await deriveKey(password, salt)
    const decryptedBuffer = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: iv as any
      },
      key,
      cipherBytes as any
    )
    return textDecoder.decode(decryptedBuffer)
  } catch (err: any) {
    // AES-GCM 校验失败表明密码错误或数据被篡改
    throw new Error('密码错误，无法解锁此便签')
  }
}

export const MASTER_VERIFIER_KEY = 'doujiao_notepad_master_verifier'
const MASTER_VERIFY_TOKEN = 'DOUJIAO_MASTER_VERIFIED_TOKEN'

/**
 * 检查是否已设置全局主访问密码
 */
export function isMasterPasswordSet(): boolean {
  try {
    return Boolean(localStorage.getItem(MASTER_VERIFIER_KEY))
  } catch {
    return false
  }
}

/**
 * 设置或更新全局主访问密码
 */
export async function setupMasterPassword(password: string): Promise<void> {
  const verifier = await encryptNoteContent(MASTER_VERIFY_TOKEN, password)
  localStorage.setItem(MASTER_VERIFIER_KEY, verifier)
}

/**
 * 校验输入的密码是否与全局主访问密码一致
 */
export async function verifyMasterPassword(password: string): Promise<boolean> {
  try {
    const verifier = localStorage.getItem(MASTER_VERIFIER_KEY)
    if (!verifier) return false
    const token = await decryptNoteContent(verifier, password)
    return token === MASTER_VERIFY_TOKEN
  } catch {
    return false
  }
}

