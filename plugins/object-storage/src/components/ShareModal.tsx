import React, { useState, useEffect } from 'react'
import type { StorageObjectItem } from '../lib/types'
import { S3Client } from '../lib/s3-client'

interface ShareModalProps {
  isOpen: boolean
  onClose: () => void
  item: StorageObjectItem | null
  bucket: string
  client: S3Client
}

export function ShareModal({
  isOpen,
  onClose,
  item,
  bucket,
  client
}: ShareModalProps): JSX.Element | null {
  if (!isOpen || !item) return null

  const [expiresInSeconds, setExpiresInSeconds] = useState<number>(3600)
  const [presignedUrl, setPresignedUrl] = useState<string>('')
  const [publicUrl, setPublicUrl] = useState<string>('')
  const [loading, setLoading] = useState<boolean>(true)
  const [copiedPresigned, setCopiedPresigned] = useState<boolean>(false)
  const [copiedPublic, setCopiedPublic] = useState<boolean>(false)

  useEffect(() => {
    let active = true
    setLoading(true)

    async function generate() {
      if (!item) return
      try {
        const url = await client.getPresignedUrl(bucket, item.key, expiresInSeconds)
        if (!active) return
        setPresignedUrl(url)
        setPublicUrl(client.getPublicUrl(bucket, item.key))
      } catch (err) {
        console.error('生成分享链接失败:', err)
      } finally {
        if (active) setLoading(false)
      }
    }

    generate()
    return () => {
      active = false
    }
  }, [item, bucket, client, expiresInSeconds])

  const copyToClipboard = (text: string, type: 'presigned' | 'public') => {
    navigator.clipboard.writeText(text)
    if (type === 'presigned') {
      setCopiedPresigned(true)
      setTimeout(() => setCopiedPresigned(false), 2000)
    } else {
      setCopiedPublic(true)
      setTimeout(() => setCopiedPublic(false), 2000)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-fade-in">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col">
        {/* 顶部标题 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-900/90">
          <div className="flex items-center gap-2">
            <span className="text-xl">🔗</span>
            <h2 className="text-sm font-semibold text-slate-100">外链分享与生成</h2>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200 p-1.5 rounded-lg hover:bg-slate-800 transition"
          >
            ✕
          </button>
        </div>

        <div className="p-6 space-y-5 text-xs">
          {/* 文件信息 */}
          <div className="p-3 bg-slate-950/60 border border-slate-800/80 rounded-xl flex items-center gap-3">
            <span className="text-2xl">📄</span>
            <div className="truncate">
              <div className="font-medium text-slate-200 truncate">{item.name}</div>
              <div className="text-[11px] text-slate-500 font-mono truncate">{item.key}</div>
            </div>
          </div>

          {/* 预签名临时链接 */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="font-medium text-slate-300">临时安全预签名链接 (Presigned URL)</label>
              <div className="flex items-center gap-1.5">
                <span className="text-slate-500">有效期:</span>
                <select
                  value={expiresInSeconds}
                  onChange={(e) => setExpiresInSeconds(Number(e.target.value))}
                  className="bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-slate-300 focus:outline-none focus:border-emerald-500"
                >
                  <option value={900}>15 分钟</option>
                  <option value={3600}>1 小时</option>
                  <option value={43200}>12 小时</option>
                  <option value={86400}>24 小时 (1天)</option>
                  <option value={604800}>7 天</option>
                </select>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={loading ? '正在计算加密签名...' : presignedUrl}
                className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-300 font-mono text-[11px] select-all focus:outline-none focus:border-emerald-500"
              />
              <button
                disabled={loading || !presignedUrl}
                onClick={() => copyToClipboard(presignedUrl, 'presigned')}
                className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-medium transition disabled:opacity-50 flex-shrink-0"
              >
                {copiedPresigned ? '已复制 ✓' : '复制链接'}
              </button>
            </div>
            <p className="text-[11px] text-slate-500">
              💡 携带 AWS Signature V4 临时授权，接收方无需任何账号或权限即可在有效期内直接下载/访问。
            </p>
          </div>

          {/* 公共/CDN 直链 */}
          <div className="space-y-2 pt-2 border-t border-slate-800/80">
            <label className="font-medium text-slate-300">公共访问直链 / CDN 加速地址</label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={publicUrl}
                className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-300 font-mono text-[11px] select-all focus:outline-none focus:border-emerald-500"
              />
              <button
                onClick={() => copyToClipboard(publicUrl, 'public')}
                className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl font-medium transition flex-shrink-0"
              >
                {copiedPublic ? '已复制 ✓' : '复制直链'}
              </button>
            </div>
            <p className="text-[11px] text-slate-500">
              💡 适用于 Bucket 具备公共读权限或配置了 CDN 加速域名的场景。
            </p>
          </div>
        </div>

        {/* 底部按钮 */}
        <div className="flex items-center justify-end px-6 py-4 border-t border-slate-800 bg-slate-900/90">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl font-medium transition"
          >
            完成
          </button>
        </div>
      </div>
    </div>
  )
}
