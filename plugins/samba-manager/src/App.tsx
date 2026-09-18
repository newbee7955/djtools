import React, { useState, useEffect, useRef, useMemo } from 'react'
import type {
  SambaProfile,
  SambaConfig,
  SambaFileItem,
  SambaTransferProgress
} from '@doujiao/plugin-sdk'

// 辅助格式化
function formatBytes(bytes: number): string {
  if (!bytes || bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

function formatDate(timestamp: number): string {
  if (!timestamp) return '-'
  const d = new Date(timestamp)
  return d.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function getFileIcon(item: SambaFileItem): { icon: string; color: string } {
  if (item.isDirectory) {
    return { icon: '📁', color: 'text-amber-400' }
  }
  const ext = item.extension.toLowerCase()
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'].includes(ext)) {
    return { icon: '🖼️', color: 'text-sky-400' }
  }
  if (['mp4', 'mkv', 'mov', 'avi', 'webm', 'flv', 'wmv'].includes(ext)) {
    return { icon: '🎬', color: 'text-rose-400' }
  }
  if (['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a'].includes(ext)) {
    return { icon: '🎵', color: 'text-emerald-400' }
  }
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) {
    return { icon: '📦', color: 'text-amber-500' }
  }
  if (['pdf', 'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx'].includes(ext)) {
    return { icon: '📄', color: 'text-indigo-400' }
  }
  if (['txt', 'md', 'json', 'js', 'ts', 'html', 'css', 'log', 'csv', 'yml', 'xml', 'py', 'sh'].includes(ext)) {
    return { icon: '📝', color: 'text-teal-400' }
  }
  return { icon: '📃', color: 'text-slate-400' }
}

export default function App(): JSX.Element {
  const sdk = window.doujiaoSDK?.samba

  // 连接预设
  const [profiles, setProfiles] = useState<SambaProfile[]>([])
  const [activeProfileId, setActiveProfileId] = useState<string>('')
  const [connecting, setConnecting] = useState(false)
  const [connectionStatus, setConnectionStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected')

  // 文件列表与路径导航
  const [currentPath, setCurrentPath] = useState<string>('')
  const [fileList, setFileList] = useState<SambaFileItem[]>([])
  const [loadingFiles, setLoadingFiles] = useState<boolean>(false)
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [sortBy, setSortBy] = useState<'name' | 'size' | 'mtime'>('name')
  const [sortAsc, setSortAsc] = useState<boolean>(true)

  // 缩略图缓存 (path -> dataUrl)
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({})
  const loadingThumbsRef = useRef<Set<string>>(new Set())

  // 传输进度
  const [transfers, setTransfers] = useState<SambaTransferProgress[]>([])
  const [showTransferDrawer, setShowTransferDrawer] = useState<boolean>(false)

  // 弹窗状态
  const [showProfileModal, setShowProfileModal] = useState<boolean>(false)
  const [editingProfile, setEditingProfile] = useState<SambaProfile | null>(null)
  const [testResult, setTestResult] = useState<{ success?: boolean; error?: string; testing?: boolean } | null>(null)

  const [showNewFolderModal, setShowNewFolderModal] = useState<boolean>(false)
  const [newFolderName, setNewFolderName] = useState<string>('')

  const [showRenameModal, setShowRenameModal] = useState<boolean>(false)
  const [renameTarget, setRenameTarget] = useState<SambaFileItem | null>(null)
  const [newRenameName, setNewRenameName] = useState<string>('')

  const [deleteConfirmTarget, setDeleteConfirmTarget] = useState<SambaFileItem | null>(null)

  // 预览状态
  const [previewText, setPreviewText] = useState<{ name: string; content: string; path: string; size: number } | null>(null)
  const [previewImage, setPreviewImage] = useState<{ name: string; src: string; path: string } | null>(null)
  const [previewVideo, setPreviewVideo] = useState<{
    name: string
    path: string
    size: number
    streamUrl?: string
    loading?: boolean
    error?: string
  } | null>(null)

  // 视频前端抽帧队列 (并发度 2，避免浏览器内存过载)
  const videoThumbQueueRef = useRef<Array<{ profileId: string; item: SambaFileItem }>>([])
  const activeThumbWorkersRef = useRef<number>(0)

  // 表单状态
  const [formConfig, setFormConfig] = useState<SambaConfig>({
    host: '192.168.1.100',
    port: 445,
    share: 'share',
    basePath: '',
    username: '',
    password: '',
    domain: 'WORKGROUP'
  })
  const [formProfileName, setFormProfileName] = useState<string>('我的 NAS')

  // 加载连接列表
  useEffect(() => {
    if (!sdk) return
    loadProfiles()

    // 监听传输进度
    const unsubscribe = sdk.onTransferProgress((progress) => {
      setTransfers((prev) => {
        const idx = prev.findIndex((t) => t.id === progress.id)
        if (idx >= 0) {
          const next = [...prev]
          next[idx] = progress
          return next
        } else {
          return [progress, ...prev]
        }
      })
      if (progress.status === 'completed') {
        // 传输完成后自动刷新文件列表
        setTimeout(() => refreshCurrentDirectory(), 600)
      }
    })

    return () => {
      unsubscribe()
    }
  }, [sdk])

  const loadProfiles = async () => {
    if (!sdk) return
    try {
      const list = await sdk.getProfiles()
      setProfiles(list)
      if (list.length > 0 && !activeProfileId) {
        handleConnectProfile(list[0].id)
      }
    } catch (err) {
      console.error('加载连接配置失败:', err)
    }
  }

  // 切换并连接指定 Profile
  const handleConnectProfile = async (profileId: string) => {
    if (!sdk) return
    setConnecting(true)
    setConnectionStatus('connecting')
    try {
      const res = await sdk.connect(profileId)
      if (res.success) {
        setActiveProfileId(profileId)
        setConnectionStatus('connected')
        setCurrentPath('')
        loadDirectory(profileId, '')
      } else {
        setConnectionStatus('disconnected')
        alert(`连接失败: ${res.error || '未知网络错误'}`)
      }
    } catch (err: any) {
      setConnectionStatus('disconnected')
      alert(`连接异常: ${err.message}`)
    } finally {
      setConnecting(false)
    }
  }

  // 读取目录
  const loadDirectory = async (profileId: string, path: string) => {
    if (!sdk || !profileId) return
    setLoadingFiles(true)
    try {
      const items = await sdk.listDirectory(profileId, path)
      setFileList(items)
      setCurrentPath(path)
      // 触发首批图片和视频缩略图加载
      triggerThumbnailLoads(profileId, items)
    } catch (err: any) {
      console.error('加载目录失败:', err)
      alert(`读取目录失败: ${err.message}`)
    } finally {
      setLoadingFiles(false)
    }
  }

  const refreshCurrentDirectory = () => {
    if (activeProfileId) {
      loadDirectory(activeProfileId, currentPath)
    }
  }

  // 监听 Esc 快捷键关闭预览弹窗
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (previewVideo) setPreviewVideo(null)
        else if (previewImage) setPreviewImage(null)
        else if (previewText) setPreviewText(null)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [previewVideo, previewImage, previewText])

  // 前端免 FFmpeg 视频硬件解码抽帧逻辑
  const extractVideoThumbnailInBrowser = async (profileId: string, item: SambaFileItem): Promise<string | null> => {
    if (!sdk) return null
    try {
      const streamUrl = await sdk.getFileStreamUrl(profileId, item.path)
      return new Promise<string | null>((resolve) => {
        const video = document.createElement('video')
        video.crossOrigin = 'anonymous'
        video.preload = 'metadata'
        video.muted = true
        video.playsInline = true

        let finished = false
        const cleanup = () => {
          if (finished) return
          finished = true
          video.pause()
          video.removeAttribute('src')
          video.load()
          video.remove()
        }

        const timer = setTimeout(() => {
          cleanup()
          resolve(null)
        }, 8000)

        video.addEventListener('loadedmetadata', () => {
          // 截取第 1 秒或前中段关键帧
          const targetTime = Math.min(1, (video.duration || 1) / 2)
          video.currentTime = targetTime
        })

        video.addEventListener('seeked', () => {
          try {
            const canvas = document.createElement('canvas')
            const targetWidth = 240
            const vWidth = video.videoWidth || 240
            const vHeight = video.videoHeight || 135
            const targetHeight = Math.round((vHeight / vWidth) * targetWidth) || 135
            canvas.width = targetWidth
            canvas.height = targetHeight
            const ctx = canvas.getContext('2d')
            if (ctx) {
              ctx.drawImage(video, 0, 0, targetWidth, targetHeight)
              const dataUrl = canvas.toDataURL('image/jpeg', 0.8)
              clearTimeout(timer)
              cleanup()
              resolve(dataUrl)
              return
            }
          } catch (e) {
            console.warn('Canvas video frame extract error:', e)
          }
          clearTimeout(timer)
          cleanup()
          resolve(null)
        })

        video.addEventListener('error', () => {
          clearTimeout(timer)
          cleanup()
          resolve(null)
        })

        video.src = streamUrl
      })
    } catch (err) {
      console.warn('Failed to get stream url for thumbnail:', err)
      return null
    }
  }

  const processVideoThumbQueue = () => {
    if (activeThumbWorkersRef.current >= 2) return
    const task = videoThumbQueueRef.current.shift()
    if (!task) return

    activeThumbWorkersRef.current++
    extractVideoThumbnailInBrowser(task.profileId, task.item)
      .then((dataUrl) => {
        if (dataUrl) {
          setThumbnails((prev) => ({ ...prev, [task.item.path]: dataUrl }))
          sdk?.saveThumbnailCache(task.profileId, task.item.path, task.item.size, dataUrl).catch(() => {})
        }
      })
      .catch(() => {})
      .finally(() => {
        activeThumbWorkersRef.current--
        processVideoThumbQueue()
      })
  }

  const enqueueFrontendVideoThumbnail = (profileId: string, item: SambaFileItem) => {
    if (thumbnails[item.path]) return
    if (videoThumbQueueRef.current.some((t) => t.item.path === item.path)) return
    videoThumbQueueRef.current.push({ profileId, item })
    processVideoThumbQueue()
  }

  // 异步加载图片与视频缩略图
  const triggerThumbnailLoads = (profileId: string, items: SambaFileItem[]) => {
    if (!sdk) return
    items.forEach((item) => {
      if (item.isDirectory) return
      const ext = item.extension.toLowerCase()
      const isImg = ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif'].includes(ext)
      const isVid = ['mp4', 'mkv', 'mov', 'avi', 'webm', 'flv', 'wmv', 'm4v', '3gp'].includes(ext)
      if (!isImg && !isVid) return

      const cacheKey = item.path
      if (thumbnails[cacheKey] || loadingThumbsRef.current.has(cacheKey)) return

      loadingThumbsRef.current.add(cacheKey)
      const mime = isImg ? `image/${ext === 'jpg' ? 'jpeg' : ext}` : `video/${ext}`

      sdk
        .getThumbnail(profileId, item.path, mime, item.size)
        .then((dataUrl) => {
          if (dataUrl) {
            setThumbnails((prev) => ({ ...prev, [cacheKey]: dataUrl }))
          } else if (isVid) {
            // 宿主未安装 FFmpeg，由前端通过本地 HTTP Range 流式服务 + Canvas 解码抽取缩略图并写回缓存
            enqueueFrontendVideoThumbnail(profileId, item)
          }
        })
        .catch(() => {
          if (isVid) {
            enqueueFrontendVideoThumbnail(profileId, item)
          }
        })
        .finally(() => {
          loadingThumbsRef.current.delete(cacheKey)
        })
    })
  }

  // 面包屑导航
  const breadcrumbs = useMemo(() => {
    const parts = currentPath.split(/[\/\\]/).filter(Boolean)
    const crumbs = [{ name: '根共享目录', path: '' }]
    let acc = ''
    for (const part of parts) {
      acc = acc ? `${acc}/${part}` : part
      crumbs.push({ name: part, path: acc })
    }
    return crumbs
  }, [currentPath])

  // 过滤与排序
  const filteredFiles = useMemo(() => {
    let result = fileList
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim()
      result = result.filter((f) => f.name.toLowerCase().includes(q))
    }
    return [...result].sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1
      if (!a.isDirectory && b.isDirectory) return 1
      let cmp = 0
      if (sortBy === 'name') {
        cmp = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
      } else if (sortBy === 'size') {
        cmp = a.size - b.size
      } else if (sortBy === 'mtime') {
        cmp = a.mtime - b.mtime
      }
      return sortAsc ? cmp : -cmp
    })
  }, [fileList, searchQuery, sortBy, sortAsc])

  // 文件操作：打开 / 预览
  const handleItemClick = async (item: SambaFileItem) => {
    if (item.isDirectory) {
      loadDirectory(activeProfileId, item.path)
      return
    }

    const ext = item.extension.toLowerCase()
    // 文本/代码预览
    if (['txt', 'md', 'json', 'js', 'ts', 'html', 'css', 'log', 'csv', 'yml', 'xml', 'py', 'sh', 'ini', 'conf'].includes(ext)) {
      if (!sdk) return
      try {
        const text = await sdk.readFileText(activeProfileId, item.path, 1024 * 512)
        setPreviewText({ name: item.name, content: text, path: item.path, size: item.size })
      } catch (err: any) {
        alert(`预览失败: ${err.message}`)
      }
      return
    }

    // 图片预览
    if (['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif', 'svg'].includes(ext)) {
      const thumb = thumbnails[item.path]
      setPreviewImage({ name: item.name, src: thumb || '', path: item.path })
      return
    }

    // 视频流式在线预览与播放
    if (['mp4', 'mkv', 'mov', 'webm', 'avi', 'flv', 'wmv', 'm4v', '3gp'].includes(ext)) {
      if (!sdk) return
      setPreviewVideo({
        name: item.name,
        path: item.path,
        size: item.size,
        loading: true
      })
      sdk
        .getFileStreamUrl(activeProfileId, item.path)
        .then((streamUrl) => {
          setPreviewVideo((prev) => (prev ? { ...prev, streamUrl, loading: false } : null))
        })
        .catch((err) => {
          setPreviewVideo((prev) =>
            prev ? { ...prev, loading: false, error: err.message || '获取视频流地址失败' } : null
          )
        })
      return
    }

    // 其他格式默认提示下载
    if (confirm(`是否下载文件: ${item.name} (${formatBytes(item.size)})？`)) {
      handleDownload(item)
    }
  }

  // 文件下载
  const handleDownload = async (item: SambaFileItem) => {
    if (!sdk) return
    try {
      setShowTransferDrawer(true)
      const res = await sdk.downloadFile(activeProfileId, item.path)
      if (res.success) {
        console.log('下载完成:', res.localPath)
      } else {
        alert(`下载失败: ${res.error}`)
      }
    } catch (err: any) {
      alert(`下载异常: ${err.message}`)
    }
  }

  // 文件上传
  const handleUpload = async () => {
    if (!sdk || !activeProfileId) return
    try {
      const fileRes = await sdk.selectLocalFile()
      if (fileRes.canceled || !fileRes.filePath) return

      setShowTransferDrawer(true)
      const res = await sdk.uploadFile(activeProfileId, fileRes.filePath, currentPath)
      if (!res.success) {
        alert(`上传失败: ${res.error}`)
      }
    } catch (err: any) {
      alert(`上传异常: ${err.message}`)
    }
  }

  // 新建文件夹
  const handleCreateFolder = async () => {
    if (!sdk || !activeProfileId || !newFolderName.trim()) return
    try {
      const folderPath = currentPath ? `${currentPath}/${newFolderName.trim()}` : newFolderName.trim()
      await sdk.createDirectory(activeProfileId, folderPath)
      setShowNewFolderModal(false)
      setNewFolderName('')
      refreshCurrentDirectory()
    } catch (err: any) {
      alert(`创建文件夹失败: ${err.message}`)
    }
  }

  // 重命名
  const handleRename = async () => {
    if (!sdk || !activeProfileId || !renameTarget || !newRenameName.trim()) return
    try {
      const parentDir = currentPath
      const newPath = parentDir ? `${parentDir}/${newRenameName.trim()}` : newRenameName.trim()
      await sdk.renameItem(activeProfileId, renameTarget.path, newPath)
      setShowRenameModal(false)
      setRenameTarget(null)
      setNewRenameName('')
      refreshCurrentDirectory()
    } catch (err: any) {
      alert(`重命名失败: ${err.message}`)
    }
  }

  // 删除文件/文件夹
  const handleDelete = async (item: SambaFileItem) => {
    if (!sdk || !activeProfileId) return
    try {
      await sdk.deleteItem(activeProfileId, item.path, item.isDirectory)
      setDeleteConfirmTarget(null)
      refreshCurrentDirectory()
    } catch (err: any) {
      alert(`删除失败: ${err.message}`)
    }
  }

  // 测试连接
  const handleTestConnection = async () => {
    if (!sdk) return
    if (!formConfig.host || !formConfig.host.trim()) {
      setTestResult({ success: false, error: '请填写主机 / IP 地址！' })
      return
    }
    if (!formConfig.share || !formConfig.share.trim()) {
      setTestResult({
        success: false,
        error: '请务必填写「共享路径 (Share Name)」！\nSamba 协议必须挂载具体的共享文件夹（例如: public, data, video 等，可在您的 NAS 共享文件夹列表中查看）。'
      })
      return
    }
    setTestResult({ testing: true })
    try {
      const res = await sdk.testConnection(formConfig)
      setTestResult(res)
    } catch (err: any) {
      setTestResult({ success: false, error: err.message })
    }
  }

  // 保存连接配置
  const handleSaveProfile = async () => {
    if (!sdk) return
    if (!formConfig.host || !formConfig.host.trim()) {
      alert('请填写服务器主机或 IP 地址！')
      return
    }
    if (!formConfig.share || !formConfig.share.trim()) {
      alert('请填写共享路径 (Share Name)，例如: public, data 等！')
      return
    }

    const profile: SambaProfile = {
      id: editingProfile ? editingProfile.id : `samba_${Date.now()}`,
      name: formProfileName.trim() || `${formConfig.host}/${formConfig.share}`,
      config: {
        ...formConfig,
        host: formConfig.host.trim(),
        share: formConfig.share.trim(),
        username: (formConfig.username || '').trim(),
        domain: (formConfig.domain || '').trim()
      },
      createdAt: editingProfile ? editingProfile.createdAt : Date.now(),
      lastConnected: editingProfile?.lastConnected
    }

    try {
      await sdk.saveProfile(profile)
      setShowProfileModal(false)
      setEditingProfile(null)
      loadProfiles()
      if (!activeProfileId) {
        handleConnectProfile(profile.id)
      }
    } catch (err: any) {
      alert(`保存失败: ${err.message}`)
    }
  }

  // 删除配置
  const handleDeleteProfile = async (id: string, name: string) => {
    if (!sdk) return
    if (!confirm(`确定删除连接配置 "${name}" 吗？`)) return
    try {
      await sdk.deleteProfile(id)
      if (activeProfileId === id) {
        setActiveProfileId('')
        setFileList([])
        setConnectionStatus('disconnected')
      }
      loadProfiles()
    } catch (err: any) {
      alert(`删除失败: ${err.message}`)
    }
  }

  const openNewProfileModal = () => {
    setEditingProfile(null)
    setFormProfileName('家庭 NAS')
    setFormConfig({
      host: '',
      port: 445,
      share: '',
      basePath: '',
      username: '',
      password: '',
      domain: ''
    })
    setTestResult(null)
    setShowProfileModal(true)
  }

  const openEditProfileModal = (p: SambaProfile) => {
    setEditingProfile(p)
    setFormProfileName(p.name)
    setFormConfig({ ...p.config })
    setTestResult(null)
    setShowProfileModal(true)
  }

  const activeProfile = profiles.find((p) => p.id === activeProfileId)

  return (
    <div className="flex h-screen w-screen bg-slate-950 text-slate-100 select-none overflow-hidden font-sans">
      {/* 左侧边栏：连接清单与快捷管理 */}
      <div className="w-64 flex-shrink-0 bg-slate-900 border-r border-slate-800/80 flex flex-col justify-between">
        <div className="flex flex-col flex-1 overflow-hidden">
          {/* 标题栏 */}
          <div className="p-4 border-b border-slate-800/80 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <span className="text-2xl">🗄️</span>
              <div>
                <h1 className="font-bold text-white text-sm tracking-wide">Samba 文件管理</h1>
                <div className="text-[11px] text-slate-400 font-mono">NAS & 局域网共享</div>
              </div>
            </div>
            <button
              onClick={openNewProfileModal}
              title="添加新连接"
              className="p-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
              </svg>
            </button>
          </div>

          {/* 连接列表 */}
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            <div className="px-2 py-1 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
              连接预设 ({profiles.length})
            </div>

            {profiles.length === 0 ? (
              <div className="p-4 text-center text-xs text-slate-500">
                暂无连接，点击右上角「+」配置 Samba/NAS 服务器
              </div>
            ) : (
              profiles.map((p) => {
                const isActive = p.id === activeProfileId
                return (
                  <div
                    key={p.id}
                    onClick={() => handleConnectProfile(p.id)}
                    className={`group relative p-2.5 rounded-xl cursor-pointer transition-all flex items-center justify-between ${
                      isActive
                        ? 'bg-emerald-500/10 border border-emerald-500/30 text-white'
                        : 'hover:bg-slate-800/60 border border-transparent text-slate-300'
                    }`}
                  >
                    <div className="min-w-0 flex-1 pr-2">
                      <div className="flex items-center gap-2">
                        <span
                          className={`w-2 h-2 rounded-full flex-shrink-0 ${
                            isActive
                              ? connectionStatus === 'connected'
                                ? 'bg-emerald-400 shadow-sm shadow-emerald-400/50'
                                : connectionStatus === 'connecting'
                                ? 'bg-amber-400 animate-ping'
                                : 'bg-rose-400'
                              : 'bg-slate-600'
                          }`}
                        />
                        <span className="text-xs font-semibold truncate">{p.name}</span>
                      </div>
                      <div className="text-[11px] text-slate-500 font-mono truncate mt-0.5 pl-4">
                        {p.config.host}:{p.config.port || 445}/{p.config.share}
                      </div>
                    </div>

                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          openEditProfileModal(p)
                        }}
                        className="p-1 rounded hover:bg-slate-700 text-slate-400 hover:text-white"
                        title="编辑配置"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                        </svg>
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          handleDeleteProfile(p.id, p.name)
                        }}
                        className="p-1 rounded hover:bg-rose-500/20 text-slate-400 hover:text-rose-400"
                        title="删除连接"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>

        {/* 底部状态 */}
        <div className="p-3 border-t border-slate-800/80 bg-slate-950/40 text-[11px] text-slate-400 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span>传输队列:</span>
            <span className="font-mono text-emerald-400">{transfers.length} 项</span>
          </div>
          <button
            onClick={() => setShowTransferDrawer(!showTransferDrawer)}
            className="text-xs text-sky-400 hover:underline flex items-center gap-1"
          >
            <span>{showTransferDrawer ? '收起' : '查看'}</span>
            <span>{showTransferDrawer ? '▼' : '▲'}</span>
          </button>
        </div>
      </div>

      {/* 右侧主工作区 */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden bg-slate-950">
        {/* 顶栏控制台 */}
        <div className="h-14 px-5 border-b border-slate-800/80 bg-slate-900/60 flex items-center justify-between gap-4">
          {/* 面包屑导航 */}
          <div className="flex items-center gap-1.5 overflow-x-auto py-1 text-xs text-slate-300 min-w-0 flex-1">
            {breadcrumbs.map((crumb, idx) => (
              <React.Fragment key={crumb.path}>
                {idx > 0 && <span className="text-slate-600">/</span>}
                <button
                  onClick={() => loadDirectory(activeProfileId, crumb.path)}
                  className={`px-2 py-1 rounded hover:bg-slate-800 font-medium transition-colors truncate max-w-[150px] ${
                    idx === breadcrumbs.length - 1
                      ? 'text-emerald-400 bg-slate-800/50'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {crumb.name}
                </button>
              </React.Fragment>
            ))}
          </div>

          {/* 搜索与视图切换工具 */}
          <div className="flex items-center gap-3 flex-shrink-0">
            {/* 搜索框 */}
            <div className="relative">
              <input
                type="text"
                placeholder="搜索当前目录..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-44 px-3 py-1.5 text-xs rounded-lg bg-slate-900 border border-slate-700/80 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-2 text-xs text-slate-400 hover:text-white"
                >
                  ×
                </button>
              )}
            </div>

            {/* 排序方式 */}
            <div className="flex items-center rounded-lg bg-slate-900 border border-slate-700/80 p-0.5 text-xs">
              <button
                onClick={() => {
                  if (sortBy === 'name') setSortAsc(!sortAsc)
                  else {
                    setSortBy('name')
                    setSortAsc(true)
                  }
                }}
                className={`px-2 py-1 rounded ${sortBy === 'name' ? 'bg-slate-800 text-white font-semibold' : 'text-slate-400'}`}
              >
                名称 {sortBy === 'name' && (sortAsc ? '↑' : '↓')}
              </button>
              <button
                onClick={() => {
                  if (sortBy === 'size') setSortAsc(!sortAsc)
                  else {
                    setSortBy('size')
                    setSortAsc(false)
                  }
                }}
                className={`px-2 py-1 rounded ${sortBy === 'size' ? 'bg-slate-800 text-white font-semibold' : 'text-slate-400'}`}
              >
                大小 {sortBy === 'size' && (sortAsc ? '↑' : '↓')}
              </button>
              <button
                onClick={() => {
                  if (sortBy === 'mtime') setSortAsc(!sortAsc)
                  else {
                    setSortBy('mtime')
                    setSortAsc(false)
                  }
                }}
                className={`px-2 py-1 rounded ${sortBy === 'mtime' ? 'bg-slate-800 text-white font-semibold' : 'text-slate-400'}`}
              >
                修改时间 {sortBy === 'mtime' && (sortAsc ? '↑' : '↓')}
              </button>
            </div>

            {/* 网格 / 列表视图切换 */}
            <div className="flex items-center rounded-lg bg-slate-900 border border-slate-700/80 p-0.5">
              <button
                onClick={() => setViewMode('grid')}
                className={`p-1.5 rounded ${viewMode === 'grid' ? 'bg-slate-800 text-emerald-400' : 'text-slate-400'}`}
                title="网格视图 (缩略图)"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                </svg>
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={`p-1.5 rounded ${viewMode === 'list' ? 'bg-slate-800 text-emerald-400' : 'text-slate-400'}`}
                title="列表视图 (详细)"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
            </div>

            {/* 操作按钮组 */}
            <button
              onClick={() => setShowNewFolderModal(true)}
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 flex items-center gap-1.5 transition-colors border border-slate-700/60"
            >
              <span>📁</span>
              <span>新建文件夹</span>
            </button>

            <button
              onClick={handleUpload}
              className="px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white flex items-center gap-1.5 transition-colors shadow-md shadow-emerald-600/20"
            >
              <span>⬆️</span>
              <span>上传文件</span>
            </button>

            <button
              onClick={refreshCurrentDirectory}
              disabled={loadingFiles}
              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
              title="刷新"
            >
              <svg className={`w-4 h-4 ${loadingFiles ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
          </div>
        </div>

        {/* 文件列表区 */}
        <div className="flex-1 overflow-y-auto p-5">
          {!activeProfile ? (
            <div className="h-full flex flex-col items-center justify-center text-center">
              <span className="text-5xl mb-4">🗄️</span>
              <h3 className="text-lg font-bold text-white">未连接到任何 Samba 服务器</h3>
              <p className="text-xs text-slate-400 mt-1 max-w-sm">
                请在左侧边栏选择一个已保存的连接，或点击左上角「+」配置新的 Samba/NAS 共享
              </p>
              <button
                onClick={openNewProfileModal}
                className="mt-4 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-lg shadow-emerald-600/20 transition-colors"
              >
                新建连接配置
              </button>
            </div>
          ) : loadingFiles ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-400 text-xs">
              <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mb-3" />
              <span>正在读取远程共享文件列表...</span>
            </div>
          ) : filteredFiles.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-500 text-xs">
              <span className="text-4xl mb-2">📂</span>
              <span>当前目录为空，或未找到匹配文件</span>
            </div>
          ) : viewMode === 'grid' ? (
            /* 网格卡片视图 (带大图/视频智能缩略图) */
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
              {filteredFiles.map((item) => {
                const { icon, color } = getFileIcon(item)
                const thumb = thumbnails[item.path]
                const isVideo = ['mp4', 'mkv', 'mov', 'webm'].includes(item.extension.toLowerCase())
                const isImage = ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif', 'svg'].includes(item.extension.toLowerCase())

                return (
                  <div
                    key={item.path}
                    onClick={() => handleItemClick(item)}
                    className="group relative bg-slate-900/80 hover:bg-slate-800/80 border border-slate-800 hover:border-emerald-500/50 rounded-xl p-3 cursor-pointer transition-all flex flex-col justify-between shadow-sm hover:shadow-md"
                  >
                    {/* 缩略图 / 图标容器 */}
                    <div className="w-full aspect-[4/3] rounded-lg bg-slate-950 flex items-center justify-center overflow-hidden relative mb-2.5">
                      {thumb ? (
                        <div className="w-full h-full relative">
                          <img
                            src={thumb}
                            alt={item.name}
                            className="w-full h-full object-cover rounded-lg group-hover:scale-105 transition-transform duration-300"
                            loading="lazy"
                          />
                          {isVideo && (
                            <div className="absolute inset-0 bg-black/30 flex items-center justify-center">
                              <span className="w-8 h-8 rounded-full bg-black/60 backdrop-blur-sm flex items-center justify-center text-white text-xs shadow-lg">
                                ▶
                              </span>
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className={`text-4xl ${color} select-none`}>{icon}</span>
                      )}

                      {/* 格式微徽标 */}
                      {!item.isDirectory && item.extension && (
                        <span className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-slate-900/80 backdrop-blur-sm text-slate-300 uppercase">
                          {item.extension}
                        </span>
                      )}
                    </div>

                    {/* 文件名与信息 */}
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-white truncate" title={item.name}>
                        {item.name}
                      </div>
                      <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono mt-1">
                        <span>{item.isDirectory ? '文件夹' : formatBytes(item.size)}</span>
                        <span>{formatDate(item.mtime).split(' ')[0]}</span>
                      </div>
                    </div>

                    {/* 悬停快捷按钮条 */}
                    <div
                      className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 bg-slate-950/80 backdrop-blur-sm p-1 rounded-lg border border-slate-700/80"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {!item.isDirectory && (
                        <button
                          onClick={() => handleDownload(item)}
                          className="p-1 rounded hover:bg-emerald-500/20 text-slate-300 hover:text-emerald-400"
                          title="下载到本地"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                          </svg>
                        </button>
                      )}
                      <button
                        onClick={() => {
                          setRenameTarget(item)
                          setNewRenameName(item.name)
                          setShowRenameModal(true)
                        }}
                        className="p-1 rounded hover:bg-slate-700 text-slate-300 hover:text-white"
                        title="重命名"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                        </svg>
                      </button>
                      <button
                        onClick={() => setDeleteConfirmTarget(item)}
                        className="p-1 rounded hover:bg-rose-500/20 text-slate-300 hover:text-rose-400"
                        title="删除"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            /* 列表详细表格视图 */
            <div className="bg-slate-900/60 border border-slate-800 rounded-xl overflow-hidden">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400 font-semibold bg-slate-900/90">
                    <th className="py-3 px-4">名称</th>
                    <th className="py-3 px-4 w-32">大小</th>
                    <th className="py-3 px-4 w-40">修改时间</th>
                    <th className="py-3 px-4 w-28 text-right">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {filteredFiles.map((item) => {
                    const { icon } = getFileIcon(item)
                    const thumb = thumbnails[item.path]
                    return (
                      <tr
                        key={item.path}
                        onClick={() => handleItemClick(item)}
                        className="hover:bg-slate-800/50 cursor-pointer transition-colors group"
                      >
                        <td className="py-2.5 px-4 flex items-center gap-3">
                          <div className="w-7 h-7 rounded bg-slate-950 flex items-center justify-center overflow-hidden flex-shrink-0">
                            {thumb ? (
                              <img src={thumb} alt={item.name} className="w-full h-full object-cover" />
                            ) : (
                              <span className="text-base">{icon}</span>
                            )}
                          </div>
                          <span className="font-medium text-white truncate max-w-md">{item.name}</span>
                        </td>
                        <td className="py-2.5 px-4 font-mono text-slate-400">
                          {item.isDirectory ? '-' : formatBytes(item.size)}
                        </td>
                        <td className="py-2.5 px-4 font-mono text-slate-400">
                          {formatDate(item.mtime)}
                        </td>
                        <td className="py-2.5 px-4 text-right" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-end gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                            {!item.isDirectory && (
                              <button
                                onClick={() => handleDownload(item)}
                                className="px-2 py-1 rounded bg-slate-800 hover:bg-emerald-600 text-slate-200 hover:text-white"
                                title="下载"
                              >
                                下载
                              </button>
                            )}
                            <button
                              onClick={() => {
                                setRenameTarget(item)
                                setNewRenameName(item.name)
                                setShowRenameModal(true)
                              }}
                              className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200"
                              title="重命名"
                            >
                              改名
                            </button>
                            <button
                              onClick={() => setDeleteConfirmTarget(item)}
                              className="px-2 py-1 rounded bg-rose-500/10 hover:bg-rose-500/20 text-rose-400"
                              title="删除"
                            >
                              删除
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* 底部传输抽屉 */}
        {showTransferDrawer && (
          <div className="h-44 border-t border-slate-800 bg-slate-900/95 backdrop-blur-md flex flex-col z-20">
            <div className="px-5 py-2.5 border-b border-slate-800/80 flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-semibold text-white">
                <span>传输任务列表</span>
                <span className="px-2 py-0.5 rounded-full bg-slate-800 text-[10px] font-mono text-emerald-400">
                  {transfers.length}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setTransfers([])}
                  className="text-xs text-slate-400 hover:text-white"
                >
                  清空已完成
                </button>
                <button
                  onClick={() => setShowTransferDrawer(false)}
                  className="text-xs text-slate-400 hover:text-white"
                >
                  ✕
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {transfers.length === 0 ? (
                <div className="h-full flex items-center justify-center text-xs text-slate-500">
                  当前暂无传输任务
                </div>
              ) : (
                transfers.map((t) => (
                  <div
                    key={t.id}
                    className="p-2.5 rounded-lg bg-slate-950/60 border border-slate-800 flex items-center justify-between gap-4 text-xs"
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <span className="text-lg flex-shrink-0">
                        {t.type === 'upload' ? '⬆️' : '⬇️'}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between text-xs mb-1">
                          <span className="font-semibold text-white truncate max-w-sm">{t.fileName}</span>
                          <span className="font-mono text-emerald-400">{t.speed}</span>
                        </div>
                        <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                          <div
                            className={`h-full transition-all duration-300 ${
                              t.status === 'completed'
                                ? 'bg-emerald-500'
                                : t.status === 'failed'
                                ? 'bg-rose-500'
                                : 'bg-sky-500'
                            }`}
                            style={{ width: `${t.progress}%` }}
                          />
                        </div>
                      </div>
                    </div>

                    <div className="text-right font-mono text-[11px] text-slate-400 flex-shrink-0 w-24">
                      {t.status === 'completed' ? (
                        <span className="text-emerald-400 font-bold">已完成</span>
                      ) : t.status === 'failed' ? (
                        <span className="text-rose-400 font-bold">失败</span>
                      ) : (
                        <span>{t.progress}%</span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {/* 弹窗：新建 / 编辑连接配置 */}
      {showProfileModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="font-bold text-base text-white">
                {editingProfile ? '编辑 Samba 连接配置' : '新建 Samba 连接配置'}
              </h3>
              <button
                onClick={() => setShowProfileModal(false)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-400 mb-1">配置名称</label>
                <input
                  type="text"
                  placeholder="例如: 家庭 NAS、办公室共享"
                  value={formProfileName}
                  onChange={(e) => setFormProfileName(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <label className="block text-slate-400 mb-1">主机 / IP 地址 *</label>
                  <input
                    type="text"
                    placeholder="192.168.1.100 或 nas.local"
                    value={formConfig.host}
                    onChange={(e) => setFormConfig({ ...formConfig, host: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white font-mono focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">指定端口 *</label>
                  <input
                    type="number"
                    placeholder="445"
                    value={formConfig.port || 445}
                    onChange={(e) => setFormConfig({ ...formConfig, port: Number(e.target.value) })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white font-mono focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1">共享路径 (Share Name) *</label>
                  <input
                    type="text"
                    placeholder="例如: public, data, video"
                    value={formConfig.share}
                    onChange={(e) => setFormConfig({ ...formConfig, share: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white font-mono focus:outline-none focus:border-emerald-500"
                  />
                  <div className="text-[10px] text-amber-400 mt-1">
                    * 必填：Samba 协议必须挂载具体共享路径（如 public, data 等）
                  </div>
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">起始子路径 (可选)</label>
                  <input
                    type="text"
                    placeholder="例如: documents/work"
                    value={formConfig.basePath || ''}
                    onChange={(e) => setFormConfig({ ...formConfig, basePath: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white font-mono focus:outline-none focus:border-emerald-500"
                  />
                  <div className="text-[10px] text-slate-500 mt-1">
                    挂载成功后默认进入的子目录，留空即为根目录
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1">用户账号 (匿名留空)</label>
                  <input
                    type="text"
                    placeholder="username"
                    value={formConfig.username || ''}
                    onChange={(e) => setFormConfig({ ...formConfig, username: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white font-mono focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">访问密码</label>
                  <input
                    type="password"
                    placeholder="password"
                    value={formConfig.password || ''}
                    onChange={(e) => setFormConfig({ ...formConfig, password: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white font-mono focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-400 mb-1">工作组 / 域 (可选)</label>
                <input
                  type="text"
                  placeholder="Linux/NAS 本地账户请留空；域账户填入 DOMAIN"
                  value={formConfig.domain || ''}
                  onChange={(e) => setFormConfig({ ...formConfig, domain: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white font-mono focus:outline-none focus:border-emerald-500"
                />
                <div className="text-[10px] text-slate-500 mt-1">
                  注意：群晖/威联通/Linux Samba 等本地用户切勿填 WORKGROUP，请保持留空
                </div>
              </div>

              {/* 测试连接反馈 */}
              {testResult && (
                <div
                  className={`p-3 rounded-xl text-xs flex items-start gap-2.5 ${
                    testResult.testing
                      ? 'bg-amber-500/10 text-amber-400 border border-amber-500/30'
                      : testResult.success
                      ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                      : 'bg-rose-500/10 text-rose-400 border border-rose-500/30'
                  }`}
                >
                  <span className="mt-0.5">{testResult.testing ? '⏳' : testResult.success ? '✅' : '❌'}</span>
                  <div className="flex-1 whitespace-pre-line text-left leading-relaxed font-sans">
                    {testResult.testing
                      ? '正在发起 Samba NTLMv2 协议握手测试中...'
                      : testResult.success
                      ? '连接测试成功！Samba 服务正常响应，凭证有效。'
                      : `连接测试失败: ${testResult.error}`}
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between pt-3 border-t border-slate-800">
              <button
                onClick={handleTestConnection}
                disabled={testResult?.testing}
                className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition-colors"
              >
                测试连通性
              </button>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowProfileModal(false)}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={handleSaveProfile}
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-lg shadow-emerald-600/20 transition-colors"
                >
                  保存配置
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 弹窗：新建文件夹 */}
      {showNewFolderModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-2xl space-y-4">
            <h3 className="font-bold text-sm text-white flex items-center gap-2">
              <span>📁</span>
              <span>新建文件夹</span>
            </h3>
            <input
              type="text"
              placeholder="请输入文件夹名称"
              autoFocus
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreateFolder()}
              className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-emerald-500"
            />
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setShowNewFolderModal(false)}
                className="px-3 py-1.5 rounded-lg bg-slate-800 text-xs text-slate-300 hover:bg-slate-700"
              >
                取消
              </button>
              <button
                onClick={handleCreateFolder}
                className="px-3 py-1.5 rounded-lg bg-emerald-600 text-xs font-semibold text-white hover:bg-emerald-500"
              >
                创建
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 弹窗：重命名 */}
      {showRenameModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-2xl space-y-4">
            <h3 className="font-bold text-sm text-white">重命名</h3>
            <input
              type="text"
              autoFocus
              value={newRenameName}
              onChange={(e) => setNewRenameName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleRename()}
              className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-emerald-500"
            />
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setShowRenameModal(false)}
                className="px-3 py-1.5 rounded-lg bg-slate-800 text-xs text-slate-300 hover:bg-slate-700"
              >
                取消
              </button>
              <button
                onClick={handleRename}
                className="px-3 py-1.5 rounded-lg bg-emerald-600 text-xs font-semibold text-white hover:bg-emerald-500"
              >
                确定
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 弹窗：删除确认 */}
      {deleteConfirmTarget && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-2xl space-y-3">
            <h3 className="font-bold text-sm text-rose-400 flex items-center gap-2">
              <span>⚠️</span>
              <span>确认删除</span>
            </h3>
            <p className="text-xs text-slate-300">
              确定要彻底删除远程 {deleteConfirmTarget.isDirectory ? '目录' : '文件'}：
              <span className="font-semibold text-white font-mono block mt-1 break-all">
                {deleteConfirmTarget.name}
              </span>
              吗？此操作无法撤销。
            </p>
            <div className="flex items-center justify-end gap-2 pt-3">
              <button
                onClick={() => setDeleteConfirmTarget(null)}
                className="px-3 py-1.5 rounded-lg bg-slate-800 text-xs text-slate-300 hover:bg-slate-700"
              >
                取消
              </button>
              <button
                onClick={() => handleDelete(deleteConfirmTarget)}
                className="px-3 py-1.5 rounded-lg bg-rose-600 text-xs font-semibold text-white hover:bg-rose-500"
              >
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 预览弹窗：文本/代码文件 */}
      {previewText && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-6">
          <div className="w-full max-w-4xl h-[80vh] bg-slate-900 border border-slate-800 rounded-2xl flex flex-col shadow-2xl overflow-hidden">
            <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/40">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-lg">📝</span>
                <div className="min-w-0">
                  <h4 className="font-bold text-sm text-white truncate">{previewText.name}</h4>
                  <div className="text-[10px] text-slate-500 font-mono">
                    {formatBytes(previewText.size)} · UTF-8 文本预览
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(previewText.content)
                    alert('已复制文本到剪贴板')
                  }}
                  className="px-3 py-1 text-xs rounded bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
                >
                  复制全文
                </button>
                <button
                  onClick={() => setPreviewText(null)}
                  className="p-1 rounded text-slate-400 hover:text-white"
                >
                  ✕
                </button>
              </div>
            </div>
            <div className="flex-1 p-4 overflow-auto bg-slate-950 font-mono text-xs text-slate-200 leading-relaxed whitespace-pre select-text">
              {previewText.content}
            </div>
          </div>
        </div>
      )}

      {/* 预览弹窗：图片 */}
      {previewImage && (
        <div
          className="fixed inset-0 bg-black/90 backdrop-blur-md z-50 flex flex-col items-center justify-center p-6"
          onClick={() => setPreviewImage(null)}
        >
          <div
            className="relative max-w-5xl max-h-[85vh] flex flex-col items-center"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-center mb-3">
              <h4 className="font-bold text-sm text-white">{previewImage.name}</h4>
            </div>
            <img
              src={previewImage.src}
              alt={previewImage.name}
              className="max-w-full max-h-[70vh] rounded-xl object-contain shadow-2xl border border-slate-800"
            />
            <div className="mt-4 flex items-center gap-3">
              <button
                onClick={() => setPreviewImage(null)}
                className="px-4 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 预览弹窗：视频流式播放器 */}
      {previewVideo && (
        <div
          className="fixed inset-0 bg-black/90 backdrop-blur-md z-50 flex items-center justify-center p-4 sm:p-6 select-none"
          onClick={() => setPreviewVideo(null)}
        >
          <div
            className="w-full max-w-4xl bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl flex flex-col max-h-[92vh]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 顶栏：标题与操作 */}
            <div className="px-5 py-3.5 border-b border-slate-800 bg-slate-900/90 flex items-center justify-between gap-4">
              <div className="min-w-0 flex items-center gap-2.5">
                <span className="text-xl flex-shrink-0">🎬</span>
                <div className="min-w-0">
                  <h4 className="font-bold text-sm text-white truncate" title={previewVideo.name}>
                    {previewVideo.name}
                  </h4>
                  <div className="flex items-center gap-2 text-[11px] text-slate-400 font-mono mt-0.5">
                    <span>{formatBytes(previewVideo.size)}</span>
                    <span>•</span>
                    <span className="text-emerald-400">HTTP 206 流式分发</span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {previewVideo.streamUrl && (
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(previewVideo.streamUrl!)
                      alert('已复制流媒体地址，可在 PotPlayer / VLC 中打开网络串流播放')
                    }}
                    className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-medium transition-colors flex items-center gap-1.5"
                    title="复制用于 PotPlayer/VLC 等外部播放器的流地址"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                    </svg>
                    复制串流地址
                  </button>
                )}
                <button
                  onClick={() => {
                    const target = fileList.find((f) => f.path === previewVideo.path)
                    if (target) handleDownload(target)
                  }}
                  className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-md shadow-emerald-600/20 transition-colors flex items-center gap-1.5"
                  title="下载文件到本地电脑"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  下载到本地
                </button>
                <button
                  onClick={() => setPreviewVideo(null)}
                  className="w-8 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center transition-colors"
                  title="关闭 (Esc)"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* 播放器主体区 */}
            <div className="relative bg-black flex items-center justify-center min-h-[360px] max-h-[72vh] overflow-hidden">
              {previewVideo.loading ? (
                <div className="flex flex-col items-center justify-center text-slate-400 text-xs py-16 gap-3">
                  <div className="w-9 h-9 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                  <span>正在建立 Samba 高速流媒体连接...</span>
                </div>
              ) : previewVideo.error ? (
                <div className="p-8 text-center max-w-md space-y-3">
                  <span className="text-4xl block">⚠️</span>
                  <h5 className="font-semibold text-white text-sm">无法直接在线播放该视频</h5>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    {previewVideo.error}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    提示：部分编码格式（如 AVI、WMV 或非标准编码）浏览器内核不支持硬解，建议下载到本地或复制串流地址使用专业播放器观看。
                  </p>
                  <div className="pt-2 flex justify-center gap-3">
                    <button
                      onClick={() => {
                        const target = fileList.find((f) => f.path === previewVideo.path)
                        if (target) handleDownload(target)
                        setPreviewVideo(null)
                      }}
                      className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white"
                    >
                      一键下载到本地
                    </button>
                  </div>
                </div>
              ) : (
                <video
                  src={previewVideo.streamUrl}
                  controls
                  autoPlay
                  playsInline
                  className="w-full max-h-[72vh] object-contain"
                  onError={() => {
                    setPreviewVideo((prev) =>
                      prev
                        ? {
                            ...prev,
                            error:
                              '当前视频编码格式浏览器暂不支持直接解码（常见于部分 AVI、WMV 或非标准编码）。建议下载到本地使用 PotPlayer / VLC 播放。'
                          }
                        : null
                    )
                  }}
                />
              )}
            </div>

            {/* 底栏提示 */}
            <div className="px-5 py-2.5 bg-slate-900/90 border-t border-slate-800 flex items-center justify-between text-[11px] text-slate-400">
              <span>💡 支持在进度条上随意快进/快退 Seek 播放（按需加载数据，无需等待完整下载）</span>
              <span className="font-mono text-slate-500">{previewVideo.name.split('.').pop()?.toUpperCase()}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
