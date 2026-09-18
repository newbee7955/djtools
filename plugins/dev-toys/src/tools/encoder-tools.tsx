import React, { useState } from 'react';

export const EncoderTools: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'base64' | 'url' | 'html' | 'jwt'>('base64');

  // Base64 Text State
  const [b64Input, setB64Input] = useState('Hello 豆角工具箱！');
  const [b64Output, setB64Output] = useState('');
  const [b64Error, setB64Error] = useState<string | null>(null);

  // URL State
  const [urlInput, setUrlInput] = useState('https://doujiao.app/search?q=极客工具箱&theme=cyber');
  const [urlOutput, setUrlOutput] = useState('');

  // HTML State
  const [htmlInput, setHtmlInput] = useState('<div class="box">Hello & "World"</div>');
  const [htmlOutput, setHtmlOutput] = useState('');

  // JWT State
  const [jwtInput, setJwtInput] = useState('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkRvdWppYW8gRGV2ZWxvcGVyIiwiYWRtaW4iOnRydWUsImlhdCI6MTUxNjIzOTAyMiwiZXhwIjoyNTI0NjA4MDAwfQ.POsm7qWkPq6s55V_V-wQ_Q9_hT3iK5R0FwM3j6n-P5M');
  const [jwtHeader, setJwtHeader] = useState('');
  const [jwtPayload, setJwtPayload] = useState('');
  const [jwtSignature, setJwtSignature] = useState('');
  const [jwtExpInfo, setJwtExpInfo] = useState<string | null>(null);
  const [jwtError, setJwtError] = useState<string | null>(null);

  const [copied, setCopied] = useState(false);

  // Base64 UTF-8 safe encode
  const encodeBase64 = () => {
    try {
      setB64Error(null);
      const encoded = btoa(unescape(encodeURIComponent(b64Input)));
      setB64Output(encoded);
    } catch (e: any) {
      setB64Error(e?.message || 'Base64 编码失败');
    }
  };

  // Base64 UTF-8 safe decode
  const decodeBase64 = () => {
    try {
      setB64Error(null);
      const decoded = decodeURIComponent(escape(atob(b64Input.trim())));
      setB64Output(decoded);
    } catch (e: any) {
      setB64Error(e?.message || '非法的 Base64 格式');
    }
  };

  // URL Encode / Decode
  const encodeUrlComponent = () => {
    setUrlOutput(encodeURIComponent(urlInput));
  };
  const decodeUrlComponent = () => {
    try {
      setUrlOutput(decodeURIComponent(urlInput));
    } catch {
      setUrlOutput('解码错误：无效的 URL 编码');
    }
  };

  // HTML Entities
  const encodeHtml = () => {
    const escaped = htmlInput
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
    setHtmlOutput(escaped);
  };
  const decodeHtml = () => {
    const doc = new DOMParser().parseFromString(htmlInput, 'text/html');
    setHtmlOutput(doc.documentElement.textContent || '');
  };

  // JWT Decode
  const decodeJwt = () => {
    try {
      setJwtError(null);
      const parts = jwtInput.trim().split('.');
      if (parts.length !== 3) {
        throw new Error('无效的 JWT 格式（JWT 应包含以点分隔的3部分）');
      }

      const decodeBase64Url = (str: string) => {
        let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
        while (base64.length % 4) base64 += '=';
        return decodeURIComponent(escape(atob(base64)));
      };

      const headerObj = JSON.parse(decodeBase64Url(parts[0]));
      const payloadObj = JSON.parse(decodeBase64Url(parts[1]));

      setJwtHeader(JSON.stringify(headerObj, null, 2));
      setJwtPayload(JSON.stringify(payloadObj, null, 2));
      setJwtSignature(parts[2]);

      if (payloadObj.exp) {
        const expDate = new Date(payloadObj.exp * 1000);
        const now = new Date();
        const diffSec = Math.round((expDate.getTime() - now.getTime()) / 1000);
        if (diffSec > 0) {
          const days = Math.floor(diffSec / 86400);
          const hours = Math.floor((diffSec % 86400) / 3600);
          setJwtExpInfo(`有效：将于 ${expDate.toLocaleString()} 过期 (剩余约 ${days} 天 ${hours} 小时)`);
        } else {
          setJwtExpInfo(`已过期：过期时间为 ${expDate.toLocaleString()}`);
        }
      } else {
        setJwtExpInfo('该 Token 未声明 exp 过期时间戳 (永不过期或由外部维持)');
      }
    } catch (err: any) {
      setJwtError(err.message || 'JWT 解析失败');
      setJwtHeader('');
      setJwtPayload('');
      setJwtSignature('');
      setJwtExpInfo(null);
    }
  };

  const handleCopy = async (text: string) => {
    if (!text) return;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="h-full flex flex-col p-6 space-y-4 overflow-y-auto">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
            <span>🔠</span> 常用编解码器
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            包含 Base64 文本与图片、URL 编码/解码、HTML 实体与 JWT 结构解析
          </p>
        </div>
      </div>

      {/* 标签栏 */}
      <div className="flex border-b border-slate-800 space-x-1">
        {(['base64', 'url', 'html', 'jwt'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-xs font-semibold rounded-t-lg transition cursor-pointer ${
              activeTab === tab
                ? 'bg-slate-800 text-indigo-400 border-b-2 border-indigo-500'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
            }`}
          >
            {tab === 'base64' && 'Base64 编解码'}
            {tab === 'url' && 'URL 编码/解码'}
            {tab === 'html' && 'HTML 实体'}
            {tab === 'jwt' && 'JWT 令牌解析'}
          </button>
        ))}
      </div>

      {/* Base64 */}
      {activeTab === 'base64' && (
        <div className="flex-1 flex flex-col space-y-4">
          <div className="flex items-center gap-2">
            <button
              onClick={encodeBase64}
              className="btn-primary px-3 py-1.5 rounded text-xs font-medium cursor-pointer"
            >
              🔒 编码 (Encode)
            </button>
            <button
              onClick={decodeBase64}
              className="bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 px-3 py-1.5 rounded text-xs font-medium cursor-pointer"
            >
              🔓 解码 (Decode)
            </button>
            <button
              onClick={() => { const temp = b64Input; setB64Input(b64Output); setB64Output(temp); }}
              className="bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 px-2.5 py-1.5 rounded text-xs cursor-pointer ml-auto"
            >
              ⇅ 上下互换
            </button>
          </div>
          {b64Error && (
            <div className="bg-rose-950/40 border border-rose-800 text-rose-300 text-xs p-2 rounded">
              {b64Error}
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 flex-1 min-h-[320px]">
            <div className="flex flex-col border border-slate-800 rounded-xl overflow-hidden bg-slate-900/60">
              <div className="bg-slate-950/80 px-3 py-2 border-b border-slate-800 text-xs text-slate-400">输入文本</div>
              <textarea
                value={b64Input}
                onChange={(e) => setB64Input(e.target.value)}
                className="flex-1 w-full bg-transparent p-3 text-xs font-mono text-slate-200 outline-none resize-none"
              />
            </div>
            <div className="flex flex-col border border-slate-800 rounded-xl overflow-hidden bg-slate-900/60">
              <div className="bg-slate-950/80 px-3 py-2 border-b border-slate-800 text-xs text-slate-400 flex justify-between">
                <span>转换结果</span>
                {b64Output && (
                  <button onClick={() => handleCopy(b64Output)} className="text-indigo-400 hover:text-indigo-300 text-xs">
                    {copied ? '✓ 已复制' : '📋 复制'}
                  </button>
                )}
              </div>
              <textarea
                value={b64Output}
                readOnly
                className="flex-1 w-full bg-transparent p-3 text-xs font-mono text-emerald-300 outline-none resize-none"
              />
            </div>
          </div>
        </div>
      )}

      {/* URL */}
      {activeTab === 'url' && (
        <div className="flex-1 flex flex-col space-y-4">
          <div className="flex items-center gap-2">
            <button onClick={encodeUrlComponent} className="btn-primary px-3 py-1.5 rounded text-xs font-medium cursor-pointer">
              🔗 URL 编码 (Encode)
            </button>
            <button onClick={decodeUrlComponent} className="bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 px-3 py-1.5 rounded text-xs font-medium cursor-pointer">
              🔓 URL 解码 (Decode)
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 flex-1 min-h-[320px]">
            <div className="flex flex-col border border-slate-800 rounded-xl overflow-hidden bg-slate-900/60">
              <div className="bg-slate-950/80 px-3 py-2 border-b border-slate-800 text-xs text-slate-400">输入 URL 或字符串</div>
              <textarea
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                className="flex-1 w-full bg-transparent p-3 text-xs font-mono text-slate-200 outline-none resize-none"
              />
            </div>
            <div className="flex flex-col border border-slate-800 rounded-xl overflow-hidden bg-slate-900/60">
              <div className="bg-slate-950/80 px-3 py-2 border-b border-slate-800 text-xs text-slate-400 flex justify-between">
                <span>结果</span>
                {urlOutput && (
                  <button onClick={() => handleCopy(urlOutput)} className="text-indigo-400 hover:text-indigo-300 text-xs">
                    {copied ? '✓ 已复制' : '📋 复制'}
                  </button>
                )}
              </div>
              <textarea
                value={urlOutput}
                readOnly
                className="flex-1 w-full bg-transparent p-3 text-xs font-mono text-emerald-300 outline-none resize-none"
              />
            </div>
          </div>
        </div>
      )}

      {/* HTML */}
      {activeTab === 'html' && (
        <div className="flex-1 flex flex-col space-y-4">
          <div className="flex items-center gap-2">
            <button onClick={encodeHtml} className="btn-primary px-3 py-1.5 rounded text-xs font-medium cursor-pointer">
              🏷️ 转义实体 (Escape)
            </button>
            <button onClick={decodeHtml} className="bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 px-3 py-1.5 rounded text-xs font-medium cursor-pointer">
              🔓 还原实体 (Unescape)
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 flex-1 min-h-[320px]">
            <div className="flex flex-col border border-slate-800 rounded-xl overflow-hidden bg-slate-900/60">
              <div className="bg-slate-950/80 px-3 py-2 border-b border-slate-800 text-xs text-slate-400">输入 HTML 代码</div>
              <textarea
                value={htmlInput}
                onChange={(e) => setHtmlInput(e.target.value)}
                className="flex-1 w-full bg-transparent p-3 text-xs font-mono text-slate-200 outline-none resize-none"
              />
            </div>
            <div className="flex flex-col border border-slate-800 rounded-xl overflow-hidden bg-slate-900/60">
              <div className="bg-slate-950/80 px-3 py-2 border-b border-slate-800 text-xs text-slate-400 flex justify-between">
                <span>转义结果</span>
                {htmlOutput && (
                  <button onClick={() => handleCopy(htmlOutput)} className="text-indigo-400 hover:text-indigo-300 text-xs">
                    {copied ? '✓ 已复制' : '📋 复制'}
                  </button>
                )}
              </div>
              <textarea
                value={htmlOutput}
                readOnly
                className="flex-1 w-full bg-transparent p-3 text-xs font-mono text-emerald-300 outline-none resize-none"
              />
            </div>
          </div>
        </div>
      )}

      {/* JWT */}
      {activeTab === 'jwt' && (
        <div className="flex-1 flex flex-col space-y-4">
          <div className="flex items-center gap-2">
            <button onClick={decodeJwt} className="btn-primary px-3 py-1.5 rounded text-xs font-medium cursor-pointer">
              🔍 解析 JWT Token
            </button>
            <button
              onClick={async () => {
                const text = await navigator.clipboard.readText();
                setJwtInput(text);
              }}
              className="bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 px-2.5 py-1.5 rounded text-xs cursor-pointer"
            >
              📋 粘贴并解析
            </button>
          </div>

          {jwtError && (
            <div className="bg-rose-950/40 border border-rose-800 text-rose-300 text-xs p-2 rounded">
              {jwtError}
            </div>
          )}

          {jwtExpInfo && (
            <div className="bg-indigo-950/40 border border-indigo-800/80 text-indigo-300 text-xs p-2.5 rounded-lg flex items-center gap-2">
              <span>⏱️</span>
              <span className="font-semibold">{jwtExpInfo}</span>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 flex-1 min-h-[320px]">
            <div className="flex flex-col border border-slate-800 rounded-xl overflow-hidden bg-slate-900/60">
              <div className="bg-slate-950/80 px-3 py-2 border-b border-slate-800 text-xs text-slate-400">
                JWT Token 原始串
              </div>
              <textarea
                value={jwtInput}
                onChange={(e) => setJwtInput(e.target.value)}
                placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6..."
                className="flex-1 w-full bg-transparent p-3 text-xs font-mono text-indigo-300 outline-none resize-none break-all"
              />
            </div>

            <div className="flex flex-col space-y-3">
              <div className="flex-1 flex flex-col border border-slate-800 rounded-xl overflow-hidden bg-slate-900/60">
                <div className="bg-slate-950/80 px-3 py-1.5 border-b border-slate-800 text-xs text-amber-400 font-semibold">
                  Header (头部信息)
                </div>
                <textarea
                  value={jwtHeader}
                  readOnly
                  className="flex-1 w-full bg-transparent p-2 text-xs font-mono text-amber-300 outline-none resize-none"
                  placeholder="未解析"
                />
              </div>

              <div className="flex-1 flex flex-col border border-slate-800 rounded-xl overflow-hidden bg-slate-900/60">
                <div className="bg-slate-950/80 px-3 py-1.5 border-b border-slate-800 text-xs text-cyan-400 font-semibold">
                  Payload (有效载荷 / Claims)
                </div>
                <textarea
                  value={jwtPayload}
                  readOnly
                  className="flex-1 w-full bg-transparent p-2 text-xs font-mono text-cyan-300 outline-none resize-none"
                  placeholder="未解析"
                />
              </div>

              {jwtSignature && (
                <div className="border border-slate-800 rounded-xl p-2 bg-slate-900/60">
                  <div className="text-[10px] text-slate-500 font-semibold mb-1">Signature (签名 Hash)</div>
                  <div className="text-[11px] font-mono text-slate-400 break-all">{jwtSignature}</div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
