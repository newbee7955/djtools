import { timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse, type Server as HttpServer } from 'node:http'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { ToolExecutionError, type ToolRegistry } from './tool-registry.ts'

export interface LocalMcpServerOptions { registry: ToolRegistry; token: string; port?: number }
const MAX_BODY_BYTES = 1024 * 1024

/** Loopback-only, authenticated, stateless MCP Streamable HTTP endpoint. */
export class LocalMcpServer {
  private readonly registry: ToolRegistry
  private readonly credential: Buffer
  private readonly requestedPort: number
  private server?: HttpServer
  private endpoint?: { url: string; port: number }
  private starting?: Promise<{ url: string; port: number }>
  private stopping?: Promise<void>
  private readonly active = new Set<Server>()

  constructor(options: LocalMcpServerOptions) {
    if (options.token.length < 32 || /[\s\x00-\x1f]/.test(options.token)) throw new Error('Invalid MCP credential')
    this.registry = options.registry
    this.credential = Buffer.from(`Bearer ${options.token}`)
    this.requestedPort = options.port ?? 18789
  }

  async start(): Promise<{ url: string; port: number }> {
    if (this.stopping) await this.stopping
    if (this.endpoint) return { ...this.endpoint }
    if (this.starting) return this.starting
    this.starting = this.listen()
    try { return await this.starting }
    finally { this.starting = undefined }
  }

  async stop(): Promise<void> {
    if (this.stopping) return this.stopping
    this.stopping = this.shutdown()
    try { await this.stopping }
    finally { this.stopping = undefined }
  }

  private async listen(): Promise<{ url: string; port: number }> {
    const server = createServer((request, response) => {
      void this.handle(request, response).catch(() => {
        if (!response.headersSent) this.reject(response, 500, 'Internal server error')
        else response.end()
      })
    })
    server.requestTimeout = 15_000
    server.headersTimeout = 10_000
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(this.requestedPort, '127.0.0.1', () => { server.removeListener('error', reject); resolve() })
    })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('MCP listener unavailable')
    this.server = server
    this.endpoint = { url: `http://127.0.0.1:${address.port}/mcp`, port: address.port }
    return { ...this.endpoint }
  }

  private async shutdown(): Promise<void> {
    if (this.starting) await this.starting.catch(() => undefined)
    const server = this.server
    this.server = undefined
    this.endpoint = undefined
    await Promise.allSettled([...this.active].map((mcp) => mcp.close()))
    this.active.clear()
    if (server) await new Promise<void>((resolve) => {
      server.close(() => resolve())
      server.closeAllConnections()
    })
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const port = this.endpoint?.port
    if (!port) { this.reject(response, 503, 'Server unavailable'); return }
    const allowedHosts = [`127.0.0.1:${port}`, `localhost:${port}`]
    if (!allowedHosts.includes(request.headers.host ?? '')) { this.reject(response, 403, 'Forbidden host'); return }
    const origin = request.headers.origin
    if (origin !== undefined && !allowedHosts.map((host) => `http://${host}`).includes(origin)) { this.reject(response, 403, 'Forbidden origin'); return }
    const supplied = Buffer.from(request.headers.authorization ?? '')
    if (supplied.length !== this.credential.length || !timingSafeEqual(supplied, this.credential)) { this.reject(response, 401, 'Unauthorized'); return }
    if (request.url !== '/mcp') { this.reject(response, 404, 'Not found'); return }
    if (request.method !== 'POST') { response.setHeader('Allow', 'POST'); this.reject(response, 405, 'Method not allowed'); return }
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] ?? '')) { this.reject(response, 415, 'JSON content type required'); return }
    if (Number(request.headers['content-length']) > MAX_BODY_BYTES) { this.reject(response, 413, 'Request too large'); request.resume(); return }
    const chunks: Buffer[] = []
    let length = 0
    for await (const chunk of request) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      length += bytes.length
      if (length > MAX_BODY_BYTES) { this.reject(response, 413, 'Request too large'); return }
      chunks.push(bytes)
    }
    let body: unknown
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) }
    catch { this.reject(response, 400, 'Invalid JSON'); return }
    const mcp = new Server({ name: 'doujiao-local-tools', version: '1.0.0' }, { capabilities: { tools: {} } })
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    mcp.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: this.registry.listTools().map((tool) => ({
      name: tool.name, title: tool.title, description: tool.description,
      inputSchema: { ...tool.inputSchema, type: 'object' as const },
      annotations: { readOnlyHint: tool.readOnly }
    })) }))
    mcp.setRequestHandler(CallToolRequestSchema, async (call, extra) => {
      try {
        const result = await this.registry.execute(call.params.name, call.params.arguments ?? {}, { source: 'mcp', clientId: 'external-client', signal: extra.signal })
        const serialized = JSON.stringify(result)
        const escapedToken = JSON.stringify(this.credential.toString('utf8').slice(7)).slice(1, -1)
        return { content: [{ type: 'text' as const, text: serialized.split(escapedToken).join('[redacted]') }] }
      } catch (error) {
        return { isError: true, content: [{ type: 'text' as const, text: error instanceof ToolExecutionError ? error.message : 'Tool execution failed' }] }
      }
    })
    this.active.add(mcp)
    const cleanup = (): void => {
      this.active.delete(mcp)
      void mcp.close().catch(() => undefined)
    }
    response.once('close', cleanup)
    try {
      await mcp.connect(transport)
      await transport.handleRequest(request, response, body)
    } catch {
      cleanup()
      if (!response.headersSent) this.reject(response, 500, 'Internal server error')
    }
  }

  private reject(response: ServerResponse, status: number, message: string): void {
    response.writeHead(status, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ error: message }))
  }
}
