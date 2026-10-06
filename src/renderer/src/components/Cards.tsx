import type { ReactNode, Ref } from 'react'
import type { TranscriptEntry } from '@shared/types'
import { Markdown } from '../lib/markdown'
import { parseStructure, sectionPresence } from '../lib/structure'

export function Card({
  title,
  dataCard,
  badge,
  meta,
  children,
  className = '',
  bodyClassName = '',
  bodyRef
}: {
  title: string
  dataCard: string
  badge?: ReactNode
  meta?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
  bodyRef?: Ref<HTMLDivElement>
}) {
  return (
    <section
      data-card={dataCard}
      className={`flex min-h-0 flex-col overflow-hidden rounded-xl border border-smog-line bg-smog-panel/70 ${className}`}
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-smog-line/70 bg-white/[0.02] px-3 py-1.5">
        <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">{title}</span>
        {badge}
        <span className="ml-auto flex items-center gap-2 text-[10px] text-zinc-600">{meta}</span>
      </header>
      <div ref={bodyRef} className={`min-h-0 flex-1 ${bodyClassName}`}>
        {children}
      </div>
    </section>
  )
}

export interface QuestionSource {
  text: string
  label: string
  tone: 'live' | 'user' | 'typed' | 'none'
}

export function extractQuestion(entries: TranscriptEntry[]): QuestionSource {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]
    if (entry.role === 'speech') return { text: entry.text, label: 'LIVE', tone: 'live' }
    if (entry.role === 'user') return { text: entry.text, label: 'USER', tone: 'user' }
  }
  return { text: '', label: 'NONE', tone: 'none' }
}

const SOURCE_TONE: Record<QuestionSource['tone'], string> = {
  live: 'bg-amber-500/15 text-amber-300',
  user: 'bg-emerald-500/15 text-emerald-300',
  typed: 'bg-sky-500/15 text-sky-300',
  none: 'bg-zinc-500/15 text-zinc-400'
}

export function QuestionCard({
  source,
  compact = false
}: {
  source: QuestionSource
  compact?: boolean
}) {
  return (
    <Card
      title="Question"
      dataCard="question"
      className={compact ? 'shrink-0' : ''}
      meta={
        <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold tracking-wider ${SOURCE_TONE[source.tone]}`}>
          {source.label}
        </span>
      }
    >
      <div className={`px-3 ${compact ? 'py-2' : 'py-3'}`}>
        {source.text ? (
          <p
            className={`whitespace-pre-wrap break-words text-zinc-200 ${
              compact ? 'line-clamp-3 text-[12px] leading-relaxed' : 'text-sm leading-relaxed'
            }`}
          >
            {source.text}
          </p>
        ) : (
          <p className="text-xs leading-relaxed text-zinc-600">
            No question captured yet — start the mic or type a screen question.
          </p>
        )}
      </div>
    </Card>
  )
}

export function AnswerCard({
  text,
  busy,
  error,
  label = 'STRUCTURED ANSWER',
  compact = false,
  placeholder,
  badge,
  scrollRef,
  className
}: {
  text: string
  busy: boolean
  error?: string | null
  label?: string
  compact?: boolean
  placeholder?: string
  badge?: ReactNode
  scrollRef?: Ref<HTMLDivElement>
  className?: string
}) {
  return (
    <Card
      title={label}
      dataCard="answer"
      badge={badge}
      className={className ?? (compact ? '' : 'min-h-0 flex-1')}
      bodyRef={scrollRef}
      meta={
        busy ? (
          <span className="flex items-center gap-1.5 text-sky-400">
            <span className="h-1.5 w-1.5 rounded-full bg-sky-400 live-dot" />
            drafting…
          </span>
        ) : text ? (
          <span>ready</span>
        ) : null
      }
      bodyClassName="scroller overflow-y-auto"
    >
      <div className={`text-zinc-300 ${compact ? 'px-3 py-2 text-[12px]' : 'px-5 py-4 text-sm'}`}>
        {error && (
          <div className="mb-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
            {error}
          </div>
        )}
        {text ? (
          <Markdown source={text} />
        ) : (
          !busy && (
            <div className="mt-6 text-center text-xs text-zinc-600">
              <p className="font-medium text-zinc-500">{placeholder ?? 'Waiting for a question'}</p>
              <p className="mt-1">Answers stream here — automatically while the mic is live.</p>
            </div>
          )
        )}
        {busy && text && <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-sky-400/70" />}
      </div>
    </Card>
  )
}

export function StructureCard({ text, compact = false }: { text: string; compact?: boolean }) {
  const structure = parseStructure(text)
  const presence = sectionPresence(structure)
  const hasText = text.trim().length > 0

  return (
    <Card
      title="Structure"
      dataCard="structure"
      className="shrink-0"
      meta={hasText ? <span>{structure.words} words</span> : null}
      bodyClassName="px-3 py-2"
    >
      <div className="flex flex-wrap items-center gap-1.5">
        {presence.map((section) => (
          <span
            key={section.label}
            className={`rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${
              section.present ? 'bg-emerald-500/15 text-emerald-300' : 'bg-zinc-500/10 text-zinc-600'
            }`}
            title={section.present ? `${section.label} section detected` : `${section.label} section missing`}
          >
            {section.present ? '✓ ' : '· '}
            {section.label}
          </span>
        ))}
        <span className="rounded bg-white/5 px-1.5 py-0.5 text-[9px] font-semibold text-zinc-500">
          {structure.bullets} bullets
        </span>
        <span className="rounded bg-white/5 px-1.5 py-0.5 text-[9px] font-semibold text-zinc-500">
          {structure.codeBlocks} code
        </span>
        {!structure.complete && hasText && (
          <span className="text-[9px] font-semibold uppercase tracking-wider text-amber-400/80">
            incomplete outline
          </span>
        )}
      </div>
      {!compact && structure.sections.length > 0 && (
        <ul className="mt-2 space-y-1 border-t border-smog-line/70 pt-2">
          {structure.sections.map((section, index) => (
            <li key={`${section.heading}-${index}`} className="flex items-baseline gap-2 text-[11px]">
              <span
                className="text-zinc-600"
                style={{ marginLeft: `${Math.max(0, section.level - 1) * 10}px` }}
              >
                {'#'.repeat(Math.max(1, Math.min(6, section.level || 2)))}
              </span>
              <span className="truncate text-zinc-400">{section.heading || 'Preamble'}</span>
              <span className="ml-auto shrink-0 text-[10px] text-zinc-600">
                {section.words}w{section.bullets ? ` · ${section.bullets}b` : ''}
                {section.codeBlocks ? ` · ${section.codeBlocks}c` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
