import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { SignalingClient } from '../src/main/services/remote-assist/signaling-client.ts'
import { RemoteAssistService } from '../src/main/services/remote-assist/remote-assist-service.ts'
import { DeviceIdentityStore } from '../src/main/services/remote-assist/device-identity-store.ts'

class MockWebSocket extends EventEmitter {
  constructor(url) {
    super()
    this.url = url
    this.readyState = 1
    this.sentMessages = []
    process.nextTick(() => this.emit('open'))
  }
  send(data) { this.sentMessages.push(JSON.parse(data)) }
  close() { this.readyState = 3; this.emit('close') }
  simulateServerMessage(msg) { this.emit('message', Buffer.from(JSON.stringify(msg))) }
}

class MemoryStore {
  constructor() { this.storage = new Map() }
  get(key) { return this.storage.get(key) }
  set(key, value) { this.storage.set(key, value) }
  has(key) { return this.storage.has(key) }
}

function createHarness(options = {}) {
  let activeMockWs = null
  const identityStore = new DeviceIdentityStore({ kvStore: new MemoryStore() })
  const signalingClient = new SignalingClient({
    signalingUrl: 'wss://test.signaling.com/v1/signal',
    createWebSocket: (url) => {
      activeMockWs = new MockWebSocket(url)
      return activeMockWs
    },
    heartbeatIntervalMs: 100000
  })
  const service = new RemoteAssistService({
    identityStore,
    signalingClient,
    displayName: 'Test Machine',
    inputHelper: options.inputHelper,
    handshakeTimeoutMs: options.handshakeTimeoutMs
  })
  return { service, signalingClient, getWs: () => activeMockWs }
}

async function boot(options) {
  const harness = createHarness(options)
  await harness.service.initialize()
  await harness.signalingClient.connect()
  return harness
}

const envelope = (overrides) => ({
  v: 1,
  timestamp: Date.now(),
  ...overrides
})

test('incoming session-request with a non device-code "from" is rejected', async () => {
  const { service, getWs } = await boot()

  let incoming = null
  service.onEvent((e) => { if (e.type === 'incoming-request') incoming = e })

  getWs().simulateServerMessage(envelope({
    type: 'session-request',
    from: '<img src=x onerror=alert(1)>',
    to: '111 222 333',
    payload: {
      sessionId: 's_malicious',
      fromDisplayName: 'Attacker',
      permission: 'control',
      nonce: 'n1',
      timestamp: Date.now()
    }
  }))

  assert.equal(incoming, null)
  assert.equal(service.getState().phase, 'idle')
})

test('incoming session-request permission is coerced into the view/control whitelist', async () => {
  const { service, getWs } = await boot()

  let incoming = null
  service.onEvent((e) => { if (e.type === 'incoming-request') incoming = e })

  getWs().simulateServerMessage(envelope({
    type: 'session-request',
    from: '999 888 777',
    to: '111 222 333',
    payload: {
      sessionId: 's_perm',
      fromDisplayName: 'Peer',
      permission: "'; require('child_process').exec('calc') //",
      nonce: 'n2',
      timestamp: Date.now()
    }
  }))

  assert.ok(incoming)
  assert.equal(incoming.permission, 'control')
  assert.equal(service.getState().permission, 'control')
})

test('a new session-request is ignored while another session is active', async () => {
  const { service, getWs } = await boot()
  service.testSetState({ phase: 'awaiting-consent', role: 'controlled', sessionId: 's_active', peerDeviceCode: '111 111 111' })

  let incoming = null
  service.onEvent((e) => { if (e.type === 'incoming-request') incoming = e })

  getWs().simulateServerMessage(envelope({
    type: 'session-request',
    from: '222 222 222',
    to: '111 222 333',
    payload: { sessionId: 's_second', fromDisplayName: 'Peer', permission: 'control', nonce: 'n3', timestamp: Date.now() }
  }))

  assert.equal(incoming, null)
  assert.equal(service.getState().sessionId, 's_active')
})

test('offer/answer/ice-candidate from a non-peer device are dropped', async () => {
  const { service, getWs } = await boot()
  service.testSetState({
    phase: 'connecting',
    role: 'controller',
    sessionId: 's_abc',
    permission: 'control',
    peerDeviceCode: '999 888 777'
  })

  const seen = []
  service.onWebRtcSignal((sig) => seen.push(sig))

  // 攻击者设备发来的 offer：来源不匹配，必须丢弃
  getWs().simulateServerMessage(envelope({
    type: 'offer',
    from: '666 666 666',
    to: '111 222 333',
    payload: { sessionId: 's_abc', sdp: { type: 'offer', sdp: 'malicious' } }
  }))
  assert.equal(seen.length, 0)

  // 会话对端发来的 offer：正常透传
  getWs().simulateServerMessage(envelope({
    type: 'offer',
    from: '999 888 777',
    to: '111 222 333',
    payload: { sessionId: 's_abc', sdp: { type: 'offer', sdp: 'legit' } }
  }))
  assert.equal(seen.length, 1)
  assert.equal(seen[0].from, '999 888 777')

  // 对端来源正确但 sessionId 不匹配：同样丢弃
  getWs().simulateServerMessage(envelope({
    type: 'offer',
    from: '999 888 777',
    to: '111 222 333',
    payload: { sessionId: 's_other', sdp: { type: 'offer', sdp: 'stale' } }
  }))
  assert.equal(seen.length, 1)
})

