import { app, BrowserWindow, desktopCapturer, session } from 'electron'
import { ConfigStore } from './config'
import { IpcRuntime } from './ipc'
import { Session } from './session'
import { installShortcutCleanup } from './shortcuts'
import { installWindowProtection, setStealthEnabled } from './stealth'
import { getMainWindow } from './windows'

const gotLock = app.requestSingleInstanceLock()

function installDisplayMediaHandler(): void {
  try {
    session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
      void desktopCapturer
        .getSources({ types: ['screen'], fetchWindowIcons: false })
        .then((sources) => {
          const source = sources[0]
          if (!source) {
            callback({})
            return
          }
          if (process.platform === 'win32') callback({ video: source, audio: 'loopback' })
          else callback({ video: source })
        })
        .catch(() => callback({}))
    })
  } catch (err) {
    console.warn('[smog-ai] display media handler unavailable:', err)
  }
}

if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = getMainWindow()
    if (win) {
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
    }
  })

  app.whenReady().then(() => {
    const store = new ConfigStore()
    const sessionStore = new Session()
    setStealthEnabled(store.get().stealth)
    installWindowProtection()
    installDisplayMediaHandler()
    installShortcutCleanup()

    const runtime = new IpcRuntime(store, sessionStore)
    runtime.boot(store.public())

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) runtime.boot(store.public())
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('web-contents-created', (_event, contents) => {
    contents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//i.test(url)) void import('electron').then(({ shell }) => shell.openExternal(url))
      return { action: 'deny' }
    })
  })
}
