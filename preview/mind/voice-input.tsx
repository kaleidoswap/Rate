import React,{forwardRef,useImperativeHandle,useRef,useEffect} from 'react';
import {getRuntime,logEvent} from './runtime';
export default forwardRef(function VoiceInput(props:any,ref:any){const active=useRef(false);const propsRef=useRef(props);propsRef.current=props;
function stop(){if(!active.current)return;active.current=false;propsRef.current.onEnd?.();if(getRuntime().voiceError)propsRef.current.onError?.('no-speech');else propsRef.current.onResult?.(getRuntime().voiceText);}
useImperativeHandle(ref,()=>({warmup:async()=>{},startListening:()=>{active.current=true;propsRef.current.onStart?.();logEvent('Voce simulata: premi Stop / il cerchio per inviare la frase di prova.');},stopListening:stop,cancelListening:()=>{active.current=false}}));
useEffect(()=>()=>{active.current=false},[]);return null});
let speechTimer:any;
export async function speak(text:string,cb:any={}){logEvent('Risposta vocale simulata; nessun audio riprodotto.');clearTimeout(speechTimer);await new Promise<void>(r=>{speechTimer=setTimeout(()=>{cb.onDone?.();r()},1200)})}
export async function stopSpeak(){clearTimeout(speechTimer)}
export async function startHandsFreeVoice(h:any){let stopped=false;h.onState?.('listening');logEvent('Hands-free simulato: invio di una sola frase di prova.');const timer=setTimeout(async()=>{if(stopped)return;const text=getRuntime().voiceText;h.onUserText?.(text);h.onState?.('thinking');const answer=await h.respond(text);if(stopped)return;h.onState?.('speaking');await h.speak(answer);if(!stopped)h.onState?.('listening')},900);return {stop(){stopped=true;clearTimeout(timer)}}}
