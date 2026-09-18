import React, { useState, useEffect, useCallback, useRef } from 'react'
import type {
  DoujiaoSDK,
  RemoteAssistDeviceInfo,
  RemoteAssistPermission,
  RemoteAssistSessionStatus,
  RemoteAssistEvent
} from '@doujiao/plugin-sdk'

const sdk = window.doujiaoSDK as DoujiaoSDK | undefined

// 会话结束原因 -> 可读中文说明（存在即为异常结束）
const SESSION_END_REASON_TEXT: Record<string, string> = {
  'handshake-timeout': 'WebRTC 握手超时，可能被 NAT/防火墙阻断，请确认信令服务已配置 TURN 中继',
  'connection-failed': 'WebRTC 连接中断',
  'handshake-error': 'WebRTC 握手报文处理失败',
  'screen-capture-failed': '受控端屏幕捕获失败或超时',
  'request-denied': '对方拒绝了本次协助请求',
  'peer-disconnected': '对端已断开连接',
  'consent-timeout': '请求超时未确认已自动取消',
  'request-timeout': '等待对方响应超时，对方可能未在线或未确认',
  'peer-offline': '目标设备不在线或设备代码错误'
}

// 传输模式 / 状态的中文展示映射
const TRANSFER_MODE_LABEL: Record<string, string> = {
  send: '文件',
  'clipboard-file': '剪贴板文件',
  'clipboard-image': '剪贴板图片'
}

const TRANSFER_STATUS_LABEL: Record<string, string> = {
  pending: '等待中',
  active: '传输中',
  done: '已完成',
  failed: '失败',
  rejected: '已拒绝',
  cancelled: '已取消'
}

// 终态集合：这些状态下不再显示「取消」按钮
const TRANSFER_TERMINAL_STATUSES = new Set(['done', 'failed', 'rejected', 'cancelled'])

// 传输历史最多保留的条数（保留最新）
const TRANSFER_HISTORY_LIMIT = 50

