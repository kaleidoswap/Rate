import React from 'react';
import {createPortal} from 'react-dom';
export * from 'react-native-web';
// Native modals cover navigation too. Portals reproduce this in the phone frame.
// Payment review gets a scrollable browser container so short desktop viewports
// do not hide its actions; the native component itself has no ScrollView.
export function Modal({visible,children,animationType}:any){if(!visible)return null;const phone=document.querySelector('.phone');const body=<div className={'native-modal '+(animationType==='none'?'payment-modal':'')}>{children}</div>;return phone?createPortal(body,phone):body}
export const Alert={alert:(title:string,message:string,buttons:any[]=[])=>{if(!buttons.length){window.alert(title+'\n\n'+message);return}if(window.confirm(title+'\n\n'+message)){buttons.find(b=>b.style!=='cancel')?.onPress?.()}}};

export const Share={sharedAction:'sharedAction',dismissedAction:'dismissedAction',share:async()=>{window.alert('Condivisione simulata. Nessun contenuto inviato.');return {action:'dismissedAction'}}};
export const Linking={openURL:async(url:string)=>{window.alert('Link dimostrativo: '+url)},canOpenURL:async()=>false};
