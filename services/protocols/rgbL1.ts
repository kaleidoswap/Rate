/**
 * RGB on this phone — KaleidoSwap App
 * -----------------------------------
 * Host config for the engine's `RgbLibWdkAdapter` (protocol RGB_L1), backed by
 * native rgb-lib through ./rgbLibRn.ts. The app's RGB account is either your
 * RGB Lightning node (paired over NWC) or this on-device wallet; the node wins
 * when both are available (see utils/protocol-bridge.ts).
 *
 * Runs on mainnet (the default, like the wallet's other accounts) or Mutinynet.
 * rgb-lib keeps one data folder per seed, not per network, so a wallet's RGB
 * network is fixed the first time it's turned on (see `pinnedRgbL1Network`).
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
const isNetwork = (v: string | null | undefined): v is RgbL1Network => !!v && (RGB_L1_NETWORKS as readonly string[]).includes(v)

/**
 * The network this wallet's RGB data on this phone belongs to, once it has been
 * turned on (it stays set when RGB on this phone is turned off again).
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
 * Turns RGB on this phone on (on `network`) or off (null). A wallet can't move
 * its RGB data to another network: rgb-lib would open the same folder.
 */
export async function saveRgbL1Network(mnemonic: string, network: RgbL1Network | null): Promise<void> {
  if (network && !isNetwork(network)) throw new Error('Unsupported RGB network.')
  const db = DatabaseService.getInstance()
  if (network) {
    const pinned = await pinnedRgbL1Network(mnemonic)
    if (pinned && pinned !== network) {
      throw new Error(`RGB on this phone already runs on ${RGB_L1_NETWORK_LABEL[pinned]} for this wallet.`)
    }
    await db.setSetting(pinnedKey(mnemonic), network)
  }
  await db.setSetting(settingKey(mnemonic), network ?? '')
}

const readyKey = (mnemonic: string, network: RgbL1Network) => `rgb-l1-ready-v1-${network}-${rgbL1WalletKey(mnemonic)}`

/**
 * Whether RGB on this phone has opened for this seed and network here before.
 * Until it has, the first start looks for a cloud backup to restore.
 */
export async function isRgbL1Ready(mnemonic: string, network: RgbL1Network): Promise<boolean> {
  return (await DatabaseService.getInstance().getSetting(readyKey(mnemonic, network))) === '1'
}

export async function markRgbL1Ready(mnemonic: string, network: RgbL1Network): Promise<void> {
  await DatabaseService.getInstance().setSetting(readyKey(mnemonic, network), '1')
}

/**
 * Password for rgb-lib's encrypted backup, derived from the seed: the file is
 * useless without the seed anyway, and the user has no extra secret to lose.
 */
export function rgbBackupPassword(mnemonic: string): string {
  return bytesToHex(sha256(utf8ToBytes(`kaleidoswap/rgb-l1/backup/v1:${mnemonic.trim()}`)))
}

/** The adapter config for `manager.connect('RGB_L1', …)`. */
export function buildRgbL1Config(mnemonic: string, host: RgbL1Host) {
  return {
    protocol: 'RGB_L1' as const,
    mnemonic,
    network: host.network,
    // rgb-lib keeps its data in the app's private files (react-native-rgb decides
    // where); the adapter requires a value, so name the wallet's slot.
    dataDir: `rgb-l1/${rgbL1WalletKey(mnemonic)}`,
    indexerUrl: host.indexerUrl,
    transportEndpoint: host.transportEndpoint,
  }
}
