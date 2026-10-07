import { app, globalShortcut } from 'electron'
import type { ShortcutAction, ShortcutFire } from '@shared/types'

export const SHORTCUT_ACCELERATORS: Record<ShortcutAction, string> = {
  'stealth-overlay': 'CommandOrControl+Shift+H',
  'screen-scan': 'CommandOrControl+Shift+V',
  'auto-pilot': 'CommandOrControl+Shift+A',
  'push-to-ask': 'CommandOrControl+Alt+Space'
}

export type ShortcutHandlers = Record<ShortcutAction, (fire?: ShortcutFire) => void>

const PUSH_RELEASE_MS = 240

let registered: ShortcutAction[] = []
let pushTimer: ReturnType<typeof setTimeout> | null = null
let pushDownAt = 0
let pushDownEmitted = false

function clearPushTimer(): void {
  if (pushTimer) clearTimeout(pushTimer)
  pushTimer = null
  pushDownEmitted = false
}

function firePush(handlers: ShortcutHandlers, phase: 'down' | 'up'): void {
  const heldMs = phase === 'up' ? Math.max(0, Date.now() - pushDownAt) : 0
  try {
    handlers['push-to-ask']({ phase, heldMs })
  } catch (err) {
    console.warn('[smog-ai] push-to-ask shortcut failed:', err)
  }
}

export function registerShortcuts(handlers: ShortcutHandlers): ShortcutAction[] {
  unregisterShortcuts()
  registered = []
  for (const action of Object.keys(SHORTCUT_ACCELERATORS) as ShortcutAction[]) {
    const accelerator = SHORTCUT_ACCELERATORS[action]
    try {
      const ok = globalShortcut.register(accelerator, () => {
        if (action === 'push-to-ask') {
          if (!pushDownEmitted) {
            pushDownEmitted = true
            pushDownAt = Date.now()
            firePush(handlers, 'down')
          }
          clearPushTimerOnce()
          pushTimer = setTimeout(() => {
            clearPushTimer()
            firePush(handlers, 'up')
          }, PUSH_RELEASE_MS)
          return
        }
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

function clearPushTimerOnce(): void {
  if (pushTimer) {
    clearTimeout(pushTimer)
    pushTimer = null
  }
}

export function unregisterShortcuts(): void {
  try {
    globalShortcut.unregisterAll()
  } catch (err) {
    console.warn('[smog-ai] shortcut cleanup failed:', err)
  }
  clearPushTimer()
  registered = []
}

export function registeredShortcuts(): ShortcutAction[] {
  return [...registered]
}

export function installShortcutCleanup(): void {
  app.on('will-quit', () => unregisterShortcuts())
}
