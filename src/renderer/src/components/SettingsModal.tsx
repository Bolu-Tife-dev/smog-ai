import { useEffect, useState, type FormEvent } from 'react'
import type { ConfigPatch, ShortcutBindings, ShortcutAction } from '@shared/types'
import { useStore } from '../store'
import { CloseIcon } from './icons'

const field =
  'w-full rounded-lg border border-smog-line bg-black/40 px-3 py-2 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-sky-500/60'
const label = 'mb-1 block text-[11px] font-semibold uppercase tracking-wider text-zinc-500'

const SHORTCUT_ROWS: Array<{ action: ShortcutAction; title: string }> = [
  { action: 'stealth-overlay', title: 'Toggle stealth overlay' },
  { action: 'screen-scan', title: 'Instant screen scan' },
  { action: 'auto-pilot', title: 'Toggle Auto-Pilot' }
]

function formatAccel(accel: string, mac: boolean): string {
  const parts = accel.split('+').map((part) => {
    if (part === 'CommandOrControl') return mac ? '⌘' : 'Ctrl'
    if (part === 'Control') return mac ? '⌃' : 'Ctrl'
    if (part === 'Shift') return mac ? '⇧' : 'Shift'
    if (part === 'Alt') return mac ? '⌥' : 'Alt'
    return part
  })
  return parts.join(mac ? '' : '+')
}

