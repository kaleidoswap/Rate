import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, TextInput, Switch, Pressable, Alert, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ScreenHeader } from '../components';
import { useAppTheme } from '../theme/ThemeProvider';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { selectMindConfig, setMindConfig, selectAiMode, setAiMode } from '../store/slices/settingsSlice';
import { useAppLanguage } from '../localization/useAppLanguage';
import { useQVAC } from '../hooks/useQVAC';
import QVACSettingsSheet from '../components/QVACSettingsSheet';
import { clearMindMemory, listMindMemory, removeMindMemory } from '../services/mindAgent';
import type { MemoryItem } from '@kaleidorg/mind';

export default function MindSettingsScreen({ navigation }: { navigation?: any }) {
  const theme = useAppTheme();
  const { t } = useAppLanguage();
  const dispatch = useAppDispatch();
  const cfg = useAppSelector(selectMindConfig);
  const aiMode = useAppSelector(selectAiMode);
  const qvac = useQVAC(false);
  const [panel, setPanel] = useState<string | null>(null);
  const [sheet, setSheet] = useState<'Model' | 'Voice' | null>(null);
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [memoryError, setMemoryError] = useState('');
  const styles = useMemo(() => StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.colors.background.primary },
    content: { padding: theme.spacing[4], gap: theme.spacing[3], paddingBottom: theme.spacing[10] },
    row: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing[3], minHeight: 64, padding: theme.spacing[4] },
    card: { backgroundColor: theme.colors.surface.primary, borderRadius: theme.borderRadius.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border.light, overflow: 'hidden' },
    body: { padding: theme.spacing[4], paddingTop: 0, gap: theme.spacing[3] },
    label: { color: theme.colors.text.primary, fontSize: theme.typography.fontSize.base, fontWeight: '600' },
    hint: { color: theme.colors.text.secondary, fontSize: theme.typography.fontSize.sm },
    input: { minHeight: 88, padding: theme.spacing[3], borderRadius: theme.borderRadius.md, color: theme.colors.text.primary, backgroundColor: theme.colors.background.secondary, textAlignVertical: 'top' },
    choices: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing[2] },
    choice: { padding: theme.spacing[3], borderRadius: theme.borderRadius.md, borderWidth: 1, borderColor: theme.colors.border.medium },
  }), [theme]);
  const refreshMemory = async () => {
    try { setMemories(await listMindMemory()); setMemoryError(''); }
    catch { setMemoryError(t('Unable to read memory. Try again.')); }
  };
  const confirmClear = () => Alert.alert(t('Clear memory'), t('Delete all saved memories? Your conversation stays unchanged.'), [
    { text: t('Cancel'), style: 'cancel' },
    { text: t('Delete'), style: 'destructive', onPress: async () => {
      try { await clearMindMemory(); await refreshMemory(); } catch { setMemoryError(t('Unable to clear memory. Try again.')); }
    } },
  ]);
  const section = (key: string, icon: keyof typeof Ionicons.glyphMap, title: string, detail: string, children?: React.ReactNode) => <View key={key} style={styles.card}>
    <Pressable style={styles.row} accessibilityRole="button" accessibilityState={children ? { expanded: panel === key } : undefined}
      onPress={() => { if (key === 'voice' || key === 'device') setSheet(key === 'voice' ? 'Voice' : 'Model'); else { setPanel(panel === key ? null : key); if (key === 'memory') void refreshMemory(); } }}>
      <Ionicons name={icon} size={22} color={theme.colors.primary[500]} />
      <View style={{ flex: 1, gap: theme.spacing[1] }}><Text style={styles.label}>{t(title)}</Text><Text style={styles.hint}>{detail}</Text></View>
      <Ionicons name={panel === key ? 'chevron-up' : 'chevron-forward'} size={18} color={theme.colors.text.secondary} />
    </Pressable>
    {panel === key && children && <View style={styles.body}>{children}</View>}
  </View>;
  return <View style={styles.screen}>
    <ScreenHeader title={t('Prismo settings')} showBack />
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {section('voice', 'volume-high-outline', 'Voice', qvac.config.ttsEngine === 'system' ? t('System voice') : `Supertonic 3 · ${qvac.config.ttsVoice ?? 'F1'}`)}
      {section('responses', 'chatbubble-outline', 'Responses', t('Tone and personal instructions'), <>
        <View style={styles.choices}>{[
          ['Concise', 'Be concise and direct.'], ['Friendly', 'Be warm and friendly; explain simply.'], ['Expert', 'Be precise and technically accurate.'],
        ].map(([label, persona]) => <Pressable key={label} accessibilityRole="radio" accessibilityState={{ selected: cfg.persona === persona }}
          style={[styles.choice, cfg.persona === persona && { borderColor: theme.colors.primary[500] }]}
          onPress={() => dispatch(setMindConfig({ persona }))}><Text style={styles.label}>{t(label)}</Text></Pressable>)}</View>
        <TextInput accessibilityLabel={t('Personal instructions')} multiline value={t(cfg.persona)} style={styles.input}
          placeholder={t('How should Prismo help you?')} placeholderTextColor={theme.colors.text.tertiary}
          onChangeText={persona => dispatch(setMindConfig({ persona }))} />
        <Text style={styles.hint}>{t('Changes apply to your next message.')}</Text>
      </>)}
      {section('memory', 'bookmark-outline', 'Memory & privacy', t('See and delete saved memories'), <>
        <View style={[styles.row, { padding: 0 }]}><Text style={[styles.label, { flex: 1 }]}>{t('Remember my preferences')}</Text><Switch accessibilityLabel={t('Remember my preferences')} value={cfg.memoryEnabled} onValueChange={memoryEnabled => { dispatch(setMindConfig({ memoryEnabled })); }} /></View>
        <Text style={styles.hint}>{t('Turning memory off does not delete saved memories.')}</Text>
        {!!memoryError && <Text accessibilityRole="alert" style={styles.hint}>{memoryError}</Text>}
        {memories.length === 0 && !memoryError && <Text style={styles.hint}>{t('No saved memories yet.')}</Text>}
        {memories.map(memory => <View key={memory.id} style={[styles.row, { padding: 0 }]}><Text style={[styles.hint, { flex: 1 }]}>{memory.text}</Text>
          <Pressable accessibilityLabel={t('Delete memory')} style={styles.choice} onPress={async () => { try { await removeMindMemory(memory.id); await refreshMemory(); } catch { setMemoryError(t('Unable to clear memory. Try again.')); } }}><Ionicons name="trash-outline" size={18} color={theme.colors.error[500]} /></Pressable></View>)}
        {memories.length > 0 && <Pressable style={styles.choice} onPress={confirmClear}><Text style={[styles.label, { color: theme.colors.error[500] }]}>{t('Clear memory')}</Text></Pressable>}
      </>)}
      {section('payments', 'shield-checkmark-outline', 'Payments & permissions', t('Confirmations and agent budget'), <>
        <Text style={styles.hint}>{t('You review wallet payments before sending. Require biometrics or PIN from:')}</Text>
        <View style={styles.choices}>{[[t('Always'), 0], ['10k sats', 10000], ['50k sats', 50000], ['250k sats', 250000]].map(([label, value]) => <Pressable key={value} accessibilityRole="radio" accessibilityState={{ selected: cfg.confirmAuthThresholdSats === value }} style={[styles.choice, cfg.confirmAuthThresholdSats === value && { borderColor: theme.colors.primary[500] }]} onPress={() => dispatch(setMindConfig({ confirmAuthThresholdSats: Number(value) }))}><Text style={styles.label}>{label}</Text></Pressable>)}</View>
        <Pressable style={styles.choice} onPress={() => navigation?.navigate('AgentWallet')}><Text style={styles.label}>{t('Agent wallet')}</Text></Pressable>
      </>)}
      {section('device', 'phone-portrait-outline', 'On this device', aiMode === 'off' ? t('Prismo is off') : t('Model, downloads and diagnostics'))}
    </ScrollView>
    {sheet && <QVACSettingsSheet visible initialTab={sheet} onClose={() => setSheet(null)} catalog={qvac.catalog} config={qvac.config}
      llmStatus={qvac.llmStatus} combinedProgress={qvac.combinedProgress} onSelectModel={qvac.setModel} deviceMemGb={qvac.deviceMemGb}
      recommendedModelId={qvac.recommendedModelId} aiMode={aiMode} onSetAiMode={mode => { dispatch(setAiMode(mode)); }}
      downloadedModelIds={qvac.downloadedModelIds} onDeleteModel={qvac.deleteModel} sttCatalog={qvac.sttCatalog} ttsOptions={qvac.ttsOptions}
      onSetSttModel={qvac.setSttModel} onSetTtsEngine={qvac.setTtsEngine} onSetTtsVoice={qvac.setTtsVoice} />}
  </View>;
}
