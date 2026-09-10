import type { DoujiaoSDK } from '@doujiao/plugin-sdk'
import type {
  DouyinVideoItem,
  DouyinParseResult,
  DouyinUserItem,
  DouyinUserVideosResult,
  DouyinQualityOption
} from '../types'
import { parseDouyinInput } from './parser'

/**
 * 将官方 API 返回的 raw item 规整为统一的 DouyinVideoItem
 */
export function mapAwemeItem(item: any): DouyinVideoItem {
  const awemeId = item.aweme_id || item.id || ''
  const desc = item.desc || item.title || ''
  const title = desc ? desc.split('\n')[0].slice(0, 120) : `抖音视频_${awemeId}`
  const cover =
    item.video?.cover?.url_list?.[0] ||
    item.video?.origin_cover?.url_list?.[0] ||
    item.video?.dynamic_cover?.url_list?.[0] ||
    ''

  const urlList: string[] = item.video?.play_addr?.url_list || []
  const playEndpoint = urlList.find((u: string) => u.includes('aweme/v1/play')) || urlList[0] || ''

  // 解析各个清晰度/分辨率流
  const qualities: DouyinQualityOption[] = []
  if (Array.isArray(item.video?.bit_rate) && item.video.bit_rate.length > 0) {
    for (const br of item.video.bit_rate) {
      const qUrlList: string[] = br.play_addr?.url_list || []
      const qPlayUrl = qUrlList.find((u: string) => u.includes('aweme/v1/play')) || qUrlList[0]
      if (qPlayUrl) {
        let label = '默认画质'
        const qType = br.quality_type || (br.gear_name ? parseInt(br.gear_name.match(/\d+/)?.[0] || '0', 10) : 0)
        if (qType >= 1080) {
          label = '1080P 超清'
        } else if (qType >= 720) {
          label = '720P 高清'
        } else if (qType >= 540) {
          label = '540P 标清'
        } else if (qType > 0) {
          label = `${qType}P`
        } else if (br.gear_name) {
          label = br.gear_name
        }

        if (br.bit_rate) {
          const mbps = (br.bit_rate / 1000 / 1000).toFixed(1)
          label += ` (~${mbps}Mbps)`
        }

        if (!qualities.some((q) => q.url === qPlayUrl || q.label === label)) {
          qualities.push({
            label,
            url: qPlayUrl,
            gearName: br.gear_name,
            qualityType: qType,
            bitRate: br.bit_rate
          })
        }
      }
    }
  }

  // 排序：最高码率优先
  qualities.sort((a, b) => (b.qualityType || b.bitRate || 0) - (a.qualityType || a.bitRate || 0))

  if (qualities.length === 0 && playEndpoint) {
    qualities.push({
      label: '默认原画',
      url: playEndpoint
    })
  }

  const selectedQualityUrl = qualities[0]?.url || playEndpoint || `https://www.douyin.com/video/${awemeId}`

  const duration = Math.round((item.video?.duration || 0) / 1000)
  const authorName = item.author?.nickname || '抖音创作者'
  const authorAvatar = item.author?.avatar_thumb?.url_list?.[0] || ''
  const authorSecUid = item.author?.sec_uid || ''
  const ratio = item.video?.ratio || '高清'

  return {
    awemeId,
    title,
    desc,
    cover,
    videoUrl: selectedQualityUrl,
    duration,
    authorName,
    authorAvatar,
    authorSecUid,
    ratio,
    selected: true,
    qualities,
    selectedQualityUrl
  }
}

/**
 * 单视频详情获取 (官方 detail API)
 */
