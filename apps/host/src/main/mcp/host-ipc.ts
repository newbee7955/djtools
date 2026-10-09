import { app, ipcMain, dialog, safeStorage, type BrowserWindow } from 'electron'
import { open, rename, unlink, realpath, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import { AiToolsRuntime } from './ai-tools-runtime'
import { createHostTools } from './host-tools'
import { ImageArtifacts } from './image-artifacts'
import { MarkdownWorkspace } from './markdown-tools'
import { NotepadWorkspace } from './notepad-tools'
import { OcrService } from './ocr-service'
import { createLocalOcrWorker } from './tesseract-worker'
import { isTrustedHostRequest } from './host-request-guard'
import { approvalSummary } from './approval-summary'
import { PluginManager } from '../plugins/plugin-manager'
import { ScreenshotService } from '../services/screenshot-service'
import { WorkspaceService } from '../services/workspace-service'
import { ClipboardHistoryService } from '../services/clipboard-service'
import { is } from '@electron-toolkit/utils'

let window:BrowserWindow|undefined
let runtime:AiToolsRuntime|undefined
let initialized:Promise<void>|undefined
let registered=false
function encryptionAvailable(){if(!safeStorage.isEncryptionAvailable() || (process.platform==='linux'&&safeStorage.getSelectedStorageBackend()==='basic_text'))throw Error('Secure credential storage unavailable')}
function getRuntime():AiToolsRuntime {
  if(runtime)return runtime
  const configPath=join(app.getPath('userData'),'ai-tools-config.json')
  const artifacts=new ImageArtifacts(), ocr=new OcrService(join(app.getPath('userData'),'ai-ocr-models'),createLocalOcrWorker)
  runtime=new AiToolsRuntime({
    load:async()=>{try{const file=await open(configPath,'r');try{if((await file.stat()).size>64*1024)throw Error();return JSON.parse(await file.readFile('utf8'))}finally{await file.close()}}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return undefined;throw Error('Invalid configuration')}},
    save:async config=>{const temp=`${configPath}.${randomUUID()}.tmp`;const file=await open(temp,'wx',0o600);try{await file.writeFile(JSON.stringify(config),'utf8');await file.sync();await file.close();await rename(temp,configPath)}finally{await file.close().catch(()=>{});await unlink(temp).catch(()=>{})}},
    encrypt:token=>{encryptionAvailable();return safeStorage.encryptString(token).toString('base64')},
    decrypt:value=>{encryptionAvailable();if(!/^[A-Za-z0-9+/]+={0,2}$/.test(value))throw Error();return safeStorage.decryptString(Buffer.from(value,'base64'))},
    artifacts,ocr,isPluginEnabled:id=>PluginManager.getInstance().isPluginAvailable(id),
    approve:async(tool,args,context)=>{if(!window||window.isDestroyed()||context.signal?.aborted)return false;const result=await dialog.showMessageBox(window,{type:'question',title:'AI 工具调用确认',message:`外部 AI 请求执行：${tool.title}`,detail:approvalSummary(tool.name,args,runtime?.outputDirectory()??null,WorkspaceService.getInstance().getDirectory('notepad')),buttons:['取消','允许本次'],defaultId:0,cancelId:0,noLink:true});return result.response===1&&!context.signal?.aborted},
    tools:createHostTools({artifacts,ocr,workspace:()=>{const root=runtime?.outputDirectory();if(!root)throw Error('Select a Markdown directory first');return new MarkdownWorkspace(root)},
      capture:async signal=>ScreenshotService.getInstance().capture({mode:'snip',hideWindow:true,directResultOnly:true,signal}),
      captureFullscreen:async signal=>ScreenshotService.getInstance().capture({mode:'fullscreen',hideWindow:true,directResultOnly:true,signal}),
      pickImage:async()=>{if(!window||window.isDestroyed())throw Error('Host window unavailable');const selected=await dialog.showOpenDialog(window,{title:'选择 OCR 图片',properties:['openFile'],filters:[{name:'图片',extensions:['png','jpg','jpeg','webp']}]});return selected.canceled?null:selected.filePaths[0]??null},
      notepadWorkspace:()=>new NotepadWorkspace(WorkspaceService.getInstance().getDirectory('notepad')),
      clipboardHistory:()=>ClipboardHistoryService.getInstance().getHistory(),
      clipboardWrite:text=>ClipboardHistoryService.getInstance().writeText(text)
    })
  })

  initialized=runtime.init();return runtime
}
export async function startAiToolsRuntime(){const result=getRuntime();await initialized;return result.status()}
export async function stopAiToolsRuntime(){await runtime?.stop()}
export function registerAiToolsIpc(mainWindow:BrowserWindow):void {
  window=mainWindow;if(registered)return;registered=true
  const expectedUrl=is.dev&&process.env.ELECTRON_RENDERER_URL?new URL(process.env.ELECTRON_RENDERER_URL).href:pathToFileURL(join(__dirname,'../renderer/index.html')).href
  const handle=(channel:string,action:(...args:any[])=>Promise<unknown>)=>ipcMain.handle(`host:ai-tools:${channel}`,async(event,...args)=>{
    if(!window||window.isDestroyed()||!isTrustedHostRequest(event,window.webContents,expectedUrl))throw Error('Host request denied')
    getRuntime();await initialized
    try{return await action(...args)}catch{throw Error('AI tools operation failed')}
  })
  handle('status',()=>getRuntime().status())
  handle('set-enabled',enabled=>getRuntime().setEnabled(enabled))
  handle('set-tool-enabled',(name,enabled)=>getRuntime().setToolEnabled(name,enabled))
  handle('select-directory',async()=>{const selected=await dialog.showOpenDialog(window!,{title:'选择 Markdown 工作目录',defaultPath:WorkspaceService.getInstance().getDirectory('markdown-editor'),properties:['openDirectory']});if(selected.canceled)return {...await getRuntime().status(),canceled:true};const directory=await realpath(selected.filePaths[0]);if(!(await stat(directory)).isDirectory())throw Error();return getRuntime().setDirectory(directory)})
  handle('connection-config',()=>getRuntime().connectionConfig())
  handle('rotate-token',()=>getRuntime().rotateToken())
  handle('prepare-ocr',()=>getRuntime().prepareOcr())
  handle('execute',(name,args)=>getRuntime().execute(name,args))
  handle('clear-calls',()=>getRuntime().clearCalls())
}
