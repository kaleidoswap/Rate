/**
 * Bark hook for React Native screens.
 * Reads the BARK adapter's native backend for Bark-specific detail (recovery state,
 * categorized balance) that the generic adapter surface flattens. Not Redux-backed
 * yet: callers refresh explicitly, mirroring Bark's manual-sync model.
 */

import { useCallback, useState } from 'react'
import type { BarkBalance, BarkReactNativeAdapter } from '@kaleidorg/wallet-engine/adapters/bark-react-native'
import type { BarkWalletInfo } from '@kaleidorg/wallet-engine'
import { protocolManager } from '../services/protocols'
import { BARK_ENABLED } from '../services/protocols/bark'

export interface BarkState {
  enabled: boolean
  connected: boolean
  info: BarkWalletInfo | null
  balance: BarkBalance | null
  loading: boolean
  error: string | null
}

function connectedBarkAdapter(): BarkReactNativeAdapter | null {
  const adapter = protocolManager.getAdapterIfAvailable('BARK') as BarkReactNativeAdapter | undefined
  return adapter?.isConnected() ? adapter : null
}

export function useBark() {
  const [state, setState] = useState<BarkState>(() => ({
    enabled: BARK_ENABLED,
    connected: connectedBarkAdapter() !== null,
    info: null,
    balance: null,
    loading: false,
    error: null,
  }))

  /** Reads info + balance. Pass `{ sync: true }` to progress pending Bark operations first. */
  const refresh = useCallback(async (opts: { sync?: boolean } = {}) => {
    const adapter = connectedBarkAdapter()
    if (!adapter) {
      setState(s => ({ ...s, connected: false }))
      return
    }
    setState(s => ({ ...s, loading: true, error: null }))
    try {
      if (opts.sync) await adapter.refreshBalances()
      const [info, balance] = await Promise.all([adapter.backend.getWalletInfo(), adapter.backend.getBalance()])
      setState(s => ({ ...s, connected: true, info, balance, loading: false }))
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Bark refresh failed'
      setState(s => ({ ...s, loading: false, error: message }))
    }
  }, [])

  return { ...state, refresh }
}
