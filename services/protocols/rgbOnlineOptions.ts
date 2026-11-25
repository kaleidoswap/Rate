import type { OnlineOptions } from '../../modules/kaleido-rgb'

/** Signet verifies Utexo's bridge on Arbitrum One. A build may override the network's entire map. */
export function rgbOnlineOptions(network: string): OnlineOptions | undefined {
  const configs = {
    mutinynet: process.env.EXPO_PUBLIC_RGB_L1_MUTINYNET_EVM_CHAINS,
    signet: process.env.EXPO_PUBLIC_RGB_L1_SIGNET_EVM_CHAINS,
  }
  if (network !== 'mutinynet' && network !== 'signet') return undefined

  const config = configs[network]?.trim()
  if (!config) {
    return network === 'signet'
      ? { evmChains: { '42161': { rpcUrl: 'https://arb1.arbitrum.io/rpc', minMintLockBlocks: 1200, maxMintLockBlocks: 28_800 } } }
      : undefined
  }

  try {
    const chains: unknown = JSON.parse(config)
    if (!isRecord(chains)) throw new Error()

    const evmChains: NonNullable<OnlineOptions['evmChains']> = {}
    for (const [chainId, chain] of Object.entries(chains)) {
      if (!/^[1-9]\d{0,19}$/.test(chainId) || BigInt(chainId) > 18_446_744_073_709_551_615n || !isRecord(chain)) {
        throw new Error()
      }
      const { rpcUrl, minMintLockBlocks, maxMintLockBlocks } = chain
      if (typeof rpcUrl !== 'string' || !isBlockCount(minMintLockBlocks) || !isBlockCount(maxMintLockBlocks)
        || maxMintLockBlocks < Math.max(2, minMintLockBlocks)) {
        throw new Error()
      }
      const url = new URL(rpcUrl)
      if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error()

      evmChains[chainId] = { rpcUrl: url.toString(), minMintLockBlocks, maxMintLockBlocks }
    }
    return { evmChains }
  } catch {
    const label = network === 'signet' ? 'Signet' : 'Mutinynet'
    throw new Error(`The ${label} RGB bridge configuration is invalid. Check its EVM chain IDs, HTTPS RPC URLs and mint lock limits.`)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isBlockCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}
