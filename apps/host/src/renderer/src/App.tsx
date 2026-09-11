import React, { useState, useEffect, useRef } from 'react'
import appIcon from './assets/app-icon.png'

interface PluginInfo {
  id: string
  name: string
  version: string
  description: string
  icon?: string
  publisher?: string
  isDev?: boolean
  isInstalled?: boolean
  enabled?: boolean
  manifest?: any
}

interface MarketPlugin {
  id: string
  publisher: string
  name: string
  description: string
  icon?: string
  latestVersion: string
  changelog: string
  size: number
  permissions: any[]
  isInstalled: boolean
  installedVersion?: string
  hasUpdate: boolean
  isDev?: boolean
  enabled?: boolean
}

interface FFmpegStatus {
  installed: boolean
  version?: string
  path?: string
  source?: string
  error?: string
}

interface PermissionDiffModalData {
  pluginId: string
  name: string
  currentVersion: string
  newVersion: string
  changelog: string
  addedCapabilities: string[]
  addedHosts: string[]
}

interface ProxyConfigState {
  mode: 'system' | 'direct' | 'custom'
  customProxyUrl: string
  bypassRules: string
  effectiveProxy: string
}

export type AppTheme = 'dark' | 'light' | 'cyber'

export interface ThemeConfig {
  id: AppTheme
  name: string
  icon: string
  desc: string
  appBg: string
  headerBg: string
  sidebarBg: string
  mainBg: string
  cardBg: string
  subcardBg: string
  border: string
  textPrimary: string
  textSecondary: string
  textMuted: string
  btnGhost: string
  drawerBg: string
  hoverText: string
  hoverBg: string
}

export const THEMES: Record<AppTheme, ThemeConfig> = {
  dark: {
    id: 'dark',
    name: '深色暗黑',
    icon: '🌙',
    desc: '经典极客黑灰，低调沉浸，夜间护眼',
    appBg: 'bg-[#0b0f19]',
    headerBg: 'bg-slate-900',
    sidebarBg: 'bg-slate-900',
    mainBg: 'bg-slate-950',
    cardBg: 'bg-slate-900',
    subcardBg: 'bg-slate-950/60',
    border: 'border-slate-800',
    textPrimary: 'text-white',
    textSecondary: 'text-slate-300',
    textMuted: 'text-slate-500',
    btnGhost: 'bg-slate-800 hover:bg-slate-700 text-slate-300',
    drawerBg: 'bg-slate-900',
    hoverText: 'hover:text-white',
    hoverBg: 'hover:bg-slate-800'
  },
  light: {
    id: 'light',
    name: '明亮浅色',
    icon: '☀️',
    desc: '清爽明亮浅白，对比清晰，日光环境更舒适',
    appBg: 'bg-slate-100',
    headerBg: 'bg-white',
    sidebarBg: 'bg-white',
    mainBg: 'bg-slate-50',
    cardBg: 'bg-white shadow-sm',
    subcardBg: 'bg-slate-100',
    border: 'border-slate-200',
    textPrimary: 'text-slate-900',
    textSecondary: 'text-slate-700',
    textMuted: 'text-slate-500',
    btnGhost: 'bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-200/80',
    drawerBg: 'bg-white',
    hoverText: 'hover:text-slate-900',
    hoverBg: 'hover:bg-slate-200'
  },
  cyber: {
    id: 'cyber',
    name: '科技深蓝',
    icon: '🌊',
    desc: '深邃赛博海蓝，科技质感，流光溢彩',
    appBg: 'bg-[#060d19]',
    headerBg: 'bg-[#0a1526]',
    sidebarBg: 'bg-[#07101f]',
    mainBg: 'bg-[#030712]',
    cardBg: 'bg-[#0c1b33]',
    subcardBg: 'bg-[#050d19]/80',
    border: 'border-[#1a365d]',
    textPrimary: 'text-sky-100',
    textSecondary: 'text-sky-200',
    textMuted: 'text-sky-400/60',
    btnGhost: 'bg-[#10223d] hover:bg-[#183259] text-sky-200 border border-sky-900/50',
    drawerBg: 'bg-[#0a1526]',
    hoverText: 'hover:text-sky-100',
    hoverBg: 'hover:bg-[#10223d]'
  }
}

function getPluginEmoji(plugin: { id?: string; icon?: string }): string {
  if (plugin.icon && !plugin.icon.includes('/')) return plugin.icon
  const id = plugin.id || ''
  if (id.includes('douyin')) return '🎵'
  if (id.includes('bilibili')) return '📺'
  if (id.includes('markdown')) return '📝'
  if (id.includes('notepad')) return '🗒️'
  if (id.includes('clipboard')) return '📋'
  if (id.includes('browser')) return '🌐'
  if (id.includes('samba')) return '🗄️'
  if (id.includes('album') || id.includes('photo')) return '📸'
  if (id.includes('image-editor')) return '🎨'
  if (id.includes('dev-toys') || id.includes('devtoys')) return '🛠️'
  if (id.includes('ocr')) return '🔍'
  if (id.includes('media-converter') || id.includes('convert')) return '🎬'
  return '🧩'
}

