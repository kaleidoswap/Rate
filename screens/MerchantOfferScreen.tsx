import React, {useEffect,useRef,useState} from 'react';
import {ScrollView,Text,TextInput,TouchableOpacity,View,Share,Clipboard,Modal,useWindowDimensions,KeyboardAvoidingView,Platform} from 'react-native';
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
import {protocolManager} from '../services/protocols';
import {loadNwcCredential} from '../services/nwc/connectionStore';
import {createMerchantOffer,checkMerchantCapabilities,listMerchantReceipts,type OfferReceipt} from '../services/kaleidoPay/merchantOffer';
import {loadMerchantOffer,saveMerchantOffer,merchantPaymentCode,type SavedMerchantOffer} from '../services/kaleidoPay/merchantOfferStore';
import {defaultReceiverPreferences,receiverRails,loadReceiverPreferences,saveReceiverPreferences,type ReceiverPreferences,type ReceiverDestination} from '../services/kaleidoPay/merchantOfferPreferences';

// The QR receives only at the user's own connected accounts, so saved on-chain entries (typed in by hand) are dropped.
const connectedOnly=(p:ReceiverPreferences):ReceiverPreferences=>({...p,destinations:p.destinations.filter(d=>d.type!=='bitcoin')});

export default function MerchantOfferScreen({navigation}: {navigation:any}) {
 const t=useAppTheme();
 const {width,height}=useWindowDimensions();
 const [fullScreen,setFullScreen]=useState(false);
 const [capability,setCapability]=useState<{checking:boolean;addressPreferences:boolean;error:string}>({checking:true,addressPreferences:false,error:''});
 const [checkAttempt,setCheckAttempt]=useState(0);
 const connections=useAppSelector(s=>s.nostr.nwcConnections);
 const selectedId=useAppSelector(s=>s.nostr.selectedNwcConnectionId);
 const [receiverId,setReceiverId]=useState<string|null>(null);
 const connection=connections.find(c=>c.id===(receiverId??selectedId))??connections[0];
 const [accounts,setAccounts]=useState<Array<{type:'bark'|'arkade';compatible:boolean}>>([]);
 useEffect(()=>{
  let active=true;
  async function refresh(){
   const results=await Promise.all((['bark','arkade'] as const).map(async type=>{
    try{const info=await protocolManager.getAdapterIfAvailable(type==='bark'?'BARK':'ARKADE')?.getConnectionInfo();
     return info?.connected?{type,compatible:(info.network==='bitcoin'?'mainnet':info.network)===connection?.network}:null;
    }catch{return null;}
   }));
   if(active)setAccounts(results.filter((a):a is {type:'bark'|'arkade';compatible:boolean}=>a!==null));
  }
  void refresh();const unsubscribe=navigation.addListener('focus',()=>void refresh());
  return()=>{active=false;unsubscribe();};
 },[connection?.network,navigation]);
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
    .then(([saved,defaults])=>{if(generation.current===revision){setOffer(saved);setPreferences(connectedOnly(defaults));setDescription(saved?.description??'KaleidoPay');setAmount(saved?.amount===undefined?'':String(saved.amount/1000));setReady(true)}})
    .catch(()=>{if(generation.current===revision)setError('Could not read your saved receiving settings. Reopen this screen before creating another QR.');});
  }
  return ()=>{generation.current++;client.current?.close();client.current=null};
 },[connection?.id,connection?.network]);
 useEffect(()=>{
  let active=true;let checkingClient:NWCClient|null=null;
  setCapability({checking:!!connection,addressPreferences:false,error:''});
  if(connection)void (async()=>{
   try{
    const uri=await loadNwcCredential(connection.id);
    if(!active)return;
    if(!uri||parseNwcUri(uri).walletPubkey.toLowerCase()!==connection.walletPubkey.toLowerCase())throw Error('Reconnect your receiving wallet.');
    checkingClient=new NWCClient(uri,{timeoutMs:15000});
    const result=await checkMerchantCapabilities(checkingClient,connection.network);
    if(active)setCapability({checking:false,addressPreferences:result.addressPreferences,error:''});
   }catch(e){if(active)setCapability({checking:false,addressPreferences:false,error:e instanceof Error?e.message:'Could not check this wallet. Try again.'});}
   finally{checkingClient?.close();}
  })();
  return()=>{active=false;checkingClient?.close();};
 },[connection?.id,connection?.network,checkAttempt]);
 async function copyPayment(){
  if(!offer)return;
  try{Clipboard.setString(merchantPaymentCode(offer));setNotice('Payment link copied.');}
  catch{setError('Could not copy the payment link.');}
 }
 function updateDestinations(destinations:ReceiverDestination[]){pending.current=null;setPreferences(p=>({...p,destinations}));setNotice('');}
 function move(index:number,offset:number){const list=[...preferences.destinations];[list[index],list[index+offset]]=[list[index+offset],list[index]];updateDestinations(list)}
 async function useConnectedWallet(type:'bark'|'arkade'){
  if(!connection||!ready||working.current)return;
  const revision=generation.current;working.current=true;setBusy(true);setError('');
  try{
   const endpoint=await loadConnectedReceiverDestination(type,connection.network);
   if(generation.current===revision){
    setEditing(true);
    const exists=preferences.destinations.some(d=>d.type===type);
    updateDestinations(exists?preferences.destinations.map(d=>d.type===type?endpoint:d):[...preferences.destinations.filter(d=>d.type!=='lightning'),endpoint,...preferences.destinations.filter(d=>d.type==='lightning')]);
   }
  }catch(e){if(generation.current===revision)setError(e instanceof Error?e.message:'Could not load the receiving address.');}
  finally{if(generation.current===revision){working.current=false;setBusy(false)}}
 }
 async function saveDefaults(){
  if(!connection||!ready||working.current)return;
  const revision=generation.current;working.current=true;setBusy(true);setError('');setNotice('');
  try{await saveReceiverPreferences(connection.id,preferences);if(generation.current===revision)setNotice('Defaults saved for future QRs. Your current QR is unchanged.');}
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
    const saved={...result,description,network:connection.network,...(rails?{rails}:{})};
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
 let blocked='';
 if(!ready)blocked='Loading your receiving settings…';
 else if(capability.checking)blocked='Checking reusable payment support…';
 else if(capability.error)blocked=capability.error;
 else if(!description.trim())blocked='Add a name for your payment QR.';
 else if(amount&&(!/^[1-9]\d*$/.test(amount)||!Number.isSafeInteger(Number(amount)*1000)))blocked='Enter a valid whole amount in sats.';
 else {
  try{const rails=receiverRails(preferences);if(rails&&!capability.addressPreferences)blocked='This wallet supports Lightning only. Remove other accounts or choose another wallet.';}
  catch{blocked='Complete or remove the unfinished receiving addresses.';}
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
 const section=(title:string,subtitle?:string)=><View style={{gap:4}}><Text style={{...text,fontSize:t.typography.fontSize.lg,fontWeight:'700'}}>{title}</Text>{subtitle&&<Text style={hint}>{subtitle}</Text>}</View>;
 const badge=(name:keyof typeof Ionicons.glyphMap)=><View style={{width:44,height:44,borderRadius:16,backgroundColor:t.colors.primary[500]+'18',alignItems:'center',justifyContent:'center'}}><Ionicons name={name} size={23} color={t.colors.primary[500]}/></View>;
 return <SafeAreaView style={{flex:1,backgroundColor:t.colors.background.primary}}>
  <ScreenHeader title="Reusable payment" onBack={()=>navigation.goBack()}/>
  <KeyboardAvoidingView style={{flex:1}} behavior={Platform.OS==='ios'?'padding':undefined}>
  <ScrollView contentContainerStyle={{padding:t.spacing[5],gap:t.spacing[5],paddingBottom:t.spacing[8]}} keyboardShouldPersistTaps="handled">
   {(!offer||editing)&&<>
   <View style={{flexDirection:'row',alignItems:'center',gap:t.spacing[3]}}>
    {badge('qr-code-outline')}<View style={{flex:1,gap:4}}><Text style={{...text,fontSize:t.typography.fontSize.xl,fontWeight:'700'}}>One QR. Your way.</Text><Text style={hint}>Choose your accounts. Set your preference. Get paid.</Text></View>
   </View>
   {section('Receiving accounts', 'Choose a Lightning wallet to create your reusable QR.')}
   <View style={{gap:t.spacing[2]}}>
    {connections.map(c=><TouchableOpacity key={c.id} accessibilityRole="radio" accessibilityState={{checked:connection?.id===c.id,disabled:busy}} disabled={busy} onPress={()=>setReceiverId(c.id)} style={{...card,flexDirection:'row',alignItems:'center',borderColor:connection?.id===c.id?t.colors.primary[500]:t.colors.border.light}}>
     <NetworkIcon network="lightning" size={30}/><View style={{flex:1,gap:3}}><Text style={{...text,fontWeight:'600'}}>{c.alias||'Lightning wallet'}</Text><Text style={hint}>Saved connection</Text></View><Ionicons name={connection?.id===c.id?'checkmark-circle':'ellipse-outline'} size={24} color={connection?.id===c.id?t.colors.primary[500]:t.colors.text.secondary}/>
    </TouchableOpacity>)}
    {accounts.map(a=><TouchableOpacity key={a.type} accessibilityRole="button" accessibilityLabel={`Add connected ${label(a.type)} account`} disabled={!connection||!ready||busy||!a.compatible} onPress={()=>void useConnectedWallet(a.type)} style={{...card,flexDirection:'row',alignItems:'center'}}>
     <NetworkIcon network={a.type} size={30}/><View style={{flex:1,gap:3}}><Text style={{...text,fontWeight:'600'}}>{label(a.type)}</Text><Text style={hint}>{!connection?'Connected account':!a.compatible?'Not compatible with this receiving wallet':preferences.destinations.some(d=>d.type===a.type)?'Added to your QR':'Connected · Add to your QR'}</Text></View><Ionicons name={preferences.destinations.some(d=>d.type===a.type)?'checkmark-circle':'add-circle-outline'} size={24} color={t.colors.primary[500]}/>
    </TouchableOpacity>)}
    <TouchableOpacity accessibilityRole="button" disabled={busy} onPress={()=>navigation.navigate('NWCConnect')} style={{flexDirection:'row',alignItems:'center',gap:8,paddingVertical:t.spacing[3]}}><Ionicons name="add-circle-outline" size={22} color={t.colors.primary[500]}/><Text style={{...text,color:t.colors.primary[500],fontWeight:'600'}}>{connections.length?'Connect another wallet':'Connect Lightning wallet'}</Text></TouchableOpacity>
   </View>
   {connection&&<View style={{gap:8}}><Text accessibilityLiveRegion="polite" style={hint}>{capability.checking?'Checking wallet…':capability.error|| (capability.addressPreferences?'Ready for reusable payments':'Ready for Lightning payments')}</Text>{!!capability.error&&<Button title="Check again" variant="secondary" onPress={()=>setCheckAttempt(n=>n+1)}/>}</View>}
   </>}
   {!!error&&<View accessibilityRole="alert" style={{...card,flexDirection:'row',alignItems:'center'}}><Ionicons name="alert-circle-outline" size={22} color={t.colors.warning[500]}/><Text style={{...text,flex:1}}>{error}</Text></View>}
   {!!notice&&<Text accessibilityLiveRegion="polite" style={{...hint,color:t.colors.primary[500]}}>{notice}</Text>}
   {connection&&<>
    {offer&&!editing&&<>
     <View style={{...card,alignItems:'center',paddingVertical:t.spacing[6],gap:t.spacing[4]}}>
      <Text style={{...text,fontSize:t.typography.fontSize.lg,fontWeight:'700'}}>{offer.description||'Your payment QR'}</Text>
      <Text style={hint}>{offer.amount===undefined?'Any amount':`${offer.amount/1000} sats`}</Text>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="Show QR full screen" onPress={()=>setFullScreen(true)}><ReceiveQr value={merchantPaymentCode(offer)} size={Math.min(240,width-100)}/></TouchableOpacity>
      <View style={{flexDirection:'row',flexWrap:'wrap',justifyContent:'center',gap:t.spacing[2]}}>{(offer.rails?.length?offer.rails:['ln']).map((r,i)=>{const kind=(typeof r==='string'?r:r.rail).split(':')[0];const type=kind==='ln'?'lightning':kind==='btc'?'bitcoin':kind;return <View key={kind} style={{flexDirection:'row',alignItems:'center',gap:6,padding:8,borderRadius:t.borderRadius.full,backgroundColor:t.colors.background.primary}}><Text style={hint}>{i+1}</Text><NetworkIcon network={icon(type)} size={16}/><Text style={hint}>{label(type)}</Text></View>})}</View>
      <Text style={hint}>Ready to share. Use it again and again.</Text>
     </View>
     <Button title="Share payment link" disabled={busy} onPress={()=>{void Share.share({message:merchantPaymentCode(offer)}).catch(()=>setError('Could not share the payment request.'));}}/>
     <View style={{flexDirection:'row',justifyContent:'center',gap:t.spacing[5]}}>
      <TouchableOpacity accessibilityRole="button" onPress={()=>void copyPayment()} style={{alignItems:'center',gap:6,padding:12}}><Ionicons name="copy-outline" size={24} color={t.colors.primary[500]}/><Text style={hint}>Copy link</Text></TouchableOpacity>
      <TouchableOpacity accessibilityRole="button" onPress={()=>setFullScreen(true)} style={{alignItems:'center',gap:6,padding:12}}><Ionicons name="expand-outline" size={24} color={t.colors.primary[500]}/><Text style={hint}>Full screen</Text></TouchableOpacity>
     </View>
     <Button title="Edit payment QR" variant="secondary" disabled={busy} onPress={()=>{setEditing(true);setNotice('');setError('');}}/>
     <View style={card}><View style={{flexDirection:'row',alignItems:'center',gap:8}}><Ionicons name="receipt-outline" size={22} color={t.colors.text.secondary}/><Text style={{...text,fontWeight:'600'}}>Lightning payments</Text></View>
      {checked&&<Text accessibilityLiveRegion="polite" style={text}>{settled.length} received</Text>}
      <Button title="Refresh payments" variant="secondary" loading={busy} disabled={busy} onPress={()=>void run(false)}/>
      <Text style={hint}>Bark and Arkade payments appear in those accounts.</Text>
      {receipts.map(p=><View key={p.payment_hash} style={{flexDirection:'row',justifyContent:'space-between'}}><Text style={text}>{p.amount/1000} sats</Text><Text style={hint}>{p.state}</Text></View>)}
     </View>
    </>}
    {(!offer||editing)&&<>
     {section('Receive in your order', 'Your first choice is preferred. Payers choose an available route.')}
     {preferences.destinations.map((d,index)=>{
      const filled=d.type!=='lightning'&&!!d.address;
      return <View key={d.type} style={{...card,borderColor:index===0?t.colors.primary[500]:t.colors.border.light}}>
       <View style={{flexDirection:'row',alignItems:'center',gap:t.spacing[3]}}>
        <NetworkIcon network={icon(d.type)} size={30}/><View style={{flex:1,gap:4}}><Text style={{...text,fontWeight:'700'}}>{label(d.type)}</Text><Text style={{...hint,color:index===0?t.colors.primary[500]:t.colors.text.secondary}}>{index===0?'Preferred':`Choice ${index+1}`}{d.type==='lightning'?' · Always included':''}</Text></View>
        {index>0&&iconButton('chevron-up',`Move ${label(d.type)} up`,()=>move(index,-1))}
        {index<preferences.destinations.length-1&&iconButton('chevron-down',`Move ${label(d.type)} down`,()=>move(index,1))}
        {d.type!=='lightning'&&iconButton('close',`Remove ${label(d.type)}`,()=>updateDestinations(preferences.destinations.filter((_,i)=>i!==index)))}
       </View>
       {filled&&<Text numberOfLines={1} style={hint}>{short(d.address)}</Text>}
      </View>;
     })}
     <View style={card}>
      <View style={{flexDirection:'row',gap:8,alignItems:'center'}}><Ionicons name="options-outline" size={22} color={t.colors.text.secondary}/><Text style={{...text,fontWeight:'700'}}>Payment details</Text></View>
      <Text style={hint}>Name</Text><TextInput accessibilityLabel="Payment description" placeholder="My payment QR" placeholderTextColor={t.colors.text.secondary} value={description} onChangeText={value=>{pending.current=null;setDescription(value)}} maxLength={256} editable={!busy} style={input}/>
      <Text style={hint}>Amount</Text><View style={{flexDirection:'row',gap:8}}>{pill('Any amount',()=>{pending.current=null;setAmount('')},{primary:!amount})}{pill('Fixed amount',()=>{pending.current=null;setAmount(amount||'1000')},{primary:!!amount})}</View>
      {!!amount&&<TextInput accessibilityLabel="Reusable QR amount in sats" value={amount} onChangeText={value=>{pending.current=null;setAmount(value)}} keyboardType="number-pad" placeholder="Amount in sats" placeholderTextColor={t.colors.text.secondary} editable={!busy} style={input}/>}
     </View>
     <TouchableOpacity accessibilityRole="button" disabled={!ready||busy} onPress={()=>void saveDefaults()} style={{flexDirection:'row',alignItems:'center',gap:8,paddingVertical:8}}><Ionicons name="bookmark-outline" size={20} color={t.colors.primary[500]}/><Text style={{...text,color:t.colors.primary[500]}}>Save as my defaults</Text></TouchableOpacity>
     {offer&&<><Text style={hint}>Updating creates a new QR. Your current QR stays available until the new one is saved. Previously shared QRs will still work.</Text><Button title="Show current QR" variant="secondary" onPress={()=>setFullScreen(true)}/></>}
     {offer&&<Button title="Cancel" variant="secondary" disabled={busy} onPress={()=>setEditing(false)}/>}
    </>}
   </>}
  </ScrollView>
  {connection&&(!offer||editing)&&<View style={{paddingHorizontal:t.spacing[5],paddingVertical:t.spacing[3],gap:8,borderTopWidth:1,borderColor:t.colors.border.light,backgroundColor:t.colors.background.primary}}>
   {!!blocked&&<Text accessibilityLiveRegion="polite" style={hint}>{blocked}</Text>}
   <Button title={offer?'Create updated QR':'Create payment QR'} disabled={!!blocked||busy} loading={busy} onPress={()=>void run(true)}/>
  </View>}
  </KeyboardAvoidingView>
  <Modal visible={fullScreen&&!!offer} animationType="slide" onRequestClose={()=>setFullScreen(false)}>
   <SafeAreaView style={{flex:1,backgroundColor:t.colors.background.primary}}>
    <ScreenHeader title="Your payment QR" onBack={()=>setFullScreen(false)}/>
    {offer&&<View style={{flex:1,alignItems:'center',justifyContent:'center',padding:t.spacing[5],gap:t.spacing[5]}}>
     <Text style={{...text,fontSize:t.typography.fontSize.xl,fontWeight:'700'}}>{offer.description}</Text>
     <Text style={hint}>{offer.amount===undefined?'Any amount':`${offer.amount/1000} sats`}</Text>
     <ReceiveQr value={merchantPaymentCode(offer)} size={Math.max(120,Math.min(width-64,height-280,440))}/>
     <Text style={hint}>Scan to pay</Text>
     <Button title="Close" variant="secondary" onPress={()=>setFullScreen(false)}/>
    </View>}
   </SafeAreaView>
  </Modal>
 </SafeAreaView>;
}
