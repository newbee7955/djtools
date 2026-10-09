import { mkdir, stat, open, rename, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
export type OcrLanguage = 'eng' | 'chi_sim' | 'eng+chi_sim'
interface OcrWorker {recognize(image:Buffer):Promise<{data:{text:string}}>;terminate():Promise<unknown>}
type WorkerFactory = (language: OcrLanguage, options: {langPath:string;gzip:false;cacheMethod:'none';logger:()=>void;errorHandler:()=>void})=>Promise<OcrWorker>
const models=['eng','chi_sim'] as const
const minModelBytes=1024, maxModelBytes=32*1024*1024
export class OcrService {
  private directory:string
  private factory:WorkerFactory
  private fetcher:typeof fetch
  private controllers=new Set<AbortController>()
  private completions=new Map<AbortController,Promise<void>>()
  constructor(directory:string,factory:WorkerFactory,fetcher:typeof fetch=fetch){this.directory=directory;this.factory=factory;this.fetcher=fetcher}
  private async modelReady(language:string){try{const s=await stat(join(this.directory,`${language}.traineddata`));return s.isFile() && s.size>=minModelBytes && s.size<=maxModelBytes}catch{return false}}
  async ready(){return (await Promise.all(models.map(l=>this.modelReady(l)))).every(Boolean)}
  async prepare(signal?:AbortSignal):Promise<void>{
    await mkdir(this.directory,{recursive:true})
    for(const language of models){
      if(await this.modelReady(language))continue
      const requestSignal=AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(120000)])
      const response=await this.fetcher(`https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/main/${language}.traineddata`,{signal:requestSignal,redirect:'error'})
      if(!response.ok || !response.body)throw Error('OCR model download failed')
      const declared=Number(response.headers.get('content-length'));if(declared>maxModelBytes) {await response.body.cancel();throw Error('OCR model too large')}
      const reader=response.body.getReader(), chunks:Buffer[]=[];let size=0
      try{while(true){signal?.throwIfAborted();const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>maxModelBytes)throw Error('OCR model too large');chunks.push(Buffer.from(value))}}finally{await reader.cancel().catch(()=>{})}
      if(size<minModelBytes)throw Error('Invalid OCR model')
      const temporary=join(this.directory,`.model-${randomUUID()}.tmp`), target=join(this.directory,`${language}.traineddata`)
      const file=await open(temporary,'wx',0o600);try{await file.writeFile(Buffer.concat(chunks));await file.sync();await file.close();signal?.throwIfAborted();await rename(temporary,target)}finally{await file.close().catch(()=>{});await unlink(temporary).catch(()=>{})}
    }
  }
  async recognize(bytes:Buffer,language:OcrLanguage,signal?:AbortSignal):Promise<string>{
    if(!['eng','chi_sim','eng+chi_sim'].includes(language))throw Error('Unsupported OCR language')
    if(this.controllers.size)throw Error('OCR is busy')
    const controller=new AbortController();this.controllers.add(controller)
    let finished:()=>void=()=>{}
    this.completions.set(controller,new Promise<void>(resolve=>{finished=resolve}))
    const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort()
    let worker:OcrWorker|undefined, termination:Promise<unknown>|undefined
    const terminate=async()=>{if(worker)termination??=worker.terminate();await termination}
    let rejectAbort:()=>void=()=>{}
    const aborted=new Promise<never>((_,reject)=>{rejectAbort=()=>reject(Error('OCR aborted'))})
    void aborted.catch(()=>{})
    const onAbort=()=>{rejectAbort();void terminate().catch(()=>{})};controller.signal.addEventListener('abort',onAbort,{once:true})
    try{
      for(const model of language.split('+'))if(!await this.modelReady(model))throw Error('OCR models are not prepared')
      controller.signal.throwIfAborted()
      const creation=this.factory(language,{langPath:this.directory,gzip:false,cacheMethod:'none',logger:()=>{},errorHandler:()=>{}}).then(async value=>{worker=value;if(controller.signal.aborted)await terminate();return value})
      worker=await Promise.race([creation,aborted]);controller.signal.throwIfAborted()
      const result=await Promise.race([worker.recognize(bytes),aborted]);return result.data.text
    }finally{signal?.removeEventListener('abort',abort);controller.signal.removeEventListener('abort',onAbort);try{await terminate()}finally{this.controllers.delete(controller);this.completions.delete(controller);finished()}}
  }
  async stop():Promise<void>{for(const controller of this.controllers)controller.abort();await Promise.all(this.completions.values())}
}
