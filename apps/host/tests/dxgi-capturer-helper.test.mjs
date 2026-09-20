import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { EventEmitter } from 'node:events'
import { DxgiCapturerHelper } from '../src/main/services/remote-assist/dxgi-capturer-helper.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function createFakeDxgiChild(portToEmit = 54321) {
  const emitter = new EventEmitter()
  let stdinClosed = false

  const child = {
    stdin: {
      write() { return true },
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
    get isStdinClosed() {
      return stdinClosed
    }
  }

  // Simulate helper startup and outputting ready port
  setTimeout(() => {
    child.stdout.emit('data', Buffer.from(`{"type":"ready","port":${portToEmit}}\n`))
  }, 10)

  return child
}

test('DxgiCapturerHelper: successfully negotiates port and manages lifecycle', async () => {
  const fakeChild = createFakeDxgiChild(49152)
  const helper = new DxgiCapturerHelper({
    spawnHelper: () => fakeChild
  })

  const port = await helper.start({ fps: 60 })
  assert.equal(port, 49152)
  assert.equal(helper.isStarted(), true)
  assert.equal(helper.getPort(), 49152)

  await helper.stop()
  assert.equal(helper.isStarted(), false)
  assert.equal(helper.getPort(), null)
  assert.equal(fakeChild.isStdinClosed, true)
})

test('DxgiCapturerHelper: returns null gracefully when binary does not exist', async () => {
  const helper = new DxgiCapturerHelper({
    helperPath: 'C:\\non_existent_dir\\doujiao-dxgi-capturer.exe'
  })

  const port = await helper.start()
  assert.equal(port, null)
  assert.equal(helper.isStarted(), false)
})

test('DxgiCapturerHelper: successfully spawns real native binary and handshakes', async () => {
  const realBinPath = path.resolve(__dirname, '../native/dxgi-screen-capturer/bin/doujiao-dxgi-capturer.exe')
  if (!fs.existsSync(realBinPath)) {
    console.log('[Test Skip] Real dxgi capturer binary not built at:', realBinPath)
    return
  }

  const helper = new DxgiCapturerHelper({
    helperPath: realBinPath
  })

  const port = await helper.start({ fps: 60 })
  assert.equal(typeof port, 'number')
  assert.ok(port > 0 && port < 65536)
  assert.equal(helper.isStarted(), true)
  assert.equal(helper.getPort(), port)

  await helper.stop()
  assert.equal(helper.isStarted(), false)
  assert.equal(helper.getPort(), null)
})
