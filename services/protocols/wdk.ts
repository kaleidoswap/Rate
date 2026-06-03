/**
 * WDK Protocol Wiring — KaleidoSwap App
 * -------------------------------------
 * Parallel to ./index.ts (native adapters), this wires the WDK-backed adapters
 * (@kaleidorg/wallet-protocols `*WdkAdapter`) into a ProtocolManager.
 *
 * Two RN-specific concerns are handled here:
 *  1. Module loading: WDK adapters call `loadWdkModule()`, which we satisfy with a
 *     STATIC `require()` per package (Metro can't follow dynamic import of these).
 *     Each require is guarded so missing modules just disable that protocol.
 *  2. Config shapes: builds each adapter's config from the wallet's NetworkConfig.
 *
 * Enabled via EXPO_PUBLIC_WALLET_ENGINE=wdk (see ./index.ts). Default stays native.
 */

import {
  ProtocolManager,
  registerWdkModule,
  SparkWdkAdapter,
  LiquidWdkAdapter,
  RlnWdkAdapter,
  ArkadeWdkAdapter,
  networkTypeToProtocol,
} from '@kaleidorg/wallet-protocols'
import type {
  ProtocolType,
  SparkAdapterConfig,
  LiquidAdapterConfig,
  RlnAdapterConfig,
  ArkadeAdapterConfig,
} from '@kaleidorg/wallet-protocols'

/**
 * Mobile rollout gates. Spark + RLN + the (pure-JS) swap module need NO WASM and
 * use SDKs the app already ships — they're on by default. Liquid (lwk WASM/native)
 * and Arkade are opt-in: leaving their `require()` out of the default build means
 * Metro never bundles lwk_wasm/lwk_node, so a Spark+RLN wallet is WASM-free end to end.
 * Enable per-protocol once their on-device story is validated:
 *   EXPO_PUBLIC_WDK_LIQUID=1   EXPO_PUBLIC_WDK_ARKADE=1
 */
const LIQUID_ENABLED = process.env.EXPO_PUBLIC_WDK_LIQUID === '1'
const ARKADE_ENABLED = process.env.EXPO_PUBLIC_WDK_ARKADE === '1'

/**
 * Register static-require loaders for each enabled WDK package (Metro can't follow
 * dynamic import of these). Loaders are LAZY: the require() runs only when an adapter
 * connects. A missing/unresolvable module surfaces as a connect() error for just that
 * protocol (caught per-protocol in initializeWdkProtocols).
 */
function registerWdkModuleLoaders(): void {
  registerWdkModule('@tetherto/wdk-wallet-spark', () => require('@tetherto/wdk-wallet-spark'))
  registerWdkModule('@kaleidorg/wdk-wallet-rln', () => require('@kaleidorg/wdk-wallet-rln'))
  registerWdkModule('@kaleidorg/wdk-protocol-swap-kaleidoswap', () =>
    require('@kaleidorg/wdk-protocol-swap-kaleidoswap'),
  )
  if (LIQUID_ENABLED) {
    registerWdkModule('@kaleidorg/wdk-wallet-liquid', () => require('@kaleidorg/wdk-wallet-liquid'))
  }
  if (ARKADE_ENABLED) {
    registerWdkModule('@arkade-os/wdk', () => require('@arkade-os/wdk'))
  }
}

let _wdkManager: ProtocolManager | null = null

export function getWdkProtocolManager(): ProtocolManager {
  if (!_wdkManager) {
    registerWdkModuleLoaders()
    _wdkManager = new ProtocolManager()
    // Spark + RLN: no WASM, SDKs already shipped — always on.
    _wdkManager.registerAdapter(new SparkWdkAdapter())
    _wdkManager.registerAdapter(new RlnWdkAdapter())
    // Liquid / Arkade: opt-in (see flags above) so the default build stays WASM-free.
    if (LIQUID_ENABLED) _wdkManager.registerAdapter(new LiquidWdkAdapter())
    if (ARKADE_ENABLED) _wdkManager.registerAdapter(new ArkadeWdkAdapter())
  }
  return _wdkManager
}

/**
 * Connect the enabled WDK protocols from the wallet's network configs.
 * Mirrors initializeProtocols() in ./index.ts but produces WDK adapter configs.
 */
export async function initializeWdkProtocols(
  mnemonic: string,
  networkConfigs: Array<{ type: string; enabled: boolean; config?: string }>,
): Promise<Map<ProtocolType, { success: boolean; error?: string }>> {
  const manager = getWdkProtocolManager()
  const results = new Map<ProtocolType, { success: boolean; error?: string }>()

  for (const nc of networkConfigs) {
    if (!nc.enabled) continue
    const protocol = networkTypeToProtocol(nc.type as any)
    if (!protocol) continue

    const existing = manager.getAdapterIfAvailable(protocol)
    if (existing?.isConnected()) {
      results.set(protocol, { success: true })
      continue
    }

    try {
      const parsed = nc.config ? JSON.parse(nc.config) : {}
      let config: any

      switch (protocol) {
        case 'SPARK':
          config = {
            protocol: 'SPARK',
            mnemonic,
            network: parsed.network || 'mainnet',
          } as SparkAdapterConfig
          break

        case 'LIQUID':
          config = {
            protocol: 'LIQUID',
            mnemonic,
            network: parsed.network || 'mainnet',
            esploraUrl: parsed.esploraUrl,
          } as LiquidAdapterConfig
          break

        case 'ARKADE':
          config = {
            protocol: 'ARKADE',
            mnemonic,
            network: parsed.network || 'signet',
            arkadeConfig: {
              arkServerUrl: parsed.arkServerUrl || 'https://signet.arkade.sh',
              esploraUrl: parsed.esploraUrl,
              ...(parsed.arkadeConfig || {}),
            },
          } as ArkadeAdapterConfig
          break

        case 'RGB': {
          const nodeUrl =
            parsed.type === 'remote' ? parsed.url : parsed.nodeUrl || 'http://127.0.0.1:3000'
          if (!nodeUrl) {
            results.set(protocol, { success: false, error: 'skipped: no node URL configured' })
            continue
          }
          config = {
            protocol: 'RGB',
            mnemonic,
            nodeUrl,
            network: parsed.network || 'regtest',
          } as RlnAdapterConfig
          break
        }

        default:
          continue
      }

      await manager.connect(protocol, config)
      results.set(protocol, { success: true })
      console.log(`[initializeWdkProtocols] ${protocol} connected`)
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      console.error(`[initializeWdkProtocols] ${protocol} failed:`, msg)
      results.set(protocol, { success: false, error: msg })
    }
  }

  return results
}
