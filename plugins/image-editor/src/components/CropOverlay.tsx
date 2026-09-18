import React, { useState, useRef, useEffect } from 'react';
import type { AspectRatio, CropBox } from '../types/editor';

interface CropOverlayProps {
  imageWidth: number;
  imageHeight: number;
  cropBox: CropBox;
  onChangeCropBox: (box: CropBox) => void;
  aspectRatio: AspectRatio;
  scale: number;
}

type HandleType = 'move' | 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

export const CropOverlay: React.FC<CropOverlayProps> = ({
  imageWidth,
  imageHeight,
  cropBox,
  onChangeCropBox,
  aspectRatio
}) => {
  const [activeHandle, setActiveHandle] = useState<HandleType | null>(null);
  const dragStartRef = useRef<{ mouseX: number; mouseY: number; box: CropBox }>({
    mouseX: 0,
    mouseY: 0,
    box: cropBox
  });

  const handleMouseDown = (e: React.MouseEvent, handle: HandleType) => {
    e.stopPropagation();
    e.preventDefault();
    setActiveHandle(handle);
    dragStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      box: { ...cropBox }
    };
  };

  useEffect(() => {
    if (!activeHandle) return;

    const handleMouseMove = (e: MouseEvent) => {
      const dx = e.clientX - dragStartRef.current.mouseX;
      const dy = e.clientY - dragStartRef.current.mouseY;
      const orig = dragStartRef.current.box;

      let newX = orig.x;
      let newY = orig.y;
      let newW = orig.width;
      let newH = orig.height;

      if (activeHandle === 'move') {
        newX = Math.max(0, Math.min(imageWidth - orig.width, orig.x + dx));
        newY = Math.max(0, Math.min(imageHeight - orig.height, orig.y + dy));
      } else {
        if (activeHandle.includes('e')) newW = Math.max(20, orig.width + dx);
        if (activeHandle.includes('s')) newH = Math.max(20, orig.height + dy);
        if (activeHandle.includes('w')) {
          const clampedDx = Math.min(dx, orig.width - 20);
          newX = Math.max(0, orig.x + clampedDx);
          newW = orig.width - (newX - orig.x);
        }
        if (activeHandle.includes('n')) {
          const clampedDy = Math.min(dy, orig.height - 20);
          newY = Math.max(0, orig.y + clampedDy);
          newH = orig.height - (newY - orig.y);
        }

        // 固定比例换算
        if (aspectRatio !== 'free') {
          let targetRatio = 1;
          if (aspectRatio === '1:1') targetRatio = 1;
          if (aspectRatio === '16:9') targetRatio = 16 / 9;
          if (aspectRatio === '4:3') targetRatio = 4 / 3;
          if (aspectRatio === '9:16') targetRatio = 9 / 16;

          if (activeHandle === 'e' || activeHandle === 'w') {
            newH = newW / targetRatio;
          } else {
            newW = newH * targetRatio;
          }
        }
      }

      // 边界限制
      newX = Math.max(0, Math.min(imageWidth - 20, newX));
      newY = Math.max(0, Math.min(imageHeight - 20, newY));
      newW = Math.max(20, Math.min(imageWidth - newX, newW));
      newH = Math.max(20, Math.min(imageHeight - newY, newH));

      onChangeCropBox({
        x: Math.round(newX),
        y: Math.round(newY),
        width: Math.round(newW),
        height: Math.round(newH)
      });
    };

    const handleMouseUp = () => {
      setActiveHandle(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [activeHandle, cropBox, imageWidth, imageHeight, aspectRatio, onChangeCropBox]);

  const { x, y, width, height } = cropBox;

  return (
    <div
      className="absolute inset-0 pointer-events-auto select-none"
      style={{ width: imageWidth, height: imageHeight }}
    >
      {/* 1. 四周暗色半透明遮罩 */}
      {/* 顶部遮罩 */}
      <div
        className="absolute bg-black/60 top-0 left-0 right-0 pointer-events-none"
        style={{ height: y }}
      />
      {/* 底部遮罩 */}
      <div
        className="absolute bg-black/60 left-0 right-0 bottom-0 pointer-events-none"
        style={{ top: y + height }}
      />
      {/* 左侧遮罩 */}
      <div
        className="absolute bg-black/60 left-0 pointer-events-none"
        style={{ top: y, height: height, width: x }}
      />
      {/* 右侧遮罩 */}
      <div
        className="absolute bg-black/60 right-0 pointer-events-none"
        style={{ top: y, height: height, left: x + width }}
      />

      {/* 2. 裁剪框内部交互区域 */}
      <div
        className="absolute border-2 border-sky-400 shadow-2xl cursor-move"
        style={{ left: x, top: y, width, height }}
        onMouseDown={(e) => handleMouseDown(e, 'move')}
      >
        {/* 九宫格辅助线 */}
        <div className="absolute inset-0 grid grid-cols-3 grid-rows-3 pointer-events-none opacity-40">
          <div className="border-r border-b border-sky-200 border-dashed" />
          <div className="border-r border-b border-sky-200 border-dashed" />
          <div className="border-b border-sky-200 border-dashed" />
          <div className="border-r border-b border-sky-200 border-dashed" />
          <div className="border-r border-b border-sky-200 border-dashed" />
          <div className="border-b border-sky-200 border-dashed" />
          <div className="border-r border-sky-200 border-dashed" />
          <div className="border-r border-sky-200 border-dashed" />
          <div />
        </div>

        {/* 尺寸提示气泡 */}
        <div className="absolute top-1 left-1 bg-black/75 text-white font-mono text-[10px] px-1.5 py-0.5 rounded pointer-events-none">
          {width} × {height}
        </div>

        {/* 8 个缩放控制点 */}
        <Handle cursor="nwse-resize" position="top-0 left-0 -translate-x-1/2 -translate-y-1/2" onMouseDown={(e) => handleMouseDown(e, 'nw')} />
        <Handle cursor="ns-resize" position="top-0 left-1/2 -translate-x-1/2 -translate-y-1/2" onMouseDown={(e) => handleMouseDown(e, 'n')} />
        <Handle cursor="nesw-resize" position="top-0 right-0 translate-x-1/2 -translate-y-1/2" onMouseDown={(e) => handleMouseDown(e, 'ne')} />
        <Handle cursor="ew-resize" position="top-1/2 right-0 translate-x-1/2 -translate-y-1/2" onMouseDown={(e) => handleMouseDown(e, 'e')} />
        <Handle cursor="nwse-resize" position="bottom-0 right-0 translate-x-1/2 translate-y-1/2" onMouseDown={(e) => handleMouseDown(e, 'se')} />
        <Handle cursor="ns-resize" position="bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2" onMouseDown={(e) => handleMouseDown(e, 's')} />
        <Handle cursor="nesw-resize" position="bottom-0 left-0 -translate-x-1/2 translate-y-1/2" onMouseDown={(e) => handleMouseDown(e, 'sw')} />
        <Handle cursor="ew-resize" position="top-1/2 left-0 -translate-x-1/2 -translate-y-1/2" onMouseDown={(e) => handleMouseDown(e, 'w')} />
      </div>
    </div>
  );
};

interface HandleProps {
  cursor: string;
  position: string;
  onMouseDown: (e: React.MouseEvent) => void;
}

const Handle: React.FC<HandleProps> = ({ cursor, position, onMouseDown }) => {
  return (
    <div
      onMouseDown={onMouseDown}
      className={`absolute w-3 h-3 bg-white border-2 border-sky-500 rounded-sm shadow-md ${position}`}
      style={{ cursor }}
    />
  );
};
