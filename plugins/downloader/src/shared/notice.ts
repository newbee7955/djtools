export type NoticeType = 'success' | 'error' | 'info'

/**
 * 外壳持有的统一提示通道：两个平台的 Tab 共用同一个 Toast
 */
export type ShowNotice = (text: string, type?: NoticeType) => void
