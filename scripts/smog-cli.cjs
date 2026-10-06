#!/usr/bin/env node
const { spawn, spawnSync } = require('child_process')
const { existsSync, readdirSync } = require('fs')
const path = require('path')
const os = require('os')

const root = path.resolve(__dirname, '..')
const releaseDir = path.join(root, 'release')
const configPath = path.join(os.homedir(), '.config', 'smog-ai', 'config.json')

const USAGE = [
  'Smog AI — real-time interview copilot',
  '',
  'Usage:',
  '  smog-ai                 Launch the app (packaged build when available)',
  '  smog-ai --config        Show config path and setup status',
  '  smog-ai --help          Show this help',
  '',
  'First-run setup:',
  '  1. Launch the app — the settings modal opens automatically',
  '  2. Paste your OpenCode Zen API key (OPENCODE_ZEN_API_KEY, starts with "zk-")',
  '  3. Set the model to mimov2.6 (LLM_MODEL_NAME)',
  '  4. Save — the key is encrypted into ~/.config/smog-ai/config.json',
  '',
  'Package installers from source:  npm run package'
].join('\n')

function findPackagedBinary() {
  if (process.platform === 'win32') {
    const candidates = [
      path.join(releaseDir, 'win-unpacked', 'Smog AI.exe'),
      path.join(releaseDir, 'win-arm64-unpacked', 'Smog AI.exe')
    ]
    return candidates.find((file) => existsSync(file)) ?? null
  }
  if (process.platform === 'darwin') {
    const app = path.join(releaseDir, 'mac', 'Smog AI.app', 'Contents', 'MacOS', 'Smog AI')
    return existsSync(app) ? app : null
  }
  const dir = path.join(releaseDir, 'linux-unpacked')
  if (!existsSync(dir)) return null
  const match = readdirSync(dir).find((name) => !name.endsWith('.so') && !name.includes('.pak'))
  return match ? path.join(dir, match) : null
}

function showConfig() {
  console.log(`config file : ${configPath}`)
  console.log(`exists      : ${existsSync(configPath) ? 'yes' : 'no'}`)
  if (existsSync(configPath)) {
    const raw = require('fs').readFileSync(configPath, 'utf8')
    const encoding = /"encoding"\s*:\s*"([^"]+)"/.exec(raw)?.[1] ?? 'unknown'
    console.log(`encoding    : ${encoding}`)
  } else {
    console.log('status      : not configured — launch the app and fill in the settings modal')
  }
}

function launch() {
  const binary = findPackagedBinary()
  if (binary) {
    console.log(`launching packaged app: ${binary}`)
    const child = spawn(binary, [], { stdio: 'inherit', detached: process.platform !== 'win32' })
    child.on('error', (err) => {
      console.error(`failed to launch packaged app: ${err.message}`)
      process.exit(1)
    })
    return
  }
  const electron = path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'electron.cmd' : 'electron')
  if (!existsSync(electron)) {
    console.error('No packaged build found and Electron is not installed.')
    console.error('Run `npm install && npm run package` first.')
    process.exit(1)
  }
  console.log('no packaged build found — launching from source with Electron')
  const child = spawnSync(electron, [root], { stdio: 'inherit' })
  process.exit(child.status ?? 0)
}

const arg = process.argv[2]
if (arg === '--help' || arg === '-h') console.log(USAGE)
else if (arg === '--config' || arg === '-c') showConfig()
else if (arg === undefined) launch()
else {
  console.error(`unknown option: ${arg}`)
  console.log(USAGE)
  process.exit(1)
}
