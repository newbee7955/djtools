import React from 'react'
import type { DownloadProgressInfo } from '@doujiao/plugin-sdk'

interface Props {
  tasks: DownloadProgressInfo[]
  onClear: () => void
}

const STATUS_META: Record<string, { label: string; badge: string; bar: string }> = {
  completed: { label: '✅ 已完成', badge: 'bg-emerald-500/20 text-emerald-400', bar: 'bg-emerald-500' },
  failed: { label: '❌ 下载失败', badge: 'bg-rose-500/20 text-rose-400', bar: 'bg-rose-500' },
  merging: {
    label: '⚙️ FFmpeg 音视频合成中...',
    badge: 'bg-amber-500/20 text-amber-400',
    bar: 'bg-amber-400 animate-pulse'
  },
  paused: { label: '⏸ 已暂停', badge: 'bg-slate-500/20 text-slate-300', bar: 'bg-slate-500' },
  pending: { label: '⏳ 排队中', badge: 'bg-indigo-500/20 text-indigo-400', bar: 'bg-indigo-500' },
  downloading: { label: '⬇️ 下载中', badge: 'bg-indigo-500/20 text-indigo-400', bar: 'bg-indigo-500' }
}

/**
 * 统一的实时下载进度面板：抖音与 B站提交的任务共用同一份宿主进度广播
 */
export const DownloadProgressPanel: React.FC<Props> = ({ tasks, onClear }) => {
  if (tasks.length === 0) return null

  return (
    <div className="p-4 rounded-xl bg-slate-950/40 border border-slate-800 space-y-2.5">
      <div className="text-xs font-semibold text-slate-400 flex items-center justify-between">
        <span>📥 当前下载进度</span>
        <button onClick={onClear} className="text-[11px] text-slate-500 hover:text-slate-300">
          清空监控列表
        </button>
      </div>

      <div className="space-y-2 max-h-48 overflow-y-auto">
        {tasks.map((t) => {
          const meta = STATUS_META[t.status] || STATUS_META.downloading
          return (
            <div
              key={t.taskId}
              className={`p-3 rounded-lg border text-xs space-y-1.5 transition-colors ${
                t.status === 'failed'
                  ? 'bg-rose-950/20 border-rose-900/40'
                  : 'bg-slate-900/80 border-slate-800/60'
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="text-slate-200 truncate max-w-sm font-medium" title={t.filename}>
                  {t.filename}
                </span>
                <div className="flex items-center gap-3 flex-shrink-0">
                  {(t.status === 'downloading' || t.status === 'pending') && (
                    <span className="font-mono text-[11px] text-slate-400">{t.speed}</span>
                  )}
                  <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${meta.badge}`}>
                    {meta.label}
                  </span>
                  <span className="font-mono text-emerald-400 font-semibold">{t.progress}%</span>
                </div>
              </div>

              {t.status === 'failed' && t.error && (
                <div className="text-rose-400 text-[11px] bg-rose-500/10 px-2.5 py-1 rounded border border-rose-500/20 break-all">
                  {t.error}
                </div>
              )}

              <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all duration-300 ${meta.bar}`}
                  style={{ width: `${t.status === 'failed' ? 100 : t.progress}%` }}
                />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
