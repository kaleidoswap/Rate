/**
 * Atomic BTC L1 <-> USDT-RGB L1 swaps against the KaleidoSwap maker
 * (`/v2/swap/atomic/*`), in plain JS.
 *
 * A port of @kaleidorg/swap-sdk's `AtomicSwaps` (src/swaps/atomic.rs): the
 * SDK's client lives in its wasm entry, which the mobile build stubs out (see
 * metro.config.js), so the checks are carried over here one for one. One
 * transaction moves both legs: no HTLC, no refund. The maker quotes and hands
 * out rgb-lib's offer; the wallet's rgb-lib accepts it (`accept_swap_offer`),
 * signs the proposal (`complete_swap_proposal`) and, once settled, accepts the
 * transfers (`accept_swap_transfers`). This client verifies every maker answer
 * before it reaches the wallet: rgb-lib signs whatever terms the offer states,
 * so the offer has to be tied to the quote, and the quote to what was asked.
 *
 * rgb-lib messages cross as JSON text, parsed losslessly (./losslessJson.ts):
 * their 64-bit fields do not survive JS numbers.
 */
import {
  JsonNumber, field, i64, losslessEqual, parseLossless, stringifyLossless, u64, type LosslessValue,
} from './losslessJson';

/** Send BTC, receive USDT-RGB. */
export const ATOMIC_BTC_TO_USDT_RGB = 'BTC/USDT-RGB';
/** Send USDT-RGB, receive BTC. */
export const ATOMIC_USDT_RGB_TO_BTC = 'USDT-RGB/BTC';
export type AtomicPairName = typeof ATOMIC_BTC_TO_USDT_RGB | typeof ATOMIC_USDT_RGB_TO_BTC;

/** Which amount of a quote request is fixed: what the taker sends or receives. */
export type AtomicAmountDirection = 'from' | 'to';

export interface AtomicQuoteRequest {
  pair: AtomicPairName;
  /** Sats for BTC, the RGB contract's smallest unit for the asset. */
  amount: bigint;
  direction?: AtomicAmountDirection;
}

/**
 * What the caller expects of a quote, beyond what it asked for. Amounts are in
 * each asset's base units: sats, or USDT-RGB's 6-decimal units.
 */
export interface AtomicQuoteExpectations {
  /** The USDT-RGB contract id the wallet trades. */
  assetId: string;
  /** rgb-lib's `BitcoinNetwork` of the wallet (see {@link atomicBitcoinNetwork}). */
  bitcoinNetwork: string;
  /** RGB proxy the wallet requires, if any. */
  proxyUrl?: string;
  /** Ceiling on the miner fee the taker funds, sats. */
  maxNetworkFeeSat?: bigint;
  /** Ceiling on the fee the maker declares. Not price protection: use minToAmount / maxFromAmount. */
  maxServiceFee?: bigint;
  /** For a `from` quote: the least the taker accepts to receive. */
  minToAmount?: bigint;
  /** For a `to` quote: the most the taker accepts to send. */
  maxFromAmount?: bigint;
  /** Longest the offer may stay open, seconds from now. */
  maxOfferTtlSecs?: bigint;
  /** Ceiling on the sats each RGB receive output carries. */
  maxRgbOutputSat?: bigint;
}

export interface AtomicOutpoint {
  txid: string;
  vout: number;
}

/** A quote that passed verification. */
export interface AtomicQuote {
  id: string;
  pair: AtomicPairName;
  direction: AtomicAmountDirection;
  /** What the taker sends. */
  fromAmount: bigint;
  /** What the taker receives, net of the maker's fee. */
  toAmount: bigint;
  assetId: string;
  /** Miner fee the taker funds on top of `fromAmount`, sats. */
  networkFeeSat: bigint;
  /** The maker's fee, in the output asset's units. */
  serviceFee: bigint;
  /** Unix seconds: post the request before this. */
  expiresAt: bigint;
  /** Unix seconds: post the completion before this. */
  offerExpiresAt: bigint;
  /** rgb-lib `OnchainSwapOffer` JSON, for the wallet's `accept_swap_offer`. */
  offer: string;
}

