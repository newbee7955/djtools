import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { EventEmitter } from 'node:events'
import { SignalingClient } from '../src/main/services/remote-assist/signaling-client.ts'
import { RemoteAssistService } from '../src/main/services/remote-assist/remote-assist-service.ts'
import { DeviceIdentityStore } from '../src/main/services/remote-assist/device-identity-store.ts'

class MockWebSocket extends EventEmitter {
  constructor(url) {
    super()
    this.url = url
    this.readyState = 0 // CONNECTING
    this.sentMessages = []

    process.nextTick(() => {
      this.readyState = 1 // OPEN
      this.emit('open')
    })
  }

  send(data) {
    this.sentMessages.push(JSON.parse(data))
  }

  close() {
    this.readyState = 3 // CLOSED
    this.emit('close')
  }

  simulateServerMessage(msg) {
    this.emit('message', Buffer.from(JSON.stringify(msg)))
  }
}

class MemoryStore {
  constructor() {
    this.storage = new Map()
  }
  get(key) { return this.storage.get(key) }
  set(key, value) { this.storage.set(key, value) }
  has(key) { return this.storage.has(key) }
}

function createTestHarness() {
  let activeMockWs = null
  const identityStore = new DeviceIdentityStore({
    kvStore: new MemoryStore()
  })

  const createWs = (url) => {
    activeMockWs = new MockWebSocket(url)
    return activeMockWs
  }

  const signalingClient = new SignalingClient({
    signalingUrl: 'wss://test.signaling.com/v1/signal',
    createWebSocket: createWs,
    heartbeatIntervalMs: 100000 // avoid timer in test
  })

  const service = new RemoteAssistService({
    identityStore,
    signalingClient,
    displayName: 'Test Machine'
  })

  return {
    service,
    signalingClient,
    getWs: () => activeMockWs
  }
}

test('SignalingClient: connects and automatically registers local device code', async () => {
  const { service, signalingClient, getWs } = createTestHarness()
  await service.initialize()
  await signalingClient.connect()

  const ws = getWs()
  assert.ok(ws)
  assert.equal(ws.sentMessages.length >= 1, true)

  const registerMsg = ws.sentMessages[0]
  assert.equal(registerMsg.type, 'register')
  assert.match(registerMsg.from, /^\d{3} \d{3} \d{3}$/)
  assert.equal(registerMsg.v, 1)
})

test('RemoteAssistService: controller initiates session request with optional safetyCode', async () => {
  const { service, signalingClient, getWs } = createTestHarness()
  await service.initialize()
  await signalingClient.connect()

  const targetCode = '123 456 789'
  await service.requestSession(targetCode, 'control', '582 109')

  assert.equal(service.getState().phase, 'requesting')
  assert.equal(service.getState().role, 'controller')
  assert.equal(service.getState().safetyCode, '582 109')

  const ws = getWs()
  const requestMsg = ws.sentMessages.find((m) => m.type === 'session-request')
  assert.ok(requestMsg)
  assert.equal(requestMsg.to, targetCode)
  assert.equal(requestMsg.payload.permission, 'control')
  assert.equal(requestMsg.payload.safetyCode, '582 109')
})

test('RemoteAssistService: controlled handles incoming request and verifies persistent safety code', async () => {
  const { service, signalingClient, getWs } = createTestHarness()
  await service.initialize()
  await signalingClient.connect()

  const info = await service.getDeviceInfo()
  assert.match(info.safetyCode, /^\d{6}$/)

  let incomingRequestEvent = null
  service.onEvent((event) => {
    if (event.type === 'incoming-request') {
      incomingRequestEvent = event
    }
  })

  const ws = getWs()
  const now = Date.now()
  ws.simulateServerMessage({
    v: 1,
    type: 'session-request',
    from: '999 888 777',
    to: info.deviceCode,
    timestamp: now,
    payload: {
      sessionId: 's_req_123',
      fromDisplayName: 'Alice Laptop',
      permission: 'control',
      safetyCode: info.safetyCode,
      nonce: 'test_nonce_123',
      timestamp: now
    }
  })

  assert.ok(incomingRequestEvent)
  assert.equal(incomingRequestEvent.fromDeviceCode, '999 888 777')
  assert.equal(incomingRequestEvent.fromDisplayName, 'Alice Laptop')
  assert.equal(incomingRequestEvent.safetyCode, info.safetyCode)
  assert.equal(incomingRequestEvent.safetyCodeMatched, true)
  assert.equal(service.getState().phase, 'awaiting-consent')

  // Test manual refresh of safety code
  const oldCode = info.safetyCode
  const newCode = service.refreshSafetyCode()
  assert.match(newCode, /^\d{6}$/)
  assert.notEqual(newCode, oldCode)
  const updatedInfo = await service.getDeviceInfo()
  assert.equal(updatedInfo.safetyCode, newCode)

  // Approve with control
  await service.respondToSession(incomingRequestEvent.requestId, 'control')
  assert.equal(service.getState().phase, 'connecting')

  const responseMsg = ws.sentMessages.find((m) => m.type === 'session-response')
  assert.ok(responseMsg)
  assert.equal(responseMsg.to, '999 888 777')
  assert.equal(responseMsg.payload.accepted, true)
  assert.equal(responseMsg.payload.permission, 'control')
})

test('RemoteAssistService: view-only session strictly rejects input events', async () => {
  const { service } = createTestHarness()
  await service.initialize()

  // Manually set internal state to connected with view permission
  service.testSetState({
    sessionId: 's_view_only',
    role: 'controlled',
    phase: 'connected',
    permission: 'view',
    peerDeviceCode: '999 888 777'
  })

  assert.throws(() => {
    service.handleRemoteInput({
      type: 'pointer-move',
      sessionId: 's_view_only',
      seq: 1,
      x: 0.5,
      y: 0.5
    })
  }, /view-only/)
})

test('RemoteAssistService: disconnect resets state to idle and releases resources', async () => {
  const { service, signalingClient, getWs } = createTestHarness()
  await service.initialize()
  await signalingClient.connect()

  service.testSetState({
    sessionId: 's_active',
    role: 'controlled',
    phase: 'connected',
    permission: 'control',
    peerDeviceCode: '999 888 777'
  })

  await service.disconnect('user-initiated')
  assert.equal(service.getState().phase, 'idle')

  const ws = getWs()
  const disconnectMsg = ws.sentMessages.find((m) => m.type === 'disconnect')
  assert.ok(disconnectMsg)
})

test('RemoteAssistService: getIceServers delegates to buildIceServers and subscribes to onTurn', async () => {
  const source = await readFile(
    new URL('../src/main/services/remote-assist/remote-assist-service.ts', import.meta.url),
    'utf8'
  )

  assert.match(source, /return buildIceServers\(\{/)
  assert.match(source, /this\.signalingClient\.onTurn\(/)
  assert.match(source, /private async verifyRelayReachability\(/)
})

test('RemoteAssistService: STUN binding probe does not overstate TURN relay allocation success', async () => {
  const source = await readFile(
    new URL('../src/main/services/remote-assist/remote-assist-service.ts', import.meta.url),
    'utf8'
  )

  assert.match(source, /TURN UDP 端点可达（中继分配由 ICE 验证）/)
  assert.match(source, /TURN UDP 端点探测中/)
  assert.doesNotMatch(source, /TURN 中继可用/)
})
