import React, {useEffect,useRef,useState} from 'react';
import {ScrollView,Text,TextInput,TouchableOpacity,View,Share} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import {NetworkIcon} from '../components/NetworkIcon';
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
 const [editing,setEditing]=useState(false),[notice,setNotice]=useState(''),[manual,setManual]=useState<Record<string,boolean>>({});
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
 const card={padding:t.spacing[4],borderRadius:t.borderRadius.xl,backgroundColor:t.colors.surface.primary,borderWidth:1,borderColor:t.colors.border.light,gap:t.spacing[3]};
 const icon=(type:string)=>type==='lightning'?'lightning':type==='bitcoin'?'onchain':type;
 const short=(value:string)=>value.length>22?`${value.slice(0,12)}…${value.slice(-8)}`:value;
 const pill=(title:string,onPress:()=>void,opts:{label?:string;primary?:boolean;disabled?:boolean}={})=><TouchableOpacity key={title} accessibilityRole="button" accessibilityLabel={opts.label} disabled={opts.disabled||busy} onPress={onPress}
  style={{paddingVertical:t.spacing[2],paddingHorizontal:t.spacing[3],borderRadius:t.borderRadius.full,backgroundColor:opts.primary?t.colors.primary[500]+'22':t.colors.background.primary,opacity:opts.disabled||busy?0.5:1}}>
  <Text style={{color:opts.primary?t.colors.primary[500]:t.colors.text.primary,fontSize:t.typography.fontSize.sm,fontWeight:'600'}}>{title}</Text></TouchableOpacity>;
 const iconButton=(name:keyof typeof Ionicons.glyphMap,label:string,onPress:()=>void)=><TouchableOpacity key={label} accessibilityRole="button" accessibilityLabel={label} disabled={busy} onPress={onPress} hitSlop={6}
  style={{width:34,height:34,borderRadius:17,alignItems:'center',justifyContent:'center',backgroundColor:t.colors.background.primary}}><Ionicons name={name} size={18} color={t.colors.text.secondary}/></TouchableOpacity>;
 const hint={...text,color:t.colors.text.secondary,fontSize:t.typography.fontSize.sm};
 const input={...text,borderWidth:1,borderColor:t.colors.border.light,backgroundColor:t.colors.background.primary,borderRadius:t.borderRadius.lg,padding:t.spacing[3]};
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
     <Text style={hint}>This QR accepts, in your order</Text>
     <View style={{flexDirection:'row',flexWrap:'wrap',gap:t.spacing[2]}}>{(offer.rails?.length?offer.rails:['ln']).map((r,i)=>{const kind=(typeof r==='string'?r:r.rail).split(':')[0];const type=kind==='ln'?'lightning':kind==='btc'?'bitcoin':kind;return <View key={kind} style={{flexDirection:'row',alignItems:'center',gap:6,paddingVertical:6,paddingHorizontal:t.spacing[3],borderRadius:t.borderRadius.full,backgroundColor:t.colors.surface.primary}}>
      <Text style={{...hint,fontSize:t.typography.fontSize.xs}}>{i+1}</Text><NetworkIcon network={icon(type)} size={14}/><Text style={{...text,fontSize:t.typography.fontSize.sm}}>{label(type)}</Text></View>})}</View>
     <Button title="Share payment QR link" variant="secondary" disabled={busy} onPress={()=>{void Share.share({message:merchantPaymentCode(offer)}).catch(()=>setError('Could not share the payment request.'));}}/>
     <Text style={hint}>Keep using this QR. Each Lightning payment gets its own invoice. The receiving node must stay online.</Text>
     {!editing&&<Button title="Edit receiving preferences" variant="secondary" disabled={busy} onPress={()=>{setEditing(true);setNotice('');setError('');}}/>}
     <Button title="Check received payments" variant="secondary" loading={busy&&!editing} disabled={busy} onPress={()=>void run(false)}/>
     <Text accessibilityLiveRegion="polite" style={text}>{checked?`${settled.length} completed Lightning payments`:'Check payments to load Lightning receipts'}</Text>
     <Text style={hint}>Direct Arkade and Bark payments are tracked by their respective wallets.</Text>
     {receipts.map(p=><View key={p.payment_hash}><Text style={text}>{p.amount/1000} sats · {p.state}</Text><Text selectable style={hint}>{p.payment_hash}</Text></View>)}
    </>}
    {(!offer||editing)&&<>
     <Text style={{...text,fontSize:t.typography.fontSize.lg,fontWeight:'600'}}>Where you want to receive</Text>
     <Text style={hint}>Order the layers you accept. The first is preferred; payers see your order and pick a route they can pay. Lightning is always accepted. Addresses are public, on {connection.network}.</Text>
     {preferences.destinations.map((d,index)=>{
      const filled=d.type!=='lightning'&&!!d.address&&(d.type==='bitcoin'||!!d.serverKey);
      const status=d.type==='lightning'?'Your node issues the offer; always accepted':filled?`${short(d.address)}${d.type==='bitcoin'?'':' · from your wallet'}`:d.type==='bitcoin'?'Add a public on-chain address':`Use your ${label(d.type)} wallet or enter an address`;
      return <View key={d.type} style={{...card,borderColor:index===0?t.colors.primary[500]:t.colors.border.light}}>
       <View style={{flexDirection:'row',alignItems:'center',gap:t.spacing[3]}}>
        <Text style={{...hint,width:18,textAlign:'center',fontWeight:'700',color:index===0?t.colors.primary[500]:t.colors.text.secondary}}>{index+1}</Text>
        <View style={{width:40,height:40,borderRadius:20,alignItems:'center',justifyContent:'center',backgroundColor:t.colors.background.primary}}><NetworkIcon network={icon(d.type)} size={22}/></View>
        <View style={{flex:1,gap:2}}>
         <Text style={{...text,fontWeight:'600'}}>{label(d.type)}{index===0?'  ·  preferred':''}</Text>
         <Text numberOfLines={1} style={{...hint,color:filled||d.type==='lightning'?t.colors.text.secondary:t.colors.warning[500]}}>{status}</Text>
        </View>
        {index>0&&iconButton('chevron-up',`Move ${label(d.type)} up`,()=>move(index,-1))}
        {index<preferences.destinations.length-1&&iconButton('chevron-down',`Move ${label(d.type)} down`,()=>move(index,1))}
        {d.type!=='lightning'&&iconButton('close',`Remove ${label(d.type)}`,()=>updateDestinations(preferences.destinations.filter((_,i)=>i!==index)))}
       </View>
       {d.type!=='lightning'&&<View style={{flexDirection:'row',flexWrap:'wrap',gap:t.spacing[2]}}>
        {d.type!=='bitcoin'&&pill(`Use my ${label(d.type)} wallet`,()=>void useConnectedWallet(d.type as 'bark'|'arkade'),{primary:true})}
        {d.type!=='bitcoin'&&pill(manual[d.type]?'Hide manual entry':'Enter manually',()=>setManual(m=>({...m,[d.type]:!m[d.type]})))}
       </View>}
       {d.type!=='lightning'&&(d.type==='bitcoin'||manual[d.type])&&<>
        <TextInput accessibilityLabel={`${label(d.type)} receiving address`} placeholder="Public receiving address" placeholderTextColor={t.colors.text.secondary} value={d.address} onChangeText={value=>updateEndpoint(index,'address',value)} editable={!busy} autoCapitalize="none" autoCorrect={false} style={input}/>
        {d.type!=='bitcoin'&&<TextInput accessibilityLabel={`${label(d.type)} server public key`} placeholder="Server x-only public key (64 hex characters)" placeholderTextColor={t.colors.text.secondary} value={d.serverKey} onChangeText={value=>updateEndpoint(index,'serverKey',value.toLowerCase())} editable={!busy} autoCapitalize="none" autoCorrect={false} style={input}/>}
       </>}
      </View>;
     })}
     {(['bark','arkade','bitcoin'] as const).some(type=>!preferences.destinations.some(d=>d.type===type))&&<View style={{gap:t.spacing[2]}}>
      <Text style={hint}>Add a layer</Text>
      <View style={{flexDirection:'row',flexWrap:'wrap',gap:t.spacing[2]}}>
       {(['bark','arkade','bitcoin'] as const).filter(type=>!preferences.destinations.some(d=>d.type===type)).map(type=>pill(`+ ${label(type)}`,()=>add(type),{label:`Add ${label(type)} address`,disabled:!ready}))}
      </View>
     </View>}
     <Button title="Save preferences" variant="secondary" disabled={!ready||busy} onPress={()=>void saveDefaults()}/>
     <TextInput accessibilityLabel="Payment description" value={description} onChangeText={value=>{pending.current=null;setDescription(value)}} maxLength={256} editable={!busy} style={input}/>
     <TextInput accessibilityLabel="Reusable QR amount in sats" value={amount} onChangeText={value=>{pending.current=null;setAmount(value)}} keyboardType="number-pad" placeholder="Amount in sats (optional)" placeholderTextColor={t.colors.text.secondary} editable={!busy} style={input}/>
     <Text style={hint}>Leave the amount empty to let each payer choose. Extra destinations require a compatible issuing node. An on-chain address wraps the offer in one Bitcoin payment link.</Text>
     {offer&&<Text style={hint}>Creating an updated QR replaces the one saved here. Previously shared offers may still receive payments; they are not revoked.</Text>}
     <Button title={offer?'Create updated QR':'Create reusable QR'} disabled={!ready||busy} loading={busy} onPress={()=>void run(true)}/>
     {offer&&<Button title="Close preferences" variant="secondary" disabled={busy} onPress={()=>setEditing(false)}/>}
    </>}
   </>}
  </ScrollView>
 </SafeAreaView>;
}
