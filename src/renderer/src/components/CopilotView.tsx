import { useEffect, useRef } from 'react'
import { useStore } from '../store'
import { AnswerCard, QuestionCard, StructureCard, extractQuestion } from './Cards'
import { MicIcon, PilotIcon, SparkIcon, StopIcon, TrashIcon } from './icons'

const ROLE_BADGE: Record<string, { label: string; cls: string }> = {
  speech: { label: 'LIVE', cls: 'bg-amber-500/15 text-amber-300' },
  assistant: { label: 'AI', cls: 'bg-sky-500/15 text-sky-300' },
  screen: { label: 'SCREEN', cls: 'bg-violet-500/15 text-violet-300' },
  user: { label: 'USER', cls: 'bg-emerald-500/15 text-emerald-300' },
  system: { label: 'SYS', cls: 'bg-zinc-500/15 text-zinc-400' }
}

export function CopilotView() {
  const {
    entries,
    streams,
    recording,
    toggleRecording,
    askCopilot,
    clearSession,
    state,
    openSettings,
    micStats,
    systemStats,
    toggleAutoPilot
  } = useStore()
  const transcriptRef = useRef<HTMLDivElement>(null)
  const answerRef = useRef<HTMLDivElement>(null)
  const answer = streams.copilot
  const question = extractQuestion(entries)

  useEffect(() => {
    transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight })
  }, [entries])

  useEffect(() => {
    answerRef.current?.scrollTo({ top: answerRef.current.scrollHeight })
  }, [answer.text])

  const configured = !!state && !state.needsSetup

  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(280px,38%)_1fr]">
      <section className="flex min-h-0 flex-col border-r border-smog-line">
        <div className="flex items-center gap-2 border-b border-smog-line px-4 py-2.5">
          <button
            onClick={() => void (configured ? toggleRecording().catch((e) => console.error(e)) : openSettings(true))}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
              recording
                ? 'bg-rose-500/20 text-rose-300 hover:bg-rose-500/30'
                : 'bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25'
            }`}
          >
            {recording ? <StopIcon width={14} height={14} /> : <MicIcon width={14} height={14} />}
            {recording ? 'Stop mic' : 'Start mic'}
          </button>
          <button
            onClick={() => void askCopilot()}
            disabled={entries.length === 0}
            className="flex items-center gap-1.5 rounded-lg bg-sky-500/15 px-3 py-1.5 text-xs font-semibold text-sky-300 transition hover:bg-sky-500/25 disabled:opacity-40"
          >
            <SparkIcon width={14} height={14} />
            Analyze
          </button>
          <button
            onClick={() => void toggleAutoPilot()}
            title="Answer detected question utterances automatically (Ctrl+Shift+A / Cmd+Shift+A)"
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
              state?.autoPilot
                ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                : 'border-white/10 bg-white/[0.04] text-zinc-300 hover:bg-white/[0.09]'
            }`}
          >
            <PilotIcon width={14} height={14} />
            Auto-Pilot
          </button>
          <button
            onClick={() => void clearSession()}
            className="ml-auto rounded-lg p-1.5 text-zinc-500 transition hover:bg-white/5 hover:text-zinc-300"
            title="Clear session"
          >
            <TrashIcon />
          </button>
        </div>

        <div ref={transcriptRef} className="scroller min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {entries.length === 0 ? (
            <div className="mt-10 px-2 text-center text-xs leading-relaxed text-zinc-600">
              <p className="font-medium text-zinc-500">No transcript yet</p>
              <p className="mt-1">
                Hit <span className="text-emerald-400">Start mic</span> — speech is transcribed in chunks and
                fed to the model live.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {entries.map((entry) => {
                const badge = ROLE_BADGE[entry.role] ?? ROLE_BADGE.system
                return (
                  <div key={entry.id} className="text-xs leading-relaxed">
                    <div className="mb-1 flex items-center gap-2">
                      <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold tracking-wider ${badge.cls}`}>
                        {badge.label}
                      </span>
                      <span className="text-[10px] text-zinc-600">
                        {new Date(entry.ts).toLocaleTimeString()}
                      </span>
                    </div>
                    <p className="whitespace-pre-wrap break-words text-zinc-300">{entry.text}</p>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div className="border-t border-smog-line px-4 py-2 text-[10px] text-zinc-600">
          {state?.autoPilot
            ? 'Auto-Pilot on · detected questions stream automatically'
            : 'Auto-analyze 3.5s after each transcript chunk'}
          {' · '}
          {recording
            ? `mic ${micStats.capturedSeconds.toFixed(0)}s · ${micStats.sentChunks} sent · ${micStats.droppedChunks} silent skipped · system ${
                systemStats.sentChunks
              } chunks`
            : 'mic off'}
        </div>
      </section>

      <section className="flex min-h-0 flex-col gap-3 p-4">
        <QuestionCard source={question} />
        <AnswerCard
          scrollRef={answerRef}
          text={answer.text}
          busy={answer.busy}
          error={answer.error}
          badge={
            <span className="rounded bg-white/5 px-1.5 py-0.5 text-[9px] font-semibold text-zinc-500">
              INTRO · CONTENT · CONCLUSION
            </span>
          }
        />
        <StructureCard text={answer.text} />
      </section>
    </div>
  )
}
