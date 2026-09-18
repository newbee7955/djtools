/**
 * 远程协助公共信令服务 (Public Signaling Service)
 * 基于原生 Node.js HTTP/WebSocket 实现的高性能无外部依赖信令网关
 */

import http from 'node:http'
import crypto from 'node:crypto'
import { SessionRegistry } from './session-registry.ts'
import { generateTurnCredentials } from './turn-credentials.ts'
import { normalizeDeviceCode, verifyRegisterIdentity } from './identity.ts'

export interface SignalServerOptions {
  port?: number
  turnSecret?: string
  turnHost?: string
  authToken?: string
}

/** 单帧/单消息最大字节数，防止内存耗尽型 DoS */
const MAX_FRAME_BYTES = 512 * 1024
/** 背压时允许积压的最大待发帧数 */
const MAX_WRITE_QUEUE_FRAMES = 256
/** 单连接每秒最大消息数 (超出丢弃) */
const MAX_MESSAGES_PER_SECOND = 40

export class WebSocketConnection {
  private socket: any
  private buffer: Buffer = Buffer.alloc(0)
  private messageCallback?: (msg: any) => void
  private closeCallback?: () => void
  private messageCount = 0
  private lastSecond = Math.floor(Date.now() / 1000)
  private fragmentOpcode: number | null = null
  private fragments: Buffer[] = []
  private fragmentLength = 0
  private writeQueue: Buffer[] = []
  private backpressured = false
  private closed = false

  constructor(socket: any) {
    this.socket = socket
    this.setupSocket()
  }

  public onMessage(cb: (msg: any) => void): void {
    this.messageCallback = cb
  }

  public onClose(cb: () => void): void {
    this.closeCallback = cb
  }

