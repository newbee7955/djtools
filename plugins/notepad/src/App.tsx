import React, { useState, useEffect, useMemo, useRef } from 'react'
import { getSDK, WorkspaceFileItem } from '@doujiao/plugin-sdk'
import { VersionHistoryDrawer } from './components/VersionHistoryDrawer'
import {
  encryptNoteContent,
  decryptNoteContent,
  isEncryptedContent,
  isMasterPasswordSet,
  setupMasterPassword,
  verifyMasterPassword,
  removeMasterPassword
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

  // 全局密码加密与会话状态
  const masterPasswordInSession = useRef<string | null>(null)
  const pendingEncryptNoteIdRef = useRef<string | null>(null)
  const [isMasterUnlocked, setIsMasterUnlocked] = useState<boolean>(false)
  const [hasMasterPass, setHasMasterPass] = useState<boolean>(() => isMasterPasswordSet())
  const [unlockPassword, setUnlockPassword] = useState('')
  const [unlockError, setUnlockError] = useState<string | null>(null)
  const [showUnlockPassword, setShowUnlockPassword] = useState(false)
  const [isUnlocking, setIsUnlocking] = useState(false)

  // 全局主密码首次设置弹窗
  const [showMasterSetupModal, setShowMasterSetupModal] = useState(false)
  const [masterSetupPassword, setMasterSetupPassword] = useState('')
  const [masterSetupConfirm, setMasterSetupConfirm] = useState('')
  const [masterSetupError, setMasterSetupError] = useState<string | null>(null)
  const [showMasterSetupEye, setShowMasterSetupEye] = useState(false)

  // 全局记事本解锁弹窗
  const [showGlobalUnlockModal, setShowGlobalUnlockModal] = useState(false)
  const [globalUnlockInput, setGlobalUnlockInput] = useState('')
  const [globalUnlockError, setGlobalUnlockError] = useState<string | null>(null)
  const [showGlobalUnlockEye, setShowGlobalUnlockEye] = useState(false)
  const [isGlobalUnlocking, setIsGlobalUnlocking] = useState(false)

  // 全局安全管理弹窗状态（修改密码 / 清除密码 / 偏好策略）
  const [showSecuritySettingsModal, setShowSecuritySettingsModal] = useState(false)
  const [securityTab, setSecurityTab] = useState<'change' | 'clear' | 'policy'>('change')
  const [currentPassInput, setCurrentPassInput] = useState('')
  const [newPassInput, setNewPassInput] = useState('')
  const [confirmPassInput, setConfirmPassInput] = useState('')
  const [securityModalError, setSecurityModalError] = useState<string | null>(null)
  const [autoLockOnSwitch, setAutoLockOnSwitch] = useState<boolean>(() => {
    try {
      return localStorage.getItem('doujiao_notepad_autolock') === 'true'
    } catch {
      return false
    }
  })

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
            if (encrypted && masterPasswordInSession.current) {
              try {
                finalContent = await decryptNoteContent(content, masterPasswordInSession.current)
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
            if (encrypted && masterPasswordInSession.current) {
              try {
                finalContent = await decryptNoteContent(content, masterPasswordInSession.current)
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
    if (autoLockOnSwitch && isMasterUnlocked) {
      handleLockAll(true)
    } else if (activeNote && activeNote.isEncrypted && !activeNote.isLocked && masterPasswordInSession.current) {
      const targetName = activeNote.fileName || `${(activeNote.title || '便签').replace(/[\\/:*?"<>|]/g, '_')}.txt`
      encryptNoteContent(activeNote.content, masterPasswordInSession.current).then((c) => {
        getSDK()?.workspace?.writeFile?.(targetName, c, 'notepad')
      }).catch(() => {})
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
      if (isMasterUnlocked && masterPasswordInSession.current) {
        if (!window.confirm(`警告：文件夹 "${folderName}" 内包含加密便签。删除将彻底抹除该文件夹下所有文件，确定要删除吗？`)) {
          return
        }
        await executeDeleteFolder(folderRelPath, folderName)
        showToast(`已删除文件夹「${folderName}」🗑️`)
        return
      }

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
            const pass = masterPasswordInSession.current
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
            const pass = masterPasswordInSession.current
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

  // 立即锁定全部加密便签并密文存盘，退出解锁会话
  const handleLockAll = async (silent = false) => {
    const pass = masterPasswordInSession.current
    const sdk = getSDK()

    const updated = await Promise.all(
      notes.map(async (n) => {
        if (n.isEncrypted && !n.isLocked) {
          if (pass) {
            try {
              const cipher = await encryptNoteContent(n.content, pass)
              const targetName = n.fileName || `${(n.title || '便签').replace(/[\\/:*?"<>|]/g, '_')}.txt`
              if (sdk?.workspace) {
                await sdk.workspace.writeFile(targetName, cipher, 'notepad')
                if (sdk.workspace.history) {
                  await sdk.workspace.history.saveSnapshot('notepad', targetName, cipher, 'auto', '锁定存盘')
                }
              }
              return { ...n, content: cipher, isLocked: true }
            } catch (err) {
              console.error('锁定加密存盘失败:', err)
              return { ...n, isLocked: true }
            }
          }
          return { ...n, isLocked: true }
        }
        return n
      })
    )

    setNotes(updated)
    masterPasswordInSession.current = null
    setIsMasterUnlocked(false)
    if (!silent) {
      showToast('已锁定全部加密便签 🔒')
    }
  }

  // 立即锁定当前加密便签并密文存盘
  const handleLockNote = async (targetId?: string, silent = false) => {
    await handleLockAll(silent)
  }

  // 从外部磁盘打开文件
  const handleOpenFile = async () => {
    try {
      if (autoLockOnSwitch && isMasterUnlocked) {
        await handleLockAll(true)
      }
      const sdk = getSDK()
      if (sdk?.workspace?.selectFileToOpen) {
        const res = await sdk.workspace.selectFileToOpen(['txt', 'log', 'md'])
        if (!res.canceled && res.content !== undefined && res.fileName) {
          const title = res.fileName.replace(/\.(txt|log|md)$/i, '')
          const encrypted = isEncryptedContent(res.content)
          let finalContent = res.content
          let locked = encrypted
          if (encrypted && masterPasswordInSession.current) {
            try {
              finalContent = await decryptNoteContent(res.content, masterPasswordInSession.current)
              locked = false
            } catch {
              locked = true
            }
          }

          const existing = notes.find((n) => n.title === title || n.fileName === res.fileName)
          if (existing) {
            if (existing.isEncrypted && existing.isLocked) {
              showToast('该文件已在列表中，请先输入全局密码解锁')
            } else {
              updateNote('content', finalContent)
              showToast(`已载入文件: ${res.fileName}`)
            }
            setActiveNoteId(existing.id)
          } else {
            const newNote: Note = {
              id: res.fileName,
              fileName: res.fileName,
              title,
              content: finalContent,
              pinned: false,
              updatedAt: Date.now(),
              isEncrypted: encrypted,
              isLocked: locked
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

  // 选择切换便签（全局解锁态下无缝浏览编辑，不频繁重新锁闭）
  const handleSelectNote = async (id: string) => {
    if (id === activeNoteId) return

    // 如果开启了极端隐私策略（切换便签即锁），则锁定全部
    if (autoLockOnSwitch && isMasterUnlocked) {
      await handleLockAll(true)
    } else {
      // 保持会话解锁态：自动将当前便签改动加密写盘
      if (activeNote && activeNote.isEncrypted && !activeNote.isLocked && masterPasswordInSession.current) {
        try {
          const cipher = await encryptNoteContent(activeNote.content, masterPasswordInSession.current)
          const sdk = getSDK()
          if (sdk?.workspace) {
            const targetName = activeNote.fileName || `${(activeNote.title || '便签').replace(/[\\/:*?"<>|]/g, '_')}.txt`
            await sdk.workspace.writeFile(targetName, cipher, 'notepad')
          }
        } catch {}
      }
    }

    // 目标便签若已加密但处于加锁态，且当前会话已有全局主密码，自动予以平滑解密
    const targetNote = notes.find((n) => n.id === id)
    if (targetNote && targetNote.isEncrypted && targetNote.isLocked && masterPasswordInSession.current) {
      try {
        const plain = await decryptNoteContent(targetNote.content, masterPasswordInSession.current)
        setNotes((prev) =>
          prev.map((n) => (n.id === id ? { ...n, content: plain, isLocked: false } : n))
        )
      } catch {}
    }

    setActiveNoteId(id)
    setUnlockPassword('')
    setUnlockError(null)
  }

  // 新建笔记（支持在当前子目录新建）
  const handleNewNote = async () => {
    if (autoLockOnSwitch && isMasterUnlocked) {
      await handleLockAll(true)
    } else if (activeNote && activeNote.isEncrypted && !activeNote.isLocked && masterPasswordInSession.current) {
      const targetName = activeNote.fileName || `${(activeNote.title || '便签').replace(/[\\/:*?"<>|]/g, '_')}.txt`
      try {
        const cipher = await encryptNoteContent(activeNote.content, masterPasswordInSession.current)
        await getSDK()?.workspace?.writeFile?.(targetName, cipher, 'notepad')
      } catch {}
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

    // 如果文件已加锁/加密保护
    if (noteToDelete.isEncrypted) {
      if (isMasterUnlocked && masterPasswordInSession.current) {
        const title = noteToDelete.title || noteToDelete.fileName || '该加密便签'
        if (!window.confirm(`确定要永久删除加密便签 "${title}" 吗？此操作将彻底从磁盘抹除物理文件且无法撤销。`)) {
          return
        }
        await executeDeleteNote(id)
        showToast(`已删除加密便签「${title}」🗑️`)
        return
      }

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

  // 使用全局主密码解锁整个记事本（批量解密所有受保护便签）
  const handleUnlockWithMasterPassword = async (pass: string): Promise<boolean> => {
    const trimmed = pass.trim()
    if (!trimmed) {
      return false
    }

    let isValid = false
    if (isMasterPasswordSet()) {
      isValid = await verifyMasterPassword(trimmed)
    } else {
      await setupMasterPassword(trimmed)
      setHasMasterPass(true)
      isValid = true
    }

    // 容错：若校验未通过，尝试用输入密码解密当前活动便签
    if (!isValid && activeNote && isEncryptedContent(activeNote.content)) {
      try {
        await decryptNoteContent(activeNote.content, trimmed)
        isValid = true
        await setupMasterPassword(trimmed)
        setHasMasterPass(true)
      } catch {}
    }

    if (!isValid) {
      return false
    }

    masterPasswordInSession.current = trimmed
    setIsMasterUnlocked(true)

    // 批量解密内存中当前所有已加锁加密便签
    const updated = await Promise.all(
      notes.map(async (n) => {
        if (n.isEncrypted && n.isLocked) {
          try {
            const plain = await decryptNoteContent(n.content, trimmed)
            return { ...n, content: plain, isLocked: false }
          } catch {
            return n
          }
        }
        return n
      })
    )
    setNotes(updated)

    // 若有等待加密的便签挂起
    if (pendingEncryptNoteIdRef.current) {
      const targetId = pendingEncryptNoteIdRef.current
      pendingEncryptNoteIdRef.current = null
      const targetNote = updated.find((n) => n.id === targetId)
      if (targetNote && !targetNote.isEncrypted) {
        try {
          const cipher = await encryptNoteContent(targetNote.content, trimmed)
          const sdk = getSDK()
          if (sdk?.workspace) {
            const targetName = targetNote.fileName || `${(targetNote.title || '便签').replace(/[\\/:*?"<>|]/g, '_')}.txt`
            await sdk.workspace.writeFile(targetName, cipher, 'notepad')
            if (sdk.workspace.history) {
              await sdk.workspace.history.saveSnapshot('notepad', targetName, cipher, 'auto', '开启全局密码加密')
            }
          }
          setNotes((prev) =>
            prev.map((n) =>
              n.id === targetId ? { ...n, isEncrypted: true, isLocked: false } : n
            )
          )
          showToast(`已使用全局密码为「${targetNote.title}」开启加密 🔒`)
        } catch (err: any) {
          console.error('开启加密失败:', err)
        }
      }
    }

    showToast('记事本已解锁 🔓')
    return true
  }

  // 解锁当前便签（在便签锁定卡片中输入全局密码）
  const handleUnlockNote = async () => {
    if (!activeNote) return
    const pass = unlockPassword.trim()
    if (!pass) {
      setUnlockError('请输入全局访问密码')
      return
    }
    setIsUnlocking(true)
    setUnlockError(null)

    const ok = await handleUnlockWithMasterPassword(pass)
    setIsUnlocking(false)
    if (ok) {
      setUnlockPassword('')
    } else {
      setUnlockError('全局访问密码错误，无法解锁便签')
    }
  }

  // 为当前便签开启加密保护（统一使用全局主密码，已解锁时一键直接加密，无需重复输密）
  const handleEnableEncryptionForActiveNote = async () => {
    if (!activeNote) return

    // 1. 若尚未设置全局主密码：唤起全局主密码首次设置弹窗
    if (!isMasterPasswordSet()) {
      pendingEncryptNoteIdRef.current = activeNote.id
      setMasterSetupPassword('')
      setMasterSetupConfirm('')
      setMasterSetupError(null)
      setShowMasterSetupModal(true)
      return
    }

    // 2. 若已设置且当前会话已解锁：一键直接加密存盘，无需弹出任何密码输入框！
    if (masterPasswordInSession.current) {
      const pass = masterPasswordInSession.current
      try {
        const cipher = await encryptNoteContent(activeNote.content, pass)
        const sdk = getSDK()
        if (sdk?.workspace) {
          const targetName = activeNote.fileName || `${(activeNote.title || '便签').replace(/[\\/:*?"<>|]/g, '_')}.txt`
          await sdk.workspace.writeFile(targetName, cipher, 'notepad')
          if (sdk.workspace.history) {
            await sdk.workspace.history.saveSnapshot('notepad', targetName, cipher, 'auto', '开启全局密码加密')
          }
        }
        setNotes((prev) =>
          prev.map((n) =>
            n.id === activeNote.id
              ? { ...n, isEncrypted: true, isLocked: false }
              : n
          )
        )
        showToast('已使用全局主密码为此便签开启加密保护 🔒')
      } catch (err: any) {
        showToast('加密失败: ' + (err?.message || '未知错误'))
      }
      return
    }

    // 3. 若已设置但当前处于锁定状态：提示输入全局密码解锁并为当前便签开启加密
    pendingEncryptNoteIdRef.current = activeNote.id
    setGlobalUnlockInput('')
    setGlobalUnlockError(null)
    setShowGlobalUnlockModal(true)
  }

  // 解除当前便签加密保护（恢复为普通未加密文本）
  const handleRemoveEncryptionForActiveNote = async () => {
    if (!activeNote || !activeNote.isEncrypted) return
    if (!window.confirm(`确定要解除便签「${activeNote.title}」的加密保护吗？\n解除后正文将以普通文本 .txt 文件形式存盘，无需密码即可查看。`)) {
      return
    }

    try {
      let plainText = activeNote.content
      if (activeNote.isLocked && masterPasswordInSession.current) {
        plainText = await decryptNoteContent(activeNote.content, masterPasswordInSession.current)
      }
      const sdk = getSDK()
      if (sdk?.workspace) {
        const targetName = activeNote.fileName || `${(activeNote.title || '便签').replace(/[\\/:*?"<>|]/g, '_')}.txt`
        await sdk.workspace.writeFile(targetName, plainText, 'notepad')
        if (sdk.workspace.history) {
          await sdk.workspace.history.saveSnapshot('notepad', targetName, plainText, 'auto', '解除加密保护')
        }
      }
      setNotes((prev) =>
        prev.map((n) =>
          n.id === activeNote.id
            ? { ...n, content: plainText, isEncrypted: false, isLocked: false }
            : n
        )
      )
      showToast('已解除便签加密，恢复为普通文本 🔓')
    } catch (err: any) {
      showToast('解除加密失败: ' + (err?.message || '未知错误'))
    }
  }

  // 首次设置全局主密码表单提交
  const handleMasterSetupSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const pass = masterSetupPassword.trim()
    const conf = masterSetupConfirm.trim()

    if (!pass || pass.length < 4) {
      setMasterSetupError('全局主密码长度不能少于 4 位')
      return
    }
    if (pass !== conf) {
      setMasterSetupError('两次输入的密码不一致')
      return
    }

    try {
      await setupMasterPassword(pass)
      setHasMasterPass(true)
      masterPasswordInSession.current = pass
      setIsMasterUnlocked(true)

      // 若有待加密便签
      if (pendingEncryptNoteIdRef.current) {
        const targetId = pendingEncryptNoteIdRef.current
        pendingEncryptNoteIdRef.current = null
        const targetNote = notes.find((n) => n.id === targetId)
        if (targetNote) {
          const cipher = await encryptNoteContent(targetNote.content, pass)
          const sdk = getSDK()
          if (sdk?.workspace) {
            const targetName = targetNote.fileName || `${(targetNote.title || '便签').replace(/[\\/:*?"<>|]/g, '_')}.txt`
            await sdk.workspace.writeFile(targetName, cipher, 'notepad')
            if (sdk.workspace.history) {
              await sdk.workspace.history.saveSnapshot('notepad', targetName, cipher, 'auto', '设置全局主密码并加密')
            }
          }
          setNotes((prev) =>
            prev.map((n) =>
              n.id === targetId ? { ...n, isEncrypted: true, isLocked: false } : n
            )
          )
          showToast(`已设置全局主密码，并为「${targetNote.title}」开启加密 🔒`)
        }
      } else {
        showToast('已成功设置记事本全局主密码 🔑')
      }

      setShowMasterSetupModal(false)
      setMasterSetupPassword('')
      setMasterSetupConfirm('')
      setMasterSetupError(null)
    } catch (err: any) {
      setMasterSetupError(`设置密码失败: ${err?.message || '未知错误'}`)
    }
  }

  // 全局解锁表单提交
  const handleGlobalUnlockSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsGlobalUnlocking(true)
    setGlobalUnlockError(null)

    const ok = await handleUnlockWithMasterPassword(globalUnlockInput)
    setIsGlobalUnlocking(false)
    if (ok) {
      setShowGlobalUnlockModal(false)
      setGlobalUnlockInput('')
    } else {
      setGlobalUnlockError('全局访问密码错误，无法解锁')
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
      setIsMasterUnlocked(true)

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

          updatedNotes.push({
            ...n,
            content: plainText,
            isLocked: false
          })
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

  // 清除全局主密码并全部解密为普通文本
  const handleClearMasterPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!currentPassInput) {
      setSecurityModalError('请输入当前全局访问密码')
      return
    }
    const isValid = await verifyMasterPassword(currentPassInput)
    if (!isValid) {
      setSecurityModalError('当前全局访问密码错误')
      return
    }

    if (!window.confirm('警告：此操作将清除全局主密码，并将所有已加密便签批量解密为普通明文文件存盘。是否确定继续？')) {
      return
    }

    try {
      const sdk = getSDK()
      const updatedNotes: Note[] = []

      for (const n of notes) {
        if (!n.isEncrypted) {
          updatedNotes.push(n)
          continue
        }

        let plainText = n.content
        if (n.isLocked) {
          try {
            plainText = await decryptNoteContent(n.content, currentPassInput)
          } catch {
            plainText = n.content
          }
        }

        const targetName = n.fileName || `${(n.title || '便签').replace(/[\\/:*?"<>|]/g, '_')}.txt`
        if (sdk?.workspace) {
          await sdk.workspace.writeFile(targetName, plainText, 'notepad')
          if (sdk.workspace.history) {
            await sdk.workspace.history.saveSnapshot('notepad', targetName, plainText, 'auto', '清除全局密码批量解密')
          }
        }

        updatedNotes.push({
          ...n,
          content: plainText,
          isEncrypted: false,
          isLocked: false
        })
      }

      removeMasterPassword()
      setHasMasterPass(false)
      setIsMasterUnlocked(false)
      masterPasswordInSession.current = null
      setNotes(updatedNotes)
      setShowSecuritySettingsModal(false)
      setCurrentPassInput('')
      showToast('已清除全局主密码，所有便签已还原为普通文本 🔓')
    } catch (err: any) {
      setSecurityModalError(`清除全局密码失败: ${err?.message || '未知错误'}`)
    }
  }

  // 切换自动锁定策略
  const handleToggleAutoLock = (enabled: boolean) => {
    setAutoLockOnSwitch(enabled)
    try {
      localStorage.setItem('doujiao_notepad_autolock', String(enabled))
    } catch {}
    showToast(enabled ? '已开启切换便签时自动锁定' : '已关闭切换自动锁定（保持会话解锁）')
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
        {/* 标题栏与新建/打开/全局锁按钮 */}
        <div className="p-3 border-b border-slate-800 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <span className="text-xl">🗒️</span>
              <div>
                <span className="font-semibold text-xs text-slate-200">轻便记事本</span>
                <span className="text-[10px] ml-1.5 px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 font-mono">
                  {notes.length} 条
                </span>
              </div>
            </div>

            {/* 全局主密码锁状态与控制 */}
            {!hasMasterPass ? (
              <button
                onClick={() => {
                  setMasterSetupPassword('')
                  setMasterSetupConfirm('')
                  setMasterSetupError(null)
                  setShowMasterSetupModal(true)
                }}
                className="px-2 py-0.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-amber-400 border border-slate-700 text-[10px] flex items-center gap-1 transition-colors"
                title="设置记事本全局主密码（只需设置一次，全部加密便签通用）"
              >
                <span>🔐</span>
                <span>设置全局密码</span>
              </button>
            ) : isMasterUnlocked ? (
              <div className="flex items-center gap-1">
                <button
                  onClick={() => handleLockAll()}
                  className="px-2 py-0.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-[10px] flex items-center gap-1 transition-colors font-medium"
                  title="记事本已解锁，点击一键锁定全部加密便签"
                >
                  <span>🔓</span>
                  <span>已解锁 (锁定全部)</span>
                </button>
                <button
                  onClick={() => {
                    setSecurityTab('change')
                    setCurrentPassInput('')
                    setNewPassInput('')
                    setConfirmPassInput('')
                    setSecurityModalError(null)
                    setShowSecuritySettingsModal(true)
                  }}
                  className="p-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 border border-slate-700 text-[10px] transition-colors"
                  title="全局密码管理 (修改密码 / 清除密码 / 策略)"
                >
                  ⚙️
                </button>
              </div>
            ) : (
              <button
                onClick={() => {
                  setGlobalUnlockInput('')
                  setGlobalUnlockError(null)
                  setShowGlobalUnlockModal(true)
                }}
                className="px-2 py-0.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/30 text-[10px] flex items-center gap-1 transition-colors font-medium"
                title="记事本已锁定，点击输入全局密码解锁全部加密便签"
              >
                <span>🔒</span>
                <span>已加锁 (点击解锁)</span>
              </button>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={() => {
                setNewFolderName('')
                setShowNewFolderModal(true)
              }}
              className="flex-1 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs flex items-center justify-center gap-1 transition-colors"
              title="在当前位置新建文件夹"
            >
              <span>📁+</span>
              <span>新建目录</span>
            </button>
            <button
              onClick={handleOpenFile}
              className="flex-1 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs flex items-center justify-center gap-1 transition-colors"
              title="从外部磁盘打开文本文件..."
            >
              <span>📂 打开</span>
            </button>
            <button
              onClick={handleNewNote}
              className="flex-1 py-1 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs flex items-center justify-center gap-1 shadow transition-colors font-medium"
              title="新建便签"
            >
              <span>+</span>
              <span>新建便签</span>
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
                      <span>已加锁</span>
                    </div>
                  ) : (
                    <div className="flex items-center bg-slate-800 border border-slate-700 rounded-lg p-0.5 text-xs shadow-xs">
                      <span className="px-2 py-0.5 text-[11px] text-amber-500 font-medium flex items-center gap-1 select-none">
                        <span>🔒</span>
                        <span>加密保护</span>
                      </span>
                      <div className="w-[1px] h-3 bg-slate-700 mx-0.5" />
                      <button
                        onClick={handleRemoveEncryptionForActiveNote}
                        className="px-2 py-0.5 rounded text-[11px] text-slate-300 hover:text-rose-400 hover:bg-slate-900 transition-colors"
                        title="解除此便签的加密保护（恢复为普通未加密文本）"
                      >
                        🔓 解除加密
                      </button>
                      <div className="w-[1px] h-3 bg-slate-700 mx-0.5" />
                      <button
                        onClick={() => handleLockAll()}
                        className="px-2 py-0.5 rounded text-[11px] text-amber-500 hover:bg-slate-900 font-medium transition-colors"
                        title="立即锁定全部加密便签"
                      >
                        🔒 锁定全部
                      </button>
                      <div className="w-[1px] h-3 bg-slate-700 mx-0.5" />
                      <button
                        onClick={() => {
                          setSecurityTab('change')
                          setCurrentPassInput('')
                          setNewPassInput('')
                          setConfirmPassInput('')
                          setSecurityModalError(null)
                          setShowSecuritySettingsModal(true)
                        }}
                        className="p-1 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-900 transition-colors"
                        title="全局密码管理 (修改密码 / 清除密码 / 策略)"
                      >
                        ⚙️
                      </button>
                    </div>
                  )
                ) : (
                  <button
                    onClick={handleEnableEncryptionForActiveNote}
                    className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white border border-slate-700 text-xs flex items-center gap-1.5 font-medium transition-colors shadow-xs"
                    title={hasMasterPass ? "使用记事本全局主密码为此便签开启加密" : "设置全局密码并开启加密保护"}
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
                    <h3 className="text-base font-bold text-slate-900 tracking-wide">便签已受全局密码保护</h3>
                    <p className="text-xs text-slate-600 leading-relaxed">
                      便签「<span className="text-amber-600 font-medium">{activeNote.title}</span>」已加锁。输入全局主密码即可一键解锁记事本全部加密便签。
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
                          <span>解锁记事本全部便签</span>
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

      {/* 首次设置全局主密码弹窗 */}
      {showMasterSetupModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-sm w-full p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xl">🔑</span>
                <h3 className="font-bold text-slate-100 text-sm">设置记事本全局主密码</h3>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowMasterSetupModal(false)
                  setMasterSetupPassword('')
                  setMasterSetupConfirm('')
                  setMasterSetupError(null)
                  pendingEncryptNoteIdRef.current = null
                }}
                className="text-slate-400 hover:text-slate-200 text-sm p-1"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-slate-400 leading-relaxed">
              记事本采用<strong>全局主密码机制</strong>。您只需设置一次，所有加密便签统一使用该密码保护；在会话中解锁一次，即可无缝查看和编辑所有加密便签。
            </p>

            <form onSubmit={handleMasterSetupSubmit} className="space-y-3.5">
              <div className="space-y-1.5">
                <label className="text-[11px] font-medium text-slate-400">设置全局主密码</label>
                <div className="relative">
                  <input
                    type={showMasterSetupEye ? 'text' : 'password'}
                    autoFocus
                    value={masterSetupPassword}
                    onChange={(e) => {
                      setMasterSetupPassword(e.target.value)
                      setMasterSetupError(null)
                    }}
                    placeholder="请输入全局主密码（至少 4 位）..."
                    className="w-full pl-3 pr-10 py-2 rounded-xl bg-slate-800 border border-slate-700 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-amber-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowMasterSetupEye(!showMasterSetupEye)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 text-xs"
                    tabIndex={-1}
                  >
                    {showMasterSetupEye ? '🙈' : '👁️'}
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-medium text-slate-400">确认主密码</label>
                <input
                  type={showMasterSetupEye ? 'text' : 'password'}
                  value={masterSetupConfirm}
                  onChange={(e) => {
                    setMasterSetupConfirm(e.target.value)
                    setMasterSetupError(null)
                  }}
                  placeholder="请再次输入全局主密码..."
                  className="w-full px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-amber-500"
                />
              </div>

              {masterSetupError && (
                <div className="text-[11px] text-rose-400 bg-rose-500/10 border border-rose-500/20 px-3 py-1.5 rounded-lg flex items-center gap-1.5">
                  <span>⚠️</span>
                  <span>{masterSetupError}</span>
                </div>
              )}

              <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-[11px] text-amber-500 leading-relaxed">
                💡 本地硬件级 AES-256-GCM 强加密保护，密码仅保存在本地安全验证区。若遗忘密码将无法恢复密文，请妥善记牢！
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowMasterSetupModal(false)
                    setMasterSetupPassword('')
                    setMasterSetupConfirm('')
                    setMasterSetupError(null)
                    pendingEncryptNoteIdRef.current = null
                  }}
                  className="px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs transition-colors"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={!masterSetupPassword || !masterSetupConfirm}
                  className="px-4 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-xs font-semibold shadow transition-colors"
                >
                  确认设置
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 解锁记事本全部便签弹窗 */}
      {showGlobalUnlockModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-sm w-full p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xl">🔓</span>
                <h3 className="font-bold text-slate-100 text-sm">解锁记事本全部便签</h3>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowGlobalUnlockModal(false)
                  setGlobalUnlockInput('')
                  setGlobalUnlockError(null)
                  pendingEncryptNoteIdRef.current = null
                }}
                className="text-slate-400 hover:text-slate-200 text-sm p-1"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-slate-400 leading-relaxed">
              输入记事本<strong>全局访问密码</strong>，即可一键解锁记事本内的全部加密便签，本次会话期间畅享查看与编辑。
            </p>

            <form onSubmit={handleGlobalUnlockSubmit} className="space-y-3.5">
              <div className="space-y-1.5">
                <label className="text-[11px] font-medium text-slate-400">全局访问密码</label>
                <div className="relative">
                  <input
                    type={showGlobalUnlockEye ? 'text' : 'password'}
                    autoFocus
                    value={globalUnlockInput}
                    onChange={(e) => {
                      setGlobalUnlockInput(e.target.value)
                      setGlobalUnlockError(null)
                    }}
                    placeholder="请输入全局访问密码..."
                    className="w-full pl-3 pr-10 py-2 rounded-xl bg-slate-800 border border-slate-700 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-amber-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowGlobalUnlockEye(!showGlobalUnlockEye)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 text-xs"
                    tabIndex={-1}
                  >
                    {showGlobalUnlockEye ? '🙈' : '👁️'}
                  </button>
                </div>
              </div>

              {globalUnlockError && (
                <div className="text-[11px] text-rose-400 bg-rose-500/10 border border-rose-500/20 px-3 py-1.5 rounded-lg flex items-center gap-1.5">
                  <span>⚠️</span>
                  <span>{globalUnlockError}</span>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowGlobalUnlockModal(false)
                    setGlobalUnlockInput('')
                    setGlobalUnlockError(null)
                    pendingEncryptNoteIdRef.current = null
                  }}
                  className="px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs transition-colors"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={!globalUnlockInput || isGlobalUnlocking}
                  className="px-4 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-xs font-semibold shadow transition-colors"
                >
                  {isGlobalUnlocking ? '验证中...' : '确认解锁'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 记事本全局密码与安全管理弹窗 */}
      {showSecuritySettingsModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-sm w-full p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xl">⚙️</span>
                <h3 className="font-bold text-slate-100 text-sm">记事本安全管理</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowSecuritySettingsModal(false)}
                className="text-slate-400 hover:text-slate-200 text-sm p-1"
              >
                ✕
              </button>
            </div>

            {/* 选项卡切换 */}
            <div className="grid grid-cols-3 p-1 bg-slate-800 rounded-xl border border-slate-700 text-xs">
              <button
                type="button"
                onClick={() => {
                  setSecurityTab('change')
                  setSecurityModalError(null)
                }}
                className={`py-1.5 rounded-lg font-medium transition-all ${
                  securityTab === 'change'
                    ? 'bg-slate-900 text-amber-500 font-semibold shadow-xs'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                修改主密码
              </button>
              <button
                type="button"
                onClick={() => {
                  setSecurityTab('clear')
                  setSecurityModalError(null)
                }}
                className={`py-1.5 rounded-lg font-medium transition-all ${
                  securityTab === 'clear'
                    ? 'bg-slate-900 text-amber-500 font-semibold shadow-xs'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                清除主密码
              </button>
              <button
                type="button"
                onClick={() => {
                  setSecurityTab('policy')
                  setSecurityModalError(null)
                }}
                className={`py-1.5 rounded-lg font-medium transition-all ${
                  securityTab === 'policy'
                    ? 'bg-slate-900 text-amber-500 font-semibold shadow-xs'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                安全策略
              </button>
            </div>

            {/* 修改全局密码 */}
            {securityTab === 'change' && (
              <form onSubmit={handleChangePassword} className="space-y-3.5">
                <p className="text-xs text-slate-400 leading-relaxed">
                  修改记事本全局主密码。修改成功后，所有已加密便签将统一自动使用新密码重新加密保存。
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
                  <div className="text-[11px] text-rose-400 bg-rose-500/10 border border-rose-500/20 px-3 py-1.5 rounded-lg flex items-center gap-1.5">
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

            {/* 清除全局密码并全部解密 */}
            {securityTab === 'clear' && (
              <form onSubmit={handleClearMasterPassword} className="space-y-3.5">
                <p className="text-xs text-slate-400 leading-relaxed">
                  清除全局主密码并将所有已加密便签<strong>批量解密为普通明文 .txt</strong> 文件存盘。后续打开记事本不再需要密码。
                </p>

                <div className="p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-[11px] text-rose-400 leading-relaxed">
                  ⚠️ 警告：此操作不可逆！解密后所有便签将以纯文本形式保存在外部磁盘上。
                </div>

                <div className="space-y-1.5">
                  <label className="text-[11px] font-medium text-slate-400">当前全局访问密码</label>
                  <input
                    type="password"
                    autoFocus
                    value={currentPassInput}
                    onChange={(e) => {
                      setCurrentPassInput(e.target.value)
                      setSecurityModalError(null)
                    }}
                    placeholder="请输入当前全局访问密码进行安全确认..."
                    className="w-full px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-amber-500"
                  />
                </div>

                {securityModalError && (
                  <div className="text-[11px] text-rose-400 bg-rose-500/10 border border-rose-500/20 px-3 py-1.5 rounded-lg flex items-center gap-1.5">
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
                    确认清除密码并批量解密
                  </button>
                </div>
              </form>
            )}

            {/* 安全锁定策略 */}
            {securityTab === 'policy' && (
              <div className="space-y-4">
                <p className="text-xs text-slate-400 leading-relaxed">
                  自定义记事本的安全锁定行为，平衡日常便捷性与隐私防护需求。
                </p>

                <div className="p-3 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-between gap-3">
                  <div className="space-y-0.5">
                    <div className="text-xs font-medium text-slate-200">切换便签时自动锁定</div>
                    <div className="text-[11px] text-slate-400 leading-relaxed">
                      {autoLockOnSwitch
                        ? '已开启：每次点击切换查看其他便签时，立即重新上锁并清除内存密码。'
                        : '已关闭（推荐）：解锁一次后，在当前会话中切换不同便签无缝查看，无需反复输入密码。'}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleToggleAutoLock(!autoLockOnSwitch)}
                    className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                      autoLockOnSwitch ? 'bg-amber-600' : 'bg-slate-700'
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                        autoLockOnSwitch ? 'translate-x-4' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>

                <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-[11px] text-amber-500 leading-relaxed">
                  💡 关闭自动锁定不会降低文件安全性：磁盘上的便签文件始终由 AES-256 硬件级强加密保存，且支持随时在顶部或工具栏一键「锁定全部」。
                </div>

                <div className="flex items-center justify-end pt-2">
                  <button
                    type="button"
                    onClick={() => setShowSecuritySettingsModal(false)}
                    className="px-4 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 hover:text-white transition-colors"
                  >
                    完成
                  </button>
                </div>
              </div>
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
