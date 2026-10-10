import {useCallback,useEffect,useRef,useState} from 'react';
import {Animated} from 'react-native';
import clips from './assets/prismo/voice/clips.json';
export type ClipId=keyof typeof clips;
type Status='idle'|'loading'|'playing'|'paused'|'ended'|'error';
/** Prerecorded demo speech. The envelope is measured from these exact MP3s. */
export function usePrismoAudio(){
 const audio=useRef<HTMLAudioElement|null>(null);
 const generation=useRef(0),frame=useRef(0),current=useRef<ClipId|null>(null);
 const ended=useRef<(()=>void)|undefined>(undefined);
 const mouthLevel=useRef(new Animated.Value(0)).current;
 const [status,setStatus]=useState<Status>('idle');
 const [clip,setClip]=useState<ClipId|null>(null);
 const [muted,setMuted]=useState(false);
 const [error,setError]=useState('');
 useEffect(()=>{
  const element=new Audio();element.preload='auto';audio.current=element;
  const clear=()=>{cancelAnimationFrame(frame.current);mouthLevel.setValue(0)};
  let smooth=0;
  const tick=()=>{
   const id=current.current;
   if(!id||element.paused||element.ended){clear();return}
   const data=clips[id],index=Math.floor(element.currentTime/data.frameSeconds);
   const target=id==='request'?0:(data.levels[index]??0);
   smooth+=(target-smooth)*(target>smooth?.75:.5);
   mouthLevel.setValue(smooth<.025?0:smooth);
   frame.current=requestAnimationFrame(tick);
  };
  element.onplaying=()=>{setStatus('playing');cancelAnimationFrame(frame.current);smooth=0;tick()};
  element.onpause=()=>{clear();if(!element.ended)setStatus('paused')};
  element.onended=()=>{clear();setStatus('ended');ended.current?.()};
  element.onerror=()=>{clear();setStatus('error');setError('Audio non disponibile. Riprova la battuta.')};
  const visibility=()=>{if(document.hidden&&!element.paused)element.pause()};
  document.addEventListener('visibilitychange',visibility);
  return()=>{generation.current++;element.onplaying=null;element.onpause=null;element.onended=null;element.onerror=null;element.pause();element.removeAttribute('src');element.load();clear();audio.current=null;document.removeEventListener('visibilitychange',visibility)};
 },[mouthLevel]);
 const stop=useCallback(()=>{generation.current++;ended.current=undefined;current.current=null;audio.current?.pause();cancelAnimationFrame(frame.current);mouthLevel.setValue(0);setStatus('idle');setClip(null);setError('')},[mouthLevel]);
 const play=useCallback((id:ClipId,onEnd?:()=>void)=>{
  const element=audio.current;if(!element)return;
  const token=++generation.current;
  element.pause();cancelAnimationFrame(frame.current);mouthLevel.setValue(0);
  current.current=id;ended.current=onEnd;setClip(id);setError('');setStatus('loading');element.src=clips[id].url;
  void element.play().catch(()=>{if(generation.current!==token)return;mouthLevel.setValue(0);setStatus('error');setError('Premi Riprendi audio per ascoltare Prismo.')});
 },[mouthLevel]);
 const pause=useCallback(()=>audio.current?.pause(),[]);
 const resume=useCallback(()=>{const element=audio.current;if(!element||!current.current)return;const token=generation.current;setError('');void element.play().catch(()=>{if(token!==generation.current)return;setStatus('error');setError('La riproduzione è bloccata. Riprova con Riprendi audio.')})},[]);
 const toggleMute=useCallback(()=>{const element=audio.current;if(!element)return;element.muted=!element.muted;setMuted(element.muted)},[]);
 return {play,stop,pause,resume,toggleMute,muted,status,clip,error,mouthLevel,text:clip?clips[clip].text:''};
}