export async function fetchVideoDetail(awemeId: string, sdk: DoujiaoSDK): Promise<DouyinVideoItem> {
  const apiUrl = `https://www.douyin.com/aweme/v1/web/aweme/detail/?aweme_id=${awemeId}&device_platform=webapp&aid=6383&channel=channel_pc_web`

  try {
    const res = await sdk.network.request({
      url: apiUrl,
      headers: {
        Referer: 'https://www.douyin.com/'
      }
    })

    if (res.data && res.data.aweme_detail) {
      return mapAwemeItem(res.data.aweme_detail)
    }
  } catch (err) {
    console.warn('[DouyinApi] 请求官方 detail API 失败，尝试兜底解析:', err)
  }

  // 兜底策略：访问 m.douyin.com/share/video/:id 页面提取结构化数据
  try {
    const shareUrl = `https://m.douyin.com/share/video/${awemeId}`
    const pageRes = await sdk.network.request({
      url: shareUrl,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1'
      }
    })

    if (typeof pageRes.data === 'string') {
      const html = pageRes.data
      const titleMatch = html.match(/<title>([^<]+)<\/title>/)
      let title = titleMatch ? titleMatch[1].replace(' - 抖音', '').trim() : `抖音视频_${awemeId}`

      // 提取 play url
      const playMatch = html.match(/"play_addr":\{"uri":"[^"]*","url_list":\["([^"]+)"/)
      const videoUrl = playMatch ? playMatch[1].replace(/\\u0026/g, '&') : `https://www.douyin.com/video/${awemeId}`

      // 提取封面
      const coverMatch = html.match(/"cover":\{"uri":"[^"]*","url_list":\["([^"]+)"/)
      const cover = coverMatch ? coverMatch[1].replace(/\\u0026/g, '&') : ''

      return {
        awemeId,
        title,
        desc: title,
        cover,
        videoUrl,
        duration: 0,
        authorName: '抖音创作者',
        authorAvatar: '',
        ratio: '高清',
        selected: true,
        qualities: [{ label: '默认原画', url: videoUrl }],
        selectedQualityUrl: videoUrl
      }
    }
  } catch (fallbackErr) {
    console.warn('[DouyinApi] 兜底解析亦失败:', fallbackErr)
  }

  throw new Error(`未能解析视频信息 (${awemeId})，可能已被作者删除或链接受限`)
}

/**
 * 解析合集 (collection / series / mix)
 */
export async function parseCollection(mixId: string, sdk: DoujiaoSDK): Promise<DouyinParseResult> {
  // 1. 尝试官方合集作品接口
  const mixApiUrl = `https://www.douyin.com/aweme/v1/web/mix/aweme/?mix_id=${mixId}&cursor=0&count=30&device_platform=webapp&aid=6383`
  try {
    const res = await sdk.network.request({
      url: mixApiUrl,
      headers: { Referer: 'https://www.douyin.com/' }
    })

    if (res.data && res.data.aweme_list && res.data.aweme_list.length > 0) {
      const items: DouyinVideoItem[] = res.data.aweme_list.map(mapAwemeItem)
      const first = items[0]
      return {
        type: 'mix',
        title: `合集_${mixId}`,
        authorName: first ? first.authorName : '抖音创作者',
        authorAvatar: first ? first.authorAvatar : '',
        cover: first ? first.cover : '',
        items
      }
    }
  } catch (err) {
    console.warn('[DouyinApi] 合集 API 请求异常，尝试 HTML 解析:', err)
  }

  // 2. HTML 页面结构解析
  try {
    const pageUrl = `https://www.douyin.com/collection/${mixId}`
    const pageRes = await sdk.network.request({
      url: pageUrl,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        Referer: 'https://www.douyin.com/'
      }
    })

    if (typeof pageRes.data === 'string') {
      const html = pageRes.data
      const titleMatch = html.match(/<title>([^<]+)<\/title>/)
      let rawTitle = titleMatch ? titleMatch[1].replace(' - 抖音', '').trim() : `合集_${mixId}`
      let author = '抖音创作者'
      if (rawTitle.includes(' - ')) {
        const parts = rawTitle.split(' - ')
        rawTitle = parts[0]
        author = parts[1] || author
      }

      const idMatches = Array.from(html.matchAll(/\/video\/(\d{15,21})/g))
      const seen = new Set<string>()
      const items: DouyinVideoItem[] = []

      for (const m of idMatches) {
        const vid = m[1]
        if (!seen.has(vid)) {
          seen.add(vid)
          items.push({
            awemeId: vid,
            title: `第 ${items.length + 1} 集`,
            desc: '',
            cover: '',
            videoUrl: `https://www.douyin.com/video/${vid}`,
            duration: 0,
            authorName: author,
            authorAvatar: '',
            ratio: '高清',
            selected: true
          })
        }
      }

      if (items.length > 0) {
        return {
          type: 'mix',
          title: rawTitle,
          authorName: author,
          authorAvatar: '',
          cover: items[0]?.cover || '',
          items
        }
      }
    }
  } catch (err) {
    console.warn('[DouyinApi] HTML 解析合集失败:', err)
  }

  throw new Error('未能在合集页面中提取到有效视频作品，请检查合集链接')
}

/**
 * 解析专题 (zhuanti) 页面
 */
export async function parseZhuanti(zhuantiId: string, sdk: DoujiaoSDK): Promise<DouyinParseResult> {
  const url = `https://m.douyin.com/zhuanti/${zhuantiId}`
  const resp = await sdk.network.request({
    url,
    headers: {
      'User-Agent':
        'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1'
    }
  })

  if (typeof resp.data !== 'string') {
    throw new Error('获取专题页面内容异常')
  }

  const html = resp.data
  const metaKw = html.match(/name="keywords" content="([^"]+)"/)?.[1]
  const metaDesc = html.match(/name="description" content="([^"]+)"/)?.[1]
  const descKwMatch = metaDesc?.match(/您在查找“([^”]+)”吗/)
  const title = metaKw || descKwMatch?.[1] || `抖音专题_${zhuantiId}`

  const itemMatches = Array.from(
    html.matchAll(/<li[^>]*class="[^"]*item[^"]*"[^>]*>([\s\S]*?)<\/li>/g)
  )

  const items: DouyinVideoItem[] = []
  const seenIds = new Set<string>()

  for (const match of itemMatches) {
    const liHtml = match[1]
    const idMatch = liHtml.match(/share\/video\/(\d+)/) || liHtml.match(/\/video\/(\d+)/)
    if (!idMatch) continue
    const awemeId = idMatch[1]
    if (seenIds.has(awemeId)) continue
    seenIds.add(awemeId)

    const titleMatch =
      liHtml.match(/<h4[^>]*class="[^"]*video-title[^"]*"[^>]*>([^<]+)<\/h4>/) ||
      liHtml.match(/alt="([^"]+)"/)
    const rawTitle = titleMatch ? titleMatch[1].replace(/\s+/g, ' ').trim() : `视频_${awemeId}`

    const imgMatch =
      liHtml.match(/<img[^>]*class="[^"]*video-img[^"]*"[^>]*src="([^"]+)"/) ||
      liHtml.match(/style="background-image:url\('([^']+)'\)"/)
    const cover = imgMatch ? imgMatch[1].replace(/&amp;/g, '&') : ''

    const authorMatch = liHtml.match(/<h5[^>]*class="[^"]*video-creator[^"]*"[^>]*>([\s\S]*?)<\/h5>/)
    let authorName = '抖音创作者'
    if (authorMatch) {
      authorName = authorMatch[1].replace(/@|<!--.*?-->/g, '').trim() || '抖音创作者'
    }

    const durationMatch = liHtml.match(/<div[^>]*class="[^"]*duration[^"]*"[^>]*>(\d+):(\d+)<\/div>/)
    let duration = 0
    if (durationMatch) {
      duration = parseInt(durationMatch[1], 10) * 60 + parseInt(durationMatch[2], 10)
    }

    items.push({
      awemeId,
      title: rawTitle,
      desc: rawTitle,
      cover,
      videoUrl: `https://www.douyin.com/video/${awemeId}`,
      duration,
      authorName,
      authorAvatar: '',
      ratio: '高清',
      selected: true
    })
  }

  if (items.length === 0) {
    throw new Error('未能在专题页面中解析到视频作品')
  }

  return {
    type: 'zhuanti',
    title,
    authorName: '抖音专题',
    authorAvatar: '',
    cover: items[0]?.cover || '',
    items
  }
}