// 将字节数格式化为易读文本
const formatBytes = (bytes: number): string => {
  if (!bytes || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  return `${value >= 10 || unitIndex === 0 ? Math.round(value) : value.toFixed(1)} ${units[unitIndex]}`
}

// 传输设置 / 传输项 / 会话消息 结构
interface TransferPolicy {
  receiveFiles: boolean
  clipboard: { text: boolean; image: boolean; file: boolean }
}

interface TransferItem {
  transferId: string
  mode: string
  direction: 'outgoing' | 'incoming'
  totalBytes: number
  transferredBytes: number
  status: string
  message?: string
}

interface ChatItem {
  id: string
  text: string
  direction: 'in' | 'out'
}

export default function App() {
  const [deviceInfo, setDeviceInfo] = useState<RemoteAssistDeviceInfo>({
    deviceCode: '--- --- ---',
    rawDeviceId: '',
    displayName: '本地设备',
    signalingStatus: 'disconnected'
  })

  const [targetCode, setTargetCode] = useState('')
  const [targetSafetyCode, setTargetSafetyCode] = useState('')
  const [permission, setPermission] = useState<RemoteAssistPermission>('control')
  const [sessionStatus, setSessionStatus] = useState<RemoteAssistSessionStatus | null>(null)
  const [copied, setCopied] = useState(false)
  const [copiedSafety, setCopiedSafety] = useState(false)
  const [refreshingSafety, setRefreshingSafety] = useState(false)
  const [loading, setLoading] = useState(false)
  const [showServerModal, setShowServerModal] = useState(false)
  const [serverUrlInput, setServerUrlInput] = useState('')
  const [preferredFps, setPreferredFps] = useState<number>(() => {
    const saved = localStorage.getItem('doujiao:remote-assist:default-fps')
    return saved ? Number(saved) : 60
  })

  const handleFpsChange = async (newFps: number) => {
    setPreferredFps(newFps)
    localStorage.setItem('doujiao:remote-assist:default-fps', String(newFps))
    if (sdk?.remoteAssist?.setPreferredFps) {
      try {
        await sdk.remoteAssist.setPreferredFps(newFps)
      } catch (err) {
        console.warn('同步帧率偏好失败:', err)
      }
    }
  }

  // 待确认的入站请求
  const [incomingRequest, setIncomingRequest] = useState<{
    requestId: string
    fromDeviceCode: string
    fromDisplayName: string
    permission: RemoteAssistPermission
    safetyCode: string
    providedSafetyCode?: string
    safetyCodeMatched?: boolean
  } | null>(null)

  // 本地物理抢占提示（被控端移动本地鼠标/键盘时短暂显示）
  const [localOverride, setLocalOverride] = useState(false)
  const overrideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 传输与共享（文件传输 / 剪贴板同步）
  // 与宿主安全默认（receiveFiles=false）保持一致：在 getSettings() 返回前不得展示更宽松的状态
  const [transferPolicy, setTransferPolicy] = useState<TransferPolicy>({
    receiveFiles: false,
    clipboard: { text: true, image: true, file: true }
  })
  // 与 transferPolicy 同步的最新值引用：同一 tick 内连续切换时基于最新值合成下一个策略
  const transferPolicyRef = useRef<TransferPolicy>({
    receiveFiles: false,
    clipboard: { text: true, image: true, file: true }
  })
  // 单调递增的 setPolicy 调用序号：只有最新一次失败才允许回滚，避免慢失败覆盖更新的成功更新
  const policySeqRef = useRef(0)
  // 用户是否已手动修改过策略：挂载时的 getSettings() 不得覆盖用户在此之后改动
  const policyTouchedRef = useRef(false)
  // 用户是否已手动编辑过接收目录输入：挂载时的 getSettings() 不得覆盖该编辑
  const receiveDirTouchedRef = useRef(false)
  const [receiveDir, setReceiveDir] = useState('')
  const [receiveDirInput, setReceiveDirInput] = useState('')
  const [savingDir, setSavingDir] = useState(false)
  const [transfers, setTransfers] = useState<TransferItem[]>([])
  const [chats, setChats] = useState<ChatItem[]>([])
  const [chatInput, setChatInput] = useState('')

  // 仅查看会话下禁止主动发送：本机作为控制方且权限非 control 即不可发送
  const canSend = !(sessionStatus?.role === 'controller' && sessionStatus.permission !== 'control')

  const refreshDeviceInfo = useCallback(async () => {
    if (!sdk?.remoteAssist) return
    try {
      const info = await sdk.remoteAssist.getDeviceInfo()
      setDeviceInfo(info)
      if (typeof (info as any).preferredFps === 'number' && !localStorage.getItem('doujiao:remote-assist:default-fps')) {
        setPreferredFps((info as any).preferredFps)
      }
      if ((info as any).pendingRequest) {
        setIncomingRequest((info as any).pendingRequest)
      }
    } catch (err) {
      console.error('获取设备信息失败:', err)
    }
  }, [])

  useEffect(() => {
    refreshDeviceInfo()

    if (!sdk?.remoteAssist) return

    const unsubscribe = sdk.remoteAssist.onEvent((event: RemoteAssistEvent) => {
      switch (event.type) {
        case 'signaling-status':
          setDeviceInfo((prev) => ({ ...prev, signalingStatus: event.status }))
          break

        case 'incoming-request':
          setIncomingRequest(event)
          break

        case 'local-override':
          setLocalOverride(true)
          if (overrideTimerRef.current) clearTimeout(overrideTimerRef.current)
          overrideTimerRef.current = setTimeout(() => setLocalOverride(false), 1500)
          break

        case 'session-state':
          setSessionStatus(event.status)
          if (event.status.phase === 'idle') {
            setLoading(false)
          }
          break

        case 'session-ended': {
          setSessionStatus(null)
          setIncomingRequest(null)
          setLoading(false)
          const reasonText = SESSION_END_REASON_TEXT[event.reason] || event.reason || '正常断开'
          const isFailure = Boolean(SESSION_END_REASON_TEXT[event.reason])
          sdk?.ui.notify({
            message: `远程协助会话已结束（${reasonText}）`,
            type: isFailure ? 'error' : 'info'
          })
          break
        }

        case 'transfer-state': {
          const state = event.state
          setTransfers((prev) => {
            const index = prev.findIndex((item) => item.transferId === state.transferId)
            const next = index === -1
              ? [...prev, state]
              : prev.slice().map((item, i) => (i === index ? { ...item, ...state } : item))
            // 只保留最新的 TRANSFER_HISTORY_LIMIT 条，避免列表无界增长
            return next.length > TRANSFER_HISTORY_LIMIT ? next.slice(next.length - TRANSFER_HISTORY_LIMIT) : next
          })
          break
        }

        case 'transfer-chat':
          setChats((prev) => [
            ...prev,
            { id: `in-${Date.now()}-${prev.length}`, text: event.text, direction: 'in' }
          ])
          break

        case 'clipboard-applied':
          sdk?.ui.notify({
            message: `已应用剪贴板（${event.kind === 'text' ? '文本' : event.kind === 'image' ? '图片' : '文件'}）`,
            type: 'success'
          })
          break
      }
    })

    return () => {
      unsubscribe()
      if (overrideTimerRef.current) clearTimeout(overrideTimerRef.current)
    }
  }, [refreshDeviceInfo])

  // 窗口/标签页获得焦点或变为可见时，自动刷新设备信息并拾取未处理的请求
  useEffect(() => {
    const handleFocus = () => {
      refreshDeviceInfo()
    }
    window.addEventListener('focus', handleFocus)
    document.addEventListener('visibilitychange', handleFocus)
    return () => {
      window.removeEventListener('focus', handleFocus)
      document.removeEventListener('visibilitychange', handleFocus)
    }
  }, [refreshDeviceInfo])

  // 挂载时读取传输设置（接收策略 + 接收目录）
  useEffect(() => {
    const loadTransferSettings = async () => {
      if (!sdk?.remoteAssist?.transfer?.getSettings) return
      try {
        const settings = await sdk.remoteAssist.transfer.getSettings()
        // 用户在 getSettings 返回前已手动改动策略时，不得用拉取到的旧值覆盖
        if (settings?.policy && !policyTouchedRef.current) {
          setTransferPolicy(settings.policy)
          transferPolicyRef.current = settings.policy
        }
        if (typeof settings?.receiveDir === 'string' && !receiveDirTouchedRef.current) {
          setReceiveDir(settings.receiveDir)
          setReceiveDirInput(settings.receiveDir)
        }
      } catch (err) {
        console.error('读取传输设置失败:', err)
      }
    }
    loadTransferSettings()
  }, [])

  const handleCopyCode = () => {
    if (!deviceInfo.deviceCode) return
    navigator.clipboard.writeText(deviceInfo.deviceCode)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
    sdk?.ui.notify({ message: '设备代码已复制到剪贴板', type: 'success' })
  }

  const handleCopySafetyCode = () => {
    if (!deviceInfo.safetyCode) return
    navigator.clipboard.writeText(deviceInfo.safetyCode)
    setCopiedSafety(true)
    setTimeout(() => setCopiedSafety(false), 2000)
    sdk?.ui.notify({ message: '固定安全码已复制到剪贴板', type: 'success' })
  }

  const handleRefreshSafetyCode = async () => {
    if (!sdk?.remoteAssist?.refreshSafetyCode) return
    setRefreshingSafety(true)
    try {
      const newCode = await sdk.remoteAssist.refreshSafetyCode()
      setDeviceInfo((prev) => ({ ...prev, safetyCode: newCode }))
      sdk?.ui.notify({ message: `固定安全码已刷新为: ${newCode}`, type: 'success' })
    } catch (err: any) {
      sdk?.ui.notify({ message: `刷新固定安全码失败: ${err.message || err}`, type: 'error' })
    } finally {
      setRefreshingSafety(false)
    }
  }

  const handleRequestSession = async () => {
    if (!sdk?.remoteAssist) return
    const cleanTarget = targetCode.trim()
    if (!cleanTarget) {
      sdk?.ui.notify({ message: '请输入伙伴的9位设备代码', type: 'warning' })
      return
    }

    setLoading(true)
    try {
      if (sdk?.remoteAssist?.setPreferredFps) {
        try {
          await sdk.remoteAssist.setPreferredFps(preferredFps)
        } catch {}
      }
      const status = await sdk.remoteAssist.requestSession(cleanTarget, permission, targetSafetyCode.trim() || undefined)
      setSessionStatus(status)
    } catch (err: any) {
      setLoading(false)
      sdk?.ui.notify({ message: `请求协助失败: ${err.message || err}`, type: 'error' })
    }
  }

  const handleRespond = async (decision: 'view' | 'control' | 'deny') => {
    if (!sdk?.remoteAssist || !incomingRequest) return
    const reqId = incomingRequest.requestId
    setIncomingRequest(null)
    try {
      await sdk.remoteAssist.respondToSession(reqId, decision)
    } catch (err: any) {
      sdk?.ui.notify({ message: `响应请求异常: ${err.message || err}`, type: 'error' })
    }
  }

  const handleDisconnect = async () => {
    if (!sdk?.remoteAssist || !sessionStatus) return
    try {
      await sdk.remoteAssist.disconnect(sessionStatus.sessionId)
      setSessionStatus(null)
    } catch (err: any) {
      sdk?.ui.notify({ message: `断开连接异常: ${err.message || err}`, type: 'error' })
    }
  }

  // 更新接收策略（接收文件 + 剪贴板各类开关），并同步到宿主
  // updater 基于最新策略计算 next，避免同一 tick 内多次切换互相覆盖
  const applyPolicy = async (updater: (prev: TransferPolicy) => TransferPolicy) => {
    const previous = transferPolicyRef.current
    const next = updater(previous)
    // 标记用户已改动策略，阻止挂载时 getSettings() 的迟到结果覆盖
    policyTouchedRef.current = true
    // 本次调用的序号：只有仍是最新一次时才允许回滚
    const seq = (policySeqRef.current += 1)
    transferPolicyRef.current = next
    setTransferPolicy(next)
    if (!sdk?.remoteAssist?.transfer?.setPolicy) return
    try {
      await sdk.remoteAssist.transfer.setPolicy(next)
    } catch (err: any) {
      // 已有更新的 setPolicy 调用（可能已成功）：不回滚，避免慢失败覆盖较新的值
      if (seq !== policySeqRef.current) return
      // 宿主写入失败：回滚本地乐观更新，避免复选框与宿主实际策略不一致
      transferPolicyRef.current = previous
      setTransferPolicy(previous)
      sdk?.ui.notify({ message: `更新传输设置失败: ${err?.message || err}`, type: 'error' })
    }
  }

  const handleToggleReceiveFiles = (value: boolean) => {
    applyPolicy((prev) => ({ ...prev, receiveFiles: value }))
  }

  const handleToggleClipboard = (key: 'text' | 'image' | 'file', value: boolean) => {
    applyPolicy((prev) => ({
      ...prev,
      clipboard: { ...prev.clipboard, [key]: value }
    }))
  }

  const handleSaveReceiveDir = async () => {
    if (!sdk?.remoteAssist?.transfer?.setReceiveDir) return
    const dir = receiveDirInput.trim()
    if (!dir) {
      sdk?.ui.notify({ message: '请输入接收目录路径', type: 'warning' })
      return
    }
    setSavingDir(true)
    try {
      await sdk.remoteAssist.transfer.setReceiveDir(dir)
      setReceiveDir(dir)
      sdk?.ui.notify({ message: '接收目录已保存', type: 'success' })
    } catch (err: any) {
      sdk?.ui.notify({ message: `保存接收目录失败: ${err?.message || err}`, type: 'error' })
    } finally {
      setSavingDir(false)
    }
  }

  const handleOpenReceiveFolder = async () => {
    if (!sdk?.remoteAssist?.transfer?.openReceiveFolder) return
    try {
      await sdk.remoteAssist.transfer.openReceiveFolder()
    } catch (err: any) {
      sdk?.ui.notify({ message: `打开接收文件夹失败: ${err?.message || err}`, type: 'error' })
    }
  }

  const handleChooseAndSend = async () => {
    if (!canSend) {
      sdk?.ui.notify({ message: '仅查看会话下不可发送文件', type: 'info' })
      return
    }
    if (!sdk?.remoteAssist?.transfer?.chooseAndSend) return
    try {
      const transferId = await sdk.remoteAssist.transfer.chooseAndSend()
      if (transferId) {
        sdk?.ui.notify({ message: '已开始发送文件', type: 'info' })
      }
    } catch (err: any) {
      sdk?.ui.notify({ message: `发送文件失败: ${err?.message || err}`, type: 'error' })
    }
  }

  const handleCancelTransfer = async (transferId: string) => {
    if (!sdk?.remoteAssist?.transfer?.cancel) return
    try {
      await sdk.remoteAssist.transfer.cancel(transferId)
    } catch (err: any) {
      sdk?.ui.notify({ message: `取消传输失败: ${err?.message || err}`, type: 'error' })
    }
  }

  const handleSendChat = async () => {
    const text = chatInput.trim()
    if (!canSend) {
      sdk?.ui.notify({ message: '仅查看会话下不可发送消息', type: 'info' })
      return
    }
    if (!text || !sdk?.remoteAssist?.transfer?.sendChat) return
    try {
      await sdk.remoteAssist.transfer.sendChat(text)
      setChats((prev) => [...prev, { id: `out-${Date.now()}-${prev.length}`, text, direction: 'out' }])
      setChatInput('')
    } catch (err: any) {
      sdk?.ui.notify({ message: `发送消息失败: ${err?.message || err}`, type: 'error' })
    }
  }

  // 固定安全码明确不符时严禁放行，必须重新核对设备
  const safetyMismatch = incomingRequest?.safetyCodeMatched === false

  return (
    <div className="container">
      <header className="header">
        <h1>🖥️ 豆角远程协助</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div className="status-badge">
            <span className={`status-dot ${deviceInfo.signalingStatus}`} />
            {deviceInfo.signalingStatus === 'connected'
              ? '信令服务在线'
              : deviceInfo.signalingStatus === 'connecting'
              ? '信令连接中...'
              : '信令离线'}
          </div>
          <button
            className="btn btn-secondary"
            style={{ padding: '4px 8px', fontSize: '12px' }}
            onClick={() => {
              setServerUrlInput(deviceInfo.signalingUrl || '')
              setShowServerModal(true)
            }}
            title="配置信令服务器地址"
          >
            ⚙️ 设置
          </button>
        </div>
      </header>

      {/* 本地物理抢占提示 */}
      {localOverride && (
        <div className="local-override-banner">
          ⚠️ 已检测到本地鼠标/键盘操作，远端输入已临时暂停
        </div>
      )}

      {/* 活跃会话状态栏 */}
      {sessionStatus && sessionStatus.phase !== 'idle' && (
        <div className="active-session-banner">
          <div>
            <div style={{ fontWeight: 600, fontSize: '15px' }}>
              正在进行协助: {sessionStatus.peerDeviceCode} ({sessionStatus.role === 'controller' ? '控制方' : '受控方'})
            </div>
            <div style={{ color: 'var(--text-secondary)', fontSize: '13px', marginTop: '4px', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '6px' }}>
              <span>模式: {sessionStatus.permission === 'control' ? '键鼠控制' : '仅查看屏幕'}</span>
              {sessionStatus.connectionModeText && (
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    padding: '1px 6px',
                    borderRadius: '4px',
                    fontSize: '11px',
                    fontWeight: 600,
                    background: sessionStatus.connectionMode === 'relay' ? 'rgba(245, 158, 11, 0.15)' : 'rgba(16, 185, 129, 0.15)',
                    color: sessionStatus.connectionMode === 'relay' ? '#f59e0b' : '#10b981',
                    border: `1px solid ${sessionStatus.connectionMode === 'relay' ? 'rgba(245, 158, 11, 0.4)' : 'rgba(16, 185, 129, 0.4)'}`
                  }}
                >
                  ● {sessionStatus.connectionModeText}
                  {sessionStatus.rttMs !== undefined && ` (${sessionStatus.rttMs}ms)`}
                </span>
              )}
              {sessionStatus.role === 'controlled' && sessionStatus.safetyCode && (
                <span>● 本机固定安全码: {sessionStatus.safetyCode}</span>
              )}
              {sessionStatus.phase === 'requesting' && <span>(等待对方同意...)</span>}
              {sessionStatus.phase === 'connecting' && <span>(WebRTC 握手中...)</span>}
            </div>
          </div>
          <button className="btn btn-danger" onClick={handleDisconnect}>
            断开连接
          </button>
        </div>
      )}

      <div className="cards-grid">
        {/* 卡片 1: 允许协助 */}
        <div className="assist-card">
          <div className="card-title">
            <span>【允许协助】</span>
            <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>让伙伴连接本机</span>
          </div>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
            将下方的 9 位设备代码与固定安全码分享给协助者。你也可以随时点击刷新更换固定安全码。
          </p>

          <div style={{ marginTop: '8px' }}>
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
              本机设备代码:
            </div>
            <div className="device-code-box">
              <span className="device-code">{deviceInfo.deviceCode}</span>
              <button className="btn btn-secondary" onClick={handleCopyCode}>
                {copied ? '已复制' : '复制'}
              </button>
            </div>
          </div>

          <div style={{ marginTop: '12px' }}>
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
              本机固定安全码（相当于连接口令，可手动刷新）:
            </div>
            <div className="device-code-box">
              <span className="device-code" style={{ fontSize: '20px', letterSpacing: '2px', color: 'var(--accent-color)' }}>
                {deviceInfo.safetyCode || '------'}
              </span>
              <div style={{ display: 'flex', gap: '6px' }}>
                <button className="btn btn-secondary" onClick={handleCopySafetyCode}>
                  {copiedSafety ? '已复制' : '复制'}
                </button>
                <button
                  className="btn btn-secondary"
                  onClick={handleRefreshSafetyCode}
                  disabled={refreshingSafety}
                  title="手动生成新的固定安全码"
                >
                  {refreshingSafety ? '刷新中...' : '🔄 刷新'}
                </button>
              </div>
            </div>
          </div>

          <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '12px' }}>
            状态: {deviceInfo.signalingStatus === 'connected'
              ? '● 在线，等待连接 (仅受控，免开本地监听端口)'
              : deviceInfo.signalingStatus === 'connecting'
              ? '● 连接信令服务中...'
              : '○ 信令离线 (请点击右上角⚙️检查服务器地址)'}
          </div>
        </div>

        {/* 卡片 2: 远程协助他人 */}
        <div className="assist-card">
          <div className="card-title">
            <span>【远程协助他人】</span>
            <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>连接伙伴桌面</span>
          </div>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
            输入伙伴提供的 9 位设备代码与固定安全码，选择协助模式发起连接。
          </p>

          <div style={{ marginTop: '8px' }}>
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
              伙伴设备代码:
            </div>
            <input
              className="input-field"
              placeholder="例如: 123 456 789"
              value={targetCode}
              onChange={(e) => setTargetCode(e.target.value)}
              disabled={loading || (sessionStatus !== null && sessionStatus.phase !== 'idle')}
            />
          </div>

          <div style={{ marginTop: '10px' }}>
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
              伙伴固定安全码（选填，填写后自动校验）:
            </div>
            <input
              className="input-field"
              placeholder="例如: 582 109"
              value={targetSafetyCode}
              onChange={(e) => setTargetSafetyCode(e.target.value)}
              disabled={loading || (sessionStatus !== null && sessionStatus.phase !== 'idle')}
            />
          </div>

          <div style={{ marginTop: '10px' }}>
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
              默认画面帧率偏好:
            </div>
            <select
              className="input-field"
              value={preferredFps}
              onChange={(e) => handleFpsChange(Number(e.target.value))}
              disabled={loading || (sessionStatus !== null && sessionStatus.phase !== 'idle')}
            >
              <option value={60}>60 FPS (极致流畅，适合局域网/高性能网络)</option>
              <option value={30}>30 FPS (平衡省流，画质稳定/降低带宽)</option>
              <option value={15}>15 FPS (极度省流，适合弱网/低功耗)</option>
            </select>
          </div>

          <div className="radio-group" style={{ marginTop: '12px' }}>
            <label className="radio-label">
              <input
                type="radio"
                name="permission"
                checked={permission === 'control'}
                onChange={() => setPermission('control')}
              />
              键鼠控制
            </label>
            <label className="radio-label">
              <input
                type="radio"
                name="permission"
                checked={permission === 'view'}
                onChange={() => setPermission('view')}
              />
              仅查看屏幕
            </label>
          </div>
          <button
            className="btn btn-primary"
            onClick={handleRequestSession}
            disabled={loading || (sessionStatus !== null && sessionStatus.phase !== 'idle')}
          >
            {loading ? '正在发起连接...' : '发起协助请求'}
          </button>
        </div>
      </div>

      {/* 卡片 3: 传输与共享 */}
      <div className="assist-card">
        <div className="card-title">
          <span>【传输与共享】</span>
          <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>文件传输与剪贴板同步</span>
        </div>

        <div className="transfer-grid">
          {/* 左列：接收策略与剪贴板同步 */}
          <div className="transfer-column">
            {/* 接收策略 */}
            <label className="switch-row">
              <input
                type="checkbox"
                checked={transferPolicy.receiveFiles}
                onChange={(e) => handleToggleReceiveFiles(e.target.checked)}
                disabled={!sdk?.remoteAssist?.transfer}
              />
              <span>是否允许接收文件</span>
            </label>

            {/* 剪贴板同步 */}
            <div className="transfer-subsection">
              <div className="transfer-subsection-title">剪贴板同步</div>
              <div className="clipboard-switches">
                <label className="switch-row">
                  <input
                    type="checkbox"
                    checked={transferPolicy.clipboard.text}
                    onChange={(e) => handleToggleClipboard('text', e.target.checked)}
                    disabled={!sdk?.remoteAssist?.transfer}
                  />
                  <span>文本</span>
                </label>
                <label className="switch-row">
                  <input
                    type="checkbox"
                    checked={transferPolicy.clipboard.image}
                    onChange={(e) => handleToggleClipboard('image', e.target.checked)}
                    disabled={!sdk?.remoteAssist?.transfer}
                  />
                  <span>图片</span>
                </label>
                <label className="switch-row">
                  <input
                    type="checkbox"
                    checked={transferPolicy.clipboard.file}
                    onChange={(e) => handleToggleClipboard('file', e.target.checked)}
                    disabled={!sdk?.remoteAssist?.transfer}
                  />
                  <span>文件</span>
                </label>
              </div>
              <div className="privacy-hint">
                ⚠️ 剪贴板内容可能包含密码等敏感信息，请仅在可信设备间开启同步。
              </div>
            </div>
          </div>

          {/* 右列：接收目录与文件发送 */}
          <div className="transfer-column">
            {/* 接收目录 */}
            <div className="transfer-subsection">
              <div className="transfer-subsection-title">接收目录</div>
              <input
                className="input-field"
                style={{ fontSize: '13px', letterSpacing: 'normal', textAlign: 'left' }}
                placeholder="例如: D:\\Downloads\\豆角接收"
                value={receiveDirInput}
                onChange={(e) => {
                  receiveDirTouchedRef.current = true
                  setReceiveDirInput(e.target.value)
                }}
              />
              <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                <button className="btn btn-secondary" onClick={handleSaveReceiveDir} disabled={savingDir}>
                  {savingDir ? '保存中...' : '保存目录'}
                </button>
                <button className="btn btn-secondary" onClick={handleOpenReceiveFolder}>
                  打开接收文件夹
                </button>
              </div>
              {receiveDir && <div className="transfer-note">当前目录: {receiveDir}</div>}
            </div>

            <button
              className="btn btn-primary"
              style={{ marginTop: 'auto', width: '100%' }}
              onClick={handleChooseAndSend}
              disabled={!sdk?.remoteAssist?.transfer || !canSend || !sessionStatus || sessionStatus.phase !== 'connected'}
              title={
                !canSend || !sessionStatus || sessionStatus.phase !== 'connected'
                  ? '需在已连接且允许发送的协助会话中发送'
                  : undefined
              }
            >
              📎 发送文件
            </button>
          </div>
        </div>

        {/* 底部：传输历史与会话消息 */}
        <div className="transfer-logs-grid">
          {/* 传输历史 */}
          <div className="transfer-subsection">
            <div className="transfer-subsection-title">传输历史</div>
            {transfers.length === 0 ? (
              <div className="transfer-empty">暂无传输记录</div>
            ) : (
              <div className="transfer-list">
                {transfers.map((item) => {
                  const percent =
                    item.totalBytes > 0
                      ? Math.min(100, Math.round((item.transferredBytes / item.totalBytes) * 100))
                      : 0
                  const finished = TRANSFER_TERMINAL_STATUSES.has(item.status)
                  return (
                    <div className="transfer-item" key={item.transferId}>
                      <div className="transfer-item-head">
                        <span className={`transfer-direction ${item.direction}`}>
                          {item.direction === 'outgoing' ? '发送' : '接收'}
                        </span>
                        <span className="transfer-name">
                          {item.message || TRANSFER_MODE_LABEL[item.mode] || '文件'}
                        </span>
                        <span className={`transfer-status ${item.status}`}>
                          {TRANSFER_STATUS_LABEL[item.status] || item.status}
                        </span>
                      </div>
                      <div className="progress-bar">
                        <div className="progress-fill" style={{ width: `${percent}%` }} />
                      </div>
                      <div className="transfer-item-foot">
                        <span>
                          {formatBytes(item.transferredBytes)} / {formatBytes(item.totalBytes)} ({percent}%)
                        </span>
                        {!finished && (
                          <button
                            className="btn btn-danger"
                            style={{ padding: '2px 8px', fontSize: '12px' }}
                            onClick={() => handleCancelTransfer(item.transferId)}
                          >
                            取消
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* 会话消息（transfer-chat） */}
          <div className="transfer-subsection">
            <div className="transfer-subsection-title">会话消息</div>
            <div className="chat-list">
              {chats.length === 0 ? (
                <div className="transfer-empty">暂无消息</div>
              ) : (
                chats.map((chat) => (
                  <div key={chat.id} className={`chat-item ${chat.direction}`}>
                    {chat.text}
                  </div>
                ))
              )}
            </div>
            <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
              <input
                className="input-field"
                style={{ fontSize: '13px', letterSpacing: 'normal', textAlign: 'left' }}
                placeholder={canSend ? '输入消息后回车发送' : '仅查看会话下不可发送'}
                value={chatInput}
                disabled={!canSend}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return
                  if (e.nativeEvent.isComposing || e.keyCode === 229) return
                  handleSendChat()
                }}
              />
              <button className="btn btn-primary" onClick={handleSendChat} disabled={!canSend} title={canSend ? undefined : '仅查看会话下不可发送'}>
                发送
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 确认授权弹窗 */}
      {incomingRequest && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h2 style={{ fontSize: '18px', fontWeight: 700 }}>收到远程协助请求</h2>
            <p style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>
              来自 <strong>{incomingRequest.fromDisplayName}</strong> ({incomingRequest.fromDeviceCode}) 请求协助您的电脑。
            </p>
            <p style={{ fontSize: '13px' }}>
              请求模式: <strong>{incomingRequest.permission === 'control' ? '键鼠控制' : '仅查看屏幕'}</strong>
            </p>
            <div style={{ textAlign: 'center', marginTop: '8px' }}>
              <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '6px' }}>
                {incomingRequest.safetyCodeMatched === true ? (
                  <span style={{ color: 'var(--success-color)', fontWeight: 600 }}>
                    ✅ 对方填写的固定安全码已核对一致:
                  </span>
                ) : incomingRequest.safetyCodeMatched === false ? (
                  <span style={{ color: 'var(--danger-color)', fontWeight: 600 }}>
                    ⚠️ 对方填写的固定安全码不符！请注意甄别:
                  </span>
                ) : (
                  <span>请与对方核对本机 6 位固定安全码是否一致:</span>
                )}
              </div>
              <div className="safety-code-display">
                {incomingRequest.safetyCode}
              </div>
              {incomingRequest.providedSafetyCode && incomingRequest.safetyCodeMatched === false && (
                <div style={{ fontSize: '12px', color: 'var(--danger-color)', marginTop: '4px' }}>
                  对方填写: <strong style={{ fontFamily: 'monospace' }}>{incomingRequest.providedSafetyCode}</strong>
                  {' / '}
                  本机固定安全码: <strong style={{ fontFamily: 'monospace' }}>{incomingRequest.safetyCode}</strong>
                </div>
              )}
            </div>
            {safetyMismatch && (
              <p style={{ fontSize: '12px', color: 'var(--danger-color)', marginTop: '10px', textAlign: 'center' }}>
                固定安全码不符，已禁用授权。请通过其他可信渠道与对方重新核对设备代码与固定安全码后重试。
              </p>
            )}
            <p style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '8px', textAlign: 'center' }}>
              「固定安全码」是你预设的连接口令，用于确认对方知道你的口令。
            </p>
            <p style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '4px', textAlign: 'center' }}>
              ⏱️ 提示：若未在 60 秒内核实并处理，请求将自动超时关闭
            </p>
            <div style={{ display: 'flex', gap: '10px', marginTop: '12px', justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => handleRespond('deny')}>
                拒绝
              </button>
              {incomingRequest.permission === 'control' && (
                <button
                  className="btn btn-secondary"
                  onClick={() => handleRespond('view')}
                  disabled={safetyMismatch}
                  title={safetyMismatch ? '固定安全码不符，已禁用授权' : undefined}
                >
                  仅允许查看
                </button>
              )}
              <button
                className="btn btn-primary"
                onClick={() => handleRespond(incomingRequest.permission)}
                disabled={safetyMismatch}
                title={safetyMismatch ? '固定安全码不符，已禁用授权' : undefined}
              >
                允许协助
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 信令服务器配置弹窗 */}
      {showServerModal && (
        <div className="modal-overlay">
          <div className="modal-card">
            <h2 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '10px' }}>
              ⚙️ 信令服务器配置
            </h2>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '14px', lineHeight: '1.6' }}>
              当前连接的公网信令服务地址。支持自定义公网 IP、域名，若服务端开启了密钥认证可拼接 Token 参数：
            </p>
            <input
              type="text"
              className="input-code"
              style={{
                width: '100%',
                boxSizing: 'border-box',
                marginBottom: '16px',
                fontSize: '13px',
                textAlign: 'left',
                letterSpacing: 'normal'
              }}
              value={serverUrlInput}
              onChange={(e) => setServerUrlInput(e.target.value)}
              placeholder="ws://你的公网IP:8080 或 ws://IP:8080?token=你的密钥"
            />
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button
                className="btn btn-secondary"
                onClick={() => setServerUrlInput('ws://117.72.108.46:8080')}
              >
                默认地址
              </button>
              <button className="btn btn-secondary" onClick={() => setShowServerModal(false)}>
                取消
              </button>
              <button
                className="btn btn-primary"
                onClick={async () => {
                  try {
                    if (sdk?.remoteAssist?.setSignalingUrl) {
                      await sdk.remoteAssist.setSignalingUrl(serverUrlInput)
                    }
                    setShowServerModal(false)
                    sdk?.ui?.notify({
                      message: '信令服务器地址已更新，正在连接...',
                      type: 'info'
                    })
                    setTimeout(() => refreshDeviceInfo(), 300)
                  } catch (err: any) {
                    sdk?.ui?.notify({
                      message: `连接失败: ${err?.message || err}`,
                      type: 'error'
                    })
                  }
                }}
              >
                保存并连接
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
