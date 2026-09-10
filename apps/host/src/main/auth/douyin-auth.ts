import { BrowserWindow, session, app, net } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync } from 'fs'

let loginWindow: BrowserWindow | null = null
let cachedTtwid = ''
let ttwidExpireTime = 0

function getAuthFilePath(): string {
  return join(app.getPath('userData'), 'auth_douyin.json')
}

export function getDouyinCookie(): string {
  try {
    const file = getAuthFilePath()
    if (existsSync(file)) {
      const data = JSON.parse(readFileSync(file, 'utf-8'))
      return data.cookie || ''
    }
  } catch (err) {
    console.warn('[DouyinAuth] 读取 Cookie 文件失败:', err)
  }
  return ''
}

export function saveDouyinCookie(cookie: string): void {
  try {
    const file = getAuthFilePath()
    writeFileSync(file, JSON.stringify({ cookie, updatedAt: Date.now() }, null, 2), 'utf-8')
  } catch (err) {
    console.error('[DouyinAuth] 保存 Cookie 文件失败:', err)
  }
}

/**
 * 动态申请并缓存官方 ttwid Cookie (有效期约 30 分钟)
 */
export async function getDynamicTtwid(): Promise<string> {
  const now = Date.now()
  if (cachedTtwid && now < ttwidExpireTime) {
    return cachedTtwid
  }

  try {
    const resp = await net.fetch('https://ttwid.bytedance.com/ttwid/union/register/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        aid: 1768,
        union: true,
        needFid: false,
        service: 'www.ixigua.com',
        region: 'cn',
        migrate_info: { ticket: '', source: 'node' },
        cbUrlProtocol: 'https'
      })
    })

    const setCookie = resp.headers.get('set-cookie') || ''
    const match = setCookie.match(/ttwid=([^;]+)/)
    if (match) {
      cachedTtwid = match[1]
      ttwidExpireTime = now + 30 * 60 * 1000
      console.log('[DouyinAuth] 动态获取官方 ttwid 成功')
      return cachedTtwid
    }
  } catch (err) {
    console.warn('[DouyinAuth] 动态获取 ttwid 失败:', err)
  }

  return cachedTtwid
}

/**
 * 检查当前是否有有效的抖音登录凭证
 */
export function getDouyinLoginStatus(): { loggedIn: boolean } {
  const cookie = getDouyinCookie()
  if (!cookie) return { loggedIn: false }
  const hasSession = cookie.includes('sessionid') || cookie.includes('passport_csrf_token')
  return { loggedIn: hasSession }
}

/**
 * 弹出抖音安全隔离登录窗口，监听并捕获登录 Cookie
 */
export function openDouyinLoginWindow(): Promise<{ success: boolean; message?: string }> {
  if (loginWindow && !loginWindow.isDestroyed()) {
    loginWindow.focus()
    return Promise.resolve({ success: false, message: '登录窗口已打开' })
  }

  return new Promise((resolve) => {
    loginWindow = new BrowserWindow({
      width: 1020,
      height: 720,
      title: '登录抖音账号 (宿主受控隔离环境)',
      autoHideMenuBar: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true
      }
    })

    // 阻止唤起系统外部应用协议（如 bytedance://、snssdk1128:// 等）
    loginWindow.webContents.on('will-navigate', (event, navUrl) => {
      if (!navUrl.startsWith('http://') && !navUrl.startsWith('https://')) {
        event.preventDefault()
      }
    })
    loginWindow.webContents.on('will-frame-navigate', (event) => {
      if (!event.url.startsWith('http://') && !event.url.startsWith('https://')) {
        event.preventDefault()
      }
    })
    loginWindow.webContents.setWindowOpenHandler(({ url: openUrl }) => {
      if (!openUrl.startsWith('http://') && !openUrl.startsWith('https://')) {
        return { action: 'deny' }
      }
      return { action: 'allow' }
    })

    loginWindow.loadURL('https://www.douyin.com/')

    let checkInterval: NodeJS.Timeout | null = null
    let resolved = false

    const cleanup = () => {
      if (checkInterval) {
        clearInterval(checkInterval)
        checkInterval = null
      }
      loginWindow = null
    }

    // 轮询检查登录 Cookie
    checkInterval = setInterval(async () => {
      try {
        const cookies = await session.defaultSession.cookies.get({
          domain: '.douyin.com'
        })

        const hasSession = cookies.some(
          (c) => c.name === 'sessionid' || c.name === 'sessionid_ss' || c.name === 'LOGIN_STATUS'
        )

        if (hasSession) {
          console.log('[DouyinAuth] 检测到抖音登录成功，正在提取安全凭据...')
          const cookieStr = cookies.map((c) => `${c.name}=${c.value}`).join('; ')
          saveDouyinCookie(cookieStr)

          resolved = true
          cleanup()
          if (loginWindow && !loginWindow.isDestroyed()) {
            loginWindow.close()
          }
          resolve({ success: true, message: '登录成功' })
        }
      } catch (err) {
        console.error('[DouyinAuth] 检查 Cookie 异常:', err)
      }
    }, 1500)

    loginWindow.on('closed', () => {
      cleanup()
      if (!resolved) {
        resolve({ success: false, message: '用户取消登录或窗口已关闭' })
      }
    })
  })
}
