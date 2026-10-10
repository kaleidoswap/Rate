import React,{useEffect,useState} from 'react';
import {MindCharacter, type MindCharacterState} from './prismo';
import {theme} from '../../theme';
import {MindIcon} from './proposal';
import {usePrismoAudio} from './prismo-audio';

type Step='ready'|'listening'|'thinking'|'speaking'|'balance'|'preparing'|'review'|'confirming'|'done';
const sequence:Partial<Record<Step,{next:Step;ms:number}>>={thinking:{next:'speaking',ms:900},confirming:{next:'done',ms:600}};
const labels:Record<Step,string>={ready:'Facciamo una prova.',listening:'Ti ascolto.',thinking:'Controllo il saldo.',speaking:'Ecco il tuo saldo.',balance:'Come vuoi continuare?',preparing:'Preparo il pagamento.',review:'Controlla, poi conferma.',confirming:'Registro la conferma.',done:'Tutto chiaro. Fatto.'};
const tokens={...Object.fromEntries(Object.entries(theme.spacing).map(([k,v])=>[`--s${k}`,`${v}px`])),'--mind-bg':theme.colors.background.primary,'--mind-card':theme.colors.surface.primary,'--mind-raised':theme.colors.surface.elevated,'--mind-text':theme.colors.text.primary,'--mind-muted':theme.colors.text.secondary,'--mind-line':theme.colors.border.medium,'--mind-green':theme.colors.primary[500],'--mind-ink':theme.colors.text.inverse,'--mind-tint':theme.colors.primary[50]} as React.CSSProperties;
export function FlowDemo(){
 const voice=usePrismoAudio();
 const {play,stop}=voice;
 const [expression,setExpression]=useState<MindCharacterState|null>(null);
 const [step,setStep]=useState<Step>('ready'),[paused,setPaused]=useState(false),[amount,setAmount]=useState('1000');
 useEffect(()=>{const transition=sequence[step];if(!transition||paused||expression)return;const id=setTimeout(()=>setStep(transition.next),transition.ms);return()=>clearTimeout(id)},[step,paused,expression]);
 useEffect(()=>{
   if(expression){if(expression==='speaking')play('balance');else stop();return stop}
   if(step==='listening')play('request',()=>setStep('thinking'));
   else if(step==='speaking')play('balance',()=>setStep('balance'));
   else if(step==='preparing')play('preparing',()=>setStep('review'));
   else if(step==='review')play('review');
   else if(step==='done')play('done');
   else stop();
   return stop;
 },[step,expression,play,stop]);
 const talking=voice.clip!==null&&voice.clip!=='request'&&['playing','paused','loading'].includes(voice.status);
 const phase=talking?'speaking':step==='listening'?'listening':['thinking','preparing','confirming'].includes(step)?'thinking':step==='speaking'?'speaking':step==='done'?'success':'idle';
 const payment=['preparing','review','confirming','done'].includes(step);
 const valid=/^\d+$/.test(amount)&&Number.isSafeInteger(Number(amount))&&Number(amount)>0&&Number(amount)<=80000;
 const number=(value:number)=>new Intl.NumberFormat('it-IT',{useGrouping:true}).format(value);
 const reset=()=>{setExpression(null);setStep('ready');setPaused(false);setAmount('1000')};
 return <div className="mind-design mind-flow" data-step={step} style={tokens}>
 <header className="mind-header"><div className="mind-brand"><MindCharacter size={36} animate={false}/><div><strong>Agent</strong><small>Percorso guidato · demo</small></div></div><button className="mind-icon-button" aria-label="Ricomincia il flusso" onClick={reset}><MindIcon name="plus"/></button></header>
 {(step==='ready'||expression)&&<nav className="prismo-state-picker" aria-label="Prova le espressioni di Prismo">{([['listening','Ascolta'],['thinking','Pensa'],['speaking','Parla'],['success','Conferma']] as [MindCharacterState,string][]).map(([target,label])=><button key={target} aria-pressed={expression===target} onClick={()=>{setExpression(target);setPaused(true)}}>{label}</button>)}</nav>}
 <ol className="flow-progress" aria-label="Avanzamento della demo">{['Saldo','Pagamento','Conferma'].map((label,i)=><li key={label} aria-current={(payment?(step==='confirming'||step==='done'?2:1):0)===i?'step':undefined}><span>{i+1}</span>{label}</li>)}</ol>
 <div className="flow-content">
 <div className="flow-character"><MindCharacter size={step==='review'?64:step==='ready'?144:104} state={expression??phase} animate={expression!==null||(!paused&&voice.status!=='paused')} speechLevel={voice.mouthLevel}/></div>
 {expression&&<div className="prismo-expression-note">Voce italiana · animazione sincronizzata<button className="mind-text-button" onClick={()=>{setExpression(null);setPaused(false)}}>Torna al flusso</button></div>}
 {voice.clip&&voice.clip!=='request'&&voice.status!=='ended'&&<p className="prismo-subtitle">{voice.text}</p>}
 <div className="flow-status" role="status" aria-live="polite"><small>{step==='ready'?'PRISMO È PRONTO':phase==='listening'?'ASCOLTO SIMULATO':phase==='thinking'?'ELABORAZIONE SIMULATA':phase==='speaking'?'PRISMO PARLA IN ITALIANO':step==='review'?'SERVE LA TUA CONFERMA':step==='done'?'DEMO COMPLETATA':'IL CONTROLLO RESTA A TE'}</small><h2>{expression?({idle:'Sono qui.',listening:'Ti ascolto.',thinking:'Sto pensando…',speaking:'Ti racconto.',success:'Fatto, tutto confermato.'}[expression]):labels[step]}</h2></div>
 {step==='ready'&&<><p className="flow-intro">Chiedi il saldo a voce, prepara un invio ad Alice e controlla ogni dettaglio.</p><div className="flow-note"><MindIcon name="mic" size={17}/><span>Ascolta la voce italiana di Prismo. La domanda è preregistrata; il microfono resta spento.</span></div></>}
 {['listening','thinking','speaking','balance'].includes(step)&&<div className="flow-utterance"><MindIcon name="mic" size={16}/><span>«Prismo, qual è il mio saldo?»</span></div>}
 {step==='listening'&&<div className="mind-wave is-listening" aria-hidden="true">{Array.from({length:23},(_,i)=><i key={i} style={{height:10+i*7%27,animationDelay:`${i*70}ms`}}/>)}</div>}
 {step==='thinking'&&<p className="flow-intro">Recupero il saldo dimostrativo del wallet…</p>}
 {['speaking','balance'].includes(step)&&<><div className="mind-balance"><small>SALDO DIMOSTRATIVO</small><div><strong>125.000</strong> <span>sats</span></div><dl><dt>Spark</dt><dd>80.000 sats</dd><dt>Lightning / RGB</dt><dd>45.000 sats</dd></dl></div></>}
 {step==='preparing'&&<><div className="flow-utterance"><MindIcon name="send" size={16}/><span>«Prepara {number(Number(amount))} sats per Alice.»</span></div><p className="flow-intro">Preparo i dettagli. Non invio nulla prima della tua conferma.</p></>}
 {step==='review'&&<div className="flow-review"><div className="flow-recipient"><div className="flow-avatar">A</div><div><b>Alice</b><small>Contatto dimostrativo · Spark</small></div></div><label>Importo in sats<input aria-label="Importo del pagamento dimostrativo" type="number" inputMode="numeric" min="1" max="80000" step="1" value={amount} onChange={e=>{voice.stop();setAmount(e.target.value)}}/></label><dl><dt>Commissione demo</dt><dd>0 sats</dd><dt>Totale demo</dt><dd>{valid?number(Number(amount)):'—'} sats</dd><dt>Saldo Spark dopo</dt><dd>{valid?number(80000-Number(amount)):'—'} sats</dd></dl>{!valid&&<p className="flow-error" role="alert">Inserisci un numero intero da 1 a 80.000 sats.</p>}<small className="flow-fee-note">Commissione fittizia. Nell’app va verificata prima dell’invio.</small></div>}
 {step==='confirming'&&<p className="flow-intro">Hai confermato {number(Number(amount))} sats ad Alice. Completo solo la simulazione.</p>}
 {step==='done'&&<><div className="flow-success"><MindIcon name="check" size={25}/><b>Conferma simulata</b><strong>{number(Number(amount))} sats</strong><span>ad Alice · Spark</span></div><p className="flow-intro">Nessun denaro è stato inviato.</p><details className="flow-history"><summary>Rivedi i passaggi</summary><p>Hai chiesto il saldo → Prismo ha risposto → hai preparato l’invio → hai controllato Alice e l’importo → hai confermato.</p></details></>}
 </div>
 <footer className="flow-footer">
 {voice.clip&&<div className="prismo-audio-controls"><span>{voice.status==='playing'?'● Voce italiana':voice.status==='loading'?'Carico la voce…':voice.status==='paused'?'Audio in pausa':'Voce italiana'}</span><button onClick={()=>{if(voice.status==='playing'){voice.pause();setPaused(true)}else{setPaused(false);voice.resume()}}}>{voice.status==='playing'?'Pausa audio':voice.status==='ended'?'Riascolta':'Riprendi audio'}</button><button aria-pressed={voice.muted} onClick={voice.toggleMute}>{voice.muted?'Attiva suono':'Silenzia'}</button></div>}
 {voice.error&&<p className="flow-error" role="alert">{voice.error}</p>}

 {step==='ready'&&<button className="mind-primary" onClick={()=>{setExpression(null);setPaused(false);setStep('listening')}}><MindIcon name="mic" size={18}/>Ascolta il flusso con Prismo</button>}
 {sequence[step]&&<div className="flow-playback"><button onClick={()=>setPaused(!paused)}>{paused?'Riprendi':'Pausa'}</button><button onClick={()=>{setPaused(false);setStep(sequence[step]!.next)}}>Passaggio successivo <MindIcon name="arrow" size={16}/></button></div>}
 {step==='balance'&&<button className="mind-primary" onClick={()=>{setPaused(false);setStep('preparing')}}>Prepara 1.000 sats per Alice <MindIcon name="arrow" size={17}/></button>}
 {step==='review'&&<><button className="mind-primary" disabled={!valid} onClick={()=>{setPaused(false);setStep('confirming')}}>Conferma {valid?number(Number(amount)):''} sats · demo <MindIcon name="check" size={17}/></button><button className="mind-text-button" onClick={()=>{setAmount('1000');setStep('balance')}}>Annulla e torna al saldo</button></>}
 {step==='done'&&<button className="mind-primary" onClick={reset}>Riprova il flusso <MindIcon name="arrow" size={17}/></button>}
 <small>Voce sintetica · dati demo · nessuna operazione reale</small>
 </footer></div>
}
