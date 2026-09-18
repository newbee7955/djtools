import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { ConfigBackupCrypto } from '../src/main/services/config-backup-crypto.ts'

test('ConfigBackupCrypto.deriveKey: generates 256-bit key using PBKDF2', () => {
  const salt = Buffer.from('0123456789abcdef0123456789abcdef', 'hex')
  const key1 = ConfigBackupCrypto.deriveKey('SecretPass@123', salt, 1000)
  const key2 = ConfigBackupCrypto.deriveKey('SecretPass@123', salt, 1000)
  const key3 = ConfigBackupCrypto.deriveKey('DifferentPass!', salt, 1000)

  assert.equal(key1.length, 32)
  assert.equal(key1.toString('hex'), key2.toString('hex'))
  assert.notEqual(key1.toString('hex'), key3.toString('hex'))
})

test('ConfigBackupCrypto.encryptPayload / decryptPayload: round-trip encrypts and decrypts payload', () => {
  const sampleData = {
    samba: [
      {
        id: 'samba-nas-1',
        name: '家庭 NAS',
        config: {
          host: '192.168.1.100',
          port: 445,
          username: 'admin',
          password: 'NasPassword#987654',
          share: 'Public'
        }
      }
    ],
    objectStorage: [
      {
        id: 'oss-prod',
        name: '生产 OSS',
        provider: 'oss',
        endpoint: 'oss-cn-hangzhou.aliyuncs.com',
        region: 'cn-hangzhou',
        accessKeyId: 'LTAI5t8abc123456',
        secretAccessKey: 'SecretKeyOSS#998877665544',
        defaultBucket: 'my-prod-bucket'
      }
    ],
    proxy: {
      mode: 'custom',
      customProxyUrl: 'http://127.0.0.1:7890',
      bypassRules: '<local>;localhost'
    }
  }

  const password = 'StrongBackupPassword@2026'
  const { payload, crypto: cryptoMeta } = ConfigBackupCrypto.encryptPayload(sampleData, password)

  assert.ok(payload)
  assert.equal(cryptoMeta.algorithm, 'AES-256-GCM')
  assert.equal(cryptoMeta.kdf, 'PBKDF2')
  assert.equal(cryptoMeta.iterations, 100000)
  assert.equal(cryptoMeta.salt.length, 32) // 16 bytes hex
  assert.equal(cryptoMeta.iv.length, 24) // 12 bytes hex
  assert.equal(cryptoMeta.tag.length, 32) // 16 bytes hex

  // 严禁包含明文密码或密钥
  assert.equal(payload.includes('NasPassword#987654'), false)
  assert.equal(payload.includes('SecretKeyOSS#998877665544'), false)
  assert.equal(payload.includes('192.168.1.100'), false)

  // 正确密码解密
  const decrypted = ConfigBackupCrypto.decryptPayload(payload, password, cryptoMeta)
  assert.deepEqual(decrypted, sampleData)
  assert.equal(decrypted.samba[0].config.password, 'NasPassword#987654')
  assert.equal(decrypted.objectStorage[0].secretAccessKey, 'SecretKeyOSS#998877665544')
})

test('ConfigBackupCrypto: fails decryption with incorrect password', () => {
  const data = { secret: 'sensitive-token-123' }
  const { payload, crypto: cryptoMeta } = ConfigBackupCrypto.encryptPayload(data, 'CorrectPassword@1')

  assert.throws(
    () => ConfigBackupCrypto.decryptPayload(payload, 'WrongPassword@99', cryptoMeta),
    /密码错误或备份文件已被篡改/
  )
})

test('ConfigBackupCrypto: fails decryption when ciphertext or tag is tampered with', () => {
  const data = { secret: 'sensitive-token-123' }
  const { payload, crypto: cryptoMeta } = ConfigBackupCrypto.encryptPayload(data, 'CorrectPassword@1')

  // 篡改密文
  const tamperedPayload = payload.slice(0, -2) + (payload.slice(-2) === 'aa' ? 'bb' : 'aa')
  assert.throws(
    () => ConfigBackupCrypto.decryptPayload(tamperedPayload, 'CorrectPassword@1', cryptoMeta),
    /密码错误或备份文件已被篡改/
  )

  // 篡改 Auth Tag
  const tamperedTag = cryptoMeta.tag.slice(0, -2) + (cryptoMeta.tag.slice(-2) === '11' ? '22' : '11')
  const tamperedMeta = { ...cryptoMeta, tag: tamperedTag }
  assert.throws(
    () => ConfigBackupCrypto.decryptPayload(payload, 'CorrectPassword@1', tamperedMeta),
    /密码错误或备份文件已被篡改/
  )
})

test('ConfigBackupCrypto: rejects passwords shorter than 6 characters', () => {
  assert.throws(
    () => ConfigBackupCrypto.encryptPayload({ foo: 'bar' }, '12345'),
    /加密密码长度不能少于 6 位/
  )
  assert.throws(
    () => ConfigBackupCrypto.encryptPayload({ foo: 'bar' }, ''),
    /加密密码长度不能少于 6 位/
  )
})

test('ConfigBackupService: source contains AES-256-GCM, PBKDF2 and integrity protection', async () => {
  const source = await readFile(new URL('../src/main/services/config-backup-service.ts', import.meta.url), 'utf8')
  assert.match(source, /export class ConfigBackupService/)
  assert.match(source, /exportToFile/)
  assert.match(source, /inspectBackupFile/)
  assert.match(source, /importFromFile/)
  assert.match(source, /ConfigBackupCrypto\.encryptPayload/)
  assert.match(source, /ConfigBackupCrypto\.decryptPayload/)
})
