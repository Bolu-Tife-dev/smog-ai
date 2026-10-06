import type { SmogApi } from '@shared/types'

declare global {
  interface Window {
    smog: SmogApi
  }
}

export {}
