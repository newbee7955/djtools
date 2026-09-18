import React, { useState, useEffect } from 'react'
import type { ShelfItem, ShelfConfig } from '@doujiao/plugin-sdk'

export const ShelfWorkbenchView: React.FC = () => {
  const [items, setItems] = useState<ShelfItem[]>([])
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [toastMsg, setToastMsg] = useState<string>('')
  const [isPacking, setIsPacking] = useState<boolean>(false)
  const [showClearConfirm, setShowClearConfirm] = useState<boolean>(false)
  const [config, setConfig] = useState<ShelfConfig>({
    shortcut: 'Alt+Shift+D',
    copyFiles: true,
    autoDock: true,
    dockSide: 'right'
  })
  const [inputShortcut, setInputShortcut] = useState<string>('Alt+Shift+D')

  const showToast = (msg: string) => {
    setToastMsg(msg)
    setTimeout(() => setToastMsg(''), 2200)
  }

  const formatSize = (bytes: number): string => {
    if (!bytes || bytes <= 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
  }

  const getFileIcon = (item: ShelfItem): string => {
    if (item.type === 'directory') return '📁'
    if (item.type === 'image') return '🖼️'
    if (item.type === 'url') return '🔗'
    if (item.type === 'text') return '📝'

    const name = item.name.toLowerCase()
    if (name.endsWith('.zip') || name.endsWith('.rar') || name.endsWith('.7z') || name.endsWith('.tar') || name.endsWith('.gz')) return '📦'
    if (name.endsWith('.pdf')) return '📕'
    if (name.endsWith('.mp4') || name.endsWith('.mkv') || name.endsWith('.mov') || name.endsWith('.avi')) return '🎬'
    if (name.endsWith('.mp3') || name.endsWith('.wav') || name.endsWith('.flac')) return '🎵'
    if (name.endsWith('.js') || name.endsWith('.ts') || name.endsWith('.py') || name.endsWith('.html') || name.endsWith('.json')) return '💻'
    if (name.endsWith('.doc') || name.endsWith('.docx')) return '📄'
    if (name.endsWith('.xls') || name.endsWith('.xlsx') || name.endsWith('.csv')) return '📊'
    return '📄'
  }

  const loadData = async () => {
    try {
      const list = await window.doujiaoSDK?.shelf?.getItems()
      if (list) setItems(list)

      const cfg = await window.doujiaoSDK?.shelf?.getConfig?.()
      if (cfg) {
        setConfig(cfg)
        setInputShortcut(cfg.shortcut)
      }
    } catch (e) {
      console.error('加载暂存项或配置失败:', e)
    }
  }

  useEffect(() => {
    loadData()
    const unbind = window.doujiaoSDK?.shelf?.onShelfChanged((list) => {
      setItems(list)
    })

    const handleKeyDown = async (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
        const target = e.target as HTMLElement | null
        if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
          return
        }
        e.preventDefault()
        await executePaste()
      }
    }

    const handleWindowPaste = async (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return
      }
      e.preventDefault()
      await handleClipboardPasteEvent(e)
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('paste', handleWindowPaste)

    return () => {
      unbind?.()
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('paste', handleWindowPaste)
    }
  }, [config])

  const handleClipboardPasteEvent = async (e: ClipboardEvent) => {
    const files = e.clipboardData?.files
    if (files && files.length > 0) {
      let count = 0
      for (let i = 0; i < files.length; i++) {
        const f = files[i]
        const filePath = window.doujiaoSDK?.getPathForFile?.(f) || (f as any).path
        if (filePath) {
          await window.doujiaoSDK?.shelf?.addItem({
            path: filePath,
            name: f.name,
            size: f.size
          })
          count++
        }
      }
      if (count > 0) {
        showToast(config.copyFiles ? `已粘贴并暂存 ${count} 个文件副本` : `已粘贴 ${count} 个文件路径`)
        return
      }
    }

    const res = await window.doujiaoSDK?.shelf?.pasteFromClipboard?.()
    if (res && res.success) {
      showToast(res.message || `已暂存 ${res.count} 个项目`)
      return
    }

    const textData = e.clipboardData?.getData('text/plain')
    if (textData && textData.trim()) {
      await window.doujiaoSDK?.shelf?.addItem({
        content: textData.trim()
      })
      showToast('已暂存便签文本')
      return
    }

    showToast(res?.message || '剪贴板中无有效内容')
  }

  const executePaste = async () => {
    try {
      const res = await window.doujiaoSDK?.shelf?.pasteFromClipboard?.()
      if (res && res.success) {
        showToast(res.message || `已暂存 ${res.count} 个项目`)
      } else {
        showToast(res?.message || '剪贴板中无有效内容')
      }
    } catch {
      showToast('粘贴失败')
    }
  }

  const filteredItems = items.filter((it) =>
    it.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (it.path && it.path.toLowerCase().includes(searchQuery.toLowerCase())) ||
    (it.originalPath && it.originalPath.toLowerCase().includes(searchQuery.toLowerCase()))
  )

  const totalSize = items.reduce((acc, it) => acc + (it.size || 0), 0)
  const copiedCount = items.filter((it) => it.isCopy).length

  const handleSelectFiles = async () => {
    const res = await window.doujiaoSDK?.shelf?.selectFiles?.()
    if (res?.count) {
      showToast(config.copyFiles ? `已复制并暂存 ${res.count} 个文件` : `已添加 ${res.count} 个文件到暂存岛`)
    }
  }

  const handlePackZip = async () => {
    const valid = items.map((it) => it.path).filter(Boolean)
    if (valid.length === 0) {
      showToast('暂无有效文件可打包')
      return
    }
    setIsPacking(true)
    try {
      const res = await window.doujiaoSDK?.shelf?.packToZip(valid)
      if (res && res.success && res.zipPath) {
        await window.doujiaoSDK?.shelf?.addItem({ path: res.zipPath })
        showToast('打包成功并已自动加入暂存岛！')
      } else {
        showToast(`打包失败: ${res?.error || '未知错误'}`)
      }
    } catch {
      showToast('打包异常')
    } finally {
      setIsPacking(false)
    }
  }

  const handleCopyAllPaths = async () => {
    const valid = items.map((it) => it.path).filter(Boolean)
    if (valid.length === 0) return
    await window.doujiaoSDK?.shelf?.copyPaths(valid)
    showToast(`已复制 ${valid.length} 个文件路径`)
  }

  const handleClear = () => {
    if (items.length === 0) {
      showToast('暂存岛已经是空的')
      return
    }
    setShowClearConfirm(true)
  }

  const handleConfirmClear = async () => {
    setShowClearConfirm(false)
    await window.doujiaoSDK?.shelf?.clearShelf()
    showToast('暂存岛已清空')
  }

  const handleToggleDrawer = () => {
    window.doujiaoSDK?.shelf?.toggleShelfWindow()
  }

  const handleSaveConfig = async (newCfg: Partial<ShelfConfig>) => {
    try {
      const updated = await window.doujiaoSDK?.shelf?.setConfig?.(newCfg)
      if (updated) {
        setConfig(updated)
        setInputShortcut(updated.shortcut)
        showToast('暂存岛配置已保存')
      }
    } catch {
      showToast('保存配置失败')
    }
  }

  return (
    <div className="w-full h-full flex flex-col bg-slate-950 text-slate-100 p-6 overflow-y-auto select-none">
      {/* 顶部标题栏 */}
      <div className="flex items-center justify-between pb-6 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-xl shadow-inner">
            🏝️
          </div>
          <div>
            <h1 className="text-base font-semibold text-white tracking-wide">桌面文件暂存岛</h1>
            <p className="text-xs text-slate-400 mt-0.5">
              屏幕边缘滑出式收纳架，支持独立安全副本暂存、一键压缩打包与原生向外拖放
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs shadow-md shadow-indigo-600/20 active:scale-95 transition-all whitespace-nowrap flex-shrink-0"
            onClick={handleToggleDrawer}
          >
            <span>🖥️</span>
            <span className="text-white font-semibold">桌面浮窗抽屉 ({config.shortcut})</span>
          </button>
          <button
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs border border-slate-700/80 active:scale-95 transition-all whitespace-nowrap flex-shrink-0"
            onClick={executePaste}
            title="从系统剪贴板直接粘贴文件、截图或文本 (Ctrl+V)"
          >
            <span>📋</span>
            <span className="font-medium">从剪贴板粘贴</span>
          </button>
          <button
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs border border-slate-700/80 active:scale-95 transition-all whitespace-nowrap flex-shrink-0"
            onClick={handleSelectFiles}
          >
            <span>➕</span>
            <span className="font-medium">添加文件</span>
          </button>
          <button
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs border border-slate-700/80 active:scale-95 transition-all whitespace-nowrap flex-shrink-0 disabled:opacity-50"
            onClick={handlePackZip}
            disabled={isPacking || items.length === 0}
          >
            <span>{isPacking ? '⏳' : '📦'}</span>
            <span className="font-medium">打包 ZIP</span>
          </button>
          {items.length > 0 && (
            <button
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 text-xs border border-rose-500/30 active:scale-95 transition-all whitespace-nowrap flex-shrink-0"
              onClick={handleClear}
            >
              <span className="font-medium">清空暂存</span>
            </button>
          )}
        </div>
      </div>

      {/* 概览统计与快捷键卡片 */}
      <div className="my-6 grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-4 bg-slate-900/60 border border-slate-800/80 rounded-2xl flex items-center justify-between">
          <div>
            <div className="text-xs text-slate-400">暂存项目总数</div>
            <div className="text-2xl font-bold font-mono text-white mt-1">
              {items.length}
              <span className="text-xs font-normal text-emerald-400 ml-2">
                ({copiedCount} 个安全独立副本)
              </span>
            </div>
          </div>
          <span className="text-3xl opacity-80">📑</span>
        </div>

        <div className="p-4 bg-slate-900/60 border border-slate-800/80 rounded-2xl flex items-center justify-between">
          <div>
            <div className="text-xs text-slate-400">总占用存储容量</div>
            <div className="text-2xl font-bold font-mono text-indigo-400 mt-1">{formatSize(totalSize)}</div>
          </div>
          <span className="text-3xl opacity-80">💾</span>
        </div>

        <div className="p-4 bg-slate-900/60 border border-slate-800/80 rounded-2xl flex items-center justify-between">
          <div>
            <div className="text-xs text-slate-400">桌面呼出快捷键</div>
            <div className="flex items-center gap-1.5 mt-1.5">
              <input
                type="text"
                value={inputShortcut}
                onChange={(e) => setInputShortcut(e.target.value)}
                className="w-28 px-2 py-0.5 bg-slate-800 border border-slate-700 rounded text-xs font-mono text-sky-400 text-center focus:outline-none focus:border-sky-500"
              />
              <button
                className="px-2 py-0.5 bg-sky-600 hover:bg-sky-500 rounded text-white text-[11px] font-medium transition-colors"
                onClick={() => handleSaveConfig({ shortcut: inputShortcut.trim() })}
              >
                保存
              </button>
            </div>
          </div>
          <span className="text-3xl opacity-80">⚡</span>
        </div>
      </div>

      {/* 存储模式切换说明栏 */}
      <div className="mb-6 p-4 rounded-2xl bg-slate-900/40 border border-slate-800 flex items-center justify-between text-xs">
        <div className="flex items-center gap-3">
          <span className="text-xl">🛡️</span>
          <div>
            <div className="font-semibold text-slate-200">文件暂存存储策略</div>
            <div className="text-slate-400 text-[11px] mt-0.5">
              当前为：<span className="text-sky-400 font-semibold">{config.copyFiles ? '独立副本模式' : '原路径引用模式'}</span>。
              {config.copyFiles
                ? ' 文件已完整复制到暂存岛持久目录，即使将桌面或下载文件夹的源文件删除，暂存岛内的文件仍完整保留。'
                : ' 仅记录原文件路径以节省磁盘空间，源文件被移动或删除后将无法使用。'}
            </div>
          </div>
        </div>

        <label className="flex items-center gap-2 cursor-pointer bg-slate-800/80 hover:bg-slate-800 px-3 py-1.5 rounded-xl border border-slate-700/80">
          <input
            type="checkbox"
            checked={config.copyFiles}
            onChange={(e) => handleSaveConfig({ copyFiles: e.target.checked })}
            className="rounded accent-sky-500 w-3.5 h-3.5"
          />
          <span className="text-slate-200 font-medium">自动复制为独立副本</span>
        </label>
      </div>

      {/* 边缘停靠与折叠设置栏 */}
      <div className="mb-6 p-4 rounded-2xl bg-slate-900/40 border border-slate-800 flex items-center justify-between text-xs">
        <div className="flex items-center gap-3">
          <span className="text-xl">📌</span>
          <div>
            <div className="font-semibold text-slate-200">屏幕边缘停靠折叠 (悬浮标签)</div>
            <div className="text-slate-400 text-[11px] mt-0.5">
              启用后，桌面暂存岛抽屉可折叠收起为屏幕边缘的紧凑迷你标签 <kbd className="px-1 py-0.5 rounded bg-slate-800 border border-slate-700 font-mono text-sky-400 text-[10px]">◀ 🏝️</kbd>，拖拽文件悬停至标签或快捷键呼出时即时展开。
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {config.autoDock !== false && (
            <div className="flex items-center gap-1 bg-slate-800/80 p-1 rounded-xl border border-slate-700/80">
              <button
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                  config.dockSide !== 'left'
                    ? 'bg-indigo-600 text-white shadow'
                    : 'text-slate-400 hover:text-white'
                }`}
                onClick={() => handleSaveConfig({ dockSide: 'right' })}
              >
                靠右停靠
              </button>
              <button
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                  config.dockSide === 'left'
                    ? 'bg-indigo-600 text-white shadow'
                    : 'text-slate-400 hover:text-white'
                }`}
                onClick={() => handleSaveConfig({ dockSide: 'left' })}
              >
                靠左停靠
              </button>
            </div>
          )}

          <label className="flex items-center gap-2 cursor-pointer bg-slate-800/80 hover:bg-slate-800 px-3 py-1.5 rounded-xl border border-slate-700/80">
            <input
              type="checkbox"
              checked={config.autoDock !== false}
              onChange={(e) => handleSaveConfig({ autoDock: e.target.checked })}
              className="rounded accent-sky-500 w-3.5 h-3.5"
            />
            <span className="text-slate-200 font-medium">启用边缘停靠折叠</span>
          </label>
        </div>
      </div>

      {/* 列表头部与过滤检索 */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
          <span>暂存项目清单 ({filteredItems.length})</span>
        </h2>

        <div className="flex items-center gap-2">
          {items.length > 0 && (
            <button
              className="text-xs text-slate-400 hover:text-white px-2 py-1 hover:bg-slate-800 rounded-lg transition-colors"
              onClick={handleCopyAllPaths}
            >
              复制所有路径
            </button>
          )}
          <input
            type="text"
            placeholder="搜索暂存文件..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="px-3 py-1 bg-slate-900 border border-slate-800 rounded-xl text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500 w-48"
          />
        </div>
      </div>

      {/* 项目表格 */}
      {filteredItems.length === 0 ? (
        <div className="p-12 border border-dashed border-slate-800 rounded-2xl flex flex-col items-center justify-center text-center bg-slate-900/20 my-2">
          <span className="text-4xl mb-2">🏝️</span>
          <span className="text-xs text-slate-400">暂存岛中暂无文件</span>
          <span className="text-[11px] text-slate-500 mt-1">
            按快捷键 <span className="font-mono text-indigo-400">{config.shortcut}</span> 唤醒桌面悬浮抽屉，将任意文件拖入，或直接按 <span className="font-mono text-indigo-400">Ctrl+V</span> 从剪贴板粘贴存入
          </span>
          <button
            onClick={executePaste}
            className="mt-3 px-3 py-1.5 rounded-xl bg-indigo-600/80 hover:bg-indigo-500 text-white text-xs font-medium flex items-center gap-1.5 shadow transition-all active:scale-95"
          >
            <span>📋</span>
            <span>从剪贴板粘贴 (Ctrl+V)</span>
          </button>
        </div>
      ) : (
        <div className="border border-slate-800 rounded-2xl overflow-hidden bg-slate-900/40">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-900/80 text-slate-400 border-b border-slate-800">
              <tr>
                <th className="px-4 py-3 font-medium">名称</th>
                <th className="px-4 py-3 font-medium">存储模式</th>
                <th className="px-4 py-3 font-medium">原始路径 / 暂存路径</th>
                <th className="px-4 py-3 font-medium">大小</th>
                <th className="px-4 py-3 font-medium">添加时间</th>
                <th className="px-4 py-3 font-medium text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {filteredItems.map((item) => (
                <tr key={item.id} className="hover:bg-slate-800/40 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-lg bg-slate-800 flex items-center justify-center flex-shrink-0 text-sm overflow-hidden">
                        {item.thumbnail ? (
                          <img src={item.thumbnail} alt={item.name} className="w-full h-full object-cover" />
                        ) : (
                          <span>{item.type === 'directory' ? '📁' : item.type === 'image' ? '🖼️' : '📄'}</span>
                        )}
                      </div>
                      <span className="font-medium text-slate-200 truncate max-w-xs" title={item.name}>
                        {item.name}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {item.isCopy ? (
                      <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-[10px] font-medium">
                        独立副本
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full bg-slate-800 border border-slate-700 text-slate-400 text-[10px]">
                        源文件引用
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono text-[11px] text-slate-400 truncate max-w-xs" title={item.originalPath || item.path}>
                    {item.originalPath || item.path || '便签纯文本'}
                  </td>
                  <td className="px-4 py-3 font-mono text-slate-400">{formatSize(item.size)}</td>
                  <td className="px-4 py-3 text-slate-500">
                    {new Date(item.createdAt).toLocaleString('zh-CN')}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      {item.path && (
                        <>
                          <button
                            className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px]"
                            onClick={() => window.doujiaoSDK?.shelf?.openFile?.(item.path)}
                          >
                            打开
                          </button>
                          <button
                            className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px]"
                            onClick={() => window.doujiaoSDK?.shelf?.showItemInFolder?.(item.path)}
                          >
                            定位
                          </button>
                        </>
                      )}
                      <button
                        className="px-2 py-1 rounded bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 text-[11px]"
                        onClick={() => window.doujiaoSDK?.shelf?.removeItems([item.id])}
                      >
                        移除
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 清空暂存二次确认弹窗 */}
      {showClearConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-sm p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-2xl flex flex-col gap-4 text-slate-100 animate-in zoom-in-95 duration-150">
            <div className="flex items-start gap-3.5">
              <div className="w-10 h-10 rounded-2xl bg-rose-500/15 border border-rose-500/30 flex items-center justify-center text-xl flex-shrink-0 text-rose-400">
                ⚠️
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-bold text-white tracking-wide">清空暂存项目？</h3>
                <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
                  确定要清空暂存岛中的全部 <span className="text-sky-400 font-semibold font-mono">{items.length}</span> 个项目吗？
                  {items.some((it) => it.isCopy) && (
                    <span className="block text-amber-400/90 mt-1 text-[11px]">
                      提示：其中包含的本地独立副本缓存文件将被同步彻底清理。
                    </span>
                  )}
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-800/80">
              <button
                type="button"
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition-colors"
                onClick={() => setShowClearConfirm(false)}
              >
                取消
              </button>
              <button
                type="button"
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-medium shadow-lg shadow-rose-600/30 transition-all active:scale-95"
                onClick={handleConfirmClear}
              >
                确认清空
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 提示消息 Toast */}
      {toastMsg && (
        <div className="fixed bottom-6 left-1/2 transform -translate-x-1/2 z-50 px-4 py-2 bg-slate-900 border border-slate-700 rounded-full text-xs text-white shadow-2xl backdrop-blur-md animate-in fade-in duration-150">
          {toastMsg}
        </div>
      )}
    </div>
  )
}