export default function App(): JSX.Element {
  const [plugins, setPlugins] = useState<PluginInfo[]>([])
  const [marketPlugins, setMarketPlugins] = useState<MarketPlugin[]>([])
  const [activeTab, setActiveTab] = useState<string>('market')
  const [tasks, setTasks] = useState<any[]>([])
  const [showTasksDrawer, setShowTasksDrawer] = useState(false)
  const [douyinLoggedIn, setDouyinLoggedIn] = useState(false)
  const [installMsg, setInstallMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const [ffmpegStatus, setFFmpegStatus] = useState<FFmpegStatus>({ installed: false })
  const [loadingMarket, setLoadingMarket] = useState(false)
  const [installingPluginId, setInstallingPluginId] = useState<string | null>(null)
  const [isInstallingAll, setIsInstallingAll] = useState(false)
  const [installAllProgress, setInstallAllProgress] = useState<{ current: number; total: number; name: string } | null>(null)
  const [ffmpegLoading, setFFmpegLoading] = useState(false)
  const [ffmpegProgress, setFFmpegProgress] = useState<{ percent: number; speed?: string; text?: string } | null>(null)
  const [ffmpegCardMsg, setFFmpegCardMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const [permissionModal, setPermissionModal] = useState<PermissionDiffModalData | null>(null)

  // 网络代理配置状态 (默认跟随系统代理)
  const [proxyConfig, setProxyConfig] = useState<ProxyConfigState>({
    mode: 'system',
    customProxyUrl: 'http://127.0.0.1:7890',
    bypassRules: '<local>;localhost;127.0.0.1',
    effectiveProxy: 'DIRECT'
  })
  const [savingProxy, setSavingProxy] = useState(false)
  const [testingProxy, setTestingProxy] = useState(false)
  const [testResult, setTestResult] = useState<{
    success: boolean
    latencyMs?: number
    effectiveProxy: string
    error?: string
  } | null>(null)

  // 主程序版本与在线更新状态
  const [hostVersion, setHostVersion] = useState<string>('0.2.1')
  const [autoCheckUpdate, setAutoCheckUpdate] = useState<boolean>(true)
  const [checkingUpdate, setCheckingUpdate] = useState<boolean>(false)
  const [updateInfo, setUpdateInfo] = useState<any | null>(null)
  const [showUpdateModal, setShowUpdateModal] = useState<boolean>(false)
  const [downloadingUpdate, setDownloadingUpdate] = useState<boolean>(false)
  const [updateProgress, setUpdateProgress] = useState<any | null>(null)
  const [updateDownloaded, setUpdateDownloaded] = useState<boolean>(false)
  const [updateCardMsg, setUpdateCardMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null)

  // 置顶插件 ID 列表 (持久化于 localStorage，排列顺序即主侧边栏显示顺序)
  const [pinnedPluginIds, setPinnedPluginIds] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('doujiao_pinned_plugins')
      if (saved) return JSON.parse(saved)
    } catch {}
    return []
  })

  // 拖动排序状态
  const [draggedPluginId, setDraggedPluginId] = useState<string | null>(null)
  const [dragOverPluginId, setDragOverPluginId] = useState<string | null>(null)
  const [dropPosition, setDropPosition] = useState<'before' | 'after' | null>(null)

  // 更多插件弹出菜单状态与定位
  const [moreMenuOpen, setMoreMenuOpen] = useState(false)
  const [moreMenuPos, setMoreMenuPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 })
  const moreTimeoutRef = useRef<any>(null)

  // 统一文件存储与工作目录状态
  const [workspaces, setWorkspaces] = useState<{ downloads: string; notepad: string; markdown: string }>({
    downloads: '',
    notepad: '',
    markdown: ''
  })

  // 侧边栏折叠状态 (展开 240px，折叠 68px，持久化于 localStorage)
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('doujiao_sidebar_collapsed') === 'true'
    } catch {
      return false
    }
  })

  // 应用主体/主题状态 (dark: 深色暗黑 | light: 明亮浅色 | cyber: 科技深蓝)
  const [theme, setTheme] = useState<AppTheme>(() => {
    try {
      const saved = localStorage.getItem('doujiao_theme') as AppTheme
      if (saved && THEMES[saved]) return saved
    } catch {}
    return 'dark'
  })

  const currentTheme = THEMES[theme] || THEMES.dark

  const handleSetTheme = (newTheme: AppTheme) => {
    setTheme(newTheme)
    try {
      localStorage.setItem('doujiao_theme', newTheme)
    } catch {}
    document.documentElement.setAttribute('data-theme', newTheme)
    window.hostAPI?.setTheme?.(newTheme)
  }

  const handleCycleTheme = () => {
    const themeOrder: AppTheme[] = ['dark', 'light', 'cyber']
    const nextIdx = (themeOrder.indexOf(theme) + 1) % themeOrder.length
    handleSetTheme(themeOrder[nextIdx])
  }

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    window.hostAPI?.setTheme?.(theme)
  }, [theme])

  // 同步侧边栏宽度给主进程 WebContentsView 视口边界
  useEffect(() => {
    const width = sidebarCollapsed ? 68 : 240
    try {
      localStorage.setItem('doujiao_sidebar_collapsed', String(sidebarCollapsed))
    } catch {}
    window.hostAPI?.setSidebarWidth?.(width)
  }, [sidebarCollapsed])

  // 同步右侧下载管理抽屉宽度给主进程 WebContentsView (抽屉打开时缩窄 384px 保证抽屉完全可见且可交互)
  useEffect(() => {
    window.hostAPI?.setRightDrawerWidth?.(showTasksDrawer ? 384 : 0)
  }, [showTasksDrawer])

  // 更多插件菜单现由主进程原生悬浮层 (MoreMenuPopoverManager) 接管，完全悬浮且不挤压主视口 WebContentsView

  // 按 Escape 键自动收起下载抽屉
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && showTasksDrawer) {
        setShowTasksDrawer(false)
      }
    }
    window.addEventListener('keydown', handleEsc)
    return () => window.removeEventListener('keydown', handleEsc)
  }, [showTasksDrawer])

  // 快捷键 Ctrl+B (或 Cmd+B) 切换折叠侧边栏
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault()
        setSidebarCollapsed((prev) => !prev)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  // 1. 加载本地与已安装插件
  const fetchPlugins = async () => {
    if (window.hostAPI?.listPlugins) {
      const list = await window.hostAPI.listPlugins()
      setPlugins(list || [])
      setActiveTab((prev) => {
        if (prev === 'market' || prev === 'settings') return prev
        const exists = list && list.some((p: any) => p.id === prev)
        return exists ? prev : 'market'
      })
    }
  }

  // 首次运行若未设置过置顶列表，默认将前 4 个常用插件设为置顶；同时清理已卸载插件的 ID
  useEffect(() => {
    if (plugins.length > 0) {
      try {
        const saved = localStorage.getItem('doujiao_pinned_plugins')
        if (saved === null) {
          const initialPinned = plugins.slice(0, 4).map((p) => p.id)
          setPinnedPluginIds(initialPinned)
          localStorage.setItem('doujiao_pinned_plugins', JSON.stringify(initialPinned))
        } else {
          const validIds = new Set(plugins.map((p) => p.id))
          setPinnedPluginIds((prev) => {
            const cleaned = prev.filter((id) => validIds.has(id))
            if (cleaned.length !== prev.length) {
              localStorage.setItem('doujiao_pinned_plugins', JSON.stringify(cleaned))
              return cleaned
            }
            return prev
          })
        }
      } catch {}
    }
  }, [plugins])

  // 切换置顶状态（置顶 / 取消置顶移入更多）
  const handleTogglePin = (pluginId: string, e?: React.MouseEvent) => {
    e?.stopPropagation()
    setPinnedPluginIds((prev) => {
      let next: string[]
      if (prev.includes(pluginId)) {
        next = prev.filter((id) => id !== pluginId)
      } else {
        next = [...prev, pluginId]
      }
      try {
        localStorage.setItem('doujiao_pinned_plugins', JSON.stringify(next))
      } catch {}
      return next
    })
  }

  // 拖拽排序逻辑
  const handleDragStart = (e: React.DragEvent, id: string) => {
    e.dataTransfer.setData('text/plain', id)
    e.dataTransfer.effectAllowed = 'move'
    setDraggedPluginId(id)
  }

  const handleDragOver = (e: React.DragEvent, targetId: string) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (draggedPluginId === targetId) return

    const rect = e.currentTarget.getBoundingClientRect()
    const midY = rect.top + rect.height / 2
    const pos = e.clientY < midY ? 'before' : 'after'

    setDragOverPluginId(targetId)
    setDropPosition(pos)
  }

  const handleDragLeave = (e: React.DragEvent, targetId: string) => {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return
    if (dragOverPluginId === targetId) {
      setDragOverPluginId(null)
      setDropPosition(null)
    }
  }

  const handleDrop = (e: React.DragEvent, targetId: string) => {
    e.preventDefault()
    const sourceId = e.dataTransfer.getData('text/plain') || draggedPluginId
    if (sourceId && targetId && sourceId !== targetId) {
      setPinnedPluginIds((prev) => {
        const sourceIndex = prev.indexOf(sourceId)
        let targetIndex = prev.indexOf(targetId)
        if (sourceIndex === -1 || targetIndex === -1) return prev

        const next = [...prev]
        const [movedItem] = next.splice(sourceIndex, 1)

        targetIndex = next.indexOf(targetId)
        const insertIndex = dropPosition === 'after' ? targetIndex + 1 : targetIndex
        next.splice(insertIndex, 0, movedItem)

        try {
          localStorage.setItem('doujiao_pinned_plugins', JSON.stringify(next))
        } catch {}
        return next
      })
    }
    setDraggedPluginId(null)
    setDragOverPluginId(null)
    setDropPosition(null)
  }

  const handleDragEnd = () => {
    setDraggedPluginId(null)
    setDragOverPluginId(null)
    setDropPosition(null)
  }

  // 计算置顶插件与未置顶插件列表
  const pinnedPlugins: PluginInfo[] = pinnedPluginIds
    .map((id) => plugins.find((p) => p.id === id))
    .filter((p): p is PluginInfo => Boolean(p))

  const unpinnedPlugins: PluginInfo[] = plugins.filter(
    (p) => !pinnedPluginIds.includes(p.id)
  )

  // 更多插件按钮悬停与弹出控制 (原生独立悬浮层，不挤压主视口 WebContentsView)
  const handleMoreMouseEnter = (e: React.MouseEvent) => {
    if (moreTimeoutRef.current) clearTimeout(moreTimeoutRef.current)
    const rect = e.currentTarget.getBoundingClientRect()
    const left = sidebarCollapsed ? 68 + 4 : 240 + 4
    window.hostAPI?.showMoreMenuPopover?.({
      top: rect.top,
      left,
      plugins: unpinnedPlugins.map((p) => ({
        id: p.id,
        name: p.name,
        icon: p.icon,
        enabled: p.enabled !== false,
        isDev: p.isDev
      })),
      activeTab,
      theme
    })
  }

  const handleMoreClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (moreTimeoutRef.current) clearTimeout(moreTimeoutRef.current)
    const rect = e.currentTarget.getBoundingClientRect()
    const left = sidebarCollapsed ? 68 + 4 : 240 + 4
    window.hostAPI?.showMoreMenuPopover?.({
      top: rect.top,
      left,
      plugins: unpinnedPlugins.map((p) => ({
        id: p.id,
        name: p.name,
        icon: p.icon,
        enabled: p.enabled !== false,
        isDev: p.isDev
      })),
      activeTab,
      theme
    })
  }

  const handleMoreMouseLeave = () => {
    window.hostAPI?.scheduleHideMoreMenuPopover?.(250)
  }

  // 2. 加载远端插件市场聚合清单
  const fetchMarket = async (force = false) => {
    if (window.hostAPI?.fetchMarketPlugins) {
      setLoadingMarket(true)
      try {
        const res = await window.hostAPI.fetchMarketPlugins(force)
        let list: MarketPlugin[] = []
        let fromRemote = false
        let version = 0
        let errorMsg = ''

        if (Array.isArray(res)) {
          list = res
        } else if (res && Array.isArray(res.plugins)) {
          list = res.plugins
          fromRemote = res.fromRemote
          version = res.registryVersion
          errorMsg = res.error
        }

        setMarketPlugins(list)

        if (force) {
          if (fromRemote) {
            setInstallMsg({
              text: `✓ 已成功直连 GitHub 同步最新插件市场清单 (版本: v${version})！`,
              type: 'success'
            })
          } else {
            setInstallMsg({
              text: `⚠️ GitHub 连接较慢 (${errorMsg || '网络超时'})，已载入本地最新索引缓存。您可前往「系统设置」切换或测试代理。`,
              type: 'error'
            })
          }
          setTimeout(() => setInstallMsg(null), 4000)
        }
      } catch (err: any) {
        console.error('拉取市场清单失败:', err)
        if (force) {
          setInstallMsg({ text: `刷新异常: ${err?.message}`, type: 'error' })
          setTimeout(() => setInstallMsg(null), 4000)
        }
      } finally {
        setLoadingMarket(false)
      }
    }
  }

  // 3. 检查 FFmpeg 状态
  const checkFFmpeg = async () => {
    if (window.hostAPI?.getFFmpegStatus) {
      try {
        const res = await window.hostAPI.getFFmpegStatus()
        setFFmpegStatus(res || { installed: false })
      } catch {}
    }
  }

  // 4. 检查抖音登录状态
  const checkDouyinStatus = async () => {
    if (window.hostAPI?.getDouyinStatus) {
      const res = await window.hostAPI.getDouyinStatus()
      setDouyinLoggedIn(res.loggedIn)
    }
  }

  // 5. 获取网络代理设置与当前 GitHub 连通有效代理
  const fetchProxyConfig = async () => {
    if (window.hostAPI?.getProxyStatus) {
      try {
        const res = await window.hostAPI.getProxyStatus()
        if (res) setProxyConfig(res)
      } catch {}
    }
  }

  useEffect(() => {
    fetchPlugins()
    fetchMarket()   // 本地数据秒级显示，后台异步拉取最新 registry
    checkFFmpeg()
    checkDouyinStatus()
    fetchProxyConfig()
    fetchWorkspaces()

    window.hostAPI?.getHostVersion?.().then((v: string) => {
      if (v) setHostVersion(v)
    })
    window.hostAPI?.getAppUpdateConfig?.().then((cfg: any) => {
      if (cfg && typeof cfg.autoCheck === 'boolean') setAutoCheckUpdate(cfg.autoCheck)
    })

    let cleanupProgress: (() => void) | undefined
    if (window.hostAPI?.onFFmpegInstallProgress) {
      cleanupProgress = window.hostAPI.onFFmpegInstallProgress((p) => {
        setFFmpegProgress(p)
      })
    }

    let cleanupUpdateAvailable: (() => void) | undefined
    if (window.hostAPI?.onAppUpdateAvailable) {
      cleanupUpdateAvailable = window.hostAPI.onAppUpdateAvailable((info: any) => {
        if (info && info.hasUpdate) {
          setUpdateInfo(info)
          setShowUpdateModal(true)
        }
      })
    }

    let cleanupUpdateProgress: (() => void) | undefined
    if (window.hostAPI?.onAppUpdateProgress) {
      cleanupUpdateProgress = window.hostAPI.onAppUpdateProgress((p: any) => {
        setUpdateProgress(p)
        if (p.status === 'completed') {
          setDownloadingUpdate(false)
          setUpdateDownloaded(true)
        } else if (p.status === 'failed') {
          setDownloadingUpdate(false)
        }
      })
    }

    return () => {
      cleanupProgress?.()
      cleanupUpdateAvailable?.()
      cleanupUpdateProgress?.()
    }
  }, [])

  // 监听 Tab 切换挂载/隐藏沙箱插件
  useEffect(() => {
    if (activeTab !== 'market' && activeTab !== 'settings') {
      window.hostAPI?.showPlugin(activeTab)
    } else {
      window.hostAPI?.hidePlugin()
    }
  }, [activeTab])

  // 监听来自主进程的外壳导航指令 (例如全局截图后自动激活图片编辑插件)
  useEffect(() => {
    const cleanup = window.hostAPI?.onNavigate?.((tab: string) => {
      if (tab) {
        setActiveTab(tab)
      }
    })
    return () => cleanup?.()
  }, [])

  // 定期拉取下载任务列表
  useEffect(() => {
    const fetchTasks = async () => {
      if (window.hostAPI?.listTasks) {
        const list = await window.hostAPI.listTasks()
        setTasks(list || [])
      }
    }
    fetchTasks()
    const interval = setInterval(fetchTasks, 1500)
    return () => clearInterval(interval)
  }, [])

  // 本地安装 ZIP 插件
  const handleInstallZip = async () => {
    if (!window.hostAPI?.installPluginZip) return
    const res = await window.hostAPI.installPluginZip()
    if (res.canceled) return

    if (res.success) {
      setInstallMsg({ text: `插件 ${res.pluginId}@${res.version} 事务安装成功！`, type: 'success' })
      await fetchPlugins()
      await fetchMarket(true)
      if (res.pluginId) {
        setActiveTab(res.pluginId)
      }
    } else {
      setInstallMsg({ text: `安装失败: ${res.error || '未知原因'}`, type: 'error' })
    }
    setTimeout(() => setInstallMsg(null), 5000)
  }

  // 在线市场一键安装
  const handleMarketInstall = async (plugin: MarketPlugin) => {
    if (!window.hostAPI?.installMarketPlugin) return
    setInstallingPluginId(plugin.id)

    try {
      const res = await window.hostAPI.installMarketPlugin(plugin.id, plugin.latestVersion)
      if (res.success) {
        setInstallMsg({
          text: `插件【${plugin.name}】v${plugin.latestVersion} 安装成功！`,
          type: 'success'
        })
        await fetchPlugins()
        await fetchMarket(true)
        setActiveTab(plugin.id)
      } else {
        setInstallMsg({ text: `安装失败: ${res.error || '未知错误'}`, type: 'error' })
      }
    } catch (err: any) {
      setInstallMsg({ text: `安装异常: ${err?.message}`, type: 'error' })
    } finally {
      setInstallingPluginId(null)
      setTimeout(() => setInstallMsg(null), 5000)
    }
  }

  // 检查更新并触发权限变更确认
  const handleTriggerUpdate = async (plugin: MarketPlugin) => {
    if (!window.hostAPI?.checkPluginUpdates) return
    try {
      const updates = await window.hostAPI.checkPluginUpdates()
      const thisUpdate = updates.find((u: any) => u.pluginId === plugin.id)

      if (thisUpdate && thisUpdate.hasPermissionChanges) {
        // 弹出权限变更审计弹窗 (Permission Diff Modal)
        setPermissionModal({
          pluginId: thisUpdate.pluginId,
          name: thisUpdate.name,
          currentVersion: thisUpdate.currentVersion,
          newVersion: thisUpdate.latestVersion,
          changelog: thisUpdate.changelog,
          addedCapabilities: thisUpdate.addedCapabilities || [],
          addedHosts: thisUpdate.addedHosts || []
        })
        return
      }

      // 无敏感权限扩展，直接执行更新
      await executeUpdate(plugin.id, plugin.latestVersion)
    } catch (err: any) {
      setInstallMsg({ text: `更新检查失败: ${err?.message}`, type: 'error' })
    }
  }

  // 用户同意权限后正式执行更新
  const executeUpdate = async (pluginId: string, version: string) => {
    if (!window.hostAPI?.applyPluginUpdate) return
    setInstallingPluginId(pluginId)
    setPermissionModal(null)

    try {
      const res = await window.hostAPI.applyPluginUpdate(pluginId, version)
      if (res.success) {
        setInstallMsg({
          text: `插件 ${pluginId} 已成功升级至 v${version}！`,
          type: 'success'
        })
        await fetchPlugins()
        await fetchMarket(true)
      } else {
        setInstallMsg({ text: `升级失败: ${res.error || '未知错误'}`, type: 'error' })
      }
    } catch (err: any) {
      setInstallMsg({ text: `升级异常: ${err?.message}`, type: 'error' })
    } finally {
      setInstallingPluginId(null)
      setTimeout(() => setInstallMsg(null), 5000)
    }
  }

  // 卸载插件
  const handleUninstall = async (pluginId: string, pluginName?: string) => {
    const name = pluginName || pluginId
    const confirmed = window.confirm(`确定要卸载插件【${name}】吗？\n卸载后将移除该插件在本地的所有版本和配置数据。`)
    if (!confirmed) return

    if (!window.hostAPI?.uninstallPlugin) return
    try {
      const res = await window.hostAPI.uninstallPlugin(pluginId)
      if (res.success) {
        setInstallMsg({ text: `插件【${name}】已成功卸载！`, type: 'success' })
        if (activeTab === pluginId) {
          setActiveTab('market')
        }
        await fetchPlugins()
        await fetchMarket(true)
      } else {
        setInstallMsg({ text: `卸载失败，文件可能被系统占用，请稍后重试`, type: 'error' })
      }
    } catch (err: any) {
      setInstallMsg({ text: `卸载异常: ${err?.message}`, type: 'error' })
    } finally {
      setTimeout(() => setInstallMsg(null), 4000)
    }
  }

  // 切换插件启用/禁用状态
  const handleTogglePlugin = async (pluginId: string, enabled: boolean) => {
    if (!window.hostAPI?.togglePlugin) return
    try {
      const res = await window.hostAPI.togglePlugin(pluginId, enabled)
      if (res && res.success) {
        const targetPlugin = plugins.find((p) => p.id === pluginId) || marketPlugins.find((p) => p.id === pluginId)
        const name = targetPlugin?.name || pluginId
        setInstallMsg({
          text: `插件【${name}】已${enabled ? '启用' : '禁用'}！${
            pluginId === 'clipboard-history'
              ? enabled
                ? '（已恢复剪贴板后台监听与记录）'
                : '（已停止剪贴板后台监听与数据采集）'
              : ''
          }`,
          type: 'success'
        })
        if (!enabled && activeTab === pluginId) {
          setActiveTab('market')
        }
        await fetchPlugins()
        await fetchMarket()
      } else {
        setInstallMsg({ text: `操作失败: ${res?.error || '未知原因'}`, type: 'error' })
      }
    } catch (err: any) {
      setInstallMsg({ text: `操作异常: ${err?.message}`, type: 'error' })
    } finally {
      setTimeout(() => setInstallMsg(null), 4000)
    }
  }

  // 市场一键全部安装
  const handleInstallAll = async () => {
    const uninstalled = marketPlugins.filter((p) => !p.isInstalled)
    if (uninstalled.length === 0 || !window.hostAPI?.installMarketPlugin) return

    setIsInstallingAll(true)
    let successCount = 0
    let failCount = 0

    for (let i = 0; i < uninstalled.length; i++) {
      const p = uninstalled[i]
      setInstallAllProgress({ current: i + 1, total: uninstalled.length, name: p.name })
      try {
        const res = await window.hostAPI.installMarketPlugin(p.id, p.latestVersion)
        if (res && res.success) {
          successCount++
        } else {
          failCount++
          console.warn(`[InstallAll] 安装插件 ${p.name} 失败:`, res?.error)
        }
      } catch (err) {
        failCount++
        console.error(`[InstallAll] 安装插件 ${p.name} 异常:`, err)
      }
    }

    setIsInstallingAll(false)
    setInstallAllProgress(null)
    await fetchPlugins()
    await fetchMarket(true)

    if (failCount === 0) {
      setInstallMsg({
        text: `✓ 一键安装完成！已成功安装全部 ${successCount} 款插件。`,
        type: 'success'
      })
    } else {
      setInstallMsg({
        text: `批量安装完成：成功 ${successCount} 个，失败 ${failCount} 个。`,
        type: 'error'
      })
    }
    setTimeout(() => setInstallMsg(null), 5000)
  }

  // 点击打开插件（若被禁用则友好提示启用）
  const handleSelectPlugin = (plugin: { id: string; name: string; enabled?: boolean }) => {
    setMoreMenuOpen(false)
    if (plugin.enabled === false) {
      const confirmEnable = window.confirm(`插件【${plugin.name}】当前处于禁用状态，是否立即启用并打开？`)
      if (confirmEnable) {
        handleTogglePlugin(plugin.id, true).then(() => {
          setActiveTab(plugin.id)
        })
      }
      return
    }
    setActiveTab(plugin.id)
  }

  // 监听来自独立悬浮层 (MoreMenuPopover) 的用户交互指令 (打开插件、置顶切换、禁用/启用切换、卸载)
  useEffect(() => {
    const cleanup = window.hostAPI?.onMoreMenuAction?.((action: string, data: any) => {
      if (action === 'select') {
        const targetPlugin = plugins.find((p) => p.id === data.pluginId)
        if (targetPlugin) {
          handleSelectPlugin(targetPlugin)
        } else if (data.pluginId) {
          setActiveTab(data.pluginId)
        }
      } else if (action === 'pin') {
        handleTogglePin(data.pluginId)
      } else if (action === 'toggle') {
        handleTogglePlugin(data.pluginId, data.enabled)
      } else if (action === 'uninstall') {
        handleUninstall(data.pluginId, data.name)
      }
    })
    return () => cleanup?.()
  }, [plugins, pinnedPluginIds])

  // 网络代理切换与保存
  const handleUpdateProxyMode = async (mode: 'system' | 'direct' | 'custom') => {
    const updated = { ...proxyConfig, mode }
    setProxyConfig(updated)
    await handleSaveProxyConfig(updated)
  }

  const handleSaveProxyConfig = async (configToSave = proxyConfig) => {
    if (!window.hostAPI?.setProxyConfig) return
    setSavingProxy(true)
    try {
      const res = await window.hostAPI.setProxyConfig({
        mode: configToSave.mode,
        customProxyUrl: configToSave.customProxyUrl,
        bypassRules: configToSave.bypassRules
      })
      if (res) {
        setProxyConfig(res)
        setInstallMsg({
          text: `网络代理已切换为【${
            res.mode === 'system'
              ? '跟随系统代理 (默认)'
              : res.mode === 'direct'
              ? '关闭代理 (直连 GitHub)'
              : '自定义代理'
          }】！`,
          type: 'success'
        })
      }
    } catch (err: any) {
      setInstallMsg({ text: `保存代理设置失败: ${err?.message}`, type: 'error' })
    } finally {
      setSavingProxy(false)
      setTimeout(() => setInstallMsg(null), 4000)
    }
  }

  const handleTestGitHub = async () => {
    if (!window.hostAPI?.testGitHubConnectivity) return
    setTestingProxy(true)
    setTestResult(null)
    try {
      const res = await window.hostAPI.testGitHubConnectivity()
      setTestResult(res)
      if (res?.effectiveProxy) {
        setProxyConfig((prev) => ({ ...prev, effectiveProxy: res.effectiveProxy }))
      }
    } catch (err: any) {
      setTestResult({ success: false, effectiveProxy: 'DIRECT', error: err?.message || '请求超时' })
    } finally {
      setTestingProxy(false)
    }
  }

  // FFmpeg 操作
  const handleInstallFFmpeg = async () => {
    if (!window.hostAPI?.installFFmpeg) return
    setFFmpegLoading(true)
    setFFmpegProgress({ percent: 5, text: '正在连接高速下载源...' })
    setFFmpegCardMsg(null)
    try {
      const res = await window.hostAPI.installFFmpeg()
      if (res.success && res.status?.installed) {
        setFFmpegStatus(res.status)
        setFFmpegCardMsg({
          text: `FFmpeg 组件已就绪！(${res.status.version ? 'v' + res.status.version : '最新版本'})`,
          type: 'success'
        })
      } else {
        setFFmpegCardMsg({ text: res.error || 'FFmpeg 安装未完成，请重试或手动导入', type: 'error' })
      }
    } catch (err: any) {
      setFFmpegCardMsg({ text: err?.message || 'FFmpeg 安装异常', type: 'error' })
    } finally {
      setFFmpegLoading(false)
      setFFmpegProgress(null)
      setTimeout(() => setFFmpegCardMsg(null), 8000)
    }
  }

  const handleSelectFFmpegFile = async () => {
    if (!window.hostAPI?.selectFFmpegFile) return
    setFFmpegCardMsg(null)
    const res = await window.hostAPI.selectFFmpegFile()
    if (res.canceled) return

    if (res.success && res.status?.installed) {
      setFFmpegStatus(res.status)
      setFFmpegCardMsg({ text: '成功导入本地 FFmpeg 可执行文件！', type: 'success' })
    } else {
      setFFmpegCardMsg({ text: res.error || '导入失败，请选择有效的 ffmpeg.exe', type: 'error' })
    }
    setTimeout(() => setFFmpegCardMsg(null), 6000)
  }

  const handleOpenFFmpegDir = async () => {
    if (!window.hostAPI?.openFFmpegDir) return
    await window.hostAPI.openFFmpegDir()
  }

  // 宿主触发抖音扫码登录
  const handleDouyinLogin = async () => {
    if (!window.hostAPI?.loginDouyin) return
    const res = await window.hostAPI.loginDouyin()
    if (res.success) {
      setDouyinLoggedIn(true)
      setInstallMsg({ text: '抖音账号登录成功！', type: 'success' })
    } else {
      setInstallMsg({ text: res.message || '登录未完成', type: 'error' })
    }
    setTimeout(() => setInstallMsg(null), 4000)
  }

  // 工作目录管理
  const fetchWorkspaces = async () => {
    if (window.hostAPI?.getWorkspaceDirectories) {
      try {
        const dirs = await window.hostAPI.getWorkspaceDirectories()
        if (dirs) setWorkspaces(dirs)
      } catch {}
    }
  }

  const handleSelectWorkspaceDir = async (scope: string) => {
    if (!window.hostAPI?.selectWorkspaceDirectory || !window.hostAPI?.setWorkspaceDirectory) return
    const current = (workspaces as any)[scope]
    const res = await window.hostAPI.selectWorkspaceDirectory(current)
    if (!res.canceled && res.directoryPath) {
      await window.hostAPI.setWorkspaceDirectory(scope, res.directoryPath)
      await fetchWorkspaces()
      setInstallMsg({ text: '工作存储目录已成功更改！', type: 'success' })
      setTimeout(() => setInstallMsg(null), 3000)
    }
  }

  const handleResetWorkspaceDir = async (scope: string) => {
    if (!window.hostAPI?.resetWorkspaceDirectory) return
    await window.hostAPI.resetWorkspaceDirectory(scope)
    await fetchWorkspaces()
    setInstallMsg({ text: '已恢复默认工作目录！', type: 'success' })
    setTimeout(() => setInstallMsg(null), 3000)
  }

  const handleOpenWorkspaceDir = async (scope: string) => {
    if (!window.hostAPI?.openWorkspaceDirectory) return
    await window.hostAPI.openWorkspaceDirectory(scope)
  }

  // 主程序检测更新与下载安装
  const handleCheckHostUpdate = async (manual = true) => {
    if (!window.hostAPI?.checkAppUpdate) return
    setCheckingUpdate(true)
    setUpdateCardMsg(null)
    try {
      const info = await window.hostAPI.checkAppUpdate()
      if (info && info.hasUpdate) {
        setUpdateInfo(info)
        setShowUpdateModal(true)
      } else if (manual) {
        setUpdateCardMsg({
          text: `🎉 当前已是最新版本 (v${info?.currentVersion || hostVersion})`,
          type: 'success'
        })
        setTimeout(() => setUpdateCardMsg(null), 5000)
      }
    } catch (err: any) {
      if (manual) {
        setUpdateCardMsg({
          text: `检查更新失败: ${err?.message || '网络连接超时'}`,
          type: 'error'
        })
        setTimeout(() => setUpdateCardMsg(null), 5000)
      }
    } finally {
      setCheckingUpdate(false)
    }
  }

  const handleToggleAutoCheck = async (enabled: boolean) => {
    setAutoCheckUpdate(enabled)
    if (window.hostAPI?.setAppUpdateConfig) {
      await window.hostAPI.setAppUpdateConfig({ autoCheck: enabled })
    }
  }

  const handleStartDownloadUpdate = async () => {
    if (!window.hostAPI?.downloadAppUpdate) return
    setDownloadingUpdate(true)
    setUpdateDownloaded(false)
    setUpdateProgress({ percent: 1, transferred: 0, total: 0, speed: '0 KB/s', status: 'downloading' })
    try {
      const res = await window.hostAPI.downloadAppUpdate()
      if (res.success) {
        setUpdateDownloaded(true)
      } else {
        alert(`下载更新失败: ${res.error || '未知错误'}`)
      }
    } catch (err: any) {
      alert(`下载异常: ${err?.message}`)
    } finally {
      setDownloadingUpdate(false)
    }
  }

  const handleInstallAppUpdate = async () => {
    if (!window.hostAPI?.installAppUpdate) return
    try {
      await window.hostAPI.installAppUpdate()
    } catch (err: any) {
      alert(`拉起安装程序失败: ${err?.message}`)
    }
  }

  const activeDownloadsCount = tasks.filter((t) => t.status === 'downloading').length

  return (
    <div className={`flex flex-col h-screen w-screen overflow-hidden ${currentTheme.appBg} ${currentTheme.textPrimary} select-none transition-colors duration-200`}>
      {/* 顶部标题栏 (拖拽区) */}
      <header
        className={`h-12 border-b ${currentTheme.border} flex items-center justify-between px-4 ${currentTheme.headerBg} backdrop-blur z-20 transition-colors duration-200`}
        style={{ WebkitAppRegion: 'drag' } as any}
      >
        <div className="flex items-center gap-2.5">
          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            title={sidebarCollapsed ? '展开侧边栏 (Ctrl+B)' : '折叠侧边栏 (Ctrl+B)'}
            style={{ WebkitAppRegion: 'no-drag' } as any}
            className={`p-1.5 rounded-lg ${currentTheme.btnGhost} transition flex items-center justify-center cursor-pointer`}
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d={sidebarCollapsed ? "M4 6h16M4 12h16M4 18h16" : "M4 6h16M4 12h10M4 18h16"}
              />
            </svg>
          </button>
          <img
            src={appIcon}
            alt="Logo"
            className="w-7 h-7 object-contain flex-shrink-0 select-none drop-shadow-md transition-transform hover:scale-105"
          />
          <span className={`font-bold text-[14px] tracking-wide ${
            theme === 'light'
              ? 'text-emerald-700'
              : 'bg-gradient-to-r from-emerald-400 to-teal-200 bg-clip-text text-transparent'
          }`}>
            豆角工具箱 Doujiao
          </span>
        </div>

        {/* 右侧控制按钮 */}
        <div
          className="flex items-center gap-1.5"
          style={{ WebkitAppRegion: 'no-drag' } as any}
        >
          {/* 主体风格快速切换 */}
          <button
            onClick={handleCycleTheme}
            className={`px-2.5 py-1 text-xs rounded-md transition-colors flex items-center gap-1.5 cursor-pointer ${currentTheme.btnGhost}`}
            title={`应用主体风格: ${currentTheme.name} (点击一键切换)`}
          >
            <span>{currentTheme.icon}</span>
            <span className="hidden sm:inline font-medium">{currentTheme.name}</span>
          </button>

          {/* 下载托盘按钮 */}
          <button
            onClick={() => setShowTasksDrawer(!showTasksDrawer)}
            className={`relative px-3 py-1 mr-2 text-xs rounded-md transition-colors flex items-center gap-1.5 cursor-pointer ${
              showTasksDrawer
                ? 'bg-emerald-600 text-white font-medium shadow-sm'
                : currentTheme.btnGhost
            }`}
            title="查看所有下载任务与进度"
          >
            <span>📥 下载管理</span>
            {activeDownloadsCount > 0 && (
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span>
            )}
          </button>

          <button
            onClick={() => window.hostAPI?.minimize()}
            className={`w-8 h-8 flex items-center justify-center rounded transition-colors ${
              theme === 'light'
                ? 'hover:bg-slate-200 text-slate-600 hover:text-slate-900'
                : 'hover:bg-slate-800 text-slate-400 hover:text-white'
            }`}
          >
            ━
          </button>
          <button
            onClick={() => window.hostAPI?.maximize()}
            className={`w-8 h-8 flex items-center justify-center rounded transition-colors ${
              theme === 'light'
                ? 'hover:bg-slate-200 text-slate-600 hover:text-slate-900'
                : 'hover:bg-slate-800 text-slate-400 hover:text-white'
            }`}
          >
            □
          </button>
          <button
            onClick={() => window.hostAPI?.close()}
            className={`w-8 h-8 flex items-center justify-center hover:bg-rose-600 hover:text-white ${
              theme === 'light' ? 'text-slate-600' : 'text-slate-400'
            } rounded transition-colors`}
          >
            ✕
          </button>
        </div>
      </header>

      {/* 主体双栏布局 */}
      <div className="flex flex-1 overflow-hidden">
        {/* 左侧导航栏 */}
        <aside
          className={`${currentTheme.sidebarBg} border-r ${currentTheme.border} flex flex-col justify-between transition-all duration-200 ease-in-out z-10 relative flex-shrink-0 ${
            sidebarCollapsed ? 'w-[68px] p-2' : 'w-60 p-3'
          }`}
        >
          {/* 顶部标题与折叠开关 */}
          <div className={`flex items-center justify-between pb-2 border-b ${currentTheme.border} mb-2 px-1`}>
            {!sidebarCollapsed ? (
              <>
                <div className={`flex items-center gap-1.5 text-[11px] font-semibold tracking-wider ${currentTheme.textMuted} uppercase`}>
                  <span>置顶插件</span>
                  <span
                    className={`text-[10px] px-1.5 py-0.2 rounded-full ${currentTheme.subcardBg} text-emerald-600 dark:text-emerald-400 font-mono font-semibold`}
                    title={`已置顶 ${pinnedPlugins.length} 个 / 共安装 ${plugins.length} 个`}
                  >
                    {pinnedPlugins.length}{unpinnedPlugins.length > 0 ? `/${plugins.length}` : ''}
                  </span>
                </div>
                <button
                  onClick={() => setSidebarCollapsed(true)}
                  title="折叠侧边栏 (Ctrl+B)"
                  className={`p-1 rounded-md ${currentTheme.textMuted} ${currentTheme.hoverText} ${currentTheme.hoverBg} transition flex items-center justify-center text-xs`}
                >
                  ◀
                </button>
              </>
            ) : (
              <div className="w-full flex justify-center">
                <button
                  onClick={() => setSidebarCollapsed(false)}
                  title="展开侧边栏 (Ctrl+B)"
                  className={`p-1.5 rounded-lg ${currentTheme.textMuted} hover:text-emerald-500 ${currentTheme.hoverBg} transition flex items-center justify-center text-xs`}
                >
                  ▶
                </button>
              </div>
            )}
          </div>

          {/* 中间插件滚动列表（展示置顶插件与“更多”按钮） */}
          <div className="flex-1 overflow-y-auto overflow-x-hidden space-y-1.5 pr-0.5">
            {plugins.length === 0 ? (
              !sidebarCollapsed ? (
                <div className={`px-3 py-4 my-1 rounded-xl ${currentTheme.subcardBg} border ${currentTheme.border} text-center space-y-1.5`}>
                  <div className="text-xl opacity-60">📦</div>
                  <div className={`text-xs ${currentTheme.textMuted} font-medium`}>暂无安装插件</div>
                  <p className={`text-[10px] ${currentTheme.textMuted}`}>主程序纯净无预装</p>
                  <button
                    onClick={() => setActiveTab('market')}
                    className="text-[11px] text-emerald-500 hover:underline pt-1 inline-block"
                  >
                    前往插件市场安装 →
                  </button>
                </div>
              ) : (
                <div
                  onClick={() => setActiveTab('market')}
                  title="暂无插件，点击前往市场"
                  className={`w-12 h-12 mx-auto flex items-center justify-center rounded-xl ${currentTheme.subcardBg} border ${currentTheme.border} text-lg cursor-pointer hover:border-emerald-500/40`}
                >
                  📦
                </div>
              )
            ) : (
              <>
                {/* 1. 置顶插件列表（支持拖拽排序） */}
                {pinnedPlugins.map((plugin) => {
                  const isActive = activeTab === plugin.id
                  const emoji = getPluginEmoji(plugin)

                  if (sidebarCollapsed) {
                    return (
                      <div
                        key={plugin.id}
                        draggable={true}
                        onDragStart={(e) => handleDragStart(e, plugin.id)}
                        onDragOver={(e) => handleDragOver(e, plugin.id)}
                        onDragLeave={(e) => handleDragLeave(e, plugin.id)}
                        onDrop={(e) => handleDrop(e, plugin.id)}
                        onDragEnd={handleDragEnd}
                        className={`relative group flex justify-center transition-all ${
                          draggedPluginId === plugin.id ? 'opacity-40 scale-95' : ''
                        } ${
                          dragOverPluginId === plugin.id && dropPosition === 'before' ? 'border-t-2 !border-t-emerald-500' : ''
                        } ${
                          dragOverPluginId === plugin.id && dropPosition === 'after' ? 'border-b-2 !border-b-emerald-500' : ''
                        }`}
                      >
                        <button
                          onClick={() => handleSelectPlugin(plugin)}
                          className={`w-12 h-12 rounded-xl flex items-center justify-center transition-all relative ${
                            isActive
                              ? 'bg-emerald-500/15 text-emerald-500 border border-emerald-500/40 shadow-md ring-1 ring-emerald-500/20'
                              : theme === 'light'
                              ? 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 border border-transparent'
                              : theme === 'cyber'
                              ? 'text-sky-300/80 hover:bg-[#10223d] hover:text-sky-100 border border-transparent'
                              : 'text-slate-400 hover:bg-slate-800/90 hover:text-slate-200 border border-transparent'
                          } ${plugin.enabled === false ? 'opacity-50' : ''}`}
                          title={`${plugin.name}${plugin.enabled === false ? ' (已禁用)' : ''} (可拖拽排序)`}
                        >
                          {isActive && (
                            <span className="absolute left-0.5 top-2.5 bottom-2.5 w-1 rounded-full bg-emerald-500" />
                          )}
                          <span className="text-xl group-hover:scale-110 transition-transform">
                            {emoji}
                          </span>
                          {plugin.enabled === false && (
                            <span className="absolute bottom-1 right-1 text-[9px] leading-none select-none">⏸️</span>
                          )}
                        </button>
                      </div>
                    )
                  }

                  return (
                    <div
                      key={plugin.id}
                      draggable={true}
                      onDragStart={(e) => handleDragStart(e, plugin.id)}
                      onDragOver={(e) => handleDragOver(e, plugin.id)}
                      onDragLeave={(e) => handleDragLeave(e, plugin.id)}
                      onDrop={(e) => handleDrop(e, plugin.id)}
                      onDragEnd={handleDragEnd}
                      className={`group relative w-full flex items-center justify-between rounded-xl transition-all select-none ${
                        isActive
                          ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/30 shadow-xs'
                          : theme === 'light'
                          ? 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 border border-transparent'
                          : theme === 'cyber'
                          ? 'text-sky-300/80 hover:bg-[#10223d] hover:text-sky-100 border border-transparent'
                          : 'text-slate-400 hover:bg-slate-800/80 hover:text-slate-200 border border-transparent'
                      } ${
                        draggedPluginId === plugin.id ? 'opacity-40 scale-[0.98]' : ''
                      } ${
                        dragOverPluginId === plugin.id && dropPosition === 'before' ? 'border-t-2 !border-t-emerald-500' : ''
                      } ${
                        dragOverPluginId === plugin.id && dropPosition === 'after' ? 'border-b-2 !border-b-emerald-500' : ''
                      }`}
                    >
                      {isActive && (
                        <span className="absolute left-0 top-2 bottom-2 w-1 rounded-r bg-emerald-500" />
                      )}

                      <button
                        onClick={() => handleSelectPlugin(plugin)}
                        className={`flex items-center gap-2.5 px-2.5 py-2.5 flex-1 min-w-0 text-left cursor-pointer ${
                          plugin.enabled === false ? 'opacity-60' : ''
                        }`}
                      >
                        {/* 拖拽手柄图标 (悬停显现) */}
                        <span
                          className="opacity-0 group-hover:opacity-40 hover:!opacity-100 transition-opacity text-xs cursor-grab active:cursor-grabbing text-slate-400 -mr-0.5 select-none"
                          title="拖动调整顺序"
                        >
                          ⋮⋮
                        </span>

                        <span className={`w-8 h-8 rounded-lg border flex items-center justify-center text-base flex-shrink-0 group-hover:scale-105 transition-transform relative ${
                          theme === 'light'
                            ? 'bg-slate-100 border-slate-200/80 text-slate-800'
                            : theme === 'cyber'
                            ? 'bg-[#0f2444] border-[#1a365d] text-sky-200'
                            : 'bg-slate-800/70 border-slate-700/50 text-slate-200'
                        }`}>
                          {emoji}
                          {plugin.enabled === false && (
                            <span className="absolute -top-1 -right-1 text-[9px] leading-none">⏸️</span>
                          )}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className={`text-xs font-semibold leading-tight truncate ${isActive ? 'text-emerald-500 font-bold' : currentTheme.textPrimary}`}>
                              {plugin.name}
                            </span>
                            {plugin.enabled === false && (
                              <span className="text-[9px] px-1 rounded bg-slate-700/50 text-slate-400 font-mono flex-shrink-0">已禁用</span>
                            )}
                            {plugin.isDev && (
                              <span className="text-[9px] px-1 rounded bg-amber-500/15 text-amber-500 font-mono flex-shrink-0">开发</span>
                            )}
                          </div>
                        </div>
                      </button>

                      {/* 悬停操作组：启用/禁用切换、取消置顶与卸载 */}
                      <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 pr-1.5 transition-opacity flex-shrink-0">
                        <button
                          onMouseDown={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation()
                            handleTogglePlugin(plugin.id, plugin.enabled === false)
                          }}
                          title={plugin.enabled === false ? '点击启用插件' : '点击禁用插件'}
                          className="p-1 rounded hover:bg-slate-700/40 text-slate-400 hover:text-amber-400 text-xs transition-colors"
                        >
                          {plugin.enabled === false ? '▶️' : '⏸️'}
                        </button>
                        <button
                          onMouseDown={(e) => e.stopPropagation()}
                          onClick={(e) => handleTogglePin(plugin.id, e)}
                          title="取消置顶 (移至更多)"
                          className="p-1 rounded hover:bg-slate-700/40 text-emerald-500 hover:text-emerald-400 text-xs transition-colors"
                        >
                          📌
                        </button>
                        {!plugin.isDev && (
                          <button
                            onMouseDown={(e) => e.stopPropagation()}
                            onClick={(e) => {
                              e.stopPropagation()
                              handleUninstall(plugin.id, plugin.name)
                            }}
                            title={`卸载插件 ${plugin.name}`}
                            className="p-1 rounded hover:bg-rose-500/20 text-slate-400 hover:text-rose-500 transition-all text-xs"
                          >
                            🗑️
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}

                {/* 若置顶为空，提示用户 */}
                {pinnedPlugins.length === 0 && (
                  <div className={`px-3 py-4 rounded-xl ${currentTheme.subcardBg} border border-dashed ${currentTheme.border} text-center space-y-1`}>
                    <div className={`text-xs ${currentTheme.textMuted} font-medium`}>暂无置顶插件</div>
                    <div className={`text-[10px] ${currentTheme.textMuted}`}>鼠标悬停下方「更多插件」点 📌 即可固定</div>
                  </div>
                )}

                {/* 2. “更多插件” 按钮（当有未置顶插件时展示） */}
                {unpinnedPlugins.length > 0 && (
                  !sidebarCollapsed ? (
                    <div className="pt-1">
                      <button
                        id="more-plugins-btn"
                        onMouseEnter={handleMoreMouseEnter}
                        onMouseLeave={handleMoreMouseLeave}
                        onClick={handleMoreClick}
                        className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium transition-all ${
                          unpinnedPlugins.some((p) => p.id === activeTab)
                            ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/30 font-semibold'
                            : theme === 'light'
                            ? 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 border border-slate-200/60'
                            : theme === 'cyber'
                            ? 'text-sky-300/80 hover:bg-[#10223d] hover:text-sky-100 border border-[#1a365d]/50'
                            : 'text-slate-400 hover:bg-slate-800/80 hover:text-slate-200 border border-slate-800/60'
                        }`}
                      >
                        <div className="flex items-center gap-2.5">
                          <span className="text-base font-mono">⋯</span>
                          <span>更多插件</span>
                        </div>
                        <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${currentTheme.subcardBg} text-emerald-500 border ${currentTheme.border}`}>
                          {unpinnedPlugins.length}
                        </span>
                      </button>
                    </div>
                  ) : (
                    <div className="flex justify-center pt-1">
                      <button
                        id="more-plugins-btn"
                        onMouseEnter={handleMoreMouseEnter}
                        onMouseLeave={handleMoreMouseLeave}
                        onClick={handleMoreClick}
                        className={`w-12 h-12 rounded-xl flex items-center justify-center transition-all relative ${
                          unpinnedPlugins.some((p) => p.id === activeTab)
                            ? 'bg-emerald-500/15 text-emerald-500 border border-emerald-500/40 shadow-md'
                            : theme === 'light'
                            ? 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 border border-slate-200/60'
                            : theme === 'cyber'
                            ? 'text-sky-300/80 hover:bg-[#10223d] hover:text-sky-100 border border-[#1a365d]/50'
                            : 'text-slate-400 hover:bg-slate-800/90 hover:text-slate-200 border border-slate-800/60'
                        }`}
                        title={`更多插件 (${unpinnedPlugins.length} 个)`}
                      >
                        <span className="text-lg font-mono">⋯</span>
                        <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-emerald-500" />
                      </button>
                    </div>
                  )
                )}
              </>
            )}
          </div>

          {/* 底部固定区：系统中心与状态卡片 */}
          <div className={`pt-2 border-t ${currentTheme.border} space-y-1.5 flex-shrink-0`}>
            {!sidebarCollapsed && (
              <div className={`px-2 py-1 text-[10px] font-semibold tracking-wider ${currentTheme.textMuted} uppercase`}>
                系统服务
              </div>
            )}

            {/* 插件市场 */}
            <div className={`relative ${sidebarCollapsed ? 'group flex justify-center' : ''}`}>
              <button
                onClick={() => setActiveTab('market')}
                className={`flex items-center transition-all ${
                  sidebarCollapsed
                    ? `w-12 h-12 rounded-xl justify-center ${
                        activeTab === 'market'
                          ? 'bg-emerald-500/15 text-emerald-500 border border-emerald-500/40'
                          : theme === 'light'
                          ? 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                          : theme === 'cyber'
                          ? 'text-sky-300/80 hover:bg-[#10223d] hover:text-sky-100'
                          : 'text-slate-400 hover:bg-slate-800/90 hover:text-slate-200'
                      }`
                    : `w-full gap-3 px-3 py-2 rounded-xl text-xs font-medium ${
                        activeTab === 'market'
                          ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/30'
                          : theme === 'light'
                          ? 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                          : theme === 'cyber'
                          ? 'text-sky-300/80 hover:bg-[#10223d] hover:text-sky-100'
                          : 'text-slate-400 hover:bg-slate-800/80 hover:text-slate-200'
                      }`
                }`}
              >
                <span className={sidebarCollapsed ? 'text-xl' : 'text-base'}>🧩</span>
                {!sidebarCollapsed && <span>插件市场</span>}
              </button>
              {sidebarCollapsed && (
                <div className="absolute left-full ml-2.5 top-1/2 -translate-y-1/2 z-50 pointer-events-none opacity-0 group-hover:opacity-100 transition-all duration-150">
                  <div className={`${currentTheme.cardBg} border ${currentTheme.border} rounded-lg px-2.5 py-1.5 text-xs ${currentTheme.textPrimary} whitespace-nowrap shadow-xl`}>
                    插件市场
                  </div>
                </div>
              )}
            </div>

            {/* 应用设置 */}
            <div className={`relative ${sidebarCollapsed ? 'group flex justify-center' : ''}`}>
              <button
                onClick={() => setActiveTab('settings')}
                className={`flex items-center transition-all ${
                  sidebarCollapsed
                    ? `w-12 h-12 rounded-xl justify-center ${
                        activeTab === 'settings'
                          ? 'bg-emerald-500/15 text-emerald-500 border border-emerald-500/40'
                          : theme === 'light'
                          ? 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                          : theme === 'cyber'
                          ? 'text-sky-300/80 hover:bg-[#10223d] hover:text-sky-100'
                          : 'text-slate-400 hover:bg-slate-800/90 hover:text-slate-200'
                      }`
                    : `w-full gap-3 px-3 py-2 rounded-xl text-xs font-medium ${
                        activeTab === 'settings'
                          ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/30'
                          : theme === 'light'
                          ? 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                          : theme === 'cyber'
                          ? 'text-sky-300/80 hover:bg-[#10223d] hover:text-sky-100'
                          : 'text-slate-400 hover:bg-slate-800/80 hover:text-slate-200'
                      }`
                }`}
              >
                <span className={sidebarCollapsed ? 'text-xl' : 'text-base'}>⚙️</span>
                {!sidebarCollapsed && <span>应用设置</span>}
              </button>
              {sidebarCollapsed && (
                <div className="absolute left-full ml-2.5 top-1/2 -translate-y-1/2 z-50 pointer-events-none opacity-0 group-hover:opacity-100 transition-all duration-150">
                  <div className={`${currentTheme.cardBg} border ${currentTheme.border} rounded-lg px-2.5 py-1.5 text-xs ${currentTheme.textPrimary} whitespace-nowrap shadow-xl`}>
                    应用设置
                  </div>
                </div>
              )}
            </div>
          </div>
        </aside>

        {/* 右侧内容区 */}
        <main className={`flex-1 overflow-y-auto p-8 transition-colors duration-200 ${currentTheme.mainBg}`}>
          {installMsg && (
            <div
              className={`mb-6 p-4 rounded-xl border text-xs flex items-center justify-between shadow-lg ${
                installMsg.type === 'success'
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
                  : 'bg-rose-500/10 border-rose-500/30 text-rose-600 dark:text-rose-400'
              }`}
            >
              <span>{installMsg.text}</span>
              <button onClick={() => setInstallMsg(null)} className={`${currentTheme.textMuted} ${currentTheme.hoverText}`}>✕</button>
            </div>
          )}

          {activeTab === 'market' && (
            <div className="max-w-4xl mx-auto space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h1 className={`text-2xl font-bold ${currentTheme.textPrimary}`}>官方插件市场</h1>
                  <p className={`text-sm ${currentTheme.textMuted} mt-1`}>
                    经过官方安全认证，即点即装，纯净轻量无干扰
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => fetchMarket(true)}
                    disabled={loadingMarket}
                    className={`px-3 py-2 rounded-xl text-xs transition-colors ${currentTheme.btnGhost}`}
                  >
                    {loadingMarket ? '刷新中...' : '🔄 刷新'}
                  </button>
                  {/* 一键全部安装 */}
                  {(() => {
                    const uninstalledCount = marketPlugins.filter((p) => !p.isInstalled).length
                    if (uninstalledCount === 0) return null
                    return (
                      <button
                        onClick={handleInstallAll}
                        disabled={isInstallingAll}
                        className="px-4 py-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-semibold text-xs transition-all shadow-lg shadow-blue-500/20 flex items-center gap-2 disabled:opacity-50"
                      >
                        {isInstallingAll ? (
                          <>
                            <span className="inline-block animate-spin">⏳</span>
                            <span>
                              安装中 ({installAllProgress?.current}/{installAllProgress?.total}: {installAllProgress?.name})
                            </span>
                          </>
                        ) : (
                          <>
                            <span>⚡ 一键全部安装</span>
                            <span className="px-1.5 py-0.5 bg-white/20 rounded-full text-[10px] font-mono">
                              {uninstalledCount}
                            </span>
                          </>
                        )}
                      </button>
                    )
                  })()}
                  <button
                    onClick={handleInstallZip}
                    className="px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 font-semibold text-xs transition-all shadow-lg shadow-emerald-500/20 flex items-center gap-2"
                  >
                    <span>📦 离线 ZIP 导入</span>
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                {marketPlugins.map((plugin) => (
                  <div
                    key={plugin.id}
                    className={`p-5 rounded-xl ${currentTheme.cardBg} border ${currentTheme.border} ${plugin.isInstalled && plugin.enabled === false ? 'opacity-70' : ''} hover:border-emerald-500/40 transition-all flex flex-col justify-between hover:shadow-md`}
                  >
                    <div>
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-3">
                          <span className="text-3xl">
                            {getPluginEmoji(plugin)}
                          </span>
                          <div>
                            <h3 className={`font-semibold ${currentTheme.textPrimary}`}>{plugin.name}</h3>
                            <div className={`text-xs ${currentTheme.textMuted} mt-0.5 flex items-center gap-1.5 flex-wrap`}>
                              <span>{plugin.publisher}</span>
                              <span>•</span>
                              <span>{plugin.hasUpdate ? `最新 v${plugin.latestVersion}` : `v${plugin.latestVersion}`}</span>
                              {plugin.size > 0 && <span>• {(plugin.size / 1024).toFixed(0)} KB</span>}
                            </div>
                          </div>
                        </div>

                        {plugin.hasUpdate ? (
                          <span className="px-2 py-0.5 text-xs rounded bg-amber-500/10 text-amber-600 dark:text-amber-500 border border-amber-500/30 animate-pulse font-mono font-semibold whitespace-nowrap">
                            可更新 (v{plugin.installedVersion} → v{plugin.latestVersion})
                          </span>
                        ) : plugin.isInstalled ? (
                          plugin.enabled === false ? (
                            <span className="px-2 py-0.5 text-xs rounded bg-slate-500/10 text-slate-500 dark:text-slate-400 border border-slate-500/20 font-medium whitespace-nowrap flex items-center gap-1">
                              <span>⏸️</span>
                              <span>已禁用</span>
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 text-xs rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-500 border border-emerald-500/20 font-medium whitespace-nowrap flex items-center gap-1">
                              <span>✓</span>
                              <span>已启用</span>
                            </span>
                          )
                        ) : (
                          <span className={`px-2 py-0.5 text-xs rounded ${currentTheme.subcardBg} ${currentTheme.textMuted} border ${currentTheme.border} whitespace-nowrap`}>
                            未安装
                          </span>
                        )}
                      </div>

                      <p className={`text-xs ${currentTheme.textSecondary} mt-3 leading-relaxed`}>
                        {plugin.description}
                      </p>


                      {plugin.changelog && (
                        <div className="relative inline-block mt-2.5 group/cl">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full ${currentTheme.subcardBg} border ${currentTheme.border} text-[10px] ${currentTheme.textMuted} ${currentTheme.hoverText} cursor-default transition-colors select-none`}>
                            <span>📋</span>
                            <span>更新日志</span>
                          </span>
                          {/* Tooltip */}
                          <div className="absolute left-0 bottom-full mb-2 z-50 hidden group-hover/cl:block pointer-events-none w-72">
                            <div className={`${currentTheme.cardBg} border ${currentTheme.border} rounded-xl shadow-2xl p-3`}>
                              <div className={`text-[10px] font-semibold ${currentTheme.textMuted} mb-1.5 flex items-center gap-1`}>
                                <span>📋</span>
                                <span>更新日志</span>
                              </div>
                              <p className={`text-[11px] ${currentTheme.textSecondary} leading-relaxed whitespace-pre-wrap break-words`}>
                                {plugin.changelog.replace(/；/g, '；\n')}
                              </p>
                            </div>
                            {/* 小三角 */}
                            <div className={`absolute left-3 top-full w-0 h-0 border-l-4 border-r-4 border-t-4 border-l-transparent border-r-transparent ${theme === 'light' ? 'border-t-slate-200' : 'border-t-slate-700'}`} />
                          </div>
                        </div>
                      )}

                      {/* 权限提示标签 */}
                      <div className="mt-3 flex flex-wrap gap-1">
                        {plugin.permissions.map((p, idx) => (
                          <span
                            key={idx}
                            className={`text-[10px] px-1.5 py-0.5 rounded ${currentTheme.subcardBg} ${currentTheme.textMuted} border ${currentTheme.border} font-mono`}
                          >
                            {p.capability}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div className={`mt-4 pt-3 border-t ${currentTheme.border} flex items-center justify-between`}>
                      <span className={`text-[11px] ${currentTheme.textMuted} font-mono`}>{plugin.id}</span>
                      <div className="flex items-center gap-2">
                        {plugin.isInstalled && !plugin.hasUpdate && (
                          <button
                            onClick={() => handleSelectPlugin(plugin)}
                            className={`px-3 py-1 text-xs rounded ${currentTheme.btnGhost} text-emerald-600 dark:text-emerald-400 font-semibold transition-colors`}
                          >
                            打开
                          </button>
                        )}

                        {plugin.hasUpdate && (
                          <button
                            onClick={() => handleTriggerUpdate(plugin)}
                            disabled={installingPluginId === plugin.id}
                            className="px-3 py-1 text-xs rounded bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold transition-colors shadow-md shadow-amber-500/20"
                          >
                            {installingPluginId === plugin.id ? '更新中...' : '立即更新'}
                          </button>
                        )}

                        {!plugin.isInstalled && (
                          <button
                            onClick={() => handleMarketInstall(plugin)}
                            disabled={installingPluginId === plugin.id || isInstallingAll}
                            className="px-3.5 py-1 text-xs rounded bg-emerald-600 hover:bg-emerald-500 text-white font-medium transition-colors shadow-md shadow-emerald-600/20"
                          >
                            {installingPluginId === plugin.id ? '安装中...' : '一键安装'}
                          </button>
                        )}

                        {/* 启用/禁用状态切换按钮 */}
                        {plugin.isInstalled && (
                          <button
                            onClick={() => handleTogglePlugin(plugin.id, plugin.enabled === false)}
                            className={`px-2.5 py-1 text-xs rounded font-medium transition-colors ${
                              plugin.enabled === false
                                ? 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30'
                                : `${currentTheme.subcardBg} ${currentTheme.hoverBg} ${currentTheme.textMuted} ${currentTheme.hoverText} border ${currentTheme.border}`
                            }`}
                            title={plugin.enabled === false ? '点击启用此插件' : '点击禁用此插件'}
                          >
                            {plugin.enabled === false ? '▶️ 启用' : '⏸️ 禁用'}
                          </button>
                        )}

                        {plugin.isInstalled && !plugin.isDev && (
                          <button
                            onClick={() => handleUninstall(plugin.id, plugin.name)}
                            className={`px-2.5 py-1 text-xs rounded ${currentTheme.subcardBg} hover:bg-rose-500/20 text-rose-500 border border-rose-500/30 font-medium transition-colors`}
                          >
                            卸载
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'settings' && (
            <div className="max-w-2xl mx-auto space-y-6">
              <div>
                <h1 className={`text-2xl font-bold ${currentTheme.textPrimary}`}>应用设置</h1>
                <p className={`text-sm ${currentTheme.textMuted} mt-1`}>
                  管理应用通用参数、多媒体组件与数据存储
                </p>
              </div>

              <div className={`p-5 rounded-xl border space-y-5 ${currentTheme.cardBg} ${currentTheme.border}`}>
                {/* 应用主体与界面风格 */}
                <div className={`space-y-3 pb-5 border-b ${currentTheme.border}`}>
                  <div>
                    <div className={`text-sm font-medium ${currentTheme.textPrimary} flex items-center gap-2`}>
                      <span>应用主体与界面风格</span>
                      <span className="text-xs px-2 py-0.5 rounded-full font-mono bg-emerald-500/10 text-emerald-500 border border-emerald-500/30">
                        {currentTheme.name}
                      </span>
                    </div>
                    <div className={`text-xs ${currentTheme.textMuted} mt-0.5`}>
                      选择您喜爱的应用主体外观，支持暗黑极客、明亮浅色与科技深蓝即时无缝切换，并自动记忆保存
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-3 pt-1">
                    {(Object.values(THEMES) as ThemeConfig[]).map((t) => {
                      const isSelected = theme === t.id
                      return (
                        <button
                          key={t.id}
                          onClick={() => handleSetTheme(t.id)}
                          className={`p-3 rounded-xl border text-left transition-all relative cursor-pointer ${
                            isSelected
                              ? 'border-emerald-500 ring-2 ring-emerald-500/30 bg-emerald-500/10'
                              : `${currentTheme.border} ${currentTheme.subcardBg}`
                          }`}
                        >
                          <div className="flex items-center justify-between mb-1.5">
                            <span className="text-2xl">{t.icon}</span>
                            {isSelected && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500 text-slate-950 font-bold">
                                当前主体
                              </span>
                            )}
                          </div>
                          <div className={`text-xs font-semibold ${currentTheme.textPrimary}`}>{t.name}</div>
                          <div className={`text-[10px] ${currentTheme.textMuted} mt-0.5 leading-snug`}>{t.desc}</div>
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* 主程序版本与在线更新 */}
                <div className={`space-y-3 pb-5 border-b ${currentTheme.border}`}>
                  <div className="flex items-start justify-between">
                    <div>
                      <div className={`text-sm font-medium ${currentTheme.textPrimary} flex items-center gap-2`}>
                        <span>主程序版本与在线更新</span>
                        <span className="text-xs px-2 py-0.5 rounded-full font-mono bg-indigo-500/10 text-indigo-500 border border-indigo-500/30">
                          v{hostVersion}
                        </span>
                      </div>
                      <div className={`text-xs ${currentTheme.textMuted} mt-0.5`}>
                        支持一键手动检查最新版本、静默断点续传下载与自动升级更新
                      </div>
                    </div>

                    <button
                      onClick={() => handleCheckHostUpdate(true)}
                      disabled={checkingUpdate}
                      className="px-3.5 py-1.5 text-xs rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-medium shadow-md shadow-indigo-600/20 transition-all flex items-center gap-1.5"
                    >
                      <span>{checkingUpdate ? '⏳ 正在检查...' : '⚡ 检查新版本'}</span>
                    </button>
                  </div>

                  <div className={`flex items-center justify-between p-3 rounded-xl ${currentTheme.subcardBg} border ${currentTheme.border}`}>
                    <div className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        id="autoCheckHostUpdate"
                        checked={autoCheckUpdate}
                        onChange={(e) => handleToggleAutoCheck(e.target.checked)}
                        className={`w-4 h-4 rounded text-indigo-600 focus:ring-0 ${theme === 'light' ? 'bg-white border-slate-300' : 'bg-slate-900 border-slate-700'} cursor-pointer`}
                      />
                      <label htmlFor="autoCheckHostUpdate" className="cursor-pointer">
                        <div className={`text-xs font-semibold ${currentTheme.textPrimary}`}>启动时自动检查更新</div>
                        <div className={`text-[10px] ${currentTheme.textMuted}`}>开启后每次启动应用静默检查是否有新版本，发现更新即时提醒</div>
                      </label>
                    </div>
                  </div>

                  {updateCardMsg && (
                    <div
                      className={`p-2.5 rounded-lg border text-xs flex items-center justify-between transition-all ${
                        updateCardMsg.type === 'success'
                          ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
                          : 'bg-rose-500/10 border-rose-500/30 text-rose-600 dark:text-rose-400'
                      }`}
                    >
                      <span>{updateCardMsg.text}</span>
                      <button onClick={() => setUpdateCardMsg(null)} className={`${currentTheme.textMuted} ${currentTheme.hoverText}`}>✕</button>
                    </div>
                  )}
                </div>


                {/* 网络代理与 GitHub 连通配置 */}
                <div className={`space-y-3 pb-5 border-b ${currentTheme.border}`}>
                  <div className="flex items-start justify-between">
                    <div>
                      <div className={`text-sm font-medium ${currentTheme.textPrimary} flex items-center gap-2`}>
                        <span>网络代理与 GitHub 连通配置</span>
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded-full font-mono ${
                            proxyConfig.mode === 'direct'
                              ? `${currentTheme.subcardBg} ${currentTheme.textMuted} border ${currentTheme.border}`
                              : 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/30'
                          }`}
                        >
                          {proxyConfig.mode === 'system'
                            ? '跟随系统代理 (默认)'
                            : proxyConfig.mode === 'direct'
                            ? '关闭代理 (纯直连)'
                            : '自定义代理'}
                        </span>
                      </div>
                      <div className={`text-xs ${currentTheme.textMuted} mt-0.5`}>
                        插件市场与发布包已全面直连 GitHub 官方源（无国内第三方镜像）。默认使用系统代理，可在不需要时一键关闭。
                      </div>
                      <div className={`text-[11px] ${currentTheme.textMuted} font-mono mt-1 flex items-center gap-2`}>
                        <span>GitHub 有效链路:</span>
                        <span className={`px-2 py-0.5 rounded border ${currentTheme.cardBg} ${currentTheme.border} ${currentTheme.textSecondary}`}>
                          {proxyConfig.effectiveProxy || 'DIRECT'}
                        </span>
                      </div>
                    </div>

                    <button
                      onClick={handleTestGitHub}
                      disabled={testingProxy}
                      className="px-3.5 py-1.5 text-xs rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-medium shadow-md shadow-indigo-600/20 transition-all flex items-center gap-1.5"
                    >
                      <span>{testingProxy ? '⏳ 检测中...' : '⚡ 测试 GitHub 连通性'}</span>
                    </button>
                  </div>

                  {/* 模式单选控制 */}
                  <div className="grid grid-cols-3 gap-2.5">
                    <label
                      onClick={() => handleUpdateProxyMode('system')}
                      className={`flex items-center gap-2.5 p-3 rounded-xl border cursor-pointer transition-all ${
                        proxyConfig.mode === 'system'
                          ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-600 dark:text-emerald-300'
                          : `${currentTheme.subcardBg} ${currentTheme.border} hover:border-emerald-500/30 ${currentTheme.textMuted}`
                      }`}
                    >
                      <input
                        type="radio"
                        name="proxyMode"
                        checked={proxyConfig.mode === 'system'}
                        onChange={() => handleUpdateProxyMode('system')}
                        className="text-emerald-500 focus:ring-0"
                      />
                      <div>
                        <div className={`text-xs font-semibold ${currentTheme.textPrimary}`}>跟随系统代理 (默认)</div>
                        <div className={`text-[10px] ${currentTheme.textMuted} mt-0.5`}>自动同步系统 Clash / VPN / 局域网代理</div>
                      </div>
                    </label>

                    <label
                      onClick={() => handleUpdateProxyMode('direct')}
                      className={`flex items-center gap-2.5 p-3 rounded-xl border cursor-pointer transition-all ${
                        proxyConfig.mode === 'direct'
                          ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-600 dark:text-emerald-300'
                          : `${currentTheme.subcardBg} ${currentTheme.border} hover:border-emerald-500/30 ${currentTheme.textMuted}`
                      }`}
                    >
                      <input
                        type="radio"
                        name="proxyMode"
                        checked={proxyConfig.mode === 'direct'}
                        onChange={() => handleUpdateProxyMode('direct')}
                        className="text-emerald-500 focus:ring-0"
                      />
                      <div>
                        <div className={`text-xs font-semibold ${currentTheme.textPrimary}`}>关闭代理 (纯直连)</div>
                        <div className={`text-[10px] ${currentTheme.textMuted} mt-0.5`}>禁用所有代理规则，直接请求 GitHub</div>
                      </div>
                    </label>

                    <label
                      onClick={() => handleUpdateProxyMode('custom')}
                      className={`flex items-center gap-2.5 p-3 rounded-xl border cursor-pointer transition-all ${
                        proxyConfig.mode === 'custom'
                          ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-600 dark:text-emerald-300'
                          : `${currentTheme.subcardBg} ${currentTheme.border} hover:border-emerald-500/30 ${currentTheme.textMuted}`
                      }`}
                    >
                      <input
                        type="radio"
                        name="proxyMode"
                        checked={proxyConfig.mode === 'custom'}
                        onChange={() => handleUpdateProxyMode('custom')}
                        className="text-emerald-500 focus:ring-0"
                      />
                      <div>
                        <div className={`text-xs font-semibold ${currentTheme.textPrimary}`}>自定义代理地址</div>
                        <div className={`text-[10px] ${currentTheme.textMuted} mt-0.5`}>手动指定 HTTP / SOCKS5 代理端口</div>
                      </div>
                    </label>
                  </div>

                  {/* 自定义代理输入框（当选择自定义代理时显示） */}
                  {proxyConfig.mode === 'custom' && (
                    <div className={`p-3.5 rounded-xl ${currentTheme.subcardBg} border ${currentTheme.border} space-y-3`}>
                      <div className="flex items-center gap-3">
                        <div className="flex-1">
                          <label className={`text-[11px] ${currentTheme.textMuted} block mb-1`}>代理服务器地址 (HTTP / SOCKS5)</label>
                          <input
                            type="text"
                            value={proxyConfig.customProxyUrl}
                            onChange={(e) => setProxyConfig({ ...proxyConfig, customProxyUrl: e.target.value })}
                            placeholder="http://127.0.0.1:7890 或 socks5://127.0.0.1:1080"
                            className={`w-full px-3 py-1.5 ${theme === 'light' ? 'bg-white border-slate-200 text-slate-900 placeholder-slate-400' : 'bg-slate-900 border-slate-700 text-white placeholder-slate-600'} border rounded-lg text-xs focus:border-emerald-500 focus:outline-none font-mono`}
                          />
                        </div>
                        <button
                          onClick={() => handleSaveProxyConfig()}
                          disabled={savingProxy}
                          className="mt-5 px-4 py-1.5 text-xs rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-medium transition-colors"
                        >
                          {savingProxy ? '保存中...' : '保存代理'}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* 连通性测试结果提示 */}
                  {testResult && (
                    <div
                      className={`p-3 rounded-xl border text-xs flex items-center justify-between ${
                        testResult.success
                          ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
                          : 'bg-rose-500/10 border-rose-500/30 text-rose-600 dark:text-rose-400'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span>{testResult.success ? '✓' : '✕'}</span>
                        <span>
                          {testResult.success
                            ? `GitHub 官方源连通正常！响应延迟: ${testResult.latencyMs}ms (通过 ${testResult.effectiveProxy})`
                            : `连接失败: ${testResult.error} (请检查系统代理或切换模式)`}
                        </span>
                      </div>
                      <button onClick={() => setTestResult(null)} className={`${currentTheme.textMuted} ${currentTheme.hoverText}`}>✕</button>
                    </div>
                  )}
                </div>

                {/* FFmpeg 独立组件配置 */}
                <div className="space-y-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className={`text-sm font-medium ${currentTheme.textPrimary} flex items-center gap-2`}>
                        <span>FFmpeg 多媒体独立扩展组件</span>
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
                            ffmpegStatus.installed
                              ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30'
                              : 'bg-amber-500/10 text-amber-600 dark:text-amber-500 border border-amber-500/30'
                          }`}
                        >
                          {ffmpegStatus.installed ? `已就绪 (${ffmpegStatus.source})` : '未安装'}
                        </span>
                      </div>
                      {ffmpegStatus.installed && ffmpegStatus.path && (
                        <div className={`text-[11px] ${currentTheme.textMuted} font-mono mt-1 truncate max-w-md`}>
                          路径: {ffmpegStatus.path} {ffmpegStatus.version ? `(v${ffmpegStatus.version})` : ''}
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-2 flex-shrink-0">
                      {ffmpegStatus.installed && (
                        <button
                          onClick={handleOpenFFmpegDir}
                          className={`px-3 py-1.5 text-xs rounded-lg ${currentTheme.btnGhost} transition-colors`}
                          title="在文件资源管理器中定位组件"
                        >
                          📂 打开目录
                        </button>
                      )}
                      <button
                        onClick={handleSelectFFmpegFile}
                        className={`px-3 py-1.5 text-xs rounded-lg ${currentTheme.btnGhost} transition-colors`}
                      >
                        手动导入
                      </button>
                      <button
                        onClick={handleInstallFFmpeg}
                        disabled={ffmpegLoading}
                        className="px-3.5 py-1.5 text-xs rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium shadow-md shadow-emerald-600/20 transition-colors disabled:opacity-50"
                      >
                        {ffmpegLoading ? '正在下载解压...' : ffmpegStatus.installed ? '重新检测' : '在线安装'}
                      </button>
                    </div>
                  </div>

                  {/* 实时安装进度条 */}
                  {ffmpegLoading && ffmpegProgress && (
                    <div className={`p-3 rounded-lg ${currentTheme.subcardBg} border ${currentTheme.border} space-y-2`}>
                      <div className="flex items-center justify-between text-xs">
                        <span className={`font-medium ${currentTheme.textPrimary}`}>
                          {ffmpegProgress.text || '正在极速下载并解压组件...'}
                        </span>
                        <span className="text-emerald-500 font-mono font-semibold">
                          {ffmpegProgress.percent}%
                        </span>
                      </div>
                      <div className={`w-full h-2 ${theme === 'light' ? 'bg-slate-200' : 'bg-slate-800'} rounded-full overflow-hidden`}>
                        <div
                          className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all duration-200 rounded-full"
                          style={{ width: `${Math.max(6, ffmpegProgress.percent)}%` }}
                        />
                      </div>
                      {ffmpegProgress.speed && (
                        <div className={`text-[11px] ${currentTheme.textMuted} flex justify-between`}>
                          <span>实时传输速率</span>
                          <span className="font-mono">{ffmpegProgress.speed}</span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* 卡片就地消息提示 */}
                  {ffmpegCardMsg && (
                    <div
                      className={`p-2.5 rounded-lg border text-xs flex items-center justify-between transition-all ${
                        ffmpegCardMsg.type === 'success'
                          ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
                          : 'bg-rose-500/10 border-rose-500/30 text-rose-600 dark:text-rose-400'
                      }`}
                    >
                      <span>{ffmpegCardMsg.text}</span>
                      <button onClick={() => setFFmpegCardMsg(null)} className={`${currentTheme.textMuted} ${currentTheme.hoverText}`}>✕</button>
                    </div>
                  )}
                </div>

                {/* 统一文件存储与工作目录管理 */}
                <div className={`border-t ${currentTheme.border} pt-4 space-y-3`}>
                  <div>
                    <div className={`text-sm font-medium ${currentTheme.textPrimary} flex items-center gap-2`}>
                      <span>文件存储与工作目录管理</span>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-mono ${currentTheme.subcardBg} ${currentTheme.textMuted} border ${currentTheme.border}`}>
                        安全独立存储
                      </span>
                    </div>
                    <div className={`text-xs ${currentTheme.textMuted} mt-0.5`}>
                      自定义文件下载、记事本与 Markdown 默认保存路径，应用卸载或升级不会删除您的工作文件
                    </div>
                  </div>

                  <div className="space-y-2.5">
                    {/* 通用文件下载 */}
                    <div className={`p-3 rounded-xl ${currentTheme.subcardBg} border ${currentTheme.border} space-y-2`}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-base">📥</span>
                          <span className={`text-xs font-semibold ${currentTheme.textPrimary}`}>统一文件下载目录</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => handleOpenWorkspaceDir('downloads')}
                            className={`px-2.5 py-1 text-xs rounded ${currentTheme.btnGhost} transition-colors`}
                          >
                            打开目录
                          </button>
                          <button
                            onClick={() => handleSelectWorkspaceDir('downloads')}
                            className="px-2.5 py-1 text-xs rounded bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-500 border border-emerald-500/30 transition-colors"
                          >
                            更改目录
                          </button>
                          <button
                            onClick={() => handleResetWorkspaceDir('downloads')}
                            className={`px-2.5 py-1 text-xs rounded ${currentTheme.btnGhost} transition-colors`}
                            title="恢复为系统默认下载目录"
                          >
                            重置
                          </button>
                        </div>
                      </div>
                      <div className={`text-[11px] font-mono ${currentTheme.cardBg} ${currentTheme.textSecondary} px-2.5 py-1.5 rounded border ${currentTheme.border} truncate select-all`} title={workspaces.downloads}>
                        {workspaces.downloads || '未设置'}
                      </div>
                    </div>

                    {/* 记事本默认目录 */}
                    <div className={`p-3 rounded-xl ${currentTheme.subcardBg} border ${currentTheme.border} space-y-2`}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-base">🗒️</span>
                          <span className={`text-xs font-semibold ${currentTheme.textPrimary}`}>记事本默认保存目录</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => handleOpenWorkspaceDir('notepad')}
                            className={`px-2.5 py-1 text-xs rounded ${currentTheme.btnGhost} transition-colors`}
                          >
                            打开目录
                          </button>
                          <button
                            onClick={() => handleSelectWorkspaceDir('notepad')}
                            className="px-2.5 py-1 text-xs rounded bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-500 border border-emerald-500/30 transition-colors"
                          >
                            更改目录
                          </button>
                          <button
                            onClick={() => handleResetWorkspaceDir('notepad')}
                            className={`px-2.5 py-1 text-xs rounded ${currentTheme.btnGhost} transition-colors`}
                            title="恢复为文档默认目录"
                          >
                            重置
                          </button>
                        </div>
                      </div>
                      <div className={`text-[11px] font-mono ${currentTheme.cardBg} ${currentTheme.textSecondary} px-2.5 py-1.5 rounded border ${currentTheme.border} truncate select-all`} title={workspaces.notepad}>
                        {workspaces.notepad || '未设置'}
                      </div>
                    </div>

                    {/* Markdown 默认目录 */}
                    <div className={`p-3 rounded-xl ${currentTheme.subcardBg} border ${currentTheme.border} space-y-2`}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-base">📝</span>
                          <span className={`text-xs font-semibold ${currentTheme.textPrimary}`}>Markdown 默认保存目录</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => handleOpenWorkspaceDir('markdown')}
                            className={`px-2.5 py-1 text-xs rounded ${currentTheme.btnGhost} transition-colors`}
                          >
                            打开目录
                          </button>
                          <button
                            onClick={() => handleSelectWorkspaceDir('markdown')}
                            className="px-2.5 py-1 text-xs rounded bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-500 border border-emerald-500/30 transition-colors"
                          >
                            更改目录
                          </button>
                          <button
                            onClick={() => handleResetWorkspaceDir('markdown')}
                            className={`px-2.5 py-1 text-xs rounded ${currentTheme.btnGhost} transition-colors`}
                            title="恢复为文档默认目录"
                          >
                            重置
                          </button>
                        </div>
                      </div>
                      <div className={`text-[11px] font-mono ${currentTheme.cardBg} ${currentTheme.textSecondary} px-2.5 py-1.5 rounded border ${currentTheme.border} truncate select-all`} title={workspaces.markdown}>
                        {workspaces.markdown || '未设置'}
                      </div>
                    </div>
                  </div>
                </div>

                {/* 抖音凭证 */}
                <div className={`border-t ${currentTheme.border} pt-4 flex items-center justify-between`}>
                  <div>
                    <div className={`text-sm font-medium ${currentTheme.textPrimary}`}>抖音网页端隔离会话</div>
                    <div className={`text-xs ${currentTheme.textMuted} mt-0.5`}>
                      {douyinLoggedIn ? (
                        <span className="text-emerald-500">✓ 已捕获有效凭证（自动附加安全凭据，保护账户隐私）</span>
                      ) : (
                        <span className="text-amber-500">未检测到登录凭证，部分高清视频与合集可能受限</span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={handleDouyinLogin}
                    className="px-3.5 py-1.5 text-xs rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium shadow-md shadow-indigo-600/20 transition-colors"
                  >
                    {douyinLoggedIn ? '重新登录' : '扫码登录'}
                  </button>
                </div>

                {/* 安全防护 */}
                <div className={`border-t ${currentTheme.border} pt-4 flex items-center justify-between`}>
                  <div>
                    <div className={`text-sm font-medium ${currentTheme.textPrimary}`}>应用运行与安全防护</div>
                    <div className={`text-xs ${currentTheme.textMuted} mt-0.5`}>
                      独立进程运行、网络安全防护、防篡改数字签名与独立数据存储
                    </div>
                  </div>
                  <span className="text-xs font-mono text-emerald-500 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                    安全保护已开启
                  </span>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* 权限变更差异审计确认弹窗 (Permission Diff Modal) */}
      {permissionModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className={`${currentTheme.cardBg} border ${currentTheme.border} rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4`}>
            <div className="flex items-center gap-3">
              <span className="text-2xl">🛡️</span>
              <div>
                <h3 className={`font-bold ${currentTheme.textPrimary} text-base`}>插件权限变更审计确认</h3>
                <p className={`text-xs ${currentTheme.textMuted} mt-0.5`}>
                  插件【{permissionModal.name}】正在申请扩展运行权限
                </p>
              </div>
            </div>

            <div className={`p-3.5 rounded-xl ${theme === 'light' ? 'bg-amber-50 border-amber-200 text-amber-800' : 'bg-amber-500/10 border-amber-500/30 text-amber-300'} border text-xs leading-relaxed space-y-2`}>
              <p className="font-semibold flex items-center gap-1.5">
                <span>⚠️</span>
                <span>检测到该版本申请了新的权限能力：</span>
              </p>

              {permissionModal.addedCapabilities.length > 0 && (
                <div>
                  <span className={theme === 'light' ? 'text-slate-600' : 'text-slate-400'}>新增系统能力: </span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {permissionModal.addedCapabilities.map((cap, i) => (
                      <span key={i} className={`px-1.5 py-0.5 rounded ${theme === 'light' ? 'bg-amber-100 text-amber-900 border border-amber-200' : 'bg-amber-500/20 text-amber-200'} font-mono text-[11px]`}>
                        {cap}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {permissionModal.addedHosts.length > 0 && (
                <div>
                  <span className={theme === 'light' ? 'text-slate-600' : 'text-slate-400'}>新增网络请求域名: </span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {permissionModal.addedHosts.map((host, i) => (
                      <span key={i} className={`px-1.5 py-0.5 rounded ${theme === 'light' ? 'bg-amber-100 text-amber-900 border border-amber-200' : 'bg-amber-500/20 text-amber-200'} font-mono text-[11px]`}>
                        {host}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <p className={`text-[11px] ${currentTheme.textMuted} pt-1`}>
                版本跨度: v{permissionModal.currentVersion} → v{permissionModal.newVersion}
              </p>
            </div>

            <div className={`text-xs ${currentTheme.textSecondary}`}>
              更新日志: {permissionModal.changelog}
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => setPermissionModal(null)}
                className={`px-4 py-2 rounded-xl text-xs ${currentTheme.btnGhost} transition-colors`}
              >
                暂不升级
              </button>
              <button
                onClick={() => executeUpdate(permissionModal.pluginId, permissionModal.newVersion)}
                className="px-4 py-2 rounded-xl text-xs bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold shadow-lg shadow-amber-500/20 transition-all"
              >
                同意授权并升级
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 集中式下载任务抽屉 (悬浮窗口) */}
      {showTasksDrawer && (
        <div className={`fixed right-0 top-[50px] bottom-0 w-96 ${currentTheme.drawerBg} border-l ${currentTheme.border} shadow-2xl z-40 flex flex-col animate-in slide-in-from-right duration-200`}>
          <div className={`p-4 border-b ${currentTheme.border} flex items-center justify-between`}>
            <div className={`font-semibold text-sm ${currentTheme.textPrimary} flex items-center gap-2`}>
              <span>📥 下载任务列表</span>
              <span className={`text-xs ${currentTheme.textMuted} font-mono`}>({tasks.length})</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => window.hostAPI?.openDownloadDir()}
                className="text-xs text-emerald-500 hover:underline"
              >
                打开文件夹
              </button>
              <button
                onClick={() => setShowTasksDrawer(false)}
                className={`${currentTheme.textMuted} ${currentTheme.hoverText} p-1`}
              >
                ✕
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {tasks.length === 0 ? (
              <div className={`h-40 flex items-center justify-center text-xs ${currentTheme.textMuted}`}>
                暂无下载任务
              </div>
            ) : (
              tasks.map((task) => (
                <div
                  key={task.id}
                  className={`p-3 rounded-lg ${currentTheme.subcardBg} border ${currentTheme.border} text-xs space-y-1.5`}
                >
                  <div className={`font-medium ${currentTheme.textPrimary} truncate`} title={task.filename}>
                    {task.filename}
                  </div>
                  <div className={`flex items-center justify-between ${currentTheme.textMuted} text-[11px]`}>
                    <span>
                      {task.status === 'completed'
                        ? '已完成'
                        : task.status === 'merging'
                        ? '音视频混流中...'
                        : task.status === 'downloading'
                        ? `${task.speed}`
                        : task.status === 'failed'
                        ? `失败: ${task.error || ''}`
                        : '等待中'}
                    </span>
                    <span className="font-mono">{task.progress}%</span>
                  </div>
                  <div className={`w-full h-1.5 ${theme === 'light' ? 'bg-slate-200' : 'bg-slate-800'} rounded-full overflow-hidden`}>
                    <div
                      className={`h-full transition-all duration-300 ${
                        task.status === 'completed'
                          ? 'bg-emerald-500'
                          : task.status === 'merging'
                          ? 'bg-amber-400 animate-pulse'
                          : task.status === 'failed'
                          ? 'bg-rose-500'
                          : 'bg-indigo-500'
                      }`}
                      style={{ width: `${task.progress}%` }}
                    />
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* 主程序在线更新弹窗 */}
      {showUpdateModal && updateInfo && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className={`${currentTheme.cardBg} border ${currentTheme.border} rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-2xl">🚀</span>
                <div>
                  <h3 className={`font-bold ${currentTheme.textPrimary} text-base`}>发现主程序新版本</h3>
                  <p className={`text-xs ${currentTheme.textMuted} mt-0.5`}>
                    Doujiao Host 外壳程序有重要更新可用
                  </p>
                </div>
              </div>
              {!downloadingUpdate && (
                <button
                  onClick={() => setShowUpdateModal(false)}
                  className={`${currentTheme.textMuted} ${currentTheme.hoverText} p-1`}
                >
                  ✕
                </button>
              )}
            </div>

            {/* 版本信息卡 */}
            <div className="p-3.5 rounded-xl bg-indigo-500/10 border border-indigo-500/30 text-indigo-500 text-xs flex items-center justify-between">
              <div>
                <span className={currentTheme.textMuted}>当前版本: </span>
                <span className="font-mono font-semibold">v{updateInfo.currentVersion}</span>
                <span className={`mx-2 ${currentTheme.textMuted}`}>→</span>
                <span className={currentTheme.textMuted}>最新版本: </span>
                <span className="font-mono font-bold text-emerald-500">v{updateInfo.latestVersion}</span>
              </div>
              {updateInfo.size && (
                <span className={`text-[11px] font-mono ${currentTheme.textMuted}`}>
                  ~{(updateInfo.size / (1024 * 1024)).toFixed(1)} MB
                </span>
              )}
            </div>

            {/* 更新日志 */}
            <div className="space-y-1.5">
              <span className={`text-xs font-semibold ${currentTheme.textPrimary}`}>更新日志：</span>
              <div className={`p-3 rounded-xl ${currentTheme.subcardBg} border ${currentTheme.border} text-xs ${currentTheme.textSecondary} font-sans max-h-40 overflow-y-auto whitespace-pre-wrap leading-relaxed`}>
                {updateInfo.changelog || '常规性能优化与体验改进。'}
              </div>
            </div>

            {/* 下载进度条 */}
            {downloadingUpdate && updateProgress && (
              <div className={`p-3.5 rounded-xl ${currentTheme.subcardBg} border ${currentTheme.border} space-y-2`}>
                <div className="flex items-center justify-between text-xs">
                  <span className={`font-medium ${currentTheme.textPrimary}`}>
                    正在下载更新安装包...
                  </span>
                  <span className="text-indigo-500 font-mono font-semibold">
                    {updateProgress.percent}%
                  </span>
                </div>
                <div className={`w-full h-2 ${theme === 'light' ? 'bg-slate-200' : 'bg-slate-800'} rounded-full overflow-hidden`}>
                  <div
                    className="h-full bg-gradient-to-r from-indigo-500 to-emerald-400 transition-all duration-200 rounded-full"
                    style={{ width: `${Math.max(5, updateProgress.percent)}%` }}
                  />
                </div>
                <div className={`text-[11px] ${currentTheme.textMuted} flex justify-between font-mono`}>
                  <span>速度: {updateProgress.speed || '0 KB/s'}</span>
                  {updateProgress.total > 0 && (
                    <span>
                      {(updateProgress.transferred / 1024 / 1024).toFixed(1)}MB / {(updateProgress.total / 1024 / 1024).toFixed(1)}MB
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* 下载完成提示 */}
            {updateDownloaded && (
              <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-300 text-xs flex items-center gap-2">
                <span>✓</span>
                <span>更新安装包下载完成！点击下方按钮将关闭程序并启动安装。</span>
              </div>
            )}

            {/* 操作按钮 */}
            <div className="flex items-center justify-end gap-3 pt-2">
              {!downloadingUpdate && !updateDownloaded && (
                <>
                  <button
                    onClick={() => setShowUpdateModal(false)}
                    className={`px-4 py-2 rounded-xl text-xs ${currentTheme.btnGhost} transition-colors`}
                  >
                    暂不更新
                  </button>
                  <button
                    onClick={handleStartDownloadUpdate}
                    className="px-4 py-2 rounded-xl text-xs bg-indigo-600 hover:bg-indigo-500 text-white font-semibold shadow-lg shadow-indigo-600/20 transition-all flex items-center gap-1.5"
                  >
                    <span>⚡ 立即下载并更新</span>
                  </button>
                </>
              )}

              {downloadingUpdate && (
                <button
                  disabled
                  className={`px-4 py-2 rounded-xl text-xs ${currentTheme.btnGhost} opacity-50 cursor-not-allowed`}
                >
                  正在高速下载中...
                </button>
              )}

              {updateDownloaded && (
                <button
                  onClick={handleInstallAppUpdate}
                  className="px-5 py-2 rounded-xl text-xs bg-emerald-600 hover:bg-emerald-500 text-white font-bold shadow-lg shadow-emerald-600/20 transition-all animate-pulse flex items-center gap-1.5"
                >
                  <span>🚀 立即重启并安装</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  )
}

