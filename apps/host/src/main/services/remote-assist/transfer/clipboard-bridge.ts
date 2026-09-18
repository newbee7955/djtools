/**
 * 剪贴板桥：文本 / PNG 图片 / FileNameW 文件列表的读写与变化轮询（含回声抑制）
 */

import crypto from 'node:crypto'

export interface ClipboardLike {
  readText(): string
  readImage(): { isEmpty(): boolean; toPNG(): Buffer }
  readBuffer(format: string): Buffer
  writeText(text: string): void
  writeImage(image: any): void
  writeBuffer(format: string, buffer: Buffer): void
}

export interface ClipboardSnapshot {
  kind: 'text' | 'image' | 'files'
  text?: string
  png?: Uint8Array
  files?: string[]
  hash: string
}

/** nativeImage 的最小可用面：把 PNG buffer 解码为可判空的图像对象 */
export interface NativeImageLike {
  createFromBuffer(buffer: Buffer): { isEmpty(): boolean }
}

export interface ClipboardBridgeOptions {
  clipboard?: ClipboardLike
  pollIntervalMs?: number
  /** 可注入的 nativeImage（单测用）；缺省时回退到 require('electron')?.nativeImage */
  nativeImage?: NativeImageLike
}

const FILENAME_W = 'FileNameW'

export function encodeFileNameW(paths: string[]): Uint8Array {
  const serialized = paths.join('\0') + '\0\0'
  return new Uint8Array(Buffer.from(serialized, 'ucs2'))
}

export function decodeFileNameW(buffer: Uint8Array): string[] {
  const buf = Buffer.from(buffer)
  if (buf.length < 2) return []
  const text = buf.toString('ucs2')
  return text.split('\0').filter((p) => p.length > 0)
}

function resolveClipboard(injected?: ClipboardLike): ClipboardLike | null {
  if (injected) return injected
  try {
    const electron = require('electron')
    return electron?.clipboard ?? null
  } catch {
    return null
  }
}

function resolveNativeImage(injected?: NativeImageLike): NativeImageLike | null {
  if (injected) return injected
  try {
    const electron = require('electron')
    return electron?.nativeImage ?? null
  } catch {
    return null
  }
}

export class ClipboardBridge {
  private clipboard: ClipboardLike | null
  private nativeImage: NativeImageLike | null
  private pollIntervalMs: number
  private timer: any = null
  private lastHash: string | null = null
  private suppressedHashes = new Set<string>()
  private onChange: ((snap: ClipboardSnapshot) => void) | null = null

  constructor(options: ClipboardBridgeOptions = {}) {
    this.clipboard = resolveClipboard(options.clipboard)
    this.nativeImage = resolveNativeImage(options.nativeImage)
    this.pollIntervalMs = options.pollIntervalMs ?? 700
  }

  public start(onChange: (snap: ClipboardSnapshot) => void): void {
    // 先复位（stop 会清空 onChange），再注册回调并记录基线，否则回调会被 stop 清掉
    this.stop()
    this.onChange = onChange
    this.lastHash = this.computeHash()
    this.timer = setInterval(() => this.pollOnce(), this.pollIntervalMs)
    if (this.timer?.unref) this.timer.unref()
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    this.onChange = null
  }

  public pollOnce(): void {
    const snap = this.read()
    if (!snap) return
    if (snap.hash === this.lastHash) return
    this.lastHash = snap.hash
    if (this.suppressedHashes.has(snap.hash)) {
      return
    }
    this.onChange?.(snap)
  }

  public markRemoteWrite(content: string | Uint8Array): void {
    const hash = typeof content === 'string' ? this.hashText(content) : crypto.createHash('sha256').update(Buffer.from(content)).digest('hex')
    this.suppressedHashes.add(hash)
    if (this.suppressedHashes.size > 32) {
      const first = this.suppressedHashes.values().next().value
      if (first) this.suppressedHashes.delete(first)
    }
    this.lastHash = hash
  }

  public read(): ClipboardSnapshot | null {
    if (!this.clipboard) return null
    try {
      const files = decodeFileNameW(this.clipboard.readBuffer(FILENAME_W))
      if (files.length > 0) {
        return { kind: 'files', files, hash: crypto.createHash('sha256').update(files.join('|')).digest('hex') }
      }
      const image = this.clipboard.readImage()
      if (image && !image.isEmpty()) {
        const png = image.toPNG()
        if (png.length > 0) {
          return { kind: 'image', png: new Uint8Array(png), hash: crypto.createHash('sha256').update(png).digest('hex') }
        }
      }
      const text = this.clipboard.readText()
      if (text) {
        return { kind: 'text', text, hash: this.hashText(text) }
      }
      return null
    } catch {
      return null
    }
  }

  /** 返回 true 仅当剪贴板确实可用且写入未抛错；失败时返回 false（不标记回声） */
  public writeText(text: string): boolean {
    if (!this.clipboard) return false
    try {
      this.clipboard.writeText(text)
    } catch {
      return false
    }
    this.markRemoteWrite(text)
    return true
  }

  public writeImage(png: Uint8Array): boolean {
    if (!this.clipboard) return false
    let image: any = null
    if (this.nativeImage?.createFromBuffer) {
      try {
        image = this.nativeImage.createFromBuffer(Buffer.from(png))
        // null/undefined 或「非空但 isEmpty」的 NativeImage（损坏 PNG 的解码结果）一律视为失败，
        // 否则失败解码会被写入剪贴板并误标记回声
        if (!image || image.isEmpty()) return false
      } catch {
        return false
      }
    }
    try {
      this.clipboard.writeImage(image ?? Buffer.from(png))
    } catch {
      return false
    }
    this.markRemoteWrite(png)
    return true
  }

  public writeFiles(paths: string[]): boolean {
    if (!this.clipboard || paths.length === 0) return false
    try {
      const encoded = Buffer.from(encodeFileNameW(paths))
      this.clipboard.writeBuffer(FILENAME_W, encoded)
      this.clipboard.writeBuffer('FileName', Buffer.from(paths.join('\r\n') + '\r\n\0', 'latin1'))
    } catch {
      return false
    }
    this.markRemoteWrite(paths.join('|'))
    return true
  }

  private computeHash(): string | null {
    const snap = this.read()
    return snap ? snap.hash : null
  }

  private hashText(text: string): string {
    return crypto.createHash('sha256').update(text, 'utf8').digest('hex')
  }
}
