import type {ReceiverDestination} from './merchantOfferPreferences';
interface ReceivingAdapter {
 getConnectionInfo():Promise<{connected:boolean;network?:string;nodeId?:string}>;
 getReceiveAddress():Promise<{address:string}>;
 backend?:{sync?():Promise<unknown>};
}
const key=(value:string|undefined)=>value&&/^(02|03)[0-9a-f]{64}$/i.test(value)?value.slice(2).toLowerCase():value?.toLowerCase();
const network=(value:string|undefined)=>value==='bitcoin'?'mainnet':value;
/** Obtain a native receive address only from an already connected wallet on the selected network. */
export async function receiverDestinationFromWallet(adapter:ReceivingAdapter,type:'bark'|'arkade',expectedNetwork:string):Promise<ReceiverDestination>{
 const name=type==='bark'?'Bark':'Arkade';
 let before=await adapter.getConnectionInfo();
 if(!before.connected)throw Error(`Connect a compatible ${name} account before adding its address.`);
 if(network(before.network)!==expectedNetwork)throw Error(`${name} is on ${network(before.network)??'another network'}, your receiving node on ${expectedNetwork}. Switch ${name} to ${expectedNetwork} in Settings → Advanced.`);
 // A wallet learns its server key once it has reached the server.
 if(!key(before.nodeId)){await adapter.backend?.sync?.().catch(()=>undefined);before=await adapter.getConnectionInfo();}
 const serverKey=key(before.nodeId);
 if(!serverKey||!/^[a-f0-9]{64}$/.test(serverKey))throw Error(`${name} has not reached its server yet. Try again in a moment.`);
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
