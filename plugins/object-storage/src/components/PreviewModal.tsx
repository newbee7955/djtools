import React, { useState, useEffect, useRef } from 'react'
import type { StorageObjectItem } from '../lib/types'
import { S3Client } from '../lib/s3-client'

interface PreviewModalProps {
  isOpen: boolean
  onClose: () => void
  item: StorageObjectItem | null
  bucket: string
  client: S3Client
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

function formatDuration(seconds: number): string {
  if (!seconds || isNaN(seconds)) return '00:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

export function PreviewModal({
  isOpen,
  onClose,
  item,
  bucket,
  client
}: PreviewModalProps): JSX.Element | null {
  if (!isOpen || !item) return null

  const [url, setUrl] = useState<string>('')
  const [textContent, setTextContent] = useState<string>('')
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string>('')
  const [copied, setCopied] = useState<boolean>(false)

  // 媒体元数据
  const [imgDim, setImgDim] = useState<{ w: number; h: number } | null>(null)
  const [zoom, setZoom] = useState<number>(1)
  const [rotate, setRotate] = useState<number>(0)

  // 视频元数据与状态
  const [videoDim, setVideoDim] = useState<{ w: number; h: number } | null>(null)
  const [videoDuration, setVideoDuration] = useState<number>(0)
  const [videoError, setVideoError] = useState<boolean>(false)
  const [playbackRate, setPlaybackRate] = useState<number>(1)
  const videoRef = useRef<HTMLVideoElement | null>(null)

  const ext = item.extension.toLowerCase()
  const isImage = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'].includes(ext)
  const isVideo = ['mp4', 'webm', 'ogg', 'mov', 'mkv', 'avi', 'm4v', '3gp'].includes(ext)
  const isAudio = ['mp3', 'wav', 'ogg', 'aac', 'm4a', 'flac'].includes(ext)
  const isPdf = ext === 'pdf'
  const isText = [
    'txt', 'md', 'json', 'js', 'jsx', 'ts', 'tsx', 'css', 'html', 'xml',
    'yml', 'yaml', 'log', 'sh', 'py', 'sql', 'csv', 'env', 'conf', 'ini'
  ].includes(ext)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    setTextContent('')
    setUrl('')
    setImgDim(null)
    setZoom(1)
    setRotate(0)
    setVideoDim(null)
    setVideoDuration(0)
    setVideoError(false)

    async function load() {
      try {
        if (!item) return
        const presigned = await client.getPresignedUrl(bucket, item.key, 7200)
        if (!active) return
        setUrl(presigned)

        if (isText) {
          const text = await client.getTextContent(bucket, item.key)
          if (!active) return
          setTextContent(text)
        }
      } catch (err: any) {
        if (!active) return
        setError(err.message || '加载预览失败')
      } finally {
        if (active) setLoading(false)
      }
    }

    load()
    return () => {
      active = false
    }
  }, [item, bucket, client, isText])

