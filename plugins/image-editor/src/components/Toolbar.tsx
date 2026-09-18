import React, { useState } from 'react';
import type { AspectRatio, EditorSettings, ToolType } from '../types/editor';

interface ToolbarProps {
  currentTool: ToolType;
  onSelectTool: (tool: ToolType) => void;
  settings: EditorSettings;
  onUpdateSettings: (newSettings: Partial<EditorSettings>) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
  scale: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetZoom: () => void;
  onFitZoom: () => void;
  onRotateCW: () => void;
  onFlipH: () => void;
  onCopyClipboard: () => void;
  onSaveWorkspace: () => void;
  onSaveAs: () => void;
  onOpenFile: () => void;
  onOpenWorkspaceDrawer: () => void;
  onScreenshot: (mode?: 'snip' | 'fullscreen') => void;
  imageDimensions?: { width: number; height: number };
  cropAspect: AspectRatio;
  onChangeCropAspect: (aspect: AspectRatio) => void;
  onApplyCrop: () => void;
  onCancelCrop: () => void;
  onClearWorkspace: () => void;
}

const PRESET_COLORS = [
  { label: '猩红', value: '#ef4444' },
  { label: '活力橙', value: '#f97316' },
  { label: '明黄', value: '#eab308' },
  { label: '鲜绿', value: '#22c55e' },
  { label: '青蓝', value: '#06b6d4' },
  { label: '豆角蓝', value: '#3b82f6' },
  { label: '紫色', value: '#a855f7' },
  { label: '纯白', value: '#ffffff' },
  { label: '黑深', value: '#0f172a' }
];

const STROKE_WIDTHS = [
  { label: '细', value: 2 },
  { label: '中', value: 4 },
  { label: '粗', value: 8 },
  { label: '特粗', value: 14 }
];

const FONT_SIZES = [
  { label: '小', value: 16 },
  { label: '中', value: 22 },
  { label: '大', value: 32 },
  { label: '特大', value: 44 }
];

const MOSAIC_SIZES = [
  { label: '细打码', value: 8 },
  { label: '标清', value: 14 },
  { label: '深度打码', value: 24 }
];

