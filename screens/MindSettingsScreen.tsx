// screens/MindSettingsScreen.tsx
// Configure the on-device KaleidoMind agent: persona, sampling, context window,
// long-term memory and the RAG knowledge base. Persisted via settingsSlice.
import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Switch, Pressable, Alert } from 'react-native';
import { useSelector, useDispatch } from 'react-redux';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { theme } from '../theme';
import { ScreenHeader } from '../components';
import { selectMindConfig, setMindConfig, resetMindConfig, type MindConfig } from '../store/slices/settingsSlice';
import { MEMORY_KEY } from '../services/aiMemory';

const PERSONA_PRESETS: Array<{ label: string; text: string }> = [
  { label: 'Concise', text: 'Be concise and direct. Prefer short answers and avoid filler.' },
  { label: 'Friendly', text: 'Be warm, friendly and encouraging. Explain things simply.' },
  { label: 'Expert', text: 'Speak as a Bitcoin/Lightning expert. Be precise and technically accurate.' },
  { label: 'Cautious', text: 'Be extra cautious with money. Always double-check amounts and recipients.' },
];

const TEMP_OPTS = [
  { label: 'Precise', value: 0.2 },
  { label: 'Balanced', value: 0.6 },
  { label: 'Creative', value: 0.9 },
];
const LEN_OPTS = [
  { label: 'Short', value: 256 },
  { label: 'Medium', value: 512 },
  { label: 'Long', value: 1024 },
];
const HIST_OPTS = [
  { label: 'Short', value: 4 },
  { label: 'Medium', value: 8 },
  { label: 'Long', value: 12 },
];

export default function MindSettingsScreen() {
  const dispatch = useDispatch();
  const cfg = useSelector(selectMindConfig);
  const [persona, setPersona] = useState(cfg.persona);

  const update = (patch: Partial<MindConfig>) => dispatch(setMindConfig(patch));

  const clearMemory = () =>
    Alert.alert('Clear memory', "This erases everything the agent has remembered about you. This can't be undone.", [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear',
        style: 'destructive',
        onPress: async () => {
          try { await AsyncStorage.removeItem(MEMORY_KEY); } catch { /* noop */ }
        },
      },
    ]);

  const resetAll = () =>
    Alert.alert('Reset to defaults', 'Restore the default agent configuration?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Reset', style: 'destructive', onPress: () => { dispatch(resetMindConfig()); setPersona(''); } },
    ]);

  return (
    <View style={styles.container}>
      <ScreenHeader title="Design your agent" subtitle="KaleidoMind" showBack />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">

        {/* ── Persona ── */}
        <Section title="Persona" hint="Extra instructions added to the agent's system prompt.">
          <TextInput
            style={styles.textArea}
            value={persona}
            onChangeText={setPersona}
            onEndEditing={() => update({ persona: persona.trim() })}
            onBlur={() => update({ persona: persona.trim() })}
            placeholder="e.g. Always answer in Italian and keep it short."
            placeholderTextColor={theme.colors.text.tertiary}
            multiline
            textAlignVertical="top"
          />
          <View style={styles.chips}>
            {PERSONA_PRESETS.map((p) => (
              <Pressable key={p.label} style={styles.chip} onPress={() => { setPersona(p.text); update({ persona: p.text }); }}>
                <Text style={styles.chipText}>{p.label}</Text>
              </Pressable>
            ))}
          </View>
        </Section>

        {/* ── Responses ── */}
        <Section title="Responses" hint="How the model generates replies.">
          <Segmented label="Style" options={TEMP_OPTS} value={cfg.temperature} onChange={(v) => update({ temperature: v })} />
          <Segmented label="Max length" options={LEN_OPTS} value={cfg.maxTokens} onChange={(v) => update({ maxTokens: v })} />
        </Section>

        {/* ── Context ── */}
        <Section title="Context" hint="What the agent keeps in mind across the chat.">
          <Segmented label="History kept" options={HIST_OPTS} value={cfg.historyLength} onChange={(v) => update({ historyLength: v })} />
          <ToggleRow
            icon="bookmark-outline"
            label="Long-term memory"
            desc="Remember your preferences (currency, contacts, style)."
            value={cfg.memoryEnabled}
            onChange={(v) => update({ memoryEnabled: v })}
          />
          <Pressable style={styles.dangerRow} onPress={clearMemory}>
            <Ionicons name="trash-outline" size={18} color={theme.colors.error?.[500] ?? '#ff5d5d'} />
            <Text style={styles.dangerText}>Clear memory</Text>
          </Pressable>
        </Section>

        {/* ── Knowledge ── */}
        <Section title="Knowledge (RAG)" hint="Ground answers in the on-device Bitcoin / Lightning / RGB knowledge base.">
          <ToggleRow
            icon="library-outline"
            label="Knowledge base"
            desc="Retrieve relevant docs before answering questions."
            value={cfg.ragEnabled}
            onChange={(v) => update({ ragEnabled: v })}
          />
        </Section>

        <Pressable style={styles.resetBtn} onPress={resetAll}>
          <Ionicons name="refresh-outline" size={16} color={theme.colors.text.secondary} />
          <Text style={styles.resetText}>Reset to defaults</Text>
        </Pressable>
        <View style={{ height: 32 }} />
      </ScrollView>
    </View>
  );
}

