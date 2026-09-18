import { shell, WebContents } from 'electron'
import { PLUGIN_PROTOCOL } from './protocol'

/**
 * 加固 WebContents 安全基线
 */
export function setupSecurityGuards(contents: WebContents, isPluginView = false): void {
  // 1. 拦截未授权导航
  contents.on('will-navigate', (event, navigationUrl) => {
    try {
      const parsed = new URL(navigationUrl)
      // 宿主允许 dev 服务的 localhost / http，或自定义插件协议
      if (parsed.protocol === `${PLUGIN_PROTOCOL}:`) {
        return
      }
      if (process.env.NODE_ENV === 'development' && (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')) {
        return
      }

      event.preventDefault()
      console.warn(`[Security] 拦截未授权页面跳转: ${navigationUrl}`)
    } catch {
      event.preventDefault()
    }
  })

  // 2. 拦截所有子 frame 跳转（彻底防止系统弹窗或协议劫持）
  contents.on('will-frame-navigate', (event) => {
    try {
      const parsed = new URL(event.url)
      if (parsed.protocol === `${PLUGIN_PROTOCOL}:` || parsed.protocol === 'about:') {
        return
      }
      if (process.env.NODE_ENV === 'development' && (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')) {
        return
      }
      event.preventDefault()
    } catch {
      event.preventDefault()
    }
  })

  // 3. 拦截 window.open 弹窗
  contents.setWindowOpenHandler((details) => {
    try {
      const parsed = new URL(details.url)
      // 仅允许安全的 http/https 外链在系统默认浏览器中打开
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        shell.openExternal(details.url)
      } else {
        console.warn(`[Security] 拒绝唤醒非安全协议: ${details.url}`)
      }
    } catch (err) {
      console.warn(`[Security] 解析弹窗 URL 失败:`, err)
    }
    return { action: 'deny' }
  })
}
