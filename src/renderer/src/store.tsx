import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode
} from 'react'
import type {
  AppState,
  AudioChannel,
  ConfigPatch,
  DisplayInfo,
  GenerateNotesResult,
  HudTab,
  LlmDeltaEvent,
  LlmDoneEvent,
  LlmErrorEvent,
  LlmResult,
  PublicConfig,
  ScreenFrame,
  ScreenWatchEvent,
  ScreenWatchState,
  ShortcutEvent,
  TranscriptEntry
} from '@shared/types'
import { DualChannelCapture, type MicStats } from './lib/audio'
import { copilotMessages } from './lib/prompts'
import { buildVisionContext } from './lib/vision'

export interface StreamState {
  text: string
  busy: boolean
  error: string | null
}

const emptyStream = (): StreamState => ({ text: '', busy: false, error: null })
const emptyStats = (): MicStats => ({ capturedSeconds: 0, sentChunks: 0, droppedChunks: 0 })
const BATCH_FLUSH_MS = 250

interface StoreValue {
  state: AppState | null
  entries: TranscriptEntry[]
  streams: Record<'copilot' | 'screen', StreamState>
  recording: boolean
  settingsOpen: boolean
  notice: string | null
  micStats: MicStats
  systemStats: MicStats
  frame: ScreenFrame | null
  capturing: boolean
  visionQuestion: string
  displays: DisplayInfo[]
  captureDisplayId: number | null
  hudTab: HudTab
  screenWatch: ScreenWatchState
  openSettings: (open: boolean) => void
  requestSettings: () => void
  dismissNotice: () => void
  toggleRecording: () => Promise<void>
  setHudTab: (tab: HudTab) => void
  setVisionQuestion: (question: string) => void
  setCaptureDisplay: (displayId: number) => void
  captureFrame: () => Promise<ScreenFrame | null>
  scanScreen: () => Promise<ScreenFrame | null>
  askVision: (question?: string) => Promise<void>
  askCopilot: () => Promise<void>
  clearSession: () => Promise<void>
  saveConfig: (patch: ConfigPatch) => Promise<void>
  toggleOverlay: (open?: boolean) => Promise<void>
  toggleHud: (open?: boolean) => Promise<void>
  toggleAutoPilot: (enabled?: boolean) => Promise<void>
  toggleScreenWatch: (enabled?: boolean, intervalMs?: number) => Promise<void>
  setStealth: (enabled: boolean) => Promise<void>
  setAlwaysOnTop: (enabled: boolean) => Promise<void>
  windowAction: (action: 'minimize' | 'maximize' | 'close') => void
  moveHostWindow: (x: number, y: number) => Promise<{ x: number; y: number } | null>
  dockHostWindow: (edge: 'left' | 'right' | 'top' | 'bottom' | 'center' | 'auto') => Promise<string | null>
  requestNotes: () => Promise<GenerateNotesResult>
}

const StoreContext = createContext<StoreValue | null>(null)

export function useStore(): StoreValue {
  const value = useContext(StoreContext)
  if (!value) throw new Error('useStore must be used inside StoreProvider')
  return value
}

function requireApi(): Window['smog'] {
  if (!window.smog) throw new Error('Preload bridge unavailable — restart the app.')
  return window.smog
}

