import React, { useState, useEffect, useMemo, useCallback } from 'react'
import type { StorageProfile, BucketItem, StorageObjectItem } from './lib/types'
import { PROVIDER_PRESETS } from './lib/types'
import {
  getStoredProfiles,
  saveStoredProfiles,
  getActiveProfileId,
  setActiveProfileId,
  getLastBucketForProfile,
  setLastBucketForProfile
} from './lib/storage'
import { S3Client } from './lib/s3-client'
import { ProfileModal } from './components/ProfileModal'
import { UploadModal } from './components/UploadModal'
import { PreviewModal } from './components/PreviewModal'
import { ShareModal } from './components/ShareModal'
import { NewFolderModal } from './components/NewFolderModal'
import { RenameModal } from './components/RenameModal'
import { ObjectThumbnail } from './components/ObjectThumbnail'

function formatBytes(bytes: number): string {
  if (!bytes || bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

function formatDate(dateStr?: string): string {
  if (!dateStr) return '-'
  try {
    const d = new Date(dateStr)
    return d.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    })
  } catch {
    return dateStr
  }
}


export default function App(): JSX.Element {
  // Profiles
  const [profiles, setProfiles] = useState<StorageProfile[]>(getStoredProfiles)
  const [activeProfileIdState, setActiveProfileIdState] = useState<string | null>(getActiveProfileId)

  const activeProfile = useMemo(() => {
    return profiles.find((p) => p.id === activeProfileIdState) || profiles[0] || null
  }, [profiles, activeProfileIdState])

  const s3Client = useMemo(() => {
    if (!activeProfile) return null
    return new S3Client(activeProfile)
  }, [activeProfile])

  // Buckets & Current View
  const [buckets, setBuckets] = useState<BucketItem[]>([])
  const [currentBucket, setCurrentBucket] = useState<string>('')
  const [currentPrefix, setCurrentPrefix] = useState<string>('') // e.g. "photos/2026/"
  const [objects, setObjects] = useState<StorageObjectItem[]>([])
  const [loading, setLoading] = useState<boolean>(false)
  const [error, setError] = useState<string>('')

  // View state
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set())
  const [sortBy, setSortBy] = useState<'name' | 'size' | 'time'>('name')
  const [sortAsc, setSortAsc] = useState<boolean>(true)

  // Drag-and-drop state
  const [isDragOverWindow, setIsDragOverWindow] = useState<boolean>(false)

  // Modals
  const [showProfileModal, setShowProfileModal] = useState<boolean>(false)
  const [showUploadModal, setShowUploadModal] = useState<boolean>(false)
  const [showNewFolderModal, setShowNewFolderModal] = useState<boolean>(false)
  const [previewTarget, setPreviewTarget] = useState<StorageObjectItem | null>(null)
  const [shareTarget, setShareTarget] = useState<StorageObjectItem | null>(null)
  const [renameTarget, setRenameTarget] = useState<StorageObjectItem | null>(null)

  // 保存配置列表
  const handleSaveProfile = (profile: StorageProfile) => {
    const exists = profiles.some((p) => p.id === profile.id)
    const updated = exists ? profiles.map((p) => (p.id === profile.id ? profile : p)) : [...profiles, profile]
    setProfiles(updated)
    saveStoredProfiles(updated)
    setActiveProfileIdState(profile.id)
    setActiveProfileId(profile.id)
  }

  const handleDeleteProfile = (id: string) => {
    const updated = profiles.filter((p) => p.id !== id)
    setProfiles(updated)
    saveStoredProfiles(updated)
    if (activeProfileIdState === id) {
      const nextId = updated[0]?.id || null
      setActiveProfileIdState(nextId)
      if (nextId) setActiveProfileId(nextId)
    }
  }

  // 加载当前 Profile 的 Buckets
  const loadBuckets = useCallback(async () => {
    if (!s3Client || !activeProfile) return
    setError('')
    try {
      if (activeProfile.defaultBucket) {
        setBuckets([{ name: activeProfile.defaultBucket }])
        setCurrentBucket(activeProfile.defaultBucket)
      } else {
        const list = await s3Client.listBuckets()
        setBuckets(list)
        const savedBucket = getLastBucketForProfile(activeProfile.id)
        if (savedBucket && list.some((b) => b.name === savedBucket)) {
          setCurrentBucket(savedBucket)
        } else if (list.length > 0) {
          setCurrentBucket(list[0].name)
        }
      }
    } catch (err: any) {
      setError(err.message || '加载存储桶失败')
    }
  }, [s3Client, activeProfile])

  // 加载当前 Bucket 的对象列表
  const loadObjects = useCallback(async () => {
    if (!s3Client || !currentBucket) return
    setLoading(true)
    setError('')
    setSelectedKeys(new Set())
    try {
      const res = await s3Client.listObjects(currentBucket, currentPrefix, '/')
      setObjects(res.objects)
      if (activeProfile) {
        setLastBucketForProfile(activeProfile.id, currentBucket)
      }
    } catch (err: any) {
      setError(err.message || '加载目录对象失败')
    } finally {
      setLoading(false)
    }
  }, [s3Client, currentBucket, currentPrefix, activeProfile])

  useEffect(() => {
    loadBuckets()
  }, [loadBuckets])

  useEffect(() => {
    if (currentBucket) {
      loadObjects()
    }
  }, [loadObjects, currentBucket])

  // 路径导航面包屑
  const breadcrumbSegments = useMemo(() => {
    if (!currentPrefix) return []
    const parts = currentPrefix.replace(/\/$/, '').split('/')
    let accum = ''
    return parts.map((part) => {
      accum += part + '/'
      return { name: part, prefix: accum }
    })
  }, [currentPrefix])

  const navigateToPrefix = (prefix: string) => {
    setCurrentPrefix(prefix)
  }

  const navigateUp = () => {
    if (!currentPrefix) return
    const parts = currentPrefix.replace(/\/$/, '').split('/')
    parts.pop()
    const nextPrefix = parts.length > 0 ? parts.join('/') + '/' : ''
    setCurrentPrefix(nextPrefix)
  }

  // 排序与过滤
  const filteredAndSortedObjects = useMemo(() => {
    let list = objects
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      list = list.filter((item) => item.name.toLowerCase().includes(q))
    }

    return [...list].sort((a, b) => {
      // 文件夹优先
      if (a.isDirectory && !b.isDirectory) return -1
      if (!a.isDirectory && b.isDirectory) return 1

      let comp = 0
      if (sortBy === 'name') {
        comp = a.name.localeCompare(b.name, 'zh-CN')
      } else if (sortBy === 'size') {
        comp = a.size - b.size
      } else if (sortBy === 'time') {
        comp = (a.lastModified || '').localeCompare(b.lastModified || '')
      }
      return sortAsc ? comp : -comp
    })
  }, [objects, searchQuery, sortBy, sortAsc])

  // 全选/多选
  const handleToggleSelect = (key: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const next = new Set(selectedKeys)
    if (next.has(key)) {
      next.delete(key)
    } else {
      next.add(key)
    }
    setSelectedKeys(next)
  }

  const handleSelectAll = () => {
    if (selectedKeys.size === filteredAndSortedObjects.length) {
      setSelectedKeys(new Set())
    } else {
      setSelectedKeys(new Set(filteredAndSortedObjects.map((o) => o.key)))
    }
  }

  // 单文件下载
  const handleDownloadItem = async (item: StorageObjectItem, e?: React.MouseEvent) => {
    if (e) e.stopPropagation()
    if (!s3Client || item.isDirectory) return
    try {
      const presigned = await s3Client.getPresignedUrl(currentBucket, item.key, 3600)
      const sdk = (window as any).doujiaoSDK?.download
      if (sdk && typeof sdk.enqueue === 'function') {
        await sdk.enqueue({
          url: presigned,
          filename: item.name
        })
        const uiSdk = (window as any).doujiaoSDK?.ui
        if (uiSdk) uiSdk.notify({ message: `已添加下载任务: ${item.name}`, type: 'success' })
      } else {
        // 浏览器直接下载
        const a = document.createElement('a')
        a.href = presigned
        a.download = item.name
        a.target = '_blank'
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
      }
    } catch (err: any) {
      alert(`下载失败: ${err.message}`)
    }
  }

  // 删除选中或单文件
  const handleDeleteItem = async (item: StorageObjectItem, e?: React.MouseEvent) => {
    if (e) e.stopPropagation()
    if (!s3Client) return
    const msg = item.isDirectory
      ? `确定要删除文件夹「${item.name}」吗？`
      : `确定要删除文件「${item.name}」吗？`
    if (!confirm(msg)) return

    try {
      await s3Client.deleteObject(currentBucket, item.key)
      loadObjects()
    } catch (err: any) {
      alert(`删除失败: ${err.message}`)
    }
  }

  const handleBatchDelete = async () => {
    if (!s3Client || selectedKeys.size === 0) return
    if (!confirm(`确定要批量永久删除选中的 ${selectedKeys.size} 个对象吗？`)) return

    try {
      await s3Client.deleteObjects(currentBucket, Array.from(selectedKeys))
      loadObjects()
    } catch (err: any) {
      alert(`批量删除失败: ${err.message}`)
    }
  }

  // 拖拽上传监听
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOverWindow(true)
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.currentTarget.contains(e.relatedTarget as Node)) return
    setIsDragOverWindow(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOverWindow(false)
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      setShowUploadModal(true)
    }
  }

  // 计算当前目录统计
  const totalStats = useMemo(() => {
    let count = 0
    let size = 0
    objects.forEach((o) => {
      if (!o.isDirectory) {
        count++
        size += o.size
      }
    })
    return { count, size }
  }, [objects])

  return (
    <div
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className="flex flex-col h-screen w-screen overflow-hidden bg-slate-950 text-slate-100 select-none relative"
    >
      {/* 拖拽上传全局高亮覆盖层 */}
      {isDragOverWindow && (
        <div className="absolute inset-0 z-40 bg-emerald-950/80 border-4 border-dashed border-emerald-400 backdrop-blur-sm flex flex-col items-center justify-center pointer-events-none animate-fade-in">
          <div className="text-6xl mb-4 animate-bounce">📥</div>
          <div className="text-lg font-bold text-white mb-1">释放文件立即上传到当前目录</div>
          <div className="text-xs text-emerald-300 font-mono">
            /{currentBucket}/{currentPrefix}
          </div>
        </div>
      )}

      {/* 顶部主导航栏 */}
      <header className="h-14 border-b border-slate-800 flex items-center justify-between px-4 bg-slate-900/90 backdrop-blur z-20 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-2xl">🪣</span>
            <span className="font-bold text-sm tracking-wide bg-gradient-to-r from-emerald-400 to-teal-200 bg-clip-text text-transparent">
              对象存储管理
            </span>
          </div>

          <div className="h-4 w-[1px] bg-slate-800 mx-1" />

          {/* Profile 下拉切换 */}
          {profiles.length > 0 ? (
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-slate-500">连接:</span>
              <select
                value={activeProfile?.id || ''}
                onChange={(e) => {
                  setActiveProfileIdState(e.target.value)
                  setActiveProfileId(e.target.value)
                }}
                className="bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-500 max-w-[160px] truncate"
              >
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {PROVIDER_PRESETS[p.provider]?.icon || '🪣'} {p.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          {/* 存储桶 Bucket 下拉切换 */}
          {buckets.length > 0 ? (
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-slate-500">存储桶:</span>
              <select
                value={currentBucket}
                onChange={(e) => {
                  setCurrentBucket(e.target.value)
                  setCurrentPrefix('')
                }}
                className="bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-1.5 text-xs text-emerald-300 font-mono focus:outline-none focus:border-emerald-500 max-w-[180px] truncate"
              >
                {buckets.map((b) => (
                  <option key={b.name} value={b.name}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          <button
            onClick={loadObjects}
            disabled={loading || !currentBucket}
            title="刷新对象列表"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition disabled:opacity-30"
          >
            🔄
          </button>
        </div>

        {/* 右侧全局配置按钮 */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowProfileModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-medium transition"
          >
            <span>⚙️</span>
            <span>管理连接配置</span>
          </button>
        </div>
      </header>

      {/* 次级操作与面包屑工具栏 */}
      {activeProfile && currentBucket ? (
        <div className="h-12 border-b border-slate-800/80 bg-slate-900/50 flex items-center justify-between px-4 text-xs flex-shrink-0">
          {/* 面包屑导航 */}
          <div className="flex items-center gap-1 overflow-x-auto py-1 max-w-xl">
            <button
              onClick={navigateUp}
              disabled={!currentPrefix}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition disabled:opacity-30"
              title="返回上级目录"
            >
              ⬆️
            </button>

            <button
              onClick={() => navigateToPrefix('')}
              className={`px-2 py-1 rounded-lg transition font-medium ${
                !currentPrefix
                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              }`}
            >
              根目录
            </button>

            {breadcrumbSegments.map((seg, idx) => {
              const isLast = idx === breadcrumbSegments.length - 1
              return (
                <React.Fragment key={seg.prefix}>
                  <span className="text-slate-600">/</span>
                  <button
                    onClick={() => navigateToPrefix(seg.prefix)}
                    className={`px-2 py-1 rounded-lg transition font-mono ${
                      isLast
                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 font-medium'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                    }`}
                  >
                    {seg.name}
                  </button>
                </React.Fragment>
              )
            })}
          </div>

          {/* 右侧搜索与操作工具 */}
          <div className="flex items-center gap-2">
            {/* 实时搜索 */}
            <div className="relative">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜索当前目录..."
                className="w-36 focus:w-48 transition-all bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-1 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-1.5 text-slate-500 hover:text-slate-300"
                >
                  ✕
                </button>
              )}
            </div>

            {/* 批量删除 */}
            {selectedKeys.size > 0 && (
              <button
                onClick={handleBatchDelete}
                className="flex items-center gap-1 px-3 py-1 bg-rose-950/60 border border-rose-500/40 text-rose-300 hover:bg-rose-900/60 rounded-xl transition"
              >
                <span>🗑️</span>
                <span>删除选中 ({selectedKeys.size})</span>
              </button>
            )}

            {/* 新建文件夹 */}
            <button
              onClick={() => setShowNewFolderModal(true)}
              className="flex items-center gap-1 px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl transition"
            >
              <span>📁</span>
              <span>新建文件夹</span>
            </button>

            {/* 上传文件 */}
            <button
              onClick={() => setShowUploadModal(true)}
              className="flex items-center gap-1 px-3.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-medium transition shadow-sm"
            >
              <span>📤</span>
              <span>上传文件</span>
            </button>

            {/* 视图模式切换 */}
            <div className="flex items-center bg-slate-950 border border-slate-800 rounded-xl p-0.5 ml-1">
              <button
                onClick={() => setViewMode('grid')}
                className={`p-1 rounded-lg transition ${
                  viewMode === 'grid' ? 'bg-slate-800 text-emerald-400' : 'text-slate-500 hover:text-slate-300'
                }`}
                title="网格视图"
              >
                ▦
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={`p-1 rounded-lg transition ${
                  viewMode === 'list' ? 'bg-slate-800 text-emerald-400' : 'text-slate-500 hover:text-slate-300'
                }`}
                title="列表视图"
              >
                ≡
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* 主体展示区 */}
      <main className="flex-1 overflow-y-auto p-4 relative">
        {/* 无配置引导卡片 */}
        {profiles.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-8">
            <div className="text-6xl mb-4">🪣</div>
            <h3 className="text-base font-semibold text-slate-200 mb-2">欢迎使用对象存储文件管理</h3>
            <p className="text-xs text-slate-400 max-w-md mb-6 leading-relaxed">
              支持 AWS S3、MinIO、阿里云 OSS、腾讯云 COS、Cloudflare R2 等多平台存储桶无缝接入，支持文件多选拖拽上传、临时外链生成与在线高清媒体预览。
            </p>
            <button
              onClick={() => setShowProfileModal(true)}
              className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-medium transition shadow-lg flex items-center gap-2"
            >
              <span>＋</span>
              <span>新建并连接首个对象存储</span>
            </button>
          </div>
        ) : error ? (
          <div className="h-full flex flex-col items-center justify-center p-8 text-center">
            <div className="p-4 bg-rose-950/40 border border-rose-500/50 rounded-2xl max-w-lg text-rose-300 text-xs space-y-2">
              <div className="font-semibold text-sm flex items-center justify-center gap-1.5">
                <span>⚠️</span>
                <span>连接或拉取失败</span>
              </div>
              <p className="leading-relaxed">{error}</p>
              <div className="pt-2 flex items-center justify-center gap-3">
                <button
                  onClick={loadObjects}
                  className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg"
                >
                  重新尝试
                </button>
                <button
                  onClick={() => setShowProfileModal(true)}
                  className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg"
                >
                  检查配置
                </button>
              </div>
            </div>
          </div>
        ) : loading ? (
          <div className="h-full flex flex-col items-center justify-center text-slate-500 text-xs gap-3">
            <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
            <span>正在拉取对象列表...</span>
          </div>
        ) : filteredAndSortedObjects.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-8 text-slate-500 text-xs">
            <div className="text-5xl mb-3">📂</div>
            <div className="font-medium text-slate-400 mb-1">当前目录为空</div>
            <p className="text-[11px] text-slate-600 mb-4">可直接拖拽本地文件至窗口中上传</p>
            <button
              onClick={() => setShowUploadModal(true)}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl transition font-medium"
            >
              上传首个文件
            </button>
          </div>
        ) : viewMode === 'grid' ? (
          /* 网格视图 */
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-3">
            {filteredAndSortedObjects.map((item) => {
              const isSelected = selectedKeys.has(item.key)

              return (
                <div
                  key={item.key}
                  onClick={() => {
                    if (item.isDirectory) {
                      navigateToPrefix(item.key)
                    } else {
                      setPreviewTarget(item)
                    }
                  }}
                  className={`group relative p-3 rounded-2xl border flex flex-col items-center text-center cursor-pointer transition select-none ${
                    isSelected
                      ? 'bg-emerald-950/40 border-emerald-500/60 shadow-md'
                      : 'bg-slate-900/60 border-slate-800/80 hover:bg-slate-850 hover:border-slate-700 hover:shadow-lg'
                  }`}
                >
                  {/* 复选框 */}
                  <div
                    onClick={(e) => handleToggleSelect(item.key, e)}
                    className={`absolute top-2 left-2 z-10 w-4 h-4 rounded border flex items-center justify-center transition ${
                      isSelected
                        ? 'bg-emerald-500 border-emerald-400 text-white text-[10px]'
                        : 'border-slate-700 bg-slate-950/60 opacity-0 group-hover:opacity-100 hover:border-slate-500'
                    }`}
                  >
                    {isSelected && '✓'}
                  </div>

                  {/* 缩略图/卡片 */}
                  <div className="w-full mb-2 group-hover:scale-[1.02] transition-transform">
                    <ObjectThumbnail
                      item={item}
                      bucket={currentBucket}
                      client={s3Client}
                      viewMode="grid"
                    />
                  </div>

                  {/* 名称 */}
                  <div className="w-full text-xs font-medium text-slate-200 truncate px-1" title={item.name}>
                    {item.name}
                  </div>

                  {/* 属性 */}
                  <div className="text-[10px] text-slate-500 mt-0.5">
                    {item.isDirectory ? '文件夹' : formatBytes(item.size)}
                  </div>

                  {/* 浮动快捷操作栏 */}
                  <div
                    onClick={(e) => e.stopPropagation()}
                    className="absolute inset-x-2 bottom-2 z-10 bg-slate-950/95 border border-slate-800 rounded-xl py-1 px-2 flex items-center justify-around opacity-0 group-hover:opacity-100 transition shadow-lg text-xs"
                  >
                    {!item.isDirectory && (
                      <button
                        onClick={() => setPreviewTarget(item)}
                        title="在线预览"
                        className="hover:text-emerald-400 p-1"
                      >
                        👁️
                      </button>
                    )}
                    {!item.isDirectory && (
                      <button
                        onClick={(e) => handleDownloadItem(item, e)}
                        title="下载文件"
                        className="hover:text-emerald-400 p-1"
                      >
                        ⬇️
                      </button>
                    )}
                    {!item.isDirectory && (
                      <button
                        onClick={() => setShareTarget(item)}
                        title="分享外链"
                        className="hover:text-emerald-400 p-1"
                      >
                        🔗
                      </button>
                    )}
                    <button
                      onClick={() => setRenameTarget(item)}
                      title="重命名"
                      className="hover:text-emerald-400 p-1"
                    >
                      ✏️
                    </button>
                    <button
                      onClick={(e) => handleDeleteItem(item, e)}
                      title="删除"
                      className="hover:text-rose-400 p-1"
                    >
                      🗑️
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          /* 列表视图 */
          <div className="bg-slate-900/50 border border-slate-800/80 rounded-2xl overflow-hidden">
            <div className="flex items-center px-4 py-2.5 bg-slate-900/90 border-b border-slate-800 text-[11px] font-medium text-slate-400">
              <div className="w-8 flex items-center">
                <input
                  type="checkbox"
                  checked={selectedKeys.size > 0 && selectedKeys.size === filteredAndSortedObjects.length}
                  onChange={handleSelectAll}
                  className="rounded border-slate-700 text-emerald-500 focus:ring-0"
                />
              </div>
              <div
                onClick={() => {
                  setSortBy('name')
                  setSortAsc(!sortAsc)
                }}
                className="flex-1 cursor-pointer hover:text-slate-200 flex items-center gap-1"
              >
                <span>名称</span>
                {sortBy === 'name' && <span>{sortAsc ? '↑' : '↓'}</span>}
              </div>
              <div
                onClick={() => {
                  setSortBy('size')
                  setSortAsc(!sortAsc)
                }}
                className="w-28 text-right cursor-pointer hover:text-slate-200 flex items-center justify-end gap-1"
              >
                <span>大小</span>
                {sortBy === 'size' && <span>{sortAsc ? '↑' : '↓'}</span>}
              </div>
              <div
                onClick={() => {
                  setSortBy('time')
                  setSortAsc(!sortAsc)
                }}
                className="w-40 text-right cursor-pointer hover:text-slate-200 flex items-center justify-end gap-1"
              >
                <span>修改时间</span>
                {sortBy === 'time' && <span>{sortAsc ? '↑' : '↓'}</span>}
              </div>
              <div className="w-36 text-center">操作</div>
            </div>

            <div className="divide-y divide-slate-800/50 text-xs">
              {filteredAndSortedObjects.map((item) => {
                const isSelected = selectedKeys.has(item.key)

                return (
                  <div
                    key={item.key}
                    onClick={() => {
                      if (item.isDirectory) {
                        navigateToPrefix(item.key)
                      } else {
                        setPreviewTarget(item)
                      }
                    }}
                    className={`flex items-center px-4 py-2 cursor-pointer transition ${
                      isSelected ? 'bg-emerald-950/30 text-emerald-300' : 'hover:bg-slate-800/40 text-slate-200'
                    }`}
                  >
                    <div className="w-8 flex items-center" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => {
                          const next = new Set(selectedKeys)
                          if (next.has(item.key)) next.delete(item.key)
                          else next.add(item.key)
                          setSelectedKeys(next)
                        }}
                        className="rounded border-slate-700 text-emerald-500 focus:ring-0"
                      />
                    </div>

                    <div className="flex-1 flex items-center gap-3 truncate min-w-0 pr-4">
                      <ObjectThumbnail
                        item={item}
                        bucket={currentBucket}
                        client={s3Client}
                        viewMode="list"
                      />
                      <span className="font-medium truncate" title={item.name}>{item.name}</span>
                    </div>

                    <div className="w-28 text-right text-slate-400 font-mono text-[11px]">
                      {item.isDirectory ? '-' : formatBytes(item.size)}
                    </div>

                    <div className="w-40 text-right text-slate-500 text-[11px]">
                      {formatDate(item.lastModified)}
                    </div>

                    <div
                      className="w-36 flex items-center justify-center gap-1"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {!item.isDirectory && (
                        <button
                          onClick={() => setPreviewTarget(item)}
                          title="在线预览"
                          className="p-1 rounded hover:bg-slate-700 text-slate-400 hover:text-emerald-300"
                        >
                          👁️
                        </button>
                      )}
                      {!item.isDirectory && (
                        <button
                          onClick={(e) => handleDownloadItem(item, e)}
                          title="下载"
                          className="p-1 rounded hover:bg-slate-700 text-slate-400 hover:text-emerald-300"
                        >
                          ⬇️
                        </button>
                      )}
                      {!item.isDirectory && (
                        <button
                          onClick={() => setShareTarget(item)}
                          title="外链分享"
                          className="p-1 rounded hover:bg-slate-700 text-slate-400 hover:text-emerald-300"
                        >
                          🔗
                        </button>
                      )}
                      <button
                        onClick={() => setRenameTarget(item)}
                        title="重命名"
                        className="p-1 rounded hover:bg-slate-700 text-slate-400 hover:text-emerald-300"
                      >
                        ✏️
                      </button>
                      <button
                        onClick={(e) => handleDeleteItem(item, e)}
                        title="删除"
                        className="p-1 rounded hover:bg-slate-700 text-slate-400 hover:text-rose-400"
                      >
                        🗑️
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </main>

      {/* 底部状态栏 */}
      <footer className="h-8 border-t border-slate-800/80 bg-slate-900/90 flex items-center justify-between px-4 text-[11px] text-slate-500 flex-shrink-0">
        <div className="flex items-center gap-3">
          {activeProfile && (
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              <span>{activeProfile.name} ({activeProfile.endpoint})</span>
            </span>
          )}
          {currentBucket && (
            <span>
              Bucket: <span className="font-mono text-slate-400">{currentBucket}</span>
            </span>
          )}
        </div>

        <div className="flex items-center gap-4">
          <span>文件数: {totalStats.count}</span>
          <span>总大小: {formatBytes(totalStats.size)}</span>
          {selectedKeys.size > 0 && (
            <span className="text-emerald-400 font-medium">已选中: {selectedKeys.size}</span>
          )}
        </div>
      </footer>

      {/* 模态框组 */}
      <ProfileModal
        isOpen={showProfileModal}
        onClose={() => setShowProfileModal(false)}
        profiles={profiles}
        activeProfileId={activeProfile?.id || null}
        onSaveProfile={handleSaveProfile}
        onDeleteProfile={handleDeleteProfile}
        onSelectProfile={(id) => {
          setActiveProfileIdState(id)
          setActiveProfileId(id)
        }}
      />

      {s3Client && (
        <UploadModal
          isOpen={showUploadModal}
          onClose={() => setShowUploadModal(false)}
          client={s3Client}
          bucket={currentBucket}
          currentPrefix={currentPrefix}
          onUploadSuccess={loadObjects}
        />
      )}

      {s3Client && (
        <PreviewModal
          isOpen={!!previewTarget}
          onClose={() => setPreviewTarget(null)}
          item={previewTarget}
          bucket={currentBucket}
          client={s3Client}
        />
      )}

      {s3Client && (
        <ShareModal
          isOpen={!!shareTarget}
          onClose={() => setShareTarget(null)}
          item={shareTarget}
          bucket={currentBucket}
          client={s3Client}
        />
      )}

      <NewFolderModal
        isOpen={showNewFolderModal}
        onClose={() => setShowNewFolderModal(false)}
        currentPrefix={currentPrefix}
        onCreate={async (name) => {
          if (s3Client && currentBucket) {
            await s3Client.createFolder(currentBucket, currentPrefix, name)
            loadObjects()
          }
        }}
      />

      <RenameModal
        isOpen={!!renameTarget}
        onClose={() => setRenameTarget(null)}
        item={renameTarget}
        currentPrefix={currentPrefix}
        onRename={async (oldKey, newKey) => {
          if (s3Client && currentBucket) {
            await s3Client.renameObject(currentBucket, oldKey, newKey)
            loadObjects()
          }
        }}
      />
    </div>
  )
}
