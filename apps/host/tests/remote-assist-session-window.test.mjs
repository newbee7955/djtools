import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const read = (relativeUrl) => readFile(new URL(relativeUrl, import.meta.url), 'utf8')
const readSessionWindow = async () => {
  const ts = await read('../src/main/container/remote-assist-session-window.ts')
  const runtime = await read('../src/main/container/remote-assist-session-runtime.js')
  return ts + '\n' + runtime
}

test('session window enforces strict sandbox and dedicated partition', async () => {
  const source = await readSessionWindow()
  assert.match(source, /partition:\s*['"]persist:remote-assist['"]/)
  assert.match(source, /backgroundThrottling:\s*false/)
  assert.match(source, /contextIsolation:\s*true/)
  assert.match(source, /sandbox:\s*true/)
  assert.match(source, /nodeIntegration:\s*false/)
})

test('display-media-controller scopes capture strictly to approved source ID', async () => {
  const source = await read('../src/main/services/remote-assist/display-media-controller.ts')
  assert.match(source, /setDisplayMediaRequestHandler/)
  assert.match(source, /videoRequested/)
  assert.match(source, /approvedSourceId/)
})

test('display-media-controller allows fullscreen in both permission handlers', async () => {
  const source = await read('../src/main/services/remote-assist/display-media-controller.ts')
  const requestIdx = source.indexOf('setPermissionRequestHandler')
  const checkIdx = source.indexOf('setPermissionCheckHandler')
  assert.ok(requestIdx !== -1, 'setPermissionRequestHandler should exist')
  assert.ok(checkIdx !== -1, 'setPermissionCheckHandler should exist')
  // 请求处理器中放行 fullscreen（否则全屏按钮静默失败），且仍放行屏幕捕获权限
  const requestBlock = source.slice(requestIdx, checkIdx)
  assert.match(requestBlock, /perm === 'fullscreen'/, 'request handler must allow fullscreen')
  assert.match(requestBlock, /perm === 'display-capture'/, 'request handler must still allow display-capture')
  assert.match(requestBlock, /perm === 'media'/, 'request handler must still allow media')
  assert.match(requestBlock, /callback\(false\)/, 'request handler must still deny other permissions')
  // 校验处理器中同样放行 fullscreen
  const checkBlock = source.slice(checkIdx, source.indexOf('setDisplayMediaRequestHandler'))
  assert.match(checkBlock, /perm === 'fullscreen'/, 'check handler must allow fullscreen')
  assert.match(checkBlock, /perm === 'display-capture'/, 'check handler must still allow display-capture')
  assert.match(checkBlock, /perm === 'media'/, 'check handler must still allow media')
})

test('preload entry exposes narrow remote assist session API', async () => {
  const source = await read('../src/preload/remote-assist-session.ts')
  assert.match(source, /contextBridge\.exposeInMainWorld\(['"]remoteAssistSession['"]/)
  assert.match(source, /sendSignal/)
  assert.match(source, /onSignal/)
  assert.match(source, /sendInput/)
  assert.match(source, /onInput/)
  assert.match(source, /setRemoteCursorHidden/)
  assert.match(source, /disconnect/)
})

test('electron.vite.config.ts includes remoteAssistSession preload entry', async () => {
  const source = await read('../electron.vite.config.ts')
  assert.match(source, /remoteAssistSession:\s*resolve\(['"]src\/preload\/remote-assist-session\.ts['"]\)/)
})

test('session window integrates DisplayMediaController and bidirectional WebRTC signaling', async () => {
  const source = await readSessionWindow()
  // 校验 DisplayMediaController 的实例化
  assert.match(source, /new DisplayMediaController\(['"]persist:remote-assist['"]\)/)
  // 校验监听 service.onWebRtcSignal 并转发给渲染进程
  assert.match(source, /service\.onWebRtcSignal/)
  // 校验转发渲染进程信令到 service.sendWebRtcSignal
  assert.match(source, /service\.sendWebRtcSignal/)
  // 校验 dom-ready 之前的信令缓冲机制
  assert.match(source, /flushPendingSignals/)
  assert.match(source, /pendingSignals/)
  // 校验连接成功状态同步
  assert.match(source, /service\.setConnected/)
  // 校验国内 STUN 节点加速
  assert.match(source, /stun\.miwifi\.com/)
  assert.match(source, /stun\.chat\.bilibili\.com/)
})

test('preload buffers early signals before onSignal listener is registered', async () => {
  const source = await read('../src/preload/remote-assist-session.ts')
  assert.match(source, /signalQueue/)
  assert.match(source, /setConnected/)
})

test('session window escapes and whitelists network-sourced fields against HTML/JS injection', async () => {
  const source = await readSessionWindow()
  // 引入白名单/转义助手
  assert.match(source, /normalizePermission/)
  assert.match(source, /isValidDeviceCode/)
  assert.match(source, /function escapeHtml/)
  // 会话配置整体 JSON.stringify 注入，permission 不会被裸拼进脚本
  assert.match(source, /const sessionConfigJson = JSON\.stringify\(/)
  assert.match(source, /window\.__RA_SESSION__=\$\{sessionConfigJson\}/)
  // 对端设备代码经 escapeHtml 处理
  assert.match(source, /escapeHtml\(safePeerDeviceCode\)/)
  // 不再存在裸拼接的旧写法
  assert.doesNotMatch(source, /const permission = '\$\{permission\}';/)
})

test('session window bounds screen capture and fails fast instead of hanging at handshake', async () => {
  const source = await readSessionWindow()
  // 捕获带超时与重试
  assert.match(source, /CAPTURE_TIMEOUT_MS/)
  assert.match(source, /CAPTURE_MAX_ATTEMPTS/)
  assert.match(source, /function withTimeout/)
  assert.match(source, /async function captureScreen/)
  // offer 到达时对捕获 Promise 做有界等待，而不是无条件 await
  assert.match(source, /withTimeout\(localStreamPromise/)
  // 握手信令处理失败时主动退出，避免永久 connecting
  assert.match(source, /disconnect\('handshake-error'\)/)
})

test('session window isolates IPC per window (sender guard + precise listener removal)', async () => {
  const source = await readSessionWindow()
  assert.match(source, /isFromThisWindow/)
  assert.match(source, /ipcMain\.removeListener\(channel, handler\)/)
  assert.doesNotMatch(source, /ipcMain\.removeAllListeners\('remote-assist:session:signal'\)/)
})

test('controller session window offers capture-quality profiles and contain-fit fullscreen', async () => {
  const source = await readSessionWindow()
  assert.match(source, /QUALITY_PROFILES/)
  assert.match(source, /applyQuality/)
  assert.match(source, /set-quality/)
  assert.match(source, /qualitySelect/)
  assert.match(source, /applyConstraints/)
  assert.match(source, /maxBitrate/)
  assert.match(source, /requestFullscreen/)
  assert.match(source, /object-fit: contain/)
})

test('session window implements a real fullscreen view with a permission-free fallback', async () => {
  const source = await readSessionWindow()
  // 进入全屏后隐藏页内标题栏与面板，只保留远端画面
  assert.match(source, /body\.fs-active \.titlebar/)
  assert.match(source, /fs-active/)
  // 无 fullscreen 权限时用 fixed 视口兜底铺满窗口
  assert.match(source, /pseudo-fs/)
  assert.match(source, /function fsActive\(\)/)
  assert.match(source, /function applyFsClass\(on\)/)
  // 仍保留既有全屏按钮 id 与提示
  assert.match(source, /id="fullscreenBtn"/)
  assert.match(source, /title="全屏显示 \(F11\)"/)
})

test('session window surfaces transfer-readiness and send failures in the UI', async () => {
  const source = await readSessionWindow()
  // 传输通道就绪态驱动按钮/聊天输入可用性
  assert.match(source, /function setTransferReady\(ready\)/)
  assert.match(source, /传输通道未建立/)
  assert.match(source, /传输通道已就绪/)
  // 发送失败经专用 IPC 通道回传并在窗口内展示
  assert.match(source, /remote-assist:transfer:error/)
  assert.match(source, /onError/)
})

test('generated session-window script is syntactically valid JavaScript', async () => {
  const ts = await read('../src/main/container/remote-assist-session-window.ts')
  const runtime = await read('../src/main/container/remote-assist-session-runtime.js')

  // 运行时脚本是独立 JS，必须能直接解析；禁止再塞进 HTML 模板字符串里被 \n \/ 插值弄坏
  assert.doesNotThrow(() => new Function(runtime), 'session runtime.js must be valid JavaScript')
  assert.match(ts, /sessionRuntime \+/, 'runtime must be concatenated, not template-interpolated')
  assert.doesNotMatch(ts, /\$\{sessionRuntime\}/)
  assert.match(ts, /window\.__RA_SESSION__/)
  assert.doesNotMatch(ts, /replace\(\/\^video\\\//, 'HTML template must not embed escaped-slash regex')
  assert.match(runtime, /function paintStatsBar\(/)
  assert.match(runtime, /识别链路中/)
})

test('session window wires the doujiao-data channel and transfer/chat panels', async () => {
  const source = await readSessionWindow()
  assert.match(source, /doujiao-data/)
  assert.match(source, /transferPanel/)
  assert.match(source, /chatPanel/)
  assert.match(source, /FrameTransport|createDataChannelTransport/)
})

test('view-only gate: session window blocks file/chat sends unless permission is control', async () => {
  const source = await readSessionWindow()

  // canSend 由 permission 推导
  assert.match(source, /const canSend = this\.options\.permission === 'control'/)

  // 发送类会话通道都在 canSend 闸门内直接 return（open-receive-folder 不设闸门）
  // 注：send-paths 通道为 Batch B 移除的死通道（无任何生产者），故不再断言其存在。
  const guardFor = (channel) => new RegExp(`bind\\('${channel}'[\\s\\S]*?if \\(!canSend\\)[\\s\\S]*?return`)
  assert.match(source, guardFor('remote-assist:transfer:request-send'), 'request-send must be gated by canSend')
  assert.match(source, guardFor('remote-assist:transfer:chat-from-window'), 'chat-from-window must be gated by canSend')
  const folderIdx = source.indexOf("bind('remote-assist:transfer:open-receive-folder'")
  assert.ok(folderIdx !== -1)
  assert.doesNotMatch(
    source.slice(folderIdx, folderIdx + 400),
    /if \(!canSend\)/,
    'open-receive-folder must stay available in view-only mode'
  )

  // attach 后把闸门下发给 TransferService
  assert.match(source, /setOutgoingAllowed\(canSend\)/)

  // 发送/聊天面板与按钮接线仅在 permission === 'control' 下生效
  assert.match(source, /id="transferPanel"[\s\S]{0,160}?isController && permission === 'control'/)
  assert.match(source, /id="chatPanel"[\s\S]{0,160}?isController && permission === 'control'/)
  assert.match(source, /if \(permission === 'control'\) \{[\s\S]*?sendFilesBtn[\s\S]*?chatInput/)
})

test('repeated transfer ready is idempotent and resets frame callbacks before re-attach', async () => {
  // 该模块依赖 Electron，无法在 node:test 下直接实例化，故用带明确锚点的源码断言。
  const source = await readSessionWindow()

  // 1) onFrame 仍返回 void（FrameTransport 导出接口不得改动）
  assert.match(source, /onFrame\(cb: \(bytes: Uint8Array\) => void\): void/)

  // 2) transport 必须存在清空回调表的路径（修复前不存在）
  assert.match(source, /resetFrameCallbacks\(\)\s*:\s*void\s*\{\s*this\.frameCallbacks\s*=\s*\[\]\s*\}/)

  // 3) ready 处理器必须对同一 sessionId 幂等（避免叠加第二个 TransferSession）
  const readyHandler = source.match(/bind\('remote-assist:transfer:ready',[\s\S]*?\n    \}\)/)
  assert.ok(readyHandler, 'bind remote-assist:transfer:ready handler should exist')
  const block = readyHandler[0]
  assert.match(block, /this\.transferAttachedSessionId === this\.options\.sessionId\) return/)

  // 4) 清空回调必须发生在 attach 新会话之前（否则丢帧 / 重复派发二选一）
  const resetIdx = block.indexOf('resetFrameCallbacks()')
  const attachIdx = block.indexOf('attach(transport')
  assert.ok(resetIdx !== -1, 'ready handler should call resetFrameCallbacks()')
  assert.ok(attachIdx !== -1, 'ready handler should call attach(transport, ...)')
  assert.ok(resetIdx < attachIdx, 'frame callbacks must be reset before attaching a new session')
})

test('Batch B: dead send-paths session channel is removed', async () => {
  const source = await readSessionWindow()
  // 没有任何生产者向该通道发送（会话 preload 走 request-send，插件桥走 plugin: 前缀），确认已移除
  assert.doesNotMatch(source, /remote-assist:transfer:send-paths/, 'dead send-paths channel must be gone')
})

test('Batch B: session window renders a persistent clipboard-sync indicator', async () => {
  const source = await readSessionWindow()

  // 初始状态取自 TransferService 的剪贴板策略（任一类型启用即视为同步中）
  assert.match(source, /getSettings\(\)\.policy\.clipboard/)
  assert.match(source, /clipboardEnabled/)
  assert.match(source, /const clipboardBadgeText = clipboardEnabled \? '剪贴板同步中' : '剪贴板同步关闭'/)
  // 控制端标题栏与受控端面板都渲染该徽标
  assert.match(source, /id="clipboardBadge"/)
  // 应用远端剪贴板时闪烁提示
  assert.match(source, /onClipboardApplied/)
  assert.match(source, /剪贴板已同步/)
  // 服务事件被转发到窗口
  assert.match(source, /remote-assist:transfer:clipboard-applied/)
})

test('控制端不显示本地十字光标，并启用低延迟采集/接收设置', async () => {
  const source = await readSessionWindow()

  // CSS 默认隐藏控制端系统光标；JS 再按「本地光标」开关改成 default/none
  assert.match(source, /cursor: \$\{permission === 'control' \? 'none' : 'default'\}/)
  assert.doesNotMatch(source, /cursor: \$\{permission === 'control' \? 'crosshair'/, '不得再使用十字光标')

  // 采集侧：本地光标开启时不把被控端光标合成进画面
  assert.match(source, /\? 'never' : 'always'/)
  assert.match(source, /set-remote-cursor/)
  assert.match(source, /applyRemoteCursorHidden/)
  assert.match(source, /frameRate: \{ ideal: (currentFps|60), max: (currentFps|60) \}/)
  assert.match(source, /contentHint = 'motion'/)
  assert.match(source, /degradationPreference = 'maintain-framerate'/)

  // 接收侧：压小抖动缓冲以降低延迟
  assert.match(source, /playoutDelayHint = 0/)
  assert.match(source, /jitterBufferTarget = 0/)

  // 默认画质档位改为 1080p（高清画质，被控端为 1080p 时即原生分辨率）
  assert.match(source, /let desiredQuality = '1080p'/)
  assert.match(source, /let controllerDesiredQuality = '1080p'/)
})

test('全屏时提供悬浮按钮，保证任何状态下都能退出全屏与断开连接', async () => {
  const source = await readSessionWindow()
  assert.match(source, /id="fsHud"/)
  assert.match(source, /id="fsHudExit"/)
  assert.match(source, /id="fsHudDisconnect"/)
  assert.match(source, /body\.fs-active \.fs-hud/)
  assert.match(source, /hudExit\.addEventListener/)
  assert.match(source, /hudDisconnect\.addEventListener/)
})

test('ICE 诊断：打印全部候选对、分组汇总，并按合法的 host↔srflx/prflx 组合判断直连', async () => {
  const source = await readSessionWindow()

  // 1) 候选对上限由 12 提升到 40（且旧上限已移除）
  assert.match(source, /slice\(0, 40\)/, '候选对打印上限应为 40')
  assert.doesNotMatch(source, /slice\(0, 12\)/, '旧的上限 12 应已移除')

  // 2) 按 本地类型↔远端类型 分组汇总
  assert.match(source, /汇总 /, '应有分组汇总行')

  // 3) RFC 8445 会把本地 srflx 对替换成其 host base，不能把 srflx↔srflx 当成必要条件
  assert.match(source, /keyPairLine\('host\\u2194srflx', 'host', 'srflx'\)/)
  assert.match(source, /keyPairLine\('host\\u2194prflx', 'host', 'prflx'\)/)
  assert.doesNotMatch(source, /keyPairLine\('srflx\\u2194srflx'/)

  // 4) 一行结论
  assert.match(source, /\[ICE诊断\] 结论:/, '应有 [ICE诊断] 结论 行')

  // 结论各分支文案齐全
  assert.match(source, /已建立直连（非中继）/)
  assert.match(source, /直连检查已有响应，但握手或提名未完成/)
  assert.match(source, /直连检查无响应（对端入站 UDP 可能被 NAT\/防火墙过滤）/)
  assert.match(source, /已交换公网映射，但未形成可检测的直连候选对/)
  assert.match(source, /仅中继可用（缺少可直连的候选组合）/)
})

test('ICE 诊断：记录候选者错误并在走中继/失败时打印明细', async () => {
  const source = await readSessionWindow()
  assert.match(source, /async function reportIceDiagnostics/)
  assert.match(source, /\[ICE诊断\]/)
  assert.match(source, /const iceErrors = \[\]/)
  assert.match(source, /pc\.onicecandidateerror/)
  assert.match(source, /iceErrors\.push/)
  assert.match(source, /' address=' \+ \(e\.address \|\| '\?'\) \+ ':' \+ \(e\.port \|\| '\?'\)/)
  // 走中继时触发一次
  assert.match(source, /isRelay && !iceDiagState\.reported/)
  // ICE 失败时也触发
  assert.match(source, /void reportIceDiagnostics\('ICE\/连接失败/)
  // 打印实际使用的 ICE 服务器列表
  assert.match(source, /console\.log\('\[ICE\] 使用的 ICE 服务器:'/)
})

test('远端画面铺满视口并按需留黑边（不再按原始尺寸居中显示）', async () => {
  const source = await readSessionWindow()

  // 精确定位 video CSS 规则，避免匹配到其它块
  const ruleStart = source.indexOf('    video {')
  assert.ok(ruleStart !== -1, 'video 规则应存在')
  const ruleEnd = source.indexOf('\n    }', ruleStart)
  const videoRule = source.slice(ruleStart, ruleEnd)

  // 放大铺满：显式宽高 100%，配合 contain 保持比例
  assert.match(videoRule, /width:\s*100%/, 'video 必须显式 width: 100%')
  assert.match(videoRule, /height:\s*100%/, 'video 必须显式 height: 100%')
  assert.match(videoRule, /object-fit:\s*contain/, 'video 必须 object-fit: contain')

  // 原有 max-width/max-height 会阻止放大，必须移除；cursor 规则保持原样
  assert.doesNotMatch(videoRule, /max-width:\s*100%/, 'video 规则不应再有 max-width: 100%')
  assert.doesNotMatch(videoRule, /max-height:\s*100%/, 'video 规则不应再有 max-height: 100%')
  assert.match(videoRule, /cursor:\s*\$\{permission === 'control' \? 'none' : 'default'\}/, 'cursor 规则必须保持')
})

test('画质切换提供即时与确认反馈，且 applyConstraints 带超时兜底', async () => {
  const source = await readSessionWindow()

  // 标题栏状态位
  assert.match(source, /id="qualityStatus"/, '应渲染 qualityStatus 状态位')

  // 档位标签映射与待确认/已应用状态
  assert.match(source, /const QUALITY_LABELS = \{/, '应定义 QUALITY_LABELS 标签映射')
  assert.match(source, /native: '原始'/)
  assert.match(source, /let pendingQuality = null;/)
  assert.match(source, /let appliedQuality = 'native';/)

  // 即时反馈与确认反馈文案
  assert.match(source, /切换中/, '应显示「切换中」即时反馈')
  assert.match(source, /已切换/, '应显示「已切换」确认反馈')
  assert.match(source, /切换超时/, '应显示「切换超时」')
  assert.match(source, /6000/, '切换超时应使用 6 秒计时')

  // 确认消息沿用控制消息通道
  assert.match(source, /action: 'quality-applied'/, '受控端应回执 quality-applied')
  assert.match(source, /data\.action === 'quality-applied'/, '控制端应处理 quality-applied')

  // applyConstraints 必须在 4 秒超时内竞速，避免采集重启把流程挂死
  assert.match(source, /Promise\.race\(/, 'applyConstraints 应以 Promise.race 包裹')
  assert.match(source, /4000/, 'applyConstraints 超时应为 4000ms')

  // 档位未变化时跳过重复应用
  assert.match(source, /profileId === appliedQuality/, '相同档位应跳过应用')
})

test('连接先用 STUN/host 直连，仅由控制端从 checking 计时并通过 ICE restart 回退 TURN', async () => {
  const source = await readSessionWindow()
  assert.match(source, /const directRtcConfig = \{[\s\S]*iceServers: directOnlyIceServers/)
  assert.match(source, /pc = new RTCPeerConnection\(directRtcConfig\)/)
  assert.match(source, /const DIRECT_ICE_TIMEOUT_MS = 5000/)
  assert.match(source, /pc\.iceConnectionState === 'checking'[\s\S]*scheduleRelayFallback\(\)/)
  assert.match(source, /if \(!isController \|\| iceMode !== 'auto'/)
  assert.match(source, /pc\.setConfiguration\(fullRtcConfig\)/)
  assert.match(source, /pc\.restartIce\(\)/)
  assert.match(source, /pc\.createOffer\(\{ iceRestart: true \}\)/)
  assert.match(source, /DOUJIAO_REMOTE_ICE_MODE/)
  assert.match(source, /iceMode === 'direct-only'/)
  assert.doesNotMatch(source, /pc = new RTCPeerConnection\(rtcConfig\)/)
  // 连接后 8 秒补打最终 ICE 状态（纯诊断，保留）
  assert.match(source, /iceDiagState\.settledScheduled/)
  assert.match(source, /连接后 8 秒最终 ICE 状态/)
})

test('direct-only 诊断模式从 checking 起保留 10 秒观测窗口且不启用 TURN', async () => {
  const source = await readSessionWindow()
  assert.match(source, /const DIRECT_ONLY_DIAGNOSTIC_MS = 10000/)
  assert.match(source, /iceMode === 'direct-only'[\s\S]*DIRECT_ONLY_DIAGNOSTIC_MS/)
  assert.match(source, /void reportIceDiagnostics\('direct-only 10 秒观测结果'\)/)
})

test('ICE restart 信令携带代次/阶段，隔离旧候选并显式交换 end-of-candidates', async () => {
  const source = await readSessionWindow()
  assert.match(source, /let iceGeneration = 0/)
  assert.match(source, /let icePhase = 'direct'/)
  assert.match(source, /let iceRestartInProgress = false/)
  assert.match(source, /const pendingCandidatesByGeneration = new Map\(\)/)
  assert.match(source, /iceGeneration: iceGeneration/)
  assert.match(source, /icePhase: icePhase/)
  assert.match(source, /candidate: null/)
  assert.match(source, /await pc\.addIceCandidate\(null\)/)
  assert.match(source, /incomingGeneration < iceGeneration/)
  assert.match(source, /incomingGeneration > iceGeneration/)
  assert.match(source, /flushCandidatesForGeneration\(iceGeneration\)/)
})

test('未携带 iceGeneration 的旧版对端信令归入当前代次，保持滚动升级兼容', async () => {
  const source = await readSessionWindow()
  assert.match(source, /function getSignalGeneration\(sig, fallbackGeneration\)/)
  assert.match(source, /const incomingGeneration = getSignalGeneration\(sig, iceGeneration\)/)
  assert.match(source, /return fallbackGeneration/)
})

test('TURN fallback avoids racing an already-connected pair and tolerates old failed events during restart', async () => {
  const source = await readSessionWindow()
  assert.match(source, /const alreadyConnected = pc\.iceConnectionState === 'connected'/)
  assert.match(source, /if \(alreadyConnected\) return/)
  assert.match(source, /if \(iceRestartInProgress\)[\s\S]*return/)
  assert.match(source, /ICE restart 失败/)
  assert.match(source, /disconnect\('ice-restart-failed'\)/)
})

test('ICE 诊断记录事件候选，并优先使用 transport.selectedCandidatePairId 识别真实链路', async () => {
  const source = await readSessionWindow()
  assert.match(source, /const observedLocalCandidates = new Map\(\)/)
  assert.match(source, /const observedRemoteCandidates = new Map\(\)/)
  assert.match(source, /recordObservedCandidate\(observedLocalCandidates, event\.candidate\)/)
  assert.match(source, /recordObservedCandidate\(observedRemoteCandidates, cand\)/)
  assert.match(source, /report\.type === 'transport' && report\.selectedCandidatePairId/)
  assert.match(source, /stats\.get\(selectedPairId\)/)
})

test('连接状态在选中候选对识别前不谎报直连', async () => {
  const source = await readSessionWindow()
  assert.match(source, /已连接 ● 正在识别链路/)
  assert.doesNotMatch(source, /已连接 ● WebRTC 直连就绪/)
})

test('ICE 诊断能直接指出"本机/对端未获得公网映射(srflx)"', async () => {
  const source = await readSessionWindow()
  assert.match(source, /本机是否有公网映射\(srflx\)/)
  assert.match(source, /对端是否有公网映射\(srflx\)/)
  assert.match(source, /本机未获得公网映射/)
  assert.match(source, /对端未获得公网映射/)
})

test('会话窗口强制硬件 H264 并设置低延迟编码参数', async () => {
  const source = await readSessionWindow()

  assert.match(source, /function preferHardwareH264\(/)
  assert.match(source, /RTCRtpSender\.getCapabilities\('video'\)/)
  assert.match(source, /RTCRtpReceiver\.getCapabilities/)
  assert.match(source, /VIDEO\/H264/)
  assert.match(source, /setCodecPreferences\(/)
  assert.match(source, /preferHardwareH264\(\)/)
  assert.match(source, /function preferH264InSdp\(/)
  assert.match(source, /preferH264InSdp\(/)

  assert.match(source, /function applyLowLatencyEncoding\(/)
  assert.match(source, /enc\.maxFramerate = .*60/)
  assert.match(source, /enc\.priority = 'high'/)
  assert.match(source, /enc\.networkPriority = 'high'/)

  assert.match(source, /startBitrateKbps/)
  assert.match(source, /function mungeLowLatencySdp\(/)
  assert.match(source, /x-google-start-bitrate/)
  assert.match(source, /x-google-min-bitrate/)
  assert.match(source, /mungeLowLatencySdp\(/)
})

test('受控端上报编码延迟，控制端状态栏展示编码/网络/接收拆分', async () => {
  const source = await readSessionWindow()

  assert.match(source, /action: 'media-stats'/)
  assert.match(source, /data\.action === 'media-stats'/)
  assert.match(source, /totalEncodeTime/)
  assert.match(source, /encoderImplementation/)
  assert.match(source, /qualityLimitationReason/)
  assert.match(source, /编码:/)
  assert.match(source, /网络:/)
  assert.match(source, /接收:/)
})

test('点击与滚轮走无序指针通道并保留可靠通道备份', async () => {
  const source = await readSessionWindow()

  assert.match(source, /function sendUrgentInput\(/)
  assert.match(source, /sendUrgentInput\(evt\)/)
  assert.match(source, /pointer-button/)
  assert.match(source, /type !== 'pointer-move'/)
  // 键盘仍走可靠通道，避免按键丢失
  assert.match(source, /function sendReliableInput\(/)
  assert.match(source, /type: 'key'[\s\S]*sendReliableInput\(evt\)/)
})

test('宿主启动关闭隐藏窗口节流，避免受控端采集被降速', async () => {
  const source = await read('../src/main/index.ts')
  assert.match(source, /disable-renderer-backgrounding/)
  assert.match(source, /disable-backgrounding-occluded-windows/)
  assert.match(source, /disable-background-timer-throttling/)
  assert.match(source, /ignore-gpu-blocklist/)
  assert.match(source, /CalculateNativeWinOcclusion/)
  assert.match(source, /disable-features['"],\s*['"]WebRtcHideLocalIpsWithMdns,CalculateNativeWinOcclusion['"]/)
})

test('wireDataChannel immediately notifies ready when channel is open and pickAndSendFiles auto-recovers', async () => {
  const runtime = await read('../src/main/container/remote-assist-session-runtime.js')
  const windowTs = await read('../src/main/container/remote-assist-session-window.ts')
  const indicatorTs = await read('../src/main/container/remote-control-indicator.ts')

  // 1) 运行时在 channel.readyState === 'open' 时必须调用 markReady（含 notifyReady）
  assert.match(runtime, /if\s*\(channel\.readyState === 'open'\)\s*\{\s*markReady\(\)/)
  assert.match(runtime, /const markReady = \(\) => \{\s*setTransferReady\(true\);\s*window\.remoteAssistSession\.transfer\.notifyReady\(\);/)

  // 2) onerror 不得无条件置未就绪（仅在 readyState !== 'open' 时置未就绪）
  assert.match(runtime, /channel\.onerror = \(err\) => \{\s*console\.warn\('[^']*',\s*err\);\s*if \(channel\.readyState !== 'open'\)\s*\{\s*markClosed\(\);/)

  // 3) 主进程 pickAndSendFiles 在 transferSession 未 attach 时必须自愈
  assert.match(windowTs, /if \(!this\.transferSession && this\.transferTransport\) \{/)
  assert.match(windowTs, /this\.transferTransport\.notifyReady\(\)/)
  assert.match(windowTs, /TransferService\.getInstance\(\)\.attach\(this\.transferTransport, this\.options\.sessionId\)/)

  // 4) 被控端桌面浮条在发送前检查 TransferService 会话就绪态
  assert.match(indicatorTs, /if \(!TransferService\.getInstance\(\)\.getSession\(\)\) \{/)
  assert.match(indicatorTs, /传输通道未建立（等待连接），暂时无法发送/)
})

test('会话窗口支持帧率 (FPS) 动态调节与持久化配置', async () => {
  const windowTs = await read('../src/main/container/remote-assist-session-window.ts')
  const runtime = await read('../src/main/container/remote-assist-session-runtime.js')

  // 1) 窗口标题栏包含帧率选择器与状态文本
  assert.match(windowTs, /<select id="fpsSelect"/)
  assert.match(windowTs, /<span id="fpsStatus"/)
  assert.match(windowTs, /preferredFps: this\.options\.service\.getPreferredFps\(\)/)
  assert.match(windowTs, /remote-assist:session:set-preferred-fps/)

  // 2) 运行时支持 set-fps 与 fps-applied DataChannel 控制信令
  assert.match(runtime, /action: 'set-fps'/)
  assert.match(runtime, /action: 'fps-applied'/)
  assert.match(runtime, /function applyFps\(/)
  assert.match(runtime, /function sendFps\(/)
  assert.match(runtime, /const fpsSelect = document\.getElementById\('fpsSelect'\)/)
})