function streamKey(mode: LlmDeltaEvent['mode']): 'copilot' | 'screen' {
  return mode === 'screen' ? 'screen' : 'copilot'
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState | null>(null)
  const [entries, setEntries] = useState<TranscriptEntry[]>([])
  const [streams, setStreams] = useState<Record<'copilot' | 'screen', StreamState>>({
    copilot: emptyStream(),
    screen: emptyStream()
  })
  const [recording, setRecording] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [micStats, setMicStats] = useState<MicStats>(emptyStats())
  const [systemStats, setSystemStats] = useState<MicStats>(emptyStats())
  const [frame, setFrame] = useState<ScreenFrame | null>(null)
  const [capturing, setCapturing] = useState(false)
  const [visionQuestion, setVisionQuestion] = useState('')
  const [displays, setDisplays] = useState<DisplayInfo[]>([])
  const [captureDisplayId, setCaptureDisplayId] = useState<number | null>(null)
  const [hudTab, setHudTab] = useState<HudTab>('listen')
  const [screenWatch, setScreenWatch] = useState<ScreenWatchState>({
    running: false,
    intervalMs: 4000,
    frames: 0,
    changes: 0,
    lastChangeAt: 0,
    context: ''
  })
  const captureRef = useRef<DualChannelCapture | null>(null)
  const queueRef = useRef<Promise<unknown>>(Promise.resolve())
  const busyRef = useRef(false)
  const autoTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const batchRef = useRef<Array<{ channel: AudioChannel; wav: Uint8Array }>>([])
  const batchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const patchStream = useCallback((mode: 'copilot' | 'screen', patch: Partial<StreamState>) => {
    setStreams((prev) => ({ ...prev, [mode]: { ...prev[mode], ...patch } }))
  }, [])

  const askCopilot = useCallback(async () => {
    const api = requireApi()
    if (!state || state.needsSetup) {
      setSettingsOpen(true)
      return
    }
    const current = await api.invoke<TranscriptEntry[]>('session:entries')
    if (current.length === 0) return
    busyRef.current = true
    patchStream('copilot', { busy: true, error: null, text: '' })
    try {
      await api.invoke<LlmResult>('llm:ask', {
        mode: 'copilot',
        messages: copilotMessages(current)
      })
    } catch (err) {
      busyRef.current = false
      patchStream('copilot', { busy: false, error: String(err) })
    }
  }, [patchStream, state])

  const captureFrame = useCallback(async (): Promise<ScreenFrame | null> => {
    const api = requireApi()
    setCapturing(true)
    try {
      const next = await api.invoke<ScreenFrame>('screen:capture', {
        displayId: captureDisplayId ?? undefined
      })
      setFrame(next)
      return next
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err))
      return null
    } finally {
      setCapturing(false)
    }
  }, [captureDisplayId])

  const scanScreen = useCallback(async (): Promise<ScreenFrame | null> => {
    const api = requireApi()
    setCapturing(true)
    try {
      const next = await api.invoke<ScreenFrame>('screen:scan', {
        displayId: captureDisplayId ?? undefined,
        analyze: true
      })
      setFrame(next)
      return next
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err))
      return null
    } finally {
      setCapturing(false)
    }
  }, [captureDisplayId])

  const askVision = useCallback(
    async (question?: string) => {
      const api = requireApi()
      if (!state || state.needsSetup) {
        setSettingsOpen(true)
        return
      }
      let current = frame
      if (!current) current = await captureFrame()
      if (!current) return
      const prompt = (question ?? visionQuestion).trim()
      patchStream('screen', { busy: true, error: null, text: '' })
      try {
        const context = await buildVisionContext({
          frame: current,
          question: prompt,
          transcript: entries
        })
        await api.invoke<LlmResult>('llm:ask', { mode: 'screen', messages: context.messages })
      } catch (err) {
        patchStream('screen', { busy: false, error: String(err) })
      }
    },
    [captureFrame, entries, frame, patchStream, state, visionQuestion]
  )

  const setCaptureDisplay = useCallback((displayId: number) => {
    setCaptureDisplayId(displayId)
    setFrame(null)
  }, [])

  useEffect(() => {
    const api = window.smog
    if (!api) return
    let disposed = false

    void api.invoke<AppState>('app:state').then((next) => {
      if (disposed) return
      setState(next)
      setSettingsOpen(next.needsSetup)
      setScreenWatch(next.screenWatch)
    })
    void api.invoke<TranscriptEntry[]>('session:entries').then((list) => {
      if (!disposed) setEntries(list)
    })
    void api
      .invoke<DisplayInfo[]>('screen:displays')
      .then((list) => {
        if (disposed) return
        setDisplays(list)
        const preferred = list.find((entry) => entry.primary)?.id ?? list[0]?.id ?? null
        setCaptureDisplayId((prev) => prev ?? preferred)
      })
      .catch(() => undefined)

    const offs = [
      api.on<AppState>('event:state', (next) => {
        setState(next)
        setScreenWatch(next.screenWatch)
        if (!next.needsSetup && next.config.hasApiKey && next.config.model) setSettingsOpen(false)
      }),
      api.on<TranscriptEntry[]>('event:transcript', (list) => setEntries(list)),
      api.on<LlmDeltaEvent>('event:llm-delta', (event) => {
        const mode = streamKey(event.mode)
        setStreams((prev) => ({
          ...prev,
          [mode]: { ...prev[mode], text: prev[mode].text + event.delta }
        }))
      }),
      api.on<LlmDoneEvent>('event:llm-done', (event) => {
        const mode = streamKey(event.mode)
        if (mode === 'copilot') busyRef.current = false
        setStreams((prev) => ({
          ...prev,
          [mode]: { ...prev[mode], busy: false, text: event.text }
        }))
      }),
      api.on<LlmErrorEvent>('event:llm-error', (event) => {
        const mode = streamKey(event.mode)
        if (mode === 'copilot') busyRef.current = false
        setStreams((prev) => ({
          ...prev,
          [mode]: { ...prev[mode], busy: false, error: event.message }
        }))
      }),
      api.on<ScreenWatchEvent>('event:screen-watch', (event) => {
        setScreenWatch((prev) => ({
          ...prev,
          running: true,
          frames: prev.frames + 1,
          changes: prev.changes + (event.changed ? 1 : 0),
          lastChangeAt: event.changed ? event.at : prev.lastChangeAt,
          context: event.context
        }))
        if (event.frame) setFrame(event.frame)
      }),
      api.on<ScreenFrame>('event:screen-scan', (next) => setFrame(next)),
      api.on<{ open: boolean }>('event:settings', (event) => {
        if (event?.open) setSettingsOpen(true)
      }),
      api.on<ShortcutEvent>('event:shortcut', (event) => {
        if (event?.action === 'auto-pilot') setHudTab('ask')
        if (event?.action === 'screen-scan') setHudTab('vision')
        if (event?.action === 'stealth-overlay') setHudTab('listen')
      })
    ]

    return () => {
      disposed = true
      offs.forEach((off) => off())
    }
  }, [])

  const flushBatch = useCallback(() => {
    if (batchTimer.current) {
      clearTimeout(batchTimer.current)
      batchTimer.current = null
    }
    const chunks = batchRef.current
    batchRef.current = []
    if (chunks.length === 0) return
    const api = window.smog
    if (!api) return
    queueRef.current = queueRef.current
      .then(() => api.invoke('stt:transcribeBatch', { chunks }).catch(() => undefined))
      .catch(() => undefined)
  }, [])

  const toggleRecording = useCallback(async () => {
    const api = requireApi()
    if (captureRef.current?.isRunning) {
      const active = captureRef.current
      captureRef.current = null
      await active.stop()
      flushBatch()
      setRecording(false)
      await api.invoke('session:stop')
      return
    }
    const stateNow = state ?? (await api.invoke<AppState>('app:state'))
    if (stateNow.needsSetup) {
      setSettingsOpen(true)
      return
    }
    const capture = new DualChannelCapture({
      chunkSeconds: stateNow.config.chunkSeconds,
      systemAudio: stateNow.config.systemAudio !== false,
      onChunk: ({ channel, wav }) => {
        batchRef.current.push({ channel, wav: new Uint8Array(wav) })
        if (!batchTimer.current) batchTimer.current = setTimeout(flushBatch, BATCH_FLUSH_MS)
      },
      onChannelStats: (channel, stats) => {
        if (channel === 'system') setSystemStats(stats)
        else setMicStats(stats)
      },
      onError: (err, channel) =>
        setNotice(channel === 'system' ? `${err.message}` : `${err.message}`)
    })
    try {
      const started = await capture.start()
      if (!started.system && started.microphone) {
        setSystemStats(emptyStats())
      }
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err))
      await capture.stop().catch(() => undefined)
      return
    }
    captureRef.current = capture
    setNotice(null)
    setRecording(true)
    await api.invoke('session:start')
  }, [flushBatch, state])

  const dismissNotice = useCallback(() => setNotice(null), [])

  useEffect(() => {
    if (!recording || !state || state.needsSetup) return
    if (state.autoPilot) return
    const last = entries[entries.length - 1]
    if (!last || last.role !== 'speech') return
    if (autoTimer.current) clearTimeout(autoTimer.current)
    autoTimer.current = setTimeout(() => {
      if (busyRef.current || !captureRef.current?.isRunning) return
      void askCopilot()
    }, 3500)
    return () => {
      if (autoTimer.current) clearTimeout(autoTimer.current)
    }
  }, [entries, recording, state, askCopilot])

  useEffect(
    () => () => {
      if (batchTimer.current) clearTimeout(batchTimer.current)
      void captureRef.current?.stop().catch(() => undefined)
    },
    []
  )

  const clearSession = useCallback(async () => {
    const api = requireApi()
    patchStream('copilot', emptyStream())
    patchStream('screen', emptyStream())
    await api.invoke('session:clear')
  }, [patchStream])

  const saveConfig = useCallback(async (patch: ConfigPatch) => {
    const api = requireApi()
    const next = await api.invoke<PublicConfig>('config:set', patch)
    setState((prev) =>
      prev ? { ...prev, config: next, needsSetup: !next.hasApiKey || !next.model } : prev
    )
    if (next.hasApiKey && next.model) setSettingsOpen(false)
  }, [])

  const toggleOverlay = useCallback(async (open?: boolean) => {
    await requireApi().invoke('overlay:toggle', open)
  }, [])

  const toggleHud = useCallback(async (open?: boolean) => {
    await requireApi().invoke('hud:toggle', open)
  }, [])

  const toggleAutoPilot = useCallback(async (enabled?: boolean) => {
    await requireApi().invoke('autopilot:toggle', enabled)
  }, [])

  const toggleScreenWatch = useCallback(async (enabled?: boolean, intervalMs?: number) => {
    const next = await requireApi().invoke<ScreenWatchState>('screen:watch', { enabled, intervalMs })
    setScreenWatch(next)
  }, [])

  const requestSettings = useCallback(() => {
    void requireApi().invoke('app:openSettings')
  }, [])

  const setStealth = useCallback(async (enabled: boolean) => {
    await requireApi().invoke('stealth:set', enabled)
  }, [])

  const setAlwaysOnTop = useCallback(async (enabled: boolean) => {
    await requireApi().invoke('window:alwaysOnTop', enabled)
  }, [])

  const windowAction = useCallback((action: 'minimize' | 'maximize' | 'close') => {
    void requireApi().invoke(`window:${action}`)
  }, [])

  const moveHostWindow = useCallback(async (x: number, y: number) => {
    try {
      return await requireApi().invoke<{ x: number; y: number }>('window:move', { x, y })
    } catch {
      return null
    }
  }, [])

  const dockHostWindow = useCallback(
    async (edge: 'left' | 'right' | 'top' | 'bottom' | 'center' | 'auto') => {
      try {
        return await requireApi().invoke<string>('window:dock', { edge })
      } catch {
        return null
      }
    },
    []
  )

  const requestNotes = useCallback(async () => {
    return requireApi().invoke<GenerateNotesResult>('notes:generate')
  }, [])

  const value: StoreValue = {
    state,
    entries,
    streams,
    recording,
    settingsOpen,
    notice,
    micStats,
    systemStats,
    frame,
    capturing,
    visionQuestion,
    displays,
    captureDisplayId,
    hudTab,
    screenWatch,
    openSettings: setSettingsOpen,
    requestSettings,
    dismissNotice,
    toggleRecording,
    setHudTab,
    setVisionQuestion,
    setCaptureDisplay,
    captureFrame,
    scanScreen,
    askVision,
    askCopilot,
    clearSession,
    saveConfig,
    toggleOverlay,
    toggleHud,
    toggleAutoPilot,
    toggleScreenWatch,
    setStealth,
    setAlwaysOnTop,
    windowAction,
    moveHostWindow,
    dockHostWindow,
    requestNotes
  }

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}
