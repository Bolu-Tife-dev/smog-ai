import { spawn, execFileSync } from 'child_process'
import { setTimeout as delay } from 'timers/promises'
import { readFile, mkdir, rm, writeFile } from 'fs/promises'
import { createServer } from 'http'
import path from 'path'
import { fileURLToPath } from 'url'
import WebSocket from 'ws'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const electronExe = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
const configPath = path.join(process.env.USERPROFILE, '.config', 'smog-ai', 'config.json')
const artifacts = path.join(root, 'out', 'e2e')
const PORT = 9333

const results = []
function record(name, ok, detail = '', info = false) {
  results.push({ name, ok, detail, info })
  const tag = info ? 'INFO' : ok ? 'PASS' : 'FAIL'
  console.log(`${tag}  ${name}${detail ? ` — ${detail}` : ''}`)
}

function startMockLlm() {
  const requests = []
  const server = createServer((req, res) => {
    let raw = ''
    req.on('data', (chunk) => (raw += chunk))
    req.on('end', () => {
      let body = null
      try {
        body = JSON.parse(raw || '{}')
      } catch {
        body = null
      }
      const url = req.url || ''
      const formModel = /name="model"\r\n\r\n([^\r\n]+)/.exec(raw)?.[1] ?? null
      requests.push({
        url,
        auth: req.headers.authorization,
        body,
        model: body?.model ?? formModel,
        rawLen: raw.length,
        seq: requests.length + 1
      })

      if (url.endsWith('/chat/completions')) {
        const model = body?.model
        if (body?.stream && model === 'nostream') {
          res.writeHead(400, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ error: { message: 'stream=true is not supported by this model' } }))
          return
        }
        const seq = requests[requests.length - 1].seq
        const isAudioChat = JSON.stringify(body?.messages ?? []).includes('input_audio')
        const content = isAudioChat
          ? `chat transcript #${seq}`
          : model === 'nostream'
            ? 'nonstream fallback answer'
            : `## Introduction\n\nmock streamed answer #${seq}\n\n## Content\n\n- bullet one\n- bullet two\n\n## Conclusion\n\nwrapped up.`
        requests[requests.length - 1].content = content
        if (body?.stream) {
          res.writeHead(200, { 'content-type': 'text/event-stream' })
          const frames = (content.match(/[\s\S]{1,12}/g) ?? []).map(
            (text) => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`
          )
          let index = 0
          const tick = () => {
            if (index < frames.length) {
              res.write(frames[index++])
              setTimeout(tick, 40)
            } else {
              res.write('data: [DONE]\n\n')
              res.end()
            }
          }
          tick()
          return
        }
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }))
        return
      }

      if (url.endsWith('/audio/transcriptions')) {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ text: 'mock transcript' }))
        return
      }

      res.writeHead(404, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: { message: 'not found' } }))
    })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: server.address().port, requests })
    })
  })
}

async function waitFor(fn, timeoutMs = 20000, interval = 250) {
  const deadline = Date.now() + timeoutMs
  let lastErr
  while (Date.now() < deadline) {
    try {
      const value = await fn()
      if (value) return value
    } catch (err) {
      lastErr = err
    }
    await delay(interval)
  }
  throw lastErr ?? new Error('timed out waiting')
}

async function listTargets() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/list`)
  return res.json()
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 })
    let id = 0
    const pending = new Map()
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString())
      if (msg.id && pending.has(msg.id)) {
        const { resolve: res, reject: rej } = pending.get(msg.id)
        pending.delete(msg.id)
        msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result)
      }
    })
    ws.on('open', () =>
      resolve({
        send(method, params = {}, timeoutMs = 30000) {
          return new Promise((res, rej) => {
            const msgId = ++id
            const timer = setTimeout(() => {
              pending.delete(msgId)
              rej(new Error(`CDP timeout: ${method}`))
            }, timeoutMs)
            pending.set(msgId, {
              resolve: (v) => {
                clearTimeout(timer)
                res(v)
              },
              reject: (e) => {
                clearTimeout(timer)
                rej(e)
              }
            })
            ws.send(JSON.stringify({ id: msgId, method, params }))
          })
        },
        close: () => ws.close()
      })
    )
    ws.on('error', reject)
  })
}

async function evaluate(client, expression) {
  const result = await client.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true
  })
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? 'evaluate failed')
  }
  return result.result.value
}

