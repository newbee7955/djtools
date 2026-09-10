import React, { useState, useEffect, useRef } from 'react'
import {
  getSDK,
  LanTransferServerStatus,
  LanTransferSharedFile,
  LanTransferReceivedFile,
  LanTransferMessage,
  LanTransferEvent
} from '@doujiao/plugin-sdk'

export default function App(): JSX.Element {
  const [sdk, setSdk] = useState<any>(null)
  const [status, setStatus] = useState<LanTransferServerStatus | null>(null)
  const [activeTab, setActiveTab] = useState<'received' | 'send' | 'text'>('received')

  const [receivedFiles, setReceivedFiles] = useState<LanTransferReceivedFile[]>([])
  const [sharedFiles, setSharedFiles] = useState<LanTransferSharedFile[]>([])
  const [messages, setMessages] = useState<LanTransferMessage[]>([])
  const [inputText, setInputText] = useState('')

  const [isQrModalOpen, setIsQrModalOpen] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [toastMsg, setToastMsg] = useState<string | null>(null)

  const messagesEndRef = useRef<HTMLDivElement>(null)

  // 显示简易 Toast
  const showToast = (msg: string) => {
    setToastMsg(msg)
    setTimeout(() => {
      setToastMsg((cur) => (cur === msg ? null : cur))
    }, 2800)
  }

  // 初始化 SDK 与数据同步
  useEffect(() => {
    try {
      const s = getSDK()
      setSdk(s)

      if (s.lan) {
        // 1. 默认自动启动服务并加载状态
        s.lan.startServer().then((initialStatus) => {
          setStatus(initialStatus)
        })

        // 2. 加载数据
        s.lan.getReceivedFiles().then(setReceivedFiles)
        s.lan.getShareFiles().then(setSharedFiles)
        s.lan.getMessages().then(setMessages)

        // 3. 监听实时事件
        const unsubscribe = s.lan.onEvent((event: LanTransferEvent) => {
          if (event.type === 'file-received') {
            s.lan?.getReceivedFiles().then(setReceivedFiles)
            showToast(`🎉 收到来自 ${event.payload?.senderDevice || '手机'} 的文件: ${event.payload?.name}`)
          } else if (event.type === 'message-received') {
            s.lan?.getMessages().then((msgs) => {
              setMessages(msgs)
              messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
            })
            if (event.payload?.sender === 'mobile') {
              showToast(`💬 收到手机文字: ${event.payload?.text?.slice(0, 20)}...`)
            }
          } else if (event.type === 'share-downloaded') {
            s.lan?.getShareFiles().then(setSharedFiles)
            showToast(`📥 手机已下载: ${event.payload?.fileName}`)
          } else if (event.type === 'device-connected') {
            s.lan?.getStatus().then(setStatus)
            showToast(`📱 新设备已连接: ${event.payload?.deviceName}`)
          } else if (event.type === 'device-disconnected') {
            s.lan?.getStatus().then(setStatus)
            showToast(`👋 设备已断开: ${event.payload?.deviceName || '手机'}`)
          } else if (event.type === 'server-status') {
            s.lan?.getStatus().then(setStatus)
          }
        })

        // 4. 定期保底轮询，保持设备在线状态与后台严格同步
        const timer = setInterval(() => {
          s.lan?.getStatus().then(setStatus)
        }, 3000)

        return () => {
          unsubscribe?.()
          clearInterval(timer)
        }
      }
    } catch (err) {
      console.warn('[LanTransfer] 初始化 SDK 失败:', err)
    }
  }, [])

  // 格式化文件大小
  const formatSize = (bytes: number) => {
    if (!bytes || bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return (bytes / Math.pow(k, i)).toFixed(1) + ' ' + sizes[i]
  }

  // 格式化时间
  const formatTime = (ts: number) => {
    const d = new Date(ts)
    const pad = (n: number) => (n < 10 ? '0' + n : n)
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  }

  // 获取文件图标
  const getFileIcon = (name: string) => {
    const ext = name.split('.').pop()?.toLowerCase() || ''
    if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'].includes(ext)) return '🖼️'
    if (['mp4', 'mov', 'mkv', 'webm', 'avi', 'flv'].includes(ext)) return '🎬'
    if (['mp3', 'm4a', 'flac', 'wav', 'aac', 'ogg'].includes(ext)) return '🎵'
    if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return '📦'
    if (['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'md'].includes(ext)) return '📄'
    if (['apk', 'ipa'].includes(ext)) return '📱'
    return '📁'
  }

  // 复制文字到剪贴板
  const handleCopyText = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      showToast('已复制到剪贴板')
    })
  }

  // 切换服务启动 / 停止
  const toggleServer = async () => {
    if (!sdk?.lan) return
    if (status?.running) {
      await sdk.lan.stopServer()
      const s = await sdk.lan.getStatus()
      setStatus(s)
      showToast('服务已停止')
    } else {
      const s = await sdk.lan.startServer()
      setStatus(s)
      showToast('服务已启动')
    }
  }

  // 切换 IP
  const handleSwitchIp = async (ip: string) => {
    if (!sdk?.lan) return
    const s = await sdk.lan.switchIp(ip)
    setStatus(s)
    showToast(`已切换绑定 IP 至: ${ip}`)
  }

  // 切换验证码保护
  const handleToggleAuth = async () => {
    if (!sdk?.lan || !status) return
    const next = !status.authEnabled
    const s = await sdk.lan.setAuthEnabled(next)
    setStatus(s)
    showToast(next ? '已开启连接验证码保护' : '已关闭验证码（允许局域网免密访问）')
  }

  // 刷新验证码
  const handleRefreshPin = async () => {
    if (!sdk?.lan) return
    const s = await sdk.lan.refreshPin()
    setStatus(s)
    showToast('已刷新 6 位连接验证码')
  }

  // 切换二维码自动携带验证码
  const handleToggleAutoPinInQr = async () => {
    if (!sdk?.lan || !status) return
    const next = !status.autoPinInQr
    const s = await sdk.lan.setAutoPinInQr(next)
    setStatus(s)
    showToast(next ? '二维码已附带验证码（扫码免手输）' : '二维码不附带验证码（需手动输入）')
  }

  // 更改接收目录
  const handleSelectSaveDir = async () => {
    if (!sdk?.lan) return
    const res = await sdk.lan.selectSaveDirectory()
    if (!res.canceled && res.directoryPath) {
      const s = await sdk.lan.getStatus()
      setStatus(s)
      showToast('接收目录已更新')
    }
  }

  // 打开接收目录
  const handleOpenSaveDir = async () => {
    if (!sdk?.lan) return
    await sdk.lan.openSaveDirectory()
  }

  // 选择电脑文件发送
  const handleSelectFilesToSend = async () => {
    if (!sdk?.lan) return
    const res = await sdk.lan.selectFilesToSend()
    if (!res.canceled && res.filePaths?.length > 0) {
      const added = await sdk.lan.addShareFiles(res.filePaths)
      setSharedFiles((prev) => [...prev, ...added])
      showToast(`已添加 ${added.length} 个共享文件`)
    }
  }

  // 拖拽文件进入
  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
    if (!sdk?.lan) return

    const files = Array.from(e.dataTransfer.files)
    const paths: string[] = []
    for (const f of files) {
      let p = ''
      if (typeof sdk.getPathForFile === 'function') {
        p = sdk.getPathForFile(f)
      }
      if (!p && (f as any).path) {
        p = (f as any).path
      }
      if (p) paths.push(p)
    }

    if (paths.length > 0) {
      const added = await sdk.lan.addShareFiles(paths)
      setSharedFiles((prev) => [...prev, ...added])
      showToast(`已成功添加 ${added.length} 个文件待发送至手机`)
    } else {
      showToast('未检测到有效的文件路径，请重试')
    }
  }

  // 移除共享文件
  const handleRemoveShare = async (id: string) => {
    if (!sdk?.lan) return
    await sdk.lan.removeShareFile(id)
    setSharedFiles((prev) => prev.filter((f) => f.id !== id))
    showToast('已取消共享')
  }

  // 打开接收的文件
  const handleOpenFile = async (localPath: string) => {
    if (!sdk?.lan) return
    const ok = await sdk.lan.openFile(localPath)
    if (!ok) showToast('文件不存在或已被移动')
  }

  // 在文件夹中定位文件
  const handleShowInFolder = async (localPath: string) => {
    if (!sdk?.lan) return
    const ok = await sdk.lan.showItemInFolder(localPath)
    if (!ok) showToast('无法在文件夹中定位文件')
  }

  // 删除接收的文件
  const handleDeleteReceived = async (id: string) => {
    if (!sdk?.lan) return
    if (confirm('确定删除该文件吗？文件将从电脑磁盘中移除。')) {
      await sdk.lan.deleteReceivedFile(id)
      setReceivedFiles((prev) => prev.filter((f) => f.id !== id))
      showToast('文件已删除')
    }
  }

  // 发送文本消息
  const handleSendMessage = async () => {
    if (!sdk?.lan || !inputText.trim()) return
    const msg = await sdk.lan.sendTextMessage(inputText.trim())
    setMessages((prev) => [...prev, msg])
    setInputText('')
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  // 清空文本消息
  const handleClearMessages = async () => {
    if (!sdk?.lan) return
    if (confirm('确定清空所有文本互传记录吗？')) {
      await sdk.lan.clearMessages()
      setMessages([])
      showToast('消息记录已清空')
    }
  }

  return (
    <div className="flex flex-col h-screen bg-slate-950 text-slate-100 font-sans select-none overflow-hidden">
      {/* 简易 Toast */}
      {toastMsg && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-full bg-slate-800/95 border border-sky-500/50 text-sky-300 text-xs shadow-xl shadow-sky-950/40 animate-bounce">
          {toastMsg}
        </div>
      )}

      {/* 顶部主控状态栏 */}
      <header className="flex-shrink-0 bg-slate-900 border-b border-slate-800 px-5 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-sky-500 to-emerald-400 flex items-center justify-center text-lg shadow-lg shadow-sky-500/20">
            ⚡
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-base text-white">局域网快传</span>
              <span
                className={`text-[11px] px-2 py-0.5 rounded-full border ${
                  status?.running
                    ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-400'
                    : 'bg-slate-700/20 border-slate-700 text-slate-400'
                }`}
              >
                {status?.running ? '● 正在运行' : '○ 已停止'}
              </span>
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5 flex items-center gap-2">
              <span>电脑手机秒级互传 · 零外网流量 · 免装 App</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* 网卡 IP 下拉选择 */}
          {status?.allIps && status.allIps.length > 1 && (
            <div className="flex items-center gap-1.5 bg-slate-950/80 border border-slate-800 rounded-lg px-2.5 py-1.5">
              <span className="text-xs text-slate-400">网卡:</span>
              <select
                value={status.ip}
                onChange={(e) => handleSwitchIp(e.target.value)}
                className="bg-transparent text-xs text-sky-400 focus:outline-none cursor-pointer"
              >
                {status.allIps.map((nic) => (
                  <option key={nic.ip} value={nic.ip} className="bg-slate-900 text-white">
                    {nic.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* 接收目录 */}
          <div className="flex items-center gap-1 bg-slate-950/80 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-300">
            <span className="text-slate-500">存至:</span>
            <span className="max-w-[130px] truncate text-slate-300 font-mono" title={status?.saveDirectory}>
              {status?.saveDirectory ? status.saveDirectory.split(/[\\/]/).pop() : '豆角快传'}
            </span>
            <button
              onClick={handleSelectSaveDir}
              className="ml-1 text-slate-400 hover:text-sky-400 transition-colors"
              title="更改保存目录"
            >
              ⚙️
            </button>
            <button
              onClick={handleOpenSaveDir}
              className="ml-1 text-slate-400 hover:text-sky-400 transition-colors"
              title="在文件夹中打开"
            >
              📂
            </button>
          </div>

          {/* 服务启停切换按钮 */}
          <button
            onClick={toggleServer}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              status?.running
                ? 'bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30'
                : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-md shadow-emerald-600/30'
            }`}
          >
            {status?.running ? '停止服务' : '启动服务'}
          </button>
        </div>
      </header>

      {/* 中部核心区：扫码看板与主要内容 */}
      <div className="flex-1 flex overflow-hidden">
        {/* 左侧栏：手机连接与二维码看板 */}
        <aside className="w-80 border-r border-slate-800 bg-slate-900/60 p-5 flex flex-col justify-between overflow-y-auto">
          <div>
            <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
              📱 手机扫码免装 App 极速互传
            </div>

            {/* 二维码卡片 */}
            <div className="bg-slate-950 border border-slate-800 rounded-2xl p-4 flex flex-col items-center text-center shadow-lg relative group">
              {status?.running && status?.qrCodeSvg ? (
                <>
                  <div
                    className="w-48 h-48 bg-white p-2 rounded-xl flex items-center justify-center cursor-pointer transition-transform hover:scale-105 shadow-md"
                    onClick={() => setIsQrModalOpen(true)}
                    title="点击放大二维码"
                    dangerouslySetInnerHTML={{ __html: status.qrCodeSvg }}
                  />
                  <div className="mt-3 text-[11px] text-slate-400 flex items-center gap-1 cursor-pointer hover:text-sky-400" onClick={() => setIsQrModalOpen(true)}>
                    <span>🔍 点击可全屏放大</span>
                  </div>
                </>
              ) : (
                <div className="w-48 h-48 bg-slate-900 rounded-xl border border-dashed border-slate-800 flex flex-col items-center justify-center text-slate-500 text-xs p-4">
                  <span className="text-2xl mb-2">⏸️</span>
                  <span>服务未启动</span>
                  <button
                    onClick={toggleServer}
                    className="mt-3 text-xs text-sky-400 hover:underline font-semibold"
                  >
                    立即启动
                  </button>
                </div>
              )}

              {/* 访问地址与快捷复制 */}
              {status?.running && (
                <div className="w-full mt-4 bg-slate-900/90 border border-slate-800 rounded-xl p-2.5 flex items-center justify-between gap-2">
                  <div className="font-mono text-xs text-sky-400 truncate text-left" title={status.url}>
                    {status.url}
                  </div>
                  <button
                    onClick={() => handleCopyText(status.url)}
                    className="flex-shrink-0 px-2.5 py-1 bg-sky-500/10 hover:bg-sky-500/20 text-sky-400 rounded-lg text-[11px] border border-sky-500/30 transition-all font-medium"
                  >
                    复制
                  </button>
                </div>
              )}
            </div>

            {/* 连接验证码卡片 */}
            {status?.running && (
              <div className="mt-3.5 bg-slate-950/80 border border-slate-800 rounded-xl p-3 shadow-md">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-300">
                    <span>🔒 连接验证码</span>
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded ${
                        status?.authEnabled
                          ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                          : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      {status?.authEnabled ? '已启用' : '已关闭'}
                    </span>
                  </div>
                  <button
                    onClick={handleToggleAuth}
                    className={`text-[11px] px-2 py-0.5 rounded transition-colors ${
                      status?.authEnabled
                        ? 'text-slate-400 hover:text-rose-400'
                        : 'text-emerald-400 hover:text-emerald-300'
                    }`}
                    title={status?.authEnabled ? '点击关闭验证码（免密模式）' : '点击开启验证码保护'}
                  >
                    {status?.authEnabled ? '关闭' : '开启'}
                  </button>
                </div>

                {status?.authEnabled ? (
                  <div>
                    <div className="flex items-center justify-between bg-slate-900/90 border border-slate-800 rounded-lg px-3 py-2">
                      <span className="font-mono text-lg font-bold tracking-widest text-sky-400">
                        {status?.authPin ? `${status.authPin.slice(0, 3)} ${status.authPin.slice(3)}` : '------'}
                      </span>
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={handleRefreshPin}
                          className="px-2 py-1 text-[11px] text-slate-400 hover:text-sky-400 hover:bg-slate-800 rounded transition-colors"
                          title="刷新验证码"
                        >
                          🔄 换一个
                        </button>
                        <button
                          onClick={() => handleCopyText(status?.authPin || '')}
                          className="px-2 py-1 text-[11px] text-slate-400 hover:text-sky-400 hover:bg-slate-800 rounded transition-colors"
                          title="复制验证码"
                        >
                          📋 复制
                        </button>
                      </div>
                    </div>

                    <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400">
                      <label className="flex items-center gap-1.5 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={status?.autoPinInQr ?? true}
                          onChange={handleToggleAutoPinInQr}
                          className="rounded border-slate-700 bg-slate-900 text-sky-500 focus:ring-0 focus:ring-offset-0 w-3.5 h-3.5"
                        />
                        <span>扫码自动携带验证码</span>
                      </label>
                      <span className="text-[10px] text-slate-500">免手动输入</span>
                    </div>
                  </div>
                ) : (
                  <div className="text-[11px] text-slate-400 py-0.5">
                    当前处于免密直连模式，同 Wi-Fi 设备可直接访问。
                  </div>
                )}
              </div>
            )}

            {/* 极简步骤引导 */}
            <div className="mt-4 bg-slate-950/40 border border-slate-800/80 rounded-xl p-3.5 text-xs text-slate-400 space-y-2">
              <div className="flex items-start gap-2">
                <span className="w-4 h-4 rounded-full bg-sky-500/20 text-sky-400 flex items-center justify-center text-[10px] font-bold flex-shrink-0 mt-0.5">
                  1
                </span>
                <span>确保手机与电脑连入同一 Wi-Fi 或局域网。</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="w-4 h-4 rounded-full bg-sky-500/20 text-sky-400 flex items-center justify-center text-[10px] font-bold flex-shrink-0 mt-0.5">
                  2
                </span>
                <span>打开手机微信、相机或浏览器扫描上方二维码。</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="w-4 h-4 rounded-full bg-sky-500/20 text-sky-400 flex items-center justify-center text-[10px] font-bold flex-shrink-0 mt-0.5">
                  3
                </span>
                <span>网页秒开，直接拍照、选图选视频，双向极速秒传！</span>
              </div>
            </div>
          </div>

          {/* 底部已连接设备状态 */}
          <div className="mt-4 pt-4 border-t border-slate-800/80">
            <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
              <span>在线连入设备</span>
              <span className="text-sky-400 font-mono font-bold">
                {status?.connectedDevices?.length || 0} 台
              </span>
            </div>
            {status?.connectedDevices && status.connectedDevices.length > 0 ? (
              <div className="space-y-1.5 max-h-32 overflow-y-auto">
                {status.connectedDevices.map((dev) => (
                  <div
                    key={dev.id}
                    className="flex items-center justify-between text-xs bg-slate-950/60 p-2 rounded-lg border border-slate-800"
                  >
                    <div className="flex items-center gap-1.5 truncate">
                      <span className="text-emerald-400">●</span>
                      <span className="truncate text-slate-200">{dev.deviceName}</span>
                    </div>
                    <span className="font-mono text-[10px] text-slate-500">{dev.ip}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-[11px] text-slate-500 text-center py-2 bg-slate-950/40 rounded-lg">
                等待手机扫码连入...
              </div>
            )}
          </div>
        </aside>

        {/* 右侧主工作区：Tab 切换与列表 */}
        <main className="flex-1 flex flex-col bg-slate-950 overflow-hidden">
          {/* Tab 选项卡 */}
          <div className="flex items-center justify-between border-b border-slate-800 px-6 pt-3">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setActiveTab('received')}
                className={`pb-3 px-3 text-sm font-semibold border-b-2 transition-all flex items-center gap-2 ${
                  activeTab === 'received'
                    ? 'border-sky-500 text-sky-400'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                <span>📥 来自手机的文件</span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 font-mono">
                  {receivedFiles.length}
                </span>
              </button>

              <button
                onClick={() => setActiveTab('send')}
                className={`pb-3 px-3 text-sm font-semibold border-b-2 transition-all flex items-center gap-2 ${
                  activeTab === 'send'
                    ? 'border-sky-500 text-sky-400'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                <span>📤 电脑待发文件箱</span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 font-mono">
                  {sharedFiles.length}
                </span>
              </button>

              <button
                onClick={() => setActiveTab('text')}
                className={`pb-3 px-3 text-sm font-semibold border-b-2 transition-all flex items-center gap-2 ${
                  activeTab === 'text'
                    ? 'border-sky-500 text-sky-400'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                <span>💬 局域网剪切板 / 文本速传</span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 font-mono">
                  {messages.length}
                </span>
              </button>
            </div>

            {activeTab === 'received' && (
              <button
                onClick={handleOpenSaveDir}
                className="text-xs text-sky-400 hover:text-sky-300 flex items-center gap-1 mb-2 font-medium"
              >
                <span>📂 打开接收文件夹</span>
              </button>
            )}

            {activeTab === 'send' && (
              <button
                onClick={handleSelectFilesToSend}
                className="text-xs px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-medium flex items-center gap-1.5 mb-2 shadow-sm transition-all"
              >
                <span>➕ 选择电脑文件</span>
              </button>
            )}

            {activeTab === 'text' && (
              <button
                onClick={handleClearMessages}
                className="text-xs text-slate-400 hover:text-rose-400 transition-colors mb-2"
              >
                清空文字记录
              </button>
            )}
          </div>

          {/* 选项卡内容展示 */}
          <div className="flex-1 overflow-y-auto p-6">
            {/* 1. 手机接收文件列表 */}
            {activeTab === 'received' && (
              <div>
                {receivedFiles.length === 0 ? (
                  <div className="h-96 flex flex-col items-center justify-center text-slate-500">
                    <span className="text-5xl mb-3">📭</span>
                    <span className="text-sm text-slate-300 font-medium">尚未接收到手机文件</span>
                    <span className="text-xs text-slate-500 mt-1">
                      手机扫码后点击「📷 选取相册照片/视频」或「📁 选取本地文件」，文件将秒速存入电脑
                    </span>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {receivedFiles.map((file) => (
                      <div
                        key={file.id}
                        className="bg-slate-900 border border-slate-800 rounded-xl p-3.5 hover:border-slate-700 transition-all flex flex-col justify-between group shadow-sm"
                      >
                        <div className="flex items-start gap-3">
                          <span className="text-3xl flex-shrink-0 mt-0.5">{getFileIcon(file.name)}</span>
                          <div className="min-w-0 flex-1">
                            <div
                              className="text-sm font-semibold text-slate-200 truncate cursor-pointer hover:text-sky-400"
                              onClick={() => handleOpenFile(file.localPath)}
                              title={file.name}
                            >
                              {file.name}
                            </div>
                            <div className="text-[11px] text-slate-400 mt-1 flex items-center gap-2">
                              <span>{formatSize(file.size)}</span>
                              <span>·</span>
                              <span className="text-emerald-400 font-medium truncate">
                                📱 {file.senderDevice}
                              </span>
                            </div>
                            <div className="text-[10px] text-slate-500 mt-1">
                              接收时间: {formatTime(file.receivedAt)}
                            </div>
                          </div>
                        </div>

                        {/* 快捷操作栏 */}
                        <div className="mt-3 pt-2.5 border-t border-slate-800/80 flex items-center justify-between text-xs">
                          <button
                            onClick={() => handleOpenFile(file.localPath)}
                            className="text-sky-400 hover:text-sky-300 font-medium"
                          >
                            打开文件
                          </button>
                          <button
                            onClick={() => handleShowInFolder(file.localPath)}
                            className="text-slate-400 hover:text-slate-200"
                          >
                            定位
                          </button>
                          <button
                            onClick={() => handleDeleteReceived(file.id)}
                            className="text-rose-400 hover:text-rose-300"
                          >
                            删除
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* 2. 发给手机待发箱 */}
            {activeTab === 'send' && (
              <div>
                {/* 拖拽上传投放区 */}
                <div
                  onDragOver={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    e.dataTransfer.dropEffect = 'copy'
                    setIsDragging(true)
                  }}
                  onDragLeave={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    setIsDragging(false)
                  }}
                  onDrop={handleDrop}
                  className={`border-2 border-dashed rounded-2xl p-8 text-center transition-all cursor-pointer mb-6 ${
                    isDragging
                      ? 'border-sky-400 bg-sky-500/20 scale-[1.01] shadow-lg shadow-sky-500/10'
                      : 'border-slate-800 bg-slate-900/40 hover:border-slate-700 hover:bg-slate-900/60'
                  }`}
                  onClick={handleSelectFilesToSend}
                >
                  <div className="text-4xl mb-2">📂</div>
                  <div className="text-sm font-semibold text-slate-200">
                    将电脑文件拖拽至此，或点击选择文件
                  </div>
                  <div className="text-xs text-slate-500 mt-1">
                    添加后的文件将在手机端网页的「来自电脑」列表中即时出现，手机一键下载保存
                  </div>
                </div>

                {/* 已共享文件清单 */}
                {sharedFiles.length === 0 ? (
                  <div className="text-center py-10 text-slate-500 text-xs">
                    暂未添加准备发给手机的文件
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {sharedFiles.map((file) => (
                      <div
                        key={file.id}
                        className="bg-slate-900 border border-slate-800 rounded-xl p-3.5 flex items-center justify-between gap-3 shadow-sm"
                      >
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <span className="text-2xl flex-shrink-0">{getFileIcon(file.name)}</span>
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-semibold text-slate-200 truncate" title={file.name}>
                              {file.name}
                            </div>
                            <div className="text-[11px] text-slate-400 mt-0.5 flex items-center gap-2">
                              <span>{formatSize(file.size)}</span>
                              <span>·</span>
                              <span className="text-sky-400 font-mono">
                                手机已下载 {file.downloadCount || 0} 次
                              </span>
                            </div>
                          </div>
                        </div>

                        <button
                          onClick={() => handleRemoveShare(file.id)}
                          className="text-xs text-slate-400 hover:text-rose-400 p-1.5 transition-colors"
                          title="取消共享"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* 3. 局域网文本互传 */}
            {activeTab === 'text' && (
              <div className="flex flex-col h-full">
                {/* 消息对话流 */}
                <div className="flex-1 overflow-y-auto space-y-3 pr-2 mb-4">
                  {messages.length === 0 ? (
                    <div className="h-64 flex flex-col items-center justify-center text-slate-500 text-xs">
                      <span className="text-4xl mb-2">💬</span>
                      <span>暂无文字互传记录</span>
                      <span className="text-slate-600 mt-1">
                        在下方输入文本、验证码或网址，手机扫码后在「文本互传」标签秒同步
                      </span>
                    </div>
                  ) : (
                    messages.map((m) => {
                      const isPc = m.sender === 'pc'
                      const isUrl = /^https?:\/\//i.test(m.text)
                      return (
                        <div
                          key={m.id}
                          className={`flex flex-col ${isPc ? 'items-end' : 'items-start'}`}
                        >
                          <div className="flex items-center gap-2 text-[10px] text-slate-500 mb-1 px-1">
                            <span>{isPc ? '💻 电脑本机' : `📱 ${m.senderDevice || '手机'}`}</span>
                            <span>{formatTime(m.timestamp)}</span>
                          </div>
                          <div
                            className={`max-w-[70%] p-3.5 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap break-words shadow-md ${
                              isPc
                                ? 'bg-sky-600 text-white rounded-tr-none'
                                : 'bg-slate-900 border border-slate-800 text-slate-100 rounded-tl-none'
                            }`}
                          >
                            <div>{m.text}</div>
                            <div className="mt-2 pt-2 border-t border-white/10 flex items-center justify-between gap-3 text-xs">
                              <button
                                onClick={() => handleCopyText(m.text)}
                                className="text-[11px] opacity-80 hover:opacity-100 hover:underline"
                              >
                                📋 复制文字
                              </button>
                              {isUrl && (
                                <a
                                  href={m.text}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-[11px] opacity-80 hover:opacity-100 underline"
                                >
                                  🔗 打开网址
                                </a>
                              )}
                            </div>
                          </div>
                        </div>
                      )
                    })
                  )}
                  <div ref={messagesEndRef} />
                </div>

                {/* 文本输入框 */}
                <div className="flex gap-2 pt-2 border-t border-slate-800">
                  <input
                    type="text"
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSendMessage()
                    }}
                    placeholder="输入长文本、链接或验证码，按回车发送给手机..."
                    className="flex-1 px-4 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-sm text-white focus:outline-none focus:border-sky-500 font-sans"
                  />
                  <button
                    onClick={handleSendMessage}
                    disabled={!inputText.trim()}
                    className="px-5 py-2.5 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white font-semibold text-sm rounded-xl transition-all shadow-md shadow-sky-600/20"
                  >
                    发送
                  </button>
                </div>
              </div>
            )}
          </div>
        </main>
      </div>

      {/* 二维码全屏放大弹窗 (方便跨房间/大屏幕远距离扫码) */}
      {isQrModalOpen && status?.qrCodeSvg && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-6"
          onClick={() => setIsQrModalOpen(false)}
        >
          <div
            className="bg-slate-900 border border-slate-700 rounded-3xl p-8 max-w-sm w-full flex flex-col items-center text-center shadow-2xl relative"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setIsQrModalOpen(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-white text-lg"
            >
              ✕
            </button>
            <div className="font-bold text-lg text-white mb-2">手机扫码极速互传</div>
            <div className="text-xs text-slate-400 mb-6">
              请确保手机与当前电脑连入同一 Wi-Fi
            </div>

            <div
              className="w-72 h-72 bg-white p-3 rounded-2xl flex items-center justify-center shadow-inner"
              dangerouslySetInnerHTML={{ __html: status.qrCodeSvg }}
            />

            <div className="mt-6 text-sm font-mono text-sky-400 bg-slate-950 px-4 py-2 rounded-xl border border-slate-800">
              {status.url}
            </div>

            <button
              onClick={() => {
                handleCopyText(status.url)
                setIsQrModalOpen(false)
              }}
              className="mt-4 px-6 py-2 bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold rounded-xl"
            >
              复制访问链接
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
