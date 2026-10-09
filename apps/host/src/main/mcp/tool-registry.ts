import { randomUUID } from 'node:crypto'
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv'
import type { JsonSchemaType, JsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/types.js'
import type { RegisteredTool, ToolCallRecord, ToolContext, ToolDefinition, ToolListing, ToolResult } from '../../shared/ai-tools.ts'

export interface ToolRegistryOptions {
  approve?: (tool: ToolDefinition, args: Record<string, unknown>, context: ToolContext) => boolean | Promise<boolean>
  isPluginEnabled?: (pluginId: string) => boolean
  enabledTools?: Record<string, boolean>
  onEnabledChange?: (name: string, enabled: boolean) => void
}

const messages = {
  unknown: 'Unknown tool', disabled: 'Tool is disabled', 'plugin-disabled': 'Plugin is disabled',
  'invalid-args': 'Invalid tool arguments', 'approval-denied': 'Approval denied',
  aborted: 'Tool call aborted', failed: 'Tool execution failed'
} as const
export type ToolExecutionErrorCode = keyof typeof messages
export class ToolExecutionError extends Error {
  readonly code: ToolExecutionErrorCode
  constructor(code: ToolExecutionErrorCode) {
    super(messages[code])
    this.name = 'ToolExecutionError'
    this.code = code
  }
}

interface Entry {
  definition: ToolDefinition
  execute: RegisteredTool['execute']
  validate: JsonSchemaValidator<Record<string, unknown>>
  enabled: boolean
}

/** Shared permission boundary for trusted host actions and authenticated MCP requests. */
export class ToolRegistry {
  private readonly options: ToolRegistryOptions
  private readonly tools = new Map<string, Entry>()
  private readonly calls: ToolCallRecord[] = []

  constructor(options: ToolRegistryOptions = {}) {
    this.options = { ...options, enabledTools: { ...options.enabledTools } }
  }

  register(tool: RegisteredTool): void {
    if (!/^[a-zA-Z0-9_.-]{1,128}$/.test(tool.name) || this.tools.has(tool.name)) throw new Error('Invalid or duplicate tool name')
    const definition: ToolDefinition = structuredClone({
      name: tool.name, title: tool.title, description: tool.description, pluginId: tool.pluginId,
      inputSchema: tool.inputSchema, readOnly: tool.readOnly, requiresApproval: tool.requiresApproval
    })
    if (definition.inputSchema.type !== 'object' || typeof tool.execute !== 'function') throw new Error('Invalid tool definition')
    try {
      this.tools.set(tool.name, {
        definition, execute: tool.execute,
        // Isolate SDK's $id cache so separate tools cannot reuse another tool's constraints.
        validate: new AjvJsonSchemaValidator().getValidator<Record<string, unknown>>(definition.inputSchema as JsonSchemaType),
        enabled: this.options.enabledTools?.[tool.name] !== false
      })
    } catch { throw new Error('Invalid tool schema') }
  }

  listTools(includeDisabled = false): ToolListing[] {
    const definitions: ToolListing[] = []
    for (const entry of this.tools.values()) {
      const enabled = entry.enabled && this.pluginEnabled(entry.definition.pluginId)
      if (includeDisabled || enabled) definitions.push({ ...structuredClone(entry.definition), enabled })
    }
    return definitions
  }

  setEnabled(name: string, enabled: boolean): void {
    const entry = this.tools.get(name)
    if (!entry) throw new ToolExecutionError('unknown')
    entry.enabled = enabled
    this.options.onEnabledChange?.(name, enabled)
  }

  async execute(name: string, args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const entry = this.tools.get(name)
    const call: ToolCallRecord = {
      id: randomUUID(), toolName: entry?.definition.name ?? '(unknown)',
      clientId: context.source === 'mcp' ? 'external-client' : context.clientId.replace(/[\r\n\x00-\x1f]/g, '').slice(0, 80),
      source: context.source, status: 'running', startedAt: Date.now()
    }
    this.calls.push(call)
    if (this.calls.length > 200) this.calls.splice(0, this.calls.length - 200)
    try {
      if (!entry) throw new ToolExecutionError('unknown')
      this.checkPermission(entry, context)
      let snapshot: Record<string, unknown>
      try {
        if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error()
        snapshot = structuredClone(args)
        if (!entry.validate(snapshot).valid) throw new Error()
      } catch { throw new ToolExecutionError('invalid-args') }
      if (entry.definition.requiresApproval && context.source === 'mcp') {
        let approved = false
        try { approved = await this.options.approve?.(structuredClone(entry.definition), structuredClone(snapshot), context) === true }
        catch { throw new ToolExecutionError('approval-denied') }
        if (!approved) throw new ToolExecutionError('approval-denied')
      }
      // Permissions may have changed while an approval dialog was open.
      this.checkPermission(entry, context)
      let result: ToolResult
      try { result = await entry.execute(snapshot, context) }
      catch { throw new ToolExecutionError('failed') }
      call.status = 'succeeded'
      return result
    } catch (error) {
      const safeError = error instanceof ToolExecutionError ? error : new ToolExecutionError('failed')
      call.status = safeError.code === 'failed' ? 'failed' : 'denied'
      call.error = safeError.message
      throw safeError
    } finally { call.finishedAt = Date.now() }
  }

  getCalls(): ToolCallRecord[] { return this.calls.map((call) => ({ ...call })) }
  clearCalls(): void { this.calls.length = 0 }

  private pluginEnabled(pluginId: string): boolean {
    try { return this.options.isPluginEnabled?.(pluginId) ?? true }
    catch { return false }
  }

  private checkPermission(entry: Entry, context: ToolContext): void {
    if (context.signal?.aborted) throw new ToolExecutionError('aborted')
    if (!entry.enabled) throw new ToolExecutionError('disabled')
    if (!this.pluginEnabled(entry.definition.pluginId)) throw new ToolExecutionError('plugin-disabled')
  }
}
