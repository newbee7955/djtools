import { getSDK } from '@doujiao/plugin-sdk'
import type { BiliVideoInfo, BiliStreamResult } from '../types'
import { extractBiliId } from './parser'

const DEFAULT_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  'Referer': 'https://www.bilibili.com/'
}

/**
 * 还原 b23.tv 短链接为真实 BV 号
 */
export async function resolveBiliShortLink(shortUrl: string): Promise<string | null> {
  const sdk = getSDK()
  try {
    const res = await sdk.network.request<string>({
      url: shortUrl,
      method: 'GET',
      headers: DEFAULT_HEADERS
    })

    // 检查响应头或页面 HTML 中的真实目标地址
    const loc = res.headers['location'] || res.headers['Location']
    if (loc) {
      const match = loc.match(/(BV[a-zA-Z0-9]{10})/i)
      if (match) return match[1]
    }

    if (typeof res.data === 'string') {
      const match = res.data.match(/(BV[a-zA-Z0-9]{10})/i)
      if (match) return match[1]
    }
  } catch (err) {
    console.warn('[BiliApi] 解析短链失败:', err)
  }
  return null
}

/**
 * 获取 B 站视频核心元数据与全部分 P 列表
 */
export async function getVideoDetail(bvid: string): Promise<BiliVideoInfo> {
  const sdk = getSDK()
  const apiUrl = `https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`

  const res = await sdk.network.request<any>({
    url: apiUrl,
    method: 'GET',
    headers: DEFAULT_HEADERS
  })

  if (res.data?.code !== 0 || !res.data?.data) {
    throw new Error(res.data?.message || '获取视频信息失败，可能触发风控或视频已下架')
  }

  const d = res.data.data
  return {
    bvid: d.bvid,
    aid: d.aid,
    title: d.title,
    desc: d.desc,
    pic: d.pic,
    duration: d.duration,
    owner: {
      mid: d.owner?.mid,
      name: d.owner?.name,
      face: d.owner?.face
    },
    pages: (d.pages || []).map((p: any) => ({
      cid: p.cid,
      page: p.page,
      part: p.part || `第 ${p.page} 集`,
      duration: p.duration,
      selected: true
    }))
  }
}

export interface BiliQualityOption {
  qn: number
  label: string
}

export const BILI_QUALITY_OPTIONS: BiliQualityOption[] = [
  { qn: 116, label: '1080P 60帧 高清' },
  { qn: 80, label: '1080P 高清' },
  { qn: 64, label: '720P 高清' },
  { qn: 32, label: '480P 清晰' },
  { qn: 16, label: '360P 流畅' }
]

export function getQualityLabel(qn: number): string {
  const opt = BILI_QUALITY_OPTIONS.find((o) => o.qn === qn)
  return opt ? opt.label : `${qn}P`
}

/**
 * 获取指定分 P 的无损音视频流播放地址
 * 支持 DASH 格式（需 FFmpeg）与 DURL 单流 MP4 格式（免混流）
 */
export async function getPlayStream(
  bvid: string,
  cid: number,
  qn = 80,
  preferDash = true
): Promise<BiliStreamResult> {
  const sdk = getSDK()
  const fnval = preferDash ? '16&fourk=1' : '0'
  const apiUrl = `https://api.bilibili.com/x/player/playurl?bvid=${bvid}&cid=${cid}&qn=${qn}&fnval=${fnval}`

  const res = await sdk.network.request<any>({
    url: apiUrl,
    method: 'GET',
    headers: DEFAULT_HEADERS
  })

  if (res.data?.code !== 0 || !res.data?.data) {
    throw new Error(res.data?.message || '获取视频流地址失败')
  }

  const data = res.data.data

  // 1. 若优先 DASH 且平台返回了 dash 音视频分离流
  if (preferDash && data.dash) {
    const videoList: any[] = data.dash.video || []
    // 优先匹配用户请求的清晰度 qn，如果没有精确匹配则找小于等于 qn 的最高可用流，最后回退取第一个
    const video =
      videoList.find((v: any) => v.id === qn) ||
      videoList.find((v: any) => v.id <= qn) ||
      videoList[0]
    const audio = data.dash.audio?.[0]

    const videoUrl = video?.baseUrl || video?.backupUrl?.[0]
    const audioUrl = audio?.baseUrl || audio?.backupUrl?.[0]

    if (videoUrl) {
      return {
        quality: video.id || data.quality,
        videoUrl,
        audioUrl
      }
    }
  }

  // 2. DURL 传统单流 MP4 格式（音视频内置合一，免任何 FFmpeg 混流依赖）
  if (data.durl && data.durl.length > 0) {
    const stream = data.durl[0]
    return {
      quality: data.quality,
      videoUrl: stream.url
    }
  }

  // 3. 若 DASH 请求未获得可用地址，回退尝试一次传统单流
  if (preferDash) {
    return await getPlayStream(bvid, cid, qn, false)
  }

  throw new Error('未获取到可用的视频流地址')
}