  private setupSocket(): void {
    this.socket.on('data', (chunk: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, chunk])
      this.processBuffer()
    })

    this.socket.on('close', () => this.handleClose())

    this.socket.on('error', () => this.handleClose())

    this.socket.on('drain', () => {
      this.backpressured = false
      this.flushWriteQueue()
    })
  }

  private handleClose(): void {
    if (this.closed) return
    this.closed = true
    this.writeQueue = []
    this.closeCallback?.()
  }

  private processBuffer(): void {
    while (!this.closed && this.buffer.length >= 2) {
      const b0 = this.buffer[0]
      const b1 = this.buffer[1]

      const fin = (b0 & 0x80) !== 0
      const rsv = b0 & 0x70
      const opcode = b0 & 0x0f
      const masked = (b1 & 0x80) !== 0
      let payloadLen = b1 & 0x7f
      let offset = 2

      if (payloadLen === 126) {
        if (this.buffer.length < 4) return
        payloadLen = this.buffer.readUInt16BE(2)
        offset = 4
      } else if (payloadLen === 127) {
        if (this.buffer.length < 10) return
        payloadLen = Number(this.buffer.readBigUInt64BE(2))
        offset = 10
      }

      if (rsv !== 0) {
        this.closeWithCode(1002) // 协议错误: 不支持的扩展位
        return
      }
      if (payloadLen > MAX_FRAME_BYTES) {
        this.closeWithCode(1009) // 消息过大
        return
      }
      if (!masked) {
        this.closeWithCode(1002) // 客户端帧必须加掩码
        return
      }
      if (this.buffer.length < offset + 4) return

      const maskKey = this.buffer.subarray(offset, offset + 4)
      offset += 4

      if (this.buffer.length < offset + payloadLen) return

      const payload = Buffer.from(this.buffer.subarray(offset, offset + payloadLen))
      this.buffer = this.buffer.subarray(offset + payloadLen)
      for (let i = 0; i < payload.length; i++) {
        payload[i] ^= maskKey[i % 4]
      }

      // 控制帧 (0x8 close / 0x9 ping / 0xA pong)：不可分片，载荷 <= 125
      if (opcode >= 0x8) {
        if (!fin || payloadLen > 125) {
          this.closeWithCode(1002)
          return
        }
        if (opcode === 0x8) {
          this.closeWithCode(1000)
          return
        }
        if (opcode === 0x9) {
          this.sendFrame(0xa, payload)
        }
        continue
      }

      // 数据帧
      if (opcode === 0x0) {
        // 续帧
        if (this.fragmentOpcode === null) {
          this.closeWithCode(1002)
          return
        }
        this.fragments.push(payload)
        this.fragmentLength += payload.length
        if (this.fragmentLength > MAX_FRAME_BYTES) {
          this.closeWithCode(1009)
          return
        }
        if (fin) {
          const full = Buffer.concat(this.fragments)
          const initialOpcode = this.fragmentOpcode
          this.fragments = []
          this.fragmentOpcode = null
          this.fragmentLength = 0
          this.handleDataFrame(initialOpcode, full)
        }
      } else if (opcode === 0x1 || opcode === 0x2) {
        if (this.fragmentOpcode !== null) {
          this.closeWithCode(1002)
          return
        }
        if (fin) {
          this.handleDataFrame(opcode, payload)
        } else {
          this.fragmentOpcode = opcode
          this.fragments = [payload]
          this.fragmentLength = payload.length
        }
      } else {
        this.closeWithCode(1002)
        return
      }
    }
  }

  private handleDataFrame(opcode: number, payload: Buffer): void {
    if (opcode !== 0x1) return // 仅处理文本帧

    const nowSec = Math.floor(Date.now() / 1000)
    if (nowSec === this.lastSecond) {
      this.messageCount++
      if (this.messageCount > MAX_MESSAGES_PER_SECOND) {
        return // 超过速率限制，丢弃
      }
    } else {
      this.lastSecond = nowSec
      this.messageCount = 1
    }

    try {
      const json = JSON.parse(payload.toString('utf8'))
      this.messageCallback?.(json)
    } catch {}
  }

  public send(data: any): void {
    const text = typeof data === 'string' ? data : JSON.stringify(data)
    this.sendFrame(0x1, Buffer.from(text, 'utf8'))
  }

  private sendFrame(opcode: number, payload: Buffer): void {
    if (this.closed || !this.socket.writable) return

    const len = payload.length
    let header: Buffer

    if (len <= 125) {
      header = Buffer.from([0x80 | opcode, len])
    } else if (len <= 65535) {
      header = Buffer.alloc(4)
      header[0] = 0x80 | opcode
      header[1] = 126
      header.writeUInt16BE(len, 2)
    } else {
      header = Buffer.alloc(10)
      header[0] = 0x80 | opcode
      header[1] = 127
      header.writeBigUInt64BE(BigInt(len), 2)
    }

    this.enqueue(Buffer.concat([header, payload]))
  }

  private enqueue(frame: Buffer): void {
    if (this.closed) return

    if (this.backpressured) {
      if (this.writeQueue.length >= MAX_WRITE_QUEUE_FRAMES) {
        this.closeWithCode(1009)
        return
      }
      this.writeQueue.push(frame)
      return
    }

    try {
      const ok = this.socket.write(frame)
      if (ok === false) {
        this.backpressured = true
      }
    } catch {}
  }

  private flushWriteQueue(): void {
    while (!this.backpressured && this.writeQueue.length > 0) {
      const frame = this.writeQueue.shift() as Buffer
      try {
        const ok = this.socket.write(frame)
        if (ok === false) {
          this.backpressured = true
          return
        }
      } catch {
        return
      }
    }
  }

  public close(): void {
    this.closeWithCode(1000)
  }

  private closeWithCode(code: number): void {
    if (this.closed) return
    this.closed = true

    try {
      if (this.socket.writable) {
        const payload = Buffer.alloc(2)
        payload.writeUInt16BE(code, 0)
        // 直接写关闭帧，绕过背压队列，确保尽快发出
        this.socket.write(Buffer.concat([Buffer.from([0x88, payload.length]), payload]))
      }
    } catch {}

    this.writeQueue = []
    try {
      this.socket.destroy()
    } catch {}
    this.closeCallback?.()
  }
}

export class SignalServer {
  private server: http.Server
  private registry = new SessionRegistry()
  private port: number
  private turnSecret?: string
  private turnHost: string
  private authToken?: string
  private activeConnections = new Set<WebSocketConnection>()

