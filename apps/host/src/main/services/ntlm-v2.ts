import crypto from 'crypto'
import os from 'os'

// Pure JS MD4 (RFC 1320) - 零 OpenSSL 依赖，彻底避免 ERR_OSSL_EVP_UNSUPPORTED
export function md4(buffer: Buffer): Buffer {
  function rol(v: number, s: number): number {
    return (v << s) | (v >>> (32 - s))
  }
  function f(x: number, y: number, z: number): number {
    return (x & y) | (~x & z)
  }
  function g(x: number, y: number, z: number): number {
    return (x & y) | (x & z) | (y & z)
  }
  function h(x: number, y: number, z: number): number {
    return x ^ y ^ z
  }

  const len = buffer.length
  const bitLen = len * 8
  const padLen = (((len + 8) >>> 6) + 1) * 64
  const buf = Buffer.alloc(padLen)
  buffer.copy(buf)
  buf[len] = 0x80
  buf.writeUInt32LE(bitLen & 0xffffffff, padLen - 8)
  buf.writeUInt32LE(Math.floor(bitLen / 0x100000000), padLen - 4)

  let a = 0x67452301
  let b = 0xefcdab89
  let c = 0x98badcfe
  let d = 0x10325476

  for (let i = 0; i < padLen; i += 64) {
    const x: number[] = []
    for (let j = 0; j < 16; j++) {
      x[j] = buf.readUInt32LE(i + j * 4)
    }
    const aa = a
    const bb = b
    const cc = c
    const dd = d

    // Round 1
    a = rol((a + f(b, c, d) + x[0]) >>> 0, 3)
    d = rol((d + f(a, b, c) + x[1]) >>> 0, 7)
    c = rol((c + f(d, a, b) + x[2]) >>> 0, 11)
    b = rol((b + f(c, d, a) + x[3]) >>> 0, 19)
    a = rol((a + f(b, c, d) + x[4]) >>> 0, 3)
    d = rol((d + f(a, b, c) + x[5]) >>> 0, 7)
    c = rol((c + f(d, a, b) + x[6]) >>> 0, 11)
    b = rol((b + f(c, d, a) + x[7]) >>> 0, 19)
    a = rol((a + f(b, c, d) + x[8]) >>> 0, 3)
    d = rol((d + f(a, b, c) + x[9]) >>> 0, 7)
    c = rol((c + f(d, a, b) + x[10]) >>> 0, 11)
    b = rol((b + f(c, d, a) + x[11]) >>> 0, 19)
    a = rol((a + f(b, c, d) + x[12]) >>> 0, 3)
    d = rol((d + f(a, b, c) + x[13]) >>> 0, 7)
    c = rol((c + f(d, a, b) + x[14]) >>> 0, 11)
    b = rol((b + f(c, d, a) + x[15]) >>> 0, 19)

    // Round 2
    a = rol((a + g(b, c, d) + x[0] + 0x5a827999) >>> 0, 3)
    d = rol((d + g(a, b, c) + x[4] + 0x5a827999) >>> 0, 5)
    c = rol((c + g(d, a, b) + x[8] + 0x5a827999) >>> 0, 9)
    b = rol((b + g(c, d, a) + x[12] + 0x5a827999) >>> 0, 13)
    a = rol((a + g(b, c, d) + x[1] + 0x5a827999) >>> 0, 3)
    d = rol((d + g(a, b, c) + x[5] + 0x5a827999) >>> 0, 5)
    c = rol((c + g(d, a, b) + x[9] + 0x5a827999) >>> 0, 9)
    b = rol((b + g(c, d, a) + x[13] + 0x5a827999) >>> 0, 13)
    a = rol((a + g(b, c, d) + x[2] + 0x5a827999) >>> 0, 3)
    d = rol((d + g(a, b, c) + x[6] + 0x5a827999) >>> 0, 5)
    c = rol((c + g(d, a, b) + x[10] + 0x5a827999) >>> 0, 9)
    b = rol((b + g(c, d, a) + x[14] + 0x5a827999) >>> 0, 13)
    a = rol((a + g(b, c, d) + x[3] + 0x5a827999) >>> 0, 3)
    d = rol((d + g(a, b, c) + x[7] + 0x5a827999) >>> 0, 5)
    c = rol((c + g(d, a, b) + x[11] + 0x5a827999) >>> 0, 9)
    b = rol((b + g(c, d, a) + x[15] + 0x5a827999) >>> 0, 13)

    // Round 3
    a = rol((a + h(b, c, d) + x[0] + 0x6ed9eba1) >>> 0, 3)
    d = rol((d + h(a, b, c) + x[8] + 0x6ed9eba1) >>> 0, 9)
    c = rol((c + h(d, a, b) + x[4] + 0x6ed9eba1) >>> 0, 11)
    b = rol((b + h(c, d, a) + x[12] + 0x6ed9eba1) >>> 0, 15)
    a = rol((a + h(b, c, d) + x[2] + 0x6ed9eba1) >>> 0, 3)
    d = rol((d + h(a, b, c) + x[10] + 0x6ed9eba1) >>> 0, 9)
    c = rol((c + h(d, a, b) + x[6] + 0x6ed9eba1) >>> 0, 11)
    b = rol((b + h(c, d, a) + x[14] + 0x6ed9eba1) >>> 0, 15)
    a = rol((a + h(b, c, d) + x[1] + 0x6ed9eba1) >>> 0, 3)
    d = rol((d + h(a, b, c) + x[9] + 0x6ed9eba1) >>> 0, 9)
    c = rol((c + h(d, a, b) + x[5] + 0x6ed9eba1) >>> 0, 11)
    b = rol((b + h(c, d, a) + x[13] + 0x6ed9eba1) >>> 0, 15)
    a = rol((a + h(b, c, d) + x[3] + 0x6ed9eba1) >>> 0, 3)
    d = rol((d + h(a, b, c) + x[11] + 0x6ed9eba1) >>> 0, 9)
    c = rol((c + h(d, a, b) + x[7] + 0x6ed9eba1) >>> 0, 11)
    b = rol((b + h(c, d, a) + x[15] + 0x6ed9eba1) >>> 0, 15)

    a = (a + aa) >>> 0
    b = (b + bb) >>> 0
    c = (c + cc) >>> 0
    d = (d + dd) >>> 0
  }

  const out = Buffer.alloc(16)
  out.writeUInt32LE(a, 0)
  out.writeUInt32LE(b, 4)
  out.writeUInt32LE(c, 8)
  out.writeUInt32LE(d, 12)
  return out
}

