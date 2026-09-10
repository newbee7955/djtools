import React, { useState, useEffect, useRef } from 'react'
import { getSDK } from '@doujiao/plugin-sdk'
import { renderMarkdown } from './lib/markdown'
import { VersionHistoryDrawer } from './components/VersionHistoryDrawer'

interface MarkdownDoc {
  id: string
  title: string
  content: string
  updatedAt: number
  fileName?: string
}

const DEFAULT_DOCS: MarkdownDoc[] = [
  {
    id: 'welcome-doc',
    title: '欢迎使用 Markdown 编辑器',
    content: `# 欢迎使用 豆角 Markdown 编辑器 📝

这是一个专为**高效写作、文档草稿、技术笔记与快速预览**打造的官方扩展插件。

---

## ✨ 核心特性

- **双栏极速对照**：左侧编辑源码，右侧实时双向渲染
- **丰富语法支持**：支持 GFM 常用语法、代码高亮、表格、任务清单与引用
- **多文档持久化**：内置本地自动保存，防止内容意外丢失
- **导入与导出**：支持本地 \`.md\` 文件导入与一键导出下载

---

## 🛠️ 常用排版演示

### 1. 代码块高亮
\`\`\`typescript
interface PluginContext {
  pluginId: string;
  version: string;
}

export function activate(ctx: PluginContext): void {
  console.log(\`[Plugin] \${ctx.pluginId} v\${ctx.version} 已激活\`);
}
\`\`\`

### 2. 表格展示
| 功能模块 | 运行状态 | 运行环境 |
|---|---|---|
| 应用底座 | 正常运行 | 独立安全环境 |
| 网络代理 | 已就绪 | 统一跟随系统代理 |
| 剪贴板监视 | 监听中 | 本地加密持久化 |

### 3. 任务清单 (Task List)
- [x] 完成应用架构升级
- [x] 支持本地导入导出与全量备份
- [ ] 探索更多生产力拓展插件

> 💡 **提示**：您可以通过顶部工具栏快速插入各种格式，也可以在左侧新建多个独立文档！
`,
    updatedAt: Date.now()
  }
]

