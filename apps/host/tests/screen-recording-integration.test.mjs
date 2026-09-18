import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (relativeUrl) => readFile(new URL(relativeUrl, import.meta.url), 'utf8')

test('the SDK exposes recording through the narrow screen.record capability', async () => {
  const sdk = await read('../../../packages/plugin-sdk/src/types.ts')

  assert.match(sdk, /\| 'screen\.record'/)
  assert.match(sdk, /export interface ScreenRecordingOptions/)
  assert.match(sdk, /startRecording\(options: ScreenRecordingOptions\)/)
  assert.match(sdk, /stopRecording\(\)/)
  assert.match(sdk, /cancelRecording\(\)/)
  assert.match(sdk, /getRecordingStatus\(\)/)
  assert.match(sdk, /getRecordingSupport\(\)/)
  assert.match(sdk, /openRecording\(localPath: string\)/)
  assert.match(sdk, /onRecordingEvent\(/)
})

test('the main-process bridge permission-checks every recording operation', async () => {
  const bridge = await read('../src/main/ipc/bridge.ts')

  assert.match(bridge, /checkScreenRecordingPermission/)
  assert.match(bridge, /p\.capability === 'screen\.record'/)
  for (const operation of ['start', 'stop', 'cancel', 'status', 'support', 'open', 'show-in-folder']) {
    assert.match(bridge, new RegExp(`plugin:screen-recording:${operation}`))
  }
  assert.match(bridge, /plugin:screen-recording:event/)
})

test('the preload exposes recording methods and removable event listeners', async () => {
  const preload = await read('../src/preload/plugin.ts')

  assert.match(preload, /startRecording:/)
  assert.match(preload, /plugin:screen-recording:start/)
  assert.match(preload, /stopRecording:/)
  assert.match(preload, /cancelRecording:/)
  assert.match(preload, /getRecordingStatus:/)
  assert.match(preload, /getRecordingSupport:/)
  assert.match(preload, /openRecording:/)
  assert.match(preload, /onRecordingEvent:/)
  assert.match(preload, /removeListener\('plugin:screen-recording:event'/)
})

test('the recording service owns FFmpeg lifecycle, clean stop, GIF conversion, and cleanup', async () => {
  const service = await read('../src/main/services/screen-recording-service.ts')

  assert.match(service, /class ScreenRecordingService/)
  assert.match(service, /ownerPluginId/)
  assert.match(service, /buildGdiGrabArgs/)
  assert.match(service, /stdin\?\.write\('q\\n'\)/)
  assert.match(service, /convertMedia/)
  assert.match(service, /unlinkSync/)
  assert.match(service, /public shutdown\(\)/)
})

test('app shutdown stops recording and the workspace uses a Recordings directory', async () => {
  const main = await read('../src/main/index.ts')
  const workspace = await read('../src/main/services/workspace-service.ts')

  assert.match(main, /ScreenRecordingService/)
  assert.match(main, /\.shutdown\(\)/)
  assert.match(workspace, /scope === 'screen-recorder'/)
  assert.match(workspace, /'Recordings'/)
})

test('recording lifecycle initializes, hides, and restores the host window', async () => {
  const main = await read('../src/main/index.ts')
  const service = await read('../src/main/services/screen-recording-service.ts')

  assert.match(main, /ScreenRecordingService\.getInstance\(\)\.init\(mainWindow\)/)
  assert.match(service, /windowGuard\.hideForRecording\(\)/)
  assert.match(service, /windowGuard\.restoreAfterRecording\(\)/)
  assert.match(service, /windowGuard\.clearWithoutRestore\(\)/)
})

test('automatic stop is only scheduled for an explicit duration limit', async () => {
  const service = await read('../src/main/services/screen-recording-service.ts')

  assert.match(service, /if \(options\.maxDurationSeconds !== undefined\)/)
})
