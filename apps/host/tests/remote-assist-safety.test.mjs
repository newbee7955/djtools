import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { RemoteAssistService } from '../src/main/services/remote-assist/remote-assist-service.ts'

const read = (relativeUrl) => readFile(new URL(relativeUrl, import.meta.url), 'utf8')

test('every exit path calls release-all before clearing state', async () => {
  const operationLog = []
  const fakeInputHelper = {
    releaseAll: async () => {
      operationLog.push('release-all')
    },
    stop: async () => {
      operationLog.push('stop-helper')
    },
    send: () => {}
  }

  const service = new RemoteAssistService({
    inputHelper: fakeInputHelper
  })

  service.testSetState({
    sessionId: 's_exit_test',
    role: 'controlled',
    phase: 'connected',
    permission: 'control',
    peerDeviceCode: '123 456 789'
  })

  await service.disconnect('emergency-test')
  operationLog.push('state-idle')

  assert.deepEqual(operationLog, ['release-all', 'stop-helper', 'state-idle'])
  assert.equal(service.getState().phase, 'idle')
})

test('remote-control-indicator uses frameless always-on-top pill window', async () => {
  const source = await read('../src/main/container/remote-control-indicator.ts')
  assert.match(source, /alwaysOnTop:\s*true/)
  assert.match(source, /frame:\s*false/)
  assert.match(source, /skipTaskbar:\s*true/)
  assert.match(source, /transparent:\s*true/)
  assert.match(source, /正在被远程控制中/)
  assert.match(source, /断开/)
})

test('tray manager provides dynamic disconnect action when session is active', async () => {
  const source = await read('../src/main/tray.ts')
  assert.match(source, /断开当前远程协助/)
  assert.match(source, /updateRemoteAssistState/)
})

test('host main registers emergency shortcut Ctrl+Alt+Shift+Esc', async () => {
  const source = await read('../src/main/index.ts')
  assert.match(source, /CommandOrControl\+Alt\+Shift\+Esc/)
  assert.match(source, /emergency-shortcut/)
})

test('tray manager and host api provide auto-start toggle with silent background boot', async () => {
  const traySource = await read('../src/main/tray.ts')
  assert.match(traySource, /开机自动启动/)
  assert.match(traySource, /--hidden/)
  assert.match(traySource, /updateAutoStart/)

  const apiSource = await read('../src/main/ipc/host-api.ts')
  assert.match(apiSource, /host:app:get-auto-start/)
  assert.match(apiSource, /host:app:set-auto-start/)

  const preloadSource = await read('../src/preload/index.ts')
  assert.match(preloadSource, /getAutoStart/)
  assert.match(preloadSource, /setAutoStart/)
})

test('host main handles incoming-request with native notification and window wakeup', async () => {
  const indexSource = await read('../src/main/index.ts')
  assert.match(indexSource, /--hidden/)
  assert.match(indexSource, /incoming-request/)
  assert.match(indexSource, /Notification/)
  assert.match(indexSource, /收到远程协助请求/)
  assert.match(indexSource, /host:navigate/)
  assert.match(indexSource, /remote-assist/)

  const bridgeSource = await read('../src/main/ipc/bridge.ts')
  assert.match(bridgeSource, /pendingRequest/)
})

test('tray menu dynamically filters options based on plugin installation and enablement', async () => {
  const traySource = await read('../src/main/tray.ts')
  // 必须通过 isPluginAvailable 动态判断
  assert.match(traySource, /isPluginAvailable\('screen-pin'\)/)
  assert.match(traySource, /isPluginAvailable\('drop-shelf'\)/)

  const pmSource = await read('../src/main/plugins/plugin-manager.ts')
  assert.match(pmSource, /isPluginAvailable\(pluginId: string\)/)

  const hostApiSource = await read('../src/main/ipc/host-api.ts')
  // 插件安装、卸载、启用/禁用后必须触发 rebuildContextMenu
  assert.match(hostApiSource, /AppTrayManager\.getInstance\(\)\.rebuildContextMenu\(\)/)
})
