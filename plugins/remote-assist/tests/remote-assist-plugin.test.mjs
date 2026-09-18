import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (relativeUrl) => readFile(new URL(relativeUrl, import.meta.url), 'utf8')

test('manifest requests view and control remote desktop capabilities', async () => {
  const manifest = JSON.parse(await read('../manifest.json'))

  assert.equal(manifest.id, 'remote-assist')
  assert.deepEqual(
    manifest.permissions.map((p) => p.capability),
    ['remote.desktop.view', 'remote.desktop.control', 'remote.file.transfer', 'remote.clipboard.sync']
  )
})

test('remote-assist UI exposes device identity, request pairing, and consent workflow', async () => {
  const app = await read('../src/App.tsx')

  assert.match(app, /getDeviceInfo/)
  assert.match(app, /requestSession/)
  assert.match(app, /respondToSession/)
  assert.match(app, /disconnect/)
  assert.match(app, /onEvent/)
  assert.match(app, /允许协助/)
  assert.match(app, /远程协助他人/)
  assert.match(app, /安全码/)
  // 只保留固定安全码（连接口令）；动态「会话核对码」已移除
  assert.match(app, /固定安全码/)
  assert.doesNotMatch(app, /会话核对码/, '会话核对码 必须已移除')
  assert.match(app, /键鼠控制/)
  assert.match(app, /仅查看屏幕/)
})

test('remote-assist plugin styles support both dark and light modes', async () => {
  const css = await read('../src/index.css')

  assert.match(css, /\.assist-card/)
  assert.match(css, /\.device-code-box/)
  assert.match(css, /html\[data-theme="light"\]/)
})

test('manifest declares file transfer and clipboard sync capabilities', async () => {
  const manifest = JSON.parse(await read('../manifest.json'))
  const caps = manifest.permissions.map((p) => p.capability)
  assert.ok(caps.includes('remote.file.transfer'))
  assert.ok(caps.includes('remote.clipboard.sync'))
})

test('plugin UI exposes receive settings, clipboard toggles and transfer history', async () => {
  const app = await read('../src/App.tsx')
  assert.match(app, /是否允许接收文件/)
  assert.match(app, /剪贴板同步/)
  assert.match(app, /传输历史|传输记录/)
  assert.match(app, /sdk\.remoteAssist\.transfer/)
})

test('transfer policy handler rolls back the optimistic update when setPolicy fails', async () => {
  const app = await read('../src/App.tsx')

  // 基于最新值合成下一个策略，避免同一 tick 连续切换互相覆盖
  assert.match(app, /applyPolicy\(\(prev\)\s*=>/)
  assert.match(app, /const previous = transferPolicyRef\.current/)
  // catch 分支必须回滚到上一个策略，而不是只弹通知
  assert.match(app, /catch\s*\([\s\S]{0,400}?setTransferPolicy\(previous\)/)
})

test('chat input ignores Enter while the IME is composing', async () => {
  const app = await read('../src/App.tsx')

  assert.match(app, /isComposing/)
  assert.match(app, /keyCode\s*===\s*229/)
})

test('transfer status labels match the domain statuses and hide cancel on terminal rows', async () => {
  const app = await read('../src/App.tsx')

  // 标签映射必须覆盖域状态 active/done，而不是 UI 侧的 transferring/completed
  assert.match(app, /done:\s*'已完成'/)
  assert.match(app, /active:\s*'传输中'/)
  assert.doesNotMatch(app, /\bcompleted\b/)
  assert.doesNotMatch(app, /\btransferring\b/)

  // finished 必须基于真实终态集合（done/failed/rejected/cancelled）
  assert.match(app, /TRANSFER_TERMINAL_STATUSES/)
  assert.match(app, /TRANSFER_TERMINAL_STATUSES\.has\(item\.status\)/)
})

test('receive-files checkbox defaults to the host secure default (false)', async () => {
  const app = await read('../src/App.tsx')

  assert.match(app, /useState<TransferPolicy>\(\{[\s\S]{0,80}?receiveFiles:\s*false/)
})

test('plugin UI disables sending in a view-only (non-control) controller session', async () => {
  const app = await read('../src/App.tsx')

  // canSend 由 sessionStatus 派生：控制方且权限非 control 时禁止发送
  assert.match(app, /const canSend = !\(sessionStatus\?\.role === 'controller' && sessionStatus\.permission !== 'control'\)/)
  // 发送按钮与聊天入口据此禁用
  assert.match(app, /disabled=\{!sdk\?\.remoteAssist\?\.transfer \|\| !canSend \|\| !sessionStatus \|\| sessionStatus\.phase !== 'connected'\}/)
  assert.match(app, /disabled=\{!canSend\}/)
  // 明确提示
  assert.match(app, /仅查看会话下不可发送/)
})

test('send-file button is gated on an active connected session', async () => {
  const app = await read('../src/App.tsx')

  // 「发送文件」按钮只有在已连接会话中才可用
  const sendIdx = app.indexOf('📎 发送文件')
  assert.ok(sendIdx !== -1, 'send-file button should exist')
  const block = app.slice(Math.max(0, sendIdx - 600), sendIdx)
  assert.match(block, /disabled=\{[\s\S]*?phase !== 'connected'\}/)
  assert.match(block, /需在已连接且允许发送的协助会话中发送/)
})

test('Batch B: policy rollback is guarded by a monotonic sequence token', async () => {
  const app = await read('../src/App.tsx')

  // 每次 setPolicy 递增序号
  assert.match(app, /policySeqRef/)
  assert.match(app, /const seq = \(policySeqRef\.current \+= 1\)/)
  // 失败时只有仍是最新一次才回滚
  assert.match(app, /if \(seq !== policySeqRef\.current\) return/)
})

test('Batch B: on-mount getSettings does not clobber a user change made before it resolves', async () => {
  const app = await read('../src/App.tsx')

  assert.match(app, /policyTouchedRef/)
  // 用户改动时置位
  assert.match(app, /policyTouchedRef\.current = true/)
  // 拉取结果仅在用户未改动时应用
  assert.match(app, /settings\?\.policy && !policyTouchedRef\.current/)
})

test('Batch B: on-mount getSettings does not clobber a receive-dir edit made before it resolves', async () => {
  const app = await read('../src/App.tsx')

  assert.match(app, /receiveDirTouchedRef/)
  // 用户编辑接收目录输入时置位
  assert.match(app, /receiveDirTouchedRef\.current = true/)
  // 拉取到的接收目录仅在用户未编辑时应用
  assert.match(app, /typeof settings\?\.receiveDir === 'string' && !receiveDirTouchedRef\.current/)
})

test('Batch B: transfer history list is capped to the most recent entries', async () => {
  const app = await read('../src/App.tsx')

  assert.match(app, /TRANSFER_HISTORY_LIMIT\s*=\s*50/)
  assert.match(app, /next\.length > TRANSFER_HISTORY_LIMIT/)
})

test('Batch B: CapabilityType union includes the transfer and clipboard literals', async () => {
  const types = await read('../../../packages/plugin-sdk/src/types.ts')
  const union = types.match(/export type CapabilityType =([\s\S]*?);/)
  assert.ok(union, 'CapabilityType union should exist')
  assert.match(union[1], /'remote\.file\.transfer'/)
  assert.match(union[1], /'remote\.clipboard\.sync'/)
})
