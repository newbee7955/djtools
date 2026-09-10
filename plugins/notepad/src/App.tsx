import React, { useState, useEffect, useMemo } from 'react'
import { getSDK } from '@doujiao/plugin-sdk'
import { VersionHistoryDrawer } from './components/VersionHistoryDrawer'

interface Note {
  id: string
  title: string
  content: string
  pinned: boolean
  updatedAt: number
  color?: string
  fileName?: string
}

const DEFAULT_NOTES: Note[] = [
  {
    id: 'note-welcome.txt',
    fileName: '随手记便签使用指南.txt',
    title: '随手记便签使用指南',
    content: `欢迎使用 豆角轻便记事本！🗒️

这是一款随时随地记录灵感、临时备忘、代办事项与文本片段的随手记工具。

💡 特性提示：
1. 外部安全工作目录：所有便签直接以 .txt 文件保存在系统用户「文档/Doujiao/Notes」目录下，应用卸载或删除也绝不会丢失！
2. 实时自动存盘：键入即自动实时写入外部磁盘，可在顶部查看存盘状态。
3. 自定义工作目录：支持随时更换存储路径，或一键打开所在本地文件夹。
4. 置顶功能：点击右上角的图钉 📌 可以将高频使用的便签置顶在列表顶端。
5. 搜索与导出：支持标题与正文关键词极速搜索，支持一键导出为 .txt 文件。`,
    pinned: true,
    updatedAt: Date.now(),
    color: 'amber'
  }
]

