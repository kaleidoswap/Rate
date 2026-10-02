import AsyncStorage from '@react-native-async-storage/async-storage';
import {decodeOffer,offerRails,encodeRails,encodePaymentCode,type Network,type RailEntry,SSPS_RAILS} from '@universal-bolt12/universal-code';
import type {MerchantOffer} from './merchantOffer';
export interface SavedMerchantOffer extends MerchantOffer { description: string; network: string; rails?: RailEntry[]; onchainAddress?: string }
function key(connectionId: string, network: string) {
  if (!/^[a-f0-9]{64}$/i.test(connectionId) || !/^[a-z0-9-]+$/.test(network)) throw new Error('Invalid merchant wallet.');
  return `kaleidopay-merchant-offer-v1:${connectionId.toLowerCase()}:${network}`;
}
function validate(value: SavedMerchantOffer, network: string) {
  if (!value || value.network !== network || typeof value.description !== 'string' || !/^[a-f0-9]{64}$/i.test(value.offer_id)
    || (value.amount !== undefined && (!Number.isSafeInteger(value.amount) || value.amount <= 0))) throw new Error('Saved offer is unreadable.');
  const fields=decodeOffer(value.offer);
  const embedded=fields.some(f=>f.type===SSPS_RAILS)?offerRails(value.offer).map(r=>r.address===undefined?r.rail:{rail:r.rail,address:r.address}):undefined;
  if(value.rails!==undefined&&(!embedded||String(encodeRails(embedded))!==String(encodeRails(value.rails))))throw new Error('Saved offer destinations do not match its QR.');
  if(embedded)value={...value,rails:embedded};
  merchantPaymentCode(value);
  return value;
}
export async function loadMerchantOffer(connectionId: string, network: string): Promise<SavedMerchantOffer | null> {
  const raw = await AsyncStorage.getItem(key(connectionId,network));
  return raw ? validate(JSON.parse(raw),network) : null;
}
export async function saveMerchantOffer(connectionId: string, value: SavedMerchantOffer) {
  await AsyncStorage.setItem(key(connectionId,value.network),JSON.stringify(validate(value,value.network)));
}

export function merchantPaymentCode(value:SavedMerchantOffer):string {
  return value.onchainAddress?encodePaymentCode({offer:value.offer,address:value.onchainAddress,...(value.amount===undefined?{}:{amountSat:value.amount/1000})},value.network as Network):value.offer;
}
