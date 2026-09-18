import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { TransferSession } from '../src/main/services/remote-assist/transfer/transfer-session.ts'

class LoopbackTransport {
  constructor() { this.peer = null; this.callbacks = [] }
  send(bytes) { this.peer?.deliver(bytes) }
  bufferedAmount() { return 0 }
  isOpen() { return true }
  onFrame(cb) { this.callbacks.push(cb) }
  deliver(bytes) { for (const cb of this.callbacks) cb(bytes) }
}

test('transfers a nested folder between two sessions preserving structure', async (t) => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'dj-int-'))
  t.after(() => fs.rm(base, { recursive: true, force: true }))
  const src = path.join(base, 'src')
  await fs.mkdir(path.join(src, 'pics', 'raw'), { recursive: true })
  await fs.writeFile(path.join(src, 'pics', 'a.png'), 'AAA')
  await fs.writeFile(path.join(src, 'pics', 'raw', 'b.png'), 'BBBB')

  const ta = new LoopbackTransport(); const tb = new LoopbackTransport(); ta.peer = tb; tb.peer = ta
  const sender = new TransferSession({ transport: ta, receiveDir: path.join(base, 'a'), stagingDir: path.join(base, 'as') })
  const receiver = new TransferSession({ transport: tb, receiveDir: path.join(base, 'b'), stagingDir: path.join(base, 'bs') })
  receiver.setPolicy({ receiveFiles: true, clipboard: { text: false, image: false, file: false } })

  await sender.enqueueSend([path.join(src, 'pics')])

  const expected = [
    path.join(base, 'b', 'pics', 'a.png'),
    path.join(base, 'b', 'pics', 'raw', 'b.png'),
  ]
  const deadline = Date.now() + 3000
  let delivered = false
  while (Date.now() < deadline) {
    try {
      for (const file of expected) await fs.access(file)
      delivered = true
      break
    } catch {
      await new Promise((r) => setTimeout(r, 10))
    }
  }
  assert.ok(delivered, `transferred files did not appear within 3000ms: ${expected.join(', ')}`)

  assert.equal(await fs.readFile(path.join(base, 'b', 'pics', 'a.png'), 'utf8'), 'AAA')
  assert.equal(await fs.readFile(path.join(base, 'b', 'pics', 'raw', 'b.png'), 'utf8'), 'BBBB')
})
