import { app, clipboard, nativeImage } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { EventEmitter } from 'events'
import type { ClipboardItem } from '@doujiao/plugin-sdk'

const MAX_HISTORY_ITEMS = 500

export class ClipboardHistoryService extends EventEmitter {
  private static instance: ClipboardHistoryService
  private items: ClipboardItem[] = []
  private storageFile: string
  private lastCopiedText: string = ''
  private lastCopiedImageFingerprint: string = ''
  private timer: NodeJS.Timeout | null = null

  private constructor() {
    super()
    this.storageFile = join(app.getPath('userData'), 'clipboard-history.json')
    this.loadFromDisk()
    this.startWatching()
  }

  public static getInstance(): ClipboardHistoryService {
    if (!ClipboardHistoryService.instance) {
      ClipboardHistoryService.instance = new ClipboardHistoryService()
    }
    return ClipboardHistoryService.instance
  }

  private loadFromDisk(): void {
    if (existsSync(this.storageFile)) {
      try {
        const raw = readFileSync(this.storageFile, 'utf-8')
        const parsed = JSON.parse(raw)
        let rawList: any[] = []
        if (Array.isArray(parsed)) {
          rawList = parsed
        } else if (parsed && typeof parsed === 'object' && Array.isArray((parsed as any).items)) {
          rawList = (parsed as any).items
        }

        // 统一规范化清洗数据（同时兼容文本与历史图片）
        this.items = rawList
          .map((item: any) => {
            const rawContent = (item.dataUrl || item.content || item.text || '').toString()
            const isImage =
              item.type === 'image' ||
              rawContent.startsWith('data:image/') ||
              Boolean(item.thumbnail && item.thumbnail.startsWith('data:image/'))

            if (isImage) {
              const dataUrl = rawContent.startsWith('data:image/') ? rawContent : (item.thumbnail || '')
              return {
                id: item.id || `clip_img_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
                text: item.text && !item.text.startsWith('data:image/') ? item.text : '[图片]',
                type: 'image' as const,
                dataUrl,
                thumbnail: item.thumbnail || dataUrl,
                width: typeof item.width === 'number' ? item.width : undefined,
                height: typeof item.height === 'number' ? item.height : undefined,
                timestamp: typeof item.timestamp === 'number' ? item.timestamp : Date.now(),
                charCount: typeof item.charCount === 'number' ? item.charCount : Math.round(dataUrl.length * 0.75),
                lineCount: 1,
                pinned: Boolean(item.pinned)
              }
            }

            const text = (item.text || item.content || '').toString()
            return {
              id: item.id || `clip_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
              text: text,
              type: 'text' as const,
              timestamp: typeof item.timestamp === 'number' ? item.timestamp : Date.now(),
              charCount: typeof item.charCount === 'number' ? item.charCount : text.length,
              lineCount: typeof item.lineCount === 'number' ? item.lineCount : (text ? text.split(/\r?\n/).length : 1),
              pinned: Boolean(item.pinned)
            }
          })
          .filter((item) => (item.type === 'image' && item.dataUrl) || (item.type === 'text' && item.text && item.text.trim()))

        if (this.items.length > 0) {
          const first = this.items[0]
          if (first.type === 'text') {
            this.lastCopiedText = first.text
          } else if (first.type === 'image' && first.dataUrl) {
            this.lastCopiedImageFingerprint = `${first.width || 0}x${first.height || 0}_${first.charCount}`
          }
        }
      } catch (err) {
        console.warn('[ClipboardService] 读取剪贴板历史文件失败，初始化为空:', err)
        this.items = []
      }
    } else {
      this.items = []
    }
  }

  private saveToDisk(): void {
    try {
      writeFileSync(this.storageFile, JSON.stringify(this.items, null, 2), 'utf-8')
    } catch (err) {
      console.error('[ClipboardService] 写入剪贴板历史失败:', err)
    }
  }

  public isPluginEnabled(): boolean {
    try {
      const stateFile = join(app.getPath('userData'), 'plugins', 'clipboard-history', 'state.json')
      if (existsSync(stateFile)) {
        const raw = readFileSync(stateFile, 'utf-8')
        const state = JSON.parse(raw.replace(/^\uFEFF/, ''))
        if (state && state.enabled === false) {
          return false
        }
      }
      return true
    } catch {
      return true
    }
  }

  public isWatching(): boolean {
    return this.timer !== null
  }

  public startWatching(): void {
    if (this.timer) return
    if (!this.isPluginEnabled()) {
      console.log('[ClipboardService] 剪贴板历史插件处于禁用状态，跳过启动监听器')
      return
    }

    console.log('[ClipboardService] 启动剪贴板轮询监听器 (800ms)')
    // 初始化同步一次系统当前剪贴板
    try {
      const img = clipboard.readImage()
      if (!img.isEmpty()) {
        const size = img.getSize()
        const buffer = img.toPNG()
        this.lastCopiedImageFingerprint = `${size.width}x${size.height}_${buffer.length}`
      } else {
        const current = clipboard.readText()
        if (current && current.trim()) {
          this.lastCopiedText = current
        }
      }
    } catch {}

    this.timer = setInterval(() => {
      this.checkClipboard()
    }, 800)
  }

  public stopWatching(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
      console.log('[ClipboardService] 剪贴板插件已禁用，彻底停止后台剪贴板轮询监听')
    }
  }

