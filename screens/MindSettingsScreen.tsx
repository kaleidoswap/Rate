// screens/MindSettingsScreen.tsx
// Chat settings — design the on-device KaleidoMind agent: personality,
// connectors (skills + MCP), context, memory and the RAG knowledge base.
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Switch, Pressable, Alert, Modal } from 'react-native';
import { useSelector, useDispatch } from 'react-redux';
import { Ionicons } from '@expo/vector-icons';
import { skillsFromBundle } from '@kaleidorg/mind';
import { theme, leading } from '../theme';
import { ScreenHeader } from '../components';
import { selectMindConfig, setMindConfig, resetMindConfig, type MindConfig } from '../store/slices/settingsSlice';
import { clearMindMemory } from '../services/mindAgent';
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
      { text: 'Clear', style: 'destructive', onPress: async () => { try { await clearMindMemory(); } catch {} } },
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
            <Ionicons name="trash-outline" size={18} color={theme.colors.error[500]} />
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
  content: { padding: theme.spacing[4] },
  section: { marginBottom: theme.spacing[5] },
  sectionTitle: { color: theme.colors.text.primary, fontSize: theme.typography.fontSize.base, fontWeight: theme.typography.fontWeight.bold, marginBottom: theme.spacing[1] },
  sectionHint: { color: theme.colors.text.tertiary, fontSize: theme.typography.fontSize.xs, marginBottom: theme.spacing[2.5] },
  card: { backgroundColor: theme.colors.surface.primary, borderRadius: theme.borderRadius.md, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border.light, padding: theme.spacing[3.5] },
  input: { minHeight: 52, color: theme.colors.text.primary, fontSize: theme.typography.fontSize.sm, backgroundColor: theme.colors.background.secondary, borderRadius: theme.borderRadius.base, padding: theme.spacing[3] },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing[2], marginTop: theme.spacing[2.5] },
  chip: { paddingVertical: theme.spacing[1.5], paddingHorizontal: theme.spacing[3], borderRadius: theme.borderRadius.lg, backgroundColor: theme.colors.primary[100] },
  chipText: { color: theme.colors.primary[500], fontSize: theme.typography.fontSize.xs, fontWeight: theme.typography.fontWeight.semibold },
  row: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing[3], paddingVertical: theme.spacing[2.5] },
  rowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.border.light },
  skillIcon: { width: 32, height: 32, borderRadius: theme.borderRadius.base, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.primary[50] },
  rowLabel: { color: theme.colors.text.primary, fontSize: theme.typography.fontSize.sm, fontWeight: theme.typography.fontWeight.semibold, textTransform: 'capitalize' },
  rowDesc: { color: theme.colors.text.tertiary, fontSize: theme.typography.fontSize.xs, marginTop: 2, lineHeight: leading(theme.typography.fontSize.xs, theme.typography.lineHeight.snug) },
  addRow: { justifyContent: 'flex-start' },
  addText: { color: theme.colors.primary[500], fontSize: theme.typography.fontSize.sm, fontWeight: theme.typography.fontWeight.semibold },
  segRow: { marginBottom: theme.spacing[1] },
  segLabel: { color: theme.colors.text.secondary, fontSize: theme.typography.fontSize.sm, marginBottom: theme.spacing[2] },
  segTrack: { flexDirection: 'row', backgroundColor: theme.colors.background.secondary, borderRadius: theme.borderRadius.base, padding: 3 },
  segItem: { flex: 1, paddingVertical: theme.spacing[2], borderRadius: theme.borderRadius.sm, alignItems: 'center' },
  segItemActive: { backgroundColor: theme.colors.primary[500] },
  segItemText: { color: theme.colors.text.secondary, fontSize: theme.typography.fontSize.sm, fontWeight: theme.typography.fontWeight.semibold },
  segItemTextActive: { color: '#fff' }, // literal white: text sits on the green primary fill (text.inverse is dark navy)
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing[3], paddingVertical: theme.spacing[2], borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.border.light },
  dangerRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing[2], marginTop: theme.spacing[2], paddingTop: theme.spacing[3], borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.border.light },
  dangerText: { color: theme.colors.error[500], fontSize: theme.typography.fontSize.sm, fontWeight: theme.typography.fontWeight.semibold },
  resetBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: theme.spacing[1.5], paddingVertical: theme.spacing[3] },
  resetText: { color: theme.colors.text.secondary, fontSize: theme.typography.fontSize.sm, fontWeight: theme.typography.fontWeight.semibold },
  // modal
  backdrop: { flex: 1, backgroundColor: theme.colors.background.backdrop, justifyContent: 'flex-end' },
  sheet: { backgroundColor: theme.colors.background.primary, borderTopLeftRadius: theme.borderRadius.xl, borderTopRightRadius: theme.borderRadius.xl, padding: theme.spacing[5], paddingBottom: theme.spacing[9] },
  handle: { width: 40, height: 4, borderRadius: theme.borderRadius.sm, backgroundColor: theme.colors.border.dark, alignSelf: 'center', marginBottom: theme.spacing[3.5] },
  sheetTitle: { color: theme.colors.text.primary, fontSize: theme.typography.fontSize.lg, fontWeight: theme.typography.fontWeight.bold },
  sheetHint: { color: theme.colors.text.tertiary, fontSize: theme.typography.fontSize.xs, marginTop: theme.spacing[1], marginBottom: theme.spacing[3.5] },
  modalInput: { color: theme.colors.text.primary, fontSize: theme.typography.fontSize.sm, backgroundColor: theme.colors.surface.primary, borderRadius: theme.borderRadius.base, padding: theme.spacing[3], marginBottom: theme.spacing[2.5], borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border.light },
  addBtn: { backgroundColor: theme.colors.primary[500], borderRadius: theme.borderRadius.md, paddingVertical: theme.spacing[3.5], alignItems: 'center', marginTop: theme.spacing[1.5] },
  addBtnText: { color: '#fff', fontSize: theme.typography.fontSize.base, fontWeight: theme.typography.fontWeight.bold }, // literal white on green primary fill
});
