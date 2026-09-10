import { app, dialog, shell } from 'electron'
import http from 'http'
import os from 'os'
import path from 'path'
import fs from 'fs'
import { EventEmitter } from 'events'
import QRCode from 'qrcode'
import Busboy from 'busboy'
import type {
  LanTransferServerStatus,
  LanTransferSharedFile,
  LanTransferReceivedFile,
  LanTransferMessage
} from '@doujiao/plugin-sdk'

interface NicItem {
  name: string
  ip: string
  isDefault: boolean
}

interface ConnectedDevice {
  id: string
  deviceName: string
  ip: string
  lastSeen: number
  sseCount: number
}

export class LanTransferService extends EventEmitter {
  private static instance: LanTransferService
  private server: http.Server | null = null
  private running = false
  private currentPort = 8899
  private currentIp = ''
  private saveDirectory: string
  private configFile: string

  private sharedFiles: LanTransferSharedFile[] = []
  private receivedFiles: LanTransferReceivedFile[] = []
  private messages: LanTransferMessage[] = []
  private connectedDevices = new Map<string, ConnectedDevice>()
  private sseClients = new Set<http.ServerResponse>()
  private deviceSseMap = new Map<http.ServerResponse, string>()
  private cleanupTimer: NodeJS.Timeout | null = null

  private authEnabled = true
  private authPin = this.generatePin()
  private autoPinInQr = true
  private authTokens = new Set<string>()

  private constructor() {
    super()
    this.configFile = path.join(app.getPath('userData'), 'lan-transfer-config.json')
    this.saveDirectory = path.join(app.getPath('downloads'), '豆角快传')
    this.loadConfig()
    this.ensureSaveDirectory()
  }

  public static getInstance(): LanTransferService {
    if (!LanTransferService.instance) {
      LanTransferService.instance = new LanTransferService()
    }
    return LanTransferService.instance
  }

  private generatePin(): string {
    return Math.floor(100000 + Math.random() * 900000).toString()
  }

  // --- 配置加载与持久化 ---
  private loadConfig(): void {
    if (fs.existsSync(this.configFile)) {
      try {
        const raw = fs.readFileSync(this.configFile, 'utf-8')
        const data = JSON.parse(raw)
        if (data.saveDirectory && fs.existsSync(data.saveDirectory)) {
          this.saveDirectory = data.saveDirectory
        }
        if (data.receivedFiles && Array.isArray(data.receivedFiles)) {
          this.receivedFiles = data.receivedFiles.filter((f: any) => fs.existsSync(f.localPath))
        }
        if (data.messages && Array.isArray(data.messages)) {
          this.messages = data.messages.slice(-50)
        }
        if (data.authEnabled !== undefined) {
          this.authEnabled = !!data.authEnabled
        }
        if (data.authPin && typeof data.authPin === 'string') {
          this.authPin = data.authPin
        }
        if (data.autoPinInQr !== undefined) {
          this.autoPinInQr = !!data.autoPinInQr
        }
      } catch (err) {
        console.warn('[LanTransferService] 加载配置文件失败:', err)
      }
    }
  }

  private saveConfig(): void {
    try {
      const data = {
        saveDirectory: this.saveDirectory,
        receivedFiles: this.receivedFiles,
        messages: this.messages.slice(-50),
        authEnabled: this.authEnabled,
        authPin: this.authPin,
        autoPinInQr: this.autoPinInQr
      }
      fs.writeFileSync(this.configFile, JSON.stringify(data, null, 2), 'utf-8')
    } catch (err) {
      console.error('[LanTransferService] 写入配置文件失败:', err)
    }
  }

  private ensureSaveDirectory(): void {
    if (!fs.existsSync(this.saveDirectory)) {
      try {
        fs.mkdirSync(this.saveDirectory, { recursive: true })
      } catch (err) {
        console.error('[LanTransferService] 创建接收目录失败:', err)
      }
    }
  }

  // --- 智能多网卡 IPv4 探测 ---
  public getAvailableIps(): NicItem[] {
    const interfaces = os.networkInterfaces()
    const results: NicItem[] = []

    const virtualKeywords = [
      'wsl',
      'vethernet',
      'virtual',
      'vmware',
      'hyper-v',
      'loopback',
      'docker',
      'tailscale',
      'zerotier',
      'tap',
      'tun',
      'pseudo',
      'npcap'
    ]

    for (const [name, addrs] of Object.entries(interfaces)) {
      if (!addrs) continue
      const lowerName = name.toLowerCase()
      const isVirtual = virtualKeywords.some((k) => lowerName.includes(k))
      if (isVirtual) continue

      for (const addr of addrs) {
        // 过滤 IPv6 与回环接口
        if (addr.family !== 'IPv4' || addr.internal) continue
        const ip = addr.address
        if (!ip || ip.startsWith('127.')) continue

        // 仅收录常见局域网 IP
        if (ip.startsWith('192.168.') || ip.startsWith('10.') || ip.startsWith('172.')) {
          results.push({
            name: `${name} (${ip})`,
            ip,
            isDefault: false
          })
        }
      }
    }

    // 智能排序：Wi-Fi / WLAN 优先，192.168.x.x 优先
    results.sort((a, b) => {
      const aLower = a.name.toLowerCase()
      const bLower = b.name.toLowerCase()
      const aWifi = aLower.includes('wi-fi') || aLower.includes('wlan') || aLower.includes('wireless')
      const bWifi = bLower.includes('wi-fi') || bLower.includes('wlan') || bLower.includes('wireless')
      if (aWifi && !bWifi) return -1
      if (!aWifi && bWifi) return 1

      const a192 = a.ip.startsWith('192.168.')
      const b192 = b.ip.startsWith('192.168.')
      if (a192 && !b192) return -1
      if (!a192 && b192) return 1
      return 0
    })

    if (results.length > 0) {
      results[0].isDefault = true
    } else {
      // 兜底回退
      results.push({
        name: '本地回环 (127.0.0.1)',
        ip: '127.0.0.1',
        isDefault: true
      })
    }

    return results
  }

  // --- 二维码生成 ---
  private async generateQrCodeSvg(text: string): Promise<string> {
    try {
      return await QRCode.toString(text, {
        type: 'svg',
        margin: 1,
        color: {
          dark: '#0f172a',
          light: '#ffffff'
        }
      })
    } catch (err) {
      console.error('[LanTransferService] 生成二维码失败:', err)
      return ''
    }
  }

