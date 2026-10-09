import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NotepadWorkspace } from '../src/main/mcp/notepad-tools.ts'
import { createHostTools } from '../src/main/mcp/host-tools.ts'
import { approvalSummary } from '../src/main/mcp/approval-summary.ts'
import { ImageArtifacts } from '../src/main/mcp/image-artifacts.ts'

const validPng = 'data:image/png;base64,iVBORw0KGgoAAA=='

test('NotepadWorkspace creates exclusively, reads UTF-8 and rejects unsafe names', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ai-notepad-test-'))
  try {
    const ws = new NotepadWorkspace(dir, 1024)
    // 1. Create a note
    await ws.create('quick.txt', 'hello note')
    // 2. Reject overwrite
    await assert.rejects(ws.create('quick.txt', 'overwrite'), /EEXIST/i)
    // 3. Read note
    const content = await ws.read('quick.txt')
    assert.equal(content, 'hello note')
    // 4. List notes
    const list = await ws.list()
    assert.deepEqual(list, ['quick.txt'])
    // 5. Reject non-.txt extension
    await assert.rejects(ws.create('evil.exe', 'bad'), /Invalid Notepad path/i)
    await assert.rejects(ws.create('evil.md', 'bad'), /Invalid Notepad path/i)
    // 6. Reject path traversal and device names
    await assert.rejects(ws.create('../escape.txt', 'bad'), /Invalid Notepad path/i)
    await assert.rejects(ws.create('sub\\escape.txt', 'bad'), /Invalid Notepad path/i)
    await assert.rejects(ws.create('nul.txt', 'bad'), /Invalid Notepad path/i)
    await assert.rejects(ws.create('con.txt', 'bad'), /Invalid Notepad path/i)
    // 7. Reject oversized note
    await assert.rejects(ws.create('big.txt', 'x'.repeat(2000)), /Note content is too large/i)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('NotepadWorkspace rejects symlink escape', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ai-notepad-sym-'))
  const outside = await mkdtemp(join(tmpdir(), 'ai-notepad-out-'))
  try {
    await writeFile(join(outside, 'secret.txt'), 'secret')
    try {
      await symlink(join(outside, 'secret.txt'), join(dir, 'linked.txt'))
      const ws = new NotepadWorkspace(dir)
      await assert.rejects(ws.read('linked.txt'), /Unsafe/i)
    } catch (e) {
      if (e.code === 'EPERM') return // Skip symlink test if Windows unprivileged symlinks not enabled
      throw e
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  }
})

test('New host tools execute correctly with adapters', async () => {
  const artifacts = new ImageArtifacts()
  const history = [
    { id: '1', text: 'Hello World', timestamp: 1000, type: 'text' },
    { id: '2', text: 'Foo Bar', timestamp: 2000, type: 'text' },
    { id: '3', text: 'data:image/png;base64,...', timestamp: 3000, type: 'image' },
    { id: '4', text: 'hello again', timestamp: 4000, type: 'text' }
  ]
  let writtenText = ''
  let capturedFullscreen = false
  const dir = await mkdtemp(join(tmpdir(), 'ai-host-tools-test-'))
  try {
    const ws = new NotepadWorkspace(dir)
    const tools = createHostTools({
      artifacts,
      ocr: {},
      workspace: () => ({}),
      capture: async () => ({ success: true, dataUrl: validPng }),
      captureFullscreen: async () => {
        capturedFullscreen = true
        return { success: true, dataUrl: validPng }
      },
      pickImage: async () => null,
      notepadWorkspace: () => ws,
      clipboardHistory: () => history,
      clipboardWrite: text => {
        writtenText = text
        return true
      }
    })

    // Test screen_capture_fullscreen
    const fullscreenTool = tools.find(t => t.name === 'screen_capture_fullscreen')
    assert.ok(fullscreenTool)
    assert.equal(fullscreenTool.requiresApproval, true)
    const fsResult = await fullscreenTool.execute({}, { source: 'host', clientId: 'ui' })
    assert.equal(capturedFullscreen, true)
    assert.match(fsResult.artifactId, /^[0-9a-f-]+$/)

    // Test clipboard_get_recent
    const recentTool = tools.find(t => t.name === 'clipboard_get_recent')
    assert.ok(recentTool)
    assert.equal(recentTool.requiresApproval, false)
    const recentResult = await recentTool.execute({ limit: 2 }, { source: 'host', clientId: 'ui' })
    assert.equal(recentResult.items.length, 2)
    assert.equal(recentResult.items[0].text, 'Hello World')

    // Test clipboard_search
    const searchTool = tools.find(t => t.name === 'clipboard_search')
    assert.ok(searchTool)
    assert.equal(searchTool.requiresApproval, false)
    const searchResult = await searchTool.execute({ query: 'hello' }, { source: 'host', clientId: 'ui' })
    assert.equal(searchResult.items.length, 2)
    assert.equal(searchResult.items[0].id, '1')
    assert.equal(searchResult.items[1].id, '4')

    // Test clipboard_write
    const writeTool = tools.find(t => t.name === 'clipboard_write')
    assert.ok(writeTool)
    assert.equal(writeTool.requiresApproval, true)
    const writeResult = await writeTool.execute({ text: 'Copied!' }, { source: 'host', clientId: 'ui' })
    assert.deepEqual(writeResult, { success: true })
    assert.equal(writtenText, 'Copied!')

    // Test notepad_create, notepad_list, notepad_read
    const createTool = tools.find(t => t.name === 'notepad_create')
    assert.ok(createTool)
    assert.equal(createTool.requiresApproval, true)
    await createTool.execute({ path: 'memo.txt', content: 'meeting notes' }, { source: 'host', clientId: 'ui' })

    const listTool = tools.find(t => t.name === 'notepad_list')
    assert.ok(listTool)
    const listResult = await listTool.execute({}, { source: 'host', clientId: 'ui' })
    assert.deepEqual(listResult.files, ['memo.txt'])

    const readTool = tools.find(t => t.name === 'notepad_read')
    assert.ok(readTool)
    const readResult = await readTool.execute({ path: 'memo.txt' }, { source: 'host', clientId: 'ui' })
    assert.deepEqual(readResult, { path: 'memo.txt', content: 'meeting notes' })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('approvalSummary outputs accurate details for new tools', () => {
  const fsSummary = approvalSummary('screen_capture_fullscreen', {}, null)
  assert.match(fsSummary, /全屏/i)

  const clipSummary = approvalSummary('clipboard_write', { text: '12345' }, null)
  assert.match(clipSummary, /剪贴板/i)
  assert.match(clipSummary, /5 字符/)

  const noteSummary = approvalSummary('notepad_create', { path: 'todo.txt', content: 'notes' }, null, 'C:\\Notes')
  assert.match(noteSummary, /Notes/)
  assert.match(noteSummary, /todo\.txt/)
  assert.match(noteSummary, /5 字节/)
})
