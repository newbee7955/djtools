import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { getSDK } from '@doujiao/plugin-sdk'
import type {
  WorkspaceSnapshotItem,
  WorkspaceGitStatus,
  WorkspaceGitCommitItem
} from '@doujiao/plugin-sdk'
import { computeLineDiff } from '../lib/diff'

interface VersionHistoryDrawerProps {
  isOpen: boolean
  onClose: () => void
  scope: string
  fileName: string
  currentContent: string
  onRestoreContent: (content: string) => void
  onShowToast: (msg: string) => void
}

function formatDate(timestamp: number): string {
  if (!timestamp) return '-'
  const d = new Date(timestamp)
  const now = Date.now()
  const diffMinutes = Math.floor((now - timestamp) / 60000)

  if (diffMinutes < 1) return '刚刚'
  if (diffMinutes < 60) return `${diffMinutes} 分钟前`

  return d.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

export function VersionHistoryDrawer({
  isOpen,
  onClose,
  scope,
  fileName,
  currentContent,
  onRestoreContent,
  onShowToast
}: VersionHistoryDrawerProps): JSX.Element | null {
  if (!isOpen) return null

  const sdk = getSDK()

  // Tabs: 'snapshots' | 'git'
  const [activeTab, setActiveTab] = useState<'snapshots' | 'git'>('snapshots')

  // Snapshots State
  const [snapshots, setSnapshots] = useState<WorkspaceSnapshotItem[]>([])
  const [loadingSnapshots, setLoadingSnapshots] = useState(false)
  const [selectedSnapshotId, setSelectedSnapshotId] = useState<string | null>(null)
  const [snapshotContent, setSnapshotContent] = useState<string>('')
  const [loadingContent, setLoadingContent] = useState(false)

  // Milestone input
  const [showMilestoneInput, setShowMilestoneInput] = useState(false)
  const [milestoneLabel, setMilestoneLabel] = useState('')

  // Git State
  const [gitStatus, setGitStatus] = useState<WorkspaceGitStatus | null>(null)
  const [gitCommits, setGitCommits] = useState<WorkspaceGitCommitItem[]>([])
  const [loadingGit, setLoadingGit] = useState(false)
  const [commitMessage, setCommitMessage] = useState('')
  const [committing, setCommitting] = useState(false)
  const [selectedCommitHash, setSelectedCommitHash] = useState<string | null>(null)
  const [gitContent, setGitContent] = useState<string>('')

  // 加载快照列表
  const loadSnapshots = useCallback(async () => {
    if (!sdk?.workspace?.history || !fileName) return
    setLoadingSnapshots(true)
    try {
      const list = await sdk.workspace.history.listSnapshots(scope, fileName)
      setSnapshots(list)
      if (list.length > 0 && !selectedSnapshotId) {
        setSelectedSnapshotId(list[0].id)
      }
    } catch (err: any) {
      console.error('加载快照失败:', err)
    } finally {
      setLoadingSnapshots(false)
    }
  }, [sdk, scope, fileName, selectedSnapshotId])

  // 加载 Git 状态与日志
  const loadGitInfo = useCallback(async () => {
    if (!sdk?.workspace?.git) return
    setLoadingGit(true)
    try {
      const status = await sdk.workspace.git.getStatus(scope)
      setGitStatus(status)
      if (status.isRepo) {
        let logs = await sdk.workspace.git.getLog(scope, fileName, 30)
        if (logs.length === 0) {
          logs = await sdk.workspace.git.getLog(scope, undefined, 30)
        }
        setGitCommits(logs)
        if (logs.length > 0 && !selectedCommitHash) {
          setSelectedCommitHash(logs[0].hash)
        }
      }
    } catch (err: any) {
      console.error('加载 Git 失败:', err)
    } finally {
      setLoadingGit(false)
    }
  }, [sdk, scope, fileName, selectedCommitHash])

  useEffect(() => {
    if (isOpen) {
      loadSnapshots()
      loadGitInfo()
    }
  }, [isOpen, loadSnapshots, loadGitInfo])

  // 当选中的快照发生变化时，读取该快照的内容
  useEffect(() => {
    let active = true
    if (!selectedSnapshotId || activeTab !== 'snapshots' || !sdk?.workspace?.history) return

    setLoadingContent(true)
    sdk.workspace.history
      .getSnapshot(scope, fileName, selectedSnapshotId)
      .then((content) => {
        if (active) {
          setSnapshotContent(content)
          setLoadingContent(false)
        }
      })
      .catch((err) => {
        if (active) {
          console.error('读取快照内容失败:', err)
          setLoadingContent(false)
        }
      })

    return () => {
      active = false
    }
  }, [selectedSnapshotId, activeTab, sdk, scope, fileName])

  // 当选中的 Git Commit 发生变化时，读取该提交中的文件内容
  useEffect(() => {
    let active = true
    if (!selectedCommitHash || activeTab !== 'git' || !sdk?.workspace?.git) return

    setLoadingContent(true)
    sdk.workspace.git
      .showFile(scope, selectedCommitHash, fileName)
      .then((content) => {
        if (active) {
          setGitContent(content)
          setLoadingContent(false)
        }
      })
      .catch((err) => {
        if (active) {
          console.error('读取 Git 提交文件失败:', err)
          setLoadingContent(false)
        }
      })

    return () => {
      active = false
    }
  }, [selectedCommitHash, activeTab, sdk, scope, fileName])

  // 创建里程碑
  const handleCreateMilestone = async () => {
    const label = milestoneLabel.trim()
    if (!label) return
    if (!sdk?.workspace?.history) return

    try {
      await sdk.workspace.history.saveSnapshot(scope, fileName, currentContent, 'milestone', label)
      setMilestoneLabel('')
      setShowMilestoneInput(false)
      onShowToast(`已标记里程碑: 「${label}」`)
      loadSnapshots()
    } catch (err: any) {
      alert(`标记失败: ${err.message}`)
    }
  }

  // 初始化 Git 仓库
  const handleGitInit = async () => {
    if (!sdk?.workspace?.git) return
    try {
      const res = await sdk.workspace.git.init(scope)
      if (res.success) {
        onShowToast('Git 仓库初始化成功！')
        loadGitInfo()
      } else {
        alert(res.message || 'Git 初始化失败')
      }
    } catch (err: any) {
      alert(`Git 初始化失败: ${err.message}`)
    }
  }

  // 提交 Git 版本
  const handleGitCommit = async () => {
    const msg = commitMessage.trim()
    if (!msg) {
      alert('请输入提交说明 (Commit message)')
      return
    }
    if (!sdk?.workspace?.git) return

    setCommitting(true)
    try {
      const res = await sdk.workspace.git.commit(scope, msg, [fileName])
      if (res.success) {
        setCommitMessage('')
        onShowToast(`Git 提交成功: ${res.commitHash?.slice(0, 7)}`)
        loadGitInfo()
      } else {
        alert(res.error || 'Git 提交失败')
      }
    } catch (err: any) {
      alert(`Git 提交异常: ${err.message}`)
    } finally {
      setCommitting(false)
    }
  }

  // 删除快照
  const handleDeleteSnapshot = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!confirm('确定删除该历史快照吗？')) return
    if (!sdk?.workspace?.history) return

    try {
      await sdk.workspace.history.deleteSnapshot(scope, fileName, id)
      onShowToast('快照已删除')
      if (selectedSnapshotId === id) setSelectedSnapshotId(null)
      loadSnapshots()
    } catch (err: any) {
      alert(`删除失败: ${err.message}`)
    }
  }

  // 计算当前与选中版本的差异比对
  const compareText = activeTab === 'snapshots' ? snapshotContent : gitContent

  const diffResult = useMemo(() => {
    if (!compareText) return { lines: [], additions: 0, deletions: 0 }
    return computeLineDiff(compareText, currentContent)
  }, [compareText, currentContent])

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-full max-w-4xl bg-slate-900 border-l border-slate-800 shadow-2xl flex flex-col animate-slide-left select-none">
      {/* 顶部标题栏 */}
      <div className="h-14 border-b border-slate-800 flex items-center justify-between px-6 bg-slate-900/95 flex-shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-xl">🕒</span>
          <div>
            <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
              <span>便签版本控制</span>
              <span className="text-xs font-mono font-normal px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                {fileName}
              </span>
            </h2>
          </div>
        </div>

        {/* 双轨切换 Tabs */}
        <div className="flex items-center bg-slate-950 border border-slate-800 rounded-xl p-1">
          <button
            onClick={() => setActiveTab('snapshots')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition ${
              activeTab === 'snapshots'
                ? 'bg-amber-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <span>🕒 时间轴快照</span>
            <span className="text-[10px] bg-slate-900/60 px-1.5 py-0.2 rounded-full">
              {snapshots.length}
            </span>
          </button>
          <button
            onClick={() => setActiveTab('git')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition ${
              activeTab === 'git'
                ? 'bg-amber-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <span>🌿 Git 版本库</span>
            {gitStatus?.isRepo && (
              <span className="text-[10px] bg-slate-900/60 px-1.5 py-0.2 rounded-full">
                {gitCommits.length}
              </span>
            )}
          </button>
        </div>

        <button
          onClick={onClose}
          className="text-slate-400 hover:text-slate-200 p-1.5 rounded-lg hover:bg-slate-800 transition"
        >
          ✕
        </button>
      </div>

      {/* 主体两栏布局：左侧版本列表，右侧 Diff 对比预览 */}
      <div className="flex-1 flex overflow-hidden">
        {/* 左侧版本时间轴 / Git Commit 列表 */}
        <div className="w-80 border-r border-slate-800 flex flex-col bg-slate-950/50">
          {activeTab === 'snapshots' ? (
            /* 快照选项卡顶部操作 */
            <div className="p-3 border-b border-slate-800/80 space-y-2">
              {!showMilestoneInput ? (
                <button
                  onClick={() => setShowMilestoneInput(true)}
                  className="w-full flex items-center justify-center gap-1.5 py-2 px-3 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-medium transition"
                >
                  <span>📌</span>
                  <span>标记当前为里程碑便签</span>
                </button>
              ) : (
                <div className="space-y-2 p-2 bg-slate-900 border border-slate-700 rounded-xl">
                  <div className="text-[11px] text-slate-400 font-medium">输入里程碑名称:</div>
                  <input
                    type="text"
                    autoFocus
                    value={milestoneLabel}
                    onChange={(e) => setMilestoneLabel(e.target.value)}
                    placeholder="如: 会议纪要初稿 / 备忘终稿"
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-amber-500"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleCreateMilestone()
                      if (e.key === 'Escape') setShowMilestoneInput(false)
                    }}
                  />
                  <div className="flex items-center justify-end gap-2">
                    <button
                      onClick={() => setShowMilestoneInput(false)}
                      className="px-2.5 py-1 text-[11px] text-slate-400 hover:text-slate-200"
                    >
                      取消
                    </button>
                    <button
                      onClick={handleCreateMilestone}
                      disabled={!milestoneLabel.trim()}
                      className="px-3 py-1 text-[11px] bg-amber-600 hover:bg-amber-500 text-white rounded-lg font-medium transition disabled:opacity-40"
                    >
                      保存里程碑
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* Git 选项卡顶部状态与提交栏 */
            <div className="p-3 border-b border-slate-800/80 space-y-3">
              {!gitStatus?.installed ? (
                <div className="p-2.5 bg-rose-950/40 border border-rose-500/40 rounded-xl text-rose-300 text-xs">
                  ⚠️ 本机未检测到 Git 命令行工具，可继续使用左侧「时间轴快照」完整版本控制。
                </div>
              ) : !gitStatus.isRepo ? (
                <div className="space-y-2">
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    当前便签目录尚未初始化为 Git 仓库。
                  </p>
                  <button
                    onClick={handleGitInit}
                    className="w-full py-2 px-3 bg-amber-600 hover:bg-amber-500 text-white rounded-xl text-xs font-medium transition shadow-sm"
                  >
                    🌿 一键初始化 Git 本地仓库
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-slate-400">分支: <span className="font-mono text-amber-400">{gitStatus.branch || 'main'}</span></span>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                      gitStatus.clean ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-400'
                    }`}>
                      {gitStatus.clean ? '工作区干净' : '有未提交修改'}
                    </span>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <input
                      type="text"
                      value={commitMessage}
                      onChange={(e) => setCommitMessage(e.target.value)}
                      placeholder="输入 Git 提交说明..."
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-amber-500 font-mono"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleGitCommit()
                      }}
                    />
                    <button
                      onClick={handleGitCommit}
                      disabled={committing || !commitMessage.trim()}
                      className="w-full py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded-xl text-xs font-medium transition disabled:opacity-40"
                    >
                      {committing ? '提交中...' : '提交此便签 (Commit)'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 列表流 */}
          <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
            {activeTab === 'snapshots' ? (
              loadingSnapshots ? (
                <div className="text-center text-slate-500 text-xs py-8">正在读取历史版本...</div>
              ) : snapshots.length === 0 ? (
                <div className="text-center text-slate-500 text-xs py-8 space-y-1">
                  <div>暂无历史快照</div>
                  <div className="text-[11px] text-slate-600">每次保存或修改都会自动生成快照</div>
                </div>
              ) : (
                snapshots.map((item) => {
                  const isSelected = item.id === selectedSnapshotId
                  const isMilestone = item.type === 'milestone'

                  return (
                    <div
                      key={item.id}
                      onClick={() => setSelectedSnapshotId(item.id)}
                      className={`group p-2.5 rounded-xl border text-xs cursor-pointer transition ${
                        isSelected
                          ? 'bg-amber-950/50 border-amber-500/60 text-amber-200 shadow-sm'
                          : 'bg-slate-900/60 border-slate-800/80 text-slate-300 hover:bg-slate-850 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-1.5 font-medium truncate">
                          <span>{isMilestone ? '📌' : '○'}</span>
                          <span className="truncate">{item.label || (isMilestone ? '里程碑' : '自动快照')}</span>
                        </div>
                        <span className="text-[10px] text-slate-500 font-mono">
                          {formatDate(item.timestamp)}
                        </span>
                      </div>

                      <div className="flex items-center justify-between text-[11px] text-slate-500">
                        <span>{item.summary || `${item.charCount} 字`}</span>
                        <button
                          onClick={(e) => handleDeleteSnapshot(item.id, e)}
                          title="删除快照"
                          className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-rose-400 transition px-1"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  )
                })
              )
            ) : (
              loadingGit ? (
                <div className="text-center text-slate-500 text-xs py-8">正在读取 Git 日志...</div>
              ) : gitCommits.length === 0 ? (
                <div className="text-center text-slate-500 text-xs py-8 space-y-1">
                  <div>暂无提交记录</div>
                  <div className="text-[11px] text-slate-600">在上方输入说明提交第一条版本</div>
                </div>
              ) : (
                gitCommits.map((c) => {
                  const isSelected = c.hash === selectedCommitHash

                  return (
                    <div
                      key={c.hash}
                      onClick={() => setSelectedCommitHash(c.hash)}
                      className={`p-2.5 rounded-xl border text-xs cursor-pointer transition ${
                        isSelected
                          ? 'bg-amber-950/50 border-amber-500/60 text-amber-200 shadow-sm'
                          : 'bg-slate-900/60 border-slate-800/80 text-slate-300 hover:bg-slate-850 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-mono text-[11px] text-amber-400 font-medium">
                          {c.shortHash}
                        </span>
                        <span className="text-[10px] text-slate-500 font-mono">
                          {formatDate(c.timestamp)}
                        </span>
                      </div>
                      <div className="font-medium text-slate-200 line-clamp-2 mb-1">
                        {c.message}
                      </div>
                      <div className="text-[10px] text-slate-500">
                        {c.author}
                      </div>
                    </div>
                  )
                })
              )
            )}
          </div>
        </div>

        {/* 右侧 Diff 差异对比区 */}
        <div className="flex-1 flex flex-col bg-slate-950 overflow-hidden">
          {/* Diff 顶部状态栏 */}
          <div className="h-11 border-b border-slate-800 px-4 flex items-center justify-between bg-slate-900/70 text-xs flex-shrink-0">
            <div className="flex items-center gap-3">
              <span className="text-slate-400">差异比对:</span>
              <span className="font-medium text-slate-200">
                {activeTab === 'snapshots'
                  ? snapshots.find((s) => s.id === selectedSnapshotId)?.label || '历史快照'
                  : `Commit ${selectedCommitHash?.slice(0, 7)}`}
              </span>
              <span className="text-slate-600">vs</span>
              <span className="text-amber-400 font-medium">当前编辑便签</span>

              <div className="flex items-center gap-2 ml-2 text-[11px] font-mono">
                <span className="text-emerald-400 bg-emerald-950/60 border border-emerald-500/30 px-1.5 py-0.5 rounded">
                  +{diffResult.additions} 行
                </span>
                <span className="text-rose-400 bg-rose-950/60 border border-rose-500/30 px-1.5 py-0.5 rounded">
                  -{diffResult.deletions} 行
                </span>
              </div>
            </div>

            {/* 核心操作：一键恢复 */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  navigator.clipboard.writeText(compareText)
                  onShowToast('已复制历史版本内容到剪贴板')
                }}
                className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs transition"
              >
                📋 复制该版本
              </button>
              <button
                onClick={() => {
                  if (confirm('确定要将当前便签的内容恢复为该历史版本吗？')) {
                    onRestoreContent(compareText)
                    onClose()
                  }
                }}
                className="px-3.5 py-1 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-xs font-medium transition shadow-sm flex items-center gap-1"
              >
                <span>↩️</span>
                <span>恢复此版本</span>
              </button>
            </div>
          </div>

          {/* Diff 逐行渲染区 */}
          <div className="flex-1 overflow-auto font-mono text-xs p-4 select-text">
            {loadingContent ? (
              <div className="h-full flex items-center justify-center text-slate-500">
                正在加载历史内容并计算差异...
              </div>
            ) : !compareText ? (
              <div className="h-full flex items-center justify-center text-slate-500">
                请在左侧选择一个版本进行查看与对比
              </div>
            ) : diffResult.lines.length === 0 ? (
              <div className="h-full flex items-center justify-center text-slate-500">
                内容完全一致，无增减变动
              </div>
            ) : (
              <div className="space-y-0.5">
                {diffResult.lines.map((line, idx) => {
                  const isAdded = line.type === 'added'
                  const isRemoved = line.type === 'removed'

                  return (
                    <div
                      key={idx}
                      className={`flex items-start px-2 py-0.5 rounded ${
                        isAdded
                          ? 'bg-emerald-950/50 text-emerald-300 border-l-2 border-emerald-500'
                          : isRemoved
                          ? 'bg-rose-950/40 text-rose-300 line-through opacity-75 border-l-2 border-rose-500'
                          : 'text-slate-300 hover:bg-slate-900/50'
                      }`}
                    >
                      {/* 行号 */}
                      <span className="w-10 text-slate-600 select-none text-right pr-3 flex-shrink-0 text-[11px]">
                        {line.oldNum || line.newNum || ''}
                      </span>
                      {/* 增删符号 */}
                      <span className="w-4 select-none flex-shrink-0 font-bold">
                        {isAdded ? '+' : isRemoved ? '-' : ' '}
                      </span>
                      {/* 行内容 */}
                      <span className="flex-1 whitespace-pre-wrap break-all leading-relaxed">
                        {line.text || ' '}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
