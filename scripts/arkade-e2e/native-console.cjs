// Read native Hermes debugger diagnostics, not browser or UI automation.
const fs=require('node:fs'),WebSocket=require('ws');
(async()=>{const targets=await(await fetch('http://127.0.0.1:8088/json/list')).json();const t=targets.find(t=>t.appId==='com.kaleidoswap.wallet'&&t.deviceName.includes(process.argv[2]||'Rate Maker QA'));
if(!t)throw Error('Native runtime not connected');const ws=new WebSocket(t.webSocketDebuggerUrl);
ws.on('open',()=>{ws.send(JSON.stringify({id:1,method:'Runtime.enable'}));ws.send(JSON.stringify({id:2,method:'Log.enable'}));});
ws.on('message',raw=>{const e=JSON.parse(raw);if(e.method==='Runtime.exceptionThrown'||e.method==='Log.entryAdded'||e.method==='Runtime.consoleAPICalled')console.log(JSON.stringify(e));});
setTimeout(()=>ws.close(),4000);
})().catch(e=>{console.error(e.message);process.exitCode=1});
