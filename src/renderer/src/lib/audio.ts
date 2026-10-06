import type { AudioChannel } from '@shared/types'

export type ChunkHandler = (wav: ArrayBuffer) => void
export type MicErrorHandler = (err: Error) => void

export interface MicStats {
  capturedSeconds: number
  sentChunks: number
  droppedChunks: number
}

export interface ChannelCaptureOptions {
  channel: AudioChannel
  onChunk: ChunkHandler
  chunkSeconds?: number
  onError?: MicErrorHandler
  onStats?: (stats: MicStats) => void
}

export interface DualChannelOptions {
  onChunk: (chunk: { channel: AudioChannel; wav: ArrayBuffer }) => void
  chunkSeconds?: number
  systemAudio?: boolean
  onChannelStats?: (channel: AudioChannel, stats: MicStats) => void
  onError?: (err: Error, channel: AudioChannel) => void
}

export interface DualChannelResult {
  system: boolean
  microphone: boolean
}

const TARGET_RATE = 16000
const WORKLET_NAME = 'smog-capture'
const MIN_CHUNK_SECONDS = 0.35
const VOICED_FRAME_RMS = 0.01
const VOICED_RATIO_KEEP = 0.08
const PEAK_KEEP = 0.08

const WORKLET_SOURCE = `
class SmogCaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super()
    const opts = (options && options.processorOptions) || {}
    this.chunkSeconds = Number(opts.chunkSeconds) > 0 ? Number(opts.chunkSeconds) : 4
    this.flushAt = Math.max(1, Math.round(this.chunkSeconds * sampleRate))
    this.frames = []
    this.buffered = 0
    this.running = true
    this.stopping = false
    this.port.onmessage = (event) => {
      const msg = event.data || {}
      if (msg.type === 'stop') {
        this.running = false
        this.emit(true)
        this.stopping = true
      } else if (msg.type === 'config' && Number(msg.chunkSeconds) > 0) {
        this.chunkSeconds = Number(msg.chunkSeconds)
        this.flushAt = Math.max(1, Math.round(this.chunkSeconds * sampleRate))
        this.emit(false)
      }
    }
  }
  emit(force) {
    if (this.frames.length === 0) return
    let total = 0
    for (let i = 0; i < this.frames.length; i++) total += this.frames[i].length
    const minimum = force ? Math.round(sampleRate * ${MIN_CHUNK_SECONDS}) : this.flushAt
    if (total < minimum) return
    const merged = new Float32Array(total)
    let offset = 0
    for (let i = 0; i < this.frames.length; i++) {
      merged.set(this.frames[i], offset)
      offset += this.frames[i].length
    }
    this.frames = []
    this.buffered = 0
    this.port.postMessage({ type: 'chunk', samples: merged.buffer }, [merged.buffer])
  }
  process(inputs) {
    const input = inputs[0]
    const channel = input && input.length > 0 ? input[0] : null
    if (this.running && channel && channel.length > 0) {
      this.frames.push(new Float32Array(channel))
      this.buffered += channel.length
      if (this.buffered >= this.flushAt) this.emit(false)
    }
    return !this.stopping
  }
}
registerProcessor('${WORKLET_NAME}', SmogCaptureProcessor)
`

const MIC_ERROR_HINTS: Record<string, string> = {
  NotAllowedError:
    'Microphone access denied — allow microphone permission for this app in Windows Settings › Privacy › Microphone.',
  SecurityError: 'Microphone access is blocked by the security policy.',
  NotFoundError: 'No microphone found — connect an input device and try again.',
  DevicesNotFoundError: 'No microphone found — connect an input device and try again.',
  NotReadableError: 'Microphone is busy — another application may be using it.',
  TrackStartError: 'Microphone is busy — another application may be using it.',
  OverconstrainedError: 'No microphone matches the requested capture settings.',
  AbortError: 'Microphone capture was interrupted.'
}

export function describeMicError(err: unknown): Error {
  const name = err instanceof Error ? err.name : ''
  const hint = MIC_ERROR_HINTS[name]
  const detail = err instanceof Error ? err.message : String(err)
  if (hint) return new Error(detail && detail !== name ? `${hint} (${detail})` : hint)
  return new Error(detail || 'Could not start microphone capture.')
}

export function describeSystemError(err: unknown): Error {
  const detail = err instanceof Error ? err.message : String(err)
  if (err instanceof Error && (err.name === 'NotAllowedError' || err.name === 'SecurityError')) {
    return new Error(
      'System audio capture was denied — allow screen recording / audio permission for this app, then retry Listen.'
    )
  }
  return new Error(detail || 'System loopback capture is unavailable on this platform.')
}

