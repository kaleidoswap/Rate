const fs=require('node:fs'),path=require('node:path');
const ln=require('./lightning.cjs');
const dir=path.join(require('node:os').homedir(),'.local/share/rate-qa/arkade-maker-20261103/bob');
const receipt=JSON.parse(fs.readFileSync(path.join(dir,'receive-funded.json')));
const file=path.join(dir,'lightning-payment.json');
(async()=>{
 if(fs.existsSync(file))throw Error('Payment already attempted: check its status, never repay');
 if(receipt.provider!=='KaleidoSwap'||!receipt.invoice.startsWith('lntbs')||receipt.payAmountSats>10200||receipt.expiresAt<=Date.now()/1000+10)throw Error('Test payment guard');
 fs.writeFileSync(file,JSON.stringify({rfqId:receipt.rfqId,amount:receipt.payAmountSats,started:true}),{mode:0o600,flag:'wx'});
 const result=await ln.call('Bolt11Send',{invoice:receipt.invoice});
 fs.writeFileSync(file,JSON.stringify({rfqId:receipt.rfqId,amount:receipt.payAmountSats,...result}),{mode:0o600});
 console.log(JSON.stringify(result));ln.close();
})().catch(e=>{console.error(e.message);ln.close();process.exitCode=1});
