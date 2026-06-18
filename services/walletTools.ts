// Mobile binding for the canonical @kaleidorg/mind wallet contract.
//
// Maps the contract tools (spark_*, rln_*, arkade_*, get_balances, get_price,
// resolve_contact, send_payment, …) to in-process handlers over the WDK
// adapters (protocolManager). Same tool names + schemas the desktop MCP uses —
// only the execution is local + on-device + private.
//
// Spend tools stay confirmation-gated by the contract (requiresConfirmation),
// so the Engine pauses for the UI confirm sheet before any send.

import {
  InProcessToolSource,
  type InProcessTool,
} from '@kaleidorg/mind';
import { protocolManager, type ProtocolType } from './protocols';
import { getStore } from '../store/storeProvider';
import { fetchBitcoinPrice } from '../store/slices/walletSlice';
import NostrService from './NostrService';
import { resolveLightningAddressToInvoice as resolveLightningAddress } from '../utils/lnurl';

type WalletHandler = (args: Record<string, unknown>) => Promise<unknown>;
type WalletLayer = 'spark' | 'rln' | 'arkade';

const log = (...a: any[]) => { try { console.log('[AI/wallet]', ...a); } catch { /* noop */ } };

/** Normalize whatever shape an adapter's createInvoice returns to { invoice, address }. */
function normInvoice(r: any): Record<string, unknown> {
  const invoice = r?.invoice ?? r?.paymentRequest ?? r?.payment_request ?? r?.bolt11 ?? r?.pr ?? r?.encodedInvoice ?? (typeof r === 'string' ? r : undefined);
  const address = r?.address ?? r?.btcAddress;
  return { invoice, address, ...(r && typeof r === 'object' ? r : {}) };
}

const LAYER_PROTO: Record<'spark' | 'rln' | 'arkade', ProtocolType> = {
  spark: 'SPARK',
  rln: 'RGB',
  arkade: 'ARKADE',
};

function adapter(proto: ProtocolType): any | null {
  const a = protocolManager.getAdapterIfAvailable(proto);
  return a?.isConnected() ? a : null;
}
function requireLayer(layer: keyof typeof LAYER_PROTO): any {
  const a = adapter(LAYER_PROTO[layer]);
  if (!a) throw new Error(`Your ${layer.toUpperCase()} wallet isn't connected yet.`);
  return a;
}
function lightningAdapter(): any {
  const a = adapter('SPARK') ?? adapter('RGB');
  if (!a) throw new Error('No Lightning wallet is connected.');
  return a;
}
function connectedLayers(): WalletLayer[] {
  return (Object.keys(LAYER_PROTO) as (keyof typeof LAYER_PROTO)[]).filter((l) => adapter(LAYER_PROTO[l]));
}

function verifiedPaymentResult(result: any): Record<string, unknown> {
  if (!result || typeof result !== 'object') {
    throw new Error('The wallet returned no payment receipt. Check activity before retrying.');
  }
  const status = String(result.status ?? '').toLowerCase();
  if (status === 'failed' || status === 'cancelled' || status === 'rejected') {
    throw new Error(
      String(result.error ?? result.message ?? `Payment ${status}. No success was recorded.`),
    );
  }
  if (status === 'pending' || status === 'processing') {
    throw new Error(
      'The payment was submitted but is not confirmed yet. Check wallet activity; do not retry until its status is known.',
    );
  }
  const hasSettlementProof =
    status === 'confirmed' ||
    status === 'completed' ||
    status === 'success' ||
    !!result.preimage ||
    !!result.payment_preimage;
  if (!hasSettlementProof) {
    throw new Error(
      'The wallet did not return confirmation or a payment preimage. Check activity before retrying.',
    );
  }
  return { ...result, success: true, settled: true };
}

async function sendAndVerify(adapter: any, request: Record<string, unknown>) {
  return verifiedPaymentResult(await adapter.sendPayment(request));
}

