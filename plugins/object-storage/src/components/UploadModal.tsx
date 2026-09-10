import React, { useState, useRef } from 'react'
import type { UploadTask } from '../lib/types'
import { S3Client } from '../lib/s3-client'

interface UploadModalProps {
  isOpen: boolean
  onClose: () => void
  client: S3Client
  bucket: string
  currentPrefix: string
  onUploadSuccess: () => void
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

export function UploadModal({
  isOpen,
  onClose,
  client,
  bucket,
  currentPrefix,
  onUploadSuccess
}: UploadModalProps): JSX.Element | null {
  if (!isOpen) return null

  const [filesToUpload, setFilesToUpload] = useState<File[]>([])
  const [tasks, setTasks] = useState<UploadTask[]>([])
  const [uploading, setUploading] = useState<boolean>(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFilesSelected = (files: FileList | null) => {
    if (!files || files.length === 0) return
    const newFiles = Array.from(files)
    setFilesToUpload((prev) => [...prev, ...newFiles])

    const newTasks: UploadTask[] = newFiles.map((f) => ({
      id: 'task_' + Math.random().toString(36).substring(2, 9),
      fileName: f.name,
      key: `${currentPrefix}${f.name}`,
      size: f.size,
      progress: 0,
      status: 'uploading'
    }))
    setTasks((prev) => [...prev, ...newTasks])
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFilesSelected(e.dataTransfer.files)
    }
  }

  const handleStartUpload = async () => {
    if (filesToUpload.length === 0 || uploading) return
    setUploading(true)

    let hasSuccess = false

    for (let i = 0; i < filesToUpload.length; i++) {
      const file = filesToUpload[i]
      const task = tasks[i]
      if (!file || !task) continue

      const key = `${currentPrefix}${file.name}`

      try {
        await client.putObject(bucket, key, file, file.type || 'application/octet-stream', (pct) => {
          setTasks((prev) =>
            prev.map((t, idx) => (idx === i ? { ...t, progress: pct } : t))
          )
        })

        setTasks((prev) =>
          prev.map((t, idx) => (idx === i ? { ...t, progress: 100, status: 'completed' } : t))
        )
        hasSuccess = true
      } catch (err: any) {
        setTasks((prev) =>
          prev.map((t, idx) =>
            idx === i
              ? { ...t, status: 'failed', error: err.message || '上传失败' }
              : t
          )
        )
      }
    }

    setUploading(false)
    if (hasSuccess) {
      onUploadSuccess()
    }
  }

  const handleClear = () => {
    setFilesToUpload([])
    setTasks([])
  }

  const allDone = tasks.length > 0 && tasks.every((t) => t.status === 'completed' || t.status === 'failed')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-fade-in">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
        {/* 顶部标题 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-900/90">
          <div className="flex items-center gap-2.5">
            <span className="text-xl">📤</span>
            <div>
              <h2 className="text-sm font-semibold text-slate-100">上传文件到对象存储</h2>
              <p className="text-[11px] text-slate-400">
                存储桶: <span className="font-mono text-emerald-400">{bucket}</span> | 目标目录: <span className="font-mono text-emerald-400">/{currentPrefix}</span>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={uploading}
            className="text-slate-400 hover:text-slate-200 p-1.5 rounded-lg hover:bg-slate-800 transition disabled:opacity-30"
          >
            ✕
          </button>
        </div>

        {/* 拖拽上传区 */}
        <div className="p-6 space-y-4 flex-1 overflow-y-auto">
          <div
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className="border-2 border-dashed border-slate-700 hover:border-emerald-500/80 bg-slate-950/40 hover:bg-slate-950/70 rounded-2xl p-8 flex flex-col items-center justify-center cursor-pointer transition text-center group"
          >
            <input
              type="file"
              ref={fileInputRef}
              multiple
              className="hidden"
              onChange={(e) => handleFilesSelected(e.target.files)}
            />
            <div className="text-4xl mb-3 group-hover:scale-110 transition transform">📂</div>
            <div className="text-sm font-medium text-slate-200 mb-1">
              点击选择文件，或将本地文件拖拽到此区域
            </div>
            <div className="text-xs text-slate-500">支持多文件批量上传，自动识别 MIME 类型与流式分块传输</div>
          </div>

          {/* 文件待传/上传列表 */}
          {tasks.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-slate-400 px-1">
                <span>上传队列 ({tasks.length})</span>
                {!uploading && (
                  <button onClick={handleClear} className="text-slate-500 hover:text-slate-300 transition">
                    清空列表
                  </button>
                )}
              </div>

              <div className="max-h-60 overflow-y-auto space-y-2 pr-1">
                {tasks.map((t, idx) => (
                  <div
                    key={t.id}
                    className="p-3 bg-slate-950/60 border border-slate-800/80 rounded-xl flex flex-col gap-1.5 text-xs"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-slate-200 truncate max-w-sm">{t.fileName}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] text-slate-500">{formatBytes(t.size)}</span>
                        {t.status === 'completed' && <span className="text-emerald-400 font-medium">✓ 已完成</span>}
                        {t.status === 'failed' && <span className="text-rose-400 font-medium">✗ {t.error || '失败'}</span>}
                        {t.status === 'uploading' && <span className="text-emerald-400">{t.progress}%</span>}
                      </div>
                    </div>

                    {/* 进度条 */}
                    <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
                      <div
                        className={`h-full transition-all duration-200 ${
                          t.status === 'failed'
                            ? 'bg-rose-500'
                            : t.status === 'completed'
                            ? 'bg-emerald-500'
                            : 'bg-emerald-400'
                        }`}
                        style={{ width: `${t.progress}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 底部操作 */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-800 bg-slate-900/90">
          <button
            type="button"
            disabled={uploading}
            onClick={onClose}
            className="px-4 py-2 bg-slate-800/80 hover:bg-slate-800 text-slate-400 hover:text-slate-200 rounded-xl text-xs transition disabled:opacity-40"
          >
            {allDone ? '关闭' : '取消'}
          </button>
          <button
            type="button"
            disabled={uploading || filesToUpload.length === 0 || allDone}
            onClick={handleStartUpload}
            className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-medium transition shadow-sm disabled:opacity-40"
          >
            {uploading ? '正在上传中...' : `开始上传 (${filesToUpload.length})`}
          </button>
        </div>
      </div>
    </div>
  )
}
