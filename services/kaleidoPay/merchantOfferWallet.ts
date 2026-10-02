import type {ReceiverDestination} from './merchantOfferPreferences';
interface ReceivingAdapter {
 getConnectionInfo():Promise<{connected:boolean;network?:string;nodeId?:string}>;
 getReceiveAddress():Promise<{address:string}>;
}
const key=(value:string|undefined)=>value&&/^(02|03)[0-9a-f]{64}$/i.test(value)?value.slice(2).toLowerCase():value?.toLowerCase();
const network=(value:string|undefined)=>value==='bitcoin'?'mainnet':value;
/** Obtain a native receive address only from an already connected wallet on the selected network. */
export async function receiverDestinationFromWallet(adapter:ReceivingAdapter,type:'bark'|'arkade',expectedNetwork:string):Promise<ReceiverDestination>{
 const before=await adapter.getConnectionInfo();
 const serverKey=key(before.nodeId);
 if(!before.connected||network(before.network)!==expectedNetwork||!serverKey||!/^[a-f0-9]{64}$/.test(serverKey))throw Error(`Connect ${type==='bark'?'Bark':'Arkade'} on ${expectedNetwork} with a known server public key first.`);
 const result=await adapter.getReceiveAddress();
 const after=await adapter.getConnectionInfo();
 if(!after.connected||network(after.network)!==expectedNetwork||key(after.nodeId)!==serverKey)throw Error('Receiving wallet changed while loading its address. Try again.');
 if(typeof result.address!=='string'||!/^[a-z0-9]{1,2048}$/.test(result.address))throw Error('Wallet returned an invalid receiving address.');
 return {type,address:result.address,serverKey};
}
export async function loadConnectedReceiverDestination(type:'bark'|'arkade',expectedNetwork:string):Promise<ReceiverDestination>{
 const {protocolManager}=await import('../protocols');
 return receiverDestinationFromWallet(protocolManager.getAdapter(type==='bark'?'BARK':'ARKADE'),type,expectedNetwork);
}
