import React, { useState, useEffect } from 'react'
import type { AlbumSource, LocalAlbumSource, S3AlbumSource, StorageProfile, ProviderType, BucketItem } from '../lib/s3-types'
import { PROVIDER_PRESETS } from '../lib/s3-types'
import { getStoredS3Profiles, saveStoredS3Profiles, upsertS3Profile, deleteS3Profile } from '../lib/s3-profile-store'
import { S3Client } from '../lib/s3-client'

interface StorageSourceModalProps {
  isOpen: boolean
  onClose: () => void
  currentSource: AlbumSource
  localDirectory: string
  onSelectLocalDirectory: () => Promise<void>
  onOpenLocalDirectory: () => Promise<void>
  onSwitchToLocal: () => Promise<void>
  onSwitchToS3: (source: S3AlbumSource) => Promise<void>
}

export const StorageSourceModal: React.FC<StorageSourceModalProps> = ({
  isOpen,
  onClose,
  currentSource,
  localDirectory,
  onSelectLocalDirectory,
  onOpenLocalDirectory,
  onSwitchToLocal,
  onSwitchToS3
}) => {
  if (!isOpen) return null

  // Tab: 'local' | 's3'
  const [activeTab, setActiveTab] = useState<'local' | 's3'>(currentSource.type)

  // S3 Profiles state
  const [profiles, setProfiles] = useState<StorageProfile[]>(() => getStoredS3Profiles())
  const [selectedProfileId, setSelectedProfileId] = useState<string>(() => {
    if (currentSource.type === 's3') return currentSource.profileId
    const stored = getStoredS3Profiles()
    return stored[0]?.id || 'new'
  })

  // Whether user is creating/editing a profile
  const [isEditingProfile, setIsEditingProfile] = useState<boolean>(() => {
    const stored = getStoredS3Profiles()
    return stored.length === 0
  })

  // Profile Form state
  const currentProfile = profiles.find((p) => p.id === selectedProfileId)
  const [profileForm, setProfileForm] = useState<StorageProfile>(() => {
    if (currentProfile) return { ...currentProfile }
    return {
      id: 'profile_' + Date.now(),
      name: '私有 MinIO 相册',
      provider: 'minio',
      endpoint: PROVIDER_PRESETS.minio.defaultEndpoint,
      region: PROVIDER_PRESETS.minio.defaultRegion,
      accessKeyId: '',
      secretAccessKey: '',
      defaultBucket: '',
      pathStyle: PROVIDER_PRESETS.minio.pathStyle,
      useSSL: PROVIDER_PRESETS.minio.useSSL,
      createdAt: Date.now()
    }
  })

  const [showSecret, setShowSecret] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ success?: boolean; message?: string } | null>(null)

  // Bucket and Prefix for the active connection
  const [targetBucket, setTargetBucket] = useState<string>(() => {
    if (currentSource.type === 's3') return currentSource.bucket
    return currentProfile?.defaultBucket || ''
  })
  const [targetPrefix, setTargetPrefix] = useState<string>(() => {
    if (currentSource.type === 's3') return currentSource.prefix
    return ''
  })

  const [bucketsList, setBucketsList] = useState<BucketItem[]>([])
  const [fetchingBuckets, setFetchingBuckets] = useState(false)

  // Sync profileForm when selected profile changes
  useEffect(() => {
    const prof = profiles.find((p) => p.id === selectedProfileId)
    if (prof) {
      setProfileForm({ ...prof })
      if (!targetBucket) {
        setTargetBucket(prof.defaultBucket || '')
      }
    }
    setTestResult(null)
  }, [selectedProfileId, profiles])

  const handleProviderSelect = (provider: ProviderType) => {
    const preset = PROVIDER_PRESETS[provider]
    setProfileForm((prev) => ({
      ...prev,
      provider,
      endpoint: preset.defaultEndpoint || prev.endpoint,
      region: preset.defaultRegion || prev.region,
      pathStyle: preset.pathStyle,
      useSSL: preset.useSSL
    }))
    setTestResult(null)
  }

  const handleCreateNewProfile = () => {
    const newId = 'profile_' + Date.now()
    const newProfile: StorageProfile = {
      id: newId,
      name: '新建存储连接',
      provider: 'minio',
      endpoint: PROVIDER_PRESETS.minio.defaultEndpoint,
      region: PROVIDER_PRESETS.minio.defaultRegion,
      accessKeyId: '',
      secretAccessKey: '',
      defaultBucket: '',
      pathStyle: PROVIDER_PRESETS.minio.pathStyle,
      useSSL: PROVIDER_PRESETS.minio.useSSL,
      createdAt: Date.now()
    }
    setProfileForm(newProfile)
    setSelectedProfileId(newId)
    setIsEditingProfile(true)
    setTestResult(null)
  }

  const handleSaveProfile = () => {
    if (!profileForm.name.trim()) {
      alert('请输入配置名称')
      return
    }
    if (!profileForm.endpoint.trim() || !profileForm.accessKeyId.trim() || !profileForm.secretAccessKey.trim()) {
      alert('请填写完整的 Endpoint、AccessKey ID 与 SecretAccessKey')
      return
    }

    const updated = upsertS3Profile(profileForm)
    setProfiles(updated)
    setSelectedProfileId(profileForm.id)
    setIsEditingProfile(false)
    setTestResult({ success: true, message: '配置已保存' })
  }

  const handleDeleteProfile = (id: string) => {
    if (!confirm('确定删除该对象存储连接配置吗？')) return
    const updated = deleteS3Profile(id)
    setProfiles(updated)
    if (updated.length > 0) {
      setSelectedProfileId(updated[0].id)
      setProfileForm({ ...updated[0] })
      setIsEditingProfile(false)
    } else {
      handleCreateNewProfile()
    }
  }

  const handleTestConnection = async () => {
    if (!profileForm.endpoint || !profileForm.accessKeyId || !profileForm.secretAccessKey) {
      setTestResult({ success: false, message: '请完整填写 Endpoint、AccessKey ID 与 Secret' })
      return
    }

    setTesting(true)
    setTestResult(null)
    try {
      const client = new S3Client(profileForm)
      const res = await client.testConnection(targetBucket || profileForm.defaultBucket)
      setTestResult(res)
    } catch (err: any) {
      setTestResult({ success: false, message: err.message || '连接失败' })
    } finally {
      setTesting(false)
    }
  }

  const handleFetchBuckets = async () => {
    const prof = isEditingProfile ? profileForm : currentProfile
    if (!prof || !prof.endpoint || !prof.accessKeyId || !prof.secretAccessKey) {
      alert('请先填写并保存连接密鑰')
      return
    }

    setFetchingBuckets(true)
    try {
      const client = new S3Client(prof)
      const list = await client.listBuckets()
      setBucketsList(list)
      if (list.length > 0 && !targetBucket) {
        setTargetBucket(list[0].name)
      }
    } catch (err: any) {
      alert('获取存储桶失败: ' + (err.message || '网络或鉴权异常'))
    } finally {
      setFetchingBuckets(false)
    }
  }

  const handleApplyS3 = async () => {
    const prof = profiles.find((p) => p.id === selectedProfileId)
    if (!prof) {
      alert('请先选择或保存一个对象存储配置')
      return
    }
    if (!targetBucket.trim()) {
      alert('请指定要加载的存储桶 (Bucket)')
      return
    }

    let cleanPrefix = targetPrefix.trim().replace(/^\/+/, '')
    if (cleanPrefix && !cleanPrefix.endsWith('/')) {
      cleanPrefix += '/'
    }

    await onSwitchToS3({
      type: 's3',
      profileId: prof.id,
      bucket: targetBucket.trim(),
      prefix: cleanPrefix
    })
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-150">
      <div className="relative w-full max-w-2xl bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden text-slate-100">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-700/60 flex items-center justify-between bg-slate-900/95">
          <div className="flex items-center gap-2.5">
            <span className="text-xl">🗂️</span>
            <div>
              <h2 className="text-base font-bold text-slate-100">相册存储源设置</h2>
              <p className="text-xs text-slate-400">
                支持连接本地相册目录或直连 S3 / MinIO / OSS / COS 对象存储
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-100 hover:bg-slate-700/70 transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Tab Switcher */}
        <div className="flex border-b border-slate-700/50 bg-slate-800/40 px-6 pt-3 gap-2">
          <button
            onClick={() => setActiveTab('local')}
            className={`flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-t-xl transition-all border-t border-x ${
              activeTab === 'local'
                ? 'bg-slate-900 border-slate-700/70 text-slate-100 -mb-px'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <span>📁</span>
            <span>本地文件夹</span>
            {currentSource.type === 'local' && (
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            )}
          </button>

          <button
            onClick={() => setActiveTab('s3')}
            className={`flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-t-xl transition-all border-t border-x ${
              activeTab === 's3'
                ? 'bg-slate-900 border-slate-700/70 text-slate-100 -mb-px'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <span>🪣</span>
            <span>对象存储 (S3 / MinIO / OSS / COS)</span>
            {currentSource.type === 's3' && (
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            )}
          </button>
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {activeTab === 'local' ? (
            <div className="space-y-6">
              <div className="p-4 rounded-xl border border-slate-700/60 bg-slate-800/30 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-400">当前相册目录</span>
                  {currentSource.type === 'local' && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 font-medium border border-emerald-500/30">
                      正在使用
                    </span>
                  )}
                </div>
                <div className="p-3 bg-slate-950/60 rounded-lg border border-slate-700/60 font-mono text-xs text-slate-200 break-all">
                  {localDirectory || '尚未选择本地目录'}
                </div>
                <div className="flex items-center gap-3 pt-1">
                  <button
                    onClick={onSelectLocalDirectory}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-500 transition-colors shadow-sm"
                  >
                    <span>📁</span>
                    <span>选择新文件夹</span>
                  </button>
                  <button
                    onClick={onOpenLocalDirectory}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs font-medium transition-colors"
                  >
                    <span>↗</span>
                    <span>在资源管理器中打开</span>
                  </button>
                </div>
              </div>

              {currentSource.type !== 'local' && (
                <div className="pt-2">
                  <button
                    onClick={async () => {
                      await onSwitchToLocal()
                      onClose()
                    }}
                    className="w-full py-2.5 rounded-xl bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-500 transition-colors shadow-sm"
                  >
                    切换回本地相册
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-6">
              {/* Profile Selector */}
              <div className="flex items-center justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <label className="block text-xs font-medium text-slate-400 mb-1.5">
                    选择存储连接配置
                  </label>
                  <select
                    value={isEditingProfile ? 'edit' : selectedProfileId}
                    onChange={(e) => {
                      if (e.target.value === 'edit') { setIsEditingProfile(true) }
                      else { setSelectedProfileId(e.target.value); setIsEditingProfile(false) }
                    }}
                    className="w-full px-3 py-2 rounded-xl text-xs bg-slate-800 border border-slate-600/70 text-slate-200 focus:border-emerald-500 focus:outline-none"
                  >
                    {profiles.map((p) => (
                      <option key={p.id} value={p.id}>
                        {PROVIDER_PRESETS[p.provider]?.icon || '📦'} {p.name} ({p.endpoint})
                      </option>
                    ))}
                    {isEditingProfile && <option value="edit">✍️ 正在编辑配置...</option>}
                  </select>
                </div>

                <div className="flex items-end gap-2 pt-5">
                  {!isEditingProfile ? (
                    <>
                      <button
                        onClick={() => setIsEditingProfile(true)}
                        className="px-3 py-2 rounded-xl border border-slate-600/70 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition-colors"
                      >
                        编辑
                      </button>
                      <button
                        onClick={() => handleDeleteProfile(selectedProfileId)}
                        className="px-3 py-2 rounded-xl border border-rose-500/40 text-rose-400 hover:bg-rose-500/10 text-xs font-medium transition-colors"
                      >
                        删除
                      </button>
                      <button
                        onClick={handleCreateNewProfile}
                        className="px-3 py-2 rounded-xl bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 border border-emerald-500/30 text-xs font-medium transition-colors flex items-center gap-1"
                      >
                        <span>➕</span>
                        <span>新建</span>
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => setIsEditingProfile(false)}
                      className="px-3 py-2 rounded-xl border border-slate-600/70 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition-colors"
                    >
                      取消编辑
                    </button>
                  )}
                </div>
              </div>

              {/* Edit Profile Form Drawer */}
              {isEditingProfile && (
                <div className="p-4 rounded-xl border border-emerald-500/30 bg-emerald-950/20 space-y-4 animate-in fade-in">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-100">
                      {profiles.some((p) => p.id === profileForm.id) ? '编辑连接配置' : '新建对象存储连接'}
                    </span>
                    <span className="text-[10px] text-slate-400">无需本地虚拟磁盘挂载</span>
                  </div>

                  <div>
                    <label className="block text-[11px] font-medium text-slate-400 mb-1.5">
                      选择服务提供商
                    </label>
                    <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                      {(Object.keys(PROVIDER_PRESETS) as ProviderType[]).map((type) => {
                        const preset = PROVIDER_PRESETS[type]
                        const isSel = profileForm.provider === type
                        return (
                          <button
                            key={type}
                            type="button"
                            onClick={() => handleProviderSelect(type)}
                            className={`p-2 rounded-xl border text-center transition-all ${
                              isSel
                                ? 'bg-emerald-600 text-white border-emerald-500 shadow-sm'
                                : 'bg-slate-800 hover:bg-slate-700 border-slate-600/70 text-slate-200'
                            }`}
                          >
                            <div className="text-base">{preset.icon}</div>
                            <div className="text-[10px] font-semibold mt-1 truncate">{preset.name}</div>
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-medium text-slate-400 mb-1">配置备注名称 *</label>
                      <input
                        type="text"
                        value={profileForm.name}
                        onChange={(e) => setProfileForm({ ...profileForm, name: e.target.value })}
                        placeholder="如: 我的家庭 NAS 照片库"
                        className="w-full px-3 py-1.5 rounded-lg text-xs bg-slate-800 border border-slate-600/70 text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-slate-400 mb-1">Endpoint *</label>
                      <input
                        type="text"
                        value={profileForm.endpoint}
                        onChange={(e) => setProfileForm({ ...profileForm, endpoint: e.target.value })}
                        placeholder={PROVIDER_PRESETS[profileForm.provider].placeholderEndpoint}
                        className="w-full px-3 py-1.5 rounded-lg text-xs bg-slate-800 border border-slate-600/70 text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-slate-400 mb-1">Region</label>
                      <input
                        type="text"
                        value={profileForm.region}
                        onChange={(e) => setProfileForm({ ...profileForm, region: e.target.value })}
                        placeholder="us-east-1, cn-hangzhou"
                        className="w-full px-3 py-1.5 rounded-lg text-xs bg-slate-800 border border-slate-600/70 text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-slate-400 mb-1">默认 Bucket</label>
                      <input
                        type="text"
                        value={profileForm.defaultBucket || ''}
                        onChange={(e) => setProfileForm({ ...profileForm, defaultBucket: e.target.value })}
                        placeholder="存储桶名称"
                        className="w-full px-3 py-1.5 rounded-lg text-xs bg-slate-800 border border-slate-600/70 text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-slate-400 mb-1">AccessKey ID *</label>
                      <input
                        type="text"
                        value={profileForm.accessKeyId}
                        onChange={(e) => setProfileForm({ ...profileForm, accessKeyId: e.target.value })}
                        placeholder="AK"
                        className="w-full px-3 py-1.5 rounded-lg text-xs bg-slate-800 border border-slate-600/70 text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none font-mono"
                      />
                    </div>
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-[11px] font-medium text-slate-400">SecretAccessKey *</label>
                        <button type="button" onClick={() => setShowSecret(!showSecret)} className="text-[10px] text-emerald-400 hover:underline">
                          {showSecret ? '隐藏' : '显示'}
                        </button>
                      </div>
                      <input
                        type={showSecret ? 'text' : 'password'}
                        value={profileForm.secretAccessKey}
                        onChange={(e) => setProfileForm({ ...profileForm, secretAccessKey: e.target.value })}
                        placeholder="SK"
                        className="w-full px-3 py-1.5 rounded-lg text-xs bg-slate-800 border border-slate-600/70 text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none font-mono"
                      />
                    </div>
                  </div>

                  <div className="flex items-center gap-6 pt-1">
                    <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-300">
                      <input
                        type="checkbox"
                        checked={profileForm.pathStyle}
                        onChange={(e) => setProfileForm({ ...profileForm, pathStyle: e.target.checked })}
                        className="rounded focus:ring-0"
                      />
                      <span>Path-Style (MinIO / NAS)</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-300">
                      <input
                        type="checkbox"
                        checked={profileForm.useSSL !== false}
                        onChange={(e) => setProfileForm({ ...profileForm, useSSL: e.target.checked })}
                        className="rounded focus:ring-0"
                      />
                      <span>SSL (HTTPS)</span>
                    </label>
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-slate-700/40">
                    <button
                      type="button"
                      onClick={handleTestConnection}
                      disabled={testing}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs font-medium transition-colors disabled:opacity-50"
                    >
                      <span>🔌</span>
                      <span>{testing ? '测试中...' : '测试连通性'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleSaveProfile}
                      className="px-4 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-500 transition-colors shadow-sm"
                    >
                      保存配置
                    </button>
                  </div>

                  {testResult && (
                    <div className={`p-2.5 rounded-lg text-xs ${
                      testResult.success
                        ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                        : 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                    }`}>
                      {testResult.success ? '✓ ' : '✕ '}{testResult.message}
                    </div>
                  )}
                </div>
              )}

              {!isEditingProfile && currentProfile && (
                <div className="p-4 rounded-xl border border-slate-700/70 bg-slate-800/30 space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-100">相册目标位置</span>
                    <button
                      type="button"
                      onClick={handleFetchBuckets}
                      disabled={fetchingBuckets}
                      className="text-xs text-emerald-400 hover:underline flex items-center gap-1"
                    >
                      {fetchingBuckets ? '正在获取...' : '🔄 自动获取可用存储桶'}
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-medium text-slate-400 mb-1">存储桶 (Bucket) *</label>
                      {bucketsList.length > 0 ? (
                        <select
                          value={targetBucket}
                          onChange={(e) => setTargetBucket(e.target.value)}
                          className="w-full px-3 py-1.5 rounded-lg text-xs bg-slate-800 border border-slate-600/70 text-slate-200 focus:border-emerald-500 focus:outline-none font-mono"
                        >
                          <option value="">-- 请选择存储桶 --</option>
                          {bucketsList.map((b) => (
                            <option key={b.name} value={b.name}>{b.name}</option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type="text"
                          value={targetBucket}
                          onChange={(e) => setTargetBucket(e.target.value)}
                          placeholder="my-photos"
                          className="w-full px-3 py-1.5 rounded-lg text-xs bg-slate-800 border border-slate-600/70 text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none font-mono"
                        />
                      )}
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-slate-400 mb-1">目录前缀 (Prefix)</label>
                      <input
                        type="text"
                        value={targetPrefix}
                        onChange={(e) => setTargetPrefix(e.target.value)}
                        placeholder="photos/ 或留空"
                        className="w-full px-3 py-1.5 rounded-lg text-xs bg-slate-800 border border-slate-600/70 text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none font-mono"
                      />
                    </div>
                  </div>

                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    💡 提示：时光相册将递归检索该存储桶指定前缀下的全部照片。
                  </p>

                  <div className="pt-2">
                    <button
                      type="button"
                      onClick={handleApplyS3}
                      className="w-full py-2.5 rounded-xl bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-500 transition-colors shadow-sm flex items-center justify-center gap-2"
                    >
                      <span>🌟</span>
                      <span>确定切换至此对象存储相册</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
