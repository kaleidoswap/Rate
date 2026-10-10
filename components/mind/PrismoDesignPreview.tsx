import PrismoTalkPreview from './PrismoTalkPreview';
import { VoiceModeIcon } from './VoiceModeIcon';
import { PrismoExperiencePreview } from './PrismoExperiencePreview';
import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppTheme } from '../../theme/ThemeProvider';
import { MainHeader } from '../MainHeader';
import { MindCharacter } from './MindCharacter';
import ChatEmptyState from '../chat/ChatEmptyState';
import MessageBubble, { type ChatMessage } from '../chat/MessageBubble';
import { PaymentSummary } from '../payments/PaymentSummary';
import type { ConfirmReadback } from '../../services/aiConfirm';
import PaymentConfirmationModal from '../PaymentConfirmationModal';

const msg = (id: string, text: string, isUser = false): ChatMessage => ({ id, text, isUser, timestamp: new Date(2026, 9, 10, 14, 40) });
const balance: ChatMessage[] = [msg('1', 'Quanto posso spendere?', true), {
  ...msg('2', 'Ecco il saldo di esempio.'), card: { type: 'balance', data: {
    total_sats: 125000, layers: [{ layer: 'spark', btc_sats: 85000 }, { layer: 'arkade', btc_sats: 40000 }],
  } },
}, msg('3', 'Hai 125.000 sats, distribuiti tra Spark e Arkade. Vuoi preparare un pagamento?')];
const demoPayment: ConfirmReadback = {
  kind: 'payment', title: 'Pagamento demo', cta: 'Conferma demo', amount: '1.000 sats', amountSats: 1000,
  recipientName: 'Alice · esempio', rows: [
    { label: 'Destinazione fittizia', value: 'alice@example.com' },
    { label: 'Rete di esempio', value: 'Spark' },
    { label: 'Fee', value: '2 sats · esempio' },
    { label: 'Total', value: '1.002 sats · esempio' },
  ], warning: 'Solo anteprima: nessun pagamento verrà eseguito.', spoken: '',
};
const prepared = [...balance, msg('4', 'Prepara 1.000 sats per Alice.', true), msg('5', 'Pronto da rivedere. Nessun invio effettuato.')];

