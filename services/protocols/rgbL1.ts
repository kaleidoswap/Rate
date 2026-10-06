/**
 * RGB on this phone — KaleidoSwap App
 * -----------------------------------
 * Host config for the engine's `RgbLibWdkAdapter` (protocol RGB_L1), backed by
 * native rgb-lib through ./rgbLibRn.ts. The app's RGB account is either your
 * RGB Lightning node (paired over NWC) or this on-device wallet; the node wins
 * when both are available (see utils/protocol-bridge.ts).
 *
 * Opt-in per wallet from Settings › Advanced, and Mutinynet only for now. RGB
 * state can't be rebuilt from the seed alone: ./rgbBackup.ts uploads rgb-lib's
 * encrypted backup to VSS after every change.
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

export type RgbL1Network = 'mutinynet'
export const RGB_L1_NETWORKS: readonly RgbL1Network[] = ['mutinynet']

export interface RgbL1Host {
  network: RgbL1Network
  /** Esplora indexer for the chain. */
  indexerUrl: string
  /** RGB proxy that relays consignments between sender and receiver. */
  transportEndpoint: string
}

// EXPO_PUBLIC_* vars are inlined at build time only on direct member access.
const DEFAULTS: Record<RgbL1Network, RgbL1Host> = {
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

const endpointsKey = (mnemonic: string) => `rgb-l1-endpoints-v1-${rgbL1WalletKey(mnemonic)}`

/** The wallet's endpoints: its own indexer/proxy when set in Settings, else the network defaults. */
export async function loadRgbL1Host(mnemonic: string, network: RgbL1Network): Promise<RgbL1Host> {
  const saved = await DatabaseService.getInstance().getSetting(endpointsKey(mnemonic))
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
export async function saveRgbL1Endpoints(mnemonic: string, endpoints: { indexerUrl: string; transportEndpoint: string } | null): Promise<void> {
  const value = endpoints
    ? JSON.stringify({ indexerUrl: validateRgbEndpoint('indexer', endpoints.indexerUrl), transportEndpoint: validateRgbEndpoint('proxy', endpoints.transportEndpoint) })
    : ''
  await DatabaseService.getInstance().setSetting(endpointsKey(mnemonic), value)
}

/** Non-secret per-seed key, so one phone with several wallets keeps separate choices. */
export function rgbL1WalletKey(mnemonic: string): string {
  return bytesToHex(sha256(utf8ToBytes(`kaleidoswap/rgb-l1/v1:${mnemonic.trim()}`))).slice(0, 32)
}

const settingKey = (mnemonic: string) => `rgb-l1-network-v1-${rgbL1WalletKey(mnemonic)}`

/** The network this wallet runs RGB on, or null when RGB on this phone is off. */
export async function loadRgbL1Network(mnemonic: string): Promise<RgbL1Network | null> {
  if (!RGB_L1_ENABLED) return null
  const saved = await DatabaseService.getInstance().getSetting(settingKey(mnemonic))
  return saved && (RGB_L1_NETWORKS as readonly string[]).includes(saved) ? (saved as RgbL1Network) : null
}

export async function saveRgbL1Network(mnemonic: string, network: RgbL1Network | null): Promise<void> {
  if (network && !RGB_L1_NETWORKS.includes(network)) throw new Error('Unsupported RGB network.')
  await DatabaseService.getInstance().setSetting(settingKey(mnemonic), network ?? '')
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
