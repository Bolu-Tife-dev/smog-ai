import {
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type PointerEvent as ReactPointerEvent,
  type SVGProps
} from 'react'
import type { HudTab } from '@shared/types'
import { useStore } from '../store'
import { CameraIcon, GearIcon, MicIcon, NoteIcon, SparkIcon, StopIcon } from './icons'

type HudVariant = 'floating' | 'docked' | 'window'
type Offset = { x: number; y: number }

const OFFSET_KEY = 'smog.hud.offset'
const GRIP = (
  <span className="flex h-6 w-4 shrink-0 cursor-grab flex-col items-center justify-center gap-[3px] active:cursor-grabbing">
    <span className="h-0.5 w-2.5 rounded-full bg-white/25" />
    <span className="h-0.5 w-2.5 rounded-full bg-white/25" />
    <span className="h-0.5 w-2.5 rounded-full bg-white/25" />
  </span>
)

function loadOffset(key: string): Offset {
  try {
    const raw = localStorage.getItem(`${OFFSET_KEY}.${key}`)
    if (!raw) return { x: 0, y: 0 }
    const parsed = JSON.parse(raw) as Partial<Offset>
    return { x: Number(parsed.x) || 0, y: Number(parsed.y) || 0 }
  } catch {
    return { x: 0, y: 0 }
  }
}

function saveOffset(key: string, offset: Offset): void {
  try {
    localStorage.setItem(`${OFFSET_KEY}.${key}`, JSON.stringify(offset))
  } catch {
    return
  }
}

const clampOffset = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), Math.max(min, max))

interface DragState {
  id: number
  startX: number
  startY: number
  originX: number
  originY: number
  winX: number
  winY: number
}

interface HudActionProps {
  id: HudTab
  label: string
  icon: ComponentType<SVGProps<SVGSVGElement>>
  hint: string
  active?: boolean
  busy?: boolean
  primary?: boolean
  onClick: () => void
}

function HudAction({ id, label, icon: Icon, hint, active, busy, primary, onClick }: HudActionProps) {
  const tone = active
    ? 'bg-rose-500/20 text-rose-200 border-rose-500/40'
    : primary
      ? 'bg-sky-500/15 text-sky-300 border-sky-500/30 hover:bg-sky-500/25'
      : 'bg-white/[0.04] text-zinc-300 border-white/10 hover:bg-white/[0.09] hover:text-zinc-100'
  return (
    <button
      type="button"
      data-hud={id}
      title={hint}
      onClick={onClick}
      className={`relative flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition ${tone}`}
    >
      <Icon width={14} height={14} />
      <span>{label}</span>
      {busy && <span className="absolute -top-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-sky-400 live-dot" />}
    </button>
  )
}

