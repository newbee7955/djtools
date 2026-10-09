import { randomUUID } from 'node:crypto'
import { open } from 'node:fs/promises'
export class ImageArtifacts {
  private images = new Map<string,Buffer>()
  private total=0
  private limits: {maxBytes:number;maxTotalBytes:number;maxCount:number}
  constructor(options: Partial<{maxBytes:number;maxTotalBytes:number;maxCount:number}>={}) {this.limits={maxBytes:20*1024*1024,maxTotalBytes:64*1024*1024,maxCount:12,...options}}
  add(bytes:Buffer): {artifactId:string;mimeType:string;size:number} {
    if(!bytes.length || bytes.length>this.limits.maxBytes || this.total+bytes.length>this.limits.maxTotalBytes || this.images.size>=this.limits.maxCount) throw Error('Image store limit exceeded')
    let mimeType: string
    if(bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))) mimeType='image/png'
    else if(bytes[0]===255 && bytes[1]===216 && bytes[2]===255) mimeType='image/jpeg'
    else if(bytes.toString('ascii',0,4)==='RIFF' && bytes.toString('ascii',8,12)==='WEBP') mimeType='image/webp'
    else throw Error('Unsupported image')
    const artifactId=randomUUID(); this.images.set(artifactId,Buffer.from(bytes));this.total+=bytes.length; return {artifactId,mimeType,size:bytes.length}
  }
  async importFile(path:string,signal?:AbortSignal) {signal?.throwIfAborted();const file=await open(path,'r');try {const stat=await file.stat();if(!stat.isFile()||stat.size>this.limits.maxBytes)throw Error('Image is too large');const bytes=Buffer.alloc(this.limits.maxBytes+1);const {bytesRead}=await file.read(bytes,0,bytes.length,0);signal?.throwIfAborted();return this.add(bytes.subarray(0,bytesRead))}finally{await file.close()}}
  read(id:string):Buffer {const bytes=this.images.get(id);if(!bytes)throw Error('Unknown image artifact');return Buffer.from(bytes)}
  clear():void {this.images.clear();this.total=0}
}
