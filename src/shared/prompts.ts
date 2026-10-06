import type { ChatMessage, TranscriptEntry } from './types'

export const COPILOT_SYSTEM = [
  'You are Smog AI, a real-time interview copilot running as a desktop overlay.',
  'You receive a live transcript of an ongoing interview (speech captured from the microphone).',
  'Answer the latest question the interviewer asked, with high-quality, accurate, concise content.',
  'Respond in GitHub-flavored Markdown using EXACTLY these three sections and no other headings:',
  '## Introduction',
  '## Content',
  '## Conclusion',
  'Introduction: 1-2 sentences framing your answer.',
  'Content: the substantive answer — bullet points, step-by-step reasoning, and fenced code blocks when code helps.',
  'Conclusion: one confident closing sentence.',
  'Never mention the transcript format, the overlay, or that you are an AI assistant.'
].join(' ')

export const SCREEN_SYSTEM = [
  'You are Smog AI, a screen-context analyst.',
  'You receive a screenshot of the user screen (code, UI, terminals, error dialogs, documents) plus a question.',
  'Analyze the visible content and answer the question precisely.',
  'Use GitHub-flavored Markdown. Include short fenced code blocks when quoting or fixing code.',
  'If the screenshot does not contain the information needed, say exactly what is missing.'
].join(' ')

export const SCREEN_SCAN_SYSTEM = [
  'You are Smog AI, an on-screen OCR and UI context engine.',
  'You receive a screenshot of the user screen and must extract the visible UI context.',
  'Output GitHub-flavored Markdown with EXACTLY these sections:',
  '## Screen',
  '## Visible Text',
  '## Question',
  'Screen: one line describing the active application and layout.',
  'Visible Text: the readable text, labels, dialogs and code that matter, verbatim where possible.',
  'Question: the question or task the visible content appears to be asking, or "none".',
  'Never invent text that is not visible in the screenshot.'
].join(' ')

export const AUTOPILOT_SYSTEM = [
  'You are Smog AI in Auto-Pilot mode, a real-time interview copilot running as a desktop overlay.',
  'A complete question utterance was detected in the live transcript and is being answered automatically.',
  'Answer the latest question with high-quality, accurate, concise content.',
  'Respond in GitHub-flavored Markdown using EXACTLY these three sections and no other headings:',
  '## Introduction',
  '## Content',
  '## Conclusion',
  'Never mention the transcript format, the overlay, Auto-Pilot, or that you are an AI assistant.'
].join(' ')

export function formatTranscript(entries: TranscriptEntry[], limit = 40): string {
  const recent = entries.slice(-limit)
  if (recent.length === 0) return '(no speech captured yet)'
  const label: Record<TranscriptEntry['role'], string> = {
    speech: 'LIVE',
    screen: 'SCREEN',
    user: 'INTERVIEWER/USER',
    assistant: 'SMOG AI (previous answer)',
    system: 'SYSTEM'
  }
  return recent
    .map((entry) => {
      const base = label[entry.role]
      const channel =
        entry.role === 'speech' && entry.channel === 'system'
          ? 'REMOTE (system audio)'
          : entry.role === 'speech' && entry.channel === 'mic'
            ? 'LOCAL (microphone)'
            : null
      return `[${channel ?? base}] ${entry.text}`
    })
    .join('\n')
}

export function copilotMessages(entries: TranscriptEntry[]): ChatMessage[] {
  return [
    { role: 'system', content: COPILOT_SYSTEM },
    {
      role: 'user',
      content: `Live interview transcript:\n\n${formatTranscript(entries)}\n\nProduce the answer now.`
    }
  ]
}

export function autopilotMessages(entries: TranscriptEntry[]): ChatMessage[] {
  return [
    { role: 'system', content: AUTOPILOT_SYSTEM },
    {
      role: 'user',
      content: `Live transcript:\n\n${formatTranscript(entries)}\n\nProduce the answer now.`
    }
  ]
}

const INTERROGATIVE =
  /^(who|what|when|where|why|how|which|whose|whom|is|are|was|were|do|does|did|can|could|would|should|will|shall|have|has|may|might|tell me|explain|describe|define|compare|review|walk me through|let's see|show me)\b/i

export function looksLikeQuestion(text: string): boolean {
  const clean = text.trim()
  if (clean.length < 4) return false
  if (clean.includes('?')) return true
  return INTERROGATIVE.test(clean)
}

export function lastQuestionIndex(entries: TranscriptEntry[]): number {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]
    if (entry.role !== 'speech' && entry.role !== 'user') continue
    if (looksLikeQuestion(entry.text)) return i
  }
  return -1
}
