import type { NWCClient } from '../nwc/NWCExternalClient';
import { decodeOffer } from '@universal-bolt12/universal-code';

type Client = Pick<NWCClient, 'request'>;
export interface MerchantOffer { offer: string; offer_id: string; amount?: number }
export interface OfferReceipt { payment_hash: string; amount: number; state: 'settled' | 'pending' | 'failed' }
const METHODS = ['kaleidopay_make_offer', 'kaleidopay_list_offer_payments'];
const validId = (id: unknown): id is string => typeof id === 'string' && /^[a-f0-9]{64}$/i.test(id);

export async function createMerchantOffer(client: Client, network: string, description: string, amountSats?: number): Promise<MerchantOffer> {
  if (!description.trim() || description.length > 256) throw new Error('Enter a description up to 256 characters.');
  if (amountSats !== undefined && (!Number.isSafeInteger(amountSats) || amountSats <= 0 || !Number.isSafeInteger(amountSats * 1000))) throw new Error('Enter a whole number of sats.');
  const info = await client.request<{network: string; methods: string[]}>('get_info', {});
  if (info.network !== network || !Array.isArray(info.methods) || !METHODS.every(m => info.methods.includes(m))) throw new Error('This wallet does not support reusable offers on the selected network.');
  const amount = amountSats === undefined ? undefined : amountSats * 1000;
  const offer = await client.request<MerchantOffer>('kaleidopay_make_offer', { description, ...(amount === undefined ? {} : { amount }) });
  if (!validId(offer.offer_id) || offer.amount !== amount) throw new Error('Wallet returned an unexpected offer.');
  decodeOffer(offer.offer); // Structural check; the connected node owns protocol validation.
  return offer;
}

/** Read every page without counting a retried/overlapping receipt twice. Never sends. */
export async function listMerchantReceipts(client: Client, offerId: string): Promise<OfferReceipt[]> {
  if (!validId(offerId)) throw new Error('Invalid offer ID.');
  const receipts = new Map<string, OfferReceipt>();
  const seen = new Set<string>();
  let token: string | undefined;
  for (let page = 0; page < 100; page++) {
    const result = await client.request<{offer_id: string; payments: OfferReceipt[]; next_page_token?: string | null}>('kaleidopay_list_offer_payments', { offer_id: offerId, ...(token ? {page_token: token} : {}) });
    if (result.offer_id.toLowerCase() !== offerId.toLowerCase() || !Array.isArray(result.payments)) throw new Error('Unexpected receipt response.');
    for (const p of result.payments) {
      if (!validId(p.payment_hash) || !Number.isSafeInteger(p.amount) || p.amount <= 0 || !['pending','settled','failed'].includes(p.state)) throw new Error('Invalid payment receipt.');
      const key = p.payment_hash.toLowerCase();
      const prior = receipts.get(key);
      if (prior && (prior.amount !== p.amount || prior.state !== p.state)) throw new Error('Receipts changed; refresh the list.');
      receipts.set(key, {payment_hash: key, amount: p.amount, state: p.state});
    }
    if (!result.next_page_token) return [...receipts.values()];
    if (typeof result.next_page_token !== 'string' || seen.has(result.next_page_token)) throw new Error('Invalid receipt pagination.');
    token = result.next_page_token; seen.add(token);
  }
  throw new Error('Too many receipt pages.');
}
