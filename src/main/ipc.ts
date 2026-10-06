import { BrowserWindow, ipcMain } from 'electron'
import type {
  AppState,
  CaptureOptions,
  ChatMessage,
  ConfigPatch,
  DockEdge,
  GenerateNotesResult,
  IpcChannel,
  LlmDeltaEvent,
  LlmDoneEvent,
  LlmErrorEvent,
  LlmMode,
  LlmRequest,
  PublicConfig,
  ScreenFrame,
  ScreenScanRequest,
  ScreenWatchRequest,
  ScreenWatchState,
  SessionStatus,
  SmogConfig,
  TranscribeBatchRequest,
  TranscribeBatchResult,
  TranscribeRequest,
  TranscribeResult,
  WindowDockRequest,
  WindowMoveRequest
} from '@shared/types'
import { ConfigStore, notesDir } from './config'
import { CopilotEngine } from './copilot'
import { LlmError, streamChat } from './llm'
import { generateNotes, listNotes } from './notes'
import { captureScreen, listDisplays, onScreenWatch, startWatch, stopWatch, watchState } from './screen'
import { Session } from './session'
import { SHORTCUT_ACCELERATORS, registerShortcuts, type ShortcutHandlers } from './shortcuts'
import { transcribe, transcribeChannels } from './stt'
import { applyStealthAll, setStealthEnabled } from './stealth'
import {
  allWindows,
  createMainWindow,
  dockWindow,
  focusMainWindow,
  getHudWindow,
  getMainWindow,
  getOverlayWindow,
  moveWindowTo,
  toggleHud,
  toggleOverlay
} from './windows'

export class IpcRuntime {
  private micActive = false
  private activeStreams = 0
  private lastError: string | null = null
  private controllers = new Map<LlmMode, AbortController>()
  private requestSeq = 0
  private registered = false
  private booted = false
  private watchOff: (() => void) | null = null
  private engine: CopilotEngine

  constructor(
    readonly store: ConfigStore,
    readonly session: Session
  ) {
    this.engine = new CopilotEngine({
      session: this.session,
      configured: () => this.store.isConfigured(),
      enabled: () => this.store.get().autoPilot,
      busy: () => this.activeStreams > 0,
      run: (mode, messages) => this.startStream(mode, messages).requestId
    })
  }

  boot(config: PublicConfig): void {
    setStealthEnabled(config.stealth)
    if (!this.booted) {
      this.booted = true
      this.session.subscribe((entries) => this.broadcast('event:transcript', entries))
      this.engine.attach()
      this.watchOff = onScreenWatch((event) => this.broadcast('event:screen-watch', event))
      this.register()
      this.installShortcuts()
    }

    createMainWindow(config)
    applyStealthAll(allWindows(), this.store.get().stealth)

    const cfg = this.store.get()
    if (cfg.screenWatch && !watchState().running) {
      void startWatch({ enabled: true, intervalMs: cfg.screenScanMs }).catch(() => undefined)
    }
  }

  dispose(): void {
    this.watchOff?.()
    this.watchOff = null
    this.engine.detach()
    stopWatch()
  }

  state(): AppState {
    return {
      config: this.store.public(),
      needsSetup: !this.store.isConfigured(),
      status: this.currentStatus(),
      overlayOpen: !!getOverlayWindow(),
      hudOpen: !!getHudWindow(),
      alwaysOnTop: this.store.get().alwaysOnTop,
      stealth: this.store.get().stealth,
      autoPilot: this.store.get().autoPilot,
      screenWatch: watchState(),
      lastError: this.lastError,
      notesDir: notesDir()
    }
  }

  private currentStatus(): SessionStatus {
    if (this.activeStreams > 0) return 'analyzing'
    if (this.micActive) return 'recording'
    return this.lastError ? 'error' : 'idle'
  }

  private broadcast(channel: string, payload: unknown): void {
    for (const win of allWindows()) {
      if (!win.webContents.isDestroyed()) win.webContents.send(`smog:${channel}`, payload)
    }
  }

  private handle(channel: IpcChannel, listener: (...args: any[]) => unknown): void {
    ipcMain.handle(`smog:${channel}`, listener)
  }

  private broadcastState(): void {
    this.broadcast('event:state', this.state())
  }

  private setError(err: unknown): string {
    this.lastError = err instanceof Error ? err.message : String(err)
    this.broadcastState()
    return this.lastError
  }

  private clearError(): void {
    if (this.lastError !== null) {
      this.lastError = null
      this.broadcastState()
    }
  }

  private windowFor(event: Electron.IpcMainInvokeEvent): BrowserWindow | null {
    return BrowserWindow.fromWebContents(event.sender)
  }

  private setAutoPilot(enabled: boolean): boolean {
    const next = !!enabled
    this.store.set({ autoPilot: next })
    if (next) this.engine.attach()
    this.broadcastState()
    return next
  }

