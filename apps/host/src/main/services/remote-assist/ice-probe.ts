/**
 * 远程协助 ICE 服务器探测 (ICE Probe)
 * 负责解析 ICE URL、探测 STUN/TURN 可达性，并按可达性构建 WebRTC iceServers 列表。
 * 背景：信令服务会下发 TURN 临时凭据，但 coturn 中继可能整机不可达，
 * 若仍把死掉的 turn: 候选塞进 ICE，会导致 701 建连失败、握手显著变慢。
 */

import crypto from 'node:crypto'
import dgram from 'node:dgram'

export interface HostPort {
  host: string
  port: number
}

export interface IceServerSpec {
  urls: string | string[]
  username?: string
  credential?: string
}

/** 当前内置的五个国内高可用 STUN 节点（保持不变） */
export const DOMESTIC_STUN_URLS: string[] = [
  'stun:stun.douyucdn.cn:18000',
  'stun:stun.hitv.com:3478',
  'stun:stun.miwifi.com:3478',
  'stun:stun.chat.bilibili.com:3478',
  'stun:stun.cloudflare.com:3478'
]

/** 自建服务兜底 STUN（与信令主机同址的 coturn） */
export const FALLBACK_STUN_URL = 'stun:117.72.108.46:3478'

/**
 * 解析 ICE URL 中的 host 与 port。
 * 支持 stun:/turns:/turn: 等 scheme，忽略 ?query（如 ?transport=udp|tcp）；
 * 无 host 或无数字端口时返回 null。
 */
export function parseIceUrlHostPort(url: string): HostPort | null {
  if (typeof url !== 'string') return null

  let rest = url.trim()
  if (!rest) return null

  // 去掉 scheme（stun: / stuns: / turn: / turns:）
  const schemeMatch = rest.match(/^(?:stun|stuns|turn|turns):/i)
  if (schemeMatch) {
    rest = rest.slice(schemeMatch[0].length)
  }
  // 兼容 stun://host:port 形式的双斜杠
  if (rest.startsWith('//')) {
    rest = rest.slice(2)
  }
  // 忽略查询串（transport 等）
  const queryIndex = rest.indexOf('?')
  if (queryIndex >= 0) {
    rest = rest.slice(0, queryIndex)
  }

  // host:port —— 取最后一个冒号作为分隔，兼容 IPv4 / 主机名
  const lastColon = rest.lastIndexOf(':')
  if (lastColon <= 0) return null

  const host = rest.slice(0, lastColon).trim()
  const portText = rest.slice(lastColon + 1).trim()
  if (!host) return null
  if (!/^\d+$/.test(portText)) return null

  const port = Number.parseInt(portText, 10)
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return null

  return { host, port }
}

/**
 * 通过 UDP 发送最小 STUN Binding Request 探测目标是否可达。
 * 仅接受事务 ID 匹配的 STUN Binding Success；任意 UDP 回包不能证明 STUN 可用。
 * 无论成功失败都会关闭 socket。
 */
export function probeStunReachable(host: string, port: number, timeoutMs: number = 2000): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let settled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    let socket: dgram.Socket | null = null

    const finish = (result: boolean): void => {
      if (settled) return
      settled = true
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      if (socket) {
        try {
          socket.close()
        } catch {}
        socket = null
      }
      resolve(result)
    }

    try {
      socket = dgram.createSocket('udp4')
    } catch {
      resolve(false)
      return
    }

    // STUN Binding Request: type 0x0001, length 0x0000, magic cookie 0x2112A442, 12 字节随机事务 ID
    const request = Buffer.alloc(20)
    request.writeUInt16BE(0x0001, 0)
    request.writeUInt16BE(0x0000, 2)
    request.writeUInt32BE(0x2112a442, 4)
    crypto.randomBytes(12).copy(request, 8)

    socket.on('message', (message) => {
      if (message.length < 20) return
      if (message.readUInt16BE(0) !== 0x0101) return
      if (message.readUInt32BE(4) !== 0x2112a442) return
      const declaredLength = message.readUInt16BE(2)
      if (declaredLength > message.length - 20) return
      if (!message.subarray(8, 20).equals(request.subarray(8, 20))) return
      finish(true)
    })
    socket.on('error', () => finish(false))

    timer = setTimeout(() => finish(false), timeoutMs)

    try {
      socket.send(request, port, host, (err) => {
        if (err) finish(false)
      })
    } catch {
      finish(false)
    }
  })
}

/**
 * 依据探测结果构建 WebRTC iceServers 列表（纯函数）。
 * - 始终保留五个国内 STUN 节点；
 * - TURN UDP 探测失败时只剔除 UDP URL，显式 TCP/TLS TURN 仍保留；
 * - 兜底 STUN 仅在未被探测为不可达时加入。
 */
export function buildIceServers(opts: {
  turn: { username: string; credential: string; urls: string[] } | null
  turnReachable: boolean | null
  fallbackStunReachable: boolean | null
}): IceServerSpec[] {
  const servers: IceServerSpec[] = []
  const seenUrls = new Set<string>()

  const addStunServer = (url: string): void => {
    const normalized = url.trim()
    if (!normalized || seenUrls.has(normalized)) return
    seenUrls.add(normalized)
    servers.push({ urls: normalized })
  }

  // 1. 国内高可用极速 STUN 节点置顶（实测延迟 25ms~35ms）
  for (const url of DOMESTIC_STUN_URLS) {
    addStunServer(url)
  }

  // 2. 信令服务器动态下发的 TURN 中继节点。
  // UDP Binding 无响应只能否定 UDP 端点，不能否定同组显式 TCP/TLS URL。
  const { turn, turnReachable, fallbackStunReachable } = opts
  if (turn && turn.urls.length > 0) {
    const turnUrls: string[] = []
    for (const rawUrl of turn.urls) {
      const url = rawUrl.trim()
      if (!url || seenUrls.has(url)) continue
      if (/^stuns?:/i.test(url)) {
        addStunServer(url)
      } else {
        const isUdpTurn = /^turn:/i.test(url) && !/[?&]transport=(?:tcp|tls)(?:&|$)/i.test(url)
        if (turnReachable === false && isUdpTurn) continue
        seenUrls.add(url)
        turnUrls.push(url)
      }
    }
    if (turnUrls.length > 0) {
      servers.push({
        urls: turnUrls,
        username: turn.username,
        credential: turn.credential
      })
    }
  }

  // 3. 自建服务兜底 STUN（仅当未被探测为不可达时）
  if (fallbackStunReachable !== false) {
    addStunServer(FALLBACK_STUN_URL)
  }

  return servers
}
