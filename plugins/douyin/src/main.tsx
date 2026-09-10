import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { definePlugin } from '@doujiao/plugin-sdk'

// 注册标准插件生命周期
definePlugin({
  activate: (ctx) => {
    console.log(`[Plugin:Douyin] 已在宿主沙箱中激活: ${ctx.pluginId} v${ctx.version}`)
  },
  deactivate: () => {
    console.log('[Plugin:Douyin] 插件沙箱已停用')
  }
})

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
