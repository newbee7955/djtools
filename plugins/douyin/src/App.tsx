import React, { useState, useEffect, useCallback } from 'react'
import { getSDK, DownloadProgressInfo } from '@doujiao/plugin-sdk'
import type {
  DouyinVideoItem,
  DouyinParseResult,
  DouyinUserItem
} from './types'
import {
  parseDouyin,
  searchUsers,
  fetchUserVideos
} from './lib/api'

export default function App(): JSX.Element {
  const [activeTab, setActiveTab] = useState<'parse' | 'search'>('parse')

  // 鉴权状态
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [loggingIn, setLoggingIn] = useState(false)

  // 链接解析状态
  const [urlInput, setUrlInput] = useState('')
  const [parsing, setParsing] = useState(false)
  const [parseError, setParseError] = useState('')
  const [parseResult, setParseResult] = useState<DouyinParseResult | null>(null)

  // 创作者搜索状态
  const [searchKeyword, setSearchKeyword] = useState('')
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [userList, setUserList] = useState<DouyinUserItem[]>([])
  const [selectedUser, setSelectedUser] = useState<DouyinUserItem | null>(null)
  const [userVideos, setUserVideos] = useState<DouyinVideoItem[]>([])
  const [loadingVideos, setLoadingVideos] = useState(false)
  const [videoCursor, setVideoCursor] = useState(0)
  const [hasMoreVideos, setHasMoreVideos] = useState(false)

  // 本插件触发的实时任务监控
  const [tasksProgress, setTasksProgress] = useState<Record<string, DownloadProgressInfo>>({})
  const [actionNotice, setActionNotice] = useState<string | null>(null)

  const showNotice = (msg: string) => {
    setActionNotice(msg)
    setTimeout(() => setActionNotice(null), 3500)
  }

  // 检查登录状态
  const checkLogin = useCallback(async () => {
    try {
      const sdk = getSDK()
      if (sdk?.auth?.getStatus) {
        const res = await sdk.auth.getStatus('douyin.com')
        setIsLoggedIn(res.loggedIn)
      }
    } catch {
      setIsLoggedIn(false)
    }
  }, [])

  useEffect(() => {
    checkLogin()
  }, [checkLogin])

  // 监听宿主下载进度
  useEffect(() => {
    try {
      const sdk = getSDK()
      const unsubscribe = sdk.download.onProgress((info) => {
        setTasksProgress((prev) => ({
          ...prev,
          [info.taskId]: info
        }))
      })
      return () => unsubscribe()
    } catch (err) {
      console.warn('[Plugin] 无法注册下载进度监听器:', err)
      return () => {}
    }
  }, [])

  // 弹出扫码登录
  const handleLogin = async () => {
    setLoggingIn(true)
    try {
      const sdk = getSDK()
      const res = await sdk.auth.requestLogin('douyin.com')
      if (res.success) {
        setIsLoggedIn(true)
        showNotice('抖音账号登录成功！')
      } else {
        showNotice(res.message || '登录未完成')
      }
    } catch (err: any) {
      showNotice(`登录失败: ${err?.message}`)
    } finally {
      setLoggingIn(false)
      checkLogin()
    }
  }

  // ---- 1. 链接解析 ----
  const handleParse = async () => {
    const text = urlInput.trim()
    if (!text) {
      setParseError('请输入有效的抖音作品、合集或专题分享链接')
      return
    }

    setParsing(true)
    setParseError('')
    setParseResult(null)

    try {
      const sdk = getSDK()
      const result = await parseDouyin(text, sdk)
      setParseResult(result)
      showNotice(`解析成功：共发现 ${result.items.length} 个作品`)
    } catch (err: any) {
      setParseError(err?.message || '解析失败，请检查链接是否正确')
    } finally {
      setParsing(false)
    }
  }

  // 单选/反选解析列表中的视频
  const toggleParseItem = (index: number) => {
    if (!parseResult) return
    const updated = [...parseResult.items]
    updated[index].selected = !updated[index].selected
    setParseResult({ ...parseResult, items: updated })
  }

  const toggleAllParseItems = (selectAll: boolean) => {
    if (!parseResult) return
    const updated = parseResult.items.map((it) => ({ ...it, selected: selectAll }))
    setParseResult({ ...parseResult, items: updated })
  }

  // 单个视频分辨率切换
  const handleParseItemQualityChange = (index: number, url: string, e: React.ChangeEvent<HTMLSelectElement>) => {
    e.stopPropagation()
    if (!parseResult) return
    const updated = [...parseResult.items]
    updated[index] = { ...updated[index], selectedQualityUrl: url }
    setParseResult({ ...parseResult, items: updated })
  }

  const handleUserVideoQualityChange = (index: number, url: string, e: React.ChangeEvent<HTMLSelectElement>) => {
    e.stopPropagation()
    const updated = [...userVideos]
    updated[index] = { ...updated[index], selectedQualityUrl: url }
    setUserVideos(updated)
  }

  // 提交选中的视频下载
  const handleDownloadSelected = async (items: DouyinVideoItem[]) => {
    const selected = items.filter((it) => it.selected)
    if (selected.length === 0) {
      showNotice('请至少勾选一个要下载的作品')
      return
    }

    try {
      const sdk = getSDK()
      let count = 0
      for (const item of selected) {
        const downloadUrl = item.selectedQualityUrl || item.videoUrl
        const currentQuality = item.qualities?.find((q) => q.url === downloadUrl)
        const qualityTag = currentQuality ? ` [${currentQuality.label.split(' ')[0]}]` : ''
        const cleanTitle = ((item.title || `douyin_${item.awemeId}`) + qualityTag).replace(/[\\/:*?"<>|]/g, '_')
        await sdk.download.enqueue({
          url: downloadUrl,
          filename: `${cleanTitle}.mp4`,
          extra: {
            title: cleanTitle,
            authorName: item.authorName,
            coverUrl: item.cover,
            duration: item.duration,
            platform: 'douyin',
            quality: currentQuality?.label
          }
        })
        count++
      }

      showNotice(`已成功将 ${count} 个视频提交到下载中心！`)
    } catch (err: any) {
      showNotice(`提交下载出错: ${err?.message}`)
    }
  }

  // ---- 2. 创作者搜索与作品抓取 ----
  const handleSearchUsers = async () => {
    const kw = searchKeyword.trim()
    if (!kw) {
      setSearchError('请输入创作者昵称或抖音号')
      return
    }

    setSearching(true)
    setSearchError('')
    setUserList([])
    setSelectedUser(null)
    setUserVideos([])

    try {
      const sdk = getSDK()
      const users = await searchUsers(kw, sdk)
      setUserList(users)
      if (users.length === 0) {
        setSearchError('未找到相关创作者')
      }
    } catch (err: any) {
      setSearchError(err?.message || '搜索创作者失败')
    } finally {
      setSearching(false)
    }
  }

  const handleSelectUser = async (user: DouyinUserItem) => {
    setSelectedUser(user)
    setUserVideos([])
    setLoadingVideos(true)
    setVideoCursor(0)

    try {
      const sdk = getSDK()
      const res = await fetchUserVideos(user.secUid, 0, sdk)
      setUserVideos(res.videos)
      setHasMoreVideos(res.hasMore)
      setVideoCursor(res.maxCursor)
      showNotice(`已加载 ${user.nickname} 的作品 (${res.videos.length} 项)`)
    } catch (err: any) {
      showNotice(`加载作品列表失败: ${err?.message}`)
    } finally {
      setLoadingVideos(false)
    }
  }

  const handleLoadMoreVideos = async () => {
    if (!selectedUser || loadingVideos || !hasMoreVideos) return
    setLoadingVideos(true)

    try {
      const sdk = getSDK()
      const res = await fetchUserVideos(selectedUser.secUid, videoCursor, sdk)
      setUserVideos((prev) => [...prev, ...res.videos])
      setHasMoreVideos(res.hasMore)
      setVideoCursor(res.maxCursor)
    } catch (err: any) {
      showNotice(`加载更多失败: ${err?.message}`)
    } finally {
      setLoadingVideos(false)
    }
  }

  const toggleUserVideo = (index: number) => {
    const updated = [...userVideos]
    updated[index].selected = !updated[index].selected
    setUserVideos(updated)
  }

  const toggleAllUserVideos = (selectAll: boolean) => {
    setUserVideos((prev) => prev.map((v) => ({ ...v, selected: selectAll })))
  }

  const formatFansCount = (num: number) => {
    if (num >= 10000) {
      return `${(num / 10000).toFixed(1)} 万`
    }
    return `${num}`
  }

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 p-8 select-none">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* 顶部头部与认证条 */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-5">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-rose-500 via-pink-500 to-amber-500 flex items-center justify-center text-2xl shadow-lg shadow-rose-500/10">
              🎵
            </div>
            <div>
              <h2 className="text-xl font-bold text-white tracking-wide">
                抖音视频 / 合集 / 创作者批量下载
              </h2>
              <div className="flex items-center gap-2 text-xs text-slate-400 mt-1">
                <span>官方插件</span>
                <span>•</span>
                <span className="text-emerald-400 font-mono">v1.2.0</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* 登录状态胶囊 */}
            <div className="flex items-center gap-2 bg-slate-950 px-3 py-1.5 rounded-xl border border-slate-800 text-xs">
              <span
                className={`w-2 h-2 rounded-full ${
                  isLoggedIn ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'
                }`}
              />
              <span className="text-slate-300">
                {isLoggedIn ? '账号已授权' : '未授权 (可能受限)'}
              </span>
              {!isLoggedIn && (
                <button
                  onClick={handleLogin}
                  disabled={loggingIn}
                  className="ml-1 text-xs text-indigo-400 hover:text-indigo-300 underline"
                >
                  {loggingIn ? '登录中...' : '扫码登录'}
                </button>
              )}
            </div>

            <button
              onClick={() => getSDK()?.download.openSaveDirectory()}
              className="px-3.5 py-1.5 text-xs rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700/60 transition-colors"
            >
              打开下载目录
            </button>
          </div>
        </div>

        {/* 顶部操作提示 Toast */}
        {actionNotice && (
          <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs flex items-center justify-between animate-in fade-in slide-in-from-top-2">
            <span>✓ {actionNotice}</span>
            <button onClick={() => setActionNotice(null)} className="text-slate-400 hover:text-white">✕</button>
          </div>
        )}

        {/* 导航选项卡 */}
        <div className="flex gap-2 border-b border-slate-800 pb-3">
          <button
            onClick={() => setActiveTab('parse')}
            className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all ${
              activeTab === 'parse'
                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 shadow-sm'
                : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
            }`}
          >
            🔗 链接解析 (单作品 / 合集 / 专题)
          </button>
          <button
            onClick={() => setActiveTab('search')}
            className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all ${
              activeTab === 'search'
                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 shadow-sm'
                : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
            }`}
          >
            👤 创作者搜索与主页作品抓取
          </button>
        </div>

        {/* ===================== TAB 1: 链接解析 ===================== */}
        {activeTab === 'parse' && (
          <div className="space-y-6">
            <div className="p-5 rounded-2xl bg-slate-950/80 border border-slate-800 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-2">
                  支持短链接 (v.douyin.com)、单个视频、图文、合集 (collection/mix) 或专题长链接：
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={urlInput}
                    onChange={(e) => setUrlInput(e.target.value)}
                    placeholder="粘贴分享文案或链接，如 https://v.douyin.com/xxx/ 或 https://www.douyin.com/video/..."
                    className="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-emerald-500 transition-colors"
                    onKeyDown={(e) => e.key === 'Enter' && handleParse()}
                  />
                  <button
                    onClick={handleParse}
                    disabled={parsing}
                    className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 font-semibold text-sm transition-all disabled:opacity-50 shadow-lg shadow-emerald-500/20"
                  >
                    {parsing ? '智能解析中...' : '一键解析'}
                  </button>
                </div>
              </div>

              {parseError && (
                <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs">
                  ⚠️ {parseError}
                </div>
              )}
            </div>

            {/* 解析结果展示 */}
            {parseResult && (
              <div className="p-5 rounded-2xl bg-slate-950/80 border border-emerald-500/30 space-y-5">
                <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-semibold uppercase tracking-wider text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                      {parseResult.type === 'single' ? '单作品' : parseResult.type === 'mix' ? '合集' : '专题'}
                    </span>
                    <h3 className="font-semibold text-white text-sm line-clamp-1">
                      {parseResult.title}
                    </h3>
                  </div>

                  <div className="flex items-center gap-2">
                    {parseResult.items.length > 1 && (
                      <>
                        <button
                          onClick={() => toggleAllParseItems(true)}
                          className="px-2.5 py-1 text-xs rounded bg-slate-800 hover:bg-slate-700 text-slate-300"
                        >
                          全选
                        </button>
                        <button
                          onClick={() => toggleAllParseItems(false)}
                          className="px-2.5 py-1 text-xs rounded bg-slate-800 hover:bg-slate-700 text-slate-300"
                        >
                          取消全选
                        </button>
                      </>
                    )}
                    <button
                      onClick={() => handleDownloadSelected(parseResult.items)}
                      className="px-4 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs shadow-md shadow-indigo-600/20 transition-colors"
                    >
                      📥 批量推入下载 ({parseResult.items.filter((i) => i.selected).length})
                    </button>
                  </div>
                </div>

                {/* 作品列表项 */}
                <div className="space-y-2.5 max-h-[420px] overflow-y-auto pr-1">
                  {parseResult.items.map((item, index) => (
                    <div
                      key={item.awemeId || index}
                      onClick={() => toggleParseItem(index)}
                      className={`p-3 rounded-xl border flex items-center gap-3 cursor-pointer transition-colors ${
                        item.selected
                          ? 'bg-slate-900/90 border-emerald-500/40'
                          : 'bg-slate-950/60 border-slate-800/80 hover:border-slate-700'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={!!item.selected}
                        onChange={() => {}}
                        className="rounded border-slate-700 text-emerald-500 focus:ring-0"
                      />
                      {item.cover ? (
                        <img
                          src={item.cover}
                          alt="封面"
                          className="w-14 h-14 object-cover rounded-lg bg-slate-800 flex-shrink-0"
                        />
                      ) : (
                        <div className="w-14 h-14 rounded-lg bg-slate-800 flex items-center justify-center text-xl flex-shrink-0">
                          🎬
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-xs text-white line-clamp-1">{item.title}</div>
                        <div className="text-[11px] text-slate-400 mt-1.5 flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <span>作者: {item.authorName}</span>
                            {item.duration > 0 && <span>时长: {item.duration} 秒</span>}
                            <span className="text-emerald-400 font-mono">无水印源</span>
                          </div>
                          {item.qualities && item.qualities.length > 1 && (
                            <div className="flex items-center gap-1.5 ml-2" onClick={(e) => e.stopPropagation()}>
                              <span className="text-slate-400 text-[11px]">分辨率:</span>
                              <select
                                value={item.selectedQualityUrl || item.videoUrl}
                                onChange={(e) => handleParseItemQualityChange(index, e.target.value, e)}
                                className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-0.5 text-[11px] text-emerald-400 focus:outline-none focus:border-emerald-500 cursor-pointer"
                              >
                                {item.qualities.map((q, qIdx) => (
                                  <option key={qIdx} value={q.url}>
                                    {q.label}
                                  </option>
                                ))}
                              </select>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ===================== TAB 2: 创作者搜索 ===================== */}
        {activeTab === 'search' && (
          <div className="space-y-6">
            <div className="p-5 rounded-2xl bg-slate-950/80 border border-slate-800 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-2">
                  输入抖音创作者昵称或唯一号搜索：
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={searchKeyword}
                    onChange={(e) => setSearchKeyword(e.target.value)}
                    placeholder="输入用户名/昵称，如「影视剪辑」、「央视新闻」..."
                    className="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-emerald-500 transition-colors"
                    onKeyDown={(e) => e.key === 'Enter' && handleSearchUsers()}
                  />
                  <button
                    onClick={handleSearchUsers}
                    disabled={searching}
                    className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 font-semibold text-sm transition-all disabled:opacity-50 shadow-lg shadow-emerald-500/20"
                  >
                    {searching ? '搜索中...' : '搜索创作者'}
                  </button>
                </div>
              </div>

              {searchError && (
                <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs">
                  ⚠️ {searchError}
                </div>
              )}
            </div>

            {/* 搜索创作者结果列表 */}
            {userList.length > 0 && !selectedUser && (
              <div className="space-y-3">
                <div className="text-xs font-semibold text-slate-400">搜索到的创作者列表：</div>
                <div className="grid grid-cols-2 gap-3">
                  {userList.map((user) => (
                    <div
                      key={user.secUid || user.uid}
                      onClick={() => handleSelectUser(user)}
                      className="p-4 rounded-xl bg-slate-950/80 border border-slate-800 hover:border-emerald-500/40 cursor-pointer transition-all flex items-center justify-between group"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        {user.avatar ? (
                          <img
                            src={user.avatar}
                            alt="avatar"
                            className="w-12 h-12 rounded-full object-cover bg-slate-800"
                          />
                        ) : (
                          <div className="w-12 h-12 rounded-full bg-slate-800 flex items-center justify-center text-lg">
                            👤
                          </div>
                        )}
                        <div className="min-w-0">
                          <div className="font-semibold text-xs text-white truncate group-hover:text-emerald-400">
                            {user.nickname}
                          </div>
                          <div className="text-[11px] text-slate-400 mt-1 flex items-center gap-2">
                            <span>粉丝: {formatFansCount(user.followerCount)}</span>
                            <span>作品: {user.awemeCount}</span>
                          </div>
                        </div>
                      </div>
                      <span className="text-xs text-emerald-400 font-medium opacity-0 group-hover:opacity-100 transition-opacity">
                        抓取作品 →
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 选中的创作者主页作品抓取区 */}
            {selectedUser && (
              <div className="p-5 rounded-2xl bg-slate-950/80 border border-emerald-500/30 space-y-5">
                <div className="flex items-center justify-between pb-4 border-b border-slate-800">
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => setSelectedUser(null)}
                      className="text-xs text-slate-400 hover:text-white px-2 py-1 rounded bg-slate-800"
                    >
                      ← 返回列表
                    </button>
                    {selectedUser.avatar && (
                      <img
                        src={selectedUser.avatar}
                        alt="avatar"
                        className="w-9 h-9 rounded-full object-cover"
                      />
                    )}
                    <div>
                      <div className="font-semibold text-sm text-white">{selectedUser.nickname}</div>
                      <div className="text-[11px] text-slate-400">
                        获赞 {formatFansCount(selectedUser.totalFavorited)} • 作品 {selectedUser.awemeCount}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => toggleAllUserVideos(true)}
                      className="px-2.5 py-1 text-xs rounded bg-slate-800 hover:bg-slate-700 text-slate-300"
                    >
                      全选
                    </button>
                    <button
                      onClick={() => toggleAllUserVideos(false)}
                      className="px-2.5 py-1 text-xs rounded bg-slate-800 hover:bg-slate-700 text-slate-300"
                    >
                      取消
                    </button>
                    <button
                      onClick={() => handleDownloadSelected(userVideos)}
                      className="px-4 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs shadow-md shadow-indigo-600/20 transition-colors"
                    >
                      📥 批量推入下载 ({userVideos.filter((v) => v.selected).length})
                    </button>
                  </div>
                </div>

                {/* 作品列表 */}
                <div className="space-y-2.5 max-h-[380px] overflow-y-auto pr-1">
                  {userVideos.map((video, idx) => (
                    <div
                      key={video.awemeId || idx}
                      onClick={() => toggleUserVideo(idx)}
                      className={`p-3 rounded-xl border flex items-center gap-3 cursor-pointer transition-colors ${
                        video.selected
                          ? 'bg-slate-900/90 border-emerald-500/40'
                          : 'bg-slate-950/60 border-slate-800/80 hover:border-slate-700'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={!!video.selected}
                        onChange={() => {}}
                        className="rounded border-slate-700 text-emerald-500 focus:ring-0"
                      />
                      {video.cover ? (
                        <img
                          src={video.cover}
                          alt="cover"
                          className="w-14 h-14 object-cover rounded-lg bg-slate-800 flex-shrink-0"
                        />
                      ) : (
                        <div className="w-14 h-14 rounded-lg bg-slate-800 flex items-center justify-center text-xl flex-shrink-0">
                          🎬
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-xs text-white line-clamp-1">{video.title}</div>
                        <div className="text-[11px] text-slate-400 mt-1.5 flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            {video.duration > 0 && <span>时长: {video.duration} 秒</span>}
                            <span className="text-emerald-400 font-mono">无水印源</span>
                          </div>
                          {video.qualities && video.qualities.length > 1 && (
                            <div className="flex items-center gap-1.5 ml-2" onClick={(e) => e.stopPropagation()}>
                              <span className="text-slate-400 text-[11px]">分辨率:</span>
                              <select
                                value={video.selectedQualityUrl || video.videoUrl}
                                onChange={(e) => handleUserVideoQualityChange(idx, e.target.value, e)}
                                className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-0.5 text-[11px] text-emerald-400 focus:outline-none focus:border-emerald-500 cursor-pointer"
                              >
                                {video.qualities.map((q, qIdx) => (
                                  <option key={qIdx} value={q.url}>
                                    {q.label}
                                  </option>
                                ))}
                              </select>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}

                  {hasMoreVideos && (
                    <div className="pt-2 text-center">
                      <button
                        onClick={handleLoadMoreVideos}
                        disabled={loadingVideos}
                        className="px-4 py-2 text-xs rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium transition-colors"
                      >
                        {loadingVideos ? '正在加载更多作品...' : '加载更多作品 ↓'}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ===================== 本插件发起的任务监控 ===================== */}
        {Object.keys(tasksProgress).length > 0 && (
          <div className="space-y-3 pt-4 border-t border-slate-800">
            <div className="text-xs font-semibold text-slate-400 flex items-center justify-between">
              <span>活动下载进度：</span>
              <button
                onClick={() => setTasksProgress({})}
                className="text-[11px] text-slate-500 hover:text-slate-300"
              >
                清空监控列表
              </button>
            </div>
            <div className="grid grid-cols-1 gap-2 max-h-48 overflow-y-auto">
              {Object.values(tasksProgress).map((task) => (
                <div
                  key={task.taskId}
                  className="p-3 rounded-xl bg-slate-950/70 border border-slate-800 flex items-center justify-between text-xs"
                >
                  <div className="truncate max-w-sm text-slate-200 font-medium">
                    {task.filename}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-slate-400 font-mono text-[11px]">{task.speed}</span>
                    <span className="font-mono text-emerald-400 font-semibold">{task.progress}%</span>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] ${
                        task.status === 'completed'
                          ? 'bg-emerald-500/20 text-emerald-400'
                          : task.status === 'failed'
                          ? 'bg-rose-500/20 text-rose-400'
                          : 'bg-indigo-500/20 text-indigo-400'
                      }`}
                    >
                      {task.status === 'completed'
                        ? '已完成'
                        : task.status === 'failed'
                        ? '失败'
                        : '下载中'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
