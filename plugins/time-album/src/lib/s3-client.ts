import type { StorageProfile, BucketItem, S3ObjectItem } from './s3-types'
import { signS3Request, createPresignedUrl } from './s3-signer'

const SUPPORTED_IMAGE_EXTENSIONS = new Set([
  'jpg',
  'jpeg',
  'png',
  'webp',
  'heic',
  'gif',
  'bmp',
  'avif',
  'svg'
])

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
   * 执行带签名的网络请求（优先走宿主代理绕过 CORS，降级原生 fetch）
   */
  private async executeRequest(options: {
    method: string
    url: string
    headers?: Record<string, string>
    body?: any
    payloadSha256?: string
  }): Promise<{ status: number; statusText: string; headers: Headers | Record<string, string>; text: string }> {
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

    // 1. 优先走宿主主进程网络代理，完全免除 Chromium 沙箱的 CORS 限制
    const hostSdk = (window as any).doujiaoSDK?.network
    if (hostSdk && typeof hostSdk.request === 'function') {
      try {
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
      } catch (hostErr: any) {
        console.warn('Host network request failed, falling back to fetch:', hostErr)
      }
    }

    // 2. 独立纯网页或降级尝试原生 fetch
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
      text
    }
  }

  /**
   * 获取存储桶列表 (ListBuckets)
   */
  async listBuckets(): Promise<BucketItem[]> {
    const url = `${this.getBaseUrl()}/`
    const res = await this.executeRequest({ method: 'GET', url })

    if (res.status >= 300) {
      throw new Error(`获取存储桶列表失败 (${res.status}): ${this.parseErrorMessage(res.text)}`)
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
   * 递归检索指定存储桶与前缀下的所有相片对象
   * (不设 delimiter，直接多页遍历获取全部匹配文件)
   */
  async listAllImageObjects(
    bucket: string,
    prefix = '',
    onProgress?: (count: number) => void
  ): Promise<S3ObjectItem[]> {
    const cleanPrefix = prefix.replace(/^\/+/, '')
    const baseUrl = this.getBaseUrl(bucket)
    const imageObjects: S3ObjectItem[] = []

    let continuationToken: string | undefined = undefined
    let hasMore = true
    let page = 0

    while (hasMore) {
      page++
      const query = new URLSearchParams()
      query.set('list-type', '2')
      query.set('max-keys', '1000')
      if (cleanPrefix) {
        query.set('prefix', cleanPrefix)
      }
      if (continuationToken) {
        query.set('continuation-token', continuationToken)
      }

      const url = `${baseUrl}${this.profile.pathStyle ? '' : '/'}?${query.toString()}`
      const res = await this.executeRequest({ method: 'GET', url })

      if (res.status >= 300) {
        throw new Error(`读取对象列表失败 (${res.status}): ${this.parseErrorMessage(res.text)}`)
      }

      const parser = new DOMParser()
      const xml = parser.parseFromString(res.text, 'application/xml')
      const contents = xml.querySelectorAll('Contents')

      contents.forEach((node) => {
        const key = node.querySelector('Key')?.textContent || ''
        // 跳过以 / 结尾的虚拟目录或空 key
        if (!key || key.endsWith('/')) {
          return
        }

        const fileName = key.split('/').pop() || key
        const ext = fileName.includes('.') ? fileName.split('.').pop()?.toLowerCase() || '' : ''

        // 仅收录相片格式
        if (!SUPPORTED_IMAGE_EXTENSIONS.has(ext)) {
          return
        }

        const size = parseInt(node.querySelector('Size')?.textContent || '0', 10)
        const lastModified = node.querySelector('LastModified')?.textContent || ''
        const etag = (node.querySelector('ETag')?.textContent || '').replace(/"/g, '')

        imageObjects.push({
          name: fileName,
          key,
          isDirectory: false,
          size,
          lastModified,
          etag,
          extension: ext
        })
      })

      if (onProgress) {
        onProgress(imageObjects.length)
      }

      const isTruncated = xml.querySelector('IsTruncated')?.textContent === 'true'
      if (isTruncated) {
        continuationToken = xml.querySelector('NextContinuationToken')?.textContent || undefined
        hasMore = Boolean(continuationToken)
      } else {
        hasMore = false
      }

      // 保护安全上限：最多连续拉取 50 页 (50,000 个文件)
      if (page >= 50) {
        break
      }
    }

    return imageObjects
  }

  /**
   * 获取用于直接在浏览器展示与预览的预签名 URL
   * 默认 24 小时 (86400 秒)
   */
  async getPresignedUrl(bucket: string, key: string, expiresInSeconds = 86400): Promise<string> {
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
   * 自动检测并为存储桶配置 CORS 允许规则（针对图片跨域分析与缩略图生成）
   */
  async ensureBucketCors(bucket: string): Promise<boolean> {
    try {
      const baseUrl = this.getBaseUrl(bucket)
      const corsUrl = `${baseUrl}${this.profile.pathStyle ? '' : '/'}?cors`

      // 1. 查询当前 CORS 状态
      const getRes = await this.executeRequest({ method: 'GET', url: corsUrl })
      if (getRes.status >= 200 && getRes.status < 300) {
        if (getRes.text.includes('<AllowedOrigin>*</AllowedOrigin>') || getRes.text.includes('doujiao-plugin')) {
          return true
        }
      }

      // 2. 若未配置或缺少通用跨域支持，自动写入标准 CORS 规则
      const corsXml =
        '<CORSConfiguration><CORSRule><AllowedOrigin>*</AllowedOrigin><AllowedMethod>GET</AllowedMethod><AllowedMethod>HEAD</AllowedMethod><AllowedHeader>*</AllowedHeader><ExposeHeader>ETag</ExposeHeader><MaxAgeSeconds>3600</MaxAgeSeconds></CORSRule></CORSConfiguration>'
      const putRes = await this.executeRequest({
        method: 'PUT',
        url: corsUrl,
        headers: {
          'content-type': 'application/xml',
          'content-md5': '7ho5DOX7Hp8JffbbAhyhWw=='
        },
        body: corsXml
      })

      if (putRes.status >= 200 && putRes.status < 300) {
        console.log(`[S3Client] 成功为存储桶 [${bucket}] 自动配置 CORS 跨域规则`)
        return true
      }
    } catch (err) {
      console.warn(`[S3Client] 自动检查/配置存储桶 [${bucket}] CORS 规则跳过:`, err)
    }
    return false
  }

  /**
   * 测试配置连通性
   */
  async testConnection(bucket?: string): Promise<{ success: boolean; message?: string }> {
    try {
      const testBucket = bucket || this.profile.defaultBucket
      if (testBucket) {
        const baseUrl = this.getBaseUrl(testBucket)
        const query = new URLSearchParams()
        query.set('list-type', '2')
        query.set('max-keys', '1')
        const url = `${baseUrl}${this.profile.pathStyle ? '' : '/'}?${query.toString()}`
        const res = await this.executeRequest({ method: 'GET', url })
        if (res.status >= 300) {
          return { success: false, message: `连接失败 (${res.status}): ${this.parseErrorMessage(res.text)}` }
        }
        // 静默确保 CORS 跨域支持
        this.ensureBucketCors(testBucket).catch(() => {})
        return { success: true, message: `连接成功！已连通存储桶 [${testBucket}]` }
      } else {
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
}
