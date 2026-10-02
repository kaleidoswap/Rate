import React, {useEffect,useRef,useState} from 'react';
import {ScrollView,Text,TextInput,View,Share} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {useAppSelector} from '../store/hooks';
import {useAppTheme} from '../theme/ThemeProvider';
import {ScreenHeader} from '../components/ScreenHeader';
import {Button} from '../components/Button';
import {ReceiveQr} from '../components/receive/ReceiveQr';
import {NWCClient,parseNwcUri} from '../services/nwc/NWCExternalClient';
import {loadConnectedReceiverDestination} from '../services/kaleidoPay/merchantOfferWallet';
import {loadNwcCredential} from '../services/nwc/connectionStore';
import {createMerchantOffer,listMerchantReceipts,type OfferReceipt} from '../services/kaleidoPay/merchantOffer';
import {loadMerchantOffer,saveMerchantOffer,merchantPaymentCode,type SavedMerchantOffer} from '../services/kaleidoPay/merchantOfferStore';
import {defaultReceiverPreferences,receiverRails,loadReceiverPreferences,saveReceiverPreferences,type ReceiverPreferences,type ReceiverDestination} from '../services/kaleidoPay/merchantOfferPreferences';

export default function MerchantOfferScreen({navigation}: {navigation:any}) {
 const t=useAppTheme();
 const connection=useAppSelector(s=>s.nostr.nwcConnections.find(c=>c.id===s.nostr.selectedNwcConnectionId));
 const [offer,setOffer]=useState<SavedMerchantOffer|null>(null),[receipts,setReceipts]=useState<OfferReceipt[]>([]);
 const [description,setDescription]=useState('KaleidoPay'),[amount,setAmount]=useState('');
 const [preferences,setPreferences]=useState<ReceiverPreferences>(defaultReceiverPreferences('mainnet'));
 const [editing,setEditing]=useState(false),[notice,setNotice]=useState('');
 const [checked,setChecked]=useState(false);
 const [busy,setBusy]=useState(false),[ready,setReady]=useState(false),[error,setError]=useState('');
 const generation=useRef(0),working=useRef(false),client=useRef<NWCClient|null>(null);
 const pending=useRef<SavedMerchantOffer|null>(null);
 useEffect(()=>{
  const revision=++generation.current;
  setOffer(null);setReceipts([]);setChecked(false);setError('');setNotice('');setReady(false);setBusy(false);setEditing(false);
  setDescription('KaleidoPay');setAmount('');working.current=false;pending.current=null;
  if(connection) {
   setPreferences(defaultReceiverPreferences(connection.network));
   void Promise.all([loadMerchantOffer(connection.id,connection.network),loadReceiverPreferences(connection.id,connection.network)])
    .then(([saved,defaults])=>{if(generation.current===revision){setOffer(saved);setPreferences(defaults);setDescription(saved?.description??'KaleidoPay');setAmount(saved?.amount===undefined?'':String(saved.amount/1000));setReady(true)}})
    .catch(()=>{if(generation.current===revision)setError('Could not read your saved receiving settings. Reopen this screen before creating another QR.');});
  }
  return ()=>{generation.current++;client.current?.close();client.current=null};
 },[connection?.id,connection?.network]);
 function updateDestinations(destinations:ReceiverDestination[]){pending.current=null;setPreferences(p=>({...p,destinations}));setNotice('');}
 function move(index:number,offset:number){const list=[...preferences.destinations];[list[index],list[index+offset]]=[list[index+offset],list[index]];updateDestinations(list)}
 function add(type:'arkade'|'bark'|'bitcoin'){updateDestinations([...preferences.destinations.filter(d=>d.type!=='lightning'),type==='bitcoin'?{type,address:''}:{type,address:'',serverKey:''},...preferences.destinations.filter(d=>d.type==='lightning')])}
 function updateEndpoint(index:number,field:'address'|'serverKey',value:string){updateDestinations(preferences.destinations.map((d,i)=>i===index&&d.type!=='lightning'?{...d,[field]:value.trim()}:d))}
 async function useConnectedWallet(type:'bark'|'arkade'){
  if(!connection||!ready||working.current)return;
  const revision=generation.current;working.current=true;setBusy(true);setError('');
  try{
   const endpoint=await loadConnectedReceiverDestination(type,connection.network);
   if(generation.current===revision)updateDestinations(preferences.destinations.map(d=>d.type===type?endpoint:d));
  }catch(e){if(generation.current===revision)setError(e instanceof Error?e.message:'Could not load the receiving address.');}
  finally{if(generation.current===revision){working.current=false;setBusy(false)}}
 }
 async function saveDefaults(){
  if(!connection||!ready||working.current)return;
  const revision=generation.current;working.current=true;setBusy(true);setError('');setNotice('');
  try{await saveReceiverPreferences(connection.id,preferences);if(generation.current===revision)setNotice('Preferences saved for future offers. Your existing QR is unchanged.');}
  catch(e){if(generation.current===revision)setError(e instanceof Error?e.message:'Could not save preferences.');}
  finally{if(generation.current===revision){working.current=false;setBusy(false)}}
 }
 async function run(create:boolean) {
  if(!connection||!ready||working.current)return;
  const revision=generation.current;working.current=true;setBusy(true);setError('');setNotice('');
  let active:NWCClient|null=null;
  try {
   if(create&&offer&&!editing)return;
   if(create&&amount&&!/^[1-9]\d*$/.test(amount))throw Error('Enter a whole number of sats, or leave the amount empty.');
   const rails=create?receiverRails(preferences):undefined;
   if(create){await saveReceiverPreferences(connection.id,preferences);if(generation.current!==revision)return;}
   if(create&&pending.current){
    await saveMerchantOffer(connection.id,pending.current);
    if(generation.current===revision){setOffer(pending.current);pending.current=null;setEditing(false);setReceipts([]);setChecked(false)}
    return;
   }
   const uri=await loadNwcCredential(connection.id);
   if(!uri||parseNwcUri(uri).walletPubkey.toLowerCase()!==connection.walletPubkey.toLowerCase())throw Error('Reconnect your receiving wallet.');
   if(generation.current!==revision)return;
   active=new NWCClient(uri,{timeoutMs:20000});client.current=active;
   if(create) {
    const result=await createMerchantOffer(active,connection.network,description,amount?Number(amount):undefined,rails);
    if(generation.current!==revision)return;
    const bitcoin=preferences.destinations.find(d=>d.type==='bitcoin');
    const saved={...result,description,network:connection.network,...(rails?{rails}:{}),...(bitcoin?.type==='bitcoin'?{onchainAddress:bitcoin.address}:{})};
    pending.current=saved;
    await saveMerchantOffer(connection.id,saved);
    if(generation.current===revision){pending.current=null;setOffer(saved);setEditing(false);setReceipts([]);setChecked(false)}
   }else if(offer){
    const result=await listMerchantReceipts(active,offer.offer_id);
    if(generation.current===revision){setReceipts(result);setChecked(true)}
   }
  }catch(e){if(generation.current===revision)setError(e instanceof Error?e.message:'Could not reach the receiving wallet.');}
  finally{active?.close();if(client.current===active)client.current=null;if(generation.current===revision){working.current=false;setBusy(false)}}
 }
 const text={color:t.colors.text.primary,fontSize:t.typography.fontSize.base};
 const hint={...text,color:t.colors.text.secondary,fontSize:t.typography.fontSize.sm};
 const input={...text,borderWidth:1,borderColor:t.colors.text.secondary,borderRadius:8,padding:t.spacing[3]};
 const settled=receipts.filter(p=>p.state==='settled');
 const label=(type:string)=>type==='lightning'?'Lightning':type==='arkade'?'Arkade':type==='bitcoin'||type==='btc'?'Bitcoin on-chain':'Bark';
 return <SafeAreaView style={{flex:1,backgroundColor:t.colors.background.primary}}>
  <ScreenHeader title="Reusable payment QR" onBack={()=>navigation.goBack()}/>
  <ScrollView contentContainerStyle={{padding:t.spacing[5],gap:t.spacing[4]}} keyboardShouldPersistTaps="handled">
   <Text style={text}>One QR for every payment. Choose where you prefer to receive; the payer chooses a supported route.</Text>
   {!connection?<><Text style={text}>Connect a receiving wallet that supports reusable BOLT12 offers.</Text><Button title="Connect receiving wallet" onPress={()=>navigation.navigate('NWCConnect')}/></>:<>
    <Text style={text}>{connection.alias||'Connected wallet'} · {connection.network}</Text>
    {!!error&&<Text accessibilityRole="alert" style={{...text,color:t.colors.warning[500]}}>{error}</Text>}
    {!!notice&&<Text accessibilityLiveRegion="polite" style={hint}>{notice}</Text>}
    {offer&&<>
     <Text style={text}>{offer.description} · {offer.amount===undefined?'Payer chooses amount':`${offer.amount/1000} sats`}</Text>
     <ReceiveQr value={merchantPaymentCode(offer)} size={240}/>
     <Text style={hint}>This QR: {offer.rails?.map(r=>label((typeof r==='string'?r:r.rail).split(':')[0]==='ln'?'lightning':(typeof r==='string'?r:r.rail).split(':')[0])).join(' → ')||'Lightning'}</Text>
     <Button title="Share payment QR link" disabled={busy} onPress={()=>{void Share.share({message:merchantPaymentCode(offer)}).catch(()=>setError('Could not share the payment request.'));}}/>
     <Text style={hint}>Keep using this QR. Each Lightning payment gets its own invoice. The receiving node must stay online.</Text>
     {!editing&&<Button title="Edit receiving preferences" disabled={busy} onPress={()=>{setEditing(true);setNotice('');setError('');}}/>}
     <Button title="Check received payments" loading={busy&&!editing} disabled={busy} onPress={()=>void run(false)}/>
     <Text accessibilityLiveRegion="polite" style={text}>{checked?`${settled.length} completed Lightning payments`:'Check payments to load Lightning receipts'}</Text>
     <Text style={hint}>Direct Arkade and Bark payments are tracked by their respective wallets.</Text>
     {receipts.map(p=><View key={p.payment_hash}><Text style={text}>{p.amount/1000} sats · {p.state}</Text><Text selectable style={hint}>{p.payment_hash}</Text></View>)}
    </>}
    {(!offer||editing)&&<>
     <Text style={text}>Receiving preferences</Text>
     <Text style={hint}>First is preferred. Lightning stays available as a fallback. Use public receiving addresses on {connection.network}; each wallet must verify them before payment.</Text>
     {preferences.destinations.map((d,index)=><View key={d.type} style={{gap:t.spacing[2],paddingVertical:t.spacing[3]}}>
      <Text style={text}>{index+1}. {label(d.type)}</Text>
      {d.type!=='lightning'&&<>
       {d.type!=='bitcoin'&&<Button title={`Use connected ${label(d.type)} wallet`} disabled={busy} onPress={()=>void useConnectedWallet(d.type as 'bark'|'arkade')}/>}
       <TextInput accessibilityLabel={`${label(d.type)} receiving address`} placeholder="Public receiving address" placeholderTextColor={t.colors.text.secondary} value={d.address} onChangeText={value=>updateEndpoint(index,'address',value)} editable={!busy} autoCapitalize="none" autoCorrect={false} style={input}/>
       {d.type!=='bitcoin'&&<TextInput accessibilityLabel={`${label(d.type)} server public key`} placeholder="Server x-only public key (64 hex characters)" placeholderTextColor={t.colors.text.secondary} value={d.serverKey} onChangeText={value=>updateEndpoint(index,'serverKey',value.toLowerCase())} editable={!busy} autoCapitalize="none" autoCorrect={false} style={input}/>}
       <Button title={`Remove ${label(d.type)}`} disabled={busy} onPress={()=>updateDestinations(preferences.destinations.filter((_,i)=>i!==index))}/>
      </>}
      {index>0&&<Button title={`Move ${label(d.type)} up`} disabled={busy} onPress={()=>move(index,-1)}/>}
      {index<preferences.destinations.length-1&&<Button title={`Move ${label(d.type)} down`} disabled={busy} onPress={()=>move(index,1)}/>}
     </View>)}
     {(['arkade','bark','bitcoin'] as const).filter(type=>!preferences.destinations.some(d=>d.type===type)).map(type=><Button key={type} title={`Add ${label(type)} address`} disabled={!ready||busy} onPress={()=>add(type)}/>)}
     <Button title="Save preferences" disabled={!ready||busy} onPress={()=>void saveDefaults()}/>
     <TextInput accessibilityLabel="Payment description" value={description} onChangeText={value=>{pending.current=null;setDescription(value)}} maxLength={256} editable={!busy} style={input}/>
     <TextInput accessibilityLabel="Reusable QR amount in sats" value={amount} onChangeText={value=>{pending.current=null;setAmount(value)}} keyboardType="number-pad" placeholder="Amount in sats (optional)" placeholderTextColor={t.colors.text.secondary} editable={!busy} style={input}/>
     <Text style={hint}>Leave the amount empty to let each payer choose. Extra destinations require a compatible issuing node. An on-chain address wraps the offer in one Bitcoin payment link.</Text>
     {offer&&<Text style={hint}>Creating an updated QR replaces the one saved here. Previously shared offers may still receive payments; they are not revoked.</Text>}
     <Button title={offer?'Create updated QR':'Create reusable QR'} disabled={!ready||busy} loading={busy} onPress={()=>void run(true)}/>
     {offer&&<Button title="Close preferences" disabled={busy} onPress={()=>setEditing(false)}/>}
    </>}
   </>}
  </ScrollView>
 </SafeAreaView>;
}
