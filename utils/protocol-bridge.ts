/**
 * Protocol boundary bridge (wallet-engine beta.55)
 * ------------------------------------------------
 * The app models the RGB-over-Lightning account family as `'RGB'` — woven into
 * the UI (theme `protocolColor`), account-routing, settings, and labels. In
 * beta.55 the engine renamed that protocol to `'RGB_LN'` (the on-chain-only
 * variant is `'RGB_L1'`, which this app does not use).
 *
 * Rather than churn the app's pervasive `'RGB'` identity (and risk silent
 * runtime breakage in the untyped UI/routing paths), we keep `'RGB'` internally
 * and translate only at the typed wallet-engine call boundary:
 *   - toEngineProtocol('RGB')  → 'RGB_LN'   (app → engine)
 *   - fromEngineProtocol('RGB_LN' | 'RGB_L1') → 'RGB'  (engine → app)
 * All other protocols pass through unchanged.
 */
import type { ProtocolType } from '@kaleidorg/wallet-engine'

/** The app's account-family identifiers (kept stable across the beta.55 rename). */
export type AppProtocol = 'RGB' | 'SPARK' | 'ARKADE' | 'LIQUID' | 'BTC'

/** App family → engine ProtocolType. `'RGB'` becomes the RGB-over-LN protocol. */
export function toEngineProtocol(p: AppProtocol): ProtocolType {
  return (p === 'RGB' ? 'RGB_LN' : p) as ProtocolType
}

/** Engine ProtocolType → app family. Both RGB variants collapse to `'RGB'`. */
export function fromEngineProtocol(p: ProtocolType | string): AppProtocol {
  if (p === 'RGB_LN' || p === 'RGB_L1' || p === 'RGB') return 'RGB'
  return p as AppProtocol
}
