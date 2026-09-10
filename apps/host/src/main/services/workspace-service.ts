import { app, dialog, shell } from 'electron'
import path from 'path'
import fs from 'fs'
import { execFileSync, execSync } from 'child_process'
import type {
  WorkspaceFileItem,
  WorkspaceSnapshotItem,
  WorkspaceGitStatus,
  WorkspaceGitCommitItem
} from '@doujiao/plugin-sdk'

export class WorkspaceService {
  private static instance: WorkspaceService
  private configFile: string
  private config: Record<string, string> = {}

  private constructor() {
    this.configFile = path.join(app.getPath('userData'), 'workspace-config.json')
    this.loadConfig()
  }

  public static getInstance(): WorkspaceService {
    if (!WorkspaceService.instance) {
      WorkspaceService.instance = new WorkspaceService()
    }
    return WorkspaceService.instance
  }

  private loadConfig(): void {
    try {
      if (fs.existsSync(this.configFile)) {
        this.config = JSON.parse(fs.readFileSync(this.configFile, 'utf-8'))
      }
    } catch {
      this.config = {}
    }
  }

  private saveConfig(): void {
    try {
      fs.writeFileSync(this.configFile, JSON.stringify(this.config, null, 2), 'utf-8')
    } catch (err) {
      console.error('[WorkspaceService] 保存配置失败:', err)
    }
  }

  public getDefaultDirectory(scope: string): string {
    const base = path.join(app.getPath('documents'), 'Doujiao')
    const folder =
      scope === 'markdown-editor'
        ? 'Markdown'
        : scope === 'notepad'
          ? 'Notes'
          : scope === 'image-editor'
            ? 'Images'
            : scope === 'time-album'
              ? 'Photos'
              : scope || 'Workspace'
    const target = path.join(base, folder)
    if (!fs.existsSync(target)) {
      fs.mkdirSync(target, { recursive: true })
    }
    return target
  }

  public getDirectory(scope: string): string {
    const custom = this.config[scope]
    if (custom && fs.existsSync(custom)) {
      return custom
    }
    return this.getDefaultDirectory(scope)
  }