export const Toolbar: React.FC<ToolbarProps> = ({
  currentTool,
  onSelectTool,
  settings,
  onUpdateSettings,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onClear,
  scale,
  onZoomIn,
  onZoomOut,
  onResetZoom,
  onFitZoom,
  onRotateCW,
  onFlipH,
  onCopyClipboard,
  onSaveWorkspace,
  onSaveAs,
  onOpenFile,
  onOpenWorkspaceDrawer,
  onScreenshot,
  imageDimensions,
  cropAspect,
  onChangeCropAspect,
  onApplyCrop,
  onCancelCrop,
  onClearWorkspace
}) => {
  const [showScreenshotMenu, setShowScreenshotMenu] = useState(false);

  return (
    <div className="flex flex-col bg-slate-900 border-b border-slate-800 select-none shadow-md z-30">
      {/* 1. 顶部主控制栏 */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-800/80 text-xs">
        {/* 左侧：Logo、尺寸信息、缩放控制 */}
        <div className="flex items-center space-x-3">
          <div className="flex items-center space-x-1.5 font-semibold text-sky-400">
            <span className="text-base">🖼️</span>
            <span className="hidden sm:inline">轻量图片编辑</span>
          </div>

          {imageDimensions && (
            <div className="flex items-center space-x-2 text-slate-400 bg-slate-800/60 px-2 py-1 rounded">
              <span>
                {imageDimensions.width} × {imageDimensions.height} px
              </span>
              <span className="text-slate-600">|</span>
              <span className="font-mono text-sky-300">{Math.round(scale * 100)}%</span>
            </div>
          )}

          {/* 缩放控制 */}
          <div className="flex items-center space-x-1 bg-slate-800 rounded p-0.5">
            <button
              onClick={onZoomOut}
              className="p-1 hover:bg-slate-700 rounded text-slate-300 hover:text-white"
              title="缩小 (Ctrl + 滚轮向下)"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
            <button
              onClick={onResetZoom}
              className="px-1.5 py-0.5 hover:bg-slate-700 rounded text-slate-300 hover:text-white text-[11px]"
              title="重置缩放 100%"
            >
              1:1
            </button>
            <button
              onClick={onZoomIn}
              className="p-1 hover:bg-slate-700 rounded text-slate-300 hover:text-white"
              title="放大 (Ctrl + 滚轮向上)"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
            <button
              onClick={onFitZoom}
              className="px-1.5 py-0.5 hover:bg-slate-700 rounded text-slate-300 hover:text-white text-[11px]"
              title="自适应视口"
            >
              适配
            </button>
          </div>

          {/* 旋转翻转 */}
          <div className="flex items-center space-x-1 border-l border-slate-800 pl-2">
            <button
              onClick={onRotateCW}
              className="p-1.5 hover:bg-slate-800 rounded text-slate-400 hover:text-white"
              title="顺时针旋转 90°"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.85.83 6.72 2.24L21 8" />
                <path d="M21 3v5h-5" />
              </svg>
            </button>
            <button
              onClick={onFlipH}
              className="p-1.5 hover:bg-slate-800 rounded text-slate-400 hover:text-white"
              title="水平翻转"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M8 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3" />
                <path d="M16 3h3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-3" />
                <line x1="12" y1="2" x2="12" y2="22" strokeDasharray="3 3" />
              </svg>
            </button>
          </div>
        </div>

        {/* 中间：撤销/重做/清空 */}
        <div className="flex items-center space-x-1">
          <button
            onClick={onUndo}
            disabled={!canUndo}
            className={`p-1.5 rounded flex items-center space-x-1 ${
              canUndo ? 'hover:bg-slate-800 text-slate-300 hover:text-white' : 'text-slate-600 cursor-not-allowed'
            }`}
            title="撤销 (Ctrl+Z)"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 7v6h6" />
              <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" />
            </svg>
            <span>撤销</span>
          </button>
          <button
            onClick={onRedo}
            disabled={!canRedo}
            className={`p-1.5 rounded flex items-center space-x-1 ${
              canRedo ? 'hover:bg-slate-800 text-slate-300 hover:text-white' : 'text-slate-600 cursor-not-allowed'
            }`}
            title="重做 (Ctrl+Y)"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 7v6h-6" />
              <path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13" />
            </svg>
            <span>重做</span>
          </button>
          <button
            onClick={onClear}
            className="p-1.5 hover:bg-slate-800 rounded text-rose-400 hover:text-rose-300 flex items-center space-x-1"
            title="清空所有绘制的标注 (保持底图)"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
            <span>清空标注</span>
          </button>
          <button
            onClick={onClearWorkspace}
            className="p-1.5 hover:bg-slate-800 rounded text-amber-400 hover:text-amber-300 flex items-center space-x-1"
            title="清空当前工作区画布，重新载入新图"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18.36 6.64a9 9 0 1 1-12.73 0" />
              <line x1="12" y1="2" x2="12" y2="12" />
            </svg>
            <span>清空画布</span>
          </button>
        </div>

        {/* 右侧：动作按钮 (截图、导入、复制、保存) */}
        <div className="flex items-center space-x-2">
          {/* 屏幕截图按钮组 */}
          <div className="relative flex items-center bg-sky-600 hover:bg-sky-500 rounded text-white shadow transition">
            <button
              onClick={() => onScreenshot('snip')}
              className="px-2.5 py-1 text-xs font-medium flex items-center space-x-1.5 active:scale-95 transition"
              title="划选屏幕截图 (快捷键: Alt + Shift + A)"
            >
              <span>📸</span>
              <span>截图</span>
              <span className="hidden xl:inline text-[10px] text-sky-200 bg-sky-700/70 px-1 py-0.5 rounded font-mono">Alt+Shift+A</span>
            </button>
            <div className="w-[1px] h-3.5 bg-sky-400/40" />
            <button
              onClick={() => setShowScreenshotMenu(!showScreenshotMenu)}
              className="px-1.5 py-1 hover:bg-sky-700 rounded-r text-sky-100 transition"
              title="选择截图模式"
            >
              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>

            {showScreenshotMenu && (
              <div
                className="absolute left-0 top-full mt-1.5 w-48 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl p-1.5 z-50 text-xs space-y-1"
                onMouseLeave={() => setShowScreenshotMenu(false)}
              >
                <button
                  onClick={() => {
                    setShowScreenshotMenu(false);
                    onScreenshot('snip');
                  }}
                  className="w-full px-2.5 py-1.5 hover:bg-slate-800 rounded-lg flex items-center justify-between text-left text-slate-200 hover:text-white transition"
                >
                  <div className="flex items-center space-x-2">
                    <span>✂️</span>
                    <span>区域划选截图</span>
                  </div>
                  <span className="text-[10px] text-slate-400 font-mono">Alt+Shift+A</span>
                </button>
                <button
                  onClick={() => {
                    setShowScreenshotMenu(false);
                    onScreenshot('fullscreen');
                  }}
                  className="w-full px-2.5 py-1.5 hover:bg-slate-800 rounded-lg flex items-center justify-between text-left text-slate-200 hover:text-white transition"
                >
                  <div className="flex items-center space-x-2">
                    <span>🖥️</span>
                    <span>全屏直接截图</span>
                  </div>
                  <span className="text-[10px] text-slate-400 font-mono">秒截</span>
                </button>
              </div>
            )}
          </div>

          <button
            onClick={onOpenFile}
            className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded flex items-center space-x-1 transition"
            title="打开本地图片文件"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            </svg>
            <span>打开</span>
          </button>

          <button
            onClick={onOpenWorkspaceDrawer}
            className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded flex items-center space-x-1 transition"
            title="查看 Doujiao/Images 工作区图库"
          >
            <span>📁 图库</span>
          </button>

          <button
            onClick={onCopyClipboard}
            className="px-2.5 py-1 bg-sky-600 hover:bg-sky-500 text-white font-medium rounded shadow flex items-center space-x-1.5 transition active:scale-95"
            title="复制到剪贴板 (Ctrl+C)"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
            <span>复制图片</span>
          </button>

          <button
            onClick={onSaveWorkspace}
            className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white font-medium rounded shadow flex items-center space-x-1.5 transition active:scale-95"
            title="保存至工作目录 (Ctrl+S)"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
              <polyline points="17 21 17 13 7 13 7 21" />
              <polyline points="7 3 7 8 15 8" />
            </svg>
            <span>保存</span>
          </button>

          <button
            onClick={onSaveAs}
            className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded flex items-center space-x-1 transition"
            title="另存为本地文件 (Ctrl+Shift+S)"
          >
            <span>另存为...</span>
          </button>
        </div>
      </div>

      {/* 2. 二级工具选择条 */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-slate-950/60 text-xs overflow-x-auto">
        <div className="flex items-center space-x-1">
          {/* 工具项 */}
          <ToolButton
            active={currentTool === 'select'}
            onClick={() => onSelectTool('select')}
            icon={
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 3l7 18 3-7 7-3L3 3z" />
              </svg>
            }
            label="选择/平移"
            hotkey="V"
          />

          <ToolButton
            active={currentTool === 'crop'}
            onClick={() => onSelectTool('crop')}
            icon={
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M6 2v14a2 2 0 0 0 2 2h14" />
                <path d="M18 22V8a2 2 0 0 0-2-2H2" />
              </svg>
            }
            label="裁剪"
            hotkey="C"
          />

          <div className="w-[1px] h-4 bg-slate-800 mx-1" />

          <ToolButton
            active={currentTool === 'arrow'}
            onClick={() => onSelectTool('arrow')}
            icon={
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="5" y1="19" x2="19" y2="5" />
                <polyline points="9 5 19 5 19 15" />
              </svg>
            }
            label="箭头"
            hotkey="A"
          />

          <ToolButton
            active={currentTool === 'rect'}
            onClick={() => onSelectTool('rect')}
            icon={
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              </svg>
            }
            label="矩形"
            hotkey="R"
          />

          <ToolButton
            active={currentTool === 'circle'}
            onClick={() => onSelectTool('circle')}
            icon={
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="9" />
              </svg>
            }
            label="圆形"
            hotkey="O"
          />

          <ToolButton
            active={currentTool === 'line'}
            onClick={() => onSelectTool('line')}
            icon={
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="4" y1="20" x2="20" y2="4" />
              </svg>
            }
            label="直线"
            hotkey="L"
          />

          <ToolButton
            active={currentTool === 'pen'}
            onClick={() => onSelectTool('pen')}
            icon={
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 19l7-7 3 3-7 7-3-3z" />
                <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
                <path d="M2 2l7.586 7.586" />
                <circle cx="11" cy="11" r="2" />
              </svg>
            }
            label="画笔"
            hotkey="P"
          />

          <ToolButton
            active={currentTool === 'highlighter'}
            onClick={() => onSelectTool('highlighter')}
            icon={
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="m9 11-6 6v3h3l6-6" />
                <path d="m22 2-7.5 7.5" />
                <path d="m14 10 3 3" />
              </svg>
            }
            label="荧光笔"
            hotkey="H"
          />

          <ToolButton
            active={currentTool === 'step'}
            onClick={() => onSelectTool('step')}
            icon={
              <div className="w-4 h-4 rounded-full border-2 border-current flex items-center justify-center font-bold text-[10px]">
                1
              </div>
            }
            label="序号标记"
            hotkey="S"
          />

          <ToolButton
            active={currentTool === 'text'}
            onClick={() => onSelectTool('text')}
            icon={
              <span className="font-bold text-sm leading-none px-0.5">T</span>
            }
            label="文字"
            hotkey="T"
          />

          <div className="w-[1px] h-4 bg-slate-800 mx-1" />

          <ToolButton
            active={currentTool === 'mosaic'}
            onClick={() => onSelectTool('mosaic')}
            icon={
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M3 3h4v4H3V3zm7 0h4v4h-4V3zm7 0h4v4h-4V3zM3 10h4v4H3v-4zm7 0h4v4h-4v-4zm7 0h4v4h-4v-4zM3 17h4v4H3v-4zm7 0h4v4h-4v-4zm7 0h4v4h-4v-4z" />
              </svg>
            }
            label="区域马赛克"
            hotkey="M"
          />

          <ToolButton
            active={currentTool === 'mosaic-brush'}
            onClick={() => onSelectTool('mosaic-brush')}
            icon={
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18.375 2.625a3.875 3.875 0 0 0-5.48 0L3.5 12v4.5h4.5l9.395-9.395a3.875 3.875 0 0 0 0-5.48z" />
                <path d="M14 7l3 3" />
              </svg>
            }
            label="涂抹打码"
          />
        </div>

        {/* 裁剪模式特有控制条 */}
        {currentTool === 'crop' ? (
          <div className="flex items-center space-x-2 pl-4 border-l border-slate-800">
            <span className="text-slate-400">比例:</span>
            {(['free', '1:1', '16:9', '4:3', '9:16'] as AspectRatio[]).map((aspect) => (
              <button
                key={aspect}
                onClick={() => onChangeCropAspect(aspect)}
                className={`px-2 py-0.5 rounded text-xs transition ${
                  cropAspect === aspect
                    ? 'bg-sky-600 text-white font-medium'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
              >
                {aspect === 'free' ? '自由' : aspect}
              </button>
            ))}

            <button
              onClick={onApplyCrop}
              className="px-2.5 py-0.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded font-medium flex items-center space-x-1 ml-2"
            >
              <span>✓ 确认裁剪</span>
            </button>
            <button
              onClick={onCancelCrop}
              className="px-2 py-0.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded"
            >
              取消
            </button>
          </div>
        ) : (
          /* 常规工具属性设置栏 */
          <div className="flex items-center space-x-3 pl-4 border-l border-slate-800">
            {/* 调色盘 */}
            {['arrow', 'rect', 'circle', 'line', 'pen', 'highlighter', 'step', 'text'].includes(currentTool) && (
              <div className="flex items-center space-x-1">
                {PRESET_COLORS.map((c) => (
                  <button
                    key={c.value}
                    onClick={() => onUpdateSettings({ strokeColor: c.value })}
                    className={`w-4 h-4 rounded-full border transition transform active:scale-90 ${
                      settings.strokeColor === c.value
                        ? 'border-white scale-110 shadow-sm ring-2 ring-sky-500/50'
                        : 'border-slate-700 opacity-80 hover:opacity-100'
                    }`}
                    style={{ backgroundColor: c.value }}
                    title={c.label}
                  />
                ))}
              </div>
            )}

            {/* 线宽调节 */}
            {['arrow', 'rect', 'circle', 'line', 'pen', 'highlighter'].includes(currentTool) && (
              <div className="flex items-center space-x-1 bg-slate-800/80 rounded px-1.5 py-0.5">
                <span className="text-slate-400 mr-1">粗细:</span>
                {STROKE_WIDTHS.map((sw) => (
                  <button
                    key={sw.value}
                    onClick={() => onUpdateSettings({ strokeWidth: sw.value })}
                    className={`px-1.5 py-0.5 rounded text-[11px] ${
                      settings.strokeWidth === sw.value ? 'bg-sky-600 text-white font-medium' : 'text-slate-300 hover:bg-slate-700'
                    }`}
                  >
                    {sw.label}
                  </button>
                ))}
              </div>
            )}

            {/* 填充开关 (矩形与圆形可用) */}
            {['rect', 'circle'].includes(currentTool) && (
              <label className="flex items-center space-x-1.5 cursor-pointer text-slate-300 hover:text-white bg-slate-800/80 px-2 py-0.5 rounded">
                <input
                  type="checkbox"
                  checked={settings.fill}
                  onChange={(e) => onUpdateSettings({ fill: e.target.checked })}
                  className="rounded border-slate-700 text-sky-500 focus:ring-0 bg-slate-900"
                />
                <span>填充背景</span>
              </label>
            )}

            {/* 字号调节 (文字可用) */}
            {currentTool === 'text' && (
              <div className="flex items-center space-x-1 bg-slate-800/80 rounded px-1.5 py-0.5">
                <span className="text-slate-400 mr-1">字号:</span>
                {FONT_SIZES.map((fs) => (
                  <button
                    key={fs.value}
                    onClick={() => onUpdateSettings({ fontSize: fs.value })}
                    className={`px-1.5 py-0.5 rounded text-[11px] ${
                      settings.fontSize === fs.value ? 'bg-sky-600 text-white font-medium' : 'text-slate-300 hover:bg-slate-700'
                    }`}
                  >
                    {fs.label}
                  </button>
                ))}
              </div>
            )}

            {/* 序号重置 (序号标记可用) */}
            {currentTool === 'step' && (
              <div className="flex items-center space-x-2 bg-slate-800/80 rounded px-2 py-0.5">
                <span className="text-slate-400">
                  当前序号: <strong className="text-sky-300 font-mono text-xs">{settings.currentStep}</strong>
                </span>
                <button
                  onClick={() => onUpdateSettings({ currentStep: 1 })}
                  className="text-xs text-sky-400 hover:underline"
                >
                  重置为 1
                </button>
              </div>
            )}

            {/* 马赛克粒度 */}
            {['mosaic', 'mosaic-brush'].includes(currentTool) && (
              <div className="flex items-center space-x-1 bg-slate-800/80 rounded px-1.5 py-0.5">
                <span className="text-slate-400 mr-1">粒度:</span>
                {MOSAIC_SIZES.map((ms) => (
                  <button
                    key={ms.value}
                    onClick={() => onUpdateSettings({ mosaicSize: ms.value })}
                    className={`px-1.5 py-0.5 rounded text-[11px] ${
                      settings.mosaicSize === ms.value ? 'bg-sky-600 text-white font-medium' : 'text-slate-300 hover:bg-slate-700'
                    }`}
                  >
                    {ms.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

interface ToolButtonProps {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  hotkey?: string;
}

const ToolButton: React.FC<ToolButtonProps> = ({ active, onClick, icon, label, hotkey }) => {
  return (
    <button
      onClick={onClick}
      className={`px-2 py-1 rounded flex items-center space-x-1.5 transition text-xs ${
        active
          ? 'bg-sky-600 text-white font-medium shadow-sm'
          : 'text-slate-300 hover:bg-slate-800 hover:text-white'
      }`}
      title={hotkey ? `${label} (${hotkey})` : label}
    >
      <span>{icon}</span>
      <span>{label}</span>
    </button>
  );
};
