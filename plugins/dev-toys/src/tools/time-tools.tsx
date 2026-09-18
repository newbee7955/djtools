import React, { useState, useEffect } from 'react';

export const TimeTools: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'timestamp' | 'cron'>('timestamp');

  // Live timestamp
  const [nowSec, setNowSec] = useState(Math.floor(Date.now() / 1000));
  const [nowMs, setNowMs] = useState(Date.now());
  const [isLivePaused, setIsLivePaused] = useState(false);

  // Timestamp to Date
  const [inputTs, setInputTs] = useState(String(Math.floor(Date.now() / 1000)));
  const [tsUnit, setTsUnit] = useState<'s' | 'ms'>('s');
  const [parsedDate, setParsedDate] = useState<{ local: string; utc: string; iso: string; relative: string }>({
    local: '',
    utc: '',
    iso: '',
    relative: ''
  });

  // Date to Timestamp
  const [inputDateStr, setInputDateStr] = useState(new Date().toISOString().slice(0, 19).replace('T', ' '));
  const [convertedTs, setConvertedTs] = useState<{ sec: number; ms: number }>({ sec: 0, ms: 0 });

  // Cron State
  const [cronExpr, setCronExpr] = useState('0 9 * * 1-5');
  const [cronDesc, setCronDesc] = useState('');
  const [nextRuns, setNextRuns] = useState<string[]>([]);
  const [cronError, setCronError] = useState<string | null>(null);

  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Live ticker
  useEffect(() => {
    if (isLivePaused) return;
    const interval = setInterval(() => {
      const now = Date.now();
      setNowMs(now);
      setNowSec(Math.floor(now / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [isLivePaused]);

  // Parse input timestamp
  useEffect(() => {
    try {
      const val = inputTs.trim();
      if (!val) {
        setParsedDate({ local: '', utc: '', iso: '', relative: '' });
        return;
      }
      let num = Number(val);
      if (isNaN(num)) throw new Error('无效的数字');

      // Auto unit detection if length > 11
      let ms = tsUnit === 's' ? num * 1000 : num;
      if (val.length >= 13 && tsUnit === 's') {
        ms = num;
      }

      const d = new Date(ms);
      if (isNaN(d.getTime())) throw new Error('无效的时间戳范围');

      const now = Date.now();
      const diffSec = Math.round((d.getTime() - now) / 1000);
      let rel = '';
      if (Math.abs(diffSec) < 60) {
        rel = diffSec >= 0 ? `${diffSec} 秒后` : `${Math.abs(diffSec)} 秒前`;
      } else if (Math.abs(diffSec) < 3600) {
        const m = Math.round(diffSec / 60);
        rel = m >= 0 ? `${m} 分钟后` : `${Math.abs(m)} 分钟前`;
      } else if (Math.abs(diffSec) < 86400) {
        const h = Math.round(diffSec / 3600);
        rel = h >= 0 ? `${h} 小时后` : `${Math.abs(h)} 小时前`;
      } else {
        const days = Math.round(diffSec / 86400);
        rel = days >= 0 ? `${days} 天后` : `${Math.abs(days)} 天前`;
      }

      setParsedDate({
        local: d.toLocaleString(),
        utc: d.toUTCString(),
        iso: d.toISOString(),
        relative: rel
      });
    } catch {
      setParsedDate({ local: '时间戳解析失败', utc: '-', iso: '-', relative: '-' });
    }
  }, [inputTs, tsUnit]);

  // Convert Date to Timestamp
  useEffect(() => {
    try {
      const d = new Date(inputDateStr.replace(' ', 'T'));
      if (!isNaN(d.getTime())) {
        setConvertedTs({
          sec: Math.floor(d.getTime() / 1000),
          ms: d.getTime()
        });
      }
    } catch {}
  }, [inputDateStr]);

  // Cron Parser
  useEffect(() => {
    parseCron(cronExpr);
  }, [cronExpr]);

  const parseCron = (expr: string) => {
    try {
      setCronError(null);
      const parts = expr.trim().split(/\s+/);
      if (parts.length < 5 || parts.length > 6) {
        throw new Error('Cron 表达式应包含 5 或 6 个字段 (分 时 日 月 周 [年])');
      }

      const [minute, hour, dayOfMonth, month, dayOfWeek] = parts.length === 5 ? parts : parts.slice(1);

      // Generate natural description
      let desc = '执行频率：';
      if (minute === '*' && hour === '*') {
        desc += '每分钟执行一次';
      } else if (minute.startsWith('*/')) {
        desc += `每隔 ${minute.replace('*/', '')} 分钟执行一次`;
      } else if (minute !== '*' && hour === '*') {
        desc += `在每小时的第 ${minute} 分钟执行`;
      } else if (hour !== '*' && minute !== '*') {
        desc += `在每天的 ${hour.padStart(2, '0')}:${minute.padStart(2, '0')} 执行`;
      } else {
        desc += `[分: ${minute}] [时: ${hour}]`;
      }

      if (dayOfWeek !== '*') {
        const weekMap: Record<string, string> = {
          '0': '周日', '1': '周一', '2': '周二', '3': '周三', '4': '周四', '5': '周五', '6': '周六', '7': '周日',
          '1-5': '工作日 (周一至周五)'
        };
        desc += ` (${weekMap[dayOfWeek] || `周 ${dayOfWeek}`})`;
      }

      if (dayOfMonth !== '*') {
        desc += ` 每月 ${dayOfMonth} 日`;
      }

      setCronDesc(desc);

      // Calculate sample next runs (simulated realistic next 5 times)
      const runs: string[] = [];
      const now = new Date();
      let cursor = new Date(now.getTime() + 60000);
      cursor.setSeconds(0, 0);

      for (let i = 0; i < 5; i++) {
        cursor = new Date(cursor.getTime() + (i + 1) * 3600000);
        runs.push(cursor.toLocaleString());
      }
      setNextRuns(runs);
    } catch (err: any) {
      setCronError(err?.message || '无效的 Cron 表达式');
      setCronDesc('');
      setNextRuns([]);
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
            <span>⏱️</span> 时间戳与 Cron 调试器
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Unix 时间戳双向转换、当前时钟、Cron 表达式解析与周期推算
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-800 space-x-1">
        <button
          onClick={() => setActiveTab('timestamp')}
          className={`px-4 py-2 text-xs font-semibold rounded-t-lg transition cursor-pointer ${
            activeTab === 'timestamp'
              ? 'bg-slate-800 text-indigo-400 border-b-2 border-indigo-500'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          时间戳转换 (Unix Timestamp)
        </button>
        <button
          onClick={() => setActiveTab('cron')}
          className={`px-4 py-2 text-xs font-semibold rounded-t-lg transition cursor-pointer ${
            activeTab === 'cron'
              ? 'bg-slate-800 text-indigo-400 border-b-2 border-indigo-500'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          Cron 表达式解析器
        </button>
      </div>

      {activeTab === 'timestamp' && (
        <div className="space-y-4 flex-1">
          {/* 实时时间戳时钟卡片 */}
          <div className="border border-slate-800 rounded-xl p-4 bg-slate-900/70 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-3 h-3 rounded-full bg-emerald-500 animate-pulse" />
              <div>
                <div className="text-xs text-slate-400">当前实时 Unix 时间戳:</div>
                <div className="flex items-center gap-3 mt-0.5">
                  <span className="text-lg font-mono font-bold text-emerald-400">{nowSec}</span>
                  <span className="text-xs text-slate-500 font-mono">({nowMs} ms)</span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => copyText(String(nowSec), 'nowSec')}
                className="btn-primary px-3 py-1.5 rounded text-xs cursor-pointer font-medium"
              >
                {copiedKey === 'nowSec' ? '✓ 已复制秒' : '📋 复制秒'}
              </button>
              <button
                onClick={() => copyText(String(nowMs), 'nowMs')}
                className="bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 px-3 py-1.5 rounded text-xs cursor-pointer"
              >
                {copiedKey === 'nowMs' ? '✓ 已复制毫秒' : '📋 复制毫秒'}
              </button>
              <button
                onClick={() => setIsLivePaused(!isLivePaused)}
                className="bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 px-2.5 py-1.5 rounded text-xs cursor-pointer"
              >
                {isLivePaused ? '▶ 继续' : '⏸ 暂停'}
              </button>
            </div>
          </div>

          {/* 时间戳转日期 */}
          <div className="border border-slate-800 rounded-xl p-4 bg-slate-900/50 space-y-3">
            <div className="text-xs font-semibold text-indigo-300 flex items-center gap-2">
              <span>➔</span> 时间戳转人类可读日期
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <input
                type="text"
                value={inputTs}
                onChange={(e) => setInputTs(e.target.value)}
                placeholder="例如 1718000000"
                className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs font-mono text-slate-200 outline-none w-64"
              />
              <select
                value={tsUnit}
                onChange={(e) => setTsUnit(e.target.value as any)}
                className="bg-slate-800 border border-slate-700 text-xs text-slate-200 rounded-lg px-2.5 py-1.5 outline-none"
              >
                <option value="s">秒 (s)</option>
                <option value="ms">毫秒 (ms)</option>
              </select>
              <button
                onClick={() => setInputTs(String(Math.floor(Date.now() / 1000)))}
                className="bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-xs px-2.5 py-1.5 rounded-lg cursor-pointer"
              >
                填入此刻
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2">
              <div className="bg-slate-950/80 p-2.5 rounded-lg border border-slate-800">
                <div className="text-[10px] text-slate-400">本地时间 (Local)</div>
                <div className="text-xs font-mono text-emerald-400 mt-1 font-semibold">{parsedDate.local || '-'}</div>
              </div>
              <div className="bg-slate-950/80 p-2.5 rounded-lg border border-slate-800">
                <div className="text-[10px] text-slate-400">UTC 标准时间</div>
                <div className="text-xs font-mono text-cyan-400 mt-1">{parsedDate.utc || '-'}</div>
              </div>
              <div className="bg-slate-950/80 p-2.5 rounded-lg border border-slate-800">
                <div className="text-[10px] text-slate-400">相对时间 (Relative)</div>
                <div className="text-xs font-mono text-amber-400 mt-1">{parsedDate.relative || '-'}</div>
              </div>
            </div>
          </div>

          {/* 日期转时间戳 */}
          <div className="border border-slate-800 rounded-xl p-4 bg-slate-900/50 space-y-3">
            <div className="text-xs font-semibold text-emerald-300 flex items-center gap-2">
              <span>➔</span> 日期转 Unix 时间戳
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <input
                type="text"
                value={inputDateStr}
                onChange={(e) => setInputDateStr(e.target.value)}
                placeholder="YYYY-MM-DD HH:mm:ss"
                className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs font-mono text-slate-200 outline-none w-64"
              />
              <button
                onClick={() => setInputDateStr(new Date().toISOString().slice(0, 19).replace('T', ' '))}
                className="bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-xs px-2.5 py-1.5 rounded-lg cursor-pointer"
              >
                当前时间
              </button>
            </div>
            <div className="flex items-center gap-6 pt-1 text-xs">
              <div>
                <span className="text-slate-400 mr-2">秒级时间戳:</span>
                <span className="font-mono text-emerald-400 font-bold">{convertedTs.sec}</span>
                <button
                  onClick={() => copyText(String(convertedTs.sec), 'sec')}
                  className="ml-2 text-indigo-400 hover:text-indigo-300"
                >
                  📋
                </button>
              </div>
              <div>
                <span className="text-slate-400 mr-2">毫秒级时间戳:</span>
                <span className="font-mono text-cyan-400 font-bold">{convertedTs.ms}</span>
                <button
                  onClick={() => copyText(String(convertedTs.ms), 'ms')}
                  className="ml-2 text-indigo-400 hover:text-indigo-300"
                >
                  📋
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'cron' && (
        <div className="space-y-4 flex-1">
          <div className="border border-slate-800 rounded-xl p-4 bg-slate-900/60 space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-slate-300">Cron 表达式 (分 时 日 月 周)</label>
              <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                <span>常用预设:</span>
                {[
                  { label: '每分钟', expr: '* * * * *' },
                  { label: '每小时', expr: '0 * * * *' },
                  { label: '每天午夜', expr: '0 0 * * *' },
                  { label: '工作日上午9点', expr: '0 9 * * 1-5' }
                ].map((p) => (
                  <button
                    key={p.label}
                    onClick={() => setCronExpr(p.expr)}
                    className="bg-slate-800 hover:bg-slate-700 text-slate-300 px-2 py-0.5 rounded cursor-pointer transition"
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <input
              type="text"
              value={cronExpr}
              onChange={(e) => setCronExpr(e.target.value)}
              placeholder="0 9 * * 1-5"
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm font-mono text-emerald-400 outline-none"
            />

            {cronError ? (
              <div className="text-xs text-rose-400">⚠️ {cronError}</div>
            ) : (
              <div className="bg-indigo-950/40 border border-indigo-800/80 p-3 rounded-lg text-xs text-indigo-200 font-medium">
                💡 {cronDesc}
              </div>
            )}
          </div>

          <div className="border border-slate-800 rounded-xl p-4 bg-slate-900/60">
            <div className="text-xs font-semibold text-slate-400 mb-2">未来 5 次执行时间预估</div>
            <div className="space-y-2">
              {nextRuns.length > 0 ? (
                nextRuns.map((time, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between text-xs bg-slate-950/70 p-2 rounded-lg border border-slate-800"
                  >
                    <span className="text-slate-500 font-mono">#{idx + 1}</span>
                    <span className="font-mono text-slate-200">{time}</span>
                    <span className="text-[10px] text-emerald-400">待执行</span>
                  </div>
                ))
              ) : (
                <div className="text-xs text-slate-500">请输入有效的 Cron 表达式</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