  // --- 启动服务 ---
  public async startServer(options?: {
    port?: number
    ip?: string
    saveDirectory?: string
  }): Promise<LanTransferServerStatus> {
    if (this.running && this.server) {
      if (options?.ip && options.ip !== this.currentIp) {
        this.currentIp = options.ip
      }
      return this.getStatus()
    }

    if (options?.saveDirectory && fs.existsSync(options.saveDirectory)) {
      this.saveDirectory = options.saveDirectory
    }
    this.ensureSaveDirectory()

    const allIps = this.getAvailableIps()
    this.currentIp = options?.ip || (allIps.find((i) => i.isDefault) || allIps[0]).ip
    const desiredPort = options?.port || 8899

    // 端口探活与自增查找
    const listenServer = (port: number): Promise<number> => {
      return new Promise((resolve, reject) => {
        const srv = http.createServer((req, res) => this.handleHttpRequest(req, res))
        srv.once('error', (err: any) => {
          if (err.code === 'EADDRINUSE') {
            srv.close()
            resolve(listenServer(port + 1))
          } else {
            reject(err)
          }
        })
        srv.listen(port, '0.0.0.0', () => {
          this.server = srv
          resolve(port)
        })
      })
    }

    this.currentPort = await listenServer(desiredPort)
    this.running = true
    this.startHousekeeping()
    console.log(`[LanTransferService] 服务已启动: http://${this.currentIp}:${this.currentPort}`)

    this.emitEvent({
      type: 'server-status',
      payload: { running: true, port: this.currentPort, ip: this.currentIp }
    })

    return this.getStatus()
  }

  // --- 停止服务 ---
  public async stopServer(): Promise<boolean> {
    if (!this.running || !this.server) {
      return true
    }

    this.stopHousekeeping()

    // 关闭所有活跃的 SSE 客户端连接
    for (const client of this.sseClients) {
      try {
        client.end()
      } catch {}
    }
    this.sseClients.clear()
    this.deviceSseMap.clear()
    this.connectedDevices.clear()

    return new Promise((resolve) => {
      this.server?.close(() => {
        this.server = null
        this.running = false
        console.log('[LanTransferService] 服务已停止')
        this.emitEvent({
          type: 'server-status',
          payload: { running: false }
        })
        resolve(true)
      })
    })
  }

  // --- 切换网卡绑定 IP ---
  public async switchIp(newIp: string): Promise<LanTransferServerStatus> {
    this.currentIp = newIp
    return this.getStatus()
  }

  // --- 验证码与安全配置 ---
  public async setAuthEnabled(enabled: boolean): Promise<LanTransferServerStatus> {
    this.authEnabled = enabled
    this.saveConfig()
    this.broadcastSse('auth-changed', { authEnabled: this.authEnabled })
    const status = await this.getStatus()
    this.emitEvent({ type: 'server-status', payload: status })
    return status
  }

  public async refreshPin(): Promise<LanTransferServerStatus> {
    this.authPin = this.generatePin()
    this.authTokens.clear()
    this.saveConfig()
    this.broadcastSse('auth-changed', { authEnabled: this.authEnabled, pinRefreshed: true })
    const status = await this.getStatus()
    this.emitEvent({ type: 'server-status', payload: status })
    return status
  }

  public async setAutoPinInQr(enabled: boolean): Promise<LanTransferServerStatus> {
    this.autoPinInQr = enabled
    this.saveConfig()
    const status = await this.getStatus()
    this.emitEvent({ type: 'server-status', payload: status })
    return status
  }

  // --- 心跳保活与自动清理定时器 ---
  private startHousekeeping(): void {
    if (this.cleanupTimer) return
    this.cleanupTimer = setInterval(() => {
      this.housekeeping()
    }, 2000)
  }