/**
 * 统一解析调度器
 */
export async function parseDouyin(input: string, sdk: DoujiaoSDK): Promise<DouyinParseResult> {
  const parsed = await parseDouyinInput(input, sdk)

  if (parsed.type === 'zhuanti' && parsed.zhuantiId) {
    return parseZhuanti(parsed.zhuantiId, sdk)
  }

  if (parsed.type === 'mix' && parsed.mixId) {
    return parseCollection(parsed.mixId, sdk)
  }

  if (parsed.type === 'video' && parsed.awemeId) {
    if (parsed.mixId && input.includes('合集')) {
      try {
        return await parseCollection(parsed.mixId, sdk)
      } catch {
        // 回退到单视频解析
      }
    }

    const item = await fetchVideoDetail(parsed.awemeId, sdk)
    return {
      type: 'single',
      title: item.title,
      authorName: item.authorName,
      authorAvatar: item.authorAvatar,
      cover: item.cover,
      items: [item]
    }
  }

  if (parsed.type === 'user' && parsed.secUid) {
    const res = await fetchUserVideos(parsed.secUid, 0, sdk)
    return {
      type: 'user',
      title: `${res.user?.nickname || '创作者'} 的作品列表`,
      authorName: res.user?.nickname || '',
      authorAvatar: res.user?.avatar || '',
      cover: res.videos[0]?.cover || '',
      items: res.videos
    }
  }

  throw new Error('无法识别该链接或分享文案，请输入正确的抖音视频、合集或专题链接')
}

