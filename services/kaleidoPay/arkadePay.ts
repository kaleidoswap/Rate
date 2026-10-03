/**
 * Arkade as KaleidoPay accounts:
 *  - `arkade`: pays an Ark address on this wallet's own Ark server directly, and pays
 *    Lightning invoices through Arkade Intents solvers (see ./arkadeIntents.ts);
 *  - `arkade-onchain`: pays a bitcoin address by a collaborative exit (offboard).
 *
 * Fees come from the Ark server's own fee table (`getInfo().fees`). A fee the server
 * does not state is unknown, and an unknown fee is never shown as 0: the option is
 * then unavailable instead.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Address, NETWORK, OutScript, TEST_NETWORK } from '@scure/btc-signer';
import { registerKaleidoPayAccount } from './index';
import type { AccountQuoteOption, Network, PayAccount, PaymentResult, Preview, Quote, Route } from './index';
import { PaymentNotSentError } from './errors';
import { ARKADE_INTENTS_SWAP_ID, createArkadeIntentsSwap } from './arkadeIntents';
import type { ArkadeSwapStore } from '@kaleidorg/swap-sdk/arkade';

/** The ArkadeWdkAdapter surface used here. `arkInfo`, `arkSdk` and `rawWallet` are adapter internals. */
export interface ArkadePayAdapter {
  sendPayment(request: { invoice: string; amount?: number }): Promise<any>;
  offboard?(address: string, amount?: number): Promise<{ txid: string }>;
  getBtcBalance(): Promise<{ confirmed: number }>;
  isConnected?(): boolean;
}
interface ArkadeInternals {
  arkInfo?: { signerPubkey?: string; network?: string; fees?: { txFeeRate?: string; intentFee?: Record<string, string | undefined> } } | null;
  arkSdk?: { ArkAddress?: { decode(address: string): { serverPubKey: Uint8Array } }; Estimator?: new (config: Record<string, unknown>) => { evalOnchainOutput(o: { amount: bigint; script: string }): { satoshis: number } } } | null;
  rawWallet?: any;
}

const QUOTE_TTL_S = 120;
const FEE_UNAVAILABLE = 'Arkade did not report its fee for this payment, so a complete quote is not available.';
const internals = (adapter: ArkadePayAdapter) => adapter as unknown as ArkadeInternals;
const toHex = (bytes: Uint8Array) => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');

