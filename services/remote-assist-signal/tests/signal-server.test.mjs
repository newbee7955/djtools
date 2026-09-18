import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { EventEmitter } from 'node:events'
import { SignalServer, WebSocketConnection } from '../src/server.ts'
import { generateTurnCredentials } from '../src/turn-credentials.ts'
import { deriveDeviceCodeFromPublicKey } from '../src/identity.ts'

/** 构造一个客户端 -> 服务端的 WebSocket 帧 */
function buildFrame(opcode, payload, options = {}) {
  const fin = options.fin !== false
  const mask = options.mask !== false
  const b0 = (fin ? 0x80 : 0x00) | opcode
  const len = payload.length
  let header
  if (len <= 125) {
    header = Buffer.from([b0, (mask ? 0x80 : 0x00) | len])
  } else if (len <= 65535) {
    header = Buffer.alloc(4)
    header[0] = b0
    header[1] = (mask ? 0x80 : 0x00) | 126
    header.writeUInt16BE(len, 2)
  } else {
    header = Buffer.alloc(10)
    header[0] = b0
    header[1] = (mask ? 0x80 : 0x00) | 127
    header.writeBigUInt64BE(BigInt(len), 2)
  }
  const parts = [header]
  if (mask) {
    const key = Buffer.from([0x01, 0x02, 0x03, 0x04])
    parts.push(key)
    const masked = Buffer.from(payload)
    for (let i = 0; i < masked.length; i++) masked[i] ^= key[i % 4]
    parts.push(masked)
  } else {
    parts.push(Buffer.from(payload))
  }
  return Buffer.concat(parts)
}

class FakeSocket extends EventEmitter {
  constructor() {
    super()
    this.writable = true
    this.written = []
    this.destroyed = false
  }
  write(buf) {
    this.written.push(Buffer.from(buf))
    return true
  }
  destroy() {
    this.destroyed = true
    this.emit('close')
  }
}

test('WebSocketConnection: reassembles fragmented client frames', () => {
  const socket = new FakeSocket()
  const conn = new WebSocketConnection(socket)
  const messages = []
  conn.onMessage((m) => messages.push(m))

  const json = Buffer.from(JSON.stringify({ type: 'ping', from: '111111111' }))
  socket.emit('data', buildFrame(0x1, json.subarray(0, 5), { fin: false }))
  assert.equal(messages.length, 0)
  socket.emit('data', buildFrame(0x0, json.subarray(5), { fin: true }))

  assert.equal(messages.length, 1)
  assert.equal(messages[0].type, 'ping')
})

test('WebSocketConnection: replies to ping with pong and rejects unmasked frames', () => {
  const socket = new FakeSocket()
  const conn = new WebSocketConnection(socket)
  conn.onMessage(() => {})

  socket.emit('data', buildFrame(0x9, Buffer.from('hi')))
  const pong = socket.written.find((b) => (b[0] & 0x0f) === 0xa)
  assert.ok(pong, 'should have written a pong frame')

  const unmasked = new FakeSocket()
  const conn2 = new WebSocketConnection(unmasked)
  conn2.onMessage(() => {})
  unmasked.emit('data', buildFrame(0x1, Buffer.from('{}'), { mask: false }))
  assert.equal(unmasked.destroyed, true)
})

test('WebSocketConnection: closes on an oversized declared frame length', () => {
  const socket = new FakeSocket()
  const conn = new WebSocketConnection(socket)
  conn.onMessage(() => {})

  const header = Buffer.alloc(10)
  header[0] = 0x81
  header[1] = 0x80 | 127
  header.writeBigUInt64BE(BigInt(600 * 1024), 2) // 超过 512KB 上限
  socket.emit('data', header)

  assert.equal(socket.destroyed, true)
})

