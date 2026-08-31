/**
 * Protocol Layer — KaleidoSwap App Entry Point (WDK engine)
 * ---------------------------------------------------------
 * Mobile uses the WDK-backed adapters EXCLUSIVELY (see ./wdk.ts). The legacy
 * native adapters + their SDK-factory wiring have been removed.
 *
 * Default enabled protocols: Spark + RLN (no WASM). Liquid/Arkade are opt-in via
 * EXPO_PUBLIC_WDK_LIQUID=1 / EXPO_PUBLIC_WDK_ARKADE=1 (see ./wdk.ts).
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

export function getProtocolManager(): ProtocolManager {
  return getWdkProtocolManager()
}

export const protocolManager = getProtocolManager()

/**
 * Initialize protocols from the active wallet's network configs (WDK engine).
 */
export async function initializeProtocols(
  mnemonic: string,
  networkConfigs: Array<{ type: string; enabled: boolean; config?: string }>,
): Promise<Map<ProtocolType, { success: boolean; error?: string }>> {
  return initializeWdkProtocols(mnemonic, networkConfigs)
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
