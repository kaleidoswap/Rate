/**
 * Flashnet / USDB constants & helpers — ported from
 * rate-extension/src/protocols/types/flashnet.ts.
 *
 * Flashnet is the Spark AMM swap venue (alongside KaleidoSwap's RGB-Lightning
 * maker). USDB is the Spark-native USD stablecoin traded on it. The
 * @flashnet/sdk `listPools` response only carries raw asset addresses +
 * reserves — no token metadata — so these constants are what let us resolve a
 * pool's hex/bech32m address into a real ticker/precision (esp. USDB).
 */

export type FlashnetNetwork = 'mainnet' | 'regtest'

// Mainnet and regtest share one canonical USDB token address.
export const USDB_TOKEN_ADDRESS: Record<FlashnetNetwork, string> = {
  mainnet: 'btkn1xgrvjwey5ngcagvap2dzzvsy4uk8ua9x69k82dwvt5e7ef9drm9qztux87',
  regtest: 'btkn1xgrvjwey5ngcagvap2dzzvsy4uk8ua9x69k82dwvt5e7ef9drm9qztux87',
}

// The same token surfaces under a few address encodings (mainnet bech32m +
// regtest-prefixed alias). Match against all of them.
export const USDB_TOKEN_ADDRESS_ALIASES = [
  USDB_TOKEN_ADDRESS.mainnet,
  'btknrt1xgrvjwey5ngcagvap2dzzvsy4uk8ua9x69k82dwvt5e7ef9drm9qp48s74',
]

// Sentinel pubkey the AMM uses for "BTC on Spark" on the asset-A side of pools.
export const BTC_ASSET_PUBKEY =
  '020202020202020202020202020202020202020202020202020202020202020202'

export const USDB_DECIMALS = 6
export const BTC_DECIMALS = 8

export const FLASHNET_API_URL: Record<FlashnetNetwork, string> = {
  mainnet: 'https://api.flashnet.xyz',
  regtest: 'https://api.amm.makebitcoingreatagain.dev',
}

export const FLASHNET_REWARDS_API_URL = 'https://rewards.flashnet.xyz'
export const FLASHNET_USDB_REWARDS_DOC_URL = 'https://docs.flashnet.xyz/usdb/rewards'

export const DEFAULT_SLIPPAGE_BPS = 500

// Canonical display metadata for USDB, so it renders consistently anywhere it's
// held or quoted (assets list, swap pairs, balances).
export const USDB_TICKER = 'USDB'
export const USDB_NAME = 'Spark USD Balance'

export interface UsdbRewardTier {
  minBalance: number
  rate: number
  label: string
}

export const USDB_REWARD_TIERS: UsdbRewardTier[] = [
  { minBalance: 10, rate: 0.035, label: '3.5%' },
  { minBalance: 1_000, rate: 0.045, label: '4.5%' },
  { minBalance: 10_000, rate: 0.06, label: '6%' },
]

export function getFlashnetNetworkForSpark(
  sparkNetwork: string | null | undefined,
): FlashnetNetwork | null {
  const normalized = sparkNetwork?.trim().toLowerCase()
  if (normalized === 'mainnet') return 'mainnet'
  if (normalized === 'regtest') return 'regtest'
  return null
}

export function getFlashnetUsdbTokenAddress(network: FlashnetNetwork): string {
  return USDB_TOKEN_ADDRESS[network]
}

export function isUsdbTokenAddress(value: string | null | undefined): boolean {
  if (!value) return false
  const normalized = value.trim().toLowerCase()
  return USDB_TOKEN_ADDRESS_ALIASES.some((alias) => alias.toLowerCase() === normalized)
}

/** Staking reward rate for a given USDB balance (whole-USDB units). */
export function getUsdbRewardRate(usdbBalance: number): number {
  let rate = 0
  for (const tier of USDB_REWARD_TIERS) {
    if (usdbBalance >= tier.minBalance) rate = tier.rate
  }
  return rate
}
