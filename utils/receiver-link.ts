/** Navigation only: links never create offers, import credentials or send payments. */
export function isReceiverLink(url:string):boolean {
 return url==='com.kaleidoswap.wallet://receive/reusable';
}
export function canOpenReceiver(initialized:boolean,unlocked:boolean,route:string|undefined):boolean {
 return initialized&&unlocked&&!!route&&['Dashboard','DashboardTab','Receive','Settings','NostrSettings','NWCConnect','MerchantOffer'].includes(route);
}
