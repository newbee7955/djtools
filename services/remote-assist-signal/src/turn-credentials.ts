/**
 * coturn REST-API 临时 HMAC-SHA1 凭证生成器 (5 分钟有效期)
 */

import crypto from 'node:crypto'

export interface TurnCredentials {
  username: string
  credential: string
  urls: string[]
}

export function generateTurnCredentials(
  deviceId: string,
  secret: string,
  turnHost: string = 'turn.doujiao.dev',
  turnPort: number = 3478,
  ttlSeconds: number = 300 // 5 minutes
): TurnCredentials {
  const expiryTimestamp = Math.floor(Date.now() / 1000) + ttlSeconds
  const cleanId = deviceId.replace(/\s+/g, '')
  const username = `${expiryTimestamp}:${cleanId}`
  const hmac = crypto.createHmac('sha1', secret)
  hmac.update(username)
  const credential = hmac.digest('base64')

  return {
    username,
    credential,
    urls: [
      `turn:${turnHost}:${turnPort}?transport=udp`,
      `turn:${turnHost}:${turnPort}?transport=tcp`
    ]
  }
}
