import assert from 'node:assert/strict'
import test from 'node:test'

const recordingWindowGuard = await import(
  '../src/main/services/recording-window-guard.ts'
).catch(() => ({}))
const { RecordingWindowGuard } = recordingWindowGuard

function createWindow({ visible = true, destroyed = false } = {}) {
  const calls = []
  return {
    calls,
    isDestroyed: () => destroyed,
    isVisible: () => visible,
    isMinimized: () => false,
    hide: () => {
      calls.push('hide')
      visible = false
    },
    show: () => {
      calls.push('show')
      visible = true
    },
    restore: () => calls.push('restore'),
    focus: () => calls.push('focus')
  }
}

test('hides a visible host window while recording and restores it once afterward', () => {
  assert.equal(typeof RecordingWindowGuard, 'function')
  const window = createWindow()
  const guard = new RecordingWindowGuard()

  guard.init(window)
  guard.hideForRecording()
  assert.deepEqual(window.calls, ['hide'])

  guard.restoreAfterRecording()
  assert.deepEqual(window.calls, ['hide', 'show', 'focus'])

  guard.restoreAfterRecording()
  assert.deepEqual(window.calls, ['hide', 'show', 'focus'])
})

test('does not reveal a host window that was already hidden before recording', () => {
  assert.equal(typeof RecordingWindowGuard, 'function')
  const window = createWindow({ visible: false })
  const guard = new RecordingWindowGuard()

  guard.init(window)
  guard.hideForRecording()
  guard.restoreAfterRecording()

  assert.deepEqual(window.calls, [])
})

test('does not restore a host window during application shutdown', () => {
  assert.equal(typeof RecordingWindowGuard, 'function')
  const window = createWindow()
  const guard = new RecordingWindowGuard()

  guard.init(window)
  guard.hideForRecording()
  guard.clearWithoutRestore()
  guard.restoreAfterRecording()

  assert.deepEqual(window.calls, ['hide'])
})
