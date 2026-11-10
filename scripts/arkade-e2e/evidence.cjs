const fs=require('node:fs'),path=require('node:path'),{DatabaseSync}=require('node:sqlite');
const ln=require('./lightning.cjs');
const root=path.join(require('node:os').homedir(),'.local/share/rate-qa/arkade-maker-20261103');
(async()=>{
 const sends=JSON.parse(fs.readFileSync(path.join(root,'alice/send-live.json')));
 const invoice=require('light-bolt11-decoder').decode(sends.invoice);
 const sendHash=invoice.sections.find(s=>s.name==='payment_hash').value;
 const receive=JSON.parse(fs.readFileSync(path.join(root,'bob/lightning-payment.json')));
 const out={network:'mutinynet',runtime:'Node.js running Rate service and shipped Arkade SDK; not native UI',checkedAt:new Date().toISOString(),payments:[]};
 for(const [role,id]of [['alice',sendHash],['bob',receive.payment_id]]){
  const {payment:p}=await ln.call('GetPaymentDetails',{payment_id:id});
  if(p.status!=='SUCCEEDED')throw Error(`${role} payment ${p.status}`);
  out.payments.push({role,id:p.id,status:p.status,amountMsat:p.amount_msat,direction:p.direction});
 }
 out.records=[];
 for(const role of ['alice','bob']){
  const db=new DatabaseSync(path.join(root,role,'public-state.sqlite'),{readOnly:true});
  for(const {value}of db.prepare("SELECT value FROM kv WHERE key LIKE 'kaleidopay-arkade-intents-record:%'").all()){
   const r=JSON.parse(value);out.records.push({role,id:r.id,route:r.route,phase:r.phase,fundingTxid:r.fundingTxid,resolvedTxid:r.resolvedTxid,invoiceExpiresAt:r.invoiceExpiresAt});
  }
  db.close();
 }
 fs.writeFileSync(path.resolve(__dirname,'../../output/maker-mobile-audit/arkade-live-evidence.json'),JSON.stringify(out,null,2)+'\n');
 console.log(JSON.stringify(out));ln.close();
})().catch(e=>{console.error(e.message);ln.close();process.exitCode=1});
