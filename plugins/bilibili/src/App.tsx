import React, { useState, useEffect } from 'react'
import { getSDK } from '@doujiao/plugin-sdk'
import { extractBiliId } from './lib/parser'
import { resolveBiliShortLink, getVideoDetail, getPlayStream, BILI_QUALITY_OPTIONS, getQualityLabel } from './lib/api'
import type { BiliVideoInfo, BiliPage } from './types'

export default function App(): JSX.Element {
  const [inputUrl, setInputUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [videoInfo, setVideoInfo] = useState<BiliVideoInfo | null>(null)
  const [pages, setPages] = useState<BiliPage[]>([])
  const [selectedQuality, setSelectedQuality] = useState<number>(80)
  const [msg, setMsg] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null)
  const [pushing, setPushing] = useState(false)
  const [recentTasks, setRecentTasks] = useState<any[]>([])
  const [hasFFmpeg, setHasFFmpeg] = useState<boolean | null>(null)

  // 检测宿主 FFmpeg 状态并监听宿主广播的下载进度
  useEffect(() => {
    try {
      const sdk = getSDK()
      // 检测宿主 FFmpeg 状态
      sdk.media?.checkFFmpeg()
        .then((res) => setHasFFmpeg(!!res?.installed))
        .catch(() => setHasFFmpeg(false))

      const unsubscribe = sdk.download.onProgress((info) => {
        setRecentTasks((prev) => {
          const idx = prev.findIndex((t) => t.taskId === info.taskId)
          if (idx >= 0) {
            const copy = [...prev]
            copy[idx] = info
            return copy
          }
          return [info, ...prev].slice(0, 10)
        })
      })
      return () => unsubscribe()
    } catch {
      setHasFFmpeg(false)
    }
  }, [])

  // 解析视频
  const handleParse = async () => {
    const raw = inputUrl.trim()
    if (!raw) {
      setMsg({ text: '请先输入 B 站视频链接或 BV 号', type: 'error' })
      return
    }

    setLoading(true)
    setMsg(null)

    try {
      const idInfo = extractBiliId(raw)
      if (!idInfo) {
        throw new Error('无法识别该链接格式，请输入正确的 B站 视频地址或 BV 号')
      }

      let bvid = idInfo.bvid
      if (idInfo.shortUrl) {
        setMsg({ text: '正在还原 b23.tv 短链...', type: 'info' })
        const resolvedBvid = await resolveBiliShortLink(idInfo.shortUrl)
        if (!resolvedBvid) {
          throw new Error('短链解析失败，未重定向到有效视频')
        }
        bvid = resolvedBvid
      }

      if (!bvid) {
        throw new Error('未能提取到有效的 BV 号')
      }

      setMsg({ text: `正在获取视频详情 (BV: ${bvid})...`, type: 'info' })
      const info = await getVideoDetail(bvid)
      setVideoInfo(info)
      setPages(info.pages)
      setMsg({ text: `成功解析：${info.title} (共 ${info.pages.length} 个分P)`, type: 'success' })
    } catch (err: any) {
      setMsg({ text: err?.message || '解析失败', type: 'error' })
    } finally {
      setLoading(false)
    }
  }

  // 勾选/反选单个分 P
  const toggleSelect = (pageIndex: number) => {
    setPages((prev) =>
      prev.map((p, idx) => (idx === pageIndex ? { ...p, selected: !p.selected } : p))
    )
  }

  // 全选/取消全选
  const handleSelectAll = (select: boolean) => {
    setPages((prev) => prev.map((p) => ({ ...p, selected: select })))
  }

  // 批量推入下载队列
  const handleBatchDownload = async () => {
    if (!videoInfo) return
    const selectedPages = pages.filter((p) => p.selected)
    if (selectedPages.length === 0) {
      setMsg({ text: '请至少选择一个分 P 进行下载', type: 'error' })
      return
    }

    setPushing(true)
    setMsg({ text: `正在提取 ${selectedPages.length} 个选集的流地址并开始下载...`, type: 'info' })

    const sdk = getSDK()
    let ffmpegAvailable = hasFFmpeg
    try {
      const checkRes = await sdk.media?.checkFFmpeg()
      ffmpegAvailable = !!checkRes?.installed
      setHasFFmpeg(ffmpegAvailable)
    } catch {
      ffmpegAvailable = false
    }

    let successCount = 0

    for (const page of selectedPages) {
      try {
        const stream = await getPlayStream(videoInfo.bvid, page.cid, selectedQuality, !!ffmpegAvailable)
        const qualityTag = getQualityLabel(stream.quality || selectedQuality)
        const cleanTitle = (
          selectedPages.length > 1
            ? `${videoInfo.title} - P${page.page} ${page.part} [${qualityTag}]`
            : `${videoInfo.title} [${qualityTag}]`
        ).replace(/[\\/:*?"<>|]/g, '_').trim()

        await sdk.download.enqueue({
          url: stream.videoUrl,
          audioUrl: stream.audioUrl,
          filename: `${cleanTitle}.mp4`,
          headers: {
            Referer: 'https://www.bilibili.com/',
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
          },
          extra: {
            title: cleanTitle,
            authorName: videoInfo.owner?.name,
            coverUrl: videoInfo.pic,
            platform: 'bilibili',
            quality: qualityTag
          }
        })
        successCount++
      } catch (err: any) {
        console.warn(`[BiliPlugin] 提取分P ${page.part} 失败:`, err)
      }
    }

    setPushing(false)
    setMsg({
      text: `已成功推入 ${successCount} 个视频至后台下载队列！`,
      type: 'success'
    })
  }

  const selectedCount = pages.filter((p) => p.selected).length

  return (
    <div className="min-h-full bg-slate-900 text-slate-100 p-8 flex flex-col space-y-6">
      {/* 顶部标题区 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-3xl">📺</span>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-white tracking-wide">
                B站视频/多P选集下载器
              </h1>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-pink-500/10 text-pink-400 border border-pink-500/20 font-mono">
                官方插件 v1.0.0
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              支持单视频、多P合集、连载课程，自动提取最高码率并进行无损混流
            </p>
          </div>
        </div>

        <button
          onClick={() => getSDK().download.openSaveDirectory()}
          className="px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs border border-slate-700 transition-colors"
        >
          📂 打开保存目录
        </button>
      </div>

      {/* 状态提示横幅 */}
      {msg && (
        <div
          className={`p-3.5 rounded-xl border text-xs flex items-center justify-between ${
            msg.type === 'success'
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
              : msg.type === 'error'
              ? 'bg-rose-500/10 border-rose-500/30 text-rose-400'
              : 'bg-indigo-500/10 border-indigo-500/30 text-indigo-300'
          }`}
        >
          <span>{msg.text}</span>
          <button onClick={() => setMsg(null)} className="text-slate-400 hover:text-white">✕</button>
        </div>
      )}

      {/* FFmpeg 状态感知横幅 */}
      {hasFFmpeg === false && (
        <div className="p-3 rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-300 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span>💡</span>
            <span>当前未检测到 FFmpeg，已自动启用免混流单文件下载模式（480P/720P）；如需下载 1080P+/4K 高清，可前往「应用设置」一键安装 FFmpeg。</span>
          </div>
        </div>
      )}

      {/* 链接输入卡片 */}
      <div className="p-5 rounded-xl bg-slate-950/60 border border-slate-800 space-y-3">
        <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
          视频地址 / BV 号 / 短链接
        </label>
        <div className="flex gap-3">
          <input
            type="text"
            value={inputUrl}
            onChange={(e) => setInputUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleParse()}
            placeholder="粘贴 B站视频链接 (例如: https://www.bilibili.com/video/BV1xx411c7mD 或 b23.tv/...)"
            className="flex-1 bg-slate-900 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-pink-500/50"
          />
          <button
            onClick={handleParse}
            disabled={loading}
            className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-pink-500 to-rose-500 hover:from-pink-400 hover:to-rose-400 text-white text-xs font-semibold shadow-lg shadow-pink-500/20 transition-all disabled:opacity-50"
          >
            {loading ? '解析中...' : '开始解析'}
          </button>
          {inputUrl && (
            <button
              onClick={() => {
                setInputUrl('')
                setVideoInfo(null)
                setPages([])
              }}
              className="px-3 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 text-xs transition-colors"
            >
              清空
            </button>
          )}
        </div>
      </div>

      {/* 视频核心信息与分 P 选集 */}
      {videoInfo && (
        <div className="space-y-4">
          {/* 视频概览 */}
          <div className="p-4 rounded-xl bg-slate-950/40 border border-slate-800 flex items-start gap-4">
            <img
              src={videoInfo.pic}
              alt="cover"
              className="w-40 h-24 object-cover rounded-lg border border-slate-800 shadow-md"
            />
            <div className="flex-1 overflow-hidden space-y-1.5">
              <h2 className="text-base font-semibold text-white truncate" title={videoInfo.title}>
                {videoInfo.title}
              </h2>
              <div className="flex items-center gap-3 text-xs text-slate-400">
                <span>UP主: <strong className="text-slate-300">{videoInfo.owner?.name}</strong></span>
                <span>•</span>
                <span className="font-mono text-pink-400">{videoInfo.bvid}</span>
                <span>•</span>
                <span>共 {videoInfo.pages.length} 集</span>
              </div>
              <p className="text-xs text-slate-500 line-clamp-2 leading-relaxed">
                {videoInfo.desc || '暂无视频简介'}
              </p>
            </div>
          </div>

          {/* 分 P 选集列表 */}
          <div className="p-5 rounded-xl bg-slate-950/60 border border-slate-800 space-y-3">
            <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
              <div className="flex items-center gap-3">
                <span className="text-xs font-semibold text-white">分 P 连载选集列表</span>
                <span className="text-[11px] text-slate-400">
                  (已选 <strong className="text-pink-400">{selectedCount}</strong> / {pages.length} 项)
                </span>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5 text-xs text-slate-300">
                  <span className="text-slate-400">下载画质:</span>
                  <select
                    value={selectedQuality}
                    onChange={(e) => setSelectedQuality(Number(e.target.value))}
                    className="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1 text-xs text-white focus:outline-none focus:border-pink-500 cursor-pointer"
                  >
                    {BILI_QUALITY_OPTIONS.map((opt) => (
                      <option key={opt.qn} value={opt.qn}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="h-4 w-px bg-slate-800" />

                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => handleSelectAll(true)}
                    className="px-2.5 py-1 rounded text-[11px] bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
                  >
                    全选
                  </button>
                  <button
                    onClick={() => handleSelectAll(false)}
                    className="px-2.5 py-1 rounded text-[11px] bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
                  >
                    取消全选
                  </button>
                </div>

                <button
                  onClick={handleBatchDownload}
                  disabled={pushing || selectedCount === 0}
                  className="ml-1 px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-xs shadow-md shadow-emerald-600/20 transition-all disabled:opacity-50"
                >
                  {pushing ? '推入中...' : `一键下载选中的 ${selectedCount} 项`}
                </button>
              </div>
            </div>

            {/* 选集表格/列表 */}
            <div className="max-h-72 overflow-y-auto space-y-1.5 pr-1">
              {pages.map((p, idx) => (
                <div
                  key={p.cid}
                  onClick={() => toggleSelect(idx)}
                  className={`flex items-center justify-between px-3.5 py-2.5 rounded-lg border text-xs cursor-pointer transition-colors ${
                    p.selected
                      ? 'bg-pink-500/10 border-pink-500/30 text-white'
                      : 'bg-slate-900/40 border-slate-800/60 text-slate-400 hover:bg-slate-900'
                  }`}
                >
                  <div className="flex items-center gap-3 overflow-hidden">
                    <input
                      type="checkbox"
                      checked={!!p.selected}
                      onChange={() => {}}
                      className="rounded accent-pink-500 w-4 h-4 cursor-pointer"
                    />
                    <span className="font-mono text-pink-400/90 w-8">P{p.page}</span>
                    <span className="truncate">{p.part}</span>
                  </div>
                  <span className="text-[11px] text-slate-500 font-mono ml-4 shrink-0">
                    CID: {p.cid}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 实时下载动态监控 */}
      {recentTasks.length > 0 && (
        <div className="p-4 rounded-xl bg-slate-950/40 border border-slate-800 space-y-2.5">
          <div className="text-xs font-semibold text-slate-400 flex items-center justify-between">
            <span>📥 当前下载进度</span>
            <span className="text-[11px] text-emerald-400 font-mono">后台下载中</span>
          </div>

          <div className="space-y-2">
            {recentTasks.map((t) => (
              <div
                key={t.taskId}
                className={`p-3 rounded-lg border text-xs space-y-1.5 transition-colors ${
                  t.status === 'failed'
                    ? 'bg-rose-950/20 border-rose-900/40'
                    : 'bg-slate-900/80 border-slate-800/60'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-slate-200 truncate max-w-sm font-medium">{t.filename}</span>
                  <span className="font-mono text-[11px]">
                    {t.status === 'completed' ? (
                      <span className="text-emerald-400 font-medium">✅ 已完成</span>
                    ) : t.status === 'failed' ? (
                      <span className="text-rose-400 font-medium">❌ 下载失败</span>
                    ) : t.status === 'merging' ? (
                      <span className="text-amber-400 animate-pulse font-medium">⚙️ FFmpeg 音视频合成中...</span>
                    ) : (
                      <span className="text-slate-400">{t.speed || ''} ({t.progress}%)</span>
                    )}
                  </span>
                </div>

                {t.status === 'failed' && t.error && (
                  <div className="text-rose-400 text-[11px] bg-rose-500/10 px-2.5 py-1 rounded border border-rose-500/20 break-all">
                    {t.error}
                  </div>
                )}

                <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all duration-300 ${
                      t.status === 'completed'
                        ? 'bg-emerald-500'
                        : t.status === 'failed'
                        ? 'bg-rose-500'
                        : t.status === 'merging'
                        ? 'bg-amber-400 animate-pulse'
                        : 'bg-pink-500'
                    }`}
                    style={{ width: `${t.status === 'failed' ? 100 : t.progress}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
