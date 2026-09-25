/**
 * 文件名净化：剔除 Windows 路径不允许的字符，保留可读标题
 */
export function sanitizeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_').trim()
}
