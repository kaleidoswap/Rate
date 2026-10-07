/**
 * Which wallet is the app's RGB account
 * -------------------------------------
 * Either an RGB Lightning Node (RLN, paired over NWC) or RGB on this phone
 * (rgb-lib). Only one is the RGB account at a time: a connected RGB node wins,
 * and RGB on this phone is released while it is connected.
 *
 * A plain Lightning wallet connected over NWC shares the node's adapter slot
 * (RGB_LN) but holds no RGB assets, so it never counts as the RGB node.
 */
import type { RgbBacking } from '../../utils/protocol-bridge'

export interface RgbNodeLike {
  isConnected?(): boolean
  /** NwcRgbAdapter: 'rln' for an RGB Lightning Node, 'ln' for a plain Lightning wallet. */
  walletType?(): 'ln' | 'rln'
}

/** A connected RGB_LN adapter that is an RGB node, not a plain Lightning wallet. */
export function isRgbNode(adapter: RgbNodeLike | null | undefined): boolean {
  if (!adapter?.isConnected?.()) return false
  return adapter.walletType?.() !== 'ln'
}

/**
 * The engine protocol behind the RGB account: the RGB node when connected, else
 * RGB on this phone when connected, else the node slot (so "not connected" reads right).
 */
export function chooseRgbBacking(nodeIsRgb: boolean, onDeviceConnected: boolean): RgbBacking {
  if (nodeIsRgb) return 'RGB_LN'
  if (onDeviceConnected) return 'RGB_L1'
  return 'RGB_LN'
}

export type RgbOnDeviceStep = 'release' | 'keep' | 'start'

/**
 * What to do with RGB on this phone: release it when it's off or an RGB node is
 * the RGB account, keep it when it's already connected, otherwise start it.
 */
export function rgbOnDeviceStep(state: { enabled: boolean; nodeIsRgb: boolean; connected: boolean }): RgbOnDeviceStep {
  if (!state.enabled || state.nodeIsRgb) return 'release'
  return state.connected ? 'keep' : 'start'
}

/** A network name as the app, rgb-lib or a node reports it, for display. */
export function rgbNetworkLabel(raw?: string | null): string | null {
  const name = String(raw ?? '').trim().toLowerCase()
  if (!name || name === 'unknown') return null
  if (name === 'mainnet' || name === 'bitcoin') return 'Mainnet'
  if (name === 'mutinynet' || name === 'signet') return 'Mutinynet'
  if (name === 'testnet' || name === 'testnet3' || name === 'testnet4') return 'Testnet'
  if (name === 'regtest') return 'Regtest'
  return raw ?? null
}