  private checkClipboard(): void {
    if (!this.isPluginEnabled()) {
      this.stopWatching()
      return
    }
    // 1. 优先检查图片
    try {
      const img = clipboard.readImage()
      if (!img.isEmpty()) {
        const size = img.getSize()
        if (size.width > 0 && size.height > 0) {
          const buffer = img.toPNG()
          const fingerprint = `${size.width}x${size.height}_${buffer.length}`
          if (fingerprint !== this.lastCopiedImageFingerprint) {
            this.lastCopiedImageFingerprint = fingerprint
            this.lastCopiedText = ''
            const dataUrl = img.toDataURL()
            this.addImageItem(dataUrl, size.width, size.height, buffer.length)
            return
          }
          return
        }
      }
    } catch (err) {}

    // 2. 检查文本
    try {
      const text = clipboard.readText()
      if (!text || !text.trim() || text === this.lastCopiedText) {
        return
      }

      this.lastCopiedText = text
      this.lastCopiedImageFingerprint = ''
      this.addItem(text)
    } catch (err) {}
  }

  private addImageItem(dataUrl: string, width: number, height: number, sizeBytes: number): void {
    const existingIndex = this.items.findIndex(
      (i) => i.type === 'image' && (i.dataUrl === dataUrl || (i.width === width && i.height === height && i.charCount === sizeBytes))
    )

    if (existingIndex >= 0) {
      const [existing] = this.items.splice(existingIndex, 1)
      existing.timestamp = Date.now()
      this.items.unshift(existing)
    } else {
      const newItem: ClipboardItem = {
        id: `clip_img_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        text: `[图片 ${width}×${height}]`,
        type: 'image',
        dataUrl,
        thumbnail: dataUrl,
        width,
        height,
        timestamp: Date.now(),
        charCount: sizeBytes,
        lineCount: 1,
        pinned: false
      }
      this.items.unshift(newItem)
    }

    this.pruneAndSave()
  }

  private addItem(text: string): void {
    const existingIndex = this.items.findIndex((i) => i.type === 'text' && i.text === text)
    if (existingIndex >= 0) {
      // 若已存在，移至最前端并更新时间
      const [existing] = this.items.splice(existingIndex, 1)
      existing.timestamp = Date.now()
      this.items.unshift(existing)
    } else {
      const newItem: ClipboardItem = {
        id: `clip_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        text,
        type: 'text',
        timestamp: Date.now(),
        charCount: text.length,
        lineCount: text.split(/\r?\n/).length,
        pinned: false
      }
      this.items.unshift(newItem)
    }

    this.pruneAndSave()
  }

  private pruneAndSave(): void {
    // 容量上限裁剪（保留置顶项）
    if (this.items.length > MAX_HISTORY_ITEMS) {
      const pinned = this.items.filter((i) => i.pinned)
      const unpinned = this.items.filter((i) => !i.pinned).slice(0, MAX_HISTORY_ITEMS - pinned.length)
      this.items = [...pinned, ...unpinned].sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
        return b.timestamp - a.timestamp
      })
    }

    this.saveToDisk()
    this.emit('changed', this.items)
  }

  public getHistory(): ClipboardItem[] {
    return [...this.items]
  }

  public writeText(text: string): boolean {
    try {
      this.lastCopiedText = text
      clipboard.writeText(text)
      // 同时将其推入或置顶到历史列表
      this.addItem(text)
      return true
    } catch (err) {
      console.error('[ClipboardService] 写入剪贴板文本失败:', err)
      return false
    }
  }

  public writeImage(dataUrl: string): boolean {
    try {
      const img = nativeImage.createFromDataURL(dataUrl)
      if (img.isEmpty()) return false
      const size = img.getSize()
      const buffer = img.toPNG()
      this.lastCopiedImageFingerprint = `${size.width}x${size.height}_${buffer.length}`
      this.lastCopiedText = ''
      clipboard.writeImage(img)
      this.addImageItem(dataUrl, size.width, size.height, buffer.length)
      return true
    } catch (err) {
      console.error('[ClipboardService] 写入剪贴板图片失败:', err)
      return false
    }
  }

  public deleteItem(id: string): boolean {
    const idx = this.items.findIndex((i) => i.id === id)
    if (idx >= 0) {
      this.items.splice(idx, 1)
      this.saveToDisk()
      this.emit('changed', this.items)
      return true
    }
    return false
  }

  public clearHistory(): boolean {
    // 仅清除未置顶的项
    this.items = this.items.filter((i) => i.pinned)
    this.saveToDisk()
    this.emit('changed', this.items)
    return true
  }

  public togglePin(id: string): boolean {
    const item = this.items.find((i) => i.id === id)
    if (item) {
      item.pinned = !item.pinned
      this.saveToDisk()
      this.emit('changed', this.items)
      return true
    }
    return false
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }
}
