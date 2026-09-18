# 远程协助 V2：传输与共享（文件传输 / 剪贴板同步 / 文字聊天）设计

- 日期：2026-09-17
- 状态：待评审
- 关联：`docs/superpowers/plans/2026-09-16-mutual-remote-assist.md`（V1 明确将剪贴板同步、文件传输列为"暂缓"）
- 前置成果：V1 已实现公网信令 + WebRTC P2P 屏幕流 + DataChannel 键鼠输入 + 原生输入注入 + 有人值守授权；并已完成安全加固（信令验签与来源绑定、入站信令来源/会话校验、握手超时、信令出站队列、画面注入转义）。

## 1. 目标与非目标

### 目标
在已建立的远程协助会话内，补齐与成熟远控软件（TeamViewer / AnyDesk / ToDesk / RustDesk / 向日葵）对标的三项高频能力：

1. **文件传输**：控制端/受控端双向传输文件与文件夹，带进度、取消、排队。
2. **剪贴板同步**：文本、图片、文件列表（`CF_HDROP` 粘贴语义）双向同步。
3. **文字聊天**：会话内纯文本消息，作为无第三条通道时的沟通手段。

### 非目标（明确不做）
- **无人值守 / 固定密码 / 开机静默连入 / Wake-on-LAN 自动唤醒**：与"绝对有人值守"产品原则冲突，不做。
- 远程重启 / 关机 / 注册表 / 命令执行 / 远程打印。
- 断点续传（后续版本）。
- 多并发传输（同一时刻仅 1 个传输，其余排队）。
- 传输内容落盘审计（不上传、不分析、不持久化传输内容以外的元数据）。

## 2. 已确认的产品决策

| 决策点 | 结论 |
|---|---|
| 本批范围 | 文件传输 + 剪贴板同步（文本/图片/文件）+ 文字聊天 |
| 剪贴板粒度 | 文本 + 图片 + 文件列表 |
| 入站文件授权 | **会话级一次授权，可随时撤销** |
| 落盘模型 | **混合**：剪贴板来源 → 暂存 + 置入对方系统剪贴板（`FileNameW`），落点由对方粘贴决定；显式"发送文件"/拖拽 → 存到记住的接收目录 |
| 剪贴板同步默认状态 | **默认开启**（文本/图片/文件三类各自可独立关闭，并有可见指示） |
| 传输层 | 复用 P2P，新增单条 `doujiao-data` 有序可靠通道 + 自定帧协议 |
| 落地节奏 | P1+P2+P3 一次做完 |
| 安全基线 | 保持"绝对有人值守"，被控端仍须前台点击授权 |

## 3. 架构

```
控制端                                      受控端
┌─────────────────────────┐                ┌─────────────────────────┐
│ 插件页 (沙箱 UI)         │                │ 插件页 (沙箱 UI)         │
│  接收设置/剪贴板开关/历史 │                │  接收设置/剪贴板开关/历史 │
└───────────┬─────────────┘                └───────────┬─────────────┘
            │ SDK / IPC (capability 校验)                │
┌───────────┴─────────────┐                ┌───────────┴─────────────┐
│ 宿主主进程 transfer/     │                │ 宿主主进程 transfer/     │
│  protocol / session /    │                │  protocol / session /    │
│  receive-store /         │                │  receive-store /         │
│  clipboard-bridge        │                │  clipboard-bridge        │
└───────────┬─────────────┘                └───────────┬─────────────┘
            │ IPC(块级流式)                              │
┌───────────┴─────────────┐   WebRTC P2P   ┌───────────┴─────────────┐
│ 会话窗口 (renderer)      │◀──────────────▶│ 会话窗口 (renderer)      │
│  doujiao-input (键鼠)    │                │  doujiao-input (键鼠)    │
│  doujiao-data  (新增)    │                │  doujiao-data  (新增)    │
└─────────────────────────┘                └─────────────────────────┘
```

### 关键约束与取舍

