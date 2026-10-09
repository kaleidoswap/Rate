// The intent bar's sheet: type or dictate what to do, get an action card or an
// answer back. Review opens the existing Send / Receive / Swap screen with the
// card's values, so their confirm and safety steps stay the only way to spend.
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../../theme';
import { Sheet } from '../Sheet';
import { Callout } from '../Callout';
import type { VoiceInputRef } from '../VoiceInput';
import { MindCharacter, type MindMood } from './MindCharacter';
import { ActionCardView, AnswerCardView } from './IntentCards';
import { useIntentRunner } from '../../hooks/useIntentRunner';
import { useAppSelector } from '../../store/hooks';
import { selectAiEnabled } from '../../store/slices/settingsSlice';
import { useFiatRates } from '../../hooks/useFiatRates';
import type { ReviewTarget } from '../../services/mindIntents/card';

// Loaded only when dictation is on, so the QVAC SDK isn't pulled in otherwise.
const Dictation = React.forwardRef<VoiceInputRef, React.ComponentProps<typeof import('../VoiceInput').default>>((props, ref) => {
  const VoiceInput = require('../VoiceInput').default;
  return <VoiceInput ref={ref} {...props} />;
});

const EXAMPLES = ['Send 10€ to Mario', 'Swap half my BTC to USDT', 'Receive 50k sats on Lightning', 'How much did I spend this week?'];

interface Props {
  visible: boolean;
  onClose: () => void;
  onReview: (target: ReviewTarget) => void;
  /** Start dictating as soon as the sheet opens. */
  listen?: boolean;
}

export function IntentSheet({ visible, onClose, onReview, listen }: Props) {
  const { submit, busy, outcome, reset, advanced } = useIntentRunner();
  const unit = useAppSelector((s) => s.settings.bitcoinUnit) as 'BTC' | 'sats';
  const fiat = useAppSelector((s) => s.settings.currency) || 'USD';
  const voiceEnabled = useAppSelector(selectAiEnabled);
  const rates = useFiatRates();
  const [text, setText] = useState('');
  const [listening, setListening] = useState(false);
  const voice = useRef<VoiceInputRef>(null);
  const input = useRef<TextInput>(null);

  useEffect(() => {
    if (!visible) { setText(''); reset(); setListening(false); voice.current?.cancelListening(); return; }
    if (listen && voiceEnabled) voice.current?.startListening();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const send = (value = text) => { if (value.trim() && !busy) void submit(value.trim()); };
  const mood: MindMood = listening ? 'listening' : busy ? 'thinking' : outcome?.type === 'none' ? 'concerned' : outcome ? 'happy' : 'idle';
  const close = () => { voice.current?.cancelListening(); onClose(); };

  return (
    <Sheet visible={visible} onClose={close} title="What should I do?" subtitle="Runs on this phone. You review before anything moves." testID="intent-sheet">
      {voiceEnabled && (
        <Dictation
          ref={voice}
          onStart={() => setListening(true)}
          onEnd={() => setListening(false)}
          onPartialResult={(t) => setText(t)}
          onResult={(t) => { setListening(false); setText(t); send(t); }}
          onError={() => setListening(false)}
        />
      )}
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>
        <View style={styles.inputRow}>
          <MindCharacter mood={mood} size={36} />
          <TextInput
            ref={input}
            testID="intent-input"
            style={styles.input}
            value={text}
            onChangeText={setText}
            placeholder={listening ? 'Listening…' : 'Send 10€ to Mario'}
            placeholderTextColor={theme.colors.text.tertiary}
            onSubmitEditing={() => send()}
            returnKeyType="go"
            autoFocus={!listen}
            autoCorrect={false}
          />
          {voiceEnabled && (
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={listening ? 'Stop dictation' : 'Dictate'}
              style={[styles.iconButton, listening && styles.iconButtonActive]}
              onPress={() => (listening ? voice.current?.stopListening() : voice.current?.startListening())}
            >
              <Ionicons name={listening ? 'stop' : 'mic-outline'} size={18} color={theme.colors.text.primary} />
            </TouchableOpacity>
          )}
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Go" testID="intent-go" style={styles.iconButton} disabled={busy || !text.trim()} onPress={() => send()}>
            {busy ? <ActivityIndicator size="small" color={theme.colors.primary[500]} /> : <Ionicons name="arrow-forward" size={18} color={theme.colors.primary[500]} />}
          </TouchableOpacity>
        </View>

        {!outcome && !busy && (
          <View style={styles.examples}>
            {EXAMPLES.map((e) => (
              <TouchableOpacity key={e} accessibilityRole="button" style={styles.chip} onPress={() => { setText(e); send(e); }}>
                <Text style={styles.chipText}>{e}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {outcome?.type === 'none' && <Callout tone="info" message={outcome.message} />}
        {outcome?.type === 'action' && (
          <ActionCardView
            card={outcome.card}
            unit={unit}
            advanced={advanced}
            onReview={() => { onReview(outcome.card.review); onClose(); }}
            onEdit={() => { reset(); input.current?.focus(); }}
            onCancel={close}
          />
        )}
        {outcome?.type === 'answer' && (
          <AnswerCardView answer={outcome.answer} unit={unit} fiat={fiat} fiatPrice={rates[fiat.toLowerCase()]} onDone={close} />
        )}
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: theme.spacing[3], paddingBottom: theme.spacing[2] },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing[2] },
  input: {
    flex: 1,
    minHeight: 44,
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.background.secondary,
    color: theme.colors.text.primary,
    fontSize: theme.typography.fontSize.base,
  },
  iconButton: {
    width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center',
    backgroundColor: theme.colors.background.secondary,
  },
  iconButtonActive: { backgroundColor: theme.colors.error[500] },
  examples: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing[2] },
  chip: {
    paddingHorizontal: theme.spacing[3], paddingVertical: theme.spacing[2], borderRadius: theme.borderRadius.full,
    borderWidth: 1, borderColor: theme.colors.border.light,
  },
  chipText: { fontSize: theme.typography.fontSize.sm, color: theme.colors.text.secondary },
});
