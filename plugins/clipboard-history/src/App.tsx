import React, { useState, useEffect, useMemo } from 'react'
import { getSDK, ClipboardItem } from '@doujiao/plugin-sdk'

function formatTimeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp
  const seconds = Math.floor(diff / 1000)
  if (seconds < 10) return '刚刚'
  if (seconds < 60) return `${seconds} 秒前`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  return `${days} 天前`
}

export default function App(): JSX.Element {
  const [items, setItems] = useState<ClipboardItem[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [filterType, setFilterType] = useState<'all' | 'pinned' | 'image' | 'code' | 'multiline'>('all')
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [inspectItem, setInspectItem] = useState<ClipboardItem | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 2500)
  }

  // 加载与监听剪贴板
  useEffect(() => {
    let unsubscribe: (() => void) | undefined

    const fetchLatest = () => {
      try {
        const sdk = getSDK()
        if (sdk.clipboard) {
          sdk.clipboard
            .getHistory()
            .then((history) => {
              setItems(history || [])
              setLoading(false)
            })
            .catch((err) => {
              console.warn('[ClipboardHistory] 获取剪贴板历史失败:', err)
              setLoading(false)
            })
        } else {
          setLoading(false)
        }
      } catch {
        setLoading(false)
      }
    }

    fetchLatest()

    try {
      const sdk = getSDK()
      if (sdk.clipboard) {
        unsubscribe = sdk.clipboard.onChanged((updated) => {
          setItems(updated || [])
        })
      }
    } catch {}

    const handleFocus = () => fetchLatest()
    const handleVisibility = () => {
      if (!document.hidden) fetchLatest()
    }

    window.addEventListener('focus', handleFocus)
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      if (unsubscribe) unsubscribe()
      window.removeEventListener('focus', handleFocus)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [])

  // 刷新历史
  const refreshHistory = async () => {
    try {
      const sdk = getSDK()
      if (sdk.clipboard) {
        const history = await sdk.clipboard.getHistory()
        setItems(history || [])
        showToast('已同步最新剪贴板历史')
      }
    } catch {}
  }

  // 回写复制到系统剪贴板
  const handleCopy = async (item: ClipboardItem, e?: React.MouseEvent) => {
    if (e) e.stopPropagation()
    try {
      const sdk = getSDK()
      if (item.type === 'image' && item.dataUrl) {
        if (sdk.clipboard?.writeImage) {
          await sdk.clipboard.writeImage(item.dataUrl)
        } else {
          await sdk.clipboard?.writeText(item.text)
        }
        setCopiedId(item.id)
        setTimeout(() => setCopiedId(null), 1800)
        showToast('已回写图片并置顶到系统剪贴板')
      } else {
        if (sdk.clipboard) {
          await sdk.clipboard.writeText(item.text)
        } else {
          await navigator.clipboard.writeText(item.text)
        }
        setCopiedId(item.id)
        setTimeout(() => setCopiedId(null), 1800)
        showToast('已回写并置顶到系统剪贴板')
      }
    } catch (err) {
      console.error('[ClipboardHistory] 写入剪贴板失败:', err)
    }
  }

  // 切换置顶
  const handleTogglePin = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      const sdk = getSDK()
      if (sdk.clipboard) {
        await sdk.clipboard.togglePin(id)
      } else {
        setItems((prev) =>
          prev.map((i) => (i.id === id ? { ...i, pinned: !i.pinned } : i))
        )
      }
    } catch (err) {
      console.error('切换置顶失败:', err)
    }
  }

  // 删除单条
  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      const sdk = getSDK()
      if (sdk.clipboard) {
        await sdk.clipboard.deleteItem(id)
      } else {
        setItems((prev) => prev.filter((i) => i.id !== id))
      }
      if (inspectItem?.id === id) {
        setInspectItem(null)
      }
      showToast('已从历史中移除')
    } catch (err) {
      console.error('删除条目失败:', err)
    }
  }

  // 清空历史
  const handleClear = async () => {
    try {
      const sdk = getSDK()
      if (sdk.clipboard) {
        await sdk.clipboard.clearHistory()
      } else {
        setItems((prev) => prev.filter((i) => i.pinned))
      }
      showToast('已清空所有未置顶的历史记录')
    } catch (err) {
      console.error('清空历史失败:', err)
    }
  }

  // 过滤展示
  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return items.filter((item) => {
      // 搜索词过滤
      if (q && !item.text.toLowerCase().includes(q)) {
        return false
      }

      // 类型过滤
      if (filterType === 'pinned') return item.pinned
      if (filterType === 'image') return item.type === 'image'
      if (filterType === 'multiline') return item.type !== 'image' && item.lineCount > 1
      if (filterType === 'code') {
        return (
          item.type !== 'image' &&
          (item.text.includes('{') ||
            item.text.includes('function') ||
            item.text.includes('const ') ||
            item.text.includes('import ') ||
            item.text.includes('=>'))
        )
      }

      return true
    })
  }, [items, searchQuery, filterType])

  const pinnedCount = items.filter((i) => i.pinned).length
  const imageCount = items.filter((i) => i.type === 'image').length

  return (
    <div className="h-screen w-screen flex flex-col bg-slate-900 text-slate-100 overflow-hidden select-none font-sans">
      {/* Toast 提示 */}
      {toast && (
        <div className="absolute top-4 right-6 z-50 px-4 py-2 rounded-xl bg-indigo-600 text-white text-xs shadow-xl shadow-indigo-600/30 flex items-center gap-2 animate-bounce">
          <span>📋</span>
          <span>{toast}</span>
        </div>
      )}

      {/* 顶部标题与控制栏 */}
      <div className="h-16 px-6 bg-slate-950/80 border-b border-slate-800/80 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-2xl">📋</span>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-bold text-white tracking-wide">剪贴板历史记录</h1>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-mono flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                实时后台监听
              </span>
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5">
              系统文本与图片复制毫秒级捕获，去重保留最近 500 条，支持常用置顶与一键回写
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={refreshHistory}
            className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs border border-slate-700 transition-colors flex items-center gap-1.5"
            title="手动刷新"
          >
            <span>🔄</span>
            <span>刷新</span>
          </button>
          <button
            onClick={handleClear}
            className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-rose-900/30 text-slate-400 hover:text-rose-400 border border-slate-700 text-xs transition-colors flex items-center gap-1.5"
            title="清空未置顶的记录"
          >
            <span>🧹</span>
            <span>清空未置顶</span>
          </button>
        </div>
      </div>

      {/* 搜索与分类过滤器 */}
      <div className="p-4 bg-slate-950/40 border-b border-slate-800/60 flex flex-wrap items-center justify-between gap-3">
        {/* 搜索框 */}
        <div className="relative flex-1 max-w-md flex items-center">
          <span className="absolute left-3 text-slate-500 text-xs">🔍</span>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索剪贴板历史内容..."
            className="w-full pl-8 pr-8 py-2 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500/50"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 text-slate-500 hover:text-slate-300 text-xs"
            >
              ✕
            </button>
          )}
        </div>

        {/* 过滤器 Tab */}
        <div className="flex items-center bg-slate-900 border border-slate-800 rounded-xl p-1 text-xs gap-0.5">
          <button
            onClick={() => setFilterType('all')}
            className={`px-3 py-1 rounded-lg transition-colors ${
              filterType === 'all' ? 'bg-indigo-600 text-white font-medium' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            全部 ({items.length})
          </button>
          <button
            onClick={() => setFilterType('pinned')}
            className={`px-3 py-1 rounded-lg transition-colors ${
              filterType === 'pinned' ? 'bg-indigo-600 text-white font-medium' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            📌 已置顶 ({pinnedCount})
          </button>
          <button
            onClick={() => setFilterType('image')}
            className={`px-3 py-1 rounded-lg transition-colors ${
              filterType === 'image' ? 'bg-indigo-600 text-white font-medium' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            🖼️ 图片 ({imageCount})
          </button>
          <button
            onClick={() => setFilterType('multiline')}
            className={`px-3 py-1 rounded-lg transition-colors ${
              filterType === 'multiline' ? 'bg-indigo-600 text-white font-medium' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            📑 多行段落
          </button>
          <button
            onClick={() => setFilterType('code')}
            className={`px-3 py-1 rounded-lg transition-colors ${
              filterType === 'code' ? 'bg-indigo-600 text-white font-medium' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            💻 代码片段
          </button>
        </div>
      </div>

      {/* 历史卡片列表 */}
      <div className="flex-1 overflow-y-auto p-6 space-y-3">
        {loading ? (
          <div className="text-center py-20 text-slate-500 text-xs">正在连接剪贴板监视器...</div>
        ) : filteredItems.length === 0 ? (
          <div className="text-center py-20 text-slate-500 text-xs space-y-2">
            <div className="text-3xl">📭</div>
            <div>{searchQuery ? '没有找到匹配的剪贴板内容' : '暂无剪贴板历史记录，在系统任何应用中复制文本或图片后将自动捕获显示在此'}</div>
          </div>
        ) : (
          filteredItems.map((item) => {
            const isJustCopied = copiedId === item.id
            const isImage = item.type === 'image'
            return (
              <div
                key={item.id}
                onClick={() => setInspectItem(item)}
                className={`group p-4 rounded-xl border text-xs cursor-pointer transition-all hover:shadow-md ${
                  item.pinned
                    ? 'bg-slate-900/90 border-indigo-500/40 hover:border-indigo-500/60 shadow-sm shadow-indigo-500/5'
                    : 'bg-slate-900/80 border-slate-800/80 hover:bg-slate-900 hover:border-slate-700'
                }`}
              >
                {/* 顶部元数据与快捷按钮 */}
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2 text-[11px] text-slate-400 font-mono">
                    <span className="text-slate-300 font-medium">{formatTimeAgo(item.timestamp)}</span>
                    <span>•</span>
                    {isImage ? (
                      <>
                        <span className="px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-sans">
                          🖼️ 图片
                        </span>
                        <span>•</span>
                        <span>{item.width} × {item.height}</span>
                        <span>•</span>
                        <span>{Math.round((item.charCount || 0) / 1024)} KB</span>
                      </>
                    ) : (
                      <>
                        <span>{item.charCount} 字符</span>
                        {item.lineCount > 1 && (
                          <>
                            <span>•</span>
                            <span className="px-1.5 py-0.2 rounded bg-slate-800 text-slate-300 text-[10px]">
                              {item.lineCount} 行
                            </span>
                          </>
                        )}
                      </>
                    )}
                    {item.pinned && (
                      <span className="text-[10px] px-1.5 py-0.2 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 font-semibold">
                        已置顶
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5">
                    {/* 一键回写复制按钮 */}
                    <button
                      onClick={(e) => handleCopy(item, e)}
                      className={`px-3 py-1 rounded-lg text-xs font-medium transition-all flex items-center gap-1 shadow-sm ${
                        isJustCopied
                          ? 'bg-emerald-600 text-white'
                          : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-600/20'
                      }`}
                      title={isImage ? '点击回写图片至系统剪贴板' : '点击回写文本至系统剪贴板'}
                    >
                      <span>{isJustCopied ? '✓' : isImage ? '🖼️' : '📋'}</span>
                      <span>{isJustCopied ? '已复制' : isImage ? '复制图片' : '复制'}</span>
                    </button>

                    {/* 置顶按钮 */}
                    <button
                      onClick={(e) => handleTogglePin(item.id, e)}
                      className={`p-1.5 rounded-lg border text-xs transition-colors ${
                        item.pinned
                          ? 'bg-indigo-500/20 border-indigo-500/40 text-indigo-400'
                          : 'bg-slate-800/60 border-slate-700/60 text-slate-400 hover:text-slate-200 hover:bg-slate-700/60'
                      }`}
                      title={item.pinned ? '取消置顶' : '置顶此条目'}
                    >
                      📌
                    </button>

                    {/* 删除按钮 */}
                    <button
                      onClick={(e) => handleDelete(item.id, e)}
                      className="p-1.5 rounded-lg bg-slate-800/60 border border-slate-700/60 text-slate-400 hover:text-rose-400 hover:border-rose-500/40 hover:bg-rose-500/10 text-xs transition-colors"
                      title="删除记录"
                    >
                      🗑️
                    </button>
                  </div>
                </div>

                {/* 内容预览 */}
                {isImage ? (
                  <div className="bg-slate-800/40 p-2 rounded-lg border border-slate-700/40 flex items-center justify-center max-h-48 overflow-hidden">
                    <img
                      src={item.thumbnail || item.dataUrl}
                      alt={item.text}
                      className="max-h-44 max-w-full object-contain rounded select-none pointer-events-none"
                      loading="lazy"
                    />
                  </div>
                ) : (
                  <div className="bg-slate-800/40 p-3 rounded-lg border border-slate-700/40 font-mono text-xs text-slate-200 leading-relaxed max-h-28 overflow-hidden line-clamp-3 select-text whitespace-pre-wrap break-all">
                    {item.text}
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>

      {/* 详情浮窗 (Inspect Modal) */}
      {inspectItem && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-6">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-3xl max-h-[88vh] flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
            {/* Modal Header */}
            <div className="p-4 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-semibold text-white">
                {inspectItem.type === 'image' ? (
                  <>
                    <span>🖼️ 剪贴板图片详情</span>
                    <span className="text-slate-400 font-normal font-mono">
                      ({inspectItem.width} × {inspectItem.height} 像素 / {Math.round((inspectItem.charCount || 0) / 1024)} KB)
                    </span>
                  </>
                ) : (
                  <>
                    <span>📄 剪贴板文本详情</span>
                    <span className="text-slate-400 font-normal font-mono">
                      ({inspectItem.charCount} 字符 / {inspectItem.lineCount} 行)
                    </span>
                  </>
                )}
              </div>
              <button
                onClick={() => setInspectItem(null)}
                className="text-slate-400 hover:text-white text-xs px-2 py-1 rounded-lg hover:bg-slate-800"
              >
                ✕ 关闭
              </button>
            </div>

            {/* Modal Body */}
            {inspectItem.type === 'image' ? (
              <div className="flex-1 overflow-auto p-6 flex flex-col items-center justify-center bg-slate-950/90 min-h-[350px]">
                <img
                  src={inspectItem.dataUrl}
                  alt="剪贴板高清图片"
                  className="max-h-[62vh] max-w-full object-contain rounded-lg shadow-2xl border border-slate-800/80"
                />
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto p-5 font-mono text-xs text-slate-100 whitespace-pre-wrap leading-relaxed select-text bg-slate-950/40">
                {inspectItem.text}
              </div>
            )}

            {/* Modal Footer */}
            <div className="p-4 bg-slate-950 border-t border-slate-800 flex items-center justify-between text-xs">
              <span className="text-slate-500 font-mono">
                捕获时间: {new Date(inspectItem.timestamp).toLocaleString()}
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleCopy(inspectItem)}
                  className="px-4 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium shadow-md shadow-indigo-600/20 transition-all flex items-center gap-1.5"
                >
                  <span>{inspectItem.type === 'image' ? '🖼️' : '📋'}</span>
                  <span>{inspectItem.type === 'image' ? '复制图片到剪贴板' : '复制文本到剪贴板'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
