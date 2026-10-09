import { constants } from 'node:fs'
import { lstat, realpath, open, readdir, link, unlink } from 'node:fs/promises'
import { resolve, relative, join } from 'node:path'
import { randomUUID } from 'node:crypto'

export class NotepadWorkspace {
  private root: string
  private maxBytes: number
  constructor(root: string, maxBytes = 1024 * 1024) { this.root = resolve(root); this.maxBytes = maxBytes }
  private async target(name: string): Promise<string> {
    if (typeof name !== 'string' || name.length > 240 || !/\.txt$/i.test(name) || /[\\:<>?"*|\x00-\x1f]/.test(name)) throw Error('Invalid Notepad path')
    const parts = name.split('/')
    if (parts.some(p => !p || p === '.' || p === '..' || /[. ]$/.test(p) || /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(?:\.|$)/i.test(p))) throw Error('Invalid Notepad path')
    const root = await realpath(this.root)
    if (root !== this.root && resolve(root).toLowerCase() !== this.root.toLowerCase()) throw Error('Workspace root changed')
    let current = root
    for (const p of parts.slice(0, -1)) { current = join(current, p); const stat = await lstat(current); if (stat.isSymbolicLink() || !stat.isDirectory()) throw Error('Unsafe directory') }
    const parent = await realpath(current)
    if (relative(root, parent).startsWith('..') || resolve(parent).toLowerCase() !== resolve(current).toLowerCase()) throw Error('Unsafe directory')
    const result = join(parent, parts.at(-1)!)
    try { if ((await lstat(result)).isSymbolicLink()) throw Error('Unsafe file') } catch(e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e }
    return result
  }
  async create(name: string, content: string, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted()
    if (typeof content !== 'string' || Buffer.byteLength(content, 'utf8') > this.maxBytes) throw Error('Note content is too large')
    const target = await this.target(name)
    const temp = join(this.root, `.ai-${randomUUID()}.tmp`)
    const file = await open(temp, 'wx', 0o600)
    try { await file.writeFile(content, 'utf8'); await file.sync(); await file.close(); await this.target(name); signal?.throwIfAborted(); await link(temp, target) }
    finally { await file.close().catch(()=>{}); await unlink(temp).catch(()=>{}) }
  }
  async read(name: string): Promise<string> {
    const target = await this.target(name)
    const file = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW || 0))
    try { const stat = await file.stat(); if (!stat.isFile() || stat.size > this.maxBytes) throw Error('Note file is too large'); const bytes = Buffer.alloc(this.maxBytes + 1); const { bytesRead } = await file.read(bytes, 0, bytes.length, 0); if (bytesRead > this.maxBytes) throw Error('Note file is too large'); return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, bytesRead)) } finally { await file.close() }
  }
  async list(): Promise<string[]> {
    await realpath(this.root)
    const names: string[] = []
    const walk = async (dir: string, prefix: string, depth: number): Promise<void> => {
      if (depth > 8) return
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        if (names.length >= 1000) return
        const name = prefix + entry.name
        if (entry.isDirectory() && !entry.isSymbolicLink()) { try { await this.target(`${name}/probe.txt`); await walk(join(dir, entry.name), `${name}/`, depth + 1) } catch {} }
        else if (entry.isFile() && /\.txt$/i.test(name)) { try { await this.target(name); names.push(name) } catch {} }
      }
    }
    await walk(this.root, '', 0); return names.sort()
  }
}
