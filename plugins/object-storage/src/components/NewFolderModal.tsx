import React, { useState } from 'react'

interface NewFolderModalProps {
  isOpen: boolean
  onClose: () => void
  currentPrefix: string
  onCreate: (folderName: string) => Promise<void>
}

export function NewFolderModal({
  isOpen,
  onClose,
  currentPrefix,
  onCreate
}: NewFolderModalProps): JSX.Element | null {
  if (!isOpen) return null

  const [folderName, setFolderName] = useState<string>('')
  const [loading, setLoading] = useState<boolean>(false)
  const [error, setError] = useState<string>('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const clean = folderName.trim().replace(/[\\/:*?"<>|]/g, '')
    if (!clean) {
      setError('请输入有效的文件夹名称')
      return
    }

    setLoading(true)
    setError('')
    try {
      await onCreate(clean)
      onClose()
    } catch (err: any) {
      setError(err.message || '创建文件夹失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-fade-in">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-900/90">
          <div className="flex items-center gap-2">
            <span className="text-xl">📁</span>
            <h2 className="text-sm font-semibold text-slate-100">新建文件夹</h2>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200 p-1.5 rounded-lg hover:bg-slate-800 transition"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4 text-xs">
          <div>
            <div className="text-slate-400 mb-2">
              当前目录: <span className="font-mono text-emerald-400">/{currentPrefix || ''}</span>
            </div>
            <label className="block font-medium text-slate-300 mb-1.5">文件夹名称</label>
            <input
              type="text"
              autoFocus
              value={folderName}
              onChange={(e) => setFolderName(e.target.value)}
              placeholder="如: documents 或 2026-photos"
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-200 focus:outline-none focus:border-emerald-500"
            />
          </div>

          {error && (
            <div className="p-2.5 bg-rose-950/40 border border-rose-500/50 rounded-xl text-rose-300 text-[11px]">
              ⚠️ {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-slate-800/80 hover:bg-slate-800 text-slate-400 hover:text-slate-200 rounded-xl font-medium transition"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={loading || !folderName.trim()}
              className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-medium transition shadow-sm disabled:opacity-50"
            >
              {loading ? '创建中...' : '确定创建'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
