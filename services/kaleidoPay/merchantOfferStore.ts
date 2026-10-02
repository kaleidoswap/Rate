import AsyncStorage from '@react-native-async-storage/async-storage';
import {decodeOffer} from '@universal-bolt12/universal-code';
import type {MerchantOffer} from './merchantOffer';
export interface SavedMerchantOffer extends MerchantOffer { description: string; network: string }
function key(connectionId: string, network: string) {
  if (!/^[a-f0-9]{64}$/i.test(connectionId) || !/^[a-z0-9-]+$/.test(network)) throw new Error('Invalid merchant wallet.');
  return `kaleidopay-merchant-offer-v1:${connectionId.toLowerCase()}:${network}`;
}
function validate(value: SavedMerchantOffer, network: string) {
  if (!value || value.network !== network || typeof value.description !== 'string' || !/^[a-f0-9]{64}$/i.test(value.offer_id)
    || (value.amount !== undefined && (!Number.isSafeInteger(value.amount) || value.amount <= 0))) throw new Error('Saved offer is unreadable.');
  decodeOffer(value.offer);
  return value;
}
export async function loadMerchantOffer(connectionId: string, network: string): Promise<SavedMerchantOffer | null> {
  const raw = await AsyncStorage.getItem(key(connectionId,network));
  return raw ? validate(JSON.parse(raw),network) : null;
}
export async function saveMerchantOffer(connectionId: string, value: SavedMerchantOffer) {
  await AsyncStorage.setItem(key(connectionId,value.network),JSON.stringify(validate(value,value.network)));
}
