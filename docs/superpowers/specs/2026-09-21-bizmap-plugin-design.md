# 豆角业务地图插件与 MCP 设计

- 日期：2026-09-21
- 宿主仓库：`D:\wjh\project\doujiao`
- 数据契约：代谢仓库 `docs/superpowers/specs/2026-09-21-bizmap-design.md`
- 第一期目标项目：`erp-metabolize` 的 `docs/bizmap/`

本文是豆角侧实现契约：插件 UI、宿主抽取服务、版本、MCP。地图字段与流程包以代谢侧设计稿为准。

---

## 1. 为什么放在豆角

业务地图需要桌面里选仓库、读 Java/Vue、写 overlay、看 Git 历史。豆角已经具备：

- 插件沙箱 + `workspace`（选目录、读写、`.history` 快照、git commit/log/checkout）
- 官方插件脚手架 `scripts/create-plugin.cjs`

插件进程没有 Node，不能自己跑 Python 或听 MCP 端口。抽取与 MCP 必须放在 **宿主主进程**，插件只做 UI。

---

## 2. 进程与数据

```
Grok / Claude / Cursor          人手
        │ MCP stdio 或 127.0.0.1 HTTP
        ▼
┌──────────────── 宿主 Main ─────────────────┐
│  BizmapService  （抽取、合并、drift、版本）   │
│  WorkspaceService（已有读写/git/history）    │
│  McpGateway     （工具 → BizmapService）    │
└──────────┬───────────────────┬─────────────┘
           │ IPC               │ 写文件
           ▼                   ▼
   plugins/bizmap UI     <project>/docs/bizmap/
   (沙箱 WebContents)    catalog/  overlay/
```

选定的 workspace 根 = 业务仓库根（例如 `D:\wjh\project\a\erp-metabolize`）。scope 固定 `bizmap`。

写白名单：

- 抽取可覆盖 `docs/bizmap/catalog/**`
- UI/MCP 可写 `docs/bizmap/overlay/**`
- 禁止写 workspace 内其它路径（Java、Vue、pom）

---

## 3. 包结构

| 路径 | 职责 |
|------|------|
| `packages/bizmap-core` | 纯 TS 抽取 + 合并 + drift + 版本 diff，无 Electron |
| `apps/host/src/main/services/bizmap-service.ts` | 调 core、限路径、记 manifest |
| `apps/host/src/main/mcp/bizmap-mcp.ts` | MCP 工具注册与本机传输 |
| `plugins/bizmap` | 画布、骨架、版本面板 |
| `packages/plugin-sdk` | 如需增加 `sdk.bizmap.*` 薄封装；第一期也可用 IPC 名 `plugin:bizmap:*` |

`bizmap-core` 可 `node packages/bizmap-core/cli.mjs --root <repo>` 在无 GUI 时抽取，与插件结果一致。

---

## 4. 插件清单

`plugins/bizmap/manifest.json`：

- `id`: `bizmap`
- `name`: 业务地图
- `permissions`: `{ "capability": "workspace" }`
- 若 SDK 增加专用能力，再拆 `bizmap.extract`，第一期 workspace 足够（读源码 + 写 docs/bizmap）

宿主 IPC 必须用 `event.sender` 反查插件 id，禁止信插件传入的 pluginId。

新 IPC（均校验 scope=`bizmap` 且路径白名单）：

- `plugin:bizmap:extract`
- `plugin:bizmap:drift`
- `plugin:bizmap:merged`（catalog+overlay 合并视图）
- `plugin:bizmap:show`（MCP → UI 聚焦，主进程向该插件 WebContents 推事件）

读写文件继续走已有 `plugin:workspace:*`。

---

## 5. 版本管理（宿主侧）

与代谢设计稿 8.1 对齐，宿主负责落地：

1. 抽取成功后写 `docs/bizmap/catalog/manifest.json`：`extractedAt`、`sourceCommit`、`frontendCommit`、文件哈希。
2. 若相对上次 manifest 的 endpoint/event 集合有增减，追加 `docs/bizmap/catalog/history/{extractedAt}.json`（仅 id 列表摘要）。
3. overlay 每次成功 `writeFile` 后对同一相对路径 `history.saveSnapshot(scope, path, content, 'auto')`。
4. 「保存里程碑」：对关键 overlay 文件打 `milestone`，或一次 git commit `docs/bizmap/`。
5. 版本面板：抽取记录、本地快照、`git log -- docs/bizmap`。
6. diff：`bizmap-core` 对两份 merged JSON 做节点/边/uses/summary 差。
7. 还原 overlay：`history.getSnapshot` 或 `git.showFile` 后 `writeFile`；禁止用旧 catalog 覆盖新抽取结果。

`workspace.git.commit` 的 `files` 必须全部在 `docs/bizmap/` 下。

---

## 6. MCP

### 6.1 传输

