import React, { useState, useEffect } from 'react'
import type { PinItem } from '@doujiao/plugin-sdk'

export const PinWorkbenchView: React.FC = () => {
  const [activePins, setActivePins] = useState<PinItem[]>([])
  const [pinHistory, setPinHistory] = useState<PinItem[]>([])
  const [toastMsg, setToastMsg] = useState<string>('')
  const [isDraggingOver, setIsDraggingOver] = useState<boolean>(false)

  const showToast = (msg: string) => {
    setToastMsg(msg)
    setTimeout(() => setToastMsg(''), 2000)
  }

  const readFileAsDataURL = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
  }

  const loadData = async () => {
    try {
      const list = await window.doujiaoSDK?.pin?.getPinnedList?.()
      if (list) setActivePins(list)
    } catch (e) {
      console.error('加载贴图列表失败:', e)
    }
  }

  useEffect(() => {
    loadData()
    const unbind = window.doujiaoSDK?.pin?.onPinsChanged?.((pins) => {
      setActivePins(pins)
      // 同步到历史列表
      setPinHistory((prev) => {
        const ids = new Set(prev.map((p) => p.id))
        const newItems = pins.filter((p) => !ids.has(p.id))
        return [...newItems, ...prev].slice(0, 30)
      })
    })
    return () => unbind?.()
  }, [])

  // 从剪贴板贴图
  const handlePinFromClipboard = async () => {
    const res = await window.doujiaoSDK?.pin?.pinFromClipboard?.()
    if (res) {
      showToast('已从剪贴板成功创建贴图！')
      loadData()
    } else {
      showToast('剪贴板中未检测到可用图片 (可直接复制图片或图片文件按 Ctrl+V)')
    }
  }

  // 监听全局粘贴与快捷键
  useEffect(() => {
    const handlePaste = async (e: ClipboardEvent) => {
      const target = e.target as HTMLElement
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return
      }

      e.preventDefault()

      // 1. 如果剪贴板事件中带有文件项 (例如网页中复制的图片或文件)
      if (e.clipboardData && e.clipboardData.files && e.clipboardData.files.length > 0) {
        let created = 0
        for (let i = 0; i < e.clipboardData.files.length; i++) {
          const file = e.clipboardData.files[i]
          if (file.type.startsWith('image/') || /\.(png|jpe?g|webp|bmp|gif|ico|svg)$/i.test(file.name)) {
            try {
              const dataUrl = await readFileAsDataURL(file)
              await window.doujiaoSDK?.pin?.createPin?.({
                dataUrl,
                title: file.name || `贴图 #${Date.now()}`
              })
              created++
            } catch (err) {
              console.error('读取粘贴图片失败:', err)
            }
          }
        }
        if (created > 0) {
          showToast(`已成功粘贴创建 ${created} 张贴图！`)
          loadData()
          return
        }
      }

      // 2. 兜底调用宿主剪贴板贴图 (支持 Windows Explorer 复制的文件、系统截图等)
      handlePinFromClipboard()
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
        const target = e.target as HTMLElement
        if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
          return
        }
        e.preventDefault()
        handlePinFromClipboard()
      }
    }

    window.addEventListener('paste', handlePaste)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('paste', handlePaste)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [])

  // 拖放贴图支持
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDraggingOver(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDraggingOver(false)
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDraggingOver(false)

    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      let created = 0
      for (let i = 0; i < e.dataTransfer.files.length; i++) {
        const file = e.dataTransfer.files[i]
        if (file.type.startsWith('image/') || /\.(png|jpe?g|webp|bmp|gif|ico|svg)$/i.test(file.name)) {
          try {
            const dataUrl = await readFileAsDataURL(file)
            await window.doujiaoSDK?.pin?.createPin?.({
              dataUrl,
              title: file.name || `拖放贴图 #${Date.now()}`
            })
            created++
          } catch (err) {
            console.error('读取拖放图片失败:', err)
          }
        }
      }
      if (created > 0) {
        showToast(`成功创建 ${created} 张桌面贴图！`)
        loadData()
      } else {
        showToast('拖放的文件不是支持的图片格式')
      }
    }
  }

  // 截取屏幕贴图
  const handleCaptureScreen = async () => {
    try {
      await window.doujiaoSDK?.screen?.capture?.({ hideWindow: true, mode: 'snip' })
    } catch (err) {
      showToast('唤起截图失败')
    }
  }

  // 取消所有贴图鼠标穿透
  const handleCancelAllClickThrough = async () => {
    try {
      await window.doujiaoSDK?.pin?.cancelAllClickThrough?.()
      showToast('已恢复所有贴图鼠标正常交互')
    } catch {
      showToast('取消鼠标穿透失败')
    }
  }

  // 切换单张贴图鼠标穿透
  const handleTogglePinClickThrough = async (pin: PinItem) => {
    const nextState = !pin.clickThrough
    await window.doujiaoSDK?.pin?.setPinClickThrough?.(pin.id, nextState)
    showToast(nextState ? `已开启【${pin.title || '贴图'}】鼠标穿透` : `已恢复【${pin.title || '贴图'}】鼠标交互`)
  }

  // 关闭所有贴图
  const handleCloseAll = async () => {
    if (activePins.length === 0) return
    await window.doujiaoSDK?.pin?.closeAllPins?.()
    setActivePins([])
    showToast('已清空桌面所有贴图')
  }

  // 重新钉在桌面
  const handleRepin = async (item: PinItem) => {
    try {
      await window.doujiaoSDK?.pin?.createPin?.({
        dataUrl: item.dataUrl,
        title: item.title,
        opacity: item.opacity
      })
      showToast('已重新贴在桌面')
    } catch (err) {
      showToast('重新贴图失败')
    }
  }

  return (
    <div
      className={`relative w-full h-full flex flex-col bg-slate-950 text-slate-100 p-6 overflow-y-auto select-none transition-colors ${
        isDraggingOver ? 'bg-sky-950/30 ring-2 ring-sky-500/50' : ''
      }`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* 拖拽悬停遮罩提示 */}
      {isDraggingOver && (
        <div className="absolute inset-0 z-40 bg-sky-950/80 backdrop-blur-sm border-2 border-dashed border-sky-400 rounded-2xl flex flex-col items-center justify-center pointer-events-none">
          <span className="text-4xl mb-2 animate-bounce">📥</span>
          <span className="text-sm font-semibold text-sky-200">松开鼠标即可立即贴在桌面</span>
          <span className="text-xs text-sky-400 mt-1">支持 PNG, JPG, WebP, GIF, SVG 等格式</span>
        </div>
      )}

      {/* 顶部标题与功能操作区 */}
      <div className="flex items-center justify-between pb-6 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-xl shadow-inner">
            📌
          </div>
          <div>
            <h1 className="text-base font-semibold text-white tracking-wide">屏幕贴图与标注管理</h1>
            <p className="text-xs text-slate-400 mt-0.5">
              置顶浮动参考图、快捷吸色、滚轮无级缩放与就地标注神器
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-medium text-xs shadow-md shadow-sky-600/20 active:scale-95 transition-all"
            onClick={handlePinFromClipboard}
          >
            <span>📋</span>
            <span>剪贴板贴图 (Ctrl+V / Alt+F3)</span>
          </button>
          <button
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs border border-slate-700/80 active:scale-95 transition-all"
            onClick={handleCaptureScreen}
          >
            <span>📸</span>
            <span>截取新贴图</span>
          </button>
          {activePins.length > 0 && (
            <button
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 text-xs border border-rose-500/30 active:scale-95 transition-all"
              onClick={handleCloseAll}
            >
              <span>清空所有贴图 ({activePins.length})</span>
            </button>
          )}
        </div>
      </div>

      {/* 快捷键操作指南卡片 */}
      <div className="my-6 grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="p-3 bg-slate-900/60 border border-slate-800/80 rounded-2xl flex flex-col gap-1">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>剪贴板贴图</span>
            <kbd className="px-1.5 py-0.5 bg-slate-800 border border-slate-700 rounded text-[10px] font-mono text-sky-400 font-bold">
              Ctrl+V / Alt+F3
            </kbd>
          </div>
          <span className="text-[11px] text-slate-500">复制图片或图片文件后直接按 Ctrl+V 贴图</span>
        </div>

        <div className="p-3 bg-slate-900/60 border border-slate-800/80 rounded-2xl flex flex-col gap-1">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>尺寸缩放 / 透明度</span>
            <kbd className="px-1.5 py-0.5 bg-slate-800 border border-slate-700 rounded text-[10px] font-mono text-sky-400 font-bold">
              滚轮 / Ctrl+滚轮
            </kbd>
          </div>
          <span className="text-[11px] text-slate-500">无级缩放并调节参考图半透明</span>
        </div>

        <div className="p-3 bg-slate-900/60 border border-slate-800/80 rounded-2xl flex flex-col gap-1">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>穿透临摹 / 取消</span>
            <kbd className="px-1.5 py-0.5 bg-slate-800 border border-slate-700 rounded text-[10px] font-mono text-sky-400 font-bold">
              Ctrl+T / Ctrl+Shift+T
            </kbd>
          </div>
          <span className="text-[11px] text-slate-500">穿透直达底层，悬停右下角或快捷键随时恢复</span>
        </div>

        <div className="p-3 bg-slate-900/60 border border-slate-800/80 rounded-2xl flex flex-col gap-1">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>涂鸦标注 / 关闭</span>
            <kbd className="px-1.5 py-0.5 bg-slate-800 border border-slate-700 rounded text-[10px] font-mono text-sky-400 font-bold">
              空格 / Esc
            </kbd>
          </div>
          <span className="text-[11px] text-slate-500">双击或空格进入标注，按Esc退出</span>
        </div>
      </div>

      {/* 鼠标穿透恢复提醒横幅 */}
      {activePins.some((p) => p.clickThrough) && (
        <div className="mb-6 p-3.5 bg-amber-500/10 border border-amber-500/30 rounded-2xl flex items-center justify-between text-xs text-amber-200 shadow-lg backdrop-blur-sm animate-in fade-in duration-150">
          <div className="flex items-center gap-2.5">
            <span className="text-lg animate-bounce">👻</span>
            <span>
              当前有桌面贴图处于<strong>鼠标穿透</strong>状态（鼠标点击会穿透贴图直接操作底层应用）。悬停浮窗右下角控制栏可直接操作，或点击右侧按钮一键恢复。
            </span>
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
            <span className="text-[11px] text-amber-400 font-mono hidden sm:inline">快捷键: Ctrl+Shift+T</span>
            <button
              className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold rounded-xl text-xs shadow-md shadow-amber-500/20 active:scale-95 transition-all"
              onClick={handleCancelAllClickThrough}
            >
              一键取消所有穿透
            </button>
          </div>
        </div>
      )}

      {/* 当前桌面活动贴图 */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>当前桌面置顶贴图 ({activePins.length})</span>
          </h2>
        </div>

        {activePins.length === 0 ? (
          <div className="p-8 border border-dashed border-slate-800 rounded-2xl flex flex-col items-center justify-center text-center bg-slate-900/20">
            <span className="text-3xl mb-2">📌</span>
            <span className="text-xs text-slate-400">桌面当前没有活动的贴图浮窗</span>
            <span className="text-[11px] text-slate-500 mt-1">
              按 <span className="text-sky-400 font-mono">Ctrl+V</span> 或 <span className="text-sky-400 font-mono">Alt+F3</span> 直接粘贴剪贴板图片，也可直接拖放图片到此处
            </span>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {activePins.map((pin) => (
              <div
                key={pin.id}
                className="bg-slate-900/70 border border-slate-800 rounded-2xl p-3 flex flex-col gap-2 hover:border-slate-700 transition-all shadow-lg"
              >
                <div className="relative h-36 w-full rounded-xl overflow-hidden bg-slate-950/80 flex items-center justify-center border border-slate-800/50">
                  <img src={pin.dataUrl} alt={pin.title} className="max-h-full max-w-full object-contain" />
                  <span className="absolute bottom-1.5 right-2 px-1.5 py-0.5 rounded bg-black/60 text-[10px] font-mono text-slate-300 backdrop-blur-sm">
                    {pin.bounds ? `${pin.bounds.width}×${pin.bounds.height}` : '自适应'}
                  </span>
                </div>

                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1.5 truncate">
                    <span className="font-medium text-slate-200 truncate">{pin.title || '桌面贴图'}</span>
                    {pin.clickThrough && (
                      <span className="px-1.5 py-0.5 rounded bg-amber-500/20 border border-amber-500/40 text-[10px] text-amber-300 font-medium animate-pulse flex items-center gap-0.5">
                        <span>👻</span>
                        <span>穿透中</span>
                      </span>
                    )}
                  </div>
                  <span className="text-[11px] text-slate-500 flex-shrink-0">
                    {new Date(pin.createdAt).toLocaleTimeString('zh-CN', { hour12: false })}
                  </span>
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-slate-800/80 text-xs">
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-slate-400">透明度:</span>
                    <input
                      type="range"
                      min="20"
                      max="100"
                      value={Math.round((pin.opacity ?? 1) * 100)}
                      onChange={(e) => {
                        const val = parseInt(e.target.value, 10) / 100
                        window.doujiaoSDK?.pin?.setPinOpacity?.(pin.id, val)
                      }}
                      className="w-16 h-1 accent-sky-500 cursor-pointer"
                    />
                    <span className="text-[10px] text-slate-400 font-mono">
                      {Math.round((pin.opacity ?? 1) * 100)}%
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                        pin.clickThrough
                          ? 'bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40'
                          : 'hover:bg-slate-800 text-slate-400 hover:text-white'
                      }`}
                      onClick={() => handleTogglePinClickThrough(pin)}
                      title={pin.clickThrough ? '点击取消鼠标穿透' : '开启鼠标穿透 (Ctrl+T)'}
                    >
                      {pin.clickThrough ? '取消穿透' : '穿透'}
                    </button>
                    <button
                      className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-white transition-colors"
                      onClick={() => window.doujiaoSDK?.pin?.copyImage?.(pin.dataUrl)}
                      title="复制图片"
                    >
                      📋
                    </button>
                    <button
                      className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-white transition-colors"
                      onClick={() => window.doujiaoSDK?.pin?.saveAs?.(pin.dataUrl)}
                      title="保存图片"
                    >
                      💾
                    </button>
                    <button
                      className="px-2 py-0.5 rounded bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 text-[11px] transition-colors"
                      onClick={() => window.doujiaoSDK?.pin?.closePin?.(pin.id)}
                    >
                      关闭
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 历史记录 */}
      {pinHistory.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
              <span>📚 贴图历史快照 ({pinHistory.length})</span>
            </h2>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
            {pinHistory.map((item) => (
              <div
                key={item.id}
                className="group relative h-28 bg-slate-900/60 border border-slate-800 rounded-xl overflow-hidden p-1 hover:border-sky-500/50 transition-all flex items-center justify-center cursor-pointer"
                onClick={() => handleRepin(item)}
              >
                <img src={item.dataUrl} alt="History pin" className="max-h-full max-w-full object-contain" />
                <div className="absolute inset-0 bg-slate-950/70 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-xs text-white font-medium gap-1">
                  <span>📌</span>
                  <span>重新钉在桌面</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 底部反馈 Toast */}
      {toastMsg && (
        <div className="fixed bottom-6 left-1/2 transform -translate-x-1/2 z-50 px-4 py-2 bg-slate-900 border border-slate-700 rounded-full text-xs text-white shadow-2xl backdrop-blur-md animate-in fade-in duration-150">
          {toastMsg}
        </div>
      )}
    </div>
  )
}