function btcPriceUsd(): number {
  return Number((getStore().getState() as any)?.wallet?.btcPriceUSD ?? 0);
}
/** Price may be 0 until the wallet fetches it — fetch on demand for the agent. */
async function ensureBtcPrice(): Promise<number> {
  let p = btcPriceUsd();
  if (!p) {
    try { await (getStore().dispatch as any)(fetchBitcoinPrice()); } catch (e) { log('price fetch failed', e); }
    p = btcPriceUsd();
  }
  return p;
}
/** Both local AND Nostr contacts (the screen merges them; so must the agent). */
function contacts(): any[] {
  const st = getStore().getState() as any;
  const local = (st?.contacts?.contacts ?? []) as any[];
  const nostr = ((st?.nostr?.contacts ?? []) as any[]).map((c) => ({
    name: c?.profile?.display_name || c?.profile?.name || c?.petname || 'Anonymous',
    lightning_address: c?.profile?.lud16,
    pubkey: c?.pubkey,
    npub: c?.npub,
  }));
  log('contacts', { local: local.length, nostr: nostr.length });
  return [...local, ...nostr];
}
function findContact(name: string): any | undefined {
  const q = name.trim().toLowerCase();
  const list = contacts();
  return list.find((c) => c?.name?.toLowerCase() === q) ?? list.find((c) => c?.name?.toLowerCase().includes(q));
}
const looksLikeDestination = (s: string) => /^(ln(bc|tb|bcrt)|bc1|tb1|[a-z0-9._-]+@)/i.test(s.trim());
const isLightningAddress = (s: string) => /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(s.trim());
const isOnchainAddress = (s: string) => /^(bc1|tb1|bcrt1)/i.test(s.trim());

/** Contract tool → handler. Only the safe, well-understood subset for now;
 *  the rest are bound via `allowMissing` (i.e. simply not exposed yet). */