/** A fee number the server states (sats, or sat/vB); '' / missing / malformed is unknown. */
function statedNumber(value: unknown): number | null {
  if (typeof value !== 'string' || value.trim() === '' || !/^\d+(\.\d+)?$/.test(value.trim())) return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Fee of an out-of-round Ark transaction: the adapter's 150 vB at the server's txFeeRate. */
export function arkadeOffchainFee(adapter: ArkadePayAdapter): number | null {
  const rate = statedNumber(internals(adapter).arkInfo?.fees?.txFeeRate);
  return rate === null ? null : Math.ceil(150 * rate);
}

/**
 * Fee of a collaborative exit delivering `amountSat` to `address`. Ramps.offboard deducts the
 * on-chain output fee from the amount it is given, so the payment sends amount + output fee.
 * Input fees depend on which VTXOs are spent: only a server that charges none is quotable.
 */
export function arkadeOffboardFee(adapter: ArkadePayAdapter, amountSat: number, outputScriptHex?: string): number | null {
  const fees = internals(adapter).arkInfo?.fees;
  if (!fees?.intentFee) return null;
  const input = fees.intentFee.offchainInput ?? '';
  if (input.trim() !== '' && statedNumber(input) !== 0) return null;
  const output = fees.intentFee.onchainOutput ?? '';
  const flat = output.trim() === '' ? 0 : statedNumber(output);
  let fee: number | null = flat === null ? null : Math.ceil(flat);
  // A fee program (not a plain number) is evaluated with the SDK's own estimator.
  const Estimator = internals(adapter).arkSdk?.Estimator;
  if (fee === null && Estimator && outputScriptHex) {
    try {
      const estimator = new Estimator(fees.intentFee);
      const at = (amount: number) => Number(estimator.evalOnchainOutput({ amount: BigInt(amount), script: outputScriptHex }).satoshis);
      const first = at(amountSat);
      const second = at(amountSat + first);
      fee = Number.isSafeInteger(second) && second >= 0 && at(amountSat + second) === second ? second : null;
    } catch { fee = null; }
  }
  return fee;
}

const REGTEST_NETWORK = { ...TEST_NETWORK, bech32: 'bcrt' };
/** The output script of a bitcoin address, for the server's fee program. */
export function outputScriptHex(address: string, network: Network): string | undefined {
  const net = network === 'mainnet' ? NETWORK : network === 'regtest' ? REGTEST_NETWORK : TEST_NETWORK;
  try { return toHex(OutScript.encode(Address(net).decode(address))); } catch { return undefined; }
}

async function spendableSats(adapter: ArkadePayAdapter): Promise<number | null> {
  try {
    const confirmed = Number((await adapter.getBtcBalance())?.confirmed);
    return Number.isSafeInteger(confirmed) && confirmed >= 0 ? confirmed : null;
  } catch { return null; }
}

function rawWallet(adapter: ArkadePayAdapter): any {
  try { return internals(adapter).rawWallet ?? null; } catch { return null; }
}

/**
 * Whether `address` is an Ark address of this wallet's Ark server. Throws a message saying
 * why not, so a Bark (or other server's) address is left to the account that can pay it.
 */
export function assertOwnArkServer(adapter: ArkadePayAdapter, address: string): void {
  const { arkInfo, arkSdk } = internals(adapter);
  const signer = arkInfo?.signerPubkey?.trim().toLowerCase();
  if (!arkSdk?.ArkAddress || !signer) throw new Error('Arkade could not check which Ark server this address belongs to.');
  let server: string;
  try { server = toHex(arkSdk.ArkAddress.decode(address).serverPubKey).toLowerCase(); }
  catch { throw new Error('This is not a valid Ark address.'); }
  const signerXOnly = /^0[23][0-9a-f]{64}$/.test(signer) ? signer.slice(2) : signer;
  if (server !== signerXOnly) throw new Error('This Ark address belongs to a different Ark server, so Arkade cannot pay it directly.');
}

async function persist(key: string, result: PaymentResult): Promise<PaymentResult> {
  await AsyncStorage.setItem(key, JSON.stringify(result));
  return result;
}
async function saved(key: string): Promise<PaymentResult> {
  const raw = await AsyncStorage.getItem(key);
  if (!raw) return { status: 'unknown' };
  try { return JSON.parse(raw) as PaymentResult; } catch { return { status: 'unknown' }; }
}
const txidOf = (r: any): string | undefined => {
  const ref = r?.txid || r?.txId || r?.paymentHash || r?.hash;
  return typeof ref === 'string' && ref.trim() ? ref : undefined;
};

export interface ArkadePayOptions {
  /** KaleidoSwap maker /v2 base URL (RGB network config), for the maker's Intents corridor. */
  makerUrl?: string | null;
  /** Ark server URL; defaults to the connected wallet's own. */
  arkServerUrl?: string;
  /** Override the Intents swap store (tests). */
  store?: ArkadeSwapStore;
  fetchImpl?: typeof fetch;
  registryUrl?: string;
}

/** Ark addresses on this server directly, and Lightning invoices through Arkade Intents. */
export function createArkadeAccount(adapter: ArkadePayAdapter, network: Network, options: ArkadePayOptions = {}): PayAccount & { recover: () => Promise<unknown> } {
  const source = { id: 'arkade', rail: 'ark', network };
  const quotes = new WeakMap<Quote, string>();
  const ref = (attemptId: string) => `kaleidopay-arkade-ark-${attemptId}`;
  const name = 'To their Ark address';
  const intents = createArkadeIntentsSwap({
    sourceId: source.id, rail: source.rail, network,
    wallet: () => rawWallet(adapter),
    arkServerUrl: () => options.arkServerUrl ?? rawWallet(adapter)?.arkProvider?.serverUrl,
    arkNetwork: () => internals(adapter).arkInfo?.network,
    fundingFee: () => arkadeOffchainFee(adapter),
    balance: () => spendableSats(adapter),
    makerUrl: options.makerUrl, store: options.store, fetchImpl: options.fetchImpl, registryUrl: options.registryUrl,
  });

  async function directQuote(preview: Preview, route: Route): Promise<Quote> {
    const address = preview.addresses?.ark ?? preview.code.arkAddress;
    if (route.kind !== 'direct' || route.to !== `ark:${network}` || !address) throw new Error('The request has no Ark address.');
    assertOwnArkServer(adapter, address);
    const fee = arkadeOffchainFee(adapter);
    if (fee === null) throw new Error(FEE_UNAVAILABLE);
    const total = preview.request.amountSat + fee;
    const balance = await spendableSats(adapter);
    if (balance === null) throw new Error('Could not read your Arkade balance. Please try again.');
    if (total > balance) throw new Error(`Insufficient Arkade balance (${total.toLocaleString()} sats needed).`);
    const quote: Quote = { recipientSat: preview.request.amountSat, feeSat: fee, totalSat: total,
      expiresAt: Math.floor(Date.now() / 1000) + QUOTE_TTL_S, estimatedSeconds: 5 };
    quotes.set(quote, address);
    return quote;
  }

  return {
    source,
    name: 'Arkade',
    swaps: intents.swaps,
    providerNames: intents.providerNames,
    recover: intents.recover,
    async quoteOptions(preview, route): Promise<AccountQuoteOption[]> {
      if (route.kind === 'swap') return intents.quoteOptions(preview, route);
      try { return [{ id: 'arkade-ark', name, quote: await directQuote(preview, route) }]; }
      catch (e) { return [{ id: 'arkade-ark', name, unavailable: e instanceof Error ? e.message : FEE_UNAVAILABLE }]; }
    },
    async quote(preview, route) {
      if (route.kind === 'direct') return directQuote(preview, route);
      const options = await intents.quoteOptions(preview, route);
      const best = options.flatMap(o => o.quote ? [o.quote] : []).sort((a, b) => a.totalSat! - b.totalSat!)[0];
      if (!best) throw new Error(options.find(o => o.unavailable)?.unavailable ?? 'No Arkade swap provider can pay this.');
      return best;
    },
    async execute(preview, route, accepted, attemptId) {
      if (route.kind === 'swap') {
        if (route.providerId !== ARKADE_INTENTS_SWAP_ID) throw new PaymentNotSentError('Unknown swap provider.');
        return intents.execute(preview, route, accepted, attemptId);
      }
      const address = quotes.get(accepted);
      if (!address || address !== (preview.addresses?.ark ?? preview.code.arkAddress) || accepted.expiresAt <= Math.floor(Date.now() / 1000)) {
        throw new PaymentNotSentError('Review the payment again to get a fresh quote.');
      }
      const fee = arkadeOffchainFee(adapter);
      const balance = await spendableSats(adapter);
      if (fee === null || fee > accepted.feeSat!) throw new PaymentNotSentError('The Arkade fee changed. Review the payment again.');
      if (balance === null || accepted.totalSat! > balance) throw new PaymentNotSentError('Insufficient Arkade balance. Nothing was sent.');
      quotes.delete(accepted);
      const sent = await adapter.sendPayment({ invoice: address, amount: accepted.recipientSat });
      // An out-of-round Ark payment is final once the server cosigns it, which is when the call returns.
      const txid = txidOf(sent);
      const result: PaymentResult = sent?.status === 'failed' ? { status: 'failed' }
        : txid && Number(sent?.amount) === accepted.recipientSat ? { status: 'completed', reference: txid } : { status: 'unknown', reference: txid };
      return persist(ref(attemptId), result);
    },
    async status(attemptId) {
      const direct = await saved(ref(attemptId));
      return direct.status !== 'unknown' || direct.reference ? direct : intents.status(attemptId);
    },
  };
}

/** Pays a bitcoin address from the Arkade balance by a collaborative exit (offboard). */
export function createArkadeOnchainAccount(adapter: ArkadePayAdapter, network: Network): PayAccount {
  const quotes = new WeakMap<Quote, { address: string; fee: number }>();
  const ref = (attemptId: string) => `kaleidopay-arkade-onchain-${attemptId}`;
  const name = 'On-chain send (Arkade exit)';

  async function quote(preview: Preview, route: Route): Promise<Quote> {
    const address = preview.code.address;
    if (route.kind !== 'direct' || route.to !== `btc:${network}` || !address) throw new Error('The request has no bitcoin address.');
    if (typeof adapter.offboard !== 'function') throw new Error('This Arkade wallet version cannot send on-chain.');
    const fee = arkadeOffboardFee(adapter, preview.request.amountSat, outputScriptHex(address, network));
    if (fee === null) throw new Error(FEE_UNAVAILABLE);
    const total = preview.request.amountSat + fee;
    const balance = await spendableSats(adapter);
    if (balance === null) throw new Error('Could not read your Arkade balance. Please try again.');
    if (total > balance) throw new Error(`Insufficient Arkade balance (${total.toLocaleString()} sats needed).`);
    const result: Quote = { recipientSat: preview.request.amountSat, feeSat: fee, totalSat: total,
      expiresAt: Math.floor(Date.now() / 1000) + QUOTE_TTL_S };
    quotes.set(result, { address, fee });
    return result;
  }

  return {
    source: { id: 'arkade-onchain', rail: 'btc', network },
    name: 'Arkade',
    swaps: [],
    quote,
    async quoteOptions(preview, route) {
      try { return [{ id: 'arkade-onchain', name, quote: await quote(preview, route) }]; }
      catch (e) { return [{ id: 'arkade-onchain', name, unavailable: e instanceof Error ? e.message : FEE_UNAVAILABLE }]; }
    },
    async execute(preview, route, accepted, attemptId) {
      const approval = quotes.get(accepted);
      if (!approval || approval.address !== preview.code.address || accepted.expiresAt <= Math.floor(Date.now() / 1000)) {
        throw new PaymentNotSentError('Review the payment again to get a fresh quote.');
      }
      const fee = arkadeOffboardFee(adapter, accepted.recipientSat, outputScriptHex(approval.address, network));
      if (fee === null || fee !== approval.fee) throw new PaymentNotSentError('The Arkade exit fee changed. Review the payment again.');
      const balance = await spendableSats(adapter);
      if (balance === null || accepted.totalSat! > balance) throw new PaymentNotSentError('Insufficient Arkade balance. Nothing was sent.');
      quotes.delete(accepted);
      let sent: { txid: string };
      try {
        // Ramps deducts the output fee from what it is given, so the receiver gets exactly recipientSat.
        sent = await adapter.offboard!(approval.address, accepted.recipientSat + fee);
      } catch (error) {
        // These are raised while selecting coins, before anything is submitted.
        const message = error instanceof Error ? error.message : String(error);
        if (/Amount is greater than total|No vtxos available|DustChange|dust|can't deduct fees|Destination address required|Invalid offboard amount/i.test(message)) {
          throw new PaymentNotSentError(`Arkade could not send this on-chain: ${message}`);
        }
        throw error;
      }
      // The commitment transaction carrying the output is the receipt.
      const result: PaymentResult = sent?.txid ? { status: 'completed', reference: sent.txid } : { status: 'unknown' };
      return persist(ref(attemptId), result);
    },
    status: attemptId => saved(ref(attemptId)),
  };
}

/**
 * Registers the Arkade accounts with KaleidoPay and runs one recovery pass over Arkade
 * Intents swaps a restart interrupted. Returns the unregister function.
 */
export function connectArkadePayAccounts(adapter: ArkadePayAdapter, network: Network, options: ArkadePayOptions = {}): () => void {
  const account = createArkadeAccount(adapter, network, options);
  const unregister = [registerKaleidoPayAccount(account), registerKaleidoPayAccount(createArkadeOnchainAccount(adapter, network))];
  void account.recover().catch(() => undefined);
  return () => unregister.forEach(u => u());
}
