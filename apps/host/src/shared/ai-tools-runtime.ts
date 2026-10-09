import type { ToolListing, ToolCallRecord, ToolResult } from './ai-tools'
export interface AiToolsStatus {
  enabled:boolean
  running:boolean
  url?:string
  port?:number
  outputDirectory:string|null
  ocrReady:boolean
  tools:ToolListing[]
  calls:ToolCallRecord[]
  error?:string
  canceled?:boolean
}
export interface AiToolsConnectionConfig {url:string;transport:'streamable-http';headers:{Authorization:string}}
export interface AiToolsHostAPI {
  aiToolsStatus():Promise<AiToolsStatus>
  aiToolsSetEnabled(enabled:boolean):Promise<AiToolsStatus>
  aiToolsSetToolEnabled(name:string,enabled:boolean):Promise<AiToolsStatus>
  aiToolsSelectDirectory():Promise<AiToolsStatus>
  aiToolsConnectionConfig():Promise<AiToolsConnectionConfig>
  aiToolsRotateToken():Promise<AiToolsStatus>
  aiToolsPrepareOcr():Promise<AiToolsStatus>
  aiToolsExecute(name:string,args:Record<string,unknown>):Promise<ToolResult>
  aiToolsClearCalls():Promise<AiToolsStatus>
}
