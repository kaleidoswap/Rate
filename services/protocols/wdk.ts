import { loadBarkHost, barkConnectionMatches, recordBarkConnection, clearBarkConnection, isBarkOff } from './barkPreferences'
import { withPaymentProofs } from '../paymentProofs'
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
  RgbLibWdkAdapter,
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
import {
  RGB_L1_ENABLED, RGB_L1_NETWORKS, RGB_L1_NETWORK_LABEL, RGB_L1_UPDATE_TO_SWITCH, buildRgbL1Config, claimRgbL1DataFolder, isRgbLibNativeAvailable,
  isRgbL1NetworkSwitchSupported, isRgbL1Ready, loadRgbL1Network, loadRgbL1Host, markRgbL1Ready, rgbL1Restorer, saveRgbL1Network, type RgbL1Network,
} from './rgbL1'
import { createRgbLibRnModule } from './rgbLibRn'
import { findRgbCloudBackup, restoreRgbFromCloud, runRgbBackup, scheduleRgbBackup, setRgbBackupContext } from './rgbBackup'
import { isRgbNode, rgbOnDeviceStep } from './rgbAccount'

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
 *   goes through Arkade Intents swaps (services/kaleidoPay/arkadeIntents.ts).
 *   Disable with EXPO_PUBLIC_WDK_ARKADE=0.
 * - Bark: ON by default. Second's Ark via the native `@secondts/bark-react-native`
 *   SDK (needs a dev build). Not a wallet NetworkType yet, so it connects from
 *   the saved wallet preference with ./bark.ts defaults. Disable with EXPO_PUBLIC_BARK=0.
 * - RGB on this phone (RGB_L1): native rgb-lib through `react-native-rgb`, opt-in per
 *   wallet (./rgbL1.ts). Connects only when no RGB node is connected: the node is the
 *   RGB account when paired (a plain Lightning wallet over NWC is not an RGB node). Disable with EXPO_PUBLIC_RGB_L1=0.
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
  // The engine's RGB_L1 adapter loads the WDK rgb module; on the phone that is native
  // rgb-lib behind the same surface (./rgbLibRn.ts), required only on connect.
  if (RGB_L1_ENABLED) {
    // Every change (send, receive, settle) schedules the automatic cloud backup.
    registerWdkModule('@utexo/wdk-wallet-rgb', () => createRgbLibRnModule(() => require('react-native-rgb'), { onChange: scheduleRgbBackup }))
  }
}

let _wdkManager: ProtocolManager | null = null

export function getWdkProtocolManager(): ProtocolManager {
  if (!_wdkManager) {
    registerWdkModuleLoaders()
    _wdkManager = new ProtocolManager()
    const manager = _wdkManager
    // Every Lightning payment's preimage is kept for Activity, whichever screen paid.
    const register = (adapter: any) => manager.registerAdapter(withPaymentProofs(adapter))
    // Spark + RLN: no WASM, SDKs already shipped — always on.
    register(new MobileSparkAdapter())
    // RGB: NWC-backed (remote node over relays) by default on mobile; HTTP WDK
    // adapter when EXPO_PUBLIC_RGB_VIA_NWC=0.
    if (RGB_VIA_NWC) {
      register(new NwcRgbAdapter())
    } else {
      register(new RlnWdkAdapter())
    }
    // Liquid is not part of the app: its native library alone was ~175 MB of the APK.
    // Wallets saved with a Liquid network skip it (no LIQUID case below).
    if (ARKADE_ENABLED) register(new ArkadeWdkAdapter())
    if (BARK_ENABLED) register(new BarkReactNativeAdapter({ runtime: { now: () => Date.now() } }))
    if (RGB_L1_ENABLED) register(new RgbLibWdkAdapter())
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

  const connectNetwork = async (protocol: ProtocolType, nc: { type: string; enabled: boolean; config?: string }): Promise<void> => {
    const existing = manager.getAdapterIfAvailable(protocol)
    if (existing?.isConnected()) {
      results.set(protocol, { success: true })
      return
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
              return
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
            return
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
          return
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
              // Swaps only: off the startup path so balances don't wait on it.
              void Promise.resolve()
                .then(() => flashnetClientManager.initialize(sparkWallet, sparkNetwork))
                .then(() => console.log(`[initializeWdkProtocols] flashnet (Spark DEX) initialized (${sparkNetwork})`))
                .catch((e: unknown) => console.warn('[initializeWdkProtocols] flashnet init failed:', e))
            } else {
              console.log(`[initializeWdkProtocols] flashnet disabled on Spark ${sparkNetwork}`)
            }
          } else {
            console.log('[initializeWdkProtocols] no SparkWallet exposed → flashnet disabled')
          }
        } catch (e) {
          console.warn('[initializeWdkProtocols] flashnet init failed:', e)
        }
        // Bitcoin sent to a Spark deposit address only counts once it's claimed.
        // Receive claims the address on screen; this catches deposits confirmed
        // while the app was closed. Background, best effort.
        const sweeper = manager.getAdapterIfAvailable('SPARK') as any
        if (typeof sweeper?.sweepSparkL1Deposits === 'function') {
          void sweeper.sweepSparkL1Deposits()
            .then((r: { claimedTxids?: string[] }) => { if (r?.claimedTxids?.length) console.log(`[initializeWdkProtocols] claimed ${r.claimedTxids.length} Spark deposit(s)`) })
            .catch((e: unknown) => console.warn('[initializeWdkProtocols] Spark deposit sweep failed:', e))
        }
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      console.error(`[initializeWdkProtocols] ${protocol} failed:`, msg)
      results.set(protocol, { success: false, error: msg })
    }
  }

  // Each account connects on its own, in parallel: startup waits on the slowest one,
  // not the sum. Configs for the same protocol still try in order.
  const configsByProtocol = new Map<ProtocolType, Array<{ type: string; enabled: boolean; config?: string }>>()
  for (const nc of networkConfigs) {
    if (!nc.enabled) continue
    const protocol = networkTypeToProtocol(nc.type as any)
    if (!protocol) continue
    configsByProtocol.set(protocol, [...(configsByProtocol.get(protocol) ?? []), nc])
  }
  const jobs = new Map<ProtocolType, Promise<void>>()
  for (const [protocol, configs] of configsByProtocol) {
    jobs.set(protocol, (async () => {
      for (const nc of configs) {
        await connectNetwork(protocol, nc)
        if (results.get(protocol)?.success) return
      }
    })())
  }

  const pending: Array<Promise<void>> = [...jobs.values()]
  if (BARK_ENABLED) pending.push(connectBark(manager, mnemonic, results))
  // RGB on this phone yields to a connected RGB node, so it decides after the node settles.
  if (RGB_L1_ENABLED) pending.push((jobs.get('RGB_LN') ?? Promise.resolve()).then(() => connectRgbL1(manager, mnemonic, results)))
  await Promise.allSettled(pending)

  return results
}

