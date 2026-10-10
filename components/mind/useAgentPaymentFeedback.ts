import {useEffect,useState} from 'react';
import {DeviceEventEmitter} from 'react-native';

/** Celebrate an adapter-confirmed payment, never merely the approval click. */
export function useAgentPaymentFeedback() {
  const [confirmed,setConfirmed]=useState(false);
  useEffect(()=>{
    let timer:ReturnType<typeof setTimeout>;
    const sub=DeviceEventEmitter.addListener('rate.agentPaymentConfirmed',()=>{
      clearTimeout(timer);setConfirmed(true);
      timer=setTimeout(()=>setConfirmed(false),5000);
    });
    return()=>{sub.remove();clearTimeout(timer)};
  },[]);
  return confirmed;
}
