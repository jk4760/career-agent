import mammoth from 'mammoth'
import * as pdfjsLib from 'pdfjs-dist'
import type { AttachmentMeta } from '@/types'

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

export interface ImportDraft {
  title: string
  content: string
  metrics: string
}

/**
 * 素材库文件导入（§10.9）：.md / .docx / .pdf 前端本地解析，不上传任何服务器。
 * 返回全文文本与附件元信息。
 */
export async function parseImportFile(
  file: File,
): Promise<{ text: string; meta: AttachmentMeta }> {
  const ext = file.name.split('.').pop()?.toLowerCase()
  let text = ''

  if (ext === 'md') {
    text = await file.text()
  } else if (ext === 'docx') {
    const arrayBuffer = await file.arrayBuffer()
    text = (await mammoth.extractRawText({ arrayBuffer })).value
  } else if (ext === 'pdf') {
    const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise
    const pages: string[] = []
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i)
      const content = await page.getTextContent()
      pages.push(
        content.items.map((item) => ('str' in item ? item.str : '')).join(' '),
      )
    }
    text = pages.join('\n')
  } else {
    throw new Error('不支持的文件格式，请选择 .md / .docx / .pdf')
  }

  return {
    text,
    meta: {
      name: file.name,
      size: file.size,
      mime: file.type || `application/${ext}`,
      importedAt: new Date().toISOString(),
    },
  }
}

/**
 * 启发式预填（§10.9）：
 * - title ← 文档首个一级标题/加粗行，无则取前 30 字
 * - content ← 全文（md 保留原结构）
 * - metrics ← 含 % 或数字的短句（最多 2 条，可空）
 */
export function deriveImportDraft(text: string): ImportDraft {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)

  const h1 = lines.find((l) => l.startsWith('# '))
  const boldLine = lines.find((l) => /^\*\*.+\*\*$/.test(l))
  const title = h1
    ? h1.replace(/^#\s+/, '').slice(0, 60)
    : boldLine
      ? boldLine.replace(/\*\*/g, '').slice(0, 60)
      : (lines[0] ?? '').slice(0, 30)

  const metrics = text
    .split(/[。!?\n]/)
    .map((s) => s.trim())
    .filter((s) => /[%\d]/.test(s) && s.length > 0 && s.length <= 40)
    .slice(0, 2)
    .join('；')

  return { title, content: text, metrics }
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
