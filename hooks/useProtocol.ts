/**
 * Protocol hooks for React Native screens.
 * Wraps protocolManager from shared lib for use in components.
 */

import { useCallback } from 'react'
import { useAppDispatch, useAppSelector } from '../store/hooks'
import { setActiveProtocol } from '../store/slices/walletSlice'
import { protocolManager, rgbAccountAdapter } from '../services/protocols'
import type { ProtocolType } from '../services/protocols'
import type { RouteResolverAccounts } from '../utils/account-routing'

/**
 * Returns the singleton protocolManager.
 */
export function useProtocolManager() {
  return protocolManager
}

/**
 * Active protocol state + setter.
 */
export function useActiveProtocol() {
  const dispatch = useAppDispatch()
  const activeProtocol = useAppSelector(state => state.wallet.activeProtocol)

  const setProtocol = useCallback(async (protocol: ProtocolType) => {
    await protocolManager.setActiveProtocol(protocol)
    dispatch(setActiveProtocol(protocol))
  }, [dispatch])

  return { activeProtocol, setProtocol }
}

/** Read current connections instead of retaining a mount-time snapshot. */
function readProtocolStatus(): RouteResolverAccounts {
  return {
    RGB: rgbAccountAdapter()?.isConnected() ?? false,
    SPARK: protocolManager.getAdapterIfAvailable('SPARK')?.isConnected() ?? false,
    ARKADE: protocolManager.getAdapterIfAvailable('ARKADE')?.isConnected() ?? false,
    BARK: protocolManager.getAdapterIfAvailable('BARK')?.isConnected() ?? false,
  }
}

export function useProtocolStatus(): RouteResolverAccounts {
  return readProtocolStatus()
}

/** Call after connecting or disconnecting protocols to read current status. */
export function useRefreshableProtocolStatus() {
  return useCallback(readProtocolStatus, [])
}
