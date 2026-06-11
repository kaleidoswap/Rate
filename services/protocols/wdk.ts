/**
 * WDK Protocol Wiring — KaleidoSwap App
 * -------------------------------------
 * Parallel to ./index.ts (native adapters), this wires the WDK-backed adapters
 * (@kaleidorg/wallet-engine `*WdkAdapter`) into a ProtocolManager.
 *
 * Two RN-specific concerns are handled here:
 *  1. Module loading: WDK adapters call `loadWdkModule()`, which we satisfy with a
 *     STATIC `require()` per package (Metro can't follow dynamic import of these).
 *     Each require is guarded so missing modules just disable that protocol.
 *  2. Config shapes: builds each adapter's config from the wallet's NetworkConfig.
 *
 * This is the sole wallet engine on mobile (native adapters removed from ./index.ts).
 */

import {
  ProtocolManager,
  registerWdkModule,
  SparkWdkAdapter,
  LiquidWdkAdapter,
  RlnWdkAdapter,
  ArkadeWdkAdapter,
  networkTypeToProtocol,
  kaleidoClientManager,
  flashnetClientManager,
} from '@kaleidorg/wallet-engine'
import * as SecureStore from 'expo-secure-store'
import { NwcRgbAdapter, NWC_CONNECTION_KEY } from '../nwc/NwcRgbAdapter'
import type {
  ProtocolType,
  SparkAdapterConfig,
  LiquidAdapterConfig,
  RlnAdapterConfig,
  ArkadeAdapterConfig,
} from '@kaleidorg/wallet-engine'
import { buildArkadeStorage } from './arkadeStorage'

/**
 * Mobile rollout gates.
 * - Spark + RLN + the (pure-JS) swap module: no WASM, SDKs the app already ships — always on.
 * - Liquid: ON by default. Uses the native `lwk-rn` binding (UniFFI→JSI, no WASM) via the
 *   `react-native` condition of @kaleidorg/wdk-wallet-liquid's `#lwk` map. The adapter loads
 *   lazily (only when a Liquid network connects), and `lwk-rn` needs a native build
 *   (expo prebuild / pod-install). Disable with EXPO_PUBLIC_WDK_LIQUID=0.
 * - Arkade: ON by default. Uses @arkade-os/wdk over @arkade-os/sdk (RN-compatible; the
 *   manager defaults to in-memory VTXO repositories — no IndexedDB). Persistent VTXO
 *   state needs SQLite repos injected via arkadeConfig.storage (follow-up). Lightning
 *   (Boltz) needs swapProviderUrl. Disable with EXPO_PUBLIC_WDK_ARKADE=0.
 */