export interface AtomicProposal {
  id: string;
  status: string;
  /** rgb-lib `OnchainSwapProposal` JSON, for `complete_swap_proposal`. */
  proposal: string;
  /** The coins the proposal says are the maker's: none is the wallet's, none repeats. */
  makerInputs: AtomicOutpoint[];
}

export interface AtomicCompletion {
  id: string;
  status: string;
  txid: string;
  /** Finalized rgb-lib `OnchainSwapCompletion` JSON, for `accept_swap_transfers`. */
  completion: string;
}

export type AtomicSwapState =
  | 'swap.created'
  | 'swap.requested'
  | 'transaction.proposed'
  | 'transaction.mempool'
  | 'transaction.confirmed'
  | 'transaction.claimed'
  | 'swap.expired'
  | 'swap.cancelled'
  | 'transaction.failed';

const ATOMIC_STATES: ReadonlySet<string> = new Set<AtomicSwapState>([
  'swap.created', 'swap.requested', 'transaction.proposed', 'transaction.mempool', 'transaction.confirmed',
  'transaction.claimed', 'swap.expired', 'swap.cancelled', 'transaction.failed',
]);

/** No update follows these; `transaction.claimed` is the success. */
export const ATOMIC_TERMINAL_STATES: ReadonlySet<AtomicSwapState> = new Set<AtomicSwapState>([
  'transaction.claimed', 'swap.expired', 'swap.cancelled', 'transaction.failed',
]);

export interface AtomicSwapStatus {
  id: string;
  pair: string;
  status: AtomicSwapState;
  /** The maker's internal state, for diagnostics. */
  state: string;
  fromAmount: bigint;
  toAmount: bigint;
  assetId: string;
  networkFeeSat: bigint;
  txid: string | null;
  confirmations: number;
  expiresAt: bigint;
  offerExpiresAt: bigint;
  createdAt: bigint;
}

export interface AtomicPairCard {
  hash: string;
  rate: number;
  limits: { minimal: bigint; maximal: bigint };
  fees: { percentage: number; minerFees: bigint };
}

/** from currency -> to currency -> card; empty while the maker serves none (the live signet maker today). */
export type AtomicPairs = Record<string, Record<string, AtomicPairCard>>;

export type AtomicSwapErrorCode = 'Protocol' | 'Http' | 'Generic';

/** `Protocol`: the maker answered something this client refuses. `Http`: the maker refused or was unreachable. */
export class AtomicSwapError extends Error {
  constructor(readonly code: AtomicSwapErrorCode, message: string, readonly status?: number) {
    super(message);
    this.name = 'AtomicSwapError';
  }
}

const protocol = (message: string) => new AtomicSwapError('Protocol', message);

type Network = 'mainnet' | 'mutinynet' | 'signet' | 'testnet' | 'regtest';
const RGB_LIB_NETWORK: Record<Network, string> = {
  mainnet: 'Mainnet',
  // Mutinynet is rgb-lib's custom signet, the chain the signet maker settles on.
  mutinynet: 'SignetCustom',
  signet: 'Signet',
  testnet: 'Testnet',
  regtest: 'Regtest',
};

/** rgb-lib's `BitcoinNetwork` name for an app network, as offers spell it. */
export function atomicBitcoinNetwork(network: Network): string {
  return RGB_LIB_NETWORK[network];
}

/** The maker's `/v2` base from its root or `/v2` URL. */
export function atomicMakerBase(makerUrl: string): string {
  const root = makerUrl.replace(/\/+$/, '');
  return /\/v2$/.test(root) ? root : `${root}/v2`;
}

// ---------------------------------------------------------------------------
// Reading maker answers
// ---------------------------------------------------------------------------

function object(value: LosslessValue | undefined, what: string): { [key: string]: LosslessValue } {
  if (value === null || value === undefined || typeof value !== 'object' || Array.isArray(value) || value instanceof JsonNumber) {
    throw protocol(`${what} is not a JSON object`);
  }
  return value;
}

function str(value: LosslessValue | undefined, what: string): string {
  if (typeof value !== 'string') throw protocol(`${what} is not a string`);
  return value;
}

