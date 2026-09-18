import React, { useState, useMemo } from 'react';

const CHEAT_SHEETS = [
  { name: '电子邮箱 (Email)', pattern: '[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\\.[a-zA-Z0-9-.]+' },
  { name: '中国手机号 (Phone)', pattern: '1[3-9]\\d{9}' },
  { name: 'IPv4 地址', pattern: '(?:25[0-5]|2[0-4]\\d|[01]?\\d\\d?)(?:\\.(?:25[0-5]|2[0-4]\\d|[01]?\\d\\d?)){3}' },
  { name: 'URL 网址', pattern: 'https?:\\/\\/[\\w\\-\\.]+(?::\\d+)?(?:\\/[\\w\\/\\.\\#\\?\\=\\&\\%]*)?' },
  { name: '中文字符 (Chinese)', pattern: '[\\u4e00-\\u9fa5]+' },
  { name: '日期 (YYYY-MM-DD)', pattern: '\\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\\d|3[01])' },
  { name: '18位身份证号', pattern: '[1-9]\\d{5}(?:18|19|20)\\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\\d|3[01])\\d{3}[\\dXx]' }
];

export const RegexTools: React.FC = () => {
  const [pattern, setPattern] = useState('[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\\.[a-zA-Z0-9-.]+');
  const [flags, setFlags] = useState({ g: true, i: true, m: false, s: false });
  const [testText, setTestText] = useState(
    '欢迎使用豆角工具箱！如有问题请联系 support@doujiao.app 或 admin@example.com，官方团队将全天候响应。'
  );

  const flagStr = useMemo(() => {
    let res = '';
    if (flags.g) res += 'g';
    if (flags.i) res += 'i';
    if (flags.m) res += 'm';
    if (flags.s) res += 's';
    return res;
  }, [flags]);

  const { matches, error, highlightedHtml } = useMemo(() => {
    if (!pattern) return { matches: [], error: null, highlightedHtml: testText };

    try {
      const regex = new RegExp(pattern, flagStr);
      const allMatches: Array<{ match: string; index: number; groups: string[] }> = [];

      if (flags.g) {
        let m: RegExpExecArray | null;
        let lastIndex = -1;
        while ((m = regex.exec(testText)) !== null) {
          if (m.index === lastIndex) break;
          lastIndex = m.index;
          allMatches.push({
            match: m[0],
            index: m.index,
            groups: m.slice(1)
          });
        }
      } else {
        const m = regex.exec(testText);
        if (m) {
          allMatches.push({
            match: m[0],
            index: m.index,
            groups: m.slice(1)
          });
        }
      }

      // Generate HTML highlight
      let html = '';
      let cursor = 0;
      allMatches.forEach((item) => {
        html += escapeHtml(testText.slice(cursor, item.index));
        html += `<mark class="bg-amber-400 text-slate-950 font-bold px-0.5 rounded">${escapeHtml(item.match)}</mark>`;
        cursor = item.index + item.match.length;
      });
      html += escapeHtml(testText.slice(cursor));

      return { matches: allMatches, error: null, highlightedHtml: html };
    } catch (err: any) {
      return { matches: [], error: err?.message || '正则表达式错误', highlightedHtml: escapeHtml(testText) };
    }
  }, [pattern, flagStr, testText]);

  function escapeHtml(text: string) {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  return (
    <div className="h-full flex flex-col p-6 space-y-4 overflow-y-auto">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
            <span>🎯</span> 正则表达式测试器
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            实时正则语法匹配、高亮着色、分组捕获与常用正则表达式速查
          </p>
        </div>
      </div>

      {/* 正则表达式输入栏 */}
      <div className="border border-slate-800 rounded-xl p-4 bg-slate-900/60 space-y-3">
        <div className="flex items-center gap-3">
          <span className="text-slate-500 font-mono text-lg font-bold">/</span>
          <input
            type="text"
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            placeholder="输入正则表达式..."
            className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs font-mono text-emerald-400 outline-none"
          />
          <span className="text-slate-500 font-mono text-lg font-bold">/</span>
          <div className="flex items-center gap-2 text-xs">
            {(['g', 'i', 'm', 's'] as const).map((flag) => (
              <label key={flag} className="flex items-center gap-1 text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={flags[flag]}
                  onChange={(e) => setFlags({ ...flags, [flag]: e.target.checked })}
                  className="accent-indigo-500"
                />
                <span className="font-mono">{flag}</span>
              </label>
            ))}
          </div>
        </div>

        {error && (
          <div className="text-xs text-rose-400">⚠️ 正则表达式语法错误: {error}</div>
        )}

        {/* 常用模板速查 */}
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          <span className="text-[11px] text-slate-400 mr-1">速查模板:</span>
          {CHEAT_SHEETS.map((cs) => (
            <button
              key={cs.name}
              onClick={() => setPattern(cs.pattern)}
              className="bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] px-2 py-0.5 rounded cursor-pointer transition border border-slate-700/60"
            >
              {cs.name}
            </button>
          ))}
        </div>
      </div>

      {/* 测试文本与实时匹配高亮 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 flex-1 min-h-[320px]">
        <div className="flex flex-col border border-slate-800 rounded-xl overflow-hidden bg-slate-900/60">
          <div className="bg-slate-950/80 px-3 py-2 border-b border-slate-800 text-xs text-slate-400 flex justify-between">
            <span>待测试文本</span>
            <button
              onClick={async () => setTestText(await navigator.clipboard.readText())}
              className="text-xs text-indigo-400 hover:text-indigo-300"
            >
              📋 粘贴文本
            </button>
          </div>
          <textarea
            value={testText}
            onChange={(e) => setTestText(e.target.value)}
            className="flex-1 w-full bg-transparent p-3 text-xs font-mono text-slate-200 outline-none resize-none leading-relaxed"
          />
        </div>

        <div className="flex flex-col border border-slate-800 rounded-xl overflow-hidden bg-slate-900/60">
          <div className="bg-slate-950/80 px-3 py-2 border-b border-slate-800 text-xs text-slate-400 flex justify-between">
            <span>匹配高亮预览</span>
            <span className="text-emerald-400 font-semibold">
              找到 {matches.length} 处匹配
            </span>
          </div>
          <div
            className="flex-1 p-3 text-xs font-mono text-slate-200 overflow-y-auto leading-relaxed whitespace-pre-wrap select-text"
            dangerouslySetInnerHTML={{ __html: highlightedHtml }}
          />
        </div>
      </div>
    </div>
  );
};
