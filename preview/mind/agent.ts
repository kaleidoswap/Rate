// Scripted scenarios exercise the real chat UI, not AI accuracy or real payments.
import bundle from '../../skills.bundle.json';
import {skillsFromBundle} from './skills';
import {getRuntime,logEvent,cancelled,resetCancel} from './runtime';
let memory='';
export async function clearMindMemory(){memory='';logEvent('Memoria demo cancellata.')}
const pause=(ms:number)=>new Promise(r=>setTimeout(r,ms));
export function createMindAgent(_q:any,getSettings:any=()=>({})){return {listSkills:()=>skillsFromBundle(bundle).filter((s:any)=>!getSettings().disabledSkills?.includes(s.name)),async runTurn(text:string,cbs:any={}){
resetCancel();cbs.onStart?.('preview-turn');const cfg=getSettings();logEvent(`Scenario simulato · cronologia passata: ${Math.min(cbs.history?.length||0,cfg.historyLength||8)} messaggi · memoria ${cfg.memoryEnabled?'on':'off'} · RAG ${cfg.ragEnabled?'on':'off'}`);await pause(350);
if(cancelled)return {tier:'agentic',text:'Interrotto.',inference:[{status:'cancelled'}]};
if(/saldo|balance/i.test(text)){logEvent('Simulato: lettura del wallet → scheda saldo.');return {tier:'fast',intent:'balance',text:'Saldo dimostrativo, non collegato al wallet.',data:{total_sats:125000,layers:[{layer:'spark',btc_sats:80000},{layer:'rln',btc_sats:45000}]}}}
if(/send|invia|paga|pay to/i.test(text)){const amount=Number(text.match(/\b(\d+)\b/)?.[1]||0);if(!amount)return {tier:'recipe',text:'Quanti sats vuoi inviare ad Alice demo? Prova “Invia 1000 sats ad Alice”.'};const call={name:'send_payment',arguments:{to:'alice@example.invalid',amount_sats:amount}};logEvent('Simulato: richiesta di conferma, nessuna transazione reale.');cbs.onToolCall?.(call,{requiresConfirmation:true});const d=await cbs.onConfirm?.(call);return {tier:'recipe',text:d?.approved?'Conferma ricevuta nella demo. Nessun pagamento eseguito.':'Operazione dimostrativa annullata.'}}
if(/merchant|negoz|bar|caff|shops/i.test(text)){return {tier:'agentic',text:'Due risultati inventati per verificare il layout.',toolCalls:[{name:'find_merchant_locations',result:{success:true,merchants:[{name:'Caffè demo',address:'Indirizzo dimostrativo',distance_m:240,accepts_lightning:true},{name:'Negozio demo',address:'Indirizzo dimostrativo',distance_m:680,accepts_bitcoin:true}],source:'preview'}}]}}
if(/invoice|fattura/i.test(text)){const amount=Number(text.match(/\b(\d+)\b/)?.[1]||5000);return {tier:'agentic',text:'Richiesta dimostrativa: QR non pagabile.',toolCalls:[{name:'generate_invoice',result:{success:true,invoice:'DEMO-NON-PAGABILE-'+amount,amount_sats:amount,description:'DEMO · non pagabile'}}]};}
if(/receive|address|ricev|indirizzo/i.test(text))return {tier:'agentic',text:'Indirizzo dimostrativo, non utilizzare per ricevere fondi.',toolCalls:[{name:'get_receive_address',result:{success:true,address:'DEMO — indirizzo non valido'}}]};
if(/recent|activity|transaz/i.test(text))return {tier:'agentic',text:'Attività inventata per la revisione.',toolCalls:[{name:'list_recent_transactions',result:{success:true,transactions:[{direction:'received',amount_sats:12000},{direction:'sent',amount_sats:1000}]}}]};
let answer='Demo guidata: prova saldo, invio di 1000 sats, negozi, “ricorda che parlo italiano” oppure “spiega Lightning”. Nessun modello AI è in esecuzione.';

if(/ricorda|remember/i.test(text)){if(cfg.memoryEnabled){memory='Preferisci risposte in italiano.';answer='Memoria demo salvata: preferisci risposte in italiano.'}else answer='Memoria disattivata. Questa preferenza non viene salvata nella demo.'}
if(/ricordi|recall/i.test(text))answer=cfg.memoryEnabled?(memory||'Nessuna memoria dimostrativa salvata.'):'Memoria disattivata.';
if(/spiega|explain|rag|Lightning/i.test(text))answer=cfg.ragEnabled?'RAG: il codice prevede una ricerca nella documentazione Bitcoin integrata. Nel runtime attuale il plugin embeddings non è incluso: non è una funzione da presentare come verificata. Questa è una spiegazione dimostrativa.':'RAG disattivato. La demo non consulta documenti e non esegue un modello.';
if(cfg.persona)logEvent('Personalità inoltrata alle impostazioni della demo; non ne simula la qualità linguistica.');
for(const word of answer.split(' ')){if(cancelled)return {tier:'agentic',text:'Interrotto.',inference:[{status:'cancelled'}]};cbs.onToken?.(word+' ',0);await pause(25)}return {tier:'agentic',text:answer};
}}}
