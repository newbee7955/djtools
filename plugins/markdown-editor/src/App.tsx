import React, { useState, useEffect, useRef } from 'react'
import { getSDK, WorkspaceFileItem } from '@doujiao/plugin-sdk'
import Vditor from 'vditor'
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
    fileName: '欢迎使用 Markdown 编辑器.md',
    title: '欢迎使用 Markdown 编辑器',
    content: `# 欢迎使用 豆角 Markdown 编辑器 📝

这是一套为极客与创作者打造的高性能实时 Markdown 写作环境。

---

### 1. 核心特性
- **纯净双向同步**：左侧实时编写，右侧毫秒级渲染。
- **目录层级归档**：支持新建文件夹分类存放不同项目与知识库文档。
- **本地独立文件**：所有文档以标准 \`.md\` 格式保存在本地外部磁盘，即使应用卸载也绝对不丢数据。
- **历史版本回滚**：内置本地快照机制，每次修改自动记录时间线，支持一键对比与历史还原。

---

### 2. 状态表格 (Markdown Tables)
| 功能组件 | 运行状态 | 安全级别 |
| :--- | :--- | :--- |
| 应用底座 | 正常运行 | 独立安全环境 |
| 网络代理 | 已就绪 | 统一跟随系统代理 |
| 剪贴板监视 | 监听中 | 本地加密持久化 |

### 3. 任务清单 (Task List)
- [x] 完成应用架构升级
- [x] 支持本地导入导出与全量备份
- [ ] 探索更多生产力拓展插件

> 💡 **提示**：您可以通过顶部工具栏快速插入各种格式，也可以在左侧新建多个独立文档与文件夹！
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
  const [viewMode, setViewMode] = useState<'ir' | 'wysiwyg' | 'sv' | 'preview'>(() => {
    try {
      const saved = localStorage.getItem('doujiao_markdown_view_mode')
      if (saved === 'ir' || saved === 'wysiwyg' || saved === 'sv' || saved === 'preview') return saved
    } catch {}
    return 'ir'
  })
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [toast, setToast] = useState<string | null>(null)
  const [workspaceDir, setWorkspaceDir] = useState<string>('')
  const [isDiskSaving, setIsDiskSaving] = useState(false)
  const [showDirectoryModal, setShowDirectoryModal] = useState(false)
  const [showHistoryDrawer, setShowHistoryDrawer] = useState(false)

  // 目录层级与文件夹管理
  const [currentDir, setCurrentDir] = useState<string>('')
  const [folders, setFolders] = useState<WorkspaceFileItem[]>([])
  const [showNewFolderModal, setShowNewFolderModal] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')

  // 右键上下文菜单
  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    inTable: boolean
    tableIndex: number
    rowIndex: number
    colIndex: number
  } | null>(null)
  const contextMenuRef = useRef<HTMLDivElement>(null)

  const vditorContainerRef = useRef<HTMLDivElement>(null)
  const vditorRef = useRef<Vditor | null>(null)
  const isVditorReadyRef = useRef<boolean>(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const activeDoc = docs.find((d) => d.id === activeDocId) || docs[0]
  const activeDocRef = useRef(activeDoc)
  activeDocRef.current = activeDoc

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 2500)
  }

  // 1. 初始化加载工作目录与磁盘物理文件（支持子目录）
  const loadWorkspace = async (targetSubDir = currentDir) => {
    try {
      const sdk = getSDK()
      if (sdk?.workspace) {
        const dir = await sdk.workspace.getDirectory('markdown-editor')
        setWorkspaceDir(dir)
        const allItems = await sdk.workspace.listFiles('markdown-editor', ['.md', '.markdown'], targetSubDir)
        const dirItems = allItems.filter((i) => i.isDirectory)
        const fileItems = allItems.filter((i) => !i.isDirectory)
        setFolders(dirItems)

        if (fileItems.length === 0 && !targetSubDir) {
          // 首次启动，若本地缓存有旧笔记或默认文档，自动无损平滑迁移写入磁盘
          const initialDocs = docs.length > 0 ? docs : DEFAULT_DOCS
          for (const d of initialDocs) {
            const fName = `${(d.title || '未命名文档').replace(/[\\/:*?"<>|]/g, '_')}.md`
            await sdk.workspace.writeFile(fName, d.content, 'markdown-editor')
          }
          const refreshed = await sdk.workspace.listFiles('markdown-editor', ['.md', '.markdown'], targetSubDir)
          const refFiles = refreshed.filter((i) => !i.isDirectory)
          const loaded: MarkdownDoc[] = []
          for (const f of refFiles) {
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
          for (const f of fileItems) {
            const content = await sdk.workspace.readFile(f.relativePath, 'markdown-editor')
            loaded.push({
              id: f.relativePath,
              fileName: f.relativePath,
              title: f.name.replace(/\.(md|markdown)$/i, ''),
              content,
              updatedAt: f.updatedAt
            })
          }
          setDocs(loaded)
          if (loaded.length > 0) {
            if (!loaded.some((d) => d.id === activeDocId)) {
              setActiveDocId(loaded[0].id)
            }
          } else {
            setActiveDocId('')
          }
        }
      }
    } catch (err) {
      console.warn('[MarkdownEditor] 读取工作目录失败，降级为本地缓存模式:', err)
    }
  }

  const handleNavigateDir = (subDir: string) => {
    setCurrentDir(subDir)
    loadWorkspace(subDir)
  }

  const handleNavigateUp = () => {
    if (!currentDir) return
    const parts = currentDir.replace(/\\/g, '/').split('/').filter(Boolean)
    parts.pop()
    const parent = parts.join('/')
    handleNavigateDir(parent)
  }

  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = newFolderName.trim().replace(/[\\/:*?"<>|]/g, '')
    if (!trimmed) return
    try {
      const sdk = getSDK()
      if (sdk?.workspace?.createDirectory) {
        const relPath = currentDir ? `${currentDir}/${trimmed}` : trimmed
        await sdk.workspace.createDirectory(relPath, 'markdown-editor')
        showToast(`已创建文件夹: ${trimmed}`)
        setNewFolderName('')
        setShowNewFolderModal(false)
        await loadWorkspace(currentDir)
      }
    } catch (err: any) {
      showToast(`创建文件夹失败: ${err?.message || '未知错误'}`)
    }
  }

  const handleDeleteFolder = async (folderRelPath: string, folderName: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!window.confirm(`确定要删除文件夹 "${folderName}" 及其内部包含的所有文档吗？此操作无法撤销。`)) return
    try {
      const sdk = getSDK()
      if (sdk?.workspace?.deleteFile) {
        await sdk.workspace.deleteFile(folderRelPath, 'markdown-editor')
        showToast(`已删除文件夹: ${folderName}`)
        await loadWorkspace(currentDir)
      }
    } catch (err: any) {
      showToast(`删除失败: ${err?.message || '未知错误'}`)
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
        const doc = activeDocRef.current
        if (!doc) return
        const currentContent =
          vditorRef.current && isVditorReadyRef.current
            ? vditorRef.current.getValue()
            : (doc.content || '')
        const sdk = getSDK()
        if (sdk?.workspace) {
          const targetName = doc.fileName || `${(doc.title || '文档').replace(/[\\/:*?"<>|]/g, '_')}.md`
          setIsDiskSaving(true)
          await sdk.workspace.writeFile(targetName, currentContent, 'markdown-editor')
          if (sdk.workspace.history) {
            await sdk.workspace.history.saveSnapshot('markdown-editor', targetName, currentContent, 'auto', '手动存盘 (Ctrl+S)')
          }
          setIsDiskSaving(false)
          showToast('已存盘并生成历史快照 💾')
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  // 更换工作目录
  const handleSelectWorkspaceDir = async () => {
    try {
      const sdk = getSDK()
      if (sdk?.workspace) {
        const res = await sdk.workspace.selectDirectory(workspaceDir)
        if (!res.canceled && res.directoryPath) {
          await sdk.workspace.setDirectory(res.directoryPath, 'markdown-editor')
          setWorkspaceDir(res.directoryPath)
          setCurrentDir('')
          showToast('工作目录已切换')
          await loadWorkspace('')
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
        setCurrentDir('')
        showToast('已恢复系统默认保存目录')
        await loadWorkspace('')
      }
    } catch (err) {
      console.error('重置默认目录失败:', err)
      showToast('重置默认目录失败')
    }
  }

  // 另存为自定义位置
  const handleSaveAs = async () => {
    const doc = activeDocRef.current
    if (!doc) return
    const content =
      vditorRef.current && isVditorReadyRef.current
        ? vditorRef.current.getValue()
        : (doc.content || '')
    try {
      const sdk = getSDK()
      if (sdk?.workspace?.saveFileAs) {
        const defaultName = `${(doc.title || '文档').replace(/[\\/:*?"<>|]/g, '_')}.md`
        const res = await sdk.workspace.saveFileAs(content, defaultName, ['md', 'markdown'])
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
    const currentId = activeDocRef.current?.id
    if (!currentId) return
    setDocs((prev) =>
      prev.map((d) => (d.id === currentId ? { ...d, content, updatedAt: Date.now() } : d))
    )
  }

  // 初始化与模式切换时构建 Vditor 实例
  useEffect(() => {
    if (!vditorContainerRef.current) return
    if (viewMode === 'preview') return
    if (!activeDoc) return

    const isLight = document.documentElement.getAttribute('data-theme') === 'light'
    const targetMode = viewMode === 'wysiwyg' ? 'wysiwyg' : viewMode === 'sv' ? 'sv' : 'ir'

    isVditorReadyRef.current = false
    const vditor = new Vditor(vditorContainerRef.current, {
      value: activeDocRef.current?.content || '',
      mode: targetMode,
      cdn: './vditor',
      theme: isLight ? 'classic' : 'dark',
      minHeight: 200,
      placeholder: '在此输入 Markdown 内容，享受即时渲染沉浸式写作...',
      preview: {
        theme: {
          current: isLight ? 'light' : 'dark'
        },
        hljs: {
          style: isLight ? 'github' : 'atom-one-dark'
        },
        math: {
          engine: 'KaTeX'
        }
      },
      counter: {
        enable: false
      },
      cache: {
        enable: false
      },
      toolbarConfig: {
        pin: true
      },
      toolbar: [
        'headings',
        'bold',
        'italic',
        'strike',
        'link',
        '|',
        'list',
        'ordered-list',
        'check',
        'outdent',
        'indent',
        '|',
        'quote',
        'line',
        'code',
        'inline-code',
        'insert-before',
        'insert-after',
        '|',
        'table',
        'undo',
        'redo',
        '|',
        'fullscreen'
      ],
      input(value) {
        updateContent(value)
      },
      after() {
        vditorRef.current = vditor
        isVditorReadyRef.current = true
        if (activeDocRef.current && vditor.getValue() !== activeDocRef.current.content) {
          vditor.setValue(activeDocRef.current.content)
        }
      }
    })

    return () => {
      isVditorReadyRef.current = false
      try {
        vditor.destroy()
      } catch (err) {}
      vditorRef.current = null
    }
  }, [viewMode, Boolean(activeDoc)])

  // 切换当前文档时平滑同步至 Vditor
  useEffect(() => {
    if (vditorRef.current && isVditorReadyRef.current && activeDoc) {
      if (vditorRef.current.getValue() !== activeDoc.content) {
        vditorRef.current.setValue(activeDoc.content)
      }
    }
  }, [activeDocId])

  // 监听系统主题变化实时同步 Vditor 主题
  useEffect(() => {
    const observer = new MutationObserver(() => {
      const isLight = document.documentElement.getAttribute('data-theme') === 'light'
      if (vditorRef.current && isVditorReadyRef.current) {
        vditorRef.current.setTheme(
          isLight ? 'classic' : 'dark',
          isLight ? 'light' : 'dark',
          isLight ? 'github' : 'atom-one-dark'
        )
      }
    })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])

  // 持久化当前视图模式偏好
  useEffect(() => {
    try {
      localStorage.setItem('doujiao_markdown_view_mode', viewMode)
    } catch {}
  }, [viewMode])

  // ──────────────────────────────────────────────
  //  右键上下文菜单 — 表格操作工具函数
  // ──────────────────────────────────────────────

  /** 找出 markdown 文本中所有表格的行范围 */
  const findMdTables = (md: string) => {
    const lines = md.split('\n')
    const tables: { start: number; end: number }[] = []
    let start = -1
    for (let i = 0; i <= lines.length; i++) {
      const line = (lines[i] ?? '').trim()
      if (line.startsWith('|')) {
        if (start === -1) start = i
      } else {
        if (start !== -1) { tables.push({ start, end: i - 1 }); start = -1 }
      }
    }
    return tables
  }

  /** 解析表格行（含 separator）为字符串二维数组 */
  const parseMdTable = (lines: string[]) =>
    lines.map((l) => {
      const cells = l.split('|').map((c) => c.trim())
      if (cells[0] === '') cells.shift()
      if (cells[cells.length - 1] === '') cells.pop()
      return cells
    })

  /** 序列化二维数组回 markdown 表格行字符串 */
  const serializeMdTable = (rows: string[][]) =>
    rows.map((r) => '| ' + r.join(' | ') + ' |').join('\n')

  /**
   * DOM rowIndex → markdown 行索引（含 separator 在 index 1）
   * DOM: 0=header, 1,2,...=body  |  MD: 0=header, 1=sep, 2,3,...=body
   */
  const domRowToMdRow = (domRow: number) => (domRow === 0 ? 0 : domRow + 1)

  /** 执行表格操作并写回 Vditor */
  const applyTableOp = (
    op: 'insertRowAbove' | 'insertRowBelow' | 'deleteRow' | 'insertColLeft' | 'insertColRight' | 'deleteCol',
    tableIdx: number,
    domRow: number,
    col: number
  ) => {
    if (!vditorRef.current || !isVditorReadyRef.current) return
    const md = vditorRef.current.getValue()
    const allTables = findMdTables(md)
    if (tableIdx < 0 || tableIdx >= allTables.length) return

    const { start, end } = allTables[tableIdx]
    const mdLines = md.split('\n')
    const tableLines = mdLines.slice(start, end + 1)
    const rows = parseMdTable(tableLines)
    const colCount = rows[0]?.length ?? 2
    const mdRow = domRowToMdRow(domRow)

    if (op === 'insertRowAbove') {
      const insertAt = mdRow <= 1 ? 2 : mdRow
      rows.splice(insertAt, 0, Array(colCount).fill('  '))
    } else if (op === 'insertRowBelow') {
      const insertAt = mdRow < 1 ? 2 : mdRow + 1
      rows.splice(insertAt, 0, Array(colCount).fill('  '))
    } else if (op === 'deleteRow') {
      if (rows.length <= 3) { showToast('至少需要保留一行数据'); return }
      if (mdRow === 0 || mdRow === 1) { showToast('不能删除表头'); return }
      rows.splice(mdRow, 1)
    } else if (op === 'insertColLeft') {
      rows.forEach((r, i) => r.splice(col, 0, i === 1 ? '---' : '  '))
    } else if (op === 'insertColRight') {
      rows.forEach((r, i) => r.splice(col + 1, 0, i === 1 ? '---' : '  '))
    } else if (op === 'deleteCol') {
      if (colCount <= 1) { showToast('至少需要保留一列'); return }
      rows.forEach((r) => r.splice(col, 1))
    }

    const newMd = [
      ...mdLines.slice(0, start),
      ...serializeMdTable(rows).split('\n'),
      ...mdLines.slice(end + 1)
    ].join('\n')
    vditorRef.current.setValue(newMd)
    updateContent(newMd)
    setContextMenu(null)
  }

  /** 在光标处插入空白表格模板 */
  const insertNewTable = () => {
    if (!vditorRef.current || !isVditorReadyRef.current) return
    vditorRef.current.insertValue('\n\n| 列1 | 列2 | 列3 |\n| --- | --- | --- |\n|  |  |  |\n|  |  |  |\n\n')
    setContextMenu(null)
  }

  // 监听 Vditor 容器右键，识别是否在表格内
  useEffect(() => {
    const container = vditorContainerRef.current
    if (!container) return
    const handler = (e: MouseEvent) => {
      if (viewMode === 'preview') return
      e.preventDefault()
      const target = e.target as Element
      const tdEl = target.closest('td,th') as HTMLElement | null
      const trEl = tdEl?.closest('tr') as HTMLTableRowElement | null
      const tableEl = tdEl?.closest('table') as HTMLTableElement | null

      if (tableEl && tdEl && trEl) {
        const editorRoot =
          container.querySelector('.vditor-ir,.vditor-wysiwyg,.vditor-sv') ?? container
        const allTables = Array.from(editorRoot.querySelectorAll('table'))
        const tableIndex = allTables.indexOf(tableEl)
        const allRows = Array.from(tableEl.querySelectorAll('tr'))
        const rowIndex = allRows.indexOf(trEl)
        const allCols = Array.from(trEl.querySelectorAll('td,th'))
        const colIndex = allCols.indexOf(tdEl)
        setContextMenu({ x: e.clientX, y: e.clientY, inTable: true, tableIndex, rowIndex, colIndex })
      } else {
        setContextMenu({ x: e.clientX, y: e.clientY, inTable: false, tableIndex: -1, rowIndex: -1, colIndex: -1 })
      }
    }
    container.addEventListener('contextmenu', handler)
    return () => container.removeEventListener('contextmenu', handler)
  }, [viewMode])

  // 点击其他区域关闭右键菜单
  useEffect(() => {
    if (!contextMenu) return
    const close = (e: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenu(null)
      }
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [!!contextMenu])

  // 更新标题并重命名磁盘文件
  const updateTitle = async (title: string) => {
    const safeTitle = title.trim() || '未命名文档'
    const baseName = `${safeTitle.replace(/[\\/:*?"<>|]/g, '_')}.md`
    const prefix = activeDoc.fileName && activeDoc.fileName.includes('/')
      ? activeDoc.fileName.slice(0, activeDoc.fileName.lastIndexOf('/') + 1)
      : (currentDir ? `${currentDir}/` : '')
    const newFileName = `${prefix}${baseName}`
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

  // 新建文档（支持在当前子目录下创建）
  const handleNewDoc = async () => {
    let baseName = '未命名文档'
    let title = baseName
    let counter = 1
    while (docs.some((d) => d.title === title)) {
      title = `${baseName}_${counter++}`
    }
    const simpleName = `${title}.md`
    const relFileName = currentDir ? `${currentDir}/${simpleName}` : simpleName
    const defaultContent = `# ${title}\n\n在此开始输入内容...`

    try {
      const sdk = getSDK()
      if (sdk?.workspace) {
        await sdk.workspace.writeFile(relFileName, defaultContent, 'markdown-editor')
      }
    } catch {}

    const newDoc: MarkdownDoc = {
      id: relFileName,
      fileName: relFileName,
      title,
      content: defaultContent,
      updatedAt: Date.now()
    }
    setDocs((prev) => [newDoc, ...prev])
    setActiveDocId(newDoc.id)
    showToast(`已在当前目录新建: ${simpleName}`)
  }

  // 删除文档
  const handleDeleteDoc = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const docToDelete = docs.find((d) => d.id === id)
    if (!docToDelete) return
    const title = docToDelete.title || docToDelete.fileName || '该文档'
    if (!window.confirm(`确定要删除文档 "${title}" 吗？此操作将永久删除物理文件且无法撤销。`)) {
      return
    }
    if (docToDelete.fileName) {
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
      setActiveDocId(filtered[0]?.id || '')
    }
    showToast('文档已从工作目录删除')
  }

  // 导出为 .md 文件
  const handleExport = () => {
    const doc = activeDocRef.current
    if (!doc) return
    const content =
      vditorRef.current && isVditorReadyRef.current
        ? vditorRef.current.getValue()
        : (doc.content || '')
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${(doc.title || '文档').replace(/[\\/:*?"<>|]/g, '_')}.md`
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
    const content =
      vditorRef.current && isVditorReadyRef.current
        ? vditorRef.current.getValue()
        : (activeDocRef.current?.content || '')
    if (!content) {
      showToast('当前文档为空，无需复制')
      return
    }
    navigator.clipboard.writeText(content).then(() => {
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

      {/* 右键上下文菜单 */}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="fixed z-[200] min-w-[180px] bg-slate-800 border border-slate-700 rounded-xl shadow-2xl shadow-black/50 py-1 text-sm select-none"
          style={{
            left: Math.min(contextMenu.x, window.innerWidth - 200),
            top: Math.min(contextMenu.y, window.innerHeight - 300),
          }}
        >
          {/* 表格内：行列操作 */}
          {contextMenu.inTable ? (
            <>
              <div className="px-3 py-1 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">行操作</div>
              <button
                className="w-full px-3 py-1.5 text-left text-slate-200 hover:bg-slate-700 hover:text-white flex items-center gap-2 transition-colors"
                onClick={() => applyTableOp('insertRowAbove', contextMenu.tableIndex, contextMenu.rowIndex, contextMenu.colIndex)}
              >
                <span className="text-base">⬆️</span> 在上方插入行
              </button>
              <button
                className="w-full px-3 py-1.5 text-left text-slate-200 hover:bg-slate-700 hover:text-white flex items-center gap-2 transition-colors"
                onClick={() => applyTableOp('insertRowBelow', contextMenu.tableIndex, contextMenu.rowIndex, contextMenu.colIndex)}
              >
                <span className="text-base">⬇️</span> 在下方插入行
              </button>
              <button
                className="w-full px-3 py-1.5 text-left text-red-400 hover:bg-red-500/15 hover:text-red-300 flex items-center gap-2 transition-colors"
                onClick={() => applyTableOp('deleteRow', contextMenu.tableIndex, contextMenu.rowIndex, contextMenu.colIndex)}
              >
                <span className="text-base">🗑️</span> 删除当前行
              </button>
              <div className="my-1 border-t border-slate-700/80" />
              <div className="px-3 py-1 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">列操作</div>
              <button
                className="w-full px-3 py-1.5 text-left text-slate-200 hover:bg-slate-700 hover:text-white flex items-center gap-2 transition-colors"
                onClick={() => applyTableOp('insertColLeft', contextMenu.tableIndex, contextMenu.rowIndex, contextMenu.colIndex)}
              >
                <span className="text-base">⬅️</span> 在左侧插入列
              </button>
              <button
                className="w-full px-3 py-1.5 text-left text-slate-200 hover:bg-slate-700 hover:text-white flex items-center gap-2 transition-colors"
                onClick={() => applyTableOp('insertColRight', contextMenu.tableIndex, contextMenu.rowIndex, contextMenu.colIndex)}
              >
                <span className="text-base">➡️</span> 在右侧插入列
              </button>
              <button
                className="w-full px-3 py-1.5 text-left text-red-400 hover:bg-red-500/15 hover:text-red-300 flex items-center gap-2 transition-colors"
                onClick={() => applyTableOp('deleteCol', contextMenu.tableIndex, contextMenu.rowIndex, contextMenu.colIndex)}
              >
                <span className="text-base">🗑️</span> 删除当前列
              </button>
              <div className="my-1 border-t border-slate-700/80" />
            </>
          ) : null}

          {/* 通用操作：插入表格 */}
          <button
            className="w-full px-3 py-1.5 text-left text-indigo-300 hover:bg-indigo-500/20 hover:text-indigo-200 flex items-center gap-2 transition-colors"
            onClick={insertNewTable}
          >
            <span className="text-base">📋</span> 插入新表格
          </button>
        </div>
      )}

      {/* 左侧文档管理侧边栏 */}
      <div
        className={`bg-slate-950 border-r border-slate-800/80 flex flex-col transition-all duration-300 ${
          sidebarOpen ? 'w-72 min-w-72' : 'w-0 min-w-0 opacity-0 overflow-hidden'
        }`}
      >
        <div className="p-3 border-b border-slate-800/80 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="text-xl shrink-0">📝</span>
              <span className="font-semibold text-xs text-slate-200 whitespace-nowrap">我的文档</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 font-mono whitespace-nowrap">
                {docs.length} 篇
              </span>
            </div>
            <button
              onClick={() => setSidebarOpen(false)}
              className="px-1.5 py-0.5 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 transition-colors text-[11px] whitespace-nowrap"
              title="收起侧边栏"
            >
              ◀ 收起
            </button>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => {
                setNewFolderName('')
                setShowNewFolderModal(true)
              }}
              className="flex-1 py-1 px-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs flex items-center justify-center gap-1 transition-colors whitespace-nowrap"
              title="在当前位置新建文件夹"
            >
              <span>📁+</span>
              <span>新建目录</span>
            </button>
            <button
              onClick={handleOpenFile}
              className="flex-1 py-1 px-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs flex items-center justify-center gap-1 transition-colors whitespace-nowrap"
              title="从外部磁盘打开 Markdown 文件..."
            >
              <span>📂</span>
              <span>打开</span>
            </button>
            <button
              onClick={handleNewDoc}
              className="flex-1 py-1 px-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs flex items-center justify-center gap-1 shadow transition-colors font-medium whitespace-nowrap"
              title="新建文档"
            >
              <span className="text-white font-bold leading-none">+</span>
              <span className="text-white font-medium leading-none">新建</span>
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
          <div className="grid grid-cols-3 gap-1 pt-0.5">
            <button
              onClick={handleOpenWorkspaceDir}
              className="py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-[10px] transition-colors flex items-center justify-center gap-1"
              title="在 Windows 资源管理器中打开当前工作目录"
            >
              <span>📂 打开</span>
            </button>
            <button
              onClick={() => {
                setNewFolderName('')
                setShowNewFolderModal(true)
              }}
              className="py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-[10px] transition-colors flex items-center justify-center gap-1"
              title="在当前工作目录下新建文件夹"
            >
              <span>📁+ 新建目录</span>
            </button>
            <button
              onClick={handleSelectWorkspaceDir}
              className="py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-[10px] transition-colors flex items-center justify-center gap-1"
              title="选择新文件夹作为默认保存目录"
            >
              <span>🔄 更改</span>
            </button>
          </div>
        </div>

        {/* 目录面包屑导航（当在子目录时显示） */}
        {currentDir && (
          <div className="px-2.5 py-1.5 bg-slate-950/90 border-b border-slate-800/80 flex items-center justify-between text-xs">
            <div className="flex items-center gap-1 text-slate-400 overflow-hidden text-[11px]">
              <button
                onClick={() => handleNavigateDir('')}
                className="hover:text-indigo-400 text-slate-500 shrink-0 font-medium"
                title="返回根目录"
              >
                根目录
              </button>
              {currentDir.split('/').map((part, idx, arr) => {
                const sub = arr.slice(0, idx + 1).join('/')
                const isLast = idx === arr.length - 1
                return (
                  <React.Fragment key={sub}>
                    <span className="text-slate-600">/</span>
                    <button
                      onClick={() => handleNavigateDir(sub)}
                      className={`truncate max-w-[80px] ${isLast ? 'text-indigo-400 font-semibold' : 'hover:text-indigo-400 text-slate-400'}`}
                    >
                      {part}
                    </button>
                  </React.Fragment>
                )
              })}
            </div>
            <div className="flex items-center gap-1 shrink-0 ml-1">
              <button
                onClick={() => {
                  setNewFolderName('')
                  setShowNewFolderModal(true)
                }}
                className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-indigo-300 text-[10px]"
                title="在此目录下新建子目录"
              >
                📁+
              </button>
              <button
                onClick={handleNavigateUp}
                className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px]"
                title="返回上一级目录"
              >
                ⬆️ 上级
              </button>
            </div>
          </div>
        )}

        {/* 文档与文件夹列表 */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {/* 文件夹列表 */}
          {folders.map((f) => (
            <div
              key={f.relativePath}
              onClick={() => handleNavigateDir(f.relativePath)}
              className="group p-2.5 rounded-xl border border-slate-800/60 bg-slate-900/40 hover:bg-slate-900 hover:border-indigo-500/50 text-xs cursor-pointer transition-all flex items-center justify-between shadow-sm"
            >
              <div className="flex items-center gap-2 truncate flex-1 min-w-0">
                <span className="text-base text-indigo-400">📁</span>
                <span className="font-semibold text-slate-200 truncate group-hover:text-indigo-300">{f.name}</span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 font-mono">目录</span>
                <button
                  onClick={(e) => handleDeleteFolder(f.relativePath, f.name, e)}
                  className="opacity-0 group-hover:opacity-100 p-1 hover:text-rose-400 text-slate-500 transition-opacity"
                  title="删除此目录及其中内容"
                >
                  🗑️
                </button>
              </div>
            </div>
          ))}

          {docs.length === 0 && folders.length === 0 && (
            <div className="text-center py-12 text-slate-500 text-xs">当前目录下暂无文档或文件夹</div>
          )}

          {docs.map((doc) => {
            const isActive = activeDoc ? doc.id === activeDoc.id : false
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
                <button
                  onClick={(e) => handleDeleteDoc(doc.id, e)}
                  className="opacity-0 group-hover:opacity-100 p-1 hover:text-rose-400 text-slate-500 transition-opacity"
                  title="删除此文档"
                >
                  🗑️
                </button>
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
        {activeDoc ? (
          <>
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
                  onClick={() => setViewMode('ir')}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors shrink-0 whitespace-nowrap ${
                    viewMode === 'ir' ? 'bg-indigo-600 text-white shadow-xs' : 'text-slate-400 hover:text-slate-200'
                  }`}
                  title="即时渲染模式：Typora 风格编辑即预览，光标处展示源码，离开光标即时渲染"
                >
                  ⚡ 编辑即预览
                </button>
                <button
                  onClick={() => setViewMode('wysiwyg')}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors shrink-0 whitespace-nowrap ${
                    viewMode === 'wysiwyg' ? 'bg-indigo-600 text-white shadow-xs' : 'text-slate-400 hover:text-slate-200'
                  }`}
                  title="所见即所得富文本模式"
                >
                  📝 所见即所得
                </button>
                <button
                  onClick={() => setViewMode('sv')}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors shrink-0 whitespace-nowrap ${
                    viewMode === 'sv' ? 'bg-indigo-600 text-white shadow-xs' : 'text-slate-400 hover:text-slate-200'
                  }`}
                  title="分屏双栏模式：左侧源码，右侧实时渲染"
                >
                  🌗 双栏
                </button>
                <button
                  onClick={() => setViewMode('preview')}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors shrink-0 whitespace-nowrap ${
                    viewMode === 'preview' ? 'bg-indigo-600 text-white shadow-xs' : 'text-slate-400 hover:text-slate-200'
                  }`}
                  title="纯净阅读预览模式"
                >
                  👁️ 纯预览
                </button>
              </div>

              {/* 右侧：规范化整理的快捷操作组 */}
              <div className="flex items-center gap-1.5 shrink-0">
                {/* 组 1：历史版本快照 */}
                <div className="flex items-center bg-slate-900 border border-slate-800 rounded-lg p-0.5 text-xs shrink-0 shadow-sm">
                  <button
                    onClick={() => setShowHistoryDrawer(true)}
                    className="px-2 py-0.5 rounded text-[11px] text-indigo-300 hover:bg-indigo-500/20 hover:text-indigo-200 transition-all flex items-center gap-1 font-medium whitespace-nowrap"
                    title="打开时间轴版本快照与 Git 变更对比"
                  >
                    <span>⏱️</span>
                    <span>历史版本</span>
                  </button>
                </div>

                {/* 组 2：文件与导出 */}
                <div className="flex items-center bg-slate-900 border border-slate-800 rounded-lg p-0.5 text-xs shrink-0 shadow-sm">
                  <button
                    onClick={handleCopyMarkdown}
                    className="p-1 rounded hover:text-indigo-400 text-slate-400 transition-colors"
                    title="复制 Markdown 源码"
                  >
                    📋
                  </button>
                  <button
                    onClick={handleExport}
                    className="p-1 rounded hover:text-indigo-400 text-slate-400 transition-colors"
                    title="导出为 .md 文件"
                  >
                    💾
                  </button>
                  <button
                    onClick={handleSaveAs}
                    className="p-1 rounded hover:text-indigo-400 text-slate-400 transition-colors"
                    title="另存为自定义位置..."
                  >
                    📁
                  </button>
                </div>
              </div>
            </div>

            {/* 编辑与预览核心工作区 */}
            <div className="flex-1 flex overflow-hidden relative">
              {/* Vditor 容器（即时渲染 / 所见即所得 / 双栏分屏） */}
              <div
                ref={vditorContainerRef}
                data-vditor-host
                className={`flex-1 min-h-0 min-w-0 overflow-hidden ${viewMode === 'preview' ? 'hidden' : 'flex flex-col'}`}
              />

              {/* 纯预览模式 */}
              {viewMode === 'preview' && (
                <div className="w-full h-full overflow-y-auto p-8 bg-slate-900/40 select-text">
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
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-500 gap-4 select-none p-6">
            <span className="text-5xl">📝</span>
            <div className="text-center space-y-1.5">
              <p className="text-sm font-medium text-slate-300">
                {currentDir ? `当前子目录「${currentDir}」下暂无 Markdown 文档` : '当前工作目录下暂无 Markdown 文档'}
              </p>
              <p className="text-xs text-slate-500">点击下方按钮或左侧「新建」创建第一篇文档</p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={handleNewDoc}
                className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium shadow-lg shadow-indigo-600/20 transition-all flex items-center gap-1.5"
              >
                <span>+</span>
                <span>在此目录下新建文档</span>
              </button>
              <button
                onClick={() => {
                  setNewFolderName('')
                  setShowNewFolderModal(true)
                }}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-medium transition-all flex items-center gap-1.5"
              >
                <span>📁+</span>
                <span>新建子文件夹</span>
              </button>
            </div>
          </div>
        )}
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

      {/* 新建文件夹弹窗 */}
      {showNewFolderModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-sm w-full p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xl">📁</span>
                <h3 className="font-bold text-white text-sm">新建文件夹</h3>
              </div>
              <button
                onClick={() => setShowNewFolderModal(false)}
                className="text-slate-400 hover:text-white text-sm p-1"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-slate-400">
              当前保存位置：<span className="font-mono text-indigo-400">{currentDir || '根目录'}</span>
            </p>

            <form onSubmit={handleCreateFolder} className="space-y-4">
              <input
                type="text"
                autoFocus
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                placeholder="输入文件夹名称（例如：项目方案、技术笔记）..."
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
              />

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowNewFolderModal(false)}
                  className="px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs transition-colors"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={!newFolderName.trim()}
                  className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-medium shadow-md shadow-indigo-600/20 transition-colors"
                >
                  确认创建
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 文件版本控制抽屉 */}
      {activeDoc && (
        <VersionHistoryDrawer
          isOpen={showHistoryDrawer}
          onClose={() => setShowHistoryDrawer(false)}
          scope="markdown-editor"
          fileName={activeDoc.fileName || `${(activeDoc.title || '文档').replace(/[\\/:*?"<>|]/g, '_')}.md`}
          currentContent={activeDoc.content}
          onRestoreContent={(content) => {
            updateContent(content)
            if (vditorRef.current && isVditorReadyRef.current) {
              vditorRef.current.setValue(content)
            }
            showToast('已恢复历史版本内容 ↩️')
          }}
          onShowToast={showToast}
        />
      )}
    </div>
  )
}
