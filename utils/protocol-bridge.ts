/**
 * Protocol boundary bridge (wallet-engine beta.55)
 * ------------------------------------------------
 * The app models the RGB account family as `'RGB'` — woven into the UI (theme
 * `protocolColor`), account-routing, settings, and labels. The engine has two
 * RGB protocols: `'RGB_LN'` (an RGB Lightning node, paired over NWC) and
 * `'RGB_L1'` (rgb-lib on this phone, on-chain only). The RGB account is
 * whichever backs it right now — the node when connected, else the phone.
 *
 * Rather than churn the app's pervasive `'RGB'` identity (and risk silent
 * runtime breakage in the untyped UI/routing paths), we keep `'RGB'` internally
 * and translate only at the typed wallet-engine call boundary:
 *   - toEngineProtocol('RGB')  → the current backing (app → engine)
 *   - fromEngineProtocol('RGB_LN' | 'RGB_L1') → 'RGB'  (engine → app)
 * All other protocols pass through unchanged.
 */
import type { ProtocolType } from '@kaleidorg/wallet-engine'

/** The app's account-family identifiers (kept stable across the beta.55 rename). */
export type AppProtocol = 'RGB' | 'SPARK' | 'ARKADE' | 'BARK' | 'BTC'

export type RgbBacking = 'RGB_LN' | 'RGB_L1'
let rgbBacking: () => RgbBacking = () => 'RGB_LN'

/** The protocol layer says which engine protocol backs the RGB account (services/protocols). */
export function setRgbBacking(resolve: () => RgbBacking): void {
  rgbBacking = resolve
}

/** App family → engine ProtocolType. `'RGB'` becomes its current backing. */
export function toEngineProtocol(p: AppProtocol): ProtocolType {
  return (p === 'RGB' ? rgbBacking() : p) as ProtocolType
}

/** Engine ProtocolType → app family. Both RGB variants collapse to `'RGB'`. */
export function fromEngineProtocol(p: ProtocolType | string): AppProtocol {
  if (p === 'RGB_LN' || p === 'RGB_L1' || p === 'RGB') return 'RGB'
  return p as AppProtocol
}
