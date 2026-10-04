import { loadBarkHost, barkConnectionMatches, recordBarkConnection, clearBarkConnection } from './barkPreferences'
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

import { MobileSparkAdapter } from './MobileSparkAdapter'
import { ProtocolManager, networkTypeToProtocol } from '@kaleidorg/wallet-engine'
// beta.55: adapters + WDK helpers moved behind the /adapters/wdk subpath, and the
// legacy client managers behind /adapters/native (protocol SDKs are now optional peers).
import {
  registerWdkModule,
  RlnWdkAdapter,
  ArkadeWdkAdapter,
  type SparkAdapterConfig,
  type RlnAdapterConfig,
  type ArkadeAdapterConfig,
} from '@kaleidorg/wallet-engine/adapters/wdk'
import { kaleidoClientManager, flashnetClientManager } from '@kaleidorg/wallet-engine/adapters/native'
// The native Bark SDK loads lazily on connect(), not on import.
import { BarkReactNativeAdapter } from '@kaleidorg/wallet-engine/adapters/bark-react-native'
import * as SecureStore from 'expo-secure-store'
import { NwcRgbAdapter, NWC_CONNECTION_KEY } from '../nwc/NwcRgbAdapter'
import type { ProtocolType } from '@kaleidorg/wallet-engine'
import { buildArkadeStorage } from './arkadeStorage'
import { getDefaultArkadeServerUrl, resolveSparkNetwork } from './networkConfig'
import { BARK_ENABLED, buildBarkConfig, isBarkNativeAvailable } from './bark'
import { connectBarkToKaleidoPay, disconnectBarkFromKaleidoPay } from '../kaleidoPay/bark'
import { setPayOptions, type PayOptions } from '../kaleidoPay/payOptions'

/** The maker URL from the RGB config and Arkade's server URL, for Send's payment accounts. */
export function payOptionsFrom(networkConfigs: Array<{ type: string; enabled: boolean; config?: string }>): PayOptions {
  const out: PayOptions = {}
  for (const nc of networkConfigs) {
    if (!nc.enabled) continue
    let parsed: any = {}
    try { parsed = nc.config ? JSON.parse(nc.config) : {} } catch { continue }
    const protocol = networkTypeToProtocol(nc.type as any)
    if (protocol === 'RGB_LN' && (parsed.makerUrl || parsed.baseUrl)) out.makerUrl = parsed.makerUrl || parsed.baseUrl
    if (protocol === 'ARKADE') out.arkServerUrl = parsed.arkServerUrl || getDefaultArkadeServerUrl(parsed.network || 'signet')
  }
  return out
}

