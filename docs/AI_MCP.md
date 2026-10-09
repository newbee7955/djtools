# AI 工具与本地 MCP

在豆角「应用设置 → AI 工具与本地 MCP」中，可以管理供外部 AI 客户端调用的本地工具，也可以直接把图片或截图识别为可编辑的 Markdown 文档。本阶段没有内置聊天客户端，不需要配置云端模型或 AI API 密钥；外部 AI 客户端及模型由用户自行选择。

## 本机图片转文档

1. 安装并启用 `ocr-recognizer`、`markdown-editor` 插件；需要区域截图时也启用 `screen-pin`。面板中相应工具开关必须打开。
2. 点击「准备离线 OCR 模型」。此操作明确下载官方 `tessdata_fast` 的 `eng`、`chi_sim` 模型到应用数据目录，首次需要网络；两个模型准备完成后，识别只读取本地模型。失败可重试，不会隐式改用在线识别。
3. 点击「选择输出目录」。该目录独立于 Markdown 编辑器的工作目录，不会悄悄更改编辑器设置。
4. 点击「导入图片」或「区域截图」，完成原生文件/区域选择；选择界面可以取消。直接截图结果交给本次工作流，不自动复制到剪贴板或推送给当前插件。
5. 选择中文、英文或中英混合，点击「识别文字」。检查并编辑结果与相对 `.md` 文件名，点击「保存 Markdown」。例如 `note.md` 或已存在子目录中的 `notes/note.md`。

本机工作流不要求 MCP 服务开启，仍受工具和所属插件开关约束。操作进行中会显示状态并禁用重复操作。识别或保存失败保留已有草稿，可修改后重试；再次识别成功会用新结果替换编辑内容。截图/导入的取消不会自动执行 OCR。

## 连接外部 AI 客户端

MCP 默认关闭，只绑定 `127.0.0.1`，采用 Streamable HTTP。启用后显示当前 URL（端口以面板为准）；重启/重新启用后应检查当前地址。客户端需支持这个传输方式、URL 和自定义 `Authorization` 请求头。

「复制连接配置」和「显示连接配置」是显式读取凭据的操作。服务状态和调用记录不包含凭据。「轮换凭据」使旧凭据失效，并隐藏已显示配置；重新复制后更新客户端。关闭服务也会隐藏配置。复制的配置含凭据，请勿公开分享。

豆角生成的通用连接信息如下，实际地址与凭据使用面板复制的值；不同客户端的配置键名可能不同，按其设置页面填写 URL、HTTP 传输和请求头即可。示例中的凭据仅为占位符：

```json
{
  "mcpServers": {
    "doujiao": {
      "url": "http://127.0.0.1:39123/mcp",
      "transport": "streamable-http",
      "headers": {
        "Authorization": "Bearer REPLACE_WITH_COPIED_CREDENTIAL"
      }
    }
  }
}
```

首次连接先检查工具发现，再执行 `markdown_list`。图片转文档的外部调用顺序是 `image_import` 或 `screen_capture` → `ocr_recognize` → `markdown_create`；把前一步返回的 `artifactId` 传入 OCR，把识别文字或用户修订内容传入新建文档。

服务校验 Bearer 凭据、Host、Origin 和请求体大小。它没有局域网或公网监听，没有任意 Shell、文件系统或现有 IPC 转发接口。本地服务和离线 OCR 不代表外部模型也在本机：连接云端 AI 时，工具返回的识别文字、读取的文档等可能被该模型处理。

## 工具清单（共 13 个）

所有输入均为 JSON 对象，不接受额外字段。工具是否可调用由宿主执行器实时检查，不以客户端缓存的工具列表为准。

