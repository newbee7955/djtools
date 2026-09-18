import test from 'node:test'
import assert from 'node:assert/strict'
import dgram from 'node:dgram'
import {
  parseIceUrlHostPort,
  probeStunReachable,
  buildIceServers,
  DOMESTIC_STUN_URLS,
  FALLBACK_STUN_URL
} from '../src/main/services/remote-assist/ice-probe.ts'

const urlsOf = (servers) => servers.flatMap((server) => (Array.isArray(server.urls) ? server.urls : [server.urls]))

test('parseIceUrlHostPort: parses stun / turn / turn-with-transport / turns', () => {
  assert.deepEqual(parseIceUrlHostPort('stun:stun.douyucdn.cn:18000'), {
    host: 'stun.douyucdn.cn',
    port: 18000
  })
  assert.deepEqual(parseIceUrlHostPort('turn:117.72.108.46:3478'), {
    host: '117.72.108.46',
    port: 3478
  })
  assert.deepEqual(parseIceUrlHostPort('turn:117.72.108.46:3478?transport=udp'), {
    host: '117.72.108.46',
    port: 3478
  })
  assert.deepEqual(parseIceUrlHostPort('turn:117.72.108.46:3478?transport=tcp'), {
    host: '117.72.108.46',
    port: 3478
  })
  assert.deepEqual(parseIceUrlHostPort('turns:turn.example.com:5349'), {
    host: 'turn.example.com',
    port: 5349
  })
})

test('parseIceUrlHostPort: returns null for malformed URLs', () => {
  assert.equal(parseIceUrlHostPort('stun:stun.douyucdn.cn'), null)
  assert.equal(parseIceUrlHostPort('stun:'), null)
  assert.equal(parseIceUrlHostPort(''), null)
  assert.equal(parseIceUrlHostPort('stun:host:not-a-port'), null)
})

