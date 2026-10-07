/**
 * RGB on this phone — KaleidoSwap App
 * -----------------------------------
 * Host config for the engine's `RgbLibWdkAdapter` (protocol RGB_L1), backed by
 * native rgb-lib through ./rgbLibRn.ts. The app's RGB account is either your
 * RGB Lightning node (paired over NWC) or this on-device wallet; the node wins
 * when both are available (see utils/protocol-bridge.ts).
 *
 * Runs on mainnet (the default, like the wallet's other accounts) or Mutinynet,
 * switchable: each network is a separate RGB wallet with its own balances,
 * ready flag and cloud backup. rgb-lib names a wallet's folder after the seed,
 * not the network, so the network a seed first started on keeps the original
 * folder and every other network gets a folder of its own (`rgbL1DataFolder`).
 * A native build without that support keeps the old rule: one network per seed.
 * RGB state can't be rebuilt from the seed alone: ./rgbBackup.ts uploads
 * rgb-lib's encrypted backup to VSS after every change.
 * Disable entirely with EXPO_PUBLIC_RGB_L1=0.
 */
import { TurboModuleRegistry } from 'react-native'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'
import DatabaseService from '../DatabaseService'

export const RGB_L1_ENABLED = process.env.EXPO_PUBLIC_RGB_L1 !== '0'

/** OTA/JS updates may run on a native build that predates rgb-lib. */
export function isRgbLibNativeAvailable(): boolean {
  return !!TurboModuleRegistry?.get('Rgb')
}

/**
 * Whether the native module can open a wallet in a folder of its own (the
 * patched react-native-rgb). Without it a seed's RGB stays on one network.
 */
export function isRgbL1NetworkSwitchSupported(): boolean {
  if (!isRgbLibNativeAvailable()) return false
  try {
    return require('react-native-rgb').supportsSubdir?.() === true
  } catch {
    return false
  }
}

export const RGB_L1_UPDATE_TO_SWITCH = 'Update the app to switch networks.'

export type RgbL1Network = 'mainnet' | 'mutinynet'
export const RGB_L1_NETWORKS: readonly RgbL1Network[] = ['mainnet', 'mutinynet']
/** What a new wallet uses, matching its Spark and Arkade accounts. */
export const RGB_L1_DEFAULT_NETWORK: RgbL1Network = 'mainnet'
export const RGB_L1_NETWORK_LABEL: Record<RgbL1Network, string> = { mainnet: 'Mainnet', mutinynet: 'Mutinynet' }

export interface RgbL1Host {
  network: RgbL1Network
  /** Esplora indexer for the chain. */
  indexerUrl: string
  /** RGB proxy that relays consignments between sender and receiver. */
  transportEndpoint: string
}

// EXPO_PUBLIC_* vars are inlined at build time only on direct member access.
const DEFAULTS: Record<RgbL1Network, RgbL1Host> = {
  mainnet: {
    network: 'mainnet',
    indexerUrl: process.env.EXPO_PUBLIC_RGB_L1_MAINNET_INDEXER_URL || 'https://blockstream.info/api',
    transportEndpoint: process.env.EXPO_PUBLIC_RGB_L1_MAINNET_PROXY_ENDPOINT || 'rpcs://proxy.iriswallet.com/0.2/json-rpc',
  },
  mutinynet: {
    network: 'mutinynet',
    // KaleidoSwap's Esplora for Mutinynet (KaleidoSwap's signet).
    indexerUrl: process.env.EXPO_PUBLIC_RGB_L1_INDEXER_URL || 'https://esplora.signet.kaleidoswap.com',
    transportEndpoint: process.env.EXPO_PUBLIC_RGB_L1_PROXY_ENDPOINT || 'rpcs://proxy.iriswallet.com/0.2/json-rpc',
  },
}

export function rgbL1Host(network: RgbL1Network): RgbL1Host {
  return DEFAULTS[network]
}

const endpointsKey = (mnemonic: string, network: RgbL1Network) => `rgb-l1-endpoints-v1-${network}-${rgbL1WalletKey(mnemonic)}`

/** The wallet's endpoints: its own indexer/proxy when set in Settings, else the network defaults. */
export async function loadRgbL1Host(mnemonic: string, network: RgbL1Network): Promise<RgbL1Host> {
  const saved = await DatabaseService.getInstance().getSetting(endpointsKey(mnemonic, network))
  let custom: Partial<RgbL1Host> = {}
  try { custom = saved ? JSON.parse(saved) : {} } catch { /* a bad value falls back to the defaults */ }
  return {
    ...DEFAULTS[network],
    ...(custom.indexerUrl ? { indexerUrl: custom.indexerUrl } : {}),
    ...(custom.transportEndpoint ? { transportEndpoint: custom.transportEndpoint } : {}),
  }
}

