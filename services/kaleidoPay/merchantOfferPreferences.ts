import AsyncStorage from '@react-native-async-storage/async-storage';
import {validateRailEntries,encodePaymentCode,type Network,type RailEntry} from '@universal-bolt12/universal-code';

export type ReceiverDestination = {type:'arkade'|'bark';address:string;serverKey:string}|{type:'bitcoin';address:string}|{type:'lightning';source:'bolt12_offer'};
export interface ReceiverPreferences {version:1;network:string;destinations:ReceiverDestination[]}
export const lightningDestination: ReceiverDestination = {type:'lightning',source:'bolt12_offer'};
export function defaultReceiverPreferences(network:string):ReceiverPreferences {
 return {version:1,network,destinations:[{...lightningDestination}]};
}
export function validateReceiverPreferences(value:ReceiverPreferences,network:string):void {
 if(!value||value.version!==1||value.network!==network||!Array.isArray(value.destinations)||value.destinations.length<1||value.destinations.length>4)throw Error('Invalid receiving preferences.');
 if(Object.keys(value).sort().join(',')!=='destinations,network,version')throw Error('Invalid receiving preference fields.');
 for(const destination of value.destinations){
  if(!destination||!['lightning','bitcoin','bark','arkade'].includes(destination.type))throw Error('Invalid receiving destination.');
  const expected=destination.type==='lightning'?'source,type':destination.type==='bitcoin'?'address,type':'address,serverKey,type';
  if(Object.keys(destination).sort().join(',')!==expected)throw Error('Invalid receiving destination fields.');
  if(destination.type==='lightning'&&destination.source!=='bolt12_offer')throw Error('Invalid Lightning fallback.');
 }
 const types=value.destinations.map(d=>d.type);
 if(new Set(types).size!==types.length||!types.includes('lightning'))throw Error('Keep one Lightning fallback and at most one address per wallet type.');
 // Legacy Lightning-only offers also work on the node's regtest network.
 if(value.destinations.length===1&&types[0]==='lightning') {
  if(value.destinations[0].type!=='lightning'||value.destinations[0].source!=='bolt12_offer'||Object.keys(value.destinations[0]).length!==2)throw Error('Invalid Lightning fallback.');
 }else {
  if(!['mainnet','signet','mutinynet','testnet'].includes(network))throw Error('Address preferences require a supported Bitcoin network.');
  validateRailEntries(receiverRailsUnchecked(value));
  const bitcoin=value.destinations.find(d=>d.type==='bitcoin');
  if(bitcoin?.type==='bitcoin')encodePaymentCode({address:bitcoin.address},network as Network);
 }
}
function receiverRailsUnchecked(value:ReceiverPreferences):RailEntry[]{
 return value.destinations.map(d=>d.type==='lightning'?`ln:${value.network}`:d.type==='bitcoin'?`btc:${value.network}`:{rail:`${d.type}:${d.serverKey}`,address:d.address});
}
export function receiverRails(value:ReceiverPreferences):RailEntry[]|undefined {
 validateReceiverPreferences(value,value.network);
 return value.destinations.length===1?undefined:receiverRailsUnchecked(value);
}
function key(connectionId:string,network:string){
 if(!/^[a-f0-9]{64}$/i.test(connectionId)||!/^[a-z0-9-]+$/.test(network))throw Error('Invalid receiving wallet.');
 return `kaleidopay-receiver-preferences-v1:${connectionId.toLowerCase()}:${network}`;
}
export async function loadReceiverPreferences(connectionId:string,network:string):Promise<ReceiverPreferences>{
 const raw=await AsyncStorage.getItem(key(connectionId,network));
 const value=raw?JSON.parse(raw):defaultReceiverPreferences(network);
 validateReceiverPreferences(value,network);return value;
}
export async function saveReceiverPreferences(connectionId:string,value:ReceiverPreferences):Promise<void>{
 validateReceiverPreferences(value,value.network);
 // Public endpoints only. Credentials stay in the existing NWC SecureStore.
 await AsyncStorage.setItem(key(connectionId,value.network),JSON.stringify(value));
}