- 宿主设置里开关「业务地图 MCP」。
- 开启后：
  - `http://127.0.0.1:<port>/mcp`（Streamable HTTP 或 SSE，以当前 MCP SDK 为准）
  - stdio：`node apps/host/out/mcp-bizmap.js` 或安装后 `djtools mcp bizmap`（第一期至少 HTTP，stdio 作为同进程 CLI）
- 只绑 127.0.0.1。端口写入 `%APPDATA%/doujiao/` 本机配置，给 Grok `config.toml` 用。

### 6.2 工具（与 UI 能力一一对应）

查询：

| 工具 | 作用 |
|------|------|
| `bizmap_get_project` | 当前 workspace 根、最近抽取 commit |
| `bizmap_set_project` | 设置根目录（已存在的目录） |
| `bizmap_extract` | 跑抽取，返回摘要与 drift |
| `bizmap_drift` | 只跑 drift |
| `bizmap_list_flows` | 流程包列表 |
| `bizmap_get_flow` | 某包合并后的节点和边 |
| `bizmap_search` | 按关键字搜 endpoint/resource/screen/event |
| `bizmap_get_endpoint` | catalog + overlay 说明 |
| `bizmap_get_resource` | 配置资源与 CRUD 接口、谁 uses 它 |
| `bizmap_get_screen` | 骨架 yaml |
| `bizmap_list_uses` | from/to 过滤 |

写入（只 overlay，写后 auto snapshot）：

| 工具 | 作用 |
|------|------|
| `bizmap_update_endpoint_doc` | summary/详细业务 md |
| `bizmap_update_screen` | 骨架与热区 |
| `bizmap_add_manual_edge` / `bizmap_remove_manual_edge` | 人工边 |
| `bizmap_add_uses` | overlay uses |
| `bizmap_bind_hotspot` | 热区 bind |
| `bizmap_update_layout` | 节点坐标 |

版本：

| 工具 | 作用 |
|------|------|
| `bizmap_list_versions` | 抽取记录 + 里程碑 + git log |
| `bizmap_diff_versions` | 两版本 merged diff |
| `bizmap_save_milestone` | 打名 |
| `bizmap_restore_overlay` | 还原 overlay 文件 |
| `bizmap_git_status` / `bizmap_git_commit` | 仅 `docs/bizmap/` |

导航：

| 工具 | 作用 |
|------|------|
| `bizmap_show` | `{ flowId, nodeId?, hotspotId? }` 推到已打开的插件视图 |

没有对应工具的 UI 动作不得存在；新增按钮必须补 MCP。这是「完全操作」的门禁。

### 6.3 工具结果

- 查询默认返回精简 JSON（id、title、from/to），详情工具再拉全文，避免撑爆上下文。
- 写操作返回 `{ ok, id, driftWarn[] }`。
- 破坏性还原 overlay 要求参数 `confirm: true`。

---

## 7. 宿主改动范围

- `WorkspaceService.getDefaultDirectory` 增加 `bizmap` 默认文件夹名（用户仍应改到业务仓库根，而不是 Documents/Doujiao/Bizmap）。
- IPC bridge 增加 bizmap 通道与 `checkPluginPermission(workspace)`。
- 设置页：MCP 开关、端口、当前项目路径只读回显。
- 不放开通用 `child_process` 给插件。

抽取读源码：`BizmapService.extract` 在主进程用 `fs` 读 workspace 根下 `**/*.java` 等，**不**把整个 src 经 IPC 灌进沙箱。

---

## 8. 插件 UI

与代谢设计稿第 6 节相同：顶栏流程包、画布、骨架、抽屉。额外：

- 顶栏「选择仓库」「抽取」「版本」「MCP 状态」
- 版本抽屉：三条时间轴 + diff
- 暗色主题跟宿主，色板仍用 mjui token 画骨架（骨架模拟代谢前端，外壳跟豆角）

---

## 9. 测试

- `packages/bizmap-core`：用代谢仓库里截取的 `TaskEventEnum` / `TaskMsOnboardServiceImpl` 片段做夹具（拷贝到 core 的 fixtures，不在单测里依赖本机代谢路径）。
- 宿主：写路径越权被拒；MCP 工具写 Java 被拒；commit files 过滤。
- 插件：无第一期 E2E。

---

## 10. 实现顺序

1. `bizmap-core` 抽取 FSM/HTTP/uses + cli
2. `BizmapService` + workspace 选根 + 写白名单
3. 插件只读任务单画布
4. 配置总图
5. overlay 写回 + 版本面板
6. 骨架/热区/uses
7. `McpGateway` 全工具 + `bizmap_show` + 设置页

---

## 11. 关键决策

| 决策 | 选择 |
|------|------|
| UI 位置 | 豆角插件，不在代谢 Vite 站 |
| 数据位置 | 业务仓库 `docs/bizmap/` |
| 抽取位置 | 宿主 Node + bizmap-core |
| 版本 | Git + history 里程碑 + catalog history 摘要 |
| MCP | 宿主网关，工具 = UI 动作全集 |
| 安全 | 127.0.0.1、路径白名单、不给插件进程 |