function downsample(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate <= toRate) return input
  const ratio = fromRate / toRate
  const length = Math.floor(input.length / ratio)
  const out = new Float32Array(length)
  for (let i = 0; i < length; i++) {
    const start = Math.floor(i * ratio)
    const end = Math.min(input.length, Math.floor((i + 1) * ratio))
    let sum = 0
    let count = 0
    for (let j = start; j < end; j++) {
      sum += input[j]
      count++
    }
    out[i] = count > 0 ? sum / count : (input[start] ?? 0)
  }
  return out
}

function voicedStats(samples: Float32Array): { ratio: number; peak: number } {
  const frame = 320
  let voiced = 0
  let frames = 0
  let peak = 0
  for (let i = 0; i < samples.length; i += frame) {
    const end = Math.min(samples.length, i + frame)
    let sum = 0
    for (let j = i; j < end; j++) {
      const value = samples[j]
      sum += value * value
      const abs = value < 0 ? -value : value
      if (abs > peak) peak = abs
    }
    const rms = Math.sqrt(sum / (end - i))
    if (rms >= VOICED_FRAME_RMS) voiced++
    frames++
  }
  return { ratio: frames > 0 ? voiced / frames : 0, peak }
}

export function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)
  const writeString = (offset: number, text: string): void => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i))
  }
  writeString(0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  writeString(8, 'WAVE')
  writeString(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeString(36, 'data')
  view.setUint32(40, samples.length * 2, true)
  let offset = 44
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return buffer
}

let workletUrl: string | null = null

function workletModuleUrl(): string {
  if (!workletUrl) {
    workletUrl = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'text/javascript' }))
  }
  return workletUrl
}

async function acquireStream(channel: AudioChannel): Promise<MediaStream> {
  if (channel === 'system') {
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { width: 320, height: 200, frameRate: 1 },
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 2
        }
      })
    } catch (err) {
      throw describeSystemError(err)
    }
    const audioTracks = stream.getAudioTracks()
    if (audioTracks.length === 0) {
      for (const track of stream.getTracks()) track.stop()
      throw new Error(
        'No system loopback audio track was granted — this platform may not expose speaker audio. The microphone channel keeps running.'
      )
    }
    for (const track of stream.getVideoTracks()) track.stop()
    return new MediaStream(audioTracks)
  }

  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1
      }
    })
  } catch (err) {
    throw describeMicError(err)
  }
}

export class ChannelCapture {
  private ctx: AudioContext | null = null
  private stream: MediaStream | null = null
  private worklet: AudioWorkletNode | null = null
  private processor: ScriptProcessorNode | null = null
  private sink: GainNode | null = null
  private pending: Float32Array[] = []
  private buffered = 0
  private flushAt = 0
  private running = false
  private readonly channel: AudioChannel
  private readonly chunkSeconds: number
  private stats: MicStats = { capturedSeconds: 0, sentChunks: 0, droppedChunks: 0 }

  constructor(private readonly options: ChannelCaptureOptions) {
    this.channel = options.channel
    this.chunkSeconds = Math.min(15, Math.max(2, options.chunkSeconds || 4))
  }

  get isRunning(): boolean {
    return this.running
  }

  get audioChannel(): AudioChannel {
    return this.channel
  }

  get micStats(): MicStats {
    return { ...this.stats }
  }

  async start(): Promise<void> {
    if (this.running) return
    const stream = await acquireStream(this.channel)

    const ctx = new AudioContext()
    this.ctx = ctx
    this.stream = stream
    if (ctx.state === 'suspended') await ctx.resume().catch(() => undefined)
    ctx.onstatechange = (): void => {
      if (this.running && ctx.state === 'suspended') void ctx.resume().catch(() => undefined)
    }

    const source = ctx.createMediaStreamSource(stream)
    const inputTrack = stream.getAudioTracks()[0]
    if (inputTrack) {
      inputTrack.onended = (): void => {
        if (this.running) {
          this.options.onError?.(
            new Error(this.channel === 'system' ? 'System audio loopback ended.' : 'Microphone disconnected.')
          )
        }
      }
    }
    this.sink = ctx.createGain()
    this.sink.gain.value = 0
    this.flushAt = Math.max(1, Math.round(this.chunkSeconds * ctx.sampleRate))
    this.pending = []
    this.buffered = 0

    const workletReady = await this.setupWorklet(ctx)
    if (!workletReady) this.setupFallback(ctx)

    const stage = (this.worklet ?? this.processor)!
    source.connect(stage)
    stage.connect(this.sink)
    this.sink.connect(ctx.destination)
    this.running = true
  }

  private async setupWorklet(ctx: AudioContext): Promise<boolean> {
    if (typeof AudioWorkletNode === 'undefined' || !ctx.audioWorklet) return false
    try {
      await ctx.audioWorklet.addModule(workletModuleUrl())
      const node = new AudioWorkletNode(ctx, WORKLET_NAME, {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        processorOptions: { chunkSeconds: this.chunkSeconds }
      })
      node.port.onmessage = (event: MessageEvent): void => {
        const data = event.data as { type?: string; samples?: ArrayBuffer }
        if (data?.type !== 'chunk' || !data.samples || !this.ctx) return
        this.deliver(new Float32Array(data.samples))
      }
      this.worklet = node
      return true
    } catch (err) {
      console.warn('[smog-ai] AudioWorklet unavailable, using ScriptProcessor fallback:', err)
      return false
    }
  }