function createIdentity() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519')
  const pubDer = publicKey.export({ type: 'spki', format: 'der' })
  const publicKeyBase64 = pubDer.toString('base64')
  const deviceCode = deriveDeviceCodeFromPublicKey(publicKeyBase64)
  const sign = (payload) => crypto.sign(null, Buffer.from(payload, 'utf8'), privateKey).toString('base64')
  return { publicKeyBase64, deviceCode, sign }
}

function createTestClient(identity, serverPort, options = {}) {
  let ws = null
  const receivedMessages = []
  const messageResolvers = []

  const connect = async () => {
    return new Promise((resolve, reject) => {
      const query = options.token ? `?token=${options.token}` : ''
      ws = new globalThis.WebSocket(`ws://127.0.0.1:${serverPort}${query}`)
      ws.onopen = () => {
        const timestamp = Date.now()
        const from = options.spoofFrom || identity.deviceCode
        ws.send(JSON.stringify({
          v: 1,
          type: 'register',
          from,
          timestamp,
          sig: options.registerSig !== undefined ? options.registerSig : identity.sign(`${from}:${timestamp}`),
          payload: {
            displayName: `Device ${from}`,
            publicKey: options.spoofPublicKey || identity.publicKeyBase64
          }
        }))
        resolve()
      }
      ws.onerror = reject
      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data)
        if (messageResolvers.length > 0) {
          messageResolvers.shift()(msg)
        } else {
          receivedMessages.push(msg)
        }
      }
    })
  }

  const send = (envelope) => {
    ws.send(JSON.stringify({
      v: 1,
      timestamp: Date.now(),
      from: options.spoofFrom || identity.deviceCode,
      ...envelope
    }))
  }

  const waitForNextMessage = () => {
    if (receivedMessages.length > 0) {
      return Promise.resolve(receivedMessages.shift())
    }
    return new Promise((resolve) => {
      messageResolvers.push(resolve)
    })
  }

  const close = () => {
    if (ws) ws.close()
  }

  return { connect, send, waitForNextMessage, close }
}

test('generateTurnCredentials produces 5-minute ephemeral HMAC credentials', () => {
  const creds = generateTurnCredentials('839 201 442', 'turn_shared_secret_key')
  assert.ok(creds.username)
  assert.ok(creds.credential)
  assert.ok(Array.isArray(creds.urls))
  assert.deepEqual(creds.urls, [
    'turn:turn.doujiao.dev:3478?transport=udp',
    'turn:turn.doujiao.dev:3478?transport=tcp'
  ])
  assert.equal(creds.urls.some((u) => u.startsWith('stun:')), false)
})

test('SignalServer: registers two clients and forwards session envelopes', async () => {
  const server = new SignalServer({ port: 0, turnSecret: 'test_turn_secret' })
  const port = await server.start()

  const idA = createIdentity()
  const idB = createIdentity()
  const clientA = createTestClient(idA, port)
  const clientB = createTestClient(idB, port)

  await clientA.connect()
  await clientB.connect()

  const ackA = await clientA.waitForNextMessage()
  assert.equal(ackA.type, 'registered')
  const ackB = await clientB.waitForNextMessage()
  assert.equal(ackB.type, 'registered')

  clientA.send({
    type: 'session-request',
    to: idB.deviceCode,
    payload: { sessionId: 's_1', permission: 'control', safetyCode: '654321' }
  })

  const reqReceivedByB = await clientB.waitForNextMessage()
  assert.equal(reqReceivedByB.type, 'session-request')
  assert.equal(reqReceivedByB.from, idA.deviceCode)
  assert.equal(reqReceivedByB.payload.safetyCode, '654321')

  clientB.send({
    type: 'session-response',
    to: idA.deviceCode,
    payload: { sessionId: 's_1', accepted: true, permission: 'control' }
  })

  const respReceivedByA = await clientA.waitForNextMessage()
  assert.equal(respReceivedByA.type, 'session-response')
  assert.equal(respReceivedByA.from, idB.deviceCode)
  assert.equal(respReceivedByA.payload.accepted, true)

  clientA.close()
  clientB.close()
  await server.stop()
})

