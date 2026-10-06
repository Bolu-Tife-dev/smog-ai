const fs = require('fs')
const path = require('path')
const root = path.resolve(__dirname, '..')
const src = fs.readFileSync(path.join(root, 'src/renderer/src/lib/audio.ts'), 'utf8')
const start = src.indexOf('const WORKLET_SOURCE = `')
const end = src.indexOf('`', start + 'const WORKLET_SOURCE = `'.length)
if (start < 0 || end < 0) throw new Error('WORKLET_SOURCE not found')
let code = src.slice(start + 'const WORKLET_SOURCE = `'.length, end)
code = code.split('${MIN_CHUNK_SECONDS}').join('0.35').split('${WORKLET_NAME}').join('smog-capture')
globalThis.sampleRate = 48000
globalThis.AudioWorkletProcessor = class {
  constructor() {
    this.port = { postMessage() {}, onmessage: null }
  }
}
globalThis.registerProcessor = () => {}
new Function(code)
const out = path.join(root, 'out', 'worklet-check.js')
fs.writeFileSync(out, code)
console.log('worklet source: syntax OK,', code.length, 'chars ->', out)
