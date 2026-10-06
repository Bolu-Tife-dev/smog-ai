export const DEFAULT_BASE_URL = 'https://opencode.zen/v1'

export type AudioChannel = 'mic' | 'system'

export type HudTab = 'listen' | 'vision' | 'ask' | 'notes' | 'params'

export type DockEdge = 'left' | 'right' | 'top' | 'bottom' | 'center' | 'auto'

export type ShortcutAction = 'stealth-overlay' | 'screen-scan' | 'auto-pilot'

export interface SmogConfig {
  apiKey: string

  baseUrl: string

  model: string

  sttModel: string
  temperature: number
  maxTokens: number
  topP: number
  extraBody: string
  idleTimeoutMs: number

  stealth: boolean
  alwaysOnTop: boolean

  chunkSeconds: number

  language: string

  systemAudio: boolean

  autoPilot: boolean

  screenWatch: boolean

  screenScanMs: number
}

export type PublicConfig = Omit<SmogConfig, 'apiKey'> & {
  hasApiKey: boolean
  configPath: string
  encrypted: boolean
}

export type ConfigPatch = Partial<SmogConfig>

export type Role = 'user' | 'assistant' | 'system' | 'speech' | 'screen'

export interface TranscriptEntry {
  id: string
  ts: number
  role: Role
  text: string
  pending?: boolean
  channel?: AudioChannel
}

export type SessionStatus = 'idle' | 'recording' | 'analyzing' | 'error'

export interface ScreenWatchState {
  running: boolean
  intervalMs: number
  frames: number
  changes: number
  lastChangeAt: number
  displayId?: number
  context: string
}

export interface ScreenWatchEvent {
  changed: boolean
  at: number
  context: string
  frame?: ScreenFrame
}

export interface ScreenWatchRequest {
  enabled: boolean
  intervalMs?: number
  displayId?: number
}

export interface ScreenScanRequest {
  displayId?: number
  analyze?: boolean
}

export interface WindowMoveRequest {
  x: number
  y: number
}

export interface WindowDockRequest {
  edge: DockEdge
}

export interface ShortcutEvent {
  action: ShortcutAction
}

export interface TranscribeChunk {
  wav: Uint8Array
  channel?: AudioChannel
  language?: string
}

export interface TranscribeBatchRequest {
  chunks: TranscribeChunk[]
}

export interface TranscribeBatchResult {
  results: Array<{ channel: AudioChannel; text: string }>
}

export interface AppState {
  config: PublicConfig
  needsSetup: boolean
  status: SessionStatus
  overlayOpen: boolean
  hudOpen: boolean
  alwaysOnTop: boolean
  stealth: boolean
  autoPilot: boolean
  screenWatch: ScreenWatchState
  lastError: string | null
  notesDir: string
}

export type LlmMode = 'copilot' | 'screen' | 'notes' | 'autopilot'

export interface LlmRequest {
  mode: LlmMode
  messages: ChatMessage[]
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string | ContentPart[]
}

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }
  | { type: 'input_audio'; input_audio: { data: string; format: 'wav' } }

export interface LlmResult {
  requestId: string
  text: string
}

export interface ScreenFrame {
  dataUrl: string
  width: number
  height: number
  capturedAt: number
  displayId?: number
  displayLabel?: string
  scaleFactor?: number
  format?: 'png' | 'jpeg'
  bytes?: number
}

export interface CaptureOptions {
  displayId?: number
  format?: 'png' | 'jpeg'
  quality?: number
  maxWidth?: number
}

export interface DisplayInfo {
  id: number
  label: string
  primary: boolean
  width: number
  height: number
  scaleFactor: number
}

export interface NoteFile {
  name: string
  path: string
  createdAt: number
}

export interface GenerateNotesResult {
  content: string
  path: string
}

export type IpcChannel =
  | 'app:state'
  | 'app:openSettings'
  | 'app:shortcuts'
  | 'config:get'
  | 'config:set'
  | 'window:minimize'
  | 'window:maximize'
  | 'window:close'
  | 'window:alwaysOnTop'
  | 'window:move'
  | 'window:dock'
  | 'window:focus'
  | 'overlay:toggle'
  | 'hud:toggle'
  | 'stealth:set'
  | 'autopilot:toggle'
  | 'session:start'
  | 'session:stop'
  | 'session:clear'
  | 'session:entries'
  | 'stt:transcribe'
  | 'stt:transcribeBatch'
  | 'llm:ask'
  | 'screen:capture'
  | 'screen:displays'
  | 'screen:watch'
  | 'screen:scan'
  | 'notes:generate'
  | 'notes:list'

export type EventChannel =
  | 'event:state'
  | 'event:transcript'
  | 'event:llm-delta'
  | 'event:llm-done'
  | 'event:llm-error'
  | 'event:screen-watch'
  | 'event:screen-scan'
  | 'event:settings'
  | 'event:shortcut'

export interface LlmDeltaEvent {
  requestId: string
  mode: LlmMode
  delta: string
}

export interface LlmDoneEvent {
  requestId: string
  mode: LlmMode
  text: string
}

export interface LlmErrorEvent {
  requestId: string
  mode: LlmMode
  message: string
}

export interface TranscribeRequest {
  wav: Uint8Array
  language?: string
  channel?: AudioChannel
}

export interface TranscribeResult {
  text: string
}

export interface SmogApi {
  invoke<T = unknown>(channel: IpcChannel, payload?: unknown): Promise<T>
  on<T = unknown>(channel: EventChannel, listener: (data: T) => void): () => void
  getPlatform: () => string
}

export type ShortcutBindings = Record<ShortcutAction, string>
