import { contextBridge, ipcRenderer } from 'electron'
import type { EventChannel, IpcChannel, SmogApi } from '@shared/types'

const api: SmogApi = {
  invoke<T>(channel: IpcChannel, payload?: unknown): Promise<T> {
    return ipcRenderer.invoke(`smog:${channel}`, payload) as Promise<T>
  },
  on<T>(channel: EventChannel, listener: (data: T) => void): () => void {
    const handler = (_event: Electron.IpcRendererEvent, data: T): void => listener(data)
    ipcRenderer.on(`smog:${channel}`, handler)
    return () => ipcRenderer.removeListener(`smog:${channel}`, handler)
  },
  getPlatform(): string {
    return process.platform
  }
}

contextBridge.exposeInMainWorld('smog', api)
