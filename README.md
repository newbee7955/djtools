# 豆角工具箱 (DJTools) v0.2.1

> 基于 Electron + React + TypeScript 构建的高性能、插件化微内核桌面工具箱。

[![Release](https://img.shields.io/github/v/release/newbee7955/djtools?style=flat-square&label=最新版本)](https://github.com/newbee7955/djtools/releases/latest)
[![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows-lightgrey?style=flat-square)]()

---

## ✨ 功能概览

豆角工具箱采用**插件化微内核架构**，宿主仅提供安全底座，所有功能以独立插件形式按需安装。

---

## 🧩 插件列表

### 📝 轻便记事本 `notepad`
多便签管理工具，支持文件版本历史控制。

**功能亮点：**
- 多便签同时管理，支持关键词实时搜索
- 置顶悬浮窗模式，随时可见
- 丰富的文本样式控制（字号、字体、粗体、斜体、颜色）
- **本地历史快照**：自动记录每次编辑历史，支持按时间点一键恢复，支持与当前内容 Diff 对比
- **智能快照合并**：5 分钟内的连续轻微编辑自动合并为同一快照，避免存储爆炸
- 支持「另存为」到任意本地路径，支持自定义默认工作目录
- 独立文件存储（`.txt` 格式），卸载应用不丢数据

---

### 📄 Markdown 编辑器 `markdown-editor`
专业 Markdown 写作与阅读工具。

**功能亮点：**
- 编辑 / 预览 / 分屏三模式自由切换
- 实时 Markdown 渲染：代码高亮、表格、数学公式（KaTeX）
- 图片粘贴 & 拖拽插入
- 文档库侧边栏：多文档管理，支持折叠
- **本地历史快照**：自动快照 + 里程碑快照 + 一键恢复 + Diff 对比
- 支持「另存为」与自定义工作目录
- 支持导入本地 `.md` / `.markdown` 文件

---

### 🎵 抖音视频下载 `douyin-downloader`
无水印抖音内容下载工具。

**功能亮点：**
- 支持单视频、合集、专题批量解析
- 无水印视频一键下载
- 批量链接解析与下载队列管理
- 支持图集 / 图文内容下载
- 下载历史记录
- 宿主代理加速，无需额外配置

---

### 📺 B站视频下载 `bilibili-downloader`
Bilibili 高清视频下载工具。

**功能亮点：**
- 支持 BV 号 / AV 号解析
- 最高 1080P 画质
- 音视频自动合并（FFmpeg）
- 支持 Cookie 登录解锁大会员内容
- 封面图同步下载

---

### 📋 剪贴板历史 `clipboard-history`
系统级剪贴板历史记录管理器。

**功能亮点：**
- 实时监听剪贴板变化，自动记录历史
- 支持文本 & 图片（缩略图预览）
- 关键词搜索历史记录
- 内容置顶收藏
- 一键复制回写，最多保存 200 条
- 重复内容自动去重

---

### 🌐 内置极速浏览器 `browser`
基于独立会话的内嵌多标签浏览器。

**功能亮点：**
- 独立 WebContents 渲染，与其他插件完全隔离
- 多标签页切换管理
- 书签收藏
- 智能搜索寻址（支持百度 / 必应 / 谷歌）
- 导航控制（前进、后退、刷新、主页）

---

### 🗄️ Samba 文件管理 `samba-manager`
专业 NAS / Samba 局域网文件管理器。

**功能亮点：**
- 多连接配置管理（IP / 端口 / 用户名 / 密码 / 域名）
- 完整目录树浏览与文件操作（上传、下载、重命名、删除、新建目录）
- 流式上传下载，支持大文件
- 图片 / 视频**智能缩略图**（FFmpeg 帧提取 + 本地缓存）
- 视频**在线流式播放**（HLS 分块传输）
- 纯文本文件在线预览

---

### 🪣 对象存储管理 `object-storage`
多云对象存储统一管理工具。

**功能亮点：**
- 支持 S3 / MinIO / 阿里云 OSS / 腾讯云 COS / Cloudflare R2 等所有 S3 兼容存储
- 目录树浏览，文件拖拽上传，批量删除
- 预签名分享链接一键生成
- **多媒体全类型在线预览**：图片（缩放/旋转）、视频（倍速播放）、音频、PDF 内嵌、代码高亮

---

### ⚡ 局域网快传 `lan-transfer`
零安装局域网跨设备文件传输助手。

**功能亮点：**
- 电脑与手机双向互传文件，拖拽投放即传
- 手机扫码秒连，**免安装 App**
- 局域网文本即时互传（跨设备剪贴板）
- PIN 码鉴权开关，保护传输安全
- 支持多网卡 IP 切换

---

## 🏗️ 架构特色

| 特性 | 说明 |
|------|------|
| **纯净微内核** | 宿主仅提供核心底座（窗口管理、隔离容器、权限代理、下载引擎），安装包精简 |
| **严格安全沙箱** | 插件在独立 `WebContentsView` 中运行，强制 `sandbox: true + contextIsolation: true` |
| **安全自定义协议** | 插件资源通过 `doujiao-plugin://<pluginId>/` 协议加载，杜绝路径遍历 |
| **受控 SDK** | `@doujiao/plugin-sdk` 统一通信契约，能力声明式申请，无法越权访问主进程 |
| **Ed25519 签名验证** | 插件包安装前验证官方 Ed25519 签名，防止恶意包篡改 |
| **长任务脱耦** | 下载任务由宿主主进程持久持有，插件切换/刷新/升级不中断下载 |
| **本地文件版本控制** | 编辑器插件内置 Local History 快照系统，独立于应用，卸载不丢失 |

---

## 📁 目录结构

```
djtools/
├── apps/
│   └── host/                    # 宿主微内核 (Electron + React)
│       ├── src/main/            # 主进程：安全底座、IPC 受控桥、下载引擎
│       ├── src/preload/         # Preload 脚本（宿主 Shell + 插件沙箱 SDK）
│       └── src/renderer/        # 宿主 Shell UI（市场、侧边栏、设置）
├── packages/
│   └── plugin-sdk/              # 官方插件 SDK 与类型定义
├── plugins/
│   ├── notepad/                 # 轻便记事本
│   ├── markdown-editor/         # Markdown 编辑器
│   ├── douyin/                  # 抖音下载器
│   ├── bilibili/                # B站下载器
│   ├── clipboard-history/       # 剪贴板历史
│   ├── browser/                 # 内置浏览器
│   ├── samba-manager/           # Samba 文件管理
│   ├── object-storage/          # 对象存储管理
│   └── lan-transfer/            # 局域网快传
├── registry/
│   ├── plugins-registry.json    # 插件市场索引（版本、下载链接、签名）
│   ├── app-version.json         # 主程序更新检测配置
│   └── releases/                # 插件 ZIP 发行包
└── scripts/
    ├── package-plugin.cjs       # 插件打包 + SHA256 + Ed25519 签名脚本
    └── generate-keys.cjs        # 生成官方 Ed25519 密钥对
```

---

## 🚀 快速开始

### 下载安装

前往 [Releases](https://github.com/newbee7955/djtools/releases/latest) 下载最新安装包 `djtools-Setup-x.x.x.exe`，双击安装即可。

### 开发环境

```bash
# 安装全部依赖
npm install

# 启动宿主开发模式（热更新）
npm run dev

# 构建主程序
npm run build:host

# 打包指定插件（自动签名并更新 registry）
node scripts/package-plugin.cjs plugins/notepad

# 构建所有插件
npm run build:plugins
```

---

## 📄 License

MIT © 2026 [newbee7955](https://github.com/newbee7955)