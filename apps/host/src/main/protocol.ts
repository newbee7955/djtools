import { protocol, net, app } from 'electron'
import { join, normalize } from 'path'
import { pathToFileURL } from 'url'
import { existsSync } from 'fs'
import { PluginManager } from './plugins/plugin-manager'

export const PLUGIN_PROTOCOL = 'doujiao-plugin'

/**
 * 在 app ready 之前声明自定义协议特权
 */
export function registerPluginScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: PLUGIN_PROTOCOL,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true
      }
    }
  ])
}

/**
 * 注册并处理 doujiao-plugin:// 自定义协议 (必须在 app ready 之后调用)
 * 格式: doujiao-plugin://<plugin-id>/<relative-path>
 */
export function registerPluginProtocol(): void {
  protocol.handle(PLUGIN_PROTOCOL, async (request) => {
    try {
      const url = new URL(request.url)
      const pluginId = url.hostname
      let pathname = decodeURIComponent(url.pathname)
      if (pathname.startsWith('/')) {
        pathname = pathname.slice(1)
      }
      if (!pathname) {
        pathname = 'index.html'
      }

      // 定位插件根目录：通过 PluginManager 获取（支持开发环境与不可变版本指针）
      const baseDir = PluginManager.getInstance().getActiveVersionDir(pluginId)

      if (!baseDir) {
        console.error(`[PluginProtocol] 找不到插件根目录: ${pluginId}`)
        return new Response('Plugin not found', { status: 404 })
      }

      // 防范 ZipSlip 和路径逃逸
      const resolvedPath = normalize(join(baseDir, pathname))
      if (!resolvedPath.startsWith(normalize(baseDir))) {
        console.warn(`[PluginProtocol] 拦截越权路径访问: ${pathname}`)
        return new Response('Access Denied', { status: 403 })
      }

      if (!existsSync(resolvedPath)) {
        return new Response('File Not Found', { status: 404 })
      }

      return await net.fetch(pathToFileURL(resolvedPath).toString())
    } catch (err: any) {
      console.error(`[PluginProtocol] 处理请求异常:`, err)
      return new Response(`Protocol Error: ${err?.message}`, { status: 500 })
    }
  })
}
