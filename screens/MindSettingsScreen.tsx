// screens/MindSettingsScreen.tsx
// Chat settings — design the on-device KaleidoMind agent: personality,
// connectors (skills + MCP), context, memory and the RAG knowledge base.
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Switch, Pressable, Alert, Modal } from 'react-native';
import { useSelector, useDispatch } from 'react-redux';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { skillsFromBundle } from '@kaleidorg/mind';
import { theme } from '../theme';
import { ScreenHeader } from '../components';
import { selectMindConfig, setMindConfig, resetMindConfig, type MindConfig } from '../store/slices/settingsSlice';
import { MEMORY_KEY } from '../services/aiMemory';
import skillBundle from '../skills.bundle.json';

const TONES: Array<{ label: string; text: string }> = [
  { label: 'Concise', text: 'Be concise and direct.' },
  { label: 'Friendly', text: 'Be warm and friendly; explain simply.' },
  { label: 'Expert', text: 'Be precise and technically accurate.' },
  { label: 'Cautious', text: 'Be extra careful with money; double-check amounts and recipients.' },
];
const TEMP_OPTS = [{ label: 'Precise', value: 0.2 }, { label: 'Balanced', value: 0.6 }, { label: 'Creative', value: 0.9 }];
const HIST_OPTS = [{ label: 'Short', value: 4 }, { label: 'Medium', value: 8 }, { label: 'Long', value: 12 }];

export default function MindSettingsScreen() {
  const dispatch = useDispatch();
  const cfg = useSelector(selectMindConfig);
  const [persona, setPersona] = useState(cfg.persona);
  const [mcpOpen, setMcpOpen] = useState(false);

  const update = (patch: Partial<MindConfig>) => dispatch(setMindConfig(patch));

  const skills = useMemo(() => {
    try { return skillsFromBundle(skillBundle as any).map((s: any) => ({ name: s.name as string, description: String(s.description ?? '') })); }
    catch { return []; }
  }, []);
  const skillEnabled = (name: string) => !cfg.disabledSkills.includes(name);
  const toggleSkill = (name: string, on: boolean) =>
    update({ disabledSkills: on ? cfg.disabledSkills.filter((n) => n !== name) : [...cfg.disabledSkills, name] });
  const removeMcp = (url: string) => update({ mcpServers: cfg.mcpServers.filter((m) => m.url !== url) });

  const clearMemory = () =>
    Alert.alert('Clear memory', "This erases everything the agent has remembered. This can't be undone.", [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: async () => { try { await AsyncStorage.removeItem(MEMORY_KEY); } catch {} } },
    ]);
  const resetAll = () =>
    Alert.alert('Reset to defaults', 'Restore the default agent configuration?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Reset', style: 'destructive', onPress: () => { dispatch(resetMindConfig()); setPersona(''); } },
    ]);

  return (
    <View style={styles.container}>
      <ScreenHeader title="Chat settings" subtitle="Design your agent" showBack />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">

        {/* ── Personality (compact) ── */}
        <Section title="Personality">
          <TextInput
            style={styles.input}
            value={persona}
            onChangeText={setPersona}
            onEndEditing={() => update({ persona: persona.trim() })}
            onBlur={() => update({ persona: persona.trim() })}
            placeholder="How should it behave? e.g. Reply in Italian, keep it short."
            placeholderTextColor={theme.colors.text.tertiary}
            multiline
          />
          <View style={styles.chips}>
            {TONES.map((t) => (
              <Pressable key={t.label} style={styles.chip} onPress={() => { setPersona(t.text); update({ persona: t.text }); }}>
                <Text style={styles.chipText}>{t.label}</Text>
              </Pressable>
            ))}
          </View>
        </Section>

        {/* ── Connectors ── */}
        <Section title="Connectors" hint="Skills and MCP servers the agent can use.">
          {skills.map((s, i) => (
            <View key={s.name} style={[styles.row, i > 0 && styles.rowBorder]}>
              <View style={styles.skillIcon}><Ionicons name="extension-puzzle-outline" size={16} color={theme.colors.primary[500]} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowLabel}>{s.name}</Text>
                {!!s.description && <Text style={styles.rowDesc} numberOfLines={2}>{s.description}</Text>}
              </View>
              <Switch value={skillEnabled(s.name)} onValueChange={(v) => { toggleSkill(s.name, v); }} trackColor={{ true: theme.colors.primary[500], false: theme.colors.border.light }} thumbColor="#fff" />
            </View>
          ))}
          {cfg.mcpServers.map((m) => (
            <View key={m.url} style={[styles.row, styles.rowBorder]}>
              <View style={styles.skillIcon}><Ionicons name="server-outline" size={16} color={theme.colors.accent[500]} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowLabel}>{m.name}</Text>
                <Text style={styles.rowDesc} numberOfLines={1}>{m.url}</Text>
              </View>
              <Pressable onPress={() => removeMcp(m.url)} hitSlop={8}><Ionicons name="close-circle" size={20} color={theme.colors.text.tertiary} /></Pressable>
            </View>
          ))}
          <Pressable style={[styles.row, styles.rowBorder, styles.addRow]} onPress={() => setMcpOpen(true)}>
            <Ionicons name="add-circle-outline" size={18} color={theme.colors.primary[500]} />
            <Text style={styles.addText}>Add MCP server</Text>
          </Pressable>
        </Section>

        {/* ── Responses ── */}
        <Section title="Responses">
          <Segmented label="Style" options={TEMP_OPTS} value={cfg.temperature} onChange={(v) => update({ temperature: v })} />
        </Section>

        {/* ── Context ── */}
        <Section title="Context & memory">
          <Segmented label="History kept" options={HIST_OPTS} value={cfg.historyLength} onChange={(v) => update({ historyLength: v })} />
          <ToggleRow icon="bookmark-outline" label="Long-term memory" desc="Remember your preferences." value={cfg.memoryEnabled} onChange={(v) => update({ memoryEnabled: v })} />
          <ToggleRow icon="library-outline" label="Knowledge base (RAG)" desc="Ground answers in on-device docs." value={cfg.ragEnabled} onChange={(v) => update({ ragEnabled: v })} />
          <Pressable style={styles.dangerRow} onPress={clearMemory}>
            <Ionicons name="trash-outline" size={18} color={theme.colors.error?.[500] ?? '#ff5d5d'} />
            <Text style={styles.dangerText}>Clear memory</Text>
          </Pressable>
        </Section>

        <Pressable style={styles.resetBtn} onPress={resetAll}>
          <Ionicons name="refresh-outline" size={16} color={theme.colors.text.secondary} />
          <Text style={styles.resetText}>Reset to defaults</Text>
        </Pressable>
        <View style={{ height: 32 }} />
      </ScrollView>

      <AddMcpModal visible={mcpOpen} onClose={() => setMcpOpen(false)} onAdd={(name, url) => { update({ mcpServers: [...cfg.mcpServers, { name, url }] }); setMcpOpen(false); }} />
    </View>
  );
}

