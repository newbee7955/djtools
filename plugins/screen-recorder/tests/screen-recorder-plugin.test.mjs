import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (relativeUrl) => readFile(new URL(relativeUrl, import.meta.url), 'utf8')

test('manifest requests only recording and workspace capabilities', async () => {
  const manifest = JSON.parse(await read('../manifest.json'))

  assert.equal(manifest.id, 'screen-recorder')
  assert.deepEqual(
    manifest.permissions.map((permission) => permission.capability),
    ['screen.record', 'workspace']
  )
  assert.equal(manifest.requires['host.media.ffmpeg'], '>=6 <8')
})

test('screen recorder UI exposes the complete recording workflow', async () => {
  const app = await read('../src/App.tsx')

  for (const api of [
    'getRecordingSupport',
    'getRecordingStatus',
    'startRecording',
    'stopRecording',
    'cancelRecording',
    'openRecording',
    'showRecordingInFolder',
    'onRecordingEvent'
  ]) {
    assert.match(app, new RegExp(api))
  }
  assert.match(app, /selectDirectory/)
  assert.match(app, /setDirectory/)
  assert.match(app, /区域录制/)
  assert.match(app, /当前屏幕/)
  assert.match(app, /MP4/)
  assert.match(app, /系统声音/)
  assert.match(app, /麦克风/)
  assert.match(app, /悬浮操作栏与画笔/)
})

test('screen recorder passes audio and toolbar options to startRecording', async () => {
  const app = await read('../src/App.tsx')

  assert.match(app, /recordSystemAudio: format === 'mp4' \? recordSystemAudio : false/)
  assert.match(app, /recordMicrophone: format === 'mp4' \? recordMicrophone : false/)
  assert.match(app, /showToolbar/)
})

test('FFmpeg support is refreshed when returning from settings', async () => {
  const app = await read('../src/App.tsx')

  assert.match(app, /refreshSupport/)
  assert.match(app, /addEventListener\('focus'/)
  assert.match(app, /visibilitychange/)
  assert.match(app, /重新检测/)
})

test('custom recording components have an explicit light theme', async () => {
  const css = await read('../src/index.css')

  assert.match(css, /html\[data-theme="light"\] \.control-panel/)
  assert.match(css, /html\[data-theme="light"\] \.choice-card/)
  assert.match(css, /html\[data-theme="light"\] \.record-console/)
  assert.match(css, /html\[data-theme="light"\] \.primary-action/)
})

test('recording duration defaults to unlimited and only sends an explicit limit', async () => {
  const app = await read('../src/App.tsx')

  assert.match(app, /useState<number \| ''>\(''\)/)
  assert.match(app, /maxDurationSeconds: maxDuration === '' \? undefined : maxDuration/)
  assert.match(app, /placeholder="不限"/)
  assert.doesNotMatch(app, /最长 60 秒/)
})
