/**
 * 远程协助设备身份与加密存储 (Device Identity Store)
 * 基于 Ed25519 密钥对生成确定性 9 位设备代码，并使用 Electron safeStorage 加密保护私钥
 */

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { formatDeviceCode } from './remote-assist-contract.ts'

export interface DeviceIdentity {
  rawDeviceId: string
  deviceCode: string
  publicKey: string // base64 DER (spki)
  sign(payload: string | Buffer): string // base64 Ed25519 signature
}

export interface SafeStorageAdapter {
  isEncryptionAvailable(): boolean
  encryptString(plainText: string): Buffer
  decryptString(encryptedBuffer: Buffer): string
}

export interface KeyValueAdapter {
  get(key: string): any
  set(key: string, value: any): void
  has(key: string): boolean
}

export interface DeviceIdentityStoreOptions {
  kvStore?: KeyValueAdapter
  safeStorage?: SafeStorageAdapter
  storagePath?: string
}

interface StoredIdentityPayload {
  rawDeviceId: string
  deviceCode: string
  publicKey: string
  encryptedPrivateKey: string
  privateKeyProtected?: boolean
  signalingUrl?: string
  safetyCode?: string
  preferredFps?: number
}

const STORAGE_KEY = 'remote_assist_device_identity_v1'

/**
 * 生成 6 位随机安全核对码 (例如: "582109")
 */
export function generateRandomSafetyCode(): string {
  const num = crypto.randomInt(100000, 1000000)
  return num.toString()
}

/**
 * 从公钥派生稳定的 9 位设备代码 (格式: "839 201 442")
 */
export function deriveDeviceCodeFromPublicKey(publicKeyData: string | Buffer): string {
  const buf = typeof publicKeyData === 'string'
    ? Buffer.from(publicKeyData, 'utf8')
    : publicKeyData
  const hash = crypto.createHash('sha256').update(buf).digest('hex')
  const num = (BigInt('0x' + hash.slice(0, 12)) % 900000000n) + 100000000n
  return formatDeviceCode(num.toString())
}

/**
 * 从握手摘要派生 6 位确认安全码 (Safety Code)
 */
export function deriveSafetyCode(transcriptOrHash: string): string {
  const hash = crypto.createHash('sha256').update(transcriptOrHash, 'utf8').digest('hex')
  const num = (BigInt('0x' + hash.slice(0, 8)) % 900000n) + 100000n
  return num.toString()
}

export class DeviceIdentityStore {
  private kvStore?: KeyValueAdapter
  private safeStorage?: SafeStorageAdapter
  private storagePath?: string
  private cachedIdentity: DeviceIdentity | null = null
  private cachedPayload: StoredIdentityPayload | null = null

  constructor(options: DeviceIdentityStoreOptions = {}) {
    this.kvStore = options.kvStore
    this.safeStorage = options.safeStorage
    this.storagePath = options.storagePath
  }

  private resolveStoragePath(): string | null {
    if (this.storagePath) {
      return this.storagePath
    }
    try {
      const electron = require('electron')
      const app = electron?.app || electron?.default?.app
      if (app && typeof app.getPath === 'function') {
        return path.join(app.getPath('userData'), 'remote-assist-identity.json')
      }
    } catch {}
    return null
  }

  private resolveSafeStorage(): SafeStorageAdapter | null {
    if (this.safeStorage) {
      return this.safeStorage
    }
    try {
      // Dynamic require Electron safeStorage if available in runtime
      const electron = require('electron')
      if (electron?.safeStorage) {
        return electron.safeStorage
      }
    } catch {}
    return null
  }

  private readStoredPayload(): StoredIdentityPayload | null {
    if (this.kvStore) {
      return (this.kvStore.get(STORAGE_KEY) as StoredIdentityPayload) || null
    }

    const resolvedPath = this.resolveStoragePath()
    if (resolvedPath && fs.existsSync(resolvedPath)) {
      try {
        const raw = fs.readFileSync(resolvedPath, 'utf8')
        const parsed = JSON.parse(raw) as StoredIdentityPayload
        this.cachedPayload = parsed
        return parsed
      } catch (err) {
        console.warn('[DeviceIdentityStore] 读取存储文件失败:', err)
      }
    }

    return this.cachedPayload
  }

