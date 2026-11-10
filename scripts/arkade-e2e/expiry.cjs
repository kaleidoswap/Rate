// Wait for the REAL protocol grace window; never changes the clock or payment state.
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=path.join(require('node:os').homedir(),'.local/share/rate-qa/arkade-maker-20261103');
const receipt=JSON.parse(fs.readFileSync(path.join(root,'bob/receive.json')));
const deadline=(receipt.expiresAt+15*60+5)*1000;
(async()=>{
 console.log(JSON.stringify({event:'waiting-real-expiry',id:receipt.rfqId,deadline:new Date(deadline).toISOString()}));
 while(Date.now()<deadline)await new Promise(r=>setTimeout(r,Math.min(30000,deadline-Date.now())));
 const r=spawnSync(process.execPath,['--experimental-eventsource',path.join(__dirname,'probe.cjs'),'claim','bob'],{encoding:'utf8',timeout:45000});
 process.stdout.write(r.stdout||'');
 if(r.status!==0)throw Error('Expiry recovery probe failed');
 const result=r.stdout.split('\n').filter(l=>l.startsWith('{')).map(l=>JSON.parse(l)).find(e=>e.event==='receive-status');
 if(result?.phase!=='prepared')throw Error(`Invoice remains payable: expected prepared, got ${result?.phase}`);
 console.log(JSON.stringify({event:'quote-expiry-grace-passed-without-premature-cancellation',id:receipt.rfqId}));
})().catch(e=>{console.error(e.message);process.exitCode=1});
