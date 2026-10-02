import type { NWCClient } from '../nwc/NWCExternalClient';
import { decodeOffer,offerRails,encodeRails,validateRailEntries,paymentCodeNetwork,SSPS_RAILS,type RailEntry } from '@universal-bolt12/universal-code';

type Client = Pick<NWCClient, 'request'>;
export interface MerchantOffer { offer: string; offer_id: string; amount?: number }
export interface OfferReceipt { payment_hash: string; amount: number; state: 'settled' | 'pending' | 'failed' }
const METHODS = ['kaleidopay_make_offer', 'kaleidopay_list_offer_payments'];
const validId = (id: unknown): id is string => typeof id === 'string' && /^[a-f0-9]{64}$/i.test(id);

/** Read-only preflight; creation checks again before issuing an offer. */
export async function checkMerchantCapabilities(client: Client, network: string): Promise<{addressPreferences:boolean}> {
 const info = await client.request<{network:string;methods:string[];kaleidopay?:{rails_versions?:number[]}}>('get_info',{});
 if(info.network!==network)throw new Error('This connection no longer matches the receiving wallet. Reconnect it.');
 if(!Array.isArray(info.methods)||!METHODS.every(m=>info.methods.includes(m)))throw new Error('This wallet cannot create reusable payment QRs. Choose another wallet.');
 return {addressPreferences:Array.isArray(info.kaleidopay?.rails_versions)&&info.kaleidopay.rails_versions.includes(1)};
}

export async function createMerchantOffer(client: Client, network: string, description: string, amountSats?: number, rails?: RailEntry[]): Promise<MerchantOffer> {
  if (!description.trim() || description.length > 256) throw new Error('Enter a description up to 256 characters.');
  if (amountSats !== undefined && (!Number.isSafeInteger(amountSats) || amountSats <= 0 || !Number.isSafeInteger(amountSats * 1000))) throw new Error('Enter a whole number of sats.');
  if (rails) { validateRailEntries(rails); for(const entry of rails){const rail=typeof entry==='string'?entry:entry.rail;if(/^(ln|btc):/.test(rail)&&rail.split(':')[1]!==network)throw new Error('Rail network conflicts with receiving wallet.');} }
  const capabilities = await checkMerchantCapabilities(client, network);
  if(rails&&!capabilities.addressPreferences)throw new Error('This wallet supports Lightning-only QRs. Choose a compatible wallet to include other accounts.');
  const amount = amountSats === undefined ? undefined : amountSats * 1000;
  const offer = await client.request<MerchantOffer>('kaleidopay_make_offer', { description, ...(rails ? {rails} : {}), ...(amount === undefined ? {} : { amount }) });
  if (!validId(offer.offer_id) || offer.amount !== amount) throw new Error('Wallet returned an unexpected offer.');
  const fields=decodeOffer(offer.offer);
  const encodedAmount=fields.find(f=>f.type===8n)?.value;
  const offerAmount=encodedAmount?.reduce((n,b)=>(n<<8n)|BigInt(b),0n);
  if(fields.some(f=>f.type===6n)||encodedAmount&&(encodedAmount.length>8||encodedAmount[0]===0)||offerAmount!==(amount===undefined?undefined:BigInt(amount)))throw new Error('Returned offer does not match the requested Bitcoin amount.');
  const received=offerRails(offer.offer).map(r=>r.address===undefined?r.rail:{rail:r.rail,address:r.address});
  if(rails) {
   const expected=rails.some(r=>typeof r==='string'&&(r==='ln'||r.startsWith('ln:')))?rails:[...rails,'ln'];
   if(!fields.some(f=>f.type===SSPS_RAILS)||String(encodeRails(received))!==String(encodeRails(expected)))throw new Error('Receiving node returned different destination preferences. No QR was saved.');
  }else if(fields.some(f=>f.type===SSPS_RAILS))throw new Error('Receiving node returned unexpected destination preferences.');
  if(network!=='regtest'&&paymentCodeNetwork(offer.offer)!==network)throw new Error('Returned offer uses a different or unknown Bitcoin network.');
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
