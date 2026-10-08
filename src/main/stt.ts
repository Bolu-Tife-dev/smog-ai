import type { AudioChannel, ChatMessage, SmogConfig } from '@shared/types'
import { LlmError, chat, endpoint, requireConfigured, unreachableError } from './llm'

const STT_TIMEOUT_MS = 90_000

const CHANNEL_HINT: Record<AudioChannel, string> = {
  mic: 'You are transcribing the local microphone channel (the person speaking into this device).',
  system: 'You are transcribing the system loopback channel (a remote participant heard through speakers or a meeting app).'
}

export interface ChannelTranscription {
  channel: AudioChannel
  text: string
  error?: string
}

export interface ChannelChunk {
  wav: Buffer
  channel?: AudioChannel
  language?: string
}

async function readError(res: Response, what: string): Promise<LlmError> {
  let detail = ''
  try {
    detail = (await res.text()).replace(/\s+/g, ' ').slice(0, 300)
  } catch {
    detail = ''
  }
  return new LlmError(
    `${what} failed (${res.status})${detail ? `: ${detail}` : ''}.` +
      (res.status === 404
        ? ' This base URL has no /audio/transcriptions route — set a dedicated STT base URL in Settings (e.g. https://api.groq.com/openai/v1 with model whisper-large-v3-turbo), or clear the STT model to use chat-based transcription.'
        : ''),
    res.status
  )
}

function parseTranscription(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    if (/<\/?[a-z][^>]*>/i.test(trimmed)) return ''
    return trimmed
  }
  if (typeof parsed === 'string') return parsed.trim()
  if (!parsed || typeof parsed !== 'object') return ''
  const json = parsed as { text?: unknown; transcript?: unknown; segments?: Array<{ text?: unknown }> }
  if (typeof json.text === 'string') return json.text.trim()
  if (typeof json.transcript === 'string') return json.transcript.trim()
  if (Array.isArray(json.segments))
    return json.segments
      .map((segment) => (typeof segment?.text === 'string' ? segment.text : ''))
      .join(' ')
      .trim()
  return ''
}

async function viaAudioEndpoint(
  wav: Buffer,
  cfg: SmogConfig,
  language?: string,
  channel: AudioChannel = 'mic'
): Promise<string> {
  requireConfigured(cfg)
  const form = new FormData()
  form.append('model', cfg.sttModel)
  form.append('file', new Blob([new Uint8Array(wav)], { type: 'audio/wav' }), `${channel}-chunk.wav`)
  form.append('response_format', 'json')
  if (language) form.append('language', language)
  const base = cfg.sttBaseUrl.trim() ? cfg.sttBaseUrl : cfg.baseUrl
  const res = await fetchAudio(endpoint(base, '/audio/transcriptions'), cfg.apiKey, form)
  if (!res.ok) throw await readError(res, 'Transcription')
  return parseTranscription(await res.text())
}

async function fetchAudio(url: string, apiKey: string, form: FormData): Promise<Response> {
  try {
    return await fetch(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}` },
      body: form,
      signal: AbortSignal.timeout(STT_TIMEOUT_MS)
    })
  } catch (err) {
    const name = (err as Error)?.name
    if (name === 'TimeoutError' || name === 'AbortError')
      throw new LlmError(`Transcription timed out after ${STT_TIMEOUT_MS / 1000}s.`)
    throw unreachableError(err, url, 'transcription endpoint')
  }
}

async function viaChatEndpoint(
  wav: Buffer,
  cfg: SmogConfig,
  language?: string,
  channel: AudioChannel = 'mic'
): Promise<string> {
  requireConfigured(cfg)
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content:
        'You are a speech-to-text engine. Transcribe the audio verbatim and output ONLY the transcript text. ' +
        'No commentary, no labels, no markdown, no quotes around the transcript.' +
        ` ${CHANNEL_HINT[channel]}` +
        (language ? ` Language: ${language}.` : '')
    },
    {
      role: 'user',
      content: [
        { type: 'text', text: 'Transcribe this audio chunk.' },
        { type: 'input_audio', input_audio: { data: Buffer.from(wav).toString('base64'), format: 'wav' } }
      ]
    }
  ]
  try {
    const out = await chat(cfg, messages)
    return out
      .replace(/^```[\w]*\n?|```$/g, '')
      .replace(/^["'\s]+|["'\s]+$/g, '')
      .trim()
  } catch (err) {
    if (err instanceof LlmError && err.status === 400)
      throw new LlmError(
        'This model rejected the audio input. Configure a dedicated speech-to-text model (e.g. whisper-1) as the STT model in Settings.',
        400
      )
    throw err
  }
}

export async function transcribe(
  wav: Buffer,
  cfg: SmogConfig,
  language?: string,
  channel: AudioChannel = 'mic'
): Promise<string> {
  if (cfg.sttModel.trim()) return viaAudioEndpoint(wav, cfg, language, channel)
  return viaChatEndpoint(wav, cfg, language, channel)
}

export async function transcribeChannels(
  chunks: ChannelChunk[],
  cfg: SmogConfig,
  fallbackLanguage?: string
): Promise<ChannelTranscription[]> {
  return Promise.all(
    chunks.map(async (chunk): Promise<ChannelTranscription> => {
      const channel: AudioChannel = chunk.channel ?? 'mic'
      try {
        const text = await transcribe(chunk.wav, cfg, chunk.language || fallbackLanguage, channel)
        return { channel, text }
      } catch (err) {
        return { channel, text: '', error: err instanceof Error ? err.message : String(err) }
      }
    })
  )
}
