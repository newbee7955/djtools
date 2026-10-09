import type { RegisteredTool } from '../../shared/ai-tools.ts'
import type { ImageArtifacts } from './image-artifacts.ts'
import type { OcrService, OcrLanguage } from './ocr-service.ts'
import type { MarkdownWorkspace } from './markdown-tools.ts'
import type { NotepadWorkspace } from './notepad-tools.ts'

export interface ClipboardItemRecord {
  id: string
  text?: string
  content?: string
  timestamp?: number
  type?: string
}

export interface Adapters {
  artifacts: ImageArtifacts
  ocr: OcrService
  workspace: () => MarkdownWorkspace
  capture: (signal?: AbortSignal) => Promise<{ success: boolean; canceled?: boolean; dataUrl?: string }>
  captureFullscreen?: (signal?: AbortSignal) => Promise<{ success: boolean; canceled?: boolean; dataUrl?: string }>
  pickImage: () => Promise<string | null>
  notepadWorkspace?: () => NotepadWorkspace
  clipboardHistory?: () => ClipboardItemRecord[]
  clipboardWrite?: (text: string) => boolean
}

const schema = (properties: Record<string, unknown> = {}, required: string[] = []) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false
})

export function createHostTools(a: Adapters): RegisteredTool[] {
  const definition = (
    name: string,
    title: string,
    pluginId: string,
    inputSchema: Record<string, unknown>,
    readOnly: boolean,
    requiresApproval: boolean,
    execute: RegisteredTool['execute']
  ): RegisteredTool => ({
    name,
    title,
    description: title,
    pluginId,
    inputSchema,
    readOnly,
    requiresApproval,
    execute
  })

  return [
    definition('screen_capture', '选择区域截图', 'screen-pin', schema(), false, true, async (_, context) => {
      const result = await a.capture(context.signal)
      context.signal?.throwIfAborted()
      if (result.canceled) return { canceled: true }
      if (!result.success || !result.dataUrl) throw Error('Capture failed')
      const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(result.dataUrl)
      if (!match || match[1].length > 28 * 1024 * 1024) throw Error('Invalid screenshot')
      return a.artifacts.add(Buffer.from(match[1], 'base64'))
    }),

    definition('screen_capture_fullscreen', '全屏直接截图', 'screen-pin', schema(), false, true, async (_, context) => {
      const capturer = a.captureFullscreen ?? a.capture
      const result = await capturer(context.signal)
      context.signal?.throwIfAborted()
      if (result.canceled) return { canceled: true }
      if (!result.success || !result.dataUrl) throw Error('Capture failed')
      const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(result.dataUrl)
      if (!match || match[1].length > 28 * 1024 * 1024) throw Error('Invalid screenshot')
      return a.artifacts.add(Buffer.from(match[1], 'base64'))
    }),

    definition('image_import', '选择图片', 'ocr-recognizer', schema(), true, true, async (_, context) => {
      const path = await a.pickImage()
      context.signal?.throwIfAborted()
      if (!path) return { canceled: true }
      return a.artifacts.importFile(path, context.signal)
    }),

    definition(
      'ocr_recognize',
      '离线识别图片文字',
      'ocr-recognizer',
      schema(
        {
          artifactId: { type: 'string', minLength: 1, maxLength: 64 },
          language: { type: 'string', enum: ['eng', 'chi_sim', 'eng+chi_sim'] }
        },
        ['artifactId', 'language']
      ),
      true,
      false,
      async (args, context) => ({
        text: await a.ocr.recognize(
          a.artifacts.read(args.artifactId as string),
          args.language as OcrLanguage,
          context.signal
        ),
        language: args.language
      })
    ),

    definition('markdown_list', '列出 Markdown 文件', 'markdown-editor', schema(), true, false, async () => ({
      files: await a.workspace().list()
    })),

    definition(
      'markdown_read',
      '读取 Markdown 文件',
      'markdown-editor',
      schema({ path: { type: 'string', minLength: 1, maxLength: 240 } }, ['path']),
      true,
      false,
      async args => ({
        path: args.path,
        content: await a.workspace().read(args.path as string)
      })
    ),

    definition(
      'markdown_create',
      '新建 Markdown 文件',
      'markdown-editor',
      schema(
        {
          path: { type: 'string', minLength: 1, maxLength: 240 },
          content: { type: 'string', maxLength: 1024 * 1024 }
        },
        ['path', 'content']
      ),
      false,
      true,
      async (args, context) => {
        context.signal?.throwIfAborted()
        await a.workspace().create(args.path as string, args.content as string, context.signal)
        return { path: args.path, created: true }
      }
    ),

    definition(
      'clipboard_get_recent',
      '读取剪贴板历史文本',
      'clipboard-history',
      schema({ limit: { type: 'integer', minimum: 1, maximum: 50 } }),
      true,
      false,
      async args => {
        const limit = typeof args.limit === 'number' ? args.limit : 10
        const history = a.clipboardHistory ? a.clipboardHistory() : []
        const items = history
          .filter(item => item.type === 'text' || (item.text && !item.text.startsWith('data:image/')))
          .slice(0, limit)
          .map(item => ({
            id: item.id,
            text: (item.text || item.content || '').slice(0, 10000),
            timestamp: typeof item.timestamp === 'number' ? item.timestamp : Date.now()
          }))
        return { items }
      }
    ),

    definition(
      'clipboard_search',
      '搜索剪贴板历史文本',
      'clipboard-history',
      schema(
        {
          query: { type: 'string', minLength: 1, maxLength: 200 },
          limit: { type: 'integer', minimum: 1, maximum: 50 }
        },
        ['query']
      ),
      true,
      false,
      async args => {
        const query = (args.query as string).toLowerCase()
        const limit = typeof args.limit === 'number' ? args.limit : 10
        const history = a.clipboardHistory ? a.clipboardHistory() : []
        const items = history
          .filter(
            item =>
              (item.type === 'text' || (item.text && !item.text.startsWith('data:image/'))) &&
              (item.text || item.content || '').toLowerCase().includes(query)
          )
          .slice(0, limit)
          .map(item => ({
            id: item.id,
            text: (item.text || item.content || '').slice(0, 10000),
            timestamp: typeof item.timestamp === 'number' ? item.timestamp : Date.now()
          }))
        return { items }
      }
    ),

    definition(
      'clipboard_write',
      '写入系统剪贴板',
      'clipboard-history',
      schema({ text: { type: 'string', minLength: 1, maxLength: 100000 } }, ['text']),
      false,
      true,
      async (args, context) => {
        context.signal?.throwIfAborted()
        if (!a.clipboardWrite) throw Error('Clipboard write unavailable')
        const success = a.clipboardWrite(args.text as string)
        if (!success) throw Error('Failed to write to clipboard')
        return { success: true }
      }
    ),

    definition('notepad_list', '列出便签文本文件', 'notepad', schema(), true, false, async () => {
      if (!a.notepadWorkspace) throw Error('Notepad workspace unavailable')
      return { files: await a.notepadWorkspace().list() }
    }),

    definition(
      'notepad_read',
      '读取便签文本文件',
      'notepad',
      schema({ path: { type: 'string', minLength: 1, maxLength: 240 } }, ['path']),
      true,
      false,
      async args => {
        if (!a.notepadWorkspace) throw Error('Notepad workspace unavailable')
        return { path: args.path, content: await a.notepadWorkspace().read(args.path as string) }
      }
    ),

    definition(
      'notepad_create',
      '新建便签文本文件',
      'notepad',
      schema(
        {
          path: { type: 'string', minLength: 1, maxLength: 240 },
          content: { type: 'string', maxLength: 1024 * 1024 }
        },
        ['path', 'content']
      ),
      false,
      true,
      async (args, context) => {
        context.signal?.throwIfAborted()
        if (!a.notepadWorkspace) throw Error('Notepad workspace unavailable')
        await a.notepadWorkspace().create(args.path as string, args.content as string, context.signal)
        return { path: args.path, created: true }
      }
    )
  ]
}
