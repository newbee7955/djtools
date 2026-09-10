const fs = require('fs')
const path = require('path')

/**
 * 豆角工具箱插件脚手架生成工具
 * 用法: node scripts/create-plugin.cjs <plugin-id> [plugin-name] [icon]
 * 示例: node scripts/create-plugin.cjs xiaohongshu "小红书图文/视频下载器" 📕
 */
function createPlugin(pluginId, pluginName, icon = '🧩') {
  if (!pluginId) {
    console.error('错误: 请指定插件 ID，例如: node scripts/create-plugin.cjs kuaishou "快手视频下载器"')
    process.exit(1)
  }

  const targetId = pluginId.replace(/^plugin-/, '')
  const finalName = pluginName || `${targetId} 插件`
  const targetDir = path.resolve(__dirname, '../plugins', targetId)

  if (fs.existsSync(targetDir)) {
    console.error(`错误: 插件目录已存在: ${targetDir}`)
    process.exit(1)
  }

  console.log(`\n========================================`)
  console.log(`[PluginScaffold] 正在生成新插件: ${finalName} (${targetId})`)
  console.log(`[PluginScaffold] 目标目录: ${targetDir}`)
  console.log(`========================================`)

  fs.mkdirSync(path.join(targetDir, 'src'), { recursive: true })

  // 1. package.json
  const packageJson = {
    name: `@doujiao/plugin-${targetId}`,
    version: '1.0.0',
    private: true,
    type: 'module',
    scripts: {
      dev: 'vite',
      build: 'tsc && vite build',
      typecheck: 'tsc --noEmit'
    },
    dependencies: {
      '@doujiao/plugin-sdk': '*',
      react: '^18.3.1',
      'react-dom': '^18.3.1'
    },
    devDependencies: {
      '@types/react': '^18.3.18',
      '@types/react-dom': '^18.3.5',
      '@vitejs/plugin-react': '^4.3.4',
      autoprefixer: '^10.4.20',
      postcss: '^8.4.49',
      tailwindcss: '^3.4.17',
      typescript: '^5.7.3',
      vite: '^5.4.11'
    }
  }
  fs.writeFileSync(path.join(targetDir, 'package.json'), JSON.stringify(packageJson, null, 2), 'utf-8')

  // 2. manifest.json (微内核标准元数据与能力声明)
  const manifest = {
    $schema: 'https://doujiao.app/schemas/plugin-manifest.v2.json',
    id: `${targetId}-downloader`,
    publisher: 'doujiao-developer',
    name: finalName,
    version: '1.0.0',
    description: `支持 ${finalName} 资源解析、高清提取与批量下载`,
    icon: icon,
    engines: {
      doujiao: '>=0.2.0 <0.3.0',
      pluginApi: '^1.0.0'
    },
    entrypoints: {
      ui: 'dist/index.html'
    },
    permissions: [
      {
        capability: 'network.request',
        hosts: ['*'],
        methods: ['GET', 'POST']
      },
      {
        capability: 'download.enqueue',
        formats: ['mp4', 'jpg', 'png']
      }
    ]
  }
  fs.writeFileSync(path.join(targetDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8')

  // 3. vite.config.ts
  const viteConfig = `import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    assetsDir: 'assets'
  }
})
`
  fs.writeFileSync(path.join(targetDir, 'vite.config.ts'), viteConfig, 'utf-8')

  // 4. tsconfig.json
  const tsconfig = {
    compilerOptions: {
      target: 'ES2022',
      useDefineForClassFields: true,
      lib: ['ES2023', 'DOM', 'DOM.Iterable'],
      module: 'ESNext',
      skipLibCheck: true,
      moduleResolution: 'bundler',
      jsx: 'react-jsx',
      strict: true,
      resolveJsonModule: true,
      isolatedModules: true,
      esModuleInterop: true,
      noEmit: true
    },
    include: ['src']
  }
  fs.writeFileSync(path.join(targetDir, 'tsconfig.json'), JSON.stringify(tsconfig, null, 2), 'utf-8')

  // 5. postcss.config.js & tailwind.config.js
  fs.writeFileSync(
    path.join(targetDir, 'postcss.config.js'),
    `export default { plugins: { tailwindcss: {}, autoprefixer: {} } }\n`,
    'utf-8'
  )
  fs.writeFileSync(
    path.join(targetDir, 'tailwind.config.js'),
    `/** @type {import('tailwindcss').Config} */\nexport default {\n  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],\n  theme: { extend: {} },\n  plugins: [],\n}\n`,
    'utf-8'
  )

  // 6. index.html
  const indexHtml = `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'self' doujiao-plugin:; script-src 'self' 'unsafe-inline' doujiao-plugin:; style-src 'self' 'unsafe-inline' doujiao-plugin:; img-src 'self' data: https: doujiao-plugin:; connect-src 'self' doujiao-plugin:;" />
    <title>${finalName}</title>
  </head>
  <body class="bg-slate-900 text-slate-100 font-sans select-none overflow-x-hidden">
    <div id="root"></div>
    <script type="module" src="./src/main.tsx"></script>
  </body>
</html>
`
  fs.writeFileSync(path.join(targetDir, 'index.html'), indexHtml, 'utf-8')

  // 7. src/index.css
  fs.writeFileSync(
    path.join(targetDir, 'src/index.css'),
    `@tailwind base;\n@tailwind components;\n@tailwind utilities;\n\nbody { margin: 0; padding: 0; }\n`,
    'utf-8'
  )

  // 8. src/main.tsx
  const mainTsx = `import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
`
  fs.writeFileSync(path.join(targetDir, 'src/main.tsx'), mainTsx, 'utf-8')

  // 9. src/App.tsx (包含标准 SDK 调用的演示模板)
  const appTsx = `import React, { useState, useEffect } from 'react'
import { getSDK } from '@doujiao/plugin-sdk'

export default function App(): JSX.Element {
  const [inputUrl, setInputUrl] = useState('')
  const [parsedItem, setParsedItem] = useState<{ title: string; mediaUrl: string } | null>(null)
  const [statusMsg, setStatusMsg] = useState<string | null>(null)
  const [recentTasks, setRecentTasks] = useState<any[]>([])

  // 1. 订阅宿主广播的下载进度
  useEffect(() => {
    try {
      const sdk = getSDK()
      const unsubscribe = sdk.download.onProgress((info) => {
        setRecentTasks((prev) => {
          const idx = prev.findIndex((t) => t.taskId === info.taskId)
          if (idx >= 0) {
            const copy = [...prev]
            copy[idx] = info
            return copy
          }
          return [info, ...prev].slice(0, 5)
        })
      })
      return () => unsubscribe()
    } catch (e) {}
  }, [])

  // 2. 模拟解析逻辑（实际开发中可通过 sdk.network.request 请求目标平台 API）
  const handleParse = async () => {
    if (!inputUrl.trim()) return
    setStatusMsg('正在通过宿主受控代理请求解析...')

    try {
      const sdk = getSDK()
      // 示例: 通过受控网络代理请求
      // const res = await sdk.network.request({ url: inputUrl, method: 'GET' })

      // 演示数据
      setParsedItem({
        title: \`测试解析作品 - \${Date.now().toString().slice(-4)}\`,
        mediaUrl: 'https://www.w3schools.com/html/mov_bbb.mp4'
      })
      setStatusMsg('解析成功！')
    } catch (err: any) {
      setStatusMsg(\`解析失败: \${err?.message || '未知错误'}\`)
    }
  }

  // 3. 推入宿主下载队列
  const handleDownload = async () => {
    if (!parsedItem) return
    const sdk = getSDK()
    const taskId = await sdk.download.enqueue({
      url: parsedItem.mediaUrl,
      filename: \`\${parsedItem.title}.mp4\`,
      extra: {
        title: parsedItem.title,
        platform: '${targetId}'
      }
    })
    setStatusMsg(\`任务已推入宿主后台下载队列 (ID: \${taskId.slice(0, 10)}...)\`)
  }

  return (
    <div className="min-h-full bg-slate-900 text-slate-100 p-8 flex flex-col space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-3xl">${icon}</span>
          <div>
            <h1 className="text-xl font-bold text-white">${finalName}</h1>
            <p className="text-xs text-slate-400 mt-0.5">扩展应用功能，由主程序安全协同管理</p>
          </div>
        </div>

        <button
          onClick={() => getSDK().download.openSaveDirectory()}
          className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 border border-slate-700 transition-colors"
        >
          📂 打开保存目录
        </button>
      </div>

      <div className="p-5 rounded-xl bg-slate-950/60 border border-slate-800 space-y-3">
        <label className="text-xs font-semibold text-slate-300">目标内容链接</label>
        <div className="flex gap-2">
          <input
            type="text"
            value={inputUrl}
            onChange={(e) => setInputUrl(e.target.value)}
            placeholder="粘贴要解析的链接..."
            className="flex-1 bg-slate-900 border border-slate-800 rounded-xl px-4 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
          />
          <button
            onClick={handleParse}
            className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-xs shadow-md transition-all"
          >
            开始解析
          </button>
        </div>
      </div>

      {statusMsg && (
        <div className="p-3 rounded-lg bg-slate-800 text-xs text-slate-300">
          {statusMsg}
        </div>
      )}

      {parsedItem && (
        <div className="p-5 rounded-xl bg-slate-950/40 border border-slate-800 space-y-3">
          <h3 className="font-semibold text-white text-sm">{parsedItem.title}</h3>
          <p className="text-xs text-slate-400 font-mono truncate">{parsedItem.mediaUrl}</p>
          <button
            onClick={handleDownload}
            className="px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 text-slate-950 font-semibold text-xs transition-all shadow-lg"
          >
            📥 推入宿主下载
          </button>
        </div>
      )}

      {recentTasks.length > 0 && (
        <div className="p-4 rounded-xl bg-slate-950/40 border border-slate-800 space-y-2">
          <div className="text-xs font-semibold text-slate-400">后台长效下载进度</div>
          {recentTasks.map((t) => (
            <div key={t.taskId} className="text-xs flex justify-between text-slate-300">
              <span className="truncate max-w-xs">{t.filename}</span>
              <span className="font-mono">{t.status === 'completed' ? '完成' : \`\${t.speed} (\${t.progress}%)\`}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
`
  fs.writeFileSync(path.join(targetDir, 'src/App.tsx'), appTsx, 'utf-8')

  console.log(`✓ 插件基础骨架生成成功: plugins/${targetId}/`)
  console.log(`\n========================================`)
  console.log(`下一步操作指引:`)
  console.log(`  1. 进入插件目录: cd plugins/${targetId}`)
  console.log(`  2. 编写你的业务解析逻辑: 编辑 plugins/${targetId}/src/App.tsx`)
  console.log(`  3. 编译插件产物: npm run build`)
  console.log(`  4. 启动宿主 (主程序将自动无缝发现并挂载新插件，无需修改任何主程序代码!):`)
  console.log(`     npm run dev`)
  console.log(`  5. 打包并发布到市场: node scripts/package-plugin.cjs plugins/${targetId}`)
  console.log(`========================================\n`)
}

if (require.main === module) {
  const args = process.argv.slice(2)
  const id = args[0]
  const name = args[1]
  const icon = args[2]
  createPlugin(id, name, icon)
}

module.exports = { createPlugin }