/**
 * 按用户名或关键词搜索创作者
 */
export async function searchUsers(keyword: string, sdk: DoujiaoSDK): Promise<DouyinUserItem[]> {
  const trimmed = keyword.trim()
  if (!trimmed) return []

  const url = `https://www.douyin.com/aweme/v1/web/discover/search/?keyword=${encodeURIComponent(
    trimmed
  )}&search_channel=aweme_user_web&device_platform=webapp&aid=6383&channel=channel_pc_web`

  const res = await sdk.network.request({
    url,
    headers: {
      Referer: `https://www.douyin.com/search/${encodeURIComponent(trimmed)}`
    }
  })

  const json = res.data as any
  if (json?.status_code === 2483) {
    throw new Error('搜索创作者需要登录抖音账号，请点击右上角「扫码登录」后重试')
  }

  if (json?.status_code !== 0 && json?.status_code !== undefined && !json?.user_list) {
    throw new Error(`搜索失败: ${json?.status_msg || '未知原因'}`)
  }

  const rawList: any[] = json?.user_list || json?.data || []
  return rawList.map((item) => {
    const u = item.user_info || item
    return {
      secUid: u.sec_uid || '',
      uid: u.uid || '',
      nickname: u.nickname || '未知用户',
      avatar: u.avatar_thumb?.url_list?.[0] || u.avatar_medium?.url_list?.[0] || '',
      uniqueId: u.unique_id || u.short_id || '',
      signature: u.signature || '',
      followerCount: u.follower_count || 0,
      totalFavorited: u.total_favorited || 0,
      awemeCount: u.aweme_count || 0
    }
  })
}

/**
 * 分页获取创作者投稿作品列表
 */
export async function fetchUserVideos(
  secUid: string,
  maxCursor = 0,
  sdk: DoujiaoSDK
): Promise<DouyinUserVideosResult> {
  const url = `https://www.douyin.com/aweme/v1/web/aweme/post/?device_platform=webapp&aid=6383&channel=channel_pc_web&sec_user_id=${secUid}&count=18&max_cursor=${maxCursor}`

  const res = await sdk.network.request({
    url,
    headers: {
      Referer: `https://www.douyin.com/user/${secUid}`
    }
  })

  const json = res.data as any
  if (json?.status_code === 2483) {
    throw new Error('获取用户作品需要登录账号，请点击右上角「扫码登录」后重试')
  }

  const awemeList: any[] = json?.aweme_list || []
  const videos = awemeList.map(mapAwemeItem)

  return {
    videos,
    hasMore: json?.has_more === 1,
    maxCursor: json?.max_cursor || 0
  }
}