async function screenshot(client, file) {
  const { data } = await client.send('Page.captureScreenshot', { format: 'png' })
  await writeFile(file, Buffer.from(data, 'base64'))
}

function osScreenshot(file) {
  const script = `
    Add-Type -AssemblyName System.Windows.Forms, System.Drawing
    $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    $bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)
    $bmp.Save('${file.replace(/'/g, "''")}', [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose(); $bmp.Dispose()
  `
  execFileSync('powershell.exe', ['-NoProfile', '-Command', script], { stdio: 'ignore' })
}

async function meanBrightness(file) {
  const script = `
    Add-Type -AssemblyName System.Drawing
    $bmp = [System.Drawing.Bitmap]::FromFile('${file.replace(/'/g, "''")}')
    $sum = 0L; $count = 0
    for ($y = 0; $y -lt $bmp.Height; $y += 8) {
      for ($x = 0; $x -lt $bmp.Width; $x += 8) {
        $c = $bmp.GetPixel($x, $y)
        $sum += ($c.R + $c.G + $c.B); $count += 3
      }
    }
    $bmp.Dispose()
    [Math]::Round($sum / $count, 2)
  `
  return Number(execFileSync('powershell.exe', ['-NoProfile', '-Command', script], { encoding: 'utf8' }).trim())
}