const HANDLERS: Record<string, WalletHandler> = {
  // ── Reads ──
  get_balances: async (a) => {
    const only = a.layer as keyof typeof LAYER_PROTO | undefined;
    const layers = only ? [only] : connectedLayers();
    const out: any[] = [];
    let totalSats = 0;
    for (const l of layers as (keyof typeof LAYER_PROTO)[]) {
      const ad = adapter(LAYER_PROTO[l]);
      if (!ad) continue;
      try {
        const btc = await ad.getBtcBalance();
        const assets = await ad.listAssets?.().catch(() => []);
        totalSats += btc?.total ?? 0;
        out.push({ layer: l, btc_sats: btc?.total ?? 0, assets: (assets ?? []).filter((x: any) => x?.ticker && x.ticker !== 'BTC') });
      } catch { /* skip */ }
    }
    if (!out.length) throw new Error('No wallet is connected yet.');
    return { total_sats: totalSats, layers: out };
  },
  spark_get_balance: async () => requireLayer('spark').getBtcBalance(),
  rln_get_balances: async () => {
    const a = requireLayer('rln');
    return { btc: await a.getBtcBalance(), assets: await a.listAssets?.().catch(() => []) };
  },
  arkade_get_balance: async () => requireLayer('arkade').getBtcBalance(),

  spark_get_address: async () => ({ address: (await requireLayer('spark').getReceiveAddress()).address }),
  arkade_get_address: async () => ({ address: (await requireLayer('arkade').getReceiveAddress()).address }),

  // ── Receive (invoices with amount) ──
  spark_create_invoice: async ({ amount_sats }) => normInvoice(await requireLayer('spark').createInvoice({ amount: amount_sats ? Number(amount_sats) : undefined })),
  rln_create_ln_invoice: async ({ amount_sats }) => normInvoice(await requireLayer('rln').createInvoice({ amount: amount_sats ? Number(amount_sats) : undefined })),
  rln_create_rgb_invoice: async ({ asset, amount }) => normInvoice(await requireLayer('rln').createInvoice({ asset: String(asset), assetAmount: Number(amount) })),

  // Router: pick the right invoice tool for the asset/layer.
  create_invoice: async ({ asset, amount, layer }) => {
    const a = String(asset ?? 'BTC').toUpperCase();
    const amt = amount != null ? Number(amount) : undefined;
    log('create_invoice', { asset: a, amount: amt, layer });
    let r: any;
    if (a !== 'BTC') {
      // RGB asset (USDT/XAUT) → RLN node RGB invoice.
      r = await requireLayer('rln').createInvoice({ asset: a, assetAmount: amt });
    } else {
      // BTC: honor an expressed layer; otherwise prefer RLN (a real bolt11
      // Lightning invoice), then Spark. A Spark invoice (spark1…) is NOT a
      // standard Lightning invoice, so RLN is the better default when connected.
      const lk: keyof typeof LAYER_PROTO =
        layer === 'spark' || layer === 'arkade' || layer === 'rln'
          ? (layer as keyof typeof LAYER_PROTO)
          : adapter(LAYER_PROTO.rln) ? 'rln' : 'spark';
      const ad = adapter(LAYER_PROTO[lk]) || lightningAdapter();
      log('create_invoice via', lk);
      r = await ad.createInvoice({ amount: amt });
    }
    log('create_invoice result', r);
    return normInvoice(r);
  },

  // Swap quote — venue-aware (Flashnet on Spark · KaleidoSwap on RLN). Read-only:
  // the live quote + atomic execution happen on the tested Swap screen, so the
  // agent quotes + hands off rather than moving funds blind.
  get_swap_quote: async ({ from_asset, to_asset, amount }) => {
    const venue = adapter('RGB') ? 'KaleidoSwap (RLN)' : adapter('SPARK') ? 'Flashnet (Spark)' : null;
    if (!venue) throw new Error('Connect a Spark or RLN wallet to swap.');
    const f = String(from_asset ?? '').toUpperCase();
    const t = String(to_asset ?? '').toUpperCase();
    return { from_asset: f, to_asset: t, amount, venue, note: `Swap ${amount ?? ''} ${f} → ${t} via ${venue}. Open the Swap screen to see the live quote and confirm.` };
  },

  // ── Cross-cutting helpers ──
  get_price: async ({ fiat }) => {
    const price = await ensureBtcPrice();
    log('get_price', { price });
    if (!price) throw new Error('Price is not available right now.');
    return { asset: 'BTC', price_usd: price, fiat: (fiat as string) ?? 'USD' };
  },
  fiat_to_sats: async ({ amount, currency }) => {
    const price = await ensureBtcPrice();
    if (!price) throw new Error('Price is not available right now.');
    const sats = Math.round((Number(amount) / price) * 1e8);
    const cur = String(currency ?? 'USD').toUpperCase();
    return { sats, ...(cur !== 'USD' ? { note: `approximate — treated ${cur} as USD` } : {}) };
  },
  resolve_contact: async ({ name }) => {
    const q = String(name).trim().toLowerCase();
    const list = contacts();
    log('resolve_contact', { name, total: list.length });
    const exact = list.filter((c) => c?.name?.toLowerCase() === q);
    const matches = exact.length ? exact : list.filter((c) => c?.name?.toLowerCase().includes(q));
    if (matches.length === 0) throw new Error(`No contact named "${name}".`);
    // Disambiguate duplicates — never guess who to pay.
    if (matches.length > 1) {
      throw new Error(`There are ${matches.length} contacts matching "${name}" (${matches.map((c) => c.name).join(', ')}) — which one?`);
    }
    const c = matches[0];
    let ln = c.lightning_address as string | undefined;
    // Nostr contact whose lud16 wasn't cached (no contacts-picker pre-resolve, as
    // in voice) → fetch the profile's Lightning address on demand.
    if (!ln && c.pubkey) {
      try {
        const info = await NostrService.getInstance().getUserInfo(String(c.pubkey));
        ln = info?.profile?.lud16;
        log('resolve_contact nostr lud16', { found: !!ln });
      } catch (e) {
        log('resolve_contact nostr fetch failed', e);
      }
    }
    if (!ln) throw new Error(`"${c.name}" doesn't have a Lightning address set.`);
    return { name: c.name, ln_address: ln, npub: c.npub };
  },

  // ── Spend (confirmation-gated by the contract) ──
  rln_pay_invoice: async ({ invoice }) =>
    sendAndVerify(lightningAdapter(), { invoice: String(invoice) }),
  // RGB asset send. RGB transfers go to an RGB/Lightning invoice (which carries
  // the asset); a contact's plain Lightning address can't receive an asset, so
  // we guide the user to get their RGB invoice rather than silently mis-send.
  rln_send_asset: async ({ asset, amount, to }) => {
    const target = String(to ?? '').trim();
    if (/^(rgb:|ln(bc|tb|bcrt))/i.test(target)) {
      return sendAndVerify(requireLayer('rln'), { invoice: target });
    }
    throw new Error(`To send ${amount ?? ''} ${String(asset).toUpperCase()} to "${to}", ask them for an RGB invoice and paste it here.`);
  },
  send_payment: async ({ to, amount_sats }) => {
    let target = String(to ?? '').trim();
    const sats = amount_sats != null ? Number(amount_sats) : undefined;
    // Contact name → its payable destination.
    if (target && !looksLikeDestination(target)) {
      const c = findContact(target);
      if (c?.lightning_address) target = c.lightning_address;
      else throw new Error(`I don't have a payable address for "${to}".`);
    }
    if (!target) throw new Error('A destination (invoice, address, or contact) is required.');
    // Lightning address (user@domain) → resolve to a BOLT11 invoice via LNURL-pay.
    if (isLightningAddress(target)) {
      if (!sats) throw new Error('I need an amount in sats to pay a Lightning address.');
      target = await resolveLightningAddress(target, sats);
    } else if (isOnchainAddress(target)) {
      throw new Error("On-chain sends from the assistant aren't supported yet — use the Send screen.");
    }
    // Pay the BOLT11 invoice on the Lightning rail (Spark preferred, RLN fallback).
    return sendAndVerify(lightningAdapter(), {
      invoice: target,
      ...(sats ? { amountSats: sats } : {}),
    });
  },
};