  constructor(options: SignalServerOptions = {}) {
    this.port = options.port !== undefined ? options.port : 8080
    this.turnSecret = options.turnSecret || process.env.TURN_SECRET
    this.turnHost = options.turnHost || process.env.TURN_HOST || 'turn.doujiao.dev'
    this.authToken = options.authToken || process.env.SIGNAL_AUTH_TOKEN || process.env.AUTH_TOKEN

    this.server = http.createServer((req, res) => {
      if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ status: 'ok', onlineDevices: this.registry.count }))
        return
      }
      res.writeHead(404)
      res.end()
    })

    this.setupUpgradeHandler()
  }

  private setupUpgradeHandler(): void {
    this.server.on('upgrade', (req, socket) => {
      if (this.authToken) {
        try {
          const reqUrl = new URL(req.url || '/', 'http://localhost')
          const clientToken = reqUrl.searchParams.get('token') || req.headers['x-auth-token']
          if (clientToken !== this.authToken) {
            socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\nUnauthorized\r\n')
            socket.destroy()
            return
          }
        } catch {
          socket.destroy()
          return
        }
      }

      const version = req.headers['sec-websocket-version']
      if (version !== '13') {
        socket.write('HTTP/1.1 426 Upgrade Required\r\nSec-WebSocket-Version: 13\r\nConnection: close\r\n\r\n')
        socket.destroy()
        return
      }

      const key = req.headers['sec-websocket-key']
      if (!key) {
        socket.destroy()
        return
      }

      const acceptKey = crypto
        .createHash('sha1')
        .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
        .digest('base64')

      socket.write(
        'HTTP/1.1 101 Switching Protocols\r\n' +
          'Upgrade: websocket\r\n' +
          'Connection: Upgrade\r\n' +
          'Sec-WebSocket-Accept: ' +
          acceptKey +
          '\r\n\r\n'
      )

      const conn = new WebSocketConnection(socket)
      this.activeConnections.add(conn)

      conn.onClose(() => {
        this.activeConnections.delete(conn)
        this.registry.unregisterBySocket(conn)
      })

      conn.onMessage((msg) => {
        this.handleMessage(conn, msg)
      })
    })
  }

  private handleMessage(sender: WebSocketConnection, msg: any): void {
    if (!msg || typeof msg !== 'object') return

    const { type, from, to } = msg

    if (type === 'register' && from) {
      // 强制校验 Ed25519 签名 + 公钥派生设备代码，杜绝设备码冒充
      const verdict = verifyRegisterIdentity({
        deviceCode: from,
        publicKey: msg.payload?.publicKey,
        sig: msg.sig,
        timestamp: msg.timestamp,
        displayName: msg.payload?.displayName
      })

      if (!verdict.ok) {
        console.warn(`[SignalServer] 拒绝无效注册 (${verdict.reason}): ${from}`)
        sender.send({
          v: 1,
          type: 'error',
          from: 'server',
          to: from,
          timestamp: Date.now(),
          payload: {
            code: 'REGISTER_REJECTED',
            message: `设备身份校验失败: ${verdict.reason}`
          }
        })
        sender.close()
        return
      }

      this.registry.register(from, sender, msg.payload?.displayName, msg.payload?.publicKey)

      let turnCreds = undefined
      if (this.turnSecret) {
        turnCreds = generateTurnCredentials(from, this.turnSecret, this.turnHost)
      }

      sender.send({
        v: 1,
        type: 'registered',
        from: 'server',
        to: from,
        timestamp: Date.now(),
        payload: {
          deviceCode: from,
          turn: turnCreds
        }
      })
      return
    }

    // 除注册外，所有信令必须来自已注册且身份一致的连接
    const boundDevice = this.registry.getBySocket(sender)
    if (!boundDevice || normalizeDeviceCode(boundDevice.deviceCode) !== normalizeDeviceCode(from)) {
      console.warn(`[SignalServer] 拒绝来源未注册或身份不符的信令: from=${from} type=${type}`)
      sender.send({
        v: 1,
        type: 'error',
        from: 'server',
        to: typeof from === 'string' ? from : 'unknown',
        timestamp: Date.now(),
        payload: {
          code: 'IDENTITY_MISMATCH',
          message: '发送方未注册或 from 与绑定身份不一致'
        }
      })
      return
    }

    // 响应客户端应用层心跳 ping
    if (type === 'ping') {
      sender.send({
        v: 1,
        type: 'pong',
        from: 'server',
        to: typeof from === 'string' ? from : boundDevice.deviceCode,
        timestamp: Date.now()
      })
      return
    }

    if (typeof to !== 'string' || !to) return

    const destination = this.registry.get(to)
    if (!destination) {
      // 目标设备未连接
      sender.send({
        v: 1,
        type: 'error',
        from: 'server',
        to: from,
        timestamp: Date.now(),
        payload: {
          code: 'PEER_OFFLINE',
          message: `目标设备 ${to} 不在线或代码错误`
        }
      })
      return
    }

    // 转发信令到目标设备
    destination.socket.send(msg)
  }

  public start(): Promise<number> {
    return new Promise((resolve) => {
      this.server.listen(this.port, '0.0.0.0', () => {
        const addr = this.server.address() as any
        const actualPort = addr ? addr.port : this.port
        resolve(actualPort)
      })
    })
  }

  public stop(): Promise<void> {
    for (const conn of this.activeConnections) {
      conn.close()
    }
    this.activeConnections.clear()

    if (typeof (this.server as any).closeAllConnections === 'function') {
      try {
        ;(this.server as any).closeAllConnections()
      } catch {}
    }

    return new Promise((resolve) => {
      this.server.close(() => {
        resolve()
      })
    })
  }
}

// 独立进程启动支持
if (process.argv[1] && (process.argv[1].endsWith('server.ts') || process.argv[1].endsWith('server.js'))) {
  const port = Number(process.env.PORT || 8080)
  const server = new SignalServer({ port })
  server.start().then((p) => {
    console.log(`[SignalServer] 豆角远程协助信令服务已启动，监听端口: ${p}`)
  })
}
