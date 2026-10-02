import React, {useEffect,useRef,useState} from 'react';
import {ScrollView,Text,TextInput,View,Share} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {useAppSelector} from '../store/hooks';
import {useAppTheme} from '../theme/ThemeProvider';
import {ScreenHeader} from '../components/ScreenHeader';
import {Button} from '../components/Button';
import {ReceiveQr} from '../components/receive/ReceiveQr';
import {NWCClient,parseNwcUri} from '../services/nwc/NWCExternalClient';
import {loadNwcCredential} from '../services/nwc/connectionStore';
import {createMerchantOffer,listMerchantReceipts,type OfferReceipt} from '../services/kaleidoPay/merchantOffer';
import {loadMerchantOffer,saveMerchantOffer,type SavedMerchantOffer} from '../services/kaleidoPay/merchantOfferStore';

export default function MerchantOfferScreen({navigation}: {navigation:any}) {
 const t=useAppTheme();
 const connection=useAppSelector(s=>s.nostr.nwcConnections.find(c=>c.id===s.nostr.selectedNwcConnectionId));
 const [offer,setOffer]=useState<SavedMerchantOffer|null>(null),[receipts,setReceipts]=useState<OfferReceipt[]>([]);
 const [description,setDescription]=useState('KaleidoPay'),[amount,setAmount]=useState('');
 const [checked,setChecked]=useState(false);
 const [busy,setBusy]=useState(false),[ready,setReady]=useState(false),[error,setError]=useState('');
 const generation=useRef(0),working=useRef(false),client=useRef<NWCClient|null>(null);
 useEffect(()=>{
  const revision=++generation.current;setOffer(null);setReceipts([]);setChecked(false);setError('');setReady(false);setBusy(false);working.current=false;
  if(connection)void loadMerchantOffer(connection.id,connection.network).then(saved=>{if(generation.current===revision){setOffer(saved);setReady(true)}}).catch(()=>{if(generation.current===revision)setError('Could not read your saved QR. Reopen this screen before creating another.');});
  return ()=>{generation.current++;client.current?.close();client.current=null};
 },[connection?.id,connection?.network]);
 async function run(create: boolean) {
  if(!connection||!ready||working.current)return;
  const revision=generation.current;working.current=true;setBusy(true);setError('');
  let active:NWCClient|null=null;
  try {
   if(create&&offer)return;
   if(create&&amount&&!/^[1-9]\d*$/.test(amount))throw Error('Enter a whole number of sats, or leave the amount empty.');
   const uri=await loadNwcCredential(connection.id);
   if(!uri||parseNwcUri(uri).walletPubkey.toLowerCase()!==connection.walletPubkey.toLowerCase())throw Error('Reconnect your receiving wallet.');
   if(generation.current!==revision)return;
   active=new NWCClient(uri,{timeoutMs:20000});client.current=active;
   if(create) {
    const result=await createMerchantOffer(active,connection.network,description,amount?Number(amount):undefined);
    const saved={...result,description,network:connection.network};
    // Persist before displaying: reopening must reuse the same QR.
    await saveMerchantOffer(connection.id,saved);
    if(generation.current===revision)setOffer(saved);
   } else if(offer) {
    const result=await listMerchantReceipts(active,offer.offer_id);
    if(generation.current===revision){setReceipts(result);setChecked(true)}
   }
  }catch(e){if(generation.current===revision)setError(e instanceof Error?e.message:'Could not reach the receiving wallet.');}
  finally {active?.close();if(client.current===active)client.current=null;if(generation.current===revision){working.current=false;setBusy(false)}}
 }
 const text={color:t.colors.text.primary,fontSize:t.typography.fontSize.base};
 const settled=receipts.filter(p=>p.state==='settled');
 return <SafeAreaView style={{flex:1,backgroundColor:t.colors.background.primary}}>
  <ScreenHeader title="Reusable payment QR" onBack={()=>navigation.goBack()}/>
  <ScrollView contentContainerStyle={{padding:t.spacing[5],gap:t.spacing[4]}} keyboardShouldPersistTaps="handled">
   <Text style={text}>One QR for every payment. Your connected wallet stays online to receive.</Text>
   {!connection?<><Text style={text}>Connect a receiving wallet that supports reusable BOLT12 offers.</Text><Button title="Connect receiving wallet" onPress={()=>navigation.navigate('NWCConnect')}/></>:<>
    <Text style={text}>{connection.alias||'Connected wallet'} · {connection.network}</Text>
    {!!error&&<Text accessibilityRole="alert" style={{...text,color:t.colors.warning[500]}}>{error}</Text>}
    {offer?<>
     <Text style={text}>{offer.description} · {offer.amount===undefined?'Payer chooses amount':`${offer.amount/1000} sats`}</Text>
     <ReceiveQr value={offer.offer} size={240}/>
     <Button title="Share payment QR link" onPress={()=>{void Share.share({message:offer.offer}).catch(()=>setError('Could not share the payment request.'));}}/>
     <Text style={text}>Keep using this QR. Each payment gets its own invoice.</Text>
     <Button title="Check received payments" loading={busy} disabled={busy} onPress={()=>void run(false)}/>
     <Text accessibilityLiveRegion="polite" style={text}>{checked?`${settled.length} completed payments`:'Check payments to load receipts'}</Text>
     {receipts.map(p=><View key={p.payment_hash}><Text style={text}>{p.amount/1000} sats · {p.state}</Text><Text selectable style={text}>{p.payment_hash}</Text></View>)}
    </>:<>
     <TextInput accessibilityLabel="Payment description" value={description} onChangeText={setDescription} maxLength={256} editable={!busy} style={text}/>
     <TextInput accessibilityLabel="Reusable QR amount in sats" value={amount} onChangeText={setAmount} keyboardType="number-pad" placeholder="Amount in sats (optional)" placeholderTextColor={t.colors.text.secondary} editable={!busy} style={text}/>
     <Text style={text}>Leave the amount empty to let each payer choose.</Text>
     <Button title="Create reusable QR" disabled={!ready||busy} loading={busy} onPress={()=>void run(true)}/>
    </>}
   </>}
  </ScrollView>
 </SafeAreaView>;
}
