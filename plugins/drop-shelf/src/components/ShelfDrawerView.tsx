import React, { useState, useEffect } from 'react'
import type { ShelfItem, ShelfConfig } from '@doujiao/plugin-sdk'

export const ShelfDrawerView: React.FC = () => {
  const [items, setItems] = useState<ShelfItem[]>([])
  const [isCollapsed, setIsCollapsed] = useState<boolean>(false)
  const [isDragOver, setIsDragOver] = useState<boolean>(false)
  const [toastMsg, setToastMsg] = useState<string>('')
  const [isPacking, setIsPacking] = useState<boolean>(false)
  const [showSettings, setShowSettings] = useState<boolean>(false)
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

      const col = await window.doujiaoSDK?.shelf?.isCollapsed?.()
      if (col !== undefined) {
        setIsCollapsed(col)
      }
    } catch (e) {
      console.error('加载暂存项或配置失败:', e)
    }
  }

  useEffect(() => {
    loadData()
    const unbindShelf = window.doujiaoSDK?.shelf?.onShelfChanged((list) => {
      setItems(list)
    })
    const unbindCollapse = window.doujiaoSDK?.shelf?.onCollapseChanged?.((col) => {
      setIsCollapsed(col)
    })

    // 键盘 Ctrl+V 快捷键与 paste 事件监听
    const handleKeyDown = async (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
        const target = e.target as HTMLElement | null
        if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
          return // 输入框内部编辑保留默认行为
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
      unbindShelf?.()
      unbindCollapse?.()
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('paste', handleWindowPaste)
    }
  }, [config])

  // 处理剪贴板粘贴事件
  const handleClipboardPasteEvent = async (e: ClipboardEvent) => {
    // 1. 优先通过 Chromium 原生获取复制的文件 (0 延迟即时解析)
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

    // 2. 若没有直接文件路径，调用 SDK 从系统剪贴板粘贴 (图片、Windows 文件或文本)
    const res = await window.doujiaoSDK?.shelf?.pasteFromClipboard?.()
    if (res && res.success) {
      showToast(res.message || `已暂存 ${res.count} 个项目`)
      return
    }

    // 3. 兜底处理纯文本 / URL
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

  // 主动触发粘贴 (按钮或快捷键)
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

  const handleCollapse = async () => {
    await window.doujiaoSDK?.shelf?.setCollapsed?.(true)
  }

  const handleExpand = async () => {
    await window.doujiaoSDK?.shelf?.setCollapsed?.(false)
  }

  // 拖入放置文件监听
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragOver(false)
    }
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)

    // 1. 本地文件拖入
    const droppedFiles = e.dataTransfer.files
    if (droppedFiles && droppedFiles.length > 0) {
      let count = 0
      for (let i = 0; i < droppedFiles.length; i++) {
        const f = droppedFiles[i]
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
        showToast(config.copyFiles ? `已复制并暂存 ${count} 个独立项目` : `已记录 ${count} 个项目路径`)
        return
      }
    }

    // 2. 纯文本 / URL 拖入
    const textData = e.dataTransfer.getData('text/plain')
    if (textData && textData.trim()) {
      await window.doujiaoSDK?.shelf?.addItem({
        content: textData.trim()
      })
      showToast('已暂存便签文本')
    }
  }

  // 原生甩出拖拽单个文件
  const handleItemDragStart = (e: React.DragEvent, item: ShelfItem) => {
    if (!item.path) return
    e.preventDefault()
    window.doujiaoSDK?.shelf?.startDrag([item.path])
  }

  // 原生甩出拖拽全部文件
  const handleDragAllStart = (e: React.DragEvent) => {
    const validPaths = items.map((it) => it.path).filter(Boolean)
    if (validPaths.length === 0) return
    e.preventDefault()
    window.doujiaoSDK?.shelf?.startDrag(validPaths)
  }

  // 打包为 ZIP
  const handlePackZip = async () => {
    const validPaths = items.map((it) => it.path).filter(Boolean)
    if (validPaths.length === 0) {
      showToast('暂无有效文件可打包')
      return
    }
    setIsPacking(true)
    try {
      const res = await window.doujiaoSDK?.shelf?.packToZip(validPaths)
      if (res && res.success && res.zipPath) {
        await window.doujiaoSDK?.shelf?.addItem({ path: res.zipPath })
        showToast('打包成功并已自动暂存 ZIP')
      } else {
        showToast(`打包失败: ${res?.error || '未知错误'}`)
      }
    } catch {
      showToast('打包异常')
    } finally {
      setIsPacking(false)
    }
  }

  // 复制路径
  const handleCopyPaths = async () => {
    const validPaths = items.map((it) => it.path).filter(Boolean)
    if (validPaths.length === 0) {
      showToast('暂无有效文件路径')
      return
    }
    await window.doujiaoSDK?.shelf?.copyPaths(validPaths)
    showToast(`已复制 ${validPaths.length} 个文件路径`)
  }

  // 选择外部文件
  const handleSelectFiles = async () => {
    const res = await window.doujiaoSDK?.shelf?.selectFiles?.()
    if (res?.count) {
      showToast(config.copyFiles ? `已复制并暂存 ${res.count} 个文件` : `已添加 ${res.count} 个文件`)
    }
  }

  // 清空暂存 (弹出确认弹窗)
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

  // 折叠标签下的拖入事件 (实现拖拽文件悬停即自动展开)
  const handleTabDragEnter = async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(true)
    await handleExpand()
  }

  const handleTabDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!isDragOver) setIsDragOver(true)
  }

  const handleTabDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
  }

  const handleTabDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
    await handleDrop(e)
  }

  // 鼠标按住上下拖拽停靠位置 / 单击展开
  const handleTabPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    const startScreenY = e.screenY
    let isMoving = false

    const handlePointerMove = (moveEv: PointerEvent) => {
      const delta = moveEv.screenY - startScreenY
      if (Math.abs(delta) > 3) {
        isMoving = true
        window.doujiaoSDK?.shelf?.setTabY?.(moveEv.screenY - 80)
      }
    }

    const handlePointerUp = () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      if (!isMoving) {
        handleExpand()
      }
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
  }

  // 保存配置
  const handleSaveConfig = async (newCfg: Partial<ShelfConfig>) => {
    try {
      const updated = await window.doujiaoSDK?.shelf?.setConfig?.(newCfg)
      if (updated) {
        setConfig(updated)
        setInputShortcut(updated.shortcut)
        showToast('暂存岛设置已保存')
      }
    } catch {
      showToast('保存设置失败')
    }
  }

  // 关闭窗口
  const handleClose = () => {
    window.doujiaoSDK?.shelf?.toggleShelfWindow(false)
  }

  // 1. 折叠状态：渲染屏幕边缘紧凑悬浮把手/标签
  if (isCollapsed) {
    const isLeft = config.dockSide === 'left'
    return (
      <div
        className={`w-full h-full flex flex-col items-center justify-between py-3 px-1 select-none cursor-pointer transition-all ${
          isLeft
            ? 'rounded-r-2xl border-r-2 border-y-2'
            : 'rounded-l-2xl border-l-2 border-y-2'
        } ${
          isDragOver
            ? 'bg-sky-950/95 border-sky-400 ring-2 ring-sky-400/80 shadow-[0_0_25px_rgba(56,189,248,0.5)]'
            : 'bg-slate-900/95 hover:bg-slate-800/95 border-slate-700/80 hover:border-sky-400/80 shadow-2xl backdrop-blur-2xl'
        }`}
        onPointerDown={handleTabPointerDown}
        onDragEnter={handleTabDragEnter}
        onDragOver={handleTabDragOver}
        onDragLeave={handleTabDragLeave}
        onDrop={handleTabDrop}
        title="点击展开文件暂存岛 (按住可上下调整停靠位置；拖入文件自动展开暂存)"
      >
        {/* 顶部展开指示箭头 */}
        <div className="flex flex-col items-center gap-1 group pt-0.5">
          <span className="text-sky-400 text-xs font-bold transition-transform group-hover:scale-125 animate-pulse">
            {isLeft ? '▶' : '◀'}
          </span>
          <div className="w-1.5 h-1.5 rounded-full bg-sky-500/80"></div>
        </div>

        {/* 中间岛屿图标 */}
        <div className="flex flex-col items-center justify-center my-auto py-1">
          <span className="text-2xl transition-transform hover:scale-110 active:scale-95" role="img" aria-label="shelf">
            {isDragOver ? '📥' : '🏝️'}
          </span>
          <span className="text-[10px] text-slate-300 font-medium tracking-tight mt-1">暂存</span>
        </div>

        {/* 底部数量徽标 */}
        <div className="flex flex-col items-center pb-0.5">
          {items.length > 0 ? (
            <span className="px-1.5 py-0.5 rounded-full bg-sky-500 text-white font-mono font-bold text-[10px] leading-none shadow-md">
              {items.length}
            </span>
          ) : (
            <span className="w-4 h-4 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-[9px] text-slate-400">
              0
            </span>
          )}
        </div>
      </div>
    )
  }

  // 2. 展开状态：完整文件抽屉
  const isLeft = config.dockSide === 'left'
  return (
    <div
      className={`relative w-full h-full flex flex-col bg-slate-900/95 ${
        isLeft ? 'border-r rounded-r-2xl' : 'border-l rounded-l-2xl'
      } border-slate-700/80 shadow-2xl backdrop-blur-2xl text-slate-100 select-none overflow-hidden transition-all ${
        isDragOver ? 'ring-4 ring-sky-500/80 bg-slate-900/98' : ''
      }`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* 顶部标题与快捷操作栏 */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-800/80 bg-slate-950/60 flex-shrink-0">
        {/* 左侧紧凑标题与计数 */}
        <div className="flex items-center gap-1.5 min-w-0 flex-shrink-0">
          <span className="text-base flex-shrink-0">🏝️</span>
          <span className="text-xs font-bold text-white tracking-wide">暂存岛</span>
          <span className="px-1.5 py-0.5 rounded-full bg-sky-500/20 text-sky-400 text-[11px] font-mono font-bold leading-none">
            {items.length}
          </span>
          <span
            className={`hidden sm:inline-block px-1 py-0.5 rounded text-[9px] font-medium leading-none whitespace-nowrap ${
              config.copyFiles
                ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                : 'bg-slate-800 text-slate-400 border border-slate-700'
            }`}
            title={config.copyFiles ? '独立安全副本暂存' : '原文件路径引用'}
          >
            {config.copyFiles ? '副本' : '引用'}
          </span>
        </div>

        {/* 中间快捷操作按钮组 */}
        <div className="flex items-center gap-0.5 flex-shrink min-w-0 overflow-hidden mx-1">
          <button
            className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-sky-500/20 text-slate-400 hover:text-sky-400 transition-colors text-xs flex-shrink-0"
            onClick={executePaste}
            title="从剪贴板粘贴 (Ctrl+V，支持文件、截图与文本)"
          >
            📋
          </button>
          <button
            className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors text-xs flex-shrink-0"
            onClick={handleSelectFiles}
            title="添加本地文件"
          >
            ➕
          </button>
          <button
            className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors text-xs flex-shrink-0 disabled:opacity-40"
            onClick={handlePackZip}
            disabled={isPacking || items.length === 0}
            title="打包为 ZIP"
          >
            {isPacking ? '⏳' : '📦'}
          </button>
          <button
            className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 transition-colors text-xs flex-shrink-0"
            onClick={handleClear}
            title="清空暂存"
          >
            🧹
          </button>
          <button
            className={`w-7 h-7 flex items-center justify-center rounded-lg transition-colors text-xs flex-shrink-0 ${
              showSettings ? 'bg-sky-600 text-white' : 'hover:bg-slate-800 text-slate-400 hover:text-white'
            }`}
            onClick={() => setShowSettings(!showSettings)}
            title="暂存岛设置"
          >
            ⚙️
          </button>
        </div>

        {/* 右侧窗口常驻控制组 (折叠停靠 & 关闭收起，固定绝不溢出) */}
        <div className="flex items-center gap-1 flex-shrink-0 pl-1.5 border-l border-slate-800/80">
          <button
            className="h-7 px-2 flex items-center justify-center gap-1 rounded-lg bg-slate-800/80 hover:bg-sky-500/20 text-slate-300 hover:text-sky-300 border border-slate-700/80 hover:border-sky-500/40 transition-all text-xs font-medium active:scale-95 shadow-sm"
            onClick={handleCollapse}
            title={isLeft ? '折叠停靠到左侧边缘标签' : '折叠停靠到右侧边缘标签'}
          >
            <span className="text-[11px]">{isLeft ? '◀' : '▶'}</span>
            <span className="text-[11px]">折叠</span>
          </button>
          <button
            className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 transition-colors text-xs active:scale-95"
            onClick={handleClose}
            title={`收起隐藏暂存岛 (${config.shortcut})`}
          >
            ✕
          </button>
        </div>
      </div>

      {/* 快捷设置抽屉面板 */}
      {showSettings && (
        <div className="p-3 bg-slate-950/95 border-b border-slate-800 text-xs flex flex-col gap-2.5 flex-shrink-0 animate-in slide-in-from-top-2 duration-150 shadow-lg">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-slate-200">暂存岛设置</span>
            <button
              className="text-[10px] text-slate-400 hover:text-white"
              onClick={() => setShowSettings(false)}
            >
              关闭
            </button>
          </div>

          {/* 边缘停靠折叠开关 */}
          <div className="flex flex-col gap-1">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={config.autoDock !== false}
                onChange={(e) => handleSaveConfig({ autoDock: e.target.checked })}
                className="rounded accent-sky-500 w-3.5 h-3.5"
              />
              <span className="font-medium text-slate-200">屏幕边缘停靠折叠 (推荐)</span>
            </label>
            <span className="text-[10px] text-slate-400 pl-5 leading-relaxed">
              开启后，快捷键或靠边按钮可将暂存岛折叠为贴靠在屏幕侧边的悬浮标签。
            </span>
          </div>

          {/* 停靠侧边选择 */}
          <div className="flex items-center justify-between pt-1.5 border-t border-slate-800/80">
            <span className="text-[11px] text-slate-300">停靠侧边:</span>
            <div className="flex items-center gap-1.5">
              <button
                className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
                  config.dockSide !== 'left'
                    ? 'bg-sky-600 text-white'
                    : 'bg-slate-800 text-slate-400 hover:text-white'
                }`}
                onClick={() => handleSaveConfig({ dockSide: 'right' })}
              >
                屏幕右侧 (推荐)
              </button>
              <button
                className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
                  config.dockSide === 'left'
                    ? 'bg-sky-600 text-white'
                    : 'bg-slate-800 text-slate-400 hover:text-white'
                }`}
                onClick={() => handleSaveConfig({ dockSide: 'left' })}
              >
                屏幕左侧
              </button>
            </div>
          </div>

          {/* 暂存复制模式 */}
          <div className="flex flex-col gap-1 pt-1.5 border-t border-slate-800/80">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={config.copyFiles}
                onChange={(e) => handleSaveConfig({ copyFiles: e.target.checked })}
                className="rounded accent-sky-500 w-3.5 h-3.5"
              />
              <span className="font-medium text-slate-200">自动复制独立副本（推荐）</span>
            </label>
            <span className="text-[10px] text-slate-400 pl-5 leading-relaxed">
              开启后，拖入的文件将复制一份到暂存岛，桌面原文件删除不影响暂存岛；关闭则仅记录原路径。
            </span>
          </div>

          {/* 快捷键设置 */}
          <div className="flex items-center justify-between pt-1.5 border-t border-slate-800/80">
            <span className="text-[11px] text-slate-300">呼出快捷键:</span>
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                value={inputShortcut}
                onChange={(e) => setInputShortcut(e.target.value)}
                placeholder="如 Alt+Shift+D"
                className="w-28 px-2 py-0.5 bg-slate-900 border border-slate-700 rounded text-[11px] font-mono text-sky-400 text-center focus:outline-none focus:border-sky-500"
              />
              <button
                className="px-2 py-0.5 bg-sky-600 hover:bg-sky-500 rounded text-white text-[10px] font-medium transition-colors"
                onClick={() => handleSaveConfig({ shortcut: inputShortcut.trim() })}
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 拖拽全部文件外甩手柄 */}
      {items.length > 1 && (
        <div
          draggable={true}
          onDragStart={handleDragAllStart}
          className="mx-3 mt-2 px-3 py-1.5 bg-gradient-to-r from-sky-600/30 to-indigo-600/30 border border-sky-500/40 hover:border-sky-400/70 rounded-xl flex items-center justify-between text-xs text-sky-200 cursor-grab active:cursor-grabbing shadow-sm hover:shadow transition-all flex-shrink-0"
          title="按住此栏可将全部文件一次性拖拽甩出到微信、桌面或目标文件夹"
        >
          <div className="flex items-center gap-1.5 font-medium">
            <span>🚀</span>
            <span>按住拖出全部文件 ({items.length})</span>
          </div>
          <span className="text-[10px] text-sky-400 font-mono">拖拽甩出 ↗</span>
        </div>
      )}

      {/* 暂存项列表 */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2 min-h-0">
        {items.length === 0 ? (
          <div className="h-full w-full flex flex-col items-center justify-center text-center p-6 border-2 border-dashed border-slate-800/80 rounded-2xl box-border">
            <span className="text-4xl mb-3 animate-bounce">📥</span>
            <span className="text-xs font-semibold text-slate-200">拖入或直接 Ctrl+V 粘贴文件</span>
            <span className="text-[11px] text-slate-400 mt-1.5 max-w-[250px] leading-relaxed">
              支持直接按 <kbd className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 font-mono text-sky-400 text-[10px]">Ctrl + V</kbd> 快速粘贴复制的文件、截图或便签
            </span>
            <button
              onClick={executePaste}
              className="mt-3.5 px-3.5 py-1.5 rounded-xl bg-sky-600/80 hover:bg-sky-500 text-white text-xs font-medium flex items-center gap-1.5 shadow transition-all active:scale-95"
            >
              <span>📋</span>
              <span>从剪贴板粘贴 (Ctrl+V)</span>
            </button>
          </div>
        ) : (
          items.map((item) => (
            <div
              key={item.id}
              draggable={true}
              onDragStart={(e) => handleItemDragStart(e, item)}
              className="group relative flex items-center gap-2.5 p-2 rounded-xl bg-slate-950/60 hover:bg-slate-800/80 border border-slate-800/80 hover:border-slate-700 transition-all cursor-grab active:cursor-grabbing shadow-sm"
              title={`按住可拖出到桌面或其它程序；双击在系统中打开\n原路径: ${item.originalPath || item.path}`}
              onDoubleClick={() => {
                if (item.path) window.doujiaoSDK?.shelf?.openFile?.(item.path)
              }}
            >
              {/* 缩略图或类型图标 */}
              <div className="w-10 h-10 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-center flex-shrink-0 overflow-hidden text-lg">
                {item.thumbnail ? (
                  <img src={item.thumbnail} alt={item.name} className="w-full h-full object-cover" />
                ) : (
                  <span>{getFileIcon(item)}</span>
                )}
              </div>

              {/* 文件信息 */}
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium text-slate-200 truncate group-hover:text-sky-300 transition-colors flex items-center gap-1.5">
                  <span className="truncate">{item.name}</span>
                  {item.isCopy ? (
                    <span className="px-1 py-0.2 rounded bg-emerald-500/20 text-emerald-400 text-[9px] font-mono flex-shrink-0">
                      副本
                    </span>
                  ) : (
                    <span className="px-1 py-0.2 rounded bg-slate-800 text-slate-400 text-[9px] font-mono flex-shrink-0">
                      原路径
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 text-[10px] text-slate-500 mt-0.5">
                  <span className="font-mono">{formatSize(item.size)}</span>
                  <span>•</span>
                  <span>{new Date(item.createdAt).toLocaleTimeString('zh-CN', { hour12: false })}</span>
                </div>
              </div>

              {/* 快捷按钮 */}
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                {item.path && (
                  <button
                    className="p-1 hover:bg-slate-700 rounded text-slate-400 hover:text-white text-xs"
                    onClick={(e) => {
                      e.stopPropagation()
                      window.doujiaoSDK?.shelf?.showItemInFolder?.(item.path)
                    }}
                    title="在文件夹中定位"
                  >
                    📂
                  </button>
                )}
                <button
                  className="p-1 hover:bg-rose-500/20 rounded text-slate-400 hover:text-rose-400 text-xs"
                  onClick={(e) => {
                    e.stopPropagation()
                    window.doujiaoSDK?.shelf?.removeItems([item.id])
                  }}
                  title="移除"
                >
                  ✕
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* 拖入悬停提示遮罩 */}
      {isDragOver && (
        <div className="absolute inset-0 z-50 bg-sky-600/20 backdrop-blur-sm border-2 border-sky-400 rounded-none flex flex-col items-center justify-center pointer-events-none">
          <span className="text-3xl animate-pulse">📥</span>
          <span className="text-xs font-bold text-sky-200 mt-2">
            松开鼠标即可{config.copyFiles ? '复制暂存此项目' : '暂存此项目路径'}
          </span>
        </div>
      )}

      {/* 清空暂存二次确认弹窗 */}
      {showClearConfirm && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-[280px] bg-slate-900 border border-slate-700/80 rounded-2xl p-4 shadow-2xl flex flex-col gap-3 text-slate-100 animate-in zoom-in-95 duration-150">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-rose-500/20 border border-rose-500/30 flex items-center justify-center text-lg flex-shrink-0 text-rose-400">
                ⚠️
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-white">清空暂存岛？</div>
                <div className="text-xs text-slate-400 mt-1 leading-relaxed">
                  确定要清空所有 <span className="text-sky-400 font-semibold font-mono">{items.length}</span> 个暂存项目吗？
                  {items.some((it) => it.isCopy) && (
                    <span className="block text-amber-400/90 mt-1 text-[11px]">
                      提示：本地独立副本文件将被同步彻底清理。
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition-colors"
                onClick={() => setShowClearConfirm(false)}
              >
                取消
              </button>
              <button
                type="button"
                className="px-3 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-medium shadow-md shadow-rose-600/30 transition-colors active:scale-95"
                onClick={handleConfirmClear}
              >
                确认清空
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 底部浮动 Toast */}
      {toastMsg && (
        <div className="fixed bottom-3 left-1/2 transform -translate-x-1/2 z-50 px-3 py-1 bg-slate-950/95 border border-slate-700/80 rounded-full text-xs text-white shadow-xl backdrop-blur-md animate-in fade-in duration-150">
          {toastMsg}
        </div>
      )}
    </div>
  )
}
