import React, { useState, useEffect, useRef } from 'react';
import { createWorker } from 'tesseract.js';

interface OcrHistoryItem {
  id: string;
  timestamp: number;
  previewUrl: string;
  text: string;
  charCount: number;
}

export default function App() {
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [recognizedText, setRecognizedText] = useState<string>('');
  const [isRecognizing, setIsRecognizing] = useState(false);
  const [progressPercent, setProgressPercent] = useState(0);
  const [progressStatus, setProgressStatus] = useState<string>('');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Settings
  const [engine, setEngine] = useState<'tesseract' | 'ai'>(() => {
    return (localStorage.getItem('doujiao:ocr:engine') as any) || 'tesseract';
  });
  const [language, setLanguage] = useState<'chi_sim+eng' | 'eng' | 'chi_tra+eng'>(() => {
    return (localStorage.getItem('doujiao:ocr:lang') as any) || 'chi_sim+eng';
  });

  // AI Vision Settings
  const [showAiConfig, setShowAiConfig] = useState(false);
  const [aiEndpoint, setAiEndpoint] = useState(() => {
    return localStorage.getItem('doujiao:ocr:aiEndpoint') || 'http://localhost:11434/v1/chat/completions';
  });
  const [aiModel, setAiModel] = useState(() => {
    return localStorage.getItem('doujiao:ocr:aiModel') || 'qwen2.5-vl';
  });
  const [aiApiKey, setAiApiKey] = useState(() => {
    return localStorage.getItem('doujiao:ocr:aiApiKey') || '';
  });

  // History state
  const [history, setHistory] = useState<OcrHistoryItem[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('doujiao:ocr:history') || '[]');
    } catch {
      return [];
    }
  });
  const [showHistory, setShowHistory] = useState(false);

  // Image Zoom / Rotate
  const [zoom, setZoom] = useState(100);
  const [rotation, setRotation] = useState(0);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Global Ctrl+V listener
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      if (e.clipboardData?.items) {
        for (const item of Array.from(e.clipboardData.items)) {
          if (item.type.startsWith('image/')) {
            const file = item.getAsFile();
            if (file) {
              const reader = new FileReader();
              reader.onload = () => {
                if (typeof reader.result === 'string') {
                  loadImage(reader.result);
                }
              };
              reader.readAsDataURL(file);
              return;
            }
          }
        }
      }
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [engine, language, aiEndpoint, aiModel, aiApiKey]);

  // Save persistent configs
  useEffect(() => {
    localStorage.setItem('doujiao:ocr:engine', engine);
    localStorage.setItem('doujiao:ocr:lang', language);
    localStorage.setItem('doujiao:ocr:aiEndpoint', aiEndpoint);
    localStorage.setItem('doujiao:ocr:aiModel', aiModel);
    localStorage.setItem('doujiao:ocr:aiApiKey', aiApiKey);
  }, [engine, language, aiEndpoint, aiModel, aiApiKey]);

  useEffect(() => {
    localStorage.setItem('doujiao:ocr:history', JSON.stringify(history.slice(0, 15)));
  }, [history]);

  const loadImage = (dataUrl: string) => {
    setImageSrc(dataUrl);
    setZoom(100);
    setRotation(0);
    // 自动触发识别
    recognizeImage(dataUrl);
  };

  const handleFile = (file: File) => {
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        loadImage(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  // 1. 屏幕截图触发
  const handleScreenCapture = async () => {
    try {
      const res = await (window as any).doujiaoSDK?.screen?.capture?.({ mode: 'snip' });
      if (res?.success && res.dataUrl) {
        loadImage(res.dataUrl);
      }
    } catch (err: any) {
      console.error('Screen capture error:', err);
    }
  };

  // 2. 从剪贴板粘贴
  const handlePasteClipboard = async () => {
    try {
      if (navigator.clipboard.read) {
        const items = await navigator.clipboard.read();
        for (const item of items) {
          const imgType = item.types.find((t) => t.startsWith('image/'));
          if (imgType) {
            const blob = await item.getType(imgType);
            const reader = new FileReader();
            reader.onload = () => {
              if (typeof reader.result === 'string') loadImage(reader.result);
            };
            reader.readAsDataURL(blob);
            return;
          }
        }
      }
    } catch {}

    // Fallback: clipboard history
    try {
      const historyItems = await (window as any).doujiaoSDK?.clipboard?.getHistory?.();
      const imgItem = historyItems?.find((h: any) => h.type === 'image' && h.dataUrl);
      if (imgItem?.dataUrl) {
        loadImage(imgItem.dataUrl);
        return;
      }
    } catch {}

    alert('剪贴板中未检测到图片，请先截图或复制图片');
  };

  // 3. 执行识别核心逻辑
  const recognizeImage = async (imgData: string) => {
    setIsRecognizing(true);
    setProgressPercent(10);
    setProgressStatus('准备识别引擎...');
    setRecognizedText('');

    try {
      if (engine === 'tesseract') {
        // Tesseract.js 本地优先引擎 (配置本地 worker 与 wasm 核心，兼顾离线稳定性与性能)
        const origin = window.location.origin;
        const isPluginProtocol = origin.startsWith('doujiao-plugin:');
        const workerOptions: any = {
          logger: (m: any) => {
            if (m.status === 'recognizing text') {
              setProgressPercent(Math.round((m.progress || 0) * 100));
              setProgressStatus(`正在分析图像字符... ${Math.round((m.progress || 0) * 100)}%`);
            } else {
              setProgressStatus(m.status || '正在加载语言模型...');
            }
          }
        };

        if (isPluginProtocol) {
          workerOptions.workerPath = `${origin}/tesseract/worker.min.js`;
          workerOptions.corePath = `${origin}/tesseract`;
          workerOptions.workerBlobURL = false;
        }

        const worker = await createWorker(language, 1, workerOptions);

        const ret = await worker.recognize(imgData);
        await worker.terminate();

        const cleanResult = ret.data.text.trim();
        setRecognizedText(cleanResult);
        saveToHistory(imgData, cleanResult);
      } else {
        // AI Vision API 识别
        setProgressStatus('正在请求 AI Vision 大模型解析...');
        setProgressPercent(40);

        const prompt =
          '请精确提取并识别图片中的全部文本。保持原有的段落层次和表格结构（若是表格请输出为标准的Markdown表格）。不要输出任何额外的问候语或解释分析，仅输出识别结果。';

        const payload = {
          model: aiModel,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: prompt },
                {
                  type: 'image_url',
                  image_url: {
                    url: imgData
                  }
                }
              ]
            }
          ],
          temperature: 0.1
        };

        const headers: Record<string, string> = {
          'Content-Type': 'application/json'
        };
        if (aiApiKey) {
          headers['Authorization'] = `Bearer ${aiApiKey}`;
        }

        let resText = '';
        if ((window as any).doujiaoSDK?.network?.request) {
          const resp = await (window as any).doujiaoSDK.network.request({
            url: aiEndpoint,
            method: 'POST',
            headers,
            body: payload
          });
          resText = resp.data?.choices?.[0]?.message?.content || JSON.stringify(resp.data);
        } else {
          const resp = await fetch(aiEndpoint, {
            method: 'POST',
            headers,
            body: JSON.stringify(payload)
          });
          const json = await resp.json();
          resText = json?.choices?.[0]?.message?.content || JSON.stringify(json);
        }

        const cleanResult = resText.trim();
        setRecognizedText(cleanResult);
        saveToHistory(imgData, cleanResult);
      }
    } catch (err: any) {
      console.error('OCR error:', err);
      setRecognizedText(`[识别失败]: ${err?.message || '未知错误'}`);
    } finally {
      setIsRecognizing(false);
      setProgressPercent(100);
      setProgressStatus('');
    }
  };

  const saveToHistory = (imgData: string, text: string) => {
    if (!text) return;
    const item: OcrHistoryItem = {
      id: 'ocr_' + Date.now(),
      timestamp: Date.now(),
      previewUrl: imgData,
      text,
      charCount: text.length
    };
    setHistory((prev) => [item, ...prev.filter((h) => h.text !== text)].slice(0, 20));
  };

  // 4. 后处理排版操作
  const copyText = async (text: string, key: string) => {
    if (!text) return;
    await navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1500);
  };

  const copySingleLine = async () => {
    const single = recognizedText.replace(/[\r\n]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
    await copyText(single, 'single');
  };

  const cleanRemoveLineBreaks = () => {
    // 智能合并段落换行：中文字符连接处直接拼接，英文连接处加空格
    const cleaned = recognizedText
      .replace(/([\u4e00-\u9fa5])\r?\n([\u4e00-\u9fa5])/g, '$1$2')
      .replace(/([a-zA-Z0-9])\r?\n([a-zA-Z0-9])/g, '$1 $2');
    setRecognizedText(cleaned);
  };

  const cleanRemoveSpaces = () => {
    // 清除中文字符间的意外空格
    const cleaned = recognizedText.replace(/([\u4e00-\u9fa5])\s+([\u4e00-\u9fa5])/g, '$1$2');
    setRecognizedText(cleaned);
  };

  const saveToFile = async () => {
    if (!recognizedText) return;
    try {
      if ((window as any).doujiaoSDK?.workspace?.saveFileAs) {
        await (window as any).doujiaoSDK.workspace.saveFileAs(recognizedText, `ocr_${Date.now()}.txt`, ['txt', 'md']);
      } else {
        const blob = new Blob([recognizedText], { type: 'text/plain;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `ocr_${Date.now()}.txt`;
        a.click();
      }
    } catch (err) {
      console.error('Save error:', err);
    }
  };

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-slate-950 text-slate-100 theme-bg-base select-none">
      {/* 顶部工具栏 */}
      <header className="px-6 py-3 border-b border-slate-800/80 bg-slate-900/90 flex items-center justify-between theme-bg-sidebar">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🔍</span>
          <div>
            <h1 className="text-base font-bold text-slate-100 flex items-center gap-2">
              OCR 文字识别
              <span className="text-[10px] bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 px-2 py-0.5 rounded-full font-medium">
                {engine === 'tesseract' ? 'Tesseract 离线引擎' : `AI Vision (${aiModel})`}
              </span>
            </h1>
            <p className="text-xs text-slate-400">屏幕划选截图、剪贴板粘贴、离线快速解析与排版导出</p>
          </div>
        </div>

        {/* 顶部核心快捷操作 */}
        <div className="flex items-center gap-2.5">
          <button
            onClick={handleScreenCapture}
            className="btn-primary px-3.5 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 cursor-pointer shadow-sm active:scale-95 transition-transform"
          >
            <span>📸</span> 屏幕截图识别
          </button>
          <button
            onClick={handlePasteClipboard}
            className="bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 px-3 py-1.5 rounded-xl text-xs font-medium flex items-center gap-1.5 cursor-pointer transition"
          >
            <span>📋</span> 剪贴板粘贴 (Ctrl+V)
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 px-3 py-1.5 rounded-xl text-xs font-medium flex items-center gap-1.5 cursor-pointer transition"
          >
            <span>📁</span> 选择图片
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={(e) => e.target.files && handleFile(e.target.files[0])}
            className="hidden"
          />

          <div className="h-4 w-[1px] bg-slate-800 mx-1" />

          {/* 引擎与语言切换 */}
          <div className="flex items-center gap-2">
            <select
              value={engine}
              onChange={(e) => setEngine(e.target.value as any)}
              className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 outline-none cursor-pointer"
            >
              <option value="tesseract">Tesseract 本地离线</option>
              <option value="ai">自定义 AI Vision API</option>
            </select>

            {engine === 'tesseract' ? (
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value as any)}
                className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 outline-none cursor-pointer"
              >
                <option value="chi_sim+eng">简体中文 + 英文</option>
                <option value="eng">纯英文与数字</option>
                <option value="chi_tra+eng">繁体中文 + 英文</option>
              </select>
            ) : (
              <button
                onClick={() => setShowAiConfig(!showAiConfig)}
                className="bg-slate-800 hover:bg-slate-700 border border-slate-700 text-indigo-300 px-2.5 py-1.5 rounded-lg text-xs cursor-pointer transition"
              >
                ⚙️ API 配置
              </button>
            )}

            <button
              onClick={() => setShowHistory(!showHistory)}
              className="bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 px-2.5 py-1.5 rounded-lg text-xs cursor-pointer transition flex items-center gap-1"
            >
              <span>📜</span> 历史 ({history.length})
            </button>
          </div>
        </div>
      </header>

      {/* AI 配置弹窗 */}
      {showAiConfig && (
        <div className="bg-slate-900 border-b border-slate-800 px-6 py-4 space-y-3 text-xs">
          <div className="flex items-center justify-between font-bold text-slate-200">
            <span>⚙️ 自定义 AI Vision 接口配置 (兼容 OpenAI / Ollama 格式)</span>
            <button onClick={() => setShowAiConfig(false)} className="text-slate-500 hover:text-slate-300">
              ✕ 关闭
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="text-slate-400 block mb-1">API Endpoint 接口地址:</label>
              <input
                type="text"
                value={aiEndpoint}
                onChange={(e) => setAiEndpoint(e.target.value)}
                placeholder="http://localhost:11434/v1/chat/completions"
                className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-slate-200 font-mono text-xs outline-none"
              />
            </div>
            <div>
              <label className="text-slate-400 block mb-1">Model 模型名称:</label>
              <input
                type="text"
                value={aiModel}
                onChange={(e) => setAiModel(e.target.value)}
                placeholder="qwen2.5-vl 或 gpt-4o-mini"
                className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-slate-200 font-mono text-xs outline-none"
              />
            </div>
            <div>
              <label className="text-slate-400 block mb-1">API Key (本地 Ollama 可留空):</label>
              <input
                type="password"
                value={aiApiKey}
                onChange={(e) => setAiApiKey(e.target.value)}
                placeholder="sk-..."
                className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-slate-200 font-mono text-xs outline-none"
              />
            </div>
          </div>
        </div>
      )}

      {/* 识别进度条 */}
      {isRecognizing && (
        <div className="bg-indigo-950/60 border-b border-indigo-800/80 px-6 py-2 flex items-center justify-between text-xs text-indigo-300">
          <div className="flex items-center gap-2.5">
            <div className="w-3 h-3 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
            <span>{progressStatus || '正在分析文字...'}</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-48 h-1.5 bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-indigo-500 transition-all duration-300"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <span className="font-mono">{progressPercent}%</span>
          </div>
        </div>
      )}

      {/* 主视图：左右分屏（左图预览，右侧文字编辑） */}
      <div className="flex-1 flex overflow-hidden p-6 gap-6">
        {/* 左侧：图像载入与预览区 */}
        <div
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragging(false);
            if (e.dataTransfer.files && e.dataTransfer.files[0]) {
              handleFile(e.dataTransfer.files[0]);
            }
          }}
          className={`flex-1 flex flex-col border rounded-2xl overflow-hidden transition-colors ${
            isDragging ? 'border-indigo-500 bg-indigo-950/20' : 'border-slate-800 bg-slate-900/60'
          }`}
        >
          {/* 图像预览控制栏 */}
          <div className="px-3.5 py-2 border-b border-slate-800 bg-slate-950/80 flex items-center justify-between text-xs">
            <span className="font-semibold text-slate-300">图像预览</span>
            {imageSrc && (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setZoom((z) => Math.max(30, z - 20))}
                  className="bg-slate-800 hover:bg-slate-700 px-2 py-0.5 rounded text-slate-300 cursor-pointer"
                >
                  -
                </button>
                <span className="font-mono text-slate-400 text-[11px]">{zoom}%</span>
                <button
                  onClick={() => setZoom((z) => Math.min(300, z + 20))}
                  className="bg-slate-800 hover:bg-slate-700 px-2 py-0.5 rounded text-slate-300 cursor-pointer"
                >
                  +
                </button>
                <button
                  onClick={() => setRotation((r) => (r + 90) % 360)}
                  className="bg-slate-800 hover:bg-slate-700 px-2 py-0.5 rounded text-slate-300 cursor-pointer ml-1"
                >
                  ↻ 旋转
                </button>
                <button
                  onClick={() => recognizeImage(imageSrc)}
                  disabled={isRecognizing}
                  className="btn-primary px-2.5 py-0.5 rounded font-semibold text-[11px] cursor-pointer ml-2"
                >
                  重新识别
                </button>
              </div>
            )}
          </div>

          {/* 预览画布 */}
          <div className="flex-1 overflow-auto flex items-center justify-center p-4 bg-slate-950/40 relative">
            {imageSrc ? (
              <img
                src={imageSrc}
                alt="OCR Source"
                style={{
                  transform: `scale(${zoom / 100}) rotate(${rotation}deg)`,
                  transformOrigin: 'center center',
                  transition: 'transform 0.15s ease-out'
                }}
                className="max-h-full max-w-full object-contain rounded shadow-lg select-none"
              />
            ) : (
              <div className="flex flex-col items-center justify-center text-slate-500 space-y-3 text-center">
                <span className="text-5xl opacity-40">🖼️</span>
                <div className="text-sm font-semibold text-slate-300">拖拽图片至此处，或一键截图</div>
                <div className="text-xs text-slate-500 max-w-xs leading-relaxed">
                  支持屏幕划选截图直通、Ctrl+V 剪贴板粘贴图片，支持 PNG, JPG, WEBP, BMP 等常见格式
                </div>
                <div className="pt-2 flex items-center gap-3">
                  <button
                    onClick={handleScreenCapture}
                    className="btn-primary px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer"
                  >
                    📸 立即截图
                  </button>
                  <button
                    onClick={handlePasteClipboard}
                    className="bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer"
                  >
                    📋 从剪贴板载入
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 右侧：识别文本结果与排版工具 */}
        <div className="w-[480px] flex-shrink-0 flex flex-col border border-slate-800 rounded-2xl overflow-hidden bg-slate-900/60 theme-bg-card">
          {/* 工具栏 */}
          <div className="px-3.5 py-2 border-b border-slate-800 bg-slate-950/80 flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-slate-300">识别文本</span>
              <span className="text-[10px] text-slate-500 font-mono">
                {recognizedText.length} 字 • {recognizedText.split(/\r?\n/).filter(Boolean).length} 行
              </span>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                onClick={() => copyText(recognizedText, 'all')}
                disabled={!recognizedText}
                className="btn-primary px-2.5 py-1 rounded text-xs font-semibold cursor-pointer disabled:opacity-40"
              >
                {copiedKey === 'all' ? '✓ 已复制' : '📋 复制全部'}
              </button>
              <button
                onClick={copySingleLine}
                disabled={!recognizedText}
                className="bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 px-2.5 py-1 rounded text-xs font-medium cursor-pointer transition disabled:opacity-40"
              >
                {copiedKey === 'single' ? '✓ 已复制单行' : '单行复制'}
              </button>
              <button
                onClick={saveToFile}
                disabled={!recognizedText}
                className="bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 px-2.5 py-1 rounded text-xs font-medium cursor-pointer transition disabled:opacity-40"
              >
                💾 导出
              </button>
            </div>
          </div>

          {/* 智能排版快捷动作 */}
          <div className="px-3 py-1.5 bg-slate-900 border-b border-slate-800/80 flex items-center gap-2 text-[11px] text-slate-400">
            <span>智能排版:</span>
            <button
              onClick={cleanRemoveLineBreaks}
              disabled={!recognizedText}
              className="hover:text-indigo-300 bg-slate-800/70 hover:bg-slate-800 px-2 py-0.5 rounded cursor-pointer transition disabled:opacity-40"
            >
              去换行 / 合并段落
            </button>
            <button
              onClick={cleanRemoveSpaces}
              disabled={!recognizedText}
              className="hover:text-indigo-300 bg-slate-800/70 hover:bg-slate-800 px-2 py-0.5 rounded cursor-pointer transition disabled:opacity-40"
            >
              清除中文字间空格
            </button>
            <button
              onClick={() => setRecognizedText('')}
              className="ml-auto hover:text-rose-400 cursor-pointer"
            >
              清空
            </button>
          </div>

          {/* 文本编辑器 */}
          <textarea
            value={recognizedText}
            onChange={(e) => setRecognizedText(e.target.value)}
            placeholder="识别完成后的文本将显示在此处，您也可以直接进行二次编辑与排版修改..."
            className="flex-1 w-full bg-transparent p-4 text-xs font-mono text-slate-100 outline-none resize-none leading-relaxed placeholder-slate-600 selection:bg-indigo-500/30"
            spellCheck={false}
          />
        </div>
      </div>

      {/* 历史记录侧拉抽屉 */}
      {showHistory && (
        <div className="fixed inset-y-0 right-0 w-80 bg-slate-900 border-l border-slate-800 shadow-2xl z-50 flex flex-col">
          <div className="p-4 border-b border-slate-800 flex items-center justify-between text-xs font-bold text-slate-200">
            <span>📜 近期识别历史 ({history.length})</span>
            <button onClick={() => setShowHistory(false)} className="text-slate-400 hover:text-slate-200">
              ✕
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
            {history.length > 0 ? (
              history.map((item) => (
                <div
                  key={item.id}
                  onClick={() => {
                    setImageSrc(item.previewUrl);
                    setRecognizedText(item.text);
                    setShowHistory(false);
                  }}
                  className="border border-slate-800 hover:border-indigo-500/80 rounded-xl p-2.5 bg-slate-950/70 cursor-pointer transition space-y-1.5"
                >
                  <div className="flex items-center justify-between text-[10px] text-slate-400">
                    <span>{new Date(item.timestamp).toLocaleTimeString()}</span>
                    <span>{item.charCount} 字</span>
                  </div>
                  <div className="text-xs text-slate-300 font-mono line-clamp-2 leading-relaxed">
                    {item.text}
                  </div>
                </div>
              ))
            ) : (
              <div className="text-center text-xs text-slate-500 py-12">暂无历史记录</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