/**
 * RGB on this phone, when the wallet turned it on and no RGB node is connected.
 * Same per-protocol contract as the loop above: record the outcome, never throw.
 * Calls run one at a time: two opens of rgb-lib's data folder would collide.
 */
let rgbL1Queue: Promise<void> = Promise.resolve()
/** The network the connected RGB_L1 wallet is on. */
let rgbL1ConnectedNetwork: RgbL1Network | null = null

export interface RgbL1ConnectOptions {
  /**
   * Skip the first-start cloud restore: the caller already restored the data or
   * asked the user to start without it (Settings).
   */
  skipCloudRestore?: boolean
}

function connectRgbL1(
  manager: ProtocolManager,
  mnemonic: string,
  results: Map<ProtocolType, { success: boolean; error?: string }>,
  opts: RgbL1ConnectOptions = {},
): Promise<void> {
  return queueRgbL1(() => connectRgbL1Once(manager, mnemonic, results, opts))
}

function queueRgbL1(task: () => Promise<void>): Promise<void> {
  const run = rgbL1Queue.then(task)
  rgbL1Queue = run.catch(() => undefined)
  return run
}

async function releaseRgbL1(manager: ProtocolManager): Promise<void> {
  setRgbBackupContext(null)
  rgbL1ConnectedNetwork = null
  if (manager.getAdapterIfAvailable('RGB_L1')?.isConnected()) await manager.disconnect('RGB_L1')
}

/**
 * Switches RGB on this phone to `network`'s own RGB wallet: backs up and closes
 * the current one, saves the choice, then starts the other one the usual way
 * (restoring its cloud backup on its first start here). Never throws.
 */
export async function switchRgbL1Network(
  mnemonic: string,
  network: RgbL1Network,
): Promise<{ success: boolean; error?: string } | undefined> {
  if (!RGB_L1_ENABLED) return { success: false, error: 'skipped: RGB on this phone is not part of this build' }
  if (!isRgbL1NetworkSwitchSupported()) return { success: false, error: RGB_L1_UPDATE_TO_SWITCH }
  const manager = getWdkProtocolManager()
  const results = new Map<ProtocolType, { success: boolean; error?: string }>()
  try {
    await queueRgbL1(async () => {
      if (rgbL1ConnectedNetwork !== network) {
        await runRgbBackup() // upload anything not backed up yet before closing it
        await releaseRgbL1(manager)
      }
      await saveRgbL1Network(mnemonic, network)
      await connectRgbL1Once(manager, mnemonic, results, {})
    })
  } catch (error: unknown) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
  return results.get('RGB_L1')
}

/**
 * Brings RGB on this phone in line with the wallet's choice and the RGB node:
 * starts it, keeps it, or releases it while an RGB node is the RGB account.
 * Call after the node connects, disconnects or switches, and from Settings.
 */
