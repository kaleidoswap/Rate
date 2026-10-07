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
import { getWdkProtocolManager, initializeWdkProtocols, switchRgbL1Network, syncRgbOnDevice, type RgbL1ConnectOptions } from './wdk'
import type { RgbL1Network } from './rgbL1'
import { chooseRgbBacking, isRgbNode } from './rgbAccount'
import DatabaseService from '../DatabaseService'
import { setRgbBacking, type RgbBacking } from '../../utils/protocol-bridge'

export function getProtocolManager(): ProtocolManager {
  return getWdkProtocolManager()
}

export const protocolManager = getProtocolManager()

/** True when an RGB Lightning Node (not a plain Lightning wallet) is connected. */
export function rgbNodeConnected(): boolean {
  return isRgbNode(protocolManager.getAdapterIfAvailable('RGB_LN') as any)
}

/**
 * The RGB account's engine protocol: the paired RGB node when connected, else
 * RGB on this phone when connected, else the node (so "not connected" reads right).
 */
export function rgbAccountProtocol(): RgbBacking {
  return chooseRgbBacking(rgbNodeConnected(), !!protocolManager.getAdapterIfAvailable('RGB_L1')?.isConnected())
}
setRgbBacking(rgbAccountProtocol)

/**
 * Re-checks RGB on this phone for the active wallet after the RGB node changed
 * (connected, removed or switched): the two are never the RGB account together.
 */
export async function reconcileRgbOnDevice(
  opts: RgbL1ConnectOptions = {},
): Promise<{ success: boolean; error?: string } | undefined> {
  const wallet = await DatabaseService.getInstance().getActiveWallet()
  if (!wallet?.encrypted_mnemonic) return undefined
  return syncRgbOnDevice(wallet.encrypted_mnemonic, opts)
}

/** Switches the active wallet's RGB on this phone to `network`'s own RGB wallet. */
export async function switchRgbOnDeviceNetwork(
  network: RgbL1Network,
): Promise<{ success: boolean; error?: string } | undefined> {
  const wallet = await DatabaseService.getInstance().getActiveWallet()
  if (!wallet?.encrypted_mnemonic) return { success: false, error: 'Unlock your active wallet first.' }
  return switchRgbL1Network(wallet.encrypted_mnemonic, network)
}

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
