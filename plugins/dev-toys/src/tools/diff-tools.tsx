import React, { useState, useMemo } from 'react';
import * as Diff from 'diff';

export const DiffTools: React.FC = () => {
  const [oldText, setOldText] = useState(`function calculateTotal(price, count) {
  let subtotal = price * count;
  return subtotal;
}`);

  const [newText, setNewText] = useState(`function calculateTotal(price, count, discount = 0) {
  let subtotal = price * count;
  if (discount > 0) {
    subtotal = subtotal * (1 - discount);
  }
  return Math.round(subtotal * 100) / 100;
}`);

  const [diffMode, setDiffMode] = useState<'lines' | 'words' | 'chars'>('lines');

  const diffResult = useMemo(() => {
    if (diffMode === 'lines') {
      return Diff.diffLines(oldText, newText);
    } else if (diffMode === 'words') {
      return Diff.diffWords(oldText, newText);
    } else {
      return Diff.diffChars(oldText, newText);
    }
  }, [oldText, newText, diffMode]);

  const stats = useMemo(() => {
    let added = 0;
    let removed = 0;
    diffResult.forEach((part) => {
      if (part.added) added += part.count || 1;
      if (part.removed) removed += part.count || 1;
    });
    return { added, removed };
  }, [diffResult]);

  return (
    <div className="h-full flex flex-col p-6 space-y-4 overflow-y-auto">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
            <span>⚖️</span> 文本差异比对 (Text Diff)
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            快速比对两段代码或文本的增删改差异，支持行级、词级与字符级高亮
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-400">比对粒度:</label>
          <select
            value={diffMode}
            onChange={(e) => setDiffMode(e.target.value as any)}
            className="bg-slate-800 border border-slate-700 text-xs text-slate-200 rounded px-2.5 py-1 outline-none"
          >
            <option value="lines">按行比对 (Lines)</option>
            <option value="words">按词比对 (Words)</option>
            <option value="chars">按字符比对 (Chars)</option>
          </select>
        </div>
      </div>

      {/* 原文本与修改后文本输入区 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 h-48 flex-shrink-0">
        <div className="flex flex-col border border-slate-800 rounded-xl overflow-hidden bg-slate-900/60">
          <div className="bg-slate-950/80 px-3 py-1.5 border-b border-slate-800 text-xs text-rose-400 font-semibold flex justify-between">
            <span>原始文本 (Original)</span>
            <button
              onClick={async () => setOldText(await navigator.clipboard.readText())}
              className="text-slate-400 hover:text-slate-200 text-xs cursor-pointer"
            >
              📋 粘贴
            </button>
          </div>
          <textarea
            value={oldText}
            onChange={(e) => setOldText(e.target.value)}
            className="flex-1 w-full bg-transparent p-2.5 text-xs font-mono text-slate-200 outline-none resize-none leading-relaxed"
          />
        </div>

        <div className="flex flex-col border border-slate-800 rounded-xl overflow-hidden bg-slate-900/60">
          <div className="bg-slate-950/80 px-3 py-1.5 border-b border-slate-800 text-xs text-emerald-400 font-semibold flex justify-between">
            <span>修改后文本 (Modified)</span>
            <button
              onClick={async () => setNewText(await navigator.clipboard.readText())}
              className="text-slate-400 hover:text-slate-200 text-xs cursor-pointer"
            >
              📋 粘贴
            </button>
          </div>
          <textarea
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
            className="flex-1 w-full bg-transparent p-2.5 text-xs font-mono text-slate-200 outline-none resize-none leading-relaxed"
          />
        </div>
      </div>

      {/* 差异统计与可视化渲染区 */}
      <div className="flex-1 flex flex-col border border-slate-800 rounded-xl overflow-hidden bg-slate-950/90 min-h-[220px]">
        <div className="bg-slate-900 px-3 py-2 border-b border-slate-800 flex items-center justify-between text-xs">
          <span className="font-semibold text-slate-300">比对差异可视化</span>
          <div className="flex items-center gap-3 font-mono">
            <span className="text-emerald-400 font-bold">+{stats.added} 新增</span>
            <span className="text-rose-400 font-bold">-{stats.removed} 删除</span>
          </div>
        </div>

        <div className="flex-1 p-3 overflow-y-auto font-mono text-xs leading-relaxed space-y-0.5 select-text">
          {diffResult.map((part, index) => {
            if (part.added) {
              return (
                <span
                  key={index}
                  className="bg-emerald-950/80 text-emerald-300 border-l-2 border-emerald-500 px-1 py-0.5 rounded-sm inline-block w-full whitespace-pre-wrap"
                >
                  + {part.value}
                </span>
              );
            }
            if (part.removed) {
              return (
                <span
                  key={index}
                  className="bg-rose-950/80 text-rose-300 border-l-2 border-rose-500 px-1 py-0.5 rounded-sm inline-block w-full line-through opacity-80 whitespace-pre-wrap"
                >
                  - {part.value}
                </span>
              );
            }
            return (
              <span key={index} className="text-slate-400 px-1 py-0.5 inline-block w-full whitespace-pre-wrap">
                &nbsp; {part.value}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
};
