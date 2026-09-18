import React, { useEffect, useState } from 'react'
import { PhotoItem } from '../types/album'

interface SlideshowModalProps {
  photos: PhotoItem[]
  onClose: () => void
}

export const SlideshowModal: React.FC<SlideshowModalProps> = ({
  photos,
  onClose
}) => {
  const [currentIndex, setCurrentIndex] = useState(0)
  const [isPlaying, setIsPlaying] = useState(true)
  const [intervalSec, setIntervalSec] = useState(5)

  const currentPhoto = photos[currentIndex]

  // Slideshow auto-advance timer
  useEffect(() => {
    if (!isPlaying || photos.length <= 1) return
    const timer = setInterval(() => {
      setCurrentIndex(prev => (prev + 1) % photos.length)
    }, intervalSec * 1000)

    return () => clearInterval(timer)
  }, [isPlaying, intervalSec, photos.length])

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === ' ') {
        e.preventDefault()
        setIsPlaying(prev => !prev)
      } else if (e.key === 'ArrowLeft') {
        setCurrentIndex(prev => (prev - 1 + photos.length) % photos.length)
      } else if (e.key === 'ArrowRight') {
        setCurrentIndex(prev => (prev + 1) % photos.length)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [photos.length])

  if (!currentPhoto) return null

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col justify-between overflow-hidden select-none">
      {/* Background Ambience Blur */}
      <div
        className="absolute inset-0 opacity-20 blur-3xl scale-125 transition-all duration-1000"
        style={{
          backgroundImage: `url(${currentPhoto.dataUrl || currentPhoto.thumbnailUrl})`,
          backgroundPosition: 'center',
          backgroundSize: 'cover'
        }}
      />

      {/* Main Slide with Ken Burns animation */}
      <div className="relative flex-1 flex items-center justify-center overflow-hidden p-6">
        <img
          key={currentPhoto.id}
          src={currentPhoto.dataUrl || currentPhoto.thumbnailUrl}
          alt={currentPhoto.name}
          className="max-h-full max-w-full object-contain rounded-lg shadow-2xl animate-kenburns transition-all duration-1000"
        />
      </div>

      {/* Slide Subtitle & Meta Info */}
      <div className="relative z-20 flex flex-col items-center justify-center text-center p-4 bg-gradient-to-t from-black/90 via-black/40 to-transparent">
        <h3 className="text-xl font-medium text-white tracking-wide drop-shadow-md">
          {currentPhoto.name}
        </h3>
        <p className="text-xs text-white/70 mt-1 flex items-center gap-2">
          <span>{currentPhoto.exif?.dateTimeOriginal || currentPhoto.dateStr}</span>
          {currentPhoto.exif?.cameraModel && (
            <>
              <span>•</span>
              <span>{currentPhoto.exif.cameraModel}</span>
            </>
          )}
        </p>

        {/* Playback Controls Bar */}
        <div className="flex items-center gap-4 mt-4 bg-neutral-900/80 backdrop-blur-md px-5 py-2 rounded-full border border-white/10 shadow-lg">
          {/* Previous */}
          <button
            onClick={() => setCurrentIndex(prev => (prev - 1 + photos.length) % photos.length)}
            className="p-1.5 rounded-full hover:bg-white/10 text-white/80 hover:text-white transition-colors"
            title="上一张 (←)"
          >
            <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24">
              <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" />
            </svg>
          </button>

          {/* Pause / Play */}
          <button
            onClick={() => setIsPlaying(!isPlaying)}
            className="w-10 h-10 rounded-full bg-primary hover:bg-primary/90 text-primary-foreground flex items-center justify-center transition-transform active:scale-95 shadow"
            title={isPlaying ? '暂停 (空格)' : '播放 (空格)'}
          >
            {isPlaying ? (
              <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24">
                <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
              </svg>
            ) : (
              <svg className="w-5 h-5 fill-current ml-0.5" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </button>

          {/* Next */}
          <button
            onClick={() => setCurrentIndex(prev => (prev + 1) % photos.length)}
            className="p-1.5 rounded-full hover:bg-white/10 text-white/80 hover:text-white transition-colors"
            title="下一张 (→)"
          >
            <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24">
              <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
            </svg>
          </button>

          <div className="w-[1px] h-4 bg-white/20" />

          {/* Interval Selector */}
          <div className="flex items-center gap-1 text-xs text-white/70">
            {[3, 5, 8].map(sec => (
              <button
                key={sec}
                onClick={() => setIntervalSec(sec)}
                className={`px-2 py-0.5 rounded-full text-xs font-mono transition-colors ${intervalSec === sec ? 'bg-white/20 text-white font-bold' : 'hover:bg-white/10'}`}
              >
                {sec}s
              </button>
            ))}
          </div>

          <div className="w-[1px] h-4 bg-white/20" />

          {/* Progress Indicator */}
          <span className="text-xs font-mono text-white/60">
            {currentIndex + 1} / {photos.length}
          </span>

          {/* Close */}
          <button
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-red-500/60 text-white/80 hover:text-white transition-colors ml-1"
            title="退出放映 (ESC)"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}
