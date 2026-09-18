import test from 'node:test'
import assert from 'node:assert/strict'
import { encodeFileNameW, decodeFileNameW, ClipboardBridge } from '../src/main/services/remote-assist/transfer/clipboard-bridge.ts'

test('encodeFileNameW produces UTF-16LE null-separated list with double null', () => {
  const bytes = encodeFileNameW(['C:\\a.txt', 'C:\\b.txt'])
  const expected = Buffer.from('C:\\a.txt\0C:\\b.txt\0\0', 'ucs2')
  assert.deepEqual(Buffer.from(bytes), expected)
})

test('decodeFileNameW round-trips', () => {
  const paths = ['C:\\a.txt', 'D:\\目录\\b.txt']
  assert.deepEqual(decodeFileNameW(encodeFileNameW(paths)), paths)
})

test('writers return true with a real (injected) clipboard and false without one', () => {
  const written = []
  const fake = {
    readText() { return '' },
    readImage() { return { isEmpty: () => true, toPNG: () => Buffer.alloc(0) } },
    readBuffer() { return Buffer.alloc(0) },
    writeText(t) { written.push(['text', t]) },
    writeImage() { written.push(['image']) },
    writeBuffer(fmt, buf) { written.push(['buffer', fmt]) }
  }
  const bridge = new ClipboardBridge({ clipboard: fake })
  assert.equal(bridge.writeText('hello'), true)
  assert.equal(bridge.writeImage(new Uint8Array([1, 2, 3])), true)
  assert.equal(bridge.writeFiles(['C:\\a.txt']), true)
  assert.deepEqual(written.map((w) => w[0]), ['text', 'image', 'buffer', 'buffer'])

  const none = new ClipboardBridge({ clipboard: null })
  assert.equal(none.writeText('hello'), false)
  assert.equal(none.writeImage(new Uint8Array([1])), false)
  assert.equal(none.writeFiles(['C:\\a.txt']), false)
  // 空路径列表视为跳过
  assert.equal(bridge.writeFiles([]), false)
})

test('writers return false and do not throw when the underlying write fails', () => {
  const throwing = {
    readText() { return '' },
    readImage() { return { isEmpty: () => true, toPNG: () => Buffer.alloc(0) } },
    readBuffer() { return Buffer.alloc(0) },
    writeText() { throw new Error('clipboard write refused') },
    writeImage() { throw new Error('clipboard write refused') },
    writeBuffer() { throw new Error('clipboard write refused') }
  }
  const bridge = new ClipboardBridge({ clipboard: throwing })
  assert.equal(bridge.writeText('x'), false)
  assert.equal(bridge.writeImage(new Uint8Array([1])), false)
  assert.equal(bridge.writeFiles(['C:\\a.txt']), false)
})

test('ClipboardBridge suppresses echo of remotely-written content', () => {
  const text = 'remote-value'
  const fake = {
    _text: '',
    readText() { return this._text },
    readImage() { return { isEmpty: () => true, toPNG: () => Buffer.alloc(0) } },
    readBuffer() { return Buffer.alloc(0) },
    writeText(t) { this._text = t },
    writeImage() {},
    writeBuffer() {}
  }
  const bridge = new ClipboardBridge({ clipboard: fake, pollIntervalMs: 5 })
  const events = []
  bridge.start((snap) => events.push(snap))

  // 远端写入（模拟对端内容落到本机剪贴板）
  bridge.writeText(text)
  bridge.markRemoteWrite(text)

  // 模拟轮询捕获该变化
  bridge.pollOnce()
  assert.equal(events.length, 0, 'echo of remote write must be suppressed')

  // 本机新内容应被上报
  fake._text = 'local-new'
  bridge.pollOnce()
  assert.equal(events.length, 1)
  assert.equal(events[0].kind, 'text')
  assert.equal(events[0].text, 'local-new')
  bridge.stop()
})

// ---- 加固批次 minor 修复：损坏 PNG 解码为「非空但 isEmpty」时不得误报成功 ----

test('writeImage treats a non-null but empty decoded native image as failure', () => {
  const writes = []
  const fake = {
    readText() { return '' },
    readImage() { return { isEmpty: () => true, toPNG: () => Buffer.alloc(0) } },
    readBuffer() { return Buffer.alloc(0) },
    writeText() {},
    writeImage(img) { writes.push(img) },
    writeBuffer() {}
  }
  const bridge = new ClipboardBridge({
    clipboard: fake,
    nativeImage: { createFromBuffer: () => ({ isEmpty: () => true }) }
  })
  assert.equal(bridge.writeImage(new Uint8Array([1, 2, 3])), false, 'completely-empty decode must report failure')
  assert.equal(writes.length, 0, 'a failed decode must not be written to the clipboard')
  assert.equal(bridge.suppressedHashes.size, 0, 'a failed decode must not mark a remote-write echo')
})

test('writeImage writes a non-empty decoded native image and reports success', () => {
  const writes = []
  const decoded = { isEmpty: () => false }
  const fake = {
    readText() { return '' },
    readImage() { return { isEmpty: () => true, toPNG: () => Buffer.alloc(0) } },
    readBuffer() { return Buffer.alloc(0) },
    writeText() {},
    writeImage(img) { writes.push(img) },
    writeBuffer() {}
  }
  const bridge = new ClipboardBridge({
    clipboard: fake,
    nativeImage: {
      createFromBuffer(buffer) {
        assert.deepEqual(Array.from(buffer), [1, 2, 3], 'must decode the original PNG bytes')
        return decoded
      }
    }
  })
  assert.equal(bridge.writeImage(new Uint8Array([1, 2, 3])), true)
  assert.equal(writes.length, 1, 'a successful decode must be written to the clipboard')
  assert.equal(writes[0], decoded)
  assert.equal(bridge.suppressedHashes.size, 1, 'a successful write must mark a remote-write echo')
})

test('writeImage reports failure when the native decoder throws', () => {
  const writes = []
  const fake = {
    readText() { return '' },
    readImage() { return { isEmpty: () => true, toPNG: () => Buffer.alloc(0) } },
    readBuffer() { return Buffer.alloc(0) },
    writeText() {},
    writeImage(img) { writes.push(img) },
    writeBuffer() {}
  }
  const bridge = new ClipboardBridge({
    clipboard: fake,
    nativeImage: { createFromBuffer: () => { throw new Error('decode boom') } }
  })
  assert.equal(bridge.writeImage(new Uint8Array([1])), false)
  assert.equal(writes.length, 0)
  assert.equal(bridge.suppressedHashes.size, 0)
})
