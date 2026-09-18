/**
 * 解析用户输入的 Bilibili 链接或 BV/AV 号
 */
export function extractBiliId(input: string): { bvid?: string; aid?: string; shortUrl?: string } | null {
  const text = input.trim()
  if (!text) return null

  // 1. 匹配短链 b23.tv
  const shortMatch = text.match(/(https?:\/\/b23\.tv\/[a-zA-Z0-9]+)/i)
  if (shortMatch) {
    return { shortUrl: shortMatch[1] }
  }

  // 2. 匹配 BV 号 (标准 12 位: BV 开头 + 10位字母数字)
  const bvMatch = text.match(/(BV[a-zA-Z0-9]{10})/i)
  if (bvMatch) {
    return { bvid: bvMatch[1] }
  }

  // 3. 匹配 AV 号 (av 开头 + 纯数字)
  const avMatch = text.match(/av(\d+)/i)
  if (avMatch) {
    return { aid: avMatch[1] }
  }

  return null
}