export default function App(): JSX.Element {
  const [docs, setDocs] = useState<MarkdownDoc[]>(() => {
    try {
      const saved = localStorage.getItem('doujiao_markdown_docs')
      if (saved) return JSON.parse(saved)
    } catch {}
    return DEFAULT_DOCS
  })

  const [activeDocId, setActiveDocId] = useState<string>(() => docs[0]?.id || 'welcome-doc')
  const [viewMode, setViewMode] = useState<'split' | 'edit' | 'preview'>('split')
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [toast, setToast] = useState<string | null>(null)
  const [workspaceDir, setWorkspaceDir] = useState<string>('')
  const [isDiskSaving, setIsDiskSaving] = useState(false)
  const [showDirectoryModal, setShowDirectoryModal] = useState(false)
  const [showHistoryDrawer, setShowHistoryDrawer] = useState(false)

  const editorRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const activeDoc = docs.find((d) => d.id === activeDocId) || docs[0]

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 2500)
  }

  // 1. 初始化加载工作目录与磁盘物理文件
  const loadWorkspace = async () => {
    try {
      const sdk = getSDK()
      if (sdk?.workspace) {
        const dir = await sdk.workspace.getDirectory('markdown-editor')
        setWorkspaceDir(dir)
        const files = await sdk.workspace.listFiles('markdown-editor', ['.md', '.markdown'])
        if (files.length === 0) {
          // 首次启动，若本地缓存有旧笔记或默认文档，自动无损平滑迁移写入磁盘
          const initialDocs = docs.length > 0 ? docs : DEFAULT_DOCS
          for (const d of initialDocs) {
            const fName = `${(d.title || '未命名文档').replace(/[\\/:*?"<>|]/g, '_')}.md`
            await sdk.workspace.writeFile(fName, d.content, 'markdown-editor')
          }
          const refreshed = await sdk.workspace.listFiles('markdown-editor', ['.md', '.markdown'])
          const loaded: MarkdownDoc[] = []
          for (const f of refreshed) {
            const content = await sdk.workspace.readFile(f.relativePath, 'markdown-editor')
            loaded.push({
              id: f.relativePath,
              fileName: f.relativePath,
              title: f.name.replace(/\.(md|markdown)$/i, ''),
              content,
              updatedAt: f.updatedAt
            })
          }
          if (loaded.length > 0) {
            setDocs(loaded)
            setActiveDocId(loaded[0].id)
          }
        } else {
          const loaded: MarkdownDoc[] = []
          for (const f of files) {
            const content = await sdk.workspace.readFile(f.relativePath, 'markdown-editor')
            loaded.push({
              id: f.relativePath,
              fileName: f.relativePath,
              title: f.name.replace(/\.(md|markdown)$/i, ''),
              content,
              updatedAt: f.updatedAt
            })
          }
          if (loaded.length > 0) {
            setDocs(loaded)
            setActiveDocId(loaded[0].id)
          }
        }
      }
    } catch (err) {
      console.warn('[MarkdownEditor] 读取工作目录失败，降级为本地缓存模式:', err)
    }
  }

  useEffect(() => {
    loadWorkspace()
  }, [])

  // 2. 双重持久化：实时备份到本地缓存
  useEffect(() => {
    try {
      localStorage.setItem('doujiao_markdown_docs', JSON.stringify(docs))
    } catch (err) {
      console.error('[MarkdownEditor] 保存到本地缓存失败:', err)
    }
  }, [docs])

  // 3. 防抖自动写入外部物理文件与历史版本快照
  useEffect(() => {
    if (!activeDoc) return
    const timer = setTimeout(async () => {
      try {
        const sdk = getSDK()
        if (sdk?.workspace) {
          const targetName = activeDoc.fileName || `${(activeDoc.title || '文档').replace(/[\\/:*?"<>|]/g, '_')}.md`
          setIsDiskSaving(true)
          await sdk.workspace.writeFile(targetName, activeDoc.content, 'markdown-editor')
          if (sdk.workspace.history) {
            await sdk.workspace.history.saveSnapshot('markdown-editor', targetName, activeDoc.content, 'auto')
          }
          setIsDiskSaving(false)
        }
      } catch (err) {
        setIsDiskSaving(false)
      }
    }, 1000)
    return () => clearTimeout(timer)
  }, [activeDoc?.content])

  // 快捷键 Ctrl+S / Cmd+S 立即存盘并打快照
  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        if (!activeDoc) return
        const sdk = getSDK()
        if (sdk?.workspace) {
          const targetName = activeDoc.fileName || `${(activeDoc.title || '文档').replace(/[\\/:*?"<>|]/g, '_')}.md`
          setIsDiskSaving(true)
          await sdk.workspace.writeFile(targetName, activeDoc.content, 'markdown-editor')
          if (sdk.workspace.history) {
            await sdk.workspace.history.saveSnapshot('markdown-editor', targetName, activeDoc.content, 'auto', '手动存盘 (Ctrl+S)')
          }
          setIsDiskSaving(false)
          showToast('已存盘并生成历史快照 💾')
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [activeDoc])

  // 更换工作目录
  const handleSelectWorkspaceDir = async () => {
    try {
      const sdk = getSDK()
      if (sdk?.workspace) {
        const res = await sdk.workspace.selectDirectory(workspaceDir)
        if (!res.canceled && res.directoryPath) {
          await sdk.workspace.setDirectory(res.directoryPath, 'markdown-editor')
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
        await sdk.workspace.openDirectory('markdown-editor')
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
        const defaultDir = await sdk.workspace.resetDirectory('markdown-editor')
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
    if (!activeDoc) return
    try {
      const sdk = getSDK()
      if (sdk?.workspace?.saveFileAs) {
        const defaultName = `${(activeDoc.title || '文档').replace(/[\\/:*?"<>|]/g, '_')}.md`
        const res = await sdk.workspace.saveFileAs(activeDoc.content, defaultName, ['md', 'markdown'])
        if (!res.canceled && res.filePath) {
          showToast(`已另存为: ${res.fileName || res.filePath}`)
        }
      } else {
        handleExport()
      }
    } catch (err: any) {
      console.error('另存为失败:', err)
      showToast('另存为失败: ' + (err?.message || '未知错误'))
    }
  }

  // 从外部磁盘打开 Markdown 文件
  const handleOpenFile = async () => {
    try {
      const sdk = getSDK()
      if (sdk?.workspace?.selectFileToOpen) {
        const res = await sdk.workspace.selectFileToOpen(['md', 'markdown', 'txt'])
        if (!res.canceled && res.content !== undefined && res.fileName) {
          const title = res.fileName.replace(/\.(md|markdown|txt)$/i, '')
          const existing = docs.find((d) => d.title === title || d.fileName === res.fileName)
          if (existing) {
            updateContent(res.content)
            setActiveDocId(existing.id)
            showToast(`已载入文档: ${res.fileName}`)
          } else {
            const newDoc: MarkdownDoc = {
              id: res.fileName,
              fileName: res.fileName,
              title,
              content: res.content,
              updatedAt: Date.now()
            }
            if (sdk.workspace.writeFile) {
              await sdk.workspace.writeFile(res.fileName, res.content, 'markdown-editor')
            }
            setDocs((prev) => [newDoc, ...prev])
            setActiveDocId(newDoc.id)
            showToast(`已打开并导入: ${res.fileName}`)
          }
        }
      } else {
        fileInputRef.current?.click()
      }
    } catch (err: any) {
      console.error('打开文件失败:', err)
      showToast('打开文件失败: ' + (err?.message || '未知错误'))
    }
  }

  // 更新当前活动文档内容
  const updateContent = (content: string) => {
    setDocs((prev) =>
      prev.map((d) => (d.id === activeDoc.id ? { ...d, content, updatedAt: Date.now() } : d))
    )
  }

  // 更新标题并重命名磁盘文件
  const updateTitle = async (title: string) => {
    const safeTitle = title.trim() || '未命名文档'
    const newFileName = `${safeTitle.replace(/[\\/:*?"<>|]/g, '_')}.md`
    const oldFileName = activeDoc.fileName

    if (oldFileName && oldFileName !== newFileName) {
      try {
        const sdk = getSDK()
        if (sdk?.workspace) {
          await sdk.workspace.renameFile(oldFileName, newFileName, 'markdown-editor')
        }
      } catch (err) {
        console.warn('重命名文件失败:', err)
      }
    }

    setDocs((prev) =>
      prev.map((d) =>
        d.id === activeDoc.id
          ? { ...d, title, fileName: newFileName, id: newFileName, updatedAt: Date.now() }
          : d
      )
    )
    if (activeDocId === activeDoc.id) {
      setActiveDocId(newFileName)
    }
  }

  // 新建文档
  const handleNewDoc = async () => {
    let baseName = '未命名文档'
    let title = baseName
    let counter = 1
    while (docs.some((d) => d.title === title)) {
      title = `${baseName}_${counter++}`
    }
    const fileName = `${title}.md`
    const defaultContent = `# ${title}\n\n在此开始输入内容...`

    try {
      const sdk = getSDK()
      if (sdk?.workspace) {
        await sdk.workspace.writeFile(fileName, defaultContent, 'markdown-editor')
      }
    } catch {}

    const newDoc: MarkdownDoc = {
      id: fileName,
      fileName,
      title,
      content: defaultContent,
      updatedAt: Date.now()
    }
    setDocs((prev) => [newDoc, ...prev])
    setActiveDocId(newDoc.id)
    showToast(`已在工作目录下新建: ${fileName}`)
  }

  // 删除文档
  const handleDeleteDoc = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (docs.length <= 1) {
      showToast('请至少保留一个文档')
      return
    }
    const docToDelete = docs.find((d) => d.id === id)
    if (docToDelete?.fileName) {
      try {
        const sdk = getSDK()
        if (sdk?.workspace) {
          await sdk.workspace.deleteFile(docToDelete.fileName, 'markdown-editor')
        }
      } catch (err) {
        console.warn('删除物理文件失败:', err)
      }
    }
    const filtered = docs.filter((d) => d.id !== id)
    setDocs(filtered)
    if (activeDocId === id) {
      setActiveDocId(filtered[0].id)
    }
    showToast('文档已从工作目录删除')
  }

  // 工具栏插入语法
  const insertSyntax = (prefix: string, suffix: string = '', defaultPlaceholder: string = '') => {
    const textarea = editorRef.current
    if (!textarea) return

    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const currentText = activeDoc.content
    const selected = currentText.substring(start, end) || defaultPlaceholder

    const replacement = `${prefix}${selected}${suffix}`
    const newContent =
      currentText.substring(0, start) + replacement + currentText.substring(end)

    updateContent(newContent)

    setTimeout(() => {
      textarea.focus()
      const cursorPos = start + prefix.length + selected.length
      textarea.setSelectionRange(cursorPos, cursorPos)
    }, 0)
  }

  // 导出为 .md 文件
  const handleExport = () => {
    const blob = new Blob([activeDoc.content], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${activeDoc.title.replace(/[\\/:*?"<>|]/g, '_') || 'document'}.md`
    a.click()
    URL.revokeObjectURL(url)
    showToast('已导出为 Markdown 文件')
  }

  // 导入本地 .md 文件
  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (event) => {
      const content = (event.target?.result as string) || ''
      const title = file.name.replace(/\.(md|markdown|txt)$/i, '')
      const newDoc: MarkdownDoc = {
        id: `doc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        title,
        content,
        updatedAt: Date.now()
      }
      setDocs((prev) => [newDoc, ...prev])
      setActiveDocId(newDoc.id)
      showToast(`成功导入文档: ${file.name}`)
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  // 复制渲染后的纯文本或 Markdown
  const handleCopyMarkdown = () => {
    navigator.clipboard.writeText(activeDoc.content).then(() => {
      showToast('Markdown 源码已复制到剪贴板')
    })
  }

  // 统计指标
  const rawContent = activeDoc?.content || ''
  const charCount = rawContent.length
  const wordCount = (rawContent.match(/[\u4e00-\u9fa5]|\b[a-zA-Z0-9_-]+\b/g) || []).length
  const lineCount = rawContent.split(/\r?\n/).length
  const readMinutes = Math.max(1, Math.ceil(wordCount / 300))

  return (
    <div className="h-screen w-screen flex bg-slate-900 text-slate-100 overflow-hidden select-none font-sans">
      {/* 隐藏的导入文件 input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".md,.markdown,.txt"
        className="hidden"
        onChange={handleImportFile}
      />

      {/* 轻量 Toast 提示 */}
      {toast && (
        <div className="absolute top-4 right-6 z-50 px-4 py-2 rounded-xl bg-indigo-600 text-white text-xs shadow-xl shadow-indigo-600/30 flex items-center gap-2 animate-bounce">
          <span>✨</span>
          <span>{toast}</span>
        </div>
      )}

      {/* 左侧文档管理侧边栏 */}
      <div
        className={`bg-slate-950 border-r border-slate-800/80 flex flex-col transition-all duration-300 ${
          sidebarOpen ? 'w-64 min-w-64' : 'w-0 min-w-0 opacity-0 overflow-hidden'
        }`}
      >
        <div className="p-3.5 border-b border-slate-800/80 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xl">📝</span>
            <span className="font-semibold text-xs text-slate-200">我的文档</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 font-mono">
              {docs.length}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={handleOpenFile}
              className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs flex items-center gap-1 transition-colors"
              title="从外部磁盘打开 Markdown 文件..."
            >
              <span>📂 打开</span>
            </button>
            <button
              onClick={handleNewDoc}
              className="px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs flex items-center gap-1 shadow transition-colors"
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
              <span className="text-[9px] px-1 py-0.2 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">卸载不丢失</span>
            </span>
            <button
              onClick={() => setShowDirectoryModal(true)}
              className="text-[10px] text-indigo-400 hover:underline flex items-center gap-0.5"
              title="设置默认保存目录"
            >
              <span>⚙️ 设置</span>
            </button>
          </div>
          <div
            className="text-[10px] font-mono text-slate-400 truncate bg-slate-950/80 px-2 py-1 rounded border border-slate-800/60 cursor-pointer hover:border-slate-700 hover:text-slate-300 transition-colors"
            onClick={() => setShowDirectoryModal(true)}
            title={workspaceDir || '默认安全目录：系统用户「文档/Doujiao/Markdown」'}
          >
            {workspaceDir ? workspaceDir : '系统用户「文档/Doujiao/Markdown」'}
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
              className="flex-1 py-1 rounded bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 text-[10px] transition-colors flex items-center justify-center gap-1"
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

        {/* 文档列表 */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {docs.map((doc) => {
            const isActive = doc.id === activeDoc.id
            return (
              <div
                key={doc.id}
                onClick={() => setActiveDocId(doc.id)}
                className={`group p-2.5 rounded-xl border text-xs cursor-pointer transition-all flex items-start justify-between ${
                  isActive
                    ? 'bg-indigo-600/15 border-indigo-500/40 text-white shadow-sm'
                    : 'bg-slate-900/40 border-transparent hover:bg-slate-900 hover:border-slate-800 text-slate-400'
                }`}
              >
                <div className="flex-1 overflow-hidden pr-2">
                  <div className="font-medium truncate text-slate-200">{doc.title}</div>
                  <div className="flex items-center gap-2 text-[10px] text-slate-500 mt-1 font-mono">
                    <span>{doc.content.length} 字符</span>
                    <span>•</span>
                    <span>{new Date(doc.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                </div>
                {docs.length > 1 && (
                  <button
                    onClick={(e) => handleDeleteDoc(doc.id, e)}
                    className="opacity-0 group-hover:opacity-100 p-1 hover:text-rose-400 text-slate-500 transition-opacity"
                    title="删除此文档"
                  >
                    🗑️
                  </button>
                )}
              </div>
            )
          })}
        </div>

        {/* 底部导入工具 */}
        <div className="p-3 border-t border-slate-800/80 bg-slate-950/60">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="w-full py-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-xs text-slate-300 flex items-center justify-center gap-2 transition-colors"
          >
            <span>📁</span>
            <span>导入本地 .md 文件</span>
          </button>
        </div>
      </div>

      {/* 主编辑工作区 */}
      <div className="flex-1 flex flex-col h-full overflow-hidden bg-slate-900">
        {/* 顶部标题与控制栏 */}
        {/* 顶部标题与控制栏 */}
        <div className="h-13 px-4 bg-slate-950/90 border-b border-slate-800/80 flex items-center justify-between shrink-0 gap-3">
          {/* 左侧：侧边栏切换 + 标题 + 存盘状态 */}
          <div className="flex items-center gap-2 flex-1 min-w-0 mr-2">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white text-xs border border-slate-800 hover:border-slate-700 transition-colors shrink-0"
              title={sidebarOpen ? '收起文档库' : '展开文档库'}
            >
              {sidebarOpen ? '◀' : '▶'}
            </button>
            <input
              type="text"
              value={activeDoc.title}
              onChange={(e) => updateTitle(e.target.value)}
              className="bg-transparent text-sm font-semibold text-white border-b border-transparent hover:border-slate-700 focus:border-indigo-500 focus:outline-none px-1 py-0.5 max-w-sm truncate placeholder-slate-500 transition-colors"
              placeholder="请输入文档标题..."
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

          {/* 中间：视图模式切换（紧凑胶囊） */}
          <div className="flex items-center bg-slate-900 border border-slate-800 rounded-lg p-0.5 text-xs shrink-0 shadow-sm">
            <button
              onClick={() => setViewMode('edit')}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors shrink-0 whitespace-nowrap ${
                viewMode === 'edit' ? 'bg-indigo-600 text-white shadow-xs' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              ✏️ 编辑
            </button>
            <button
              onClick={() => setViewMode('split')}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors shrink-0 whitespace-nowrap ${
                viewMode === 'split' ? 'bg-indigo-600 text-white shadow-xs' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              🌗 双栏
            </button>
            <button
              onClick={() => setViewMode('preview')}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors shrink-0 whitespace-nowrap ${
                viewMode === 'preview' ? 'bg-indigo-600 text-white shadow-xs' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              👁️ 预览
            </button>
          </div>

          {/* 右侧：规范化工具组 */}
          <div className="flex items-center gap-2 shrink-0">
            {/* 组 1：历史与复制 */}
            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={() => setShowHistoryDrawer(true)}
                className="px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 text-xs text-slate-300 hover:text-indigo-400 transition-colors flex items-center gap-1 shrink-0 whitespace-nowrap"
                title="查看版本历史快照与 Git 记录 (Ctrl+H)"
              >
                <span>🕒</span>
                <span className="text-[11px]">历史</span>
              </button>
              <button
                onClick={handleCopyMarkdown}
                className="p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 text-slate-400 hover:text-slate-200 text-xs transition-colors flex items-center justify-center shrink-0"
                title="复制 Markdown 源码"
              >
                📋
              </button>
            </div>

            {/* 分隔线 */}
            <div className="w-px h-4 bg-slate-800/80 shrink-0" />

            {/* 组 2：另存为与目录设置 */}
            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={handleSaveAs}
                className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-750 border border-slate-700 hover:border-slate-600 text-slate-200 hover:text-white text-xs font-medium transition-all flex items-center gap-1.5 shrink-0 whitespace-nowrap shadow-xs"
                title="将当前文档另存为外部文件..."
              >
                <span>💾</span>
                <span className="text-[11px]">另存为</span>
              </button>
              <button
                onClick={() => setShowDirectoryModal(true)}
                className="p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 text-slate-400 hover:text-slate-200 text-xs transition-colors flex items-center justify-center shrink-0"
                title="设置默认保存目录与工作文件夹"
              >
                ⚙️
              </button>
            </div>
          </div>
        </div>

        {/* 语法插入快捷工具栏 (在编辑模式或双栏模式可见) */}
        {viewMode !== 'preview' && (
          <div className="px-4 py-2 bg-slate-950/40 border-b border-slate-800/60 flex items-center gap-1 flex-wrap text-xs text-slate-300">
            <button
              onClick={() => insertSyntax('# ', '', '一级标题')}
              className="px-2 py-1 rounded hover:bg-slate-800 font-bold"
              title="一级标题"
            >
              H1
            </button>
            <button
              onClick={() => insertSyntax('## ', '', '二级标题')}
              className="px-2 py-1 rounded hover:bg-slate-800 font-bold"
              title="二级标题"
            >
              H2
            </button>
            <button
              onClick={() => insertSyntax('### ', '', '三级标题')}
              className="px-2 py-1 rounded hover:bg-slate-800 font-bold"
              title="三级标题"
            >
              H3
            </button>
            <span className="text-slate-700 mx-1">|</span>
            <button
              onClick={() => insertSyntax('**', '**', '粗体文字')}
              className="px-2 py-1 rounded hover:bg-slate-800 font-bold"
              title="粗体"
            >
              B
            </button>
            <button
              onClick={() => insertSyntax('*', '*', '斜体文字')}
              className="px-2 py-1 rounded hover:bg-slate-800 italic"
              title="斜体"
            >
              I
            </button>
            <button
              onClick={() => insertSyntax('~~', '~~', '删除线文字')}
              className="px-2 py-1 rounded hover:bg-slate-800 line-through"
              title="删除线"
            >
              S
            </button>
            <span className="text-slate-700 mx-1">|</span>
            <button
              onClick={() => insertSyntax('`', '`', 'code')}
              className="px-2 py-1 rounded hover:bg-slate-800 font-mono text-[11px]"
              title="行内代码"
            >
              `code`
            </button>
            <button
              onClick={() => insertSyntax('```typescript\n', '\n```', '// 代码内容')}
              className="px-2 py-1 rounded hover:bg-slate-800 font-mono text-[11px]"
              title="多行代码块"
            >
              {'{ }'}
            </button>
            <button
              onClick={() => insertSyntax('> ', '', '引用内容')}
              className="px-2 py-1 rounded hover:bg-slate-800"
              title="引用块"
            >
              “ ”
            </button>
            <span className="text-slate-700 mx-1">|</span>
            <button
              onClick={() => insertSyntax('- ', '', '列表项')}
              className="px-2 py-1 rounded hover:bg-slate-800"
              title="无序列表"
            >
              • 列表
            </button>
            <button
              onClick={() => insertSyntax('1. ', '', '排序项')}
              className="px-2 py-1 rounded hover:bg-slate-800"
              title="有序列表"
            >
              1. 列表
            </button>
            <button
              onClick={() => insertSyntax('- [ ] ', '', '待办任务')}
              className="px-2 py-1 rounded hover:bg-slate-800"
              title="任务清单"
            >
              ☑ 任务
            </button>
            <span className="text-slate-700 mx-1">|</span>
            <button
              onClick={() => insertSyntax('[', '](https://example.com)', '链接文本')}
              className="px-2 py-1 rounded hover:bg-slate-800"
              title="插入链接"
            >
              🔗 链接
            </button>
            <button
              onClick={() => insertSyntax('![图片描述](', ')', 'https://images.unsplash.com/photo-1579783902614-a3fb3927b675')}
              className="px-2 py-1 rounded hover:bg-slate-800"
              title="插入图片"
            >
              🖼️ 图片
            </button>
            <button
              onClick={() => insertSyntax('\n| 表头1 | 表头2 |\n|---|---|\n| 内容1 | 内容2 |\n')}
              className="px-2 py-1 rounded hover:bg-slate-800"
              title="插入表格"
            >
              📊 表格
            </button>
            <button
              onClick={() => insertSyntax('\n---\n')}
              className="px-2 py-1 rounded hover:bg-slate-800"
              title="分割线"
            >
              ➖ 分割线
            </button>
          </div>
        )}

        {/* 编辑与预览核心分栏区 */}
        <div className="flex-1 flex overflow-hidden">
          {/* 编辑器输入区 */}
          {(viewMode === 'split' || viewMode === 'edit') && (
            <div
              className={`flex-1 flex flex-col h-full bg-slate-900 border-r border-slate-800/80 ${
                viewMode === 'split' ? 'w-1/2' : 'w-full'
              }`}
            >
              <textarea
                ref={editorRef}
                value={activeDoc.content}
                onChange={(e) => updateContent(e.target.value)}
                placeholder="在此尽情书写 Markdown 内容..."
                className="flex-1 w-full h-full p-6 bg-transparent resize-none focus:outline-none font-mono text-xs leading-relaxed text-slate-200 placeholder-slate-600 selection:bg-indigo-500/30"
                spellCheck={false}
              />
            </div>
          )}

          {/* 实时渲染预览区 */}
          {(viewMode === 'split' || viewMode === 'preview') && (
            <div
              className={`flex-1 h-full overflow-y-auto p-6 bg-slate-950/60 ${
                viewMode === 'split' ? 'w-1/2' : 'w-full'
              }`}
            >
              <div
                className="max-w-3xl mx-auto prose prose-invert"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(activeDoc.content) }}
              />
            </div>
          )}
        </div>

        {/* 底部状态栏 */}
        <div className="h-7 px-4 bg-slate-950 border-t border-slate-800/80 text-[11px] text-slate-500 flex items-center justify-between font-mono shrink-0">
          <div className="flex items-center gap-4">
            <span>字数: <strong className="text-slate-300">{wordCount}</strong></span>
            <span>字符数: <strong className="text-slate-300">{charCount}</strong></span>
            <span>行数: <strong className="text-slate-300">{lineCount}</strong></span>
            <span>预估阅读: <strong className="text-slate-300">{readMinutes} 分钟</strong></span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
            <span>自动本地保存已就绪</span>
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
                <h3 className="font-bold text-white text-sm">Markdown 默认保存目录设置</h3>
              </div>
              <button
                onClick={() => setShowDirectoryModal(false)}
                className="text-slate-400 hover:text-white text-sm p-1"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-slate-400 leading-relaxed">
              新建的文档将自动以 <code className="text-indigo-300 font-mono">.md</code> 格式实时同步到此目录。独立保存在用户本地磁盘，即使应用卸载或升级也绝不会丢失您的任何文档。
            </p>

            <div className="space-y-1.5">
              <span className="text-[11px] font-medium text-slate-400">当前默认保存目录：</span>
              <div
                onClick={() => {
                  navigator.clipboard.writeText(workspaceDir)
                  showToast('已复制路径到剪贴板')
                }}
                className="p-2.5 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono text-indigo-300/90 break-all select-all cursor-pointer hover:border-slate-700"
                title="点击复制完整路径"
              >
                {workspaceDir || '系统用户「文档/Doujiao/Markdown」'}
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
                className="flex-1 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium shadow-md shadow-indigo-600/20 transition-all flex items-center justify-center gap-1.5"
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
        scope="markdown-editor"
        fileName={activeDoc.fileName || `${(activeDoc.title || '文档').replace(/[\\/:*?"<>|]/g, '_')}.md`}
        currentContent={activeDoc.content}
        onRestoreContent={(content) => {
          updateContent(content)
          showToast('已恢复历史版本内容 ↩️')
        }}
        onShowToast={showToast}
      />
    </div>
  )
}
