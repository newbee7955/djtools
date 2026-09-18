import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import {
  DeviceIdentityStore,
  deriveDeviceCodeFromPublicKey,
  deriveSafetyCode,
  generateRandomSafetyCode
} from '../src/main/services/remote-assist/device-identity-store.ts'

class MemoryStore {
  constructor() {
    this.storage = new Map()
  }
  get(key) {
    return this.storage.get(key)
  }
  set(key, value) {
    this.storage.set(key, value)
  }
  has(key) {
    return this.storage.has(key)
  }
}

class FakeSafeStorage {
  isEncryptionAvailable() {
    return true
  }
  encryptString(plainText) {
    return Buffer.from(plainText, 'utf8')
  }
  decryptString(encryptedBuffer) {
    return encryptedBuffer.toString('utf8')
  }
}

test('deriveDeviceCodeFromPublicKey: generates a formatted 9-digit code', () => {
  const code = deriveDeviceCodeFromPublicKey('mock_ed25519_public_key_data')
  assert.match(code, /^\d{3} \d{3} \d{3}$/)
  // Deterministic
  assert.equal(code, deriveDeviceCodeFromPublicKey('mock_ed25519_public_key_data'))
})

test('deriveSafetyCode: derives a stable 6-digit confirmation code from transcript', () => {
  const code = deriveSafetyCode('transcript_data_hash_12345')
  assert.match(code, /^\d{6}$/)
  assert.equal(code, deriveSafetyCode('transcript_data_hash_12345'))
})

test('DeviceIdentityStore: generates and persists stable identity encrypted with safeStorage', async () => {
  const storeMap = new MemoryStore()
  const fakeSafe = new FakeSafeStorage()
  const store = new DeviceIdentityStore({
    kvStore: storeMap,
    safeStorage: fakeSafe
  })

  const id1 = await store.getOrCreate()
  assert.ok(id1.rawDeviceId)
  assert.match(id1.deviceCode, /^\d{3} \d{3} \d{3}$/)
  assert.ok(id1.publicKey)
  assert.equal(typeof id1.sign, 'function')

  // Sign and verify
  const message = 'test-remote-assist-handshake'
  const sig = id1.sign(message)
  const isVerified = crypto.verify(
    null,
    Buffer.from(message, 'utf8'),
    crypto.createPublicKey({ key: Buffer.from(id1.publicKey, 'base64'), format: 'der', type: 'spki' }),
    Buffer.from(sig, 'base64')
  )
  assert.equal(isVerified, true)

  // Re-instantiate store with same underlying storage
  const store2 = new DeviceIdentityStore({
    kvStore: storeMap,
    safeStorage: fakeSafe
  })
  const id2 = await store2.getOrCreate()
  assert.equal(id1.rawDeviceId, id2.rawDeviceId)
  assert.equal(id1.deviceCode, id2.deviceCode)
  assert.equal(id1.publicKey, id2.publicKey)
})

test('DeviceIdentityStore: initializes persistent safetyCode and supports manual refresh', async () => {
  const kv = new MemoryStore()
  const store = new DeviceIdentityStore({ kvStore: kv })

  const code1 = store.getSafetyCode()
  assert.match(code1, /^\d{6}$/)

  // Getting again returns the exact same persistent code
  const code2 = store.getSafetyCode()
  assert.equal(code1, code2)

  // Refresh generates a new 6-digit code
  const refreshedCode = store.refreshSafetyCode()
  assert.match(refreshedCode, /^\d{6}$/)
  assert.equal(store.getSafetyCode(), refreshedCode)

  // Verify generateRandomSafetyCode format
  const rand = generateRandomSafetyCode()
  assert.match(rand, /^\d{6}$/)
})

test('DeviceIdentityStore: no-arg instantiation maintains stable safetyCode across multiple calls', () => {
  const store = new DeviceIdentityStore()
  const code1 = store.getSafetyCode()
  assert.match(code1, /^\d{6}$/)
  const code2 = store.getSafetyCode()
  assert.equal(code1, code2)
})

test('DeviceIdentityStore: preserves safetyCode and signalingUrl when identity is regenerated', async () => {
  const kv = new MemoryStore()
  // 预置一份身份字段残缺但含配置的旧数据，触发重新生成身份
  kv.set('remote_assist_device_identity_v1', {
    rawDeviceId: 'old',
    deviceCode: '111 111 111',
    publicKey: '',
    encryptedPrivateKey: '',
    safetyCode: '654321',
    signalingUrl: 'ws://custom.example:9000'
  })

  const store = new DeviceIdentityStore({ kvStore: kv })
  const identity = await store.getOrCreate()
  assert.ok(identity.deviceCode)
  assert.equal(store.getSafetyCode(), '654321')
  assert.equal(store.getSignalingUrl(), 'ws://custom.example:9000')
})

test('DeviceIdentityStore: round-trips identity when safeStorage is unavailable', async () => {
  const kv = new MemoryStore()
  const store1 = new DeviceIdentityStore({ kvStore: kv })
  const id1 = await store1.getOrCreate()

  const store2 = new DeviceIdentityStore({ kvStore: kv })
  const id2 = await store2.getOrCreate()

  assert.equal(id1.deviceCode, id2.deviceCode)
  assert.equal(id1.publicKey, id2.publicKey)
})

