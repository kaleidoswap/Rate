import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Switch } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppTheme } from '../../theme/ThemeProvider';
import { MindCharacter } from './MindCharacter';
import { VoiceModeIcon } from './VoiceModeIcon';

type Pane = 'voice' | 'settings' | 'actions' | 'animation';
const animationPoses = ['happy', 'idle', 'listening', 'thinking', 'speaking', 'happy'] as const;
const animationLabels = ['Ciao! Sono Prismo', 'Sono qui', 'Ti ascolto', 'Ci penso', 'Ti rispondo', 'Fatto!'];
/** Visual-only controls. Never changes wallet, permissions or model configuration. */
export function PrismoExperiencePreview({ pane, onClose, onAction }: { pane: Pane; onClose: () => void; onAction: (step: number) => void }) {
  const t = useAppTheme();
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(true);
  useEffect(() => {
    if (pane !== 'animation' || !playing) return;
    const timer = setInterval(() => setFrame(value => (value + 1) % animationPoses.length), 2600);
    return () => clearInterval(timer);
  }, [pane, playing]);
  const [stage, setStage] = useState(0);
  const [muted, setMuted] = useState(false);
  const [section, setSection] = useState('');
  const [suggestions, setSuggestions] = useState(true);
  const [memory, setMemory] = useState(false);
  const [tone, setTone] = useState('Amichevole');
  useEffect(() => {
    if (pane !== 'voice' || muted || stage !== 1) return;
    const timer = setTimeout(() => setStage(2), 1800);
    return () => clearTimeout(timer);
  }, [pane, stage, muted]);
  const button = (label: string, action: () => void, primary = false) => <TouchableOpacity accessibilityRole="button" onPress={action} style={{ minHeight: 48, padding: 14, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: primary ? t.colors.primary[500] : t.colors.surface.primary }}><Text style={{ color: primary ? t.colors.text.inverse : t.colors.text.primary, fontWeight: '600' }}>{label}</Text></TouchableOpacity>;
  const row = (title: string, subtitle: string, action: () => void) => <TouchableOpacity key={title} accessibilityRole="button" onPress={action} style={{ paddingVertical: 16, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: 1, borderColor: t.colors.border.light }}><View style={{ flex: 1 }}><Text style={{ color: t.colors.text.primary, fontSize: 17 }}>{title}</Text><Text style={{ color: t.colors.text.secondary, fontSize: 13, lineHeight: 19, marginTop: 5 }}>{subtitle}</Text></View><Ionicons name="chevron-forward" color={t.colors.text.secondary} size={18} /></TouchableOpacity>;
  const toggle = (label: string, value: boolean, change: (v: boolean) => void) => <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 16, gap: 12 }}><Text style={{ flex: 1, color: t.colors.text.primary, fontSize: 16 }}>{label}</Text><Switch accessibilityLabel={label} value={value} onValueChange={change} /></View>;
  return <View style={{ flex: 1, padding: 20 }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}><Text style={{ fontSize: 22, fontWeight: '600', color: t.colors.text.primary }}>{pane === 'animation' ? 'Prismo in movimento' : pane === 'voice' ? 'Parla con Prismo' : pane === 'actions' ? 'Cosa vuoi fare?' : 'Impostazioni Agent'}</Text><TouchableOpacity accessibilityRole="button" accessibilityLabel="Back to preview chat" onPress={onClose} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="close" size={22} color={t.colors.text.primary} /></TouchableOpacity></View>
    {pane === 'animation' ? <>
      <Text style={{ color: t.colors.text.secondary, fontSize: 12, marginTop: 4 }}>ANTEPRIMA ANIMAZIONI · NESSUNA OPERAZIONE REALE</Text>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 24 }}>
        <MindCharacter mood={animationPoses[frame]} size={200} paused={!playing} />
        <Text style={{ fontSize: 24, color: t.colors.text.primary }}>{animationLabels[frame]}</Text>
        <Text style={{ color: t.colors.text.secondary, textAlign: 'center', lineHeight: 22 }}>Saluto, respiro, battito degli occhi e bocca animata.
