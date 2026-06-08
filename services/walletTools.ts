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
  bindWalletTools,
  walletTools,
  type WalletHandler,
  type WalletLayer,
} from '@kaleidorg/mind';
import { protocolManager, type ProtocolType } from './protocols';
import { getStore } from '../store/storeProvider';

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

function btcPriceUsd(): number {
  return Number((getStore().getState() as any)?.wallet?.btcPriceUSD ?? 0);
}
function contacts(): any[] {
  return (getStore().getState() as any)?.contacts?.contacts ?? [];
}
function findContact(name: string): any | undefined {
  const q = name.trim().toLowerCase();
  const list = contacts();
  return list.find((c) => c?.name?.toLowerCase() === q) ?? list.find((c) => c?.name?.toLowerCase().includes(q));
}
const looksLikeDestination = (s: string) => /^(ln(bc|tb|bcrt)|bc1|tb1|[a-z0-9._-]+@)/i.test(s.trim());
const isLightningAddress = (s: string) => /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(s.trim());
const isOnchainAddress = (s: string) => /^(bc1|tb1|bcrt1)/i.test(s.trim());

/** LNURL-pay: resolve a Lightning address (user@domain) to a BOLT11 invoice. */
async function resolveLightningAddress(address: string, amountSats: number, comment = ''): Promise<string> {
  const [username, domain] = address.trim().split('@');
  if (!username || !domain) throw new Error(`That doesn't look like a Lightning address: ${address}`);
  const fetchJson = async (url: string): Promise<any> => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: ctrl.signal });
      if (!res.ok) throw new Error(`Lightning address endpoint returned ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  };
  const lnurl = await fetchJson(`https://${domain}/.well-known/lnurlp/${username}`);
  if (lnurl?.status === 'ERROR') throw new Error(lnurl.reason || 'Lightning address rejected the request.');
  const msat = amountSats * 1000;
  if (lnurl?.minSendable && msat < lnurl.minSendable) throw new Error(`Minimum is ${Math.ceil(lnurl.minSendable / 1000)} sats.`);
  if (lnurl?.maxSendable && msat > lnurl.maxSendable) throw new Error(`Maximum is ${Math.floor(lnurl.maxSendable / 1000)} sats.`);
  const sep = String(lnurl.callback).includes('?') ? '&' : '?';
  const inv = await fetchJson(`${lnurl.callback}${sep}amount=${msat}&comment=${encodeURIComponent(comment)}`);
  if (inv?.status === 'ERROR') throw new Error(inv.reason || 'Could not get an invoice from the Lightning address.');
  if (!inv?.pr) throw new Error('The Lightning address returned no invoice.');
  return String(inv.pr);
}

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
  spark_create_invoice: async ({ amount_sats }) => requireLayer('spark').createInvoice({ amount: amount_sats ? Number(amount_sats) : undefined }),
  rln_create_ln_invoice: async ({ amount_sats }) => requireLayer('rln').createInvoice({ amount: amount_sats ? Number(amount_sats) : undefined }),
  rln_create_rgb_invoice: async ({ asset, amount }) => requireLayer('rln').createInvoice({ asset: String(asset), assetAmount: Number(amount) }),

  // Router: pick the right invoice tool for the asset/layer.
  create_invoice: async ({ asset, amount, layer }) => {
    const a = String(asset ?? 'BTC').toUpperCase();
    const amt = amount != null ? Number(amount) : undefined;
    if (a !== 'BTC') {
      // RGB asset (USDT/XAUT) → RLN node RGB invoice.
      return requireLayer('rln').createInvoice({ asset: a, assetAmount: amt });
    }
    // BTC: the requested layer if connected, else the Lightning rail.
    const lk = layer === 'spark' || layer === 'arkade' || layer === 'rln' ? (layer as keyof typeof LAYER_PROTO) : undefined;
    const ad = (lk && adapter(LAYER_PROTO[lk])) || lightningAdapter();
    return ad.createInvoice({ amount: amt });
  },

  // ── Cross-cutting helpers ──
  get_price: async ({ fiat }) => {
    const price = btcPriceUsd();
    if (!price) throw new Error('Price is not available right now.');
    return { asset: 'BTC', price_usd: price, fiat: (fiat as string) ?? 'USD' };
  },
  fiat_to_sats: async ({ amount, currency }) => {
    const price = btcPriceUsd();
    if (!price) throw new Error('Price is not available right now.');
    const sats = Math.round((Number(amount) / price) * 1e8);
    const cur = String(currency ?? 'USD').toUpperCase();
    return { sats, ...(cur !== 'USD' ? { note: `approximate — treated ${cur} as USD` } : {}) };
  },
  resolve_contact: async ({ name }) => {
    const c = findContact(String(name));
    if (!c) throw new Error(`No contact named "${name}".`);
    return { name: c.name, ln_address: c.lightning_address, npub: c.npub };
  },

  // ── Spend (confirmation-gated by the contract) ──
  rln_pay_invoice: async ({ invoice }) => lightningAdapter().sendPayment({ invoice: String(invoice) }),
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
    return lightningAdapter().sendPayment({ invoice: target, ...(sats ? { amountSats: sats } : {}) });
  },
};

/**
 * Build the wallet ToolSource for the engine: all implemented contract tools
 * (Spark/RLN/Arkade + core helpers), bound to the WDK adapters. The tool surface
 * is STABLE regardless of connection state — each handler checks its adapter at
 * call time and throws a friendly error if that layer isn't connected (so the
 * agent can be built once at mount, before wallets connect). Tools without a
 * handler yet (per-layer *_send, swaps, Liquid) are simply not exposed.
 */
export function buildWalletToolSource() {
  const layers: WalletLayer[] = ['spark', 'rln', 'arkade', 'core'];
  return bindWalletTools(HANDLERS, { layers, includeCore: true, allowMissing: true, id: 'wallet' });
}

/** The contract tool names this binding currently implements (for skill scoping). */
export function implementedWalletToolNames(): string[] {
  const names = new Set(Object.keys(HANDLERS));
  return walletTools({ layers: [...connectedLayers(), 'core'] })
    .map((t) => t.name)
    .filter((n) => names.has(n));
}
