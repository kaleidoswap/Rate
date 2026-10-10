import React from 'react';
import {Sheet} from './sheet';
export default function Contacts({visible,onClose,onSelectContact}:any){return <Sheet visible={visible} onClose={onClose} title="Contatti dimostrativi"><p>Nessun contatto reale caricato.</p><button onClick={()=>onSelectContact({id:'demo',name:'Alice demo',lightning_address:'alice@example.invalid'})}>Alice demo · scegli destinatario</button></Sheet>}
