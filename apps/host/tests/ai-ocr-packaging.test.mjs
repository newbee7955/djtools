import test from 'node:test'
import assert from 'node:assert/strict'
import { cp, mkdtemp, mkdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'
import { load as loadYaml } from 'js-yaml'

const require=createRequire(import.meta.url),run=promisify(execFile)
const hostRoot=fileURLToPath(new URL('..',import.meta.url))
const root=await mkdtemp(join(tmpdir(),'doujiao-ocr-packaged-'))
const modules=join(root,'resources','app.asar.unpacked','node_modules')
await mkdir(modules,{recursive:true})
const config=loadYaml(await readFile(join(hostRoot,'electron-builder.yml'),'utf8'))
// Stage only actual builder-selected packages outside the repository ancestor chain.
// No NODE_PATH fallback or access to app.asar's dependency tree is available.
for(const pattern of config.asarUnpack){
 const match=/^node_modules\/([^/]+)\/\*\*$/.exec(pattern)
 assert.ok(match,`Unsupported unpack pattern: ${pattern}`)
 const name=match[1],source=dirname(require.resolve(`${name}/package.json`))
 await cp(source,join(modules,name),{recursive:true})
}
test.after(()=>rm(root,{recursive:true,force:true}))
async function isolated(script){return run(process.execPath,['-e',script,modules],{cwd:root,env:{...process.env,NODE_PATH:''},timeout:10000})}

test('Builder unpack layout loads the actual Tesseract entry and Node image adapter',{timeout:15000},async()=>{
 const result=await isolated(`
 const assert=require('node:assert/strict'),path=require('node:path');
 assert.equal(typeof global.fetch,'function');global.fetch=()=>{throw Error('Unexpected network access')};
 const root=process.argv[1],tesseract=require(path.join(root,'tesseract.js'));
 assert.equal(typeof tesseract.createWorker,'function');
 require(path.join(root,'tesseract.js/src/worker/node/loadImage'))(Buffer.from('image')).then(bytes=>{
   assert.equal(bytes.length,5);console.log('entry-and-image-adapter-loaded');
 });`)
 assert.match(result.stdout,/entry-and-image-adapter-loaded/)
})
test('Builder unpack layout boots the actual Node worker and local WASM core without models',{timeout:15000},async()=>{
 const result=await isolated(`
 const {Worker}=require('node:worker_threads');
 const thread=new Worker(\`
   const assert=require('node:assert/strict'),path=require('node:path');
   const {parentPort,workerData}=require('node:worker_threads');
   assert.equal(typeof global.fetch,'function');global.fetch=()=>{throw Error('Unexpected network access')};
   require(path.join(workerData,'tesseract.js/src/worker-script/node/index.js'));
   const getCore=require(path.join(workerData,'tesseract.js/src/worker-script/node/getCore.js'));
   (async()=>{const factory=await getCore(1,{}, {progress:()=>{}});
     const core=await factory();assert.equal(typeof core.FS.readFile,'function');
     parentPort.postMessage('worker-and-local-core-loaded');
   })().catch(error=>{throw error});
 \`,{eval:true,execArgv:[],workerData:process.argv[1]});
 thread.once('message',async message=>{await thread.terminate();console.log(message)});
 thread.once('error',async error=>{await thread.terminate();console.error(error);process.exitCode=1});`)
 assert.match(result.stdout,/worker-and-local-core-loaded/)
})
