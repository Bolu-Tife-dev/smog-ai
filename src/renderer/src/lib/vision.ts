import type { ChatMessage, ScreenFrame, TranscriptEntry } from '@shared/types'
import { SCREEN_SYSTEM, formatTranscript } from './prompts'

export const MAX_IMAGE_BYTES = 1_400_000
export const MAX_TRANSCRIPT_CHARS = 1_600
export const DEFAULT_SCREEN_QUESTION = 'Summarize what is on screen and point out anything notable.'
const STALE_HINT_MS = 20_000

export interface FittedFrame {
  dataUrl: string
  width: number
  height: number
  bytes: number
  downgraded: boolean
}

export interface VisionMeta {
  descriptor: string
  ageMs: number
  bytes: number
  width: number
  height: number
  downgraded: boolean
  displayLabel?: string
  format?: 'png' | 'jpeg'
}

export interface VisionContext {
  messages: ChatMessage[]
  meta: VisionMeta
  question: string
}

export function frameAgeMs(frame: ScreenFrame): number {
  return Math.max(0, Date.now() - frame.capturedAt)
}

export function describeFrame(frame: ScreenFrame): string {
  const parts = [`${frame.width}×${frame.height}px`]
  if (frame.windowTitle) parts.push(`active window "${frame.windowTitle}"`)
  else if (frame.displayLabel) parts.push(`display "${frame.displayLabel}"`)
  parts.push(`captured ${new Date(frame.capturedAt).toLocaleTimeString()}`)
  if (frame.format) parts.push(frame.format)
  return parts.join(' · ')
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return `data:image/jpeg;base64,${btoa(binary)}`
}

export async function fitFrame(
  frame: ScreenFrame,
  maxBytes = MAX_IMAGE_BYTES
): Promise<FittedFrame> {
  const original: FittedFrame = {
    dataUrl: frame.dataUrl,
    width: frame.width,
    height: frame.height,
    bytes: frame.dataUrl.length,
    downgraded: false
  }
  if (original.bytes <= maxBytes) return original
  if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas === 'undefined') return original

  let bitmap: ImageBitmap
  try {
    const blob = await (await fetch(frame.dataUrl)).blob()
    bitmap = await createImageBitmap(blob)
  } catch {
    return original
  }

  let best = original
  const factors = [Math.sqrt(maxBytes / original.bytes) * 0.9, 0.6, 0.4]
  try {
    for (const factor of factors) {
      if (factor >= 1) break
      const width = Math.max(320, Math.round(bitmap.width * factor))
      const height = Math.max(180, Math.round(bitmap.height * factor))
      if (width >= bitmap.width) break
      const canvas = new OffscreenCanvas(width, height)
      const ctx = canvas.getContext('2d')
      if (!ctx) break
      ctx.drawImage(bitmap, 0, 0, width, height)
      const out = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.72 })
      const dataUrl = await blobToDataUrl(out)
      best = { dataUrl, width, height, bytes: dataUrl.length, downgraded: true }
      if (dataUrl.length <= maxBytes) break
    }
  } finally {
    bitmap.close?.()
  }
  return best
}

export function buildVisionPrompt(
  descriptor: string,
  question: string,
  transcript?: TranscriptEntry[],
  ageMs = 0
): string {
  const sections: string[] = [`Screen frame: ${descriptor}`]
  if (ageMs > STALE_HINT_MS) sections.push(`(frame was captured ${Math.round(ageMs / 1000)}s ago)`)
  const recent = (transcript ?? []).filter((entry) => entry.text.trim())
  if (recent.length > 0) {
    const excerpt = formatTranscript(recent, 14).slice(0, MAX_TRANSCRIPT_CHARS)
    sections.push(`Live transcript context:\n${excerpt}`)
  }
  sections.push(`Question: ${question.trim() || DEFAULT_SCREEN_QUESTION}`)
  return sections.join('\n\n')
}

export async function buildVisionContext(options: {
  frame: ScreenFrame
  question?: string
  transcript?: TranscriptEntry[]
  maxImageBytes?: number
}): Promise<VisionContext> {
  const question = (options.question ?? '').trim() || DEFAULT_SCREEN_QUESTION
  const fitted = await fitFrame(options.frame, options.maxImageBytes)
  const ageMs = frameAgeMs(options.frame)
  const descriptor = describeFrame({
    ...options.frame,
    width: fitted.width,
    height: fitted.height
  })
  const meta: VisionMeta = {
    descriptor,
    ageMs,
    bytes: fitted.bytes,
    width: fitted.width,
    height: fitted.height,
    downgraded: fitted.downgraded,
    displayLabel: options.frame.displayLabel,
    format: options.frame.format
  }
  const messages: ChatMessage[] = [
    { role: 'system', content: SCREEN_SYSTEM },
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: buildVisionPrompt(descriptor, question, options.transcript, ageMs)
        },
        { type: 'image_url', image_url: { url: fitted.dataUrl } }
      ]
    }
  ]
  return { messages, meta, question }
}
