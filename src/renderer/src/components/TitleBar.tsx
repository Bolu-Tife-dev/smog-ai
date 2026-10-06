import { useStore } from '../store'
import {
  ChatIcon,
  CloseIcon,
  EyeOffIcon,
  GearIcon,
  HudIcon,
  LayersIcon,
  MinusIcon,
  NoteIcon,
  PilotIcon,
  SquareIcon
} from './icons'

export type TabId = 'copilot' | 'screen' | 'notes'

const TABS: Array<{ id: TabId; label: string; icon: typeof ChatIcon }> = [
  { id: 'copilot', label: 'Copilot', icon: ChatIcon },
  { id: 'screen', label: 'Screen', icon: LayersIcon },
  { id: 'notes', label: 'Notes', icon: NoteIcon }
]

function StatusPill() {
  const { state, recording } = useStore()
  const status = state?.status ?? 'idle'
  const live = recording || status === 'recording'
  const busy = status === 'analyzing'
  const label = live ? 'LIVE' : busy ? 'ANALYZING' : 'IDLE'
  const tone = live ? 'text-rose-300 bg-rose-500/15' : busy ? 'text-sky-300 bg-sky-500/15' : 'text-zinc-400 bg-white/5'
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wider ${tone}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${live ? 'bg-rose-400 live-dot' : busy ? 'bg-sky-400 live-dot' : 'bg-zinc-500'}`} />
      {label}
      {state?.autoPilot && (
        <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-bold text-emerald-300">AUTO-PILOT</span>
      )}
      {state?.screenWatch.running && (
        <span className="rounded bg-violet-500/15 px-1.5 py-0.5 text-[9px] font-bold text-violet-300">WATCH</span>
      )}
    </span>
  )
}

interface Props {
  tab: TabId
  onTab: (tab: TabId) => void
}

export function TitleBar({ tab, onTab }: Props) {
  const { state, windowAction, toggleOverlay, toggleHud, toggleAutoPilot, setStealth, openSettings } = useStore()
  const overlayOpen = state?.overlayOpen ?? false
  const hudOpen = state?.hudOpen ?? false
  const autoPilot = state?.autoPilot ?? false
  const stealth = state?.stealth ?? false
  const configured = !!state && !state.needsSetup

  return (
    <header className="drag-region flex h-11 shrink-0 items-center gap-3 border-b border-smog-line bg-white/[0.02] px-3">
      <div className="flex items-center gap-2">
        <span className="h-4 w-4 rounded-full bg-gradient-to-br from-sky-400 to-emerald-400" />
        <span className="text-[13px] font-semibold tracking-wide text-zinc-100">Smog AI</span>
        <StatusPill />
        {!configured && (
          <span className="rounded bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-300">
            SETUP REQUIRED
          </span>
        )}
      </div>

      <nav className="no-drag ml-2 flex items-center gap-1">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => onTab(id)}
            className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] font-medium transition ${
              tab === id ? 'bg-sky-500/15 text-sky-300' : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-200'
            }`}
          >
            <Icon width={14} height={14} />
            {label}
          </button>
        ))}
      </nav>

      <div className="flex-1" />

      <div className="no-drag flex items-center gap-1">
        <button
          onClick={() => void toggleOverlay()}
          title="Toggle stealth overlay window"
          aria-keyshortcuts="Control+Shift+H Meta+Shift+H"
          className={`rounded-md p-1.5 transition ${overlayOpen ? 'bg-sky-500/20 text-sky-300' : 'text-zinc-400 hover:bg-white/5'}`}
        >
          <LayersIcon />
        </button>
        <button
          onClick={() => void toggleHud()}
          title="Toggle floating HUD control bar"
          className={`rounded-md p-1.5 transition ${hudOpen ? 'bg-sky-500/20 text-sky-300' : 'text-zinc-400 hover:bg-white/5'}`}
        >
          <HudIcon />
        </button>
        <button
          onClick={() => void toggleAutoPilot()}
          title="Toggle Auto-Pilot"
          aria-keyshortcuts="Control+Shift+A Meta+Shift+A"
          className={`rounded-md p-1.5 transition ${autoPilot ? 'bg-emerald-500/20 text-emerald-300' : 'text-zinc-400 hover:bg-white/5'}`}
        >
          <PilotIcon />
        </button>
        <button
          onClick={() => void setStealth(!stealth)}
          title="Hide app windows from screen capture / sharing"
          className={`rounded-md p-1.5 transition ${stealth ? 'bg-emerald-500/20 text-emerald-300' : 'text-zinc-400 hover:bg-white/5'}`}
        >
          <EyeOffIcon />
        </button>
        <button
          onClick={() => openSettings(true)}
          title="Settings"
          className="rounded-md p-1.5 text-zinc-400 transition hover:bg-white/5"
        >
          <GearIcon />
        </button>

        <span className="mx-1 h-4 w-px bg-smog-line" />

        <button
          onClick={() => windowAction('minimize')}
          title="Minimize"
          className="rounded-md p-1.5 text-zinc-400 transition hover:bg-white/5"
        >
          <MinusIcon />
        </button>
        <button
          onClick={() => windowAction('maximize')}
          title="Maximize"
          className="rounded-md p-1.5 text-zinc-400 transition hover:bg-white/5"
        >
          <SquareIcon />
        </button>
        <button
          onClick={() => windowAction('close')}
          title="Close"
          className="rounded-md p-1.5 text-zinc-400 transition hover:bg-rose-500/80 hover:text-white"
        >
          <CloseIcon />
        </button>
      </div>
    </header>
  )
}
