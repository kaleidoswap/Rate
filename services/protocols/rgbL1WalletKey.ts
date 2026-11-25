import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'

/** Non-secret per-seed key, so one phone with several wallets keeps separate choices. */
export function rgbL1WalletKey(mnemonic: string): string {
  return bytesToHex(sha256(utf8ToBytes(`kaleidoswap/rgb-l1/v1:${mnemonic.trim()}`))).slice(0, 32)
}
