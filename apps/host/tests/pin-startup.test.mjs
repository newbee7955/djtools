import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const compile = async (path) => ts.transpileModule(
  await readFile(new URL(path, import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }
).outputText
const [mainCode, pinCode, pluginViewCode, preloadCode] = await Promise.all([
  compile('../src/main/index.ts'),
  compile('../src/main/container/pin-manager.ts'),
  compile('../src/main/container/plugin-view.ts'),
  compile('../src/preload/plugin.ts')
])
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='
const flush = () => new Promise((resolve) => setImmediate(resolve))

function harness() {
  const handlers = new Map(), shortcuts = new Map(), windows = [], shellLoads = [], intervals = new Set()
  let clipboardImage = null, readyTask, finishRuntime, quitting = false
  const runtimeStarted = new Promise((resolve) => { finishRuntime = resolve })
  class FakeWebContents extends EventEmitter {
    constructor(messages = []) { super(); this.messages = messages; this.destroyed = false }
    isDestroyed() { return this.destroyed }
    isLoading() { return false }
    loadURL() { return Promise.resolve() }
    executeJavaScript() { return Promise.resolve() }
    send(channel, ...args) {
      const snapshot = structuredClone(args)
      this.messages.push([channel, ...snapshot])
      this.emit('ipc-message', channel, ...snapshot)
    }
    close() { this.destroyed = true }
  }
  class FakeView {
    constructor() { this.webContents = new FakeWebContents() }
    setBounds() {}
  }
  class FakeWindow extends EventEmitter {
    static getAllWindows() { return windows.filter((win) => !win.destroyed) }
    constructor(options) {
      super()
      this.options = options
      this.destroyed = false
      this.messages = []
      this.webContents = new FakeWebContents(this.messages)
      this.contentView = { addChildView() {}, removeChildView() {} }
      windows.push(this)
    }
    isDestroyed() { return this.destroyed }
    loadFile() { shellLoads.push(new Set(handlers.keys())); return Promise.resolve() }
    loadURL(url) { this.url = url; return Promise.resolve() }
    setAlwaysOnTop() {}
    setVisibleOnAllWorkspaces() {}
    setOpacity(value) { this.opacity = value }
    setIgnoreMouseEvents(value) { this.ignoreMouse = value }
    show() {}
    hide() {}
    focus() {}
    getContentBounds() { return { x: 0, y: 0, width: 1240, height: 820 } }
    getPosition() { return [this.options.x, this.options.y] }
    getSize() { return [this.options.width, this.options.height] }
    close() {
      let prevented = false
      this.emit('close', { preventDefault() { prevented = true } })
      if (!prevented) { this.destroyed = true; this.emit('closed') }
    }
  }
  const app = new EventEmitter()
  Object.assign(app, {
    commandLine: { appendSwitch() {} },
    setName() {}, getAppPath: () => '/app', requestSingleInstanceLock: () => true,
    whenReady: () => ({ then: (callback) => { readyTask = Promise.resolve().then(callback); return readyTask } }),
    quit() {}
  })
  const image = (dataUrl) => ({
    isEmpty: () => !dataUrl, toDataURL: () => dataUrl, getSize: () => ({ width: 1, height: 1 })
  })
  const electron = {
    app, BrowserWindow: FakeWindow, WebContentsView: FakeView, Notification: {},
    ipcMain: { handle: (channel, handler) => {
      assert.equal(handlers.has(channel), false, 'Duplicate IPC handler: ' + channel)
      handlers.set(channel, handler)
    } },
    globalShortcut: { register: (key, callback) => { shortcuts.set(key, callback); return true }, unregister: (key) => shortcuts.delete(key) },
    clipboard: { readImage: () => image(clipboardImage), readBuffer: () => Buffer.alloc(0), readText: () => '', readHTML: () => '' },
    nativeImage: { createFromDataURL: image },
    screen: { getCursorScreenPoint: () => ({ x: 0, y: 0 }), getDisplayNearestPoint: () => ({ scaleFactor: 1, workArea: { x: 0, y: 0, width: 1920, height: 1080 } }) }
  }
  const singleton = (instance) => ({ getInstance: () => instance })
  const tray = { getTrayIconPath: () => '/icon.png', init() {}, destroy() {}, getIsQuitting: () => quitting, setQuitting: (value) => { quitting = value } }
  const noop = () => {}
  const modules = {
    electron,
    'electron-log': { default: { initialize() {}, functions: {} } },
    '@electron-toolkit/utils': { is: { dev: false } },
    './protocol': { registerPluginScheme: noop, registerPluginProtocol: noop },
    './security': { setupSecurityGuards: noop },
    '../security': { setupSecurityGuards: noop },
    './ipc/host-api': { registerHostIpc: noop },
    './ipc/bridge': { registerPluginIpcBridge: noop },
    './network/proxy-manager': { ProxyManager: singleton({ async init() {} }) },
    './tray': { AppTrayManager: singleton(tray) },
    './mcp/host-ipc': { registerAiToolsIpc: noop, startAiToolsRuntime: () => runtimeStarted, async stopAiToolsRuntime() {} },
    './services/screenshot-service': { ScreenshotService: singleton({ init() {}, unregisterGlobalShortcuts() {} }) },
    './services/screen-recording-service': { ScreenRecordingService: singleton({ init() {}, shutdown() {} }) },
    './services/remote-assist/remote-assist-service': { RemoteAssistService: singleton({ onEvent() {}, async disconnect() {} }) },
    './container/remote-control-indicator': { RemoteControlIndicator: singleton({ hide() {} }) },
    './container/remote-assist-session-window': { RemoteAssistSessionWindow: class {} },
    './services/app-update-service': { AppUpdateService: singleton({ startAutoCheck() {} }) }
  }
  const run = (code) => {
    const module = { exports: {} }
    vm.runInNewContext(code, {
      module, exports: module.exports, __dirname: '/app/main', Buffer,
      process: { platform: 'test', argv: [], env: {} },
      console: { log() {}, warn() {}, error() {} },
      setTimeout: () => 1, clearTimeout() {},
      setInterval: (callback) => { intervals.add(callback); return callback },
      clearInterval: (callback) => intervals.delete(callback),
      require: (name) => {
        if (name in modules) return modules[name]
        if (name === 'path' || name === 'child_process') return require(name)
        if (name === 'fs') return { existsSync: () => true }
        throw new Error('Unexpected dependency: ' + name)
      }
    })
    return module.exports
  }
  modules['./plugin-view'] = modules['./container/plugin-view'] = run(pluginViewCode)
  const container = modules['./container/plugin-view'].PluginViewContainerManager.getInstance()
  modules['./container/pin-manager'] = run(pinCode)
  run(mainCode)
  return {
    handlers, shortcuts, windows, shellLoads, intervals, app, container,
    async openPlugin(id) { await container.showPlugin(id); return container.getActivePluginView().view },
    setClipboard: (value) => { clipboardImage = value },
    invoke(channel, ...args) {
      const handler = handlers.get(channel)
      if (!handler) throw new Error("No handler registered for '" + channel + "'")
      return handler({}, ...args)
    },
    async completeStartup() { finishRuntime(); await readyTask },
    async quit() {
      // The first event waits for the AI runtime; app.quit() then emits before-quit again.
      for (let i = 0; i < 2; i++) {
        for (const listener of app.listeners('before-quit')) await listener({ preventDefault() {} })
      }
    }
  }
}

test('clipboard pin IPC is callable before the shell loads and while AI startup is pending', async () => {
  const h = harness()
  await flush()
  assert.equal(h.invoke('plugin:pin:from-clipboard'), null)
  assert.equal(h.shellLoads.length, 1)
  assert.ok(h.shellLoads[0].has('plugin:pin:from-clipboard'))
  assert.equal([...h.handlers.keys()].filter((channel) => channel.startsWith('plugin:pin:')).length, 14)
  h.setClipboard(png)
  const id = h.invoke('plugin:pin:from-clipboard')
  assert.match(id, /^pin_/)
  assert.equal(h.invoke('plugin:pin:get-data', id).dataUrl, png)
  assert.equal(h.invoke('plugin:pin:list').length, 1)
  assert.equal(h.invoke('plugin:pin:close', id), true)
  assert.equal(h.invoke('plugin:pin:list').length, 0)
  await h.completeStartup()
})

test('recreating the main window keeps IPC registered and binds pin notifications to the new window', async () => {
  const h = harness()
  await h.completeStartup()
  h.windows[0].destroyed = true
  h.windows[0].emit('closed')
  h.app.emit('activate')
  h.setClipboard(png)
  h.invoke('plugin:pin:from-clipboard')
  const newMain = h.windows[1]
  assert.equal(newMain.messages.at(-1)[0], 'plugin:pin:changed')
  assert.equal(newMain.messages.at(-1)[1].length, 1)
  assert.equal(h.shellLoads.length, 2)
})

test('pin shortcuts work after startup and quit releases shortcuts, pins and cursor tracking', async () => {
  const h = harness()
  await h.completeStartup()
  h.setClipboard(png)
  assert.equal(typeof h.shortcuts.get('Alt+F3'), 'function')
  h.shortcuts.get('Alt+F3')()
  const id = h.invoke('plugin:pin:list')[0].id
  h.invoke('plugin:pin:set-click-through', id, true)
  assert.equal(h.intervals.size, 1)
  h.shortcuts.get('CommandOrControl+Shift+T')()
  assert.equal(h.invoke('plugin:pin:get-data', id).clickThrough, false)
  h.invoke('plugin:pin:set-click-through', id, true)
  await h.quit()
  assert.equal(h.shortcuts.has('Alt+F3'), false)
  assert.equal(h.shortcuts.has('CommandOrControl+Shift+T'), false)
  assert.equal(h.invoke('plugin:pin:list').length, 0)
  assert.equal(h.intervals.size, 0)
})

test('pin opacity and closing deliver updated state to the embedded workbench', async () => {
  const h = harness()
  await h.completeStartup()
  const workbench = await h.openPlugin('screen-pin')
  h.setClipboard(png)
  const id = h.invoke('plugin:pin:from-clipboard')
  assert.equal(h.invoke('plugin:pin:set-opacity', id, 0.45), true)
  assert.equal(h.windows[1].opacity, 0.45)
  assert.equal(workbench.webContents.messages.at(-1)?.[1][0].opacity, 0.45)
  assert.equal(h.invoke('plugin:pin:close', id), true)
  assert.equal(h.windows[1].isDestroyed(), true)
  assert.equal(workbench.webContents.messages.at(-1)[1].length, 0)
})

test('hidden workbench stays synchronized without sending pin images to unrelated plugins', async () => {
  const h = harness()
  await h.completeStartup()
  const workbench = await h.openPlugin('screen-pin')
  h.setClipboard(png)
  const id = h.invoke('plugin:pin:from-clipboard')
  const other = await h.openPlugin('notepad')
  h.invoke('plugin:pin:set-opacity', id, 0.3)
  assert.equal(workbench.webContents.messages.at(-1)?.[1][0].opacity, 0.3)
  assert.equal(other.webContents.messages.length, 0)
  h.container.hideCurrentPlugin()
  h.invoke('plugin:pin:close-all')
  assert.equal(workbench.webContents.messages.at(-1)[1].length, 0)
  h.container.destroyPluginView('screen-pin')
  assert.doesNotThrow(() => h.invoke('plugin:pin:from-clipboard'))
})

test('workbench slider and close button update through the real preload and host handlers', {
  skip: !process.env.PIN_UI_PLAYWRIGHT
}, async () => {
  const { createServer } = await import('vite')
  const { chromium } = require(process.env.PIN_UI_PLAYWRIGHT)
  const pluginRoot = resolve(import.meta.dirname, '../../../plugins/screen-pin')
  const server = await createServer({
    configFile: false, root: pluginRoot, server: { host: '127.0.0.1', port: 0 },
    css: { postcss: { plugins: [require('tailwindcss')({ content: [resolve(pluginRoot, 'src/**/*.{ts,tsx}')] })] } },
    plugins: [{
      name: 'pin-ui-harness',
      resolveId(id) { if (id === '/pin-test-entry.jsx') return '\0pin-test-entry' },
      load(id) {
        if (id === '\0pin-test-entry') return [
          "import React from 'react'",
          "import { createRoot } from 'react-dom/client'",
          "import { PinWorkbenchView } from '/src/components/PinWorkbenchView.tsx'",
          "import '/src/index.css'",
          "createRoot(document.getElementById('root')).render(React.createElement(PinWorkbenchView))"
        ].join('\n')
      },
      configureServer(viteServer) {
        viteServer.middlewares.use('/pin-test.html', (_req, res) => {
          res.setHeader('Content-Type', 'text/html; charset=utf-8')
          res.end('<!doctype html><html><body><div id="root"></div><script type="module" src="/pin-test-entry.jsx"></script></body></html>')
        })
      }
    }]
  })
  let browser, unsubscribe
  const deliveries = []
  try {
    await server.listen()
    browser = await chromium.launch({ headless: true, executablePath: process.env.PIN_UI_CHROMIUM })
    const page = await browser.newPage({ viewport: { width: 1000, height: 850 } })
    page.setDefaultTimeout(4000)
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    const h = harness()
    await h.completeStartup()
    const workbench = await h.openPlugin('screen-pin')
    h.setClipboard(png)
    h.invoke('plugin:pin:from-clipboard')
    const ipcRenderer = new EventEmitter()
    ipcRenderer.invoke = async (channel, ...args) => h.invoke(channel, ...args)
    let sdk
    vm.runInNewContext(preloadCode, {
      exports: {}, window: { location: { hostname: 'screen-pin' } }, console,
      require: (name) => {
        assert.equal(name, 'electron')
        return { ipcRenderer, contextBridge: { exposeInMainWorld: (_name, value) => { sdk = value } } }
      }
    })
    workbench.webContents.on('ipc-message', (channel, ...args) => ipcRenderer.emit(channel, {}, ...args))
    unsubscribe = sdk.pin.onPinsChanged((pins) => {
      deliveries.push(page.evaluate((list) => {
        for (const callback of window.pinListeners) callback(list)
      }, pins))
    })
    await page.exposeFunction('pinSdkCall', (method, args) => sdk.pin[method](...args))
    await page.addInitScript((methods) => {
      window.pinListeners = new Set()
      window.doujiaoSDK = { pin: Object.fromEntries(methods.map((method) => [
        method, (...args) => window.pinSdkCall(method, args)
      ])) }
      window.doujiaoSDK.pin.onPinsChanged = (callback) => {
        window.pinListeners.add(callback)
        return () => window.pinListeners.delete(callback)
      }
    }, Object.keys(sdk.pin).filter((method) => method !== 'onPinsChanged'))
    await page.goto('http://127.0.0.1:' + server.httpServer.address().port + '/pin-test.html')
    await page.getByText('当前桌面置顶贴图 (1)', { exact: true }).waitFor()
    const slider = page.getByRole('slider')
    const bounds = await slider.boundingBox()
    await slider.click({ position: { x: bounds.width / 2, y: bounds.height / 2 } })
    await page.getByText('60%', { exact: true }).waitFor()
    assert.equal(await slider.inputValue(), '60')
    assert.equal(h.windows[1].opacity, 0.6)
    await page.getByRole('button', { name: '关闭', exact: true }).click()
    await page.getByText('当前桌面置顶贴图 (0)', { exact: true }).waitFor()
    await page.getByText('桌面当前没有活动的贴图浮窗', { exact: true }).waitFor()
    assert.equal(h.windows[1].isDestroyed(), true)
    assert.equal(h.invoke('plugin:pin:list').length, 0)
    await Promise.all(deliveries)
    assert.deepEqual(errors, [])
  } finally {
    unsubscribe?.()
    await browser?.close()
    await server.close()
  }
})