export default function App(): JSX.Element {
  const [notes, setNotes] = useState<Note[]>(() => {
    try {
      const saved = localStorage.getItem('doujiao_notepad_notes')
      if (saved) return JSON.parse(saved)
    } catch {}
    return DEFAULT_NOTES
  })

  const [activeNoteId, setActiveNoteId] = useState<string>(() => notes[0]?.id || 'note-welcome.txt')
  const [searchQuery, setSearchQuery] = useState('')
  const [fontSize, setFontSize] = useState<'sm' | 'base' | 'lg'>('base')
  const [fontFamily, setFontFamily] = useState<'sans' | 'mono'>('sans')
  const [toast, setToast] = useState<string | null>(null)
  const [workspaceDir, setWorkspaceDir] = useState<string>('')
  const [isDiskSaving, setIsDiskSaving] = useState(false)
  const [showDirectoryModal, setShowDirectoryModal] = useState(false)
  const [showHistoryDrawer, setShowHistoryDrawer] = useState(false)

  const activeNote = notes.find((n) => n.id === activeNoteId) || notes[0]

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 2500)
  }

  // 1. 初始化工作目录与磁盘 .txt 文件同步
  const loadWorkspace = async () => {
    try {
      const sdk = getSDK()
      if (sdk?.workspace) {
        const dir = await sdk.workspace.getDirectory('notepad')
        setWorkspaceDir(dir)
        const files = await sdk.workspace.listFiles('notepad', ['.txt'])
        if (files.length === 0) {
          // 首次启动，若本地缓存有旧笔记或默认笔记，自动平滑迁移写入磁盘
          const initialNotes = notes.length > 0 ? notes : DEFAULT_NOTES
          for (const n of initialNotes) {
            const fName = `${(n.title || '便签').replace(/[\\/:*?"<>|]/g, '_')}.txt`
            await sdk.workspace.writeFile(fName, n.content, 'notepad')
          }
          const refreshed = await sdk.workspace.listFiles('notepad', ['.txt'])
          const loaded: Note[] = []
          for (const f of refreshed) {
            const content = await sdk.workspace.readFile(f.relativePath, 'notepad')
            loaded.push({
              id: f.relativePath,
              fileName: f.relativePath,
              title: f.name.replace(/\.txt$/i, ''),
              content,
              pinned: f.name.includes('指南') || f.name.includes('置顶'),
              updatedAt: f.updatedAt
            })
          }
          if (loaded.length > 0) {
            setNotes(loaded)
            setActiveNoteId(loaded[0].id)
          }
        } else {
          const loaded: Note[] = []
          for (const f of files) {
            const content = await sdk.workspace.readFile(f.relativePath, 'notepad')
            loaded.push({
              id: f.relativePath,
              fileName: f.relativePath,
              title: f.name.replace(/\.txt$/i, ''),
              content,
              pinned: f.name.includes('指南') || f.name.includes('置顶'),
              updatedAt: f.updatedAt
            })
          }
          if (loaded.length > 0) {
            setNotes(loaded)
            setActiveNoteId(loaded[0].id)
          }
        }
      }
    } catch (err) {
      console.warn('[Notepad] 读取工作目录失败，使用本地缓存模式:', err)
    }
  }

  useEffect(() => {
    loadWorkspace()
  }, [])

  // 2. 本地自动保存备份
  useEffect(() => {
    try {
      localStorage.setItem('doujiao_notepad_notes', JSON.stringify(notes))
    } catch (err) {
      console.error('[Notepad] 自动保存失败:', err)
    }
  }, [notes])

  // 3. 自动防抖写入外部磁盘物理 .txt 文件与版本历史快照
  useEffect(() => {
    if (!activeNote) return
    const timer = setTimeout(async () => {
      try {
        const sdk = getSDK()
        if (sdk?.workspace) {
          const targetName = activeNote.fileName || `${(activeNote.title || '便签').replace(/[\\/:*?"<>|]/g, '_')}.txt`
          setIsDiskSaving(true)
          await sdk.workspace.writeFile(targetName, activeNote.content, 'notepad')
          if (sdk.workspace.history) {
            await sdk.workspace.history.saveSnapshot('notepad', targetName, activeNote.content, 'auto')
          }
          setIsDiskSaving(false)
        }
      } catch {
        setIsDiskSaving(false)
      }
    }, 1000)
    return () => clearTimeout(timer)
  }, [activeNote?.content])

  // 快捷键 Ctrl+S / Cmd+S 立即存盘并打快照
  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        if (!activeNote) return
        const sdk = getSDK()
        if (sdk?.workspace) {
          const targetName = activeNote.fileName || `${(activeNote.title || '便签').replace(/[\\/:*?"<>|]/g, '_')}.txt`
          setIsDiskSaving(true)
          await sdk.workspace.writeFile(targetName, activeNote.content, 'notepad')
          if (sdk.workspace.history) {
            await sdk.workspace.history.saveSnapshot('notepad', targetName, activeNote.content, 'auto', '手动存盘 (Ctrl+S)')
          }
          setIsDiskSaving(false)
          showToast('已存盘并生成历史快照 💾')
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [activeNote])

  // 更换工作目录
  const handleSelectWorkspaceDir = async () => {
    try {
      const sdk = getSDK()
      if (sdk?.workspace) {
        const res = await sdk.workspace.selectDirectory(workspaceDir)
        if (!res.canceled && res.directoryPath) {
          await sdk.workspace.setDirectory(res.directoryPath, 'notepad')
          setWorkspaceDir(res.directoryPath)
          showToast('工作目录已切换')
          await loadWorkspace()
        }
      }
    } catch (err) {
      console.error('切换工作目录失败:', err)
      showToast('切换工作目录失败')
    }
  }

  // 打开工作目录
  const handleOpenWorkspaceDir = async () => {
    try {
      const sdk = getSDK()
      if (sdk?.workspace) {
        await sdk.workspace.openDirectory('notepad')
      }
    } catch (err) {
      console.error('打开目录失败:', err)
    }
  }

  // 重置工作目录为系统默认
  const handleResetWorkspaceDir = async () => {
    try {
      const sdk = getSDK()
      if (sdk?.workspace?.resetDirectory) {
        const defaultDir = await sdk.workspace.resetDirectory('notepad')
        setWorkspaceDir(defaultDir)
        showToast('已恢复系统默认保存目录')
        await loadWorkspace()
      }
    } catch (err) {
      console.error('重置默认目录失败:', err)
      showToast('重置默认目录失败')
    }
  }

  // 另存为自定义位置
  const handleSaveAs = async () => {
    if (!activeNote) return
    try {
      const sdk = getSDK()
      if (sdk?.workspace?.saveFileAs) {
        const defaultName = `${(activeNote.title || '便签').replace(/[\\/:*?"<>|]/g, '_')}.txt`
        const res = await sdk.workspace.saveFileAs(activeNote.content, defaultName, ['txt'])
        if (!res.canceled && res.filePath) {
          showToast(`已另存为: ${res.fileName || res.filePath}`)
        }
      } else {
        handleExportTxt()
      }
    } catch (err: any) {
      console.error('另存为失败:', err)
      showToast('另存为失败: ' + (err?.message || '未知错误'))
    }
  }

  // 从外部磁盘打开文件
  const handleOpenFile = async () => {
    try {
      const sdk = getSDK()
      if (sdk?.workspace?.selectFileToOpen) {
        const res = await sdk.workspace.selectFileToOpen(['txt', 'log', 'md'])
        if (!res.canceled && res.content !== undefined && res.fileName) {
          const title = res.fileName.replace(/\.(txt|log|md)$/i, '')
          const existing = notes.find((n) => n.title === title || n.fileName === res.fileName)
          if (existing) {
            updateNote('content', res.content)
            setActiveNoteId(existing.id)
            showToast(`已载入文件: ${res.fileName}`)
          } else {
            const newNote: Note = {
              id: res.fileName,
              fileName: res.fileName,
              title,
              content: res.content,
              pinned: false,
              updatedAt: Date.now()
            }
            if (sdk.workspace.writeFile) {
              await sdk.workspace.writeFile(res.fileName, res.content, 'notepad')
            }
            setNotes((prev) => [newNote, ...prev])
            setActiveNoteId(newNote.id)
            showToast(`已打开并导入: ${res.fileName}`)
          }
        }
      }
    } catch (err: any) {
      console.error('打开文件失败:', err)
      showToast('打开文件失败: ' + (err?.message || '未知错误'))
    }
  }

  // 过滤笔记
  const filteredNotes = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return [...notes]
      .filter((n) => {
        if (!q) return true
        return n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q)
      })
      .sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
        return b.updatedAt - a.updatedAt
      })
  }, [notes, searchQuery])

  // 新建笔记
  const handleNewNote = async () => {
    let baseName = '新便签'
    let title = baseName
    let counter = 1
    while (notes.some((n) => n.title === title)) {
      title = `${baseName}_${counter++}`
    }
    const fileName = `${title}.txt`
    const defaultContent = ''

    try {
      const sdk = getSDK()
      if (sdk?.workspace) {
        await sdk.workspace.writeFile(fileName, defaultContent, 'notepad')
      }
    } catch {}

    const newNote: Note = {
      id: fileName,
      fileName,
      title,
      content: defaultContent,
      pinned: false,
      updatedAt: Date.now()
    }
    setNotes((prev) => [newNote, ...prev])
    setActiveNoteId(newNote.id)
    showToast(`已在工作目录新建: ${fileName}`)
  }

  // 更新内容
  const updateNote = async (field: 'title' | 'content', val: string) => {
    if (field === 'title') {
      const safeTitle = val.trim() || '新便签'
      const newFileName = `${safeTitle.replace(/[\\/:*?"<>|]/g, '_')}.txt`
      const oldFileName = activeNote.fileName

      if (oldFileName && oldFileName !== newFileName) {
        try {
          const sdk = getSDK()
          if (sdk?.workspace) {
            await sdk.workspace.renameFile(oldFileName, newFileName, 'notepad')
          }
        } catch (err) {
          console.warn('重命名文件失败:', err)
        }
      }

      setNotes((prev) =>
        prev.map((n) =>
          n.id === activeNote.id
            ? { ...n, title: val, fileName: newFileName, id: newFileName, updatedAt: Date.now() }
            : n
        )
      )
      if (activeNoteId === activeNote.id) {
        setActiveNoteId(newFileName)
      }
    } else {
      setNotes((prev) =>
        prev.map((n) => {
          if (n.id === activeNote.id) {
            return {
              ...n,
              [field]: val,
              updatedAt: Date.now()
            }
          }
          return n
        })
      )
    }
  }

  // 切换置顶
  const togglePin = (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation()
    setNotes((prev) =>
      prev.map((n) => (n.id === id ? { ...n, pinned: !n.pinned, updatedAt: Date.now() } : n))
    )
    showToast('已更新便签置顶状态')
  }

  // 删除便签
  const handleDelete = async (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation()
    if (notes.length <= 1) {
      showToast('请至少保留一个便签')
      return
    }
    const noteToDelete = notes.find((n) => n.id === id)
    if (noteToDelete?.fileName) {
      try {
        const sdk = getSDK()
        if (sdk?.workspace) {
          await sdk.workspace.deleteFile(noteToDelete.fileName, 'notepad')
        }
      } catch (err) {
        console.warn('删除物理文件失败:', err)
      }
    }
    const remaining = notes.filter((n) => n.id !== id)
    setNotes(remaining)
    if (activeNoteId === id) {
      setActiveNoteId(remaining[0].id)
    }
    showToast('便签已从工作目录删除')
  }

  // 复制内容
  const handleCopy = () => {
    if (!activeNote?.content) {
      showToast('当前便签为空，无需复制')
      return
    }
    navigator.clipboard.writeText(activeNote.content).then(() => {
      showToast('内容已复制到系统剪贴板')
    })
  }

  // 导出为 .txt
  const handleExportTxt = () => {
    const blob = new Blob([activeNote.content], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${activeNote.title.replace(/[\\/:*?"<>|]/g, '_') || 'note'}.txt`
    a.click()
    URL.revokeObjectURL(url)
    showToast('已导出为 TXT 文件')
  }

  // 清空当前内容
  const handleClear = () => {
    if (!activeNote.content) return
    updateNote('content', '')
    showToast('已清空当前便签内容')
  }

  // 字数统计
  const text = activeNote?.content || ''
  const charCount = text.length
  const wordCount = (text.match(/[\u4e00-\u9fa5]|\b[a-zA-Z0-9_-]+\b/g) || []).length
  const lineCount = text ? text.split(/\r?\n/).length : 0

  return (
    <div className="h-screen w-screen flex bg-slate-900 text-slate-100 overflow-hidden select-none font-sans">
      {/* 轻量提示 */}
      {toast && (
        <div className="absolute top-4 right-6 z-50 px-4 py-2 rounded-xl bg-amber-600 text-white text-xs shadow-xl shadow-amber-600/30 flex items-center gap-2 animate-bounce">
          <span>🗒️</span>
          <span>{toast}</span>
        </div>
      )}

      {/* 左侧便签列表 */}
      <div className="w-72 min-w-72 bg-slate-950 border-r border-slate-800/80 flex flex-col h-full">
        {/* 标题栏与新建/打开按钮 */}
        <div className="p-3.5 border-b border-slate-800/80 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xl">🗒️</span>
            <div>
              <span className="font-semibold text-xs text-slate-200">轻便记事本</span>
              <span className="text-[10px] ml-1.5 px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 font-mono">
                {notes.length} 条
              </span>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={handleOpenFile}
              className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs flex items-center gap-1 transition-colors"
              title="从外部磁盘打开文本文件..."
            >
              <span>📂 打开</span>
            </button>
            <button
              onClick={handleNewNote}
              className="px-2.5 py-1 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs flex items-center gap-1 shadow transition-colors font-medium"
            >
              <span>+</span>
              <span>新建</span>
            </button>
          </div>
        </div>

        {/* 默认保存目录卡片 (独立外部存储，卸载不丢失) */}
        <div className="p-2.5 bg-slate-900/40 border-b border-slate-800/60 space-y-1.5">
          <div className="flex items-center justify-between text-[11px]">
            <span className="font-medium text-slate-300 flex items-center gap-1">
              <span>📁</span>
              <span>默认保存目录</span>
              <span className="text-[9px] px-1 py-0.2 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">卸载不丢失</span>
            </span>
            <button
              onClick={() => setShowDirectoryModal(true)}
              className="text-[10px] text-amber-400 hover:underline flex items-center gap-0.5"
              title="设置默认保存目录"
            >
              <span>⚙️ 设置</span>
            </button>
          </div>
          <div
            className="text-[10px] font-mono text-slate-400 truncate bg-slate-950/80 px-2 py-1 rounded border border-slate-800/60 cursor-pointer hover:border-slate-700 hover:text-slate-300 transition-colors"
            onClick={() => setShowDirectoryModal(true)}
            title={workspaceDir || '默认安全目录：系统用户「文档/Doujiao/Notes」'}
          >
            {workspaceDir ? workspaceDir : '系统用户「文档/Doujiao/Notes」'}
          </div>
          <div className="flex items-center justify-between gap-1 pt-0.5">
            <button
              onClick={handleOpenWorkspaceDir}
              className="flex-1 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-[10px] transition-colors flex items-center justify-center gap-1"
              title="在 Windows 资源管理器中打开"
            >
              <span>📂 打开</span>
            </button>
            <button
              onClick={handleSelectWorkspaceDir}
              className="flex-1 py-1 rounded bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 text-[10px] transition-colors flex items-center justify-center gap-1"
              title="选择新文件夹作为默认保存目录"
            >
              <span>🔄 更改</span>
            </button>
            <button
              onClick={handleResetWorkspaceDir}
              className="px-2 py-1 rounded bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-slate-200 text-[10px] transition-colors"
              title="恢复系统默认文档目录"
            >
              重置
            </button>
          </div>
        </div>

        {/* 搜索框 */}
        <div className="p-2.5 border-b border-slate-800/60">
          <div className="relative flex items-center">
            <span className="absolute left-3 text-slate-500 text-xs">🔍</span>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索便签标题或正文..."
              className="w-full pl-8 pr-7 py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500/50"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 text-slate-500 hover:text-slate-300 text-xs"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* 便签卡片列表 */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
          {filteredNotes.length === 0 ? (
            <div className="text-center py-12 text-slate-500 text-xs">未搜索到相关便签</div>
          ) : (
            filteredNotes.map((note) => {
              const isActive = note.id === activeNote.id
              const previewText = note.content.trim().slice(0, 50) || '无额外正文...'
              return (
                <div
                  key={note.id}
                  onClick={() => setActiveNoteId(note.id)}
                  className={`group p-3 rounded-xl border text-xs cursor-pointer transition-all relative ${
                    isActive
                      ? 'bg-amber-500/15 border-amber-500/40 text-white shadow-sm'
                      : 'bg-slate-900/40 border-slate-800/40 hover:bg-slate-900 hover:border-slate-800 text-slate-400'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-1.5 overflow-hidden">
                      {note.pinned && <span className="text-amber-400 text-xs">📌</span>}
                      <span className="font-semibold truncate text-slate-200">{note.title}</span>
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={(e) => togglePin(note.id, e)}
                        className={`p-1 hover:text-amber-400 ${note.pinned ? 'text-amber-400' : 'text-slate-500'}`}
                        title={note.pinned ? '取消置顶' : '置顶便签'}
                      >
                        📌
                      </button>
                      {notes.length > 1 && (
                        <button
                          onClick={(e) => handleDelete(note.id, e)}
                          className="p-1 hover:text-rose-400 text-slate-500"
                          title="删除便签"
                        >
                          🗑️
                        </button>
                      )}
                    </div>
                  </div>

                  <p className="text-[11px] text-slate-500 line-clamp-2 leading-relaxed">
                    {previewText}
                  </p>

                  <div className="flex items-center justify-between text-[10px] text-slate-600 mt-2 font-mono">
                    <span>{note.content.length} 字符</span>
                    <span>{new Date(note.updatedAt).toLocaleDateString([], { month: '2-digit', day: '2-digit' })} {new Date(note.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* 右侧主编辑器 */}
      <div className="flex-1 flex flex-col h-full overflow-hidden bg-slate-900">
        {/* 顶部控制栏 */}
        <div className="h-13 px-4 bg-slate-950/90 border-b border-slate-800/80 flex items-center justify-between shrink-0 gap-3">
          {/* 左侧：标题与存盘状态 */}
          <div className="flex items-center gap-2.5 flex-1 min-w-0 mr-2">
            <input
              type="text"
              value={activeNote.title}
              onChange={(e) => updateNote('title', e.target.value)}
              className="bg-transparent text-sm font-semibold text-white border-b border-transparent hover:border-slate-700 focus:border-amber-500 focus:outline-none px-1 py-0.5 w-full truncate placeholder-slate-500 transition-colors"
              placeholder="输入便签标题..."
            />
            {isDiskSaving ? (
              <span className="text-[11px] text-amber-400 flex items-center gap-1 font-mono shrink-0 whitespace-nowrap select-none">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse"></span>
                写入中...
              </span>
            ) : (
              <span className="text-[11px] text-slate-500 hover:text-slate-400 flex items-center gap-1 font-mono shrink-0 whitespace-nowrap transition-colors select-none" title="已自动实时保存至外部磁盘文件">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                已存盘
              </span>
            )}
          </div>

          {/* 右侧：规范化整理的工具组 */}
          <div className="flex items-center gap-2 shrink-0">
            {/* 组 1：字号与字体 */}
            <div className="flex items-center bg-slate-900 border border-slate-800 rounded-lg p-0.5 text-xs shrink-0 shadow-sm">
              <button
                onClick={() => setFontSize('sm')}
                className={`px-1.5 py-0.5 rounded text-[11px] font-medium transition-all ${
                  fontSize === 'sm' ? 'bg-amber-600/30 text-amber-300 font-semibold shadow-xs' : 'text-slate-400 hover:text-slate-200'
                }`}
                title="缩小字号"
              >
                A-
              </button>
              <button
                onClick={() => setFontSize('base')}
                className={`px-1.5 py-0.5 rounded text-[11px] font-medium transition-all ${
                  fontSize === 'base' ? 'bg-amber-600/30 text-amber-300 font-semibold shadow-xs' : 'text-slate-400 hover:text-slate-200'
                }`}
                title="标准字号"
              >
                A
              </button>
              <button
                onClick={() => setFontSize('lg')}
                className={`px-1.5 py-0.5 rounded text-[11px] font-medium transition-all ${
                  fontSize === 'lg' ? 'bg-amber-600/30 text-amber-300 font-semibold shadow-xs' : 'text-slate-400 hover:text-slate-200'
                }`}
                title="放大字号"
              >
                A+
              </button>
              <div className="w-px h-3 bg-slate-800 mx-1" />
              <button
                onClick={() => setFontFamily((prev) => (prev === 'sans' ? 'mono' : 'sans'))}
                className="px-1.5 py-0.5 rounded text-[11px] text-slate-400 hover:text-slate-200 font-mono transition-colors whitespace-nowrap"
                title="切换等宽/标准字体"
              >
                {fontFamily === 'mono' ? '等宽' : '标准'}
              </button>
            </div>

            {/* 分隔线 */}
            <div className="w-px h-4 bg-slate-800/80 shrink-0" />

            {/* 组 2：编辑与历史 */}
            <div className="flex items-center gap-1 shrink-0">
              {/* 置顶按钮 (紧凑图标式 Toggle) */}
              <button
                onClick={() => togglePin(activeNote.id)}
                className={`p-1.5 rounded-lg border text-xs transition-all flex items-center justify-center shrink-0 ${
                  activeNote.pinned
                    ? 'bg-amber-500/20 border-amber-500/50 text-amber-300 shadow-sm shadow-amber-500/10'
                    : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                }`}
                title={activeNote.pinned ? '已置顶 (点击取消置顶)' : '置顶此便签'}
              >
                📌
              </button>

              {/* 复制全文 */}
              <button
                onClick={handleCopy}
                className="p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 text-slate-400 hover:text-slate-200 text-xs transition-colors flex items-center justify-center shrink-0"
                title="复制全文"
              >
                📋
              </button>

              {/* 版本历史 */}
              <button
                onClick={() => setShowHistoryDrawer(true)}
                className="px-2 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 text-xs text-slate-300 hover:text-amber-400 transition-colors flex items-center gap-1 shrink-0 whitespace-nowrap"
                title="查看版本历史快照与对比 (Ctrl+H)"
              >
                <span>🕒</span>
                <span className="text-[11px]">历史</span>
              </button>
            </div>

            {/* 分隔线 */}
            <div className="w-px h-4 bg-slate-800/80 shrink-0" />

            {/* 组 3：文件管理与存储 */}
            <div className="flex items-center gap-1 shrink-0">
              {/* 另存为 */}
              <button
                onClick={handleSaveAs}
                className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-750 border border-slate-700 hover:border-slate-600 text-slate-200 hover:text-white text-xs font-medium transition-all flex items-center gap-1.5 shrink-0 whitespace-nowrap shadow-xs"
                title="将当前便签另存为外部文件..."
              >
                <span>💾</span>
                <span className="text-[11px]">另存为</span>
              </button>

              {/* 默认目录设置 */}
              <button
                onClick={() => setShowDirectoryModal(true)}
                className="p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 text-slate-400 hover:text-slate-200 text-xs transition-colors flex items-center justify-center shrink-0"
                title="设置默认保存目录与工作文件夹"
              >
                ⚙️
              </button>

              {/* 清空便签 */}
              <button
                onClick={handleClear}
                className="p-1.5 rounded-lg bg-slate-900 hover:bg-rose-950/40 border border-slate-800 hover:border-rose-900/50 text-slate-400 hover:text-rose-400 text-xs transition-colors flex items-center justify-center shrink-0"
                title="清空当前便签内容"
              >
                🧹
              </button>
            </div>
          </div>
        </div>

        {/* 核心文本编辑区 */}
        <div className="flex-1 p-6 overflow-hidden">
          <textarea
            value={activeNote.content}
            onChange={(e) => updateNote('content', e.target.value)}
            placeholder="随时记录你的灵感、备忘、代办事项或临时草稿..."
            className={`w-full h-full bg-transparent resize-none focus:outline-none leading-relaxed text-slate-100 placeholder-slate-600 selection:bg-amber-500/30 ${
              fontFamily === 'mono' ? 'font-mono' : 'font-sans'
            } ${
              fontSize === 'sm'
                ? 'text-xs'
                : fontSize === 'base'
                ? 'text-sm'
                : 'text-base leading-loose'
            }`}
            spellCheck={false}
          />
        </div>

        {/* 底部状态栏 */}
        <div className="h-7 px-5 bg-slate-950 border-t border-slate-800/80 text-[11px] text-slate-500 flex items-center justify-between font-mono shrink-0">
          <div className="flex items-center gap-4">
            <span>字数: <strong className="text-slate-300">{wordCount}</strong></span>
            <span>字符数: <strong className="text-slate-300">{charCount}</strong></span>
            <span>行数: <strong className="text-slate-300">{lineCount}</strong></span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
            <span>实时输入即存</span>
          </div>
        </div>
      </div>

      {/* 默认保存目录设置弹窗 */}
      {showDirectoryModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span className="text-xl">⚙️</span>
                <h3 className="font-bold text-white text-sm">便签默认保存目录设置</h3>
              </div>
              <button
                onClick={() => setShowDirectoryModal(false)}
                className="text-slate-400 hover:text-white text-sm p-1"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-slate-400 leading-relaxed">
              新建的便签将自动保存为 <code className="text-amber-300 font-mono">.txt</code> 纯文本文件实时同步到此目录。独立保存在用户本地磁盘，即使应用卸载或升级也绝对不会丢失您的任何便签。
            </p>

            <div className="space-y-1.5">
              <span className="text-[11px] font-medium text-slate-400">当前默认保存目录：</span>
              <div
                onClick={() => {
                  navigator.clipboard.writeText(workspaceDir)
                  showToast('已复制路径到剪贴板')
                }}
                className="p-2.5 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono text-amber-300/90 break-all select-all cursor-pointer hover:border-slate-700"
                title="点击复制完整路径"
              >
                {workspaceDir || '系统用户「文档/Doujiao/Notes」'}
              </div>
            </div>

            <div className="flex items-center gap-2 pt-2">
              <button
                onClick={handleOpenWorkspaceDir}
                className="flex-1 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition-colors flex items-center justify-center gap-1.5"
              >
                <span>📂</span>
                <span>打开所在文件夹</span>
              </button>
              <button
                onClick={async () => {
                  await handleSelectWorkspaceDir()
                }}
                className="flex-1 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-medium shadow-md shadow-amber-600/20 transition-all flex items-center justify-center gap-1.5"
              >
                <span>🔄</span>
                <span>更改默认目录</span>
              </button>
            </div>

            <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between">
              <button
                onClick={handleResetWorkspaceDir}
                className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
              >
                恢复系统默认目录
              </button>
              <button
                onClick={() => setShowDirectoryModal(false)}
                className="px-4 py-1.5 rounded-xl bg-slate-800 text-xs text-slate-300 hover:text-white transition-colors"
              >
                完成
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 文件版本控制抽屉 */}
      <VersionHistoryDrawer
        isOpen={showHistoryDrawer}
        onClose={() => setShowHistoryDrawer(false)}
        scope="notepad"
        fileName={activeNote.fileName || `${(activeNote.title || '便签').replace(/[\\/:*?"<>|]/g, '_')}.txt`}
        currentContent={activeNote.content}
        onRestoreContent={(content) => {
          updateNote('content', content)
          showToast('已恢复历史版本内容 ↩️')
        }}
        onShowToast={showToast}
      />
    </div>
  )
}
