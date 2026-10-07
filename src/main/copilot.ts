import type { ChatMessage, ContentPart, ScreenFrame, TranscriptEntry } from '@shared/types'
import { SCREEN_SCAN_SYSTEM, autopilotMessages, looksLikeQuestion } from '@shared/prompts'
import { captureScreen, lastWatchFrame, watchState } from './screen'
import type { Session } from './session'

const DEBOUNCE_MS = 1800
const SCREEN_CONTEXT_MAX_AGE_MS = 30_000
const SCAN_PROMPT =
  'Extract the on-screen UI context: active window, readable text, dialogs, code and any visible question or task.'

export type EngineMode = 'autopilot' | 'screen'

export interface CopilotEngineDeps {
  session: Session
  configured: () => boolean
  enabled: () => boolean
  busy: () => boolean
  run: (mode: EngineMode, messages: ChatMessage[]) => string | null
}

function screenParts(frame: ScreenFrame): ContentPart[] {
  const age = Math.max(0, Date.now() - frame.capturedAt)
  const origin = frame.windowTitle
    ? `active window "${frame.windowTitle}"`
    : `display "${frame.displayLabel ?? 'primary'}"`
  return [
    {
      type: 'text',
      text:
        `Spatial screen context — Screen frame: ${frame.width}x${frame.height}px · ${origin} · captured ${new Date(
          frame.capturedAt
        ).toLocaleTimeString()}${age > 5000 ? ` (${Math.round(age / 1000)}s ago)` : ''}.`
    },
    { type: 'image_url', image_url: { url: frame.dataUrl } }
  ]
}

function withScreenContext(messages: ChatMessage[], frame: ScreenFrame | null): ChatMessage[] {
  if (!frame) return messages
  if (Date.now() - frame.capturedAt > SCREEN_CONTEXT_MAX_AGE_MS) return messages
  const [system, user] = messages
  const text = typeof user?.content === 'string' ? user.content : ''
  if (!text) return messages
  return [
    system,
    { role: 'user', content: [{ type: 'text', text }, ...screenParts(frame)] }
  ]
}

export class CopilotEngine {
  private timer: ReturnType<typeof setTimeout> | null = null
  private answered = new Set<string>()
  private subscription: (() => void) | null = null

  constructor(private readonly deps: CopilotEngineDeps) {}

  attach(): void {
    if (this.subscription) return
    this.subscription = this.deps.session.subscribe(() => this.schedule())
  }

  detach(): void {
    this.subscription?.()
    this.subscription = null
    this.cancel()
  }

  private cancel(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  private schedule(): void {
    if (!this.deps.enabled()) return
    this.cancel()
    this.timer = setTimeout(() => {
      this.timer = null
      this.fire()
    }, DEBOUNCE_MS)
  }

  private latestQuestion(entries: TranscriptEntry[]): TranscriptEntry | null {
    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i]
      if (entry.role !== 'speech' && entry.role !== 'user') continue
      if (looksLikeQuestion(entry.text)) return entry
    }
    return null
  }

  private fire(): void {
    if (!this.deps.enabled() || !this.deps.configured()) return
    if (this.deps.busy()) {
      this.schedule()
      return
    }
    const entries = this.deps.session.list()
    const question = this.latestQuestion(entries)
    if (!question || this.answered.has(question.id)) return
    const messages = withScreenContext(autopilotMessages(entries), watchState().running ? lastWatchFrame() : null)
    const requestId = this.deps.run('autopilot', messages)
    if (!requestId) {
      this.schedule()
      return
    }
    this.answered.add(question.id)
    if (this.answered.size > 60) this.answered = new Set([...this.answered].slice(-40))
  }

  async scanNow(displayId?: number, captured?: ScreenFrame): Promise<string | null> {
    if (!this.deps.configured()) return null
    const frame = captured ?? (await captureScreen({ displayId, format: 'jpeg', quality: 0.72, activeWindow: true }))
    const messages: ChatMessage[] = [
      { role: 'system', content: SCREEN_SCAN_SYSTEM },
      {
        role: 'user',
        content: [
          { type: 'text', text: SCAN_PROMPT },
          { type: 'image_url', image_url: { url: frame.dataUrl } }
        ]
      }
    ]
    return this.deps.run('screen', messages)
  }
}
