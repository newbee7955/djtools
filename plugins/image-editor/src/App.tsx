import React, { useState, useRef, useEffect, useCallback } from 'react';
import { getSDK } from '@doujiao/plugin-sdk';
import type {
  AnnotationElement,
  AspectRatio,
  CropBox,
  EditorSettings,
  Point,
  ToolType
} from './types/editor';
import { renderAllElements } from './lib/canvas-renderer';
import { Toolbar } from './components/Toolbar';
import { CropOverlay } from './components/CropOverlay';
import { WorkspaceDrawer } from './components/WorkspaceDrawer';

export const App: React.FC = () => {
  // 1. SDK 实例注入
  const sdk = (() => {
    try {
      return getSDK();
    } catch {
      return (window as any).doujiaoSDK || null;
    }
  })();

  // 2. 图像基底与标注数据状态
  const [baseCanvas, setBaseCanvas] = useState<HTMLCanvasElement | null>(null);
  const [elements, setElements] = useState<AnnotationElement[]>([]);
  const [undoStack, setUndoStack] = useState<AnnotationElement[][]>([]);
  const [redoStack, setRedoStack] = useState<AnnotationElement[][]>([]);
  const [activeElement, setActiveElement] = useState<AnnotationElement | null>(null);

  // 3. 工具与属性配置
  const [currentTool, setCurrentTool] = useState<ToolType>('arrow');
  const [settings, setSettings] = useState<EditorSettings>({
    strokeColor: '#ef4444',
    strokeWidth: 4,
    fontSize: 24,
    fill: false,
    mosaicSize: 14,
    currentStep: 1
  });

  // 4. 视口平移与缩放 (Pan & Zoom)
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef<{ mouseX: number; mouseY: number; origX: number; origY: number }>({
    mouseX: 0,
    mouseY: 0,
    origX: 0,
    origY: 0
  });

  // 5. 裁剪状态
  const [cropBox, setCropBox] = useState<CropBox>({ x: 0, y: 0, width: 100, height: 100 });
  const [cropAspect, setCropAspect] = useState<AspectRatio>('free');

  // 6. UI 与抽屉状态
  const [isWorkspaceDrawerOpen, setIsWorkspaceDrawerOpen] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'info' | 'error' } | null>(null);
  const [textInputPrompt, setTextInputPrompt] = useState<{ isOpen: boolean; x: number; y: number; text: string } | null>(null);

  // DOM 引用
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const drawStartPosRef = useRef<Point | null>(null);
  const isDrawingRef = useRef(false);
  const isSpacePressedRef = useRef(false);

  const showToast = (message: string, type: 'success' | 'info' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  // -------------------------------------------------------------
  // 画布尺寸自适应与缩放计算
  // -------------------------------------------------------------
  const fitToScreen = useCallback((imgW?: number, imgH?: number) => {
    if (!viewportRef.current) return;
    const w = imgW || baseCanvas?.width;
    const h = imgH || baseCanvas?.height;
    if (!w || !h) return;

    const vpW = viewportRef.current.clientWidth - 80;
    const vpH = viewportRef.current.clientHeight - 80;
    if (vpW <= 0 || vpH <= 0) return;

    const scaleFit = Math.min(1, Math.min(vpW / w, vpH / h));
    setScale(scaleFit);
    setOffset({ x: 0, y: 0 });
  }, [baseCanvas]);

  // -------------------------------------------------------------
  // 图片加载核心引擎
  // -------------------------------------------------------------
  const loadImageSource = useCallback((src: string, isFromPaste = false) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const offCanvas = document.createElement('canvas');
      offCanvas.width = img.naturalWidth;
      offCanvas.height = img.naturalHeight;
      const offCtx = offCanvas.getContext('2d');
      if (!offCtx) return;

      offCtx.drawImage(img, 0, 0);
      setBaseCanvas(offCanvas);
      setElements([]);
      setUndoStack([]);
      setRedoStack([]);
      setCropBox({
        x: 0,
        y: 0,
        width: img.naturalWidth,
        height: img.naturalHeight
      });

      fitToScreen(img.naturalWidth, img.naturalHeight);
      if (isFromPaste) {
        showToast('已从剪贴板载入图片', 'success');
      }
    };
    img.onerror = () => {
      showToast('图片加载失败，请检查文件格式', 'error');
    };
    img.src = src;
  }, [fitToScreen]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      if (ev.target?.result) {
        loadImageSource(ev.target.result as string);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  // 创建空白预设画布
  const handleCreateBlankCanvas = (width = 1920, height = 1080) => {
    const offCanvas = document.createElement('canvas');
    offCanvas.width = width;
    offCanvas.height = height;
    const offCtx = offCanvas.getContext('2d');
    if (!offCtx) return;

    offCtx.fillStyle = '#ffffff';
    offCtx.fillRect(0, 0, width, height);
    setBaseCanvas(offCanvas);
    setElements([]);
    setUndoStack([]);
    setRedoStack([]);
    setCropBox({ x: 0, y: 0, width, height });
    fitToScreen(width, height);
    showToast(`已创建空白画布 (${width} × ${height})`);
  };

  // -------------------------------------------------------------
  // 渲染管道：只要 baseCanvas、elements 或 activeElement 发生变化即刷新
  // -------------------------------------------------------------
  useEffect(() => {
    if (!canvasRef.current || !baseCanvas) return;
    const canvas = canvasRef.current;
    if (canvas.width !== baseCanvas.width || canvas.height !== baseCanvas.height) {
      canvas.width = baseCanvas.width;
      canvas.height = baseCanvas.height;
    }
    renderAllElements(canvas, baseCanvas, elements, activeElement);
  }, [baseCanvas, elements, activeElement]);

  // -------------------------------------------------------------
  // 撤销 / 重做
  // -------------------------------------------------------------
  const handleUndo = useCallback(() => {
    if (elements.length === 0) return;
    const previous = elements.slice(0, -1);
    setRedoStack((prev) => [elements, ...prev]);
    setElements(previous);
  }, [elements]);

  const handleRedo = useCallback(() => {
    if (redoStack.length === 0) return;
    const next = redoStack[0];
    setRedoStack((prev) => prev.slice(1));
    setElements(next);
  }, [redoStack]);

  const handleClearAll = () => {
    if (elements.length === 0) return;
    setUndoStack((prev) => [...prev, elements]);
    setElements([]);
    setRedoStack([]);
    showToast('已清空全部标注', 'info');
  };

  const handleClearWorkspace = () => {
    if (!baseCanvas && elements.length === 0) return;
    if (window.confirm('确定要清空当前工作区画布吗？未保存的修改与标注将会丢失。')) {
      setBaseCanvas(null);
      setElements([]);
      setUndoStack([]);
      setRedoStack([]);
      setActiveElement(null);
      showToast('工作区画布已清空重置', 'info');
    }
  };

  // -------------------------------------------------------------
  // 坐标转换 (从屏幕视口像素换算到 Canvas 原始图像 1:1 坐标)
  // -------------------------------------------------------------
  const getCanvasPoint = (e: React.MouseEvent): Point => {
    if (!canvasRef.current) return { x: 0, y: 0 };
    const rect = canvasRef.current.getBoundingClientRect();
    const x = Math.round((e.clientX - rect.left) * (canvasRef.current.width / rect.width));
    const y = Math.round((e.clientY - rect.top) * (canvasRef.current.height / rect.height));
    return {
      x: Math.max(0, Math.min(canvasRef.current.width, x)),
      y: Math.max(0, Math.min(canvasRef.current.height, y))
    };
  };

  // -------------------------------------------------------------
  // 鼠标交互绘制
  // -------------------------------------------------------------
  const handleMouseDown = (e: React.MouseEvent) => {
    if (!baseCanvas) return;

    // 按住空格键或使用选择工具 -> 开启抓手平移
    if (e.button === 1 || isSpacePressedRef.current || currentTool === 'select') {
      setIsPanning(true);
      panStartRef.current = {
        mouseX: e.clientX,
        mouseY: e.clientY,
        origX: offset.x,
        origY: offset.y
      };
      return;
    }

    if (currentTool === 'crop') return;

    const pt = getCanvasPoint(e);
    drawStartPosRef.current = pt;
    isDrawingRef.current = true;

    // 单击型工具：步骤序号气泡
    if (currentTool === 'step') {
      const newStep: AnnotationElement = {
        id: `el_${Date.now()}`,
        type: 'step',
        x: pt.x,
        y: pt.y,
        stepNumber: settings.currentStep,
        color: settings.strokeColor,
        size: 18
      };
      setUndoStack((prev) => [...prev, elements]);
      setElements((prev) => [...prev, newStep]);
      setRedoStack([]);
      setSettings((prev) => ({ ...prev, currentStep: prev.currentStep + 1 }));
      isDrawingRef.current = false;
      return;
    }

    // 单击型工具：文字标注
    if (currentTool === 'text') {
      setTextInputPrompt({ isOpen: true, x: pt.x, y: pt.y, text: '' });
      isDrawingRef.current = false;
      return;
    }

    // 拖拽型工具初始化
    if (currentTool === 'arrow') {
      setActiveElement({
        id: `active_${Date.now()}`,
        type: 'arrow',
        startX: pt.x,
        startY: pt.y,
        endX: pt.x,
        endY: pt.y,
        strokeColor: settings.strokeColor,
        strokeWidth: settings.strokeWidth
      });
    } else if (currentTool === 'rect') {
      setActiveElement({
        id: `active_${Date.now()}`,
        type: 'rect',
        x: pt.x,
        y: pt.y,
        width: 0,
        height: 0,
        strokeColor: settings.strokeColor,
        strokeWidth: settings.strokeWidth,
        fill: settings.fill,
        radius: 6
      });
    } else if (currentTool === 'circle') {
      setActiveElement({
        id: `active_${Date.now()}`,
        type: 'circle',
        x: pt.x,
        y: pt.y,
        radiusX: 0,
        radiusY: 0,
        strokeColor: settings.strokeColor,
        strokeWidth: settings.strokeWidth,
        fill: settings.fill
      });
    } else if (currentTool === 'line') {
      setActiveElement({
        id: `active_${Date.now()}`,
        type: 'line',
        startX: pt.x,
        startY: pt.y,
        endX: pt.x,
        endY: pt.y,
        strokeColor: settings.strokeColor,
        strokeWidth: settings.strokeWidth
      });
    } else if (currentTool === 'pen') {
      setActiveElement({
        id: `active_${Date.now()}`,
        type: 'pen',
        points: [pt],
        strokeColor: settings.strokeColor,
        strokeWidth: settings.strokeWidth
      });
    } else if (currentTool === 'highlighter') {
      setActiveElement({
        id: `active_${Date.now()}`,
        type: 'highlighter',
        points: [pt],
        strokeColor: settings.strokeColor,
        strokeWidth: settings.strokeWidth
      });
    } else if (currentTool === 'mosaic') {
      setActiveElement({
        id: `active_${Date.now()}`,
        type: 'mosaic',
        x: pt.x,
        y: pt.y,
        width: 0,
        height: 0,
        blockSize: settings.mosaicSize
      });
    } else if (currentTool === 'mosaic-brush') {
      setActiveElement({
        id: `active_${Date.now()}`,
        type: 'mosaic-brush',
        points: [pt],
        brushSize: settings.mosaicSize * 2.5,
        blockSize: settings.mosaicSize
      });
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    // 视口平移拖拽
    if (isPanning) {
      const dx = e.clientX - panStartRef.current.mouseX;
      const dy = e.clientY - panStartRef.current.mouseY;
      setOffset({
        x: panStartRef.current.origX + dx,
        y: panStartRef.current.origY + dy
      });
      return;
    }

    if (!isDrawingRef.current || !activeElement || !drawStartPosRef.current) return;
    const pt = getCanvasPoint(e);
    const start = drawStartPosRef.current;

    if (activeElement.type === 'arrow' || activeElement.type === 'line') {
      setActiveElement({ ...activeElement, endX: pt.x, endY: pt.y });
    } else if (activeElement.type === 'rect' || activeElement.type === 'mosaic') {
      setActiveElement({
        ...activeElement,
        x: Math.min(start.x, pt.x),
        y: Math.min(start.y, pt.y),
        width: Math.abs(pt.x - start.x),
        height: Math.abs(pt.y - start.y)
      });
    } else if (activeElement.type === 'circle') {
      const rx = Math.abs(pt.x - start.x);
      const ry = Math.abs(pt.y - start.y);
      setActiveElement({
        ...activeElement,
        radiusX: rx,
        radiusY: ry
      });
    } else if (activeElement.type === 'pen' || activeElement.type === 'highlighter' || activeElement.type === 'mosaic-brush') {
      setActiveElement({
        ...activeElement,
        points: [...activeElement.points, pt]
      });
    }
  };

  const handleMouseUp = () => {
    if (isPanning) {
      setIsPanning(false);
      return;
    }

    if (isDrawingRef.current && activeElement) {
      setUndoStack((prev) => [...prev, elements]);
      setElements((prev) => [...prev, { ...activeElement, id: `el_${Date.now()}` }]);
      setRedoStack([]);
      setActiveElement(null);
    }
    isDrawingRef.current = false;
    drawStartPosRef.current = null;
  };

  // 提交文字标签
  const handleCommitText = (text: string) => {
    if (!textInputPrompt || !text.trim()) {
      setTextInputPrompt(null);
      return;
    }
    const newTextEl: AnnotationElement = {
      id: `el_${Date.now()}`,
      type: 'text',
      x: textInputPrompt.x,
      y: textInputPrompt.y,
      text: text.trim(),
      color: settings.strokeColor,
      fontSize: settings.fontSize,
      bgColor: 'rgba(15, 23, 42, 0.85)'
    };
    setUndoStack((prev) => [...prev, elements]);
    setElements((prev) => [...prev, newTextEl]);
    setRedoStack([]);
    setTextInputPrompt(null);
  };

  // -------------------------------------------------------------
  // 裁剪与翻转变换引擎
  // -------------------------------------------------------------
  const handleApplyCrop = () => {
    if (!canvasRef.current || !baseCanvas) return;
    const { x, y, width, height } = cropBox;
    if (width <= 10 || height <= 10) return;

    // 1. 先将基底与现有标注无损合并导出为临时图
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = width;
    tempCanvas.height = height;
    const tempCtx = tempCanvas.getContext('2d');
    if (!tempCtx) return;

    // 从当前全量渲染画布中切片出裁剪区域
    tempCtx.drawImage(canvasRef.current, x, y, width, height, 0, 0, width, height);

    // 2. 将切片作为全新基底图像，重置标注与视口
    setBaseCanvas(tempCanvas);
    setElements([]);
    setUndoStack([]);
    setRedoStack([]);
    setCurrentTool('arrow');
    setCropBox({ x: 0, y: 0, width, height });
    fitToScreen(width, height);
    showToast('裁剪完成', 'success');
  };

  const handleCancelCrop = () => {
    setCurrentTool('arrow');
  };

  const handleRotateCW = () => {
    if (!canvasRef.current || !baseCanvas) return;
    const origW = canvasRef.current.width;
    const origH = canvasRef.current.height;

    const rotCanvas = document.createElement('canvas');
    rotCanvas.width = origH;
    rotCanvas.height = origW;
    const rotCtx = rotCanvas.getContext('2d');
    if (!rotCtx) return;

    rotCtx.translate(origH, 0);
    rotCtx.rotate((90 * Math.PI) / 180);
    rotCtx.drawImage(canvasRef.current, 0, 0);

    setBaseCanvas(rotCanvas);
    setElements([]);
    setUndoStack([]);
    setRedoStack([]);
    setCropBox({ x: 0, y: 0, width: origH, height: origW });
    fitToScreen(origH, origW);
    showToast('顺时针旋转 90°');
  };

  const handleFlipH = () => {
    if (!canvasRef.current || !baseCanvas) return;
    const origW = canvasRef.current.width;
    const origH = canvasRef.current.height;

    const flipCanvas = document.createElement('canvas');
    flipCanvas.width = origW;
    flipCanvas.height = origH;
    const flipCtx = flipCanvas.getContext('2d');
    if (!flipCtx) return;

    flipCtx.translate(origW, 0);
    flipCtx.scale(-1, 1);
    flipCtx.drawImage(canvasRef.current, 0, 0);

    setBaseCanvas(flipCanvas);
    setElements([]);
    setUndoStack([]);
    setRedoStack([]);
    showToast('已水平翻转');
  };

  // -------------------------------------------------------------
  // 导出与分享引擎 (剪贴板 / 工作区 / 另存为)
  // -------------------------------------------------------------
  const getMergedDataUrl = (format = 'image/png'): string => {
    if (!canvasRef.current) return '';
    return canvasRef.current.toDataURL(format, 0.95);
  };

  const handleCopyClipboard = async () => {
    const dataUrl = getMergedDataUrl('image/png');
    if (!dataUrl) return;

    let success = false;
    // 优先尝试宿主 SDK 门面
    if (sdk?.clipboard?.writeImage) {
      try {
        success = await sdk.clipboard.writeImage(dataUrl);
      } catch (e) {
        console.warn('SDK writeImage error:', e);
      }
    }

    // 降级为 Web Clipboard API
    if (!success && typeof navigator !== 'undefined' && navigator.clipboard && (window as any).ClipboardItem) {
      try {
        const res = await fetch(dataUrl);
        const blob = await res.blob();
        await navigator.clipboard.write([
          new (window as any).ClipboardItem({ [blob.type]: blob })
        ]);
        success = true;
      } catch (err) {
        console.warn('Navigator clipboard error:', err);
      }
    }

    if (success) {
      showToast('🎉 已复制到剪贴板，可直接粘贴到微信/文档中！', 'success');
    } else {
      showToast('复制到剪贴板失败，请重试', 'error');
    }
  };

  const handleSaveWorkspace = async () => {
    const dataUrl = getMergedDataUrl('image/png');
    if (!dataUrl) return;

    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    const fileName = `IMG_${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(
      now.getHours()
    )}${pad(now.getMinutes())}${pad(now.getSeconds())}.png`;

    if (sdk?.workspace?.writeFile) {
      try {
        const res = await sdk.workspace.writeFile(fileName, dataUrl, 'image-editor');
        if (res?.success) {
          showToast(`已保存至工作目录: ${fileName}`, 'success');
          return;
        }
      } catch (err: any) {
        showToast(`保存失败: ${err?.message}`, 'error');
        return;
      }
    }

    // 浏览器环境降级下载
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = fileName;
    a.click();
    showToast(`已下载: ${fileName}`);
  };

  const handleSaveAs = async () => {
    const dataUrl = getMergedDataUrl('image/png');
    if (!dataUrl) return;

    if (sdk?.workspace?.saveFileAs) {
      try {
        const res = await sdk.workspace.saveFileAs(dataUrl, '截图标注.png', ['png', 'jpg', 'webp']);
        if (!res?.canceled && res?.fileName) {
          showToast(`另存为成功: ${res.fileName}`, 'success');
        }
        return;
      } catch (err: any) {
        showToast(`另存为失败: ${err?.message}`, 'error');
        return;
      }
    }

    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = '截图标注.png';
    a.click();
  };

  // -------------------------------------------------------------
  // 屏幕截图引擎 (支持划选截图与全屏直截，快捷键 Alt+Shift+A)
  // -------------------------------------------------------------
  const handleTriggerScreenshot = useCallback(
    async (mode: 'snip' | 'fullscreen' = 'snip') => {
      if (sdk?.screen?.capture) {
        try {
          const res = await sdk.screen.capture({ mode, hideWindow: true });
          if (res?.success && res?.dataUrl) {
            loadImageSource(res.dataUrl);
            showToast('📸 屏幕截图已载入画布，并已同步复制到剪贴板！', 'success');
          } else if (res?.error) {
            showToast(`截图失败: ${res.error}`, 'error');
          }
        } catch (err: any) {
          showToast(`截图异常: ${err?.message || '未知错误'}`, 'error');
        }
      } else {
        showToast('当前环境未启用屏幕截图能力，请确保在豆角宿主桌面端中运行', 'info');
      }
    },
    [sdk, loadImageSource]
  );

  // 监听宿主全局快捷键广播的截图事件
  useEffect(() => {
    if (sdk?.screen?.onCaptured) {
      const cleanup = sdk.screen.onCaptured((res: any) => {
        if (res?.success && res?.dataUrl) {
          loadImageSource(res.dataUrl);
          showToast('📸 屏幕截图已自动载入画布！', 'success');
        }
      });
      return () => cleanup?.();
    }
  }, [sdk, loadImageSource]);

  // -------------------------------------------------------------
  // 全局快捷键与剪贴板监听 (Ctrl+V, Ctrl+C, Ctrl+Z 等)
  // -------------------------------------------------------------
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            const reader = new FileReader();
            reader.onload = (ev) => {
              if (ev.target?.result) {
                loadImageSource(ev.target.result as string, true);
              }
            };
            reader.readAsDataURL(file);
            e.preventDefault();
            return;
          }
        }
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      // 文本输入框中不拦截通用快捷键
      if ((e.target as HTMLElement).tagName === 'INPUT') return;

      const isCtrlOrMeta = e.ctrlKey || e.metaKey;

      if (isCtrlOrMeta && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
        return;
      }

      if (isCtrlOrMeta && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        handleRedo();
        return;
      }

      if (isCtrlOrMeta && e.key.toLowerCase() === 'c' && baseCanvas) {
        e.preventDefault();
        handleCopyClipboard();
        return;
      }

      if (isCtrlOrMeta && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (e.shiftKey) {
          handleSaveAs();
        } else {
          handleSaveWorkspace();
        }
        return;
      }

      // 截图快捷键: Alt+Shift+A 或 Ctrl+Shift+A 或 Alt+A
      if ((e.altKey || (isCtrlOrMeta && e.shiftKey)) && (e.key.toLowerCase() === 'a' || e.code === 'KeyA')) {
        e.preventDefault();
        handleTriggerScreenshot('snip');
        return;
      }

      // 空格键平移抓手支持
      if (e.code === 'Space') {
        isSpacePressedRef.current = true;
      }

      // 工具单键切换
      if (!isCtrlOrMeta && !e.altKey) {
        const key = e.key.toLowerCase();
        if (key === 'v') setCurrentTool('select');
        else if (key === 'c') setCurrentTool('crop');
        else if (key === 'a') setCurrentTool('arrow');
        else if (key === 'r') setCurrentTool('rect');
        else if (key === 'o') setCurrentTool('circle');
        else if (key === 'l') setCurrentTool('line');
        else if (key === 'p') setCurrentTool('pen');
        else if (key === 'h') setCurrentTool('highlighter');
        else if (key === 's') setCurrentTool('step');
        else if (key === 't') setCurrentTool('text');
        else if (key === 'm') setCurrentTool('mosaic');
        else if (key === 'escape') {
          if (currentTool === 'crop') handleCancelCrop();
          setActiveElement(null);
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        isSpacePressedRef.current = false;
      }
    };

    window.addEventListener('paste', handlePaste);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('paste', handlePaste);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [baseCanvas, handleUndo, handleRedo, loadImageSource, currentTool, handleTriggerScreenshot]);

  // -------------------------------------------------------------
  // 鼠标滚轮缩放控制
  // -------------------------------------------------------------
  const handleWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      setScale((prev) => Math.max(0.1, Math.min(5, prev + delta)));
    }
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-slate-950 text-slate-100 overflow-hidden select-none">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileChange}
        className="hidden"
      />

      {/* 顶部工具与控制导航 */}
      <Toolbar
        currentTool={currentTool}
        onSelectTool={setCurrentTool}
        settings={settings}
        onUpdateSettings={(newS) => setSettings((prev) => ({ ...prev, ...newS }))}
        canUndo={elements.length > 0}
        canRedo={redoStack.length > 0}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onClear={handleClearAll}
        scale={scale}
        onZoomIn={() => setScale((prev) => Math.min(5, prev + 0.15))}
        onZoomOut={() => setScale((prev) => Math.max(0.15, prev - 0.15))}
        onResetZoom={() => {
          setScale(1);
          setOffset({ x: 0, y: 0 });
        }}
        onFitZoom={() => fitToScreen()}
        onRotateCW={handleRotateCW}
        onFlipH={handleFlipH}
        onCopyClipboard={handleCopyClipboard}
        onSaveWorkspace={handleSaveWorkspace}
        onSaveAs={handleSaveAs}
        onOpenFile={() => fileInputRef.current?.click()}
        onOpenWorkspaceDrawer={() => setIsWorkspaceDrawerOpen(true)}
        imageDimensions={baseCanvas ? { width: baseCanvas.width, height: baseCanvas.height } : undefined}
        cropAspect={cropAspect}
        onChangeCropAspect={setCropAspect}
        onApplyCrop={handleApplyCrop}
        onCancelCrop={handleCancelCrop}
        onClearWorkspace={handleClearWorkspace}
        onScreenshot={handleTriggerScreenshot}
      />

      {/* 主工作视口 */}
      <div
        ref={viewportRef}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const file = e.dataTransfer.files?.[0];
          if (file && file.type.startsWith('image/')) {
            const reader = new FileReader();
            reader.onload = (ev) => {
              if (ev.target?.result) loadImageSource(ev.target.result as string);
            };
            reader.readAsDataURL(file);
          }
        }}
        className={`flex-1 relative overflow-hidden flex items-center justify-center canvas-checkerboard ${
          isPanning || currentTool === 'select' ? 'cursor-grab active:cursor-grabbing' : 'cursor-crosshair'
        }`}
      >
        {/* 空画布引导界面 */}
        {!baseCanvas && (
          <div className="flex flex-col items-center justify-center p-8 text-center max-w-md bg-slate-900/90 border border-slate-800 rounded-2xl shadow-2xl backdrop-blur">
            <div className="w-16 h-16 rounded-2xl bg-sky-950/60 border border-sky-500/30 flex items-center justify-center text-3xl mb-4 text-sky-400">
              🖼️
            </div>
            <h2 className="text-lg font-bold text-slate-100 mb-2">轻量图片编辑与标注</h2>
            <p className="text-xs text-slate-400 mb-6 leading-relaxed">
              按下 <kbd className="px-1.5 py-0.5 bg-slate-800 border border-slate-700 rounded text-sky-300 font-mono">Alt + Shift + A</kbd> 或点击下方按钮快速屏幕截图，也可拖拽图片到此处
            </p>

            <div className="flex flex-col space-y-2.5 w-full">
              <button
                onClick={() => handleTriggerScreenshot('snip')}
                className="w-full py-2.5 bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 text-white text-xs font-semibold rounded-lg transition shadow-lg shadow-sky-950/50 flex items-center justify-center space-x-2 border border-sky-400/30 active:scale-[0.99]"
              >
                <span>📸 立即屏幕截图</span>
                <span className="text-[10px] bg-white/20 px-1.5 py-0.5 rounded text-sky-100 font-mono">Alt + Shift + A</span>
              </button>

              <div className="flex items-center space-x-3 w-full">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="flex-1 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-lg transition border border-slate-700 flex items-center justify-center space-x-1"
                >
                  <span>📂 选择本地图片</span>
                </button>
                <button
                  onClick={() => handleCreateBlankCanvas(1920, 1080)}
                  className="flex-1 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-lg transition border border-slate-700"
                >
                  <span>📄 新建 1080P 画布</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 核心 Canvas 渲染视窗 */}
        {baseCanvas && (
          <div
            className="relative shadow-2xl transition-transform duration-75 origin-center"
            style={{
              transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
              width: baseCanvas.width,
              height: baseCanvas.height
            }}
          >
            <canvas
              ref={canvasRef}
              className="block rounded shadow-md pointer-events-none"
              style={{ width: baseCanvas.width, height: baseCanvas.height }}
            />

            {/* 裁剪交互覆盖层 */}
            {currentTool === 'crop' && (
              <CropOverlay
                imageWidth={baseCanvas.width}
                imageHeight={baseCanvas.height}
                cropBox={cropBox}
                onChangeCropBox={setCropBox}
                aspectRatio={cropAspect}
                scale={scale}
              />
            )}
          </div>
        )}

        {/* 文字标注输入弹窗 */}
        {textInputPrompt && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
            <div className="bg-slate-900 border border-slate-700 rounded-xl p-4 w-80 shadow-2xl">
              <div className="text-xs font-semibold text-slate-200 mb-2">添加文字标注</div>
              <input
                autoFocus
                type="text"
                placeholder="输入标注文字..."
                defaultValue=""
                id="text-annotation-input"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleCommitText((e.target as HTMLInputElement).value);
                  } else if (e.key === 'Escape') {
                    setTextInputPrompt(null);
                  }
                }}
                className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-1.5 text-xs text-white focus:outline-none focus:border-sky-500 mb-3"
              />
              <div className="flex justify-end space-x-2">
                <button
                  onClick={() => setTextInputPrompt(null)}
                  className="px-2.5 py-1 text-xs text-slate-400 hover:text-white rounded"
                >
                  取消
                </button>
                <button
                  onClick={() => {
                    const input = document.getElementById('text-annotation-input') as HTMLInputElement;
                    handleCommitText(input?.value || '');
                  }}
                  className="px-3 py-1 bg-sky-600 hover:bg-sky-500 text-white text-xs rounded font-medium"
                >
                  确定
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 提示气泡 Toast */}
        {toast && (
          <div
            className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-full text-xs font-medium shadow-2xl flex items-center space-x-2 border transition animate-bounce ${
              toast.type === 'success'
                ? 'bg-emerald-950/90 text-emerald-300 border-emerald-500/50'
                : toast.type === 'error'
                ? 'bg-rose-950/90 text-rose-300 border-rose-500/50'
                : 'bg-slate-800 text-slate-200 border-slate-700'
            }`}
          >
            <span>{toast.type === 'success' ? '✓' : toast.type === 'error' ? '✕' : 'ℹ'}</span>
            <span>{toast.message}</span>
          </div>
        )}
      </div>

      {/* 工作区图库抽屉 */}
      <WorkspaceDrawer
        isOpen={isWorkspaceDrawerOpen}
        onClose={() => setIsWorkspaceDrawerOpen(false)}
        onSelectImage={(dataUrl) => loadImageSource(dataUrl)}
        sdk={sdk}
      />
    </div>
  );
};

export default App;
