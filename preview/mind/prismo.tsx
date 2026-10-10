// The app's Prismo, driven with the preview's own state names and audio level.
import React,{useEffect,useState} from 'react';
import {MindCharacter as Prismo} from '../../components/mind/MindCharacter';
export type MindCharacterState='idle'|'listening'|'thinking'|'speaking'|'success';
export function MindCharacter({size,state='idle',animate=true,speechLevel}:{size?:number;state?:MindCharacterState;animate?:boolean;speechLevel?:{addListener:(cb:(v:{value:number})=>void)=>string;removeListener:(id:string)=>void}}){
 const [level,setLevel]=useState(0);
 useEffect(()=>{if(!speechLevel)return;const id=speechLevel.addListener(v=>setLevel(v.value));return()=>speechLevel.removeListener(id)},[speechLevel]);
 return <Prismo mood={state==='success'?'happy':state} size={size} animated={animate} level={speechLevel?level:undefined}/>;
}
