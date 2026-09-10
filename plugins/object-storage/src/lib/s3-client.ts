import type { StorageProfile, BucketItem, StorageObjectItem } from './types'
import { signS3Request, createPresignedUrl, sha256Hex } from './s3-signer'

export class S3Client {
  private profile: StorageProfile

  constructor(profile: StorageProfile) {
    this.profile = profile
  }

  /**
   * 计算标准基础 URL (包含协议)
   */
  private getBaseUrl(bucket?: string): string {
    let ep = this.profile.endpoint.trim()
    let protocol = this.profile.useSSL === false ? 'http://' : 'https://'
    if (ep.startsWith('http://') || ep.startsWith('https://')) {
      const parsed = new URL(ep)
      protocol = parsed.protocol + '//'
      ep = parsed.host
    }

    // 移除末尾斜杠
    ep = ep.replace(/\/+$/, '')

    if (!bucket) {
      return `${protocol}${ep}`
    }

    if (this.profile.pathStyle) {
      // Path-style: https://endpoint/bucket
      return `${protocol}${ep}/${encodeURIComponent(bucket)}`
    } else {
      // Virtual-hosted style: https://bucket.endpoint
      // 容错保护：若用户已在 Endpoint 中填入了含 Bucket 的完整域名，避免拼出 bucket.bucket.endpoint
      if (ep.toLowerCase().startsWith(bucket.toLowerCase() + '.')) {
        return `${protocol}${ep}`
      }
      return `${protocol}${bucket}.${ep}`
    }
  }

  /**
   * 执行带签名的受控网络请求（优先原生 fetch，CORS 阻断时自动降级走宿主代理）
   */
  private async executeRequest(options: {
    method: string
    url: string
    headers?: Record<string, string>
    body?: any
    payloadSha256?: string
  }): Promise<{ status: number; statusText: string; headers: Headers | Record<string, string>; text: string; rawResponse?: Response }> {
    const { method, url, headers = {}, body, payloadSha256 = 'UNSIGNED-PAYLOAD' } = options

    const signedHeaders = await signS3Request({
      method,
      url,
      headers,
      payloadSha256,
      accessKeyId: this.profile.accessKeyId,
      secretAccessKey: this.profile.secretAccessKey,
      region: this.profile.region || 'us-east-1'
    })

    // S3 签名必须包含 host 进行计算，但在实际发出 HTTP 请求时，
    // 浏览器 fetch 与 Chromium net.fetch 会自动设置 Host 头，手动传入会触发 net::ERR_INVALID_ARGUMENT
    const outgoingHeaders: Record<string, string> = {}
    for (const [k, v] of Object.entries(signedHeaders)) {
      if (k.toLowerCase() !== 'host') {
        outgoingHeaders[k] = v
      }
    }

    // 1. 优先走宿主主进程网络代理，完全免除 Chromium 沙箱协议的 CORS 限制与 preflight 探测
    const hostSdk = (window as any).doujiaoSDK?.network
    if (hostSdk && typeof hostSdk.request === 'function') {
      const hostResp = await hostSdk.request({
        url,
        method: method as any,
        headers: outgoingHeaders,
        body: typeof body === 'string'
          ? body
          : (ArrayBuffer.isView(body) || body instanceof ArrayBuffer ? body : undefined)
      })
      return {
        status: hostResp.status,
        statusText: hostResp.statusText,
        headers: hostResp.headers,
        text: typeof hostResp.data === 'string' ? hostResp.data : JSON.stringify(hostResp.data)
      }
    }

    // 2. 独立纯网页环境降级尝试原生 fetch
    try {
      const resp = await fetch(url, {
        method,
        headers: outgoingHeaders,
        body
      })

      const text = await resp.text()
      return {
        status: resp.status,
        statusText: resp.statusText,
        headers: resp.headers,
        text,
        rawResponse: resp
      }
    } catch (fetchErr: any) {
      throw fetchErr
    }
  }

  /**
   * 获取存储桶列表 (ListBuckets)
   */
  async listBuckets(): Promise<BucketItem[]> {
    const url = `${this.getBaseUrl()}/`
    const res = await this.executeRequest({ method: 'GET', url })

    if (res.status >= 300) {
      throw new Error(`获取存储桶失败 (${res.status}): ${this.parseErrorMessage(res.text)}`)
    }

    const parser = new DOMParser()
    const xml = parser.parseFromString(res.text, 'application/xml')
    const bucketNodes = xml.querySelectorAll('Buckets > Bucket')
    const buckets: BucketItem[] = []

    bucketNodes.forEach((node) => {
      const name = node.querySelector('Name')?.textContent || ''
      const creationDate = node.querySelector('CreationDate')?.textContent || ''
      if (name) {
        buckets.push({ name, creationDate })
      }
    })

    return buckets
  }

