import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'
import { BrowserWindow, dialog } from 'electron'
import type { ChatMessage, NoteFile, TranscriptEntry } from '@shared/types'
import { notesDir } from './config'
import { chat } from './llm'

const ROLE_LABEL: Record<TranscriptEntry['role'], string> = {
  speech: 'LIVE SPEECH',
  screen: 'SCREEN CONTEXT',
  user: 'USER',
  assistant: 'SMOG AI',
  system: 'SYSTEM'
}

function toTranscriptText(entries: TranscriptEntry[]): string {
  if (!entries.length) return '(empty session)'
  return entries
    .map((e) => {
      const time = new Date(e.ts).toLocaleTimeString()
      return `[${time}] ${ROLE_LABEL[e.role]}: ${e.text}`
    })
    .join('\n\n')
}

const NOTES_SYSTEM: ChatMessage['content'] = [
  'You are Smog AI, an expert technical meeting and interview note-taker.',
  'Convert the session transcript into clean, actionable Markdown meeting minutes.',
  'Use exactly this structure:',
  '# Session Notes',
  '## Summary',
  '## Key Topics',
  '## Answers & Insights',
  '## Follow-up Questions',
  '## Action Items',
  'Rules: concise bullet points, preserve technical terms, identifiers and code snippets from the transcript,',
  'never invent content that is not present in the transcript, output Markdown only.'
].join(' ')

export async function generateNotes(
  entries: TranscriptEntry[],
  cfg: Parameters<typeof chat>[0]
): Promise<{ content: string; path: string }> {
  const messages: ChatMessage[] = [
    { role: 'system', content: NOTES_SYSTEM },
    { role: 'user', content: `Session transcript:\n\n${toTranscriptText(entries)}` }
  ]
  const content = (await chat(cfg, messages)).trim()

  const dir = notesDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)
  const path = join(dir, `session-${stamp}.md`)
  writeFileSync(path, `${content}\n`, 'utf8')
  return { content, path }
}

export function listNotes(): NoteFile[] {
  const dir = notesDir()
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((name) => /\.(md|pdf)$/i.test(name))
    .map((name) => {
      const path = join(dir, name)
      return { name, path, createdAt: statSync(path).mtimeMs }
    })
    .sort((a, b) => b.createdAt - a.createdAt)
}

