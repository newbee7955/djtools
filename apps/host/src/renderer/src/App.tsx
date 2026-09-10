import React, { useState, useEffect } from 'react'
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

  // 统一文件存储与工作目录状态
  const [workspaces, setWorkspaces] = useState<{ downloads: string; notepad: string; markdown: string }>({
    downloads: '',
    notepad: '',
    markdown: ''
  })

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
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-slate-950 text-slate-100 select-none">
      {/* 顶部标题栏 (拖拽区) */}
      <header
        className="h-12 border-b border-slate-800 flex items-center justify-between px-4 bg-slate-900/80 backdrop-blur z-20"
        style={{ WebkitAppRegion: 'drag' } as any}
      >
        <div className="flex items-center gap-3">
          <img
            src={appIcon}
            alt="Logo"
            className="w-8 h-8 object-contain flex-shrink-0 select-none drop-shadow-md transition-transform hover:scale-105"
          />
          <span className="font-bold text-[15px] tracking-wide bg-gradient-to-r from-emerald-400 to-teal-200 bg-clip-text text-transparent">
            豆角工具箱 Doujiao
          </span>
          <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 ml-1.5">
            V2.0 官方版
          </span>
        </div>

        {/* 右侧控制按钮 */}
        <div
          className="flex items-center gap-1"
          style={{ WebkitAppRegion: 'no-drag' } as any}
        >
          {/* 下载托盘按钮 */}
          <button
            onClick={() => setShowTasksDrawer(!showTasksDrawer)}
            className="relative px-3 py-1 mr-2 text-xs rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center gap-1.5 transition-colors"
          >
            <span>📥 下载管理</span>
            {activeDownloadsCount > 0 && (
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span>
            )}
          </button>

          <button
            onClick={() => window.hostAPI?.minimize()}
            className="w-8 h-8 flex items-center justify-center hover:bg-slate-800 text-slate-400 hover:text-white rounded"
          >
            ━
          </button>
          <button
            onClick={() => window.hostAPI?.maximize()}
            className="w-8 h-8 flex items-center justify-center hover:bg-slate-800 text-slate-400 hover:text-white rounded"
          >
            □
          </button>
          <button
            onClick={() => window.hostAPI?.close()}
            className="w-8 h-8 flex items-center justify-center hover:bg-rose-600 text-slate-400 hover:text-white rounded"
          >
            ✕
          </button>
        </div>
      </header>

      {/* 主体双栏布局 */}
      <div className="flex flex-1 overflow-hidden">
        {/* 左侧导航栏 (宽 240px，匹配 WebContentsView 边界) */}
        <aside className="w-60 bg-slate-900 border-r border-slate-800 flex flex-col justify-between p-3 z-10">
          <div className="space-y-1">
            <div className="px-3 py-2 text-[11px] font-semibold tracking-wider text-slate-500 uppercase">
              已安装插件 ({plugins.length})
            </div>

            {plugins.length === 0 ? (
              <div className="px-3 py-4 my-1 rounded-xl bg-slate-950/40 border border-slate-800/60 text-center space-y-1.5">
                <div className="text-xl opacity-60">📦</div>
                <div className="text-xs text-slate-400 font-medium">暂无安装插件</div>
                <p className="text-[10px] text-slate-500">主程序纯净无预装</p>
                <button
                  onClick={() => setActiveTab('market')}
                  className="text-[11px] text-emerald-400 hover:underline pt-1 inline-block"
                >
                  前往插件市场安装 →
                </button>
              </div>
            ) : (
              plugins.map((plugin) => (
                <div
                  key={plugin.id}
                  className={`group relative w-full flex items-center justify-between rounded-lg transition-all ${
                    activeTab === plugin.id
                      ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                      : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                  }`}
                >
                  <button
                    onClick={() => setActiveTab(plugin.id)}
                    className="flex items-center gap-3 px-3 py-2.5 flex-1 min-w-0 text-left"
                  >
                    <span className="text-base flex-shrink-0">
                      {getPluginEmoji(plugin)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="leading-none truncate font-medium">{plugin.name}</div>
                      <div className="text-[10px] text-slate-500 mt-1 flex items-center gap-1.5">
                        <span>v{plugin.version}</span>
                        {plugin.isDev && (
                          <span className="text-amber-400/80">(开发版)</span>
                        )}
                      </div>
                    </div>
                  </button>

                  {!plugin.isDev && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        handleUninstall(plugin.id, plugin.name)
                      }}
                      title={`卸载插件 ${plugin.name}`}
                      className="opacity-0 group-hover:opacity-100 p-2 mr-1 rounded-md hover:bg-rose-500/20 text-slate-500 hover:text-rose-400 transition-all text-xs flex-shrink-0"
                    >
                      🗑️
                    </button>
                  )}
                </div>
              ))
            )}

            <div className="pt-4 px-3 py-2 text-[11px] font-semibold tracking-wider text-slate-500 uppercase">
              系统中心
            </div>

            <button
              onClick={() => setActiveTab('market')}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                activeTab === 'market'
                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                  : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
              }`}
            >
              <span className="text-base">🧩</span>
              <span>插件市场</span>
            </button>

            <button
              onClick={() => setActiveTab('settings')}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                activeTab === 'settings'
                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                  : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
              }`}
            >
              <span className="text-base">⚙️</span>
              <span>应用设置</span>
            </button>
          </div>

          {/* 底部信息 */}
          <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800 text-[11px] text-slate-500 space-y-1">
            <div className="flex justify-between">
              <span>安全机制</span>
              <span className="text-emerald-400 font-mono">官方认证</span>
            </div>
            <div className="flex justify-between">
              <span>FFmpeg 组件</span>
              <span className={`font-mono ${ffmpegStatus.installed ? 'text-emerald-400' : 'text-amber-400'}`}>
                {ffmpegStatus.installed ? '已就绪' : '未安装'}
              </span>
            </div>
            <div className="flex justify-between">
              <span>活动下载</span>
              <span className="text-slate-300 font-mono">{activeDownloadsCount} 项</span>
            </div>
          </div>
        </aside>

        {/* 右侧内容区 */}
        <main className="flex-1 bg-slate-950 overflow-y-auto p-8">
          {installMsg && (
            <div
              className={`mb-6 p-4 rounded-xl border text-xs flex items-center justify-between shadow-lg ${
                installMsg.type === 'success'
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                  : 'bg-rose-500/10 border-rose-500/30 text-rose-400'
              }`}
            >
              <span>{installMsg.text}</span>
              <button onClick={() => setInstallMsg(null)} className="text-slate-400 hover:text-white">✕</button>
            </div>
          )}

          {activeTab === 'market' && (
            <div className="max-w-4xl mx-auto space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h1 className="text-2xl font-bold text-white">官方插件市场</h1>
                  <p className="text-sm text-slate-400 mt-1">
                    经过官方安全认证，即点即装，纯净轻量无干扰
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => fetchMarket(true)}
                    disabled={loadingMarket}
                    className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs transition-colors border border-slate-700"
                  >
                    {loadingMarket ? '刷新中...' : '🔄 刷新'}
                  </button>
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
                    className="p-5 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 transition-colors flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-3">
                          <span className="text-3xl">
                            {getPluginEmoji(plugin)}
                          </span>
                          <div>
                            <h3 className="font-semibold text-white">{plugin.name}</h3>
                            <p className="text-xs text-slate-400 mt-0.5">
                              {plugin.publisher} • 最新 v{plugin.latestVersion}
                              {plugin.size > 0 && ` • ${(plugin.size / 1024).toFixed(0)} KB`}
                            </p>
                          </div>
                        </div>

                        {plugin.hasUpdate ? (
                          <span className="px-2 py-0.5 text-xs rounded bg-amber-500/10 text-amber-400 border border-amber-500/30 animate-pulse">
                            有更新
                          </span>
                        ) : plugin.isInstalled ? (
                          <span className="px-2 py-0.5 text-xs rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                            已安装
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 text-xs rounded bg-slate-800 text-slate-400 border border-slate-700">
                            未安装
                          </span>
                        )}
                      </div>

                      <p className="text-xs text-slate-400 mt-3 leading-relaxed">
                        {plugin.description}
                      </p>


                      {plugin.changelog && (
                        <div className="relative inline-block mt-2.5 group/cl">
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-800/80 border border-slate-700/60 text-[10px] text-slate-400 hover:text-slate-200 hover:border-slate-600 cursor-default transition-colors select-none">
                            <span>📋</span>
                            <span>更新日志</span>
                          </span>
                          {/* Tooltip */}
                          <div className="absolute left-0 bottom-full mb-2 z-50 hidden group-hover/cl:block pointer-events-none w-72">
                            <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl shadow-black/60 p-3">
                              <div className="text-[10px] font-semibold text-slate-400 mb-1.5 flex items-center gap-1">
                                <span>📋</span>
                                <span>更新日志</span>
                              </div>
                              <p className="text-[11px] text-slate-300 leading-relaxed whitespace-pre-wrap break-words">
                                {plugin.changelog.replace(/；/g, '；\n')}
                              </p>
                            </div>
                            {/* 小三角 */}
                            <div className="absolute left-3 top-full w-0 h-0 border-l-4 border-r-4 border-t-4 border-l-transparent border-r-transparent border-t-slate-700" />
                          </div>
                        </div>
                      )}

                      {/* 权限提示标签 */}
                      <div className="mt-3 flex flex-wrap gap-1">
                        {plugin.permissions.map((p, idx) => (
                          <span
                            key={idx}
                            className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 font-mono"
                          >
                            {p.capability}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between">
                      <span className="text-[11px] text-slate-500 font-mono">{plugin.id}</span>
                      <div className="flex items-center gap-2">
                        {plugin.isInstalled && !plugin.hasUpdate && (
                          <button
                            onClick={() => setActiveTab(plugin.id)}
                            className="px-3 py-1 text-xs rounded bg-slate-800 hover:bg-slate-700 text-emerald-400 font-medium transition-colors"
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
                            disabled={installingPluginId === plugin.id}
                            className="px-3.5 py-1 text-xs rounded bg-emerald-600 hover:bg-emerald-500 text-white font-medium transition-colors shadow-md shadow-emerald-600/20"
                          >
                            {installingPluginId === plugin.id ? '安装中...' : '一键安装'}
                          </button>
                        )}

                        {plugin.isInstalled && !plugin.isDev && (
                          <button
                            onClick={() => handleUninstall(plugin.id, plugin.name)}
                            className="px-2.5 py-1 text-xs rounded bg-slate-800/80 hover:bg-rose-500/20 text-rose-400 font-medium transition-colors"
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
                <h1 className="text-2xl font-bold text-white">应用设置</h1>
                <p className="text-sm text-slate-400 mt-1">
                  管理应用通用参数、多媒体组件与数据存储
                </p>
              </div>

              <div className="p-5 rounded-xl bg-slate-900 border border-slate-800 space-y-5">
                {/* 主程序版本与在线更新 */}
                <div className="space-y-3 pb-5 border-b border-slate-800">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="text-sm font-medium text-white flex items-center gap-2">
                        <span>主程序版本与在线更新</span>
                        <span className="text-xs px-2 py-0.5 rounded-full font-mono bg-indigo-500/10 text-indigo-400 border border-indigo-500/30">
                          v{hostVersion}
                        </span>
                      </div>
                      <div className="text-xs text-slate-400 mt-0.5">
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

                  <div className="flex items-center justify-between p-3 rounded-xl bg-slate-950/60 border border-slate-800">
                    <div className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        id="autoCheckHostUpdate"
                        checked={autoCheckUpdate}
                        onChange={(e) => handleToggleAutoCheck(e.target.checked)}
                        className="w-4 h-4 rounded text-indigo-600 focus:ring-0 bg-slate-900 border-slate-700 cursor-pointer"
                      />
                      <label htmlFor="autoCheckHostUpdate" className="cursor-pointer">
                        <div className="text-xs font-semibold text-white">启动时自动检查更新</div>
                        <div className="text-[10px] text-slate-500">开启后每次启动应用静默检查是否有新版本，发现更新即时提醒</div>
                      </label>
                    </div>
                  </div>

                  {updateCardMsg && (
                    <div
                      className={`p-2.5 rounded-lg border text-xs flex items-center justify-between transition-all ${
                        updateCardMsg.type === 'success'
                          ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                          : 'bg-rose-500/10 border-rose-500/30 text-rose-400'
                      }`}
                    >
                      <span>{updateCardMsg.text}</span>
                      <button onClick={() => setUpdateCardMsg(null)} className="text-slate-400 hover:text-white">✕</button>
                    </div>
                  )}
                </div>

                {/* 已安装插件与卸载管理 */}
                <div className="space-y-3 pb-5 border-b border-slate-800">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-medium text-white flex items-center gap-2">
                        <span>已安装插件管理</span>
                        <span className="text-[10px] px-2 py-0.5 rounded-full font-mono bg-slate-800 text-slate-300 border border-slate-700">
                          {plugins.length} 个
                        </span>
                      </div>
                      <div className="text-xs text-slate-400 mt-0.5">
                        查看已安装扩展插件的运行状态，支持一键安全卸载
                      </div>
                    </div>
                    <button
                      onClick={() => setActiveTab('market')}
                      className="text-xs text-emerald-400 hover:underline"
                    >
                      前往市场安装 →
                    </button>
                  </div>

                  {plugins.length === 0 ? (
                    <div className="p-4 rounded-xl bg-slate-950/40 border border-slate-800/80 text-center text-xs text-slate-500">
                      当前暂无已安装插件，可前往插件市场按需下载
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {plugins.map((p) => (
                        <div
                          key={p.id}
                          className="p-3 rounded-lg bg-slate-950/60 border border-slate-800/80 flex items-center justify-between"
                        >
                          <div className="flex items-center gap-3">
                            <span className="text-2xl">
                              {getPluginEmoji(p)}
                            </span>
                            <div>
                              <div className="text-sm font-semibold text-white flex items-center gap-2">
                                <span>{p.name}</span>
                                <span className="text-xs font-mono text-slate-400">v{p.version}</span>
                                {p.isDev ? (
                                  <span className="text-[10px] px-1.5 py-0.2 rounded bg-amber-500/10 text-amber-400 border border-amber-500/30">开发版</span>
                                ) : (
                                  <span className="text-[10px] px-1.5 py-0.2 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">已就绪</span>
                                )}
                              </div>
                              <div className="text-xs text-slate-500 font-mono mt-0.5">{p.id}</div>
                            </div>
                          </div>

                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => setActiveTab(p.id)}
                              className="px-3 py-1 text-xs rounded bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors"
                            >
                              打开
                            </button>
                            {!p.isDev && (
                              <button
                                onClick={() => handleUninstall(p.id, p.name)}
                                className="px-3 py-1 text-xs rounded bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 transition-colors"
                              >
                                彻底卸载
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* 网络代理与 GitHub 连通配置 */}
                <div className="space-y-3 pb-5 border-b border-slate-800">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="text-sm font-medium text-white flex items-center gap-2">
                        <span>网络代理与 GitHub 连通配置</span>
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded-full font-mono ${
                            proxyConfig.mode === 'direct'
                              ? 'bg-slate-800 text-slate-400 border border-slate-700'
                              : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                          }`}
                        >
                          {proxyConfig.mode === 'system'
                            ? '跟随系统代理 (默认)'
                            : proxyConfig.mode === 'direct'
                            ? '关闭代理 (纯直连)'
                            : '自定义代理'}
                        </span>
                      </div>
                      <div className="text-xs text-slate-400 mt-0.5">
                        插件市场与发布包已全面直连 GitHub 官方源（无国内第三方镜像）。默认使用系统代理，可在不需要时一键关闭。
                      </div>
                      <div className="text-[11px] text-slate-500 font-mono mt-1 flex items-center gap-2">
                        <span>GitHub 有效链路:</span>
                        <span className="text-slate-300 bg-slate-950/80 px-2 py-0.5 rounded border border-slate-800">
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
                          ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-300'
                          : 'bg-slate-950/40 border-slate-800 hover:border-slate-700 text-slate-400'
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
                        <div className="text-xs font-semibold text-white">跟随系统代理 (默认)</div>
                        <div className="text-[10px] text-slate-500 mt-0.5">自动同步系统 Clash / VPN / 局域网代理</div>
                      </div>
                    </label>

                    <label
                      onClick={() => handleUpdateProxyMode('direct')}
                      className={`flex items-center gap-2.5 p-3 rounded-xl border cursor-pointer transition-all ${
                        proxyConfig.mode === 'direct'
                          ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-300'
                          : 'bg-slate-950/40 border-slate-800 hover:border-slate-700 text-slate-400'
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
                        <div className="text-xs font-semibold text-white">关闭代理 (纯直连)</div>
                        <div className="text-[10px] text-slate-500 mt-0.5">禁用所有代理规则，直接请求 GitHub</div>
                      </div>
                    </label>

                    <label
                      onClick={() => handleUpdateProxyMode('custom')}
                      className={`flex items-center gap-2.5 p-3 rounded-xl border cursor-pointer transition-all ${
                        proxyConfig.mode === 'custom'
                          ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-300'
                          : 'bg-slate-950/40 border-slate-800 hover:border-slate-700 text-slate-400'
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
                        <div className="text-xs font-semibold text-white">自定义代理地址</div>
                        <div className="text-[10px] text-slate-500 mt-0.5">手动指定 HTTP / SOCKS5 代理端口</div>
                      </div>
                    </label>
                  </div>

                  {/* 自定义代理输入框（当选择自定义代理时显示） */}
                  {proxyConfig.mode === 'custom' && (
                    <div className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800 space-y-3">
                      <div className="flex items-center gap-3">
                        <div className="flex-1">
                          <label className="text-[11px] text-slate-400 block mb-1">代理服务器地址 (HTTP / SOCKS5)</label>
                          <input
                            type="text"
                            value={proxyConfig.customProxyUrl}
                            onChange={(e) => setProxyConfig({ ...proxyConfig, customProxyUrl: e.target.value })}
                            placeholder="http://127.0.0.1:7890 或 socks5://127.0.0.1:1080"
                            className="w-full px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-xs text-white placeholder-slate-600 focus:border-emerald-500 focus:outline-none font-mono"
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
                          ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                          : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
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
                      <button onClick={() => setTestResult(null)} className="text-slate-400 hover:text-white">✕</button>
                    </div>
                  )}
                </div>

                {/* FFmpeg 独立组件配置 */}
                <div className="space-y-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="text-sm font-medium text-white flex items-center gap-2">
                        <span>FFmpeg 多媒体独立扩展组件</span>
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
                            ffmpegStatus.installed
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                              : 'bg-amber-500/10 text-amber-400 border border-amber-500/30'
                          }`}
                        >
                          {ffmpegStatus.installed ? `已就绪 (${ffmpegStatus.source})` : '未安装'}
                        </span>
                      </div>
                      <div className="text-xs text-slate-400 mt-0.5">
                        按需轻量化设计（主程序仅 45MB）。音视频分离流（如 B站 DASH、高清合集）无损合并需此组件。
                      </div>
                      {ffmpegStatus.installed && ffmpegStatus.path && (
                        <div className="text-[11px] text-slate-500 font-mono mt-1 truncate max-w-md">
                          路径: {ffmpegStatus.path} {ffmpegStatus.version ? `(v${ffmpegStatus.version})` : ''}
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-2 flex-shrink-0">
                      {ffmpegStatus.installed && (
                        <button
                          onClick={handleOpenFFmpegDir}
                          className="px-3 py-1.5 text-xs rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors"
                          title="在文件资源管理器中定位组件"
                        >
                          📂 打开目录
                        </button>
                      )}
                      <button
                        onClick={handleSelectFFmpegFile}
                        className="px-3 py-1.5 text-xs rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors"
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
                    <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800 space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-300 font-medium">
                          {ffmpegProgress.text || '正在极速下载并解压组件...'}
                        </span>
                        <span className="text-emerald-400 font-mono font-semibold">
                          {ffmpegProgress.percent}%
                        </span>
                      </div>
                      <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all duration-200 rounded-full"
                          style={{ width: `${Math.max(6, ffmpegProgress.percent)}%` }}
                        />
                      </div>
                      {ffmpegProgress.speed && (
                        <div className="text-[11px] text-slate-500 flex justify-between">
                          <span>实时传输速率</span>
                          <span className="font-mono text-slate-400">{ffmpegProgress.speed}</span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* 卡片就地消息提示 */}
                  {ffmpegCardMsg && (
                    <div
                      className={`p-2.5 rounded-lg border text-xs flex items-center justify-between transition-all ${
                        ffmpegCardMsg.type === 'success'
                          ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                          : 'bg-rose-500/10 border-rose-500/30 text-rose-400'
                      }`}
                    >
                      <span>{ffmpegCardMsg.text}</span>
                      <button onClick={() => setFFmpegCardMsg(null)} className="text-slate-400 hover:text-white">✕</button>
                    </div>
                  )}
                </div>

                {/* 统一文件存储与工作目录管理 */}
                <div className="border-t border-slate-800 pt-4 space-y-3">
                  <div>
                    <div className="text-sm font-medium text-white flex items-center gap-2">
                      <span>文件存储与工作目录管理</span>
                      <span className="text-[10px] px-2 py-0.5 rounded-full font-mono bg-slate-800 text-slate-300 border border-slate-700">
                        安全独立存储
                      </span>
                    </div>
                    <div className="text-xs text-slate-400 mt-0.5">
                      自定义文件下载、记事本与 Markdown 默认保存路径，应用卸载或升级不会删除您的工作文件
                    </div>
                  </div>

                  <div className="space-y-2.5">
                    {/* 通用文件下载 */}
                    <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-base">📥</span>
                          <span className="text-xs font-semibold text-white">统一文件下载目录</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => handleOpenWorkspaceDir('downloads')}
                            className="px-2.5 py-1 text-xs rounded bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
                          >
                            打开目录
                          </button>
                          <button
                            onClick={() => handleSelectWorkspaceDir('downloads')}
                            className="px-2.5 py-1 text-xs rounded bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 transition-colors"
                          >
                            更改目录
                          </button>
                          <button
                            onClick={() => handleResetWorkspaceDir('downloads')}
                            className="px-2.5 py-1 text-xs rounded bg-slate-800/80 hover:bg-slate-700 text-slate-400 transition-colors"
                            title="恢复为系统默认下载目录"
                          >
                            重置
                          </button>
                        </div>
                      </div>
                      <div className="text-[11px] font-mono text-slate-400 bg-slate-900/90 px-2.5 py-1.5 rounded border border-slate-800/80 truncate select-all" title={workspaces.downloads}>
                        {workspaces.downloads || '未设置'}
                      </div>
                    </div>

                    {/* 记事本默认目录 */}
                    <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-base">🗒️</span>
                          <span className="text-xs font-semibold text-white">记事本默认保存目录</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => handleOpenWorkspaceDir('notepad')}
                            className="px-2.5 py-1 text-xs rounded bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
                          >
                            打开目录
                          </button>
                          <button
                            onClick={() => handleSelectWorkspaceDir('notepad')}
                            className="px-2.5 py-1 text-xs rounded bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 transition-colors"
                          >
                            更改目录
                          </button>
                          <button
                            onClick={() => handleResetWorkspaceDir('notepad')}
                            className="px-2.5 py-1 text-xs rounded bg-slate-800/80 hover:bg-slate-700 text-slate-400 transition-colors"
                            title="恢复为文档默认目录"
                          >
                            重置
                          </button>
                        </div>
                      </div>
                      <div className="text-[11px] font-mono text-slate-400 bg-slate-900/90 px-2.5 py-1.5 rounded border border-slate-800/80 truncate select-all" title={workspaces.notepad}>
                        {workspaces.notepad || '未设置'}
                      </div>
                    </div>

                    {/* Markdown 默认目录 */}
                    <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-base">📝</span>
                          <span className="text-xs font-semibold text-white">Markdown 默认保存目录</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => handleOpenWorkspaceDir('markdown')}
                            className="px-2.5 py-1 text-xs rounded bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
                          >
                            打开目录
                          </button>
                          <button
                            onClick={() => handleSelectWorkspaceDir('markdown')}
                            className="px-2.5 py-1 text-xs rounded bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 transition-colors"
                          >
                            更改目录
                          </button>
                          <button
                            onClick={() => handleResetWorkspaceDir('markdown')}
                            className="px-2.5 py-1 text-xs rounded bg-slate-800/80 hover:bg-slate-700 text-slate-400 transition-colors"
                            title="恢复为文档默认目录"
                          >
                            重置
                          </button>
                        </div>
                      </div>
                      <div className="text-[11px] font-mono text-slate-400 bg-slate-900/90 px-2.5 py-1.5 rounded border border-slate-800/80 truncate select-all" title={workspaces.markdown}>
                        {workspaces.markdown || '未设置'}
                      </div>
                    </div>
                  </div>
                </div>

                {/* 抖音凭证 */}
                <div className="border-t border-slate-800 pt-4 flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium text-white">抖音网页端隔离会话</div>
                    <div className="text-xs text-slate-400 mt-0.5">
                      {douyinLoggedIn ? (
                        <span className="text-emerald-400">✓ 已捕获有效凭证（自动附加安全凭据，保护账户隐私）</span>
                      ) : (
                        <span className="text-amber-400">未检测到登录凭证，部分高清视频与合集可能受限</span>
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
                <div className="border-t border-slate-800 pt-4 flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium text-white">应用运行与安全防护</div>
                    <div className="text-xs text-slate-400 mt-0.5">
                      独立进程运行、网络安全防护、防篡改数字签名与独立数据存储
                    </div>
                  </div>
                  <span className="text-xs font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
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
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3">
              <span className="text-2xl">🛡️</span>
              <div>
                <h3 className="font-bold text-white text-base">插件权限变更审计确认</h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  插件【{permissionModal.name}】正在申请扩展运行权限
                </p>
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs leading-relaxed space-y-2">
              <p className="font-semibold flex items-center gap-1.5">
                <span>⚠️</span>
                <span>检测到该版本申请了新的权限能力：</span>
              </p>

              {permissionModal.addedCapabilities.length > 0 && (
                <div>
                  <span className="text-slate-400">新增系统能力: </span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {permissionModal.addedCapabilities.map((cap, i) => (
                      <span key={i} className="px-1.5 py-0.5 rounded bg-amber-500/20 font-mono text-[11px] text-amber-200">
                        {cap}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {permissionModal.addedHosts.length > 0 && (
                <div>
                  <span className="text-slate-400">新增网络请求域名: </span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {permissionModal.addedHosts.map((host, i) => (
                      <span key={i} className="px-1.5 py-0.5 rounded bg-amber-500/20 font-mono text-[11px] text-amber-200">
                        {host}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <p className="text-[11px] text-slate-400 pt-1">
                版本跨度: v{permissionModal.currentVersion} → v{permissionModal.newVersion}
              </p>
            </div>

            <div className="text-xs text-slate-400">
              更新日志: {permissionModal.changelog}
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => setPermissionModal(null)}
                className="px-4 py-2 rounded-xl text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
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
        <div className="fixed right-0 top-12 bottom-0 w-96 bg-slate-900 border-l border-slate-800 shadow-2xl z-30 flex flex-col">
          <div className="p-4 border-b border-slate-800 flex items-center justify-between">
            <div className="font-semibold text-sm text-white flex items-center gap-2">
              <span>📥 下载任务列表</span>
              <span className="text-xs text-slate-400 font-mono">({tasks.length})</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => window.hostAPI?.openDownloadDir()}
                className="text-xs text-emerald-400 hover:underline"
              >
                打开文件夹
              </button>
              <button
                onClick={() => setShowTasksDrawer(false)}
                className="text-slate-400 hover:text-white p-1"
              >
                ✕
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {tasks.length === 0 ? (
              <div className="h-40 flex items-center justify-center text-xs text-slate-500">
                暂无下载任务
              </div>
            ) : (
              tasks.map((task) => (
                <div
                  key={task.id}
                  className="p-3 rounded-lg bg-slate-950 border border-slate-800 text-xs space-y-1.5"
                >
                  <div className="font-medium text-slate-200 truncate" title={task.filename}>
                    {task.filename}
                  </div>
                  <div className="flex items-center justify-between text-slate-400 text-[11px]">
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
                  <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
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
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-2xl">🚀</span>
                <div>
                  <h3 className="font-bold text-white text-base">发现主程序新版本</h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Doujiao Host 外壳程序有重要更新可用
                  </p>
                </div>
              </div>
              {!downloadingUpdate && (
                <button
                  onClick={() => setShowUpdateModal(false)}
                  className="text-slate-400 hover:text-white p-1"
                >
                  ✕
                </button>
              )}
            </div>

            {/* 版本信息卡 */}
            <div className="p-3.5 rounded-xl bg-indigo-500/10 border border-indigo-500/30 text-indigo-200 text-xs flex items-center justify-between">
              <div>
                <span className="text-slate-400">当前版本: </span>
                <span className="font-mono font-semibold">v{updateInfo.currentVersion}</span>
                <span className="mx-2 text-slate-500">→</span>
                <span className="text-slate-400">最新版本: </span>
                <span className="font-mono font-bold text-emerald-400">v{updateInfo.latestVersion}</span>
              </div>
              {updateInfo.size && (
                <span className="text-[11px] font-mono text-slate-400">
                  ~{(updateInfo.size / (1024 * 1024)).toFixed(1)} MB
                </span>
              )}
            </div>

            {/* 更新日志 */}
            <div className="space-y-1.5">
              <span className="text-xs font-semibold text-slate-300">更新日志：</span>
              <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800 text-xs text-slate-300 font-sans max-h-40 overflow-y-auto whitespace-pre-wrap leading-relaxed">
                {updateInfo.changelog || '常规性能优化与体验改进。'}
              </div>
            </div>

            {/* 下载进度条 */}
            {downloadingUpdate && updateProgress && (
              <div className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-300 font-medium">
                    正在下载更新安装包...
                  </span>
                  <span className="text-indigo-400 font-mono font-semibold">
                    {updateProgress.percent}%
                  </span>
                </div>
                <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-indigo-500 to-emerald-400 transition-all duration-200 rounded-full"
                    style={{ width: `${Math.max(5, updateProgress.percent)}%` }}
                  />
                </div>
                <div className="text-[11px] text-slate-500 flex justify-between font-mono">
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
              <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2">
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
                    className="px-4 py-2 rounded-xl text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
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
                  className="px-4 py-2 rounded-xl text-xs bg-slate-800 text-slate-400 cursor-not-allowed"
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

