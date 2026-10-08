import { DEFAULT_BASE_URL, type ChatMessage, type SmogConfig } from '@shared/types'

export class LlmError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message)
    this.name = 'LlmError'
  }
}

const CONNECT_TIMEOUT_MS = 30_000
const MIN_IDLE_TIMEOUT_MS = 5_000

const trimBase = (baseUrl: string): string => baseUrl.trim().replace(/\/+$/, '')

export function endpoint(baseUrl: string, path: string): string {
  const base = trimBase(baseUrl)
  if (!base) throw new LlmError('Base URL is empty. Set it in Settings (gear icon).')
  return `${base}${path}`
}

export function requireConfigured(cfg: SmogConfig): void {
  if (!cfg.apiKey.trim())
    throw new LlmError('OPENCODE_ZEN_API_KEY is not configured. Open Settings (gear icon) to add it.')
  if (!cfg.model.trim())
    throw new LlmError('LLM_MODEL_NAME is not configured. Open Settings (gear icon) to choose a model.')
}

export function parseExtraBody(raw: string | undefined): Record<string, unknown> {
  const text = (raw ?? '').trim()
  if (!text) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new LlmError('Advanced parameters must be valid JSON, e.g. {"reasoning_effort":"low"}.')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new LlmError('Advanced parameters must be a JSON object, e.g. {"reasoning_effort":"low"}.')
  return parsed as Record<string, unknown>
}

export function buildBody(
  cfg: SmogConfig,
  messages: ChatMessage[],
  stream: boolean
): Record<string, unknown> {
  const body: Record<string, unknown> = { model: cfg.model, messages, stream }
  if (Number.isFinite(cfg.temperature)) body.temperature = cfg.temperature
  if (Number.isFinite(cfg.maxTokens) && cfg.maxTokens > 0) body.max_tokens = Math.floor(cfg.maxTokens)
  if (Number.isFinite(cfg.topP) && cfg.topP > 0 && cfg.topP < 1) body.top_p = cfg.topP
  return { ...body, ...parseExtraBody(cfg.extraBody) }
}

async function errorFromResponse(res: Response): Promise<LlmError> {
  let detail = ''
  try {
    detail = (await res.text()).replace(/\s+/g, ' ').slice(0, 300)
  } catch {
    detail = ''
  }
  if (/FreeTierError|free tier can only be used from within OpenCode/i.test(detail))
    return new LlmError(
      'This model is part of OpenCode’s free tier, which only works inside the OpenCode app itself. ' +
        'Either add credits at opencode.ai/zen and switch to a paid model (e.g. qwen3.8-flash), ' +
        'or set the base URL to the free Groq tier (https://api.groq.com/openai/v1) with model qwen/qwen3.8-27b.',
      res.status
    )
  const hints: Record<number, string> = {
    400: 'Request rejected by the endpoint — check model name and payload.',
    401: 'Unauthorized — check OPENCODE_ZEN_API_KEY.',
    403: 'Forbidden — this key cannot use the requested model.',
    404: 'Endpoint or model not found — check base URL and LLM_MODEL_NAME.',
    413: 'Payload too large — shorten the transcript/context.',
    429: 'Rate limited — retry in a moment.',
    500: 'Provider internal error — retry shortly.',
    502: 'Provider unreachable — check the base URL.',
    503: 'Provider unavailable — retry shortly.'
  }
  const hint = hints[res.status] ?? `Request failed with status ${res.status}.`
  return new LlmError(detail ? `${hint} ${detail}` : hint, res.status)
}

function contentOf(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    return value
      .map((part) => {
        const p = part as { type?: string; text?: string; content?: unknown }
        if (typeof p?.text === 'string') return p.text
        if (p?.type === 'text' || p?.type === 'output_text') return contentOf(p.content)
        return ''
      })
      .join('')
  }
  return ''
}

function extractDelta(payload: unknown): string {
  const p = payload as { choices?: Array<{ delta?: { content?: unknown }; message?: { content?: unknown } }> }
  const choice = p?.choices?.[0]
  if (!choice) return ''
  if (choice.delta && choice.delta.content !== undefined) return contentOf(choice.delta.content)
  return contentOf(choice.message?.content)
}

function extractError(payload: unknown): string {
  const p = payload as { error?: { message?: unknown } | string }
  if (typeof p?.error === 'string') return p.error
  if (p?.error && typeof p.error.message === 'string') return p.error.message
  return ''
}

class RequestGuard {
  readonly controller = new AbortController()
  private connectTimer: ReturnType<typeof setTimeout> | null = null
  private idleTimer: ReturnType<typeof setTimeout> | null = null
  private timeoutReason: 'connect' | 'idle' | null = null
  readonly idleMs: number

  constructor(
    external: AbortSignal | undefined,
    idleTimeoutMs: number
  ) {
    this.idleMs = Math.max(MIN_IDLE_TIMEOUT_MS, idleTimeoutMs || 45_000)
    if (external) {
      if (external.aborted) this.controller.abort()
      else external.addEventListener('abort', () => this.controller.abort(), { once: true })
    }
  }

  get signal(): AbortSignal {
    return this.controller.signal
  }

  get timeout(): 'connect' | 'idle' | null {
    return this.timeoutReason
  }

