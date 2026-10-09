import React, { useCallback, useEffect, useRef, useState } from 'react'
import { getSDK, DownloadProgressInfo } from '@doujiao/plugin-sdk'
import { DownloadProgressPanel } from './shared/DownloadProgressPanel'
import type { NoticeType, ShowNotice } from './shared/notice'
import { DouyinTab } from './platforms/douyin/DouyinTab'
import { BilibiliTab } from './platforms/bilibili/BilibiliTab'

type Platform = 'douyin' | 'bilibili'

const PLATFORMS: { id: Platform; label: string; icon: string; desc: string }[] = [
  { id: 'douyin', label: '抖音', icon: '🎵', desc: '作品 / 合集 / 专题 / 创作者主页' },
  { id: 'bilibili', label: 'B站', icon: '📺', desc: '单视频 / 多P选集 / 清晰度选择' }
]

const NOTICE_STYLE: Record<NoticeType, string> = {
  success: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400',
  error: 'bg-rose-500/10 border-rose-500/30 text-rose-400',
  info: 'bg-indigo-500/10 border-indigo-500/30 text-indigo-300'
}

export default function App(): JSX.Element {
  const [platform, setPlatform] = useState<Platform>('douyin')

  // 两个平台共用同一份宿主下载进度广播
  const [tasksProgress, setTasksProgress] = useState<Record<string, DownloadProgressInfo>>({})

  const [notice, setNotice] = useState<{ text: string; type: NoticeType } | null>(null)
  const noticeTimer = useRef<number | null>(null)

  const showNotice = useCallback<ShowNotice>((text, type = 'success') => {
    setNotice({ text, type })
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current)
    noticeTimer.current = window.setTimeout(() => setNotice(null), 3500)
  }, [])

  useEffect(() => {
    return () => {
      if (noticeTimer.current) window.clearTimeout(noticeTimer.current)
    }
  }, [])

  useEffect(() => {
    try {
      const sdk = getSDK()
      const unsubscribe = sdk.download.onProgress((info) => {
        setTasksProgress((prev) => ({ ...prev, [info.taskId]: info }))
      })
      return () => unsubscribe()
    } catch (err) {
      console.warn('[Plugin:VideoDownloader] 无法注册下载进度监听器:', err)
      return () => {}
    }
  }, [])

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 p-8 select-none">
      <div className="w-full space-y-6">
        {/* 顶部头部 */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-5">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-emerald-500 via-teal-500 to-indigo-500 flex items-center justify-center text-2xl shadow-lg shadow-emerald-500/10">
              📥
            </div>
            <div>
              <h2 className="text-xl font-bold text-white tracking-wide">视频下载器</h2>
              <div className="flex items-center gap-2 text-xs text-slate-400 mt-1">
                <span>官方插件</span>
                <span>•</span>
                <span className="text-emerald-400 font-mono">v1.0.0</span>
              </div>
            </div>
          </div>

          <button
            onClick={() => getSDK()?.download.openSaveDirectory()}
            className="px-3.5 py-1.5 text-xs rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700/60 transition-colors"
          >
            📂 打开下载目录
          </button>
        </div>

        {/* 平台一级选项卡 */}
        <div className="flex gap-2">
          {PLATFORMS.map((p) => (
            <button
              key={p.id}
              onClick={() => setPlatform(p.id)}
              className={`flex items-center gap-3 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all border ${
                platform === p.id
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30 shadow-sm'
                  : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200 border-transparent'
              }`}
            >
              <span className="text-lg">{p.icon}</span>
              <span className="flex flex-col items-start leading-tight">
                <span>{p.label}</span>
                <span className="text-[10px] font-normal opacity-70">{p.desc}</span>
              </span>
            </button>
          ))}
        </div>

        {/* 统一操作提示 Toast */}
        {notice && (
          <div
            className={`p-3.5 rounded-xl border text-xs flex items-center justify-between ${NOTICE_STYLE[notice.type]}`}
          >
            <span>{notice.text}</span>
            <button onClick={() => setNotice(null)} className="text-slate-400 hover:text-white">
              ✕
            </button>
          </div>
        )}

        {/* ===================== 平台内容 ===================== */}
        {platform === 'douyin' ? (
          <DouyinTab showNotice={showNotice} />
        ) : (
          <BilibiliTab showNotice={showNotice} />
        )}

        {/* ===================== 两平台共用的任务监控 ===================== */}
        <DownloadProgressPanel
          tasks={Object.values(tasksProgress)}
          onClear={() => setTasksProgress({})}
        />
      </div>
    </div>
  )
}
