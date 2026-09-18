import React, { useState, useEffect, useRef, useCallback } from 'react'
import type { PinItem } from '@doujiao/plugin-sdk'

interface Props {
  pinId: string
}

type ToolType = 'pen' | 'highlighter' | 'rect' | 'circle' | 'arrow' | 'line' | 'badge' | 'text' | 'mosaic'

export const PinFloatingView: React.FC<Props> = ({ pinId }) => {
  const [pinItem, setPinItem] = useState<PinItem | null>(null)
  const [scale, setScale] = useState<number>(1)
  const [opacity, setOpacity] = useState<number>(1)
  const [isAnnotating, setIsAnnotating] = useState<boolean>(false)
  const [currentTool, setCurrentTool] = useState<ToolType>('pen')
  const [color, setColor] = useState<string>('#ef4444')
  const [lineWidth, setLineWidth] = useState<number>(3)
  const [contextMenuPos, setContextMenuPos] = useState<{ x: number; y: number } | null>(null)
  const [toastMsg, setToastMsg] = useState<string>('')
  const [badgeCount, setBadgeCount] = useState<number>(1)

  // 内联文字输入状态
  const [textInput, setTextInput] = useState<{
    x: number
    y: number
    screenX: number
    screenY: number
  } | null>(null)
  const [textInputValue, setTextInputValue] = useState<string>('')

  // 节点引用与绘图历史栈
  const imgRef = useRef<HTMLImageElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const historyRef = useRef<ImageData[]>([])
  const isDrawingRef = useRef<boolean>(false)
  const startPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 })
  const snapshotRef = useRef<ImageData | null>(null)
  const penPointsRef = useRef<Array<{ x: number; y: number }>>([])

  // 窗口无边框拖移状态
  const isDraggingWinRef = useRef<boolean>(false)
  const dragStartPointRef = useRef<{ screenX: number; screenY: number }>({ screenX: 0, screenY: 0 })
  const toastTimerRef = useRef<NodeJS.Timeout | null>(null)

  const showToast = (msg: string, duration = 1800) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    setToastMsg(msg)
    toastTimerRef.current = setTimeout(() => setToastMsg(''), duration)
  }

  // 加载贴图数据
  useEffect(() => {
    const loadPin = async () => {
      try {
        const item = await window.doujiaoSDK?.pin?.getPinData?.(pinId)
        if (item) {
          setPinItem(item)
          if (item.opacity) setOpacity(item.opacity)
          if (item.scale) setScale(item.scale)
        }
      } catch (e) {
        console.error('加载贴图详情失败:', e)
      }
    }
    loadPin()

    const unbind = window.doujiaoSDK?.pin?.onPinsChanged?.((pins) => {
      const found = pins.find((p) => p.id === pinId)
      if (found) {
        setPinItem(found)
        if (found.opacity !== undefined) setOpacity(found.opacity)
      }
    })
    return () => {
      unbind?.()
    }
  }, [pinId])

  // 当底图加载完成时，同步初始化画布分辨率 (与原图 1:1 像素完全对齐)
  const handleImageLoaded = useCallback(() => {
    const img = imgRef.current
    const canvas = canvasRef.current
    if (!img || !canvas) return
    const w = img.naturalWidth || img.width || 360
    const h = img.naturalHeight || img.height || 240
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (ctx) {
        ctx.clearRect(0, 0, w, h)
        historyRef.current = [ctx.getImageData(0, 0, w, h)]
      }
    }
  }, [])

  useEffect(() => {
    if (imgRef.current?.complete) {
      handleImageLoaded()
    }
  }, [pinItem?.dataUrl, handleImageLoaded])

  // 窗口拖拽监听 (非标注模式下按住鼠标左键平移窗口)
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return
    if (isAnnotating) return
    if (
      (e.target as HTMLElement).closest('.action-bar') ||
      (e.target as HTMLElement).closest('.context-menu') ||
      (e.target as HTMLElement).closest('.annotation-toolbar')
    ) {
      return
    }

    isDraggingWinRef.current = true
    dragStartPointRef.current = { screenX: e.screenX, screenY: e.screenY }
  }

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!isDraggingWinRef.current) return
      const dx = e.screenX - dragStartPointRef.current.screenX
      const dy = e.screenY - dragStartPointRef.current.screenY
      if (dx !== 0 || dy !== 0) {
        dragStartPointRef.current = { screenX: e.screenX, screenY: e.screenY }
        window.doujiaoSDK?.pin?.movePin?.(pinId, dx, dy)
      }
    }

    const onMouseUp = () => {
      isDraggingWinRef.current = false
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [pinId])

  // 滚轮缩放与透明度调整
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    if (e.ctrlKey) {
      // 调整透明度
      const delta = e.deltaY < 0 ? 0.08 : -0.08
      const nextOpacity = Math.max(0.15, Math.min(1.0, +(opacity + delta).toFixed(2)))
      setOpacity(nextOpacity)
      window.doujiaoSDK?.pin?.setPinOpacity?.(pinId, nextOpacity)
      showToast(`透明度: ${Math.round(nextOpacity * 100)}%`)
    } else {
      // 缩放尺寸
      const factor = e.deltaY < 0 ? 1.1 : 0.9
      const nextScale = Math.max(0.2, Math.min(6.0, +(scale * factor).toFixed(2)))
      setScale(nextScale)
      showToast(`缩放: ${Math.round(nextScale * 100)}%`)
    }
  }

  // 关闭贴图
  const handleClose = () => {
    window.doujiaoSDK?.pin?.closePin?.(pinId)
  }

  // 切换鼠标穿透状态
  const isClickThrough = !!pinItem?.clickThrough

  const handleToggleClickThrough = () => {
    const nextState = !isClickThrough
    // 开启穿透前关闭标注模式
    if (nextState && isAnnotating) {
      setIsAnnotating(false)
    }
    window.doujiaoSDK?.pin?.setPinClickThrough?.(pinId, nextState)
    if (nextState) {
      showToast('👻 已开启鼠标穿透：悬停右下角控制栏可直接操作/关闭，按 Ctrl+Shift+T 随时取消', 4000)
    } else {
      showToast('已取消鼠标穿透，恢复正常交互')
    }
  }

  // 开启/退出涂鸦标注模式
  const handleToggleAnnotating = () => {
    if (!isAnnotating) {
      if (isClickThrough) {
        window.doujiaoSDK?.pin?.setPinClickThrough?.(pinId, false)
      }
      setIsAnnotating(true)
      showToast('✏️ 已进入涂鸦标注模式')
    } else {
      setIsAnnotating(false)
      setTextInput(null)
      showToast('已完成标注，标注内容已保留在贴图上')
    }
  }

  // 计算屏幕点击相对于 Canvas 原生像素的真实坐标 (完全不受 CSS 缩放、高分屏及 transform 影响)
  const getCanvasPoint = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / (rect.width || 1)
    const scaleY = canvas.height / (rect.height || 1)
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY
    }
  }

  // 绘制真实马赛克像素块
  const drawMosaic = (
    ctx: CanvasRenderingContext2D,
    img: HTMLImageElement,
    x0: number,
    y0: number,
    x1: number,
    y1: number
  ) => {
    const rx = Math.max(0, Math.round(Math.min(x0, x1)))
    const ry = Math.max(0, Math.round(Math.min(y0, y1)))
    const rw = Math.round(Math.abs(x1 - x0))
    const rh = Math.round(Math.abs(y1 - y0))
    if (rw < 4 || rh < 4) return

    const blockSize = Math.max(10, lineWidth * 4)
    const sw = Math.max(1, Math.round(rw / blockSize))
    const sh = Math.max(1, Math.round(rh / blockSize))

    const offCanvas = document.createElement('canvas')
    offCanvas.width = sw
    offCanvas.height = sh
    const offCtx = offCanvas.getContext('2d')
    if (!offCtx) return

    offCtx.drawImage(img, rx, ry, rw, rh, 0, 0, sw, sh)

    ctx.save()
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(offCanvas, 0, 0, sw, sh, rx, ry, rw, rh)
    ctx.restore()
  }

  // 标注绘制 Pointer 事件
  const onCanvasPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {}

    const { x, y } = getCanvasPoint(e)

    if (currentTool === 'text') {
      setTextInput({ x, y, screenX: e.clientX, screenY: e.clientY })
      setTextInputValue('')
      return
    }

    if (currentTool === 'badge') {
      ctx.save()
      ctx.fillStyle = color
      const r = Math.max(12, lineWidth * 3 + 6)
      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#ffffff'
      ctx.font = `bold ${Math.round(r * 1.1)}px sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(String(badgeCount), x, y)
      ctx.restore()
      setBadgeCount((c) => c + 1)
      historyRef.current.push(ctx.getImageData(0, 0, canvas.width, canvas.height))
      return
    }

    isDrawingRef.current = true
    startPosRef.current = { x, y }
    penPointsRef.current = [{ x, y }]
    snapshotRef.current = ctx.getImageData(0, 0, canvas.width, canvas.height)
  }

  const onCanvasPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawingRef.current) return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const { x, y } = getCanvasPoint(e)

    if (currentTool === 'pen' || currentTool === 'highlighter') {
      ctx.save()
      ctx.strokeStyle = color
      const w = currentTool === 'highlighter' ? lineWidth * 5 : lineWidth * 1.5
      ctx.lineWidth = w
      ctx.globalAlpha = currentTool === 'highlighter' ? 0.35 : 1.0
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.beginPath()
      const prev = penPointsRef.current[penPointsRef.current.length - 1]
      ctx.moveTo(prev.x, prev.y)
      ctx.lineTo(x, y)
      ctx.stroke()
      ctx.restore()
      penPointsRef.current.push({ x, y })
      return
    }

    // 预览模式：先恢复底图快照
    if (snapshotRef.current) {
      ctx.putImageData(snapshotRef.current, 0, 0)
    }

    const x0 = startPosRef.current.x
    const y0 = startPosRef.current.y

    if (currentTool === 'mosaic' && imgRef.current) {
      drawMosaic(ctx, imgRef.current, x0, y0, x, y)
      return
    }

    ctx.save()
    ctx.strokeStyle = color
    ctx.fillStyle = color
    ctx.lineWidth = lineWidth * 1.5
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    if (currentTool === 'rect') {
      ctx.strokeRect(Math.min(x0, x), Math.min(y0, y), Math.abs(x - x0), Math.abs(y - y0))
    } else if (currentTool === 'circle') {
      const rx = Math.abs(x - x0) / 2
      const ry = Math.abs(y - y0) / 2
      const cx = (x0 + x) / 2
      const cy = (y0 + y) / 2
      ctx.beginPath()
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2)
      ctx.stroke()
    } else if (currentTool === 'line') {
      ctx.beginPath()
      ctx.moveTo(x0, y0)
      ctx.lineTo(x, y)
      ctx.stroke()
    } else if (currentTool === 'arrow') {
      ctx.beginPath()
      ctx.moveTo(x0, y0)
      ctx.lineTo(x, y)
      ctx.stroke()
      const angle = Math.atan2(y - y0, x - x0)
      const headLen = Math.max(14, lineWidth * 5)
      ctx.beginPath()
      ctx.moveTo(x, y)
      ctx.lineTo(x - headLen * Math.cos(angle - Math.PI / 7), y - headLen * Math.sin(angle - Math.PI / 7))
      ctx.moveTo(x, y)
      ctx.lineTo(x - headLen * Math.cos(angle + Math.PI / 7), y - headLen * Math.sin(angle + Math.PI / 7))
      ctx.stroke()
    }

    ctx.restore()
  }

  const onCanvasPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawingRef.current) return
    isDrawingRef.current = false
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {}

    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (ctx) {
      historyRef.current.push(ctx.getImageData(0, 0, canvas.width, canvas.height))
      if (historyRef.current.length > 25) historyRef.current.shift()
    }
  }

  // 提交内联文字标注
  const handleCommitText = () => {
    if (!textInput || !textInputValue.trim()) {
      setTextInput(null)
      setTextInputValue('')
      return
    }
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (ctx) {
      ctx.save()
      ctx.fillStyle = color
      const fontSize = Math.max(16, lineWidth * 6 + 10)
      ctx.font = `bold ${fontSize}px "Segoe UI", sans-serif`
      ctx.shadowColor = 'rgba(0,0,0,0.85)'
      ctx.shadowBlur = 5
      ctx.textBaseline = 'top'
      ctx.fillText(textInputValue, textInput.x, textInput.y)
      ctx.restore()
      historyRef.current.push(ctx.getImageData(0, 0, canvas.width, canvas.height))
    }
    setTextInput(null)
    setTextInputValue('')
  }

  // 撤销标注
  const handleUndo = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    if (historyRef.current.length <= 1) {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      showToast('标注画布已清空')
      return
    }
    historyRef.current.pop()
    const prev = historyRef.current[historyRef.current.length - 1]
    ctx.putImageData(prev, 0, 0)
    showToast('已撤销上一步标注')
  }

  // 清空全部标注
  const handleClear = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    historyRef.current = [ctx.getImageData(0, 0, canvas.width, canvas.height)]
    setBadgeCount(1)
    showToast('已清空全部标注')
  }

  // 组合底图与标注画布 (任何时刻导出均保持 100% 原始画质与标注)
  const getComposedDataUrl = (): string | null => {
    if (!pinItem?.dataUrl) return null
    const canvas = canvasRef.current
    const img = imgRef.current
    if (!canvas || !img) return pinItem.dataUrl

    const exportCanvas = document.createElement('canvas')
    exportCanvas.width = img.naturalWidth || canvas.width
    exportCanvas.height = img.naturalHeight || canvas.height
    const ctx = exportCanvas.getContext('2d')
    if (!ctx) return pinItem.dataUrl

    ctx.drawImage(img, 0, 0, exportCanvas.width, exportCanvas.height)
    ctx.drawImage(canvas, 0, 0, exportCanvas.width, exportCanvas.height)
    return exportCanvas.toDataURL('image/png', 0.98)
  }

  // 复制图片到剪贴板
  const handleCopyImage = async () => {
    if (!pinItem?.dataUrl) return
    const finalUrl = getComposedDataUrl() || pinItem.dataUrl
    await window.doujiaoSDK?.pin?.copyImage?.(finalUrl)
    showToast('已复制图片到剪贴板 (含标注)')
  }

  // 另存为文件
  const handleSaveAs = async () => {
    if (!pinItem?.dataUrl) return
    const finalUrl = getComposedDataUrl() || pinItem.dataUrl
    await window.doujiaoSDK?.pin?.saveAs?.(finalUrl, `贴图_${Date.now()}.png`)
  }

  // 键盘快捷键监听
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (textInput) {
          setTextInput(null)
        } else if (isAnnotating) {
          setIsAnnotating(false)
        } else {
          handleClose()
        }
      } else if (e.code === 'Space' && (e.target as HTMLElement).tagName !== 'INPUT') {
        e.preventDefault()
        handleToggleAnnotating()
      } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 't') {
        e.preventDefault()
        window.doujiaoSDK?.pin?.setPinClickThrough?.(pinId, false)
        showToast('已取消鼠标穿透')
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 't') {
        e.preventDefault()
        handleToggleClickThrough()
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
        e.preventDefault()
        handleCopyImage()
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        handleSaveAs()
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        if (isAnnotating) handleUndo()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  })

  return (
    <div
      className="relative w-full h-full select-none overflow-hidden group"
      style={{ backgroundColor: 'transparent' }}
      onMouseDown={handleMouseDown}
      onWheel={handleWheel}
      onContextMenu={(e) => {
        e.preventDefault()
        setContextMenuPos({ x: e.clientX, y: e.clientY })
      }}
      onClick={() => setContextMenuPos(null)}
      onDoubleClick={(e) => {
        if (
          (e.target as HTMLElement).closest('.action-bar') ||
          (e.target as HTMLElement).closest('.annotation-toolbar')
        ) {
          return
        }
        handleToggleAnnotating()
      }}
    >
      {/* 贴图底图与画布主展示层 (随 scale 缩放联动，画笔与底图永远保持 1:1 绝对对齐) */}
      {pinItem?.dataUrl ? (
        <div
          className="w-full h-full flex items-center justify-center transition-transform duration-75"
          style={{
            transform: `scale(${scale})`,
            transformOrigin: 'center center'
          }}
        >
          <div className="relative inline-block max-w-none shadow-2xl rounded overflow-hidden">
            <img
              ref={imgRef}
              src={pinItem.dataUrl}
              alt="Pinned image"
              className="block max-w-none rounded select-none"
              style={{
                imageRendering: scale >= 1.5 ? 'pixelated' : 'auto',
                pointerEvents: 'none'
              }}
              onLoad={handleImageLoaded}
            />
            {/* 常驻画布层：非标注时 pointer-events-none 保留视觉显示；标注时 pointer-events-auto 进行绘制 */}
            <canvas
              ref={canvasRef}
              className={`absolute inset-0 w-full h-full z-20 touch-none ${
                isAnnotating ? 'cursor-crosshair pointer-events-auto' : 'pointer-events-none'
              }`}
              onPointerDown={onCanvasPointerDown}
              onPointerMove={onCanvasPointerMove}
              onPointerUp={onCanvasPointerUp}
            />
          </div>
        </div>
      ) : (
        <div className="w-full h-full flex items-center justify-center text-xs text-slate-400">
          加载贴图中...
        </div>
      )}

      {/* 顶部自适应标注工具栏 */}
      {isAnnotating && (
        <div
          className="annotation-toolbar absolute top-2 left-1/2 transform -translate-x-1/2 z-40 flex items-center flex-wrap justify-center gap-1 px-2.5 py-1.5 bg-slate-900/95 border border-slate-700/90 rounded-2xl shadow-2xl backdrop-blur-md text-xs text-white max-w-[96%] select-none"
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {/* 工具类型切换按钮组 */}
          <button
            className={`p-1.5 rounded-lg transition-colors ${currentTool === 'pen' ? 'bg-sky-600 text-white shadow-sm' : 'hover:bg-slate-800 text-slate-300'}`}
            onClick={() => setCurrentTool('pen')}
            title="涂鸦画笔 (自由手绘)"
          >
            ✏️
          </button>
          <button
            className={`p-1.5 rounded-lg transition-colors ${currentTool === 'highlighter' ? 'bg-sky-600 text-white shadow-sm' : 'hover:bg-slate-800 text-slate-300'}`}
            onClick={() => setCurrentTool('highlighter')}
            title="荧光笔 (半透明重点高亮)"
          >
            🖍️
          </button>
          <button
            className={`p-1.5 rounded-lg transition-colors ${currentTool === 'rect' ? 'bg-sky-600 text-white shadow-sm' : 'hover:bg-slate-800 text-slate-300'}`}
            onClick={() => setCurrentTool('rect')}
            title="矩形框"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2" />
            </svg>
          </button>
          <button
            className={`p-1.5 rounded-lg transition-colors ${currentTool === 'circle' ? 'bg-sky-600 text-white shadow-sm' : 'hover:bg-slate-800 text-slate-300'}`}
            onClick={() => setCurrentTool('circle')}
            title="椭圆"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="9" />
            </svg>
          </button>
          <button
            className={`p-1.5 rounded-lg transition-colors ${currentTool === 'arrow' ? 'bg-sky-600 text-white shadow-sm' : 'hover:bg-slate-800 text-slate-300'}`}
            onClick={() => setCurrentTool('arrow')}
            title="指示箭头"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </button>
          <button
            className={`p-1.5 rounded-lg transition-colors ${currentTool === 'line' ? 'bg-sky-600 text-white shadow-sm' : 'hover:bg-slate-800 text-slate-300'}`}
            onClick={() => setCurrentTool('line')}
            title="直线"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="4" y1="20" x2="20" y2="4" />
            </svg>
          </button>
          <button
            className={`p-1.5 rounded-lg transition-colors ${currentTool === 'badge' ? 'bg-sky-600 text-white shadow-sm' : 'hover:bg-slate-800 text-slate-300'}`}
            onClick={() => setCurrentTool('badge')}
            title="递增序号标号 ①②③"
          >
            <span className="font-bold text-xs">①</span>
          </button>
          <button
            className={`p-1.5 rounded-lg transition-colors ${currentTool === 'text' ? 'bg-sky-600 text-white shadow-sm' : 'hover:bg-slate-800 text-slate-300'}`}
            onClick={() => setCurrentTool('text')}
            title="文字文本 (点击贴图输入)"
          >
            <span className="font-bold text-xs">T</span>
          </button>
          <button
            className={`p-1.5 rounded-lg transition-colors ${currentTool === 'mosaic' ? 'bg-sky-600 text-white shadow-sm' : 'hover:bg-slate-800 text-slate-300'}`}
            onClick={() => setCurrentTool('mosaic')}
            title="马赛克打码"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="7" height="7" fill="currentColor" />
              <rect x="14" y="3" width="7" height="7" />
              <rect x="3" y="14" width="7" height="7" />
              <rect x="14" y="14" width="7" height="7" fill="currentColor" />
            </svg>
          </button>

          <div className="w-[1px] h-4 bg-slate-700 mx-0.5" />

          {/* 常用调色盘 */}
          {['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#ffffff'].map((c) => (
            <button
              key={c}
              className={`w-3.5 h-3.5 rounded-full border transition-transform ${color === c ? 'scale-125 border-white ring-2 ring-sky-400' : 'border-slate-500 hover:scale-110'}`}
              style={{ backgroundColor: c }}
              onClick={() => setColor(c)}
            />
          ))}

          <div className="w-[1px] h-4 bg-slate-700 mx-0.5" />

          {/* 线条粗细切换 */}
          {[2, 4, 7].map((w) => (
            <button
              key={w}
              className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${lineWidth === w ? 'bg-sky-600 text-white shadow-sm' : 'text-slate-400 hover:bg-slate-800'}`}
              onClick={() => setLineWidth(w)}
            >
              {w === 2 ? '细' : w === 4 ? '中' : '粗'}
            </button>
          ))}

          <div className="w-[1px] h-4 bg-slate-700 mx-0.5" />

          {/* 撤销 / 清空 / 完成 */}
          <button
            className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-300"
            onClick={handleUndo}
            title="撤销 (Ctrl+Z)"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 14 4 9l5-5" />
              <path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5 5.5 5.5 0 0 1-5.5 5.5H11" />
            </svg>
          </button>

          <button
            className="p-1.5 rounded-lg hover:bg-rose-500/20 text-rose-300"
            onClick={handleClear}
            title="清空所有标注"
          >
            🗑️
          </button>

          <button
            className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 rounded-lg text-white font-medium text-xs ml-0.5 shadow-sm"
            onClick={() => setIsAnnotating(false)}
            title="完成标注 (Space)"
          >
            ✓ 完成
          </button>
        </div>
      )}

      {/* 内联文字输入框 */}
      {textInput && (
        <div
          className="fixed z-50 flex items-center gap-1.5 p-1 bg-slate-900/95 border border-sky-400 rounded-xl shadow-2xl backdrop-blur-md"
          style={{
            left: Math.max(8, Math.min(textInput.screenX, window.innerWidth - 220)),
            top: Math.max(8, Math.min(textInput.screenY, window.innerHeight - 50))
          }}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <input
            autoFocus
            type="text"
            placeholder="输入标注文字，按 Enter 确定..."
            value={textInputValue}
            onChange={(e) => setTextInputValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCommitText()
              if (e.key === 'Escape') setTextInput(null)
            }}
            className="px-2.5 py-1 bg-slate-950 border border-slate-700 rounded-lg text-xs text-white focus:outline-none focus:border-sky-400 w-48"
          />
          <button
            className="px-2.5 py-1 bg-sky-600 hover:bg-sky-500 rounded-lg text-xs text-white font-medium"
            onClick={handleCommitText}
          >
            确定
          </button>
        </div>
      )}

      {/* 悬浮快捷控制胶囊 (正常悬停显示，穿透模式下常驻低透方便寻位与点击) */}
      <div
        className={`action-bar absolute bottom-2 right-2 z-30 transition-all duration-200 flex items-center gap-1 px-2 py-1 bg-slate-900/90 border border-slate-700/80 rounded-full shadow-2xl backdrop-blur-md text-xs text-white ${
          isClickThrough
            ? 'opacity-90 hover:opacity-100 ring-1 ring-amber-500/50 shadow-amber-500/10'
            : 'opacity-0 group-hover:opacity-100'
        }`}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <button
          className="px-1.5 py-0.5 hover:bg-slate-800 rounded text-[11px] font-mono text-sky-400"
          onClick={() => setScale(1)}
          title="点击恢复 100% 原始大小"
        >
          {Math.round(scale * 100)}%
        </button>
        <button
          className={`p-1 rounded transition-colors ${
            isAnnotating
              ? 'bg-sky-500/30 text-sky-300 border border-sky-400/50 hover:bg-sky-500/40 shadow-sm'
              : 'hover:bg-slate-800 text-slate-300'
          }`}
          onClick={handleToggleAnnotating}
          title={isAnnotating ? '退出标注模式 (Space)' : '涂鸦标注 (Space)'}
        >
          ✏️
        </button>
        {isClickThrough && (
          <span className="text-[10px] text-amber-300 font-medium px-0.5 animate-pulse select-none">
            穿透中
          </span>
        )}
        <button
          className={`p-1 rounded transition-colors ${
            isClickThrough
              ? 'bg-amber-500/30 text-amber-300 border border-amber-400/50 hover:bg-amber-500/40 shadow-sm'
              : 'hover:bg-slate-800 text-slate-300'
          }`}
          onClick={handleToggleClickThrough}
          title={isClickThrough ? '取消鼠标穿透 (或按 Ctrl+Shift+T)' : '开启鼠标穿透 (Ctrl+T)'}
        >
          👻
        </button>
        <button
          className="p-1 rounded hover:bg-slate-800 text-slate-300"
          onClick={handleCopyImage}
          title="复制图片 (Ctrl+C)"
        >
          📋
        </button>
        <button
          className="p-1 rounded hover:bg-slate-800 text-slate-300"
          onClick={handleSaveAs}
          title="另存为 (Ctrl+S)"
        >
          💾
        </button>
        <button
          className="p-1 rounded hover:bg-red-500/80 text-slate-300 hover:text-white"
          onClick={handleClose}
          title="关闭贴图 (Esc)"
        >
          ✕
        </button>
      </div>

      {/* 右键上下文菜单 */}
      {contextMenuPos && (
        <div
          className="context-menu fixed z-50 w-44 py-1.5 bg-slate-900/95 border border-slate-700/90 rounded-xl shadow-2xl backdrop-blur-md text-xs text-slate-200 animate-in fade-in zoom-in-95 duration-100"
          style={{
            left: Math.min(contextMenuPos.x, window.innerWidth - 180),
            top: Math.min(contextMenuPos.y, window.innerHeight - 240)
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            className="px-3 py-1.5 hover:bg-sky-600 hover:text-white cursor-pointer flex items-center justify-between"
            onClick={() => {
              handleCopyImage()
              setContextMenuPos(null)
            }}
          >
            <span>复制图片</span>
            <span className="text-[10px] text-slate-400">Ctrl+C</span>
          </div>
          <div
            className="px-3 py-1.5 hover:bg-sky-600 hover:text-white cursor-pointer flex items-center justify-between"
            onClick={() => {
              handleSaveAs()
              setContextMenuPos(null)
            }}
          >
            <span>另存为图片...</span>
            <span className="text-[10px] text-slate-400">Ctrl+S</span>
          </div>
          <div
            className="px-3 py-1.5 hover:bg-sky-600 hover:text-white cursor-pointer flex items-center justify-between"
            onClick={() => {
              setScale(1)
              setContextMenuPos(null)
            }}
          >
            <span>复原缩放 (100%)</span>
            <span className="text-[10px] text-slate-400">双击</span>
          </div>
          <div
            className="px-3 py-1.5 hover:bg-sky-600 hover:text-white cursor-pointer flex items-center justify-between"
            onClick={() => {
              handleToggleAnnotating()
              setContextMenuPos(null)
            }}
          >
            <span>{isAnnotating ? '退出涂鸦标注' : '就地涂鸦标注'}</span>
            <span className="text-[10px] text-slate-400">Space</span>
          </div>
          <div
            className="px-3 py-1.5 hover:bg-sky-600 hover:text-white cursor-pointer flex items-center justify-between"
            onClick={() => {
              handleToggleClickThrough()
              setContextMenuPos(null)
            }}
          >
            <span>{isClickThrough ? '取消鼠标穿透' : '开启鼠标穿透'}</span>
            <span className="text-[10px] text-slate-400">Ctrl+T</span>
          </div>
          <div className="h-[1px] bg-slate-800 my-1" />
          <div className="px-3 py-1 text-[10px] text-slate-400 font-semibold">快速透明度</div>
          <div className="px-3 py-1 flex items-center gap-1.5">
            {[1.0, 0.8, 0.5, 0.2].map((op) => (
              <button
                key={op}
                className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-sky-600 hover:text-white text-[10px]"
                onClick={() => {
                  setOpacity(op)
                  window.doujiaoSDK?.pin?.setPinOpacity?.(pinId, op)
                  setContextMenuPos(null)
                }}
              >
                {Math.round(op * 100)}%
              </button>
            ))}
          </div>
          <div className="h-[1px] bg-slate-800 my-1" />
          <div
            className="px-3 py-1.5 hover:bg-red-600 hover:text-white cursor-pointer flex items-center justify-between text-red-400"
            onClick={() => {
              handleClose()
              setContextMenuPos(null)
            }}
          >
            <span>关闭此贴图</span>
            <span className="text-[10px]">Esc</span>
          </div>
        </div>
      )}

      {/* 提示消息 Toast */}
      {toastMsg && (
        <div className="fixed bottom-4 left-1/2 transform -translate-x-1/2 z-50 px-3 py-1 bg-slate-900/90 border border-slate-700/80 rounded-full text-xs text-white shadow-xl backdrop-blur-md animate-in fade-in duration-150 pointer-events-none">
          {toastMsg}
        </div>
      )}
    </div>
  )
}
