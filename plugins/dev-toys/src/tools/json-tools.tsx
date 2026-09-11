import React, { useState } from 'react';
import * as yaml from 'js-yaml';

export const JsonTools: React.FC = () => {
  const [input, setInput] = useState('{\n  "name": "豆角工具箱",\n  "version": "2.0.0",\n  "features": ["DevToys", "OCR", "MediaConverter"],\n  "offline": true\n}');
  const [output, setOutput] = useState('');
  const [indent, setIndent] = useState<2 | 4 | 'tab'>(2);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const formatJson = () => {
    try {
      setError(null);
      const parsed = JSON.parse(input);
      const space = indent === 'tab' ? '\t' : indent;
      setOutput(JSON.stringify(parsed, null, space));
    } catch (err: any) {
      setError(err?.message || '无效的 JSON 格式');
    }
  };

  const minifyJson = () => {
    try {
      setError(null);
      const parsed = JSON.parse(input);
      setOutput(JSON.stringify(parsed));
    } catch (err: any) {
      setError(err?.message || '无效的 JSON 格式');
    }
  };

  const jsonToYaml = () => {
    try {
      setError(null);
      const parsed = JSON.parse(input);
      setOutput(yaml.dump(parsed, { indent: 2 }));
    } catch (err: any) {
      setError(err?.message || 'JSON 解析失败，无法转为 YAML');
    }
  };

  const yamlToJson = () => {
    try {
      setError(null);
      const parsed = yaml.load(input);
      const space = indent === 'tab' ? '\t' : indent;
      setOutput(JSON.stringify(parsed, null, space));
    } catch (err: any) {
      setError(err?.message || 'YAML 解析失败，无法转为 JSON');
    }
  };

  const copyOutput = async () => {
    if (!output) return;
    await navigator.clipboard.writeText(output);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const pasteInput = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setInput(text);
    } catch {}
  };

  return (
    <div className="h-full flex flex-col p-6 space-y-4 overflow-y-auto">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
            <span>📦</span> JSON / YAML 格式化与校验
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            支持 JSON 格式化、压缩、转 YAML、YAML 转 JSON 及语法错误定位
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-400">缩进:</label>
          <select
            value={indent}
            onChange={(e) => setIndent(e.target.value === 'tab' ? 'tab' : (Number(e.target.value) as 2 | 4))}
            className="bg-slate-800 border border-slate-700 text-xs text-slate-200 rounded px-2 py-1 outline-none"
          >
            <option value={2}>2 空格</option>
            <option value={4}>4 空格</option>
            <option value="tab">Tab 制表符</option>
          </select>
        </div>
      </div>

      {/* 控制栏 */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={formatJson}
          className="btn-primary px-3 py-1.5 rounded text-xs font-medium flex items-center gap-1.5 cursor-pointer shadow-sm transition-transform active:scale-95"
        >
          <span>✨</span> 格式化 (Format)
        </button>
        <button
          onClick={minifyJson}
          className="bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 px-3 py-1.5 rounded text-xs font-medium transition cursor-pointer"
        >
          <span>🗜️</span> 压缩 (Minify)
        </button>
        <button
          onClick={jsonToYaml}
          className="bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 px-3 py-1.5 rounded text-xs font-medium transition cursor-pointer"
        >
          <span>🔄</span> JSON ➔ YAML
        </button>
        <button
          onClick={yamlToJson}
          className="bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 px-3 py-1.5 rounded text-xs font-medium transition cursor-pointer"
        >
          <span>🔁</span> YAML ➔ JSON
        </button>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={pasteInput}
            className="bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 px-2.5 py-1.5 rounded text-xs transition cursor-pointer"
          >
            📋 粘贴输入
          </button>
          <button
            onClick={() => { setInput(''); setOutput(''); setError(null); }}
            className="text-slate-400 hover:text-rose-400 text-xs px-2 py-1 transition cursor-pointer"
          >
            清空
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-rose-950/40 border border-rose-800/80 text-rose-300 text-xs px-3 py-2 rounded-lg flex items-center gap-2">
          <span>⚠️</span>
          <span>{error}</span>
        </div>
      )}

      {/* 编辑区 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 flex-1 min-h-[360px]">
        <div className="flex flex-col border border-slate-800 rounded-xl overflow-hidden bg-slate-900/60">
          <div className="bg-slate-950/80 px-3 py-2 border-b border-slate-800 text-xs font-semibold text-slate-400 flex items-center justify-between">
            <span>输入内容 (JSON / YAML)</span>
            <span className="text-[10px] text-slate-500">{input.length} 字符</span>
          </div>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="请在此粘贴或输入 JSON 或 YAML 文本..."
            className="flex-1 w-full bg-transparent p-3 text-xs font-mono text-slate-200 outline-none resize-none leading-relaxed placeholder-slate-600 selection:bg-indigo-500/30"
            spellCheck={false}
          />
        </div>

        <div className="flex flex-col border border-slate-800 rounded-xl overflow-hidden bg-slate-900/60">
          <div className="bg-slate-950/80 px-3 py-2 border-b border-slate-800 text-xs font-semibold text-slate-400 flex items-center justify-between">
            <span>转换结果</span>
            {output && (
              <button
                onClick={copyOutput}
                className="text-xs text-indigo-400 hover:text-indigo-300 transition cursor-pointer flex items-center gap-1"
              >
                {copied ? '✓ 已复制' : '📋 复制结果'}
              </button>
            )}
          </div>
          <textarea
            value={output}
            readOnly
            placeholder="转换或格式化后的结果将显示在这里..."
            className="flex-1 w-full bg-transparent p-3 text-xs font-mono text-emerald-300 outline-none resize-none leading-relaxed placeholder-slate-600 selection:bg-indigo-500/30"
            spellCheck={false}
          />
        </div>
      </div>
    </div>
  );
};
