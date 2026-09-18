import React, { useState, useMemo, useEffect } from 'react';
import { JsonTools } from './tools/json-tools';
import { EncoderTools } from './tools/encoder-tools';
import { HashTools } from './tools/hash-tools';
import { TimeTools } from './tools/time-tools';
import { RegexTools } from './tools/regex-tools';
import { GeneratorTools } from './tools/generator-tools';
import { DiffTools } from './tools/diff-tools';
import { QrCodeTools } from './tools/qrcode-tools';

interface ToolItem {
  id: string;
  name: string;
  category: string;
  icon: string;
  desc: string;
  keywords: string[];
}

const ALL_TOOLS: ToolItem[] = [
  {
    id: 'json',
    name: 'JSON / YAML 格式化',
    category: '格式转换',
    icon: '📦',
    desc: 'JSON/YAML 格式化、压缩、转 YAML/JSON、校验定位',
    keywords: ['json', 'yaml', 'format', 'minify', 'validate']
  },
  {
    id: 'encoders',
    name: '常用编解码器',
    category: '编解码器',
    icon: '🔠',
    desc: 'Base64 文本与图片、URL 编解码、HTML 实体、JWT 令牌',
    keywords: ['base64', 'url', 'html', 'jwt', 'token', 'decode', 'encode']
  },
  {
    id: 'hash',
    name: '哈希与加解密',
    category: '安全加密',
    icon: '🔐',
    desc: 'MD5, SHA-1/256/512, HMAC-SHA, Checksum 比对',
    keywords: ['md5', 'sha', 'sha256', 'sha512', 'hmac', 'checksum', 'hash']
  },
  {
    id: 'time',
    name: '时间戳与 Cron',
    category: '时间调试',
    icon: '⏱️',
    desc: 'Unix 秒/毫秒时间戳互转、实时时钟、Cron 周期解析',
    keywords: ['timestamp', 'time', 'date', 'cron', 'epoch', 'unix']
  },
  {
    id: 'regex',
    name: '正则表达式测试',
    category: '代码调试',
    icon: '🎯',
    desc: '正则模式语法测试、高亮着色、捕获分组与速查表',
    keywords: ['regex', 'regexp', 'pattern', 'match', 'test']
  },
  {
    id: 'generators',
    name: '常用生成器',
    category: '效率生成',
    icon: '🎲',
    desc: '批量 UUID / GUID、随机高强密码、色彩格式换算',
    keywords: ['uuid', 'guid', 'password', 'color', 'hex', 'rgb', 'hsl']
  },
  {
    id: 'diff',
    name: '文本差异比对',
    category: '代码调试',
    icon: '⚖️',
    desc: '快速比对两段文本或代码的增删改差异',
    keywords: ['diff', 'compare', 'difference', 'merge']
  },
  {
    id: 'qrcode',
    name: '二维码生成器',
    category: '效率生成',
    icon: '📱',
    desc: '文本或网址转高清二维码图片，支持配置与复制',
    keywords: ['qrcode', 'qr', 'barcode', 'code']
  }
];

export default function App() {
  const [activeToolId, setActiveToolId] = useState<string>(() => {
    return localStorage.getItem('doujiao:dev-toys:activeTool') || 'json';
  });
  const [searchKeyword, setSearchKeyword] = useState('');

  useEffect(() => {
    localStorage.setItem('doujiao:dev-toys:activeTool', activeToolId);
  }, [activeToolId]);

  const filteredTools = useMemo(() => {
    const q = searchKeyword.trim().toLowerCase();
    if (!q) return ALL_TOOLS;
    return ALL_TOOLS.filter((tool) => {
      return (
        tool.name.toLowerCase().includes(q) ||
        tool.desc.toLowerCase().includes(q) ||
        tool.category.toLowerCase().includes(q) ||
        tool.keywords.some((k) => k.includes(q))
      );
    });
  }, [searchKeyword]);

  const groupedTools = useMemo(() => {
    const map = new Map<string, ToolItem[]>();
    filteredTools.forEach((tool) => {
      if (!map.has(tool.category)) {
        map.set(tool.category, []);
      }
      map.get(tool.category)!.push(tool);
    });
    return Array.from(map.entries());
  }, [filteredTools]);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-950 text-slate-100 select-none theme-bg-base">
      {/* 左侧工具栏 */}
      <aside className="w-64 flex-shrink-0 flex flex-col border-r border-slate-800/80 bg-slate-900/90 theme-bg-sidebar">
        {/* 顶部标题与搜索栏 */}
        <div className="p-3.5 border-b border-slate-800/80 space-y-2.5">
          <div className="flex items-center gap-2">
            <span className="text-xl">🛠️</span>
            <div>
              <h1 className="text-sm font-bold text-slate-100 leading-none">DevToys 百宝箱</h1>
              <p className="text-[10px] text-slate-400 mt-1">离线极客开发者工具箱</p>
            </div>
          </div>

          <div className="relative">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 text-xs">🔍</span>
            <input
              type="text"
              value={searchKeyword}
              onChange={(e) => setSearchKeyword(e.target.value)}
              placeholder="快速搜索工具 (如 jwt, cron)..."
              className="w-full bg-slate-950/80 border border-slate-700/80 rounded-lg pl-7 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 outline-none focus:border-indigo-500 transition theme-input"
            />
          </div>
        </div>

        {/* 工具分类列表 */}
        <div className="flex-1 overflow-y-auto p-2 space-y-3">
          {groupedTools.length > 0 ? (
            groupedTools.map(([category, tools]) => (
              <div key={category} className="space-y-1">
                <div className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  {category}
                </div>
                {tools.map((tool) => {
                  const isActive = activeToolId === tool.id;
                  return (
                    <button
                      key={tool.id}
                      onClick={() => setActiveToolId(tool.id)}
                      className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium transition cursor-pointer text-left ${
                        isActive
                          ? 'btn-primary shadow-md'
                          : 'text-slate-300 hover:bg-slate-800/60 hover:text-slate-100'
                      }`}
                    >
                      <span className="text-base">{tool.icon}</span>
                      <div className="flex-1 min-w-0">
                        <div className="truncate font-semibold">{tool.name}</div>
                        <div className="text-[10px] opacity-70 truncate">{tool.desc}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            ))
          ) : (
            <div className="py-8 text-center text-xs text-slate-500">
              未找到匹配的工具
            </div>
          )}
        </div>

        {/* 底部信息 */}
        <div className="p-3 border-t border-slate-800/80 text-[10px] text-slate-400 flex items-center justify-between">
          <span>豆角工具箱 v2.0</span>
          <span className="text-emerald-400 font-semibold">100% 离线运行</span>
        </div>
      </aside>

      {/* 右侧主工具画布 */}
      <main className="flex-1 h-full overflow-hidden bg-slate-950 theme-bg-card">
        {activeToolId === 'json' && <JsonTools />}
        {activeToolId === 'encoders' && <EncoderTools />}
        {activeToolId === 'hash' && <HashTools />}
        {activeToolId === 'time' && <TimeTools />}
        {activeToolId === 'regex' && <RegexTools />}
        {activeToolId === 'generators' && <GeneratorTools />}
        {activeToolId === 'diff' && <DiffTools />}
        {activeToolId === 'qrcode' && <QrCodeTools />}
      </main>
    </div>
  );
}