/**
 * Mobile rollout gates.
 * - Spark + RLN + the (pure-JS) swap module: no WASM, SDKs the app already ships — always on.
 * - Arkade: ON by default. Uses @arkade-os/wdk over @arkade-os/sdk (RN-compatible; the
 *   manager defaults to in-memory VTXO repositories — no IndexedDB). Persistent VTXO
 *   state needs SQLite repos injected via arkadeConfig.storage (follow-up). Lightning
 *   (Boltz) needs swapProviderUrl. Disable with EXPO_PUBLIC_WDK_ARKADE=0.
 * - Bark: ON by default. Second's Ark via the native `@secondts/bark-react-native`
 *   SDK (needs a dev build). Not a wallet NetworkType yet, so it connects from
 *   the saved wallet preference with ./bark.ts defaults. Disable with EXPO_PUBLIC_BARK=0.
 */
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
    _wdkManager.registerAdapter(new MobileSparkAdapter())
    // RGB: NWC-backed (remote node over relays) by default on mobile; HTTP WDK
    // adapter when EXPO_PUBLIC_RGB_VIA_NWC=0.
    if (RGB_VIA_NWC) {
      _wdkManager.registerAdapter(new NwcRgbAdapter())
    } else {
      _wdkManager.registerAdapter(new RlnWdkAdapter())
    }
    // Liquid is not part of the app: its native library alone was ~175 MB of the APK.
    // Wallets saved with a Liquid network skip it (no LIQUID case below).
    if (ARKADE_ENABLED) _wdkManager.registerAdapter(new ArkadeWdkAdapter())
    if (BARK_ENABLED) _wdkManager.registerAdapter(new BarkReactNativeAdapter({ runtime: { now: () => Date.now() } }))
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
  // Send's ways to pay need the maker (configured with the RGB node) and Arkade's server.
  setPayOptions(payOptionsFrom(networkConfigs))

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
            network: resolveSparkNetwork(parsed.network),
          } as SparkAdapterConfig
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
              ...(parsed.arkadeConfig || {}),
              // mutinynet.arkade.sh is the live signet/mutinynet Ark server;
              // signet.arkade.sh is deprecated and silently fails to board/receive
              // (matches rate-extension's ARKADE_SERVER_URLS.signet).
              arkServerUrl: parsed.arkServerUrl || getDefaultArkadeServerUrl(arkadeNetwork),
              esploraUrl: parsed.esploraUrl,
              ...(arkadeStorage ? { storage: arkadeStorage } : {}),
            },
          } as ArkadeAdapterConfig
          break
        }

        case 'RGB_LN': {
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
              protocol: 'RGB_LN',
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
            protocol: 'RGB_LN',
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
      if (protocol === 'RGB_LN') {
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
            const sparkNetwork = (config as SparkAdapterConfig).network || 'regtest'
            if (sparkNetwork === 'mainnet' || sparkNetwork === 'regtest') {
              await flashnetClientManager.initialize(sparkWallet, sparkNetwork)
              console.log(`[initializeWdkProtocols] flashnet (Spark DEX) initialized (${sparkNetwork})`)
            } else {
              console.log(`[initializeWdkProtocols] flashnet disabled on Spark ${sparkNetwork}`)
            }
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

  if (BARK_ENABLED) await connectBark(manager, mnemonic, results)

  return results
}

/**
 * Bark restores a wallet-scoped preference, falling back to host config on first use.
 * Same per-protocol contract as the loop above: record the outcome, never throw.
 */
let barkConnecting: Promise<void> | null = null

async function connectBark(
  manager: ProtocolManager,
  mnemonic: string,
  results: Map<ProtocolType, { success: boolean; error?: string }>,
): Promise<void> {
  // Initializations can overlap; a second open of Bark's data directory fails.
  if (barkConnecting) {
    await barkConnecting
    return connectBark(manager, mnemonic, results)
  }
  barkConnecting = connectBarkOnce(manager, mnemonic, results).finally(() => { barkConnecting = null })
  return barkConnecting
}

async function connectBarkOnce(
  manager: ProtocolManager,
  mnemonic: string,
  results: Map<ProtocolType, { success: boolean; error?: string }>,
): Promise<void> {
  try {
    const host = await loadBarkHost(mnemonic)
    if (!host) throw new Error('Bark network is not configured.')
    const existing = manager.getAdapterIfAvailable('BARK')
    if (existing?.isConnected() && barkConnectionMatches(mnemonic, host)) {
      connectBarkToKaleidoPay(existing, host.network)
      results.set('BARK', { success: true })
      return
    }
    if (!isBarkNativeAvailable()) {
      results.set('BARK', { success: false, error: 'This app build does not include Bark. Install a native build with Bark support.' })
      return
    }
    disconnectBarkFromKaleidoPay()
    if (existing?.isConnected()) await manager.disconnect('BARK')
    clearBarkConnection()
    const config = buildBarkConfig(mnemonic, host)
    if (!config) {
      results.set('BARK', { success: false, error: 'skipped: no Bark server/esplora configured' })
      return
    }
    await manager.connect('BARK', config)
    recordBarkConnection(mnemonic, host)
    // KaleidoPay pays bitcoin addresses from the Bark balance through Electrum swap providers.
    connectBarkToKaleidoPay(manager.getAdapter('BARK'), config.network ?? 'signet')
    results.set('BARK', { success: true })
    console.log(`[initializeWdkProtocols] BARK connected (${config.network}, ${config.createIfMissing ? 'created' : 'opened'})`)
  } catch (error: unknown) {
    disconnectBarkFromKaleidoPay()
    // Engine errors are already scrubbed of seed/config material.
    const msg = error instanceof Error ? error.message : String(error)
    console.error('[initializeWdkProtocols] BARK failed:', msg)
    results.set('BARK', { success: false, error: msg })
  }
}
