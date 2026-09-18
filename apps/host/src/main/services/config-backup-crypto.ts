import * as crypto from 'node:crypto'

export interface CryptoMetadata {
  algorithm: 'AES-256-GCM'
  kdf: 'PBKDF2'
  iterations: number
  salt: string
  iv: string
  tag: string
}

export interface BackupFileStructure {
  magic: 'DOUJIAO_BACKUP'
  version: number
  exportedAt: string
  appVersion: string
  encrypted: boolean
  crypto: CryptoMetadata
  summary: {
    sambaCount: number
    objectStorageCount: number
    hasProxy: boolean
    hasWorkspaces: boolean
    hasLanTransfer: boolean
    hasAppPrefs: boolean
  }
  payload: string // hex ciphertext
}

export class ConfigBackupCrypto {
  /**
   * 使用 PBKDF2 从密码与 Salt 派生 256 位密钥
   */
  public static deriveKey(password: string, salt: Buffer, iterations = 100_000): Buffer {
    return crypto.pbkdf2Sync(password, salt, iterations, 32, 'sha256')
  }

  /**
   * 使用 AES-256-GCM 加密载荷对象
   */
  public static encryptPayload(data: any, password: string): { payload: string; crypto: CryptoMetadata } {
    if (!password || typeof password !== 'string' || password.length < 6) {
      throw new Error('加密密码长度不能少于 6 位')
    }
    const salt = crypto.randomBytes(16)
    const iv = crypto.randomBytes(12)
    const iterations = 100_000
    const key = ConfigBackupCrypto.deriveKey(password, salt, iterations)
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
    const plaintext = JSON.stringify(data)
    let encrypted = cipher.update(plaintext, 'utf8', 'hex')
    encrypted += cipher.final('hex')
    const tag = cipher.getAuthTag().toString('hex')

    return {
      payload: encrypted,
      crypto: {
        algorithm: 'AES-256-GCM',
        kdf: 'PBKDF2',
        iterations,
        salt: salt.toString('hex'),
        iv: iv.toString('hex'),
        tag
      }
    }
  }

  /**
   * 使用 AES-256-GCM 解密载荷
   */
  public static decryptPayload(encryptedHex: string, password: string, meta: CryptoMetadata): any {
    if (!password) {
      throw new Error('请输入解密密码')
    }
    if (meta.algorithm !== 'AES-256-GCM' || meta.kdf !== 'PBKDF2') {
      throw new Error(`不支持的加密算法规范: ${meta.algorithm} / ${meta.kdf}`)
    }
    try {
      const salt = Buffer.from(meta.salt, 'hex')
      const iv = Buffer.from(meta.iv, 'hex')
      const tag = Buffer.from(meta.tag, 'hex')
      const key = ConfigBackupCrypto.deriveKey(password, salt, meta.iterations || 100_000)
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
      decipher.setAuthTag(tag)
      let decrypted = decipher.update(encryptedHex, 'hex', 'utf8')
      decrypted += decipher.final('utf8')
      return JSON.parse(decrypted)
    } catch (err: any) {
      throw new Error('密码错误或备份文件已被篡改')
    }
  }
}