test('probeStunReachable: rejects an arbitrary UDP reply that is not a STUN response', async () => {
  const server = dgram.createSocket('udp4')
  server.on('message', (msg, rinfo) => {
    try {
      server.send(Buffer.from('pong'), rinfo.port, rinfo.address)
    } catch {}
  })
  await new Promise((resolve) => server.bind(0, '127.0.0.1', resolve))
  const { port } = server.address()

  try {
    const reachable = await probeStunReachable('127.0.0.1', port, 150)
    assert.equal(reachable, false)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test('probeStunReachable: accepts a valid binding success with the matching transaction ID', async () => {
  const server = dgram.createSocket('udp4')
  server.on('message', (request, rinfo) => {
    try {
      const response = Buffer.alloc(20)
      response.writeUInt16BE(0x0101, 0)
      response.writeUInt16BE(0, 2)
      response.writeUInt32BE(0x2112a442, 4)
      request.copy(response, 8, 8, 20)
      server.send(response, rinfo.port, rinfo.address)
    } catch {}
  })
  await new Promise((resolve) => server.bind(0, '127.0.0.1', resolve))
  const { port } = server.address()

  try {
    const reachable = await probeStunReachable('127.0.0.1', port, 1000)
    assert.equal(reachable, true)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test('probeStunReachable: returns false for a closed UDP port', async () => {
  const temp = dgram.createSocket('udp4')
  await new Promise((resolve) => temp.bind(0, '127.0.0.1', resolve))
  const { port } = temp.address()
  await new Promise((resolve) => temp.close(resolve))

  const reachable = await probeStunReachable('127.0.0.1', port, 300)
  assert.equal(reachable, false)
})

test('buildIceServers: turn null keeps the five domestic STUN entries and no TURN', () => {
  const servers = buildIceServers({ turn: null, turnReachable: null, fallbackStunReachable: null })
  const urls = urlsOf(servers)

  for (const domestic of DOMESTIC_STUN_URLS) {
    assert.ok(urls.includes(domestic), `missing domestic STUN ${domestic}`)
  }
  assert.equal(servers.some((server) => server.username || server.credential), false)
  // 5 个国内 STUN + 1 个兜底 STUN（fallbackStunReachable 为 null 时保留）
  assert.equal(servers.length, 6)
})

test('buildIceServers: TURN omitted when unreachable, included with credentials when reachable', () => {
  const turn = {
    username: 'user-1',
    credential: 'cred-1',
    urls: ['turn:117.72.108.46:3478?transport=udp']
  }

  const omitted = buildIceServers({ turn, turnReachable: false, fallbackStunReachable: null })
  assert.equal(omitted.some((server) => server.username === 'user-1'), false)
  assert.equal(urlsOf(omitted).includes(turn.urls[0]), false)

  const included = buildIceServers({ turn, turnReachable: true, fallbackStunReachable: null })
  const turnEntry = included.find((server) => server.username === 'user-1')
  assert.ok(turnEntry)
  assert.deepEqual(turnEntry.urls, turn.urls)
  assert.equal(turnEntry.credential, 'cred-1')
  // 5 国内 STUN + TURN + 兜底 STUN
  assert.equal(included.length, 7)

  // 未知状态（null）必须保留 TURN，避免探测失败/未探测时把可用中继丢弃
  const unknown = buildIceServers({ turn, turnReachable: null, fallbackStunReachable: null })
  assert.ok(
    unknown.some((server) => server.username === 'user-1'),
    'turnReachable=null must keep the TURN entry'
  )
})

test('buildIceServers: a failed UDP probe does not discard an explicit TCP TURN fallback', () => {
  const udpUrl = 'turn:117.72.108.46:3478?transport=udp'
  const tcpUrl = 'turn:117.72.108.46:3478?transport=tcp'
  const servers = buildIceServers({
    turn: {
      username: 'user-1',
      credential: 'cred-1',
      urls: [udpUrl, tcpUrl]
    },
    turnReachable: false,
    fallbackStunReachable: null
  })

  const turnEntry = servers.find((server) => server.username === 'user-1')
  assert.ok(turnEntry)
  assert.deepEqual(turnEntry.urls, [tcpUrl])
  assert.equal(urlsOf(servers).includes(udpUrl), false)
})

test('buildIceServers: fallback STUN omitted only when probed unreachable', () => {
  const withoutFallback = buildIceServers({ turn: null, turnReachable: null, fallbackStunReachable: false })
  assert.equal(urlsOf(withoutFallback).includes(FALLBACK_STUN_URL), false)
  assert.equal(withoutFallback.length, 5)

  const withFallbackTrue = buildIceServers({ turn: null, turnReachable: null, fallbackStunReachable: true })
  assert.equal(urlsOf(withFallbackTrue).includes(FALLBACK_STUN_URL), true)
  assert.equal(withFallbackTrue.length, 6)

  const withFallbackNull = buildIceServers({ turn: null, turnReachable: null, fallbackStunReachable: null })
  assert.equal(urlsOf(withFallbackNull).includes(FALLBACK_STUN_URL), true)
  assert.equal(withFallbackNull.length, 6)
})

test('buildIceServers: de-duplicates STUN URLs bundled with TURN credentials', () => {
  const turnUrl = 'turn:117.72.108.46:3478?transport=udp'
  const servers = buildIceServers({
    turn: {
      username: 'user-1',
      credential: 'cred-1',
      urls: [FALLBACK_STUN_URL, turnUrl, FALLBACK_STUN_URL]
    },
    turnReachable: true,
    fallbackStunReachable: true
  })

  const urls = urlsOf(servers)
  assert.equal(urls.filter((url) => url === FALLBACK_STUN_URL).length, 1)
  assert.equal(urls.filter((url) => url === turnUrl).length, 1)
  const turnEntry = servers.find((server) => server.username === 'user-1')
  assert.deepEqual(turnEntry?.urls, [turnUrl])
})
