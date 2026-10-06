import { randomUUID } from 'crypto'
import type { AudioChannel, Role, TranscriptEntry } from '@shared/types'

type Listener = (entries: TranscriptEntry[]) => void

export class Session {
  private entries: TranscriptEntry[] = []
  private listeners = new Set<Listener>()

  add(role: Role, text: string, channel?: AudioChannel): TranscriptEntry | null {
    const clean = text.trim()
    if (!clean) return null
    const entry: TranscriptEntry = { id: randomUUID(), ts: Date.now(), role, text: clean }
    if (channel) entry.channel = channel
    this.entries.push(entry)
    if (this.entries.length > 400) this.entries = this.entries.slice(-400)
    this.emit()
    return entry
  }

  update(id: string, patch: Partial<TranscriptEntry>): void {
    const idx = this.entries.findIndex((e) => e.id === id)
    if (idx === -1) return
    this.entries[idx] = { ...this.entries[idx], ...patch }
    this.emit()
  }

  list(): TranscriptEntry[] {
    return [...this.entries]
  }

  clear(): void {
    this.entries = []
    this.emit()
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(): void {
    const snapshot = this.list()
    for (const listener of this.listeners) listener(snapshot)
  }
}
