import React from 'react'
import { GridSize, MonthGroup, PhotoItem } from '../types/album'

interface TimelineGalleryProps {
  monthGroups: MonthGroup[]
  gridSize: GridSize
  onSelectPhoto: (photo: PhotoItem) => void
  onPlaySlideshow: (photos: PhotoItem[]) => void
  onTagClick?: (tag: string) => void
  onScrollTop?: () => void
}

export const TimelineGallery: React.FC<TimelineGalleryProps> = ({
  monthGroups,
  gridSize,
  onSelectPhoto,
  onPlaySlideshow,
  onTagClick,
  onScrollTop
}) => {
  const scrollToMonth = (monthStr: string) => {
    const el = document.getElementById(`month-group-${monthStr}`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }
  const getGridColsClass = () => {
    switch (gridSize) {
      case 'small':
        return 'grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 gap-2'
      case 'large':
        return 'grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4'
      case 'medium':
      default:
        return 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3'
    }
  }

  const getItemHeightClass = () => {
    switch (gridSize) {
      case 'small':
        return 'aspect-square'
      case 'large':
        return 'aspect-[4/3]'
      case 'medium':
      default:
        return 'aspect-square'
    }
  }

  if (monthGroups.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
        <div className="text-5xl mb-4 opacity-40">🖼️</div>
        <p className="text-base font-medium">相册目录中没有找到图片</p>
        <p className="text-xs text-muted-foreground/70 mt-1">
          将照片添加到「我的文档/Doujiao/Photos」或在顶部点击「切换目录」进行浏览
        </p>
      </div>
    )
  }

  return (
    <div className="relative space-y-10">
      {/* Floating Timeline Scrubber / Quick Month Nav */}
      {monthGroups.length > 1 && (
        <aside className="fixed right-3 top-1/2 -translate-y-1/2 z-20 hidden md:flex flex-col items-center gap-1 bg-background/85 hover:bg-background backdrop-blur-md p-1.5 rounded-2xl border border-border/70 shadow-lg transition-all duration-200">
          <span className="text-[10px] font-bold text-muted-foreground px-1 mb-0.5 select-none">
            时间轴
          </span>
          <div className="flex flex-col gap-1 max-h-[50vh] overflow-y-auto custom-scrollbar pr-0.5">
            {monthGroups.map((m) => (
              <button
                key={m.monthStr}
                onClick={() => scrollToMonth(m.monthStr)}
                className="text-[10px] px-2 py-1 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 whitespace-nowrap transition-colors flex items-center justify-between gap-1.5 font-medium"
                title={`${m.label} (${m.count} 张)`}
              >
                <span>{m.monthStr}</span>
                <span className="text-[9px] px-1 py-0.2 rounded-full bg-muted text-muted-foreground">
                  {m.count}
                </span>
              </button>
            ))}
          </div>
          {onScrollTop && (
            <button
              onClick={onScrollTop}
              className="mt-1 p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted text-[10px] font-bold"
              title="回到时间轴顶部"
            >
              ↑ 顶
            </button>
          )}
        </aside>
      )}

      {monthGroups.map((month) => (
        <div key={month.monthStr} id={`month-group-${month.monthStr}`} className="space-y-6 scroll-mt-6">
          {/* Month Section Header */}
          <div className="sticky top-0 z-10 bg-background/85 backdrop-blur-md py-2.5 border-b border-border/50 flex items-center justify-between">
            <div className="flex items-baseline gap-3">
              <h3 className="text-xl font-bold tracking-tight text-foreground">
                {month.label}
              </h3>
              <span className="text-xs text-muted-foreground font-medium">
                {month.count} 张照片
              </span>
            </div>
            <button
              onClick={() => {
                const photos = month.dateGroups.flatMap((d) => d.photos)
                onPlaySlideshow(photos)
              }}
              className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1.5 px-2.5 py-1 rounded-md hover:bg-muted/60 transition-colors"
              title="放映此月份"
            >
              <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
              放映本月
            </button>
          </div>

          {/* Date Sub-groups */}
          {month.dateGroups.map((group) => (
            <div key={group.dateStr} className="space-y-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground/80 pl-1">
                <span>{group.label}</span>
                <span className="text-[10px] px-1.5 py-0.2 rounded bg-muted text-muted-foreground">
                  {group.photos.length}
                </span>
              </div>

              {/* Grid of photos */}
              <div className={`grid ${getGridColsClass()}`}>
                {group.photos.map((photo) => (
                  <div
                    key={photo.id}
                    onClick={() => onSelectPhoto(photo)}
                    className={`group relative rounded-xl overflow-hidden cursor-pointer bg-muted/40 border border-border/40 shadow-xs hover:shadow-md transition-all duration-200 ${getItemHeightClass()}`}
                  >
                    <img
                      src={photo.thumbnailUrl || photo.dataUrl}
                      alt={photo.name}
                      loading="lazy"
                      className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                    />

                    {/* Subtle portrait badge if tagged */}
                    {(photo.aiTags?.includes('人像') || photo.peopleIds?.length) && (
                      <div className="absolute top-1.5 left-1.5 z-10 px-1.5 py-0.5 rounded-md bg-black/50 backdrop-blur-xs text-white text-[9px] font-medium flex items-center gap-0.5 shadow-xs">
                        <span>👤</span>
                        {photo.peopleIds && photo.peopleIds.length > 0 && (
                          <span>已归类</span>
                        )}
                      </div>
                    )}

                    {/* Gradient overlay on hover */}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/15 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-between p-2">
                      <div className="flex items-center justify-end">
                        {photo.exif?.cameraModel && (
                          <span className="text-[10px] text-white/90 bg-black/50 backdrop-blur-xs px-1.5 py-0.5 rounded">
                            📷 {photo.exif.cameraModel}
                          </span>
                        )}
                      </div>
                      <div>
                        <p className="text-[11px] text-white font-medium truncate drop-shadow-xs">
                          {photo.name}
                        </p>
                        {photo.tags && photo.tags.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {photo.tags.slice(0, 3).map((t) => (
                              <span
                                key={t}
                                onClick={(e) => {
                                  if (onTagClick) {
                                    e.stopPropagation()
                                    onTagClick(t)
                                  }
                                }}
                                className="text-[9px] bg-white/20 hover:bg-white/35 backdrop-blur-xs text-white px-1.5 py-0.5 rounded transition-colors"
                              >
                                #{t}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
