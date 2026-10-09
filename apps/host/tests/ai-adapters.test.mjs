import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const load = async (name) => { try { return await import(`../src/main/mcp/${name}.ts`) } catch (e) { if (e.code === 'ERR_MODULE_NOT_FOUND') return {}; throw e } }
const md = await load('markdown-tools'), images = await load('image-artifacts'), ocr = await load('ocr-service')
const workerModule=await load('tesseract-worker')
async function workspace() { assert.equal(typeof md.MarkdownWorkspace,'function','MarkdownWorkspace implemented'); const root = await mkdtemp(join(tmpdir(),'dj-ai-')); return {root, ws:new md.MarkdownWorkspace(root, 16)} }
test('Markdown creates exclusively, reads UTF-8 and rejects unsafe names before writes', async()=>{
 const {root,ws}=await workspace(); await ws.create('a.md','中文'); assert.equal(await ws.read('a.md'),'中文');
 for(const p of ['../a.md','/a.md','C:\\a.md','CON.md','x.txt','x/../a.md','a.md:stream','a. /b.md']) await assert.rejects(ws.create(p,'oops'));
 await assert.rejects(ws.create('a.md','overwrite')); assert.equal(await readFile(join(root,'a.md'),'utf8'),'中文'); await assert.rejects(ws.create('b.md','中'.repeat(6))); assert.deepEqual(await ws.list(),['a.md']);
})
test('Markdown rejects junction/symlink escape and bounds reads',async()=>{
 const {root,ws}=await workspace(); const outside=await mkdtemp(join(tmpdir(),'dj-out-')); await writeFile(join(outside,'secret.md'),'secret'); await symlink(outside,join(root,'escape'),'junction'); await assert.rejects(ws.read('escape/secret.md')); await assert.rejects(ws.create('escape/new.md','x')); assert.deepEqual(await ws.list(),[]); await writeFile(join(root,'large.md'),'中'.repeat(6)); await assert.rejects(ws.read('large.md'));
})
test('Image session store keeps opaque IDs, copies bytes, bounds size/count and clears',async()=>{
 assert.equal(typeof images.ImageArtifacts,'function','ImageArtifacts implemented'); const store=new images.ImageArtifacts({maxBytes:16,maxTotalBytes:24,maxCount:2}); const png=Buffer.from('89504e470d0a1a0a0000','hex'); const a=store.add(png); png[0]=0; assert.equal(store.read(a.artifactId)[0],137); assert.equal(a.path,undefined); await assert.rejects(async()=>store.read('unknown')); await assert.rejects(async()=>store.add(Buffer.alloc(17))); store.add(store.read(a.artifactId)); await assert.rejects(async()=>store.add(store.read(a.artifactId))); store.clear(); await assert.rejects(async()=>store.read(a.artifactId));
})
test('OCR refuses missing models and terminates workers on success, failure and abort',async()=>{
 assert.equal(typeof ocr.OcrService,'function','OcrService implemented'); const root=await mkdtemp(join(tmpdir(),'dj-ocr-')); let created=0, terminated=0; let action=async()=>({data:{text:'hello'}});
 const service=new ocr.OcrService(root,async(_lang,options)=>{created++; assert.equal(options.langPath,root); assert.equal(options.gzip,false); return {recognize:()=>action(),terminate:async()=>{terminated++}}});
 await assert.rejects(service.recognize(Buffer.from('x'),'eng')); assert.equal(created,0); await writeFile(join(root,'eng.traineddata'),Buffer.alloc(1024)); assert.equal(await service.ready(),false); await writeFile(join(root,'chi_sim.traineddata'),Buffer.alloc(1024)); assert.equal(await service.ready(),true);
 assert.equal(await service.recognize(Buffer.from('x'),'eng'),'hello'); action=async()=>{throw Error('private')}; await assert.rejects(service.recognize(Buffer.from('x'),'eng')); assert.equal(terminated,2);
 const controller=new AbortController(); action=()=>new Promise(()=>{}); const pending=service.recognize(Buffer.from('x'),'eng',controller.signal); await new Promise(r=>setTimeout(r,20)); controller.abort(); await assert.rejects(pending,/abort/i); assert.equal(terminated,3); await service.stop();
})
test('OCR setup only downloads fixed models, bounded responses and no partial ready files',async()=>{
 assert.equal(typeof ocr.OcrService,'function'); const root=await mkdtemp(join(tmpdir(),'dj-model-')); const urls=[]; const service=new ocr.OcrService(root,async()=>{throw Error('unused')},async(url)=>{urls.push(url);return new Response(Buffer.alloc(1024))}); await service.prepare(); assert.equal(await service.ready(),true); assert.equal(urls.length,2); assert.equal(urls.every(u=>u.startsWith('https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/main/')),true);
 const badRoot=await mkdtemp(join(tmpdir(),'dj-bad-model-')); const bad=new ocr.OcrService(badRoot,async()=>{},async()=>new Response('bad',{status:500})); await assert.rejects(bad.prepare()); assert.equal(await bad.ready(),false);
})
test('OCR bounds active workers and stop waits for asynchronous worker termination',async()=>{const root=await mkdtemp(join(tmpdir(),'dj-busy-'));await writeFile(join(root,'eng.traineddata'),Buffer.alloc(1024));let terminated=false;const service=new ocr.OcrService(root,async()=>({recognize:()=>new Promise(()=>{}),terminate:async()=>{await new Promise(r=>setTimeout(r,30));terminated=true}}));const first=service.recognize(Buffer.from('a'),'eng');first.catch(()=>{});await new Promise(r=>setTimeout(r,10));await assert.rejects(Promise.race([service.recognize(Buffer.from('b'),'eng'),new Promise((_,reject)=>setTimeout(()=>reject(Error('timeout')),80))]),/busy/);await service.stop();assert.equal(terminated,true);await assert.rejects(first,/abort/i)})
test('Real supervisor worker accepts OCR service options without cloning callback functions',async()=>{const worker=await workerModule.createLocalOcrWorker('eng',{langPath:tmpdir(),gzip:false,cacheMethod:'none',logger:()=>{},errorHandler:()=>{}});await worker.terminate()})
test('Native-selected file import enforces byte bound and artifact identity independently of path',async()=>{const root=await mkdtemp(join(tmpdir(),'dj-import-'));const path=join(root,'x.png');const store=new images.ImageArtifacts({maxBytes:16});await writeFile(path,Buffer.from('89504e470d0a1a0a0000','hex'));const result=await store.importFile(path);assert.equal(result.mimeType,'image/png');assert.equal(store.read(result.artifactId).length,10);assert.equal(JSON.stringify(result).includes(root),false);await writeFile(path,Buffer.alloc(17));await assert.rejects(store.importFile(path));await assert.rejects(store.importFile(root))})
test('Canceled Markdown write never publishes a document',async()=>{const {ws}=await workspace();const signal=AbortSignal.abort();await assert.rejects(ws.create('canceled.md','text',signal));assert.deepEqual(await ws.list(),[])})
