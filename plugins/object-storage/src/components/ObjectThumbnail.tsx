import React, { useState, useEffect, useRef } from 'react'
import type { StorageObjectItem } from '../lib/types'
import { S3Client } from '../lib/s3-client'

interface ObjectThumbnailProps {
  item: StorageObjectItem
  bucket: string
  client: S3Client | null
  viewMode: 'grid' | 'list'
}

// 全局内存 URL 缓存，有效期 1 小时，避免滚动列表时重复计算签名
const urlCache = new Map<string, { url: string; expiresAt: number }>()

function getCachedPresignedUrl(client: S3Client, bucket: string, key: string): Promise<string> {
  const cacheKey = `${bucket}:${key}`
  const now = Date.now()
  const cached = urlCache.get(cacheKey)
  if (cached && cached.expiresAt > now + 60000) {
    return Promise.resolve(cached.url)
  }

  return client.getPresignedUrl(bucket, key, 3600).then((url) => {
    urlCache.set(cacheKey, { url, expiresAt: now + 3500000 })
    return url
  })
}

export function ObjectThumbnail({
  item,
  bucket,
  client,
  viewMode
}: ObjectThumbnailProps): JSX.Element {
  const [mediaUrl, setMediaUrl] = useState<string>('')
  const [loaded, setLoaded] = useState<boolean>(false)
  const [error, setError] = useState<boolean>(false)
  const isMountedRef = useRef(true)

  const ext = item.extension.toLowerCase()
  const isImage = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'].includes(ext)
  const isVideo = ['mp4', 'webm', 'mov', 'mkv', 'avi'].includes(ext)
  const isAudio = ['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a'].includes(ext)
  const isPdf = ext === 'pdf'
  const isCode = [
    'txt', 'md', 'json', 'js', 'jsx', 'ts', 'tsx', 'css', 'html', 'xml',
    'yml', 'yaml', 'log', 'sh', 'py', 'sql', 'csv', 'env', 'conf', 'ini'
  ].includes(ext)
  const isArchive = ['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)

  useEffect(() => {
    isMountedRef.current = true
    setLoaded(false)
    setError(false)

    if ((isImage || isVideo) && client && bucket && !item.isDirectory) {
      getCachedPresignedUrl(client, bucket, item.key)
        .then((url) => {
          if (isMountedRef.current) {
            setMediaUrl(url)
          }
        })
        .catch(() => {
          if (isMountedRef.current) {
            setError(true)
          }
        })
    }

    return () => {
      isMountedRef.current = false
    }
  }, [item.key, bucket, client, isImage, isVideo, item.isDirectory])

  // ==========================================
  // 1. 列表视图 (List View - 36x36 紧凑微缩图)
  // ==========================================
  if (viewMode === 'list') {
    if (item.isDirectory) {
      return (
        <div className="w-9 h-9 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-base shrink-0 select-none">
          📁
        </div>
      )
    }

    if (isImage) {
      return (
        <div className="w-9 h-9 rounded-lg bg-slate-900 border border-slate-800/80 overflow-hidden flex items-center justify-center shrink-0 relative select-none">
          {mediaUrl && !error ? (
            <img
              src={mediaUrl}
              alt={item.name}
              loading="lazy"
              onLoad={() => setLoaded(true)}
              onError={() => setError(true)}
              className={`w-full h-full object-cover transition-opacity duration-200 ${
                loaded ? 'opacity-100' : 'opacity-0'
              }`}
            />
          ) : (
            <span className="text-base text-sky-400">🖼️</span>
          )}
          {!loaded && !error && mediaUrl && (
            <div className="absolute inset-0 bg-slate-800/60 animate-pulse" />
          )}
        </div>
      )
    }

    if (isVideo) {
      return (
        <div className="w-9 h-9 rounded-lg bg-slate-950 border border-rose-500/20 overflow-hidden flex items-center justify-center shrink-0 relative select-none group/vid">
          {mediaUrl && !error ? (
            <>
              <video
                src={`${mediaUrl}#t=1`}
                preload="metadata"
                muted
                playsInline
                className="w-full h-full object-cover opacity-80"
                onError={() => setError(true)}
                onLoadedData={() => setLoaded(true)}
              />
              <div className="absolute inset-0 bg-black/30 flex items-center justify-center">
                <span className="text-[10px] text-white/90 drop-shadow">▶</span>
              </div>
            </>
          ) : (
            <span className="text-base text-rose-400">🎬</span>
          )}
        </div>
      )
    }

    if (isAudio) {
      return (
        <div className="w-9 h-9 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 text-sm shrink-0 select-none">
          🎵
        </div>
      )
    }

    if (isPdf) {
      return (
        <div className="w-9 h-9 rounded-lg bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-400 text-[11px] font-bold font-mono shrink-0 select-none">
          PDF
        </div>
      )
    }

    if (isCode) {
      return (
        <div className="w-9 h-9 rounded-lg bg-teal-500/10 border border-teal-500/20 flex items-center justify-center text-teal-300 text-[10px] font-mono font-semibold uppercase shrink-0 select-none">
          {ext.slice(0, 3) || 'TXT'}
        </div>
      )
    }

    if (isArchive) {
      return (
        <div className="w-9 h-9 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 text-sm shrink-0 select-none">
          📦
        </div>
      )
    }

    return (
      <div className="w-9 h-9 rounded-lg bg-slate-800/60 border border-slate-700/60 flex items-center justify-center text-slate-400 text-sm shrink-0 select-none">
        📄
      </div>
    )
  }

  // ==========================================
  // 2. 网格视图 (Grid View - 饱满大图与视频首帧)
  // ==========================================
  if (item.isDirectory) {
    return (
      <div className="w-full h-28 rounded-xl bg-amber-500/5 border border-amber-500/10 flex flex-col items-center justify-center gap-1 group-hover:bg-amber-500/10 transition">
        <div className="text-4xl group-hover:scale-110 transition transform">📁</div>
        <span className="text-[10px] font-mono text-amber-400/80 bg-amber-500/10 px-1.5 py-0.5 rounded">目录</span>
      </div>
    )
  }

  // 图片缩略图
  if (isImage) {
    return (
      <div className="w-full h-28 rounded-xl bg-slate-950 border border-slate-800 overflow-hidden relative flex items-center justify-center group/card">
        {mediaUrl && !error ? (
          <>
            <img
              src={mediaUrl}
              alt={item.name}
              loading="lazy"
              onLoad={() => setLoaded(true)}
              onError={() => setError(true)}
              className={`w-full h-full object-cover transition duration-300 group-hover:scale-105 ${
                loaded ? 'opacity-100' : 'opacity-0'
              }`}
            />
            {/* 格式角标 */}
            <div className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded bg-black/60 backdrop-blur-sm border border-white/10 text-[9px] font-mono uppercase text-slate-300">
              {ext}
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center gap-1 text-slate-500">
            <span className="text-3xl">🖼️</span>
            <span className="text-[10px] font-mono uppercase">{ext}</span>
          </div>
        )}

        {/* 骨架屏加载中动画 */}
        {!loaded && !error && mediaUrl && (
          <div className="absolute inset-0 bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 animate-pulse flex items-center justify-center">
            <div className="w-5 h-5 border-2 border-emerald-500/60 border-t-transparent rounded-full animate-spin" />
          </div>
        )}
      </div>
    )
  }

  // 视频缩略图与视频元数据首帧
  if (isVideo) {
    return (
      <div className="w-full h-28 rounded-xl bg-slate-950 border border-rose-500/20 overflow-hidden relative flex items-center justify-center group/vid">
        {mediaUrl && !error ? (
          <>
            <video
              src={`${mediaUrl}#t=1`}
              preload="metadata"
              muted
              playsInline
              className="w-full h-full object-cover opacity-85 group-hover/vid:opacity-100 transition duration-300 group-hover:scale-105"
              onError={() => setError(true)}
              onLoadedData={() => setLoaded(true)}
            />
            {/* 播放按钮悬浮微动效 */}
            <div className="absolute inset-0 bg-black/25 group-hover/vid:bg-black/10 flex items-center justify-center transition">
              <div className="w-8 h-8 rounded-full bg-emerald-500/80 group-hover/vid:bg-emerald-500 group-hover/vid:scale-110 text-white flex items-center justify-center shadow-lg transition backdrop-blur-sm pl-0.5 text-xs">
                ▶
              </div>
            </div>
            {/* 视频格式角标 */}
            <div className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded bg-black/70 backdrop-blur-sm border border-rose-500/30 text-[9px] font-mono uppercase text-rose-300 flex items-center gap-1">
              <span>🎬</span>
              <span>{ext}</span>
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center gap-1 text-slate-500">
            <span className="text-3xl">🎬</span>
            <span className="text-[10px] font-mono uppercase text-rose-400">{ext}</span>
          </div>
        )}

        {!loaded && !error && mediaUrl && (
          <div className="absolute inset-0 bg-slate-900 animate-pulse flex items-center justify-center">
            <div className="w-5 h-5 border-2 border-rose-500/60 border-t-transparent rounded-full animate-spin" />
          </div>
        )}
      </div>
    )
  }

  // 音频卡片
  if (isAudio) {
    return (
      <div className="w-full h-28 rounded-xl bg-gradient-to-br from-emerald-950/30 to-slate-900 border border-emerald-500/20 flex flex-col items-center justify-center gap-1.5 group-hover:border-emerald-500/40 transition">
        <div className="w-10 h-10 rounded-full bg-emerald-500/20 flex items-center justify-center text-xl text-emerald-400 group-hover:scale-110 transition shadow-inner">
          🎵
        </div>
        <span className="text-[10px] font-mono text-emerald-300/80 uppercase font-semibold bg-emerald-950/60 px-1.5 py-0.5 rounded border border-emerald-500/30">
          {ext} 音频
        </span>
      </div>
    )
  }

  // PDF 卡片
  if (isPdf) {
    return (
      <div className="w-full h-28 rounded-xl bg-gradient-to-br from-rose-950/20 to-slate-900 border border-rose-500/20 flex flex-col items-center justify-center gap-1.5 group-hover:border-rose-500/40 transition">
        <div className="text-3xl group-hover:scale-110 transition transform">📕</div>
        <span className="text-[10px] font-mono text-rose-300 font-bold bg-rose-950/60 px-2 py-0.5 rounded border border-rose-500/30">
          PDF 文档
        </span>
      </div>
    )
  }

  // 代码与文本卡片
  if (isCode) {
    return (
      <div className="w-full h-28 rounded-xl bg-gradient-to-br from-teal-950/20 to-slate-900 border border-teal-500/20 flex flex-col items-center justify-center gap-1.5 group-hover:border-teal-500/40 transition">
        <div className="text-3xl group-hover:scale-110 transition transform">📝</div>
        <span className="text-[10px] font-mono text-teal-300 uppercase font-semibold bg-teal-950/60 px-1.5 py-0.5 rounded border border-teal-500/30">
          {ext} 源码
        </span>
      </div>
    )
  }

  // 压缩包卡片
  if (isArchive) {
    return (
      <div className="w-full h-28 rounded-xl bg-gradient-to-br from-amber-950/20 to-slate-900 border border-amber-500/20 flex flex-col items-center justify-center gap-1.5 group-hover:border-amber-500/40 transition">
        <div className="text-3xl group-hover:scale-110 transition transform">📦</div>
        <span className="text-[10px] font-mono text-amber-300 uppercase font-semibold bg-amber-950/60 px-1.5 py-0.5 rounded border border-amber-500/30">
          {ext} 压缩包
        </span>
      </div>
    )
  }

  // 通用文档卡片
  return (
    <div className="w-full h-28 rounded-xl bg-slate-900 border border-slate-800 flex flex-col items-center justify-center gap-1.5 group-hover:border-slate-700 transition">
      <div className="text-3xl group-hover:scale-110 transition transform">📄</div>
      <span className="text-[10px] font-mono text-slate-400 uppercase bg-slate-950 px-1.5 py-0.5 rounded border border-slate-800">
        {ext || 'FILE'}
      </span>
    </div>
  )
}
