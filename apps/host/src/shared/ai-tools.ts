export interface ToolContext {
  source: 'host' | 'mcp'
  clientId: string
  signal?: AbortSignal
}

export interface ToolDefinition {
  name: string
  title: string
  description: string
  pluginId: string
  inputSchema: Record<string, unknown>
  readOnly: boolean
  requiresApproval: boolean
}

export interface ToolResult { [key: string]: unknown }

export interface ToolCallRecord {
  id: string
  toolName: string
  clientId: string
  source: 'host' | 'mcp'
  status: 'running' | 'succeeded' | 'failed' | 'denied'
  startedAt: number
  finishedAt?: number
  error?: string
}

export interface RegisteredTool extends ToolDefinition {
  execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult>
}

export interface ToolListing extends ToolDefinition { enabled: boolean }
