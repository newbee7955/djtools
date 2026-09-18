import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { EventEmitter } from 'node:events'
import { RemoteInputHelper } from '../src/main/services/remote-assist/remote-input-helper.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function createFakeChild() {
  const emitter = new EventEmitter()
  const messages = []
  let stdinClosed = false

  const child = {
    stdin: {
      write(chunk) {
        const lines = chunk.toString('utf8').split('\n').filter(Boolean)
        for (const line of lines) {
          try {
            messages.push(JSON.parse(line))
          } catch {}
        }
        return true
      },
      end() {
        stdinClosed = true
        emitter.emit('stdin-end')
      }
    },
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    kill() {
      emitter.emit('exit', 0, null)
    },
    on: emitter.on.bind(emitter),
    once: emitter.once.bind(emitter),
    removeListener: emitter.removeListener.bind(emitter),
    messages,
    get isStdinClosed() {
      return stdinClosed
    }
  }

  return child
}

test('RemoteInputHelper: sends hello with token and sends input events', async () => {
  const fakeChild = createFakeChild()
  const helper = new RemoteInputHelper({
    spawnHelper: () => fakeChild
  })

  await helper.start('token_secret_256')
  assert.equal(helper.isStarted(), true)

  helper.send({
    type: 'pointer-move',
    sessionId: 's_1',
    seq: 1,
    x: 0.5,
    y: 0.5
  })

  helper.send({
    type: 'pointer-button',
    sessionId: 's_1',
    seq: 2,
    button: 'left',
    pressed: true
  })

  helper.setCursorHidden(true)
  helper.setCursorHidden(false)

  await helper.releaseAll()
  await helper.stop()

  assert.equal(helper.isStarted(), false)
  assert.equal(fakeChild.isStdinClosed, true)

  const types = fakeChild.messages.map((m) => m.type)
  assert.deepEqual(types, ['hello', 'pointer-move', 'pointer-button', 'hide-cursor', 'hide-cursor', 'release-all', 'release-all', 'shutdown'])
  assert.equal(fakeChild.messages[3].hidden, true)
  assert.equal(fakeChild.messages[4].hidden, false)

  // Check all messages contain the session token
  for (const msg of fakeChild.messages) {
    assert.equal(msg.token, 'token_secret_256')
  }
})

test('RemoteInputHelper: ignores input before start and after stop', async () => {
  const fakeChild = createFakeChild()
  const helper = new RemoteInputHelper({
    spawnHelper: () => fakeChild
  })

  // Send before start
  assert.throws(() => {
    helper.send({
      type: 'pointer-move',
      sessionId: 's_1',
      seq: 1,
      x: 0.5,
      y: 0.5
    })
  }, /not started/)

  await helper.start('token_secret_256')
  await helper.stop()

  // Send after stop
  assert.throws(() => {
    helper.send({
      type: 'pointer-move',
      sessionId: 's_1',
      seq: 2,
      x: 0.5,
      y: 0.5
    })
  }, /not started/)
})

test('RemoteInputHelper: handles helper stdout events such as local override', async () => {
  const fakeChild = createFakeChild()
  const helper = new RemoteInputHelper({
    spawnHelper: () => fakeChild
  })

  let overrideDetected = false
  helper.onOverride(() => {
    overrideDetected = true
  })

  await helper.start('token_secret_256')

  // Simulate helper emitting local-override event on stdout
  fakeChild.stdout.emit('data', Buffer.from(JSON.stringify({ type: 'local-override', durationMs: 1500 }) + '\n'))

  assert.equal(overrideDetected, true)
  await helper.stop()
})

test('RemoteInputHelper: successfully spawns real native binary and handshakes', async () => {
  const helper = new RemoteInputHelper()
  await helper.start('test_token_live')
  assert.equal(helper.isStarted(), true)
  await helper.releaseAll()
  await helper.stop()
  assert.equal(helper.isStarted(), false)
})

function resolveLiveHelperPath() {
  const override = process.env.DOUJIAO_INPUT_HELPER
  if (override && fs.existsSync(override)) return override
  const candidates = [
    path.resolve(__dirname, '../native/remote-input-helper/build/Release/doujiao-remote-input.exe'),
    path.resolve(__dirname, '../native/remote-input-helper/bin/doujiao-remote-input.exe')
  ]
  return candidates.find((p) => fs.existsSync(p)) || null
}

test('RemoteInputHelper: our own injected pointer moves must not be reported as local override', async (t) => {
  const helperPath = resolveLiveHelperPath()
  if (!helperPath) {
    t.skip('native input helper binary not built')
    return
  }

  // 注意：该用例会在 Windows 上把真实光标移动到屏幕中央
  const helper = new RemoteInputHelper({ helperPath })
  let overrides = 0
  helper.onOverride(() => {
    overrides++
  })

  await helper.start('regression_token')
  helper.send({ type: 'pointer-move', sessionId: 's_reg', seq: 1, x: 0.5, y: 0.5 })
  await new Promise((r) => setTimeout(r, 150)) // > 50ms 自注入保护窗口
  helper.send({ type: 'pointer-move', sessionId: 's_reg', seq: 2, x: 0.5, y: 0.5 })
  await new Promise((r) => setTimeout(r, 300))
  await helper.releaseAll()
  await helper.stop()

  assert.equal(overrides, 0, '自注入的远程移动不得被误判为本地占用')
})

