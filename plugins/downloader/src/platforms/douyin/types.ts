/**
 * 抖音沙箱插件数据类型定义
 */

export interface DouyinQualityOption {
  label: string
  url: string
  gearName?: string
  qualityType?: number
  bitRate?: number
}

export interface DouyinVideoItem {
  awemeId: string
  title: string
  desc: string
  cover: string
  videoUrl: string
  duration: number
  authorName: string
  authorAvatar: string
  authorSecUid?: string
  ratio?: string
  selected?: boolean
  qualities?: DouyinQualityOption[]
  selectedQualityUrl?: string
}

export interface DouyinParseResult {
  type: 'single' | 'mix' | 'zhuanti' | 'user'
  title: string
  authorName: string
  authorAvatar: string
  cover: string
  items: DouyinVideoItem[]
}

export interface DouyinUserItem {
  secUid: string
  uid: string
  nickname: string
  avatar: string
  uniqueId: string
  signature: string
  followerCount: number
  totalFavorited: number
  awemeCount: number
}

export interface DouyinUserVideosResult {
  user?: DouyinUserItem
  videos: DouyinVideoItem[]
  hasMore: boolean
  maxCursor: number
}