const NTLMSIGNATURE = 'NTLMSSP\0'

export function createType1Message(workstation = os.hostname(), domain = ''): Buffer {
  let dataPos = 32
  const buf = Buffer.alloc(1024)
  let pos = 0

  buf.write(NTLMSIGNATURE, pos, 8, 'ascii')
  pos += 8

  buf.writeUInt32LE(1, pos) // Type 1 Message
  pos += 4

  const flagVal =
    0x00000001 | // Unicode
    0x00000002 | // OEM
    0x00000004 | // Request Target
    0x00000200 | // NTLM
    0x00008000 | // Always Sign
    0x00080000 | // NTLM2 Key
    0x00800000 | // Target Info
    0x20000000 | // 128-bit
    0x80000000 // 56-bit

  buf.writeUInt32LE(flagVal >>> 0, pos)
  pos += 4

  // Domain security buffer
  buf.writeUInt16LE(domain.length, pos)
  pos += 2
  buf.writeUInt16LE(domain.length, pos)
  pos += 2
  buf.writeUInt32LE(domain.length === 0 ? 0 : dataPos, pos)
  pos += 4
  if (domain.length > 0) {
    dataPos += buf.write(domain, dataPos, 'ascii')
  }

  // Workstation security buffer
  buf.writeUInt16LE(workstation.length, pos)
  pos += 2
  buf.writeUInt16LE(workstation.length, pos)
  pos += 2
  buf.writeUInt32LE(workstation.length === 0 ? 0 : dataPos, pos)
  pos += 4
  if (workstation.length > 0) {
    dataPos += buf.write(workstation, dataPos, 'ascii')
  }

  return buf.subarray(0, dataPos)
}

