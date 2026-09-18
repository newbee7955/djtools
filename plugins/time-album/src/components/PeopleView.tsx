import React, { useState } from 'react'
import { PersonProfile, PhotoItem } from '../types/album'
import {
  createPerson,
  renamePerson,
  deletePerson,
  removePhotoFromPerson,
  setPersonAvatar,
  addPhotoToPerson,
  getStoredPeople
} from '../lib/people-store'
import { getThumbnail } from '../lib/thumbnail-cache'
import { IdleClusterService, IdleClusterState } from '../lib/idle-cluster-service'
import { reconcilePeopleForPhotos } from '../lib/album-source-change'

const FaceModelModal = React.lazy(() =>
  import('./FaceModelModal').then((m) => ({ default: m.FaceModelModal }))
)

/**
 * Avatar Thumbnail that gracefully falls back to IndexedDB cache or workspace
 */
const PersonAvatarThumb: React.FC<{
  photo?: PhotoItem | null
  name: string
  className?: string
}> = ({ photo, name, className = 'w-full h-full object-cover transition-transform duration-300 group-hover:scale-105' }) => {
  const [url, setUrl] = useState<string | null>(photo?.thumbnailUrl || photo?.dataUrl || null)

  React.useEffect(() => {
    if (photo?.thumbnailUrl || photo?.dataUrl) {
      setUrl(photo.thumbnailUrl || photo.dataUrl || null)
      return
    }
    if (!photo) {
      setUrl(null)
      return
    }
    let isMounted = true
    getThumbnail(photo.relativePath).then(async (t) => {
      if (!isMounted) return
      if (t) {
        setUrl(t)
        return
      }
      const sdk = (window as any).doujiaoSDK
      if (sdk?.workspace) {
        try {
          const fileData = await sdk.workspace.readFile(photo.relativePath, 'time-album')
          if (isMounted && fileData) setUrl(fileData)
        } catch {}
      }
    })
    return () => {
      isMounted = false
    }
  }, [photo])

  if (url) {
    return <img src={url} alt={name} className={className} />
  }
  return <span className="text-3xl opacity-50 select-none">👤</span>
}

interface PeopleViewProps {
  people: PersonProfile[]
  photos: PhotoItem[]
  idleState?: IdleClusterState
  onUpdatePeople: (people: PersonProfile[]) => void
  onSelectPhoto: (photo: PhotoItem) => void
  onPlaySlideshow: (photos: PhotoItem[]) => void
  onToast: (msg: string) => void
}

