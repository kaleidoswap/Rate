// The Agent wallet is its own Spark wallet: the same recovery phrase, the next
// account index. The WDK Spark signer derives each account under
// m/44'/998'/<accountNumber>'/0/<index>, and spark-sdk picks accountNumber 1
// (0 on regtest). The main wallet is index 0, the Agent wallet index 1, so it
// has its own identity key and funds and comes back with the phrase.

import { HDKey } from '@scure/bip32';
import { mnemonicToSeedSync, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { bech32 } from '@scure/base';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';

export const MAIN_SPARK_ACCOUNT_INDEX = 0;
export const AGENT_SPARK_ACCOUNT_INDEX = 1;

/** spark-sdk's default account number for a network. */
export function sparkAccountNumber(network: string): number {
  return String(network).toLowerCase() === 'regtest' ? 0 : 1;
}

export function sparkIdentityPath(network: string, index: number): string {
  if (!Number.isInteger(index) || index < 0) throw new Error('Invalid account index');
  return `m/44'/998'/${sparkAccountNumber(network)}'/0/${index}`;
}

/** The seed bytes the WDK Spark manager uses for a wallet secret (same rules as the engine). */
export function walletSeed(secret: string): Uint8Array {
  const trimmed = String(secret ?? '').trim();
  if (trimmed.startsWith('nsec1')) {
    const decoded = bech32.decode(trimmed as `${string}1${string}`, 1023);
    const data = bech32.fromWords(decoded.words);
    if (decoded.prefix !== 'nsec' || data.length !== 32) throw new Error('Invalid wallet secret');
    return Uint8Array.from(data);
  }
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) return hexToBytes(trimmed.toLowerCase());
  const phrase = trimmed.split(/\s+/).join(' ');
  if (!validateMnemonic(phrase, wordlist)) throw new Error('Invalid wallet secret');
  return mnemonicToSeedSync(phrase);
}

/** The identity public key (hex) Spark derives for an account, for checking the live wallet. */
export function sparkIdentityPubkey(secret: string, network: string, index: number): string {
  const key = HDKey.fromMasterSeed(walletSeed(secret)).derive(sparkIdentityPath(network, index));
  if (!key.publicKey) throw new Error('Could not derive the account key');
  return bytesToHex(key.publicKey);
}