export function SettingsModal() {
  const { state, saveConfig, openSettings } = useStore()
  const [apiKey, setApiKey] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [model, setModel] = useState('')
  const [sttModel, setSttModel] = useState('')
  const [temperature, setTemperature] = useState(0.4)
  const [maxTokens, setMaxTokens] = useState(0)
  const [topP, setTopP] = useState(1)
  const [extraBody, setExtraBody] = useState('')
  const [chunkSeconds, setChunkSeconds] = useState(4)
  const [language, setLanguage] = useState('')
  const [systemAudio, setSystemAudio] = useState(true)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [shortcuts, setShortcuts] = useState<ShortcutBindings | null>(null)
  const isMac = window.smog?.getPlatform?.() === 'darwin'

  useEffect(() => {
    void window.smog?.invoke<ShortcutBindings>('app:shortcuts').then(setShortcuts).catch(() => undefined)
  }, [])

  const needsSetup = state?.needsSetup ?? true

  useEffect(() => {
    if (!state) return
    setBaseUrl(state.config.baseUrl)
    setModel(state.config.model)
    setSttModel(state.config.sttModel)
    setTemperature(state.config.temperature)
    setMaxTokens(state.config.maxTokens)
    setTopP(state.config.topP)
    setExtraBody(state.config.extraBody)
    setChunkSeconds(state.config.chunkSeconds)
    setLanguage(state.config.language)
    setSystemAudio(state.config.systemAudio !== false)
    setApiKey('')
  }, [state])

  const missingKey = !state?.config.hasApiKey && apiKey.trim() === ''
  const missingModel = model.trim() === ''

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (missingKey || missingModel) {
      setError('OPENCODE_ZEN_API_KEY and LLM_MODEL_NAME are both required.')
      return
    }
    const extra = extraBody.trim()
    if (extra) {
      try {
        const parsed = JSON.parse(extra)
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object')
      } catch {
        setError('Advanced parameters must be a JSON object, e.g. {"reasoning_effort":"low"}.')
        return
      }
    }
    setSaving(true)
    setError(null)
    const patch: ConfigPatch = {
      baseUrl: baseUrl.trim(),
      model: model.trim(),
      sttModel: sttModel.trim(),
      temperature,
      maxTokens: Math.max(0, Math.floor(maxTokens)),
      topP,
      extraBody: extra,
      chunkSeconds,
      language: language.trim(),
      systemAudio
    }
    if (apiKey.trim()) patch.apiKey = apiKey.trim()
    try {
      await saveConfig(patch)
    } catch (err) {
      setError(String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 px-6 backdrop-blur-sm">
      <form
        onSubmit={onSubmit}
        className="max-h-full w-full max-w-lg overflow-y-auto rounded-2xl border border-smog-line bg-smog-panel p-6 shadow-2xl scroller"
      >
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-base font-semibold text-zinc-100">Connect OpenCode Zen</h2>
            <p className="mt-1 text-xs text-zinc-500">
              Credentials are stored in{' '}
              <code className="rounded bg-white/5 px-1 py-0.5 text-[11px] text-sky-300">
                {state?.config.configPath ?? '~/.config/smog-ai/config.json'}
              </code>{' '}
              {state?.config.encrypted ? 'encrypted with the OS keychain.' : '(plaintext — OS keychain unavailable).'}
            </p>
          </div>
          {!needsSetup && (
            <button
              type="button"
              onClick={() => openSettings(false)}
              className="rounded-md p-1.5 text-zinc-500 transition hover:bg-white/5 hover:text-zinc-200"
            >
              <CloseIcon />
            </button>
          )}
        </div>

        <div className="grid gap-4">
          <div>
            <label className={label} htmlFor="apiKey">
              OPENCODE_ZEN_API_KEY {state?.config.hasApiKey && '(saved — leave blank to keep)'}
            </label>
            <input
              id="apiKey"
              type="password"
              autoComplete="off"
              className={field}
              placeholder={state?.config.hasApiKey ? '••••••••••••••••' : 'Enter your API key'}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={label} htmlFor="model">
                LLM_MODEL_NAME
              </label>
              <input
                id="model"
                className={field}
                placeholder="e.g. mimov2.6"
                value={model}
                onChange={(e) => setModel(e.target.value)}
              />
            </div>
            <div>
              <label className={label} htmlFor="stt">
                STT model (optional)
              </label>
              <input
                id="stt"
                className={field}
                placeholder="audio transcription model"
                value={sttModel}
                onChange={(e) => setSttModel(e.target.value)}
              />
            </div>
          </div>

          <div>
            <label className={label} htmlFor="baseUrl">
              Base URL
            </label>
            <input
              id="baseUrl"
              className={field}
              placeholder="https://opencode.zen/v1"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className={label} htmlFor="temp">
                Temperature {temperature.toFixed(2)}
              </label>
              <input
                id="temp"
                type="range"
                min={0}
                max={1}
                step={0.05}
                className="w-full accent-sky-400"
                value={temperature}
                onChange={(e) => setTemperature(Number(e.target.value))}
              />
            </div>
            <div>
              <label className={label} htmlFor="chunk">
                Chunk seconds
              </label>
              <input
                id="chunk"
                type="number"
                min={2}
                max={15}
                className={field}
                value={chunkSeconds}
                onChange={(e) => setChunkSeconds(Math.min(15, Math.max(2, Number(e.target.value) || 4)))}
              />
            </div>
            <div>
              <label className={label} htmlFor="lang">
                Language
              </label>
              <input
                id="lang"
                className={field}
                placeholder="auto"
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
              />
            </div>
          </div>
          <div className="flex items-start gap-2.5 rounded-lg border border-smog-line bg-black/30 px-3 py-2.5">
            <input
              id="systemAudio"
              type="checkbox"
              checked={systemAudio}
              onChange={(e) => setSystemAudio(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-sky-400"
            />
            <label htmlFor="systemAudio" className="text-xs leading-relaxed text-zinc-300">
              Dual-channel capture — transcribe system loopback audio (remote interviewer through speakers or a
              meeting app) alongside the local microphone
            </label>
          </div>
          <div>
            <button
              type="button"
              onClick={() => setAdvancedOpen((open) => !open)}
              className="flex w-full items-center justify-between rounded-lg border border-smog-line bg-black/30 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-zinc-500 transition hover:border-sky-500/40 hover:text-zinc-300"
            >
              Advanced model parameters
              <span className="text-[10px] text-zinc-600">{advancedOpen ? '−' : '+'}</span>
            </button>
            {advancedOpen && (
              <div className="mt-3 grid gap-4 rounded-lg border border-smog-line/70 bg-black/20 p-3">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className={label} htmlFor="maxTokens">
                      max_tokens (0 = auto)
                    </label>
                    <input
                      id="maxTokens"
                      type="number"
                      min={0}
                      step={64}
                      className={field}
                      placeholder="auto"
                      value={maxTokens}
                      onChange={(e) => setMaxTokens(Math.max(0, Number(e.target.value) || 0))}
                    />
                  </div>
                  <div>
                    <label className={label} htmlFor="topP">
                      top_p (1 = omit)
                    </label>
                    <input
                      id="topP"
                      type="number"
                      min={0.05}
                      max={1}
                      step={0.05}
                      className={field}
                      placeholder="1"
                      value={topP}
                      onChange={(e) => setTopP(Math.min(1, Math.max(0.05, Number(e.target.value) || 1)))}
                    />
                  </div>
                </div>
                <div>
                  <label className={label} htmlFor="extraBody">
                    Extra request parameters (JSON, merged into the payload)
                  </label>
                  <textarea
                    id="extraBody"
                    rows={3}
                    spellCheck={false}
                    className={`${field} font-mono text-xs`}
                    placeholder={'{"reasoning_effort":"low","logprobs":true}'}
                    value={extraBody}
                    onChange={(e) => setExtraBody(e.target.value)}
                  />
                </div>
                <p className="text-[11px] leading-relaxed text-zinc-600">
                  Sent verbatim to <code className="text-sky-300">POST /chat/completions</code> alongside the
                  model, messages, and temperature — any OpenAI-compatible parameter works.
                </p>
              </div>
            )}
          </div>
        </div>

        {shortcuts && (
          <div className="mt-4 rounded-lg border border-smog-line bg-black/30 px-3 py-2.5">
            <p className={label}>Global shortcuts</p>
            <ul className="space-y-1.5">
              {SHORTCUT_ROWS.map((row) => (
                <li key={row.action} className="flex items-center justify-between gap-3 text-xs text-zinc-400">
                  <span>{row.title}</span>
                  <kbd className="rounded border border-smog-line bg-black/40 px-1.5 py-0.5 font-mono text-[11px] text-sky-300">
                    {formatAccel(shortcuts[row.action], isMac)}
                  </kbd>
                </li>
              ))}
            </ul>
          </div>
        )}

        {error && (
          <p className="mt-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
            {error}
          </p>
        )}
        {missingKey && state?.config.hasApiKey === false && (
          <p className="mt-4 text-xs text-amber-400/90">An API key is required before the app can be used.</p>
        )}

        <div className="mt-6 flex items-center justify-end gap-2">
          {!needsSetup && (
            <button
              type="button"
              onClick={() => openSettings(false)}
              className="rounded-lg px-4 py-2 text-sm text-zinc-400 transition hover:bg-white/5"
            >
              Cancel
            </button>
          )}
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-black transition hover:bg-sky-400 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save configuration'}
          </button>
        </div>
      </form>
    </div>
  )
}
