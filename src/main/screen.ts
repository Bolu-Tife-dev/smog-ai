import { desktopCapturer, screen } from 'electron'
import type {
  CaptureOptions,
  DisplayInfo,
  ScreenFrame,
  ScreenWatchEvent,
  ScreenWatchRequest,
  ScreenWatchState
} from '@shared/types'

const MAX_CAPTURE_WIDTH = 1920
const HARD_MAX_CAPTURE_WIDTH = 3840
const DEFAULT_FORMAT: NonNullable<CaptureOptions['format']> = 'jpeg'
const DEFAULT_QUALITY = 0.72
const MIN_WATCH_INTERVAL_MS = 1000
const DEFAULT_WATCH_INTERVAL_MS = 4000
const MAX_CONTEXT_HISTORY = 10

export function listDisplays(): DisplayInfo[] {
  const primaryId = screen.getPrimaryDisplay().id
  return screen.getAllDisplays().map((display, index) => ({
    id: display.id,
    label: display.label || `Display ${index + 1}`,
    primary: display.id === primaryId,
    width: display.size.width,
    height: display.size.height,
    scaleFactor: display.scaleFactor
  }))
}

function resolveDisplay(displayId?: number): Electron.Display {
  if (displayId != null) {
    const match = screen.getAllDisplays().find((display) => display.id === displayId)
    if (match) return match
  }
  return screen.getPrimaryDisplay()
}

function qualityToJpeg(quality: number | undefined): number {
  const value = Number.isFinite(quality) ? (quality as number) : DEFAULT_QUALITY
  return Math.max(1, Math.min(100, Math.round(value * 100)))
}

export async function captureScreen(options: CaptureOptions = {}): Promise<ScreenFrame> {
  const display = resolveDisplay(options.displayId)
  const pixelWidth = Math.round(display.size.width * display.scaleFactor)
  const pixelHeight = Math.round(display.size.height * display.scaleFactor)
  const maxWidth = Math.min(options.maxWidth ?? MAX_CAPTURE_WIDTH, HARD_MAX_CAPTURE_WIDTH)
  const scale = Math.min(1, maxWidth / Math.max(1, pixelWidth))
  const thumbnailSize = {
    width: Math.max(320, Math.round(pixelWidth * scale)),
    height: Math.max(200, Math.round(pixelHeight * scale))
  }

  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize,
    fetchWindowIcons: false
  })
  const source =
    sources.find((candidate) => candidate.display_id === String(display.id)) ?? sources[0]
  if (!source) throw new Error('No screen source available for capture.')

  const image = source.thumbnail
  const size = image.getSize()
  const format: NonNullable<CaptureOptions['format']> = options.format ?? DEFAULT_FORMAT
  const dataUrl =
    format === 'png'
      ? image.toDataURL()
      : `data:image/jpeg;base64,${image.toJPEG(qualityToJpeg(options.quality)).toString('base64')}`

  const labels = listDisplays()
  const label = labels.find((entry) => entry.id === display.id)?.label ?? `Display ${display.id}`

  return {
    dataUrl,
    width: size.width,
    height: size.height,
    capturedAt: Date.now(),
    displayId: display.id,
    displayLabel: label,
    scaleFactor: display.scaleFactor,
    format,
    bytes: dataUrl.length
  }
}

function hashDataUrl(dataUrl: string): number {
  let hash = 5381
  const step = Math.max(1, Math.floor(dataUrl.length / 4096))
  for (let i = 0; i < dataUrl.length; i += step) {
    hash = ((hash << 5) + hash + dataUrl.charCodeAt(i)) | 0
  }
  return hash
}

function describeFrame(frame: ScreenFrame): string {
  return `${frame.displayLabel ?? 'primary'} ${frame.width}x${frame.height} ${frame.format ?? 'jpeg'}`
}

interface WatchRuntime {
  timer: ReturnType<typeof setInterval> | null
  intervalMs: number
  displayId?: number
  frames: number
  changes: number
  lastChangeAt: number
  lastHash: number | null
  lastFrame: ScreenFrame | null
  context: string
  history: string[]
  error: string | null
}

const runtime: WatchRuntime = {
  timer: null,
  intervalMs: DEFAULT_WATCH_INTERVAL_MS,
  frames: 0,
  changes: 0,
  lastChangeAt: 0,
  lastHash: null,
  lastFrame: null,
  context: '',
  history: [],
  error: null
}

type WatchListener = (event: ScreenWatchEvent) => void
const listeners = new Set<WatchListener>()

export function onScreenWatch(listener: WatchListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function emit(event: ScreenWatchEvent): void {
  for (const listener of [...listeners]) {
    try {
      listener(event)
    } catch (err) {
      console.warn('[smog-ai] screen watch listener failed:', err)
    }
  }
}

export function watchState(): ScreenWatchState {
  return {
    running: runtime.timer !== null,
    intervalMs: runtime.intervalMs,
    frames: runtime.frames,
    changes: runtime.changes,
    lastChangeAt: runtime.lastChangeAt,
    displayId: runtime.displayId,
    context: runtime.context
  }
}

function pushContext(line: string): void {
  runtime.history.push(line)
  if (runtime.history.length > MAX_CONTEXT_HISTORY) runtime.history = runtime.history.slice(-MAX_CONTEXT_HISTORY)
  runtime.context = runtime.history.join(' | ')
}

async function watchTick(): Promise<void> {
  try {
    const frame = await captureScreen({
      displayId: runtime.displayId,
      format: 'jpeg',
      quality: 0.6,
      maxWidth: 1280
    })
    runtime.frames += 1
    const hash = hashDataUrl(frame.dataUrl)
    const changed = runtime.lastHash === null || hash !== runtime.lastHash
    runtime.lastHash = hash
    const at = Date.now()
    if (changed) {
      runtime.changes += 1
      runtime.lastChangeAt = at
      runtime.lastFrame = frame
    }
    runtime.error = null
    pushContext(
      `${changed ? 'CHANGED' : 'same'} ${describeFrame(frame)} @ ${new Date(at).toLocaleTimeString()} #${
        runtime.frames
      }`
    )
    emit({ changed, at, context: runtime.context, frame: changed ? frame : undefined })
  } catch (err) {
    runtime.error = err instanceof Error ? err.message : String(err)
    pushContext(`capture failed: ${runtime.error}`)
    emit({ changed: false, at: Date.now(), context: runtime.context })
  }
}

export async function startWatch(request: ScreenWatchRequest = { enabled: true }): Promise<ScreenWatchState> {
  const interval = Number(request.intervalMs)
  runtime.intervalMs =
    Number.isFinite(interval) && interval > 0 ? Math.max(MIN_WATCH_INTERVAL_MS, Math.round(interval)) : runtime.intervalMs
  if (request.displayId != null) runtime.displayId = request.displayId
  stopTimer()
  runtime.timer = setInterval(() => void watchTick(), runtime.intervalMs)
  await watchTick()
  return watchState()
}

function stopTimer(): void {
  if (runtime.timer) {
    clearInterval(runtime.timer)
    runtime.timer = null
  }
}

export function stopWatch(): ScreenWatchState {
  stopTimer()
  return watchState()
}

export function lastWatchFrame(): ScreenFrame | null {
  return runtime.lastFrame
}