export function HudBar({ variant = 'floating' }: { variant?: HudVariant }) {
  const {
    state,
    recording,
    toggleRecording,
    frame,
    capturing,
    captureFrame,
    askVision,
    askCopilot,
    streams,
    openSettings,
    requestSettings,
    requestNotes,
    hudTab,
    setHudTab,
    toggleOverlay,
    moveHostWindow,
    dockHostWindow
  } = useStore()
  const [notes, setNotes] = useState<{ busy: boolean; message: string | null; tone: 'ok' | 'error' }>({
    busy: false,
    message: null,
    tone: 'ok'
  })
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragState | null>(null)
  const rafRef = useRef<number | null>(null)
  const pendingMove = useRef<Offset | null>(null)
  const docked = variant === 'docked'
  const floating = variant === 'floating'
  const [dragging, setDragging] = useState(false)
  const [offset, setOffset] = useState<Offset>(() => loadOffset(floating ? 'floating' : variant))

  const isHudWindow = typeof location !== 'undefined' && location.search.includes('window=hud')

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
  }, [])

  function flash(message: string, tone: 'ok' | 'error', ms = 5000) {
    if (timer.current) clearTimeout(timer.current)
    setNotes({ busy: false, message, tone })
    timer.current = setTimeout(() => setNotes((prev) => ({ ...prev, message: null })), ms)
  }

  function select(tab: HudTab) {
    setHudTab(tab)
    if (isHudWindow && (tab === 'listen' || tab === 'vision' || tab === 'ask')) void toggleOverlay(true)
  }

  function onListen() {
    select('listen')
    if (state?.needsSetup) {
      openSettings(true)
      return
    }
    void toggleRecording()
  }

  function onVision() {
    select('vision')
    if (state?.needsSetup) {
      openSettings(true)
      return
    }
    void captureFrame({ activeWindow: true })
  }

  function onAsk() {
    select('ask')
    if (state?.needsSetup) {
      openSettings(true)
      return
    }
    if (frame) void askVision()
    else void askCopilot()
  }

  async function onNotes() {
    select('notes')
    if (state?.needsSetup) {
      openSettings(true)
      return
    }
    setNotes({ busy: true, message: null, tone: 'ok' })
    try {
      const result = await requestNotes()
      const name = result.path.split(/[\\/]/).pop() ?? result.path
      flash(`Notes saved · ${name}`, 'ok')
    } catch (err) {
      flash(err instanceof Error ? err.message : String(err), 'error')
    }
  }

  function onParams() {
    select('params')
    if (isHudWindow) requestSettings()
    else openSettings(true)
  }

  function bounds(): { maxX: number; maxY: number } {
    const el = barRef.current
    const parent = el?.offsetParent as HTMLElement | null
    if (!el || !parent) return { maxX: 0, maxY: 0 }
    return {
      maxX: Math.max(0, Math.round((parent.clientWidth - el.offsetWidth) / 2 - 12)),
      maxY: Math.max(0, Math.round(parent.clientHeight - el.offsetHeight - 24))
    }
  }

  function queueWindowMove(x: number, y: number) {
    pendingMove.current = { x: Math.round(x), y: Math.round(y) }
    if (rafRef.current) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      const next = pendingMove.current
      pendingMove.current = null
      if (next) void moveHostWindow(next.x, next.y)
    })
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (docked || event.button !== 0) return
    const target = event.target as HTMLElement | null
    if (target?.closest('button')) return
    const el = barRef.current
    if (!el) return
    el.setPointerCapture(event.pointerId)
    if (variant === 'window') {
      dragRef.current = {
        id: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        originX: 0,
        originY: 0,
        winX: window.screenX,
        winY: window.screenY
      }
    } else {
      dragRef.current = {
        id: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        originX: offset.x,
        originY: offset.y,
        winX: 0,
        winY: 0
      }
    }
    setDragging(true)
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (!drag || drag.id !== event.pointerId) return
    if (variant === 'window') {
      drag.winX += event.clientX - drag.startX
      drag.winY += event.clientY - drag.startY
      drag.startX = event.clientX
      drag.startY = event.clientY
      queueWindowMove(drag.winX, drag.winY)
      return
    }
    const { maxX, maxY } = bounds()
    const nextX = clampOffset(drag.originX + (event.clientX - drag.startX), -maxX, maxX)
    const nextY = clampOffset(drag.originY - (event.clientY - drag.startY), -12, maxY)
    setOffset({ x: nextX, y: nextY })
  }

  function finishDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (!drag || drag.id !== event.pointerId) return
    dragRef.current = null
    setDragging(false)
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    if (variant === 'window') {
      const queued = pendingMove.current
      pendingMove.current = null
      if (queued) void moveHostWindow(queued.x, queued.y).then(() => dockHostWindow('auto'))
      else void dockHostWindow('auto')
      return
    }
    const { maxX, maxY } = bounds()
    const current = offset
    const candidates = [-maxX, 0, maxX]
    const snappedX = candidates.reduce((best, value) =>
      Math.abs(value - current.x) < Math.abs(best - current.x) ? value : best
    )
    const snappedY = current.y > maxY / 2 ? maxY : 0
    const next = { x: clampOffset(snappedX, -maxX, maxX), y: clampOffset(snappedY, -12, maxY) }
    setOffset(next)
    saveOffset('floating', next)
  }

  const answerBusy = streams.copilot.busy || streams.screen.busy
  const barClass = docked
    ? 'flex shrink-0 items-center gap-1.5 border-b border-white/5 bg-white/[0.03] px-2 py-1.5'
    : variant === 'window'
      ? `flex w-full touch-none items-center gap-1.5 rounded-2xl border border-smog-line bg-[#0d1117]/95 p-1.5 shadow-2xl backdrop-blur ${
          dragging ? 'cursor-grabbing' : 'cursor-grab'
        }`
      : `absolute z-[45] flex -translate-x-1/2 touch-none items-center gap-1.5 rounded-2xl border border-smog-line bg-[#0d1117]/95 p-1.5 shadow-2xl backdrop-blur ${
          dragging ? 'cursor-grabbing' : 'cursor-grab'
        } ${dragging ? '' : 'transition-[left,bottom] duration-200 ease-out'}`

  const floatingStyle =
    floating && !docked
      ? ({ left: `calc(50% + ${offset.x}px)`, bottom: `${12 + offset.y}px` } as const)
      : undefined

  return (
    <div className={docked ? 'contents' : 'pointer-events-auto'}>
      {notes.message && (
        <div
          className={
            docked
              ? `border-b px-3 py-1.5 text-[10px] ${
                  notes.tone === 'error'
                    ? 'border-rose-500/25 bg-rose-500/10 text-rose-300'
                    : 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300'
                }`
              : `absolute bottom-16 left-1/2 z-[46] -translate-x-1/2 rounded-lg border px-3 py-1.5 text-[10px] ${
                  notes.tone === 'error'
                    ? 'border-rose-500/30 bg-[#1a1013]/95 text-rose-300'
                    : 'border-emerald-500/30 bg-[#0f1512]/95 text-emerald-300'
                }`
          }
        >
          {notes.message}
        </div>
      )}
      <div
        ref={barRef}
        data-hud-bar
        data-hud-tab={hudTab}
        data-hud-docked={docked ? 'true' : 'false'}
        className={barClass}
        style={floatingStyle}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
      >
        {!docked && GRIP}
        <HudAction
          id="listen"
          label={recording ? 'Stop' : 'Listen'}
          icon={recording ? StopIcon : MicIcon}
          hint="Capture microphone + system loopback audio and stream it to speech-to-text"
          active={recording || hudTab === 'listen'}
          onClick={onListen}
        />
        <HudAction
          id="vision"
          label="Vision"
          icon={CameraIcon}
          hint="Capture the screen frame for visual context"
          busy={capturing}
          active={!!frame || hudTab === 'vision'}
          onClick={onVision}
        />
        <HudAction
          id="ask"
          label="Ask"
          icon={SparkIcon}
          hint={
            frame
              ? 'Ask the model about the captured screen frame'
              : 'Ask the model to analyze the live transcript'
          }
          busy={answerBusy}
          primary
          active={hudTab === 'ask'}
          onClick={onAsk}
        />
        <HudAction
          id="notes"
          label="Notes"
          icon={NoteIcon}
          hint="Summarize the session transcript into markdown notes"
          busy={notes.busy}
          active={hudTab === 'notes'}
          onClick={() => void onNotes()}
        />
        <HudAction
          id="params"
          label="Params"
          icon={GearIcon}
          hint="Open API key, model and capture parameters"
          active={hudTab === 'params'}
          onClick={onParams}
        />
      </div>
    </div>
  )
}
