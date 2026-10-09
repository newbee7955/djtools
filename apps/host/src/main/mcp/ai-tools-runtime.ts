import { randomBytes } from 'node:crypto'
import { isAbsolute } from 'node:path'
import { ToolRegistry } from './tool-registry.ts'
import { LocalMcpServer } from './mcp-server.ts'
import type { RegisteredTool } from '../../shared/ai-tools.ts'
import type { AiToolsStatus, AiToolsConnectionConfig } from '../../shared/ai-tools-runtime.ts'
interface Config {version:1;enabled:boolean;tools:Record<string,boolean>;outputDirectory:string|null;encryptedToken:string}
interface Server {start():Promise<{url:string;port:number}>;stop():Promise<void>}
interface Options {
  load():Promise<unknown>;save(config:Config):Promise<void>;encrypt(token:string):string;decrypt(encrypted:string):string
  tools:RegisteredTool[];isPluginEnabled:(id:string)=>boolean;approve:NonNullable<ConstructorParameters<typeof ToolRegistry>[0]>['approve']
  ocr:{ready():Promise<boolean>;prepare(signal?:AbortSignal):Promise<void>;stop():Promise<void>};artifacts:{clear():void}
  serverFactory?:(registry:ToolRegistry,token:string)=>Server
}
const defaults=():Config=>({version:1,enabled:false,tools:{},outputDirectory:null,encryptedToken:''})
export class AiToolsRuntime {
  private options:Options
  private config=defaults()
  private token=''
  readonly registry:ToolRegistry
  private server?:Server
  private endpoint?:{url:string;port:number}
  private error?:string
  private queue:Promise<unknown>=Promise.resolve()
  private controllers=new Set<AbortController>()
  private closed=false
  private ocrGeneration=0
  private revision=0
  constructor(options:Options){this.options=options;this.registry=new ToolRegistry({isPluginEnabled:options.isPluginEnabled,approve:async(tool,args,context)=>{
    const revision=this.revision,controller=new AbortController();const abort=()=>controller.abort();context.signal?.addEventListener('abort',abort,{once:true});if(context.signal?.aborted)abort();this.controllers.add(controller)
    try{return await options.approve?.(tool,args,{...context,signal:controller.signal})===true&&revision===this.revision&&!controller.signal.aborted&&!this.closed}finally{context.signal?.removeEventListener('abort',abort);this.controllers.delete(controller)}
  }});for(const tool of options.tools)this.registry.register({...tool,execute:async(args,context)=>{
    if(this.closed)throw Error('AI tools stopped')
    const controller=new AbortController();const abort=()=>controller.abort();context.signal?.addEventListener('abort',abort,{once:true});if(context.signal?.aborted)abort();this.controllers.add(controller)
    try{return await tool.execute(args,{...context,signal:controller.signal})}finally{context.signal?.removeEventListener('abort',abort);this.controllers.delete(controller)}
  }})}
  private serial<T>(action:()=>Promise<T>):Promise<T>{const result=this.queue.then(action);this.queue=result.catch(()=>{});return result}
  init():Promise<void>{return this.serial(async()=>{
    try {
      const value=await this.options.load()
      if(value===undefined||value===null)return
      if(typeof value!=='object'||Array.isArray(value))throw Error()
      const c=value as Config
      if(c.version!==1||typeof c.enabled!=='boolean'||!c.tools||typeof c.tools!=='object'||Array.isArray(c.tools)||Object.entries(c.tools).some(([name,v])=>!this.registry.listTools(true).some(t=>t.name===name)||typeof v!=='boolean')||(c.outputDirectory!==null&&(typeof c.outputDirectory!=='string'||!isAbsolute(c.outputDirectory)))||typeof c.encryptedToken!=='string')throw Error()
      const token=this.options.decrypt(c.encryptedToken);if(!/^[A-Za-z0-9_-]{43,}$/.test(token))throw Error()
      this.config=structuredClone(c);this.token=token;for(const [name,enabled]of Object.entries(c.tools))this.registry.setEnabled(name,enabled)
      if(c.enabled)await this.start()
    }catch{this.config=defaults();this.token='';this.error='AI tools configuration is unavailable'}
  })}
  async status():Promise<AiToolsStatus>{await this.queue;return {enabled:this.config.enabled,running:Boolean(this.endpoint),...this.endpoint,outputDirectory:this.config.outputDirectory,ocrReady:await this.options.ocr.ready(),tools:this.registry.listTools(true),calls:this.registry.getCalls(),...(this.error?{error:this.error}:{})}}
  outputDirectory():string|null{return this.config.outputDirectory}
  private async persist(next:Config,token=this.token):Promise<void>{if(!token)token=randomBytes(32).toString('base64url');try{next.encryptedToken=this.options.encrypt(token);await this.options.save(next)}catch{this.error='AI tools settings could not be saved';throw Error('AI tools settings could not be saved')}this.config=next;this.token=token;this.revision++;this.error=undefined}
  private async start(){if(this.server||this.closed)return;this.error=undefined;const server=this.options.serverFactory?.(this.registry,this.token)??new LocalMcpServer({registry:this.registry,token:this.token});this.server=server;try{this.endpoint=await server.start()}catch{await server.stop().catch(()=>{});this.server=undefined;this.endpoint=undefined;this.error='Local MCP could not start'}}
  private async cleanup(){for(const controller of this.controllers)controller.abort();this.controllers.clear();await this.options.ocr.stop();this.options.artifacts.clear();const server=this.server;this.server=undefined;this.endpoint=undefined;if(server)await server.stop()}
  async setEnabled(enabled:boolean){if(typeof enabled!=='boolean')throw Error('Invalid enabled flag');if(!enabled){this.ocrGeneration++;for(const controller of this.controllers)controller.abort()}await this.serial(async()=>{if(this.closed)throw Error('AI tools stopped');if(!enabled)await this.cleanup();await this.persist({...this.config,enabled});if(enabled)await this.start()});return this.status()}
  async setToolEnabled(name:string,enabled:boolean){if(typeof enabled!=='boolean'||!this.registry.listTools(true).some(t=>t.name===name))throw Error('Invalid tool setting');await this.serial(async()=>{await this.persist({...this.config,tools:{...this.config.tools,[name]:enabled}});this.registry.setEnabled(name,enabled)});return this.status()}
  async setDirectory(directory:string){if(typeof directory!=='string'||!isAbsolute(directory))throw Error('Invalid output directory');await this.serial(()=>this.persist({...this.config,outputDirectory:directory}));return this.status()}
  async rotateToken(){await this.serial(async()=>{await this.persist({...this.config},randomBytes(32).toString('base64url'));await this.cleanup();if(this.config.enabled)await this.start()});return this.status()}
  async connectionConfig():Promise<AiToolsConnectionConfig>{await this.queue;if(!this.endpoint||!this.token)throw Error('Enable local MCP before copying connection settings');return {url:this.endpoint.url,transport:'streamable-http',headers:{Authorization:`Bearer ${this.token}`}}}
  async prepareOcr(){if(this.closed)throw Error('AI tools stopped');const generation=this.ocrGeneration;await this.serial(async()=>{if(this.closed)throw Error('AI tools stopped');if(generation!==this.ocrGeneration)throw Error('OCR setup canceled');const controller=new AbortController();this.controllers.add(controller);try{await this.options.ocr.prepare(controller.signal)}finally{this.controllers.delete(controller)}});return this.status()}
  async execute(name:string,args:Record<string,unknown>){await this.queue;if(this.closed)throw Error('AI tools stopped');const controller=new AbortController();this.controllers.add(controller);try{return await this.registry.execute(name,args,{source:'host',clientId:'host-ui',signal:controller.signal})}finally{this.controllers.delete(controller)}}
  async clearCalls(){this.registry.clearCalls();return this.status()}
  stop():Promise<void>{this.closed=true;this.ocrGeneration++;for(const controller of this.controllers)controller.abort();return this.serial(()=>this.cleanup())}
}