  private setupFallback(ctx: AudioContext): void {
    const processor = ctx.createScriptProcessor(4096, 1, 1)
    processor.onaudioprocess = (event): void => {
      if (!this.running) return
      const data = event.inputBuffer.getChannelData(0)
      this.pending.push(new Float32Array(data))
      this.buffered += data.length
      if (this.buffered >= this.flushAt) this.flushPending()
    }
    this.processor = processor
  }

  private flushPending(force = false): void {
    if (!this.ctx || this.pending.length === 0) return
    let total = 0
    for (const chunk of this.pending) total += chunk.length
    const minimum = force ? Math.round(this.ctx.sampleRate * MIN_CHUNK_SECONDS) : this.flushAt
    if (total < minimum) return
    const merged = new Float32Array(total)
    let offset = 0
    for (const chunk of this.pending) {
      merged.set(chunk, offset)
      offset += chunk.length
    }
    this.pending = []
    this.buffered = 0
    this.deliver(merged)
  }

  private deliver(samples: Float32Array): void {
    const rate = this.ctx?.sampleRate || TARGET_RATE
    if (samples.length === 0) return
    this.stats.capturedSeconds += samples.length / rate
    const { ratio, peak } = voicedStats(samples)
    if (ratio < VOICED_RATIO_KEEP && peak < PEAK_KEEP) {
      this.stats.droppedChunks++
      this.emitStats()
      return
    }
    const mono = downsample(samples, rate, TARGET_RATE)
    this.stats.sentChunks++
    this.emitStats()
    this.options.onChunk(encodeWav(mono, TARGET_RATE))
  }

  private emitStats(): void {
    this.options.onStats?.({ ...this.stats })
  }

  async stop(): Promise<void> {
    if (!this.running && !this.ctx) return
    this.running = false
    if (this.worklet) {
      this.worklet.port.postMessage({ type: 'stop' })
      await new Promise((resolve) => setTimeout(resolve, 60))
    } else {
      this.flushPending(true)
    }
    this.processor?.disconnect()
    this.worklet?.disconnect()
    this.sink?.disconnect()
    if (this.worklet) this.worklet.port.onmessage = null
    this.worklet = null
    this.processor = null
    this.sink = null
    for (const track of this.stream?.getTracks() ?? []) {
      track.onended = null
      track.stop()
    }
    this.stream = null
    const ctx = this.ctx
    this.ctx = null
    if (ctx && ctx.state !== 'closed') await ctx.close().catch(() => undefined)
    this.pending = []
    this.buffered = 0
  }
}

export class MicCapture extends ChannelCapture {
  constructor(options: Omit<ChannelCaptureOptions, 'channel'>) {
    super({ ...options, channel: 'mic' })
  }
}

export class DualChannelCapture {
  private channels = new Map<AudioChannel, ChannelCapture>()
  private running = false
  private readonly chunkSeconds: number
  private readonly systemAudio: boolean

  constructor(private readonly options: DualChannelOptions) {
    this.chunkSeconds = options.chunkSeconds ?? 4
    this.systemAudio = options.systemAudio !== false
  }

  get isRunning(): boolean {
    return this.running
  }

  get activeChannels(): AudioChannel[] {
    return [...this.channels.keys()]
  }

  statsFor(channel: AudioChannel): MicStats {
    return this.channels.get(channel)?.micStats ?? { capturedSeconds: 0, sentChunks: 0, droppedChunks: 0 }
  }

  async start(): Promise<DualChannelResult> {
    if (this.running) return { system: this.channels.has('system'), microphone: this.channels.has('mic') }

    const create = (channel: AudioChannel): ChannelCapture =>
      new ChannelCapture({
        channel,
        chunkSeconds: this.chunkSeconds,
        onChunk: (wav) => this.options.onChunk({ channel, wav }),
        onStats: (stats) => this.options.onChannelStats?.(channel, stats),
        onError: (err) => this.options.onError?.(err, channel)
      })

    const mic = create('mic')
    await mic.start()
    this.channels.set('mic', mic)

    let system = false
    if (this.systemAudio) {
      const capture = create('system')
      try {
        await capture.start()
        this.channels.set('system', capture)
        system = true
      } catch (err) {
        await capture.stop().catch(() => undefined)
        this.options.onError?.(err instanceof Error ? err : new Error(String(err)), 'system')
      }
    }

    this.running = true
    return { system, microphone: true }
  }

  async stop(): Promise<void> {
    this.running = false
    const captures = [...this.channels.values()]
    this.channels.clear()
    await Promise.all(captures.map((capture) => capture.stop().catch(() => undefined)))
  }
}