/** Development-only visual fixture. No wallet, model, microphone or payment calls. */
export default function PrismoDesignPreview({ onClose }: { onClose: () => void }) {
  const t = useAppTheme();
  const [pane, setPane] = useState<'voice' | 'settings' | 'actions' | 'animation' | null>(null);
  const [showInsight, setShowInsight] = useState(true);
  const [step, setStep] = useState(0);
  const [confirm, setConfirm] = useState(false);
  const [draft, setDraft] = useState('');
  const [hint, setHint] = useState('');
  const messages = step === 0 ? [] : step === 1 ? balance : step === 2 ? prepared : [...prepared, msg('6', 'Pagamento completato nella demo: **1.000 sats ad Alice**.\n\nCommissioni demo: 2 sats · Totale: 1.002 sats.\n\nNessun denaro è stato inviato.')];
  const advance = () => { setDraft(''); if (step < 2) setStep(step + 1); else if (step === 2) setConfirm(true); else setStep(0); };
  const primary = t.colors.primary[500];
  const iconButton = (label: string, icon: keyof typeof Ionicons.glyphMap, action: () => void) => <TouchableOpacity accessibilityRole="button" accessibilityLabel={label} onPress={action} style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}><Ionicons name={icon} size={20} color={t.colors.text.primary} /></TouchableOpacity>;
  if (pane === 'voice') return <View style={{ flex: 1, backgroundColor: t.colors.background.primary }}><MainHeader title="Agent" /><PrismoTalkPreview onClose={() => setPane(null)} /></View>;
  return <View style={{ flex: 1, backgroundColor: t.colors.background.primary }}>
    <MainHeader title="Agent" rightAction={<View style={{ flexDirection: 'row' }}>{iconButton('Preview Prismo animation', 'sparkles-outline', () => setPane('animation'))}{iconButton('Preview Agent settings', 'options-outline', () => setPane('settings'))}{step > 0 && iconButton('Reset demo chat', 'trash-outline', () => setStep(0))}{iconButton('Close design preview', 'close', onClose)}</View>} />
    <View style={{ paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderColor: t.colors.border.light }}>
      <Text style={{ color: t.colors.text.secondary, fontSize: 12, textAlign: 'center' }}>ANTEPRIMA · DATI FITTIZI · NESSUN INVIO</Text>
      <View style={{ flexDirection: 'row', gap: 6, marginTop: 8 }}>{['Inizio', 'Saldo', 'Pagamento', 'Esito'].map((label, i) => <TouchableOpacity key={label} onPress={() => { setPane(null); setStep(i); }} accessibilityRole="button" accessibilityState={{ selected: step === i }} style={{ flex: 1, minHeight: 36, justifyContent: 'center', alignItems: 'center', borderRadius: 18, backgroundColor: step === i ? t.colors.surface.highlight : t.colors.surface.primary }}><Text style={{ fontSize: 12, color: step === i ? primary : t.colors.text.secondary }}>{label}</Text></TouchableOpacity>)}</View>
    </View>
    {pane ? <PrismoExperiencePreview pane={pane} onClose={() => setPane(null)} onAction={next => { setStep(next); setPane(null); }} /> : <>
    {step === 0 && showInsight && <View style={{ margin: 16, marginBottom: 0, padding: 14, borderRadius: 16, backgroundColor: t.colors.surface.primary, flexDirection: 'row', gap: 8 }}><TouchableOpacity accessibilityRole="button" onPress={() => setStep(1)} style={{ flex: 1 }}><Text style={{ color: t.colors.text.primary, fontSize: 14 }}>Un’occhiata al tuo wallet?</Text><Text style={{ color: t.colors.text.secondary, fontSize: 12, lineHeight: 18, marginTop: 4 }}>Esempio: bitcoin su due reti. Guarda la distribuzione →</Text></TouchableOpacity>{iconButton('Dismiss example insight', 'close', () => setShowInsight(false))}</View>}
    {step === 0 ? <ChatEmptyState hero={<MindCharacter mood="happy" size={96} />} onSuggestion={() => setStep(1)} onContacts={() => setStep(2)} /> : <ScrollView key={step} contentContainerStyle={{ padding: 16 }} ref={r => { if (r) requestAnimationFrame(() => r.scrollToEnd({ animated: false })); }}>
      {messages.map(message => <MessageBubble key={message.id} message={message} onCopy={() => setHint('Copia disponibile nella chat reale.')} onOpenLink={() => {}} onLongPress={() => {}} characterMood={step === 3 ? 'idle' : 'idle'} />)}
      {step === 2 && <PaymentSummary readback={demoPayment} />}
      <TouchableOpacity onPress={advance} accessibilityRole="button" style={{ marginTop: 12, padding: 16, borderRadius: 24, alignItems: 'center', backgroundColor: primary }}><Text style={{ fontWeight: '600', color: t.colors.text.inverse }}>{step === 1 ? 'Prepara 1.000 sats per Alice' : step === 2 ? 'Rivedi pagamento demo' : 'Ricomincia la demo'}</Text></TouchableOpacity>
    </ScrollView>}
    {!!hint && <Text style={{ padding: 12, color: t.colors.text.secondary, textAlign: 'center' }}>{hint}</Text>}
    <View style={{ padding: 12, borderTopWidth: 1, borderColor: t.colors.border.light }}>
      <Text style={{ color: t.colors.text.secondary, fontSize: 12, marginBottom: 10 }}>Modello locale · pronto nella demo</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        {iconButton('Demo quick actions', 'add', () => setPane('actions'))}
        <TextInput accessibilityLabel="Demo message" value={draft} onChangeText={setDraft} placeholder="Ask Prismo…" placeholderTextColor={t.colors.text.secondary} onSubmitEditing={advance} style={{ flex: 1, minHeight: 44, borderRadius: 24, paddingHorizontal: 14, backgroundColor: t.colors.surface.primary, color: t.colors.text.primary }} />
        {iconButton(draft ? 'Send example message' : 'Preview dictation', draft ? 'arrow-up' : 'mic-outline', () => draft ? advance() : setHint('Dettatura: il parlato diventa una bozza da rivedere. Microfono non attivo nella demo.'))}
        {!draft && <TouchableOpacity accessibilityRole="button" accessibilityLabel="Preview voice mode" onPress={() => setPane('voice')} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: primary, alignItems: 'center', justifyContent: 'center' }}><VoiceModeIcon color={t.colors.text.inverse} /></TouchableOpacity>}
      </View>
    </View>
    </>}
    <PaymentConfirmationModal visible={confirm} requireAuth={false} readback={demoPayment} onCancel={() => setConfirm(false)} onConfirm={() => { setConfirm(false); setStep(3); }} />
  </View>;
}
