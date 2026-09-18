import React, { useState, useEffect, useRef } from 'react';
import type { MediaProbeInfo, FFmpegConvertOptions, FFmpegConvertProgress } from '@doujiao/plugin-sdk';

interface MediaTask {
  id: string;
  name: string;
  inputPath: string;
  outputPath: string;
  size: number;
  probe?: MediaProbeInfo;
  status: 'idle' | 'running' | 'completed' | 'failed' | 'canceled';
  progress: number;
  speed?: string;
  timemark?: string;
  outputSize?: number;
  error?: string;
  mode: 'transcode' | 'audio' | 'gif' | 'trim' | 'compress';
  options: Partial<FFmpegConvertOptions>;
}

export default function App() {
  const [ffmpegStatus, setFfmpegStatus] = useState<{ installed: boolean; version?: string; path?: string } | null>(null);
  const [activeTab, setActiveTab] = useState<'transcode' | 'audio' | 'gif' | 'trim' | 'compress'>('transcode');

  // Tasks state
  const [tasks, setTasks] = useState<MediaTask[]>([]);
  const [isProcessingAll, setIsProcessingAll] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  // Global settings for next tasks
  const [targetFormat, setTargetFormat] = useState('mp4');
  const [targetAudioFormat, setTargetAudioFormat] = useState('mp3');
  const [audioBitrate, setAudioBitrate] = useState('192k');
  const [qualityCrf, setQualityCrf] = useState(23); // 18 high, 23 standard, 28 small
  const [targetScale, setTargetScale] = useState<'original' | '1920:1080' | '1280:720' | '854:480'>('original');
  const [targetFps, setTargetFps] = useState<number | 'original'>('original');

  // GIF settings
  const [gifFps, setGifFps] = useState(15);
  const [gifScale, setGifScale] = useState<'original' | '480:-1' | '360:-1' | '240:-1'>('480:-1');
  const [gifStart, setGifStart] = useState('0');
  const [gifDuration, setGifDuration] = useState('5');

  // Trim settings
  const [trimStart, setTrimStart] = useState('00:00:00');
  const [trimDuration, setTrimDuration] = useState('00:00:30');
  const [trimCopyOnly, setTrimCopyOnly] = useState(true);

  // Compress preset
  const [compressLevel, setCompressLevel] = useState<'light' | 'medium' | 'extreme'>('medium');

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Check FFmpeg status on mount
  useEffect(() => {
    checkFfmpeg();

    // Subscribe to progress events
    const unsub = (window as any).doujiaoSDK?.media?.onProgress?.((p: FFmpegConvertProgress) => {
      setTasks((prev) =>
        prev.map((t) => {
          if (t.id === p.taskId) {
            return {
              ...t,
              progress: p.percent,
              speed: p.speed,
              timemark: p.timemark,
              status: p.status === 'running' ? 'running' : p.status === 'completed' ? 'completed' : p.status === 'failed' ? 'failed' : t.status,
              outputPath: p.outputPath || t.outputPath,
              error: p.error
            };
          }
          return t;
        })
      );
    });

    return () => {
      if (typeof unsub === 'function') unsub();
    };
  }, []);

  const checkFfmpeg = async () => {
    try {
      const res = await (window as any).doujiaoSDK?.media?.checkFFmpeg?.();
      setFfmpegStatus(res || { installed: false });
    } catch {
      setFfmpegStatus({ installed: false });
    }
  };

  const handleFiles = async (files: FileList | File[]) => {
    const fileList = Array.from(files);
    if (fileList.length === 0) return;

    const newTasks: MediaTask[] = [];

    for (const file of fileList) {
      const inputPath = (window as any).doujiaoSDK?.getPathForFile?.(file) || (file as any).path || '';
      if (!inputPath) continue;

      let probe: MediaProbeInfo | undefined;
      try {
        probe = await (window as any).doujiaoSDK?.media?.probe?.(inputPath);
      } catch (err) {
        console.warn('Probe error for', inputPath, err);
      }

      // Generate default output path
      const dotIdx = inputPath.lastIndexOf('.');
      const baseName = dotIdx > 0 ? inputPath.slice(0, dotIdx) : inputPath;
      const taskId = 'task_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);

      let ext = targetFormat;
      if (activeTab === 'audio') ext = targetAudioFormat;
      else if (activeTab === 'gif') ext = 'gif';
      else if (activeTab === 'trim') ext = dotIdx > 0 ? inputPath.slice(dotIdx + 1) : 'mp4';

      const outputPath = `${baseName}_${activeTab}_${Date.now()}.${ext}`;

      const options: Partial<FFmpegConvertOptions> = {
        inputPath,
        outputPath
      };

      if (activeTab === 'transcode') {
        options.format = targetFormat;
        options.crf = qualityCrf;
        if (targetScale !== 'original') options.scale = targetScale;
        if (targetFps !== 'original') options.fps = targetFps;
      } else if (activeTab === 'audio') {
        options.videoCodec = 'none';
        options.audioBitrate = audioBitrate;
      } else if (activeTab === 'gif') {
        options.isGif = true;
        options.fps = gifFps;
        if (gifScale !== 'original') options.scale = gifScale;
        options.startTime = gifStart;
        options.duration = gifDuration;
      } else if (activeTab === 'trim') {
        options.startTime = trimStart;
        options.duration = trimDuration;
        if (trimCopyOnly) {
          options.videoCodec = 'copy';
          options.audioCodec = 'copy';
        }
      } else if (activeTab === 'compress') {
        options.crf = compressLevel === 'light' ? 24 : compressLevel === 'medium' ? 28 : 34;
        options.scale = compressLevel === 'extreme' ? '1280:-2' : undefined;
      }

      newTasks.push({
        id: taskId,
        name: file.name,
        inputPath,
        outputPath,
        size: file.size,
        probe,
        status: 'idle',
        progress: 0,
        mode: activeTab,
        options
      });
    }

    setTasks((prev) => [...prev, ...newTasks]);
  };

  const startTask = async (task: MediaTask) => {
    if (task.status === 'running') return;

    setTasks((prev) =>
      prev.map((t) => (t.id === task.id ? { ...t, status: 'running', progress: 1, error: undefined } : t))
    );

    try {
      const res = await (window as any).doujiaoSDK?.media?.convert?.({
        ...task.options,
        inputPath: task.inputPath,
        outputPath: task.outputPath
      });

      setTasks((prev) =>
        prev.map((t) =>
          t.id === task.id
            ? { ...t, status: 'completed', progress: 100, outputSize: res?.size, outputPath: res?.outputPath || t.outputPath }
            : t
        )
      );
    } catch (err: any) {
      setTasks((prev) =>
        prev.map((t) => (t.id === task.id ? { ...t, status: 'failed', error: err?.message || '转码失败' } : t))
      );
    }
  };

  const startAll = async () => {
    setIsProcessingAll(true);
    for (const task of tasks) {
      if (task.status === 'idle' || task.status === 'failed') {
        await startTask(task);
      }
    }
    setIsProcessingAll(false);
  };

  const cancelTask = async (task: MediaTask) => {
    try {
      await (window as any).doujiaoSDK?.media?.cancelConvert?.(task.id);
      setTasks((prev) =>
        prev.map((t) => (t.id === task.id ? { ...t, status: 'canceled', error: '已手动取消' } : t))
      );
    } catch {}
  };

  const removeTask = (taskId: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== taskId));
  };

  const openFile = (filePath: string) => {
    (window as any).doujiaoSDK?.media?.openPath?.(filePath);
  };

  const showInFolder = (filePath: string) => {
    (window as any).doujiaoSDK?.media?.showItemInFolder?.(filePath);
  };

  const formatBytes = (bytes: number) => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const formatDuration = (sec?: number) => {
    if (!sec) return '00:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-slate-950 text-slate-100 theme-bg-base">
      {/* 顶部状态与环境导航 */}
      <header className="px-6 py-3.5 border-b border-slate-800/80 bg-slate-900/90 flex items-center justify-between theme-bg-sidebar">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🎬</span>
          <div>
            <h1 className="text-base font-bold text-slate-100 flex items-center gap-2">
              音视频转换工坊
              {ffmpegStatus?.installed ? (
                <span className="text-[10px] bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 px-2 py-0.5 rounded-full font-mono">
                  ✓ FFmpeg 就绪 ({ffmpegStatus.version || 'v7.0.1'})
                </span>
              ) : (
                <span className="text-[10px] bg-amber-500/20 text-amber-400 border border-amber-500/40 px-2 py-0.5 rounded-full font-mono">
                  ⚠️ 未检测到 FFmpeg
                </span>
              )}
            </h1>
            <p className="text-xs text-slate-400">格式转码、提取音频、制作 GIF、无损快剪与极速压缩</p>
          </div>
        </div>

        {/* 模式切换 Tab */}
        <div className="flex bg-slate-950/80 p-1 rounded-xl border border-slate-800 space-x-1 text-xs">
          {[
            { id: 'transcode', label: '🎥 视频转码' },
            { id: 'audio', label: '🎵 提取音频' },
            { id: 'gif', label: '🎞️ 制作 GIF' },
            { id: 'trim', label: '✂️ 快速截取' },
            { id: 'compress', label: '🗜️ 视频压缩' }
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`px-3 py-1.5 rounded-lg font-medium transition cursor-pointer ${
                activeTab === tab.id
                  ? 'btn-primary shadow-sm font-semibold'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </header>

      {/* FFmpeg 未安装警告横幅 */}
      {ffmpegStatus && !ffmpegStatus.installed && (
        <div className="bg-amber-950/50 border-b border-amber-800 px-6 py-2.5 flex items-center justify-between text-xs text-amber-200">
          <div className="flex items-center gap-2">
            <span>⚠️</span>
            <span>当前系统未检测到独立 FFmpeg 组件。请前往宿主「应用设置」中完成 FFmpeg 自动安装或手动导入。</span>
          </div>
          <button
            onClick={checkFfmpeg}
            className="bg-amber-600 hover:bg-amber-500 text-white font-medium px-3 py-1 rounded cursor-pointer transition"
          >
            🔄 重新检测
          </button>
        </div>
      )}

      {/* 中部主视图：左配置 & 右拖拽列表 */}
      <div className="flex-1 flex overflow-hidden p-6 gap-6">
        {/* 左侧参数调节面板 */}
        <div className="w-80 flex-shrink-0 flex flex-col border border-slate-800 rounded-2xl bg-slate-900/60 p-4 space-y-4 theme-bg-card">
          <div className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center justify-between">
            <span>转换参数配置</span>
            <span className="text-[10px] text-indigo-400 font-normal">对新添加任务生效</span>
          </div>

          {/* 视频转码配置 */}
          {activeTab === 'transcode' && (
            <div className="space-y-3 text-xs">
              <div>
                <label className="text-slate-400 block mb-1">目标视频格式:</label>
                <div className="grid grid-cols-3 gap-1.5">
                  {['mp4', 'webm', 'mkv', 'mov', 'avi', 'flv'].map((fmt) => (
                    <button
                      key={fmt}
                      onClick={() => setTargetFormat(fmt)}
                      className={`py-1.5 rounded-lg border text-center font-mono uppercase transition cursor-pointer ${
                        targetFormat === fmt
                          ? 'bg-indigo-600/30 border-indigo-500 text-indigo-300 font-bold'
                          : 'border-slate-800 text-slate-400 hover:border-slate-700'
                      }`}
                    >
                      {fmt}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="flex justify-between text-slate-400 mb-1">
                  <span>画质预设 (CRF {qualityCrf}):</span>
                  <span className="text-[10px] text-slate-500">
                    {qualityCrf <= 19 ? '极高画质' : qualityCrf <= 24 ? '平衡推荐' : '快速压缩'}
                  </span>
                </div>
                <input
                  type="range"
                  min={16}
                  max={32}
                  value={qualityCrf}
                  onChange={(e) => setQualityCrf(Number(e.target.value))}
                  className="w-full accent-indigo-500"
                />
              </div>

              <div>
                <label className="text-slate-400 block mb-1">分辨率缩放:</label>
                <select
                  value={targetScale}
                  onChange={(e) => setTargetScale(e.target.value as any)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-slate-200 outline-none"
                >
                  <option value="original">保持原始分辨率</option>
                  <option value="1920:1080">1080p 全高清 (1920×1080)</option>
                  <option value="1280:720">720p 高清 (1280×720)</option>
                  <option value="854:480">480p 标清 (854×480)</option>
                </select>
              </div>

              <div>
                <label className="text-slate-400 block mb-1">输出帧率:</label>
                <select
                  value={targetFps}
                  onChange={(e) => setTargetFps(e.target.value === 'original' ? 'original' : Number(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-slate-200 outline-none"
                >
                  <option value="original">保持原始帧率</option>
                  <option value={60}>60 fps (极度顺滑)</option>
                  <option value={30}>30 fps (标准)</option>
                  <option value={24}>24 fps (电影感)</option>
                </select>
              </div>
            </div>
          )}

          {/* 提取音频配置 */}
          {activeTab === 'audio' && (
            <div className="space-y-3 text-xs">
              <div>
                <label className="text-slate-400 block mb-1">音频目标格式:</label>
                <div className="grid grid-cols-3 gap-1.5">
                  {['mp3', 'aac', 'wav', 'flac', 'm4a', 'ogg'].map((fmt) => (
                    <button
                      key={fmt}
                      onClick={() => setTargetAudioFormat(fmt)}
                      className={`py-1.5 rounded-lg border text-center font-mono uppercase transition cursor-pointer ${
                        targetAudioFormat === fmt
                          ? 'bg-indigo-600/30 border-indigo-500 text-indigo-300 font-bold'
                          : 'border-slate-800 text-slate-400 hover:border-slate-700'
                      }`}
                    >
                      {fmt}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-slate-400 block mb-1">音频码率品质:</label>
                <select
                  value={audioBitrate}
                  onChange={(e) => setAudioBitrate(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-slate-200 outline-none"
                >
                  <option value="320k">320 kbps (最高品质无损级)</option>
                  <option value="256k">256 kbps (超清品质)</option>
                  <option value="192k">192 kbps (标准推荐)</option>
                  <option value="128k">128 kbps (网络紧凑)</option>
                </select>
              </div>
            </div>
          )}

          {/* 制作 GIF 配置 */}
          {activeTab === 'gif' && (
            <div className="space-y-3 text-xs">
              <div>
                <label className="text-slate-400 block mb-1">GIF 帧率:</label>
                <select
                  value={gifFps}
                  onChange={(e) => setGifFps(Number(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-slate-200 outline-none"
                >
                  <option value={10}>10 fps (体积最小)</option>
                  <option value={15}>15 fps (推荐平衡)</option>
                  <option value={24}>24 fps (极度顺滑)</option>
                </select>
              </div>

              <div>
                <label className="text-slate-400 block mb-1">动图宽度:</label>
                <select
                  value={gifScale}
                  onChange={(e) => setGifScale(e.target.value as any)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-slate-200 outline-none"
                >
                  <option value="480:-1">480 px (标准宽)</option>
                  <option value="360:-1">360 px (表情包适中)</option>
                  <option value="240:-1">240 px (迷你紧凑)</option>
                  <option value="original">原始大小</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-slate-400 block mb-1">开始秒数 (s):</label>
                  <input
                    type="text"
                    value={gifStart}
                    onChange={(e) => setGifStart(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-slate-200 font-mono outline-none"
                  />
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">截取时长 (s):</label>
                  <input
                    type="text"
                    value={gifDuration}
                    onChange={(e) => setGifDuration(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-slate-200 font-mono outline-none"
                  />
                </div>
              </div>
              <div className="text-[11px] text-emerald-400/90 leading-tight">
                💡 自动采用 palettegen 高保真双通道调色板生成，消除色阶断层。
              </div>
            </div>
          )}

          {/* 截取快剪配置 */}
          {activeTab === 'trim' && (
            <div className="space-y-3 text-xs">
              <div>
                <label className="text-slate-400 block mb-1">起始时间点 (hh:mm:ss):</label>
                <input
                  type="text"
                  value={trimStart}
                  onChange={(e) => setTrimStart(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-slate-200 font-mono outline-none"
                />
              </div>

              <div>
                <label className="text-slate-400 block mb-1">截取时长 (hh:mm:ss 或秒):</label>
                <input
                  type="text"
                  value={trimDuration}
                  onChange={(e) => setTrimDuration(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-slate-200 font-mono outline-none"
                />
              </div>

              <label className="flex items-center gap-2 text-slate-300 cursor-pointer pt-1">
                <input
                  type="checkbox"
                  checked={trimCopyOnly}
                  onChange={(e) => setTrimCopyOnly(e.target.checked)}
                  className="accent-indigo-500 rounded"
                />
                <span>极速流复制模式 (秒级剪辑，无重编码损失)</span>
              </label>
            </div>
          )}

          {/* 视频压缩配置 */}
          {activeTab === 'compress' && (
            <div className="space-y-3 text-xs">
              <label className="text-slate-400 block">压缩等级推荐:</label>
              {[
                { id: 'light', title: '轻度压缩', desc: '几乎无感画质损失，节约约 25% 空间' },
                { id: 'medium', title: '智能推荐压缩', desc: '最佳画质与体积平衡，节约约 50% 空间' },
                { id: 'extreme', title: '极限网络压缩', desc: '转为 720p 高压缩，适合微信/邮件秒发' }
              ].map((c) => (
                <div
                  key={c.id}
                  onClick={() => setCompressLevel(c.id as any)}
                  className={`p-3 rounded-xl border cursor-pointer transition ${
                    compressLevel === c.id
                      ? 'bg-indigo-600/20 border-indigo-500 text-indigo-200'
                      : 'border-slate-800 hover:border-slate-700 text-slate-400'
                  }`}
                >
                  <div className="font-semibold text-slate-200">{c.title}</div>
                  <div className="text-[10px] mt-0.5 opacity-80">{c.desc}</div>
                </div>
              ))}
            </div>
          )}

          <div className="mt-auto pt-3 border-t border-slate-800/80">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-full py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl text-xs font-medium text-slate-200 transition cursor-pointer flex items-center justify-center gap-1.5"
            >
              <span>📁</span> 选择媒体文件...
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="video/*,audio/*"
              onChange={(e) => e.target.files && handleFiles(e.target.files)}
              className="hidden"
            />
          </div>
        </div>

        {/* 右侧批量任务管理与拖放区 */}
        <div
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragging(false);
            if (e.dataTransfer.files) handleFiles(e.dataTransfer.files);
          }}
          className={`flex-1 flex flex-col border rounded-2xl overflow-hidden transition-colors ${
            isDragging ? 'border-indigo-500 bg-indigo-950/20' : 'border-slate-800 bg-slate-900/40'
          }`}
        >
          {/* 任务栏顶部状态 */}
          <div className="p-3.5 border-b border-slate-800 bg-slate-900/80 flex items-center justify-between text-xs">
            <div className="flex items-center gap-3">
              <span className="font-semibold text-slate-200">
                任务列表 ({tasks.length})
              </span>
              <span className="text-slate-500 text-[11px]">
                支持直接拖拽视频或音频文件至任意区域
              </span>
            </div>

            <div className="flex items-center gap-2">
              {tasks.length > 0 && (
                <>
                  <button
                    onClick={startAll}
                    disabled={isProcessingAll}
                    className="btn-primary px-3 py-1.5 rounded-lg font-semibold flex items-center gap-1 cursor-pointer transition disabled:opacity-50"
                  >
                    <span>▶</span> 开始全部转换
                  </button>
                  <button
                    onClick={() => setTasks([])}
                    className="bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 px-2.5 py-1.5 rounded-lg cursor-pointer transition"
                  >
                    清空
                  </button>
                </>
              )}
            </div>
          </div>

          {/* 任务列表内容 */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {tasks.length > 0 ? (
              tasks.map((task) => (
                <div
                  key={task.id}
                  className="border border-slate-800 rounded-xl p-3.5 bg-slate-950/70 space-y-2 hover:border-slate-700 transition"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="text-xl flex-shrink-0">
                        {task.mode === 'audio' ? '🎵' : task.mode === 'gif' ? '🎞️' : '🎬'}
                      </span>
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-slate-200 truncate">{task.name}</div>
                        <div className="text-[11px] text-slate-500 flex items-center gap-2 mt-0.5">
                          <span>{formatBytes(task.size)}</span>
                          {task.probe?.duration && <span>• {formatDuration(task.probe.duration)}</span>}
                          {task.probe?.width && task.probe?.height && (
                            <span>• {task.probe.width}×{task.probe.height}</span>
                          )}
                          <span className="text-indigo-400 font-mono uppercase">➔ {task.mode}</span>
                        </div>
                      </div>
                    </div>

                    {/* 操作按钮 */}
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {task.status === 'idle' && (
                        <button
                          onClick={() => startTask(task)}
                          className="btn-primary px-3 py-1 rounded text-xs cursor-pointer font-medium"
                        >
                          开始转换
                        </button>
                      )}
                      {task.status === 'running' && (
                        <button
                          onClick={() => cancelTask(task)}
                          className="bg-rose-900/60 hover:bg-rose-800 border border-rose-700 text-rose-200 px-2.5 py-1 rounded text-xs cursor-pointer"
                        >
                          ✕ 取消
                        </button>
                      )}
                      {task.status === 'completed' && (
                        <>
                          <button
                            onClick={() => openFile(task.outputPath)}
                            className="bg-emerald-900/40 hover:bg-emerald-800/60 border border-emerald-700 text-emerald-300 px-2.5 py-1 rounded text-xs cursor-pointer transition"
                          >
                            ▶ 播放
                          </button>
                          <button
                            onClick={() => showInFolder(task.outputPath)}
                            className="bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 px-2.5 py-1 rounded text-xs cursor-pointer transition"
                          >
                            📁 定位
                          </button>
                        </>
                      )}
                      <button
                        onClick={() => removeTask(task.id)}
                        className="text-slate-500 hover:text-rose-400 p-1 text-xs cursor-pointer"
                      >
                        🗑️
                      </button>
                    </div>
                  </div>

                  {/* 进度条与状态 */}
                  {task.status === 'running' && (
                    <div className="space-y-1">
                      <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-indigo-500 transition-all duration-200 rounded-full"
                          style={{ width: `${task.progress}%` }}
                        />
                      </div>
                      <div className="flex justify-between text-[10px] text-slate-400 font-mono">
                        <span>
                          {task.progress}% {task.speed && `(${task.speed})`}
                        </span>
                        <span>{task.timemark || '正在转码...'}</span>
                      </div>
                    </div>
                  )}

                  {task.status === 'completed' && (
                    <div className="text-[11px] text-emerald-400 flex items-center justify-between">
                      <span>✓ 转换完成！输出大小: {formatBytes(task.outputSize || 0)}</span>
                      <span className="text-slate-500 font-mono truncate max-w-[280px]">{task.outputPath}</span>
                    </div>
                  )}

                  {task.status === 'failed' && (
                    <div className="text-[11px] text-rose-400">
                      ✗ 处理失败: {task.error}
                    </div>
                  )}
                </div>
              ))
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-slate-500 space-y-3 py-16">
                <span className="text-4xl opacity-50">📂</span>
                <div className="text-sm font-semibold text-slate-400">暂无转换任务</div>
                <div className="text-xs max-w-sm text-center leading-relaxed text-slate-500">
                  可将视频（MP4/MKV/MOV/WebM）或音频文件直接拖入此区域，或点击左下角「选择媒体文件」开始处理
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
