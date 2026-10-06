import { BrowserWindow, screen, shell } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'
import type { DockEdge, PublicConfig } from '@shared/types'
import { protectNewWindow } from './stealth'

const DOCK_MARGIN = 12

let mainWindow: BrowserWindow | null = null
let overlayWindow: BrowserWindow | null = null
let hudWindow: BrowserWindow | null = null

function resolvePreload(): string {
  const candidates = ['index.js', 'index.mjs', 'index.cjs', 'index.js.bundled']
  for (const name of candidates) {
    const path = join(__dirname, '../preload', name)
    if (existsSync(path)) return path
  }
  throw new Error('Preload bundle not found in out/preload')
}

function commonWebPreferences(): Electron.WebPreferences {
  return {
    preload: resolvePreload(),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: false,
    spellcheck: false,
    devTools: true
  }
}

function overlayFlags(): Electron.BrowserWindowConstructorOptions {
  return {
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    skipTaskbar: true,
    hiddenInMissionControl: true,
    autoHideMenuBar: true,
    alwaysOnTop: true,
    fullscreenable: false
  }
}

function showInactive(win: BrowserWindow): void {
  if (win.isDestroyed()) return
  if (!win.isVisible()) {
    win.showInactive()
    return
  }
  win.moveTop()
  win.setAlwaysOnTop(true, 'screen-saver')
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
}

export function getOverlayWindow(): BrowserWindow | null {
  return overlayWindow && !overlayWindow.isDestroyed() ? overlayWindow : null
}

export function getHudWindow(): BrowserWindow | null {
  return hudWindow && !hudWindow.isDestroyed() ? hudWindow : null
}

export function allWindows(): BrowserWindow[] {
  return [mainWindow, overlayWindow, hudWindow].filter(
    (w): w is BrowserWindow => !!w && !w.isDestroyed()
  )
}

export function createMainWindow(config: PublicConfig): BrowserWindow {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    autoHideMenuBar: true,
    title: 'Smog AI',
    alwaysOnTop: config.alwaysOnTop,
    webPreferences: commonWebPreferences()
  })

  protectNewWindow(mainWindow)
  mainWindow.on('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  const filter = (url: string): void => {
    if (!url.startsWith('file://') && !url.startsWith('http://localhost') && !url.startsWith('data:')) {
      shell.openExternal(url)
    }
  }
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    filter(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const devUrl = process.env['ELECTRON_RENDERER_URL']
    if (url.startsWith('file://') || (devUrl && url.startsWith(devUrl))) return
    event.preventDefault()
    filter(url)
  })

  loadRenderer(mainWindow)
  return mainWindow
}

