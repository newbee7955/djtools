import type { DoujiaoSDK } from '@doujiao/plugin-sdk'

export interface ParsedDouyinInput {
  type: 'video' | 'mix' | 'zhuanti' | 'user' | 'unknown'
  awemeId?: string
  mixId?: string
  zhuantiId?: string
  secUid?: string
  rawUrl?: string
}

/**
 * 从输入文本中提取第一个 HTTP/HTTPS 链接
 */
export function extractUrlFromText(text: string): string | null {
  const match = text.match(/https?:\/\/[a-zA-Z0-9][-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b[-a-zA-Z0-9()@:%_+.~#?&/=]*/i)
  return match ? match[0] : null
}

/**
 * 从 URL 或文本中提取视频 ID (aweme_id)
 */
export function extractAwemeId(urlOrText: string): string | null {
  const pureDigits = urlOrText.trim().match(/^\d{15,21}$/)
  if (pureDigits) return pureDigits[0]

  const videoMatch = urlOrText.match(/\/video\/(\d{15,21})/)
  if (videoMatch) return videoMatch[1]

  const noteMatch = urlOrText.match(/\/note\/(\d{15,21})/)
  if (noteMatch) return noteMatch[1]

  const modalMatch = urlOrText.match(/modal_id=(\d{15,21})/)
  if (modalMatch) return modalMatch[1]

  const itemMatch = urlOrText.match(/item_ids?=(\d{15,21})/)
  if (itemMatch) return itemMatch[1]

  return null
}

/**
 * 从 URL 或文本中提取合集 ID (mix_id / series_id / collection)
 */
export function extractMixId(urlOrText: string): string | null {
  const collectionMatch = urlOrText.match(/\/collection\/(\d{15,21})/)
  if (collectionMatch) return collectionMatch[1]

  const seriesPathMatch = urlOrText.match(/\/series\/(\d{15,21})/)
  if (seriesPathMatch) return seriesPathMatch[1]

  const mixIdMatch = urlOrText.match(/mix_id=(\d{15,21})/)
  if (mixIdMatch) return mixIdMatch[1]

  const seriesMatch = urlOrText.match(/series_id=(\d{15,21})/)
  if (seriesMatch) return seriesMatch[1]

  const mixDetailMatch = urlOrText.match(/\/mix\/detail\/(\d{15,21})/)
  if (mixDetailMatch) return mixDetailMatch[1]

  return null
}

/**
 * 从 URL 或文本中提取专题 ID (/zhuanti/xxxx)
 */
export function extractZhuantiId(urlOrText: string): string | null {
  const zhuantiMatch = urlOrText.match(/\/zhuanti\/(\d{15,21})/)
  if (zhuantiMatch) return zhuantiMatch[1]
  return null
}

/**
 * 从 URL 或文本中提取创作者 sec_uid
 */
export function extractSecUid(urlOrText: string): string | null {
  const match = urlOrText.match(/\/user\/([a-zA-Z0-9_\-]+)/)
  if (match) return match[1]

  const secUserMatch = urlOrText.match(/sec_user_id=([a-zA-Z0-9_\-]+)/)
  if (secUserMatch) return secUserMatch[1]

  const secUidMatch = urlOrText.match(/sec_uid=([a-zA-Z0-9_\-]+)/)
  if (secUidMatch) return secUidMatch[1]

  if (urlOrText.trim().startsWith('MS4wLj')) {
    return urlOrText.trim().split(/[?#& ]/)[0]
  }

  return null
}

/**
 * 短链接解析：通过受控网络代理跟随重定向获取真实 URL 与内容
 */
export async function resolveDouyinRedirect(url: string, sdk: DoujiaoSDK): Promise<{ finalUrl: string; data?: any }> {
  try {
    const res = await sdk.network.request({
      url,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1'
      }
    })

    let targetUrl = url
    // 检查响应头中的 location
    if (res.headers && res.headers['location']) {
      targetUrl = res.headers['location']
    }

    // 从返回的 HTML 中检查 canonical 或 video 链接
    if (typeof res.data === 'string') {
      const canonicalMatch = res.data.match(/<link[^>]*rel="canonical"[^>]*href="([^"]+)"/)
      if (canonicalMatch) {
        targetUrl = canonicalMatch[1]
      } else {
        const videoMatch = res.data.match(/\/video\/(\d{15,21})/)
        if (videoMatch) {
          targetUrl = `https://www.douyin.com/video/${videoMatch[1]}`
        }
      }
    }

    return { finalUrl: targetUrl, data: res.data }
  } catch (err) {
    console.warn('[Parser] 解析短链接异常:', err)
    return { finalUrl: url }
  }
}

/**
 * 完整解析用户输入的文本或分享链接
 */
export async function parseDouyinInput(input: string, sdk: DoujiaoSDK): Promise<ParsedDouyinInput> {
  const trimmed = input.trim()
  if (!trimmed) return { type: 'unknown' }

  let targetUrl = extractUrlFromText(trimmed) || trimmed

  // 1. 若是短链 (v.douyin.com)，先跟随解析
  if (targetUrl.includes('v.douyin.com')) {
    const resolved = await resolveDouyinRedirect(targetUrl, sdk)
    targetUrl = resolved.finalUrl
  }

  // 2. 检查专题 (zhuanti)
  const zhuantiId = extractZhuantiId(targetUrl) || extractZhuantiId(trimmed)
  if (zhuantiId) {
    return {
      type: 'zhuanti',
      zhuantiId,
      rawUrl: targetUrl
    }
  }

  // 3. 检查合集 (collection / series / mix)
  const mixId = extractMixId(targetUrl) || extractMixId(trimmed)
  const isExplicitCollection =
    targetUrl.includes('/collection/') ||
    targetUrl.includes('/series/') ||
    targetUrl.includes('/mix/detail') ||
    trimmed.includes('合集')

  if (mixId && isExplicitCollection) {
    return {
      type: 'mix',
      mixId,
      rawUrl: targetUrl
    }
  }

  // 4. 检查单个视频/图文
  const awemeId = extractAwemeId(targetUrl) || extractAwemeId(trimmed)
  if (awemeId) {
    return {
      type: 'video',
      awemeId,
      mixId: mixId || undefined,
      rawUrl: targetUrl
    }
  }

  if (mixId) {
    return {
      type: 'mix',
      mixId,
      rawUrl: targetUrl
    }
  }

  // 5. 检查用户主页
  const secUid = extractSecUid(targetUrl) || extractSecUid(trimmed)
  if (secUid) {
    return {
      type: 'user',
      secUid,
      rawUrl: targetUrl
    }
  }

  return { type: 'unknown', rawUrl: targetUrl }
}
