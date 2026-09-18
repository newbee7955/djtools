import React, { useState, useEffect } from 'react';
import { md5 } from '../utils/md5';

export const HashTools: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'hash' | 'hmac' | 'checksum'>('hash');

  // Hash State
  const [inputText, setInputText] = useState('Hello 豆角工具箱');
  const [isUppercase, setIsUppercase] = useState(false);
  const [hashes, setHashes] = useState<{ md5: string; sha1: string; sha256: string; sha512: string }>({
    md5: '',
    sha1: '',
    sha256: '',
    sha512: ''
  });

  // HMAC State
  const [hmacText, setHmacText] = useState('Hello HMAC');
  const [hmacKey, setHmacKey] = useState('secret-key-123');
  const [hmacAlgo, setHmacAlgo] = useState<'SHA-256' | 'SHA-512' | 'SHA-1'>('SHA-256');
  const [hmacResult, setHmacResult] = useState('');

  // Checksum State
  const [compareA, setCompareA] = useState('');
  const [compareB, setCompareB] = useState('');
  const [isMatch, setIsMatch] = useState<boolean | null>(null);

  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Compute subtle hashes
  useEffect(() => {
    let isCancelled = false;

    async function computeHashes() {
      if (!inputText) {
        setHashes({ md5: '', sha1: '', sha256: '', sha512: '' });
        return;
      }

      const m5 = md5(inputText);
      const encoder = new TextEncoder();
      const data = encoder.encode(inputText);

      const bufferToHex = (buf: ArrayBuffer) =>
        Array.from(new Uint8Array(buf))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('');

      try {
        const [sha1Buf, sha256Buf, sha512Buf] = await Promise.all([
          crypto.subtle.digest('SHA-1', data),
          crypto.subtle.digest('SHA-256', data),
          crypto.subtle.digest('SHA-512', data)
        ]);

        if (!isCancelled) {
          const s1 = bufferToHex(sha1Buf);
          const s256 = bufferToHex(sha256Buf);
          const s512 = bufferToHex(sha512Buf);

          setHashes({
            md5: isUppercase ? m5.toUpperCase() : m5,
            sha1: isUppercase ? s1.toUpperCase() : s1,
            sha256: isUppercase ? s256.toUpperCase() : s256,
            sha512: isUppercase ? s512.toUpperCase() : s512
          });
        }
      } catch (err) {
        console.error('Hash calculation error:', err);
      }
    }

    computeHashes();

    return () => {
      isCancelled = true;
    };
  }, [inputText, isUppercase]);

  // Compute HMAC
  useEffect(() => {
    async function computeHmac() {
      if (!hmacText || !hmacKey) {
        setHmacResult('');
        return;
      }

      try {
        const encoder = new TextEncoder();
        const keyData = encoder.encode(hmacKey);
        const msgData = encoder.encode(hmacText);

        const cryptoKey = await crypto.subtle.importKey(
          'raw',
          keyData,
          { name: 'HMAC', hash: hmacAlgo },
          false,
          ['sign']
        );

        const signature = await crypto.subtle.sign('HMAC', cryptoKey, msgData);
        const hex = Array.from(new Uint8Array(signature))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('');

        setHmacResult(isUppercase ? hex.toUpperCase() : hex);
      } catch (err) {
        console.error('HMAC error:', err);
      }
    }

    computeHmac();
  }, [hmacText, hmacKey, hmacAlgo, isUppercase]);

  // Compare Checksum
  useEffect(() => {
    if (!compareA && !compareB) {
      setIsMatch(null);
    } else {
      setIsMatch(compareA.trim().toLowerCase() === compareB.trim().toLowerCase());
    }
  }, [compareA, compareB]);

  const copyToClipboard = async (text: string, key: string) => {
    if (!text) return;
    await navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1500);
  };

  return (
    <div className="h-full flex flex-col p-6 space-y-4 overflow-y-auto">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
            <span>🔐</span> 哈希与加密计算
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            支持 MD5, SHA-1, SHA-256, SHA-512, HMAC-SHA 与 Checksum 校验
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-300 flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={isUppercase}
              onChange={(e) => setIsUppercase(e.target.checked)}
              className="accent-indigo-500 rounded"
            />
            <span>大写格式 (UPPERCASE)</span>
          </label>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-800 space-x-1">
        {(['hash', 'hmac', 'checksum'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-xs font-semibold rounded-t-lg transition cursor-pointer ${
              activeTab === tab
                ? 'bg-slate-800 text-indigo-400 border-b-2 border-indigo-500'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
            }`}
          >
            {tab === 'hash' && '哈希生成 (MD5 / SHA)'}
            {tab === 'hmac' && 'HMAC 消息认证'}
            {tab === 'checksum' && '哈希比对校验 (Checksum)'}
          </button>
        ))}
      </div>

      {activeTab === 'hash' && (
        <div className="flex-1 flex flex-col space-y-4">
          <div className="flex flex-col border border-slate-800 rounded-xl overflow-hidden bg-slate-900/60">
            <div className="bg-slate-950/80 px-3 py-2 border-b border-slate-800 text-xs text-slate-400 flex justify-between">
              <span>输入原始字符串</span>
              <button
                onClick={async () => setInputText(await navigator.clipboard.readText())}
                className="text-xs text-indigo-400 hover:text-indigo-300"
              >
                📋 粘贴
              </button>
            </div>
            <textarea
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="请输入需要计算哈希的文本..."
              className="h-24 w-full bg-transparent p-3 text-xs font-mono text-slate-200 outline-none resize-none"
            />
          </div>

          <div className="space-y-3">
            {[
              { label: 'MD5 (128-bit)', value: hashes.md5, key: 'md5' },
              { label: 'SHA-1 (160-bit)', value: hashes.sha1, key: 'sha1' },
              { label: 'SHA-256 (256-bit)', value: hashes.sha256, key: 'sha256' },
              { label: 'SHA-512 (512-bit)', value: hashes.sha512, key: 'sha512' }
            ].map(({ label, value, key }) => (
              <div key={key} className="border border-slate-800 rounded-xl p-3 bg-slate-900/60">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-semibold text-slate-400">{label}</span>
                  <button
                    onClick={() => copyToClipboard(value, key)}
                    className="text-xs text-indigo-400 hover:text-indigo-300 transition cursor-pointer"
                  >
                    {copiedKey === key ? '✓ 已复制' : '📋 复制'}
                  </button>
                </div>
                <div className="bg-slate-950/80 px-3 py-2 rounded-lg font-mono text-xs text-emerald-400 break-all select-all border border-slate-800/80">
                  {value || <span className="text-slate-600">等待输入...</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'hmac' && (
        <div className="flex-1 flex flex-col space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex flex-col border border-slate-800 rounded-xl overflow-hidden bg-slate-900/60">
              <div className="bg-slate-950/80 px-3 py-2 border-b border-slate-800 text-xs text-slate-400">消息内容 (Message)</div>
              <textarea
                value={hmacText}
                onChange={(e) => setHmacText(e.target.value)}
                className="h-24 w-full bg-transparent p-3 text-xs font-mono text-slate-200 outline-none resize-none"
              />
            </div>
            <div className="flex flex-col border border-slate-800 rounded-xl overflow-hidden bg-slate-900/60">
              <div className="bg-slate-950/80 px-3 py-2 border-b border-slate-800 text-xs text-slate-400 flex justify-between items-center">
                <span>私钥 (Secret Key)</span>
                <select
                  value={hmacAlgo}
                  onChange={(e) => setHmacAlgo(e.target.value as any)}
                  className="bg-slate-800 border border-slate-700 text-xs text-slate-200 rounded px-2 py-0.5"
                >
                  <option value="SHA-256">HMAC-SHA256</option>
                  <option value="SHA-512">HMAC-SHA512</option>
                  <option value="SHA-1">HMAC-SHA1</option>
                </select>
              </div>
              <textarea
                value={hmacKey}
                onChange={(e) => setHmacKey(e.target.value)}
                className="h-24 w-full bg-transparent p-3 text-xs font-mono text-amber-300 outline-none resize-none"
              />
            </div>
          </div>

          <div className="border border-slate-800 rounded-xl p-3 bg-slate-900/60">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-semibold text-slate-400">{hmacAlgo} 签名结果</span>
              <button
                onClick={() => copyToClipboard(hmacResult, 'hmac')}
                className="text-xs text-indigo-400 hover:text-indigo-300 transition cursor-pointer"
              >
                {copiedKey === 'hmac' ? '✓ 已复制' : '📋 复制结果'}
              </button>
            </div>
            <div className="bg-slate-950/80 px-3 py-2 rounded-lg font-mono text-xs text-cyan-400 break-all select-all border border-slate-800/80">
              {hmacResult || <span className="text-slate-600">等待输入...</span>}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'checksum' && (
        <div className="flex-1 flex flex-col space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex flex-col border border-slate-800 rounded-xl overflow-hidden bg-slate-900/60">
              <div className="bg-slate-950/80 px-3 py-2 border-b border-slate-800 text-xs text-slate-400">原始值 / 哈希 A</div>
              <textarea
                value={compareA}
                onChange={(e) => setCompareA(e.target.value)}
                placeholder="粘贴源哈希或原字符串..."
                className="h-28 w-full bg-transparent p-3 text-xs font-mono text-slate-200 outline-none resize-none"
              />
            </div>
            <div className="flex flex-col border border-slate-800 rounded-xl overflow-hidden bg-slate-900/60">
              <div className="bg-slate-950/80 px-3 py-2 border-b border-slate-800 text-xs text-slate-400">待比对值 / 哈希 B</div>
              <textarea
                value={compareB}
                onChange={(e) => setCompareB(e.target.value)}
                placeholder="粘贴待验证的哈希或字符串..."
                className="h-28 w-full bg-transparent p-3 text-xs font-mono text-slate-200 outline-none resize-none"
              />
            </div>
          </div>

          {isMatch !== null && (
            <div
              className={`p-4 rounded-xl border flex items-center gap-3 transition-colors ${
                isMatch
                  ? 'bg-emerald-950/40 border-emerald-800/80 text-emerald-300'
                  : 'bg-rose-950/40 border-rose-800/80 text-rose-300'
              }`}
            >
              <span className="text-2xl">{isMatch ? '✓' : '✗'}</span>
              <div>
                <div className="font-bold text-sm">{isMatch ? '哈希匹配一致！' : '哈希不一致！'}</div>
                <div className="text-xs opacity-80 mt-0.5">
                  {isMatch
                    ? '比对的两段哈希值或字符串完全相同（已忽略首尾空格及大小写差异）'
                    : '检测到两段内容存在差异，请仔细检查或重新校验'}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