test('SignalServer: returns PEER_OFFLINE error if destination device is not registered', async () => {
  const server = new SignalServer({ port: 0, turnSecret: 'test_turn_secret' })
  const port = await server.start()

  const idA = createIdentity()
  const clientA = createTestClient(idA, port)
  await clientA.connect()
  await clientA.waitForNextMessage() // registered ack

  clientA.send({
    type: 'session-request',
    to: '999 999 999',
    payload: { sessionId: 's_x', permission: 'control' }
  })

  const err = await clientA.waitForNextMessage()
  assert.equal(err.type, 'error')
  assert.equal(err.payload.code, 'PEER_OFFLINE')

  clientA.close()
  await server.stop()
})

test('SignalServer: rejects registration with an invalid signature', async () => {
  const server = new SignalServer({ port: 0 })
  const port = await server.start()

  const idA = createIdentity()
  const other = createIdentity()
  const client = createTestClient(idA, port, {
    // 使用他人私钥签名，签名与声明公钥不匹配
    registerSig: other.sign(`${idA.deviceCode}:${Date.now()}`)
  })
  await client.connect()

  const err = await client.waitForNextMessage()
  assert.equal(err.type, 'error')
  assert.equal(err.payload.code, 'REGISTER_REJECTED')
  assert.match(err.payload.message, /BAD_SIGNATURE/)

  await server.stop()
})

test('SignalServer: rejects registration when device code does not match public key', async () => {
  const server = new SignalServer({ port: 0 })
  const port = await server.start()

  const realIdentity = createIdentity()
  const attacker = createIdentity()
  const client = createTestClient(attacker, port, {
    // 冒充 realIdentity 的设备码，但用 attacker 自己的公钥/签名
    spoofFrom: realIdentity.deviceCode
  })
  await client.connect()

  const err = await client.waitForNextMessage()
  assert.equal(err.type, 'error')
  assert.equal(err.payload.code, 'REGISTER_REJECTED')
  assert.match(err.payload.message, /DEVICE_CODE_MISMATCH/)

  await server.stop()
})

test('SignalServer: rejects forwarded envelopes whose "from" does not match the registered socket', async () => {
  const server = new SignalServer({ port: 0 })
  const port = await server.start()

  const idA = createIdentity()
  const idB = createIdentity()
  const clientA = createTestClient(idA, port)
  const clientB = createTestClient(idB, port)

  await clientA.connect()
  await clientB.connect()
  await clientA.waitForNextMessage() // ack
  await clientB.waitForNextMessage() // ack

  // A 冒充 B 的身份向 B 发送信令
  clientA.send({
    type: 'session-request',
    from: idB.deviceCode,
    to: idB.deviceCode,
    payload: { sessionId: 's_spoof', permission: 'control' }
  })

  const err = await clientA.waitForNextMessage()
  assert.equal(err.type, 'error')
  assert.equal(err.payload.code, 'IDENTITY_MISMATCH')

  clientA.close()
  clientB.close()
  await server.stop()
})

test('SignalServer: rejects unauthorized clients when authToken is configured', async () => {
  const server = new SignalServer({ port: 0, authToken: 'secret123' })
  const port = await server.start()

  await assert.rejects(async () => {
    await new Promise((resolve, reject) => {
      const ws = new globalThis.WebSocket(`ws://127.0.0.1:${port}`)
      ws.onopen = resolve
      ws.onerror = reject
    })
  })

  await assert.rejects(async () => {
    await new Promise((resolve, reject) => {
      const ws = new globalThis.WebSocket(`ws://127.0.0.1:${port}?token=wrong_token`)
      ws.onopen = resolve
      ws.onerror = reject
    })
  })

  const connected = await new Promise((resolve, reject) => {
    const ws = new globalThis.WebSocket(`ws://127.0.0.1:${port}?token=secret123`)
    ws.onopen = () => {
      ws.close()
      resolve(true)
    }
    ws.onerror = reject
  })
  assert.equal(connected, true)

  await server.stop()
})
