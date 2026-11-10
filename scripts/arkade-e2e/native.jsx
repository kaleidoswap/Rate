// Native-only development entry. Not imported by index.ts or a release bundle.
import 'react-native-get-random-values';
import { Buffer } from 'buffer';
import { EventSourcePolyfill } from 'event-source-polyfill';
global.Buffer = Buffer;
global.EventSource = EventSourcePolyfill;
import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, Platform } from 'react-native';
import { registerRootComponent } from 'expo';
import * as SecureStore from 'expo-secure-store';
import * as FS from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { buildArkadeStorage } from '../../services/protocols/arkadeStorage';
import { loadMakerCatalog } from '../../services/makerRoutes';
import { createArkadeLightningReceive, claimArkadeLightningReceive, createAsyncStorageArkadeSwapStore } from '../../services/kaleidoPay/arkadeIntents';
const server='https://mutinynet.arkade.sh',maker='https://maker.signet.kaleidoswap.com';
const output=FS.documentDirectory+'rate-native-arkade-qa.json';
const report={platform:Platform.OS,hermes:!!global.HermesInternal,events:[]};
async function emit(event,details={}){report.events.push({event,at:new Date().toISOString(),...details});await FS.writeAsStringAsync(output,JSON.stringify(report,null,2));}
async function run(){
 if(!__DEV__||!global.HermesInternal)throw Error('Development Hermes runtime required');
 await emit('started');
 let key=await SecureStore.getItemAsync('rate.qa.arkade.key');const restored=!!key;
 if(!key){key=Buffer.from(global.crypto.getRandomValues(new Uint8Array(32))).toString('hex');await SecureStore.setItemAsync('rate.qa.arkade.key',key);}
 const storage=buildArkadeStorage({network:'mutinynet',accountIndex:99001});if(!storage)throw Error('Native SQLite unavailable');
 const sdk=require('@arkade-os/sdk');
 const provider=new sdk.RestArkProvider(server);const info=await provider.getInfo();if(info.network!=='mutinynet')throw Error('Wrong network');
 const wallet=await sdk.Wallet.create({identity:sdk.SingleKey.fromPrivateKey(Buffer.from(key,'hex')),arkProvider:provider,indexerProvider:new sdk.RestIndexerProvider(server),onchainProvider:new sdk.EsploraProvider('https://esplora.signet.kaleidoswap.com'),storage});
 const address=await wallet.getAddress();const previous=await AsyncStorage.getItem('rate.qa.arkade.address');if(previous&&previous!==address)throw Error('Identity changed on restart');await AsyncStorage.setItem('rate.qa.arkade.address',address);
 await emit('wallet-ready',{restored,address,balance:await wallet.getBalance()});
 const catalog=await loadMakerCatalog(maker,'mutinynet');await emit('catalogue',{routes:catalog.routes.length});
 const store=createAsyncStorageArkadeSwapStore('rate.qa.arkade.records:');
 const raw=await AsyncStorage.getItem('rate.qa.arkade.receive');let receipt=raw?JSON.parse(raw):null;
 if(!receipt){receipt=await createArkadeLightningReceive({wallet,network:'mutinynet',arkNetwork:'mutinynet',arkServerUrl:server,makerUrl:maker,providerId:'kaleidoswap',store},10000);await AsyncStorage.setItem('rate.qa.arkade.receive',JSON.stringify(receipt));}
 await emit('receipt-ready',{restored:!!raw,id:receipt.rfqId});
 const online=await claimArkadeLightningReceive(wallet,server,receipt.rfqId,store);await emit('recovery-online',{phase:online});
 const original=global.fetch;let denied=0;const before=await store.get(receipt.rfqId);
 try{global.fetch=async()=>{denied++;throw Error('QA offline')};await claimArkadeLightningReceive(wallet,server,receipt.rfqId,store).catch(()=>{});}finally{global.fetch=original;}
 const after=await store.get(receipt.rfqId);if(before.phase!==after.phase)throw Error('Offline recovery changed phase');
 await emit('offline-preserved',{phase:after.phase,denied});
 await emit('passed',{restored});
}
function NativeQA(){const [state,setState]=useState('Testing native Arkade…');useEffect(()=>{run().then(()=>setState('Native checks passed')).catch(async e=>{await emit('failed',{message:e.message,stack:e.stack});setState(e.message);});},[]);return <ScrollView contentContainerStyle={{padding:32}}><Text style={{fontSize:24}}>Rate native QA</Text><Text>{state}</Text><Text>Mutinynet · isolated wallet · no payments</Text></ScrollView>}
registerRootComponent(NativeQA);