test('disconnect and session-response from a non-peer device are ignored', async () => {
  const { service, getWs } = await boot()
  service.testSetState({
    phase: 'connected',
    role: 'controlled',
    sessionId: 's_live',
    permission: 'control',
    peerDeviceCode: '999 888 777'
  })

  getWs().simulateServerMessage(envelope({
    type: 'disconnect',
    from: '666 666 666',
    to: '111 222 333',
    payload: { sessionId: 's_live', reason: 'attack' }
  }))
  assert.equal(service.getState().phase, 'connected')

  service.testSetState({ phase: 'requesting', role: 'controller' })
  getWs().simulateServerMessage(envelope({
    type: 'session-response',
    from: '666 666 666',
    to: '111 222 333',
    payload: { sessionId: 's_live', accepted: true }
  }))
  assert.equal(service.getState().phase, 'requesting')
})

test('remote input is rate limited to a bounded number of events per second', async () => {
  let sent = 0
  const { service } = await boot({ inputHelper: { send: () => { sent++ }, start: async () => {}, stop: async () => {}, releaseAll: async () => {} } })

  service.testSetState({
    phase: 'connected',
    role: 'controlled',
    sessionId: 's_rate',
    permission: 'control',
    peerDeviceCode: '999 888 777'
  })

  // 离散事件（按键）仍受 200/s 限流
  for (let i = 0; i < 500; i++) {
    service.handleRemoteInput({ type: 'key', sessionId: 's_rate', seq: i, code: 'KeyA', pressed: true, modifiers: [] })
  }

  assert.equal(sent, RemoteAssistService.MAX_INPUT_EVENTS_PER_SECOND)
})

test('pointer-move events bypass rate limiter (already rAF-coalesced on controller)', async () => {
  let sent = 0
  const { service } = await boot({ inputHelper: { send: () => { sent++ }, start: async () => {}, stop: async () => {}, releaseAll: async () => {} } })

  service.testSetState({
    phase: 'connected',
    role: 'controlled',
    sessionId: 's_ptr',
    permission: 'control',
    peerDeviceCode: '999 888 777'
  })

  for (let i = 0; i < 500; i++) {
    service.handleRemoteInput({ type: 'pointer-move', sessionId: 's_ptr', seq: i, x: 0.5, y: 0.5 })
  }

  // pointer-move 不受限流，全部通过
  assert.equal(sent, 500)
})

test('SignalingClient: heartbeat watchdog forces a reconnect when the server goes silent', async () => {
  const sockets = []
  const client = new SignalingClient({
    signalingUrl: 'wss://silent.test/v1/signal',
    createWebSocket: (url) => {
      const ws = new MockWebSocket(url)
      sockets.push(ws)
      return ws
    },
    heartbeatIntervalMs: 30,
    livenessTimeoutMs: 80
  })

  let disconnects = 0
  client.onStatus((s) => { if (s === 'disconnected') disconnects++ })

  await client.connect()
  assert.equal(sockets.length, 1)

  // 服务端从不回 pong，看门狗应在 livenessTimeoutMs 后强制断开
  await new Promise((r) => setTimeout(r, 250))

  assert.equal(client.getStatus(), 'disconnected')
  assert.ok(disconnects >= 1, 'should have observed a disconnect')
  assert.equal(sockets[0].readyState, 3)

  client.disconnect()
})

test('SignalingClient: re-registers to refresh TURN credentials before they expire', async () => {
  const sockets = []
  const client = new SignalingClient({
    signalingUrl: 'wss://turn.test/v1/signal',
    createWebSocket: (url) => {
      const ws = new MockWebSocket(url)
      sockets.push(ws)
      return ws
    },
    heartbeatIntervalMs: 30,
    livenessTimeoutMs: 100000
  })
  client.setIdentity({ rawDeviceId: 'r1', deviceCode: '111 222 333', publicKey: 'pk', sign: () => 'sig' }, 'Test')

  await client.connect()
  const ws = sockets[0]
  const registers = () => ws.sentMessages.filter((m) => m.type === 'register').length
  assert.equal(registers(), 1)

  // 服务端下发 30 秒后过期的 TURN 凭据（落在 60s 续期窗口内）
  const expiry = Math.floor(Date.now() / 1000) + 30
  ws.simulateServerMessage({
    v: 1,
    type: 'registered',
    from: 'server',
    to: '111 222 333',
    timestamp: Date.now(),
    payload: { deviceCode: '111 222 333', turn: { username: `${expiry}:111222333`, credential: 'c', urls: ['turn:x:3478'] } }
  })
  assert.ok(client.getTurnConfig())

  await new Promise((r) => setTimeout(r, 120))
  assert.ok(registers() >= 2, 'should re-register to renew TURN credentials')

  client.disconnect()
})