- **DataChannel 只能在渲染进程，文件读写只能在主进程**，二进制必须经一次 IPC。为控制开销：
  - 分块 256 KiB；渲染进程**拉模式**逐块向主进程索取（不在内存堆积整个文件）；
  - 发送侧按 `dataChannel.bufferedAmount` 流控；
  - 若后续吞吐不足，再引入 `MessageChannelMain` 直连端口（本设计不依赖它）。
- **键鼠输入与传输必须隔离通道**：`doujiao-input` 保持承载键鼠，避免大文件造成队头阻塞；新增 `doujiao-data` 承载聊天/剪贴板/文件。
- 内容全程 P2P（WebRTC DTLS/SCTP 加密），**不经过信令服务器**；走 TURN 中继时也仅转发加密流量。

## 4. 组件划分

宿主侧新增目录 `apps/host/src/main/services/remote-assist/transfer/`：

| 组件 | 职责 | 依赖 |
|---|---|---|
| `transfer-protocol.ts` | 帧编解码（JSON 帧 / 二进制分块帧）、校验和、文件名安全校验。**纯函数，重点单测** | 无 |
| `transfer-session.ts` | 单会话传输管理：队列、并发=1、进度、取消、流控、校验、失败处理 | protocol |
| `receive-store.ts` | 暂存目录、接收目录（记住）、`.part` 原子落盘、磁盘/大小检查、路径穿越防护、清理 | node:fs |
| `clipboard-bridge.ts` | 剪贴板读写（文本 / PNG 图片 / `FileNameW` 文件列表）、变化轮询、回声抑制 | electron clipboard |
| `transfer-service.ts` | 串起以上组件、对外暴露给 IPC/会话窗口的门面、与会话生命周期绑定 | 上述 |

会话窗口（`remote-assist-session-window.ts`）：
- 新增 `doujiao-data` 通道与帧收发：沿用现有模式——**控制端**在创建 `doujiao-input` 的同时创建 `doujiao-data`（`ordered: true`），**受控端**通过 `pc.ondatachannel` 接收并按 `channel.label` 区分两条通道；
- 新增**传输面板**（发送按钮、拖拽区、进度、取消、打开文件夹）与**聊天面板**（仅控制端窗口展示；受控端仅有指示与提示）。

插件页（`plugins/remote-assist/src/App.tsx`）：
- **接收设置**：是否允许接收文件（可撤销）、接收目录；
- **剪贴板同步开关**：文本 / 图片 / 文件三类独立开关 + 状态指示；
- **传输历史**（本会话内，内存，不落盘）。

### 4.1 新增能力（capability）

SDK `PluginCapability` 联合类型新增：
- `remote.file.transfer`
- `remote.clipboard.sync`

`plugins/remote-assist/manifest.json` 增加上述两项权限；宿主 `ipc/bridge.ts` 沿用 `checkRemoteAssistPermission` 模式，对文件/剪贴板相关 IPC 强制校验对应 capability。

## 5. 帧协议（`doujiao-data`）

通道参数：`ordered: true`（可靠有序）。单帧结构：

```
[1B frameType][4B headerLen uint32BE][header JSON utf8][payload bytes]
  frameType: 0x01 = 控制帧(JSON，无 payload)
             0x02 = 二进制分块帧(payload 为文件字节)
```

### 5.1 控制帧（header JSON）

| `t` | 字段 | 说明 |
|---|---|---|
| `chat` | `text`(≤4KB) | 聊天消息 |
| `clip-text` | `text`(≤1MB) | 剪贴板文本 |
| `transfer-offer` | `transferId`、`mode`、`totalBytes`、`entries[]` | 传输请求；`entries[] = {name, relPath, size, mime, sha256}` |
| `transfer-accept` | `transferId` | 接收方同意 |
| `transfer-reject` | `transferId`、`reason` | 拒绝（未授权/空间不足/超限/非法路径） |
| `transfer-cancel` | `transferId`、`reason` | 任一方取消 |
| `transfer-complete` | `transferId` | 发送完毕，等待接收方校验回执 |
| `transfer-result` | `transferId`、`ok`、`message?` | 接收方校验与落盘结果 |
| `receive-policy` | `receiveFiles`、`clipboard:{text,image,file}` | 本端策略广播（撤销授权/剪贴板开关变化时发送） |
| `ping` / `pong` | — | 通道存活探测 |

