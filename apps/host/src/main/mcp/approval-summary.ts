const display=(value:unknown)=>JSON.stringify(String(value??'').slice(0,260))
export function approvalSummary(name:string,args:Record<string,unknown>,outputDirectory:string|null,notepadDirectory?:string|null):string {
  if(name==='markdown_create')return `工作目录：${display(outputDirectory??'尚未选择')}\n新文件：${display(args.path)}\n内容大小：${typeof args.content==='string'?Buffer.byteLength(args.content,'utf8'):0} 字节\n仅创建新文件，已有文件不会覆盖。仅本次调用有效。`
  if(name==='notepad_create')return `便签目录：${display(notepadDirectory??'默认便签目录')}\n新便签：${display(args.path)}\n内容大小：${typeof args.content==='string'?Buffer.byteLength(args.content,'utf8'):0} 字节\n仅创建新文件，已有文件不会覆盖。仅本次调用有效。`
  if(name==='screen_capture')return '将打开区域选择界面；仅你选中的屏幕区域进入本次会话，供后续 OCR 识别。取消选择可中止。仅本次调用有效。'
  if(name==='screen_capture_fullscreen')return '将截取当前全屏画面进入本次会话，供后续 OCR 识别。仅本次调用有效。'
  if(name==='image_import')return '将打开图片选择对话框；仅你选中的图片进入本次会话，供后续 OCR 识别。取消选择可中止。仅本次调用有效。'
  if(name==='clipboard_write')return `将向系统剪贴板写入文本（长度：${typeof args.text==='string'?args.text.length:0} 字符）。仅本次调用有效。`
  return '仅本次调用有效。请确认后继续。'
}

