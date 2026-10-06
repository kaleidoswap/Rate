import { coalesceInFlight } from '../../utils/coalesce-in-flight'
/**
 * Protocol Layer — KaleidoSwap App Entry Point (WDK engine)
 * ---------------------------------------------------------
 * Mobile uses the WDK-backed adapters EXCLUSIVELY (see ./wdk.ts). The legacy
 * native adapters + their SDK-factory wiring have been removed.
 *
 * Enabled protocols: Spark, RGB (NWC node, or rgb-lib on this phone), Arkade and Bark
 * (see ./wdk.ts for the flags).
 *
 * NOTE: the `*ClientManager` singletons re-exported below are still referenced by
 * the swap UI (screens/SwapScreen.tsx). They are NO LONGER initialized here (that
 * used to happen via the native adapters), so the swap path needs migration to the
 * WDK swap wrapper (@kaleidorg/wallet-engine → KaleidoswapSwap) + a Spark-DEX
 * (flashnet) story. Tracked as a known gap.
 */

import { ProtocolManager } from '@kaleidorg/wallet-engine'
import type { ProtocolType } from '@kaleidorg/wallet-engine'
import { getWdkProtocolManager, initializeWdkProtocols } from './wdk'
import { setRgbBacking, type RgbBacking } from '../../utils/protocol-bridge'

export function getProtocolManager(): ProtocolManager {
  return getWdkProtocolManager()
}

export const protocolManager = getProtocolManager()

/**
 * The RGB account's engine protocol: the paired RGB node when connected, else
 * RGB on this phone when connected, else the node (so "not connected" reads right).
 */
export function rgbAccountProtocol(): RgbBacking {
  if (protocolManager.getAdapterIfAvailable('RGB_LN')?.isConnected()) return 'RGB_LN'
  if (protocolManager.getAdapterIfAvailable('RGB_L1')?.isConnected()) return 'RGB_L1'
  return 'RGB_LN'
}
setRgbBacking(rgbAccountProtocol)

/** The adapter behind the RGB account (see rgbAccountProtocol). */
export function rgbAccountAdapter() {
  return protocolManager.getAdapterIfAvailable(rgbAccountProtocol())
}

/** True when the RGB account is the on-device rgb-lib wallet: on-chain only, no Lightning. */
export function rgbAccountIsOnDevice(): boolean {
  return rgbAccountProtocol() === 'RGB_L1'
}

/**
 * Initialize protocols from the active wallet's network configs (WDK engine).
 */
const initializeOnce = coalesceInFlight(initializeWdkProtocols)

export async function initializeProtocols(
  mnemonic: string,
  networkConfigs: Array<{ type: string; enabled: boolean; config?: string }>,
): Promise<Map<ProtocolType, { success: boolean; error?: string }>> {
  return initializeOnce(mnemonic, networkConfigs)
}

// Re-export everything consumers need from the shared lib.
export type { ProtocolType, IProtocolAdapter, SparkConfig, ArkadeConfig, RgbConfig } from '@kaleidorg/wallet-engine'
export { ProtocolManager } from '@kaleidorg/wallet-engine'
// beta.55: the legacy client managers moved behind the /adapters/native subpath
// (protocol SDKs are now optional peers; the root barrel is SDK-free).
export {
  kaleidoClientManager,
  flashnetClientManager,
  sparkClientManager,
  arkadeClientManager,
} from '@kaleidorg/wallet-engine/adapters/native'
