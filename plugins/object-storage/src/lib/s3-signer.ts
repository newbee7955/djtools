/**
 * AWS Signature Version 4 (AWS4-HMAC-SHA256) 纯前端 Web Crypto 实现
 * 零第三方依赖，支持标准 S3、MinIO、OSS、COS、R2
 */

const encoder = new TextEncoder()

function toHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export function encodeRFC3986(str: string): string {
  return encodeURIComponent(str).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())
}

export function encodeURIPath(path: string): string {
  if (!path.startsWith('/')) path = '/' + path
  const segments = path.split('/')
  return segments.map((s) => {
    try {
      return encodeRFC3986(decodeURIComponent(s))
    } catch {
      return encodeRFC3986(s)
    }
  }).join('/')
}

export async function sha256Hex(data: string | ArrayBuffer | Uint8Array): Promise<string> {
  const buffer = (typeof data === 'string' ? encoder.encode(data) : data) as BufferSource
  const hash = await crypto.subtle.digest('SHA-256', buffer)
  return toHex(hash)
}

async function hmacSha256(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  return await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(data) as BufferSource)
}

export async function getSigningKey(
  secretKey: string,
  dateStamp: string,
  region: string,
  service = 's3'
): Promise<ArrayBuffer> {
  const kSecret = encoder.encode('AWS4' + secretKey)
  const kDate = await hmacSha256(kSecret, dateStamp)
  const kRegion = await hmacSha256(kDate, region)
  const kService = await hmacSha256(kRegion, service)
  return await hmacSha256(kService, 'aws4_request')
}

export interface SignOptions {
  method: string
  url: string // 完整请求 URL
  headers?: Record<string, string>
  payloadSha256?: string // 十六进制或 'UNSIGNED-PAYLOAD'
  accessKeyId: string
  secretAccessKey: string
  region: string
  service?: string
  date?: Date
}

/**
 * 为 HTTP 请求生成标准 AWS V4 Authorization Header 与相关签名头
 */
export async function signS3Request(options: SignOptions): Promise<Record<string, string>> {
  const {
    method,
    url: rawUrl,
    headers = {},
    payloadSha256 = 'UNSIGNED-PAYLOAD',
    accessKeyId,
    secretAccessKey,
    region,
    service = 's3',
    date = new Date()
  } = options

  const parsedUrl = new URL(rawUrl)
  const amzDate = date.toISOString().replace(/[:-]|\.\d{3}/g, '') // e.g. 20260910T023000Z
  const dateStamp = amzDate.substring(0, 8) // e.g. 20260910

  // 1. 规范化 Header
  const reqHeaders: Record<string, string> = {
    host: parsedUrl.host,
    'x-amz-date': amzDate,
    'x-amz-content-sha256': payloadSha256
  }

  // 合并传入的自定义 header（全部小写化处理，过滤由网络库自动管理的头）
  const ignoredHeaders = new Set(['content-length', 'connection', 'transfer-encoding', 'upgrade'])
  for (const [k, v] of Object.entries(headers)) {
    const lowerKey = k.toLowerCase()
    if (!ignoredHeaders.has(lowerKey)) {
      reqHeaders[lowerKey] = v.trim()
    }
  }

  // 排序 header 列表
  const sortedHeaderKeys = Object.keys(reqHeaders).sort()
  const canonicalHeaders = sortedHeaderKeys.map((k) => `${k}:${reqHeaders[k]}\n`).join('')
  const signedHeaders = sortedHeaderKeys.join(';')

  // 2. 规范化 URI 与 Query
  const canonicalURI = encodeURIPath(parsedUrl.pathname)
  const queryParams: Array<[string, string]> = []
  parsedUrl.searchParams.forEach((v, k) => {
    queryParams.push([encodeRFC3986(k), encodeRFC3986(v)])
  })
  queryParams.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  const canonicalQuery = queryParams.map(([k, v]) => `${k}=${v}`).join('&')

  // 3. Canonical Request
  const canonicalRequest = [
    method.toUpperCase(),
    canonicalURI,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadSha256
  ].join('\n')

  const hashedCanonicalRequest = await sha256Hex(canonicalRequest)

  // 4. String To Sign
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    hashedCanonicalRequest
  ].join('\n')

  // 5. 计算签名
  const signingKey = await getSigningKey(secretAccessKey, dateStamp, region, service)
  const signatureRaw = await hmacSha256(signingKey, stringToSign)
  const signature = toHex(signatureRaw)

  // 6. 生成 Authorization
  const authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`

  return {
    ...reqHeaders,
    Authorization: authorization
  }
}

/**
 * 生成临时访问预签名链接 (Presigned URL)
 */
export async function createPresignedUrl(options: {
  url: string
  accessKeyId: string
  secretAccessKey: string
  region: string
  service?: string
  expiresInSeconds?: number // 默认 3600 (1小时)
  date?: Date
}): Promise<string> {
  const {
    url: rawUrl,
    accessKeyId,
    secretAccessKey,
    region,
    service = 's3',
    expiresInSeconds = 3600,
    date = new Date()
  } = options

  const parsedUrl = new URL(rawUrl)
  const amzDate = date.toISOString().replace(/[:-]|\.\d{3}/g, '')
  const dateStamp = amzDate.substring(0, 8)
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`

  // 注入预签名 query 参数
  parsedUrl.searchParams.set('X-Amz-Algorithm', 'AWS4-HMAC-SHA256')
  parsedUrl.searchParams.set('X-Amz-Credential', `${accessKeyId}/${credentialScope}`)
  parsedUrl.searchParams.set('X-Amz-Date', amzDate)
  parsedUrl.searchParams.set('X-Amz-Expires', expiresInSeconds.toString())
  parsedUrl.searchParams.set('X-Amz-SignedHeaders', 'host')

  // 规范化 Header
  const canonicalHeaders = `host:${parsedUrl.host}\n`
  const signedHeaders = 'host'

  // 规范化 URI
  const canonicalURI = encodeURIPath(parsedUrl.pathname)

  // 规范化 Query (排除 Signature)
  const queryParams: Array<[string, string]> = []
  parsedUrl.searchParams.forEach((v, k) => {
    if (k !== 'X-Amz-Signature') {
      queryParams.push([encodeRFC3986(k), encodeRFC3986(v)])
    }
  })
  queryParams.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  const canonicalQuery = queryParams.map(([k, v]) => `${k}=${v}`).join('&')

  // 规范化请求
  const canonicalRequest = [
    'GET',
    canonicalURI,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    'UNSIGNED-PAYLOAD'
  ].join('\n')

  const hashedCanonicalRequest = await sha256Hex(canonicalRequest)

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    hashedCanonicalRequest
  ].join('\n')

  const signingKey = await getSigningKey(secretAccessKey, dateStamp, region, service)
  const signatureRaw = await hmacSha256(signingKey, stringToSign)
  const signature = toHex(signatureRaw)

  parsedUrl.searchParams.set('X-Amz-Signature', signature)
  return parsedUrl.toString()
}
