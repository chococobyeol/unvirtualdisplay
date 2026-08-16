import type { UnvirtualApi } from '../../shared/types'

declare global {
  interface Window {
    unvirtual: UnvirtualApi
  }
}

export {}
