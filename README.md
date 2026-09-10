# 豆角工具箱 (Doujiao) V2.0 - 插件化微内核架构

基于 Electron + React + TypeScript 构建的高性能、微内核、安全沙箱化的桌面工具箱。

---

## 架构特色

1. **纯净微内核**：宿主仅提供核心能力底座（窗口管理、WebContentsView 隔离容器、权限受控代理、集中式长任务下载引擎），安装包体积大幅瘦身。
2. **严格安全沙箱**：插件在独立的 `WebContentsView` 中运行，强制开启 `sandbox: true` 与 `contextIsolation: true`，禁止直接访问 Node 原生特权。
3. **安全自定义协议**：插件资源通过 `doujiao-plugin://<pluginId>/` 协议加载，杜绝 `file://` 路径遍历与安全逃逸。
4. **中心化长任务脱耦**：长时间下载流由宿主主进程持久持有，插件视图切换、刷新或升级不影响正在进行的下载任务。
5. **@doujiao/plugin-sdk**：统一的受控通信契约与生命周期接口，支持跨平台能力调用与自动取消监听防泄漏。

---

## 目录结构

```text
doujiao/
├── docs/                               # 架构设计与评审规格书
│   ├── PLUGIN_SYSTEM_DESIGN.md         # V2.0 工程规格书
│   └── PLUGIN_SYSTEM_DESIGN_REVIEW.md  # 架构设计深度评审
├── apps/
│   └── host/                           # 宿主微内核应用 (Electron + React)
│       ├── src/main/                   # 主进程：安全基线、WebContentsView 容器、IPC 受控桥、下载任务引擎
│       ├── src/preload/index.ts        # 宿主 Shell 专属特权 Preload
│       ├── src/preload/plugin.ts       # 注入沙箱的受控 SDK Preload (无 Node 权限)
│       └── src/renderer/               # 宿主外壳 UI (插件市场、侧边栏导航、下载托盘)
├── packages/
│   └── plugin-sdk/                     # 官方插件受控 SDK 与标准契约类型定义
└── plugins/
    └── douyin/                         # 首个解耦的官方沙箱插件 (抖音视频/合集/专题下载)
        ├── manifest.json               # 插件清单规范 (V2.0)
        └── src/                        # 纯前端 UI 与解析调用组件
```

---

## 常用命令

```bash
# 安装全部依赖并建立工作区软链接
npm install

# 启动宿主开发模式
npm run dev

# 构建插件产物
npm run build:plugins

# 构建宿主产物
npm run build:host

# 全工作区类型检查
npm run typecheck
```