/**
 * Pay a BOLT11 invoice on the Lightning rail and return its preimage. Used by
 * the L402 paid-data tool, which needs the preimage to build the `Authorization:
 * L402 <macaroon>:<preimage>` header that unlocks the resource. Spark/RLN
 * adapters surface the preimage on PaymentResult; if one doesn't, we fail loudly
 * rather than return an unusable success.
 */
export async function payLightningInvoice(
  invoice: string,
  amountSats?: number,
): Promise<{ preimage: string }> {
  const r: any = await lightningAdapter().sendPayment({
    invoice: String(invoice),
    ...(amountSats ? { amountSats } : {}),
  });
  const preimage = r?.preimage ?? r?.payment_preimage;
  if (!preimage) {
    throw new Error('Payment went through but no preimage was returned — cannot unlock the paid resource.');
  }
  return { preimage: String(preimage) };
}

/**
 * Build the wallet ToolSource for the engine: all implemented contract tools
 * (Spark/RLN/Arkade + core helpers), bound to the WDK adapters. The tool surface
 * is STABLE regardless of connection state — each handler checks its adapter at
 * call time and throws a friendly error if that layer isn't connected (so the
 * agent can be built once at mount, before wallets connect). Tools without a
 * handler yet (per-layer *_send, swaps, Liquid) are simply not exposed.
 */
export function buildWalletToolSource() {
  const tools: InProcessTool[] = Object.entries(HANDLERS).map(([name, handler]) => ({
    name,
    description: describeWalletTool(name),
    parameters: paramsForWalletTool(name),
    requiresConfirmation: requiresConfirmation(name),
    handler,
  }));
  return new InProcessToolSource('wallet', tools);
}