const Section: React.FC<{ title: string; hint?: string; children: React.ReactNode }> = ({ title, hint, children }) => (
  <View style={styles.section}>
    <Text style={styles.sectionTitle}>{title}</Text>
    {!!hint && <Text style={styles.sectionHint}>{hint}</Text>}
    <View style={styles.card}>{children}</View>
  </View>
);

const Segmented: React.FC<{ label: string; options: Array<{ label: string; value: number }>; value: number; onChange: (v: number) => void }> = ({ label, options, value, onChange }) => (
  <View style={styles.segRow}>
    <Text style={styles.segLabel}>{label}</Text>
    <View style={styles.segTrack}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable key={o.label} style={[styles.segItem, active && styles.segItemActive]} onPress={() => onChange(o.value)}>
            <Text style={[styles.segItemText, active && styles.segItemTextActive]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  </View>
);

const ToggleRow: React.FC<{ icon: any; label: string; desc?: string; value: boolean; onChange: (v: boolean) => void }> = ({ icon, label, desc, value, onChange }) => (
  <View style={styles.toggleRow}>
    <View style={styles.toggleIcon}>
      <Ionicons name={icon} size={18} color={theme.colors.primary[500]} />
    </View>
    <View style={{ flex: 1 }}>
      <Text style={styles.toggleLabel}>{label}</Text>
      {!!desc && <Text style={styles.toggleDesc}>{desc}</Text>}
    </View>
    <Switch
      value={value}
      onValueChange={onChange}
      trackColor={{ true: theme.colors.primary[500], false: theme.colors.border.light }}
      thumbColor="#fff"
    />
  </View>
);

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background.primary },
  content: { padding: 16 },
  section: { marginBottom: 22 },
  sectionTitle: { color: theme.colors.text.primary, fontSize: 15, fontWeight: '700', marginBottom: 4 },
  sectionHint: { color: theme.colors.text.tertiary, fontSize: 12, marginBottom: 10, lineHeight: 16 },
  card: {
    backgroundColor: theme.colors.surface.primary,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border.light,
    padding: 14,
  },
  textArea: {
    minHeight: 84,
    color: theme.colors.text.primary,
    fontSize: 14,
    backgroundColor: theme.colors.background.secondary,
    borderRadius: 10,
    padding: 12,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  chip: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 16, backgroundColor: theme.colors.primary[500] + '1A' },
  chipText: { color: theme.colors.primary[500], fontSize: 12, fontWeight: '600' },
  segRow: { marginBottom: 14 },
  segLabel: { color: theme.colors.text.secondary, fontSize: 13, marginBottom: 8 },
  segTrack: { flexDirection: 'row', backgroundColor: theme.colors.background.secondary, borderRadius: 10, padding: 3 },
  segItem: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center' },
  segItemActive: { backgroundColor: theme.colors.primary[500] },
  segItemText: { color: theme.colors.text.secondary, fontSize: 13, fontWeight: '600' },
  segItemTextActive: { color: '#fff' },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6 },
  toggleIcon: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.primary[500] + '1A' },
  toggleLabel: { color: theme.colors.text.primary, fontSize: 14, fontWeight: '600' },
  toggleDesc: { color: theme.colors.text.tertiary, fontSize: 12, marginTop: 2, lineHeight: 16 },
  dangerRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.border.light },
  dangerText: { color: theme.colors.error?.[500] ?? '#ff5d5d', fontSize: 14, fontWeight: '600' },
  resetBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12 },
  resetText: { color: theme.colors.text.secondary, fontSize: 14, fontWeight: '600' },
});
