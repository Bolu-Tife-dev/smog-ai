import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'
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
  'You are Smog AI, an expert technical interview note-taker.',
  'Convert the session transcript into clean, actionable Markdown notes.',
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
    .filter((name) => name.endsWith('.md'))
    .map((name) => {
      const path = join(dir, name)
      return { name, path, createdAt: statSync(path).mtimeMs }
    })
    .sort((a, b) => b.createdAt - a.createdAt)
}