export function createOverlayWindow(): BrowserWindow {
  overlayWindow = new BrowserWindow({
    width: 440,
    height: 600,
    minWidth: 320,
    minHeight: 260,
    show: false,
    resizable: true,
    maximizable: false,
    title: 'Smog AI Overlay',
    ...overlayFlags(),
    webPreferences: commonWebPreferences()
  })

  overlayWindow.setAlwaysOnTop(true, 'screen-saver')
  protectNewWindow(overlayWindow)
  overlayWindow.on('ready-to-show', () => {
    if (overlayWindow) showInactive(overlayWindow)
  })
  overlayWindow.on('closed', () => {
    overlayWindow = null
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    void overlayWindow.loadURL(`${devUrl}/index.html?window=overlay`)
  } else {
    void overlayWindow.loadFile(join(__dirname, '../renderer/index.html'), {
      query: { window: 'overlay' }
    })
  }
  return overlayWindow
}

export function createHudWindow(): BrowserWindow {
  const area = screen.getPrimaryDisplay().workArea
  hudWindow = new BrowserWindow({
    width: 520,
    height: 66,
    x: Math.round(area.x + (area.width - 520) / 2),
    y: area.y + area.height - 66 - DOCK_MARGIN,
    show: false,
    resizable: false,
    movable: true,
    focusable: false,
    maximizable: false,
    minimizable: false,
    title: 'Smog AI HUD',
    ...overlayFlags(),
    webPreferences: commonWebPreferences()
  })

  hudWindow.setAlwaysOnTop(true, 'screen-saver')
  if (process.platform === 'darwin') hudWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  protectNewWindow(hudWindow)
  hudWindow.on('ready-to-show', () => {
    if (hudWindow) showInactive(hudWindow)
  })
  hudWindow.on('closed', () => {
    hudWindow = null
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    void hudWindow.loadURL(`${devUrl}/index.html?window=hud`)
  } else {
    void hudWindow.loadFile(join(__dirname, '../renderer/index.html'), {
      query: { window: 'hud' }
    })
  }
  return hudWindow
}

function loadRenderer(win: BrowserWindow): void {
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    void win.loadURL(`${devUrl}/index.html`)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

export function toggleOverlay(open?: boolean): boolean {
  const current = getOverlayWindow()
  const shouldOpen = open ?? !current
  if (shouldOpen) {
    if (current) {
      showInactive(current)
      return true
    }
    createOverlayWindow()
    return true
  }
  if (current) {
    current.close()
    overlayWindow = null
  }
  return false
}

export function toggleHud(open?: boolean): boolean {
  const current = getHudWindow()
  const shouldOpen = open ?? !current
  if (shouldOpen) {
    if (current) {
      showInactive(current)
      return true
    }
    createHudWindow()
    return true
  }
  if (current) {
    current.close()
    hudWindow = null
  }
  return false
}

function displayFor(win: BrowserWindow): Electron.Display {
  const bounds = win.getBounds()
  const center = { x: bounds.x + Math.round(bounds.width / 2), y: bounds.y + Math.round(bounds.height / 2) }
  return screen.getDisplayNearestPoint(center)
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), Math.max(min, max))

export function moveWindowTo(win: BrowserWindow | null, x: number, y: number): { x: number; y: number } {
  if (!win || win.isDestroyed()) return { x, y }
  const area = displayFor(win).workArea
  const bounds = win.getBounds()
  const next = {
    x: clamp(Math.round(x), area.x - bounds.width + 80, area.x + area.width - 80),
    y: clamp(Math.round(y), area.y, area.y + area.height - 24)
  }
  win.setPosition(next.x, next.y, false)
  return next
}

export function dockWindow(win: BrowserWindow | null, edge: DockEdge): DockEdge {
  if (!win || win.isDestroyed()) return 'auto'
  const area = displayFor(win).workArea
  const bounds = win.getBounds()
  const distances: Record<'left' | 'right' | 'top' | 'bottom', number> = {
    left: bounds.x - area.x,
    right: area.x + area.width - (bounds.x + bounds.width),
    top: bounds.y - area.y,
    bottom: area.y + area.height - (bounds.y + bounds.height)
  }
  let chosen: 'left' | 'right' | 'top' | 'bottom' | 'center' =
    edge === 'auto'
      ? (Object.keys(distances) as Array<keyof typeof distances>).reduce((best, key) =>
          distances[key] < distances[best] ? key : best
        )
      : edge

  const maxX = area.x + area.width - bounds.width - DOCK_MARGIN
  const maxY = area.y + area.height - bounds.height - DOCK_MARGIN
  let x = bounds.x
  let y = bounds.y

  if (chosen === 'left') {
    x = area.x + DOCK_MARGIN
    y = clamp(y, area.y + DOCK_MARGIN, maxY)
  } else if (chosen === 'right') {
    x = maxX
    y = clamp(y, area.y + DOCK_MARGIN, maxY)
  } else if (chosen === 'top') {
    y = area.y + DOCK_MARGIN
    x = clamp(x, area.x + DOCK_MARGIN, maxX)
  } else if (chosen === 'bottom') {
    y = maxY
    x = clamp(x, area.x + DOCK_MARGIN, maxX)
  } else {
    x = Math.round(area.x + (area.width - bounds.width) / 2)
    y = maxY
  }

  win.setPosition(Math.round(x), Math.round(y), false)
  return chosen
}

export function focusMainWindow(): void {
  const win = getMainWindow()
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}
