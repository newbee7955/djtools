const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const keysDir = path.join(__dirname, '.keys');
if (!fs.existsSync(keysDir)) {
  fs.mkdirSync(keysDir, { recursive: true });
}

const privateKeyPath = path.join(keysDir, 'ed25519_private.pem');
const publicKeyPath = path.join(keysDir, 'ed25519_public.pem');

let privateKeyPem, publicKeyPem;

if (fs.existsSync(privateKeyPath) && fs.existsSync(publicKeyPath)) {
  console.log('[Keys] 发现已有密钥对，直接复用...');
  privateKeyPem = fs.readFileSync(privateKeyPath, 'utf-8');
  publicKeyPem = fs.readFileSync(publicKeyPath, 'utf-8');
} else {
  console.log('[Keys] 正在生成全新官方 Ed25519 签名密钥对...');
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });

  fs.writeFileSync(privateKeyPath, privateKey, 'utf-8');
  fs.writeFileSync(publicKeyPath, publicKey, 'utf-8');
  privateKeyPem = privateKey;
  publicKeyPem = publicKey;
  console.log('[Keys] 官方私钥已保存至:', privateKeyPath);
  console.log('[Keys] 官方公钥已保存至:', publicKeyPath);
}

// 将公钥嵌入到宿主主进程 keys.ts 中
const hostKeysTs = path.join(__dirname, '../apps/host/src/main/security/keys.ts');
const hostKeysContent = `import crypto from 'crypto'
import { createReadStream, existsSync } from 'fs'

/**
 * 豆角工具箱官方 Ed25519 签名验证公钥 (SPKI PEM 格式)
 * 用于拦截任何未经官方私钥签名的非安全插件或被中间人篡改的包
 */
export const OFFICIAL_ED25519_PUBLIC_KEY = ${JSON.stringify(publicKeyPem)}

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
      return reject(new Error(\`找不到文件: \${filePath}\`))
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
`;

fs.mkdirSync(path.dirname(hostKeysTs), { recursive: true });
fs.writeFileSync(hostKeysTs, hostKeysContent, 'utf-8');
console.log('[Keys] 宿主安全公钥文件已更新:', hostKeysTs);
