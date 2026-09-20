/**
 * Windows 原生 DXGI 屏幕采集辅助进程宿主包装器 (DXGI Capturer Helper)
 * 通过管道与 doujiao-dxgi-capturer.exe 进行生命周期管理与端口协商
 */

import { spawn, type ChildProcess } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { EventEmitter } from 'node:events'

const __currentDir = typeof __dirname !== 'undefined'
  ? __dirname
  : path.dirname(fileURLToPath(import.meta.url))

export interface DxgiCapturerOptions {
  helperPath?: string
  spawnHelper?: () => any
}

export interface DxgiStartOptions {
  fps?: number
  displayIndex?: number
}

export class DxgiCapturerHelper {
  private helperPath: string
  private spawnHelper?: () => any
  private child: ChildProcess | null = null
  private started = false
  private port: number | null = null
  private emitter = new EventEmitter()
  private stdoutBuffer = ''

  constructor(options: DxgiCapturerOptions = {}) {
    this.spawnHelper = options.spawnHelper
    this.helperPath = options.helperPath || this.resolveDefaultHelperPath()
  }

  private resolveDefaultHelperPath(): string {
    const candidates = [
      // Production packaged path
      typeof process !== 'undefined' && (process as any).resourcesPath
        ? path.join((process as any).resourcesPath, 'bin', 'doujiao-dxgi-capturer.exe')
        : '',
      // From out/main or dist directory
      path.resolve(__currentDir, '../../native/dxgi-screen-capturer/bin/doujiao-dxgi-capturer.exe'),
      // From src/main/services/remote-assist
      path.resolve(__currentDir, '../../../native/dxgi-screen-capturer/bin/doujiao-dxgi-capturer.exe'),
      // Relative from repo root cwd
      path.resolve(process.cwd(), 'apps/host/native/dxgi-screen-capturer/bin/doujiao-dxgi-capturer.exe'),
      // Relative from apps/host cwd
      path.resolve(process.cwd(), 'native/dxgi-screen-capturer/bin/doujiao-dxgi-capturer.exe')
    ].filter(Boolean)

    for (const p of candidates) {
      if (fs.existsSync(p)) {
        return p
      }
    }
    return candidates[0] || 'doujiao-dxgi-capturer.exe'
  }

  public isStarted(): boolean {
    return this.started && this.child !== null && this.port !== null
  }

  public getPort(): number | null {
    return this.port
  }

  public async start(options: DxgiStartOptions = {}): Promise<number | null> {
    if (this.started) {
      await this.stop()
    }

    const fps = options.fps && options.fps > 0 ? options.fps : 60
    const displayIndex = options.displayIndex !== undefined ? options.displayIndex : 0

    if (this.spawnHelper) {
      this.child = this.spawnHelper()
    } else {
      if (!fs.existsSync(this.helperPath)) {
        console.warn(`[DxgiCapturerHelper] 原生采集器未找到: ${this.helperPath}，将回退至浏览器采集`)
        return null
      }
      this.child = spawn(this.helperPath, [
        '--port', '0',
        '--fps', String(fps),
        '--display', String(displayIndex)
      ], {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true
      })
    }

    if (!this.child) {
      console.warn('[DxgiCapturerHelper] 创建原生采集进程失败')
      return null
    }

    this.started = true

    if (typeof this.child.stdin?.on === 'function') {
      this.child.stdin.on('error', () => {
        // Ignore EPIPE
      })
    }

    return new Promise<number | null>((resolve) => {
      let resolved = false
      const timeoutTimer = setTimeout(() => {
        if (!resolved) {
          resolved = true
          console.warn('[DxgiCapturerHelper] 等待采集器端口协商超时 (3000ms)，回退至浏览器采集')
          resolve(null)
        }
      }, 3000)

      this.child?.stdout?.on('data', (chunk: Buffer) => {
        this.stdoutBuffer += chunk.toString('utf8')
        const lines = this.stdoutBuffer.split('\n')
        this.stdoutBuffer = lines.pop() || ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed) continue

          try {
            const msg = JSON.parse(trimmed)
            if (msg.type === 'ready' && typeof msg.port === 'number') {
              this.port = msg.port
              this.emitter.emit('ready', this.port)
              if (!resolved) {
                resolved = true
                clearTimeout(timeoutTimer)
                console.info(`[DxgiCapturerHelper] 原生 DXGI 采集器已就绪，端口: ${this.port}`)
                resolve(this.port)
              }
            } else if (msg.type === 'client-connected') {
              this.emitter.emit('client-connected')
            } else if (msg.type === 'client-disconnected') {
              this.emitter.emit('client-disconnected')
            }
          } catch {
            // Non-json log from helper
          }
        }
      })

      this.child?.stderr?.on('data', (chunk: Buffer) => {
        console.warn(`[DxgiCapturerHelper stderr] ${chunk.toString('utf8').trim()}`)
      })

      this.child?.on('exit', (code, signal) => {
        this.started = false
        this.port = null
        this.child = null
        this.emitter.emit('exit', { code, signal })
        if (!resolved) {
          resolved = true
          clearTimeout(timeoutTimer)
          console.warn(`[DxgiCapturerHelper] 采集器提前退出 (code: ${code}, signal: ${signal})`)
          resolve(null)
        }
      })

      this.child?.on('error', (err) => {
        console.error('[DxgiCapturerHelper] 采集进程错误:', err)
        if (!resolved) {
          resolved = true
          clearTimeout(timeoutTimer)
          resolve(null)
        }
      })
    })
  }

  public async stop(): Promise<void> {
    if (!this.child) {
      this.started = false
      this.port = null
      return
    }

    try {
      if (this.child.stdin && !this.child.stdin.destroyed) {
        this.child.stdin.end()
      }
    } catch {}

    const childRef = this.child
    this.child = null
    this.started = false
    this.port = null

    try {
      childRef.kill('SIGTERM')
    } catch {}
  }
}
