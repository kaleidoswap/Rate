// Companion to the existing, isolated maker Signet smoke node. TLS certificate pinned.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const grpc=require('@grpc/grpc-js'),loader=require('@grpc/proto-loader');
const base=path.resolve(__dirname,'../../../kaleidoswap-maker-rs/e2e/signet-smoke/run');
const definition=loader.loadSync(path.join(base,'ldk-server-src/ldk-server-grpc/src/proto/api.proto'),{keepCase:true,longs:String,enums:String,defaults:true,oneofs:true});
const api=grpc.loadPackageDefinition(definition).api;
const client=new api.LightningNode('localhost:13646',grpc.credentials.createSsl(fs.readFileSync(path.join(base,'certs/client.crt'))));
const key=fs.readFileSync(path.join(base,'data/signet/api_key')).toString('hex');
async function call(method,body={}){
 if(!['GetNodeInfo','GetBalances','ListChannels','Bolt11Receive','Bolt11Send','GetPaymentDetails','Bolt11ReceiveForHash','Bolt11FailForHash'].includes(method))throw Error('Unsupported test operation');
 const bytes=api.LightningNode.service[method].requestSerialize(body);
 const frame=Buffer.alloc(5);frame.writeUInt32BE(bytes.length,1);
 const timestamp=Math.floor(Date.now()/1000);const time=Buffer.alloc(8);time.writeBigUInt64BE(BigInt(timestamp));
 const mac=crypto.createHmac('sha256',Buffer.from(key)).update(time).update(frame).update(bytes).digest('hex');
 const metadata=new grpc.Metadata();metadata.set('x-auth',`HMAC ${timestamp}:${mac}`);
 return new Promise((resolve,reject)=>client[method](body,metadata,{deadline:Date.now()+20000},(e,r)=>e?reject(e):resolve(r)));
}
module.exports={call,close:()=>client.close()};
if(require.main===module)(async()=>{console.log(JSON.stringify({info:await call('GetNodeInfo'),balances:await call('GetBalances'),channels:await call('ListChannels')}));client.close()})().catch(e=>{console.error(e.message);client.close();process.exitCode=1});
