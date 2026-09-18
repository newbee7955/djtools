import { app, BrowserWindow, globalShortcut, Notification } from 'electron'
import { join } from 'path'
import { execSync } from 'child_process'
import log from 'electron-log'
import { is } from '@electron-toolkit/utils'
import { registerPluginScheme, registerPluginProtocol } from './protocol'
import { setupSecurityGuards } from './security'
import { PluginViewContainerManager } from './container/plugin-view'
import { registerPluginIpcBridge } from './ipc/bridge'
import { registerHostIpc } from './ipc/host-api'
import { ProxyManager } from './network/proxy-manager'
import { AppTrayManager } from './tray'

// Windows 控制台编码加固：自动将终端代码页切换为 UTF-8 (65001)，仅在开发模式下生效
if (process.platform === 'win32' && is.dev) {
  try {
    execSync('chcp 65001>nul 2>&1')
  } catch {}
  process.env.LANG = 'zh_CN.UTF-8'
  process.env.LC_ALL = 'zh_CN.UTF-8'
}

// 禁用 WebRTC 本地局域网真实 IP 掩蔽 (mDNS)，允许两端设备在同局域网或内网穿透时直接使用真实的 host IP 直连。
// 同时关闭 Windows 原生窗口遮挡计算，避免隐藏的受控会话窗口被当成遮挡而降速采集/编码。
app.commandLine.appendSwitch('disable-features', 'WebRtcHideLocalIpsWithMdns,CalculateNativeWinOcclusion')
// 远程协助受控窗口默认隐藏：禁止渲染进程后台节流，避免桌面采集/编码帧率被打到个位数
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
app.commandLine.appendSwitch('disable-background-timer-throttling')
app.commandLine.appendSwitch('ignore-gpu-blocklist')

// 支持通过命令行参数 --profile=<name> 或环境变量 DOUJIAO_PROFILE 指定独立 profile，支持单机多开联调
const profileArg = process.argv.find((arg) => arg.startsWith('--profile='))
const customProfile = profileArg ? profileArg.split('=')[1] : process.env.DOUJIAO_PROFILE

if (customProfile) {
  const appName = `doujiao-${customProfile}`
  app.setName(appName)
  try {
    const appData = app.getPath('appData')
    app.setPath('userData', join(appData, appName))
  } catch {}
} else {
  // 统一设定应用名称，确保 userData 目录一致为 %APPDATA%/doujiao
  app.setName('doujiao')
}

// 初始化结构化日志系统 (自动接管 console.log 并以 UTF-8 记录到 %APPDATA%/doujiao/logs/main.log)
try {
  log.initialize()
  Object.assign(console, log.functions)
} catch {}

// 0. 单实例互斥锁：防止多开冲突及底层 Chromium GPU/Disk Cache 文件锁定冲突 (0x5 ACCESS_DENIED)
const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  console.log('[Host] 检测到已有实例正在运行，自动退出当前重复进程并唤醒主窗口')
  app.quit()
  process.exit(0)
}

// 1. 必须在 app ready 之前声明自定义协议特权
registerPluginScheme()

let mainWindow: BrowserWindow | null = null

function createWindow(): BrowserWindow {
  const trayManager = AppTrayManager.getInstance()
  const iconPath = trayManager.getTrayIconPath()

  const win = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    frame: false,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    backgroundColor: '#0f172a',
    icon: iconPath,
    webPreferences: {
      sandbox: true,               // 加固：开启沙箱
      contextIsolation: true,      // 加固：上下文隔离
      nodeIntegration: false,      // 禁用 Node 原生直接注入
      preload: join(__dirname, '../preload/index.cjs'),
      webSecurity: true,
      spellcheck: false
    }
  })

  // 挂载主窗口安全拦截
  setupSecurityGuards(win.webContents, false)

  const isSilentStart = process.argv.includes('--hidden')

  win.on('ready-to-show', () => {
    if (!isSilentStart) {
      win.show()
    } else {
      console.log('[Host] 开机自启或静默模式启动，主窗口常驻系统托盘')
    }
  })

  // 拦截关闭事件：默认最小化到系统托盘，除非用户明确点击退出
  win.on('close', (event) => {
    if (!AppTrayManager.getInstance().getIsQuitting()) {
      event.preventDefault()
      win.hide()
    }
  })

  // 初始化插件沙箱容器与 IPC
  const containerManager = PluginViewContainerManager.getInstance()
  containerManager.init(win)

  registerHostIpc(win)
  registerPluginIpcBridge()

  // 加载宿主 Shell 界面
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  win.on('closed', () => {
    containerManager.destroyAll()
    mainWindow = null
  })

  return win
}

