import {useSyncExternalStore} from 'react';
import {QVAC_MODELS,QVAC_STT_MODELS,QVAC_TTS_OPTIONS,DEFAULT_MODEL_ID,DEFAULT_STT_MODEL_ID,recommendLocalModel} from '../../services/qvacModels';
let snapshot:any={llmStatus:'ready',whisperStatus:'ready',llmDownloadProgress:100,error:null,ram:8,available:true,downloadedModelIds:[DEFAULT_MODEL_ID,DEFAULT_STT_MODEL_ID],config:{modelId:DEFAULT_MODEL_ID,sttModelId:DEFAULT_STT_MODEL_ID,ttsEngine:'supertonic',providerPublicKey:'',delegateEnabled:false},events:[],voiceText:'Mostrami il saldo',voiceError:false};
const listeners=new Set<()=>void>();
export const updateRuntime=(patch:any)=>{snapshot={...snapshot,...patch};listeners.forEach(fn=>fn())};
export const getRuntime=()=>snapshot;
export function logEvent(text:string){updateRuntime({events:[...snapshot.events.slice(-9),text]})}
let timer:any;
const patchConfig=(patch:any)=>updateRuntime({config:{...snapshot.config,...patch}});
export function simulateStatus(status:string){clearInterval(timer);updateRuntime({llmStatus:status,llmDownloadProgress:status==='downloading'?35:100,error:status==='error'?'Errore simulato: memoria insufficiente.':null})}
export const selectModel=async(id:string)=>{
 clearInterval(timer);
 const selected=QVAC_MODELS.find(m=>m.id===id)!;
 if(selected.tier!=='phone'){id=recommendLocalModel(snapshot.ram*1024**3).id;logEvent('Comportamento attuale: 4B sostituito dal modello raccomandato.');}
 patchConfig({modelId:id});
 if(snapshot.downloadedModelIds.includes(id)){simulateStatus('ready');return}
 updateRuntime({llmStatus:'downloading',llmDownloadProgress:0});
 timer=setInterval(()=>{const p=Math.min(100,snapshot.llmDownloadProgress+20);updateRuntime({llmDownloadProgress:p});if(p===100){clearInterval(timer);updateRuntime({llmStatus:'ready',downloadedModelIds:[...new Set([...snapshot.downloadedModelIds,id])]});logEvent('Download simulato completato.')}},250);
};
const service={getAvailability:async()=>({runtimeAvailable:snapshot.available,localCapable:snapshot.ram>=6,deviceMemGb:snapshot.ram}),cancelRequest:async()=>{cancelled=true},initializeWhisper:async()=>{},getState:()=>snapshot};
export let cancelled=false;
export function resetCancel(){cancelled=false}
export default class QVACService{static getInstance(){return service}}
export function useQVAC(){const s=useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn)},getRuntime);return {...s,service,isReady:s.llmStatus==='ready',isWhisperReady:s.whisperStatus==='ready',isDownloading:s.llmStatus==='downloading',isPreparing:['downloading','loading'].includes(s.llmStatus),combinedProgress:s.llmDownloadProgress,catalog:QVAC_MODELS,sttCatalog:QVAC_STT_MODELS,ttsOptions:QVAC_TTS_OPTIONS,deviceMemGb:s.ram,recommendedModelId:recommendLocalModel(s.ram*1024**3).id,initialize:()=>simulateStatus('ready'),setModel:selectModel,setDelegate:async()=>{},reloadConfig:()=>{},setSttModel:async(id:string)=>{patchConfig({sttModelId:id});if(id==='whisper-large-v3-turbo')logEvent('Comportamento attuale: selezione Turbo conservata, ma sul telefono viene caricato Whisper Base.');},setTtsEngine:async(id:string)=>patchConfig({ttsEngine:id}),deleteModel:async(id:string)=>{updateRuntime({downloadedModelIds:snapshot.downloadedModelIds.filter((x:string)=>x!==id)});if(id===snapshot.config.modelId)simulateStatus('not_downloaded')}}}