test('service surfaces native local-override events to subscribers', async () => {
  let overrideCb = null
  const inputHelper = {
    send() {},
    start: async () => {},
    stop: async () => {},
    releaseAll: async () => {},
    onOverride: (fn) => {
      overrideCb = fn
      return () => {}
    }
  }
  const { service } = await boot({ inputHelper })

  const types = []
  service.onEvent((e) => types.push(e.type))
  assert.equal(typeof overrideCb, 'function')

  overrideCb()
  assert.ok(types.includes('local-override'))
})

test('SignalingClient: queues handshake signals while offline and flushes on reconnect', async () => {
  const sockets = []
  const client = new SignalingClient({
    signalingUrl: 'wss://queue.test/v1/signal',
    createWebSocket: (url) => {
      const ws = new MockWebSocket(url)
      sockets.push(ws)
      return ws
    },
    heartbeatIntervalMs: 100000
  })
  client.setIdentity({ rawDeviceId: 'r1', deviceCode: '111 222 333', publicKey: 'pk', sign: () => 'sig' }, 'Test')

  await client.connect()
  const first = sockets[0]
  assert.equal(first.sentMessages.filter((m) => m.type === 'register').length, 1)

  // 模拟连接掉线（非手动），此时发送 offer 应被缓存而非丢弃
  first.close()
  assert.equal(client.getStatus(), 'disconnected')

  client.sendSignal('offer', '999 888 777', { sessionId: 's_q', sdp: { type: 'offer', sdp: 'x' } })

  // 重连后应补发缓存的 offer
  await client.connect()
  const second = sockets[sockets.length - 1]
  assert.notEqual(second, first)
  const replayed = second.sentMessages.find((m) => m.type === 'offer')
  assert.ok(replayed, 'queued offer should be flushed after reconnect')
  assert.equal(replayed.payload.sessionId, 's_q')

  client.disconnect()
})

test('RemoteAssistService: aborts a stuck handshake with a timeout instead of hanging at connecting', async () => {
  const { service, getWs } = await boot({ handshakeTimeoutMs: 60 })

  let ended = null
  service.onEvent((e) => {
    if (e.type === 'session-ended') ended = e
  })

  // 走真实 setState 路径：受控端收到请求并授权 -> 进入 connecting 并启动握手超时
  getWs().simulateServerMessage(envelope({
    type: 'session-request',
    from: '999 888 777',
    to: '111 222 333',
    payload: { sessionId: 's_stuck', fromDisplayName: 'Peer', permission: 'view', nonce: 'n_stuck', timestamp: Date.now() }
  }))
  const approved = await service.respondToSession(service.getPendingRequest().requestId, 'view')
  assert.equal(approved, true)
  assert.equal(service.getState().phase, 'connecting')

  await new Promise((r) => setTimeout(r, 200))

  assert.equal(service.getState().phase, 'idle')
  assert.ok(ended)
  assert.equal(ended.reason, 'handshake-timeout')
})

test('duplicate pointer-button seq from dual-channel send is injected only once', async () => {
  const sent = []
  const { service } = await boot({
    inputHelper: {
      send: (event) => { sent.push(event) },
      start: async () => {},
      stop: async () => {},
      releaseAll: async () => {}
    }
  })

  service.testSetState({
    phase: 'connected',
    role: 'controlled',
    sessionId: 's_dup',
    permission: 'control',
    peerDeviceCode: '999 888 777'
  })

  const button = { type: 'pointer-button', sessionId: 's_dup', seq: 7, button: 'left', pressed: true }
  service.handleRemoteInput(button)
  service.handleRemoteInput(button)

  assert.equal(sent.length, 1)
  assert.equal(sent[0].seq, 7)
  assert.equal(sent[0].type, 'pointer-button')
})

test('duplicate wheel seq is injected only once, while pointer-move repeats are kept', async () => {
  const sent = []
  const { service } = await boot({
    inputHelper: {
      send: (event) => { sent.push(event) },
      start: async () => {},
      stop: async () => {},
      releaseAll: async () => {}
    }
  })

  service.testSetState({
    phase: 'connected',
    role: 'controlled',
    sessionId: 's_dup2',
    permission: 'control',
    peerDeviceCode: '999 888 777'
  })

  const wheel = { type: 'wheel', sessionId: 's_dup2', seq: 4, deltaX: 0, deltaY: 120 }
  service.handleRemoteInput(wheel)
  service.handleRemoteInput(wheel)
  service.handleRemoteInput({ type: 'pointer-move', sessionId: 's_dup2', seq: 5, x: 0.2, y: 0.3 })
  service.handleRemoteInput({ type: 'pointer-move', sessionId: 's_dup2', seq: 5, x: 0.2, y: 0.3 })

  assert.equal(sent.filter((e) => e.type === 'wheel').length, 1)
  assert.equal(sent.filter((e) => e.type === 'pointer-move').length, 2)
})