export async function syncRgbOnDevice(
  mnemonic: string,
  opts: RgbL1ConnectOptions = {},
): Promise<{ success: boolean; error?: string } | undefined> {
  if (!RGB_L1_ENABLED) return { success: false, error: 'skipped: RGB on this phone is not part of this build' }
  const results = new Map<ProtocolType, { success: boolean; error?: string }>()
  await connectRgbL1(getWdkProtocolManager(), mnemonic, results, opts)
  return results.get('RGB_L1')
}

async function connectRgbL1Once(
  manager: ProtocolManager,
  mnemonic: string,
  results: Map<ProtocolType, { success: boolean; error?: string }>,
  opts: RgbL1ConnectOptions,
): Promise<void> {
  try {
    let existing = manager.getAdapterIfAvailable('RGB_L1')
    const network = await loadRgbL1Network(mnemonic)
    if (network && existing?.isConnected() && rgbL1ConnectedNetwork && rgbL1ConnectedNetwork !== network) {
      // Another network was chosen: close this one, then start that network's wallet.
      await releaseRgbL1(manager)
      existing = manager.getAdapterIfAvailable('RGB_L1')
    }
    const nodeIsRgb = isRgbNode(manager.getAdapterIfAvailable('RGB_LN') as any)
    const step = rgbOnDeviceStep({ enabled: !!network, nodeIsRgb, connected: !!existing?.isConnected() })
    if (step === 'release' || !network) {
      // Turned off, or an RGB node is the RGB account: release the local wallet.
      await releaseRgbL1(manager)
      if (network && nodeIsRgb) results.set('RGB_L1', { success: false, error: 'skipped: your RGB Lightning Node is the RGB account' })
      return
    }
    if (step === 'keep') {
      setRgbBackupContext({ mnemonic, network, account: () => (manager.getAdapterIfAvailable('RGB_L1') as any)?.account ?? null })
      results.set('RGB_L1', { success: true })
      return
    }
    if (!isRgbLibNativeAvailable()) {
      results.set('RGB_L1', { success: false, error: 'This app build does not include RGB. Install a newer build.' })
      return
    }
    if (!opts.skipCloudRestore && !(await isRgbL1Ready(mnemonic, network))) {
      // First start on this phone: bring the RGB data back from the cloud backup first.
      // If that can't be checked, don't start an empty wallet that would back up over it.
      let restored: string
      try {
        restored = await restoreRgbFromCloud({ mnemonic, network, restore: rgbL1Restorer(mnemonic, network) })
        console.log(`[initializeWdkProtocols] RGB_L1 cloud restore: ${restored}`)
      } catch (e: unknown) {
        const why = e instanceof Error ? e.message : String(e)
        results.set('RGB_L1', { success: false, error: `Couldn't restore your RGB backup (${why}). Check your connection and try again.` })
        return
      }
      // Nothing on this network, but a backup on another one: on a build that can't
      // switch, don't fix this wallet to an empty network; let the user pick in Settings › RGB.
      if (restored === 'no-backup' && !isRgbL1NetworkSwitchSupported()) {
        const elsewhere = await backupOnOtherNetwork(mnemonic, network)
        if (elsewhere) {
          results.set('RGB_L1', { success: false, error: `Your RGB backup is on ${RGB_L1_NETWORK_LABEL[elsewhere]}. Choose its network in Settings › RGB to restore it.` })
          return
        }
      }
    }
    const folder = await claimRgbL1DataFolder(mnemonic, network)
    await manager.connect('RGB_L1', buildRgbL1Config(mnemonic, await loadRgbL1Host(mnemonic, network), folder) as any)
    rgbL1ConnectedNetwork = network
    await markRgbL1Ready(mnemonic, network)
    setRgbBackupContext({ mnemonic, network, account: () => (manager.getAdapterIfAvailable('RGB_L1') as any)?.account ?? null })
    void runRgbBackup() // catch up on anything that changed since the last upload
    results.set('RGB_L1', { success: true })
    console.log(`[initializeWdkProtocols] RGB_L1 connected (${network})`)
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('[initializeWdkProtocols] RGB_L1 failed:', msg)
    results.set('RGB_L1', { success: false, error: msg })
  }
}

/** Another network with a cloud backup for this seed, best effort (a failed check is "none"). */
async function backupOnOtherNetwork(mnemonic: string, network: RgbL1Network): Promise<RgbL1Network | null> {
  for (const other of RGB_L1_NETWORKS) {
    if (other === network) continue
    try {
      if (await findRgbCloudBackup(mnemonic, other)) return other
    } catch { /* unreachable: don't block the start on another network's check */ }
  }
  return null
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
    const existing = manager.getAdapterIfAvailable('BARK')
    if (await isBarkOff(mnemonic)) {
      // Turned off for this wallet: release it if it was running.
      disconnectBarkFromKaleidoPay()
      if (existing?.isConnected()) await manager.disconnect('BARK')
      clearBarkConnection()
      results.set('BARK', { success: false, error: 'skipped: Bark is off for this wallet' })
      return
    }
    const host = await loadBarkHost(mnemonic)
    if (!host) throw new Error('Bark network is not configured.')
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