export interface NotesExportOptions {
  saveDialog?: boolean
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function inlineMarkdown(text: string): string {
  let out = escapeHtml(text)
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>')
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  out = out.replace(/__([^_]+)__/g, '<strong>$1</strong>')
  out = out.replace(/\*([^*]+)\*/g, '<em>$1</em>')
  out = out.replace(/~~([^~]+)~~/g, '<del>$1</del>')
  out = out.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2">$1</a>')
  return out
}

export function markdownToHtml(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  const body: string[] = []
  let list: 'ul' | 'ol' | null = null
  let paragraph: string[] = []
  let code: string[] | null = null
  let quote: string[] = []

  const closeParagraph = (): void => {
    if (paragraph.length > 0) {
      body.push(`<p>${inlineMarkdown(paragraph.join(' '))}</p>`)
      paragraph = []
    }
  }
  const closeList = (): void => {
    if (list) {
      body.push(`</${list}>`)
      list = null
    }
  }
  const closeQuote = (): void => {
    if (quote.length > 0) {
      body.push(`<blockquote>${inlineMarkdown(quote.join(' '))}</blockquote>`)
      quote = []
    }
  }
  const closeAll = (): void => {
    closeParagraph()
    closeList()
    closeQuote()
  }

  for (const raw of lines) {
    const line = raw.trimEnd()
    if (code) {
      if (line.trim().startsWith('```')) {
        body.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`)
        code = null
      } else {
        code.push(raw)
      }
      continue
    }
    if (line.trim().startsWith('```')) {
      closeAll()
      code = []
      continue
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      closeAll()
      const level = Math.min(6, heading[1].length)
      body.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`)
      continue
    }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      closeAll()
      body.push('<hr />')
      continue
    }
    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line)
    if (bullet) {
      closeParagraph()
      closeQuote()
      if (list !== 'ul') {
        closeList()
        list = 'ul'
        body.push('<ul>')
      }
      body.push(`<li>${inlineMarkdown(bullet[1])}</li>`)
      continue
    }
    const ordered = /^\s*\d+[.)]\s+(.*)$/.exec(line)
    if (ordered) {
      closeParagraph()
      closeQuote()
      if (list !== 'ol') {
        closeList()
        list = 'ol'
        body.push('<ol>')
      }
      body.push(`<li>${inlineMarkdown(ordered[1])}</li>`)
      continue
    }
    const quoted = /^\s*>\s?(.*)$/.exec(line)
    if (quoted) {
      closeParagraph()
      closeList()
      quote.push(quoted[1])
      continue
    }
    if (!line.trim()) {
      closeAll()
      continue
    }
    closeList()
    closeQuote()
    paragraph.push(line.trim())
  }
  if (code) body.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`)
  closeAll()
  return body.join('\n')
}

const PDF_CSS = `
  @page { size: A4; margin: 18mm 16mm; }
  body { font-family: 'Segoe UI', Helvetica, Arial, sans-serif; color: #18181b; font-size: 11.5pt; line-height: 1.55; }
  h1 { font-size: 20pt; border-bottom: 2px solid #18181b; padding-bottom: 6px; }
  h2 { font-size: 14pt; margin-top: 22px; color: #0f766e; }
  h3 { font-size: 12pt; margin-top: 16px; }
  p { margin: 8px 0; }
  ul, ol { margin: 8px 0; padding-left: 22px; }
  li { margin: 3px 0; }
  code { font-family: 'Cascadia Mono', Consolas, monospace; background: #f4f4f5; padding: 1px 4px; border-radius: 3px; font-size: 10pt; }
  pre { background: #f4f4f5; border: 1px solid #e4e4e7; border-radius: 6px; padding: 10px 12px; overflow-x: auto; }
  pre code { background: none; padding: 0; }
  blockquote { border-left: 3px solid #a1a1aa; margin: 8px 0; padding: 2px 12px; color: #52525b; }
  hr { border: none; border-top: 1px solid #d4d4d8; margin: 16px 0; }
  a { color: #0369a1; }
`

function exportDocumentHtml(title: string, markdown: string): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>${PDF_CSS}</style>
</head>
<body>
${markdownToHtml(markdown)}
</body>
</html>`
}

function noteStamp(): string {
  return new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)
}

async function resolveTarget(
  extension: 'pdf' | 'md',
  opts: NotesExportOptions,
  label: string
): Promise<string> {
  const dir = notesDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const fallback = join(dir, `session-${noteStamp()}.${extension}`)
  if (!opts.saveDialog) return fallback
  const result = await dialog.showSaveDialog({
    title: `Export ${label}`,
    defaultPath: fallback,
    filters: [{ name: label, extensions: [extension] }]
  })
  if (result.canceled || !result.filePath) throw new Error('Export cancelled.')
  return result.filePath
}

export async function exportNotesPdf(
  content: string,
  opts: NotesExportOptions = {}
): Promise<string> {
  const target = await resolveTarget('pdf', opts, 'PDF document')
  const win = new BrowserWindow({ show: false, width: 900, height: 1200, webPreferences: { sandbox: true } })
  try {
    const html = exportDocumentHtml('Smog AI — Session Notes', content)
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    const buffer = await win.webContents.printToPDF({
      pageSize: 'A4',
      printBackground: true,
      margins: { marginType: 'default' }
    })
    writeFileSync(target, buffer)
    return target
  } finally {
    if (!win.isDestroyed()) win.destroy()
  }
}

export async function exportNotesMarkdown(
  content: string,
  opts: NotesExportOptions = {}
): Promise<string> {
  const target = await resolveTarget('md', opts, 'Markdown file')
  const body = content.endsWith('\n') ? content : `${content}\n`
  writeFileSync(target, body, 'utf8')
  return target
}