`mode ∈ { 'send', 'clipboard-file', 'clipboard-image' }`：
- `send`：显式发送，落盘到接收目录；
- `clipboard-file`：暂存后置入接收方系统剪贴板（`FileNameW`）；
- `clipboard-image`：单张 PNG，暂存后置入接收方图片剪贴板。

### 5.2 二进制分块帧（header JSON）

`{ transferId, entryIndex, seq, len }`：`entryIndex` 为 `entries[]` 下标，`seq` 为该 entry 内的块序号（从 0 起），`payload` 长度必须等于 `len`（≤256 KiB，接收端校验不一致即中止该传输）。

### 5.3 校验与流控

- 每个 entry 带 SHA-256（发送端计算）；接收端落盘后校验，不匹配 → `transfer-result.ok=false`，发送端可提示重试（不做断点续传，重传整个 entry）。
- 发送端：`bufferedAmount > 4 MiB` 暂停，`< 512 KiB` 恢复。
- 块大小 256 KiB；单帧上限 512 KiB（含 header）。

## 6. 数据流

### 6.1 显式发送（任一方 → 另一方）
1. 发送方在会话窗口点「发送文件」或拖拽文件/文件夹（`webUtils.getPathForFile`）→ 交给主进程入队。
2. 主进程扫描路径（文件夹递归，计算 `relPath`/`size`/`sha256`）→ 发送 `transfer-offer`。
3. 接收方主进程按 `receivePolicy.receiveFiles` 决定 `transfer-accept` / `transfer-reject`。
4. 发送端逐块拉取并发送二进制帧；接收端追加写 `<name>.doujiao.part`。
5. `transfer-complete` → 接收端校验 + `rename` → 写 `transfer-result`。
6. 落盘到**接收目录**（默认 `下载/豆角远程传输`），提供「打开文件夹」。

### 6.2 剪贴板文件（"粘贴到当前目录"）
1. 复制方主进程轮询检测到剪贴板含文件列表（`clipboard.readBuffer('FileNameW')`）→ 计算文件集 → `transfer-offer(mode='clipboard-file')`。
2. 接收方按 `receivePolicy.clipboard.file` 决定接受，传输到**暂存目录** `userData/remote-transfer/<sessionId>/<transferId>/`（保留 `relPath` 结构）。
3. 接收方将暂存顶层路径写入系统剪贴板：
   `clipboard.writeBuffer('FileNameW', Buffer.from(paths.join('\0') + '\0', 'ucs2'))`，并同时写 ANSI `FileName` 以兼容旧程序。
4. 用户在任意文件夹 Ctrl+V → 由资源管理器完成拷贝（**落点由用户决定**）。
5. 会话结束（或 TTL 到期）清理暂存目录。

### 6.3 剪贴板文本 / 图片
- 文本：变化 → `clip-text` 控制帧 → 对端 `clipboard.writeText`。
- 图片：变化 → `clipboard.readImage().toPNG()` → `clipboard-image` 传输（≤20 MB）→ 对端 `clipboard.writeImage(nativeImage.createFromBuffer(png))`。
- **回声抑制**：主进程在写入远端内容后记录其内容哈希，下一次轮询若命中该哈希则跳过，避免无限回环。
- 仅当**接收方**对应类型开关开启时才推送（通过 `receive-policy` 同步）。
- 剪贴板轮询与同步**仅在会话处于 `connected` 时运行**；进入会话时先各自广播一次 `receive-policy`，避免两端策略不一致。

### 6.4 聊天
控制帧 `chat` 直接透传到对端聊天面板；仅存内存，不落盘。

## 7. 授权与隐私