app.whenReady().then(async () => {
  // 0. 设置 Windows AppUserModelId，确保任务栏窗口与快捷方式正确关联并展示高清图标
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.doujiao.app')
  }

  // 1. 初始化并应用网络代理策略（默认跟随系统代理，可关闭直连或自定义）
  await ProxyManager.getInstance().init()

  // 2. 在 app ready 之后注册自定义协议处理器 (protocol.handle 依赖默认 session)
  registerPluginProtocol()

  mainWindow = createWindow()

  // 3. 初始化全局屏幕截图服务 (注册全局快捷键 Alt+Shift+A 与 Ctrl+Alt+A)
  const { ScreenshotService } = await import('./services/screenshot-service')
  ScreenshotService.getInstance().init(mainWindow)

  // 3.1 初始化录屏服务窗口守卫
  const { ScreenRecordingService } = await import('./services/screen-recording-service')
  ScreenRecordingService.getInstance().init(mainWindow)

  // 4. 初始化系统托盘（支持点击/双击唤醒及右键退出菜单）
  AppTrayManager.getInstance().init(mainWindow)

  // 4.1 注册远程协助紧急断开全局快捷键 CommandOrControl+Alt+Shift+Esc
  globalShortcut.register('CommandOrControl+Alt+Shift+Esc', async () => {
    const { RemoteAssistService } = await import('./services/remote-assist/remote-assist-service')
    await RemoteAssistService.getInstance().disconnect('emergency-shortcut')
  })

  // 4.2 监听远程协助会话状态，联动悬浮条、托盘与会话窗口
  const { RemoteAssistService } = await import('./services/remote-assist/remote-assist-service')
  const { RemoteControlIndicator } = await import('./container/remote-control-indicator')
  const { RemoteAssistSessionWindow } = await import('./container/remote-assist-session-window')
  let activeSessionWindow: any = null

  RemoteAssistService.getInstance().onEvent((event) => {
    if (event.type === 'incoming-request') {
      const trayManager = AppTrayManager.getInstance()

      // 1. 弹出系统原生通知
      try {
        if (Notification.isSupported()) {
          const notif = new Notification({
            title: '收到远程协助请求',
            body: `${event.fromDisplayName || '远端设备'} (${event.fromDeviceCode}) 请求控制您的电脑`,
            icon: trayManager.getTrayIconPath()
          })
          notif.on('click', () => {
            trayManager.showWindow()
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('host:navigate', 'remote-assist')
            }
          })
          notif.show()
        }
      } catch (err) {
        console.error('[RemoteAssist] 弹出系统通知失败:', err)
      }

      // 2. 唤醒并置前主窗口，并自动跳转到 remote-assist 插件页面显示授权确认弹窗
      trayManager.showWindow()
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('host:navigate', 'remote-assist')
      }
    }

    if (event.type === 'session-state') {
      const status = event.status
      const isActive = status.phase === 'connecting' || status.phase === 'connected'
      AppTrayManager.getInstance().updateRemoteAssistState(isActive)

      if (isActive && !activeSessionWindow) {
        activeSessionWindow = new RemoteAssistSessionWindow({
          role: status.role,
          sessionId: status.sessionId,
          permission: status.permission,
          peerDeviceCode: status.peerDeviceCode,
          safetyCode: status.safetyCode,
          iceServers: RemoteAssistService.getInstance().getIceServers(),
          service: RemoteAssistService.getInstance(),
          onDestroy: () => {
            activeSessionWindow = null
          }
        })

        if (status.role === 'controlled') {
          try {
            RemoteControlIndicator.getInstance().show(
              status.peerDeviceCode,
              status.permission === 'control',
              () => RemoteAssistService.getInstance().disconnect('indicator-clicked')
            )
          } catch (e) {
            console.error('[RemoteControlIndicator] 显示浮条异常:', e)
          }
        }
      } else if (status.phase === 'idle') {
        if (activeSessionWindow) {
          activeSessionWindow.destroy()
          activeSessionWindow = null
        }
        try {
          RemoteControlIndicator.getInstance().hide()
        } catch (e) {
          console.error('[RemoteControlIndicator] 隐藏浮条异常:', e)
        }
      }
    }

    if (event.type === 'session-ended') {
      if (activeSessionWindow) {
        activeSessionWindow.destroy()
        activeSessionWindow = null
      }
      try {
        RemoteControlIndicator.getInstance().hide()
      } catch {}
    }
  })

  // 5. 启动主程序静默更新检测（延时 4 秒，不阻塞首屏）
  const { AppUpdateService } = await import('./services/app-update-service')
  AppUpdateService.getInstance().startAutoCheck((info) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('host:app-update:available', info)
    }
  })

  // 监听多开事件，唤醒现有主窗口
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
  })

  app.on('activate', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    } else if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', async () => {
  try {
    const { ScreenshotService } = await import('./services/screenshot-service')
    ScreenshotService.getInstance().unregisterGlobalShortcuts()
    const { ScreenRecordingService } = await import('./services/screen-recording-service')
    ScreenRecordingService.getInstance().shutdown()
    globalShortcut.unregister('CommandOrControl+Alt+Shift+Esc')
    const { RemoteAssistService } = await import('./services/remote-assist/remote-assist-service')
    await RemoteAssistService.getInstance().disconnect('app-quit')
  } catch {}
  AppTrayManager.getInstance().setQuitting(true)
  PluginViewContainerManager.getInstance().destroyAll()
  AppTrayManager.getInstance().destroy()
})