  /**
   * 获取对象与虚拟子目录列表 (ListObjectsV2)
   */
  async listObjects(bucket: string, prefix = '', delimiter = '/'): Promise<{
    objects: StorageObjectItem[]
    isTruncated: boolean
    nextContinuationToken?: string
  }> {
    const baseUrl = this.getBaseUrl(bucket)
    const query = new URLSearchParams()
    query.set('list-type', '2')
    query.set('delimiter', delimiter)
    if (prefix) {
      query.set('prefix', prefix)
    }

    const url = `${baseUrl}${this.profile.pathStyle ? '' : '/'}?${query.toString()}`
    const res = await this.executeRequest({ method: 'GET', url })

    if (res.status >= 300) {
      throw new Error(`读取目录失败 (${res.status}): ${this.parseErrorMessage(res.text)}`)
    }

    const parser = new DOMParser()
    const xml = parser.parseFromString(res.text, 'application/xml')
    const objects: StorageObjectItem[] = []

    // 1. 解析子文件夹 (CommonPrefixes)
    const commonPrefixes = xml.querySelectorAll('CommonPrefixes > Prefix')
    commonPrefixes.forEach((node) => {
      const fullPrefix = node.textContent || ''
      if (fullPrefix) {
        // 剥离当前 prefix 获得相对文件夹名
        const relativeName = fullPrefix.slice(prefix.length).replace(/\/$/, '')
        if (relativeName) {
          objects.push({
            name: relativeName,
            key: fullPrefix,
            isDirectory: true,
            size: 0,
            extension: ''
          })
        }
      }
    })

    // 2. 解析文件列表 (Contents)
    const contents = xml.querySelectorAll('Contents')
    contents.forEach((node) => {
      const key = node.querySelector('Key')?.textContent || ''
      // 跳过目录自身或空 key
      if (!key || key === prefix || key.endsWith('/')) {
        return
      }

      const size = parseInt(node.querySelector('Size')?.textContent || '0', 10)
      const lastModified = node.querySelector('LastModified')?.textContent || ''
      const etag = (node.querySelector('ETag')?.textContent || '').replace(/"/g, '')
      const storageClass = node.querySelector('StorageClass')?.textContent || 'STANDARD'

      // 获取当前文件名
      const fileName = key.slice(prefix.length)
      const ext = fileName.includes('.') ? fileName.split('.').pop()?.toLowerCase() || '' : ''

      objects.push({
        name: fileName,
        key,
        isDirectory: false,
        size,
        lastModified,
        etag,
        storageClass,
        extension: ext
      })
    })

    const isTruncated = xml.querySelector('IsTruncated')?.textContent === 'true'
    const nextContinuationToken = xml.querySelector('NextContinuationToken')?.textContent || undefined

    return { objects, isTruncated, nextContinuationToken }
  }

  /**
   * 上传文件对象 (PutObject)
   */
  async putObject(
    bucket: string,
    key: string,
    data: File | Blob | ArrayBuffer | Uint8Array | string,
    contentType = 'application/octet-stream',
    onProgress?: (progress: number) => void
  ): Promise<void> {
    const baseUrl = this.getBaseUrl(bucket)
    const cleanKey = key.startsWith('/') ? key.slice(1) : key
    const url = `${baseUrl}/${cleanKey.split('/').map(encodeURIComponent).join('/')}`

    const signedHeaders = await signS3Request({
      method: 'PUT',
      url,
      headers: {
        'content-type': contentType
      },
      payloadSha256: 'UNSIGNED-PAYLOAD',
      accessKeyId: this.profile.accessKeyId,
      secretAccessKey: this.profile.secretAccessKey,
      region: this.profile.region || 'us-east-1'
    })

    const outgoingHeaders: Record<string, string> = {}
    for (const [k, v] of Object.entries(signedHeaders)) {
      if (k.toLowerCase() !== 'host') {
        outgoingHeaders[k] = v
      }
    }

    // 1. 优先通过宿主主进程安全网络代理上传，彻底规避浏览器端 CORS 跨域拦截
    const hostSdk = (window as any).doujiaoSDK?.network
    if (hostSdk && typeof hostSdk.request === 'function') {
      if (onProgress) onProgress(15)

      let uint8Array: Uint8Array
      if (data instanceof Blob) {
        const ab = await data.arrayBuffer()
        uint8Array = new Uint8Array(ab)
      } else if (data instanceof ArrayBuffer) {
        uint8Array = new Uint8Array(data)
      } else if (data instanceof Uint8Array) {
        uint8Array = data
      } else if (typeof data === 'string') {
        uint8Array = new TextEncoder().encode(data)
      } else {
        const ab = (data as any).buffer || new ArrayBuffer(0)
        uint8Array = new Uint8Array(ab)
      }

      if (onProgress) onProgress(40)

      const timeoutMs = Math.max(120000, Math.ceil(uint8Array.byteLength / (50 * 1024)) * 1000)

      const hostResp = await hostSdk.request({
        url,
        method: 'PUT',
        headers: outgoingHeaders,
        body: uint8Array,
        timeout: timeoutMs
      })

      if (hostResp.status >= 200 && hostResp.status < 300) {
        if (onProgress) onProgress(100)
        return
      } else {
        const errorMsg = typeof hostResp.data === 'string' ? hostResp.data : JSON.stringify(hostResp.data)
        throw new Error(`上传失败 (${hostResp.status}): ${this.parseErrorMessage(errorMsg)}`)
      }
    }

    // 2. 独立纯网页环境降级尝试 XMLHttpRequest
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open('PUT', url)

      for (const [k, v] of Object.entries(outgoingHeaders)) {
        xhr.setRequestHeader(k, v)
      }

      if (xhr.upload && onProgress) {
        xhr.upload.onprogress = (evt) => {
          if (evt.lengthComputable) {
            const pct = Math.round((evt.loaded / evt.total) * 100)
            onProgress(pct)
          }
        }
      }

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          if (onProgress) onProgress(100)
          resolve()
        } else {
          reject(new Error(`上传失败 (${xhr.status}): ${this.parseErrorMessage(xhr.responseText)}`))
        }
      }