- **入站文件**：受控端（及任一方作为接收方）的 `receivePolicy.receiveFiles` 由用户在会话授权弹窗中勾选（会话级），会话中可在悬浮条/插件页**一键撤销**；撤销时广播 `receive-policy`，后续 `transfer-offer` 一律 `transfer-reject`。
- **剪贴板同步**：**默认开启**，三类各自可独立关闭。启动同步后，会话窗口/悬浮条显示"剪贴板同步中"指示；关闭立即生效并广播。
- **隐私提示**：默认开启意味着剪贴板内容（可能含密码等敏感信息）会在会话内双向同步；UI 需在开启状态给出一眼可见的指示，便于用户临时关闭。
- **不落盘**：聊天与剪贴板元数据不持久化；仅传输历史在内存中保留到会话结束。
- **文件名安全**：所有 `name`/`relPath` 做严格校验——禁止 `..`、绝对路径、盘符、保留设备名；接收端只允许写目标根目录内的相对路径（`path.resolve(root, rel)` 必须以 `root` 为前缀）。

## 8. 错误处理与边界

| 场景 | 行为 |
|---|---|
| 未授权接收 | `transfer-reject('not-authorized')`，发送端提示"对方未授权接收文件" |
| 磁盘空间不足 / 路径非法 | 预检后 `transfer-reject('disk' / 'path')` |
| 单文件超限（默认 2 GB）/ 图片超限（20 MB） | 拒绝并提示 |
| 传输中断（连接断开/取消） | `transfer-cancel`；会话结束时清理 `.part` 与暂存 |
| 校验失败 | `transfer-result.ok=false`；发送端提示可重试 |
| TURN 中继 | 提示"当前为中继转发，大文件较慢" |
| 并发请求 | 排队（并发=1），队列可见 |
| 目录递归 | 递归收集并保留相对结构；受符号链接/循环保护 |

## 9. 测试策略

**单元测试（宿主 `apps/host/tests/`）**
- `transfer-protocol`：控制帧/二进制帧编解码往返；分块重组；大小/长度边界；`sha256` 校验。
- 文件名安全：拒绝 `..`、绝对路径、盘符、保留名；`path.resolve` 前缀校验。
- 流控：模拟 `bufferedAmount` 背压，验证暂停/恢复与内存不堆积。
- `FileNameW` 编码：生成的字节序列正确（UTF-16LE、`\0` 分隔、双 `\0` 结尾）。
- 剪贴板回声抑制：写入后命中哈希被跳过。
- `transfer-session`：两个实例用内存通道桩互发小文件与文件夹，验证进度、取消、拒绝、校验失败路径。

**既有回归**
- 会话窗口生成脚本的语法解析测试（已有）需覆盖新增脚本片段。
- 信令服务/契约/身份等既有测试保持通过。

**手工验收（双机）**
- 双向发送单文件/多文件/文件夹到接收目录并校验内容；
- 复制文件 → 对端粘贴到任意目录；
- 复制文本/截图 → 对端粘贴；
- 撤销接收授权后发送被拒；
- 关闭/开启剪贴板同步开关即时生效；
- 会话中断后暂存清理。

## 10. 落地分批（本次一次做完，但按此顺序实施）

- **P1 核心通道与控制面**：`doujiao-data` 通道 + 帧协议 + 传输会话骨架 + 聊天 + 文本剪贴板 + 显式文件发送到接收目录（进度/取消/授权）。
- **P2 剪贴板高级**：图片剪贴板 + 文件剪贴板（暂存 + `FileNameW` 置入）。
- **P3 强化**：文件夹递归、大小/空间预检、流控调优、失败重试（整文件重传）。

## 11. 安全考量小结

- 传输内容全程 P2P 加密，不经服务器；服务器不可见内容。
- 新增 capability 门控，插件渲染进程仍无特权、无文件系统访问。
- 入站授权沿用"会话级显式同意 + 可撤销"，符合有人值守原则。
- 路径穿越、超限、非法文件名在接收端强制校验，防止写入越界或磁盘耗尽。
- 剪贴板默认开带来隐私面（敏感内容同步），以**可见指示 + 一键关闭**缓解。

## 12. 待办/后续（不在本批）

- 断点续传、多并发、传输限速。
- 剪贴板历史与敏感内容过滤（正则/密码管理器集成）。
- 只读旁观者、远程音频、多显示器会话中切换、会话录制、审计日志。
