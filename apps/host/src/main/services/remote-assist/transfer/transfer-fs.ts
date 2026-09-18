/**
 * 传输用文件系统原语：目录、路径树扫描、分块读取、原子落盘、哈希
 */

import fs from 'node:fs/promises'
import { createReadStream, createWriteStream } from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { isSafeRelPath, resolveWithinRoot } from './transfer-protocol.ts'

export interface TreeEntry {
  relPath: string
  absPath: string
  size: number
  isDirectory: boolean
}

export async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true })
}

/**
 * 真实路径包含性校验。resolveWithinRoot 只做词法判断：若 root 内已存在的符号链接 / Windows
 * 目录联接（junction）指向 root 之外，词法路径仍在 root 内，写入却会落到 root 之外。
 *
 * 做法：自底向上找到 targetPath 最深的「已存在祖先目录」，取其真实路径（realpath，会解析
 * 符号链接），必须等于 realRoot 或以 realRoot + 分隔符 开头，否则判定为经由符号链接逃逸。
 * 该检查必须在任何 ensureDir(target) 之前执行，避免借道符号链接在 root 之外创建目录。
 */
async function assertRealPathWithinRoot(realRoot: string, targetPath: string, relPath: string): Promise<void> {
  let current = path.dirname(targetPath)
  // 自底向上寻找第一个真实存在的目录；都不存在时最终会停在 root 本身（调用方已确保存在）
  while (true) {
    const exists = await fs.stat(current).then((s) => s.isDirectory(), () => false)
    if (exists) break
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }
  const realAncestor = await fs.realpath(current)
  if (realAncestor !== realRoot && !realAncestor.startsWith(realRoot + path.sep)) {
    throw new Error('path escapes root via symlink: ' + relPath)
  }
}

async function walk(rootDir: string, currentDir: string, out: TreeEntry[]): Promise<void> {
  const dirents = await fs.readdir(currentDir, { withFileTypes: true })
  for (const dirent of dirents) {
    const absPath = path.join(currentDir, dirent.name)
    if (dirent.isSymbolicLink()) continue
    if (dirent.isDirectory()) {
      await walk(rootDir, absPath, out)
      continue
    }
    if (!dirent.isFile()) continue
    const relPath = path.relative(rootDir, absPath).replace(/\\/g, '/')
    if (!isSafeRelPath(relPath)) continue
    const stat = await fs.stat(absPath)
    out.push({ relPath, absPath, size: stat.size, isDirectory: false })
  }
}

export async function scanPaths(inputs: string[]): Promise<TreeEntry[]> {
  const out: TreeEntry[] = []
  for (const input of inputs) {
    const abs = path.resolve(input)
    const stat = await fs.stat(abs)
    if (stat.isDirectory()) {
      const rootDir = path.dirname(abs)
      await walk(rootDir, abs, out)
    } else if (stat.isFile()) {
      // 与目录分支保持对称：单文件输入的 basename 同样要做安全校验（保留名、控制字符等）
      const relPath = path.basename(abs)
      if (!isSafeRelPath(relPath)) continue
      out.push({ relPath, absPath: abs, size: stat.size, isDirectory: false })
    }
  }
  return out
}