  const handleCopyLink = () => {
    if (url) {
      navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const handleCopyText = () => {
    if (textContent) {
      navigator.clipboard.writeText(textContent)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const handleSpeedChange = (rate: number) => {
    setPlaybackRate(rate)
    if (videoRef.current) {
      videoRef.current.playbackRate = rate
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-fade-in">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-5xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden">
        {/* 顶部标题栏 */}
        <div className="flex items-center justify-between px-6 py-3.5 border-b border-slate-800 bg-slate-900/95">
          <div className="flex items-center gap-3 truncate max-w-xl">
            <span className="text-2xl select-none">
              {isImage ? '🖼️' : isVideo ? '🎬' : isAudio ? '🎵' : isPdf ? '📕' : isText ? '📝' : '📄'}
            </span>
            <div className="truncate">
              <h2 className="text-sm font-bold text-slate-100 truncate">{item.name}</h2>
              <p className="text-[11px] text-slate-400 font-mono truncate">{item.key}</p>
            </div>
          </div>

          {/* 顶部快捷操作栏 */}
          <div className="flex items-center gap-2">
            {/* 图像专用缩放控制 */}
            {isImage && (
              <div className="flex items-center bg-slate-800/80 rounded-xl p-1 border border-slate-700/60 text-xs text-slate-300 mr-1">
                <button
                  onClick={() => setZoom((z) => Math.max(0.2, z - 0.25))}
                  className="px-2 py-0.5 hover:bg-slate-700 rounded transition"
                  title="缩小"
                >
                  -
                </button>
                <span className="px-1.5 font-mono text-[11px] min-w-[3rem] text-center">
                  {Math.round(zoom * 100)}%
                </span>
                <button
                  onClick={() => setZoom((z) => Math.min(4, z + 0.25))}
                  className="px-2 py-0.5 hover:bg-slate-700 rounded transition"
                  title="放大"
                >
                  +
                </button>
                <button
                  onClick={() => setRotate((r) => (r + 90) % 360)}
                  className="px-2 py-0.5 hover:bg-slate-700 rounded transition ml-1"
                  title="顺时针旋转 90 度"
                >
                  🔄
                </button>
                <button
                  onClick={() => {
                    setZoom(1)
                    setRotate(0)
                  }}
                  className="px-2 py-0.5 hover:bg-slate-700 rounded transition text-[11px]"
                  title="复位"
                >
                  复位
                </button>
              </div>
            )}

            {/* 视频专用倍速控制 */}
            {isVideo && !videoError && (
              <div className="flex items-center bg-slate-800/80 rounded-xl p-1 border border-slate-700/60 text-xs text-slate-300 mr-1">
                {[1.0, 1.25, 1.5, 2.0].map((rate) => (
                  <button
                    key={rate}
                    onClick={() => handleSpeedChange(rate)}
                    className={`px-2 py-0.5 rounded transition text-[11px] font-mono ${
                      playbackRate === rate ? 'bg-emerald-600 text-white font-bold' : 'hover:bg-slate-700'
                    }`}
                  >
                    {rate}x
                  </button>
                ))}
              </div>
            )}

            {/* 复制代码 */}
            {isText && textContent && (
              <button
                onClick={handleCopyText}
                className="px-3 py-1.5 text-xs rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700/80 transition flex items-center gap-1.5"
              >
                <span>📋</span>
                <span>{copied ? '已复制代码' : '复制代码'}</span>
              </button>
            )}

            {/* 复制外链 */}
            {url && (
              <button
                onClick={handleCopyLink}
                className="px-3 py-1.5 text-xs rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700/80 transition flex items-center gap-1.5"
                title="复制预签名临时访问链接 (2小时内有效)"
              >
                <span>🔗</span>
                <span>{copied ? '已复制直链' : '复制直链'}</span>
              </button>
            )}

            {/* 下载 */}
            {url && (
              <a
                href={url}
                download={item.name}
                className="px-3 py-1.5 text-xs rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-medium transition shadow-md shadow-emerald-600/20 flex items-center gap-1.5"
                title="直接下载该对象到本地"
              >
                <span>⬇️</span>
                <span>下载</span>
              </a>
            )}

            <button
              onClick={onClose}
              className="text-slate-400 hover:text-slate-100 p-1.5 rounded-xl hover:bg-slate-800 transition ml-1"
            >
              ✕
            </button>
          </div>
        </div>

        {/* 核心内容展示区 */}
        <div className="flex-1 overflow-auto p-6 flex items-center justify-center bg-slate-950/80 min-h-[420px] relative">
          {loading ? (
            <div className="flex flex-col items-center gap-3 text-slate-400">
              <div className="w-10 h-10 border-3 border-emerald-500 border-t-transparent rounded-full animate-spin" />
              <span className="text-xs font-mono text-slate-400">正在获取对象流与生成临时安全签名...</span>
            </div>
          ) : error ? (
            <div className="p-5 bg-rose-950/40 border border-rose-500/50 rounded-2xl text-rose-300 text-xs flex items-center gap-3 max-w-lg">
              <span className="text-2xl">⚠️</span>
              <div className="space-y-1">
                <div className="font-semibold">加载预览失败</div>
                <div className="text-slate-400 leading-relaxed">{error}</div>
              </div>
            </div>
          ) : isImage ? (
            /* 图片查看 */
            <div className="w-full h-full max-h-[70vh] flex items-center justify-center overflow-auto p-4 select-none">
              <img
                src={url}
                alt={item.name}
                style={{
                  transform: `scale(${zoom}) rotate(${rotate}deg)`,
                  transition: 'transform 0.15s ease-out'
                }}
                onLoad={(e) => {
                  const target = e.currentTarget
                  setImgDim({ w: target.naturalWidth, h: target.naturalHeight })
                }}
                className="max-w-full max-h-[66vh] object-contain rounded-xl shadow-2xl border border-slate-800/80"
              />
            </div>
          ) : isVideo ? (
            /* 视频播放器 */
            <div className="w-full max-w-3xl flex flex-col items-center justify-center">
              {!videoError ? (
                <div className="w-full relative rounded-2xl overflow-hidden bg-black shadow-2xl border border-slate-800">
                  <video
                    ref={videoRef}
                    src={url}
                    controls
                    autoPlay
                    playsInline
                    onLoadedMetadata={(e) => {
                      const v = e.currentTarget
                      setVideoDim({ w: v.videoWidth, h: v.videoHeight })
                      setVideoDuration(v.duration)
                    }}
                    onError={() => setVideoError(true)}
                    className="w-full max-h-[62vh] object-contain bg-black"
                  />
                </div>
              ) : (
                /* 视频解码失败优雅兜底 */
                <div className="p-6 bg-slate-900 border border-slate-800 rounded-2xl text-center space-y-3 max-w-md">
                  <div className="text-4xl">🎬</div>
                  <h4 className="text-sm font-semibold text-slate-200">网页播放器无法直接硬解此视频格式</h4>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    当前视频文件格式（<code className="text-rose-400 font-mono">.{ext}</code>）可能包含浏览器未支持的高级音视频编码，建议点击下方按钮一键下载到本地播放。
                  </p>
                  <a
                    href={url}
                    download={item.name}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-lg shadow-emerald-600/20 transition"
                  >
                    <span>⬇️</span>
                    <span>立即下载视频到本地</span>
                  </a>
                </div>
              )}
            </div>
          ) : isAudio ? (
            /* 音频播放 */
            <div className="p-8 flex flex-col items-center gap-5 bg-slate-900/90 border border-slate-800 rounded-3xl max-w-md w-full shadow-2xl text-center">
              <div className="w-24 h-24 rounded-full bg-gradient-to-tr from-emerald-600 to-teal-400 flex items-center justify-center text-4xl shadow-xl shadow-emerald-500/20 animate-pulse">
                🎵
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-100">{item.name}</h3>
                <p className="text-[11px] text-slate-400 font-mono mt-0.5">{formatBytes(item.size)}</p>
              </div>
              <audio src={url} controls autoPlay className="w-full mt-2" />
            </div>
          ) : isPdf ? (
            /* PDF 在线预览 */
            <div className="w-full h-[70vh] rounded-2xl overflow-hidden border border-slate-800 shadow-2xl bg-slate-900">
              <iframe
                src={url}
                title={item.name}
                className="w-full h-full border-0"
              />
            </div>
          ) : isText ? (
            /* 文本/代码预览 */
            <div className="w-full h-full max-h-[70vh] overflow-auto bg-slate-900/95 border border-slate-800 rounded-2xl p-5 font-mono text-xs text-slate-200 leading-relaxed select-text whitespace-pre-wrap shadow-inner">
              {textContent}
            </div>
          ) : (
            /* 不支持在线渲染的文件 */
            <div className="text-center space-y-4 max-w-md p-6 bg-slate-900/60 border border-slate-800 rounded-2xl">
              <div className="text-5xl">📦</div>
              <div className="text-sm text-slate-200 font-semibold">该格式暂不支持浏览器直接预览</div>
              <p className="text-xs text-slate-400 leading-relaxed">
                文件格式为 <code className="text-amber-400 font-mono">.{ext}</code>，大小 {formatBytes(item.size)}。您可以生成分享链接或将其下载到本地查看。
              </p>
              {url && (
                <a
                  href={url}
                  download={item.name}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-lg shadow-emerald-600/20 transition"
                >
                  <span>⬇️</span>
                  <span>下载文件到本地</span>
                </a>
              )}
            </div>
          )}
        </div>

        {/* 底部详细信息栏 */}
        <div className="flex items-center justify-between px-6 py-3 border-t border-slate-800 bg-slate-900/95 text-xs text-slate-400 font-mono">
          <div className="flex items-center gap-4">
            <span>大小: <strong className="text-slate-300">{formatBytes(item.size)}</strong></span>
            {imgDim && <span>分辨率: <strong className="text-slate-300">{imgDim.w} × {imgDim.h} px</strong></span>}
            {videoDim && <span>分辨率: <strong className="text-slate-300">{videoDim.w} × {videoDim.h}</strong></span>}
            {videoDuration > 0 && <span>时长: <strong className="text-slate-300">{formatDuration(videoDuration)}</strong></span>}
            {item.storageClass && <span>类型: <strong className="text-slate-300">{item.storageClass}</strong></span>}
          </div>
          {item.lastModified && (
            <div>更新时间: {new Date(item.lastModified).toLocaleString('zh-CN')}</div>
          )}
        </div>
      </div>
    </div>
  )
}
