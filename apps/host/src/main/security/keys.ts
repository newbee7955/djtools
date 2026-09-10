import crypto from 'crypto'
import { createReadStream, existsSync } from 'fs'

/**
 * 豆角工具箱官方 Ed25519 签名验证公钥 (SPKI PEM 格式)
 * 用于拦截任何未经官方私钥签名的非安全插件或被中间人篡改的包
 */
export const OFFICIAL_ED25519_PUBLIC_KEY = "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEATL2T06T1nlQDgWQlBxr3pEiiMrtU7/I+k49CDO3rAJM=\n-----END PUBLIC KEY-----\n"

/**
 * 校验指定 Buffer 或字符串的 Ed25519 数字签名
 */
export function verifyEd25519Signature(
  data: Buffer | string,
  signatureBase64: string,
  publicKeyPem: string = OFFICIAL_ED25519_PUBLIC_KEY
): boolean {
  try {
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf-8')
    const signature = Buffer.from(signatureBase64, 'base64')
    return crypto.verify(null, buffer, publicKeyPem, signature)
  } catch (err) {
    console.error('[Security:Keys] 验签异常:', err)
    return false
  }
}

/**
 * 流式计算本地文件的 SHA-256 哈希值
 */
export function calculateFileSha256(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!existsSync(filePath)) {
      return reject(new Error(`找不到文件: ${filePath}`))
    }
    const hash = crypto.createHash('sha256')
    const stream = createReadStream(filePath)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
    stream.on('error', (err) => reject(err))
  })
}

/**
 * 验证文件 SHA-256 是否与预期严格匹配
 */
export async function verifyFileSha256(filePath: string, expectedSha256: string): Promise<boolean> {
  try {
    const actual = await calculateFileSha256(filePath)
    return actual.toLowerCase() === expectedSha256.toLowerCase()
  } catch {
    return false
  }
}
