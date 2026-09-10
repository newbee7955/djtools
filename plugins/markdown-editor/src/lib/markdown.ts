/**
 * 轻量且安全的 Markdown 渲染器
 * 支持标题、粗体、斜体、删除线、行内代码、多语言代码块、引用、表格、任务清单、无序/有序列表、分割线与外链
 */

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

export function renderMarkdown(markdown: string): string {
  if (!markdown) return '<p class="text-slate-500 italic">空文档，请在左侧编辑器中开始输入...</p>'

  const lines = markdown.split(/\r?\n/)
  const htmlParts: string[] = []

  let inCodeBlock = false
  let codeLanguage = ''
  let codeBuffer: string[] = []

  let inTable = false
  let tableBuffer: string[] = []

  const flushTable = () => {
    if (tableBuffer.length === 0) return
    let tableHtml = '<div class="overflow-x-auto my-4"><table class="w-full border-collapse border border-slate-700 text-xs text-slate-200">'
    let isHeader = true

    for (const row of tableBuffer) {
      const trimmed = row.trim()
      if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
        const cells = trimmed.slice(1, -1).split('|').map((c) => c.trim())
        // 检查是否是分割行如 |--|--|
        if (cells.every((c) => /^:?-+:?$/.test(c))) {
          isHeader = false
          continue
        }

        tableHtml += '<tr class="border-b border-slate-800">'
        for (const cell of cells) {
          const parsedCell = parseInline(cell)
          if (isHeader) {
            tableHtml += `<th class="px-3 py-2 bg-slate-800 font-semibold text-left border border-slate-700 text-slate-100">${parsedCell}</th>`
          } else {
            tableHtml += `<td class="px-3 py-2 border border-slate-800 text-slate-300">${parsedCell}</td>`
          }
        }
        tableHtml += '</tr>'
        isHeader = false
      }
    }

    tableHtml += '</table></div>'
    htmlParts.push(tableHtml)
    tableBuffer = []
    inTable = false
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // 1. 代码块 ``` 处理
    if (line.trim().startsWith('```')) {
      if (inTable) flushTable()
      if (!inCodeBlock) {
        inCodeBlock = true
        codeLanguage = line.trim().slice(3).trim()
        codeBuffer = []
      } else {
        inCodeBlock = false
        const escapedCode = escapeHtml(codeBuffer.join('\n'))
        htmlParts.push(
          `<div class="my-4 rounded-xl overflow-hidden border border-slate-800 bg-slate-950 font-mono text-xs">
            ${codeLanguage ? `<div class="px-4 py-1.5 bg-slate-900 border-b border-slate-800 text-[11px] text-slate-400 font-semibold uppercase tracking-wider flex justify-between"><span>${escapeHtml(codeLanguage)}</span><span class="text-slate-500">Code</span></div>` : ''}
            <pre class="p-4 overflow-x-auto text-emerald-300 leading-relaxed"><code>${escapedCode}</code></pre>
          </div>`
        )
        codeBuffer = []
        codeLanguage = ''
      }
      continue
    }

    if (inCodeBlock) {
      codeBuffer.push(line)
      continue
    }

    // 2. 表格行处理
    if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
      inTable = true
      tableBuffer.push(line)
      continue
    } else if (inTable) {
      flushTable()
    }

    // 3. 空行
    if (!line.trim()) {
      htmlParts.push('<div class="h-3"></div>')
      continue
    }

    // 4. 水平分割线
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      htmlParts.push('<hr class="my-6 border-slate-800" />')
      continue
    }

    // 5. 标题 H1 - H6
    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/)
    if (headingMatch) {
      const level = headingMatch[1].length
      const text = parseInline(headingMatch[2])
      const headingStyles: Record<number, string> = {
        1: 'text-2xl font-bold text-white mt-6 mb-3 pb-2 border-b border-slate-800 flex items-center gap-2',
        2: 'text-xl font-bold text-slate-100 mt-5 mb-2.5 pb-1 border-b border-slate-800/60',
        3: 'text-lg font-semibold text-slate-200 mt-4 mb-2',
        4: 'text-base font-semibold text-slate-300 mt-3 mb-1.5',
        5: 'text-sm font-medium text-slate-300 mt-2 mb-1',
        6: 'text-xs font-medium text-slate-400 mt-2 mb-1 uppercase tracking-wider'
      }
      htmlParts.push(`<h${level} class="${headingStyles[level]}">${text}</h${level}>`)
      continue
    }

    // 6. 引用块
    if (line.trim().startsWith('>')) {
      const quoteText = parseInline(line.trim().replace(/^>\s*/, ''))
      htmlParts.push(
        `<blockquote class="border-l-4 border-indigo-500 pl-4 py-1.5 my-2.5 bg-indigo-500/5 rounded-r-lg text-slate-300 text-xs italic leading-relaxed">
          ${quoteText}
        </blockquote>`
      )
      continue
    }

    // 7. 任务列表
    const taskMatch = line.match(/^\s*-\s*\[([ xX])\]\s+(.*)$/)
    if (taskMatch) {
      const checked = taskMatch[1].toLowerCase() === 'x'
      const text = parseInline(taskMatch[2])
      htmlParts.push(
        `<div class="flex items-center gap-2.5 my-1 text-xs ${checked ? 'line-through text-slate-500' : 'text-slate-300'}">
          <input type="checkbox" disabled ${checked ? 'checked' : ''} class="w-3.5 h-3.5 accent-indigo-500 rounded cursor-default" />
          <span>${text}</span>
        </div>`
      )
      continue
    }

    // 8. 无序列表
    if (/^\s*[-*+]\s+(.*)$/.test(line)) {
      const text = parseInline(line.replace(/^\s*[-*+]\s+/, ''))
      htmlParts.push(
        `<div class="flex items-start gap-2.5 my-1 text-xs text-slate-300">
          <span class="text-indigo-400 mt-0.5">•</span>
          <span class="flex-1 leading-relaxed">${text}</span>
        </div>`
      )
      continue
    }

    // 9. 有序列表
    const orderedMatch = line.match(/^\s*(\d+)\.\s+(.*)$/)
    if (orderedMatch) {
      const num = orderedMatch[1]
      const text = parseInline(orderedMatch[2])
      htmlParts.push(
        `<div class="flex items-start gap-2 my-1 text-xs text-slate-300">
          <span class="font-mono text-indigo-400 font-semibold min-w-4 text-right">${num}.</span>
          <span class="flex-1 leading-relaxed">${text}</span>
        </div>`
      )
      continue
    }

    // 10. 普通段落
    htmlParts.push(`<p class="my-1.5 text-xs text-slate-300 leading-relaxed">${parseInline(line)}</p>`)
  }

  if (inTable) flushTable()
  if (inCodeBlock) {
    const escapedCode = escapeHtml(codeBuffer.join('\n'))
    htmlParts.push(
      `<pre class="p-4 my-3 rounded-xl bg-slate-950 border border-slate-800 text-emerald-300 font-mono text-xs overflow-x-auto"><code>${escapedCode}</code></pre>`
    )
  }

  return htmlParts.join('\n')
}

function parseInline(text: string): string {
  let result = escapeHtml(text)

  // 图片: ![alt](url)
  result = result.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" class="max-w-full max-h-96 rounded-xl border border-slate-800 my-2 shadow-md" />')

  // 链接: [text](url)
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer" class="text-indigo-400 hover:text-indigo-300 underline underline-offset-2">$1</a>')

  // 粗体加斜体: ***text***
  result = result.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong class="font-bold italic text-white">$1</strong>')

  // 粗体: **text**
  result = result.replace(/\*\*([^*]+)\*\*/g, '<strong class="font-bold text-white">$1</strong>')

  // 斜体: *text*
  result = result.replace(/\*([^*]+)\*/g, '<em class="italic text-slate-200">$1</em>')

  // 删除线: ~~text~~
  result = result.replace(/~~([^~]+)~~/g, '<del class="line-through text-slate-500">$1</del>')

  // 行内代码: `code`
  result = result.replace(/`([^`]+)`/g, '<code class="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700/60 font-mono text-pink-400 text-[11px]">$1</code>')

  return result
}
