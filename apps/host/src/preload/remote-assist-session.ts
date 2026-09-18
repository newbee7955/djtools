/**
 * 远程协助会话窗口专用沙箱预加载脚本 (Session Preload Bridge)
 * 仅向会话窗口暴露极简的 WebRTC 信令交互和输入数据通道通道，严禁泄露 Node.js 原始能力
 */

import { contextBridge, ipcRenderer } from 'electron'

let signalListener: ((envelope: any) => void) | null = null
const signalQueue: any[] = []

ipcRenderer.on('remote-assist:session:signal', (_: any, envelope: any) => {
  if (signalListener) {
    try {
      signalListener(envelope)
    } catch (err) {
      console.error('[RemoteAssistSession] 信令回调执行错误:', err)
    }
  } else {
    signalQueue.push(envelope)
  }
})

const sessionApi = {
  sendSignal: (envelope: any) => {
    ipcRenderer.send('remote-assist:session:signal', envelope)
  },

  onSignal: (callback: (envelope: any) => void) => {
    signalListener = callback
    while (signalQueue.length > 0) {
      const sig = signalQueue.shift()
      try {
        callback(sig)
      } catch (err) {
        console.error('[RemoteAssistSession] 处理积压信令错误:', err)
      }
    }
    return () => {
      if (signalListener === callback) {
        signalListener = null
      }
    }
  },

  sendInput: (event: any) => {
    ipcRenderer.send('remote-assist:session:input', event)
  },

  setRemoteCursorHidden: (hidden: boolean) => {
    ipcRenderer.send('remote-assist:session:hide-cursor', Boolean(hidden))
  },

  onInput: (callback: (event: any) => void) => {
    const handler = (_: any, event: any) => {
      try {
        callback(event)
      } catch (err) {
        console.error('[RemoteAssistSession] 输入事件执行错误:', err)
      }
    }
    ipcRenderer.on('remote-assist:session:input', handler)
    return () => {
      ipcRenderer.removeListener('remote-assist:session:input', handler)
    }
  },

  disconnect: (reason?: string) => {
    ipcRenderer.send('remote-assist:session:disconnect', reason)
  },

  setConnected: () => {
    ipcRenderer.send('remote-assist:session:connected')
  },

  reportStats: (stats: any) => {
    ipcRenderer.send('remote-assist:session:stats', stats)
  },

  getSessionInfo: () => {
    return ipcRenderer.invoke('remote-assist:session:get-info')
  },

  setPreferredFps: (fps: number) => {
    ipcRenderer.send('remote-assist:session:set-preferred-fps', fps)
  },

  transfer: {
    // 主进程 -> 渲染进程：把要发送到对端的帧交给 DataChannel
    onOutgoingChunk: (cb: (bytes: Uint8Array) => void) => {
      const handler = (_: any, bytes: Uint8Array) => cb(new Uint8Array(bytes))
      ipcRenderer.on('remote-assist:transfer:outgoing-chunk', handler)
      return () => ipcRenderer.removeListener('remote-assist:transfer:outgoing-chunk', handler)
    },
    // 渲染进程 -> 主进程：DataChannel 收到的帧回传
    sendIncomingChunk: (bytes: Uint8Array) => ipcRenderer.send('remote-assist:transfer:incoming-chunk', bytes),
    // 通道就绪/关闭与背压上报
    notifyReady: () => ipcRenderer.send('remote-assist:transfer:ready'),
    notifyClosed: () => ipcRenderer.send('remote-assist:transfer:closed'),
    reportBackpressure: (bufferedAmount: number) => ipcRenderer.send('remote-assist:transfer:backpressure', bufferedAmount),
    // UI 事件
    onState: (cb: (state: any) => void) => {
      const handler = (_: any, state: any) => cb(state)
      ipcRenderer.on('remote-assist:transfer:state', handler)
      return () => ipcRenderer.removeListener('remote-assist:transfer:state', handler)
    },
    onChat: (cb: (text: string) => void) => {
      const handler = (_: any, text: string) => cb(text)
      ipcRenderer.on('remote-assist:transfer:chat', handler)
      return () => ipcRenderer.removeListener('remote-assist:transfer:chat', handler)
    },
    // 主进程 -> 渲染进程：发送失败原因（如传输通道未建立）
    onError: (cb: (msg: string) => void) => {
      const h = (_: any, msg: any) => cb(String(msg))
      ipcRenderer.on('remote-assist:transfer:error', h)
      return () => ipcRenderer.removeListener('remote-assist:transfer:error', h)
    },
    // 剪贴板已应用到本机的通知（用于窗口内的同步指示灯闪烁）
    onClipboardApplied: (cb: (kind: string) => void) => {
      const handler = (_: any, kind: string) => cb(kind)
      ipcRenderer.on('remote-assist:transfer:clipboard-applied', handler)
      return () => ipcRenderer.removeListener('remote-assist:transfer:clipboard-applied', handler)
    },
    sendChat: (text: string) => ipcRenderer.send('remote-assist:transfer:chat-from-window', text),
    // 发起文件发送：由主进程弹系统选择框（会话窗口无 Node 能力）
    requestSendFiles: () => ipcRenderer.send('remote-assist:transfer:request-send'),
    // 打开接收文件夹：会话窗口不是插件容器，走会话作用域通道（send，非 invoke）
    openReceiveFolder: () => ipcRenderer.send('remote-assist:transfer:open-receive-folder'),
    // 主进程选中文件后回传路径，用于 UI 反馈
    onPickResult: (cb: (paths: string[]) => void) => {
      const handler = (_: any, paths: string[]) => cb(paths)
      ipcRenderer.on('host:transfer:pick-files', handler)
      return () => ipcRenderer.removeListener('host:transfer:pick-files', handler)
    }
  }
}

contextBridge.exposeInMainWorld('remoteAssistSession', sessionApi)