  private stopHousekeeping(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = null
    }
  }

  private housekeeping(): void {
    const now = Date.now()
    const toRemove: string[] = []

    for (const [id, dev] of this.connectedDevices.entries()) {
      // 若无活跃 SSE 连接且超过 7 秒无心跳，或者有活跃 SSE 但超过 15 秒无任何交互
      const timeoutLimit = (dev.sseCount || 0) > 0 ? 15000 : 7000
      if (now - dev.lastSeen > timeoutLimit) {
        toRemove.push(id)
      }
    }

    for (const id of toRemove) {
      const dev = this.connectedDevices.get(id)
      if (dev) {
        this.connectedDevices.delete(id)
        console.log(`[LanTransferService] 设备下线 (超时清理): ${dev.deviceName} (${dev.ip})`)
        this.emitEvent({
          type: 'device-disconnected',
          payload: { deviceId: dev.id, deviceName: dev.deviceName, ip: dev.ip }
        })
        this.broadcastSse('device-count', { count: this.connectedDevices.size })
      }
    }
  }

  // --- 获取当前服务状态 ---
  public async getStatus(): Promise<LanTransferServerStatus> {
    const allIps = this.getAvailableIps()
    if (!this.currentIp && allIps.length > 0) {
      this.currentIp = (allIps.find((i) => i.isDefault) || allIps[0]).ip
    }

    const baseUrl = `http://${this.currentIp}:${this.currentPort}`
    const url = this.running && this.authEnabled && this.autoPinInQr
      ? `${baseUrl}?pin=${this.authPin}`
      : baseUrl
    const qrCodeSvg = this.running ? await this.generateQrCodeSvg(url) : ''

    const devices = Array.from(this.connectedDevices.values())

    return {
      running: this.running,
      port: this.currentPort,
      ip: this.currentIp,
      allIps,
      url,
      qrCodeSvg,
      connectedDevices: devices,
      saveDirectory: this.saveDirectory,
      authEnabled: this.authEnabled,
      authPin: this.authPin,
      autoPinInQr: this.autoPinInQr
    }
  }

  // --- 设备识别辅助 ---
  private identifyDevice(userAgent: string): string {
    const ua = userAgent || ''
    if (/iPhone/i.test(ua)) return 'iPhone'
    if (/iPad/i.test(ua)) return 'iPad'
    if (/Android/i.test(ua)) {
      const match = ua.match(/;\s*([^;]+?)\s*Build/i)
      return match ? match[1].trim() : 'Android 手机'
    }
    if (/Macintosh/i.test(ua)) return 'Mac 电脑'
    if (/Windows/i.test(ua)) return 'Windows 电脑'
    return '移动设备'
  }

  private recordDevice(req: http.IncomingMessage, explicitId?: string, customName?: string): ConnectedDevice {
    const ip = req.socket.remoteAddress?.replace(/^.*:/, '') || '127.0.0.1'
    const ua = req.headers['user-agent'] || ''
    const deviceName = customName || this.identifyDevice(ua)
    const deviceId = explicitId || `${ip}_${deviceName}`

    const existing = this.connectedDevices.get(deviceId)
    if (!existing) {
      const dev: ConnectedDevice = {
        id: deviceId,
        deviceName,
        ip,
        lastSeen: Date.now(),
        sseCount: 0
      }
      this.connectedDevices.set(deviceId, dev)
      console.log(`[LanTransferService] 设备上线: ${deviceName} (${ip}) id=${deviceId}`)
      this.emitEvent({
        type: 'device-connected',
        payload: { deviceId, deviceName, ip }
      })
      this.broadcastSse('device-count', { count: this.connectedDevices.size })
      return dev
    } else {
      existing.lastSeen = Date.now()
      if (customName && customName !== existing.deviceName) {
        existing.deviceName = customName
      }
      return existing
    }
  }

  private checkAuth(req: http.IncomingMessage, urlObj: URL): boolean {
    if (!this.authEnabled) return true

    const authHeader = req.headers['authorization'] || ''
    const bearerToken = authHeader.replace(/^Bearer\s+/i, '').trim()
    const customToken = (req.headers['x-auth-token'] as string) || ''
    const queryToken = urlObj.searchParams.get('token') || ''
    const queryPin = urlObj.searchParams.get('pin') || ''

    if (bearerToken && this.authTokens.has(bearerToken)) return true
    if (customToken && this.authTokens.has(customToken)) return true
    if (queryToken && this.authTokens.has(queryToken)) return true
    if (queryPin && queryPin === this.authPin) return true

    return false
  }

  // --- SSE 实时推送 ---
  private broadcastSse(eventType: string, data: any): void {
    const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`
    for (const client of this.sseClients) {
      try {
        client.write(payload)
      } catch {
        this.sseClients.delete(client)
      }
    }
  }

  private emitEvent(event: any): void {
    this.emit('lan-event', event)
  }

  // --- HTTP 请求分发 ---
  private async handleHttpRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const urlObj = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
    const pathname = urlObj.pathname
    const method = req.method?.toUpperCase() || 'GET'

    // 跨域 Header（支持各类移动端浏览器）
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range')
    if (method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    // 1. 移动端 H5 主页
    if (pathname === '/' || pathname === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(this.getMobileH5Html())
      return
    }

    // 2. 状态查询 API（供未认证手机探测环境）
    if (pathname === '/api/status' && method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          pcName: os.hostname(),
          os: `${os.type()} ${os.release()}`,
          ip: this.currentIp,
          port: this.currentPort,
          saveDirectory: this.saveDirectory,
          authRequired: this.authEnabled
        })
      )
      return
    }

    // 3. 验证码校验 API
    if (pathname === '/api/auth/verify' && method === 'POST') {
      let body = ''
      req.on('data', (chunk) => (body += chunk))
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body || '{}')
          const submittedPin = (parsed.pin || '').trim()
          const clientDeviceName = (parsed.deviceName || '').trim()
          const clientDeviceId = (parsed.deviceId || '').trim()

          if (!this.authEnabled || submittedPin === this.authPin) {
            const token = Math.random().toString(36).slice(2) + Date.now().toString(36)
            this.authTokens.add(token)
            const dev = this.recordDevice(req, clientDeviceId, clientDeviceName)

            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(
              JSON.stringify({
                success: true,
                token,
                deviceId: dev.id,
                deviceName: dev.deviceName
              })
            )
          } else {
            res.writeHead(401, { 'Content-Type': 'application/json' })
            res.end(
              JSON.stringify({
                success: false,
                error: '验证码错误，请重新核对电脑端显示的 6 位 PIN 码'
              })
            )
          }
        } catch (e: any) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: false, error: '请求数据格式错误' }))
        }
      })
      return
    }

    // 4. 设备退出通知（手机关闭网页或卸载页面上报）
    if (pathname === '/api/leave') {
      const deviceId = urlObj.searchParams.get('id') || urlObj.searchParams.get('deviceId')
      if (deviceId && this.connectedDevices.has(deviceId)) {
        const dev = this.connectedDevices.get(deviceId)!
        this.connectedDevices.delete(deviceId)
        console.log(`[LanTransferService] 手机端主动离开: ${dev.deviceName} (${dev.ip}) id=${deviceId}`)
        this.emitEvent({
          type: 'device-disconnected',
          payload: { deviceId: dev.id, deviceName: dev.deviceName, ip: dev.ip }
        })
        this.broadcastSse('device-count', { count: this.connectedDevices.size })
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ success: true }))
      return
    }

    // 5. 设备保活心跳
    if (pathname === '/api/heartbeat') {
      if (!this.checkAuth(req, urlObj)) {
        res.writeHead(401, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Unauthorized', needPin: true }))
        return
      }
      const deviceId = urlObj.searchParams.get('id') || urlObj.searchParams.get('deviceId')
      if (deviceId && this.connectedDevices.has(deviceId)) {
        const dev = this.connectedDevices.get(deviceId)!
        dev.lastSeen = Date.now()
      } else if (deviceId) {
        this.recordDevice(req, deviceId)
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ success: true, timestamp: Date.now() }))
      return
    }

    // --- 受控鉴权拦截 ---
    if (!this.checkAuth(req, urlObj)) {
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ success: false, error: 'Unauthorized', needPin: true }))
      return
    }

    const clientDeviceId = urlObj.searchParams.get('id') || urlObj.searchParams.get('deviceId')
    const currentDevice = this.recordDevice(req, clientDeviceId || undefined)
    const deviceName = currentDevice.deviceName

    // 6. SSE 实时事件流
    if (pathname === '/api/events' && method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive'
      })
      res.write(`event: init\ndata: ${JSON.stringify({ connected: true })}\n\n`)
      this.sseClients.add(res)
      this.deviceSseMap.set(res, currentDevice.id)
      currentDevice.sseCount = (currentDevice.sseCount || 0) + 1

      req.on('close', () => {
        this.sseClients.delete(res)
        const dId = this.deviceSseMap.get(res)
        this.deviceSseMap.delete(res)
        if (dId && this.connectedDevices.has(dId)) {
          const target = this.connectedDevices.get(dId)!
          target.sseCount = Math.max(0, (target.sseCount || 1) - 1)
          if (target.sseCount === 0) {
            // 当 SSE 连接断开且无其它活跃连接时，将 lastSeen 提前以触发快速离线清理
            target.lastSeen = Date.now() - 5000
          }
        }
      })
      return
    }

    // 4. 获取电脑端待发/共享文件列表
    if (pathname === '/api/files' && method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          files: this.sharedFiles.map((f) => ({
            id: f.id,
            name: f.name,
            size: f.size,
            mimeType: f.mimeType,
            createdAt: f.createdAt,
            downloadCount: f.downloadCount
          }))
        })
      )
      return
    }

    // 5. 手机端下载电脑文件 (支持 HTTP Range 断点续传与媒体播放)
    if (pathname.startsWith('/api/download/') && method === 'GET') {
      const fileId = pathname.replace('/api/download/', '').trim()
      const target = this.sharedFiles.find((f) => f.id === fileId)
      if (!target || !fs.existsSync(target.localPath)) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end('文件不存在或已被移除')
        return
      }

      target.downloadCount = (target.downloadCount || 0) + 1
      this.emitEvent({
        type: 'share-downloaded',
        payload: { fileId: target.id, fileName: target.name, deviceName }
      })
      this.broadcastSse('files-updated', { files: this.sharedFiles })

      const filePath = target.localPath
      const stat = fs.statSync(filePath)
      const fileSize = stat.size
      const range = req.headers.range

      const encodedName = encodeURIComponent(target.name)
      const disposition = `attachment; filename="${encodedName}"; filename*=UTF-8''${encodedName}`

      if (range) {
        const parts = range.replace(/bytes=/, '').split('-')
        const start = parseInt(parts[0], 10)
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1
        const chunksize = end - start + 1
        const stream = fs.createReadStream(filePath, { start, end })

        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunksize,
          'Content-Type': target.mimeType || 'application/octet-stream',
          'Content-Disposition': disposition
        })
        stream.pipe(res)
      } else {
        res.writeHead(200, {
          'Content-Length': fileSize,
          'Content-Type': target.mimeType || 'application/octet-stream',
          'Content-Disposition': disposition
        })
        fs.createReadStream(filePath).pipe(res)
      }
      return
    }

    // 6. 手机端流式上传文件 (Phone -> PC)
    if (pathname === '/api/upload' && method === 'POST') {
      const clientIp = req.socket.remoteAddress?.replace(/^.*:/, '') || '127.0.0.1'
      let busboy: any
      try {
        busboy = Busboy({ headers: req.headers })
      } catch (err: any) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: false, error: '无效的表单请求: ' + err.message }))
        return
      }

      const uploadedFiles: LanTransferReceivedFile[] = []

      busboy.on('file', (fieldname: string, fileStream: NodeJS.ReadableStream, fileInfo: any) => {
        const { filename, mimeType } = fileInfo
        let cleanName = path.basename(filename || `upload_${Date.now()}.bin`)
        // 避免文件名冲突
        let targetPath = path.join(this.saveDirectory, cleanName)
        if (fs.existsSync(targetPath)) {
          const ext = path.extname(cleanName)
          const base = path.basename(cleanName, ext)
          cleanName = `${base}_${Date.now()}${ext}`
          targetPath = path.join(this.saveDirectory, cleanName)
        }

        const writeStream = fs.createWriteStream(targetPath)
        let bytesReceived = 0

        fileStream.on('data', (chunk: Buffer) => {
          bytesReceived += chunk.length
          this.emitEvent({
            type: 'upload-progress',
            payload: {
              fileName: cleanName,
              bytesReceived,
              deviceName
            }
          })
        })

        fileStream.on('end', () => {
          const record: LanTransferReceivedFile = {
            id: `recv_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            name: cleanName,
            size: bytesReceived,
            localPath: targetPath,
            mimeType: mimeType || 'application/octet-stream',
            senderDevice: deviceName,
            senderIp: clientIp,
            receivedAt: Date.now()
          }
          uploadedFiles.push(record)
          this.receivedFiles.unshift(record)
          this.saveConfig()

          this.emitEvent({
            type: 'file-received',
            payload: record
          })
        })

        fileStream.pipe(writeStream)
      })

      busboy.on('finish', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: true, files: uploadedFiles }))
      })

      busboy.on('error', (err: any) => {
        console.error('[LanTransferService] Busboy 处理上传出错:', err)
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: false, error: err.message }))
      })

      req.pipe(busboy)
      return
    }

    // 7. 文本消息列表与发送
    if (pathname === '/api/messages') {
      if (method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ messages: this.messages }))
        return
      }

      if (method === 'POST') {
        let body = ''
        req.on('data', (chunk) => (body += chunk))
        req.on('end', () => {
          try {
            const data = JSON.parse(body)
            const text = (data.text || '').trim()
            if (!text) {
              res.writeHead(400, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ success: false, error: '文本内容不能为空' }))
              return
            }

            const newMsg: LanTransferMessage = {
              id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
              text,
              sender: 'mobile',
              senderDevice: deviceName,
              timestamp: Date.now()
            }
            this.messages.push(newMsg)
            this.saveConfig()

            this.broadcastSse('message-received', newMsg)
            this.emitEvent({
              type: 'message-received',
              payload: newMsg
            })

            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: true, message: newMsg }))
          } catch (err: any) {
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: false, error: err.message }))
          }
        })
        return
      }
    }

    // 未匹配路由
    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('Not Found')
  }

  // --- PC 端操作接口 ---
  public addShareFiles(filePaths: string[]): LanTransferSharedFile[] {
    const added: LanTransferSharedFile[] = []
    for (const fp of filePaths) {
      if (!fs.existsSync(fp)) continue
      const stat = fs.statSync(fp)
      if (stat.isDirectory()) continue // 暂不支持直接分享整个目录，建议打包后分享

      const name = path.basename(fp)
      const ext = path.extname(name).toLowerCase()
      let mimeType = 'application/octet-stream'
      if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg'].includes(ext)) {
        mimeType = `image/${ext.replace('.', '')}`
      } else if (['.mp4', '.mov', '.mkv', '.webm', '.avi'].includes(ext)) {
        mimeType = `video/${ext.replace('.', '')}`
      } else if (['.mp3', '.m4a', '.flac', '.wav', '.aac'].includes(ext)) {
        mimeType = `audio/${ext.replace('.', '')}`
      } else if (['.txt', '.md', '.json', '.js', '.ts'].includes(ext)) {
        mimeType = 'text/plain'
      } else if (ext === '.pdf') {
        mimeType = 'application/pdf'
      }

      const item: LanTransferSharedFile = {
        id: `share_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        name,
        size: stat.size,
        localPath: fp,
        mimeType,
        downloadCount: 0,
        createdAt: Date.now()
      }
      this.sharedFiles.push(item)
      added.push(item)
    }

    this.broadcastSse('files-updated', { files: this.sharedFiles })
    return added
  }

  public removeShareFile(id: string): boolean {
    const index = this.sharedFiles.findIndex((f) => f.id === id)
    if (index >= 0) {
      this.sharedFiles.splice(index, 1)
      this.broadcastSse('files-updated', { files: this.sharedFiles })
      return true
    }
    return false
  }

  public getShareFiles(): LanTransferSharedFile[] {
    return this.sharedFiles
  }

  public getReceivedFiles(): LanTransferReceivedFile[] {
    return this.receivedFiles
  }

  public deleteReceivedFile(id: string): boolean {
    const index = this.receivedFiles.findIndex((f) => f.id === id)
    if (index >= 0) {
      const [removed] = this.receivedFiles.splice(index, 1)
      try {
        if (fs.existsSync(removed.localPath)) {
          fs.unlinkSync(removed.localPath)
        }
      } catch (err) {
        console.warn('[LanTransferService] 删除本地接收文件失败:', err)
      }
      this.saveConfig()
      return true
    }
    return false
  }

  public async openFile(localPath: string): Promise<boolean> {
    if (fs.existsSync(localPath)) {
      await shell.openPath(localPath)
      return true
    }
    return false
  }

  public showItemInFolder(localPath: string): boolean {
    if (fs.existsSync(localPath)) {
      shell.showItemInFolder(localPath)
      return true
    }
    return false
  }

  public async selectFilesToSend(): Promise<{ canceled: boolean; filePaths: string[] }> {
    const res = await dialog.showOpenDialog({
      title: '选择要发送给手机的文件',
      properties: ['openFile', 'multiSelections']
    })
    return {
      canceled: res.canceled,
      filePaths: res.filePaths
    }
  }

  public async selectSaveDirectory(): Promise<{ canceled: boolean; directoryPath?: string }> {
    const res = await dialog.showOpenDialog({
      title: '选择手机文件接收保存目录',
      defaultPath: this.saveDirectory,
      properties: ['openDirectory', 'createDirectory']
    })
    if (!res.canceled && res.filePaths.length > 0) {
      this.saveDirectory = res.filePaths[0]
      this.saveConfig()
      return { canceled: false, directoryPath: this.saveDirectory }
    }
    return { canceled: true }
  }

  public async openSaveDirectory(): Promise<void> {
    this.ensureSaveDirectory()
    await shell.openPath(this.saveDirectory)
  }

  public sendTextMessage(text: string): LanTransferMessage {
    const msg: LanTransferMessage = {
      id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      text: text.trim(),
      sender: 'pc',
      senderDevice: `${os.hostname()} (电脑)`,
      timestamp: Date.now()
    }
    this.messages.push(msg)
    this.saveConfig()

    this.broadcastSse('message-received', msg)
    this.emitEvent({
      type: 'message-received',
      payload: msg
    })
    return msg
  }

  public getMessages(): LanTransferMessage[] {
    return this.messages
  }

  public clearMessages(): boolean {
    this.messages = []
    this.saveConfig()
    this.broadcastSse('messages-cleared', {})
    return true
  }

  // --- 移动端 H5 完整单页代码 (零外部网络依赖，离线 Wi-Fi 亦可流畅秒开) ---
  private getMobileH5Html(): string {
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>豆角快传 - 手机传输助手</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
      background: #0f172a;
      color: #f8fafc;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }
    header {
      background: #1e293b;
      padding: 14px 16px;
      border-bottom: 1px solid #334155;
      display: flex;
      align-items: center;
      justify-content: space-between;
      position: sticky;
      top: 0;
      z-index: 50;
    }
    .logo-area { display: flex; align-items: center; gap: 8px; }
    .logo-icon { font-size: 20px; }
    .logo-title { font-weight: 700; font-size: 16px; color: #38bdf8; }
    .status-badge {
      font-size: 12px;
      display: flex;
      align-items: center;
      gap: 6px;
      background: rgba(16, 185, 129, 0.15);
      color: #34d399;
      padding: 4px 10px;
      border-radius: 999px;
      border: 1px solid rgba(16, 185, 129, 0.3);
    }
    .status-dot { width: 7px; height: 7px; border-radius: 50%; background: #10b981; }

    nav {
      display: flex;
      background: #1e293b;
      border-bottom: 1px solid #334155;
    }
    .nav-btn {
      flex: 1;
      padding: 12px 0;
      text-align: center;
      font-size: 14px;
      font-weight: 600;
      color: #94a3b8;
      border: none;
      background: none;
      cursor: pointer;
      position: relative;
    }
    .nav-btn.active { color: #38bdf8; }
    .nav-btn.active::after {
      content: '';
      position: absolute;
      bottom: 0;
      left: 20%;
      right: 20%;
      height: 3px;
      background: #38bdf8;
      border-radius: 3px;
    }

    main { flex: 1; padding: 16px; max-width: 600px; margin: 0 auto; width: 100%; }
    .tab-pane { display: none; }
    .tab-pane.active { display: block; }

    /* 上传区域 */
    .upload-card {
      background: #1e293b;
      border: 2px dashed #475569;
      border-radius: 16px;
      padding: 24px 16px;
      text-align: center;
      margin-bottom: 20px;
    }
    .upload-btns {
      display: flex;
      flex-direction: column;
      gap: 12px;
      margin-top: 16px;
    }
    .btn-action {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 14px;
      font-size: 15px;
      font-weight: 600;
      border-radius: 12px;
      border: none;
      cursor: pointer;
      width: 100%;
    }
    .btn-primary { background: #0284c7; color: #fff; box-shadow: 0 4px 12px rgba(2, 132, 199, 0.3); }
    .btn-secondary { background: #334155; color: #e2e8f0; }

    /* 进度条与状态 */
    .progress-box {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 12px;
      padding: 14px;
      margin-top: 16px;
      display: none;
    }
    .progress-header { display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 8px; }
    .progress-bar-bg { width: 100%; height: 8px; background: #334155; border-radius: 999px; overflow: hidden; }
    .progress-bar-fill { height: 100%; width: 0%; background: #38bdf8; transition: width 0.15s ease; }

    /* 文件卡片 */
    .file-item {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 12px;
      padding: 12px 14px;
      margin-bottom: 10px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }
    .file-info { display: flex; align-items: center; gap: 10px; min-width: 0; flex: 1; }
    .file-icon { font-size: 24px; flex-shrink: 0; }
    .file-name { font-size: 14px; font-weight: 600; color: #f1f5f9; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .file-meta { font-size: 11px; color: #94a3b8; margin-top: 2px; }
    .file-dl-btn {
      background: #0284c7;
      color: white;
      text-decoration: none;
      padding: 7px 14px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 600;
      flex-shrink: 0;
    }

    /* 文本互传 */
    .chat-box {
      display: flex;
      flex-direction: column;
      gap: 10px;
      margin-bottom: 70px;
    }
    .chat-bubble {
      max-width: 85%;
      padding: 10px 14px;
      border-radius: 14px;
      font-size: 14px;
      line-height: 1.5;
      word-break: break-all;
      position: relative;
    }
    .chat-bubble.pc {
      align-self: flex-start;
      background: #1e293b;
      border: 1px solid #334155;
      color: #f1f5f9;
    }
    .chat-bubble.mobile {
      align-self: flex-end;
      background: #0284c7;
      color: #fff;
    }
    .chat-time { font-size: 10px; opacity: 0.7; margin-top: 4px; text-align: right; }
    .chat-copy-btn {
      display: inline-block;
      margin-top: 6px;
      font-size: 11px;
      padding: 3px 8px;
      border-radius: 6px;
      background: rgba(255,255,255,0.15);
      color: #e2e8f0;
      cursor: pointer;
      border: none;
    }

    .chat-input-bar {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      background: #1e293b;
      border-top: 1px solid #334155;
      padding: 10px 14px;
      display: flex;
      gap: 8px;
      max-width: 600px;
      margin: 0 auto;
    }
    .chat-input {
      flex: 1;
      background: #0f172a;
      border: 1px solid #334155;
      border-radius: 10px;
      padding: 10px 12px;
      color: #fff;
      font-size: 14px;
      outline: none;
    }
    .chat-send-btn {
      background: #0284c7;
      color: #fff;
      border: none;
      padding: 0 16px;
      border-radius: 10px;
      font-weight: 600;
      font-size: 14px;
    }

    .empty-tip {
      text-align: center;
      padding: 40px 0;
      color: #64748b;
      font-size: 14px;
    }
    .toast {
      position: fixed;
      top: 70px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(15, 23, 42, 0.9);
      color: #38bdf8;
      border: 1px solid #0284c7;
      padding: 8px 16px;
      border-radius: 999px;
      font-size: 13px;
      z-index: 100;
      display: none;
    }
    .auth-modal {
      position: fixed;
      inset: 0;
      background: rgba(15, 23, 42, 0.96);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1000;
      padding: 20px;
    }
    .auth-card {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 20px;
      padding: 28px 22px;
      width: 100%;
      max-width: 360px;
      text-align: center;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);
    }
    .auth-icon { font-size: 40px; margin-bottom: 12px; }
    .auth-title { font-size: 18px; font-weight: 700; color: #f8fafc; margin-bottom: 6px; }
    .auth-desc { font-size: 13px; color: #94a3b8; margin-bottom: 20px; line-height: 1.5; }
    .pin-input {
      width: 100%;
      height: 52px;
      background: #0f172a;
      border: 2px solid #38bdf8;
      border-radius: 12px;
      color: #38bdf8;
      font-size: 26px;
      font-weight: 700;
      text-align: center;
      letter-spacing: 8px;
      outline: none;
      margin-bottom: 12px;
      box-sizing: border-box;
    }
    .auth-error {
      color: #f43f5e;
      font-size: 12px;
      margin-bottom: 14px;
      display: none;
    }
  </style>
</head>
<body>
  <div id="toast" class="toast"></div>

  <!-- 连接验证码模态窗 -->
  <div id="authModal" class="auth-modal" style="display: none;">
    <div class="auth-card">
      <div class="auth-icon">🔒</div>
      <div class="auth-title">局域网连接验证</div>
      <div class="auth-desc">为保障文件与剪贴板安全，请输入电脑屏幕上显示的 6 位连接验证码</div>
      <input type="tel" id="pinInput" maxlength="6" pattern="[0-9]*" class="pin-input" placeholder="000000" onkeydown="if(event.key==='Enter') submitPin()">
      <div id="authError" class="auth-error">验证码错误，请核对电脑端 PIN 码</div>
      <button class="btn-action btn-primary" onclick="submitPin()">立即配对连接</button>
    </div>
  </div>

  <header>
    <div class="logo-area">
      <span class="logo-icon">🫛</span>
      <span class="logo-title">豆角快传</span>
    </div>
    <div class="status-badge">
      <span class="status-dot"></span>
      <span id="pcNameDisplay">电脑已在线</span>
    </div>
  </header>

  <nav>
    <button class="nav-btn active" onclick="switchTab('upload')">📤 发给电脑</button>
    <button class="nav-btn" onclick="switchTab('download')">📥 来自电脑 (<span id="pcFileCount">0</span>)</button>
    <button class="nav-btn" onclick="switchTab('text')">💬 文本互传</button>
  </nav>

  <main>
    <!-- Tab 1: 发给电脑 -->
    <div id="tab-upload" class="tab-pane active">
      <div class="upload-card">
        <div style="font-size: 36px; margin-bottom: 8px;">📱 ➔ 💻</div>
        <div style="font-weight: 600; font-size: 16px; color: #f8fafc;">向电脑快速发送文件</div>
        <div style="font-size: 12px; color: #94a3b8; margin-top: 4px;">局域网直连，零外网流量，支持大视频</div>
        
        <input type="file" id="mediaInput" accept="image/*,video/*" multiple style="display: none;" onchange="handleFileSelect(this)">
        <input type="file" id="docInput" multiple style="display: none;" onchange="handleFileSelect(this)">

        <div class="upload-btns">
          <button class="btn-action btn-primary" onclick="document.getElementById('mediaInput').click()">
            📷 选取相册照片 / 视频
          </button>
          <button class="btn-action btn-secondary" onclick="document.getElementById('docInput').click()">
            📁 选取手机文档 / 其它文件
          </button>
        </div>
      </div>

      <div id="progressBox" class="progress-box">
        <div class="progress-header">
          <span id="uploadFileName">正在上传...</span>
          <span id="uploadSpeed">0 MB/s</span>
        </div>
        <div class="progress-bar-bg">
          <div id="progressBar" class="progress-bar-fill"></div>
        </div>
      </div>

      <div style="font-size: 13px; font-weight: 600; color: #94a3b8; margin-bottom: 8px; margin-top: 16px;">本次已发送</div>
      <div id="sentList">
        <div class="empty-tip">暂无发送记录，快选张照片试试吧！</div>
      </div>
    </div>

    <!-- Tab 2: 来自电脑 -->
    <div id="tab-download" class="tab-pane">
      <div style="font-size: 12px; color: #94a3b8; margin-bottom: 12px;">电脑端拖放的文件会实时显示在这里，点击直接保存：</div>
      <div id="downloadFileList">
        <div class="empty-tip">电脑端当前暂未共享文件<br><small style="color:#475569">在电脑豆角快传中拖入文件即可</small></div>
      </div>
    </div>

    <!-- Tab 3: 文本互传 -->
    <div id="tab-text" class="tab-pane">
      <div id="chatBox" class="chat-box">
        <div class="empty-tip">在下方输入文字、验证码或网址，即可秒发至电脑！</div>
      </div>
      <div class="chat-input-bar">
        <input type="text" id="msgInput" class="chat-input" placeholder="输入内容发给电脑..." onkeydown="if(event.key==='Enter') sendTextMessage()">
        <button class="chat-send-btn" onclick="sendTextMessage()">发送</button>
      </div>
    </div>
  </main>

  <script>
    let wakeLock = null;
    let authToken = sessionStorage.getItem('doujiao_lan_token') || '';
    let deviceId = localStorage.getItem('doujiao_lan_dev_id') || '';
    if (!deviceId) {
      deviceId = 'dev_' + Math.random().toString(36).slice(2, 9);
      localStorage.setItem('doujiao_lan_dev_id', deviceId);
    }

    async function requestWakeLock() {
      if ('wakeLock' in navigator) {
        try { wakeLock = await navigator.wakeLock.request('screen'); } catch(e){}
      }
    }
    function releaseWakeLock() {
      if (wakeLock) { wakeLock.release(); wakeLock = null; }
    }

    function showToast(msg) {
      const t = document.getElementById('toast');
      t.innerText = msg;
      t.style.display = 'block';
      setTimeout(() => { t.style.display = 'none'; }, 2500);
    }

    function switchTab(tabId) {
      document.querySelectorAll('.tab-pane').forEach(el => el.classList.remove('active'));
      document.querySelectorAll('.nav-btn').forEach(el => el.classList.remove('active'));
      document.getElementById('tab-' + tabId).classList.add('active');
      event.currentTarget.classList.add('active');
      if (tabId === 'download') fetchFiles();
      if (tabId === 'text') fetchMessages();
    }

    function formatSize(bytes) {
      if (!bytes || bytes === 0) return '0 B';
      const k = 1024;
      const sizes = ['B', 'KB', 'MB', 'GB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return (bytes / Math.pow(k, i)).toFixed(1) + ' ' + sizes[i];
    }

    function getIcon(name) {
      const ext = name.split('.').pop().toLowerCase();
      if (['jpg','jpeg','png','gif','webp'].includes(ext)) return '🖼️';
      if (['mp4','mov','mkv','webm'].includes(ext)) return '🎬';
      if (['mp3','m4a','wav'].includes(ext)) return '🎵';
      if (['zip','rar','7z'].includes(ext)) return '📦';
      if (['pdf','doc','docx','txt','md'].includes(ext)) return '📄';
      return '📁';
    }

    // --- 认证请求封装 ---
    function authFetch(url, options = {}) {
      options.headers = options.headers || {};
      if (authToken) {
        if (options.headers instanceof Headers) {
          options.headers.set('Authorization', 'Bearer ' + authToken);
          options.headers.set('x-auth-token', authToken);
        } else {
          options.headers['Authorization'] = 'Bearer ' + authToken;
          options.headers['x-auth-token'] = authToken;
        }
      }
      return fetch(url, options);
    }

    async function submitPin(autoPin) {
      const pin = autoPin || document.getElementById('pinInput').value.trim();
      const errEl = document.getElementById('authError');
      if (!pin) {
        errEl.innerText = '请输入 6 位数字验证码';
        errEl.style.display = 'block';
        return;
      }
      try {
        const res = await fetch('/api/auth/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pin, deviceId })
        });
        const data = await res.json();
        if (data.success && data.token) {
          authToken = data.token;
          sessionStorage.setItem('doujiao_lan_token', authToken);
          document.getElementById('authModal').style.display = 'none';
          errEl.style.display = 'none';
          showToast('🎉 连接配对成功！');
          onAuthenticated();
        } else {
          errEl.innerText = data.error || '验证码错误，请核对电脑端显示的 6 位 PIN 码';
          errEl.style.display = 'block';
          document.getElementById('authModal').style.display = 'flex';
        }
      } catch (err) {
        errEl.innerText = '网络连接异常，请重试';
        errEl.style.display = 'block';
      }
    }

    // --- 心跳保活与离开通知 ---
    let heartbeatTimer = null;
    function startHeartbeat() {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      heartbeatTimer = setInterval(() => {
        authFetch('/api/heartbeat?id=' + encodeURIComponent(deviceId) + '&token=' + encodeURIComponent(authToken))
          .catch(() => {});
      }, 4000);
    }

    function notifyLeave() {
      try {
        const url = '/api/leave?id=' + encodeURIComponent(deviceId) + '&token=' + encodeURIComponent(authToken);
        if (navigator.sendBeacon) {
          navigator.sendBeacon(url);
        } else {
          fetch(url, { method: 'POST', keepalive: true }).catch(() => {});
        }
      } catch (e) {}
    }
    window.addEventListener('pagehide', notifyLeave);
    window.addEventListener('beforeunload', notifyLeave);

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        authFetch('/api/heartbeat?id=' + encodeURIComponent(deviceId) + '&token=' + encodeURIComponent(authToken)).catch(() => {});
        fetchFiles();
      }
    });

    // --- 上传处理 ---
    async function handleFileSelect(input) {
      const files = input.files;
      if (!files || files.length === 0) return;

      await requestWakeLock();
      const progressBox = document.getElementById('progressBox');
      const progressBar = document.getElementById('progressBar');
      const uploadFileName = document.getElementById('uploadFileName');
      const uploadSpeed = document.getElementById('uploadSpeed');

      progressBox.style.display = 'block';

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        uploadFileName.innerText = '正在上传 (' + (i + 1) + '/' + files.length + '): ' + file.name;
        progressBar.style.width = '0%';

        await new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          const formData = new FormData();
          formData.append('file', file);

          let startTime = Date.now();

          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
              const percent = Math.round((e.loaded / e.total) * 100);
              progressBar.style.width = percent + '%';

              const now = Date.now();
              const elapsedSec = (now - startTime) / 1000;
              if (elapsedSec > 0.3) {
                const speedMB = ((e.loaded / 1024 / 1024) / elapsedSec).toFixed(1);
                uploadSpeed.innerText = speedMB + ' MB/s (' + percent + '%)';
              }
            }
          };

          xhr.onload = () => {
            if (xhr.status === 200) {
              addSentRecord(file.name, file.size);
              resolve();
            } else if (xhr.status === 401) {
              document.getElementById('authModal').style.display = 'flex';
              reject(new Error('未授权'));
            } else {
              reject(new Error('上传失败'));
            }
          };

          xhr.onerror = () => reject(new Error('网络错误'));
          xhr.open('POST', '/api/upload?id=' + encodeURIComponent(deviceId) + '&token=' + encodeURIComponent(authToken), true);
          if (authToken) {
            xhr.setRequestHeader('Authorization', 'Bearer ' + authToken);
            xhr.setRequestHeader('x-auth-token', authToken);
          }
          xhr.send(formData);
        });
      }

      progressBox.style.display = 'none';
      input.value = '';
      releaseWakeLock();
      showToast('🎉 上传成功！电脑端已保存');
      if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
    }

    function addSentRecord(name, size) {
      const list = document.getElementById('sentList');
      if (list.querySelector('.empty-tip')) list.innerHTML = '';
      const div = document.createElement('div');
      div.className = 'file-item';
      div.innerHTML = '<div class="file-info"><span class="file-icon">' + getIcon(name) + '</span><div><div class="file-name">' + name + '</div><div class="file-meta">' + formatSize(size) + ' · 已传电脑</div></div></div><span style="color:#34d399;font-size:12px;">✓ 已完成</span>';
      list.prepend(div);
    }

    // --- 获取电脑文件 ---
    async function fetchFiles() {
      try {
        const res = await authFetch('/api/files?id=' + encodeURIComponent(deviceId) + '&token=' + encodeURIComponent(authToken));
        if (res.status === 401) {
          document.getElementById('authModal').style.display = 'flex';
          return;
        }
        const data = await res.json();
        const list = document.getElementById('downloadFileList');
        document.getElementById('pcFileCount').innerText = data.files ? data.files.length : 0;

        if (!data.files || data.files.length === 0) {
          list.innerHTML = '<div class="empty-tip">电脑端当前暂未共享文件<br><small style="color:#475569">在电脑豆角快传中拖入文件即可</small></div>';
          return;
        }

        list.innerHTML = data.files.map(f => {
          const dlUrl = '/api/download/' + encodeURIComponent(f.id) + '?token=' + encodeURIComponent(authToken) + '&id=' + encodeURIComponent(deviceId);
          return '<div class="file-item">' +
            '<div class="file-info">' +
              '<span class="file-icon">' + getIcon(f.name) + '</span>' +
              '<div>' +
                '<div class="file-name">' + f.name + '</div>' +
                '<div class="file-meta">' + formatSize(f.size) + '</div>' +
              '</div>' +
            '</div>' +
            '<a href="' + dlUrl + '" class="file-dl-btn" download>下载</a>' +
          '</div>';
        }).join('');
      } catch (err) {
        console.error(err);
      }
    }

    // --- 文本互传 ---
    async function fetchMessages() {
      try {
        const res = await authFetch('/api/messages?id=' + encodeURIComponent(deviceId) + '&token=' + encodeURIComponent(authToken));
        if (res.status === 401) {
          document.getElementById('authModal').style.display = 'flex';
          return;
        }
        const data = await res.json();
        renderMessages(data.messages || []);
      } catch (err) {}
    }

    function renderMessages(msgs) {
      const box = document.getElementById('chatBox');
      if (msgs.length === 0) {
        box.innerHTML = '<div class="empty-tip">在下方输入文字、验证码或网址，即可秒发至电脑！</div>';
        return;
      }
      box.innerHTML = msgs.map(m => {
        const isMe = m.sender === 'mobile';
        return '<div class="chat-bubble ' + (isMe ? 'mobile' : 'pc') + '">' +
          '<div>' + escapeHtml(m.text) + '</div>' +
          '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:4px;">' +
            '<button class="chat-copy-btn" onclick="copyText(\\'' + escapeAttr(m.text) + '\\')">复制</button>' +
            '<span class="chat-time">' + (isMe ? '手机' : (m.senderDevice || '电脑')) + '</span>' +
          '</div>' +
        '</div>';
      }).join('');
      box.scrollTop = box.scrollHeight;
    }

    async function sendTextMessage() {
      const input = document.getElementById('msgInput');
      const text = input.value.trim();
      if (!text) return;
      input.value = '';

      try {
        const res = await authFetch('/api/messages?id=' + encodeURIComponent(deviceId) + '&token=' + encodeURIComponent(authToken), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text })
        });
        if (res.status === 401) {
          document.getElementById('authModal').style.display = 'flex';
          return;
        }
        const data = await res.json();
        if (data.success) {
          fetchMessages();
          showToast('已发往电脑');
        }
      } catch (err) {
        showToast('发送失败');
      }
    }

    function copyText(txt) {
      if (navigator.clipboard) {
        navigator.clipboard.writeText(txt).then(() => showToast('已复制到剪贴板'));
      } else {
        const t = document.createElement('textarea');
        t.value = txt;
        document.body.appendChild(t);
        t.select();
        document.execCommand('copy');
        document.body.removeChild(t);
        showToast('已复制到剪贴板');
      }
    }

    function escapeHtml(str) {
      return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    function escapeAttr(str) {
      return (str || '').replace(/'/g, "\\\\'").replace(/"/g, '&quot;');
    }

    // --- SSE 实时感知 ---
    let es = null;
    function initEventSource() {
      if (es) { try { es.close(); } catch(e){} }
      const url = '/api/events?id=' + encodeURIComponent(deviceId) + '&token=' + encodeURIComponent(authToken);
      es = new EventSource(url);
      es.addEventListener('files-updated', () => { fetchFiles(); showToast('电脑端更新了共享文件'); });
      es.addEventListener('message-received', (e) => {
        fetchMessages();
        const data = JSON.parse(e.data);
        if (data.sender !== 'mobile') showToast('收到来自电脑的新文字');
      });
      es.addEventListener('auth-changed', (e) => {
        const data = JSON.parse(e.data || '{}');
        if (data.pinRefreshed) {
          sessionStorage.removeItem('doujiao_lan_token');
          authToken = '';
          document.getElementById('authModal').style.display = 'flex';
          showToast('电脑端已刷新验证码，请重新输入');
        }
      });
      es.onerror = () => { setTimeout(initEventSource, 5000); };
    }

    function onAuthenticated() {
      startHeartbeat();
      initEventSource();
      fetchFiles();
      fetchMessages();
    }

    // 初始化入口
    fetch('/api/status').then(r => r.json()).then(d => {
      document.getElementById('pcNameDisplay').innerText = d.pcName || '电脑已在线';

      const urlParams = new URLSearchParams(window.location.search);
      const pinInUrl = urlParams.get('pin');

      if (pinInUrl) {
        // 扫码自带 PIN，静默自动连接
        submitPin(pinInUrl);
        // 清除 URL 中的 PIN，避免分享泄露
        window.history.replaceState({}, '', window.location.pathname);
      } else if (authToken) {
        // 已有会话，直接进入
        onAuthenticated();
      } else if (d.authRequired) {
        // 需要验证码，显示模态窗
        document.getElementById('authModal').style.display = 'flex';
      } else {
        // 免密直连
        onAuthenticated();
      }
    });
  </script>
</body>
</html>`
  }
}