  private async setScreenWatch(request: ScreenWatchRequest): Promise<ScreenWatchState> {
    const cfg = this.store.get()
    if (request?.enabled) {
      const state = await startWatch({
        enabled: true,
        intervalMs: request.intervalMs ?? cfg.screenScanMs,
        displayId: request.displayId
      })
      if (!this.store.get().screenWatch) this.store.set({ screenWatch: true })
      this.broadcastState()
      return state
    }
    const state = stopWatch()
    if (this.store.get().screenWatch) this.store.set({ screenWatch: false })
    this.broadcastState()
    return state
  }

  private async runScreenScan(request: ScreenScanRequest = {}): Promise<ScreenFrame> {
    const frame = await captureScreen({ displayId: request.displayId, format: 'jpeg', quality: 0.72 })
    this.broadcast('event:screen-scan', frame)
    if (this.store.isConfigured() && request.analyze !== false) {
      this.engine.scanNow(request.displayId).catch((err) => this.setError(err))
    }
    return frame
  }

  private installShortcuts(): void {
    const handlers: ShortcutHandlers = {
      'stealth-overlay': () => {
        const opened = toggleOverlay()
        if (opened) applyStealthAll(allWindows(), this.store.get().stealth)
        this.broadcast('event:shortcut', { action: 'stealth-overlay' })
        this.broadcastState()
      },
      'screen-scan': () => {
        this.broadcast('event:shortcut', { action: 'screen-scan' })
        void this.runScreenScan({}).catch((err) => this.setError(err))
      },
      'auto-pilot': () => {
        this.setAutoPilot(!this.store.get().autoPilot)
        this.broadcast('event:shortcut', { action: 'auto-pilot' })
      }
    }
    registerShortcuts(handlers)
  }

