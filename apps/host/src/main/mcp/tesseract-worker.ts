import { Worker } from 'node:worker_threads'
import { createRequire } from 'node:module'
import type { OcrLanguage } from './ocr-service.ts'

// A supervisor thread owns Tesseract's child worker, including initialization failures.
// Terminating it also stops its child threads; no unresolved createWorker can leak.
export async function createLocalOcrWorker(language:OcrLanguage,options:{langPath:string;gzip:false;cacheMethod:'none'}) {
  const require=createRequire(import.meta.url)
  const modulePath=require.resolve('tesseract.js').replace(/app\.asar([\\/])/,'app.asar.unpacked$1')
  const thread=new Worker(`
    const {parentPort,workerData}=require('node:worker_threads');
    const {createWorker}=require(workerData.modulePath);
    parentPort.once('message',async bytes=>{
      let worker;
      try {
        worker=await createWorker(workerData.language,1,{...workerData.options,logger:()=>{},errorHandler:()=>parentPort.postMessage({error:true})});
        const result=await worker.recognize(Buffer.from(bytes));
        parentPort.postMessage({text:result.data.text});
      }catch{parentPort.postMessage({error:true})}
      finally{if(worker)await worker.terminate()}
    });
  `,{eval:true,execArgv:[],workerData:{modulePath,language,options:{langPath:options.langPath,gzip:options.gzip,cacheMethod:options.cacheMethod}}})
  let rejection:((error:Error)=>void)|undefined
  // Install the error listener immediately, before any caller can request recognition.
  let startupError=false
  thread.on('error',()=>{startupError=true;rejection?.(Error('OCR worker failed'))})
  return {
    recognize(bytes:Buffer):Promise<{data:{text:string}}>{return new Promise((resolve,reject)=>{
      rejection=reject;if(startupError){reject(Error('OCR worker failed'));return}
      thread.once('message',value=>{if(value.error)reject(Error('OCR recognition failed'));else resolve({data:{text:value.text}})})
      thread.once('exit',()=>reject(Error('OCR worker stopped')))
      thread.postMessage(bytes)
    })},
    async terminate(){await thread.terminate()}
  }
}
