/**
 * Shared helpers for the Flashnet Orchestra flows (Receive bridge and Send to
 * an external chain): amounts, fees, route hops, chain artwork and the order
 * status pipeline.
 */
import type { ImageSourcePropType } from 'react-native';
import { keccak_256 } from '@noble/hashes/sha3';
import {
  ORCHESTRA_AUTH_ERROR_CODE,
  ORCHESTRA_ORIGIN_ERROR_CODE,
  type OrchestraOrderStatus,
} from '../services/orchestra/client';

/** EIP-55 mixed-case checksum. Non-EVM addresses are returned unchanged. */
export function toChecksumAddress(address: string): string {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return address;
  const lower = address.slice(2).toLowerCase();
  const hash = keccak_256(Uint8Array.from(lower, (c) => c.charCodeAt(0)));
  let result = '0x';
  for (let i = 0; i < lower.length; i++) {
    const byte = hash[Math.floor(i / 2)];
    const nibble = i % 2 === 0 ? (byte >> 4) & 0xf : byte & 0xf;
    result += nibble >= 8 ? lower[i].toUpperCase() : lower[i];
  }
  return result;
}

/**
 * An EVM address, honouring its checksum when it has one. A mixed-case body
 * that fails EIP-55 is almost certainly a typo, so it is rejected rather than
 * "fixed" into a different address.
 */
export function isValidEvmAddress(address: string): boolean {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return false;
  const body = address.slice(2);
  if (body === body.toLowerCase() || body === body.toUpperCase()) return true;
  return toChecksumAddress(address) === address;
}

/** Decimal string → smallest-unit integer string, without float rounding. */
export function toFixedDecimalUnits(amount: string, decimals: number): string {
  const trimmed = amount.trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return '0';
  const [intPart, fracPart = ''] = trimmed.split('.');
  const fracPadded = (fracPart + '0'.repeat(decimals)).slice(0, decimals);
  const raw = `${intPart}${fracPadded}`.replace(/^0+(?=\d)/, '');
  return raw.length === 0 ? '0' : raw;
}

/** Inverse of `toFixedDecimalUnits`: plain decimal, no grouping, safe to put back in an input. */
export function fromFixedDecimalUnits(raw: string, decimals: number): string {
  const digits = (String(raw).match(/\d+/)?.[0] ?? '0').replace(/^0+(?=\d)/, '');
  if (decimals <= 0) return digits;
  const padded = digits.padStart(decimals + 1, '0');
  const intPart = padded.slice(0, padded.length - decimals);
  const fracPart = padded.slice(padded.length - decimals).replace(/0+$/, '');
  return fracPart ? `${intPart}.${fracPart}` : intPart;
}

