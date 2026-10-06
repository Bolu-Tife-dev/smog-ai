import { BrowserWindow, app } from 'electron'

let stealthEnabled = false

export function isStealthEnabled(): boolean {
  return stealthEnabled
}

export function setStealthEnabled(enabled: boolean): void {
  stealthEnabled = !!enabled
}

export function applyStealth(win: BrowserWindow | null, enabled: boolean): void {
  if (!win || win.isDestroyed()) return
  try {
    win.setContentProtection(!!enabled)
  } catch (err) {
    console.warn('[smog-ai] stealth toggle failed:', err)
  }
}

export function applyStealthAll(windows: Array<BrowserWindow | null>, enabled: boolean): void {
  setStealthEnabled(enabled)
  for (const win of windows) applyStealth(win, enabled)
}

export function protectNewWindow(win: BrowserWindow): void {
  if (!stealthEnabled) return
  applyStealth(win, true)
}

export function installWindowProtection(): void {
  app.on('browser-window-created', (_event, win) => {
    if (!stealthEnabled) return
    const attach = (): void => applyStealth(win, true)
    attach()
    win.webContents.once('dom-ready', attach)
  })
}
