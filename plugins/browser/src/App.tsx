import React, { useState, useRef, useEffect } from 'react'

interface BrowserTab {
  id: string
  title: string
  url: string
  inputUrl: string
  favicon?: string
  isLoading: boolean
  canGoBack: boolean
  canGoForward: boolean
}

interface Bookmark {
  id: string
  title: string
  url: string
  icon?: string
}

type SearchEngine = 'bing' | 'baidu' | 'google' | 'duckduckgo'

const DEFAULT_BOOKMARKS: Bookmark[] = [
  { id: 'bm_github', title: 'GitHub', url: 'https://github.com', icon: '🐙' },
  { id: 'bm_bili', title: '哔哩哔哩', url: 'https://www.bilibili.com', icon: '📺' },
  { id: 'bm_v2ex', title: 'V2EX', url: 'https://www.v2ex.com', icon: '💬' },
  { id: 'bm_mdn', title: 'MDN Web', url: 'https://developer.mozilla.org', icon: '📚' },
  { id: 'bm_npm', title: 'npm Registry', url: 'https://www.npmjs.com', icon: '📦' },
  { id: 'bm_douyin', title: '抖音网页版', url: 'https://www.douyin.com', icon: '🎵' }
]

export default function App(): JSX.Element {
  const [tabs, setTabs] = useState<BrowserTab[]>([
    {
      id: 'tab_1',
      title: '新标签页',
      url: 'about:blank',
      inputUrl: '',
      isLoading: false,
      canGoBack: false,
      canGoForward: false
    }
  ])

  const [activeTabId, setActiveTabId] = useState<string>('tab_1')
  const [searchEngine, setSearchEngine] = useState<SearchEngine>('bing')
  const [bookmarks, setBookmarks] = useState<Bookmark[]>(() => {
    try {
      const saved = localStorage.getItem('doujiao_browser_bookmarks')
      if (saved) return JSON.parse(saved)
    } catch {}
    return DEFAULT_BOOKMARKS
  })
  const [toast, setToast] = useState<string | null>(null)

  const activeTab = tabs.find((t) => t.id === activeTabId) || tabs[0]
  const webviewRefs = useRef<Map<string, any>>(new Map())

  // 保存书签
  useEffect(() => {
    try {
      localStorage.setItem('doujiao_browser_bookmarks', JSON.stringify(bookmarks))
    } catch (err) {}
  }, [bookmarks])

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 2500)
  }

  // 绑定 webview 事件监听
  useEffect(() => {
    const webview = webviewRefs.current.get(activeTab.id)
    if (!webview) return

    const handleStartLoading = () => {
      updateTab(activeTab.id, { isLoading: true })
    }

    const handleStopLoading = () => {
      updateTab(activeTab.id, {
        isLoading: false,
        canGoBack: webview.canGoBack ? webview.canGoBack() : false,
        canGoForward: webview.canGoForward ? webview.canGoForward() : false
      })
    }

    const handleTitle = (e: any) => {
      if (e.title) {
        updateTab(activeTab.id, { title: e.title })
      }
    }

    const handleNavigate = (e: any) => {
      if (e.url) {
        updateTab(activeTab.id, {
          url: e.url,
          inputUrl: e.url === 'about:blank' ? '' : e.url,
          canGoBack: webview.canGoBack ? webview.canGoBack() : false,
          canGoForward: webview.canGoForward ? webview.canGoForward() : false
        })
      }
    }

    const handleFavicon = (e: any) => {
      if (e.favicons && e.favicons.length > 0) {
        updateTab(activeTab.id, { favicon: e.favicons[0] })
      }
    }

    webview.addEventListener('did-start-loading', handleStartLoading)
    webview.addEventListener('did-stop-loading', handleStopLoading)
    webview.addEventListener('page-title-updated', handleTitle)
    webview.addEventListener('did-navigate', handleNavigate)
    webview.addEventListener('did-navigate-in-page', handleNavigate)
    webview.addEventListener('page-favicon-updated', handleFavicon)

    return () => {
      webview.removeEventListener('did-start-loading', handleStartLoading)
      webview.removeEventListener('did-stop-loading', handleStopLoading)
      webview.removeEventListener('page-title-updated', handleTitle)
      webview.removeEventListener('did-navigate', handleNavigate)
      webview.removeEventListener('did-navigate-in-page', handleNavigate)
      webview.removeEventListener('page-favicon-updated', handleFavicon)
    }
  }, [activeTab.id])

  const updateTab = (id: string, partial: Partial<BrowserTab>) => {
    setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, ...partial } : t)))
  }

  // 新建标签页
  const handleNewTab = (initialUrl: string = 'about:blank', title: string = '新标签页') => {
    const newId = `tab_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    const newTab: BrowserTab = {
      id: newId,
      title,
      url: initialUrl,
      inputUrl: initialUrl === 'about:blank' ? '' : initialUrl,
      isLoading: false,
      canGoBack: false,
      canGoForward: false
    }
    setTabs((prev) => [...prev, newTab])
    setActiveTabId(newId)
  }

  // 关闭标签页
  const handleCloseTab = (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation()
    if (tabs.length <= 1) {
      // 若只剩一个标签，重置为新标签页
      updateTab(id, {
        title: '新标签页',
        url: 'about:blank',
        inputUrl: '',
        favicon: undefined,
        isLoading: false
      })
      const webview = webviewRefs.current.get(id)
      if (webview && webview.loadURL) webview.loadURL('about:blank')
      return
    }

    const filtered = tabs.filter((t) => t.id !== id)
    setTabs(filtered)
    webviewRefs.current.delete(id)
    if (activeTabId === id) {
      setActiveTabId(filtered[filtered.length - 1].id)
    }
  }

  // 解析目标网址或搜索查询
  const resolveTargetUrl = (raw: string): string => {
    const trimmed = raw.trim()
    if (!trimmed) return 'about:blank'

    // 若已经以 http/https 开头
    if (/^https?:\/\//i.test(trimmed)) {
      return trimmed
    }

    // 若符合标准域名格式如 github.com 或 www.baidu.com
    if (/^([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}(:\d+)?(\/.*)?$/i.test(trimmed)) {
      return `https://${trimmed}`
    }

    // 否则调用搜索引擎
    const encoded = encodeURIComponent(trimmed)
    switch (searchEngine) {
      case 'baidu':
        return `https://www.baidu.com/s?wd=${encoded}`
      case 'google':
        return `https://www.google.com/search?q=${encoded}`
      case 'duckduckgo':
        return `https://duckduckgo.com/?q=${encoded}`
      case 'bing':
      default:
        return `https://www.bing.com/search?q=${encoded}`
    }
  }

  // 提交访问地址
  const handleNavigate = (target?: string) => {
    const targetUrl = resolveTargetUrl(target || activeTab.inputUrl)
    updateTab(activeTab.id, {
      url: targetUrl,
      inputUrl: targetUrl,
      isLoading: true
    })

    const webview = webviewRefs.current.get(activeTab.id)
    if (webview && webview.loadURL) {
      webview.loadURL(targetUrl).catch((err: any) => {
        console.warn('[Browser] 加载失败:', err)
      })
    }
  }

  // 导航动作
  const handleGoBack = () => {
    const webview = webviewRefs.current.get(activeTab.id)
    if (webview && webview.goBack) webview.goBack()
  }

  const handleGoForward = () => {
    const webview = webviewRefs.current.get(activeTab.id)
    if (webview && webview.goForward) webview.goForward()
  }

  const handleReload = () => {
    const webview = webviewRefs.current.get(activeTab.id)
    if (webview) {
      if (activeTab.isLoading && webview.stop) {
        webview.stop()
      } else if (webview.reload) {
        webview.reload()
      }
    }
  }

  const handleGoHome = () => {
    updateTab(activeTab.id, {
      title: '新标签页',
      url: 'about:blank',
      inputUrl: '',
      favicon: undefined,
      isLoading: false
    })
    const webview = webviewRefs.current.get(activeTab.id)
    if (webview && webview.loadURL) webview.loadURL('about:blank')
  }

  // 复制当前网址
  const handleCopyUrl = () => {
    if (!activeTab.url || activeTab.url === 'about:blank') {
      showToast('当前为主页，无有效链接')
      return
    }
    navigator.clipboard.writeText(activeTab.url).then(() => {
      showToast('网址已复制到剪贴板')
    })
  }

  // 在系统外部浏览器打开
  const handleOpenExternal = () => {
    if (!activeTab.url || activeTab.url === 'about:blank') return
    window.open(activeTab.url, '_blank')
  }

  // 添加或移除书签
  const isBookmarked = bookmarks.some((b) => b.url === activeTab.url && activeTab.url !== 'about:blank')
  const toggleBookmark = () => {
    if (!activeTab.url || activeTab.url === 'about:blank') return
    if (isBookmarked) {
      setBookmarks((prev) => prev.filter((b) => b.url !== activeTab.url))
      showToast('已从书签栏移除')
    } else {
      const newBm: Bookmark = {
        id: `bm_${Date.now()}`,
        title: activeTab.title || activeTab.url,
        url: activeTab.url,
        icon: '🔖'
      }
      setBookmarks((prev) => [...prev, newBm])
      showToast('已添加到书签栏')
    }
  }

  return (
    <div className="h-screen w-screen flex flex-col bg-slate-900 text-slate-100 overflow-hidden select-none font-sans">
      {/* Toast 提示 */}
      {toast && (
        <div className="absolute top-4 right-6 z-50 px-4 py-2 rounded-xl bg-blue-600 text-white text-xs shadow-xl shadow-blue-600/30 flex items-center gap-2 animate-bounce">
          <span>🌐</span>
          <span>{toast}</span>
        </div>
      )}

      {/* 顶部 Chrome 风格标签栏 */}
      <div className="h-10 bg-slate-950 px-2 flex items-end gap-1 overflow-x-auto border-b border-slate-800/80 shrink-0">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTab.id
          return (
            <div
              key={tab.id}
              onClick={() => setActiveTabId(tab.id)}
              className={`group max-w-[200px] min-w-[120px] h-8.5 px-3 rounded-t-xl text-xs flex items-center justify-between cursor-pointer border-t border-x transition-all ${
                isActive
                  ? 'bg-slate-900 border-slate-800 text-white font-medium shadow-sm'
                  : 'bg-slate-950/60 border-transparent hover:bg-slate-900/60 text-slate-400'
              }`}
            >
              <div className="flex items-center gap-2 overflow-hidden flex-1">
                {tab.isLoading ? (
                  <span className="w-3.5 h-3.5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin shrink-0"></span>
                ) : tab.favicon ? (
                  <img src={tab.favicon} alt="" className="w-3.5 h-3.5 rounded shrink-0" />
                ) : (
                  <span className="text-xs shrink-0">🌐</span>
                )}
                <span className="truncate text-xs">{tab.title || '新标签页'}</span>
              </div>
              <button
                onClick={(e) => handleCloseTab(tab.id, e)}
                className="opacity-0 group-hover:opacity-100 ml-1.5 p-0.5 rounded-full hover:bg-slate-800 text-slate-500 hover:text-white transition-opacity text-[11px]"
              >
                ✕
              </button>
            </div>
          )
        })}

        {/* 新建标签按钮 */}
        <button
          onClick={() => handleNewTab()}
          className="p-1.5 mb-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white text-xs transition-colors"
          title="打开新标签页"
        >
          +
        </button>
      </div>

      {/* 导航控制与地址栏 */}
      <div className="h-12 bg-slate-900 px-3 flex items-center gap-2 border-b border-slate-800/80 shrink-0">
        {/* 前进后退刷新按钮组 */}
        <div className="flex items-center gap-1">
          <button
            onClick={handleGoBack}
            disabled={!activeTab.canGoBack}
            className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-300 disabled:opacity-30 transition-colors text-xs"
            title="后退"
          >
            ◀
          </button>
          <button
            onClick={handleGoForward}
            disabled={!activeTab.canGoForward}
            className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-300 disabled:opacity-30 transition-colors text-xs"
            title="前进"
          >
            ▶
          </button>
          <button
            onClick={handleReload}
            className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-300 transition-colors text-xs"
            title={activeTab.isLoading ? '停止加载' : '刷新页面'}
          >
            {activeTab.isLoading ? '✕' : '🔄'}
          </button>
          <button
            onClick={handleGoHome}
            className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-300 transition-colors text-xs"
            title="主页"
          >
            🏠
          </button>
        </div>

        {/* 搜索引擎选择器 */}
        <select
          value={searchEngine}
          onChange={(e) => setSearchEngine(e.target.value as SearchEngine)}
          className="bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5 text-[11px] text-slate-300 focus:outline-none cursor-pointer"
        >
          <option value="bing">Bing 必应</option>
          <option value="baidu">百度</option>
          <option value="google">Google</option>
          <option value="duckduckgo">DuckDuckGo</option>
        </select>

        {/* 智能地址栏 */}
        <div className="flex-1 relative flex items-center">
          <span className="absolute left-3 text-xs text-slate-500">
            {activeTab.url.startsWith('https://') ? '🔒' : '🌐'}
          </span>
          <input
            type="text"
            value={activeTab.inputUrl}
            onChange={(e) => updateTab(activeTab.id, { inputUrl: e.target.value })}
            onKeyDown={(e) => e.key === 'Enter' && handleNavigate()}
            placeholder="输入网址或搜索关键词..."
            className="w-full pl-8 pr-20 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500/60 font-mono transition-colors"
          />
          <div className="absolute right-2 flex items-center gap-1">
            {activeTab.url !== 'about:blank' && (
              <button
                onClick={toggleBookmark}
                className={`p-1 text-xs transition-colors ${
                  isBookmarked ? 'text-amber-400' : 'text-slate-500 hover:text-amber-400'
                }`}
                title={isBookmarked ? '已收藏' : '添加至书签'}
              >
                ★
              </button>
            )}
            <button
              onClick={() => handleNavigate()}
              className="px-2.5 py-0.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-medium transition-colors"
            >
              前往
            </button>
          </div>
        </div>

        {/* 外链与复制 */}
        <div className="flex items-center gap-1">
          <button
            onClick={handleCopyUrl}
            className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-slate-200 text-xs transition-colors"
            title="复制网址"
          >
            📋
          </button>
          <button
            onClick={handleOpenExternal}
            className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-slate-200 text-xs transition-colors"
            title="在系统默认浏览器中打开"
          >
            ↗️
          </button>
        </div>
      </div>

      {/* 快捷书签栏 */}
      {bookmarks.length > 0 && (
        <div className="h-7 bg-slate-950/40 px-3 flex items-center gap-2 border-b border-slate-800/40 overflow-x-auto shrink-0 text-[11px]">
          <span className="text-slate-500 font-mono text-[10px]">书签:</span>
          {bookmarks.map((bm) => (
            <button
              key={bm.id}
              onClick={() => handleNavigate(bm.url)}
              className="flex items-center gap-1 px-2 py-0.5 rounded-md hover:bg-slate-800 text-slate-300 transition-colors whitespace-nowrap"
            >
              <span>{bm.icon || '🔖'}</span>
              <span>{bm.title}</span>
            </button>
          ))}
        </div>
      )}

      {/* 核心视图区域 */}
      <div className="flex-1 relative w-full h-full overflow-hidden bg-slate-950">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTab.id
          const isBlank = !tab.url || tab.url === 'about:blank'

          return (
            <div
              key={tab.id}
              className={`absolute inset-0 w-full h-full flex flex-col ${
                isActive ? 'visible z-10' : 'invisible z-0 pointer-events-none'
              }`}
            >
              {/* 新标签页导航起始卡片 */}
              {isBlank ? (
                <div className="flex-1 flex flex-col items-center justify-center p-8 space-y-6">
                  <div className="text-center space-y-2">
                    <div className="text-5xl mb-2">🌐</div>
                    <h2 className="text-xl font-bold text-white tracking-wide">豆角内置隔离浏览器</h2>
                    <p className="text-xs text-slate-400 max-w-md">
                      支持 Chromium 完整内核渲染、独立持久化存储分区与极速快捷寻址
                    </p>
                  </div>

                  {/* 快捷搜索框 */}
                  <div className="w-full max-w-lg relative flex items-center shadow-xl shadow-blue-500/5">
                    <span className="absolute left-4 text-sm text-slate-500">🔍</span>
                    <input
                      type="text"
                      placeholder={`使用 ${searchEngine.toUpperCase()} 搜索或输入网址...`}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          handleNavigate((e.target as HTMLInputElement).value)
                        }
                      }}
                      className="w-full pl-10 pr-24 py-3 rounded-2xl bg-slate-900 border border-slate-800 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500/60 shadow-inner"
                      autoFocus
                    />
                    <button
                      onClick={(e) => {
                        const input = (e.currentTarget.parentElement?.querySelector('input') as HTMLInputElement)
                        if (input) handleNavigate(input.value)
                      }}
                      className="absolute right-3 px-4 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-md shadow-blue-600/20 transition-all"
                    >
                      搜索
                    </button>
                  </div>

                  {/* 快捷入口网格 */}
                  <div className="grid grid-cols-3 gap-3 w-full max-w-lg mt-4">
                    {bookmarks.slice(0, 6).map((bm) => (
                      <div
                        key={bm.id}
                        onClick={() => handleNavigate(bm.url)}
                        className="p-3 rounded-xl bg-slate-900/60 border border-slate-800/80 hover:bg-slate-900 hover:border-blue-500/40 cursor-pointer transition-all flex items-center gap-3 group"
                      >
                        <span className="text-xl group-hover:scale-110 transition-transform">{bm.icon || '🌐'}</span>
                        <div className="overflow-hidden">
                          <div className="text-xs font-semibold text-slate-200 group-hover:text-blue-400 truncate">
                            {bm.title}
                          </div>
                          <div className="text-[10px] text-slate-500 truncate font-mono">{bm.url.replace(/^https?:\/\//, '')}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                /* 真实 Chromium 沙箱 Webview */
                <webview
                  ref={(el: any) => {
                    if (el) webviewRefs.current.set(tab.id, el)
                  }}
                  src={tab.url}
                  partition="persist:doujiao-browser"
                  className="w-full h-full flex-1 border-0"
                />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