/** Smallest-unit integer string → grouped decimal for display. */
export function formatSmallUnits(raw: string, decimals: number): string {
  if (!/^-?\d+$/.test(raw) || !Number.isInteger(decimals) || decimals < 0) return '—';
  const units = BigInt(raw);
  const divisor = BigInt(10) ** BigInt(decimals);
  const absolute = units < BigInt(0) ? -units : units;
  const whole = absolute / divisor;
  const fraction = (absolute % divisor).toString().padStart(decimals, '0').replace(/0+$/, '');
  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${units < BigInt(0) ? '-' : ''}${grouped}${fraction ? `.${fraction}` : ''}`;
}

export function formatSats(raw: string): string {
  return `${parseInt(raw, 10).toLocaleString('en-US')} sats`;
}

/** Orchestra prices fees in BTC (8 decimals) or a 6-decimal stablecoin. */
export function orchestraAssetDecimals(ticker: string | undefined): number {
  return (ticker ?? '').toUpperCase() === 'BTC' ? 8 : 6;
}

export interface OrchestraFeeSource {
  totalFeeAmount?: string;
  feeAmount?: string;
  roundingFeeAmount?: string;
  feeAsset?: string;
  feeBps?: number;
}

const USD_STABLES = new Set(['USDC', 'USDT', 'USDB', 'DAI', 'USDE', 'PATHUSD', 'USDC.E']);

export interface OrchestraFeeContext {
  sourceAmountRaw?: string;
  sourceAsset?: string;
  /** Amount delivered, after the fee. */
  destAmountRaw?: string;
  destAsset?: string;
}

export interface OrchestraFeeDisplay {
  text: string;
  note?: string;
}

/**
 * The fee as quoted. `feeBps` only applies above a floor, so the percentage is
 * derived from the real amounts, and the amount keeps its own ticker because
 * the fee is often charged in the routing stablecoin, not the asset sent.
 * Null when there is no usable fee.
 */
export function describeOrchestraFee(
  fee: OrchestraFeeSource | null | undefined,
  ctx?: OrchestraFeeContext,
): OrchestraFeeDisplay | null {
  if (!fee) return null;
  const raw = fee.totalFeeAmount ?? fee.feeAmount;
  const feeUnits = raw != null ? Number(raw) : NaN;
  const asset = (fee.feeAsset ?? '').toUpperCase();

  if (!Number.isFinite(feeUnits) || feeUnits <= 0) {
    return typeof fee.feeBps === 'number' && fee.feeBps > 0
      ? { text: `${(fee.feeBps / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}%` }
      : null;
  }

  const amountText =
    asset === 'BTC'
      ? formatSats(String(raw))
      : `${formatSmallUnits(String(raw), orchestraAssetDecimals(asset))}${asset ? ` ${asset}` : ''}`;

  const comparable = (legAsset?: string): 'exact' | 'approx' | null => {
    const leg = (legAsset ?? '').toUpperCase();
    if (!leg || !asset) return null;
    if (leg === asset) return 'exact';
    return USD_STABLES.has(leg) && USD_STABLES.has(asset) ? 'approx' : null;
  };

  let share: { pct: number; kind: 'exact' | 'approx' } | null = null;
  const sourceMatch = comparable(ctx?.sourceAsset);
  const destMatch = comparable(ctx?.destAsset);
  if (sourceMatch && ctx?.sourceAmountRaw != null) {
    const sent = Number(ctx.sourceAmountRaw);
    if (Number.isFinite(sent) && sent > 0) share = { pct: (feeUnits / sent) * 100, kind: sourceMatch };
  } else if (destMatch && ctx?.destAmountRaw != null) {
    const received = Number(ctx.destAmountRaw);
    if (Number.isFinite(received) && received > 0) {
      share = { pct: (feeUnits / (received + feeUnits)) * 100, kind: destMatch };
    }
  }

  const text = share
    ? `${amountText} (${share.kind === 'approx' ? '~' : ''}${share.pct.toLocaleString('en-US', {
        maximumFractionDigits: share.pct < 1 ? 2 : 1,
      })}%)`
    : amountText;

  const sourceTicker = (ctx?.sourceAsset ?? '').toUpperCase();
  const note = asset && sourceTicker && asset !== sourceTicker ? `charged in ${asset} on the routing leg` : undefined;
  return { text, note };
}

/** Hop path, e.g. ["USDT","USDC","USDB","BTC"], from either route shape. */
export function routeHops(route: unknown): string[] {
  if (Array.isArray(route)) {
    return route.filter((hop): hop is string => typeof hop === 'string' && hop.length > 0);
  }
  if (route && typeof route === 'object') {
    const r = route as { sourceAsset?: string; destinationAsset?: string };
    return [r.sourceAsset, r.destinationAsset].filter(
      (hop): hop is string => typeof hop === 'string' && hop.length > 0,
    );
  }
  return [];
}

// Bundled artwork (assets/icons/chains), same files as the extension.
const ICONS: Record<string, ImageSourcePropType> = {
  arbitrum: require('../assets/icons/chains/arbitrum.png'),
  avalanche: require('../assets/icons/chains/avalanche.png'),
  base: require('../assets/icons/chains/base.png'),
  bitcoin: require('../assets/icons/chains/bitcoin.png'),
  bnb: require('../assets/icons/chains/bnb.png'),
  btc: require('../assets/icons/chains/btc.png'),
  dai: require('../assets/icons/chains/dai.png'),
  eth: require('../assets/icons/chains/eth.png'),
  ethereum: require('../assets/icons/chains/ethereum.png'),
  hypercore: require('../assets/icons/chains/hypercore.png'),
  hyperevm: require('../assets/icons/chains/hyperevm.png'),
  lightning: require('../assets/icons/chains/lightning.png'),
  litecoin: require('../assets/icons/chains/litecoin.png'),
  monad: require('../assets/icons/chains/monad.png'),
  optimism: require('../assets/icons/chains/optimism.png'),
  plasma: require('../assets/icons/chains/plasma.png'),
  polygon: require('../assets/icons/chains/polygon.png'),
  sol: require('../assets/icons/chains/sol.png'),
  solana: require('../assets/icons/chains/solana.png'),
  spark: require('../assets/icons/chains/spark.png'),
  tempo: require('../assets/icons/chains/tempo.png'),
  ton: require('../assets/icons/chains/ton.png'),
  tron: require('../assets/icons/chains/tron.png'),
  trx: require('../assets/icons/chains/trx.png'),
  usdb: require('../assets/icons/chains/usdb.png'),
  usdc: require('../assets/icons/chains/usdc.png'),
  usdce: require('../assets/icons/chains/usdce.png'),
  usde: require('../assets/icons/chains/usde.png'),
  usdt: require('../assets/icons/chains/usdt.png'),
  wbtc: require('../assets/icons/chains/wbtc.png'),
  xrp: require('../assets/icons/chains/xrp.png'),
  zcash: require('../assets/icons/chains/zcash.png'),
};

export const CHAIN_META: Record<string, { label: string; iconFile: string; color: string }> = {
  ethereum: { label: 'Ethereum', iconFile: 'ethereum', color: '#627EEA' },
  base: { label: 'Base', iconFile: 'base', color: '#0052FF' },
  arbitrum: { label: 'Arbitrum', iconFile: 'arbitrum', color: '#28A0F0' },
  optimism: { label: 'Optimism', iconFile: 'optimism', color: '#FF0420' },
  polygon: { label: 'Polygon', iconFile: 'polygon', color: '#8247E5' },
  solana: { label: 'Solana', iconFile: 'solana', color: '#14F195' },
  tron: { label: 'Tron', iconFile: 'tron', color: '#EF0027' },
  plasma: { label: 'Plasma', iconFile: 'plasma', color: '#7DD3C0' },
  tempo: { label: 'Tempo', iconFile: 'tempo', color: '#9CA3AF' },
  bitcoin: { label: 'Bitcoin', iconFile: 'bitcoin', color: '#F7931A' },
  lightning: { label: 'Lightning', iconFile: 'lightning', color: '#FACC15' },
  spark: { label: 'Spark', iconFile: 'spark', color: '#60A5FA' },
  avalanche: { label: 'Avalanche', iconFile: 'avalanche', color: '#E84142' },
  bsc: { label: 'BNB Chain', iconFile: 'bnb', color: '#F3BA2F' },
  hypercore: { label: 'HyperCore', iconFile: 'hypercore', color: '#97FCE4' },
  hyperevm: { label: 'HyperEVM', iconFile: 'hyperevm', color: '#97FCE4' },
  litecoin: { label: 'Litecoin', iconFile: 'litecoin', color: '#345D9D' },
  monad: { label: 'Monad', iconFile: 'monad', color: '#836EF9' },
  ton: { label: 'TON', iconFile: 'ton', color: '#0098EA' },
  xrp: { label: 'XRP', iconFile: 'xrp', color: '#9CA3AF' },
  zcash: { label: 'Zcash', iconFile: 'zcash', color: '#F4B728' },
};

const ASSET_ICON: Record<string, string> = {
  BTC: 'btc',
  USDC: 'usdc',
  USDT: 'usdt',
  ETH: 'eth',
  SOL: 'sol',
  USDB: 'usdb',
  TRX: 'trx',
  PATHUSD: 'usdc',
  'USDC.E': 'usdce',
  DAI: 'dai',
  WBTC: 'wbtc',
  USDE: 'usde',
  LTC: 'litecoin',
  MON: 'monad',
  ZEC: 'zcash',
};

/** Chain artwork, or undefined for chains we ship none for (callers show an initial). */
export function chainIcon(chain: string): ImageSourcePropType | undefined {
  const file = CHAIN_META[chain.toLowerCase()]?.iconFile;
  return file ? ICONS[file] : undefined;
}

export function assetIcon(ticker: string): ImageSourcePropType | undefined {
  const file = ASSET_ICON[ticker.toUpperCase()] ?? ticker.toLowerCase();
  return ICONS[file];
}

export function chainLabel(chain: string): string {
  return CHAIN_META[chain.toLowerCase()]?.label ?? chain.charAt(0).toUpperCase() + chain.slice(1);
}

export function chainColor(chain: string): string | undefined {
  return CHAIN_META[chain.toLowerCase()]?.color;
}

export const STATUS_LABELS: Record<OrchestraOrderStatus, string> = {
  processing: 'Processing',
  confirming: 'Confirming',
  bridging: 'Bridging',
  swapping: 'Swapping',
  awaiting_approval: 'Awaiting approval',
  refunding: 'Refunding',
  delivering: 'Delivering',
  completed: 'Completed',
  failed: 'Failed',
  refunded: 'Refunded',
};

export const STATUS_PIPELINE: OrchestraOrderStatus[] = [
  'processing',
  'confirming',
  'bridging',
  'swapping',
  'delivering',
  'completed',
];

export const TERMINAL_STATUSES = new Set<OrchestraOrderStatus>(['completed', 'failed', 'refunded']);

/** Consecutive failed status polls tolerated before telling the user. */
export const POLL_FAILURES_BEFORE_SURFACING = 3;

export function describePollFailure(rawMessage: string): string {
  if (rawMessage.includes(ORCHESTRA_ORIGIN_ERROR_CODE)) return 'tracking unavailable';
  if (rawMessage.includes(ORCHESTRA_AUTH_ERROR_CODE)) return 'service rejected the request';
  if (/failed to fetch|network/i.test(rawMessage)) return 'no connection';
  return 'status service unreachable';
}
