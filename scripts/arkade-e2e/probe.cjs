// Isolated Mutinynet-only harness. Never opens application/user wallets.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const root = path.join(require('node:os').homedir(), '.local/share/rate-qa/arkade-maker-20261103');
process.umask(0o077); fs.mkdirSync(root, { recursive: true, mode: 0o700 });
const mode = process.argv[2] || 'status';
const role = process.argv[3] || 'alice';
if (!['alice', 'bob'].includes(role)) throw Error('Test role required');
const dir = path.join(root, role); fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
const storageDB = new DatabaseSync(path.join(dir, 'public-state.sqlite'));
storageDB.exec('CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
const storage = {
 getItem: async k => storageDB.prepare('SELECT value FROM kv WHERE key=?').get(k)?.value ?? null,
 setItem: async (k,v) => {storageDB.prepare('INSERT OR REPLACE INTO kv VALUES (?,?)').run(k,v)},
 getAllKeys: async () => storageDB.prepare('SELECT key FROM kv').all().map(r=>r.key),
};
const storagePath = require.resolve('@react-native-async-storage/async-storage');
require.cache[storagePath] = {id:storagePath,filename:storagePath,loaded:true,exports:storage};
const babel = require('@babel/core');
require.extensions['.ts'] = (m,f) => m._compile(babel.transformSync(fs.readFileSync(f,'utf8'),{filename:f,babelrc:false,configFile:false,presets:[require.resolve('@babel/preset-typescript')],plugins:[require.resolve('@babel/plugin-transform-modules-commonjs')]}).code,f);
const intents = require('../../services/kaleidoPay/arkadeIntents.ts');
const sdk = require('@arkade-os/sdk');
const repos = require('@arkade-os/sdk/repositories/sqlite');
const server = 'https://mutinynet.arkade.sh';
const maker = 'https://maker.signet.kaleidoswap.com';
const emit = (event,data={}) => console.log(JSON.stringify({event,role,...data}));
async function main() {
 const secretFile=path.join(dir,'test-only-key');
 if(!fs.existsSync(secretFile))fs.writeFileSync(secretFile,crypto.randomBytes(32),{mode:0o600,flag:'wx'});
 const db=new DatabaseSync(path.join(dir,'wallet.sqlite'));
 const executor={run:async(s,p=[])=>{db.prepare(s).run(...p)},get:async(s,p=[])=>db.prepare(s).get(...p),all:async(s,p=[])=>db.prepare(s).all(...p)};
 const provider=new sdk.RestArkProvider(server);
 const info=await provider.getInfo(); if(info.network!=='mutinynet')throw Error('Refusing non-Mutinynet server');
 const wallet=await sdk.Wallet.create({identity:sdk.SingleKey.fromPrivateKey(fs.readFileSync(secretFile)),arkProvider:provider,indexerProvider:new sdk.RestIndexerProvider(server),onchainProvider:new sdk.EsploraProvider('https://esplora.signet.kaleidoswap.com'),storage:{walletRepository:new repos.SQLiteWalletRepository(executor),contractRepository:new repos.SQLiteContractRepository(executor)}});
 const store=intents.createAsyncStorageArkadeSwapStore();
 const receiptFile=path.join(dir,mode.endsWith('-funded')?'receive-funded.json':'receive.json');
 emit('wallet',{address:await wallet.getAddress(),boardingAddress:await wallet.getBoardingAddress(),balance:await wallet.getBalance(),network:info.network});
 const sendFile=path.join(dir,mode.startsWith('refund-')?'refund.json':mode==='send-lost-ack'?'send.json':'send-live.json');
 const swap = intents.createArkadeIntentsSwap({sourceId:`qa-${role}`,rail:'ark',network:'mutinynet',wallet:()=>wallet,
  arkServerUrl:()=>server,arkNetwork:()=>info.network,fundingFee:()=>Number(info.fees.txFeeRate)===0?0:null,
  balance:async()=>Number((await wallet.getBalance()).available),makerUrl:maker,store});
 if(mode==='refund-prepare'){
  if(fs.existsSync(sendFile)){emit('existing-refund-attempt',JSON.parse(fs.readFileSync(sendFile)));return;}
  const ln=require('./lightning.cjs');const hash=crypto.randomBytes(32).toString('hex');
  const {invoice}=await ln.call('Bolt11ReceiveForHash',{amount_msat:'10000000',expiry_secs:3600,payment_hash:hash});ln.close();
  const facts=intents.invoiceFacts(invoice);if(facts.amountSats!==10000||!invoice.startsWith('lntbs'))throw Error('Wrong refund test invoice');
  const preview={code:{invoice},request:{amountSat:10000}};
  const route={kind:'swap',sourceId:`qa-${role}`,from:'ark',to:'ln:mutinynet',providerId:'arkade-intents'};
  const option=(await swap.quoteOptions(preview,route)).find(o=>o.id==='kaleidoswap');
  if(!option?.quote||option.quote.totalSat>10200)throw Error(option?.unavailable||'Refund test spend cap');
  const attempt={id:'maker-live-refund-1',invoice,hash,totalApproved:option.quote.totalSat,started:true};
  fs.writeFileSync(sendFile,JSON.stringify(attempt),{flag:'wx',mode:0o600});
  const send=wallet.sendBitcoin.bind(wallet);
  wallet.sendBitcoin=async(params)=>{
   const records=await store.listPending();const r=records.find(r=>r.address===params.address);
   if(!r||params.amount>10200||r.quote.refund_locktime>Date.now()/1000+26*3600)throw Error('Refund lock exceeds test limits');
   attempt.rfqId=r.id;attempt.refundAt=r.quote.refund_locktime;attempt.relativeRefundDelay=r.scriptOptions.unilateralRefundWithoutReceiverDelay;
   fs.writeFileSync(sendFile,JSON.stringify(attempt),{mode:0o600});
   const txid=await send(params);attempt.fundingTxid=txid;attempt.fundedAmount=params.amount;
   fs.writeFileSync(sendFile,JSON.stringify(attempt),{mode:0o600});return txid;
  };
  emit('refund-funded',await swap.execute(preview,route,option.quote,attempt.id));
  emit('refund-deadline',{rfqId:attempt.rfqId,refundAt:attempt.refundAt,relativeDelay:attempt.relativeRefundDelay,amount:attempt.fundedAmount});
 }else if(mode==='refund-fail-invoice'){
  const attempt=JSON.parse(fs.readFileSync(sendFile));if(!attempt.fundingTxid)throw Error('Not funded: cannot run refund scenario');
  const ln=require('./lightning.cjs');await ln.call('Bolt11FailForHash',{payment_hash:attempt.hash});ln.close();
  emit('refund-invoice-failed',{rfqId:attempt.rfqId});
 }else if(mode==='refund-status'){
  const attempt=JSON.parse(fs.readFileSync(sendFile));emit('refund-status',{...await swap.status(attempt.id),refundAt:attempt.refundAt});
 }else if(mode==='send-retry'){
  const attempt=JSON.parse(fs.readFileSync(sendFile));
  wallet.sendBitcoin=async()=>{throw Error('Duplicate funding forbidden')};
  const result=await swap.execute({}, {}, {}, attempt.id);
  if(result.status!=='completed')throw Error('Settled attempt did not restore');
  emit('duplicate-execute-after-restart',result);
 }else if(mode==='send-status'){
  const attempt=JSON.parse(fs.readFileSync(sendFile));emit('send-status',await swap.status(attempt.id));
 }else if(mode==='send-lost-ack'||mode==='send-live-lost-ack'){
  if(fs.existsSync(sendFile)){emit('existing-send',await swap.status(JSON.parse(fs.readFileSync(sendFile)).id));return;}
  let invoice;
  if(mode==='send-live-lost-ack'){
   const ln=require('./lightning.cjs');invoice=(await ln.call('Bolt11Receive',{amount_msat:'10000000',expiry_secs:3600})).invoice;ln.close();
  }else{
   const address=await (await fetch('https://lnurl.mutinynet.com/.well-known/lnurlp/refund')).json();
   const callback=new URL(address.callback);if(callback.origin!=='https://lnurl.mutinynet.com')throw Error('Unexpected faucet callback');
   callback.searchParams.set('amount','10000000');invoice=(await (await fetch(callback)).json()).pr;
  }
  const facts=intents.invoiceFacts(invoice);if(facts.amountSats!==10000||!invoice.startsWith('lntbs'))throw Error('Wrong test invoice');
  const preview={code:{invoice},request:{amountSat:10000}};
  const route={kind:'swap',sourceId:`qa-${role}`,from:'ark',to:'ln:mutinynet',providerId:'arkade-intents'};
  const option=(await swap.quoteOptions(preview,route)).find(o=>o.id==='kaleidoswap');
  if(!option?.quote)throw Error(option?.unavailable||'No maker quote');
  if(option.quote.totalSat>10200)throw Error('Test spend cap exceeded');
  const attempt={id:mode==='send-lost-ack'?'maker-live-lost-ack-1':'maker-live-lost-ack-2',invoice,quote:option.quote};
  fs.writeFileSync(sendFile,JSON.stringify(attempt),{flag:'wx',mode:0o600});
  const send=wallet.sendBitcoin.bind(wallet);
  wallet.sendBitcoin=async(params)=>{const txid=await send(params);fs.writeFileSync(path.join(dir,'broadcast.json'),JSON.stringify({txid,amount:params.amount}),{mode:0o600});throw Error('TEST: lost connection after real broadcast');};
  emit('approved-test-send',{amount:10000,total:option.quote.totalSat});
  try{emit('send-result',await swap.execute(preview,route,option.quote,attempt.id));}catch(e){emit('interrupted-send',{message:e.message});}
 }else if(mode==='receive'||mode==='receive-funded'){
  if(fs.existsSync(receiptFile)){emit('existing-receipt',{...JSON.parse(fs.readFileSync(receiptFile))});return;}
  const receipt=await intents.createArkadeLightningReceive({network:'mutinynet',wallet,arkServerUrl:server,arkNetwork:info.network,makerUrl:maker,providerId:'kaleidoswap',store},10000);
  fs.writeFileSync(receiptFile,JSON.stringify(receipt,null,2),{mode:0o600,flag:'wx'}); emit('receive-prepared',receipt);
 }else if(mode==='expiry-clock'){
  const receipt=JSON.parse(fs.readFileSync(receiptFile));const record=await store.get(receipt.rfqId);
  if(record.phase!=='prepared')throw Error('Only the unfunded expiry fixture may be time-shifted');
  const realExpiry=intents.invoiceFacts(record.invoice).expiresAt;
  const {ArkadeIntentsVenue}=require('@kaleidorg/swap-sdk/arkade');
  for(const [label,now,expected]of [['invoice-valid',realExpiry-1,'prepared'],['invoice-and-grace-ended',realExpiry+901,'cancelled']]){
   let copy={...record,invoiceExpiresAt:realExpiry};
   const isolated={put:async r=>{copy=r},get:async id=>id===copy.id?copy:undefined,listPending:async()=>['prepared','funded'].includes(copy.phase)?[copy]:[]};
   wallet.sendBitcoin=async()=>{throw Error('Expiry probe must never send')};
   const venue=new ArkadeIntentsVenue({wallet,arkServerUrl:server,store:isolated,now:()=>now,transport:{requestQuote:async()=>{throw Error('No RFQ allowed')},status:async()=>null,close:async()=>{}}});
   await venue.reconcile();if(copy.phase!==expected)throw Error(`${label}: ${copy.phase}`);
   emit('real-sdk-controlled-clock',{label,phase:copy.phase,liveChainRead:true,productionRecordUnchanged:(await store.get(record.id)).phase});
  }
 }else if(mode==='board'){
  const inputs=await wallet.getBoardingUtxos();
  if(!inputs.length)throw Error('No test boarding UTXOs');
  emit('boarding-start',{inputs:inputs.length});
  emit('boarding-settled',{txid:await wallet.settle()});
 }else if(mode==='claim'||mode.startsWith('offline-')||mode==='claim-funded'||mode==='offline-funded'){
  const receipt=JSON.parse(fs.readFileSync(receiptFile));
  const before=await store.get(receipt.rfqId);let denied=0;
  if(mode.startsWith('offline-'))global.fetch=async()=>{denied++;throw Error('TEST: offline')};
  try {emit('receive-status',{id:receipt.rfqId,phase:await intents.claimArkadeLightningReceive(wallet,server,receipt.rfqId,store)});}
  catch(e){if(!mode.startsWith('offline-'))throw e;emit('offline-error',{message:e.message});}
  if(mode.startsWith('offline-')){const after=await store.get(receipt.rfqId);if(after.phase!==before.phase)throw Error('Offline changed phase');emit('offline-preserved',{phase:after.phase,denied});}
 }else if(mode!=='status')throw Error('Unknown mode');
 emit('pending',{records:(await store.listPending()).map(r=>({id:r.id,phase:r.phase,route:r.route}))});
}
main().then(()=>process.exit(0)).catch(e=>{emit('error',{message:e.message,stack:e.stack});process.exit(1)});