export function sha256File(absPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    const stream = createReadStream(absPath)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

export async function readChunk(absPath: string, offset: number, length: number): Promise<Uint8Array> {
  const handle = await fs.open(absPath, 'r')
  try {
    const buffer = Buffer.alloc(length)
    const { bytesRead } = await handle.read(buffer, 0, length, offset)
    return new Uint8Array(buffer.subarray(0, bytesRead))
  } finally {
    await handle.close()
  }
}

export class PartWriter {
  readonly partPath: string
  private readonly targetPath: string
  private stream: ReturnType<typeof createWriteStream>
  private finished = false
  bytesWritten = 0
  /** 打开成功后挂载的唯一持久 error 监听记录到的错误；供 write/finalize 感知 */
  private streamError: Error | null = null
  /** 尚未落定的 write/finalize 的 reject 回调；流错误时统一触发，避免悬挂 */
  private pendingRejects: Array<(err: Error) => void> = []
  private readonly handleStreamError = (err: Error): void => {
    this.streamError = err
    const rejects = this.pendingRejects
    this.pendingRejects = []
    for (const reject of rejects) reject(err)
  }

  private constructor(targetPath: string) {
    this.targetPath = targetPath
    this.partPath = `${targetPath}.doujiao.part`
    this.stream = createWriteStream(this.partPath)
  }

  static async open(targetDir: string, relPath: string): Promise<PartWriter> {
    const targetPath = resolveWithinRoot(targetDir, relPath)
    // 保留词法校验后，再补真实路径包含性校验：防御 root 内预置的符号链接/junction 逃逸
    await ensureDir(targetDir)
    const resolvedRoot = await fs.realpath(targetDir)
    await assertRealPathWithinRoot(resolvedRoot, targetPath, relPath)
    await ensureDir(path.dirname(targetPath))
    const writer = new PartWriter(targetPath)
    await writer.waitForOpen()
    return writer
  }

  /**
   * 等待 open：使用临时 once 监听，落定后立即移除，避免残留的 once('error')
   * 把打开后的首个流错误吞掉。open 成功后换成唯一的持久 on('error') 记录错误。
   */
  private waitForOpen(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let settled = false
      const onOpen = (): void => {
        if (settled) return
        settled = true
        this.stream.removeListener('error', onError)
        this.stream.on('error', this.handleStreamError)
        resolve()
      }
      const onError = (err: Error): void => {
        if (settled) return
        settled = true
        this.stream.removeListener('open', onOpen)
        reject(err)
      }
      this.stream.once('open', onOpen)
      this.stream.once('error', onError)
    })
  }

  private trackPending(fail: (err: Error) => void): void {
    this.pendingRejects.push(fail)
  }

  private untrackPending(fail: (err: Error) => void): void {
    const i = this.pendingRejects.indexOf(fail)
    if (i >= 0) this.pendingRejects.splice(i, 1)
  }

  write(chunk: Uint8Array): Promise<void> {
    // 已记录的流错误优先：立即拒绝而不是继续排队写入
    if (this.streamError) return Promise.reject(this.streamError)
    return new Promise<void>((resolve, reject) => {
      let settled = false
      const fail = (err: Error): void => {
        if (settled) return
        settled = true
        this.untrackPending(fail)
        reject(err)
      }
      this.trackPending(fail)
      this.stream.write(Buffer.from(chunk), (err?: Error | null) => {
        if (settled) return
        if (err) {
          fail(err)
          return
        }
        if (this.streamError) {
          fail(this.streamError)
          return
        }
        settled = true
        this.untrackPending(fail)
        // 仅在写回调确认成功后才累加，避免把失败的写入计入进度
        this.bytesWritten += chunk.length
        resolve()
      })
    })
  }

  async finalize(): Promise<string> {
    if (this.streamError) throw this.streamError
    await new Promise<void>((resolve, reject) => {
      let settled = false
      const fail = (err: Error): void => {
        if (settled) return
        settled = true
        this.untrackPending(fail)
        reject(err)
      }
      this.trackPending(fail)
      this.stream.end((err?: Error | null) => {
        if (settled) return
        settled = true
        this.untrackPending(fail)
        if (err) {
          reject(err)
          return
        }
        if (this.streamError) {
          reject(this.streamError)
          return
        }
        resolve()
      })
    })
    if (this.streamError) throw this.streamError
    this.finished = true
    await fs.rename(this.partPath, this.targetPath)
    return this.targetPath
  }

  async abort(): Promise<void> {
    // 先拒绝所有未落定的 write/finalize，否则与 abort 竞态的 write 会永久悬挂
    // （流写回调是唯一的另一条落定路径，close 后不再触发）
    const rejects = this.pendingRejects
    this.pendingRejects = []
    for (const reject of rejects) {
      try {
        reject(new Error('writer aborted'))
      } catch {
        // 已落定的条目重复 reject 是 no-op，忽略即可
      }
    }
    if (!this.finished) {
      await new Promise<void>((resolve) => this.stream.close(() => resolve()))
    }
    await fs.rm(this.partPath, { force: true })
  }
}

export async function estimateFreeBytes(dir: string): Promise<number> {
  try {
    const stat = await fs.statfs(dir)
    return Number(stat.bsize) * Number(stat.bavail)
  } catch {
    // 保留宽松回退（对不支持 statfs 的文件系统直接拦截会误伤所有传输），但不再静默
    console.warn(`[remote-assist] statfs failed for ${dir}; skipping disk-space precheck`)
    return Number.MAX_SAFE_INTEGER
  }
}

export async function cleanupDir(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true })
}
