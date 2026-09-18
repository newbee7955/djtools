/**
 * Windows 原生输入助手进程宿主包装器 (Remote Input Helper)
 * 通过继承的 stdin 管道与 doujiao-remote-input.exe 进行安全的 JSONL 通信
 */

import { spawn, type ChildProcess } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { EventEmitter } from 'node:events'
import type { RemoteAssistInputEvent } from './remote-assist-contract.ts'

const __currentDir = typeof __dirname !== 'undefined'
  ? __dirname
  : path.dirname(fileURLToPath(import.meta.url))

export interface RemoteInputHelperOptions {
  helperPath?: string
  spawnHelper?: () => any
}

export class RemoteInputHelper {
  private helperPath: string
  private spawnHelper?: () => any
  private child: ChildProcess | null = null
  private sessionToken: string | null = null
  private started = false
  private emitter = new EventEmitter()
  private stdoutBuffer = ''

  constructor(options: RemoteInputHelperOptions = {}) {
    this.spawnHelper = options.spawnHelper
    this.helperPath = options.helperPath || this.resolveDefaultHelperPath()
  }

  private resolveDefaultHelperPath(): string {
    const candidates = [
      // Production packaged path
      typeof process !== 'undefined' && (process as any).resourcesPath
        ? path.join((process as any).resourcesPath, 'bin', 'doujiao-remote-input.exe')
        : '',
      // From out/main or dist directory
      path.resolve(__currentDir, '../../native/remote-input-helper/bin/doujiao-remote-input.exe'),
      path.resolve(__currentDir, '../../native/remote-input-helper/build/Release/doujiao-remote-input.exe'),
      // From src/main/services/remote-assist
      path.resolve(__currentDir, '../../../native/remote-input-helper/bin/doujiao-remote-input.exe'),
      path.resolve(__currentDir, '../../../native/remote-input-helper/build/Release/doujiao-remote-input.exe'),
      // Relative from repo root cwd
      path.resolve(process.cwd(), 'apps/host/native/remote-input-helper/bin/doujiao-remote-input.exe'),
      path.resolve(process.cwd(), 'apps/host/native/remote-input-helper/build/Release/doujiao-remote-input.exe'),
      // Relative from apps/host cwd
      path.resolve(process.cwd(), 'native/remote-input-helper/bin/doujiao-remote-input.exe'),
      path.resolve(process.cwd(), 'native/remote-input-helper/build/Release/doujiao-remote-input.exe')
    ].filter(Boolean)

    for (const p of candidates) {
      if (fs.existsSync(p)) {
        return p
      }
    }
    return candidates[0] || 'doujiao-remote-input.exe'
  }

  public isStarted(): boolean {
    return this.started && this.child !== null
  }

  public async start(sessionToken: string): Promise<void> {
    if (this.started) {
      await this.stop()
    }

    this.sessionToken = sessionToken

    if (this.spawnHelper) {
      this.child = this.spawnHelper()
    } else {
      if (!fs.existsSync(this.helperPath)) {
        console.warn(`[RemoteInputHelper] 原生输入助手程序未找到: ${this.helperPath}，将跳过原生输入注入`)
        return
      }
      this.child = spawn(this.helperPath, [], {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true
      })
    }

    if (!this.child) {
      throw new Error('Failed to spawn remote input helper process')
    }

    this.started = true

    if (typeof this.child.stdin?.on === 'function') {
      this.child.stdin.on('error', () => {
        // Ignore EPIPE/EOF errors when child exits
      })
    }

    this.child.stdout?.on('data', (chunk: Buffer) => {
      this.handleStdoutData(chunk)
    })

    this.child.on('exit', () => {
      this.started = false
      this.child = null
    })

    // 发送初始握手，绑定本次会话 Token
    this.sendRaw({
      type: 'hello',
      token: this.sessionToken
    })
  }

  private handleStdoutData(chunk: Buffer): void {
    this.stdoutBuffer += chunk.toString('utf8')
    const lines = this.stdoutBuffer.split('\n')
    this.stdoutBuffer = lines.pop() || ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        const msg = JSON.parse(trimmed)
        if (msg.type === 'local-override') {
          this.emitter.emit('override', msg)
        }
      } catch {}
    }
  }

  private sendRaw(data: Record<string, any>): void {
    if (!this.child || !this.child.stdin || !this.child.stdin.write) {
      return
    }
    try {
      this.child.stdin.write(JSON.stringify(data) + '\n')
    } catch (err) {
      console.error('[RemoteInputHelper] 写入管道失败:', err)
    }
  }

  public send(event: RemoteAssistInputEvent): void {
    if (!this.started || !this.sessionToken) {
      throw new Error('Remote input helper is not started')
    }

    this.sendRaw({
      ...event,
      token: this.sessionToken
    })
  }

  public setCursorHidden(hidden: boolean): void {
    if (!this.started || !this.sessionToken) return
    this.sendRaw({
      type: 'hide-cursor',
      token: this.sessionToken,
      hidden: Boolean(hidden)
    })
  }

  public async releaseAll(): Promise<void> {
    if (!this.started || !this.sessionToken) return
    this.sendRaw({
      type: 'release-all',
      token: this.sessionToken
    })
  }

  public async stop(): Promise<void> {
    if (!this.started) return

    if (this.sessionToken) {
      this.sendRaw({
        type: 'release-all',
        token: this.sessionToken
      })
      this.sendRaw({
        type: 'shutdown',
        token: this.sessionToken
      })
    }

    if (this.child?.stdin?.end) {
      try {
        this.child.stdin.end()
      } catch {}
    }

    if (this.child && typeof this.child.kill === 'function') {
      try {
        this.child.kill()
      } catch {}
    }

    this.started = false
    this.sessionToken = null
    this.child = null
  }

  public onOverride(callback: () => void): () => void {
    this.emitter.on('override', callback)
    return () => {
      this.emitter.removeListener('override', callback)
    }
  }
}