const AddMcpModal: React.FC<{ visible: boolean; onClose: () => void; onAdd: (name: string, url: string) => void }> = ({ visible, onClose, onAdd }) => {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const valid = name.trim().length > 0 && /^https?:\/\//i.test(url.trim());
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.handle} />
          <Text style={styles.sheetTitle}>Add MCP server</Text>
          <Text style={styles.sheetHint}>Connect an external tool server (Streamable HTTP / SSE).</Text>
          <TextInput style={styles.modalInput} value={name} onChangeText={setName} placeholder="Name (e.g. Bitrefill)" placeholderTextColor={theme.colors.text.tertiary} autoCapitalize="none" />
          <TextInput style={styles.modalInput} value={url} onChangeText={setUrl} placeholder="https://server.example.com/mcp" placeholderTextColor={theme.colors.text.tertiary} autoCapitalize="none" autoCorrect={false} keyboardType="url" />
          <Pressable style={[styles.addBtn, !valid && { opacity: 0.5 }]} disabled={!valid} onPress={() => { onAdd(name.trim(), url.trim()); setName(''); setUrl(''); }}>
            <Text style={styles.addBtnText}>Add connector</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
};

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
    <View style={styles.skillIcon}><Ionicons name={icon} size={16} color={theme.colors.primary[500]} /></View>
    <View style={{ flex: 1 }}>
      <Text style={styles.rowLabel}>{label}</Text>
      {!!desc && <Text style={styles.rowDesc}>{desc}</Text>}
    </View>
    <Switch value={value} onValueChange={onChange} trackColor={{ true: theme.colors.primary[500], false: theme.colors.border.light }} thumbColor="#fff" />
  </View>
);

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background.primary },
  content: { padding: 16 },
  section: { marginBottom: 20 },
  sectionTitle: { color: theme.colors.text.primary, fontSize: 15, fontWeight: '700', marginBottom: 4 },
  sectionHint: { color: theme.colors.text.tertiary, fontSize: 12, marginBottom: 10 },
  card: { backgroundColor: theme.colors.surface.primary, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border.light, padding: 14 },
  input: { minHeight: 52, color: theme.colors.text.primary, fontSize: 14, backgroundColor: theme.colors.background.secondary, borderRadius: 10, padding: 12 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  chip: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 16, backgroundColor: theme.colors.primary[500] + '1A' },
  chipText: { color: theme.colors.primary[500], fontSize: 12, fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  rowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.border.light },
  skillIcon: { width: 32, height: 32, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.primary[500] + '14' },
  rowLabel: { color: theme.colors.text.primary, fontSize: 14, fontWeight: '600', textTransform: 'capitalize' },
  rowDesc: { color: theme.colors.text.tertiary, fontSize: 12, marginTop: 2, lineHeight: 16 },
  addRow: { justifyContent: 'flex-start' },
  addText: { color: theme.colors.primary[500], fontSize: 14, fontWeight: '600' },
  segRow: { marginBottom: 4 },
  segLabel: { color: theme.colors.text.secondary, fontSize: 13, marginBottom: 8 },
  segTrack: { flexDirection: 'row', backgroundColor: theme.colors.background.secondary, borderRadius: 10, padding: 3 },
  segItem: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center' },
  segItemActive: { backgroundColor: theme.colors.primary[500] },
  segItemText: { color: theme.colors.text.secondary, fontSize: 13, fontWeight: '600' },
  segItemTextActive: { color: '#fff' },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.border.light },
  dangerRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.border.light },
  dangerText: { color: theme.colors.error?.[500] ?? '#ff5d5d', fontSize: 14, fontWeight: '600' },
  resetBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12 },
  resetText: { color: theme.colors.text.secondary, fontSize: 14, fontWeight: '600' },
  // modal
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: theme.colors.background.primary, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 36 },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.2)', alignSelf: 'center', marginBottom: 14 },
  sheetTitle: { color: theme.colors.text.primary, fontSize: 17, fontWeight: '700' },
  sheetHint: { color: theme.colors.text.tertiary, fontSize: 12, marginTop: 4, marginBottom: 14 },
  modalInput: { color: theme.colors.text.primary, fontSize: 14, backgroundColor: theme.colors.surface.primary, borderRadius: 10, padding: 12, marginBottom: 10, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border.light },
  addBtn: { backgroundColor: theme.colors.primary[500], borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 6 },
  addBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
