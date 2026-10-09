import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'
import { createServer } from 'vite'
import tailwindcss from 'tailwindcss'
const require = createRequire(import.meta.url)
const { chromium } = require('C:/Users/Admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const root = resolve(import.meta.dirname, '../../..')
const panel = resolve(root, 'apps/host/src/renderer/src/components/AiToolsPanel.tsx')
let server, browser, base
before(async () => {
  server = await createServer({ configFile: false, root, server: { host: '127.0.0.1', port: 0 }, css: { postcss: { plugins: [tailwindcss({ content: [resolve(root, 'apps/host/src/renderer/src/**/*.{tsx,css}')], theme: { extend: {} } })] } }, plugins: [{ name: 'ui-harness', resolveId(id) {
    if (id === '/ui-entry.tsx') return resolve(root, '.superpowers/sdd/ai-mcp/ui-entry.tsx')
    if (id === '/ui-panel.tsx') return existsSync(panel) ? panel : '\0ui-baseline'
  }, load(id) { if (id === '\0ui-baseline') return 'export default function Panel(){return null}' } }] })
  await server.listen(); base = `http://127.0.0.1:${server.httpServer.address().port}`
  browser = await chromium.launch({ headless: true, executablePath: process.env.AI_UI_CHROMIUM || 'C:/Users/Admin/AppData/Local/ms-playwright/chromium-1169/chrome-win/chrome.exe' })
})
after(async () => { await browser?.close(); await server?.close() })
async function open(options = {}, theme = 'light') {
  const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'], viewport: { width: 1000, height: 1050 } })
  await context.addInitScript(({ options }) => {
    const titles = ['选择区域截图', '选择图片', '离线识别图片文字', '列出 Markdown 文件', '读取 Markdown 文件', '新建 Markdown 文件']
    const names = ['screen_capture', 'image_import', 'ocr_recognize', 'markdown_list', 'markdown_read', 'markdown_create']
    const state = { enabled: false, running: false, outputDirectory: null, ocrReady: false, calls: [], tools: names.map((name, i) => ({ name, title: titles[i], description: titles[i], pluginId: i === 0 ? 'screen-pin' : i < 3 ? 'ocr-recognizer' : 'markdown-editor', enabled: true, requiresApproval: [0,1,5].includes(i), readOnly: ![0,5].includes(i), inputSchema: {} })), ...options }
    window.uiCalls = []; window.uiState = state
    const record = (method, ...args) => window.uiCalls.push({ method, args })
    window.hostAPI = {
      aiToolsStatus: async () => { record('status'); return structuredClone(state) },
      aiToolsSetEnabled: async enabled => { record('enabled', enabled); Object.assign(state, { enabled, running: enabled, url: enabled ? 'http://127.0.0.1:39123/mcp' : undefined }); return structuredClone(state) },
      aiToolsSetToolEnabled: async (name, enabled) => { record('toggle', name, enabled); state.tools.find(t => t.name === name).enabled = enabled; return structuredClone(state) },
      aiToolsSelectDirectory: async () => { record('directory'); if (options.cancelDirectory) return { ...structuredClone(state), canceled: true }; state.outputDirectory = 'D:\\AI Markdown'; return structuredClone(state) },
      aiToolsConnectionConfig: async () => { record('connection'); return { url: state.url, transport: 'streamable-http', headers: { Authorization: `Bearer ${state.rotated ? 'TEST_ROTATED_SECRET' : 'TEST_SECRET'}` } } },
      aiToolsRotateToken: async () => { record('rotate'); state.rotated = true; return structuredClone(state) },
      aiToolsPrepareOcr: async () => { record('prepare'); await new Promise(r => setTimeout(r, 80)); state.ocrReady = true; return structuredClone(state) },
      aiToolsExecute: async (name, args) => { record('execute', name, args); await new Promise(r => setTimeout(r, 40)); if (options.failTool === name) throw Error('private request text TEST_SECRET'); state.calls.unshift({ id: String(state.calls.length), toolName: name, clientId: 'host-ui', source: 'host', status: 'succeeded', startedAt: Date.now(), finishedAt: Date.now() }); if (name === 'image_import' || name === 'screen_capture') return options.cancelImage ? { canceled: true } : { artifactId: 'artifact-1', mimeType: 'image/png', size: 4096 }; if (name === 'ocr_recognize') return { text: '原始识别文字', language: args.language }; return { path: args.path, created: true } },
      aiToolsClearCalls: async () => { record('clear'); state.calls = []; return structuredClone(state) }
    }
    if (options.noHost) delete window.hostAPI
  }, { options })
  const page = await context.newPage(); page.setDefaultTimeout(2500); await page.goto(`${base}/.superpowers/sdd/ai-mcp/ui-harness.html?theme=${theme}`)
  return { page, context }
}
const button = (page, name) => page.getByRole('button', { name, exact: true })
async function check(locator, predicate, message) { await locator.waitFor({ state: 'attached', timeout: 2500 }); assert.ok(await predicate(locator), message) }
test('workflow respects model setup, directory and tool toggles while MCP stays off', async () => {
  const { page, context } = await open()
  try {
    await check(button(page, '导入图片'), l => l.isDisabled(), 'models required')
    await button(page, '准备离线 OCR 模型').click()
    await check(button(page, '正在准备模型…'), l => l.isDisabled(), 'setup busy')
    await button(page, '导入图片').waitFor(); await page.waitForFunction(() => window.uiState.ocrReady)
    await button(page, '导入图片').click(); await page.getByText('图片已就绪').waitFor()
    await button(page, '识别文字').click(); await page.getByLabel('Markdown 内容').waitFor()
    await check(button(page, '保存 Markdown'), l => l.isDisabled(), 'directory required')
    await button(page, '选择输出目录').click()
    await page.getByRole('checkbox', { name: '新建 Markdown 文件' }).uncheck()
    await check(button(page, '保存 Markdown'), l => l.isDisabled(), 'tool toggle enforced')
    assert.equal(await page.evaluate(() => window.uiState.enabled), false)
  } finally { await context.close() }
})
test('import OCR edit and save use exact public inputs and report saved path', async () => {
  const { page, context } = await open({ ocrReady: true, outputDirectory: 'D:\\AI Markdown' })
  try {
    await button(page, '导入图片').click(); await page.getByText('图片已就绪').waitFor()
    await page.getByLabel('识别语言').selectOption('eng')
    await button(page, '识别文字').click()
    await page.getByLabel('Markdown 内容').fill('# 人工修订\n内容')
    await page.getByLabel('文件名').fill('edited.md')
    await button(page, '保存 Markdown').click(); await page.getByText('已保存：edited.md', { exact: true }).waitFor()
    const calls = await page.evaluate(() => window.uiCalls.filter(c => c.method === 'execute'))
    assert.deepEqual(calls.map(c => c.args), [['image_import', {}], ['ocr_recognize', { artifactId: 'artifact-1', language: 'eng' }], ['markdown_create', { path: 'edited.md', content: '# 人工修订\n内容' }]])
    assert.equal(await page.getByLabel('Markdown 内容').inputValue(), '# 人工修订\n内容')
  } finally { await context.close() }
})
test('capture cancellation leaves editor intact and never runs OCR', async () => {
  const { page, context } = await open({ ocrReady: true, cancelImage: true, cancelDirectory: true })
  try {
    await button(page, '选择输出目录').click(); await page.getByText('已取消选择目录').waitFor()
    await button(page, '区域截图').click(); await page.getByText('已取消图片选择').waitFor()
    assert.equal(await page.evaluate(() => window.uiCalls.some(c => c.args[0] === 'ocr_recognize')), false)
    await check(button(page, '识别文字'), l => l.isDisabled(), 'no artifact after cancellation')
  } finally { await context.close() }
})
test('failed recognition shows safe error and supports retry without sensitive details', async () => {
  const { page, context } = await open({ ocrReady: true, failTool: 'ocr_recognize' })
  try {
    await button(page, '导入图片').click(); await page.getByText('图片已就绪').waitFor()
    await button(page, '识别文字').click(); await page.getByRole('alert').waitFor()
    assert.match(await page.getByRole('alert').innerText(), /识别失败/)
    assert.equal(await page.getByText('private request text TEST_SECRET', { exact: true }).count(), 0)
    await check(button(page, '识别文字'), l => l.isEnabled(), 'retry available')
  } finally { await context.close() }
})
test('connection credentials appear only on explicit reveal or copy and clear on rotate and stop', async () => {
  const { page, context } = await open()
  try {
    await page.getByRole('checkbox', { name: '启用本地 MCP 服务' }).check()
    await page.getByText('http://127.0.0.1:39123/mcp', { exact: true }).waitFor()
    assert.equal(await page.evaluate(() => window.uiCalls.filter(c => c.method === 'connection').length), 0)
    await button(page, '显示连接配置').click(); await page.getByLabel('连接配置（含凭据）').waitFor()
    assert.match(await page.getByLabel('连接配置（含凭据）').inputValue(), /Bearer TEST_SECRET/)
    await button(page, '复制连接配置').click(); assert.match(await page.evaluate(() => navigator.clipboard.readText()), /streamable-http/)
    await button(page, '轮换凭据').click(); await page.waitForFunction(() => window.uiState.rotated)
    assert.equal(await page.getByLabel('连接配置（含凭据）').count(), 0)
    await button(page, '显示连接配置').click(); assert.match(await page.getByLabel('连接配置（含凭据）').inputValue(), /TEST_ROTATED_SECRET/)
    await page.getByRole('checkbox', { name: '启用本地 MCP 服务' }).uncheck()
    await check(button(page, '显示连接配置'), l => l.isDisabled(), 'no stopped credentials')
    assert.equal(await page.getByLabel('连接配置（含凭据）').count(), 0)
  } finally { await context.close() }
})
test('metadata history refreshes and clears through host API', async () => {
  const { page, context } = await open({ calls: [{ id: 'call1', toolName: 'markdown_read', clientId: 'external-client', source: 'mcp', status: 'denied', startedAt: 1720000000000 }] })
  try {
    await page.getByText('external-client', { exact: true }).waitFor()
    await button(page, '刷新状态').click(); await button(page, '清空记录').click(); await page.getByText('暂无调用记录', { exact: true }).waitFor()
    assert.ok(await page.evaluate(() => window.uiCalls.some(c => c.method === 'clear')))
  } finally { await context.close() }
})
test('browser-only rendering explains unavailable desktop host API', async () => {
  const { page, context } = await open({ noHost: true })
  try {
    await page.getByText('请在豆角桌面应用中使用 AI 工具。', { exact: true }).waitFor()
    await check(button(page, '刷新状态'), l => l.isDisabled(), 'native API unavailable')
    assert.equal(await page.getByText('正在读取工具状态…', { exact: true }).count(), 0)
  } finally { await context.close() }
})
test('successful capture and failed save retain editable draft for retry', async () => {
  const { page, context } = await open({ ocrReady: true, outputDirectory: 'D:\\AI Markdown', failTool: 'markdown_create' })
  try {
    await button(page, '区域截图').click(); await page.getByText('图片已就绪').waitFor()
    await button(page, '识别文字').click(); await page.getByLabel('Markdown 内容').fill('保留草稿')
    await button(page, '保存 Markdown').click(); await page.getByRole('alert').waitFor()
    assert.match(await page.getByRole('alert').innerText(), /保存失败/)
    assert.equal(await page.getByLabel('Markdown 内容').inputValue(), '保留草稿')
    await check(button(page, '保存 Markdown'), l => l.isEnabled(), 'retry available')
    assert.deepEqual(await page.evaluate(() => window.uiCalls.filter(c => c.method === 'execute')[0].args), ['screen_capture', {}])
  } finally { await context.close() }
})
test('delayed background status cannot overwrite a completed enable operation', async () => {
  const { page, context } = await open()
  try {
    await page.getByRole('checkbox', { name: '启用本地 MCP 服务' }).waitFor()
    await page.evaluate(() => {
      const original = window.hostAPI.aiToolsStatus
      let held = false
      window.hostAPI.aiToolsStatus = async () => {
        const snapshot = await original()
        if (!held) { held = true; window.uiPendingStatus = true; await new Promise(r => { window.uiReleaseStatus = r }) }
        return snapshot
      }
    })
    await page.waitForFunction(() => window.uiPendingStatus, null, { timeout: 4500 })
    await page.getByRole('checkbox', { name: '启用本地 MCP 服务' }).check()
    await page.getByText('http://127.0.0.1:39123/mcp', { exact: true }).waitFor()
    await page.evaluate(async () => { window.uiReleaseStatus(); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))) })
    assert.equal(await page.getByRole('checkbox', { name: '启用本地 MCP 服务' }).isChecked(), true)
  } finally { await context.close() }
})
test('delayed failed background status cannot show stale error after completed enable', async () => {
  const { page, context } = await open()
  try {
    await page.getByRole('checkbox', { name: '启用本地 MCP 服务' }).waitFor()
    await page.evaluate(() => {
      const original = window.hostAPI.aiToolsStatus
      let held = false
      window.hostAPI.aiToolsStatus = async () => {
        if (!held) {
          held = true; window.uiPendingStatus = true
          await new Promise((_, reject) => { window.uiRejectStatus = () => reject(Error('deferred status failure')) })
        }
        return original()
      }
    })
    await page.waitForFunction(() => window.uiPendingStatus, null, { timeout: 4500 })
    await page.getByRole('checkbox', { name: '启用本地 MCP 服务' }).check()
    await page.getByText('http://127.0.0.1:39123/mcp', { exact: true }).waitFor()
    await check(button(page, '刷新状态'), l => l.isEnabled(), 'enable operation finished')
    await page.evaluate(async () => { window.uiRejectStatus(); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))) })
    assert.equal(await page.getByRole('checkbox', { name: '启用本地 MCP 服务' }).isChecked(), true)
    assert.equal(await page.getByRole('alert').count(), 0, 'old poll failure must not produce a stale error')
  } finally { await context.close() }
})
test('light dark and cyber panels fit narrow viewport with readable controls', async () => {
  const dir = resolve(root, '.superpowers/sdd/ai-mcp/ui-screenshots'); mkdirSync(dir, { recursive: true })
  for (const theme of ['light', 'dark', 'cyber']) {
    const { page, context } = await open({ ocrReady: true, outputDirectory: 'D:\\AI Markdown' }, theme)
    try {
      await page.getByRole('heading', { name: 'AI 工具与本地 MCP' }).waitFor({ timeout: 2500 })
      const contrast = await page.evaluate(() => {
        const explanation = [...document.querySelectorAll('p')].find(p => p.textContent.startsWith('服务只监听'))
        const rgb = value => value.match(/[\d.]+/g).map(Number)
        const color = rgb(getComputedStyle(explanation).color)
        const background = rgb(getComputedStyle(explanation.closest('section')).backgroundColor)
        const foreground = color.slice(0, 3).map((v, i) => v * (color[3] ?? 1) + background[i] * (1 - (color[3] ?? 1)))
        const lum = values => values.slice(0, 3).map(v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0)
        const a = lum(foreground), b = lum(background)
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
      })
      assert.ok(contrast >= 4.5, `${theme} explanation contrast ${contrast}`)
      await page.screenshot({ path: resolve(dir, `${theme}.png`), fullPage: true })
      await page.setViewportSize({ width: 430, height: 900 })
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
      await page.screenshot({ path: resolve(dir, `${theme}-narrow.png`), fullPage: true })
    } finally { await context.close() }
  }
})