  public setDirectory(scope: string, dirPath: string): string {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true })
    }
    this.config[scope] = dirPath
    this.saveConfig()
    return dirPath
  }

  public resetDirectory(scope: string): string {
    delete this.config[scope]
    this.saveConfig()
    return this.getDefaultDirectory(scope)
  }

  public async selectDirectory(defaultPath?: string): Promise<{ canceled: boolean; directoryPath?: string }> {
    const res = await dialog.showOpenDialog({
      title: '选择工作存储目录',
      defaultPath: defaultPath,
      properties: ['openDirectory', 'createDirectory']
    })
    if (res.canceled || res.filePaths.length === 0) {
      return { canceled: true }
    }
    return { canceled: false, directoryPath: res.filePaths[0] }
  }

  public async saveFileAs(
    content: string,
    defaultName?: string,
    extensions?: string[]
  ): Promise<{ canceled: boolean; filePath?: string; fileName?: string }> {
    const defaultExt = extensions && extensions[0] ? extensions[0].replace(/^\./, '') : 'txt'
    const filters = extensions && extensions.length > 0
      ? [{ name: `${defaultExt.toUpperCase()} Files`, extensions: extensions.map((e) => e.replace(/^\./, '')) }]
      : [{ name: 'All Files', extensions: ['*'] }]

    const res = await dialog.showSaveDialog({
      title: '将文件另存为...',
      defaultPath: defaultName || `未命名.${defaultExt}`,
      filters
    })

    if (res.canceled || !res.filePath) {
      return { canceled: true }
    }

    this.writeContent(res.filePath, content)
    return {
      canceled: false,
      filePath: res.filePath,
      fileName: path.basename(res.filePath)
    }
  }

  public async selectFileToOpen(
    extensions?: string[]
  ): Promise<{ canceled: boolean; filePath?: string; content?: string; fileName?: string }> {
    const defaultExt = extensions && extensions[0] ? extensions[0].replace(/^\./, '') : '*'
    const filters = extensions && extensions.length > 0
      ? [{ name: `${defaultExt.toUpperCase()} Files`, extensions: extensions.map((e) => e.replace(/^\./, '')) }]
      : [{ name: 'All Files', extensions: ['*'] }]

    const res = await dialog.showOpenDialog({
      title: '选择要打开的文件',
      properties: ['openFile'],
      filters
    })

    if (res.canceled || res.filePaths.length === 0) {
      return { canceled: true }
    }

    const filePath = res.filePaths[0]
    const content = this.readContent(filePath)
    return {
      canceled: false,
      filePath,
      content,
      fileName: path.basename(filePath)
    }
  }

  public listFiles(scope: string, extensions?: string[], subPath = '', recursive = false): WorkspaceFileItem[] {
    const baseDir = this.getDirectory(scope)
    const targetDir = subPath ? this.resolveSafePath(scope, subPath) : baseDir
    if (!fs.existsSync(targetDir)) return []

    const extSet = extensions && extensions.length > 0
      ? new Set(extensions.map((e) => (e.startsWith('.') ? e.toLowerCase() : `.${e.toLowerCase()}`)))
      : null

    try {
      const result: WorkspaceFileItem[] = []

      const scan = (dir: string, currentRel: string) => {
        const entries = fs.readdirSync(dir, { withFileTypes: true })
        for (const entry of entries) {
          if (entry.name.startsWith('.') || entry.name === 'node_modules') continue

          const ext = path.extname(entry.name).toLowerCase()
          const fullPath = path.join(dir, entry.name)
          const relPath = currentRel ? path.posix.join(currentRel.replace(/\\/g, '/'), entry.name) : entry.name

          if (entry.isDirectory()) {
            if (!recursive) {
              try {
                const stat = fs.statSync(fullPath)
                result.push({
                  name: entry.name,
                  relativePath: relPath,
                  size: stat.size,
                  updatedAt: stat.mtimeMs,
                  isDirectory: true
                })
              } catch {}
            } else {
              scan(fullPath, relPath)
            }
          } else {
            if (extSet && !extSet.has(ext)) continue
            try {
              const stat = fs.statSync(fullPath)
              result.push({
                name: entry.name,
                relativePath: relPath,
                size: stat.size,
                updatedAt: stat.mtimeMs,
                isDirectory: false
              })
            } catch {}
          }
        }
      }

      scan(targetDir, subPath)

      // 目录优先，同类型按更新时间倒序
      return result.sort((a, b) => {
        if (a.isDirectory && !b.isDirectory) return -1
        if (!a.isDirectory && b.isDirectory) return 1
        return b.updatedAt - a.updatedAt
      })
    } catch (err) {
      console.error('[WorkspaceService] 读取目录失败:', err)
      return []
    }
  }

  private resolveSafePath(scope: string, relativePath: string): string {
    const baseDir = path.resolve(this.getDirectory(scope))
    const resolved = path.resolve(baseDir, relativePath)
    const rel = path.relative(baseDir, resolved)
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error('[Security] 禁止跨越工作目录访问外部路径')
    }
    return resolved
  }

  private writeContent(targetPath: string, content: string): void {
    const match = typeof content === 'string' ? content.match(/^data:([a-zA-Z0-9\/\+\-\.]+);base64,(.+)$/) : null
    if (match) {
      fs.writeFileSync(targetPath, Buffer.from(match[2], 'base64'))
    } else {
      fs.writeFileSync(targetPath, content, 'utf-8')
    }
  }

  private readContent(targetPath: string): string {
    const ext = path.extname(targetPath).toLowerCase().replace(/^\./, '')
    const imageMimes: Record<string, string> = {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      webp: 'image/webp',
      gif: 'image/gif',
      bmp: 'image/bmp',
      svg: 'image/svg+xml',
      ico: 'image/x-icon'
    }
    const mime = imageMimes[ext]
    if (mime) {
      const buf = fs.readFileSync(targetPath)
      return `data:${mime};base64,${buf.toString('base64')}`
    }
    return fs.readFileSync(targetPath, 'utf-8')
  }

  public readFile(scope: string, relativePath: string): string {
    const fullPath = this.resolveSafePath(scope, relativePath)
    if (!fs.existsSync(fullPath)) {
      throw new Error(`文件不存在: ${relativePath}`)
    }
    return this.readContent(fullPath)
  }

  public writeFile(scope: string, relativePath: string, content: string): { success: boolean; filePath: string } {
    const fullPath = this.resolveSafePath(scope, relativePath)
    const parent = path.dirname(fullPath)
    if (!fs.existsSync(parent)) {
      fs.mkdirSync(parent, { recursive: true })
    }
    this.writeContent(fullPath, content)
    return { success: true, filePath: fullPath }
  }

  public deleteFile(scope: string, relativePath: string): boolean {
    const fullPath = this.resolveSafePath(scope, relativePath)
    if (fs.existsSync(fullPath)) {
      const stat = fs.statSync(fullPath)
      if (stat.isDirectory()) {
        fs.rmSync(fullPath, { recursive: true, force: true })
      } else {
        fs.unlinkSync(fullPath)
      }
      return true
    }
    return false
  }

  public renameFile(scope: string, oldName: string, newName: string): boolean {
    const oldPath = this.resolveSafePath(scope, oldName)
    const newPath = this.resolveSafePath(scope, newName)
    if (!fs.existsSync(oldPath)) {
      throw new Error(`原文件不存在: ${oldName}`)
    }
    fs.renameSync(oldPath, newPath)
    return true
  }

  public createDirectory(scope: string, relativePath: string): { success: boolean; dirPath: string } {
    const fullPath = this.resolveSafePath(scope, relativePath)
    if (fs.existsSync(fullPath)) {
      return { success: true, dirPath: fullPath }
    }
    fs.mkdirSync(fullPath, { recursive: true })
    return { success: true, dirPath: fullPath }
  }

  public async openDirectory(scope: string): Promise<void> {
    const dir = this.getDirectory(scope)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    await shell.openPath(dir)
  }

  // ==========================================
  // 本地历史版本快照 (Local History Snapshots)
  // ==========================================

  private getHistoryDir(scope: string, relativePath: string): string {
    const dir = this.getDirectory(scope)
    const safeName = relativePath.replace(/[\\/:*?"<>|]/g, '_')
    const historyDir = path.join(dir, '.history', safeName)
    if (!fs.existsSync(historyDir)) {
      fs.mkdirSync(historyDir, { recursive: true })
    }
    return historyDir
  }

  public saveSnapshot(
    scope: string,
    relativePath: string,
    content: string,
    type: 'auto' | 'milestone' = 'auto',
    label?: string
  ): WorkspaceSnapshotItem {
    const historyDir = this.getHistoryDir(scope, relativePath)
    const existingList = this.listSnapshots(scope, relativePath)
    const timestamp = Date.now()
    const charCount = content.length
    const size = Buffer.byteLength(content, 'utf-8')

    // 1. 如果最新一条快照内容完全一致，避免冗余存储
    if (existingList.length > 0) {
      try {
        const latestContent = this.getSnapshot(scope, relativePath, existingList[0].id)
        if (latestContent === content && type === 'auto') {
          return existingList[0]
        }
      } catch {}
    }

    // 2. 连续编辑智能合并窗口 (Merge Window = 5 分钟)
    // 如果上一条也是自动快照 (auto)，且在 5 分钟之内，且非单次大跨度粘贴/删除 (>200 字)，且非显式手动保存：
    // 则合并更新最近那条快照的内容与时间戳，避免高频打字产生大量无意义琐碎快照
    const MERGE_WINDOW_MS = 5 * 60 * 1000 // 5 分钟合并窗口
    const isManualSave = label === '手动保存' || label === 'Ctrl+S'

    if (
      type === 'auto' &&
      !isManualSave &&
      existingList.length > 0 &&
      existingList[0].type === 'auto'
    ) {
      const latestSnap = existingList[0]
      const timeDiff = timestamp - latestSnap.timestamp
      const charDiff = Math.abs(charCount - latestSnap.charCount)

      if (timeDiff < MERGE_WINDOW_MS && charDiff < 200) {
        // 计算相对于基础版本（合并窗口前的一个版本）的累计差异
        const baseSnap = existingList[1]
        let summary: string
        if (baseSnap) {
          const cumulativeDiff = charCount - baseSnap.charCount
          summary = `${cumulativeDiff >= 0 ? '+' : ''}${cumulativeDiff} 字`
        } else {
          summary = `${charCount} 字 (编辑中)`
        }

        const updatedData = {
          id: latestSnap.id,
          timestamp,
          type: 'auto',
          label: latestSnap.label,
          charCount,
          size,
          summary,
          content
        }

        const filePath = path.join(historyDir, `${latestSnap.id}.json`)
        fs.writeFileSync(filePath, JSON.stringify(updatedData, null, 2), 'utf-8')

        return {
          id: latestSnap.id,
          timestamp,
          type: 'auto',
          label: latestSnap.label,
          charCount,
          size,
          summary
        }
      }
    }

    // 3. 超出合并窗口、重大变更或里程碑，创建全新版本快照
    const snapId = `snap_${timestamp}`

    // 计算与上一版本的简要差异
    let summary: string | undefined
    if (existingList.length > 0) {
      const charDiff = charCount - existingList[0].charCount
      summary = `${charDiff >= 0 ? '+' : ''}${charDiff} 字`
    } else {
      summary = '初始版本'
    }

    const snapshotData = {
      id: snapId,
      timestamp,
      type,
      label: label || (type === 'milestone' ? '未命名里程碑' : undefined),
      charCount,
      size,
      summary,
      content
    }

    const filePath = path.join(historyDir, `${snapId}.json`)
    fs.writeFileSync(filePath, JSON.stringify(snapshotData, null, 2), 'utf-8')

    // 容量保护：最多保留 50 个快照，自动清理多余的 auto 类型旧快照，保留 milestone
    if (existingList.length >= 50) {
      const autoSnaps = existingList.filter((s) => s.type === 'auto').sort((a, b) => a.timestamp - b.timestamp)
      while (autoSnaps.length > 40) {
        const oldest = autoSnaps.shift()
        if (oldest) {
          const oldFile = path.join(historyDir, `${oldest.id}.json`)
          if (fs.existsSync(oldFile)) {
            try {
              fs.unlinkSync(oldFile)
            } catch {}
          }
        }
      }
    }

    return {
      id: snapId,
      timestamp,
      type,
      label: snapshotData.label,
      charCount,
      size,
      summary
    }
  }

  public listSnapshots(scope: string, relativePath: string): WorkspaceSnapshotItem[] {
    const dir = this.getDirectory(scope)
    const safeName = relativePath.replace(/[\\/:*?"<>|]/g, '_')
    const historyDir = path.join(dir, '.history', safeName)
    if (!fs.existsSync(historyDir)) return []

    try {
      const files = fs.readdirSync(historyDir).filter((f) => f.endsWith('.json'))
      const list: WorkspaceSnapshotItem[] = []

      for (const f of files) {
        try {
          const fullPath = path.join(historyDir, f)
          const data = JSON.parse(fs.readFileSync(fullPath, 'utf-8'))
          list.push({
            id: data.id,
            timestamp: data.timestamp,
            type: data.type || 'auto',
            label: data.label,
            charCount: data.charCount ?? 0,
            size: data.size ?? 0,
            summary: data.summary
          })
        } catch {}
      }

      return list.sort((a, b) => b.timestamp - a.timestamp)
    } catch (err) {
      console.error('[WorkspaceService] 读取历史快照失败:', err)
      return []
    }
  }

  public getSnapshot(scope: string, relativePath: string, snapshotId: string): string {
    const dir = this.getDirectory(scope)
    const safeName = relativePath.replace(/[\\/:*?"<>|]/g, '_')
    const filePath = path.join(dir, '.history', safeName, `${snapshotId}.json`)
    if (!fs.existsSync(filePath)) {
      throw new Error(`快照不存在: ${snapshotId}`)
    }
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
    return data.content || ''
  }

  public deleteSnapshot(scope: string, relativePath: string, snapshotId: string): boolean {
    const dir = this.getDirectory(scope)
    const safeName = relativePath.replace(/[\\/:*?"<>|]/g, '_')
    const filePath = path.join(dir, '.history', safeName, `${snapshotId}.json`)
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
      return true
    }
    return false
  }

  // ==========================================
  // 专业 Git 版本控制 (Git Version Control)
  // ==========================================

  public isGitInstalled(): boolean {
    try {
      execSync('git --version', { stdio: 'ignore' })
      return true
    } catch {
      return false
    }
  }

  private runGit(dir: string, args: string[], inputBuffer?: Buffer | string): string {
    const defaultFlags = [
      '-c', 'core.quotepath=false',
      '-c', 'gui.encoding=utf-8',
      '-c', 'i18n.commitencoding=utf-8',
      '-c', 'i18n.logoutputencoding=utf-8'
    ]
    return execFileSync('git', [...defaultFlags, ...args], {
      cwd: dir,
      encoding: 'utf-8',
      input: inputBuffer,
      env: {
        ...process.env,
        LANG: 'zh_CN.UTF-8',
        LC_ALL: 'zh_CN.UTF-8'
      },
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim()
  }

  private unquoteGitPath(p: string): string {
    if (p.startsWith('"') && p.endsWith('"')) {
      p = p.slice(1, -1)
      const bytes: number[] = []
      for (let i = 0; i < p.length; i++) {
        if (p[i] === '\\' && i + 3 < p.length && /^[0-7]{3}$/.test(p.slice(i + 1, i + 4))) {
          bytes.push(parseInt(p.slice(i + 1, i + 4), 8))
          i += 3
        } else if (p[i] === '\\' && i + 1 < p.length) {
          const next = p[i + 1]
          if (next === 'n') bytes.push(0x0a)
          else if (next === 't') bytes.push(0x09)
          else if (next === '\\') bytes.push(0x5c)
          else if (next === '"') bytes.push(0x22)
          else bytes.push(p.charCodeAt(i + 1))
          i += 1
        } else {
          bytes.push(p.charCodeAt(i))
        }
      }
      return Buffer.from(bytes).toString('utf-8')
    }
    return p
  }

  public gitStatus(scope: string): WorkspaceGitStatus {
    const installed = this.isGitInstalled()
    if (!installed) {
      return { installed: false, isRepo: false }
    }

    const dir = this.getDirectory(scope)
    const gitDir = path.join(dir, '.git')
    if (!fs.existsSync(gitDir)) {
      return { installed: true, isRepo: false }
    }

    try {
      let branch = 'main'
      try {
        branch = this.runGit(dir, ['rev-parse', '--abbrev-ref', 'HEAD'])
      } catch {}

      const statusOutput = this.runGit(dir, ['status', '--porcelain'])
      if (!statusOutput) {
        return { installed: true, isRepo: true, branch, clean: true, modifiedFiles: [], untrackedFiles: [], stagedFiles: [] }
      }

      const modified: string[] = []
      const untracked: string[] = []
      const staged: string[] = []

      for (const line of statusOutput.split('\n')) {
        if (!line.trim()) continue
        const x = line[0]
        const y = line[1]
        const rawFile = line.slice(3).trim()
        const file = this.unquoteGitPath(rawFile)
        if (x === '?' && y === '?') {
          untracked.push(file)
        } else {
          if (x !== ' ' && x !== '?') staged.push(file)
          if (y !== ' ' && y !== '?') modified.push(file)
        }
      }

      return {
        installed: true,
        isRepo: true,
        branch,
        clean: modified.length === 0 && untracked.length === 0 && staged.length === 0,
        modifiedFiles: modified,
        untrackedFiles: untracked,
        stagedFiles: staged
      }
    } catch (err) {
      console.error('[WorkspaceService] gitStatus 错误:', err)
      return { installed: true, isRepo: true, clean: true }
    }
  }

  public gitInit(scope: string): { success: boolean; message?: string } {
    const dir = this.getDirectory(scope)
    try {
      this.runGit(dir, ['init'])

      // 配置 Git 中文防乱码与 UTF-8 编码策略
      try {
        this.runGit(dir, ['config', 'core.quotepath', 'false'])
        this.runGit(dir, ['config', 'gui.encoding', 'utf-8'])
        this.runGit(dir, ['config', 'i18n.commitencoding', 'utf-8'])
        this.runGit(dir, ['config', 'i18n.logoutputencoding', 'utf-8'])
      } catch {}

      // 写入标准 .gitignore
      const gitignorePath = path.join(dir, '.gitignore')
      if (!fs.existsSync(gitignorePath)) {
        fs.writeFileSync(
          gitignorePath,
          '# 豆角工具箱忽略文件\n.history/\n*.tmp\n.DS_Store\nThumbs.db\n',
          'utf-8'
        )
      }

      // 初次提交
      try {
        this.runGit(dir, ['add', '.gitignore'])
        const initBuf = Buffer.from('Initial commit by Doujiao', 'utf-8')
        this.runGit(dir, ['commit', '-F', '-'], initBuf)
      } catch {}

      return { success: true, message: 'Git 仓库初始化成功' }
    } catch (err: any) {
      console.error('[WorkspaceService] gitInit 失败:', err)
      return { success: false, message: err?.message || 'Git 初始化失败' }
    }
  }

  public gitCommit(scope: string, message: string, files?: string[]): { success: boolean; commitHash?: string; error?: string } {
    const dir = this.getDirectory(scope)
    try {
      if (files && files.length > 0) {
        this.runGit(dir, ['add', ...files])
      } else {
        this.runGit(dir, ['add', '-A'])
      }

      // 通过 stdin 传入 UTF-8 Buffer，规避 Windows 命令行参数 ANSI 代码页导致的中文乱码
      const msgBuf = Buffer.from(message.trim() || 'Update documents', 'utf-8')
      this.runGit(dir, ['commit', '-F', '-'], msgBuf)
      const hash = this.runGit(dir, ['rev-parse', 'HEAD'])
      return { success: true, commitHash: hash }
    } catch (err: any) {
      console.error('[WorkspaceService] gitCommit 失败:', err)
      return { success: false, error: err?.message || 'Git 提交失败' }
    }
  }

  public gitLog(scope: string, relativePath?: string, maxCount = 50): WorkspaceGitCommitItem[] {
    const dir = this.getDirectory(scope)
    const gitDir = path.join(dir, '.git')
    if (!fs.existsSync(gitDir)) return []

    try {
      const args = ['log', `-n`, maxCount.toString(), '--pretty=format:%H|%h|%an|%ad|%at|%s', '--date=iso']
      if (relativePath) {
        args.push('--', relativePath)
      }

      const raw = this.runGit(dir, args)
      if (!raw) return []

      const items: WorkspaceGitCommitItem[] = []
      for (const line of raw.split('\n')) {
        if (!line.trim()) continue
        const parts = line.split('|')
        if (parts.length >= 6) {
          items.push({
            hash: parts[0],
            shortHash: parts[1],
            author: parts[2],
            date: parts[3],
            timestamp: parseInt(parts[4], 10) * 1000,
            message: parts.slice(5).join('|')
          })
        }
      }
      return items
    } catch (err) {
      return []
    }
  }

  public gitShowFile(scope: string, commitHash: string, relativePath: string): string {
    const dir = this.getDirectory(scope)
    const cleanPath = relativePath.replace(/\\/g, '/')
    try {
      return this.runGit(dir, ['show', `${commitHash}:${cleanPath}`])
    } catch {
      return ''
    }
  }

  public gitCheckout(scope: string, commitHash: string, relativePath: string): { success: boolean; error?: string } {
    const dir = this.getDirectory(scope)
    try {
      this.runGit(dir, ['checkout', commitHash, '--', relativePath])
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err?.message || '检出失败' }
    }
  }
}