Le transizioni rispettano “Riduci movimento”.</Text>
      </View>
      <View style={{ gap: 12 }}>{button(playing ? 'Pausa animazione' : 'Riprendi animazione', () => setPlaying(!playing), true)}{button('Ricomincia dal saluto', () => { setFrame(0); setPlaying(true); })}</View>
    </> : pane === 'voice' ? <>
      <Text style={{ color: t.colors.text.secondary, fontSize: 12, marginTop: 4 }}>SIMULAZIONE · MICROFONO E AUDIO NON ATTIVI</Text>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 20 }}>
        <MindCharacter size={180} mood={muted ? 'idle' : stage === 0 ? 'listening' : stage === 1 ? 'thinking' : 'speaking'} />
        <Text accessibilityLiveRegion="polite" style={{ fontSize: 24, color: t.colors.text.primary }}>{muted ? 'In pausa' : ['Ti ascolto', 'Controllo il saldo', 'Prismo risponde'][stage]}</Text>
        <Text style={{ fontSize: 16, lineHeight: 24, textAlign: 'center', color: t.colors.text.secondary, maxWidth: 320 }}>{stage === 0 ? 'Prova una domanda. Puoi interrompere Prismo in qualsiasi momento.' : stage === 1 ? 'Tu: «Quanto posso spendere?»' : '«Hai 125.000 sats tra Spark e Arkade. Vuoi preparare un pagamento?»'}</Text>
      </View>
      <View style={{ gap: 12 }}>
        {button(stage === 0 ? 'Simula: «Quanto posso spendere?»' : stage === 1 ? 'Mostra la risposta' : 'Prepara un pagamento nella chat', () => { setMuted(false); if (stage === 2) onAction(2); else setStage(stage + 1); }, true)}
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 24 }}>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel={muted ? 'Resume simulated voice' : 'Pause simulated voice'} onPress={() => setMuted(!muted)} style={{ minWidth: 52, minHeight: 52, alignItems: 'center', justifyContent: 'center', borderRadius: 26, backgroundColor: t.colors.surface.primary }}><Ionicons name={muted ? 'mic-off-outline' : 'mic-outline'} size={23} color={t.colors.text.primary} /></TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Interrupt simulated reply" onPress={() => { setStage(0); setMuted(false); }} style={{ minWidth: 52, minHeight: 52, alignItems: 'center', justifyContent: 'center', borderRadius: 26, backgroundColor: t.colors.surface.primary }}><VoiceModeIcon color={t.colors.text.primary} /></TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="End simulated voice" onPress={onClose} style={{ minWidth: 52, minHeight: 52, alignItems: 'center', justifyContent: 'center', borderRadius: 26, backgroundColor: t.colors.surface.primary }}><Ionicons name="close" size={24} color={t.colors.text.primary} /></TouchableOpacity>
        </View>
        <Text style={{ color: t.colors.text.secondary, textAlign: 'center', fontSize: 12 }}>I pagamenti si rivedono e si confermano nella chat.</Text>
      </View>
    </> : <ScrollView contentContainerStyle={{ paddingBottom: 20 }}>
      {pane === 'actions' ? <>
        <Text style={{ color: t.colors.text.secondary, marginTop: 12 }}>Azioni rapide del wallet, senza cercare comandi.</Text>
        {row('Controlla il saldo', 'Bitcoin disponibili, divisi per rete', () => onAction(1))}
        {row('Paga un contatto', 'Scegli destinatario e importo, poi rivedi', () => onAction(2))}
        {row('Ricevi bitcoin', 'Indirizzo o richiesta di pagamento', () => setSection('receive'))}
        {section === 'receive' && <Text style={{ color: t.colors.text.secondary, marginTop: 16 }}>Nell’app scegli la rete e l’importo facoltativo. Questa demo non genera indirizzi né fatture.</Text>}
      </> : <>
        <Text style={{ color: t.colors.text.secondary, marginTop: 12 }}>Preferenze di esempio · nessuna modifica al wallet</Text>
        {row('Modelli e voce', 'Locale · italiano · scelta in base al dispositivo', () => setSection(section === 'models' ? '' : 'models'))}
        {section === 'models' && <View style={{ padding: 14, backgroundColor: t.colors.surface.primary, borderRadius: 16, gap: 10 }}><Text style={{ color: t.colors.text.primary }}>Conversazione · Riconoscimento · Voce</Text><Text style={{ color: t.colors.text.secondary, lineHeight: 21 }}>Per ogni modello: compatibilità, spazio richiesto, stato del download e rimozione. Il consiglio dipende dalla memoria del telefono; non dal saldo.</Text>{button('Automatico · esempio', () => setSection('models-auto'))}</View>}
        {section === 'models-auto' && <Text style={{ color: t.colors.text.secondary, paddingVertical: 12 }}>Scelta automatica simulata. Nessun modello scaricato.</Text>}
        {row('Personalità', tone + ' · tono delle risposte', () => setSection(section === 'tone' ? '' : 'tone'))}
        {section === 'tone' && <View style={{ gap: 8, marginTop: 12 }}>{['Conciso', 'Amichevole', 'Esperto'].map(value => <View key={value}>{button(value + (tone === value ? ' ✓' : ''), () => setTone(value))}</View>)}</View>}
        {row('Privacy e memoria', 'Scegli cosa ricordare e cosa suggerire', () => setSection(section === 'privacy' ? '' : 'privacy'))}
        {section === 'privacy' && <View>{toggle('Suggerimenti contestuali', suggestions, setSuggestions)}{toggle('Memoria tra conversazioni', memory, setMemory)}<Text style={{ color: t.colors.text.secondary, lineHeight: 21 }}>Suggerimenti discreti all’apertura, basati solo su dati disponibili. La memoria resta facoltativa; l’utente deve poterla consultare e cancellare.</Text></View>}
        {row('Pagamenti e autorizzazioni', 'Riepilogo prima dell’invio', () => setSection(section === 'payments' ? '' : 'payments'))}
        {section === 'payments' && <Text style={{ color: t.colors.text.secondary, lineHeight: 22, paddingVertical: 14 }}>Importo, destinatario, commissioni e totale sempre visibili. Le autorizzazioni del wallet restano applicate. La demo non modifica queste protezioni.</Text>}
      </>}
    </ScrollView>}
  </View>;
}
