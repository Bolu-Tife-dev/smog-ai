import { safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { DEFAULT_BASE_URL, type ConfigPatch, type PublicConfig, type SmogConfig } from '@shared/types'

interface StoredFile {
  version: 1
  
  payload: string
  encoding: 'encrypted' | 'plaintext'
}

const DEFAULTS: SmogConfig = {
  apiKey: '',
  baseUrl: DEFAULT_BASE_URL,
  sttBaseUrl: '',
  model: '',
  sttModel: '',
  temperature: 0.4,
  maxTokens: 0,
  topP: 1,
  extraBody: '',
  idleTimeoutMs: 45000,
  stealth: true,
  alwaysOnTop: true,
  chunkSeconds: 4,
  language: '',
  systemAudio: true,
  autoPilot: false,
  screenWatch: false,
  screenScanMs: 4000
}

const ENV_ALIASES: Array<[string, keyof SmogConfig]> = [
  ['OPENCODE_ZEN_API_KEY', 'apiKey'],
  ['LLM_MODEL_NAME', 'model'],
  ['LLM_BASE_URL', 'baseUrl'],
  ['STT_BASE_URL', 'sttBaseUrl'],
  ['STT_MODEL_NAME', 'sttModel'],
  ['SMOG_STEALTH', 'stealth'],
  ['SMOG_SYSTEM_AUDIO', 'systemAudio'],
  ['SMOG_AUTO_PILOT', 'autoPilot'],
  ['SMOG_SCREEN_WATCH', 'screenWatch']
]

function applyEnvAliases(target: Record<string, unknown>): void {
  for (const [envKey, field] of ENV_ALIASES) {
    const value = target[envKey]
    if (value === undefined || value === null) continue
    if (target[field] !== undefined && target[field] !== '' && target[field] !== DEFAULTS[field]) continue
    if (typeof DEFAULTS[field] === 'boolean') {
      if (typeof value === 'boolean') target[field] = value
      else if (typeof value === 'string') target[field] = value === 'true' || value === '1'
      else if (typeof value === 'number') target[field] = value !== 0
      continue
    }
    if (typeof value === 'string') target[field] = value
  }
  for (const envKey of Object.keys(target)) {
    if (ENV_ALIASES.some(([alias]) => alias === envKey)) delete target[envKey]
  }
}

const LEGACY_BASE_URL = /^https?:\/\/opencode\.zen(\/|$)/i

export function normalizeBaseUrl(raw: string): string {
  const url = raw.trim().replace(/\/+$/, '')
  if (!url) return DEFAULTS.baseUrl
  if (LEGACY_BASE_URL.test(url)) return DEFAULT_BASE_URL
  return url
}

export function normalizeSttBaseUrl(raw: string): string {
  const url = raw.trim().replace(/\/+$/, '')
  if (!url) return ''
  if (LEGACY_BASE_URL.test(url)) return DEFAULT_BASE_URL
  return url
}

export function normalizeModelId(raw: string): string {
  let id = raw.trim().replace(/^["'`]|["'`]$/g, '')
  id = id.replace(/^opencode\//i, '')
  if (/\s/.test(id)) id = id.toLowerCase().replace(/\s+/g, '-')
  return id
}

export function configDir(): string {
  return join(homedir(), '.config', 'smog-ai')
}

export function configPath(): string {
  return join(configDir(), 'config.json')
}

export function notesDir(): string {
  return join(configDir(), 'notes')
}

export class ConfigStore {
  private data: SmogConfig = { ...DEFAULTS }
  private encrypted = false

  constructor() {
    this.load()
  }

  private load(): void {
    this.encrypted = safeStorage.isEncryptionAvailable()
    const file = configPath()
    if (!existsSync(file)) return
    try {
      const stored = JSON.parse(readFileSync(file, 'utf8')) as StoredFile
      const raw =
        stored.encoding === 'encrypted' && this.encrypted
          ? safeStorage.decryptString(Buffer.from(stored.payload, 'base64'))
          : stored.payload
      const parsed = JSON.parse(raw) as Partial<SmogConfig> & Record<string, unknown>
      applyEnvAliases(parsed)
      const key = typeof parsed.apiKey === 'string' ? parsed.apiKey : ''
      const model =
        typeof parsed.model === 'string' ? normalizeModelId(parsed.model) : ''
      const sttModel =
        typeof parsed.sttModel === 'string' ? normalizeModelId(parsed.sttModel) : ''
      this.data = {
        ...DEFAULTS,
        ...parsed,
        apiKey: key,
        model,
        sttModel,
        baseUrl:
          typeof parsed.baseUrl === 'string' && parsed.baseUrl.trim()
            ? normalizeBaseUrl(parsed.baseUrl)
            : DEFAULTS.baseUrl,
        sttBaseUrl:
          typeof parsed.sttBaseUrl === 'string' ? normalizeSttBaseUrl(parsed.sttBaseUrl) : ''
      }
    } catch {
      this.data = { ...DEFAULTS }
    }
  }

  private persist(): void {
    const dir = configDir()
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const json = JSON.stringify(this.data, null, 2)
    const encoded =
      this.encrypted && safeStorage.isEncryptionAvailable()
        ? ({
            payload: safeStorage.encryptString(json).toString('base64'),
            encoding: 'encrypted'
          } as StoredFile)
        : ({ payload: json, encoding: 'plaintext' } as StoredFile)
    const file = configPath()
    const tmp = `${file}.tmp`
    writeFileSync(tmp, JSON.stringify(encoded, null, 2), { mode: 0o600 })
    renameSync(tmp, file)
  }

  get(): SmogConfig {
    return { ...this.data }
  }

  public(): PublicConfig {
    const { apiKey, ...rest } = this.data
    return {
      ...rest,
      hasApiKey: apiKey.length > 0,
      configPath: configPath(),
      encrypted: this.encrypted && safeStorage.isEncryptionAvailable()
    }
  }

  isConfigured(): boolean {
    return this.data.apiKey.trim().length > 0 && this.data.model.trim().length > 0
  }

  set(patch: ConfigPatch): PublicConfig {
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) continue
      if (!(key in DEFAULTS)) continue
      let normalized: unknown = value
      if (key === 'model' || key === 'sttModel')
        normalized = typeof value === 'string' ? normalizeModelId(value) : value
      if (key === 'baseUrl')
        normalized = typeof value === 'string' ? normalizeBaseUrl(value) : value
      if (key === 'sttBaseUrl')
        normalized = typeof value === 'string' ? normalizeSttBaseUrl(value) : value
      ;(this.data as unknown as Record<string, unknown>)[key] = normalized
    }
    this.persist()
    return this.public()
  }
}