  private register(): void {
    if (this.registered) return
    this.registered = true

    this.handle('app:state', () => this.state())
    this.handle('app:shortcuts', () => SHORTCUT_ACCELERATORS)
    this.handle('app:openSettings', () => {
      focusMainWindow()
      this.broadcast('event:settings', { open: true })
      return true
    })
    this.handle('config:get', () => this.store.public())
    this.handle('config:set', (_event, patch: ConfigPatch) => {
      const next = this.store.set(patch ?? {})
      const cfg = this.store.get()
      const win = getMainWindow()
      if (win) win.setAlwaysOnTop(cfg.alwaysOnTop)
      applyStealthAll(allWindows(), cfg.stealth)
      getOverlayWindow()?.setAlwaysOnTop(true, 'screen-saver')
      getHudWindow()?.setAlwaysOnTop(true, 'screen-saver')
      if (cfg.autoPilot) this.engine.attach()
      if (cfg.screenWatch && !watchState().running) {
        void startWatch({ enabled: true, intervalMs: cfg.screenScanMs }).catch(() => undefined)
      }
      this.clearError()
      this.broadcastState()
      return next
    })

    this.handle('window:minimize', (event) => this.windowFor(event)?.minimize())
    this.handle('window:maximize', (event) => {
      const win = this.windowFor(event)
      if (!win) return false
      if (win.isMaximized()) win.unmaximize()
      else win.maximize()
      return win.isMaximized()
    })
    this.handle('window:close', (event) => this.windowFor(event)?.close())
    this.handle('window:alwaysOnTop', (_event, enabled: boolean) => {
      this.store.set({ alwaysOnTop: !!enabled })
      getMainWindow()?.setAlwaysOnTop(!!enabled)
      this.broadcastState()
      return !!enabled
    })
    this.handle('window:move', (event, request: WindowMoveRequest) => {
      const win = this.windowFor(event)
      return moveWindowTo(win, Number(request?.x), Number(request?.y))
    })
    this.handle('window:dock', (event, request: WindowDockRequest) => {
      const win = this.windowFor(event)
      const edge = (request?.edge ?? 'auto') as DockEdge
      return dockWindow(win, edge)
    })
    this.handle('window:focus', () => {
      focusMainWindow()
      return true
    })

    this.handle('overlay:toggle', (_event, open?: boolean) => {
      const opened = toggleOverlay(open)
      if (opened) applyStealthAll(allWindows(), this.store.get().stealth)
      this.broadcastState()
      return opened
    })

    this.handle('hud:toggle', (_event, open?: boolean) => {
      const opened = toggleHud(open)
      if (opened) applyStealthAll(allWindows(), this.store.get().stealth)
      this.broadcastState()
      return opened
    })

    this.handle('stealth:set', (_event, enabled: boolean) => {
      this.store.set({ stealth: !!enabled })
      applyStealthAll(allWindows(), !!enabled)
      this.broadcastState()
      return !!enabled
    })

    this.handle('autopilot:toggle', (_event, enabled?: boolean) =>
      this.setAutoPilot(enabled ?? !this.store.get().autoPilot)
    )

    this.handle('session:start', () => {
      this.micActive = true
      this.clearError()
      this.broadcastState()
      return this.state()
    })
    this.handle('session:stop', () => {
      this.micActive = false
      this.broadcastState()
      return this.state()
    })
    this.handle('session:clear', () => {
      this.session.clear()
      this.lastError = null
      this.broadcastState()
      return this.state()
    })
    this.handle('session:entries', () => this.session.list())

    this.handle('stt:transcribe', async (_event, req: TranscribeRequest): Promise<TranscribeResult> => {
      const wav = Buffer.from(req.wav)
      const channel = req.channel ?? 'mic'
      const cfg = this.store.get()
      try {
        const text = await transcribe(wav, cfg, req.language || cfg.language, channel)
        if (text) this.session.add('speech', text, req.channel ? channel : undefined)
        this.clearError()
        return { text }
      } catch (err) {
        this.setError(err)
        throw err
      }
    })

    this.handle(
      'stt:transcribeBatch',
      async (_event, req: TranscribeBatchRequest): Promise<TranscribeBatchResult> => {
        const chunks = (req?.chunks ?? [])
          .filter((chunk) => chunk && chunk.wav && chunk.wav.length > 0)
          .map((chunk) => ({
            wav: Buffer.from(chunk.wav),
            channel: chunk.channel,
            language: chunk.language
          }))
        if (chunks.length === 0) return { results: [] }
        const cfg = this.store.get()
        try {
          const results = await transcribeChannels(chunks, cfg, cfg.language || undefined)
          const ok = results.filter((entry) => entry.text.trim())
          const failed = results.filter((entry) => entry.error)
          for (const entry of ok) this.session.add('speech', entry.text, entry.channel)
          if (failed.length > 0) {
            const message = this.setError(failed[0].error)
            if (ok.length === 0) throw new Error(message)
          } else {
            this.clearError()
          }
          return { results: ok.map((entry) => ({ channel: entry.channel, text: entry.text })) }
        } catch (err) {
          this.setError(err)
          throw err
        }
      }
    )

    this.handle('llm:ask', (_event, req: LlmRequest) => this.startStream(req.mode, req.messages))

    this.handle('screen:displays', () => listDisplays())

    this.handle('screen:capture', async (_event, options?: CaptureOptions): Promise<ScreenFrame> => {
      try {
        const frame = await captureScreen(options ?? {})
        this.clearError()
        return frame
      } catch (err) {
        this.setError(err)
        throw err
      }
    })

    this.handle('screen:watch', async (_event, request?: ScreenWatchRequest): Promise<ScreenWatchState> => {
      try {
        return await this.setScreenWatch(request ?? { enabled: true })
      } catch (err) {
        this.setError(err)
        throw err
      }
    })

    this.handle('screen:scan', async (_event, request?: ScreenScanRequest): Promise<ScreenFrame> => {
      try {
        const frame = await this.runScreenScan(request ?? {})
        this.clearError()
        return frame
      } catch (err) {
        this.setError(err)
        throw err
      }
    })

    this.handle('notes:generate', async (): Promise<GenerateNotesResult> => {
      const entries = this.session.list()
      if (entries.length === 0) throw new LlmError('Nothing to summarize yet — start a session first.')
      try {
        const result = await generateNotes(entries, this.store.get())
        this.clearError()
        return result
      } catch (err) {
        this.setError(err)
        throw err
      }
    })

    this.handle('notes:list', () => listNotes())
  }

  private startStream(mode: LlmMode, messages: ChatMessage[]): { requestId: string } {
    const requestId = `llm-${++this.requestSeq}`
    this.controllers.get(mode)?.abort()
    const controller = new AbortController()
    this.controllers.set(mode, controller)
    this.activeStreams += 1
    this.clearError()
    this.broadcastState()
    void this.runStream(requestId, mode, messages, this.store.get(), controller).finally(() => {
      if (this.controllers.get(mode) === controller) this.controllers.delete(mode)
      this.activeStreams = Math.max(0, this.activeStreams - 1)
      this.broadcastState()
    })
    return { requestId }
  }

  private async runStream(
    requestId: string,
    mode: LlmMode,
    messages: ChatMessage[],
    cfg: SmogConfig,
    controller: AbortController
  ): Promise<void> {
    let text = ''
    try {
      for await (const delta of streamChat(cfg, messages, controller.signal)) {
        if (controller.signal.aborted) return
        text += delta
        const event: LlmDeltaEvent = { requestId, mode, delta }
        this.broadcast('event:llm-delta', event)
      }
      if (mode === 'copilot' || mode === 'screen' || mode === 'autopilot') {
        this.session.add('assistant', text.trim())
      }
      const done: LlmDoneEvent = { requestId, mode, text }
      this.broadcast('event:llm-done', done)
      this.clearError()
    } catch (err) {
      if (controller.signal.aborted) return
      const message = this.setError(err)
      const failure: LlmErrorEvent = { requestId, mode, message }
      this.broadcast('event:llm-error', failure)
    }
  }
}