function optStr(value: LosslessValue | undefined, what: string): string | null {
  return value === undefined || value === null ? null : str(value, what);
}

function uint(value: LosslessValue | undefined, what: string): bigint {
  const n = u64(value);
  if (n === undefined) throw protocol(`${what} is not an unsigned integer`);
  return n;
}

function int(value: LosslessValue | undefined, what: string): bigint {
  const n = i64(value);
  if (n === undefined) throw protocol(`${what} is not an integer`);
  return n;
}

function float(value: LosslessValue | undefined, what: string): number {
  const n = value instanceof JsonNumber ? Number(value.raw) : NaN;
  if (!Number.isFinite(n)) throw protocol(`${what} is not a number`);
  return n;
}

/** A wire integer that is a JSON number, not a string (serde's u64 on the maker's own fields). */
function wireUint(value: LosslessValue | undefined, what: string): bigint {
  if (!(value instanceof JsonNumber)) throw protocol(`${what} is not an unsigned integer`);
  return uint(value, what);
}

/** rgb-lib JSON text in from the wallet: must be an object. */
function walletJson(text: string, what: string): LosslessValue {
  if (typeof text !== 'string') throw new AtomicSwapError('Generic', `${what} must be rgb-lib JSON text`);
  let value: LosslessValue;
  try {
    value = parseLossless(text);
  } catch (e) {
    throw new AtomicSwapError('Generic', `${what} is not JSON: ${(e as Error).message}`);
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value) || value instanceof JsonNumber) {
    throw new AtomicSwapError('Generic', `${what} is not a JSON object`);
  }
  return value;
}

const TXID = /^[0-9a-fA-F]{64}$/;

/** Canonical (lowercase) outpoint key, or undefined when the txid is not one. */
function outpointKey(txid: unknown, vout: unknown): string | undefined {
  if (typeof txid !== 'string' || !TXID.test(txid)) return undefined;
  if (typeof vout !== 'number' || !Number.isInteger(vout) || vout < 0 || vout > 0xffff_ffff) return undefined;
  return `${txid.toLowerCase()}:${vout}`;
}

/** The outpoints of an rgb-lib input list (`[{ "outpoint": { "txid", "vout" } }]`); none for a missing list. */
function inputOutpoints(inputs: LosslessValue | undefined, what: string): AtomicOutpoint[] {
  if (inputs === undefined) return [];
  const malformed = () => protocol(`atomic swap ${what} is not a list of inputs`);
  if (!Array.isArray(inputs)) throw malformed();
  return inputs.map((input) => {
    const outpoint = field(input, 'outpoint');
    const txid = field(outpoint, 'txid');
    const rawVout = field(outpoint, 'vout');
    const vout = u64(rawVout);
    if (typeof txid !== 'string' || !TXID.test(txid) || vout === undefined || vout > 0xffff_ffffn) throw malformed();
    return { txid: txid.toLowerCase(), vout: Number(vout) };
  });
}

function walletKeys(wallet: readonly AtomicOutpoint[]): Set<string> {
  const keys = new Set<string>();
  for (const outpoint of wallet) {
    const key = outpointKey(outpoint?.txid, outpoint?.vout);
    if (!key) throw new AtomicSwapError('Generic', `wallet outpoint ${outpoint?.txid}:${outpoint?.vout} does not name a txid`);
    keys.add(key);
  }
  return keys;
}

/**
 * `wallet` must be every coin the wallet holds (rgb-lib's list_unspents): it
 * must hold the request's own taker_inputs, which catches an empty or partial
 * list passed by mistake.
 */
