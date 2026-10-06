import { useState } from 'react'
import { StoreProvider, useStore } from './store'
import { TitleBar, type TabId } from './components/TitleBar'
import { CopilotView } from './components/CopilotView'
import { ScreenView } from './components/ScreenView'
import { NotesView } from './components/NotesView'
import { OverlayApp } from './components/OverlayApp'
import { SettingsModal } from './components/SettingsModal'
import { HudBar } from './components/HudBar'

function ErrorToast() {
  const { state, notice, dismissNotice } = useStore()
  const [dismissed, setDismissed] = useState<string | null>(null)
  const message = state?.lastError ?? notice ?? null
  if (!message || message === dismissed) return null
  return (
    <div className="pointer-events-auto absolute bottom-20 left-1/2 z-40 w-[min(560px,90%)] -translate-x-1/2 rounded-xl border border-rose-500/30 bg-[#1a1013]/95 px-4 py-3 shadow-xl">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-rose-400">Error</p>
          <p className="mt-1 break-words text-xs leading-relaxed text-rose-200/90">{message}</p>
        </div>
        <button
          onClick={() => {
            setDismissed(message)
            dismissNotice()
          }}
          className="rounded-md px-2 py-1 text-[11px] text-zinc-500 transition hover:bg-white/5 hover:text-zinc-300"
        >
          Dismiss
        </button>
      </div>
    </div>
  )
}

function Shell() {
  const { settingsOpen, state } = useStore()
  const [tab, setTab] = useState<TabId>('copilot')
  const query = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams()
  const isOverlay = query.get('window') === 'overlay'
  const isHud = query.get('window') === 'hud'

  if (isHud) {
    return (
      <div className="flex h-full w-full items-center justify-center p-1.5">
        <HudBar variant="window" />
      </div>
    )
  }

  if (isOverlay) {
    return (
      <div className="relative h-full">
        <OverlayApp />
        {settingsOpen && <SettingsModal />}
      </div>
    )
  }

  return (
    <div className="window-shell relative flex h-full flex-col">
      <TitleBar tab={tab} onTab={setTab} />
      <div className="min-h-0 flex-1">
        {tab === 'copilot' && <CopilotView />}
        {tab === 'screen' && <ScreenView />}
        {tab === 'notes' && <NotesView />}
      </div>
      <HudBar variant="floating" />
      <ErrorToast />
      {settingsOpen && <SettingsModal />}
      {!state && (
        <div className="absolute inset-0 z-60 flex items-center justify-center bg-smog-bg">
          <span className="text-xs tracking-widest text-zinc-600">LOADING…</span>
        </div>
      )}
    </div>
  )
}

export default function App() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  )
}
