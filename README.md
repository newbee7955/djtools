# 豆角工具箱 (DJTools) v0.3.0

> 基于 Electron + React + TypeScript 构建的高性能、模块化、插件化微内核桌面工具箱。

[![Release](https://img.shields.io/github/v/release/newbee7955/djtools?style=flat-square&label=最新版本)](https://github.com/newbee7955/djtools/releases/latest)
[![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows-lightgrey?style=flat-square)]()

---

## ✨ 功能概览

豆角工具箱采用**插件化微内核架构**，宿主负责窗口管理、权限沙箱、跨源网络代理与原生底层驱动，所有工具以独立插件形式按需运行、热更新加载。

---

## 🧩 插件列表

### 📸 时光相册 `time-album`
基于端侧边缘 AI 的智能家庭多媒体相册管理工具。

**功能亮点：**
- **本地 AI 人脸识别聚类**：纯离线边缘端运行，自动提取人脸特征并自动聚类为人物分组，支持人物相册重命名与合并
- **EXIF 时光轴画廊**：精准解析拍摄时间与地理相机参数，按年/月生成精美时光轴
- **「那年今日」历史回忆**：自动挖掘往年同日的珍贵相片生成横幅轮播
- **沉浸式预览与幻灯片**：全屏幻灯片播放、无损缩放、EXIF 详细参数抽屉
- **混合云源无缝挂载**：支持本地硬盘目录与 S3 / MinIO / OSS 远程云存储无缝挂载，切换数据源时自动冷热清理缓存

---

### 🎨 图片编辑器 `image-editor`
轻巧强大的专业图片处理与裁剪标注工具。

**功能亮点：**
- **自由与预设比例裁剪**：支持 1:1、4:3、16:9、自由比例等多重裁剪构图
- **几何旋转与镜像**：90° 旋转、水平镜像翻转、自由微调
- **滤镜与色彩调优**：亮度、对比度、饱和度即时预览调节
- **无损高清导出**：基于 Canvas 渲染引擎，保全图片原始高分辨率

---

### 📝 轻便记事本 `notepad` (v1.4.0)
专业便签管理工具，集成 AES-256 全局主密码硬件级安全加密。

**功能亮点：**
- **AES-256 全局主密码强加密**：便签正文通过 PBKDF2 + AES-256-GCM 强加密存盘，密码学零泄露设计
- **离开防窥自动上锁**：切换便签或离开时自动加密写盘并重新上锁，再次查看必须输入全局密码
- **加锁便签防误删保护**：删除任何受保护的加密便签（或包含加密便签的文件夹）必须输入密码验证
- **层级子目录管理**：支持在工作目录下创建多级子文件夹归档便签
- **全主题无缝自适应**：亮色与暗色模式深度重构，高对比纯净视觉排版
- **本地历史版本快照**：自动记录历史快照，支持时间轴 Diff 对比与一键恢复
- 独立 `.txt` 物理文件实时落盘，应用卸载重装数据永不丢失

---

### 📄 Markdown 编辑器 `markdown-editor` (v1.3.3)
专业 Markdown 写作与知识管理工具。

**功能亮点：**
- 编辑 / 预览 / 分屏三模式自由切换
- 实时 Markdown 渲染：代码高亮、表格、数学公式（KaTeX）
- 图片粘贴 & 拖拽插入
- **层级子目录侧边栏**：支持树状文件夹结构组织与管理文档
- **本地历史快照**：自动快照 + 里程碑标记 + 一键版本恢复 + Diff 对比
- 支持「另存为」与自定义工作目录，支持导入外部本地 `.md` 文件

---

### 🗄️ Samba 文件管理 `samba-manager`
专业 NAS / Samba 局域网网络存储管理器。

**功能亮点：**
- 多连接配置管理（IP / 端口 / 用户名 / 密码 / 域名），支持 NTLMv2
- 完整目录树浏览与文件操作（上传、下载、重命名、删除、新建目录）
- 流式上传下载，轻松传输超大文件
- 图片 / 视频**智能缩略图**（FFmpeg 主进程帧提取 + 本地缓存）
- 视频**在线流式播放**（HLS 分块传输，无需等待整片下载）
- 纯文本文件即时在线预览

---

### 🪣 对象存储管理 `object-storage` (v1.0.2)
多云对象存储统一客户端。

**功能亮点：**
- 支持 S3 / MinIO / 阿里云 OSS / 腾讯云 COS / Cloudflare R2 等全系列 S3 兼容存储
- **宿主网络通道代理**：全面免除存储桶的复杂 CORS 跨域配置
- 目录树浏览，文件拖拽上传，批量删除，中文层级目录完备支持
- 预签名分享链接一键生成
- **多媒体在线预览**：图片（缩放/旋转）、视频（倍速播放）、音频、PDF 内嵌、代码高亮

---

### ⚡ 局域网快传 `lan-transfer`
零安装局域网跨设备文件传输助手。

**功能亮点：**
- 电脑与手机双向互传文件，拖拽投放即传
- 手机扫码秒连，**免安装任何客户端或 App**
- 局域网文本即时互传（跨设备剪贴板）
- PIN 码鉴权保护，多网卡智能切换

---

### 🎵 抖音视频下载 `douyin-downloader`
无水印抖音多媒体下载工具。

**功能亮点：**
- 支持单视频、合集批量解析
- 无水印高清原画一键下载
- 批量链接解析与下载队列管理，支持图集/图文打包
- 宿主代理加速，下载不中断

---

### 📺 B站视频下载 `bilibili-downloader`
Bilibili 高清视频与音轨下载工具。

**功能亮点：**
- 支持 BV 号 / AV 号解析
- 最高 1080P 画质下载
- 音视频自动合并（内置 FFmpeg 原生驱动）
- 支持 Cookie 导入解锁大会员高码率内容

---

### 📋 剪贴板历史 `clipboard-history`
系统级剪贴板历史记录管理器。

**功能亮点：**
- 实时监听剪贴板变化，支持文本与图片预览
- 关键词极速过滤搜索，内容置顶收藏
- 一键复制回写，最多保存 200 条，智能防重复去重

---

### 🌐 内置极速浏览器 `browser`
基于独立会话的内嵌多标签轻量浏览器。

**功能亮点：**
- 独立 WebContents 渲染隔离
- 多标签页切换，书签收藏管理
- 百度 / 必应 / 谷歌智能搜画与寻址导航

---

## 🏗️ 架构特色

| 特性 | 说明 |
|------|------|
| **纯净微内核** | 宿主仅提供核心底座（窗口管理、隔离容器、权限代理、下载引擎），安装包精简原生 |
| **全主题自适应引擎** | 宿主提供 `LIGHT_THEME_CSS` 动态主题穿透技术，自动将插件 UI 适配为极致高质感的亮色或暗色视觉 |
| **侧边栏一键收折** | 支持 `Ctrl+B` 或点击图标一键在 68px 极简图标态与 240px 完整态间无缝切换，插件沙箱视口自适应拉伸 |
| **严格安全沙箱** | 插件在独立 `WebContentsView` 中运行，强制 `sandbox: true + contextIsolation: true` |
| **安全自定义协议** | 插件资源通过 `doujiao-plugin://<pluginId>/` 协议安全加载，物理隔绝路径遍历 |
| **受控 SDK** | `@doujiao/plugin-sdk` 统一通信契约，权限按需申请，杜绝违规越权调用 |
| **Ed25519 签名体系** | 官方私钥签名，宿主公钥验签，彻底杜绝安装包与插件市场包的中间人篡改 |
| **长任务脱耦** | 大文件传输与下载任务由主进程持有，切换/重启插件不中断下载 |
| **独立外部数据保全** | 记事本与 Markdown 文档默认持久化保存在用户本地磁盘，应用卸载升级永不丢失数据 |

---

## 📁 目录结构

```
djtools/
├── apps/
│   └── host/                    # 宿主微内核 (Electron + React)
│       ├── src/main/            # 主进程：安全底座、主题引擎、IPC 受控桥、下载服务
│       ├── src/preload/         # Preload 脚本（宿主 Shell + 插件沙箱 SDK）
│       └── src/renderer/        # 宿主 Shell UI（插件市场、侧边栏、更新检测）
├── packages/
│   └── plugin-sdk/              # 官方插件 SDK 与类型定义
├── plugins/
│   ├── time-album/              # 时光相册 (端侧 AI 人脸聚类 + EXIF 时间轴)
│   ├── image-editor/            # 图片编辑器 (裁剪 + 滤镜 + 缩放导出)
│   ├── notepad/                 # 轻便记事本 (AES-256 全局主密码 + 历史快照)
│   ├── markdown-editor/         # Markdown 编辑器 (子目录管理 + 版本控制)
│   ├── object-storage/          # 对象存储管理 (免 CORS 代理 + S3 全类型预览)
│   ├── samba-manager/           # Samba 文件管理 (视频流式在线播放)
│   ├── lan-transfer/            # 局域网快传 (手机扫码免装 App)
│   ├── douyin/                  # 抖音视频下载器
│   ├── bilibili/                # B站视频下载器
│   ├── clipboard-history/       # 剪贴板历史
│   └── browser/                 # 内置浏览器
├── registry/
│   ├── plugins-registry.json    # 插件市场中心索引（版本、下载链接、签名）
│   ├── app-version.json         # 主程序热更新检测配置
│   ├── models/face/             # 端侧人脸识别模型权重 (tiny_face_detector 等)
│   └── releases/                # 各插件独立 ZIP 发行包
└── scripts/
    ├── package-plugin.cjs       # 插件自动化打包 + SHA256 + Ed25519 签名脚本
    └── generate-keys.cjs        # 生成官方 Ed25519 密钥对
```

---

## 🚀 快速开始

### 下载安装

前往 [GitHub Releases](https://github.com/newbee7955/djtools/releases/latest) 下载最新安装包 `djtools-Setup-0.3.0.exe`，双击运行安装即可。

### 开发者指南

```bash
# 1. 安装全部工作区依赖
npm install

# 2. 启动宿主开发模式（热更新）
npm run dev

# 3. 构建宿主主程序
npm run build:host

# 4. 打包 Windows 安装程序 (.exe)
npm run package:win

# 5. 打包并签名指定插件（自动计算 SHA256 与 Ed25519 签名并更新 registry）
node scripts/package-plugin.cjs plugins/notepad

# 6. 构建所有插件
npm run build:plugins
```

---

## 📄 License

MIT © 2026 [newbee7955](https://github.com/newbee7955)