export function checkWalletOutpoints(request: LosslessValue, wallet: readonly AtomicOutpoint[]): void {
  const keys = walletKeys(wallet);
  for (const input of inputOutpoints(field(request, 'taker_inputs'), "request's taker_inputs")) {
    if (!keys.has(`${input.txid}:${input.vout}`)) {
      throw new AtomicSwapError(
        'Generic',
        `wallet outpoints must be every outpoint the wallet holds (list_unspents); they lack the request's own input ${input.txid}:${input.vout}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Quote verification
// ---------------------------------------------------------------------------

interface ParsedQuote extends Omit<AtomicQuote, 'offer' | 'pair'> {
  pair: string;
  offer: LosslessValue;
}

function parseQuote(body: LosslessValue): ParsedQuote {
  const q = object(body, 'atomic quote');
  const direction = str(q.direction, 'quote direction');
  if (direction !== 'from' && direction !== 'to') throw protocol(`atomic quote has an unknown direction ${direction}`);
  if (!('offer' in q)) throw protocol('atomic quote has no offer');
  return {
    id: str(q.id, 'quote id'),
    pair: str(q.pair, 'quote pair'),
    direction,
    fromAmount: wireUint(q.fromAmount, 'quote fromAmount'),
    toAmount: wireUint(q.toAmount, 'quote toAmount'),
    assetId: str(q.assetId, 'quote assetId'),
    networkFeeSat: wireUint(q.networkFeeSat, 'quote networkFeeSat'),
    serviceFee: wireUint(q.serviceFee, 'quote serviceFee'),
    expiresAt: int(q.expiresAt, 'quote expiresAt'),
    offerExpiresAt: int(q.offerExpiresAt, 'quote offerExpiresAt'),
    offer: q.offer,
  };
}

interface OfferLeg { kind: 'Btc' | 'Rgb'; assetId: string | null; amount: bigint }

const describeLeg = (leg: OfferLeg) =>
  leg.kind === 'Btc' ? `${leg.amount} sat BTC` : leg.assetId ? `${leg.amount} units of ${leg.assetId}` : `${leg.amount} units of an unnamed RGB asset`;

/**
 * Check the quote before its offer goes to the wallet: it must answer
 * `request`, match `expect`, be unexpired at `now` (unix seconds), and carry
 * an offer whose legs, miner fee and expiry are the quote's, with no platform
 * fee. The wallet signs the offer, not the quote, so the offer has to match.
 */
export function verifyAtomicQuote(
  quote: ParsedQuote,
  request: Required<AtomicQuoteRequest>,
  expect: AtomicQuoteExpectations,
  now: bigint,
): void {
  const mismatch = (what: string) => protocol(`atomic quote ${quote.id}: ${what}`);
  if (quote.pair !== request.pair) throw mismatch(`is for pair ${quote.pair}, not ${request.pair}`);
  let takerSendsBtc: boolean;
  if (quote.pair === ATOMIC_BTC_TO_USDT_RGB) takerSendsBtc = true;
  else if (quote.pair === ATOMIC_USDT_RGB_TO_BTC) takerSendsBtc = false;
  else throw mismatch(`unknown atomic pair ${quote.pair}`);
  if (quote.direction !== request.direction) {
    throw mismatch(`fixes the ${quote.direction} amount, the request fixed ${request.direction}`);
  }
  const fixed = request.direction === 'from' ? quote.fromAmount : quote.toAmount;
  if (fixed !== request.amount) throw mismatch(`quotes ${fixed} for the fixed amount, the request asked ${request.amount}`);
  if (quote.fromAmount === 0n || quote.toAmount === 0n) throw mismatch('has a zero amount');
  if (quote.assetId !== expect.assetId) throw mismatch(`is for asset ${quote.assetId}, the wallet trades ${expect.assetId}`);
  if (expect.maxNetworkFeeSat !== undefined && quote.networkFeeSat > expect.maxNetworkFeeSat) {
    throw mismatch(`asks a ${quote.networkFeeSat} sat miner fee, over the ${expect.maxNetworkFeeSat} sat ceiling`);
  }
  if (expect.maxServiceFee !== undefined && quote.serviceFee > expect.maxServiceFee) {
    throw mismatch(`charges a ${quote.serviceFee} service fee, over the ${expect.maxServiceFee} ceiling`);
  }
  if (quote.direction === 'from' && expect.minToAmount !== undefined && quote.toAmount < expect.minToAmount) {
    throw mismatch(`pays ${quote.toAmount}, under the ${expect.minToAmount} minimum`);
  }
  if (quote.direction === 'to' && expect.maxFromAmount !== undefined && quote.fromAmount > expect.maxFromAmount) {
    throw mismatch(`costs ${quote.fromAmount}, over the ${expect.maxFromAmount} maximum`);
  }
  if (now >= quote.expiresAt) throw mismatch(`expired at ${quote.expiresAt} (now ${now})`);
  if (quote.offerExpiresAt < quote.expiresAt) {
    throw mismatch(`offer expires at ${quote.offerExpiresAt}, before the request deadline ${quote.expiresAt}`);
  }
  if (expect.maxOfferTtlSecs !== undefined) {
    const ttl = quote.offerExpiresAt - now;
    if (ttl > expect.maxOfferTtlSecs) throw mismatch(`offer stays open ${ttl}s, over the ${expect.maxOfferTtlSecs}s maximum`);
  }
  verifyOffer(quote, takerSendsBtc, expect, mismatch);
}

function verifyOffer(
  quote: ParsedQuote,
  takerSendsBtc: boolean,
  expect: AtomicQuoteExpectations,
  mismatch: (what: string) => AtomicSwapError,
): void {
  const notAnOffer = (why: string) => mismatch(`offer is not an rgb-lib swap offer: ${why}`);
  const offer = quote.offer;
  if (offer === null || typeof offer !== 'object' || Array.isArray(offer) || offer instanceof JsonNumber) throw notAnOffer('not an object');
  const required = (key: string) => {
    const v = field(offer, key);
    if (v === undefined) throw notAnOffer(`missing field ${key}`);
    return v;
  };
  const amount = (v: LosslessValue | undefined, key: string) => {
    const n = u64(v);
    if (n === undefined) throw notAnOffer(`${key} is not an unsigned integer`);
    return n;
  };
  const optAmount = (key: string) => {
    const v = field(offer, key);
    return v === undefined || v === null ? undefined : amount(v, key);
  };
  const optText = (key: string) => {
    const v = field(offer, key);
    if (v === undefined || v === null) return null;
    if (typeof v !== 'string') throw notAnOffer(`${key} is not a string`);
    return v;
  };
  const leg = (key: string): OfferLeg => {
    const v = required(key);
    const kind = field(v, 'kind');
    if (kind !== 'Btc' && kind !== 'Rgb') throw notAnOffer(`${key}.kind is not Btc or Rgb`);
    const assetId = field(v, 'asset_id');
    if (assetId !== undefined && assetId !== null && typeof assetId !== 'string') throw notAnOffer(`${key}.asset_id is not a string`);
    return { kind, assetId: assetId ?? null, amount: amount(field(v, 'amount'), `${key}.amount`) };
  };

  const swapId = required('swap_id');
  if (typeof swapId !== 'string') throw notAnOffer('swap_id is not a string');
  const makerGives = leg('maker_gives');
  const makerReceives = leg('maker_receives');
  const bitcoinNetwork = required('bitcoin_network');
  if (typeof bitcoinNetwork !== 'string') throw notAnOffer('bitcoin_network is not a string');
  const networkFeeSat = amount(required('network_fee_sat'), 'network_fee_sat');
  const rgbOutputSat = optAmount('rgb_output_sat');
  const expiration = optAmount('expiration_timestamp');
  const makerBtcAddress = optText('maker_btc_address');
  const makerRgbRecipientId = optText('maker_rgb_recipient_id');
  const proxyUrl = optText('proxy_url');
  const platformFeeSat = optAmount('platform_fee_sat');
  const feeRecipient = optText('fee_recipient_script_pubkey_hex');

  if (swapId === '') throw mismatch('offer has no swap_id');
  const btc = (n: bigint): OfferLeg => ({ kind: 'Btc', assetId: null, amount: n });
  const rgb = (n: bigint): OfferLeg => ({ kind: 'Rgb', assetId: quote.assetId, amount: n });
  const [gives, receives] = takerSendsBtc ? [rgb(quote.toAmount), btc(quote.fromAmount)] : [btc(quote.toAmount), rgb(quote.fromAmount)];
  const sameLeg = (a: OfferLeg, b: OfferLeg) => a.kind === b.kind && a.assetId === b.assetId && a.amount === b.amount;
  if (!sameLeg(makerGives, gives)) throw mismatch(`offer gives ${describeLeg(makerGives)}, the quote ${describeLeg(gives)}`);
  if (!sameLeg(makerReceives, receives)) throw mismatch(`offer takes ${describeLeg(makerReceives)}, the quote ${describeLeg(receives)}`);
  if (networkFeeSat !== quote.networkFeeSat) {
    throw mismatch(`offer reserves a ${networkFeeSat} sat miner fee, the quote ${quote.networkFeeSat}`);
  }
  if (expect.maxRgbOutputSat !== undefined) {
    if (rgbOutputSat === undefined) throw mismatch('offer does not say what its RGB output carries');
    if (rgbOutputSat > expect.maxRgbOutputSat) {
      throw mismatch(`offer puts ${rgbOutputSat} sat in each RGB output, more than ${expect.maxRgbOutputSat}`);
    }
  }
  if ((platformFeeSat ?? 0n) !== 0n || feeRecipient !== null) throw mismatch('offer adds a platform fee the quote does not show');
  if (expiration === undefined || expiration !== quote.offerExpiresAt) {
    throw mismatch(`offer expires at ${expiration ?? 'never'}, the quote at ${quote.offerExpiresAt}`);
  }
  if (bitcoinNetwork !== expect.bitcoinNetwork) throw mismatch(`offer is for ${bitcoinNetwork}, the wallet is on ${expect.bitcoinNetwork}`);
  if (expect.proxyUrl !== undefined && proxyUrl !== expect.proxyUrl) {
    throw mismatch(`offer uses proxy ${proxyUrl ?? 'none'}, the wallet ${expect.proxyUrl}`);
  }
  const makerReceiveNamed = takerSendsBtc ? makerBtcAddress !== null : makerRgbRecipientId !== null;
  if (!makerReceiveNamed) throw mismatch('offer names no maker receive destination');
}

// ---------------------------------------------------------------------------
// Proposal and completion checks
// ---------------------------------------------------------------------------

/**
 * The proposal must answer the request that was posted (rgb-lib embeds it),
 * and list none of the taker's coins as the maker's: rgb-lib before
 * kaleidoswap/rgb-lib#18 would sign such a coin and hand its value to the maker.
 */
export function checkAtomicProposal(
  id: string,
  request: LosslessValue,
  answerId: string,
  proposal: LosslessValue,
  wallet: readonly AtomicOutpoint[],
): AtomicOutpoint[] {
  if (answerId !== id) throw protocol(`atomic swap ${id}: proposal answers swap ${answerId}`);
  if (!losslessEqual(field(proposal, 'request'), request)) {
    throw protocol(`atomic swap ${id}: proposal is not for the request that was sent`);
  }
  checkWalletOutpoints(request, wallet);
  const keys = walletKeys(wallet);
  const maker = inputOutpoints(field(proposal, 'maker_inputs'), "proposal's maker_inputs");
  const seen = new Set<string>();
  for (const outpoint of maker) {
    const key = `${outpoint.txid}:${outpoint.vout}`;
    if (keys.has(key)) throw protocol(`atomic swap ${id}: proposal lists the taker's own coin ${key} as the maker's`);
    if (seen.has(key)) throw protocol(`atomic swap ${id}: proposal lists the maker's input ${key} twice`);
    seen.add(key);
  }
  return maker;
}

/** The broadcast must be the completion that was signed. */
export function checkAtomicCompletion(id: string, completion: LosslessValue, answerId: string, answerTxid: string, finalized: LosslessValue): void {
  if (answerId !== id) throw protocol(`atomic swap ${id}: completion answers swap ${answerId}`);
  const sent = field(completion, 'txid');
  if (typeof sent !== 'string' || sent !== answerTxid) {
    throw protocol(`atomic swap ${id}: maker broadcast ${answerTxid}, the signed completion is ${typeof sent === 'string' ? sent : 'missing'}`);
  }
  if (!losslessEqual(field(finalized, 'proposal'), field(completion, 'proposal'))) {
    throw protocol(`atomic swap ${id}: finalized completion is for another proposal`);
  }
}

// ---------------------------------------------------------------------------
// The client
// ---------------------------------------------------------------------------

export interface AtomicSwapClientOptions {
  fetchImpl?: typeof fetch;
  /** Per request. Default 30 s. */
  timeoutMs?: number;
}

export interface AtomicTrackOptions {
  /** Delay between status reads. Default 5 s. */
  intervalMs?: number;
  /** Called with every status read, before the terminal check. */
  onStatus?: (status: AtomicSwapStatus) => void;
  signal?: AbortSignal;
}

export class AtomicSwapClient {
  private readonly base: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  /** `makerUrl`: the maker's root or its `/v2` URL. */
  constructor(makerUrl: string, { fetchImpl, timeoutMs = 30_000 }: AtomicSwapClientOptions = {}) {
    this.base = atomicMakerBase(makerUrl);
    this.fetchImpl = fetchImpl ?? ((...args) => fetch(...args));
    this.timeoutMs = timeoutMs;
  }

  private async send(path: string, body?: string): Promise<LosslessValue> {
    const controller = typeof AbortController === 'function' ? new AbortController() : undefined;
    const timer = controller ? setTimeout(() => controller.abort(), this.timeoutMs) : undefined;
    let response: Response;
    let text: string;
    try {
      response = await this.fetchImpl(`${this.base}/${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: body === undefined ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json' },
        body,
        signal: controller?.signal,
      });
      text = await response.text();
    } catch (e) {
      throw new AtomicSwapError('Http', `maker unreachable: ${(e as Error)?.message ?? e}`);
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (!response.ok) {
      let message = text.slice(0, 300);
      try {
        const error = field(parseLossless(text), 'error');
        if (typeof error === 'string') message = error;
      } catch { /* not JSON: keep the text */ }
      throw new AtomicSwapError('Http', `maker answered ${response.status}: ${message}`, response.status);
    }
    try {
      return parseLossless(text);
    } catch (e) {
      throw protocol(`maker answered invalid JSON: ${(e as Error).message}`);
    }
  }

  /** `GET /v2/swap/atomic/pairs`. */
  async pairs(): Promise<AtomicPairs> {
    const body = object(await this.send('swap/atomic/pairs'), 'atomic pairs');
    const pairs: AtomicPairs = {};
    for (const [from, tos] of Object.entries(body)) {
      pairs[from] = {};
      for (const [to, raw] of Object.entries(object(tos, `atomic pairs ${from}`))) {
        const card = object(raw, `atomic pair ${from}/${to}`);
        const limits = object(card.limits, `atomic pair ${from}/${to} limits`);
        const fees = object(card.fees, `atomic pair ${from}/${to} fees`);
        pairs[from][to] = {
          hash: str(card.hash, 'pair hash'),
          rate: float(card.rate, 'pair rate'),
          limits: { minimal: uint(limits.minimal, 'pair minimal'), maximal: uint(limits.maximal, 'pair maximal') },
          fees: { percentage: float(fees.percentage, 'pair fee percentage'), minerFees: uint(fees.minerFees, 'pair minerFees') },
        };
      }
    }
    return pairs;
  }

  /**
   * `POST /v2/swap/atomic/quote`, verified (see {@link verifyAtomicQuote})
   * before it is returned. Never hand an unverified offer to the wallet.
   */
  async quote(
    request: AtomicQuoteRequest,
    expect: AtomicQuoteExpectations,
    nowSecs: bigint = BigInt(Math.floor(Date.now() / 1000)),
  ): Promise<AtomicQuote> {
    const asked: Required<AtomicQuoteRequest> = { direction: 'from', ...request };
    if (asked.amount <= 0n) throw new AtomicSwapError('Generic', 'amount must be positive');
    const body = await this.send('swap/atomic/quote', stringifyLossless({ pair: asked.pair, amount: asked.amount, direction: asked.direction }));
    const parsed = parseQuote(body);
    verifyAtomicQuote(parsed, asked, expect, nowSecs);
    return { ...parsed, pair: parsed.pair as AtomicPairName, offer: stringifyLossless(parsed.offer) };
  }

  /**
   * `POST /v2/swap/atomic/{id}/request` with the wallet's `OnchainSwapRequest`
   * JSON. `walletOutpoints`: every coin the wallet holds (rgb-lib's
   * list_unspents), including the request's own inputs.
   */
  async request(swapId: string, requestJson: string, walletOutpoints: readonly AtomicOutpoint[]): Promise<AtomicProposal> {
    const request = walletJson(requestJson, 'the swap request');
    checkWalletOutpoints(request, walletOutpoints);
    const body = object(
      await this.send(`swap/atomic/${encodeURIComponent(swapId)}/request`, stringifyLossless({ request })),
      'atomic proposal',
    );
    const id = str(body.id, 'proposal id');
    const proposal = body.proposal;
    if (proposal === undefined) throw protocol(`atomic swap ${swapId}: answer has no proposal`);
    const makerInputs = checkAtomicProposal(swapId, request, id, proposal, walletOutpoints);
    return { id, status: str(body.status, 'proposal status'), proposal: stringifyLossless(proposal), makerInputs };
  }

  /** `POST /v2/swap/atomic/{id}/complete` with the wallet's signed completion. The maker signs last and broadcasts. */
  async complete(swapId: string, completionJson: string): Promise<AtomicCompletion> {
    const completion = walletJson(completionJson, 'the swap completion');
    const body = object(
      await this.send(`swap/atomic/${encodeURIComponent(swapId)}/complete`, stringifyLossless({ completion })),
      'atomic completion',
    );
    const id = str(body.id, 'completion id');
    const txid = str(body.txid, 'completion txid');
    const finalized = body.completion;
    if (finalized === undefined) throw protocol(`atomic swap ${swapId}: answer has no completion`);
    checkAtomicCompletion(swapId, completion, id, txid, finalized);
    return { id, status: str(body.status, 'completion status'), txid, completion: stringifyLossless(finalized) };
  }

  /** `GET /v2/swap/atomic/{id}`. */
  async status(swapId: string): Promise<AtomicSwapStatus> {
    const s = object(await this.send(`swap/atomic/${encodeURIComponent(swapId)}`), 'atomic swap status');
    const status = str(s.status, 'swap status');
    if (!ATOMIC_STATES.has(status)) throw protocol(`atomic swap ${swapId}: unknown status ${status}`);
    const confirmations = uint(s.confirmations, 'swap confirmations');
    if (confirmations > 0xffff_ffffn) throw protocol(`atomic swap ${swapId}: confirmations out of range`);
    return {
      id: str(s.id, 'swap id'),
      pair: str(s.pair, 'swap pair'),
      status: status as AtomicSwapState,
      state: str(s.state, 'swap state'),
      fromAmount: uint(s.fromAmount, 'swap fromAmount'),
      toAmount: uint(s.toAmount, 'swap toAmount'),
      assetId: str(s.assetId, 'swap assetId'),
      networkFeeSat: uint(s.networkFeeSat, 'swap networkFeeSat'),
      txid: optStr(s.txid, 'swap txid'),
      confirmations: Number(confirmations),
      expiresAt: int(s.expiresAt, 'swap expiresAt'),
      offerExpiresAt: int(s.offerExpiresAt, 'swap offerExpiresAt'),
      createdAt: int(s.createdAt, 'swap createdAt'),
    };
  }

  /** Poll {@link status} until a terminal state, and resolve with it. */
  async track(swapId: string, { intervalMs = 5_000, onStatus, signal }: AtomicTrackOptions = {}): Promise<AtomicSwapStatus> {
    for (;;) {
      if (signal?.aborted) throw signal.reason ?? new Error('aborted');
      const status = await this.status(swapId);
      onStatus?.(status);
      if (ATOMIC_TERMINAL_STATES.has(status.status)) return status;
      await new Promise<void>((resolve, reject) => {
        // `onStatus` may have aborted already: no 'abort' event would follow.
        if (signal?.aborted) return reject(signal.reason ?? new Error('aborted'));
        const onAbort = () => {
          clearTimeout(timer);
          reject(signal!.reason ?? new Error('aborted'));
        };
        const timer = setTimeout(() => {
          signal?.removeEventListener('abort', onAbort);
          resolve();
        }, intervalMs);
        signal?.addEventListener('abort', onAbort, { once: true });
      });
    }
  }
}