export interface Type2Info {
  flags: number
  challenge: Buffer
  targetName: string
  targetInfoBuffer: Buffer
}

export function decodeType2Message(buf: Buffer): Type2Info {
  if (buf.toString('ascii', 0, 8) !== NTLMSIGNATURE) {
    throw new Error('Invalid NTLM message signature')
  }
  if (buf.readUInt32LE(8) !== 2) {
    throw new Error('Invalid message type, expected NTLM Type 2 Challenge')
  }

  const flags = buf.readUInt32LE(20)
  const challenge = buf.subarray(24, 32)

  const targetNameLength = buf.readUInt16LE(12)
  const targetNameOffset = buf.readUInt32LE(16)
  let targetName = ''
  if (targetNameLength > 0 && targetNameOffset + targetNameLength <= buf.length) {
    targetName = buf.toString('ucs2', targetNameOffset, targetNameOffset + targetNameLength)
  }

  let targetInfoBuffer = Buffer.alloc(0)
  if (flags & 0x00800000) {
    // NEGOTIATE_TARGET_INFO
    const targetInfoLength = buf.readUInt16LE(40)
    const targetInfoOffset = buf.readUInt32LE(44)
    if (targetInfoLength > 0 && targetInfoOffset + targetInfoLength <= buf.length) {
      targetInfoBuffer = Buffer.from(buf.subarray(targetInfoOffset, targetInfoOffset + targetInfoLength))
    }
  }

  return {
    flags,
    challenge,
    targetName,
    targetInfoBuffer
  }
}

