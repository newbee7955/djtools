export interface BiliPage {
  cid: number
  page: number
  part: string
  duration: number
  selected?: boolean
}

export interface BiliVideoInfo {
  bvid: string
  aid: number
  title: string
  desc: string
  pic: string
  duration: number
  owner: {
    mid: number
    name: string
    face: string
  }
  pages: BiliPage[]
}

export interface BiliStreamResult {
  quality: number
  videoUrl: string
  audioUrl?: string
}