/** An Esplora indexer is https; an RGB proxy is rpcs:// (or https://) — plain http only for a local test setup. */
export function validateRgbEndpoint(kind: 'indexer' | 'proxy', value: string): string {
  const v = value.trim()
  const schemes = kind === 'indexer' ? ['https:', 'http:'] : ['rpcs:', 'rpc:', 'https:', 'http:']
  let url: URL
  try { url = new URL(v) } catch { throw new Error(`Enter a valid ${kind === 'indexer' ? 'indexer' : 'proxy'} URL.`) }
  if (!schemes.includes(url.protocol)) throw new Error(`The ${kind} URL must start with ${schemes.map((p) => `${p}//`).join(' or ')}.`)
  return v.replace(/\/+$/, '')
}

/** Saves this wallet's endpoints; null clears them back to the network defaults. */
export async function saveRgbL1Endpoints(mnemonic: string, network: RgbL1Network, endpoints: { indexerUrl: string; transportEndpoint: string } | null): Promise<void> {
  const value = endpoints
    ? JSON.stringify({ indexerUrl: validateRgbEndpoint('indexer', endpoints.indexerUrl), transportEndpoint: validateRgbEndpoint('proxy', endpoints.transportEndpoint) })
    : ''
  await DatabaseService.getInstance().setSetting(endpointsKey(mnemonic, network), value)
}

/** Non-secret per-seed key, so one phone with several wallets keeps separate choices. */
export function rgbL1WalletKey(mnemonic: string): string {
  return bytesToHex(sha256(utf8ToBytes(`kaleidoswap/rgb-l1/v1:${mnemonic.trim()}`))).slice(0, 32)
}

const settingKey = (mnemonic: string) => `rgb-l1-network-v1-${rgbL1WalletKey(mnemonic)}`
const pinnedKey = (mnemonic: string) => `rgb-l1-pinned-network-v1-${rgbL1WalletKey(mnemonic)}`
const homeKey = (mnemonic: string) => `rgb-l1-home-network-v1-${rgbL1WalletKey(mnemonic)}`
const readyKey = (mnemonic: string, network: RgbL1Network) => `rgb-l1-ready-v1-${network}-${rgbL1WalletKey(mnemonic)}`
const isNetwork = (v: string | null | undefined): v is RgbL1Network => !!v && (RGB_L1_NETWORKS as readonly string[]).includes(v)

/**
 * The network last chosen for this wallet's RGB on this phone (it stays set
 * when RGB on this phone is turned off again).
 */
export async function pinnedRgbL1Network(mnemonic: string): Promise<RgbL1Network | null> {
  const db = DatabaseService.getInstance()
  const pinned = await db.getSetting(pinnedKey(mnemonic))
  if (isNetwork(pinned)) return pinned
  // Turned on before networks were pinned: that was Mutinynet.
  const current = await db.getSetting(settingKey(mnemonic))
  return isNetwork(current) ? current : null
}

/** The network this wallet runs RGB on, or null when RGB on this phone is off. */
export async function loadRgbL1Network(mnemonic: string): Promise<RgbL1Network | null> {
  if (!RGB_L1_ENABLED) return null
  const saved = await DatabaseService.getInstance().getSetting(settingKey(mnemonic))
  return isNetwork(saved) ? saved : null
}

/**
 * The network whose RGB data is in rgb-lib's original folder for this seed: the
 * first one it started on here. Never changes once set, so data never moves.
 * Wallets from before it was saved: the pinned network if it started, else
 * whichever network did.
 */
export async function rgbL1HomeNetwork(mnemonic: string): Promise<RgbL1Network | null> {
  const saved = await DatabaseService.getInstance().getSetting(homeKey(mnemonic))
  if (isNetwork(saved)) return saved
  const pinned = await pinnedRgbL1Network(mnemonic)
  if (pinned && (await isRgbL1Ready(mnemonic, pinned))) return pinned
  for (const network of RGB_L1_NETWORKS) if (await isRgbL1Ready(mnemonic, network)) return network
  return null
}

/** The folder rgb-lib keeps a network's wallet in when it isn't the seed's home network. */
export const rgbL1Subdir = (network: RgbL1Network) => `rgb-${network}`

/**
 * Where `network`'s RGB data lives: null for rgb-lib's original folder (the home
 * network, or the first network to start), else a folder of its own. Throws on
 * a native build that can't open another folder.
 */
export async function rgbL1DataFolder(mnemonic: string, network: RgbL1Network): Promise<string | null> {
  const home = await rgbL1HomeNetwork(mnemonic)
  if (!home || home === network) return null
  if (!isRgbL1NetworkSwitchSupported()) {
    throw new Error(`RGB on this phone already runs on ${RGB_L1_NETWORK_LABEL[home]} for this wallet. ${RGB_L1_UPDATE_TO_SWITCH}`)
  }
  return rgbL1Subdir(network)
}

/**
 * `rgbL1DataFolder`, saving the home network first when there is none yet. Call
 * right before rgb-lib creates the wallet's data (open or restore).
 */
export async function claimRgbL1DataFolder(mnemonic: string, network: RgbL1Network): Promise<string | null> {
  const db = DatabaseService.getInstance()
  if (!isNetwork(await db.getSetting(homeKey(mnemonic)))) {
    await db.setSetting(homeKey(mnemonic), (await rgbL1HomeNetwork(mnemonic)) ?? network)
  }
  return rgbL1DataFolder(mnemonic, network)
}

/** react-native-rgb's `restoreBackup`, into `folder` (null: the original folder). */
export function rgbL1NativeRestore(folder: string | null): (path: string, password: string) => Promise<void> {
  return (path, password) => {
    const lib = require('react-native-rgb')
    return folder ? lib.restoreBackup(path, password, folder) : lib.restoreBackup(path, password)
  }
}

/** A restore for `network`'s RGB data: picks (and claims) its folder right before rgb-lib writes it. */
export function rgbL1Restorer(mnemonic: string, network: RgbL1Network): (path: string, password: string) => Promise<void> {
  return async (path, password) => rgbL1NativeRestore(await claimRgbL1DataFolder(mnemonic, network))(path, password)
}

/**
 * The network this wallet's RGB is stuck on: only on a native build that can't
 * switch, once a network started (or was restored). Null when it can change.
 */
export async function lockedRgbL1Network(mnemonic: string): Promise<RgbL1Network | null> {
  if (isRgbL1NetworkSwitchSupported()) return null
  return rgbL1HomeNetwork(mnemonic)
}

/**
 * Turns RGB on this phone on (on `network`) or off (null). Choosing another
 * network switches to that network's own RGB wallet (see ./wdk.ts,
 * `switchRgbL1Network`); a native build that can't switch refuses.
 */
export async function saveRgbL1Network(mnemonic: string, network: RgbL1Network | null): Promise<void> {
  if (network && !isNetwork(network)) throw new Error('Unsupported RGB network.')
  const db = DatabaseService.getInstance()
  if (network) {
    const locked = await lockedRgbL1Network(mnemonic)
    if (locked && locked !== network) {
      throw new Error(`RGB on this phone already runs on ${RGB_L1_NETWORK_LABEL[locked]} for this wallet. ${RGB_L1_UPDATE_TO_SWITCH}`)
    }
    await db.setSetting(pinnedKey(mnemonic), network)
  }
  await db.setSetting(settingKey(mnemonic), network ?? '')
}

/**
 * Whether RGB on this phone has opened for this seed and network here before.
 * Until it has, the first start looks for a cloud backup to restore.
 */
export async function isRgbL1Ready(mnemonic: string, network: RgbL1Network): Promise<boolean> {
  return (await DatabaseService.getInstance().getSetting(readyKey(mnemonic, network))) === '1'
}

/** The networks this seed's RGB has started on here. */
export async function readyRgbL1Networks(mnemonic: string): Promise<RgbL1Network[]> {
  const ready = await Promise.all(RGB_L1_NETWORKS.map((n) => isRgbL1Ready(mnemonic, n)))
  return RGB_L1_NETWORKS.filter((_, i) => ready[i])
}

export async function markRgbL1Ready(mnemonic: string, network: RgbL1Network): Promise<void> {
  await claimRgbL1DataFolder(mnemonic, network).catch(() => undefined) // a home network, if none yet
  await DatabaseService.getInstance().setSetting(readyKey(mnemonic, network), '1')
}

/**
 * Password for rgb-lib's encrypted backup, derived from the seed: the file is
 * useless without the seed anyway, and the user has no extra secret to lose.
 */
export function rgbBackupPassword(mnemonic: string): string {
  return bytesToHex(sha256(utf8ToBytes(`kaleidoswap/rgb-l1/backup/v1:${mnemonic.trim()}`)))
}

/** rgb-lib's original folder in the adapter's `dataDir` (see ./rgbLibRn.ts). */
export const RGB_L1_BASE_FOLDER = '.'

/** The adapter config for `manager.connect('RGB_L1', …)`; `folder` from `claimRgbL1DataFolder`. */
export function buildRgbL1Config(mnemonic: string, host: RgbL1Host, folder: string | null = null) {
  return {
    protocol: 'RGB_L1' as const,
    mnemonic,
    network: host.network,
    // The folder inside the app's RGB data folder (react-native-rgb decides where that is).
    dataDir: folder ?? RGB_L1_BASE_FOLDER,
    indexerUrl: host.indexerUrl,
    transportEndpoint: host.transportEndpoint,
  }
}