export function createType3Message(
  type2: Type2Info,
  username: string,
  password = '',
  workstation = os.hostname(),
  domain = ''
): Buffer {
  const authTarget = type2.targetName || domain || 'WORKGROUP'

  // NTLM Hash = MD4(password_utf16le)
  const ntlmHash = md4(Buffer.from(password, 'utf16le'))

  // NTLMv2 Hash = HMAC-MD5(ntlmHash, uppercase(username) + authTarget)
  const hmacNtlmv2 = crypto.createHmac('md5', ntlmHash)
  hmacNtlmv2.update(Buffer.from(username.toUpperCase() + authTarget, 'utf16le'))
  const ntlmv2Hash = hmacNtlmv2.digest()

  // Client Nonce (8 bytes random)
  const clientNonce = crypto.randomBytes(8)

  // LMv2 Response = HMAC-MD5(ntlmv2Hash, challenge + clientNonce) + clientNonce
  const hmacLmv2 = crypto.createHmac('md5', ntlmv2Hash)
  hmacLmv2.update(type2.challenge)
  hmacLmv2.update(clientNonce)
  const lmv2Resp = Buffer.concat([hmacLmv2.digest(), clientNonce])

  // NTLMv2 Response (Client Challenge blob)
  const now = Date.now()
  const fileTime = (BigInt(now) + 11644473600000n) * 10000n
  const timeBuf = Buffer.alloc(8)
  timeBuf.writeBigUInt64LE(fileTime, 0)

  const clientChallengeBlob = Buffer.concat([
    Buffer.from([0x01, 0x01, 0x00, 0x00]), // RespType (0x01010000)
    Buffer.alloc(4), // Reserved
    timeBuf, // TimeStamp
    clientNonce, // ClientNonce (8 bytes)
    Buffer.alloc(4), // Reserved
    type2.targetInfoBuffer, // TargetInfo from Type 2
    Buffer.alloc(4) // Reserved
  ]);

  // NTProofStr = HMAC-MD5(ntlmv2Hash, challenge + clientChallengeBlob)
  const hmacNtProof = crypto.createHmac('md5', ntlmv2Hash)
  hmacNtProof.update(type2.challenge)
  hmacNtProof.update(clientChallengeBlob)
  const ntProofStr = hmacNtProof.digest() // 16 bytes

  const ntlmv2Resp = Buffer.concat([ntProofStr, clientChallengeBlob])

  // Build Type 3 Message Buffer (64 bytes header + payloads)
  let dataPos = 64
  const buf = Buffer.alloc(4096)

  buf.write(NTLMSIGNATURE, 0, 8, 'ascii')
  buf.writeUInt32LE(3, 8) // Type 3

  // LMv2 Response
  buf.writeUInt16LE(lmv2Resp.length, 12)
  buf.writeUInt16LE(lmv2Resp.length, 14)
  buf.writeUInt32LE(dataPos, 16)
  lmv2Resp.copy(buf, dataPos)
  dataPos += lmv2Resp.length

  // NTLMv2 Response
  buf.writeUInt16LE(ntlmv2Resp.length, 20)
  buf.writeUInt16LE(ntlmv2Resp.length, 22)
  buf.writeUInt32LE(dataPos, 24)
  ntlmv2Resp.copy(buf, dataPos)
  dataPos += ntlmv2Resp.length

  // Target Name
  const domainBuf = Buffer.from(authTarget, 'utf16le')
  buf.writeUInt16LE(domainBuf.length, 28)
  buf.writeUInt16LE(domainBuf.length, 30)
  buf.writeUInt32LE(dataPos, 32)
  domainBuf.copy(buf, dataPos)
  dataPos += domainBuf.length

  // User Name
  const userBuf = Buffer.from(username, 'utf16le')
  buf.writeUInt16LE(userBuf.length, 36)
  buf.writeUInt16LE(userBuf.length, 38)
  buf.writeUInt32LE(dataPos, 40)
  userBuf.copy(buf, dataPos)
  dataPos += userBuf.length

  // Workstation
  const wsBuf = Buffer.from(workstation, 'utf16le')
  buf.writeUInt16LE(wsBuf.length, 44)
  buf.writeUInt16LE(wsBuf.length, 46)
  buf.writeUInt32LE(dataPos, 48)
  wsBuf.copy(buf, dataPos)
  dataPos += wsBuf.length

  // Session Key
  buf.writeUInt16LE(0, 52)
  buf.writeUInt16LE(0, 54)
  buf.writeUInt32LE(dataPos, 56)

  // Flags
  buf.writeUInt32LE(type2.flags >>> 0, 60)

  return buf.subarray(0, dataPos)
}

/**
 * 补丁 @marsaud/smb2 使其原生支持现代 NTLMv2 鉴权
 */
let isPatched = false
export function patchSmb2WithNtlmV2(): void {
  if (isPatched) return
  try {
    const step1 = require('@marsaud/smb2/lib/messages/session_setup_step1.js')
    const step2 = require('@marsaud/smb2/lib/messages/session_setup_step2.js')
    const SMB2Message = require('@marsaud/smb2/lib/tools/smb2-message.js')

    step1.generate = function (connection: any) {
      return new SMB2Message({
        headers: {
          Command: 'SESSION_SETUP',
          ProcessId: connection.ProcessId
        },
        request: {
          Buffer: createType1Message(connection.ip, connection.domain)
        }
      })
    }

    step1.onSuccess = function (connection: any, response: any) {
      const h = response.getHeaders()
      connection.SessionId = h.SessionId
      connection.rawType2 = response.getResponse().Buffer
    }

    step2.generate = function (connection: any) {
      const type2 = decodeType2Message(connection.rawType2)
      const type3Buf = createType3Message(
        type2,
        connection.username,
        connection.password,
        connection.ip,
        connection.domain
      )
      return new SMB2Message({
        headers: {
          Command: 'SESSION_SETUP',
          SessionId: connection.SessionId,
          ProcessId: connection.ProcessId
        },
        request: {
          Buffer: type3Buf
        }
      })
    }

    isPatched = true
    console.log('[SambaService] Successfully patched @marsaud/smb2 with pure NTLMv2 engine')
  } catch (err) {
    console.error('[SambaService] Failed to patch @marsaud/smb2 with NTLMv2:', err)
  }
}