  private writeStoredPayload(payload: StoredIdentityPayload): void {
    this.cachedPayload = { ...payload }

    if (this.kvStore) {
      this.kvStore.set(STORAGE_KEY, payload)
      return
    }

    const resolvedPath = this.resolveStoragePath()
    if (resolvedPath) {
      try {
        const dir = path.dirname(resolvedPath)
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true })
        }
        // 原子写：先写临时文件再重命名，避免写入中断导致身份文件损坏
        const tmpPath = `${resolvedPath}.tmp`
        fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2), 'utf8')
        fs.renameSync(tmpPath, resolvedPath)
      } catch (err) {
        console.error('[DeviceIdentityStore] 写入存储文件失败:', err)
      }
    }
  }

  public getSignalingUrl(): string | undefined {
    return this.readStoredPayload()?.signalingUrl
  }

  public setSignalingUrl(url: string): void {
    const payload = this.readStoredPayload() || {
      rawDeviceId: '',
      deviceCode: '',
      publicKey: '',
      encryptedPrivateKey: ''
    }
    payload.signalingUrl = url
    this.writeStoredPayload(payload)
  }

  public getSafetyCode(): string {
    const payload = this.readStoredPayload()
    if (payload?.safetyCode && /^\d{6}$/.test(payload.safetyCode)) {
      return payload.safetyCode
    }
    const newCode = generateRandomSafetyCode()
    this.setSafetyCode(newCode)
    return newCode
  }

  public setSafetyCode(code: string): string {
    const payload = this.readStoredPayload() || {
      rawDeviceId: '',
      deviceCode: '',
      publicKey: '',
      encryptedPrivateKey: ''
    }
    payload.safetyCode = code
    this.writeStoredPayload(payload)
    return code
  }

  public refreshSafetyCode(): string {
    const newCode = generateRandomSafetyCode()
    this.setSafetyCode(newCode)
    return newCode
  }

  public getPreferredFps(): number {
    const payload = this.readStoredPayload()
    const fps = payload?.preferredFps
    if (typeof fps === 'number' && (fps === 15 || fps === 30 || fps === 60)) {
      return fps
    }
    return 60
  }

  public setPreferredFps(fps: number): void {
    const validFps = fps === 15 || fps === 30 ? fps : 60
    const payload = this.readStoredPayload() || {
      rawDeviceId: '',
      deviceCode: '',
      publicKey: '',
      encryptedPrivateKey: ''
    }
    payload.preferredFps = validFps
    this.writeStoredPayload(payload)
  }

  /**
   * 获取已有设备身份，或自动生成并持久化
   */
  public async getOrCreate(): Promise<DeviceIdentity> {
    if (this.cachedIdentity) {
      return this.cachedIdentity
    }

    const safeStorage = this.resolveSafeStorage()
    const stored = this.readStoredPayload()

    if (stored && stored.encryptedPrivateKey && stored.publicKey && stored.deviceCode) {
      try {
        let privBase64: string
        if (stored.privateKeyProtected === false) {
          // 明确标记为明文存储 (safeStorage 不可用时的降级)
          privBase64 = Buffer.from(stored.encryptedPrivateKey, 'base64').toString('utf8')
        } else if (stored.privateKeyProtected === true) {
          if (!safeStorage || !safeStorage.isEncryptionAvailable()) {
            throw new Error('safeStorage 当前不可用，无法解密受保护的私钥')
          }
          privBase64 = safeStorage.decryptString(Buffer.from(stored.encryptedPrivateKey, 'base64'))
        } else {
          // 兼容旧数据 (无标记)：优先按 safeStorage 解密，失败再按明文处理
          if (safeStorage && safeStorage.isEncryptionAvailable()) {
            privBase64 = safeStorage.decryptString(Buffer.from(stored.encryptedPrivateKey, 'base64'))
          } else {
            privBase64 = Buffer.from(stored.encryptedPrivateKey, 'base64').toString('utf8')
          }
        }

        const privKey = crypto.createPrivateKey({
          key: Buffer.from(privBase64, 'base64'),
          format: 'der',
          type: 'pkcs8'
        })

        const identity: DeviceIdentity = {
          rawDeviceId: stored.rawDeviceId,
          deviceCode: stored.deviceCode,
          publicKey: stored.publicKey,
          sign: (payload: string | Buffer) => {
            const data = typeof payload === 'string' ? Buffer.from(payload, 'utf8') : payload
            return crypto.sign(null, data, privKey).toString('base64')
          }
        }

        this.cachedIdentity = identity
        return identity
      } catch (err) {
        console.warn('[DeviceIdentityStore] 解密已有私钥失败，将重新生成身份:', err)
      }
    }

    // 生成新的 Ed25519 密钥对
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519')
    const pubDer = publicKey.export({ type: 'spki', format: 'der' })
    const privDer = privateKey.export({ type: 'pkcs8', format: 'der' })

    const rawDeviceId = crypto.randomUUID()
    const deviceCode = deriveDeviceCodeFromPublicKey(pubDer)
    const pubBase64 = pubDer.toString('base64')
    const privBase64 = privDer.toString('base64')

    const protectedBySafeStorage = Boolean(safeStorage && safeStorage.isEncryptionAvailable())
    let encryptedPrivateKey: string
    if (protectedBySafeStorage) {
      encryptedPrivateKey = safeStorage!.encryptString(privBase64).toString('base64')
    } else {
      encryptedPrivateKey = Buffer.from(privBase64, 'utf8').toString('base64')
    }

    const newPayload: StoredIdentityPayload = {
      rawDeviceId,
      deviceCode,
      publicKey: pubBase64,
      encryptedPrivateKey,
      privateKeyProtected: protectedBySafeStorage,
      // 保留既有配置，避免重新生成身份时丢失安全码/信令地址
      signalingUrl: stored?.signalingUrl,
      safetyCode: stored?.safetyCode
    }

    this.writeStoredPayload(newPayload)

    const identity: DeviceIdentity = {
      rawDeviceId,
      deviceCode,
      publicKey: pubBase64,
      sign: (payload: string | Buffer) => {
        const data = typeof payload === 'string' ? Buffer.from(payload, 'utf8') : payload
        return crypto.sign(null, data, privateKey).toString('base64')
      }
    }

    this.cachedIdentity = identity
    return identity
  }
}
