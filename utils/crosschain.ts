/**
 * Sending from Spark to an external chain (USDB or BTC out as USDC/USDT on EVM
 * or Solana) through Flashnet Orchestra: recipient detection and the curated
 * destination chains, tokens and source assets.
 *
 * Detection only runs after the wallet's own destination decoding has failed,
 * so it can't shadow a Bitcoin/Lightning/Spark/Ark/RGB destination. Orchestra
 * validates the address again when the quote is created.
 */
import { base58 } from '@scure/base';
import { isValidEvmAddress, toChecksumAddress } from './orchestra-ui';

export type CrossChainFamily = 'evm' | 'solana';

export interface DetectedCrossChainAddress {
  family: CrossChainFamily;
  /** EIP-55 checksummed for EVM; unchanged for Solana. */
  normalized: string;
}

const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

// A Solana address is a 32-byte ed25519 key; the charset regex alone accepts
// shorter strings (e.g. a dropped character).
function isValidSolanaAddress(address: string): boolean {
  if (!SOLANA_ADDRESS_RE.test(address)) return false;
  try {
    return base58.decode(address).length === 32;
  } catch {
    return false;
  }
}

export function detectCrossChainAddress(input: string): DetectedCrossChainAddress | null {
  const trimmed = (input ?? '').trim();
  if (!trimmed) return null;
  if (EVM_ADDRESS_RE.test(trimmed)) {
    if (!isValidEvmAddress(trimmed)) return null;
    return { family: 'evm', normalized: toChecksumAddress(trimmed) };
  }
  if (isValidSolanaAddress(trimmed)) return { family: 'solana', normalized: trimmed };
  return null;
}

export interface CrossChainDestChain {
  chain: string;
  family: CrossChainFamily;
  label: string;
}

/** Destination chains offered, in display order. */
export const CURATED_WITHDRAW_CHAINS: CrossChainDestChain[] = [
  { chain: 'ethereum', family: 'evm', label: 'Ethereum' },
  { chain: 'base', family: 'evm', label: 'Base' },
  { chain: 'arbitrum', family: 'evm', label: 'Arbitrum' },
  { chain: 'optimism', family: 'evm', label: 'Optimism' },
  { chain: 'polygon', family: 'evm', label: 'Polygon' },
  { chain: 'solana', family: 'solana', label: 'Solana' },
];

export const WITHDRAW_DEST_TOKENS = ['USDC', 'USDT'] as const;
export type WithdrawDestToken = (typeof WITHDRAW_DEST_TOKENS)[number];

export function isCuratedWithdrawChain(chain: string): boolean {
  const key = chain.toLowerCase();
  return CURATED_WITHDRAW_CHAINS.some((c) => c.chain === key);
}

export function chainsForFamily(family: CrossChainFamily): CrossChainDestChain[] {
  return CURATED_WITHDRAW_CHAINS.filter((c) => c.family === family);
}

export function familyForChain(chain: string): CrossChainFamily | null {
  return CURATED_WITHDRAW_CHAINS.find((c) => c.chain === chain.toLowerCase())?.family ?? null;
}

export function isValidRecipientForFamily(address: string, family: CrossChainFamily): boolean {
  const trimmed = (address ?? '').trim();
  if (!trimmed) return false;
  return family === 'evm' ? isValidEvmAddress(trimmed) : isValidSolanaAddress(trimmed);
}

/** What the user spends from Spark. */
export type CrossChainSourceKey = 'USDB' | 'BTC';
