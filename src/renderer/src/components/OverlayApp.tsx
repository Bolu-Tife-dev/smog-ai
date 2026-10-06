import { useEffect, useRef } from 'react'
import { useStore } from '../store'
import { AnswerCard, QuestionCard, StructureCard, extractQuestion, type QuestionSource } from './Cards'
import { HudBar } from './HudBar'
import { CloseIcon } from './icons'

export function OverlayApp() {
  const {
    streams,
    entries,
    recording,
    state,
    dismissNotice,
    notice,
    frame,
    visionQuestion,
    toggleOverlay
  } = useStore()
  const answerRef = useRef<HTMLDivElement>(null)
  const answer = streams.copilot

  useEffect(() => {
    answerRef.current?.scrollTo({ top: answerRef.current.scrollHeight })
  }, [answer.text])

  const live = extractQuestion(entries)
  const question: QuestionSource = live.text
    ? live
    : visionQuestion.trim()
      ? { text: visionQuestion, label: 'SCREEN', tone: 'typed' }
      : live

  return (
    <div className="window-shell flex h-full flex-col border-sky-500/25!">
      <header className="drag-region flex h-9 shrink-0 items-center gap-2 border-b border-white/5 bg-white/[0.03] px-3">
        <span className="h-2.5 w-2.5 rounded-full bg-gradient-to-br from-sky-400 to-emerald-400" />
        <span className="text-[11px] font-semibold tracking-wider text-zinc-300">SMOG AI · OVERLAY</span>
        <span
          className={`h-1.5 w-1.5 rounded-full ${recording ? 'bg-rose-400 live-dot' : 'bg-zinc-600'}`}
          title={recording ? 'Capturing' : 'Idle'}
        />
        <span className="ml-auto text-[10px] text-zinc-600">{entries.length} lines</span>
        <button
          onClick={() => void toggleOverlay(false)}
          className="no-drag rounded p-1 text-zinc-500 transition hover:bg-white/10 hover:text-zinc-200"
          title="Close overlay"
        >
          <CloseIcon width={14} height={14} />
        </button>
      </header>

      <HudBar variant="docked" />

      {notice && (
        <div className="flex shrink-0 items-start gap-2 border-b border-rose-500/25 bg-rose-500/10 px-3 py-2 text-[10px] leading-relaxed text-rose-300">
          <span className="min-w-0 flex-1 break-words">{notice}</span>
          <button
            onClick={dismissNotice}
            className="no-drag shrink-0 rounded px-1 text-rose-400/70 transition hover:bg-white/10 hover:text-rose-200"
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col gap-2 p-2">
        <QuestionCard source={question} compact />
        <AnswerCard
          compact
          className="min-h-0 flex-1"
          scrollRef={answerRef}
          label="ANSWER"
          text={answer.text}
          busy={answer.busy}
          error={answer.error}
          placeholder={state?.needsSetup ? 'Configure the API to begin' : 'Waiting for a question'}
        />
        <StructureCard text={answer.text} compact />
      </div>

      <footer className="flex shrink-0 items-center gap-2 border-t border-white/5 px-3 py-1.5 text-[9px] tracking-wider text-zinc-700">
        {frame && <span className="text-emerald-400/70">VISION {frame.width}×{frame.height}</span>}
        <span className="ml-auto">
          {state?.stealth ? 'STEALTH ON · hidden from capture' : 'OVERLAY · visible in captures'}
        </span>
      </footer>
    </div>
  )
}
