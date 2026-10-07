import { useEffect, useState } from 'react'
import type { GenerateNotesResult, NoteFile } from '@shared/types'
import { useStore } from '../store'
import { Markdown } from '../lib/markdown'
import { CopyIcon, NoteIcon } from './icons'

export function NotesView() {
  const { requestNotes, entries, state, openSettings } = useStore()
  const [result, setResult] = useState<GenerateNotesResult | null>(null)
  const [files, setFiles] = useState<NoteFile[]>([])
  const [busy, setBusy] = useState(false)
  const [exporting, setExporting] = useState<'pdf' | 'markdown' | null>(null)
  const [exportedPath, setExportedPath] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  async function refreshFiles() {
    try {
      setFiles(await window.smog.invoke<NoteFile[]>('notes:list'))
    } catch {
      setFiles([])
    }
  }

  useEffect(() => {
    void refreshFiles()
  }, [])

  async function generate() {
    if (!state || state.needsSetup) {
      openSettings(true)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const next = await requestNotes()
      setResult(next)
      await refreshFiles()
    } catch (err) {
      setError(String(err))
    } finally {
      setBusy(false)
    }
  }

  async function copy() {
    if (!result) return
    await navigator.clipboard.writeText(result.content)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  async function exportAs(kind: 'pdf' | 'markdown') {
    if (!result) return
    setExporting(kind)
    setError(null)
    try {
      const channel = kind === 'pdf' ? 'notes:exportPdf' : 'notes:exportMarkdown'
      const path = await window.smog.invoke<string>(channel, {
        content: result.content,
        saveDialog: true
      })
      setExportedPath(path)
      await refreshFiles()
    } catch (err) {
      setError(String(err))
    } finally {
      setExporting(null)
    }
  }

  return (
    <div className="grid h-full min-h-0 grid-cols-[260px_1fr]">
      <aside className="flex min-h-0 flex-col border-r border-smog-line">
        <div className="border-b border-smog-line p-3">
          <button
            onClick={() => void generate()}
            disabled={busy || entries.length === 0}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-emerald-500/15 px-3 py-2 text-xs font-semibold text-emerald-300 transition hover:bg-emerald-500/25 disabled:opacity-40"
          >
            <NoteIcon width={14} height={14} />
            {busy ? 'Summarizing…' : 'Generate markdown notes'}
          </button>
          <p className="mt-2 text-[10px] leading-relaxed text-zinc-600">
            {entries.length} transcript entries in this session · saved to{' '}
            <span className="text-zinc-500">{state?.notesDir ?? ''}</span>
          </p>
        </div>
        <div className="scroller min-h-0 flex-1 overflow-y-auto p-2">
          {files.length === 0 ? (
            <p className="px-2 py-4 text-center text-[11px] text-zinc-600">No saved notes yet.</p>
          ) : (
            files.map((file) => (
              <div key={file.path} className="rounded-lg px-2 py-1.5 text-[11px] text-zinc-400 hover:bg-white/5">
                <p className="truncate font-medium text-zinc-300">{file.name}</p>
                <p className="text-[10px] text-zinc-600">{new Date(file.createdAt).toLocaleString()}</p>
              </div>
            ))
          )}
        </div>
      </aside>

      <section className="flex min-h-0 flex-col">
        <div className="flex items-center gap-2 border-b border-smog-line px-4 py-2.5">
          <span className="text-xs font-semibold tracking-wider text-zinc-400">SESSION NOTES</span>
          {result && (
            <>
              <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-zinc-500">
                {exportedPath ?? result.path}
              </span>
              <button
                onClick={() => void exportAs('pdf')}
                disabled={exporting !== null}
                title="Export these notes as a PDF file"
                className="ml-auto flex items-center gap-1.5 rounded-lg bg-amber-500/15 px-2 py-1 text-[11px] font-semibold text-amber-300 transition hover:bg-amber-500/25 disabled:opacity-40"
              >
                {exporting === 'pdf' ? 'Exporting…' : 'Export PDF'}
              </button>
              <button
                onClick={() => void exportAs('markdown')}
                disabled={exporting !== null}
                title="Save these notes as a Markdown file"
                className="flex items-center gap-1.5 rounded-lg bg-sky-500/15 px-2 py-1 text-[11px] font-semibold text-sky-300 transition hover:bg-sky-500/25 disabled:opacity-40"
              >
                {exporting === 'markdown' ? 'Saving…' : 'Export Markdown'}
              </button>
              <button
                onClick={() => void copy()}
                className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] text-zinc-400 transition hover:bg-white/5"
              >
                <CopyIcon width={13} height={13} />
                {copied ? 'Copied' : 'Copy'}
              </button>
            </>
          )}
        </div>
        <div className="scroller min-h-0 flex-1 overflow-y-auto px-5 py-4 text-sm text-zinc-300">
          {error && (
            <div className="mb-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
              {error}
            </div>
          )}
          {result ? (
            <Markdown source={result.content} />
          ) : (
            <div className="mt-10 text-center text-xs text-zinc-600">
              <p className="font-medium text-zinc-500">Nothing generated yet</p>
              <p className="mt-1">Run a session, then generate structured markdown notes from the transcript.</p>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