function requiresConfirmation(name: string): boolean {
  return /(^send_payment$|_pay_invoice$|_send_asset$)/.test(name);
}

function describeWalletTool(name: string): string {
  const descriptions: Record<string, string> = {
    get_balances: 'Get BTC and asset balances across connected wallet layers.',
    spark_get_balance: 'Get the Spark BTC balance.',
    rln_get_balances: 'Get RLN/RGB BTC and RGB asset balances.',
    arkade_get_balance: 'Get the Arkade BTC balance.',
    spark_get_address: 'Create or fetch a Spark receive address.',
    arkade_get_address: 'Create or fetch an Arkade receive address.',
    spark_create_invoice: 'Create a Spark invoice for receiving BTC.',
    rln_create_ln_invoice: 'Create a Lightning invoice on the RLN wallet.',
    rln_create_rgb_invoice: 'Create an RGB asset invoice on the RLN wallet.',
    create_invoice: 'Create a receive invoice for BTC or an RGB asset.',
    get_swap_quote: 'Describe where a swap quote can be obtained.',
    get_price: 'Get the cached or freshly fetched BTC price.',
    fiat_to_sats: 'Convert a fiat amount to satoshis using the BTC price.',
    resolve_contact: 'Resolve a local or Nostr contact to a Lightning address.',
    rln_pay_invoice: 'Pay a Lightning invoice from the connected wallet.',
    rln_send_asset: 'Send an RGB asset to a provided RGB invoice.',
    send_payment: 'Pay a Lightning invoice, Lightning address, or contact.',
  };
  return descriptions[name] ?? `Run wallet action ${name}.`;
}

function paramsForWalletTool(name: string): Record<string, unknown> {
  const stringProp = (description: string) => ({ type: 'string', description });
  const numberProp = (description: string) => ({ type: 'number', description });
  const object = (properties: Record<string, unknown>, required: string[] = []) => ({
    type: 'object',
    properties,
    required,
  });

  switch (name) {
    case 'get_balances':
      return object({ layer: stringProp('Optional layer: spark, rln, or arkade.') });
    case 'spark_create_invoice':
    case 'rln_create_ln_invoice':
      return object({ amount_sats: numberProp('Optional amount in satoshis.') });
    case 'rln_create_rgb_invoice':
      return object({
        asset: stringProp('RGB asset ticker or id.'),
        amount: numberProp('Asset amount to receive.'),
      }, ['asset', 'amount']);
    case 'create_invoice':
      return object({
        asset: stringProp('Asset to receive, defaults to BTC.'),
        amount: numberProp('Amount to receive.'),
        layer: stringProp('Optional layer: spark, rln, or arkade.'),
      });
    case 'get_swap_quote':
      return object({
        from_asset: stringProp('Asset being sold.'),
        to_asset: stringProp('Asset being bought.'),
        amount: numberProp('Amount to quote.'),
      }, ['from_asset', 'to_asset', 'amount']);
    case 'get_price':
      return object({ fiat: stringProp('Fiat currency, defaults to USD.') });
    case 'fiat_to_sats':
      return object({
        amount: numberProp('Fiat amount.'),
        currency: stringProp('Fiat currency, defaults to USD.'),
      }, ['amount']);
    case 'resolve_contact':
      return object({ name: stringProp('Contact name to resolve.') }, ['name']);
    case 'rln_pay_invoice':
      return object({ invoice: stringProp('BOLT11 invoice to pay.') }, ['invoice']);
    case 'rln_send_asset':
      return object({
        asset: stringProp('RGB asset ticker or id.'),
        amount: numberProp('Asset amount.'),
        to: stringProp('RGB invoice destination.'),
      }, ['asset', 'amount', 'to']);
    case 'send_payment':
      return object({
        to: stringProp('Invoice, Lightning address, or contact name.'),
        amount_sats: numberProp('Amount in satoshis for Lightning addresses.'),
      }, ['to']);
    default:
      return object({});
  }
}
