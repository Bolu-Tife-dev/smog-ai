import { app, globalShortcut } from 'electron'
import type { ShortcutAction } from '@shared/types'

export const SHORTCUT_ACCELERATORS: Record<ShortcutAction, string> = {
  'stealth-overlay': 'CommandOrControl+Shift+H',
  'screen-scan': 'CommandOrControl+Shift+V',
  'auto-pilot': 'CommandOrControl+Shift+A'
}

export type ShortcutHandlers = Record<ShortcutAction, () => void>

let registered: ShortcutAction[] = []

export function registerShortcuts(handlers: ShortcutHandlers): ShortcutAction[] {
  unregisterShortcuts()
  registered = []
  for (const action of Object.keys(SHORTCUT_ACCELERATORS) as ShortcutAction[]) {
    const accelerator = SHORTCUT_ACCELERATORS[action]
    try {
      const ok = globalShortcut.register(accelerator, () => {
        try {
          handlers[action]()
        } catch (err) {
          console.warn(`[smog-ai] shortcut ${action} failed:`, err)
        }
      })
      if (ok) registered.push(action)
      else console.warn(`[smog-ai] shortcut ${accelerator} for ${action} is unavailable`)
    } catch (err) {
      console.warn(`[smog-ai] could not register ${accelerator}:`, err)
    }
  }
  return registered
}

export function unregisterShortcuts(): void {
  try {
    globalShortcut.unregisterAll()
  } catch (err) {
    console.warn('[smog-ai] shortcut cleanup failed:', err)
  }
  registered = []
}

export function registeredShortcuts(): ShortcutAction[] {
  return [...registered]
}

export function installShortcutCleanup(): void {
  app.on('will-quit', () => unregisterShortcuts())
}
