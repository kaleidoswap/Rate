/**
 * Protocol hooks for React Native screens.
 * Wraps protocolManager from shared lib for use in components.
 */

import { useCallback, useMemo } from 'react'
import { useAppDispatch, useAppSelector } from '../store/hooks'
import { setActiveProtocol } from '../store/slices/walletSlice'
import { protocolManager } from '../services/protocols'
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

/**
 * Returns which protocols are currently connected.
 */
export function useProtocolStatus(): RouteResolverAccounts {
  // This is computed live from the protocol manager
  // In a future version, this could be Redux-driven for reactivity
  return useMemo(() => {
    const rgbAdapter = protocolManager.getAdapterIfAvailable('RGB_LN')
    const sparkAdapter = protocolManager.getAdapterIfAvailable('SPARK')
    const arkadeAdapter = protocolManager.getAdapterIfAvailable('ARKADE')

    return {
      RGB: rgbAdapter?.isConnected() ?? false,
      SPARK: sparkAdapter?.isConnected() ?? false,
      ARKADE: arkadeAdapter?.isConnected() ?? false,
    }
  }, [])
}

/**
 * Returns a function to refresh protocol connection status.
 * Call this after connecting/disconnecting protocols.
 */
export function useRefreshableProtocolStatus() {
  const getStatus = useCallback((): RouteResolverAccounts => {
    const rgbAdapter = protocolManager.getAdapterIfAvailable('RGB_LN')
    const sparkAdapter = protocolManager.getAdapterIfAvailable('SPARK')
    const arkadeAdapter = protocolManager.getAdapterIfAvailable('ARKADE')

    return {
      RGB: rgbAdapter?.isConnected() ?? false,
      SPARK: sparkAdapter?.isConnected() ?? false,
      ARKADE: arkadeAdapter?.isConnected() ?? false,
    }
  }, [])

  return getStatus
}