const LIQUID_ENABLED = process.env.EXPO_PUBLIC_WDK_LIQUID !== '0'
const ARKADE_ENABLED = process.env.EXPO_PUBLIC_WDK_ARKADE !== '0'
// On mobile, RLN/RGB is reached over Nostr Wallet Connect by default (the app
// drives a remote node via an NWC connection string instead of a direct HTTP
// nodeUrl). Set EXPO_PUBLIC_RGB_VIA_NWC=0 to use the HTTP WDK RLN adapter.
const RGB_VIA_NWC = process.env.EXPO_PUBLIC_RGB_VIA_NWC !== '0'

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
    // RGB: NWC-backed (remote node over relays) by default on mobile; HTTP WDK
    // adapter when EXPO_PUBLIC_RGB_VIA_NWC=0.
    if (RGB_VIA_NWC) {
      _wdkManager.registerAdapter(new NwcRgbAdapter())
    } else {
      _wdkManager.registerAdapter(new RlnWdkAdapter())
    }
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
            // Default Spark to regtest (test network); changeable per-account.
            network: parsed.network || 'regtest',
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

        case 'ARKADE': {
          const arkadeNetwork = parsed.network || 'signet'
          // Persist VTXO state across restarts via SQLite; falls back to in-memory
          // (storage left unset) if SQLite/expo-sqlite are unavailable.
          const arkadeStorage = buildArkadeStorage({
            network: arkadeNetwork,
            accountIndex: parsed.accountIndex,
          })
          console.log(
            `[initializeWdkProtocols] ARKADE storage: ${arkadeStorage ? 'persistent (SQLite)' : 'in-memory'}`,
          )
          config = {
            protocol: 'ARKADE',
            mnemonic,
            network: arkadeNetwork,
            arkadeConfig: {
              // mutinynet.arkade.sh is the live signet/mutinynet Ark server;
              // signet.arkade.sh is deprecated and silently fails to board/receive
              // (matches rate-extension's ARKADE_SERVER_URLS.signet).
              arkServerUrl: parsed.arkServerUrl
                || (arkadeNetwork === 'mainnet' ? 'https://arkade.computer' : 'https://mutinynet.arkade.sh'),
              esploraUrl: parsed.esploraUrl,
              ...(parsed.arkadeConfig || {}),
              ...(arkadeStorage ? { storage: arkadeStorage } : {}),
            },
          } as ArkadeAdapterConfig
          break
        }

        case 'RGB': {
          // NWC mode (default on mobile): the NwcRgbAdapter drives a remote node over
          // relays and reads its connection string from SecureStore — no HTTP nodeUrl.
          if (RGB_VIA_NWC) {
            // No paired node yet → soft-skip instead of letting connect() throw, so a
            // fresh wallet doesn't log a scary ERROR for an expected unconfigured state
            // (mirrors the HTTP "no node URL configured" skip below).
            const nwcUri = await SecureStore.getItemAsync(NWC_CONNECTION_KEY)
            if (!nwcUri) {
              results.set(protocol, { success: false, error: 'skipped: no NWC connection string configured' })
              continue
            }
            config = {
              protocol: 'RGB',
              mnemonic,
              network: parsed.network || 'regtest',
            } as RlnAdapterConfig
            break
          }
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

      // Restore the maker/RLN HTTP client for the swap UI (screens/SwapScreen.tsx uses
      // kaleidoClientManager.getClient().maker/.rln directly). Pure HTTP — no SparkWallet.
      // NOTE: flashnet (Spark DEX) still needs the SparkWallet exposed from the WDK Spark
      // adapter — tracked gap; AMM swaps stay disabled until then.
      if (protocol === 'RGB') {
        const makerBaseUrl = parsed.makerUrl || parsed.baseUrl
        if (makerBaseUrl) {
          try {
            kaleidoClientManager.initialize({
              baseUrl: makerBaseUrl,
              nodeUrl: (config as RlnAdapterConfig).nodeUrl,
              apiKey: parsed.apiKey,
            })
            console.log('[initializeWdkProtocols] maker client initialized for swaps')
          } catch (e) {
            console.warn('[initializeWdkProtocols] maker client init failed:', e)
          }
        } else {
          console.log('[initializeWdkProtocols] no makerUrl configured → maker swaps disabled')
        }
      }

      // Restore flashnet (Spark DEX / AMM) by feeding it the SparkWallet the WDK Spark
      // adapter already holds. SwapScreen skips flashnet gracefully if this isn't set.
      if (protocol === 'SPARK') {
        try {
          const sparkAdapter = manager.getAdapterIfAvailable('SPARK') as any
          const sparkWallet = sparkAdapter?.getUnderlyingSparkWallet?.()
          if (sparkWallet) {
            await flashnetClientManager.initialize(sparkWallet, parsed.network || 'MAINNET')
            console.log('[initializeWdkProtocols] flashnet (Spark DEX) initialized')
          } else {
            console.log('[initializeWdkProtocols] no SparkWallet exposed → flashnet disabled')
          }
        } catch (e) {
          console.warn('[initializeWdkProtocols] flashnet init failed:', e)
        }
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      console.error(`[initializeWdkProtocols] ${protocol} failed:`, msg)
      results.set(protocol, { success: false, error: msg })
    }
  }

  return results
}
