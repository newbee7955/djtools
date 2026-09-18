import React from 'react'
import { OnThisDayMemory, PhotoItem } from '../types/album'

interface OnThisDayBannerProps {
  memories: OnThisDayMemory[]
  onSelectPhoto: (photo: PhotoItem) => void
  onPlaySlideshow: (photos: PhotoItem[]) => void
}

export const OnThisDayBanner: React.FC<OnThisDayBannerProps> = ({
  memories,
  onSelectPhoto,
  onPlaySlideshow
}) => {
  if (!memories || memories.length === 0) return null

  // Collect all photos from memories
  const allMemoryPhotos = memories.flatMap(m => m.photos)

  return (
    <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-amber-500/10 via-orange-500/5 to-rose-500/10 border border-amber-500/20 p-5 mb-8 backdrop-blur-md shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <span className="flex items-center justify-center w-9 h-9 rounded-full bg-amber-500/20 text-amber-500 font-bold text-lg">
            ✨
          </span>
          <div>
            <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
              那年今日
              <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-600 font-medium">
                {memories.map(m => `${m.yearsAgo}年前`).join(' / ')}
              </span>
            </h2>
            <p className="text-xs text-muted-foreground">
              重温那些在过去的今天留下的温暖瞬间（共 {allMemoryPhotos.length} 张照片）
            </p>
          </div>
        </div>

        <button
          onClick={() => onPlaySlideshow(allMemoryPhotos)}
          className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-xs font-medium shadow transition-transform active:scale-95"
        >
          <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24">
            <path d="M8 5v14l11-7z" />
          </svg>
          一键放映回忆
        </button>
      </div>

      {/* Memory Cards Carousel */}
      <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-none">
        {memories.map((mem) => (
          <div
            key={mem.year}
            className="flex-shrink-0 flex flex-col gap-2 p-3 rounded-xl bg-background/70 border border-border/40 shadow-xs"
          >
            <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
              <span className="font-semibold text-foreground">{mem.year}年 ({mem.yearsAgo}年前)</span>
              <span>{mem.photos.length} 张</span>
            </div>

            <div className="flex gap-2">
              {mem.photos.slice(0, 4).map((photo) => (
                <div
                  key={photo.id}
                  onClick={() => onSelectPhoto(photo)}
                  className="group relative w-20 h-20 rounded-lg overflow-hidden cursor-pointer border border-border/40 shadow-xs hover:shadow-md transition-all duration-200"
                >
                  <img
                    src={photo.thumbnailUrl || photo.dataUrl}
                    alt={photo.name}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    loading="lazy"
                  />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />
                </div>
              ))}
              {mem.photos.length > 4 && (
                <button
                  onClick={() => onSelectPhoto(mem.photos[4])}
                  className="w-20 h-20 rounded-lg bg-muted/50 border border-dashed border-border flex flex-col items-center justify-center text-xs text-muted-foreground hover:bg-muted/80 transition-colors"
                >
                  <span>+{mem.photos.length - 4}</span>
                  <span className="text-[10px]">更多</span>
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
