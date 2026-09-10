import React, { useState, useEffect, useMemo, useRef } from 'react'
import { getSDK, WorkspaceFileItem } from '@doujiao/plugin-sdk'
import { VersionHistoryDrawer } from './components/VersionHistoryDrawer'
import {
  encryptNoteContent,
  decryptNoteContent,
  isEncryptedContent,
  isMasterPasswordSet,
  setupMasterPassword,
  verifyMasterPassword
} from './lib/crypto'

interface Note {
  id: string
  title: string
  content: string
  pinned: boolean
  updatedAt: number
  color?: string
  fileName?: string
  isEncrypted?: boolean
  isLocked?: boolean
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
2. 全局密码加密保护：支持对指定敏感便签开启加密保护（AES-256-GCM 本地硬件级强加密），统一使用全局访问密码，离开即自动重新上锁！
3. 目录层级支持：支持创建子文件夹分类整理便签，支持多层级灵活归纳。
4. 实时自动存盘：键入即自动实时写入外部磁盘，可在顶部查看存盘状态。
5. 自定义工作目录：支持随时更换存储路径，或一键打开所在本地文件夹。
6. 置顶功能：点击右上角的图钉 📌 可以将高频使用的便签置顶在列表顶端。
7. 搜索与导出：支持标题与正文关键词极速搜索，支持一键导出为 .txt 文件。`,
    pinned: true,
    updatedAt: Date.now(),
    color: 'amber',
    isEncrypted: false,
    isLocked: false
  }
]

export default function App(): JSX.Element {
  const [notes, setNotes] = useState<Note[]>(() => {
    try {
      const saved = localStorage.getItem('doujiao_notepad_notes')
      if (saved) {
        const parsed = JSON.parse(saved)
        if (Array.isArray(parsed)) {
          return parsed.map((n) => {
            const encrypted = isEncryptedContent(n.content) || Boolean(n.isEncrypted)
            return {
              ...n,
              isEncrypted: encrypted,
              isLocked: encrypted ? true : false
            }
          })
        }
      }
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

  // 全局密码加密与访问状态
  const masterPasswordInSession = useRef<string | null>(null)
  const sessionPasswordsRef = useRef<Record<string, string>>({})
  const [sessionPasswords, setSessionPasswords] = useState<Record<string, string>>({})
  const [hasMasterPass, setHasMasterPass] = useState<boolean>(() => isMasterPasswordSet())
  const [unlockPassword, setUnlockPassword] = useState('')
  const [unlockError, setUnlockError] = useState<string | null>(null)
  const [showUnlockPassword, setShowUnlockPassword] = useState(false)
  const [isUnlocking, setIsUnlocking] = useState(false)

  // 开启加密弹窗状态
  const [showEncryptModal, setShowEncryptModal] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [encryptModalError, setEncryptModalError] = useState<string | null>(null)
  const [showNewPassword, setShowNewPassword] = useState(false)

  // 安全管理弹窗状态（解除加密 / 修改密码）
  const [showSecuritySettingsModal, setShowSecuritySettingsModal] = useState(false)
  const [securityTab, setSecurityTab] = useState<'remove' | 'change'>('remove')
  const [currentPassInput, setCurrentPassInput] = useState('')
  const [newPassInput, setNewPassInput] = useState('')
  const [confirmPassInput, setConfirmPassInput] = useState('')
  const [securityModalError, setSecurityModalError] = useState<string | null>(null)

  // 删除加锁/加密便签二次密码验证弹窗状态
  const [deleteModalTarget, setDeleteModalTarget] = useState<{
    type: 'note' | 'folder'
    id: string
    title: string
    note?: Note
    folderRelPath?: string
  } | null>(null)
  const [deletePassword, setDeletePassword] = useState('')
  const [showDeletePassword, setShowDeletePassword] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  // 目录层级与文件夹管理
  const [currentDir, setCurrentDir] = useState<string>('')
  const [folders, setFolders] = useState<WorkspaceFileItem[]>([])
  const [showNewFolderModal, setShowNewFolderModal] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')

  const activeNote = notes.find((n) => n.id === activeNoteId) || notes[0]

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 2500)
  }

  // 1. 初始化工作目录与磁盘 .txt 文件同步（支持子目录）
  const loadWorkspace = async (targetSubDir = currentDir) => {
    try {
      const sdk = getSDK()
      if (sdk?.workspace) {
        const dir = await sdk.workspace.getDirectory('notepad')
        setWorkspaceDir(dir)
        const allItems = await sdk.workspace.listFiles('notepad', ['.txt'], targetSubDir)
        const dirItems = allItems.filter((i) => i.isDirectory)
        const fileItems = allItems.filter((i) => !i.isDirectory)
        setFolders(dirItems)

        if (fileItems.length === 0 && !targetSubDir) {
          // 首次启动，若本地缓存有旧笔记或默认笔记，自动平滑迁移写入磁盘
          const initialNotes = notes.length > 0 ? notes : DEFAULT_NOTES
          for (const n of initialNotes) {
            const fName = `${(n.title || '便签').replace(/[\\/:*?"<>|]/g, '_')}.txt`
            await sdk.workspace.writeFile(fName, n.content, 'notepad')
          }
          const refreshed = await sdk.workspace.listFiles('notepad', ['.txt'], targetSubDir)
          const refFiles = refreshed.filter((i) => !i.isDirectory)
          const loaded: Note[] = []
          for (const f of refFiles) {
            const content = await sdk.workspace.readFile(f.relativePath, 'notepad')
            const encrypted = isEncryptedContent(content)
            let finalContent = content
            let locked = encrypted
            if (encrypted && sessionPasswordsRef.current[f.relativePath]) {
              try {
                finalContent = await decryptNoteContent(content, sessionPasswordsRef.current[f.relativePath])
                locked = false
              } catch {
                locked = true
              }
            }
            loaded.push({
              id: f.relativePath,
              fileName: f.relativePath,
              title: f.name.replace(/\.txt$/i, ''),
              content: finalContent,
              pinned: f.name.includes('指南') || f.name.includes('置顶'),
              updatedAt: f.updatedAt,
              isEncrypted: encrypted,
              isLocked: locked
            })
          }
          if (loaded.length > 0) {
            setNotes(loaded)
            setActiveNoteId(loaded[0].id)
          }
        } else {
          const loaded: Note[] = []
          for (const f of fileItems) {
            const content = await sdk.workspace.readFile(f.relativePath, 'notepad')
            const encrypted = isEncryptedContent(content)
            let finalContent = content
            let locked = encrypted
            if (encrypted && sessionPasswordsRef.current[f.relativePath]) {
              try {
                finalContent = await decryptNoteContent(content, sessionPasswordsRef.current[f.relativePath])
                locked = false
              } catch {
                locked = true
              }
            }
            loaded.push({
              id: f.relativePath,
              fileName: f.relativePath,
              title: f.name.replace(/\.txt$/i, ''),
              content: finalContent,
              pinned: f.name.includes('指南') || f.name.includes('置顶'),
              updatedAt: f.updatedAt,
              isEncrypted: encrypted,
              isLocked: locked
            })
          }
          setNotes(loaded)
          if (loaded.length > 0) {
            if (!loaded.some((n) => n.id === activeNoteId)) {
              setActiveNoteId(loaded[0].id)
            }
          } else {
            setActiveNoteId('')
          }
        }
      }
    } catch (err) {
      console.warn('[Notepad] 读取工作目录失败，使用本地缓存模式:', err)
    }
  }

  const handleNavigateDir = (subDir: string) => {
    if (activeNote && activeNote.isEncrypted && !activeNote.isLocked) {
      handleLockNote(activeNote.id, true)
    }
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
        await sdk.workspace.createDirectory(relPath, 'notepad')
        showToast(`已创建文件夹: ${trimmed}`)
        setNewFolderName('')
        setShowNewFolderModal(false)
        await loadWorkspace(currentDir)
      }
    } catch (err: any) {
      showToast(`创建文件夹失败: ${err?.message || '未知错误'}`)
    }
  }

  const executeDeleteFolder = async (folderRelPath: string, folderName: string) => {
    try {
      const sdk = getSDK()
      if (sdk?.workspace?.deleteFile) {
        await sdk.workspace.deleteFile(folderRelPath, 'notepad')
        showToast(`已删除文件夹: ${folderName}`)
        await loadWorkspace(currentDir)
      }
    } catch (err: any) {
      showToast(`删除失败: ${err?.message || '未知错误'}`)
    }
  }

  const handleDeleteFolder = async (folderRelPath: string, folderName: string, e: React.MouseEvent) => {
    e.stopPropagation()
    // 检查该文件夹下是否包含已加密锁定的便签
    const hasEncryptedInFolder = notes.some(
      (n) => n.isEncrypted && (n.fileName === folderRelPath || n.fileName?.startsWith(folderRelPath + '/'))
    )

    if (hasEncryptedInFolder) {
      setDeleteModalTarget({
        type: 'folder',
        id: folderRelPath,
        title: folderName,
        folderRelPath
      })
      setDeletePassword('')
      setShowDeletePassword(false)
      setDeleteError(null)
      return
    }

    if (!window.confirm(`确定要删除文件夹 "${folderName}" 及其内部包含的所有文件吗？此操作无法撤销。`)) return
    await executeDeleteFolder(folderRelPath, folderName)
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
    if (activeNote.isEncrypted && activeNote.isLocked) return
    const timer = setTimeout(async () => {
      try {
        const sdk = getSDK()
        if (sdk?.workspace) {
          const targetName = activeNote.fileName || `${(activeNote.title || '便签').replace(/[\\/:*?"<>|]/g, '_')}.txt`
          let contentToWrite = activeNote.content
          if (activeNote.isEncrypted) {
            const pass = masterPasswordInSession.current || sessionPasswordsRef.current[activeNote.id]
            if (!pass) return
            contentToWrite = await encryptNoteContent(activeNote.content, pass)
          }
          setIsDiskSaving(true)
          await sdk.workspace.writeFile(targetName, contentToWrite, 'notepad')
          if (sdk.workspace.history) {
            await sdk.workspace.history.saveSnapshot('notepad', targetName, contentToWrite, 'auto')
          }
          setIsDiskSaving(false)
        }
      } catch {
        setIsDiskSaving(false)
      }
    }, 1000)
    return () => clearTimeout(timer)
  }, [activeNote?.content, activeNote?.isEncrypted, activeNote?.isLocked])

  // 快捷键 Ctrl+S / Cmd+S 立即存盘并打快照
  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        if (!activeNote) return
        if (activeNote.isEncrypted && activeNote.isLocked) return
        const sdk = getSDK()
        if (sdk?.workspace) {
          const targetName = activeNote.fileName || `${(activeNote.title || '便签').replace(/[\\/:*?"<>|]/g, '_')}.txt`
          let contentToWrite = activeNote.content
          if (activeNote.isEncrypted) {
            const pass = masterPasswordInSession.current || sessionPasswordsRef.current[activeNote.id]
            if (!pass) return
            contentToWrite = await encryptNoteContent(activeNote.content, pass)
          }
          setIsDiskSaving(true)
          await sdk.workspace.writeFile(targetName, contentToWrite, 'notepad')
          if (sdk.workspace.history) {
            await sdk.workspace.history.saveSnapshot('notepad', targetName, contentToWrite, 'auto', '手动存盘 (Ctrl+S)')
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
    if (!activeNote) return
    if (activeNote.isEncrypted && activeNote.isLocked) {
      showToast('请先输入密码解锁便签后再另存为')
      return
    }
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

  // 立即锁定加密便签并密文存盘
  const handleLockNote = async (targetId?: string, silent = false) => {
    const id = targetId || activeNote?.id
    if (!id) return
    const note = notes.find((n) => n.id === id)
    if (!note || !note.isEncrypted || note.isLocked) return

    const pass = masterPasswordInSession.current || sessionPasswordsRef.current[id]
    let cipher = note.content
    if (pass) {
      try {
        cipher = await encryptNoteContent(note.content, pass)
        const sdk = getSDK()
        if (sdk?.workspace) {
          const targetName = note.fileName || `${(note.title || '便签').replace(/[\\/:*?"<>|]/g, '_')}.txt`
          await sdk.workspace.writeFile(targetName, cipher, 'notepad')
          if (sdk.workspace.history) {
            await sdk.workspace.history.saveSnapshot('notepad', targetName, cipher, 'auto', '锁定存盘')
          }
        }
      } catch (err) {
        console.error('锁定加密存盘失败:', err)
      }
    }

    delete sessionPasswordsRef.current[id]
    setSessionPasswords((prev) => {
      const copy = { ...prev }
      delete copy[id]
      return copy
    })

    setNotes((prev) =>
      prev.map((n) =>
        n.id === id
          ? { ...n, content: cipher, isLocked: true }
          : n
      )
    )
    if (!silent) {
      showToast('便签已锁定 🔒')
    }
  }

  // 从外部磁盘打开文件
  const handleOpenFile = async () => {
    try {
      if (activeNote && activeNote.isEncrypted && !activeNote.isLocked) {
        await handleLockNote(activeNote.id, true)
      }
      const sdk = getSDK()
      if (sdk?.workspace?.selectFileToOpen) {
        const res = await sdk.workspace.selectFileToOpen(['txt', 'log', 'md'])
        if (!res.canceled && res.content !== undefined && res.fileName) {
          const title = res.fileName.replace(/\.(txt|log|md)$/i, '')
          const encrypted = isEncryptedContent(res.content)
          const existing = notes.find((n) => n.title === title || n.fileName === res.fileName)
          if (existing) {
            if (existing.isEncrypted && existing.isLocked) {
              showToast('该文件已在列表中，请先输入密码解锁')
            } else {
              updateNote('content', res.content)
              showToast(`已载入文件: ${res.fileName}`)
            }
            setActiveNoteId(existing.id)
          } else {
            const newNote: Note = {
              id: res.fileName,
              fileName: res.fileName,
              title,
              content: res.content,
              pinned: false,
              updatedAt: Date.now(),
              isEncrypted: encrypted,
              isLocked: encrypted
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
        const matchTitle = n.title.toLowerCase().includes(q)
        const matchContent = (!n.isEncrypted || !n.isLocked) && n.content.toLowerCase().includes(q)
        return matchTitle || matchContent
      })
      .sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
        return b.updatedAt - a.updatedAt
      })
  }, [notes, searchQuery])

  // 选择切换便签（若当前便签已解锁且开启了加密，切换离开时自动加密存盘并重新上锁）
  const handleSelectNote = async (id: string) => {
    if (id === activeNoteId) return

    if (activeNote && activeNote.isEncrypted && !activeNote.isLocked) {
      await handleLockNote(activeNote.id, true)
    }

    setActiveNoteId(id)
    setUnlockPassword('')
    setUnlockError(null)
  }

  // 新建笔记（支持在当前子目录新建，离开加密便签时自动上锁）
  const handleNewNote = async () => {
    if (activeNote && activeNote.isEncrypted && !activeNote.isLocked) {
      await handleLockNote(activeNote.id, true)
    }
    let baseName = '新便签'
    let title = baseName
    let counter = 1
    while (notes.some((n) => n.title === title)) {
      title = `${baseName}_${counter++}`
    }
    const simpleName = `${title}.txt`
    const relFileName = currentDir ? `${currentDir}/${simpleName}` : simpleName
    const defaultContent = ''

    try {
      const sdk = getSDK()
      if (sdk?.workspace) {
        await sdk.workspace.writeFile(relFileName, defaultContent, 'notepad')
      }
    } catch {}

    const newNote: Note = {
      id: relFileName,
      fileName: relFileName,
      title,
      content: defaultContent,
      pinned: false,
      updatedAt: Date.now(),
      isEncrypted: false,
      isLocked: false
    }
    setNotes((prev) => [newNote, ...prev])
    setActiveNoteId(newNote.id)
    showToast(`已在工作目录新建: ${simpleName}`)
  }

  // 更新内容
  const updateNote = async (field: 'title' | 'content', val: string) => {
    if (!activeNote) return
    if (activeNote.isEncrypted && activeNote.isLocked) return

    if (field === 'title') {
      const safeTitle = val.trim() || '新便签'
      const baseName = `${safeTitle.replace(/[\\/:*?"<>|]/g, '_')}.txt`
      const prefix = activeNote.fileName && activeNote.fileName.includes('/')
        ? activeNote.fileName.slice(0, activeNote.fileName.lastIndexOf('/') + 1)
        : (currentDir ? `${currentDir}/` : '')
      const newFileName = `${prefix}${baseName}`
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

        // 迁移 session 密码映射
        if (sessionPasswordsRef.current[activeNote.id]) {
          const pass = sessionPasswordsRef.current[activeNote.id]
          delete sessionPasswordsRef.current[activeNote.id]
          sessionPasswordsRef.current[newFileName] = pass
          setSessionPasswords((prev) => {
            const copy = { ...prev }
            delete copy[activeNote.id]
            copy[newFileName] = pass
            return copy
          })
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

  // 执行删除物理便签文件与清理状态
  const executeDeleteNote = async (id: string) => {
    const noteToDelete = notes.find((n) => n.id === id)
    if (!noteToDelete) return

    if (noteToDelete.fileName) {
      try {
        const sdk = getSDK()
        if (sdk?.workspace) {
          await sdk.workspace.deleteFile(noteToDelete.fileName, 'notepad')
        }
      } catch (err) {
        console.warn('删除物理文件失败:', err)
      }
    }

    delete sessionPasswordsRef.current[id]
    setSessionPasswords((prev) => {
      const copy = { ...prev }
      delete copy[id]
      return copy
    })

    const remaining = notes.filter((n) => n.id !== id)
    setNotes(remaining)
    if (activeNoteId === id) {
      setActiveNoteId(remaining[0]?.id || '')
    }
  }

  // 删除便签（若文件已加锁加密，必须输入密码验证后方可删除）
  const handleDelete = async (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation()
    const noteToDelete = notes.find((n) => n.id === id)
    if (!noteToDelete) return

    // 如果文件已加锁/加密保护，删除必须输入密码
    if (noteToDelete.isEncrypted) {
      setDeleteModalTarget({
        type: 'note',
        id,
        title: noteToDelete.title || noteToDelete.fileName || '加密便签',
        note: noteToDelete
      })
      setDeletePassword('')
      setShowDeletePassword(false)
      setDeleteError(null)
      return
    }

    // 未加密便签使用常规确认
    const title = noteToDelete.title || noteToDelete.fileName || '该便签'
    if (!window.confirm(`确定要删除便签 "${title}" 吗？此操作将永久删除物理文件且无法撤销。`)) {
      return
    }
    await executeDeleteNote(id)
    showToast('便签已从工作目录删除')
  }

  // 验证全局密码确认删除加密便签或文件夹
  const handleConfirmDeleteWithPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!deleteModalTarget) return
    const pass = deletePassword.trim()
    if (!pass) {
      setDeleteError('请输入全局访问密码确认删除')
      return
    }

    setIsDeleting(true)
    setDeleteError(null)

    try {
      let isValid = false
      if (isMasterPasswordSet()) {
        isValid = await verifyMasterPassword(pass)
      }

      // 如果全局主密码校验未通过，但属于单条便签，尝试使用该密码直接解密便签内容作为校验
      if (!isValid && deleteModalTarget.note && isEncryptedContent(deleteModalTarget.note.content)) {
        try {
          await decryptNoteContent(deleteModalTarget.note.content, pass)
          isValid = true
        } catch {
          isValid = false
        }
      }

      if (!isValid) {
        setDeleteError('全局访问密码错误，无法执行删除')
        setIsDeleting(false)
        return
      }

      // 密码验证通过，执行实际物理删除
      if (deleteModalTarget.type === 'note') {
        await executeDeleteNote(deleteModalTarget.id)
        showToast(`已验证密码并删除加密便签「${deleteModalTarget.title}」🗑️`)
      } else if (deleteModalTarget.type === 'folder' && deleteModalTarget.folderRelPath) {
        await executeDeleteFolder(deleteModalTarget.folderRelPath, deleteModalTarget.title)
        showToast(`已验证密码并删除文件夹「${deleteModalTarget.title}」🗑️`)
      }

      setDeleteModalTarget(null)
      setDeletePassword('')
    } catch (err: any) {
      setDeleteError(`删除失败: ${err?.message || '未知错误'}`)
    } finally {
      setIsDeleting(false)
    }
  }

  // 解锁加密便签
  const handleUnlockNote = async () => {
    if (!activeNote) return
    const pass = unlockPassword.trim()
    if (!pass) {
      setUnlockError('请输入全局访问密码')
      return
    }
    setIsUnlocking(true)
    setUnlockError(null)
    try {
      const decrypted = await decryptNoteContent(activeNote.content, pass)

      if (!isMasterPasswordSet()) {
        await setupMasterPassword(pass)
        setHasMasterPass(true)
      } else {
        const ok = await verifyMasterPassword(pass)
        if (!ok) {
          await setupMasterPassword(pass)
          setHasMasterPass(true)
        }
      }

      masterPasswordInSession.current = pass
      sessionPasswordsRef.current[activeNote.id] = pass
      setSessionPasswords((prev) => ({ ...prev, [activeNote.id]: pass }))

      setNotes((prev) =>
        prev.map((n) =>
          n.id === activeNote.id
            ? { ...n, content: decrypted, isLocked: false }
            : n
        )
      )
      setUnlockPassword('')
      showToast('便签已解锁 🔓')
    } catch (err: any) {
      setUnlockError('访问密码错误，无法解锁便签')
    } finally {
      setIsUnlocking(false)
    }
  }

  // 开启加密保护
  const handleEnableEncryption = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!activeNote) return

    const masterConfigured = isMasterPasswordSet()
    let passToUse = ''

    if (!masterConfigured) {
      if (!newPassword || newPassword.length < 4) {
        setEncryptModalError('全局密码长度不能少于 4 位')
        return
      }
      if (newPassword !== confirmPassword) {
        setEncryptModalError('两次输入的密码不一致')
        return
      }
      passToUse = newPassword
      await setupMasterPassword(passToUse)
      setHasMasterPass(true)
    } else {
      if (!newPassword) {
        setEncryptModalError('请输入已设置的全局访问密码')
        return
      }
      const valid = await verifyMasterPassword(newPassword)
      if (!valid) {
        setEncryptModalError('全局访问密码错误')
        return
      }
      passToUse = newPassword
    }

    try {
      const cipher = await encryptNoteContent(activeNote.content, passToUse)
      const sdk = getSDK()
      if (sdk?.workspace) {
        const targetName = activeNote.fileName || `${(activeNote.title || '便签').replace(/[\\/:*?"<>|]/g, '_')}.txt`
        await sdk.workspace.writeFile(targetName, cipher, 'notepad')
        if (sdk.workspace.history) {
          await sdk.workspace.history.saveSnapshot('notepad', targetName, cipher, 'auto', '开启加密保护')
        }
      }

      masterPasswordInSession.current = passToUse
      sessionPasswordsRef.current[activeNote.id] = passToUse
      setSessionPasswords((prev) => ({ ...prev, [activeNote.id]: passToUse }))

      setNotes((prev) =>
        prev.map((n) =>
          n.id === activeNote.id
            ? { ...n, isEncrypted: true, isLocked: false }
            : n
        )
      )

      setShowEncryptModal(false)
      setNewPassword('')
      setConfirmPassword('')
      showToast('已为当前便签开启加密保护 🔒')
    } catch (err: any) {
      setEncryptModalError(`加密失败: ${err?.message || '未知错误'}`)
    }
  }

  // 解除加密保护
  const handleRemoveEncryption = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!activeNote) return

    if (!currentPassInput) {
      setSecurityModalError('请输入全局访问密码')
      return
    }

    const isMasterValid = await verifyMasterPassword(currentPassInput)
    if (!isMasterValid) {
      setSecurityModalError('全局访问密码验证错误，无法解除加密')
      return
    }

    try {
      let plainText = activeNote.content
      if (activeNote.isLocked) {
        plainText = await decryptNoteContent(activeNote.content, currentPassInput)
      }

      const sdk = getSDK()
      if (sdk?.workspace) {
        const targetName = activeNote.fileName || `${(activeNote.title || '便签').replace(/[\\/:*?"<>|]/g, '_')}.txt`
        await sdk.workspace.writeFile(targetName, plainText, 'notepad')
        if (sdk.workspace.history) {
          await sdk.workspace.history.saveSnapshot('notepad', targetName, plainText, 'auto', '解除加密保护')
        }
      }

      delete sessionPasswordsRef.current[activeNote.id]
      setSessionPasswords((prev) => {
        const copy = { ...prev }
        delete copy[activeNote.id]
        return copy
      })

      setNotes((prev) =>
        prev.map((n) =>
          n.id === activeNote.id
            ? { ...n, content: plainText, isEncrypted: false, isLocked: false }
            : n
        )
      )

      setShowSecuritySettingsModal(false)
      setCurrentPassInput('')
      showToast('已解除便签加密，恢复为普通文本 🔓')
    } catch (err: any) {
      setSecurityModalError(`解除加密失败: ${err?.message || '未知错误'}`)
    }
  }

  // 修改全局密码
  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!currentPassInput) {
      setSecurityModalError('请输入当前全局访问密码')
      return
    }
    const isMasterValid = await verifyMasterPassword(currentPassInput)
    if (!isMasterValid) {
      setSecurityModalError('当前全局访问密码错误')
      return
    }
    if (!newPassInput || newPassInput.length < 4) {
      setSecurityModalError('新密码长度不能少于 4 位')
      return
    }
    if (newPassInput !== confirmPassInput) {
      setSecurityModalError('两次输入的新密码不一致')
      return
    }

    try {
      // 1. 更新全局主密码 Verifier
      await setupMasterPassword(newPassInput)
      setHasMasterPass(true)
      masterPasswordInSession.current = newPassInput

      // 2. 批量重新加密所有加密便签
      const sdk = getSDK()
      const updatedNotes: Note[] = []

      for (const n of notes) {
        if (!n.isEncrypted) {
          updatedNotes.push(n)
          continue
        }

        try {
          let plainText = n.content
          if (n.isLocked) {
            try {
              plainText = await decryptNoteContent(n.content, currentPassInput)
            } catch {
              updatedNotes.push(n)
              continue
            }
          }

          const newCipher = await encryptNoteContent(plainText, newPassInput)
          const targetName = n.fileName || `${(n.title || '便签').replace(/[\\/:*?"<>|]/g, '_')}.txt`
          if (sdk?.workspace) {
            await sdk.workspace.writeFile(targetName, newCipher, 'notepad')
            if (sdk.workspace.history) {
              await sdk.workspace.history.saveSnapshot('notepad', targetName, newCipher, 'auto', '修改全局密码重加密')
            }
          }

          const isCurrentUnlocked = n.id === activeNote?.id && !n.isLocked
          updatedNotes.push({
            ...n,
            content: isCurrentUnlocked ? plainText : newCipher,
            isLocked: isCurrentUnlocked ? false : true
          })
          if (isCurrentUnlocked) {
            sessionPasswordsRef.current[n.id] = newPassInput
          }
        } catch {
          updatedNotes.push(n)
        }
      }

      setNotes(updatedNotes)
      setShowSecuritySettingsModal(false)
      setCurrentPassInput('')
      setNewPassInput('')
      setConfirmPassInput('')
      showToast('全局访问密码已更新，所有加密便签已同步 🔑')
    } catch (err: any) {
      setSecurityModalError(`修改密码失败: ${err?.message || '未知错误'}`)
    }
  }

  // 复制内容
  const handleCopy = () => {
    if (!activeNote) return
    if (activeNote.isEncrypted && activeNote.isLocked) {
      showToast('请先输入密码解锁便签后再复制')
      return
    }
    if (!activeNote.content) {
      showToast('当前便签为空，无需复制')
      return
    }
    navigator.clipboard.writeText(activeNote.content).then(() => {
      showToast('内容已复制到系统剪贴板')
    })
  }

  // 导出为 .txt
  const handleExportTxt = () => {
    if (!activeNote) return
    if (activeNote.isEncrypted && activeNote.isLocked) {
      showToast('请先输入密码解锁便签后再导出')
      return
    }
    const blob = new Blob([activeNote.content || ''], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${(activeNote.title || '便签').replace(/[\\/:*?"<>|]/g, '_')}.txt`
    a.click()
    URL.revokeObjectURL(url)
    showToast('已导出为 TXT 文件')
  }

  // 清空当前内容
  const handleClear = () => {
    if (!activeNote) return
    if (activeNote.isEncrypted && activeNote.isLocked) {
      showToast('请先输入密码解锁便签')
      return
    }
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
        <div className="absolute top-4 right-6 z-50 px-4 py-2 rounded-xl bg-amber-600 text-white text-xs shadow-lg flex items-center gap-2 animate-bounce">
          <span>🗒️</span>
          <span>{toast}</span>
        </div>
      )}

      {/* 左侧便签列表 */}
      <div className="w-72 min-w-72 bg-slate-950 border-r border-slate-800 flex flex-col h-full">
        {/* 标题栏与新建/打开按钮 */}
        <div className="p-3.5 border-b border-slate-800 flex items-center justify-between">
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
              onClick={() => {
                setNewFolderName('')
                setShowNewFolderModal(true)
              }}
              className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs flex items-center gap-1 transition-colors"
              title="在当前位置新建文件夹"
            >
              <span>📁+</span>
              <span>目录</span>
            </button>
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
              title="新建便签"
            >
              <span>+</span>
              <span>新建</span>
            </button>
          </div>
        </div>

        {/* 默认保存目录卡片 (独立外部存储，卸载不丢失) */}
        <div className="p-2.5 bg-slate-900 border-b border-slate-800 space-y-1.5">
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
            className="text-[10px] font-mono text-slate-400 truncate bg-slate-950 px-2 py-1 rounded border border-slate-800 cursor-pointer hover:border-slate-700 hover:text-slate-300 transition-colors"
            onClick={() => setShowDirectoryModal(true)}
            title={workspaceDir || '默认安全目录：系统用户「文档/Doujiao/Notes」'}
          >
            {workspaceDir ? workspaceDir : '系统用户「文档/Doujiao/Notes」'}
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
              className="py-1 rounded bg-amber-600 hover:bg-amber-500 text-white text-[10px] transition-colors flex items-center justify-center gap-1 font-medium shadow-xs"
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
          <div className="px-2.5 py-1.5 bg-slate-950 border-b border-slate-800 flex items-center justify-between text-xs">
            <div className="flex items-center gap-1 text-slate-400 overflow-hidden text-[11px]">
              <button
                onClick={() => handleNavigateDir('')}
                className="hover:text-amber-400 text-slate-500 shrink-0 font-medium"
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
                      className={`truncate max-w-[80px] ${isLast ? 'text-amber-400 font-semibold' : 'hover:text-amber-400 text-slate-400'}`}
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
                className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-amber-300 text-[10px]"
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

        {/* 搜索框 */}
        <div className="p-2.5 border-b border-slate-800">
          <div className="relative flex items-center">
            <span className="absolute left-3 text-slate-500 text-xs">🔍</span>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索便签标题或正文..."
              className="w-full pl-8 pr-7 py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500"
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

        {/* 便签卡片与文件夹列表 */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
          {/* 文件夹列表 */}
          {folders.map((f) => (
            <div
              key={f.relativePath}
              onClick={() => handleNavigateDir(f.relativePath)}
              className="group p-2.5 rounded-xl border border-slate-800 bg-slate-900 hover:bg-slate-900 hover:border-amber-500 text-xs cursor-pointer transition-all flex items-center justify-between shadow-sm"
            >
              <div className="flex items-center gap-2 truncate flex-1 min-w-0">
                <span className="text-base text-amber-400">📁</span>
                <span className="font-semibold text-slate-200 truncate group-hover:text-amber-300">{f.name}</span>
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

          {filteredNotes.length === 0 && folders.length === 0 ? (
            <div className="text-center py-12 text-slate-500 text-xs">当前目录下暂无便签或文件夹</div>
          ) : (
            filteredNotes.map((note) => {
              const isActive = activeNote ? note.id === activeNote.id : false
              const previewText = note.isEncrypted && note.isLocked
                ? '🔒 此便签已加密保护，输入密码解锁'
                : note.content.trim().slice(0, 50) || '无额外正文...'
              return (
                <div
                  key={note.id}
                  onClick={() => handleSelectNote(note.id)}
                  className={`group p-3 rounded-xl border text-xs cursor-pointer transition-all relative ${
                    isActive
                      ? 'bg-amber-500/15 border-amber-500/40 text-white shadow-sm'
                      : 'bg-slate-900/40 border-slate-800/40 hover:bg-slate-900 hover:border-slate-800 text-slate-400'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-1.5 overflow-hidden">
                      {note.pinned && <span className="text-amber-400 text-xs">📌</span>}
                      {note.isEncrypted && (
                        <span
                          className={`text-[10px] px-1 py-0.2 rounded border font-mono ${
                            note.isLocked
                              ? 'bg-amber-500/15 border-amber-500/30 text-amber-400'
                              : 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400'
                          }`}
                          title={note.isLocked ? '已加密且锁定' : '已加密 (已解锁)'}
                        >
                          {note.isLocked ? '🔒' : '🔓'}
                        </span>
                      )}
                      <span className="font-semibold truncate text-slate-200">{note.title}</span>
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      {note.isEncrypted && !note.isLocked && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            handleLockNote(note.id)
                          }}
                          className="p-1 hover:text-amber-400 text-slate-500"
                          title="立即锁定便签"
                        >
                          🔒
                        </button>
                      )}
                      <button
                        onClick={(e) => togglePin(note.id, e)}
                        className={`p-1 hover:text-amber-400 ${note.pinned ? 'text-amber-400' : 'text-slate-500'}`}
                        title={note.pinned ? '取消置顶' : '置顶便签'}
                      >
                        📌
                      </button>
                      <button
                        onClick={(e) => handleDelete(note.id, e)}
                        className="p-1 hover:text-rose-400 text-slate-500"
                        title="删除便签"
                      >
                        🗑️
                      </button>
                    </div>
                  </div>

                  <p className={`text-[11px] line-clamp-2 leading-relaxed ${note.isEncrypted && note.isLocked ? 'text-amber-400/70 italic' : 'text-slate-500'}`}>
                    {previewText}
                  </p>

                  <div className="flex items-center justify-between text-[10px] text-slate-600 mt-2 font-mono">
                    <span>{note.isEncrypted && note.isLocked ? '加密保护' : `${note.content.length} 字符`}</span>
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
        {activeNote ? (
          <>
            {/* 顶部控制栏 */}
            <div className="h-13 px-4 bg-slate-900 border-b border-slate-800 flex items-center justify-between shrink-0 gap-3">
              {/* 左侧：标题与存盘状态 */}
              <div className="flex items-center gap-2.5 flex-1 min-w-0 mr-2">
                <input
                  type="text"
                  value={activeNote.title}
                  onChange={(e) => updateNote('title', e.target.value)}
                  className="bg-transparent text-sm font-semibold text-slate-100 border-b border-transparent hover:border-slate-700 focus:border-amber-500 focus:outline-none px-1.5 py-1 w-full truncate placeholder-slate-500 transition-colors"
                  placeholder="输入便签标题..."
                />
                {isDiskSaving ? (
                  <span className="text-[11px] text-amber-500 flex items-center gap-1 font-mono shrink-0 whitespace-nowrap select-none">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></span>
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
                <div className="flex items-center bg-slate-800 border border-slate-700 rounded-lg p-0.5 text-xs shrink-0 shadow-xs">
                  <button
                    onClick={() => setFontSize('sm')}
                    className={`px-1.5 py-0.5 rounded text-[11px] font-medium transition-all ${
                      fontSize === 'sm' ? 'bg-slate-900 text-amber-600 font-semibold shadow-xs' : 'text-slate-500 hover:text-slate-800'
                    }`}
                    title="缩小字号"
                  >
                    A-
                  </button>
                  <button
                    onClick={() => setFontSize('base')}
                    className={`px-1.5 py-0.5 rounded text-[11px] font-medium transition-all ${
                      fontSize === 'base' ? 'bg-slate-900 text-amber-600 font-semibold shadow-xs' : 'text-slate-500 hover:text-slate-800'
                    }`}
                    title="标准字号"
                  >
                    A
                  </button>
                  <button
                    onClick={() => setFontSize('lg')}
                    className={`px-1.5 py-0.5 rounded text-[11px] font-medium transition-all ${
                      fontSize === 'lg' ? 'bg-slate-900 text-amber-600 font-semibold shadow-xs' : 'text-slate-500 hover:text-slate-800'
                    }`}
                    title="放大字号"
                  >
                    A+
                  </button>
                  <div className="w-[1px] h-3 bg-slate-700 mx-0.5" />
                  <button
                    onClick={() => setFontFamily(fontFamily === 'sans' ? 'mono' : 'sans')}
                    className={`px-1.5 py-0.5 rounded text-[11px] font-medium transition-all ${
                      fontFamily === 'mono' ? 'bg-slate-900 text-amber-600 font-mono font-semibold shadow-xs' : 'text-slate-500 hover:text-slate-800'
                    }`}
                    title="切换字体 (等宽/无衬线)"
                  >
                    {fontFamily === 'mono' ? '等宽' : '标准'}
                  </button>
                </div>

                {/* 组 2：版本控制与历史快照 */}
                <button
                  onClick={() => setShowHistoryDrawer(true)}
                  className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-700 hover:text-slate-900 border border-slate-700 text-xs flex items-center gap-1.5 font-medium transition-colors shadow-xs"
                  title="打开时间轴版本快照与 Git 变更对比"
                >
                  <span>⏱️</span>
                  <span>历史版本</span>
                </button>

                {/* 组 2.5：密码加密保护 */}
                {activeNote.isEncrypted ? (
                  activeNote.isLocked ? (
                    <div className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-500 text-white text-xs font-medium shadow-xs">
                      <span>🔒</span>
                      <span>已锁定</span>
                    </div>
                  ) : (
                    <div className="flex items-center bg-slate-800 border border-slate-700 rounded-lg p-0.5 text-xs shadow-xs">
                      <button
                        onClick={() => handleLockNote()}
                        className="px-2 py-0.5 rounded text-[11px] text-amber-600 hover:bg-slate-900 font-medium transition-colors flex items-center gap-1"
                        title="立即锁定当前便签 (重新查看需输入密码)"
                      >
                        <span>🔒</span>
                        <span>立即上锁</span>
                      </button>
                      <div className="w-[1px] h-3 bg-slate-700 mx-0.5" />
                      <button
                        onClick={() => {
                          setSecurityTab('remove')
                          setCurrentPassInput('')
                          setNewPassInput('')
                          setConfirmPassInput('')
                          setSecurityModalError(null)
                          setShowSecuritySettingsModal(true)
                        }}
                        className="p-1 rounded text-slate-500 hover:text-slate-800 hover:bg-slate-900 transition-colors"
                        title="加密设置 (修改全局密码 / 解除加密)"
                      >
                        ⚙️
                      </button>
                    </div>
                  )
                ) : (
                  <button
                    onClick={() => {
                      setNewPassword('')
                      setConfirmPassword('')
                      setEncryptModalError(null)
                      setShowEncryptModal(true)
                    }}
                    className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-700 hover:text-slate-900 border border-slate-700 text-xs flex items-center gap-1.5 font-medium transition-colors shadow-xs"
                    title={hasMasterPass ? "使用全局密码加密此便签" : "设置全局密码并开启加密保护"}
                  >
                    <span>🔒</span>
                    <span>开启加密</span>
                  </button>
                )}

                {/* 组 3：置顶与操作 */}
                <div className="flex items-center bg-slate-800 border border-slate-700 rounded-lg p-0.5 text-xs shadow-xs">
                  <button
                    onClick={() => togglePin(activeNote.id)}
                    className={`p-1.5 rounded transition-colors ${
                      activeNote.pinned
                        ? 'bg-slate-900 text-amber-500 shadow-xs'
                        : 'text-slate-500 hover:text-slate-800 hover:bg-slate-900'
                    }`}
                    title={activeNote.pinned ? '已置顶 (点击取消置顶)' : '置顶此便签'}
                  >
                    📌
                  </button>
                  <button
                    onClick={handleCopy}
                    className="p-1.5 rounded text-slate-500 hover:text-slate-800 hover:bg-slate-900 transition-colors"
                    title="复制便签全文"
                  >
                    📋
                  </button>
                  <button
                    onClick={handleExportTxt}
                    className="p-1.5 rounded text-slate-500 hover:text-slate-800 hover:bg-slate-900 transition-colors"
                    title="导出为外部 .txt 文件"
                  >
                    💾
                  </button>
                  <button
                    onClick={handleSaveAs}
                    className="p-1.5 rounded text-slate-500 hover:text-slate-800 hover:bg-slate-900 transition-colors"
                    title="另存为自定义位置..."
                  >
                    📁
                  </button>
                  <button
                    onClick={handleClear}
                    className="p-1.5 rounded text-slate-500 hover:text-rose-600 hover:bg-slate-900 transition-colors"
                    title="清空当前便签正文"
                  >
                    🧹
                  </button>
                </div>
              </div>
            </div>

            {/* 核心文本编辑区 / 密码解锁屏 */}
            {activeNote.isEncrypted && activeNote.isLocked ? (
              <div className="flex-1 flex flex-col items-center justify-center p-6 select-none bg-slate-900">
                <div className="w-full max-w-sm p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl space-y-5 text-center">
                  <div className="w-14 h-14 rounded-2xl bg-amber-500 text-white flex items-center justify-center text-2xl mx-auto shadow">
                    🔒
                  </div>
                  <div className="space-y-1.5">
                    <h3 className="text-base font-bold text-slate-900 tracking-wide">便签已加密锁定</h3>
                    <p className="text-xs text-slate-600 leading-relaxed">
                      此便签「<span className="text-amber-600 font-medium">{activeNote.title}</span>」已启用加密保护，请输入全局访问密码解锁查看。
                    </p>
                  </div>

                  <form
                    onSubmit={(e) => {
                      e.preventDefault()
                      handleUnlockNote()
                    }}
                    className="space-y-3.5 text-left"
                  >
                    <div className="space-y-1.5">
                      <label className="text-[11px] font-medium text-slate-600">全局访问密码</label>
                      <div className="relative">
                        <input
                          type={showUnlockPassword ? 'text' : 'password'}
                          autoFocus
                          value={unlockPassword}
                          onChange={(e) => {
                            setUnlockPassword(e.target.value)
                            setUnlockError(null)
                          }}
                          placeholder="请输入记事本全局访问密码..."
                          className="w-full pl-3 pr-10 py-2 rounded-xl bg-slate-800 border border-slate-700 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-amber-500"
                        />
                        <button
                          type="button"
                          onClick={() => setShowUnlockPassword(!showUnlockPassword)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-700 text-xs"
                          tabIndex={-1}
                        >
                          {showUnlockPassword ? '🙈' : '👁️'}
                        </button>
                      </div>
                    </div>

                    {unlockError && (
                      <div className="text-[11px] text-rose-600 bg-rose-50 border border-rose-200 px-3 py-1.5 rounded-lg flex items-center gap-1.5">
                        <span>⚠️</span>
                        <span>{unlockError}</span>
                      </div>
                    )}

                    <button
                      type="submit"
                      disabled={isUnlocking || !unlockPassword}
                      className="w-full py-2 rounded-xl bg-amber-500 hover:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold shadow transition-all flex items-center justify-center gap-1.5"
                    >
                      {isUnlocking ? (
                        <>
                          <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                          <span>正在校验解密...</span>
                        </>
                      ) : (
                        <>
                          <span>🔓</span>
                          <span>解锁并查看便签</span>
                        </>
                      )}
                    </button>
                  </form>
                </div>
              </div>
            ) : (
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
            )}

            {/* 底部状态栏 */}
            <div className="h-7 px-5 bg-slate-950 border-t border-slate-800 text-[11px] text-slate-500 flex items-center justify-between font-mono shrink-0">
              <div className="flex items-center gap-4">
                {activeNote.isEncrypted && activeNote.isLocked ? (
                  <span className="text-amber-500 flex items-center gap-1.5">
                    <span>🔒</span>
                    <span>便签已锁定保护</span>
                  </span>
                ) : (
                  <>
                    <span>字数: <strong className="text-slate-300">{wordCount}</strong></span>
                    <span>字符数: <strong className="text-slate-300">{charCount}</strong></span>
                    <span>行数: <strong className="text-slate-300">{lineCount}</strong></span>
                  </>
                )}
              </div>
              <div className="flex items-center gap-2">
                {activeNote.isEncrypted ? (
                  <span className="text-amber-400 flex items-center gap-1">
                    <span>🛡️</span>
                    <span>AES-256 加密</span>
                  </span>
                ) : (
                  <>
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
                    <span>实时输入即存</span>
                  </>
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-500 gap-4 select-none p-6">
            <span className="text-5xl">🗒️</span>
            <div className="text-center space-y-1.5">
              <p className="text-sm font-medium text-slate-300">
                {currentDir ? `当前子目录「${currentDir}」下暂无便签` : '当前工作目录下暂无便签'}
              </p>
              <p className="text-xs text-slate-500">点击下方按钮或左上角「新建」创建第一条便签</p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={handleNewNote}
                className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-medium shadow-lg transition-all flex items-center gap-1.5"
              >
                <span>+</span>
                <span>在此目录下新建便签</span>
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
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span className="text-xl">⚙️</span>
                <h3 className="font-bold text-slate-100 text-sm">便签默认保存目录设置</h3>
              </div>
              <button
                onClick={() => setShowDirectoryModal(false)}
                className="text-slate-400 hover:text-slate-200 text-sm p-1"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-slate-400 leading-relaxed">
              新建的便签将自动保存为 <code className="text-amber-500 font-mono">.txt</code> 纯文本文件实时同步到此目录。独立保存在用户本地磁盘，即使应用卸载或升级也绝对不会丢失您的任何便签。
            </p>

            <div className="space-y-1.5">
              <span className="text-[11px] font-medium text-slate-400">当前默认保存目录：</span>
              <div
                onClick={() => {
                  navigator.clipboard.writeText(workspaceDir)
                  showToast('已复制路径到剪贴板')
                }}
                className="p-2.5 rounded-xl bg-slate-800 border border-slate-700 text-xs font-mono text-amber-500 break-all select-all cursor-pointer hover:border-slate-600"
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
                className="flex-1 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-medium shadow transition-all flex items-center justify-center gap-1.5"
              >
                <span>🔄</span>
                <span>更改默认目录</span>
              </button>
            </div>

            <div className="pt-2 border-t border-slate-800 flex items-center justify-between">
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
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-sm w-full p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xl">📁</span>
                <h3 className="font-bold text-slate-100 text-sm">新建文件夹</h3>
              </div>
              <button
                onClick={() => setShowNewFolderModal(false)}
                className="text-slate-400 hover:text-slate-200 text-sm p-1"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-slate-400">
              当前保存位置：<span className="font-mono text-amber-500">{currentDir || '根目录'}</span>
            </p>

            <form onSubmit={handleCreateFolder} className="space-y-4">
              <input
                type="text"
                autoFocus
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                placeholder="输入文件夹名称（例如：工作便签、灵感备忘）..."
                className="w-full px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-amber-500"
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
                  className="px-4 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-xs font-medium shadow transition-colors"
                >
                  确认创建
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 开启密码加密弹窗 */}
      {showEncryptModal && activeNote && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-sm w-full p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xl">🔒</span>
                <h3 className="font-bold text-slate-100 text-sm">
                  {hasMasterPass ? '开启便签加密保护' : '设置全局密码并开启加密'}
                </h3>
              </div>
              <button
                onClick={() => setShowEncryptModal(false)}
                className="text-slate-400 hover:text-slate-200 text-sm p-1"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-slate-400 leading-relaxed">
              {hasMasterPass ? (
                <>
                  将为便签「<span className="text-amber-500 font-medium">{activeNote.title}</span>」开启加密保护。便签内容将使用全局密码通过 <span className="font-mono text-slate-300">AES-256-GCM</span> 强加密保存至外部磁盘文件。
                </>
              ) : (
                <>
                  首次开启加密，请设置记事本的<strong>全局访问密码</strong>。所有加密便签将统一使用此密码进行保护与解锁，请妥善保管。
                </>
              )}
            </p>

            <form onSubmit={handleEnableEncryption} className="space-y-3.5">
              <div className="space-y-1.5">
                <label className="text-[11px] font-medium text-slate-400">
                  {hasMasterPass ? '全局访问密码' : '设置全局访问密码'}
                </label>
                <div className="relative">
                  <input
                    type={showNewPassword ? 'text' : 'password'}
                    autoFocus
                    value={newPassword}
                    onChange={(e) => {
                      setNewPassword(e.target.value)
                      setEncryptModalError(null)
                    }}
                    placeholder={hasMasterPass ? '请输入全局访问密码...' : '请输入全局密码（至少 4 位）...'}
                    className="w-full pl-3 pr-10 py-2 rounded-xl bg-slate-800 border border-slate-700 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-amber-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPassword(!showNewPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 text-xs"
                    tabIndex={-1}
                  >
                    {showNewPassword ? '🙈' : '👁️'}
                  </button>
                </div>
              </div>

              {!hasMasterPass && (
                <div className="space-y-1.5">
                  <label className="text-[11px] font-medium text-slate-400">确认全局密码</label>
                  <input
                    type={showNewPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => {
                      setConfirmPassword(e.target.value)
                      setEncryptModalError(null)
                    }}
                    placeholder="请再次输入全局密码以确认..."
                    className="w-full px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-amber-500"
                  />
                </div>
              )}

              {encryptModalError && (
                <div className="text-[11px] text-rose-600 bg-rose-50 border border-rose-200 px-3 py-1.5 rounded-lg flex items-center gap-1.5">
                  <span>⚠️</span>
                  <span>{encryptModalError}</span>
                </div>
              )}

              <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-[11px] text-amber-500 leading-relaxed">
                💡 记事本采用全局主密码机制与 AES-256 本地硬件级强加密。若忘记密码，密文将无法还原，请务必牢记。
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowEncryptModal(false)}
                  className="px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs transition-colors"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={!newPassword || (!hasMasterPass && !confirmPassword)}
                  className="px-4 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-xs font-semibold shadow transition-colors"
                >
                  {hasMasterPass ? '确认开启加密' : '设置并开启加密'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 便签加密管理弹窗（解除加密 / 修改全局密码） */}
      {showSecuritySettingsModal && activeNote && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-sm w-full p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xl">⚙️</span>
                <h3 className="font-bold text-slate-100 text-sm">记事本加密安全管理</h3>
              </div>
              <button
                onClick={() => setShowSecuritySettingsModal(false)}
                className="text-slate-400 hover:text-slate-200 text-sm p-1"
              >
                ✕
              </button>
            </div>

            {/* 选项卡切换 */}
            <div className="grid grid-cols-2 p-1 bg-slate-800 rounded-xl border border-slate-700 text-xs">
              <button
                type="button"
                onClick={() => {
                  setSecurityTab('remove')
                  setSecurityModalError(null)
                }}
                className={`py-1.5 rounded-lg font-medium transition-all ${
                  securityTab === 'remove'
                    ? 'bg-slate-900 text-amber-600 font-semibold shadow-xs'
                    : 'text-slate-500 hover:text-slate-800 hover:bg-slate-900'
                }`}
              >
                解除当前加密
              </button>
              <button
                type="button"
                onClick={() => {
                  setSecurityTab('change')
                  setSecurityModalError(null)
                }}
                className={`py-1.5 rounded-lg font-medium transition-all ${
                  securityTab === 'change'
                    ? 'bg-slate-900 text-amber-600 font-semibold shadow-xs'
                    : 'text-slate-500 hover:text-slate-800 hover:bg-slate-900'
                }`}
              >
                修改全局密码
              </button>
            </div>

            {securityTab === 'remove' ? (
              <form onSubmit={handleRemoveEncryption} className="space-y-3.5">
                <p className="text-xs text-slate-400 leading-relaxed">
                  解除当前便签「<span className="text-amber-500 font-medium">{activeNote.title}</span>」的加密保护。解除后正文将以普通明文 <code className="text-amber-500 font-mono">.txt</code> 文件形式保存到磁盘，今后无需密码即可直接查看。
                </p>

                <div className="space-y-1.5">
                  <label className="text-[11px] font-medium text-slate-400">全局访问密码</label>
                  <input
                    type="password"
                    autoFocus
                    value={currentPassInput}
                    onChange={(e) => {
                      setCurrentPassInput(e.target.value)
                      setSecurityModalError(null)
                    }}
                    placeholder="请输入记事本全局访问密码..."
                    className="w-full px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-amber-500"
                  />
                </div>

                {securityModalError && (
                  <div className="text-[11px] text-rose-600 bg-rose-50 border border-rose-200 px-3 py-1.5 rounded-lg flex items-center gap-1.5">
                    <span>⚠️</span>
                    <span>{securityModalError}</span>
                  </div>
                )}

                <div className="flex items-center justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowSecuritySettingsModal(false)}
                    className="px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs transition-colors"
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    disabled={!currentPassInput}
                    className="px-4 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white text-xs font-semibold shadow transition-colors"
                  >
                    确认解除加密
                  </button>
                </div>
              </form>
            ) : (
              <form onSubmit={handleChangePassword} className="space-y-3.5">
                <p className="text-xs text-slate-400 leading-relaxed">
                  修改记事本全局访问密码。修改成功后，所有已加密便签将统一自动使用新密码重新加密保存。
                </p>

                <div className="space-y-1.5">
                  <label className="text-[11px] font-medium text-slate-400">原全局访问密码</label>
                  <input
                    type="password"
                    autoFocus
                    value={currentPassInput}
                    onChange={(e) => {
                      setCurrentPassInput(e.target.value)
                      setSecurityModalError(null)
                    }}
                    placeholder="请输入原全局访问密码..."
                    className="w-full px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-amber-500"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[11px] font-medium text-slate-400">新全局访问密码</label>
                  <input
                    type="password"
                    value={newPassInput}
                    onChange={(e) => {
                      setNewPassInput(e.target.value)
                      setSecurityModalError(null)
                    }}
                    placeholder="请输入新全局密码（至少 4 位）..."
                    className="w-full px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-amber-500"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[11px] font-medium text-slate-400">确认新密码</label>
                  <input
                    type="password"
                    value={confirmPassInput}
                    onChange={(e) => {
                      setConfirmPassInput(e.target.value)
                      setSecurityModalError(null)
                    }}
                    placeholder="请再次输入新全局密码..."
                    className="w-full px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-amber-500"
                  />
                </div>

                {securityModalError && (
                  <div className="text-[11px] text-rose-600 bg-rose-50 border border-rose-200 px-3 py-1.5 rounded-lg flex items-center gap-1.5">
                    <span>⚠️</span>
                    <span>{securityModalError}</span>
                  </div>
                )}

                <div className="flex items-center justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowSecuritySettingsModal(false)}
                    className="px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs transition-colors"
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    disabled={!currentPassInput || !newPassInput || !confirmPassInput}
                    className="px-4 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-xs font-semibold shadow transition-colors"
                  >
                    确认更新密码
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* 删除加锁/加密文件与文件夹安全确认弹窗 */}
      {deleteModalTarget && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-sm w-full p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xl">🔒</span>
                <h3 className="font-bold text-slate-100 text-sm">
                  {deleteModalTarget.type === 'folder' ? '删除包含加密便签的文件夹' : '删除加密便签安全验证'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => {
                  setDeleteModalTarget(null)
                  setDeletePassword('')
                  setDeleteError(null)
                }}
                className="text-slate-400 hover:text-slate-200 text-sm p-1"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-slate-400 leading-relaxed">
              {deleteModalTarget.type === 'folder' ? (
                <>
                  文件夹「<span className="text-amber-500 font-medium">{deleteModalTarget.title}</span>」内含有已加锁保护的加密便签。为保障隐私安全，请输入记事本<strong>全局访问密码</strong>确认删除整组文件夹。
                </>
              ) : (
                <>
                  便签「<span className="text-amber-500 font-medium">{deleteModalTarget.title}</span>」已加锁加密保护。为防止误删或未经授权删除，请输入记事本<strong>全局访问密码</strong>确认删除。此操作将永久抹除磁盘文件且无法撤销。
                </>
              )}
            </p>

            <form onSubmit={handleConfirmDeleteWithPassword} className="space-y-3.5">
              <div className="space-y-1.5">
                <label className="text-[11px] font-medium text-slate-400">全局访问密码</label>
                <div className="relative">
                  <input
                    type={showDeletePassword ? 'text' : 'password'}
                    autoFocus
                    value={deletePassword}
                    onChange={(e) => {
                      setDeletePassword(e.target.value)
                      setDeleteError(null)
                    }}
                    placeholder="请输入记事本全局访问密码..."
                    className="w-full pl-3 pr-10 py-2 rounded-xl bg-slate-800 border border-slate-700 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-rose-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowDeletePassword(!showDeletePassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 text-xs"
                    tabIndex={-1}
                  >
                    {showDeletePassword ? '🙈' : '👁️'}
                  </button>
                </div>
              </div>

              {deleteError && (
                <div className="text-[11px] text-rose-600 bg-rose-50 border border-rose-200 px-3 py-1.5 rounded-lg flex items-center gap-1.5">
                  <span>⚠️</span>
                  <span>{deleteError}</span>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setDeleteModalTarget(null)
                    setDeletePassword('')
                    setDeleteError(null)
                  }}
                  className="px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs transition-colors"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={isDeleting || !deletePassword}
                  className="px-4 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white text-xs font-semibold shadow transition-colors flex items-center gap-1"
                >
                  {isDeleting ? (
                    <>
                      <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                      <span>校验并删除...</span>
                    </>
                  ) : (
                    <>
                      <span>🗑️</span>
                      <span>确认永久删除</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 文件版本控制抽屉 */}
      {activeNote && (
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
      )}
    </div>
  )
}
