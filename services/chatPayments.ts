// services/chatPayments.ts
//
// Thin wrappers over protocolManager for creating and paying invoices from the
// chat. Kept separate from the AI assistant's helpers because RGB-asset invoices
// need the RGB adapter directly (the assistant's generateInvoice enforces a BTC
// sats amount that doesn't fit asset-only requests).
import { protocolManager } from './protocols';

type ProtocolName = 'SPARK' | 'RGB' | 'ARKADE';

function firstConnected(order: ProtocolName[]): any | null {
  for (const proto of order) {
    const adapter = protocolManager.getAdapterIfAvailable(proto);
    if (adapter?.isConnected?.()) return adapter;
  }
  return null;
}

export interface CreateChatInvoiceParams {
  /** RGB asset id; omit for a plain BTC Lightning invoice. */
  assetId?: string;
  /** Display amount: sats for BTC, whole asset units for RGB. */
  amount: number;
  /** Asset precision (decimals) — used to scale RGB amounts to base units. */
  precision?: number;
  description?: string;
  expirySeconds?: number;
}

/**
 * Create a payment-request invoice for the chat. BTC requests yield a normal
 * BOLT11; RGB requests yield an RGB-over-Lightning BOLT11 carrying the asset, so
 * either can be settled by the recipient with a single Lightning payment.
 */
export async function createChatInvoice(
  params: CreateChatInvoiceParams,
): Promise<{ invoice: string }> {
  const { assetId, amount, precision = 0, description, expirySeconds = 3600 } = params;

  if (assetId) {
    const rgb = firstConnected(['RGB']);
    if (!rgb) throw new Error('Connect an RGB node to request asset payments.');
    const assetAmount = Math.round(amount * Math.pow(10, precision));
    const res = await rgb.createInvoice({ asset: assetId, assetAmount, description, expirySeconds });
    if (!res?.invoice) throw new Error('Failed to create the asset invoice.');
    return { invoice: res.invoice };
  }

  // BTC Lightning — prefer Spark, fall back to the RGB node.
  const ln = firstConnected(['SPARK', 'RGB']);
  if (!ln) throw new Error('No Lightning-capable wallet is connected.');
  const res = await ln.createInvoice({ amount: Math.round(amount), description, expirySeconds });
  if (!res?.invoice) throw new Error('Failed to create the invoice.');
  return { invoice: res.invoice };
}

/**
 * Pay a Lightning (or RGB-over-Lightning) invoice from the chat. The RGB adapter
 * is preferred when connected because it can settle both plain BTC and RGB-asset
 * invoices; Spark is the fallback for plain BTC.
 */
export async function payChatInvoice(
  invoice: string,
  amountSats?: number,
): Promise<any> {
  const ln = firstConnected(['RGB', 'SPARK']);
  if (!ln) throw new Error('No Lightning-capable wallet is connected.');
  return ln.sendPayment(amountSats ? { invoice, amountSats } : { invoice });
}
