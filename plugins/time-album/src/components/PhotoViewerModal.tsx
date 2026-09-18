import React, { useEffect, useState } from 'react'
import { PersonProfile, PhotoItem } from '../types/album'
import {
  addPhotoToPerson,
  removePhotoFromPerson,
  createPerson,
  addTagToPhoto,
  removeTagFromPhoto
} from '../lib/people-store'
import { getCachedPhotoFace } from '../lib/face-cache-store'

interface PhotoViewerModalProps {
  photo: PhotoItem | null
  photos: PhotoItem[]
  people: PersonProfile[]
  onClose: () => void
  onSelectPhoto: (photo: PhotoItem) => void
  onUpdatePeople: (people: PersonProfile[]) => void
  onUpdatePhoto: (updated: PhotoItem) => void
}

export const PhotoViewerModal: React.FC<PhotoViewerModalProps> = ({
  photo,
  photos,
  people,
  onClose,
  onSelectPhoto,
  onUpdatePeople,
  onUpdatePhoto
}) => {
  const [rotation, setRotation] = useState(0)
  const [scale, setScale] = useState(1)
  const [showInfo, setShowInfo] = useState(true)

  // Tag inputs & dropdown states
  const [newTagInput, setNewTagInput] = useState('')
  const [showPersonDropdown, setShowPersonDropdown] = useState(false)
  const [newPersonNameInput, setNewPersonNameInput] = useState('')

  // Reset transform when photo changes
  useEffect(() => {
    setRotation(0)
    setScale(1)
    setNewTagInput('')
    setShowPersonDropdown(false)
    setNewPersonNameInput('')
  }, [photo?.id])

  // Query face scanning cache for the current photo
  const [faceScanResult, setFaceScanResult] = useState<{ analyzed: boolean; faceCount: number } | null>(null)

  useEffect(() => {
    if (!photo) return
    let isMounted = true
    getCachedPhotoFace(photo.id).then((rec) => {
      if (!isMounted) return
      if (rec) {
        setFaceScanResult({ analyzed: true, faceCount: rec.faces ? rec.faces.length : 0 })
      } else {
        setFaceScanResult({ analyzed: false, faceCount: 0 })
      }
    })
    return () => {
      isMounted = false
    }
  }, [photo?.id])

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept when typing in inputs
      if (
        document.activeElement?.tagName === 'INPUT' ||
        document.activeElement?.tagName === 'TEXTAREA'
      ) {
        return
      }

      if (!photo) return
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowLeft') handlePrev()
      else if (e.key === 'ArrowRight') handleNext()
      else if (e.key === 'r' || e.key === 'R') handleRotate()
      else if (e.key === 'i' || e.key === 'I') setShowInfo((prev) => !prev)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [photo, photos])

  if (!photo) return null

  const currentIndex = photos.findIndex((p) => p.id === photo.id)
  const hasPrev = currentIndex > 0
  const hasNext = currentIndex !== -1 && currentIndex < photos.length - 1

  const handlePrev = () => {
    if (hasPrev) onSelectPhoto(photos[currentIndex - 1])
  }

  const handleNext = () => {
    if (hasNext) onSelectPhoto(photos[currentIndex + 1])
  }

  const handleRotate = () => {
    setRotation((prev) => (prev + 90) % 360)
  }

  const handleZoomIn = () => {
    setScale((prev) => Math.min(prev + 0.25, 3))
  }

  const handleZoomOut = () => {
    setScale((prev) => Math.max(prev - 0.25, 0.5))
  }

  const handleResetZoom = () => {
    setScale(1)
    setRotation(0)
  }

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
  }

  // Associated people for this photo
  const associatedPeople = people.filter((p) => p.photoIds.includes(photo.id))
  const unassociatedPeople = people.filter((p) => !p.photoIds.includes(photo.id))

  // Handle linking to a person
  const handleLinkPerson = (personId: string) => {
    addPhotoToPerson(personId, photo.id)
    const updatedPeople = people.map((p) =>
      p.id === personId
        ? {
            ...p,
            photoIds: Array.from(new Set([...p.photoIds, photo.id])),
            avatarPhotoId: p.avatarPhotoId || photo.id
          }
        : p
    )
    onUpdatePeople(updatedPeople)
    const currentPeopleIds = photo.peopleIds || []
    onUpdatePhoto({
      ...photo,
      peopleIds: Array.from(new Set([...currentPeopleIds, personId]))
    })
    setShowPersonDropdown(false)
  }

  // Handle unlinking from a person
  const handleUnlinkPerson = (personId: string) => {
    removePhotoFromPerson(personId, photo.id)
    const updatedPeople = people.map((p) =>
      p.id === personId
        ? {
            ...p,
            photoIds: p.photoIds.filter((id) => id !== photo.id),
            avatarPhotoId: p.avatarPhotoId === photo.id ? p.photoIds[0] || undefined : p.avatarPhotoId
          }
        : p
    )
    onUpdatePeople(updatedPeople)
    const currentPeopleIds = photo.peopleIds || []
    onUpdatePhoto({
      ...photo,
      peopleIds: currentPeopleIds.filter((id) => id !== personId)
    })
  }

  // Handle creating a new person and linking directly
  const handleCreateAndLinkPerson = () => {
    if (!newPersonNameInput.trim()) return
    const newPerson = createPerson(newPersonNameInput.trim(), [photo.id])
    onUpdatePeople([...people, newPerson])
    const currentPeopleIds = photo.peopleIds || []
    onUpdatePhoto({
      ...photo,
      peopleIds: [...currentPeopleIds, newPerson.id]
    })
    setNewPersonNameInput('')
    setShowPersonDropdown(false)
  }

  // Handle adding custom tag
  const handleAddTag = () => {
    const trimmed = newTagInput.trim()
    if (!trimmed) return
    const updatedUserTags = addTagToPhoto(photo.id, trimmed)
    const combinedTags = Array.from(
      new Set([...(photo.aiTags || []), ...updatedUserTags, ...(photo.tags || [])])
    )
    onUpdatePhoto({
      ...photo,
      userTags: updatedUserTags,
      tags: combinedTags
    })
    setNewTagInput('')
  }

  // Handle removing custom tag
  const handleRemoveTag = (tag: string) => {
    const updatedUserTags = removeTagFromPhoto(photo.id, tag)
    const combinedTags = Array.from(
      new Set([...(photo.aiTags || []), ...updatedUserTags])
    )
    onUpdatePhoto({
      ...photo,
      userTags: updatedUserTags,
      tags: combinedTags
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex bg-black/95 backdrop-blur-md text-white select-none">
      {/* Main View Area */}
      <div className="relative flex-1 flex flex-col h-full overflow-hidden">
        {/* Top Floating Bar */}
        <div className="absolute top-0 inset-x-0 z-20 flex items-center justify-between p-4 bg-gradient-to-b from-black/80 to-transparent">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-white/90 truncate max-w-xs md:max-w-md">
              {photo.name}
            </span>
            <span className="text-xs text-white/50">
              {currentIndex + 1} / {photos.length}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {/* Zoom Out */}
            <button
              onClick={handleZoomOut}
              className="p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors"
              title="缩小"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <circle cx="11" cy="11" r="8" strokeWidth="2" />
                <path strokeLinecap="round" strokeWidth="2" d="M8 11h6m7 10l-4.35-4.35" />
              </svg>
            </button>

            {/* Reset Zoom */}
            <button
              onClick={handleResetZoom}
              className="px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-xs font-mono text-white transition-colors"
              title="还原"
            >
              {Math.round(scale * 100)}%
            </button>

            {/* Zoom In */}
            <button
              onClick={handleZoomIn}
              className="p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors"
              title="放大"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <circle cx="11" cy="11" r="8" strokeWidth="2" />
                <path strokeLinecap="round" strokeWidth="2" d="M11 8v6m-3-3h6m7 10l-4.35-4.35" />
              </svg>
            </button>

            {/* Rotate */}
            <button
              onClick={handleRotate}
              className="p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors"
              title="向右旋转 90° (R)"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
            </button>

            {/* Toggle Info Sidebar */}
            <button
              onClick={() => setShowInfo(!showInfo)}
              className={`p-2 rounded-lg transition-colors ${
                showInfo ? 'bg-primary text-primary-foreground' : 'bg-white/10 hover:bg-white/20 text-white'
              }`}
              title="显示/隐藏详情 (I)"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10" strokeWidth="2" />
                <path strokeLinecap="round" strokeWidth="2" d="M12 16v-4m0-4h.01" />
              </svg>
            </button>

            {/* Close */}
            <button
              onClick={onClose}
              className="p-2 rounded-lg bg-white/10 hover:bg-red-500/80 text-white transition-colors ml-2"
              title="关闭 (ESC)"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Center Image Container */}
        <div className="flex-1 flex items-center justify-center p-8 overflow-hidden">
          <img
            src={photo.dataUrl || photo.thumbnailUrl}
            alt={photo.name}
            style={{
              transform: `scale(${scale}) rotate(${rotation}deg)`,
              transition: 'transform 0.15s ease-out'
            }}
            className="max-h-full max-w-full object-contain pointer-events-auto"
            draggable={false}
          />
        </div>

        {/* Previous & Next Navigation Buttons */}
        {hasPrev && (
          <button
            onClick={handlePrev}
            className="absolute left-4 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-black/40 hover:bg-black/80 backdrop-blur-md flex items-center justify-center text-white/80 hover:text-white transition-all shadow-lg"
            title="上一张 (←)"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        )}

        {hasNext && (
          <button
            onClick={handleNext}
            className="absolute right-4 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-black/40 hover:bg-black/80 backdrop-blur-md flex items-center justify-center text-white/80 hover:text-white transition-all shadow-lg"
            title="下一张 (→)"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        )}
      </div>

      {/* Photo Info & Metadata Sidebar */}
      {showInfo && (
        <div className="w-84 h-full bg-neutral-900/95 border-l border-white/10 p-5 flex flex-col gap-5 overflow-y-auto backdrop-blur-xl animate-in slide-in-from-right duration-200">
          {/* Section: Basic Info */}
          <div>
            <h4 className="text-xs uppercase tracking-wider text-white/40 font-semibold mb-3">
              照片信息
            </h4>
            <div className="space-y-2 text-xs">
              <div>
                <span className="text-white/40 block">文件名</span>
                <span className="text-white/90 break-all font-medium">{photo.name}</span>
              </div>
              <div>
                <span className="text-white/40 block">拍摄时间</span>
                <span className="text-white/90">
                  {photo.exif?.dateTimeOriginal || photo.date.toLocaleString()}
                </span>
              </div>
              <div>
                <span className="text-white/40 block">文件大小</span>
                <span className="text-white/90">{formatFileSize(photo.size)}</span>
              </div>
              <div>
                <span className="text-white/40 block">相对路径</span>
                <span className="text-white/70 break-all font-mono text-[11px]">
                  {photo.relativePath}
                </span>
              </div>
            </div>
          </div>

          {/* Section: Associated People */}
          <div className="border-t border-white/10 pt-4">
            <div className="flex items-center justify-between mb-2.5">
              <h4 className="text-xs uppercase tracking-wider text-white/40 font-semibold flex items-center gap-1.5">
                <span>👥</span>
                <span>关联人物</span>
              </h4>
              <button
                onClick={() => setShowPersonDropdown(!showPersonDropdown)}
                className="text-xs text-primary hover:underline flex items-center gap-1"
              >
                <span>➕ 归入人物</span>
              </button>
            </div>

            {/* Face Analysis Status for this photo */}
            <div className="mb-2.5 px-2.5 py-1.5 rounded-xl bg-white/5 border border-white/10 text-xs flex items-center justify-between select-none">
              <span className="text-white/50 flex items-center gap-1">
                <span>🤖</span>
                <span>人脸扫描</span>
              </span>
              {faceScanResult?.analyzed ? (
                faceScanResult.faceCount > 0 ? (
                  <span className="text-emerald-400 font-medium flex items-center gap-1">
                    <span>✓ 已识别 {faceScanResult.faceCount} 处面孔</span>
                  </span>
                ) : (
                  <span className="text-white/60 font-medium">
                    ✓ 已扫描 (未检测到人脸)
                  </span>
                )
              ) : (
                <span className="text-amber-400/80 font-medium flex items-center gap-1">
                  <span>⏳ 等待空闲扫描</span>
                </span>
              )}
            </div>

            {/* Current associated people pills */}
            <div className="flex flex-wrap gap-1.5 mb-2">
              {associatedPeople.length > 0 ? (
                associatedPeople.map((person) => (
                  <span
                    key={person.id}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-primary/25 border border-primary/40 text-primary-foreground text-xs"
                  >
                    <span>👤 {person.name}</span>
                    <button
                      onClick={() => handleUnlinkPerson(person.id)}
                      className="hover:text-red-400 ml-0.5"
                      title="移除关联"
                    >
                      ✕
                    </button>
                  </span>
                ))
              ) : (
                <span className="text-xs text-white/40 italic">暂未关联人物</span>
              )}
            </div>

            {/* Add person dropdown / popover */}
            {showPersonDropdown && (
              <div className="mt-2 p-3 rounded-xl bg-neutral-800 border border-white/15 space-y-2 text-xs">
                {unassociatedPeople.length > 0 && (
                  <div>
                    <span className="text-white/50 text-[11px] block mb-1">选择已有的人物：</span>
                    <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
                      {unassociatedPeople.map((p) => (
                        <button
                          key={p.id}
                          onClick={() => handleLinkPerson(p.id)}
                          className="px-2 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-white text-xs transition-colors"
                        >
                          + {p.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="pt-2 border-t border-white/10">
                  <span className="text-white/50 text-[11px] block mb-1">或新建人物：</span>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="text"
                      placeholder="人物姓名..."
                      value={newPersonNameInput}
                      onChange={(e) => setNewPersonNameInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleCreateAndLinkPerson()
                      }}
                      className="flex-1 px-2 py-1 rounded bg-neutral-900 border border-white/20 text-white text-xs focus:outline-none focus:border-primary"
                    />
                    <button
                      onClick={handleCreateAndLinkPerson}
                      className="px-2.5 py-1 rounded bg-primary text-primary-foreground text-xs font-medium"
                    >
                      添加
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Section: Custom Tags */}
          <div className="border-t border-white/10 pt-4">
            <h4 className="text-xs uppercase tracking-wider text-white/40 font-semibold mb-2.5 flex items-center gap-1.5">
              <span>🏷️</span>
              <span>自定义标签</span>
            </h4>

            <div className="flex flex-wrap gap-1.5 mb-2.5">
              {photo.userTags && photo.userTags.length > 0 ? (
                photo.userTags.map((t) => (
                  <span
                    key={t}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-200 border border-amber-500/30 text-xs"
                  >
                    <span>#{t}</span>
                    <button
                      onClick={() => handleRemoveTag(t)}
                      className="hover:text-red-400 ml-0.5"
                      title="删除标签"
                    >
                      ✕
                    </button>
                  </span>
                ))
              ) : (
                <span className="text-xs text-white/40 italic">暂无自定义标签</span>
              )}
            </div>

            {/* Add tag input */}
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                placeholder="输入标签按回车添加 (如: 毕业旅行)..."
                value={newTagInput}
                onChange={(e) => setNewTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAddTag()
                }}
                className="flex-1 px-2.5 py-1 rounded-lg bg-white/5 border border-white/15 text-white text-xs focus:outline-none focus:border-primary placeholder:text-white/30"
              />
              <button
                onClick={handleAddTag}
                className="px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-white text-xs transition-colors"
              >
                添加
              </button>
            </div>
          </div>

          {/* Section: Local AI Tags */}
          {photo.aiTags && photo.aiTags.length > 0 && (
            <div className="border-t border-white/10 pt-4">
              <h4 className="text-xs uppercase tracking-wider text-white/40 font-semibold mb-2.5 flex items-center gap-1.5">
                <span>🤖</span>
                <span>本地智能识别标签</span>
              </h4>
              <div className="flex flex-wrap gap-1.5">
                {photo.aiTags.map((t) => (
                  <span
                    key={t}
                    className="px-2 py-0.5 rounded-full bg-primary/20 text-primary-foreground border border-primary/30 text-xs"
                  >
                    ✨ {t}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Section: EXIF Information */}
          <div className="border-t border-white/10 pt-4">
            <h4 className="text-xs uppercase tracking-wider text-white/40 font-semibold mb-3">
              EXIF 拍摄参数
            </h4>
            {photo.exif &&
            (photo.exif.cameraModel || photo.exif.shutterSpeed || photo.exif.aperture) ? (
              <div className="space-y-2 text-xs">
                {photo.exif.cameraMake && (
                  <div>
                    <span className="text-white/40 block">相机品牌</span>
                    <span className="text-white/90">{photo.exif.cameraMake}</span>
                  </div>
                )}
                {photo.exif.cameraModel && (
                  <div>
                    <span className="text-white/40 block">相机型号</span>
                    <span className="text-white/90">{photo.exif.cameraModel}</span>
                  </div>
                )}
                {photo.exif.lensModel && (
                  <div>
                    <span className="text-white/40 block">镜头型号</span>
                    <span className="text-white/90">{photo.exif.lensModel}</span>
                  </div>
                )}

                {/* Exposure Parameters */}
                <div className="grid grid-cols-2 gap-2 pt-1">
                  {photo.exif.focalLength && (
                    <div className="p-2 rounded bg-white/5 border border-white/10">
                      <span className="text-white/40 block text-[10px]">焦距</span>
                      <span className="font-semibold text-white/90">
                        {photo.exif.focalLength}
                      </span>
                    </div>
                  )}
                  {photo.exif.aperture && (
                    <div className="p-2 rounded bg-white/5 border border-white/10">
                      <span className="text-white/40 block text-[10px]">光圈</span>
                      <span className="font-semibold text-white/90">{photo.exif.aperture}</span>
                    </div>
                  )}
                  {photo.exif.shutterSpeed && (
                    <div className="p-2 rounded bg-white/5 border border-white/10">
                      <span className="text-white/40 block text-[10px]">快门</span>
                      <span className="font-semibold text-white/90">
                        {photo.exif.shutterSpeed}
                      </span>
                    </div>
                  )}
                  {photo.exif.iso && (
                    <div className="p-2 rounded bg-white/5 border border-white/10">
                      <span className="text-white/40 block text-[10px]">ISO</span>
                      <span className="font-semibold text-white/90">{photo.exif.iso}</span>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-xs text-white/40 italic">未读取到 EXIF 元数据</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
