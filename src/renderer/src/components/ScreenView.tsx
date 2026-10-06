import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { AnswerCard, QuestionCard, StructureCard, type QuestionSource } from './Cards'
import { CameraIcon, ScanIcon, SparkIcon } from './icons'
import { frameAgeMs } from '../lib/vision'

function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

export function ScreenView() {
  const {
    streams,
    state,
    openSettings,
    frame,
    capturing,
    visionQuestion,
    setVisionQuestion,
    displays,
    captureDisplayId,
    setCaptureDisplay,
    captureFrame,
    askVision,
    scanScreen,
    screenWatch,
    toggleScreenWatch
  } = useStore()
  const [age, setAge] = useState(0)
  const answerRef = useRef<HTMLDivElement>(null)
  const answer = streams.screen

  useEffect(() => {
    answerRef.current?.scrollTo({ top: answerRef.current.scrollHeight })
  }, [answer.text])

  useEffect(() => {
    if (!frame) return
    const tick = (): void => setAge(frameAgeMs(frame))
    tick()
    const timer = setInterval(tick, 1000)
    return () => clearInterval(timer)
  }, [frame])

  async function submit() {
    const configured = !!state && !state.needsSetup
    if (!configured) {
      openSettings(true)
      return
    }
    await askVision(visionQuestion)
  }

  const question: QuestionSource = visionQuestion.trim()
    ? { text: visionQuestion, label: 'SCREEN', tone: 'typed' }
    : { text: '', label: 'NONE', tone: 'none' }

  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(300px,45%)_1fr]">
      <section className="flex min-h-0 flex-col border-r border-smog-line">
        <div className="flex items-center gap-2 border-b border-smog-line px-4 py-2.5">
          <button
            onClick={() => void captureFrame()}
            disabled={capturing}
            className="flex items-center gap-1.5 rounded-lg bg-violet-500/15 px-3 py-1.5 text-xs font-semibold text-violet-300 transition hover:bg-violet-500/25 disabled:opacity-40"
          >
            <CameraIcon width={14} height={14} />
            {capturing ? 'Capturing…' : 'Capture screen'}
          </button>
          <button
            onClick={() => void scanScreen()}
            disabled={capturing}
            title="Instant screen scan — extracts on-screen UI context (Ctrl+Shift+V / Cmd+Shift+V)"
            className="flex items-center gap-1.5 rounded-lg bg-sky-500/15 px-3 py-1.5 text-xs font-semibold text-sky-300 transition hover:bg-sky-500/25 disabled:opacity-40"
          >
            <ScanIcon width={14} height={14} />
            Scan now
          </button>
          <button
            onClick={() => void toggleScreenWatch(!screenWatch.running)}
            title="Continuously capture screen deltas for spatial context"
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
              screenWatch.running
                ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                : 'border-white/10 bg-white/[0.04] text-zinc-300 hover:bg-white/[0.09]'
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${screenWatch.running ? 'bg-emerald-400 live-dot' : 'bg-zinc-500'}`}
            />
            {screenWatch.running ? 'Watching' : 'Watch'}
          </button>
          <select
            value={captureDisplayId ?? ''}
            onChange={(e) => setCaptureDisplay(Number(e.target.value))}
            className="max-w-[160px] rounded-lg border border-smog-line bg-black/40 px-2 py-1.5 text-[11px] text-zinc-300 outline-none"
          >
            {displays.length === 0 && <option value="">Primary display</option>}
            {displays.map((display) => (
              <option key={display.id} value={display.id}>
                {display.label}
                {display.primary ? ' (primary)' : ''}
              </option>
            ))}
          </select>
        </div>

        <div className="scroller min-h-0 flex-1 overflow-y-auto p-4">
          {frame ? (
            <>
              <img
                src={frame.dataUrl}
                alt="Screen capture"
                className="w-full rounded-lg border border-smog-line"
              />
              <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 rounded-lg border border-smog-line bg-black/30 px-3 py-2 text-[10px]">
                <div className="flex justify-between gap-2">
                  <dt className="text-zinc-600">Frame</dt>
                  <dd className="text-zinc-400">
                    {frame.width}×{frame.height}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-zinc-600">Display</dt>
                  <dd className="truncate text-zinc-400">{frame.displayLabel ?? 'primary'}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-zinc-600">Payload</dt>
                  <dd className="text-zinc-400">
                    {formatBytes(frame.bytes ?? frame.dataUrl.length)} · {frame.format ?? 'png'}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-zinc-600">Age</dt>
                  <dd className="text-zinc-400">{Math.round(age / 1000)}s ago</dd>
                </div>
              </dl>
              <div className="mt-2 rounded-lg border border-smog-line bg-black/30 px-3 py-2 text-[10px] text-zinc-500">
                {screenWatch.running
                  ? `Screen watch active · ${screenWatch.intervalMs}ms · ${screenWatch.frames} frames · ${screenWatch.changes} changes`
                  : 'Screen watch is off — enable it to keep spatial context fresh for Auto-Pilot'}
              </div>
            </>
          ) : (
            <div className="mt-10 text-center text-xs leading-relaxed text-zinc-600">
              <p className="font-medium text-zinc-500">No frame captured</p>
              <p className="mt-1">
                Capture the primary display to extract code, UI or error context for the model.
              </p>
            </div>
          )}
        </div>

        <div className="border-t border-smog-line p-3">
          <div className="flex gap-2">
            <input
              id="visionQuestion"
              value={visionQuestion}
              onChange={(e) => setVisionQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submit()
              }}
              placeholder="Ask about what's on screen…"
              className="min-w-0 flex-1 rounded-lg border border-smog-line bg-black/40 px-3 py-2 text-xs text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-sky-500/60"
            />
            <button
              onClick={() => void submit()}
              disabled={answer.busy}
              className="flex items-center gap-1.5 rounded-lg bg-sky-500 px-3 py-2 text-xs font-semibold text-black transition hover:bg-sky-400 disabled:opacity-50"
            >
              <SparkIcon width={14} height={14} />
              Ask
            </button>
          </div>
        </div>
      </section>

      <section className="flex min-h-0 flex-col gap-3 p-4">
        <QuestionCard source={question} />
        <AnswerCard
          scrollRef={answerRef}
          label="SCREEN ANALYSIS"
          text={answer.text}
          busy={answer.busy}
          error={answer.error}
          placeholder="No analysis yet"
        />
        <StructureCard text={answer.text} />
      </section>
    </div>
  )
}
