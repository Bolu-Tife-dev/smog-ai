import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { SparkIcon } from './icons'

export function QuickAsk({ compact = false }: { compact?: boolean }) {
  const { askTyped, askSignal, state, openSettings, streams, pushAskHeld } = useStore()
  const [question, setQuestion] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const busy = streams.copilot.busy

  useEffect(() => {
    if (askSignal > 0) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [askSignal])

  async function submit() {
    const typed = question.trim()
    if (!typed) {
      inputRef.current?.focus()
      return
    }
    if (!state || state.needsSetup) {
      openSettings(true)
      return
    }
    setQuestion('')
    await askTyped(typed)
  }

  return (
    <div
      data-quick-ask
      className={`flex shrink-0 items-center gap-1.5 ${compact ? 'px-2 pb-1' : 'px-4 pb-1'}`}
    >
      <input
        id="quickAsk"
        ref={inputRef}
        data-quick-ask-input
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            void submit()
          }
        }}
        placeholder={
          state?.needsSetup
            ? 'Configure the API to ask questions'
            : 'Type a question — live transcript context is included…'
        }
        aria-label="Quick ask question"
        className={`min-w-0 flex-1 rounded-lg border ${
          pushAskHeld ? 'border-sky-400/70 bg-sky-500/10' : 'border-smog-line bg-black/40'
        } px-3 ${compact ? 'py-1.5 text-[11px]' : 'py-2 text-xs'} text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-sky-500/60`}
      />
      <button
        type="button"
        onClick={() => void submit()}
        disabled={busy}
        title="Ask with live transcript context (hold Ctrl+Alt+Space / Cmd+Alt+Space to open)"
        className={`flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 ${
          compact ? 'py-1.5 text-[11px]' : 'py-2 text-xs'
        } font-semibold transition ${
          busy
            ? 'bg-sky-500/40 text-black'
            : 'bg-sky-500/15 text-sky-300 hover:bg-sky-500/25 disabled:opacity-40'
        }`}
      >
        <SparkIcon width={13} height={13} />
        {busy ? '…' : 'Ask'}
      </button>
      <span className="hidden shrink-0 select-none text-[9px] tracking-wider text-zinc-600 lg:inline">
        {pushAskHeld ? 'HOLDING' : 'ENTER ↵'}
      </span>
    </div>
  )
}