async function main() {
  await mkdir(artifacts, { recursive: true })
  await rm(configPath, { force: true })
  const mock = await startMockLlm()

  const proc = spawn(electronExe, ['--remote-debugging-port=' + PORT, '.'], {
    cwd: root,
    stdio: 'ignore'
  })

  let mainClient
  let overlayClient
  try {
    await waitFor(async () => (await listTargets()).some((t) => t.type === 'page'))
    const mainTarget = await waitFor(async () =>
      (await listTargets()).find((t) => t.type === 'page' && !t.url.includes('window=overlay'))
    )
    mainClient = await connect(mainTarget.webSocketDebuggerUrl)
    await mainClient.send('Page.enable')

    await delay(1500)

    const setupResult = await evaluate(
      mainClient,
      `(() => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms))
        const setNative = (el, value) => {
          const desc = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value')
          desc.set.call(el, value)
          el.dispatchEvent(new Event('input', { bubbles: true }))
        }
        return (async () => {
          let key = document.getElementById('apiKey')
          let model = document.getElementById('model')
          for (let i = 0; i < 30 && (!key || !model); i++) {
            await wait(250)
            key = document.getElementById('apiKey')
            model = document.getElementById('model')
          }
          if (!key || !model) return { modal: false }
          const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Save configuration'))
          let state = await window.smog.invoke('app:state')
          for (let attempt = 0; attempt < 4 && state.needsSetup; attempt++) {
            setNative(key, 'zk-test-' + Date.now())
            setNative(model, 'test-model')
            await wait(120)
            btn.click()
            for (let i = 0; i < 10 && state.needsSetup; i++) {
              await wait(250)
              state = await window.smog.invoke('app:state')
            }
          }
          return {
            modal: true,
            needsSetup: state.needsSetup,
            hasApiKey: state.config.hasApiKey,
            model: state.config.model,
            encrypted: state.config.encrypted,
            baseUrl: state.config.baseUrl
          }
        })()
      })()`
    )

    record(
      'first-run settings modal saves config',
      setupResult.modal === true && setupResult.needsSetup === false && setupResult.hasApiKey === true,
      JSON.stringify(setupResult)
    )
    record('base URL defaults to OpenCode Zen endpoint', setupResult.baseUrl === 'https://opencode.zen/v1')

    const freshState = await evaluate(
      mainClient,
      `window.smog.invoke('app:state').then((s) => ({ stealth: s.stealth, baseUrl: s.config.baseUrl }))`
    )
    record(
      'stealth (hidden from screenshots / screen share) is on by default',
      freshState.stealth === true,
      JSON.stringify(freshState)
    )

    const shortcutMap = await evaluate(mainClient, `window.smog.invoke('app:shortcuts')`)
    record(
      'global shortcuts include quick hide / vision / push-to-ask',
      shortcutMap?.['stealth-overlay'] === 'CommandOrControl+Shift+H' &&
        shortcutMap?.['screen-scan'] === 'CommandOrControl+Shift+V' &&
        shortcutMap?.['auto-pilot'] === 'CommandOrControl+Shift+A' &&
        typeof shortcutMap?.['push-to-ask'] === 'string',
      JSON.stringify(shortcutMap)
    )

    const stored = JSON.parse(await readFile(configPath, 'utf8'))
    record(
      'config persisted encrypted at ~/.config/smog-ai/config.json',
      stored.encoding === 'encrypted' && !JSON.stringify(stored).includes('zk-test-'),
      `encoding=${stored.encoding}`
    )

    await screenshot(mainClient, path.join(artifacts, 'main-after-setup.png'))
    record('main window screenshot captured', true)

    const screen = await evaluate(
      mainClient,
      `window.smog.invoke('screen:capture').then((f) => ({ w: f.width, h: f.height, len: f.dataUrl.length }))`
    )
    record(
      'screen frame capture returns image data',
      screen && screen.len > 5000 && screen.w > 400,
      `${screen.w}x${screen.h}, ${screen.len} bytes`
    )

    const stealthOn = await evaluate(mainClient, `window.smog.invoke('stealth:set', true)`)
    await delay(800)
    osScreenshot(path.join(artifacts, 'os-stealth-on.png'))
    const stealthState = await evaluate(mainClient, `window.smog.invoke('app:state').then((s) => s.stealth)`)
    record('stealth mode toggles on', stealthOn === true && stealthState === true)
    const brightOn = await meanBrightness(path.join(artifacts, 'os-stealth-on.png'))

    await evaluate(mainClient, `window.smog.invoke('stealth:set', false)`)
    await delay(800)
    osScreenshot(path.join(artifacts, 'os-stealth-off.png'))
    const brightOff = await meanBrightness(path.join(artifacts, 'os-stealth-off.png'))
    record(
      'OS screen capture differs when stealth is on (informational)',
      Math.abs(brightOn - brightOff) > 1,
      `brightness on=${brightOn} off=${brightOff}`,
      true
    )

    await evaluate(mainClient, `document.querySelector('button[title="Toggle stealth overlay window"]').click()`)
    const overlayTarget = await waitFor(async () =>
      (await listTargets()).find((t) => t.type === 'page' && t.url.includes('window=overlay'))
    )
    record('overlay window opens', true, overlayTarget.title)

    overlayClient = await connect(overlayTarget.webSocketDebuggerUrl)
    await overlayClient.send('Page.enable')
    await delay(1500)
    await screenshot(overlayClient, path.join(artifacts, 'overlay.png'))
    const overlayInfo = await evaluate(
      overlayClient,
      `({ title: document.title, hasShell: !!document.querySelector('.window-shell'), text: document.body.innerText.slice(0, 120) })`
    )
    record('overlay renderer mounted', overlayInfo.hasShell === true, JSON.stringify(overlayInfo.text))

    const overlayState = await evaluate(mainClient, `window.smog.invoke('app:state').then((s) => s.overlayOpen)`)
    record('state reflects overlay open', overlayState === true)

    const entries = await evaluate(mainClient, `window.smog.invoke('session:entries')`)
    record('session transcript starts empty', Array.isArray(entries) && entries.length === 0)

    const mockBase = `http://127.0.0.1:${mock.port}/v1`
    const patched = await evaluate(
      mainClient,
      `window.smog.invoke('config:set', {
        apiKey: 'zk-test-key',
        baseUrl: ${JSON.stringify(mockBase)},
        model: 'mimov2.6',
        sttModel: 'whisper-mock',
        maxTokens: 512,
        topP: 0.9,
        extraBody: '{"smog_probe":"phase1b"}'
      })`
    )
    record(
      'dynamic model parameters persisted',
      patched.maxTokens === 512 &&
        patched.topP === 0.9 &&
        patched.extraBody === '{"smog_probe":"phase1b"}' &&
        patched.baseUrl === mockBase,
      JSON.stringify({
        maxTokens: patched.maxTokens,
        topP: patched.topP,
        extraBody: patched.extraBody
      })
    )

    await evaluate(
      mainClient,
      `(() => {
        window.__llm = { deltas: [], done: null, error: null }
        window.__offLlm = [
          window.smog.on('event:llm-delta', (e) => window.__llm.deltas.push(e.delta)),
          window.smog.on('event:llm-done', (e) => { window.__llm.done = e }),
          window.smog.on('event:llm-error', (e) => { window.__llm.error = e })
        ]
        return true
      })()`
    )

    await evaluate(
      mainClient,
      `window.smog.invoke('llm:ask', {
        mode: 'copilot',
        messages: [{ role: 'user', content: 'Say hello' }]
      })`
    )
    await waitFor(
      () => evaluate(mainClient, `window.__llm.done !== null || window.__llm.error !== null`),
      20000
    )
    const streamed = await evaluate(mainClient, `({ deltas: window.__llm.deltas, done: window.__llm.done, error: window.__llm.error })`)
    record(
      'chat completion streams incremental deltas',
        streamed.error === null &&
        Array.isArray(streamed.deltas) &&
        streamed.deltas.length >= 3 &&
        typeof streamed.done?.text === 'string' &&
        streamed.done.text.startsWith('## Introduction\n\nmock streamed answer #'),
      `${streamed.deltas.length} deltas, error=${JSON.stringify(streamed.error?.message ?? null)}`
    )

    const chatReq = [...mock.requests].reverse().find((r) => r.url.endsWith('/chat/completions'))
    record(
      'request carries dynamic key + model parameters',
      chatReq?.auth === 'Bearer zk-test-key' &&
        chatReq?.body?.model === 'mimov2.6' &&
        chatReq?.body?.stream === true &&
        chatReq?.body?.max_tokens === 512 &&
        chatReq?.body?.top_p === 0.9 &&
        chatReq?.body?.temperature === 0.4 &&
        chatReq?.body?.smog_probe === 'phase1b',
      JSON.stringify({
        auth: chatReq?.auth,
        model: chatReq?.body?.model,
        max_tokens: chatReq?.body?.max_tokens,
        top_p: chatReq?.body?.top_p,
        smog_probe: chatReq?.body?.smog_probe
      })
    )

    await evaluate(mainClient, `window.smog.invoke('config:set', { model: 'nostream' })`)
    await evaluate(
      mainClient,
      `(() => {
        window.__llm = { deltas: [], done: null, error: null }
        return true
      })()`
    )
    await evaluate(
      mainClient,
      `window.smog.invoke('llm:ask', {
        mode: 'copilot',
        messages: [{ role: 'user', content: 'Say hello' }]
      })`
    )
    await waitFor(
      () => evaluate(mainClient, `window.__llm.done !== null || window.__llm.error !== null`),
      20000
    )
    const fallback = await evaluate(mainClient, `({ done: window.__llm.done, error: window.__llm.error })`)
    const nostreamReqs = mock.requests.filter((r) => r.url.endsWith('/chat/completions') && r.body?.model === 'nostream')
    record(
      'stream rejection falls back to non-streaming completion',
      fallback.error === null &&
        fallback.done?.text === 'nonstream fallback answer' &&
        nostreamReqs.length === 2 &&
        nostreamReqs[0]?.body?.stream === true &&
        nostreamReqs[1]?.body?.stream === false,
      `${nostreamReqs.length} attempts for nostream model`
    )

    const sttResult = await evaluate(
      mainClient,
      `(() => {
        const rate = 16000
        const samples = rate / 4
        const bytes = new Uint8Array(44 + samples * 2)
        const view = new DataView(bytes.buffer)
        const str = (offset, text) => { for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i)) }
        str(0, 'RIFF'); view.setUint32(4, 36 + samples * 2, true); str(8, 'WAVE'); str(12, 'fmt ')
        view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true)
        view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true)
        view.setUint16(32, 2, true); view.setUint16(34, 16, true)
        str(36, 'data'); view.setUint32(40, samples * 2, true)
        for (let i = 0; i < samples; i++) view.setInt16(44 + i * 2, Math.round(Math.sin(i / 8) * 9000), true)
        return window.smog.invoke('stt:transcribe', { wav: bytes }).then((r) => r.text)
      })()`
    )
    const transcribeReq = [...mock.requests].reverse().find((r) => r.url.endsWith('/audio/transcriptions'))
    const sessionAfterStt = await evaluate(mainClient, `window.smog.invoke('session:entries')`)
    record(
      'audio chunk transcribed through /audio/transcriptions',
      sttResult === 'mock transcript' &&
        transcribeReq?.auth === 'Bearer zk-test-key' &&
        transcribeReq?.model === 'whisper-mock' &&
        sessionAfterStt.some((e) => e.role === 'speech' && e.text === 'mock transcript'),
      `text=${JSON.stringify(sttResult)}`
    )

    await evaluate(mainClient, `window.smog.invoke('config:set', { sttModel: '', model: 'mimov2.6' })`)
    const chatSttResult = await evaluate(
      mainClient,
      `(() => {
        const bytes = new Uint8Array(44 + 800)
        const view = new DataView(bytes.buffer)
        const str = (offset, text) => { for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i)) }
        str(0, 'RIFF'); view.setUint32(4, 36 + 800, true); str(8, 'WAVE'); str(12, 'fmt ')
        view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true)
        view.setUint32(24, 16000, true); view.setUint32(28, 32000, true)
        view.setUint16(32, 2, true); view.setUint16(34, 16, true)
        str(36, 'data'); view.setUint32(40, 800, true)
        return window.smog.invoke('stt:transcribe', { wav: bytes }).then((r) => r.text)
      })()`
    )
    const sessionAfterChatStt = await evaluate(mainClient, `window.smog.invoke('session:entries')`)
    record(
      'audio chunk transcribed through chat audio fallback',
      typeof chatSttResult === 'string' &&
        chatSttResult.startsWith('chat transcript #') &&
        sessionAfterChatStt.some(
          (e) => e.role === 'speech' && typeof e.text === 'string' && e.text.startsWith('chat transcript #')
        ),
      `text=${JSON.stringify(chatSttResult)} log=${JSON.stringify(
        mock.requests.map((r) => `${r.seq}|${r.url}|${r.model}|${r.content ?? '-'}`)
      )}`
    )

    const hudUi = await evaluate(
      mainClient,
      `(() => {
        const hud = {}
        for (const id of ['listen', 'vision', 'ask', 'notes', 'params']) {
          hud[id] = !!document.querySelector('[data-hud="' + id + '"]')
        }
        const cards = {}
        for (const id of ['question', 'answer', 'structure']) {
          cards[id] = !!document.querySelector('[data-card="' + id + '"]')
        }
        const bar = document.querySelector('[data-hud-bar]')
        const labels = [...document.querySelectorAll('[data-hud-bar] button')].map((b) => b.textContent.trim())
        const question = document.querySelector('[data-card="question"]')?.innerText ?? ''
        return {
          hud,
          cards,
          labels,
          position: bar ? getComputedStyle(bar).position : null,
          question
        }
      })()`
    )
    record(
      'HUD bar exposes Listen / Vision / Ask / Notes / Params',
      ['listen', 'vision', 'ask', 'notes', 'params'].every((id) => hudUi.hud[id]) &&
        hudUi.labels.length >= 5 &&
        hudUi.position === 'absolute',
      JSON.stringify(hudUi.labels)
    )
    record(
      'copilot view renders Question / Answer / Structure cards',
      hudUi.cards.question && hudUi.cards.answer && hudUi.cards.structure,
      JSON.stringify(hudUi.cards)
    )
    record(
      'question card surfaces the latest captured utterance',
      hudUi.question.includes('chat transcript #'),
      hudUi.question.slice(-50).replace(/\s+/g, ' ')
    )

    await evaluate(
      mainClient,
      `(() => {
        window.__llm = { deltas: [], done: null, error: null }
        document.querySelector('[data-hud="ask"]').click()
        return true
      })()`
    )
    await waitFor(
      () => evaluate(mainClient, `window.__llm.done !== null || window.__llm.error !== null`),
      20000
    )
    await delay(500)
    const hudAnswer = await evaluate(
      mainClient,
      `({
        error: window.__llm.error,
        text: window.__llm.done?.text ?? '',
        headings: [...document.querySelectorAll('[data-card="answer"] h2')].map((h) => h.textContent),
        sections: document.querySelectorAll('[data-card="structure"] span[title$="section detected"]').length
      })`
    )
    record(
      'HUD Ask streams a structured answer into the Answer card',
      hudAnswer.error === null &&
        hudAnswer.text.includes('## Content') &&
        hudAnswer.headings.length >= 3,
      `${hudAnswer.headings.length} headings, ${hudAnswer.text.length} chars`
    )
    record(
      'Structure card detects Introduction / Content / Conclusion',
      hudAnswer.sections >= 3,
      `${hudAnswer.sections}/3 sections`
    )
    const copilotReq = [...mock.requests]
      .reverse()
      .find((r) => r.url.endsWith('/chat/completions') && Array.isArray(r.body?.messages))
    record(
      'copilot request carries the live transcript prompt',
      copilotReq?.body?.model === 'mimov2.6' &&
        String(copilotReq?.body?.messages?.[1]?.content ?? '').includes('Live interview transcript'),
      String(copilotReq?.body?.messages?.[1]?.content ?? '').slice(0, 50).replace(/\s+/g, ' ')
    )

    await evaluate(
      mainClient,
      `(() => {
        window.__llm = { deltas: [], done: null, error: null }
        return true
      })()`
    )
    const typedSetup = await evaluate(
      mainClient,
      `(() => {
        const input = document.querySelector('[data-quick-ask-input]')
        if (!input) return { found: false }
        const desc = Object.getOwnPropertyDescriptor(input.constructor.prototype, 'value')
        desc.set.call(input, 'What is the time complexity of quicksort?')
        input.dispatchEvent(new Event('input', { bubbles: true }))
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        return { found: true }
      })()`
    )
    await waitFor(
      () => evaluate(mainClient, `window.__llm.done !== null || window.__llm.error !== null`),
      20000
    )
    const typedDone = await evaluate(mainClient, `({ done: window.__llm.done, error: window.__llm.error })`)
    const typedReqs = mock.requests.filter(
      (r) =>
        r.url.endsWith('/chat/completions') &&
        String(JSON.stringify(r.body?.messages ?? [])).includes('time complexity of quicksort')
    )
    const typedEntries = await evaluate(mainClient, `window.smog.invoke('session:entries')`)
    const typedLast = typedReqs[typedReqs.length - 1]
    record(
      'typed question asks the LLM with live transcript context',
      typedSetup.found === true &&
        typedDone.error === null &&
        typedReqs.length >= 1 &&
        String(typedLast?.body?.messages?.[1]?.content ?? '').includes('Live interview transcript') &&
        String(typedLast?.body?.messages?.[1]?.content ?? '').includes('Typed question:') &&
        typedEntries.some((e) => e.role === 'user' && e.text.includes('time complexity')),
      `${typedReqs.length} requests, userEntry=${typedEntries.some((e) => e.role === 'user')}`
    )

    await evaluate(
      mainClient,
      `(() => {
        window.__shortcuts = []
        window.smog.on('event:shortcut', (e) => window.__shortcuts.push(e))
        return true
      })()`
    )
    const pushDown = await evaluate(mainClient, `window.smog.invoke('app:triggerShortcut', { action: 'push-to-ask' })`)
    await delay(400)
    const pushFocusMain = await evaluate(mainClient, `document.activeElement?.id ?? null`)
    const pushFocusOverlay = overlayClient
      ? await evaluate(overlayClient, `document.activeElement?.id ?? null`).catch(() => null)
      : null
    const pushUp = await evaluate(
      mainClient,
      `window.smog.invoke('app:triggerShortcut', { action: 'push-to-ask', phase: 'up', heldMs: 620 })`
    )
    const pushEvents = await evaluate(mainClient, `window.__shortcuts`)
    const pushOverlayOpen = await evaluate(mainClient, `window.smog.invoke('app:state').then((s) => s.overlayOpen)`)
    const downEvent = pushEvents.find((e) => e.action === 'push-to-ask' && e.phase === 'down')
    const upEvent = pushEvents.find((e) => e.action === 'push-to-ask' && e.phase === 'up')
    record(
      'push-to-ask hold opens a focused prompt and reports hold phases',
      pushDown === true &&
        pushUp === true &&
        !!downEvent &&
        !!upEvent &&
        upEvent.heldMs === 620 &&
        pushOverlayOpen === true &&
        pushFocusMain === 'quickAsk' &&
        pushFocusOverlay === 'quickAsk',
      JSON.stringify({
        phases: pushEvents.map((e) => `${e.action}:${e.phase ?? 'sync'}:${e.heldMs ?? 0}`),
        focusMain: pushFocusMain,
        focusOverlay: pushFocusOverlay,
        overlayOpen: pushOverlayOpen
      })
    )

    await evaluate(
      mainClient,
      `(() => {
        document.querySelector('[data-hud="vision"]').click()
        return true
      })()`
    )
    await delay(800)

    let visionSnap = null
    let visionOk = true
    try {
      await waitFor(async () => {
        visionSnap = await evaluate(
          mainClient,
          `window.smog.invoke('app:state').then((st) => {
            const btn = document.querySelector('[data-hud="vision"]')
            const text = document.body.innerText
            return {
              active: !!btn && btn.className.includes('text-rose-200'),
              busy: !!btn && !!btn.querySelector('.live-dot'),
              modal: !!document.getElementById('apiKey'),
              needsSetup: st.needsSetup,
              lastError: st.lastError,
              tail: text.slice(-260)
            }
          })`
        )
        return visionSnap.active ? visionSnap : null
      }, 20000)
    } catch {
      visionOk = false
    }
    record('HUD Vision captures a screen frame', visionOk, JSON.stringify(visionSnap))

    if (visionOk) {
      await delay(400)
      await evaluate(
        mainClient,
        `(() => {
          window.__llm = { deltas: [], done: null, error: null }
          document.querySelector('[data-hud="ask"]').click()
          return true
        })()`
      )
      const visionReq = await waitFor(() => {
        const found = mock.requests.filter(
          (r) => r.url.endsWith('/chat/completions') && JSON.stringify(r.body?.messages ?? []).includes('image_url')
        )
        return found.length > 0 ? found[found.length - 1] : null
      }, 25000)
      const visionUser = visionReq.body.messages.find((m) => Array.isArray(m.content))
      const visionParts = Array.isArray(visionUser?.content) ? visionUser.content : []
      const visionText = visionParts.find((p) => p.type === 'text')?.text ?? ''
      const imageUrl = visionParts.find((p) => p.type === 'image_url')?.image_url?.url ?? ''
      record(
        'HUD Ask sends the captured frame as an image_url message',
        visionReq.body.model === 'mimov2.6' && imageUrl.startsWith('data:image/'),
        `${imageUrl.slice(0, 22)}… ${imageUrl.length} chars`
      )
      record(
        'vision prompt carries screen system prompt, frame descriptor and question',
        visionText.includes('Screen frame:') &&
          visionText.includes('Question:') &&
          String(visionReq.body.messages[0]?.content ?? '').includes('screen-context analyst'),
        visionText.slice(0, 70).replace(/\s+/g, ' ')
      )
      record(
        'vision analyzes the active window (bounding-box frame)',
        visionText.includes('active window "') || visionText.includes('display "'),
        visionText.slice(0, 90).replace(/\s+/g, ' ')
      )
      await waitFor(
        () => evaluate(mainClient, `window.__llm.done !== null || window.__llm.error !== null`),
        25000
      )
      const visionDone = await evaluate(
        mainClient,
        `({ done: window.__llm.done, error: window.__llm.error })`
      )
      record(
        'screen analysis streams into the screen answer stream',
        visionDone.error === null && (visionDone.done?.text ?? '').length > 0,
        `${visionDone.done?.text?.length ?? 0} chars`
      )
    }

    await evaluate(
      mainClient,
      `(() => {
        const tab = [...document.querySelectorAll('header button')].find((b) => b.textContent.trim() === 'Screen')
        tab?.click()
        return true
      })()`
    )
    await delay(600)
    const screenUi = await evaluate(
      mainClient,
      `({
        cards: ['question', 'answer', 'structure'].map((id) => !!document.querySelector('[data-card="' + id + '"]')),
        frame: !!document.querySelector('img[alt="Screen capture"]'),
        label: document.querySelector('[data-card="answer"] header span')?.textContent ?? '',
        displays: [...document.querySelectorAll('select option')].map((o) => o.textContent.trim()),
        age: document.body.innerText.includes('ago')
      })`
    )
    record(
      'screen tab shows captured frame with Question / Answer / Structure cards',
      screenUi.cards.every(Boolean) &&
        screenUi.frame === visionOk &&
        screenUi.label.includes('SCREEN ANALYSIS') &&
        screenUi.displays.length >= 1 &&
        screenUi.age === visionOk,
      JSON.stringify({ label: screenUi.label, displays: screenUi.displays, cards: screenUi.cards, frame: screenUi.frame, age: screenUi.age, visionOk })
    )

    const notesStart = Date.now()
    await evaluate(
      mainClient,
      `(() => {
        document.querySelector('[data-hud="notes"]').click()
        return true
      })()`
    )
    const notesState = await waitFor(async () => {
      const text = await evaluate(mainClient, `document.body.innerText`)
      if (text.includes('Notes saved')) return { ok: true, toast: true }
      const files = await evaluate(mainClient, `window.smog.invoke('notes:list')`)
      const fresh = (Array.isArray(files) ? files : []).find((f) => f.createdAt >= notesStart - 1000)
      return fresh ? { ok: true, toast: false } : null
    }, 30000)
    const noteFiles = await evaluate(mainClient, `window.smog.invoke('notes:list')`)
    const latestNote = [...(Array.isArray(noteFiles) ? noteFiles : [])].sort(
      (a, b) => b.createdAt - a.createdAt
    )[0]
    const noteBody = latestNote?.path ? await readFile(latestNote.path, 'utf8') : ''
    record(
      'HUD Notes writes markdown session notes',
      notesState.ok === true &&
        !!latestNote &&
        latestNote.name.startsWith('session-') &&
        noteBody.includes('## Introduction'),
      `${latestNote?.name ?? 'none'} · ${noteBody.length} chars`
    )

    const pdfPath = await evaluate(
      mainClient,
      `window.smog.invoke('notes:exportPdf', { content: ${JSON.stringify(noteBody)}, saveDialog: false })`
    )
    let pdfOk = false
    let pdfDetail = 'none'
    try {
      const buf = await readFile(pdfPath)
      pdfOk =
        typeof pdfPath === 'string' &&
        pdfPath.endsWith('.pdf') &&
        buf.subarray(0, 4).toString('latin1') === '%PDF' &&
        buf.length > 800
      pdfDetail = `${pdfPath} · ${buf.length} bytes`
    } catch (err) {
      pdfDetail = String(err)
    }
    record('notes export produces a standalone PDF file', pdfOk, pdfDetail)

    const mdPath = await evaluate(
      mainClient,
      `window.smog.invoke('notes:exportMarkdown', { content: ${JSON.stringify(noteBody)}, saveDialog: false })`
    )
    let mdOk = false
    let mdDetail = 'none'
    try {
      const mdBody = await readFile(mdPath, 'utf8')
      mdOk = typeof mdPath === 'string' && mdPath.endsWith('.md') && mdBody.trim() === noteBody.trim()
      mdDetail = `${mdPath} · ${mdBody.length} chars`
    } catch (err) {
      mdDetail = String(err)
    }
    record('notes export writes a Markdown file', mdOk, mdDetail)

    const overlayHud = await evaluate(
      overlayClient,
      `(() => {
        const bar = document.querySelector('[data-hud-bar]')
        return {
          bar: !!bar,
          position: bar ? getComputedStyle(bar).position : null,
          ids: [...document.querySelectorAll('[data-hud-bar] button')].map((b) => b.dataset.hud),
          cards: ['question', 'answer', 'structure'].map((id) => !!document.querySelector('[data-card="' + id + '"]'))
        }
      })()`
    )
    record(
      'overlay docks the HUD bar above compact cards',
      overlayHud.bar === true &&
        overlayHud.position === 'static' &&
        overlayHud.ids.length === 5 &&
        overlayHud.cards.every(Boolean),
      JSON.stringify(overlayHud)
    )

    await evaluate(
      mainClient,
      `(() => {
        const gear = document.querySelector('button[title="Settings"]')
        gear?.click()
        return true
      })()`
    )
    await delay(400)
    const advancedToggle = await evaluate(
      mainClient,
      `(() => {
        const toggle = [...document.querySelectorAll('button')].find((b) =>
          b.textContent.includes('Advanced model parameters')
        )
        if (!toggle) return false
        toggle.click()
        return true
      })()`
    )
    await delay(400)
    const advancedUi = await evaluate(
      mainClient,
      `({
        extraBody: document.getElementById('extraBody')?.value ?? null,
        maxTokens: document.getElementById('maxTokens')?.value ?? null,
        topP: document.getElementById('topP')?.value ?? null
      })`
    )
    record(
      'settings modal exposes advanced model parameters',
      advancedToggle === true &&
        advancedUi.extraBody === '{"smog_probe":"phase1b"}' &&
        advancedUi.maxTokens === '512' &&
        Number(advancedUi.topP) === 0.9,
      JSON.stringify(advancedUi)
    )
  } catch (err) {
    record('e2e run', false, String(err?.stack ?? err))
  } finally {
    try {
      mainClient?.close()
      overlayClient?.close()
    } catch {
    }
    proc.kill()
    await delay(1000)
    try {
      execFileSync('taskkill', ['/F', '/T', '/PID', String(proc.pid)], { stdio: 'ignore' })
    } catch {
    }
    await rm(configPath, { force: true })
    mock.server.close()
  }

  const failed = results.filter((r) => !r.ok && !r.info)
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
  process.exit(failed.length > 0 ? 1 : 0)
}

main()
