import React, { useEffect, useRef, useState } from 'react'
import type { ThemeConfig } from '../App'
import type { AiToolsStatus } from '../../../shared/ai-tools-runtime'

const callStates = { running: '执行中', succeeded: '成功', failed: '失败', denied: '已拒绝' }
type Language = 'eng' | 'chi_sim' | 'eng+chi_sim'

export default function AiToolsPanel({ theme }: { theme: ThemeConfig }): JSX.Element {
  const [status, setStatus] = useState<AiToolsStatus | null>(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [connection, setConnection] = useState('')
  const [artifact, setArtifact] = useState<string | null>(null)
  const [language, setLanguage] = useState<Language>('eng+chi_sim')
  const [content, setContent] = useState('')
  const [filename, setFilename] = useState('ocr-note.md')
  const [recognized, setRecognized] = useState(false)
  const lock = useRef(false)
  const mounted = useRef(false)
  const currentUrl = useRef<string | undefined>()
  const revision = useRef(0)
  const api = window.hostAPI!

  function applyStatus(next: AiToolsStatus): void {
    if (!mounted.current) return
    if (!next.running || currentUrl.current !== next.url) setConnection('')
    currentUrl.current = next.url
    setStatus(next)
  }

  useEffect(() => {
    mounted.current = true
    if (!api) return () => { mounted.current = false }
    let fetching = false
    async function refresh(): Promise<void> {
      if (lock.current || fetching) return
      fetching = true
      const version = revision.current
      try { const next = await api.aiToolsStatus(); if (version === revision.current) applyStatus(next) }
      catch { if (mounted.current && version === revision.current) setError('无法获取 AI 工具状态，请刷新重试。') }
      finally { fetching = false }
    }
    void refresh()
    const timer = window.setInterval(() => { void refresh() }, 3000)
    return () => { mounted.current = false; window.clearInterval(timer) }
  }, [api])

  async function act(label: string, failure: string, operation: () => Promise<void>): Promise<void> {
    if (lock.current) return
    lock.current = true
    revision.current += 1
    setBusy(label); setError(''); setNotice('')
    try { await operation() }
    catch { if (mounted.current) setError(failure) }
    finally {
      try { applyStatus(await api.aiToolsStatus()) } catch { /* Keep the last known status. */ }
      lock.current = false
      if (mounted.current) setBusy('')
    }
  }

  const enabled = (name: string): boolean => !!status?.tools.find(tool => tool.name === name)?.enabled
  const canRecognize = !!status?.ocrReady && enabled('ocr_recognize')
  const canSave = recognized && enabled('markdown_create') && !!status?.outputDirectory && !!filename.trim() && !busy
  const buttonClass = `px-3 py-2 rounded-lg text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${theme.btnGhost}`
  const inputClass = `w-full rounded-lg border p-2.5 text-sm outline-none focus:ring-2 focus:ring-emerald-500/50 disabled:opacity-50 ${theme.subcardBg} ${theme.border} ${theme.textPrimary}`
  const muted = `text-xs leading-relaxed ${theme.textSecondary}`
  const section = `pt-5 border-t space-y-3 ${theme.border}`

  async function selectImage(name: 'image_import' | 'screen_capture'): Promise<void> {
    await act(name === 'image_import' ? '正在选择图片…' : '正在选择截图区域…', '图片获取失败，请检查工具及所属插件后重试。', async () => {
      const result = await api.aiToolsExecute(name, {})
      if (result.canceled) { setNotice('已取消图片选择'); return }
      if (typeof result.artifactId !== 'string') throw new Error()
      setArtifact(result.artifactId); setNotice('图片已就绪')
    })
  }

  async function connectionConfig(copy: boolean): Promise<void> {
    await act(copy ? '正在复制配置…' : '正在读取配置…', copy ? '复制失败，请显示配置后手动复制。' : '无法读取连接配置，请确认 MCP 正在运行。', async () => {
      const config = await api.aiToolsConnectionConfig()
      const json = JSON.stringify({ mcpServers: { doujiao: config } }, null, 2)
      if (copy) { await navigator.clipboard.writeText(json); setNotice('已复制连接配置，请妥善保管其中的凭据。') }
      else setConnection(json)
    })
  }

  return (
    <section aria-labelledby="ai-tools-title" className={`p-5 rounded-xl border space-y-5 ${theme.cardBg} ${theme.border} ${theme.textPrimary}`}>
      <div className="space-y-2">
        <div className="flex flex-wrap gap-3 items-center justify-between">
          <h2 id="ai-tools-title" className="text-base font-semibold">AI 工具与本地 MCP</h2>
          <button className={buttonClass} disabled={!!busy || !api} onClick={() => void act('正在刷新…', '刷新失败，请稍后重试。', async () => { applyStatus(await api.aiToolsStatus()) })}>刷新状态</button>
        </div>
        <p className={`text-xs leading-relaxed ${theme.textSecondary}`}>把豆角的截图、离线文字识别与 Markdown 工具交给支持 MCP 的 AI 客户端调用。此版本提供工具与图片转文档流程，尚未内置聊天模型。</p>
        <p className={muted}>服务只监听本机 127.0.0.1。连接云端 AI 时，所调用工具的结果可能交给该模型处理，请自行选择分享内容。</p>
      </div>

      {error && <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-500">{error}</p>}
      {busy && <p role="status" className={`text-xs ${theme.textSecondary}`}>{busy}</p>}
      {notice && <p role="status" className={`text-xs ${theme.textSecondary}`}>{notice}</p>}
      {!status ? <p className={muted}>{api ? '正在读取工具状态…' : '请在豆角桌面应用中使用 AI 工具。'}</p> : <>
        <div className={section}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" className="accent-emerald-500" checked={status.enabled} disabled={!!busy} onChange={event => {
                const value = event.target.checked
                setConnection('')
                void act(value ? '正在启动服务…' : '正在停止服务…', '服务设置失败，请检查下方状态后重试。', async () => {
                  applyStatus(await api.aiToolsSetEnabled(value))
                  if (!value) setArtifact(null)
                })
              }} />启用本地 MCP 服务
            </label>
            <span className={`text-xs rounded-full px-2.5 py-1 ${status.running ? 'bg-emerald-500/10 text-emerald-500' : theme.subcardBg}`}>{status.running ? '运行中' : status.error ? '服务异常' : status.enabled ? '已启用 · 未运行' : '已关闭'}</span>
          </div>
          {status.error && <p className="text-xs text-red-500">{status.error}</p>}
          {status.running && status.url && <p className={`text-xs font-mono break-all ${theme.textSecondary}`}>{status.url}</p>}
          <p className={muted}>默认关闭。开启后复制地址与 Bearer 凭据到客户端；端口以当前地址为准。本机工作流无需开启 MCP。</p>
          <div className="flex flex-wrap gap-2">
            <button className={buttonClass} disabled={!status.running || !!busy} onClick={() => void connectionConfig(true)}>复制连接配置</button>
            <button className={buttonClass} disabled={!status.running || !!busy} onClick={() => connection ? setConnection('') : void connectionConfig(false)}>{connection ? '隐藏连接配置' : '显示连接配置'}</button>
            <button className={buttonClass} disabled={!status.running || !!busy} onClick={() => {
              setConnection('')
              void act('正在轮换凭据…', '凭据轮换失败，请检查服务状态后重试。', async () => { applyStatus(await api.aiToolsRotateToken()); setNotice('凭据已轮换，请重新复制配置并更新客户端。') })
            }}>轮换凭据</button>
          </div>
          {connection && <div className="space-y-2"><p className={muted}>此配置包含访问凭据。不要发布或发给他人；轮换后旧凭据失效。</p><textarea aria-label="连接配置（含凭据）" readOnly rows={9} className={`${inputClass} font-mono text-xs`} value={connection} /></div>}
        </div>

        <div className={section}>
          <h3 className="text-sm font-medium">允许调用的工具</h3>
          <p className={muted}>工具开关对本机工作流和外部 AI 同时生效。所属插件须已安装并启用；插件不可用时，勾选也无法启用工具。</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {status.tools.map(tool => <label key={tool.name} className={`flex gap-3 items-start rounded-lg p-3 ${theme.subcardBg}`}>
              <input type="checkbox" className="accent-emerald-500 mt-1" aria-label={tool.title} checked={tool.enabled} disabled={!!busy} onChange={event => {
                const value = event.target.checked
                void act('正在更新工具…', '工具开关更新失败，请确认所属插件可用。', async () => { applyStatus(await api.aiToolsSetToolEnabled(tool.name, value)) })
              }} />
              <span className="min-w-0 space-y-1"><span className="block text-xs font-medium">{tool.title}</span><span className={`block font-mono break-all ${muted}`}>{tool.name}</span><span className={`block ${muted}`}>{tool.pluginId} · {tool.requiresApproval ? '外部调用需确认' : '外部调用无需逐次确认'}</span></span>
            </label>)}
          </div>
        </div>

        <div className={section}>
          <h3 className="text-sm font-medium">图片 / 截图 → Markdown</h3>
          <div className={`p-3 rounded-lg space-y-2 ${theme.subcardBg}`}>
            <div className="flex flex-wrap items-center justify-between gap-2"><span className={`text-xs ${theme.textSecondary}`}>离线 OCR 模型：{status.ocrReady ? '已就绪（中文 / 英文）' : '尚未准备'}</span><button className={buttonClass} disabled={!!busy || status.ocrReady} onClick={() => void act('正在准备模型…', '模型准备失败，请检查网络后重试。', async () => { applyStatus(await api.aiToolsPrepareOcr()); setNotice('离线 OCR 模型已准备完成') })}>{busy === '正在准备模型…' ? busy : '准备离线 OCR 模型'}</button></div>
            <p className={muted}>首次需主动下载中文和英文模型，可能需要一些时间和网络流量。准备完成后，文字识别使用本地模型，无需 AI 密钥。</p>
          </div>
          <div className="space-y-2"><div className="flex flex-wrap gap-2 items-center"><button className={buttonClass} disabled={!!busy} onClick={() => void act('正在选择目录…', '目录选择失败，请重试。', async () => {
            const next = await api.aiToolsSelectDirectory(); applyStatus(next); setNotice(next.canceled ? '已取消选择目录' : '输出目录已更新')
          })}>选择输出目录</button><span className={`break-all min-w-0 text-xs ${theme.textSecondary}`}>{status.outputDirectory || '尚未选择输出目录'}</span></div><p className={muted}>这是 AI 工具的 Markdown 输出目录，独立于编辑器工作目录。保存只新建文件，不覆盖现有文件。</p></div>
          <div className="flex flex-wrap gap-2">
            <button className={buttonClass} disabled={!!busy || !canRecognize || !enabled('image_import')} onClick={() => void selectImage('image_import')}>导入图片</button>
            <button className={buttonClass} disabled={!!busy || !canRecognize || !enabled('screen_capture')} onClick={() => void selectImage('screen_capture')}>区域截图</button>
            <button className={buttonClass} disabled={!!busy || !canRecognize || !artifact} onClick={() => void act('正在识别文字…', '识别失败，请确认模型、工具及图片可用后重试。', async () => {
              const result = await api.aiToolsExecute('ocr_recognize', { artifactId: artifact, language })
              if (typeof result.text !== 'string') throw new Error()
              setContent(result.text); setRecognized(true); setNotice('识别完成，请检查并编辑内容后保存。')
            })}>识别文字</button>
          </div>
          <p className={muted}>{artifact ? '当前图片已选择，可识别或重新选择。图片仅在当前应用会话保留。' : '先准备模型并启用相关工具，再导入图片或选择截图区域。选择界面可以取消。'}</p>
          <label className={`block space-y-1 text-xs ${theme.textSecondary}`}><span>识别语言</span><select className={inputClass} aria-label="识别语言" value={language} disabled={!!busy} onChange={event => setLanguage(event.target.value as Language)}><option value="eng+chi_sim">中文 + 英文</option><option value="chi_sim">中文</option><option value="eng">英文</option></select></label>
          <label className={`block space-y-1 text-xs ${theme.textSecondary}`}><span>Markdown 内容</span><textarea className={inputClass} aria-label="Markdown 内容" placeholder="识别结果会显示在这里，保存前可以编辑。" rows={7} disabled={!!busy || !recognized} value={content} onChange={event => setContent(event.target.value)} /></label>
          <label className={`block space-y-1 text-xs ${theme.textSecondary}`}><span>文件名</span><input className={inputClass} aria-label="文件名" value={filename} maxLength={240} disabled={!!busy} onChange={event => setFilename(event.target.value)} /></label>
          <p className={muted}>使用相对 .md 文件名，如 note.md；已有子目录可用 folder/note.md。内容上限 1 MiB，保存失败后可修改文件名或内容重试。</p>
          <button className={`${buttonClass} ${canSave ? 'ring-1 ring-emerald-500/50' : ''}`} disabled={!canSave} onClick={() => void act('正在保存…', '保存失败，请检查文件名、目录、大小或是否已存在同名文件。', async () => {
            const result = await api.aiToolsExecute('markdown_create', { path: filename, content })
            if (result.created !== true || typeof result.path !== 'string') throw new Error()
            setNotice(`已保存：${result.path}`)
          })}>保存 Markdown</button>
        </div>

        <div className={section}>
          <div className="flex flex-wrap justify-between items-center gap-2"><h3 className="text-sm font-medium">调用记录 <span className={muted}>（{status.calls.length} / 200）</span></h3><button className={buttonClass} disabled={!!busy || !status.calls.length} onClick={() => void act('正在清空记录…', '清空记录失败，请重试。', async () => { applyStatus(await api.aiToolsClearCalls()) })}>清空记录</button></div>
          <p className={muted}>只保留工具、来源、结果与时间等信息，不记录图片、正文或凭据。状态每 3 秒刷新。</p>
          {!status.calls.length ? <p className={muted}>暂无调用记录</p> : <ul className="max-h-60 overflow-y-auto space-y-2" aria-label="调用记录">
            {status.calls.slice().reverse().map(call => <li key={call.id} className={`p-3 rounded-lg text-xs space-y-1 ${theme.subcardBg}`}><div className="flex flex-wrap justify-between gap-2"><span className="font-mono break-all">{call.toolName}</span><span>{callStates[call.status]}</span></div><div className={`flex flex-wrap gap-x-3 gap-y-1 ${theme.textMuted}`}><span>{call.source === 'mcp' ? '外部 MCP' : '本机工作流'}</span><span className="break-all">{call.clientId}</span><time>{new Date(call.startedAt).toLocaleString()}</time>{call.finishedAt !== undefined && <span>{Math.max(0, call.finishedAt - call.startedAt)} ms</span>}</div>{call.error && <p className="text-red-500">{call.error}</p>}</li>)}
          </ul>}
        </div>
      </>}
    </section>
  )
}