      xhr.onerror = () => {
        reject(new Error('上传网络异常或跨域请求受阻，请确保存储桶配置了允许 PUT 的 CORS 规则'))
      }

      xhr.send(data as any)
    })
  }

  /**
   * 创建虚拟文件夹 (以 / 结尾的空对象)
   */
  async createFolder(bucket: string, prefix: string, folderName: string): Promise<void> {
    const cleanName = folderName.trim().replace(/\/+$/, '')
    if (!cleanName) return

    const key = `${prefix}${cleanName}/`
    const baseUrl = this.getBaseUrl(bucket)
    const cleanKey = key.startsWith('/') ? key.slice(1) : key
    const url = `${baseUrl}/${cleanKey.split('/').map(encodeURIComponent).join('/')}`

    const res = await this.executeRequest({
      method: 'PUT',
      url,
      headers: {
        'content-type': 'application/x-directory'
      },
      body: '',
      payloadSha256: await sha256Hex('')
    })

    if (res.status >= 300) {
      throw new Error(`创建文件夹失败 (${res.status}): ${this.parseErrorMessage(res.text)}`)
    }
  }

  /**
   * 删除单个对象 (DeleteObject)
   */
  async deleteObject(bucket: string, key: string): Promise<void> {
    const baseUrl = this.getBaseUrl(bucket)
    const cleanKey = key.startsWith('/') ? key.slice(1) : key
    const url = `${baseUrl}/${cleanKey.split('/').map(encodeURIComponent).join('/')}`

    const res = await this.executeRequest({ method: 'DELETE', url })
    if (res.status >= 300 && res.status !== 404) {
      throw new Error(`删除失败 (${res.status}): ${this.parseErrorMessage(res.text)}`)
    }
  }

  /**
   * 批量删除对象 (DeleteObjects)
   */
  async deleteObjects(bucket: string, keys: string[]): Promise<void> {
    if (!keys || keys.length === 0) return

    const baseUrl = this.getBaseUrl(bucket)
    const url = `${baseUrl}${this.profile.pathStyle ? '' : '/'}?delete`

    const xmlBody = `<?xml version="1.0" encoding="UTF-8"?>
<Delete>
  <Quiet>true</Quiet>
  ${keys.map((k) => `<Object><Key>${this.escapeXml(k)}</Key></Object>`).join('\n  ')}
</Delete>`

    const payloadSha256 = await sha256Hex(xmlBody)
    const res = await this.executeRequest({
      method: 'POST',
      url,
      headers: {
        'content-type': 'application/xml',
        'content-length': xmlBody.length.toString()
      },
      body: xmlBody,
      payloadSha256
    })

    if (res.status >= 300) {
      throw new Error(`批量删除失败 (${res.status}): ${this.parseErrorMessage(res.text)}`)
    }
  }

  /**
   * 重命名/移动对象 (CopyObject + DeleteObject)
   */
  async renameObject(bucket: string, oldKey: string, newKey: string): Promise<void> {
    const baseUrl = this.getBaseUrl(bucket)
    const cleanNewKey = newKey.startsWith('/') ? newKey.slice(1) : newKey
    const url = `${baseUrl}/${cleanNewKey.split('/').map(encodeURIComponent).join('/')}`

    // x-amz-copy-source 格式: /bucket/source-key
    const copySource = `/${bucket}/${oldKey.split('/').map(encodeURIComponent).join('/')}`

    const res = await this.executeRequest({
      method: 'PUT',
      url,
      headers: {
        'x-amz-copy-source': copySource
      }
    })

    if (res.status >= 300) {
      throw new Error(`复制对象失败 (${res.status}): ${this.parseErrorMessage(res.text)}`)
    }

    // 复制成功后删除旧对象
    await this.deleteObject(bucket, oldKey)
  }

  /**
   * 获取用于直接访问的预签名链接 (Presigned URL)
   */
  async getPresignedUrl(bucket: string, key: string, expiresInSeconds = 3600): Promise<string> {
    const baseUrl = this.getBaseUrl(bucket)
    const cleanKey = key.startsWith('/') ? key.slice(1) : key
    const url = `${baseUrl}/${cleanKey.split('/').map(encodeURIComponent).join('/')}`

    return await createPresignedUrl({
      url,
      accessKeyId: this.profile.accessKeyId,
      secretAccessKey: this.profile.secretAccessKey,
      region: this.profile.region || 'us-east-1',
      expiresInSeconds
    })
  }

  /**
   * 获取自定义 CDN 或公共 URL
   */
  getPublicUrl(bucket: string, key: string): string {
    const cleanKey = key.startsWith('/') ? key.slice(1) : key
    if (this.profile.customDomain) {
      const domain = this.profile.customDomain.replace(/\/+$/, '')
      return `${domain}/${cleanKey}`
    }
    return `${this.getBaseUrl(bucket)}/${cleanKey}`
  }

  /**
   * 获取文本文件内容（用于代码/文本在线预览）
   */
  async getTextContent(bucket: string, key: string, maxBytes = 500000): Promise<string> {
    const url = await this.getPresignedUrl(bucket, key, 300)
    let text = ''
    try {
      const resp = await fetch(url)
      if (!resp.ok) {
        throw new Error(`加载文件内容失败 (${resp.status}): ${resp.statusText}`)
      }
      text = await resp.text()
    } catch (fetchErr: any) {
      const hostSdk = (window as any).doujiaoSDK?.network
      if (hostSdk && typeof hostSdk.request === 'function') {
        const hostResp = await hostSdk.request({ url, method: 'GET' })
        if (hostResp.status >= 200 && hostResp.status < 300) {
          text = typeof hostResp.data === 'string' ? hostResp.data : JSON.stringify(hostResp.data)
        } else {
          throw new Error(`加载文件内容失败 (${hostResp.status}): ${hostResp.statusText || ''}`)
        }
      } else {
        throw fetchErr
      }
    }
    if (text.length > maxBytes) {
      return text.slice(0, maxBytes) + '\n\n... (文件过长，已截断显示)'
    }
    return text
  }

  /**
   * 测试连接有效性
   */
  async testConnection(): Promise<{ success: boolean; message?: string }> {
    try {
      if (this.profile.defaultBucket) {
        // 如果指定了默认桶，测试列出该桶前1条对象
        await this.listObjects(this.profile.defaultBucket, '', '/')
        return { success: true, message: `连接成功！已连通存储桶 [${this.profile.defaultBucket}]` }
      } else {
        // 尝试列出当前密钥下的所有存储桶
        const buckets = await this.listBuckets()
        return { success: true, message: `连接成功！检测到 ${buckets.length} 个可用存储桶` }
      }
    } catch (err: any) {
      return { success: false, message: err.message || '连接失败，请核对密钥与 Endpoint' }
    }
  }

  private parseErrorMessage(xmlText: string): string {
    try {
      const parser = new DOMParser()
      const xml = parser.parseFromString(xmlText, 'application/xml')
      const msg = xml.querySelector('Message')?.textContent
      const code = xml.querySelector('Code')?.textContent
      if (msg) return `${code ? `[${code}] ` : ''}${msg}`
    } catch {}
    return xmlText.slice(0, 150)
  }

  private escapeXml(unsafe: string): string {
    return unsafe.replace(/[<>&'"]/g, (c) => {
      switch (c) {
        case '<': return '&lt;'
        case '>': return '&gt;'
        case '&': return '&amp;'
        case '\'': return '&apos;'
        case '"': return '&quot;'
        default: return c
      }
    })
  }
}
