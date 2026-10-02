/**
 * Bark (Second's on-device Ark wallet) — KaleidoSwap App
 * ------------------------------------------------------
 * Host-side config for `BarkReactNativeAdapter` (@kaleidorg/wallet-engine
 * `adapters/bark-react-native`, registered in ./wdk.ts as BARK). The adapter owns
 * the wallet; the host owns what the engine leaves to it:
 *  - the app-private data directory (created here, one per seed + network);
 *  - deciding when to create a wallet vs. open an existing one;
 *  - the server/esplora endpoints.
 *
 * ON by default on MAINNET (Second's public deployment). Set EXPO_PUBLIC_BARK_NETWORK=signet
 * for test sats, or disable with EXPO_PUBLIC_BARK=0.
 * Bark isn't a wallet `NetworkType` yet, so it doesn't come from the wallet's
 * network list — initializeWdkProtocols connects it alongside the listed networks.
 *
 * Distinct from Arkade: different Ark server, no interop, yet both mint `tark1…`
 * addresses — route by account, never by prefix.
 */

import { TurboModuleRegistry } from 'react-native'
import { Directory, Paths } from 'expo-file-system'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'
import type { BarkConfig } from '@kaleidorg/wallet-engine'

/** OTA/JS updates may run on a dev client built before Bark was added. */
export function isBarkNativeAvailable(): boolean {
  return !!TurboModuleRegistry?.get('BarkReactNative')
}

export type BarkNetwork = NonNullable<BarkConfig['network']>

// EXPO_PUBLIC_* vars are inlined at build time only on direct member access, so
// read each one explicitly — `process.env` as an object is empty at runtime.
export const BARK_ENABLED = process.env.EXPO_PUBLIC_BARK !== '0'
const BARK_ENV: Record<string, string | undefined> = {
  EXPO_PUBLIC_BARK_NETWORK: process.env.EXPO_PUBLIC_BARK_NETWORK,
  EXPO_PUBLIC_BARK_SERVER_URL: process.env.EXPO_PUBLIC_BARK_SERVER_URL,
  EXPO_PUBLIC_BARK_ESPLORA_URL: process.env.EXPO_PUBLIC_BARK_ESPLORA_URL,
}

const BARK_NETWORKS: readonly BarkNetwork[] = ['mainnet', 'signet']

/** Second's public deployments (https://second.tech/docs/connection-details). */
export const BARK_DEFAULT_ENDPOINTS: Partial<Record<BarkNetwork, { arkServerUrl: string; esploraUrl: string }>> = {
  mainnet: {
    arkServerUrl: 'https://ark.second.tech',
    esploraUrl: 'https://mempool.second.tech/api',
  },
  signet: {
    arkServerUrl: 'https://ark.signet.2nd.dev',
    esploraUrl: 'https://esplora.signet.2nd.dev',
  },
}

export interface BarkHostConfig {
  network: BarkNetwork
  arkServerUrl: string
  esploraUrl: string
}

/**
 * Resolve the Bark network + endpoints from env. Defaults to mainnet with Second's
 * endpoints. Returns null (Bark stays off) for an unrecognised network name rather than
 * guessing: with mainnet as the default, a typo meant for testing must not move real
 * funds. Also null when the network has no known endpoints and none were set.
 */
export function resolveBarkHostConfig(env: Record<string, string | undefined> = BARK_ENV): BarkHostConfig | null {
  const requested = env.EXPO_PUBLIC_BARK_NETWORK as BarkNetwork | undefined
  if (requested && !BARK_NETWORKS.includes(requested)) return null
  const network: BarkNetwork = requested ?? 'mainnet'
  const defaults = BARK_DEFAULT_ENDPOINTS[network]
  const arkServerUrl = env.EXPO_PUBLIC_BARK_SERVER_URL || defaults?.arkServerUrl
  const esploraUrl = env.EXPO_PUBLIC_BARK_ESPLORA_URL || defaults?.esploraUrl
  if (!arkServerUrl || !esploraUrl) return null
  return { network, arkServerUrl, esploraUrl }
}

/** `file:///…/Documents/bark/<key>-<network>` → absolute POSIX path, as Bark requires. */
export function toFilesystemPath(uri: string): string {
  const path = uri.startsWith('file://') ? decodeURI(uri.slice('file://'.length)) : uri
  return path.replace(/\/+$/, '')
}

/**
 * Directory key for a seed. Bark's open does NOT check the mnemonic against the
 * stored database, so keying by wallet id would let a recreated wallet (new seed,
 * reused id) silently open the old seed's state. A one-way hash of the seed can't.
 */
export function barkWalletKey(mnemonic: string): string {
  return bytesToHex(sha256(utf8ToBytes(`kaleidoswap/bark-datadir/v1:${mnemonic.trim()}`))).slice(0, 32)
}

/**
 * Create (if needed) the app-private Bark directory for one seed + network.
 * `isNew` is true when the directory had no contents — the only case in which we
 * let Bark create a wallet. An existing directory is always opened, never recreated.
 */
export function prepareBarkDataDir(walletKey: string, network: BarkNetwork): { dataDir: string; isNew: boolean } {
  const dir = new Directory(Paths.document, 'bark', `${walletKey}-${network}`)
  let isNew = true
  if (dir.exists) {
    isNew = dir.list().length === 0
  } else {
    dir.create({ intermediates: true, idempotent: true })
  }
  return { dataDir: toFilesystemPath(dir.uri), isNew }
}

/**
 * Adapter config for this seed, or null when Bark is disabled / unconfigured.
 * Touches the filesystem (creates the data directory).
 */
export function buildBarkConfig(mnemonic: string): BarkConfig | null {
  if (!BARK_ENABLED) return null
  const host = resolveBarkHostConfig()
  if (!host) return null
  const { dataDir, isNew } = prepareBarkDataDir(barkWalletKey(mnemonic), host.network)
  return {
    protocol: 'BARK',
    mnemonic,
    network: host.network,
    arkServerUrl: host.arkServerUrl,
    esploraUrl: host.esploraUrl,
    dataDir,
    createIfMissing: isNew,
  }
}
