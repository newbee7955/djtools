import test from 'node:test'
import assert from 'node:assert/strict'
import { request } from 'node:http'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import * as registryModule from '../src/main/mcp/tool-registry.ts'
import * as serverModule from '../src/main/mcp/mcp-server.ts'
const token = 'random-test-credential-01234567890123456789'
async function fixture(t) {
  assert.equal(typeof registryModule.ToolRegistry, 'function', 'ToolRegistry is implemented')
  assert.equal(typeof serverModule.LocalMcpServer, 'function', 'LocalMcpServer is implemented')
  const registry = new registryModule.ToolRegistry()
  registry.register({ name: 'test_echo', title: 'Echo', description: 'Echo text', pluginId: 'test', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false }, readOnly: true, requiresApproval: false, execute: async (args) => ({ text: args.text }) })
  const server = new serverModule.LocalMcpServer({ registry, token, port: 0 })
  t.after(() => server.stop())
  return { server, registry, ...await server.start() }
}
function post(url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = request(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...headers } }, (res) => {
      let text = ''
      res.on('data', (chunk) => { text += chunk })
      res.on('end', () => resolve({ status: res.statusCode, text }))
    })
    req.on('error', reject)
    req.end(body)
  })
}

test('actual SDK client initializes, lists and executes the shared registry over stateless HTTP', async (t) => {
  const { url, registry } = await fixture(t)
  const client = new Client({ name: 'doujiao-test', version: '1.0' })
  t.after(() => client.close())
  const transport = new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { Authorization: `Bearer ${token}` } } })
  await client.connect(transport)
  assert.equal(transport.sessionId, undefined)
  assert.equal((await client.listTools()).tools[0].name, 'test_echo')
  const result = await client.callTool({ name: 'test_echo', arguments: { text: 'hello' } })
  assert.equal(result.isError, undefined)
  assert.deepEqual(JSON.parse(result.content[0].text), { text: 'hello' })
  assert.equal(registry.getCalls()[0].source, 'mcp')
  registry.setEnabled('test_echo', false)
  assert.deepEqual((await client.listTools()).tools, [])
  assert.equal((await client.callTool({ name: 'test_echo', arguments: { text: 'hello' } })).isError, true)
})

test('bearer authentication rejects missing, malformed and wrong credentials without execution', async (t) => {
  const { url, registry } = await fixture(t)
  for (const auth of ['', 'Basic xyz', 'Bearer wrong', `Bearer ${token}extra`]) assert.equal((await post(url, '{}', { Authorization: auth })).status, 401)
  assert.deepEqual(registry.getCalls(), [])
})

test('Host and Origin reject remote domains, wrong ports, null and disguised loopback URLs', async (t) => {
  const { url, port } = await fixture(t)
  for (const host of ['attacker.test', `127.0.0.1:${port + 1}`, '127.0.0.1.attacker.test', `attacker.test:${port}`]) assert.equal((await post(url, '{}', { Host: host })).status, 403)
  for (const origin of ['https://attacker.test', 'null', `http://127.0.0.1:${port + 1}`, `http://127.0.0.1:${port}/evil`, `http://user@127.0.0.1:${port}`]) assert.equal((await post(url, '{}', { Origin: origin })).status, 403)
})

test('malformed JSON and oversized fixed/chunked bodies are rejected before SDK processing', async (t) => {
  const { url } = await fixture(t)
  assert.equal((await post(url, '{')).status, 400)
  const body = JSON.stringify({ secret: 'x'.repeat(1024 * 1024 + 1) })
  const chunked = await post(url, body, { 'Transfer-Encoding': 'chunked' })
  assert.equal(chunked.status, 413)
  assert.equal(chunked.text.includes('xxx'), false)
  assert.equal((await post(url, body, { 'Content-Length': Buffer.byteLength(body) })).status, 413)
})

test('execution failures return generic MCP errors without exception contents', async (t) => {
  const { registry, url } = await fixture(t)
  registry.register({ name: 'test_fail', title: 'Fail', description: 'Failure', pluginId: 'test', inputSchema: { type: 'object' }, readOnly: true, requiresApproval: false, execute: async () => { throw new Error(token + ' sensitive text') } })
  const client = new Client({ name: 'doujiao-test', version: '1.0' })
  t.after(() => client.close())
  await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }))
  const result = await client.callTool({ name: 'test_fail', arguments: {} })
  assert.equal(result.isError, true)
  assert.equal(JSON.stringify(result).includes(token), false)
  assert.equal(JSON.stringify(registry.getCalls()).includes(token), false)
})

test('shutdown is idempotent, stops connections and supports restart', async (t) => {
  const { server, url } = await fixture(t)
  await server.stop()
  await server.stop()
  await assert.rejects(fetch(url))
  const restarted = await server.start()
  assert.equal((await post(restarted.url, '{}', { Authorization: '' })).status, 401)
})

test('the local bearer credential cannot be reflected by a successful tool result', async (t) => {
  const { url, registry } = await fixture(t)
  registry.register({ name: 'test_sensitive', title: 'Result', description: 'Result', pluginId: 'test', inputSchema: { type: 'object' }, readOnly: true, requiresApproval: false, execute: async () => ({ nested: { text: token } }) })
  const client = new Client({ name: 'doujiao-test', version: '1.0' })
  t.after(() => client.close())
  await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }))
  const result = await client.callTool({ name: 'test_sensitive', arguments: {} })
  assert.equal(JSON.stringify(result).includes(token), false)
})
