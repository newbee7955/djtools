import React, { useState } from 'react'
import type { StorageProfile, ProviderType } from '../lib/types'
import { PROVIDER_PRESETS } from '../lib/types'
import { S3Client } from '../lib/s3-client'

interface ProfileModalProps {
  isOpen: boolean
  onClose: () => void
  profiles: StorageProfile[]
  activeProfileId: string | null
  onSaveProfile: (profile: StorageProfile) => void
  onDeleteProfile: (id: string) => void
  onSelectProfile: (id: string) => void
}

export function ProfileModal({
  isOpen,
  onClose,
  profiles,
  activeProfileId,
  onSaveProfile,
  onDeleteProfile,
  onSelectProfile
}: ProfileModalProps): JSX.Element | null {
  if (!isOpen) return null

  const [selectedId, setSelectedId] = useState<string>(activeProfileId || (profiles[0]?.id ?? 'new'))
  const [isNew, setIsNew] = useState<boolean>(!profiles.some((p) => p.id === selectedId))

  // Form state
  const currentProfile = profiles.find((p) => p.id === selectedId)

  const [formData, setFormData] = useState<StorageProfile>(() => {
    if (currentProfile) return { ...currentProfile }
    return {
      id: 'profile_' + Date.now(),
      name: '我的对象存储',
      provider: 's3',
      endpoint: PROVIDER_PRESETS.s3.defaultEndpoint,
      region: PROVIDER_PRESETS.s3.defaultRegion,
      accessKeyId: '',
      secretAccessKey: '',
      defaultBucket: '',
      pathStyle: PROVIDER_PRESETS.s3.pathStyle,
      useSSL: PROVIDER_PRESETS.s3.useSSL,
      customDomain: '',
      createdAt: Date.now()
    }
  })

  const [showSecret, setShowSecret] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ success?: boolean; message?: string } | null>(null)

  const handleSelectProfileItem = (p: StorageProfile) => {
    setSelectedId(p.id)
    setIsNew(false)
    setFormData({ ...p })
    setTestResult(null)
  }

  const handleCreateNew = () => {
    const newId = 'profile_' + Date.now()
    setSelectedId(newId)
    setIsNew(true)
    setFormData({
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
      customDomain: '',
      createdAt: Date.now()
    })
    setTestResult(null)
  }

  const handleProviderChange = (provider: ProviderType) => {
    const preset = PROVIDER_PRESETS[provider]
    setFormData((prev) => ({
      ...prev,
      provider,
      endpoint: preset.defaultEndpoint || prev.endpoint,
      region: preset.defaultRegion || prev.region,
      pathStyle: preset.pathStyle,
      useSSL: preset.useSSL
    }))
    setTestResult(null)
  }

  const handleTestConnection = async () => {
    if (!formData.endpoint || !formData.accessKeyId || !formData.secretAccessKey) {
      setTestResult({ success: false, message: '请完整填写 Endpoint、AccessKey ID 与 SecretAccessKey' })
      return
    }

    setTesting(true)
    setTestResult(null)

    try {
      const client = new S3Client(formData)
      const res = await client.testConnection()
      setTestResult(res)
    } catch (err: any) {
      setTestResult({ success: false, message: err.message || '测试失败' })
    } finally {
      setTesting(false)
    }
  }

  const handleSave = () => {
    if (!formData.name.trim()) {
      alert('请输入连接名称')
      return
    }
    if (!formData.endpoint.trim() || !formData.accessKeyId.trim() || !formData.secretAccessKey.trim()) {
      alert('请完整填写 Endpoint、AccessKey ID 与 SecretAccessKey')
      return
    }

    onSaveProfile({
      ...formData,
      endpoint: formData.endpoint.trim(),
      region: (formData.region || 'us-east-1').trim(),
      accessKeyId: formData.accessKeyId.trim(),
      secretAccessKey: formData.secretAccessKey.trim(),
      defaultBucket: formData.defaultBucket?.trim() || undefined,
      customDomain: formData.customDomain?.trim() || undefined
    })

    onSelectProfile(formData.id)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-fade-in">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-4xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
        {/* 顶部标题栏 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-900/90">
          <div className="flex items-center gap-2.5">
            <span className="text-xl">⚙️</span>
            <h2 className="text-base font-semibold text-slate-100">存储连接预设管理 (Profiles)</h2>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200 p-1.5 rounded-lg hover:bg-slate-800 transition"
          >
            ✕
          </button>
        </div>

        {/* 主体两栏布局 */}
        <div className="flex-1 flex overflow-hidden min-h-[460px]">
          {/* 左侧配置列表 */}
          <div className="w-64 border-r border-slate-800 flex flex-col bg-slate-950/50 p-3">
            <button
              onClick={handleCreateNew}
              className="flex items-center justify-center gap-2 w-full py-2 px-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-medium transition shadow-sm mb-3"
            >
              <span>＋</span>
              <span>新建存储连接</span>
            </button>

            <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
              {profiles.length === 0 && (
                <div className="text-center text-slate-500 text-xs py-8">暂无已保存连接</div>
              )}
              {profiles.map((p) => {
                const isSelected = p.id === selectedId && !isNew
                const preset = PROVIDER_PRESETS[p.provider] || PROVIDER_PRESETS.s3
                return (
                  <div
                    key={p.id}
                    onClick={() => handleSelectProfileItem(p)}
                    className={`flex items-center justify-between p-2.5 rounded-xl cursor-pointer text-xs transition border ${
                      isSelected
                        ? 'bg-emerald-950/40 border-emerald-500/50 text-emerald-300'
                        : 'bg-slate-900/60 border-slate-800/80 text-slate-300 hover:bg-slate-800/50 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center gap-2 truncate">
                      <span className="text-sm">{preset.icon}</span>
                      <div className="truncate">
                        <div className="font-medium truncate">{p.name}</div>
                        <div className="text-[10px] text-slate-500 truncate">{p.endpoint}</div>
                      </div>
                    </div>
                    {p.id === activeProfileId && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex-shrink-0">
                        当前
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* 右侧表单 */}
          <div className="flex-1 overflow-y-auto p-6 space-y-5">
            {/* 存储服务商模板选择 */}
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-2">服务平台模板</label>
              <div className="grid grid-cols-3 gap-2">
                {(Object.keys(PROVIDER_PRESETS) as ProviderType[]).map((key) => {
                  const item = PROVIDER_PRESETS[key]
                  const isChecked = formData.provider === key
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => handleProviderChange(key)}
                      className={`flex items-center gap-2 p-2.5 rounded-xl border text-left text-xs transition ${
                        isChecked
                          ? 'bg-emerald-500/10 border-emerald-500 text-emerald-300 font-medium'
                          : 'bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                      }`}
                    >
                      <span className="text-base">{item.icon}</span>
                      <span className="truncate">{item.name}</span>
                    </button>
                  )
                })}
              </div>
              <p className="text-[11px] text-slate-500 mt-1.5">
                💡 {PROVIDER_PRESETS[formData.provider]?.note}
              </p>
            </div>

            {/* 基本连接配置 */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">
                  连接别名 <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="如: 我的 MinIO / 生产 OSS"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">
                  Endpoint (服务接入点) <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  value={formData.endpoint}
                  onChange={(e) => setFormData({ ...formData, endpoint: e.target.value })}
                  placeholder={PROVIDER_PRESETS[formData.provider]?.placeholderEndpoint}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-emerald-500 font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">
                  Region (地域 / 可用区)
                </label>
                <input
                  type="text"
                  value={formData.region}
                  onChange={(e) => setFormData({ ...formData, region: e.target.value })}
                  placeholder="如: us-east-1 / cn-hangzhou / auto"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-emerald-500 font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">
                  默认存储桶 (Default Bucket)
                </label>
                <input
                  type="text"
                  value={formData.defaultBucket || ''}
                  onChange={(e) => setFormData({ ...formData, defaultBucket: e.target.value })}
                  placeholder="可选，留空则自动列出所有桶"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-emerald-500 font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">
                  AccessKey ID <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  value={formData.accessKeyId}
                  onChange={(e) => setFormData({ ...formData, accessKeyId: e.target.value })}
                  placeholder="AccessKey / 用户名"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-emerald-500 font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">
                  SecretAccessKey <span className="text-rose-400">*</span>
                </label>
                <div className="relative">
                  <input
                    type={showSecret ? 'text' : 'password'}
                    value={formData.secretAccessKey}
                    onChange={(e) => setFormData({ ...formData, secretAccessKey: e.target.value })}
                    placeholder="SecretKey / 密码"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-emerald-500 font-mono pr-8"
                  />
                  <button
                    type="button"
                    onClick={() => setShowSecret(!showSecret)}
                    className="absolute right-2.5 top-2.5 text-xs text-slate-500 hover:text-slate-300"
                  >
                    {showSecret ? '🙈' : '👁️'}
                  </button>
                </div>
              </div>
            </div>

            {/* 高级选项 */}
            <div className="pt-2 border-t border-slate-800/80 space-y-3">
              <div className="text-xs font-medium text-slate-400">高级选项</div>
              <div className="grid grid-cols-2 gap-4">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="pathStyle"
                    checked={formData.pathStyle}
                    onChange={(e) => setFormData({ ...formData, pathStyle: e.target.checked })}
                    className="rounded border-slate-800 text-emerald-500 focus:ring-emerald-500"
                  />
                  <label htmlFor="pathStyle" className="text-xs text-slate-300 cursor-pointer">
                    启用路径样式 (Path-Style，MinIO 推荐)
                  </label>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="useSSL"
                    checked={formData.useSSL ?? true}
                    onChange={(e) => setFormData({ ...formData, useSSL: e.target.checked })}
                    className="rounded border-slate-800 text-emerald-500 focus:ring-emerald-500"
                  />
                  <label htmlFor="useSSL" className="text-xs text-slate-300 cursor-pointer">
                    使用 HTTPS 安全连接 (本地调试可取消勾选)
                  </label>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">
                  自定义 CDN 加速域名 (可选)
                </label>
                <input
                  type="text"
                  value={formData.customDomain || ''}
                  onChange={(e) => setFormData({ ...formData, customDomain: e.target.value })}
                  placeholder="如: https://cdn.example.com (生成复制链接时自动替换)"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-emerald-500 font-mono"
                />
              </div>
            </div>

            {/* 连通性测试结果提示 */}
            {testResult && (
              <div
                className={`p-3 rounded-xl border text-xs flex items-center gap-2 ${
                  testResult.success
                    ? 'bg-emerald-950/40 border-emerald-500/50 text-emerald-300'
                    : 'bg-rose-950/40 border-rose-500/50 text-rose-300'
                }`}
              >
                <span>{testResult.success ? '✅' : '❌'}</span>
                <span>{testResult.message}</span>
              </div>
            )}
          </div>
        </div>

        {/* 底部操作栏 */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-800 bg-slate-900/90">
          <div>
            {!isNew && currentProfile && (
              <button
                type="button"
                onClick={() => {
                  if (confirm(`确定删除连接预设「${currentProfile.name}」吗？`)) {
                    onDeleteProfile(currentProfile.id)
                    handleCreateNew()
                  }
                }}
                className="px-3 py-2 text-xs text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 rounded-xl transition"
              >
                删除当前连接
              </button>
            )}
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={testing}
              onClick={handleTestConnection}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-medium transition disabled:opacity-50"
            >
              {testing ? '正在测试...' : '测试连通性'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-slate-800/80 hover:bg-slate-800 text-slate-400 hover:text-slate-200 rounded-xl text-xs transition"
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-medium transition shadow-sm"
            >
              保存并连接
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
