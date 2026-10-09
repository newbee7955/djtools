import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {EventEmitter} from 'node:events'
import vm from 'node:vm'
import ts from 'typescript'
import * as boundsCore from '../src/main/services/screen-recording-core.ts'
import {createHostTools} from '../src/main/mcp/host-tools.ts'
import {ImageArtifacts} from '../src/main/mcp/image-artifacts.ts'
const source=await readFile(new URL('../src/main/services/screenshot-service.ts',import.meta.url),'utf8')
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
const png='data:image/png;base64,iVBORw0KGgoAAA=='
const deferred=()=>{let resolve,reject;const promise=new Promise((r,j)=>{resolve=r;reject=j});return {promise,resolve,reject}}
const flush=()=>new Promise(resolve=>setImmediate(resolve))
function harness(){
 const handlers=new Map(),windows=[],writes=[],events=[],delays=[];let shows=0,hides=0,captures=0
 class FakeWindow extends EventEmitter {
  constructor(){super();this.webContents=new EventEmitter();this.webContents.id=windows.length+1;this.destroyed=false;windows.push(this)}
  isDestroyed(){return this.destroyed}isVisible(){return true}isMinimized(){return false}
  show(){shows++}hide(){hides++}focus(){}restore(){}setAlwaysOnTop(){}setVisibleOnAllWorkspaces(){}
  loadFile(){return Promise.resolve()}close(){this.destroyed=true;this.emit('closed')}
 }
 const main={isDestroyed:()=>false,isVisible:()=>true,isMinimized:()=>false,show:()=>{shows++},hide:()=>{hides++},focus(){},restore(){}}
 const electron={BrowserWindow:FakeWindow,app:{getPath:()=>'/user',getAppPath:()=>'/app'},screen:{getCursorScreenPoint:()=>({x:0,y:0}),getDisplayNearestPoint:()=>({bounds:{x:20,y:30,width:100,height:80},scaleFactor:1})},clipboard:{writeImage:image=>writes.push(image),writeText:text=>writes.push(text)},nativeImage:{createFromDataURL:value=>value},globalShortcut:{register:()=>true,unregister(){}},ipcMain:{handle:(name,fn)=>handlers.set(name,fn)},dialog:{},shell:{},desktopCapturer:{}}
 const module={exports:{}}
 const context={module,exports:module.exports,__dirname:'/app/main',Buffer,process:{platform:'test'},console:{log(){},error(){},warn(){}},setTimeout:fn=>{delays.push(fn);return 1},clearTimeout(){},require:name=>{if(name==='electron')return electron;if(name==='path')return {join:(...parts)=>parts.join('/')};if(name==='fs')return {existsSync:()=>true,writeFileSync(){},mkdirSync(){},unlinkSync(){}};if(name==='child_process')return {};if(name.includes('plugin-view'))return {PluginViewContainerManager:{getInstance:()=>({getActivePluginView:()=>({view:{webContents:{isDestroyed:()=>false,send:(...args)=>events.push(args)}}})})}};if(name.includes('screen-recording-core'))return boundsCore;throw Error(name)}}
 vm.runInNewContext(compiled,context)
 const service=module.exports.ScreenshotService.getInstance();service.init(main)
 service.captureDisplay=async()=>{captures++;return png}
 const finish=async(window=windows.at(-1))=>handlers.get('host:screenshot:finish')({sender:window.webContents},{dataUrl:png,bounds:{x:2,y:3,width:10,height:12}})
 return {service,handlers,windows,writes,events,delays,finish,get shows(){return shows},get captures(){return captures}}
}
for(const mode of ['snip','fullscreen'])test(`direct ${mode} capture returns image without clipboard or active-plugin delivery`,async()=>{
 const h=harness();const pending=h.service.capture({hideWindow:false,mode,directResultOnly:true});await flush();if(mode==='snip')await h.finish();const result=await pending;assert.equal(result.success,true);assert.equal(result.dataUrl,png);assert.equal(h.writes.length,0);assert.equal(h.events.length,0)
})
test('AI artifact rejection cannot disclose a captured image through legacy delivery',async()=>{
 const h=harness(),artifacts=new ImageArtifacts({maxCount:0});const tool=createHostTools({artifacts,ocr:{},workspace(){},pickImage:async()=>null,capture:signal=>h.service.capture({mode:'snip',hideWindow:false,directResultOnly:true,signal})}).find(t=>t.name==='screen_capture');const pending=tool.execute({},{});const rejection=assert.rejects(pending,/limit/);await flush();await h.finish();await rejection;assert.equal(h.writes.length,0);assert.equal(h.events.length,0)
})
test('legacy snip/fullscreen still deliver clipboard and plugin; recording selection only returns global bounds',async()=>{
 for(const mode of ['snip','fullscreen']){const h=harness();const pending=h.service.capture({mode,hideWindow:false});await flush();if(mode==='snip')await h.finish();assert.equal((await pending).success,true);assert.equal(h.writes.length,1);assert.equal(h.events.length,1)}
 const h=harness();const pending=h.service.capture({hideWindow:false,selectionOnly:true});await flush();await h.finish();const result=await pending;assert.equal(result.dataUrl,undefined);assert.deepEqual(JSON.parse(JSON.stringify(result.bounds)),{x:22,y:33,width:10,height:12});assert.equal(h.writes.length,0);assert.equal(h.events.length,0)
})
test('abort during hide settles immediately and never captures or opens overlay',async()=>{
 const h=harness(),controller=new AbortController();const pending=h.service.capture({directResultOnly:true,signal:controller.signal});let result;pending.then(value=>{result=value});controller.abort();await flush();assert.equal(result?.canceled,true);for(const delay of h.delays)delay();await flush();assert.equal(h.captures,0);assert.equal(h.windows.length,0)
})
test('abort during display settles immediately; old completion cannot change newer capture',async()=>{
 const h=harness(),display=deferred(),controller=new AbortController();h.service.captureDisplay=()=>display.promise;const old=h.service.capture({hideWindow:false,directResultOnly:true,signal:controller.signal});let result;old.then(value=>{result=value});await flush();controller.abort();await flush();assert.equal(result?.canceled,true)
 h.service.captureDisplay=async()=>png;const newer=h.service.capture({hideWindow:false,directResultOnly:true});await flush();const window=h.windows.at(-1),shows=h.shows;display.resolve(png);await flush();assert.equal(h.windows.length,1);assert.equal(h.service.captureWindow,window);assert.equal(h.shows,shows);await h.finish(window);assert.equal((await newer).success,true)
})
test('stale overlay closed/error callbacks do not cancel or restore a newer capture',async()=>{
 const h=harness();const old=h.service.capture({hideWindow:false,directResultOnly:true});await flush();const window=h.windows[0];h.service.cancelCapture();assert.equal((await old).canceled,true);const newer=h.service.capture({hideWindow:false,directResultOnly:true});await flush();const current=h.windows[1],shows=h.shows;window.emit('closed');window.webContents.emit('did-fail-load',{},-1,'stale');await flush();assert.equal(h.service.captureWindow,current);assert.equal(h.shows,shows);await h.finish(current);assert.equal((await newer).success,true)
})
test('stale overlay IPC cannot finish a newer capture or read its image',async()=>{
 const h=harness();const old=h.service.capture({hideWindow:false,directResultOnly:true});await flush();const previous=h.windows[0];h.service.cancelCapture();await old;const newer=h.service.capture({hideWindow:false,directResultOnly:true});await flush();const current=h.windows[1];assert.equal((await h.finish(previous)).success,false);const data=await h.handlers.get('host:screenshot:get-initial-data')({sender:previous.webContents});assert.equal(data.bgDataUrl,undefined);assert.equal(h.service.captureWindow,current);await h.finish(current);assert.equal((await newer).success,true)
})
test('direct overlay copy/save/pin/color actions cannot disclose data or prematurely complete capture',async()=>{
 const h=harness();const pending=h.service.capture({hideWindow:false,directResultOnly:true});await flush();const window=h.windows[0],event={sender:window.webContents};for(const [channel,value]of [['copy',png],['save-as',png],['pin',{dataUrl:png}],['copy-color','#fff']])assert.equal((await h.handlers.get(`host:screenshot:${channel}`)(event,value)).success,false);assert.equal(h.writes.length,0);assert.equal(h.service.captureWindow,window);await h.finish(window);assert.equal((await pending).success,true)
})