  armConnect(): void {
    if (this.connectTimer) return
    this.connectTimer = setTimeout(() => {
      this.timeoutReason = 'connect'
      this.controller.abort()
    }, CONNECT_TIMEOUT_MS)
  }

  armIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = setTimeout(() => {
      this.timeoutReason = 'idle'
      this.controller.abort()
    }, this.idleMs)
  }

  dispose(): void {
    if (this.connectTimer) clearTimeout(this.connectTimer)
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.connectTimer = null
    this.idleTimer = null
  }
}

function mapGuardError(guard: RequestGuard, err: unknown): never {
  if (guard.timeout === 'connect')
    throw new LlmError(`Could not reach the endpoint within ${CONNECT_TIMEOUT_MS / 1000}s. Check the base URL.`)
  if (guard.timeout === 'idle')
    throw new LlmError(`The model sent no tokens for ${Math.round(guard.idleMs / 1000)}s — request timed out.`)
  throw err
}

export function unreachableError(err: unknown, url: string, what = 'endpoint'): LlmError {
  const outer = err as { cause?: { code?: string; message?: string; cause?: { code?: string; message?: string } } }
  const cause = outer?.cause
  const reason =
    cause?.code ??
    cause?.cause?.code ??
    cause?.message ??
    cause?.cause?.message ??
    (err instanceof Error ? err.message : String(err))
  let host = url
  try {
    host = new URL(url).host
  } catch {
    /* keep raw url */
  }
  return new LlmError(
    `Cannot reach the ${what} at ${host} (${reason}). Check the base URL in Settings (gear icon) — the default is ${DEFAULT_BASE_URL}.`
  )
}

async function readAll(res: Response, guard: RequestGuard): Promise<string> {
  guard.armIdle()
  const reader = res.body?.getReader()
  if (!reader) return ''
  const decoder = new TextDecoder()
  let out = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      guard.armIdle()
      out += decoder.decode(value, { stream: true })
    }
  } catch (err) {
    mapGuardError(guard, err)
  }
  return out
}

function sseDelta(line: string): string {
  const trimmed = line.trim()
  if (!trimmed.startsWith('data:')) return ''
  const data = trimmed.slice(5).trim()
  if (!data || data === '[DONE]') return ''
  try {
    return extractDelta(JSON.parse(data))
  } catch {
    return ''
  }
}

async function* readSse(res: Response, guard: RequestGuard): AsyncGenerator<string> {
  const reader = res.body?.getReader()
  if (!reader) return
  const decoder = new TextDecoder()
  let buffer = ''
  guard.armIdle()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      guard.armIdle()
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        const delta = sseDelta(line)
        if (delta) yield delta
      }
    }
    buffer += decoder.decode()
    for (const line of buffer.split('\n')) {
      const delta = sseDelta(line)
      if (delta) yield delta
    }
  } catch (err) {
    mapGuardError(guard, err)
  }
}

async function* request(
  cfg: SmogConfig,
  messages: ChatMessage[],
  stream: boolean,
  external?: AbortSignal
): AsyncGenerator<string> {
  const guard = new RequestGuard(external, cfg.idleTimeoutMs)
  try {
    let res: Response
    const url = endpoint(cfg.baseUrl, '/chat/completions')
    try {
      guard.armConnect()
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${cfg.apiKey}`
        },
        body: JSON.stringify(buildBody(cfg, messages, stream)),
        signal: guard.signal
      })
    } catch (err) {
      if (guard.timeout) mapGuardError(guard, err)
      throw unreachableError(err, url)
    }
    if (!res.ok) throw await errorFromResponse(res)

    const type = (res.headers.get('content-type') ?? '').toLowerCase()
    if (type.includes('text/event-stream')) {
      yield* readSse(res, guard)
      return
    }

    let raw: string
    try {
      raw = await readAll(res, guard)
    } catch (err) {
      mapGuardError(guard, err)
    }
    if (!raw.trim()) return

    let payload: unknown
    try {
      payload = JSON.parse(raw)
    } catch {
      throw new LlmError(
        `Endpoint returned an unexpected (non-JSON) response: ${raw.replace(/\s+/g, ' ').slice(0, 160)}`
      )
    }
    const providerError = extractError(payload)
    if (providerError) throw new LlmError(providerError)
    const delta = extractDelta(payload)
    if (delta) yield delta
  } finally {
    guard.dispose()
  }
}

export async function* streamChat(
  cfg: SmogConfig,
  messages: ChatMessage[],
  signal?: AbortSignal
): AsyncGenerator<string> {
  requireConfigured(cfg)
  let yielded = 0
  try {
    for await (const delta of request(cfg, messages, true, signal)) {
      yielded += 1
      yield delta
    }
    return
  } catch (err) {
    const streamRejected =
      err instanceof LlmError &&
      err.status === 400 &&
      yielded === 0 &&
      !signal?.aborted &&
      /stream/i.test(err.message)
    if (!streamRejected) throw err
  }
  yield* request(cfg, messages, false, signal)
}

export async function chat(
  cfg: SmogConfig,
  messages: ChatMessage[],
  signal?: AbortSignal
): Promise<string> {
  let out = ''
  for await (const chunk of streamChat(cfg, messages, signal)) out += chunk
  return out
}
