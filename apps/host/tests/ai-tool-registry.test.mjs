import test from 'node:test'
import assert from 'node:assert/strict'

import * as module from '../src/main/mcp/tool-registry.ts'
const context = { source: 'host', clientId: 'host-ui' }
const schema = { type: 'object', properties: { text: { type: 'string', minLength: 1 } }, required: ['text'], additionalProperties: false }
function registry(options = {}) {
  assert.equal(typeof module.ToolRegistry, 'function', 'ToolRegistry is implemented')
  return new module.ToolRegistry(options)
}
function tool(execute = async (args) => ({ text: args.text }), extra = {}) {
  return { name: 'test_echo', title: 'Echo', description: 'Echo text', pluginId: 'test', inputSchema: schema, readOnly: true, requiresApproval: false, execute, ...extra }
}

test('public tool definitions contain no executor and reflect toggles', async () => {
  const changes = []
  const r = registry({ onEnabledChange: (...args) => changes.push(args) })
  r.register(tool())
  assert.equal(r.listTools()[0].execute, undefined)
  r.setEnabled('test_echo', false)
  assert.deepEqual(r.listTools(), [])
  assert.equal(r.listTools(true)[0].enabled, false)
  assert.equal(r.listTools(true)[0].execute, undefined)
  assert.deepEqual(changes, [['test_echo', false]])
  r.setEnabled('test_echo', true)
  assert.deepEqual(await r.execute('test_echo', { text: 'hello' }, context), { text: 'hello' })
})

test('unknown and disabled tools cannot produce side effects from host or MCP', async () => {
  let calls = 0
  const r = registry({ enabledTools: { test_echo: false } })
  r.register(tool(async () => { calls++; return {} }))
  for (const source of ['host', 'mcp']) {
    await assert.rejects(r.execute('missing', {}, { ...context, source }), /Unknown tool/)
    await assert.rejects(r.execute('test_echo', { text: 'hello' }, { ...context, source }), /disabled/)
  }
  assert.equal(calls, 0)
  assert.equal(r.getCalls().every((call) => call.status === 'denied'), true)
})

test('JSON Schema validation rejects nested constraints and combinators before execution', async () => {
  let calls = 0
  const r = registry()
  r.register(tool(async () => { calls++; return {} }, { inputSchema: {
    type: 'object', required: ['items'], additionalProperties: false,
    properties: { items: { type: 'array', minItems: 1, uniqueItems: true, items: { anyOf: [{ type: 'integer', minimum: 2 }, { type: 'string', pattern: '^ok$' }] } } }
  } }))
  for (const args of [null, [], { items: [] }, { items: [1] }, { items: ['bad'] }, { items: [2, 2] }, { items: [2], extra: true }]) {
    await assert.rejects(r.execute('test_echo', args, context), /Invalid tool arguments/)
  }
  await r.execute('test_echo', { items: [2, 'ok'] }, context)
  assert.equal(calls, 1)
})

test('plugin disabled state denies discovery and execution', async () => {
  let enabled = true
  let calls = 0
  const r = registry({ isPluginEnabled: () => enabled })
  r.register(tool(async () => { calls++; return {} }))
  enabled = false
  assert.deepEqual(r.listTools(), [])
  await assert.rejects(r.execute('test_echo', { text: 'hello' }, context), /Plugin is disabled/)
  assert.equal(calls, 0)
})

test('required external approval defaults to denial and trusted host calls still execute', async () => {
  let calls = 0
  for (const approve of [undefined, async () => false]) {
    const r = registry({ approve })
    r.register(tool(async () => { calls++; return {} }, { requiresApproval: true }))
    await assert.rejects(r.execute('test_echo', { text: 'hello' }, { ...context, source: 'mcp' }), /Approval denied/)
    await r.execute('test_echo', { text: 'hello' }, context)
  }
  assert.equal(calls, 2)
})

test('executor rechecks tool and plugin permissions after awaited approval', async () => {
  for (const revoked of ['tool', 'plugin']) {
    let enabled = true
    let calls = 0
    let release
    const r = registry({ isPluginEnabled: () => enabled, approve: () => new Promise((resolve) => { release = resolve }) })
    r.register(tool(async () => { calls++; return {} }, { requiresApproval: true }))
    const pending = r.execute('test_echo', { text: 'hello' }, { ...context, source: 'mcp' })
    if (revoked === 'tool') r.setEnabled('test_echo', false)
    else enabled = false
    release(true)
    await assert.rejects(pending, /disabled/)
    assert.equal(calls, 0)
  }
})

test('execution preserves approved arguments even when caller mutates them during approval', async () => {
  let release
  const r = registry({ approve: () => new Promise((resolve) => { release = resolve }) })
  r.register(tool(undefined, { requiresApproval: true }))
  const args = { text: 'hello' }
  const pending = r.execute('test_echo', args, { ...context, source: 'mcp' })
  args.text = 123
  release(true)
  assert.deepEqual(await pending, { text: 'hello' })
})

test('aborted approval does not execute', async () => {
  const abort = new AbortController()
  let release
  let calls = 0
  const r = registry({ approve: () => new Promise((resolve) => { release = resolve }) })
  r.register(tool(async () => { calls++; return {} }, { requiresApproval: true }))
  const pending = r.execute('test_echo', { text: 'hello' }, { ...context, source: 'mcp', signal: abort.signal })
  abort.abort()
  release(true)
  await assert.rejects(pending, /aborted/)
  assert.equal(calls, 0)
})

test('history is bounded, metadata-only, immutable to callers and errors are generic', async () => {
  const secret = 'Bearer private-token OCR-content'
  const r = registry()
  r.register(tool(async () => { throw new Error(secret) }))
  for (let index = 0; index < 205; index++) await assert.rejects(r.execute('test_echo', { text: secret }, context), /Tool execution failed/)
  const history = r.getCalls()
  assert.equal(history.length, 200)
  assert.equal(history[0].status, 'failed')
  assert.ok(history[0].finishedAt >= history[0].startedAt)
  assert.equal(JSON.stringify(history).includes(secret), false)
  assert.deepEqual(Object.keys(history[0]).sort(), ['clientId', 'error', 'finishedAt', 'id', 'source', 'startedAt', 'status', 'toolName'])
  history[0].error = secret
  assert.equal(JSON.stringify(r.getCalls()).includes(secret), false)
  r.clearCalls()
  assert.deepEqual(r.getCalls(), [])
})

test('definition snapshots cannot mutate registered schemas or permissions', async () => {
  const r = registry()
  const definition = tool()
  r.register(definition)
  definition.requiresApproval = true
  const listed = r.listTools()[0]
  listed.inputSchema.required = []
  await assert.rejects(r.execute('test_echo', {}, context), /Invalid tool arguments/)
  assert.deepEqual(await r.execute('test_echo', { text: 'hello' }, context), { text: 'hello' })
})

test('two tools with the same schema id enforce their own advertised constraints', async () => {
  const r = registry()
  const id = 'https://doujiao.local/tool-args'
  r.register(tool(undefined, { inputSchema: { ...schema, $id: id } }))
  r.register(tool(async (args) => args, { name: 'test_count', inputSchema: { $id: id, type: 'object', properties: { count: { type: 'integer' } }, required: ['count'], additionalProperties: false } }))
  await assert.rejects(r.execute('test_count', { text: 'hello' }, context), /Invalid tool arguments/)
  assert.deepEqual(await r.execute('test_count', { count: 2 }, context), { count: 2 })
})
