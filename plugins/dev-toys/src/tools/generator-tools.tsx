import React, { useState } from 'react';

export const GeneratorTools: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'uuid' | 'password' | 'color'>('uuid');

  // UUID State
  const [uuidCount, setUuidCount] = useState(5);
  const [uuidUppercase, setUuidUppercase] = useState(false);
  const [uuidHyphens, setUuidHyphens] = useState(true);
  const [uuids, setUuids] = useState<string[]>([]);

  // Password State
  const [pwdLength, setPwdLength] = useState(16);
  const [includeUpper, setIncludeUpper] = useState(true);
  const [includeLower, setIncludeLower] = useState(true);
  const [includeDigits, setIncludeDigits] = useState(true);
  const [includeSymbols, setIncludeSymbols] = useState(true);
  const [excludeAmbiguous, setExcludeAmbiguous] = useState(true);
  const [generatedPasswords, setGeneratedPasswords] = useState<string[]>([]);

  // Color State
  const [hexColor, setHexColor] = useState('#6366f1');
  const [rgbColor, setRgbColor] = useState('rgb(99, 102, 241)');
  const [hslColor, setHslColor] = useState('hsl(239, 84%, 67%)');

  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Generate UUID v4
  const generateUuids = () => {
    const list: string[] = [];
    for (let i = 0; i < uuidCount; i++) {
      let id = crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
      });

      if (!uuidHyphens) id = id.replace(/-/g, '');
      if (uuidUppercase) id = id.toUpperCase();
      list.push(id);
    }
    setUuids(list);
  };

  // Generate Passwords
  const generatePasswords = () => {
    let chars = '';
    if (includeUpper) chars += excludeAmbiguous ? 'ABCDEFGHJKLMNPQRSTUVWXYZ' : 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    if (includeLower) chars += excludeAmbiguous ? 'abcdefghijkmnopqrstuvwxyz' : 'abcdefghijklmnopqrstuvwxyz';
    if (includeDigits) chars += excludeAmbiguous ? '23456789' : '0123456789';
    if (includeSymbols) chars += '!@#$%^&*()_+-=[]{}|;:,.<>?';

    if (!chars) chars = 'abcdefghijklmnopqrstuvwxyz';

    const pwds: string[] = [];
    for (let p = 0; p < 5; p++) {
      let pwd = '';
      const array = new Uint32Array(pwdLength);
      crypto.getRandomValues(array);
      for (let i = 0; i < pwdLength; i++) {
        pwd += chars[array[i] % chars.length];
      }
      pwds.push(pwd);
    }
    setGeneratedPasswords(pwds);
  };

  // Color conversion
  const handleHexChange = (hex: string) => {
    setHexColor(hex);
    if (/^#?[0-9A-Fa-f]{6}$/.test(hex)) {
      const cleanHex = hex.replace('#', '');
      const r = parseInt(cleanHex.slice(0, 2), 16);
      const g = parseInt(cleanHex.slice(2, 4), 16);
      const b = parseInt(cleanHex.slice(4, 6), 16);
      setRgbColor(`rgb(${r}, ${g}, ${b})`);

      const rNorm = r / 255, gNorm = g / 255, bNorm = b / 255;
      const max = Math.max(rNorm, gNorm, bNorm), min = Math.min(rNorm, gNorm, bNorm);
      let h = 0, s = 0, l = (max + min) / 2;

      if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
          case rNorm: h = (gNorm - bNorm) / d + (gNorm < bNorm ? 6 : 0); break;
          case gNorm: h = (bNorm - rNorm) / d + 2; break;
          case bNorm: h = (rNorm - gNorm) / d + 4; break;
        }
        h /= 6;
      }
      setHslColor(`hsl(${Math.round(h * 360)}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%)`);
    }
  };

  const copyText = async (text: string, key: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1500);
  };

  return (
    <div className="h-full flex flex-col p-6 space-y-4 overflow-y-auto">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
            <span>🎲</span> 常用生成器
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            批量 UUID / GUID 生成、安全随机密码与色彩格式换算
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-800 space-x-1">
        {(['uuid', 'password', 'color'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-xs font-semibold rounded-t-lg transition cursor-pointer ${
              activeTab === tab
                ? 'bg-slate-800 text-indigo-400 border-b-2 border-indigo-500'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {tab === 'uuid' && 'UUID / GUID 生成器'}
            {tab === 'password' && '随机密码生成器'}
            {tab === 'color' && '色彩格式换算 (Color)'}
          </button>
        ))}
      </div>

      {activeTab === 'uuid' && (
        <div className="space-y-4 flex-1">
          <div className="border border-slate-800 rounded-xl p-4 bg-slate-900/60 flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2 text-xs">
              <label className="text-slate-400">数量:</label>
              <input
                type="number"
                min={1}
                max={50}
                value={uuidCount}
                onChange={(e) => setUuidCount(Math.min(50, Math.max(1, Number(e.target.value))))}
                className="w-16 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-slate-200"
              />
            </div>
            <label className="flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={uuidUppercase}
                onChange={(e) => setUuidUppercase(e.target.checked)}
                className="accent-indigo-500"
              />
              <span>大写 (UPPERCASE)</span>
            </label>
            <label className="flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={uuidHyphens}
                onChange={(e) => setUuidHyphens(e.target.checked)}
                className="accent-indigo-500"
              />
              <span>带连字符 (-)</span>
            </label>
            <button
              onClick={generateUuids}
              className="btn-primary px-3 py-1.5 rounded text-xs font-medium cursor-pointer ml-auto"
            >
              🎲 立即生成
            </button>
          </div>

          <div className="border border-slate-800 rounded-xl p-4 bg-slate-900/60 space-y-2">
            <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
              <span>生成结果 ({uuids.length})</span>
              {uuids.length > 0 && (
                <button
                  onClick={() => copyText(uuids.join('\n'), 'all_uuids')}
                  className="text-indigo-400 hover:text-indigo-300 cursor-pointer"
                >
                  {copiedKey === 'all_uuids' ? '✓ 已复制全部' : '📋 复制全部'}
                </button>
              )}
            </div>
            <div className="space-y-1.5 max-h-[360px] overflow-y-auto">
              {uuids.length > 0 ? (
                uuids.map((id, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between bg-slate-950/70 p-2 rounded-lg border border-slate-800/80 font-mono text-xs text-emerald-400"
                  >
                    <span>{id}</span>
                    <button
                      onClick={() => copyText(id, id)}
                      className="text-slate-400 hover:text-slate-200 text-xs cursor-pointer ml-2"
                    >
                      {copiedKey === id ? '✓' : '📋'}
                    </button>
                  </div>
                ))
              ) : (
                <div className="text-xs text-slate-500 py-6 text-center">点击上方「立即生成」按钮批量生成 UUID</div>
              )}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'password' && (
        <div className="space-y-4 flex-1">
          <div className="border border-slate-800 rounded-xl p-4 bg-slate-900/60 space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs text-slate-300 font-semibold">
                密码长度: <span className="font-mono text-indigo-400 font-bold">{pwdLength} 位</span>
              </label>
              <button
                onClick={generatePasswords}
                className="btn-primary px-3 py-1.5 rounded text-xs font-medium cursor-pointer"
              >
                ⚡ 批量生成5组
              </button>
            </div>
            <input
              type="range"
              min={6}
              max={48}
              value={pwdLength}
              onChange={(e) => setPwdLength(Number(e.target.value))}
              className="w-full accent-indigo-500"
            />
            <div className="flex flex-wrap items-center gap-4 text-xs pt-1">
              <label className="flex items-center gap-1 text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeUpper}
                  onChange={(e) => setIncludeUpper(e.target.checked)}
                  className="accent-indigo-500"
                />
                大写字母 (A-Z)
              </label>
              <label className="flex items-center gap-1 text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeLower}
                  onChange={(e) => setIncludeLower(e.target.checked)}
                  className="accent-indigo-500"
                />
                小写字母 (a-z)
              </label>
              <label className="flex items-center gap-1 text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeDigits}
                  onChange={(e) => setIncludeDigits(e.target.checked)}
                  className="accent-indigo-500"
                />
                数字 (0-9)
              </label>
              <label className="flex items-center gap-1 text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeSymbols}
                  onChange={(e) => setIncludeSymbols(e.target.checked)}
                  className="accent-indigo-500"
                />
                特殊符号 (!@#$%)
              </label>
              <label className="flex items-center gap-1 text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={excludeAmbiguous}
                  onChange={(e) => setExcludeAmbiguous(e.target.checked)}
                  className="accent-indigo-500"
                />
                排除易混淆字符 (1, l, I, 0, O)
              </label>
            </div>
          </div>

          <div className="border border-slate-800 rounded-xl p-4 bg-slate-900/60 space-y-2">
            <div className="text-xs text-slate-400 mb-2">生成的高强度随机密码建议</div>
            <div className="space-y-2">
              {generatedPasswords.length > 0 ? (
                generatedPasswords.map((pwd, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between bg-slate-950/80 p-2.5 rounded-lg border border-slate-800 font-mono text-xs text-cyan-300"
                  >
                    <span className="break-all">{pwd}</span>
                    <button
                      onClick={() => copyText(pwd, pwd)}
                      className="text-xs text-indigo-400 hover:text-indigo-300 cursor-pointer ml-3 flex-shrink-0"
                    >
                      {copiedKey === pwd ? '✓ 已复制' : '📋 复制'}
                    </button>
                  </div>
                ))
              ) : (
                <div className="text-xs text-slate-500 py-6 text-center">点击上方「批量生成5组」获取密码</div>
              )}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'color' && (
        <div className="space-y-4 flex-1">
          <div className="border border-slate-800 rounded-xl p-4 bg-slate-900/60 flex items-center gap-6">
            <input
              type="color"
              value={hexColor.startsWith('#') ? hexColor : `#${hexColor}`}
              onChange={(e) => handleHexChange(e.target.value)}
              className="w-16 h-16 rounded-xl border border-slate-700 bg-transparent cursor-pointer"
            />
            <div className="space-y-1">
              <div className="text-sm font-bold text-slate-200">选取或输入颜色</div>
              <div className="text-xs text-slate-400">实时在 HEX, RGB, HSL 之间无缝换算并一键复制</div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="border border-slate-800 rounded-xl p-3 bg-slate-900/60 space-y-2">
              <div className="text-xs text-slate-400 font-semibold">HEX 颜色代码</div>
              <input
                type="text"
                value={hexColor}
                onChange={(e) => handleHexChange(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-xs font-mono text-emerald-400 outline-none"
              />
              <button
                onClick={() => copyText(hexColor, 'hex')}
                className="w-full text-center text-xs text-indigo-400 hover:text-indigo-300 pt-1 cursor-pointer"
              >
                {copiedKey === 'hex' ? '✓ 已复制' : '📋 复制 HEX'}
              </button>
            </div>

            <div className="border border-slate-800 rounded-xl p-3 bg-slate-900/60 space-y-2">
              <div className="text-xs text-slate-400 font-semibold">RGB 色彩格式</div>
              <div className="bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-xs font-mono text-cyan-400">
                {rgbColor}
              </div>
              <button
                onClick={() => copyText(rgbColor, 'rgb')}
                className="w-full text-center text-xs text-indigo-400 hover:text-indigo-300 pt-1 cursor-pointer"
              >
                {copiedKey === 'rgb' ? '✓ 已复制' : '📋 复制 RGB'}
              </button>
            </div>

            <div className="border border-slate-800 rounded-xl p-3 bg-slate-900/60 space-y-2">
              <div className="text-xs text-slate-400 font-semibold">HSL 色彩格式</div>
              <div className="bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-xs font-mono text-amber-400">
                {hslColor}
              </div>
              <button
                onClick={() => copyText(hslColor, 'hsl')}
                className="w-full text-center text-xs text-indigo-400 hover:text-indigo-300 pt-1 cursor-pointer"
              >
                {copiedKey === 'hsl' ? '✓ 已复制' : '📋 复制 HSL'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