| 工具 / 所属插件 | 输入 | 返回 | 外部调用确认 |
|---|---|---|---|
| `screen_capture` / `screen-pin` | `{}` | `{artifactId, mimeType, size}` 或 `{canceled:true}` | 需要；之后由用户选择区域 |
| `screen_capture_fullscreen` / `screen-pin` | `{}` | `{artifactId, mimeType, size}` 或 `{canceled:true}` | 需要；截取全屏画面 |
| `image_import` / `ocr-recognizer` | `{}` | `{artifactId, mimeType, size}` 或 `{canceled:true}` | 需要；之后由用户选择文件 |
| `ocr_recognize` / `ocr-recognizer` | `{artifactId, language}`，语言为 `eng`、`chi_sim` 或 `eng+chi_sim` | `{text, language}` | 无逐次确认 |
| `markdown_list` / `markdown-editor` | `{}` | `{files:string[]}` | 无逐次确认 |
| `markdown_read` / `markdown-editor` | `{path}` | `{path, content}` | 无逐次确认 |
| `markdown_create` / `markdown-editor` | `{path, content}` | `{path, created:true}` | 需要；显示文件名、输出目录及内容字节数 |
| `clipboard_get_recent` / `clipboard-history` | `{limit?:number}`（1-50，默认 10） | `{items:{id,text,timestamp}[]}` | 无逐次确认 |
| `clipboard_search` / `clipboard-history` | `{query:string, limit?:number}` | `{items:{id,text,timestamp}[]}` | 无逐次确认 |
| `clipboard_write` / `clipboard-history` | `{text:string}`（最多 100000 字符） | `{success:true}` | 需要；显示写入字符数 |
| `notepad_list` / `notepad` | `{}` | `{files:string[]}` | 无逐次确认 |
| `notepad_read` / `notepad` | `{path:string}` | `{path, content}` | 无逐次确认 |
| `notepad_create` / `notepad` | `{path:string, content:string}` | `{path, created:true}` | 需要；显示文件名、便签目录及内容字节数 |


例如：

```json
{"artifactId":"PREVIOUS_RESULT_ARTIFACT_ID","language":"eng+chi_sim"}
```

```json
{"path":"note.md","content":"# 修订后的识别内容\n\n正文"}
```

确认只允许本次调用；待确认时权限或目录发生改变，旧确认不能继续执行。本机面板按钮已表达用户操作，不重复弹出外部调用确认。关闭某工具、禁用或卸载其所属插件后，本机和外部调用都会被拒绝；勾选开关不能代替安装/启用插件。关闭 MCP 会中止在途识别/模型准备并清空图片会话，之后可继续使用本机工作流重新获取图片。

## 存储、记录与限制

- 图片使用不透明会话 ID，返回值不暴露本地图片路径。支持 PNG/JPEG/WebP，每张最多 20 MiB，最多 12 张、总计 64 MiB；达到上限会拒绝继续导入。关闭 MCP 或退出应用清空图片，不作为持久素材库。
- Markdown 仅访问显式选定目录内的相对 `.md` 文件。拒绝绝对路径、上级路径、反斜线、Windows 设备名、非法名称、符号链接/目录联接逃逸和覆盖。已有子目录可以使用，工具不自动建目录。
- 文档读写上限为 1 MiB UTF-8 字节；列表最多 1000 个文件、遍历深度最多 8。创建采用独占临时文件和原子硬链接发布，需要输出卷支持硬链接；不支持的卷会安全失败，不会覆盖已有文件。
- 输出目录应由本地用户控制。常规路径防护不能消除恶意本地进程在路径校验后替换目录的竞态。
- 调用记录最多保留 200 条元数据：工具名、来源/客户端、状态、时间、耗时及安全通用错误。不保存图片、输入参数、识别输出、文档正文或令牌。面板定时刷新，支持手动刷新与清空。
- 开关、工具权限、输出目录与加密凭据保存到应用用户数据目录。凭据依赖系统安全存储；安全存储不可用、配置损坏或写入失败时会显示错误，不会因出错新启监听。关闭时若配置无法写入，本次仍停止服务，但下次启动可能仍读取旧配置，应排除写入问题后再次关闭。

## 验证范围

仓库提供执行器、HTTP/SDK、OCR/文档适配器和截图行为测试，UI 使用真实 React 面板与模拟宿主 API 检查控制流。UI 测试运行方式：

```powershell
node --test apps/host/tests/ai-tools-ui.test.mjs
```

该测试使用本机已有 Playwright/Chromium；可通过 `AI_UI_CHROMIUM` 指定可执行文件。当前开发机器默认浏览器路径在测试脚本中，不会安装新的依赖。UI 测试覆盖显式配置复制/显示及请求参数，但不能代替原生选择器、系统安全存储重启、真实 MCP 客户端、安装包的验收。集成 SDK 请求验证也不等同于所有桌面 AI 客户端均已接受此通用配置；具体客户端按其配置格式适配。

2026-10-07 开发验证：相关回归 79 项通过，宿主 node/web 类型检查及生产构建通过；隔离 Windows Electron 中完成了真实 SDK 的工具发现、图片导入、离线 OCR、Markdown 保存/读取、覆盖拒绝、工具关闭和旧凭据拒绝，并验证系统加密凭据重启恢复。另用隔离 ASAR 包和真实 Electron 33 完成了本地样例识别，覆盖 OCR 的打包依赖。原生文件选择和确认采用受控测试选择，未代替人工操作验收；尚未对指定桌面 AI 客户端或完整安装程序进行验收。
