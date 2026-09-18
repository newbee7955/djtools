import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  DoujiaoSDK,
  ScreenRecordingEvent,
  ScreenRecordingFormat,
  ScreenRecordingMode,
  ScreenRecordingResult,
  ScreenRecordingStatus,
  ScreenRecordingSupport
} from '@doujiao/plugin-sdk'

const sdk = window.doujiaoSDK as DoujiaoSDK | undefined

const phaseLabels: Record<ScreenRecordingStatus['phase'], string> = {
  idle: '准备就绪',
  selecting: '请选择录制区域',
  starting: '正在启动录制',
  recording: '正在录制',
  stopping: '正在保存视频',
  converting: '正在生成 GIF',
  completed: '录制完成',
  failed: '录制失败',
  canceled: '已取消'
}

function formatTime(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

function fileName(filePath?: string): string {
  return filePath?.split(/[\\/]/).pop() || ''
}

export default function App() {
  const [mode, setMode] = useState<ScreenRecordingMode>('region')
  const [format, setFormat] = useState<ScreenRecordingFormat>('mp4')
  const [fps, setFps] = useState(30)
  const [showCursor, setShowCursor] = useState(true)
  const [gifWidth, setGifWidth] = useState(960)
  const [maxDuration, setMaxDuration] = useState<number | ''>('')
  const [recordSystemAudio, setRecordSystemAudio] = useState(true)
  const [recordMicrophone, setRecordMicrophone] = useState(false)
  const [showToolbar, setShowToolbar] = useState(true)
  const [support, setSupport] = useState<ScreenRecordingSupport | null>(null)
  const [status, setStatus] = useState<ScreenRecordingStatus>({ active: false, phase: 'idle' })
  const [result, setResult] = useState<ScreenRecordingResult | null>(null)
  const [outputDirectory, setOutputDirectory] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const [supportLoading, setSupportLoading] = useState(false)
  const [, setClock] = useState(0)

  const refreshSupport = useCallback(async () => {
    if (!sdk?.screen) return null
    setSupportLoading(true)
    try {
      const nextSupport = await sdk.screen.getRecordingSupport()
      setSupport(nextSupport)
      return nextSupport
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法检测 FFmpeg 环境')
      return null
    } finally {
      setSupportLoading(false)
    }
  }, [])

  useEffect(() => {
    let alive = true
    const initialize = async () => {
      try {
        const [nextStatus, directory] = await Promise.all([
          sdk?.screen?.getRecordingStatus(),
          sdk?.workspace?.getDirectory()
        ])
        if (!alive) return
        if (nextStatus) setStatus(nextStatus)
        if (directory) setOutputDirectory(directory)
      } catch (cause) {
        if (alive) setError(cause instanceof Error ? cause.message : '无法读取录制环境')
      }
    }

    void initialize()
    void refreshSupport()
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void refreshSupport()
    }
    const refreshWhenFocused = () => void refreshSupport()
    window.addEventListener('focus', refreshWhenFocused)
    document.addEventListener('visibilitychange', refreshWhenVisible)
    const unsubscribe = sdk?.screen?.onRecordingEvent((event: ScreenRecordingEvent) => {
      if (!alive) return
      setStatus(event)
      if (event.outputPath) {
        setResult({
          success: event.phase === 'completed',
          recordingId: event.recordingId,
          format: event.format,
          outputPath: event.outputPath,
          durationMs: event.elapsedMs,
          error: event.error
        })
      }
      if (event.error) setError(event.error)
    })
    return () => {
      alive = false
      window.removeEventListener('focus', refreshWhenFocused)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
      unsubscribe?.()
    }
  }, [refreshSupport])

  useEffect(() => {
    if (!status.active || !status.startedAt) return
    const timer = window.setInterval(() => setClock(Date.now()), 250)
    return () => window.clearInterval(timer)
  }, [status.active, status.startedAt])

  const elapsedMs = status.startedAt ? Date.now() - status.startedAt : status.elapsedMs || 0
  const isBusy =
    pending || ['selecting', 'starting', 'recording', 'stopping', 'converting'].includes(status.phase)
  const canStop = status.phase === 'recording'
  const canCancel = status.active && !['stopping', 'converting'].includes(status.phase)
  const durationLimit = format === 'gif' ? 60 : 3600
  const fpsOptions = format === 'gif' ? [10, 15, 20, 24, 30] : [15, 24, 30, 60]

  useEffect(() => {
    if (!fpsOptions.includes(fps)) setFps(format === 'gif' ? 15 : 30)
    if (maxDuration !== '' && maxDuration > durationLimit) setMaxDuration(durationLimit)
  }, [durationLimit, format, fps, fpsOptions, maxDuration])

  const statusTone = useMemo(() => {
    if (status.phase === 'recording') return 'live'
    if (status.phase === 'failed') return 'danger'
    if (status.phase === 'completed') return 'success'
    return 'neutral'
  }, [status.phase])

  const startRecording = async () => {
    if (!sdk?.screen) return
    setPending(true)
    setError('')
    setResult(null)
    try {
      const latestSupport = await refreshSupport()
      if (!latestSupport?.supported) {
        throw new Error(latestSupport?.reason || '当前未检测到可用的 FFmpeg 组件')
      }
      const nextStatus = await sdk.screen.startRecording({
        mode,
        format,
        fps,
        showCursor,
        gifWidth,
        maxDurationSeconds: maxDuration === '' ? undefined : maxDuration,
        recordSystemAudio: format === 'mp4' ? recordSystemAudio : false,
        recordMicrophone: format === 'mp4' ? recordMicrophone : false,
        showToolbar
      })
      setStatus(nextStatus)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '启动录制失败')
    } finally {
      setPending(false)
    }
  }

  const stopRecording = async () => {
    if (!sdk?.screen) return
    setPending(true)
    setError('')
    try {
      const nextResult = await sdk.screen.stopRecording()
      setResult(nextResult)
      setStatus({
        active: false,
        phase: nextResult.success ? 'completed' : 'failed',
        recordingId: nextResult.recordingId,
        format: nextResult.format,
        outputPath: nextResult.outputPath,
        elapsedMs: nextResult.durationMs,
        error: nextResult.error
      })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '停止录制失败')
    } finally {
      setPending(false)
    }
  }

  const cancelRecording = async () => {
    setPending(true)
    setError('')
    try {
      await sdk?.screen?.cancelRecording()
      setStatus({ active: false, phase: 'canceled' })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '取消录制失败')
    } finally {
      setPending(false)
    }
  }

  const chooseDirectory = async () => {
    if (!sdk?.workspace) return
    const selected = await sdk.workspace.selectDirectory(outputDirectory)
    if (selected.canceled || !selected.directoryPath) return
    const directory = await sdk.workspace.setDirectory(selected.directoryPath)
    setOutputDirectory(directory)
  }

  return (
    <main className="app-shell">
      <header className="hero">
        <div className="brand-mark" aria-hidden="true"><span /></div>
        <div>
          <p className="eyebrow">CAPTURE STUDIO</p>
          <h1>屏幕录制 <span>/</span> GIF</h1>
          <p className="subtitle">捕捉操作过程，快速生成可分享的视频或动图</p>
        </div>
        <button
          type="button"
          className={`support-chip ${support?.supported ? 'ready' : 'blocked'}`}
          onClick={() => void refreshSupport()}
          disabled={supportLoading}
          title="重新检测 FFmpeg"
        >
          <i />
          {supportLoading || support === null
            ? '正在检测环境'
            : support.supported
              ? `FFmpeg 已就绪${support.ffmpegVersion ? ` · ${support.ffmpegVersion}` : ''}`
              : `${support.reason || '当前不可用'} · 重新检测`}
        </button>
      </header>

      <section className="workspace-grid">
        <div className="control-panel">
          <section className="setting-block">
            <div className="section-heading"><span>01</span><h2>录制范围</h2></div>
            <div className="choice-grid two">
              <button className={`choice-card ${mode === 'region' ? 'selected' : ''}`} disabled={isBusy} onClick={() => setMode('region')}>
                <b className="choice-icon crop">⌗</b><strong>区域录制</strong><small>拖拽选取屏幕范围</small>
              </button>
              <button className={`choice-card ${mode === 'display' ? 'selected' : ''}`} disabled={isBusy} onClick={() => setMode('display')}>
                <b className="choice-icon">▣</b><strong>当前屏幕</strong><small>录制鼠标所在显示器</small>
              </button>
            </div>
          </section>

          <section className="setting-block">
            <div className="section-heading"><span>02</span><h2>输出格式</h2></div>
            <div className="choice-grid two format-grid">
              <button className={`choice-card ${format === 'mp4' ? 'selected' : ''}`} disabled={isBusy} onClick={() => setFormat('mp4')}>
                <b className="format-badge">MP4</b><strong>高清录屏</strong><small>适合长时间记录</small>
              </button>
              <button className={`choice-card ${format === 'gif' ? 'selected' : ''}`} disabled={isBusy} onClick={() => setFormat('gif')}>
                <b className="format-badge warm">GIF</b><strong>轻量动图</strong><small>适合短时分享</small>
              </button>
            </div>
          </section>

          <section className="setting-block">
            <div className="section-heading"><span>03</span><h2>音频录制</h2></div>
            {format === 'gif' ? (
              <div className="audio-disabled-notice">
                <span>ℹ</span>
                <p><strong>GIF 动图不支持音频</strong><small>切换至 MP4 格式即可录制系统声音和麦克风</small></p>
              </div>
            ) : (
              <div className="choice-grid two">
                <button
                  type="button"
                  className={`choice-card ${recordSystemAudio ? 'selected' : ''}`}
                  disabled={isBusy}
                  onClick={() => setRecordSystemAudio(!recordSystemAudio)}
                >
                  <b className="choice-icon">🔊</b>
                  <strong>系统声音</strong>
                  <small>{recordSystemAudio ? '已开启 · 录制电脑扬声器声音' : '已关闭 · 不录电脑声音'}</small>
                </button>
                <button
                  type="button"
                  className={`choice-card ${recordMicrophone ? 'selected' : ''}`}
                  disabled={isBusy}
                  onClick={() => setRecordMicrophone(!recordMicrophone)}
                >
                  <b className="choice-icon">🎙</b>
                  <strong>麦克风</strong>
                  <small>{recordMicrophone ? '已开启 · 录入人声解说' : '已关闭 · 麦克风静音'}</small>
                </button>
              </div>
            )}
          </section>

          <section className="setting-block compact">
            <div className="section-heading"><span>04</span><h2>录制参数</h2></div>
            <div className="form-row">
              <label>帧率<select value={fps} disabled={isBusy} onChange={(event) => setFps(Number(event.target.value))}>{fpsOptions.map((value) => <option key={value} value={value}>{value} FPS</option>)}</select></label>
              <label>时长上限<div className="number-field"><input type="number" min="1" max={durationLimit} value={maxDuration} placeholder="不限" disabled={isBusy} onChange={(event) => setMaxDuration(event.target.value === '' ? '' : Math.min(durationLimit, Math.max(1, Number(event.target.value))))} /><span>{maxDuration === '' ? '不限' : '秒'}</span></div></label>
              {format === 'gif' && <label>GIF 宽度<select value={gifWidth} disabled={isBusy} onChange={(event) => setGifWidth(Number(event.target.value))}><option value={640}>640 px</option><option value={960}>960 px</option><option value={1280}>1280 px</option><option value={1920}>1920 px</option></select></label>}
            </div>
            <label className="switch-row"><input type="checkbox" checked={showCursor} disabled={isBusy} onChange={(event) => setShowCursor(event.target.checked)} /><span className="switch" /><span><strong>显示鼠标指针</strong><small>在成片中保留操作轨迹</small></span></label>
            <label className="switch-row"><input type="checkbox" checked={showToolbar} disabled={isBusy} onChange={(event) => setShowToolbar(event.target.checked)} /><span className="switch" /><span><strong>悬浮操作栏与画笔</strong><small>录屏时在屏幕展示控制条、计时器及画笔批注工具</small></span></label>
          </section>

          <section className="output-row">
            <div><span className="folder-icon">⌑</span><p><small>保存到</small><strong title={outputDirectory}>{outputDirectory || '正在读取目录…'}</strong></p></div>
            <button disabled={isBusy} onClick={() => void chooseDirectory()}>更改目录</button>
          </section>
        </div>

        <aside className={`record-console ${statusTone}`}>
          <div className="console-visual">
            <div className="orbit one" /><div className="orbit two" />
            <div className="record-core"><span className={status.phase === 'recording' ? 'pulse' : ''} /></div>
          </div>
          <div className="phase-line"><i />{phaseLabels[status.phase]}</div>
          <div className="timer">{formatTime(elapsedMs)}</div>
          <p className="console-hint">
            {status.phase === 'recording'
              ? `${status.bounds?.width || 0} × ${status.bounds?.height || 0} · ${status.format?.toUpperCase()}${
                  format === 'mp4' && (recordSystemAudio || recordMicrophone)
                    ? ` · ${[recordSystemAudio ? '系统声音' : null, recordMicrophone ? '麦克风' : null].filter(Boolean).join('+')}`
                    : ''
                }`
              : status.phase === 'converting'
                ? `GIF 转换进度 ${Math.round(status.progress || 0)}%`
                : '开始后可随时停止并保存'}
          </p>

          {!status.active && !['stopping', 'converting'].includes(status.phase) ? (
            <button className="primary-action" disabled={pending || supportLoading} onClick={() => void startRecording()}><span>●</span>{mode === 'region' ? '选择区域并开始' : '开始录制当前屏幕'}</button>
          ) : (
            <div className="action-stack">
              <button className="stop-action" disabled={!canStop || pending} onClick={() => void stopRecording()}><span>■</span>停止并保存</button>
              <button className="ghost-action" disabled={!canCancel || pending} onClick={() => void cancelRecording()}>取消录制</button>
            </div>
          )}

          <div className="privacy-note"><span>◈</span><p><strong>本地安全处理</strong><small>画面与声音均在本地处理保存，不上传云端</small></p></div>
        </aside>
      </section>

      {(result?.outputPath || error) && (
        <section className={`result-bar ${error ? 'has-error' : ''}`}>
          <div className="result-icon">{error ? '!' : '✓'}</div>
          <div className="result-copy">
            <strong>{error ? '操作未完成' : '录制文件已保存'}</strong>
            <span title={result?.outputPath}>{error || fileName(result?.outputPath)}</span>
          </div>
          {!error && result?.outputPath && <div className="result-actions"><button onClick={() => void sdk?.screen?.openRecording(result.outputPath!)}>打开</button><button onClick={() => void sdk?.screen?.showRecordingInFolder?.(result.outputPath!)}>定位文件</button></div>}
          {error && <button className="dismiss" onClick={() => setError('')}>关闭</button>}
        </section>
      )}
    </main>
  )
}
