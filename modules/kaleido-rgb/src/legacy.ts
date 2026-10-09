import type { WalletDirState } from './types'

/**
 * What to do with a wallet's BDK cache before rgb-lib 0.3.0-beta.7 opens it.
 *
 * rgb-lib 0.3.0-beta.6 moved to BDK 3, which can't read the cache file (`bdk_db`)
 * earlier versions wrote. Since beta.7 every open writes `wallet_manifest.json`,
 * so a wallet folder with a `bdk_db` and no manifest was last opened by an older
 * rgb-lib (the app shipped beta.4): move that cache aside — the native side keeps
 * it as `bdk_db.pre-beta7`, never deletes it, and refuses when a manifest exists.
 * The RGB state (rgb_lib_db, consignments) is never touched; the BDK cache is
 * rebuilt from the chain by the full scan `goOnline` runs.
 */
export function legacyBdkCacheAction(state: WalletDirState): 'none' | 'move-aside' {
  return state.exists && !state.hasManifest && state.hasBdkDb ? 'move-aside' : 'none'
}