export const PeopleView: React.FC<PeopleViewProps> = ({
  people,
  photos,
  idleState,
  onUpdatePeople,
  onSelectPhoto,
  onPlaySlideshow,
  onToast
}) => {
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [showFaceModelModal, setShowFaceModelModal] = useState(false)
  const [showRecommendation, setShowRecommendation] = useState(true)
  const [newPersonName, setNewPersonName] = useState('')
  const [editingPersonId, setEditingPersonId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [showAddPhotosModal, setShowAddPhotosModal] = useState(false)
  const [selectedAddPhotoIds, setSelectedAddPhotoIds] = useState<string[]>([])
  const [showIdleHelpModal, setShowIdleHelpModal] = useState(false)
  const [isForceRunning, setIsForceRunning] = useState(false)

  // Subscribe to IdleClusterService if not passed from parent
  const [internalIdleState, setInternalIdleState] = useState<IdleClusterState>(
    () => idleState || IdleClusterService.getInstance().getState()
  )

  React.useEffect(() => {
    if (idleState) {
      setInternalIdleState(idleState)
    } else {
      const unsub = IdleClusterService.getInstance().subscribe(setInternalIdleState)
      return unsub
    }
  }, [idleState])

  const currentIdleState = idleState || internalIdleState

  const handleForceRun = async () => {
    if (photos.length === 0) {
      onToast('当前相册暂无照片')
      return
    }
    // 若当前人物数为 0 且面孔数为 0，但照片已被标记过（因之前跨域错误被判为 0 人脸），自动转为全量重聚
    if (
      displayPeople.length === 0 &&
      currentIdleState.facesFoundCount === 0 &&
      currentIdleState.processedCount >= photos.length
    ) {
      await handleResetAndRecluster(true)
      return
    }

    try {
      setIsForceRunning(true)
      onToast('⚡ 正在全速提取人脸特征并执行增量聚类...')
      await IdleClusterService.getInstance().forceRunAll()
      const freshPeople = getStoredPeople()
      onUpdatePeople(freshPeople)
      onToast('✨ 增量人脸聚类完成！')
    } catch (err: any) {
      if (err?.message?.includes('尚未下载')) {
        setShowFaceModelModal(true)
      } else {
        alert(err.message || '聚类失败')
      }
    } finally {
      setIsForceRunning(false)
    }
  }

  const handleResetAndRecluster = async (skipConfirm = false) => {
    if (photos.length === 0) {
      onToast('当前相册暂无照片')
      return
    }
    if (!skipConfirm) {
      const confirmed = window.confirm(
        '确定要清空并全量重新聚类吗？\n\n' +
        '• 将清空当前所有人物相册分组与自定义的人物名称；\n' +
        '• 重新提取相册中照片人脸特征并从零构建人物关系。'
      )
      if (!confirmed) return
    }

    try {
      setIsForceRunning(true)
      onUpdatePeople([])
      onToast('🔄 正在全量重新提取人脸特征并构建人物分类...')
      await IdleClusterService.getInstance().resetAndReclusterAll()
      const freshPeople = getStoredPeople()
      onUpdatePeople(freshPeople)
      onToast(`✨ 全量重新聚类完成！已归整 ${freshPeople.length} 位人物`)
    } catch (err: any) {
      alert(err?.message || '重聚类失败')
    } finally {
      setIsForceRunning(false)
    }
  }

  // Fast map to find photo by ID
  const photoMap = React.useMemo(() => {
    const map = new Map<string, PhotoItem>()
    for (const p of photos) {
      map.set(p.id, p)
    }
    return map
  }, [photos])

  // Only display people that belong to the current album (have at least 1 photo in photoMap or were created empty)
  const displayPeople = React.useMemo(() => {
    if (photos.length === 0) return people
    return people.filter(
      (p) => p.photoIds.length === 0 || p.photoIds.some((id) => photoMap.has(id))
    )
  }, [people, photos, photoMap])

  // Auto reconcile: if any people have photoIds that do not belong to current photo pool, prune or clear them
  React.useEffect(() => {
    if (photos.length === 0 || people.length === 0) return
    const currentPhotoIdSet = new Set(photos.map((p) => p.id))
    const hasStale = people.some(
      (p) => p.photoIds.length > 0 && !p.photoIds.some((id) => currentPhotoIdSet.has(id))
    )
    if (hasStale) {
      const reconciled = reconcilePeopleForPhotos(people, photos.map((p) => p.id))
      onUpdatePeople(reconciled.people)
      if (reconciled.removedStaleSource) {
        onToast('已自动清理上一数据源遗留的人物分类')
      }
    }
  }, [photos, people, onUpdatePeople, onToast])


  // Photos tagged with "人像" that are not yet assigned to ANY person
  const unassignedPortraitPhotos = React.useMemo(() => {
    const allAssignedIds = new Set<string>()
    for (const p of people) {
      for (const id of p.photoIds) {
        allAssignedIds.add(id)
      }
    }
    return photos.filter((p) => {
      const hasPortraitTag = p.aiTags?.includes('人像') || p.tags?.includes('人像')
      return hasPortraitTag && !allAssignedIds.has(p.id)
    })
  }, [photos, people])

  // Currently selected person
  const currentPerson = people.find((p) => p.id === selectedPersonId)

  // Photos for current person
  const currentPersonPhotos = React.useMemo(() => {
    if (!currentPerson) return []
    return currentPerson.photoIds
      .map((id) => photoMap.get(id))
      .filter((p): p is PhotoItem => Boolean(p))
  }, [currentPerson, photoMap])

  // Handle create new person
  const handleCreatePerson = (initialIds: string[] = []) => {
    const name = newPersonName.trim() || `人物 ${people.length + 1}`
    const newPerson = createPerson(name, initialIds)
    onUpdatePeople([...people, newPerson])
    setNewPersonName('')
    setIsCreating(false)
    setSelectedPersonId(newPerson.id)
  }

  // Handle rename
  const handleSaveRename = (personId: string) => {
    if (editName.trim()) {
      renamePerson(personId, editName.trim())
      onUpdatePeople(
        people.map((p) => (p.id === personId ? { ...p, name: editName.trim() } : p))
      )
    }
    setEditingPersonId(null)
  }

  // Handle delete person
  const handleDeletePerson = (personId: string, name: string) => {
    if (window.confirm(`确定要删除人物「${name}」吗？（照片本身不会被删除）`)) {
      deletePerson(personId)
      onUpdatePeople(people.filter((p) => p.id !== personId))
      if (selectedPersonId === personId) {
        setSelectedPersonId(null)
      }
    }
  }

  // Handle remove photo from person
  const handleRemovePhoto = (photoId: string) => {
    if (!currentPerson) return
    removePhotoFromPerson(currentPerson.id, photoId)
    onUpdatePeople(
      people.map((p) =>
        p.id === currentPerson.id
          ? { ...p, photoIds: p.photoIds.filter((id) => id !== photoId) }
          : p
      )
    )
  }

  // Handle set avatar
  const handleSetAvatar = (photoId: string) => {
    if (!currentPerson) return
    setPersonAvatar(currentPerson.id, photoId)
    onUpdatePeople(
      people.map((p) =>
        p.id === currentPerson.id ? { ...p, avatarPhotoId: photoId } : p
      )
    )
  }

  // Batch add photos to current person
  const handleBatchAddPhotos = () => {
    if (!currentPerson || selectedAddPhotoIds.length === 0) return
    for (const pid of selectedAddPhotoIds) {
      addPhotoToPerson(currentPerson.id, pid)
    }
    const updatedIds = Array.from(new Set([...currentPerson.photoIds, ...selectedAddPhotoIds]))
    onUpdatePeople(
      people.map((p) =>
        p.id === currentPerson.id
          ? {
              ...p,
              photoIds: updatedIds,
              avatarPhotoId: p.avatarPhotoId || updatedIds[0]
            }
          : p
      )
    )
    setSelectedAddPhotoIds([])
    setShowAddPhotosModal(false)
  }

  // --- Sub-view: Single Person Album ---
  if (currentPerson) {
    return (
      <div className="space-y-6">
        {/* Person Header */}
        <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-border/60">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setSelectedPersonId(null)}
              className="p-2 rounded-xl bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              title="返回所有人物"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" />
              </svg>
            </button>

            {/* Avatar */}
            <div className="w-14 h-14 rounded-full overflow-hidden bg-primary/10 border-2 border-primary/30 flex items-center justify-center flex-shrink-0 shadow-sm">
              {currentPerson.avatarPhotoId && photoMap.get(currentPerson.avatarPhotoId) ? (
                <img
                  src={
                    photoMap.get(currentPerson.avatarPhotoId)?.thumbnailUrl ||
                    photoMap.get(currentPerson.avatarPhotoId)?.dataUrl
                  }
                  alt={currentPerson.name}
                  className="w-full h-full object-cover"
                />
              ) : (
                <span className="text-2xl">👤</span>
              )}
            </div>

            <div>
              {editingPersonId === currentPerson.id ? (
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSaveRename(currentPerson.id)
                      if (e.key === 'Escape') setEditingPersonId(null)
                    }}
                    autoFocus
                    className="px-2.5 py-1 text-base font-bold rounded-lg border border-primary bg-background focus:outline-none"
                  />
                  <button
                    onClick={() => handleSaveRename(currentPerson.id)}
                    className="px-2.5 py-1 rounded-lg bg-primary text-primary-foreground text-xs font-medium"
                  >
                    保存
                  </button>
                  <button
                    onClick={() => setEditingPersonId(null)}
                    className="px-2.5 py-1 rounded-lg bg-muted text-muted-foreground text-xs"
                  >
                    取消
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <h2 className="text-xl font-bold tracking-tight text-foreground">
                    {currentPerson.name}
                  </h2>
                  <button
                    onClick={() => {
                      setEditingPersonId(currentPerson.id)
                      setEditName(currentPerson.name)
                    }}
                    className="p-1 text-muted-foreground hover:text-foreground rounded transition-colors"
                    title="修改姓名"
                  >
                    ✏️
                  </button>
                </div>
              )}
              <p className="text-xs text-muted-foreground mt-0.5">
                共 {currentPersonPhotos.length} 张照片
              </p>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowAddPhotosModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-muted/60 hover:bg-muted text-foreground text-xs font-medium border border-border/40 transition-colors shadow-2xs"
            >
              <span>➕</span>
              <span>添加照片</span>
            </button>
            <button
              onClick={() => onPlaySlideshow(currentPersonPhotos)}
              disabled={currentPersonPhotos.length === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-medium shadow-xs disabled:opacity-50 transition-all"
            >
              <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
              <span>人物画卷</span>
            </button>
            <button
              onClick={() => handleDeletePerson(currentPerson.id, currentPerson.name)}
              className="p-2 rounded-xl text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
              title="删除此人物"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          </div>
        </div>

        {/* Photos Grid */}
        {currentPersonPhotos.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
            <div className="text-4xl mb-3 opacity-50">🖼️</div>
            <p className="text-sm font-medium">该人物在当前相册中暂无照片</p>
            <p className="text-xs text-muted-foreground/70 mt-1 max-w-sm text-center">
              {currentPerson.photoIds.length > 0
                ? '该分类关联的照片均属于其他相册源。您可以删除此分类，或点击「添加照片」关联当前相册照片。'
                : '点击上方「添加照片」或在大图查看器右侧详情中将照片归入此人物'}
            </p>
            <div className="flex items-center gap-3 mt-4">
              <button
                onClick={() => setShowAddPhotosModal(true)}
                className="px-4 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-medium shadow-xs"
              >
                立即挑选照片
              </button>
              {currentPerson.photoIds.length > 0 && (
                <button
                  onClick={() => handleDeletePerson(currentPerson.id, currentPerson.name)}
                  className="px-4 py-2 rounded-xl bg-destructive/10 text-destructive hover:bg-destructive/20 text-xs font-medium transition-colors"
                >
                  删除此残留分类
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {currentPersonPhotos.map((photo) => {
              const isAvatar = currentPerson.avatarPhotoId === photo.id
              return (
                <div
                  key={photo.id}
                  className="group relative rounded-xl overflow-hidden aspect-square bg-muted/40 border border-border/40 shadow-xs hover:shadow-md transition-all duration-200"
                >
                  <img
                    src={photo.thumbnailUrl || photo.dataUrl}
                    alt={photo.name}
                    loading="lazy"
                    onClick={() => onSelectPhoto(photo)}
                    className="w-full h-full object-cover cursor-pointer transition-transform duration-300 group-hover:scale-105"
                  />

                  {/* Avatar badge */}
                  {isAvatar && (
                    <div className="absolute top-2 left-2 z-10 px-1.5 py-0.5 rounded-full bg-primary/90 text-primary-foreground text-[10px] font-medium shadow-xs backdrop-blur-xs flex items-center gap-1">
                      <span>👑</span>
                      <span>头像</span>
                    </div>
                  )}

                  {/* Hover Actions overlay */}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-between p-2 pointer-events-none">
                    <div className="flex items-center justify-end gap-1 pointer-events-auto">
                      {!isAvatar && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            handleSetAvatar(photo.id)
                          }}
                          className="px-2 py-1 rounded bg-black/60 hover:bg-black/90 text-white text-[10px] backdrop-blur-xs transition-colors"
                          title="设为人物封面头像"
                        >
                          设为头像
                        </button>
                      )}
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          handleRemovePhoto(photo.id)
                        }}
                        className="p-1 rounded bg-red-600/80 hover:bg-red-600 text-white text-[10px] transition-colors"
                        title="从该人物中移除"
                      >
                        ✕
                      </button>
                    </div>

                    <div className="pointer-events-auto">
                      <p className="text-[11px] text-white font-medium truncate drop-shadow-xs">
                        {photo.name}
                      </p>
                      <p className="text-[10px] text-white/70">{photo.dateStr}</p>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Modal: Add Photos to Person */}
        {showAddPhotosModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4 select-none animate-in fade-in duration-150">
            <div className="bg-card border border-border text-card-foreground rounded-2xl max-w-2xl w-full max-h-[85vh] flex flex-col shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150">
              <div className="p-4 border-b border-border/60 flex items-center justify-between">
                <div>
                  <h3 className="text-base font-bold text-foreground">
                    为「{currentPerson.name}」添加照片
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    已勾选 {selectedAddPhotoIds.length} 张照片
                  </p>
                </div>
                <button
                  onClick={() => {
                    setShowAddPhotosModal(false)
                    setSelectedAddPhotoIds([])
                  }}
                  className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors text-xs"
                >
                  ✕
                </button>
              </div>

              {/* Grid of photos to select */}
              <div className="flex-1 overflow-y-auto p-4 grid grid-cols-4 sm:grid-cols-6 gap-2.5 custom-scrollbar">
                {photos.map((photo) => {
                  const isAlreadyIn = currentPerson.photoIds.includes(photo.id)
                  const isSelected = selectedAddPhotoIds.includes(photo.id)

                  return (
                    <div
                      key={photo.id}
                      onClick={() => {
                        if (isAlreadyIn) return
                        if (isSelected) {
                          setSelectedAddPhotoIds((prev) => prev.filter((id) => id !== photo.id))
                        } else {
                          setSelectedAddPhotoIds((prev) => [...prev, photo.id])
                        }
                      }}
                      className={`relative aspect-square rounded-xl overflow-hidden cursor-pointer border transition-all ${
                        isAlreadyIn
                          ? 'opacity-40 border-border pointer-events-none'
                          : isSelected
                          ? 'ring-2 ring-primary border-transparent shadow-xs'
                          : 'border-border/60 hover:border-primary/50'
                      }`}
                    >
                      <img
                        src={photo.thumbnailUrl || photo.dataUrl}
                        alt={photo.name}
                        className="w-full h-full object-cover"
                      />
                      {isAlreadyIn && (
                        <div className="absolute inset-0 bg-black/60 flex items-center justify-center text-[10px] font-medium text-white">
                          已添加
                        </div>
                      )}
                      {isSelected && (
                        <div className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs shadow-xs font-bold">
                          ✓
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              {/* Footer */}
              <div className="p-4 border-t border-border/60 flex items-center justify-end gap-2 bg-muted/30">
                <button
                  onClick={() => {
                    setShowAddPhotosModal(false)
                    setSelectedAddPhotoIds([])
                  }}
                  className="px-3.5 py-1.5 rounded-xl border border-border hover:bg-muted text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={handleBatchAddPhotos}
                  disabled={selectedAddPhotoIds.length === 0}
                  className="px-4 py-1.5 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-medium shadow-xs disabled:opacity-50 transition-colors"
                >
                  确定添加 ({selectedAddPhotoIds.length})
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  // --- Main View: All People Grid ---
  return (
    <div className="space-y-4">
      {/* Top Toolbar: Compact & Clean */}
      <div className="flex items-center justify-between gap-4 pb-2.5 border-b border-border/50">
        <div className="flex items-center gap-3">
          <h2 className="text-base font-bold tracking-tight text-foreground flex items-center gap-2">
            <span>👥 人物相册</span>
            <span className="text-xs px-2.5 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
              {people.length} 位人物
            </span>
          </h2>
          <span className="text-xs text-muted-foreground hidden sm:inline">
            已智能聚合识别照片面孔，点击人物卡片进入专属回忆相册
          </span>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowFaceModelModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-500/15 hover:bg-indigo-500/25 text-indigo-600 dark:text-indigo-300 border border-indigo-500/30 text-xs font-medium transition-all shadow-2xs active:scale-95"
            title="启动端侧离线深度神经网络自动聚类人脸"
          >
            <span>⚡</span>
            <span>深度人脸聚类</span>
          </button>
          <button
            onClick={() => setIsCreating(true)}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-medium shadow-xs transition-all active:scale-95"
          >
            <span>➕</span>
            <span>新建人物</span>
          </button>
        </div>
      </div>

      {/* Background Idle Clustering Status Card */}
      {(() => {
        const isAllCompleted =
          currentIdleState.status === 'completed' ||
          (currentIdleState.totalCount > 0 && currentIdleState.processedCount >= currentIdleState.totalCount)
        const percent = Math.min(
          100,
          Math.round((currentIdleState.processedCount / Math.max(1, currentIdleState.totalCount)) * 100)
        )

        return (
          <div className="p-3.5 sm:p-4 rounded-2xl bg-card border border-border shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-3.5 text-xs animate-in fade-in duration-150">
            {/* Left: Status Icon & Details */}
            <div className="flex items-start sm:items-center gap-3 min-w-0 flex-1">
              <div
                className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 text-base shadow-xs ${
                  isAllCompleted
                    ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30'
                    : currentIdleState.status === 'analyzing'
                    ? 'bg-primary/15 text-primary border border-primary/30 animate-pulse'
                    : currentIdleState.status === 'no_model'
                    ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30'
                    : 'bg-muted text-foreground border border-border/60'
                }`}
              >
                {isAllCompleted && <span>✓</span>}
                {!isAllCompleted && currentIdleState.status === 'no_model' && <span>⚠️</span>}
                {!isAllCompleted && currentIdleState.status === 'analyzing' && <span>🍃</span>}
                {!isAllCompleted && currentIdleState.status === 'idle' && <span>🍃</span>}
                {!isAllCompleted && currentIdleState.status === 'paused' && <span>⏸️</span>}
                {!isAllCompleted &&
                  (currentIdleState.status === 'uninitialized' || currentIdleState.status === 'error') && (
                    <span>🤖</span>
                  )}
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold text-foreground text-sm flex items-center gap-1.5">
                    {isAllCompleted ? (
                      <>
                        <span className="text-emerald-500">✓</span>
                        <span>
                          人脸扫描与聚类已全部完成 ({currentIdleState.totalCount}/{currentIdleState.totalCount})
                        </span>
                      </>
                    ) : currentIdleState.status === 'no_model' ? (
                      '离线人脸识别模型未就绪'
                    ) : currentIdleState.status === 'analyzing' ? (
                      `后台空闲扫描归类中 (${currentIdleState.processedCount} / ${currentIdleState.totalCount})`
                    ) : currentIdleState.status === 'paused' ? (
                      `后台空闲聚类暂停中 (${currentIdleState.processedCount} / ${currentIdleState.totalCount})`
                    ) : currentIdleState.status === 'error' ? (
                      '人脸模型装载异常，请重新加载'
                    ) : (
                      `后台空闲聚类就绪 (${currentIdleState.processedCount} / ${currentIdleState.totalCount} 张已扫描)`
                    )}
                  </span>

                  {/* Badges */}
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 font-medium border border-blue-500/20">
                    ⚡ 增量模式
                  </span>

                  {isAllCompleted ? (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 font-bold border border-emerald-500/30">
                      已 100% 增量归整
                    </span>
                  ) : currentIdleState.totalCount > 0 ? (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary font-bold border border-primary/20">
                      进度 {percent}%
                    </span>
                  ) : null}

                  {currentIdleState.facesFoundCount > 0 && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 font-medium border border-indigo-500/20">
                      已识别 {currentIdleState.facesFoundCount} 处面孔
                    </span>
                  )}
                </div>

                <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                  {isAllCompleted &&
                    `全量照片人脸特征已持久化并增量归聚至 ${people.length} 位人物。新导入照片将在后台空闲时毫秒级自动追加识别，不影响已有命名`}
                  {!isAllCompleted &&
                    currentIdleState.status === 'no_model' &&
                    '下载约 6.6MB 端侧神经网络离线模型后即可完全离线自动识别归类'}
                  {!isAllCompleted &&
                    currentIdleState.status === 'analyzing' &&
                    `正在分析: ${currentIdleState.currentPhotoName || '提取面孔特征...'} • 零卡顿避让用户操作`}
                  {!isAllCompleted &&
                    currentIdleState.status === 'idle' &&
                    '静止 4 秒即平滑切片推进 • 内置 15 秒保底心跳保障绝不卡死'}
                  {!isAllCompleted &&
                    currentIdleState.status === 'paused' &&
                    '检测到用户活跃交互或正在查看全屏相册，主动避让以保持流畅'}
                </p>

                {/* Persistent Progress Bar */}
                {currentIdleState.totalCount > 0 && (
                  <div className="flex items-center gap-2.5 mt-2 w-full max-w-md">
                    <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden border border-border/40">
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${
                          isAllCompleted
                            ? 'bg-emerald-500'
                            : currentIdleState.status === 'analyzing'
                            ? 'bg-primary animate-pulse'
                            : 'bg-primary/70'
                        }`}
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                    <span className="text-[10px] font-mono text-muted-foreground shrink-0 font-medium">
                      {percent}%
                    </span>
                  </div>
                )}
              </div>
            </div>

        {/* Right: Toggle, Help & Actions */}
        <div className="flex items-center gap-2.5 flex-shrink-0 self-end sm:self-center">
          {/* Toggle background clustering */}
          <label className="flex items-center gap-1.5 cursor-pointer select-none text-xs text-muted-foreground hover:text-foreground transition-colors mr-1">
            <span>后台自动</span>
            <div
              onClick={(e) => {
                e.preventDefault()
                IdleClusterService.getInstance().setEnabled(!currentIdleState.enabled)
              }}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                currentIdleState.enabled ? 'bg-primary' : 'bg-muted'
              }`}
            >
              <span
                className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-xs transition-transform ${
                  currentIdleState.enabled ? 'translate-x-4.5' : 'translate-x-1'
                }`}
              />
            </div>
          </label>

          {/* Explanation Button */}
          <button
            onClick={() => setShowIdleHelpModal(true)}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-muted/60 hover:bg-muted text-muted-foreground hover:text-foreground text-xs font-medium transition-colors"
            title="查看什么是空闲状态及保底心跳机制"
          >
            <span>💡</span>
            <span>什么是空闲？</span>
          </button>

          {/* Action Button: Download model, Reset recluster, or Force incremental run */}
          {currentIdleState.status === 'no_model' ? (
            <button
              onClick={() => setShowFaceModelModal(true)}
              className="px-3 py-1.5 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-medium shadow-xs transition-all active:scale-95"
            >
              下载模型
            </button>
          ) : (
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => handleResetAndRecluster()}
                disabled={isForceRunning}
                className="px-2.5 py-1.5 rounded-xl bg-muted/60 hover:bg-destructive/10 hover:text-destructive text-muted-foreground text-xs font-medium transition-colors active:scale-95 disabled:opacity-50 flex items-center gap-1"
                title="清空当前人物分类，并基于相册内全部照片从零执行全量重新聚类"
              >
                <span>🔄</span>
                <span className="hidden md:inline">全量重聚</span>
              </button>
              <button
                onClick={handleForceRun}
                disabled={isForceRunning}
                className="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium shadow-xs disabled:opacity-50 transition-all active:scale-95 flex items-center gap-1"
                title="跳过空闲等待，全速增量分析剩余照片并实时归入人物库"
              >
                <span>{isForceRunning ? '⏳' : '⚡'}</span>
                <span>{isForceRunning ? '聚类中...' : '立即增量聚类'}</span>
              </button>
            </div>
          )}
            </div>
          </div>
        )
      })()}

      {/* AI Smart Portrait Recommendation Card: Slim & Dismissible */}
      {showRecommendation && unassignedPortraitPhotos.length > 0 && (
        <div className="p-3 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-between gap-3 text-xs shadow-2xs animate-in fade-in duration-150">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="text-base flex-shrink-0">✨</span>
            <div className="min-w-0 truncate">
              <span className="font-semibold text-foreground">
                本地 AI 发现了 {unassignedPortraitPhotos.length} 张待归类的人像照片
              </span>
              <span className="text-muted-foreground ml-2 hidden md:inline">
                已自动识别人像特征，点击可快速归入新人物。
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={() => {
                const p = createPerson(`人物 ${people.length + 1}`, unassignedPortraitPhotos.map((item) => item.id))
                onUpdatePeople([...people, p])
                setSelectedPersonId(p.id)
              }}
              className="px-2.5 py-1 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 shadow-2xs"
            >
              一键归入新人物
            </button>
            <button
              onClick={() => setShowRecommendation(false)}
              className="text-muted-foreground hover:text-foreground text-xs p-1"
              title="关闭提示"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Create Person Inline Modal/Card */}
      {isCreating && (
        <div className="p-3.5 rounded-2xl bg-muted/40 border border-primary/40 flex items-center gap-3 shadow-sm animate-in fade-in duration-200">
          <span className="text-2xl">👤</span>
          <input
            type="text"
            placeholder="输入人物姓名（如 妈妈、张三、老友）..."
            value={newPersonName}
            onChange={(e) => setNewPersonName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreatePerson()
              if (e.key === 'Escape') setIsCreating(false)
            }}
            autoFocus
            className="flex-1 px-3 py-1.5 text-xs rounded-xl bg-background border border-border focus:border-primary focus:outline-none"
          />
          <button
            onClick={() => handleCreatePerson()}
            className="px-3 py-1.5 rounded-xl bg-primary text-primary-foreground text-xs font-medium shadow-xs"
          >
            确定创建
          </button>
          <button
            onClick={() => setIsCreating(false)}
            className="px-3 py-1.5 rounded-xl bg-muted text-muted-foreground hover:text-foreground text-xs"
          >
            取消
          </button>
        </div>
      )}

      {/* People Grid */}
      {displayPeople.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <div className="text-5xl mb-4 opacity-40">👥</div>
          <p className="text-base font-semibold text-foreground">暂无人物分类</p>
          <p className="text-xs text-muted-foreground/80 mt-1 max-w-sm text-center">
            点击上方「全量重聚」或「深度人脸聚类」自动归整，也可手动新建人物建立专属回忆相册。
          </p>
          <div className="flex items-center gap-3 mt-5">
            <button
              onClick={() => handleResetAndRecluster()}
              className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-xs font-medium shadow-xs hover:bg-indigo-500 flex items-center gap-1.5"
            >
              <span>🔄</span>
              <span>立即全量聚类</span>
            </button>
            <button
              onClick={() => setIsCreating(true)}
              className="px-4 py-2 rounded-xl bg-muted text-foreground text-xs font-medium border border-border/60 hover:bg-muted/80"
            >
              ➕ 手动新建人物
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
          {displayPeople.map((person) => {
            const validCount = person.photoIds.filter((id) => photoMap.has(id)).length
            const avatarPhoto = person.avatarPhotoId && photoMap.has(person.avatarPhotoId)
              ? photoMap.get(person.avatarPhotoId)
              : person.photoIds.find((id) => photoMap.has(id))
              ? photoMap.get(person.photoIds.find((id) => photoMap.has(id))!)
              : null

            return (
              <div
                key={person.id}
                onClick={() => setSelectedPersonId(person.id)}
                className="group relative flex flex-col items-center p-4 rounded-2xl bg-card hover:bg-muted/40 border border-border/50 hover:border-primary/40 shadow-xs hover:shadow-md cursor-pointer transition-all duration-200"
              >
                {/* Avatar Circle */}
                <div className="relative w-24 h-24 sm:w-28 sm:h-28 rounded-full overflow-hidden bg-primary/10 border-2 border-border group-hover:border-primary/60 transition-all flex items-center justify-center shadow-inner mb-3">
                  <PersonAvatarThumb photo={avatarPhoto} name={person.name} />
                </div>

                {/* Name */}
                <h3 className="text-sm font-bold text-foreground text-center truncate max-w-full group-hover:text-primary transition-colors">
                  {person.name}
                </h3>

                {/* Photo Count */}
                <span className="text-[11px] text-muted-foreground mt-0.5 font-medium">
                  {validCount > 0
                    ? `${validCount} 张照片`
                    : person.photoIds.length > 0
                    ? '当前无匹配照片'
                    : '0 张照片'}
                </span>

                {/* Delete button on hover */}
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    handleDeletePerson(person.id, person.name)
                  }}
                  className="absolute top-2.5 right-2.5 p-1 rounded-lg bg-muted/80 hover:bg-destructive text-muted-foreground hover:text-white opacity-0 group-hover:opacity-100 transition-all"
                  title="删除人物"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
            )
          })}
        </div>
      )}


      {/* Help Modal: What is Idle & Guarantee of Never Getting Stuck */}
      {showIdleHelpModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-xs p-4 select-none animate-in fade-in duration-150">
          <div className="bg-card text-foreground border border-border rounded-2xl max-w-xl w-full p-6 shadow-2xl flex flex-col gap-4 animate-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-3 border-b border-border/60">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center text-lg">
                  🍃
                </div>
                <div>
                  <h3 className="text-base font-bold text-foreground">
                    后台空闲自动聚类与防卡死机制
                  </h3>
                  <p className="text-[11px] text-muted-foreground">
                    零感知端侧运算，毫秒级避让与进度保证
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowIdleHelpModal(false)}
                className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors text-sm"
              >
                ✕
              </button>
            </div>

            {/* Modal Body */}
            <div className="space-y-4 text-xs text-foreground/90 overflow-y-auto max-h-[60vh] pr-1">
              {/* Question 1: How idle is defined */}
              <div className="p-3.5 rounded-xl bg-muted/40 border border-border/50 space-y-2">
                <div className="flex items-center gap-2 font-bold text-foreground text-sm">
                  <span>🌿</span>
                  <h4>一、怎么才算“空闲”？</h4>
                </div>
                <ul className="space-y-1.5 text-muted-foreground pl-5 list-disc leading-relaxed">
                  <li>
                    <strong className="text-foreground">全量交互毫秒级避让</strong>：系统实时监听鼠标位移、按键、滚轮、触控与页面滚动。只要您在操作相册，后台聚类会在 1 毫秒内让出计算资源，保证界面操作 0 卡顿。
                  </li>
                  <li>
                    <strong className="text-foreground">4 秒交互防抖（Debounce）</strong>：当您停止操作超过 4 秒无动作时，系统判定您已进入阅读或静止状态，自动唤醒空闲切片流水线。
                  </li>
                  <li>
                    <strong className="text-foreground">单张微切片（Time-Slicing）</strong>：每次空闲仅提取 1 张照片的面孔特征（耗时仅数十毫秒），随后立即通过定时器让出主线程事件循环重绘，绝不抢占 UI 渲染。
                  </li>
                  <li>
                    <strong className="text-foreground">沉浸场景主动挂起</strong>：在您全屏浏览大图、播放幻灯片或配置相册源时，后台聚类会自动休眠挂起。
                  </li>
                </ul>
              </div>

              {/* Question 2: Why it will never get stuck */}
              <div className="p-3.5 rounded-xl bg-muted/40 border border-border/50 space-y-2">
                <div className="flex items-center gap-2 font-bold text-foreground text-sm">
                  <span>🛡️</span>
                  <h4>二、会不会永远不会自动聚类？（为什么绝不卡死）</h4>
                </div>
                <ul className="space-y-1.5 text-muted-foreground pl-5 list-disc leading-relaxed">
                  <li>
                    <strong className="text-foreground">15 秒保底心跳推进机制</strong>：即便您一直在相册中持续微小移动鼠标、永远达不到连续 4 秒完全静止，内置的 15 秒心跳保底机制也会在两次动作微隙强行推进单张切片。因此<span className="text-emerald-600 dark:text-emerald-400 font-semibold">聚类进度绝不会无限等待，必然稳定向前！</span>
                  </li>
                  <li>
                    <strong className="text-foreground">IndexedDB 向量持久化</strong>：每张分析完的照片其 128 维人脸数学特征向量即刻写入本地持久数据库。即使中途关闭相册或刷新，已分析成果永远保留，下次打开直接从断点继续，绝不从 0 重来。
                  </li>
                  <li>
                    <strong className="text-foreground">坏图与免死标记</strong>：如遇损坏文件、无脸照片或加载超时的图片，自动写入跳过缓存，绝不反复死磕某一张图片导致死循环。
                  </li>
                  <li>
                    <strong className="text-foreground">支持随时一键全速聚类</strong>：若您不想等待空闲切片，随时点击「立即全速聚类」按钮，相册将在数秒内全速连续识别并完成归整。
                  </li>
                </ul>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="pt-2 border-t border-border/50 flex items-center justify-end">
              <button
                onClick={() => setShowIdleHelpModal(false)}
                className="px-4 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 shadow-xs transition-colors"
              >
                我知道了
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Offline Face Model & Clustering Modal */}
      {showFaceModelModal && (
        <React.Suspense fallback={null}>
          <FaceModelModal
            photos={photos}
            existingPeople={people}
            onClose={() => setShowFaceModelModal(false)}
            onUpdatePeople={onUpdatePeople}
            onToast={onToast}
          />
        </React.Suspense>
      )}
    </div>
  )
}
