import type { OnlineOptions } from '../../modules/kaleido-rgb'

/** The RPC verifies bridge state, so only use endpoints supplied by the build. */
export function rgbOnlineOptions(network: string): OnlineOptions | undefined {
  if (network !== 'mutinynet') return undefined

  const config = process.env.EXPO_PUBLIC_RGB_L1_MUTINYNET_EVM_CHAINS?.trim()
  if (!config) return undefined

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
    throw new Error('The Mutinynet RGB bridge configuration is invalid. Check its EVM chain IDs, HTTPS RPC URLs and mint lock limits.')
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isBlockCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}
