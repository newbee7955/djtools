import React, { useState, useEffect, useRef } from 'react';
import QRCode from 'qrcode';

export const QrCodeTools: React.FC = () => {
  const [text, setText] = useState('https://doujiao.app');
  const [errorCorrectionLevel, setErrorCorrectionLevel] = useState<'L' | 'M' | 'Q' | 'H'>('M');
  const [qrSize, setQrSize] = useState(240);
  const [darkColor, setDarkColor] = useState('#000000');
  const [lightColor, setLightColor] = useState('#ffffff');
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [copied, setCopied] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    generateQr();
  }, [text, errorCorrectionLevel, qrSize, darkColor, lightColor]);

  const generateQr = async () => {
    if (!text.trim()) {
      setQrDataUrl('');
      return;
    }
    try {
      const url = await QRCode.toDataURL(text, {
        errorCorrectionLevel,
        width: qrSize,
        margin: 2,
        color: {
          dark: darkColor,
          light: lightColor
        }
      });
      setQrDataUrl(url);

      if (canvasRef.current) {
        await QRCode.toCanvas(canvasRef.current, text, {
          errorCorrectionLevel,
          width: qrSize,
          margin: 2,
          color: {
            dark: darkColor,
            light: lightColor
          }
        });
      }
    } catch (err) {
      console.error('QR generation error:', err);
    }
  };

  const copyImage = async () => {
    if (!qrDataUrl) return;
    try {
      if ((window as any).doujiaoSDK?.clipboard?.writeImage) {
        await (window as any).doujiaoSDK.clipboard.writeImage(qrDataUrl);
      } else {
        const res = await fetch(qrDataUrl);
        const blob = await res.blob();
        await navigator.clipboard.write([
          new ClipboardItem({ [blob.type]: blob })
        ]);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.error('Failed to copy QR image:', err);
    }
  };

  const downloadImage = () => {
    if (!qrDataUrl) return;
    const a = document.createElement('a');
    a.href = qrDataUrl;
    a.download = `qrcode_${Date.now()}.png`;
    a.click();
  };

  return (
    <div className="h-full flex flex-col p-6 space-y-4 overflow-y-auto">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
            <span>📱</span> 二维码生成器 (QR Code)
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            将文本或网址快速生成高质量二维码图片，支持纠错等级配置与一键复制/下载
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 flex-1">
        {/* 左侧配置栏 */}
        <div className="space-y-4 flex flex-col">
          <div className="flex flex-col border border-slate-800 rounded-xl overflow-hidden bg-slate-900/60 flex-1">
            <div className="bg-slate-950/80 px-3 py-2 border-b border-slate-800 text-xs text-slate-400 flex justify-between">
              <span>二维码文本 / URL 链接</span>
              <button
                onClick={async () => setText(await navigator.clipboard.readText())}
                className="text-xs text-indigo-400 hover:text-indigo-300"
              >
                📋 粘贴
              </button>
            </div>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="请输入需要生成二维码的网址或文字..."
              className="flex-1 w-full bg-transparent p-3 text-xs font-mono text-slate-200 outline-none resize-none leading-relaxed min-h-[120px]"
            />
          </div>

          <div className="border border-slate-800 rounded-xl p-4 bg-slate-900/60 space-y-3">
            <div className="text-xs font-semibold text-slate-300">个性化样式配置</div>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <label className="text-slate-400 block mb-1">纠错等级:</label>
                <select
                  value={errorCorrectionLevel}
                  onChange={(e) => setErrorCorrectionLevel(e.target.value as any)}
                  className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-slate-200"
                >
                  <option value="L">L (7% 容错)</option>
                  <option value="M">M (15% 容错 - 推荐)</option>
                  <option value="Q">Q (25% 容错)</option>
                  <option value="H">H (30% 极高容错)</option>
                </select>
              </div>

              <div>
                <label className="text-slate-400 block mb-1">尺寸 ({qrSize}px):</label>
                <input
                  type="range"
                  min={160}
                  max={360}
                  step={20}
                  value={qrSize}
                  onChange={(e) => setQrSize(Number(e.target.value))}
                  className="w-full accent-indigo-500 mt-2"
                />
              </div>

              <div>
                <label className="text-slate-400 block mb-1">前景色:</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={darkColor}
                    onChange={(e) => setDarkColor(e.target.value)}
                    className="w-8 h-8 rounded border border-slate-700 bg-transparent cursor-pointer"
                  />
                  <span className="font-mono text-xs text-slate-300">{darkColor}</span>
                </div>
              </div>

              <div>
                <label className="text-slate-400 block mb-1">背景色:</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={lightColor}
                    onChange={(e) => setLightColor(e.target.value)}
                    className="w-8 h-8 rounded border border-slate-700 bg-transparent cursor-pointer"
                  />
                  <span className="font-mono text-xs text-slate-300">{lightColor}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 右侧预览与操作 */}
        <div className="flex flex-col items-center justify-center border border-slate-800 rounded-xl p-6 bg-slate-900/60 space-y-4">
          <div className="p-3 bg-white rounded-2xl shadow-xl border border-slate-200">
            <canvas ref={canvasRef} className="rounded-lg" />
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={copyImage}
              className="btn-primary px-4 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
            >
              <span>📋</span> {copied ? '✓ 已复制到剪贴板' : '复制二维码图片'}
            </button>
            <button
              onClick={downloadImage}
              className="bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 px-4 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition"
            >
              <span>💾</span> 下载 PNG
            </button>
          </div>
          <div className="text-[11px] text-slate-500">
            支持手机微信、支付宝、相机或任何扫码工具直接扫描
          </div>
        </div>
      </div>
    </div>
  );
};
