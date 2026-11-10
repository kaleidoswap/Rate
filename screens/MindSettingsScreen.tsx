import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, TextInput, Switch, Pressable, Alert, Share, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ScreenHeader } from '../components';
import { Card } from '../components/Card';
import { Badge, type BadgeTone } from '../components/Badge';
import { SectionHeader } from '../components/SectionHeader';
import { Divider } from '../components/Divider';
import { leading, type Theme } from '../theme';
import { useAppTheme } from '../theme/ThemeProvider';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { selectMindConfig, setMindConfig, selectAiMode, setAiMode } from '../store/slices/settingsSlice';
import { useAppLanguage } from '../localization/useAppLanguage';
import { useQVAC } from '../hooks/useQVAC';
import QVACSettingsSheet from '../components/QVACSettingsSheet';
import { clearMindMemory, listMindMemory, removeMindMemory } from '../services/mindAgent';
import { voiceDiagnosticReport } from '../services/voiceDiagnostics';
import type { MemoryItem } from '@kaleidorg/mind';

type IconName = keyof typeof Ionicons.glyphMap;

const TONES: [string, string][] = [
  ['Concise', 'Be concise and direct.'],
  ['Friendly', 'Be warm and friendly; explain simply.'],
  ['Expert', 'Be precise and technically accurate.'],
];
const AUTH_THRESHOLDS: [string, number][] = [['Always', 0], ['10k sats', 10000], ['50k sats', 50000], ['250k sats', 250000]];

const formatSize = (mb?: number) => (mb == null ? '' : mb < 1024 ? `${Math.round(mb)} MB` : `${(mb / 1024).toFixed(1)} GB`);

const makeStyles = (theme: Theme) => {
  const fs = theme.typography.fontSize;
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.colors.background.primary },
    content: { padding: theme.spacing[4], paddingBottom: theme.spacing[10] },
    section: { marginTop: theme.spacing[6] },
    sectionHeader: { marginBottom: theme.spacing[2], paddingHorizontal: theme.spacing[1] },
    card: { padding: 0, overflow: 'hidden' },
    // Status header
    hero: { padding: theme.spacing[4], gap: theme.spacing[3] },
    heroTop: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing[3] },
    heroIcon: { width: 48, height: 48, borderRadius: theme.borderRadius.lg, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.primary[500] + '1F' },
    heroTitle: { color: theme.colors.text.primary, fontSize: fs.lg, lineHeight: leading(fs.lg, theme.typography.lineHeight.tight), fontWeight: theme.typography.fontWeight.bold },
    progressTrack: { height: 4, borderRadius: theme.borderRadius.full, backgroundColor: theme.colors.border.light, overflow: 'hidden' },
    progressFill: { height: 4, backgroundColor: theme.colors.primary[500] },
    heroAction: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 },
    heroActionText: { color: theme.colors.primary[500], fontSize: fs.sm, lineHeight: leading(fs.sm), fontWeight: theme.typography.fontWeight.semibold },
    // Rows
    row: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing[3], minHeight: 56, paddingHorizontal: theme.spacing[4], paddingVertical: theme.spacing[3] },
    rowPressed: { backgroundColor: theme.colors.background.secondary },
    rowDisabled: { opacity: 0.45 },
    iconTile: { width: 32, height: 32, borderRadius: theme.borderRadius.md, alignItems: 'center', justifyContent: 'center' },
    rowText: { flex: 1, gap: theme.spacing[0.5] },
    label: { color: theme.colors.text.primary, fontSize: fs.base, lineHeight: leading(fs.base, theme.typography.lineHeight.tight), fontWeight: theme.typography.fontWeight.semibold },
    hint: { color: theme.colors.text.secondary, fontSize: fs.sm, lineHeight: leading(fs.sm) },
    errorText: { color: theme.colors.error[500], fontSize: fs.sm, lineHeight: leading(fs.sm) },
    body: { paddingHorizontal: theme.spacing[4], paddingBottom: theme.spacing[4], gap: theme.spacing[3] },
    input: { minHeight: 88, padding: theme.spacing[3], borderRadius: theme.borderRadius.md, color: theme.colors.text.primary, backgroundColor: theme.colors.background.secondary, fontSize: fs.base, lineHeight: leading(fs.base), textAlignVertical: 'top' },
    choices: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing[2] },
    choice: { minHeight: 44, justifyContent: 'center', paddingHorizontal: theme.spacing[4], borderRadius: theme.borderRadius.full, borderWidth: 1, borderColor: theme.colors.border.medium, backgroundColor: theme.colors.background.secondary },
    choiceActive: { borderColor: theme.colors.primary[500], backgroundColor: theme.colors.primary[500] + '1F' },
    choiceLabel: { color: theme.colors.text.secondary, fontSize: fs.sm, lineHeight: leading(fs.sm), fontWeight: theme.typography.fontWeight.semibold },
    choiceLabelActive: { color: theme.colors.primary[500] },
    memoryRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing[2], minHeight: 44 },
    iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  });
};
function useStyles() { const theme = useAppTheme(); return useMemo(() => makeStyles(theme), [theme]); }

function Row({ icon, label, description, onPress, right, danger, chevron = !!onPress, expanded, disabled, accessibilityLabel }: {
  icon: IconName; label: string; description?: string; onPress?: () => void; right?: React.ReactNode; danger?: boolean;
  chevron?: boolean; expanded?: boolean; disabled?: boolean; accessibilityLabel?: string;
}) {
  const theme = useAppTheme();
  const styles = useStyles();
  const accent = danger ? theme.colors.error[500] : theme.colors.primary[500];
  const content = <>
    <View style={[styles.iconTile, { backgroundColor: accent + '1F' }]}><Ionicons name={icon} size={18} color={accent} /></View>
    <View style={styles.rowText}>
      <Text style={[styles.label, danger && { color: theme.colors.error[500] }]}>{label}</Text>
      {!!description && <Text style={styles.hint}>{description}</Text>}
    </View>
    {right}
    {chevron && <Ionicons name={expanded === undefined ? 'chevron-forward' : expanded ? 'chevron-up' : 'chevron-down'} size={18} color={theme.colors.text.tertiary} />}
  </>;
  if (!onPress) return <View style={styles.row}>{content}</View>;
  return <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={accessibilityLabel}
    accessibilityState={{ disabled: !!disabled, ...(expanded !== undefined ? { expanded } : {}) }}
    style={({ pressed }) => [styles.row, pressed && styles.rowPressed, disabled && styles.rowDisabled]}>{content}</Pressable>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const styles = useStyles();
  return <View style={styles.section}>
    <SectionHeader title={title} eyebrow style={styles.sectionHeader} />
    <Card style={styles.card}>{children}</Card>
  </View>;
}

export default function MindSettingsScreen({ navigation }: { navigation?: any }) {
  const theme = useAppTheme();
  const { t } = useAppLanguage();
  const dispatch = useAppDispatch();
  const cfg = useAppSelector(selectMindConfig);
  const aiMode = useAppSelector(selectAiMode);
  const qvac = useQVAC(false);
  const [sheet, setSheet] = useState<'Model' | 'Voice' | null>(null);
  const [memoriesOpen, setMemoriesOpen] = useState(false);
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [memoryError, setMemoryError] = useState('');
  const [actionError, setActionError] = useState('');

  const styles = useStyles();

  const refreshMemory = useCallback(async () => {
    try { setMemories(await listMindMemory()); setMemoryError(''); }
    catch { setMemoryError(t('Unable to read memory. Try again.')); }
  }, [t]);
  // Load once so the row can show a count and the danger zone knows whether there is anything to clear.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void refreshMemory(); }, []);

  const confirmClear = () => Alert.alert(t('Clear memory'), t('Delete all saved memories? Your conversation stays unchanged.'), [
    { text: t('Cancel'), style: 'cancel' },
    { text: t('Delete'), style: 'destructive', onPress: async () => {
      try { await clearMindMemory(); await refreshMemory(); } catch { setMemoryError(t('Unable to clear memory. Try again.')); }
    } },
  ]);

  // ---- Model status ----
  const catalog = qvac.catalog ?? [];
  const config = qvac.config ?? ({} as typeof qvac.config);
  const model = catalog.find(m => m.id === config.modelId);
  const downloaded = qvac.downloadedModelIds ?? [];
  const progress = Math.max(0, Math.min(100, Math.round(qvac.combinedProgress ?? 0)));
  const status: { label: string; tone: BadgeTone; icon: IconName } = aiMode === 'off'
    ? { label: t('Off'), tone: 'neutral', icon: 'moon-outline' }
    : qvac.llmStatus === 'ready' ? { label: t('Ready'), tone: 'success', icon: 'checkmark-circle' }
    : qvac.llmStatus === 'downloading' ? { label: `${progress}%`, tone: 'primary', icon: 'cloud-download-outline' }
    : qvac.llmStatus === 'loading' ? { label: t('Loading'), tone: 'warning', icon: 'hourglass-outline' }
    : qvac.llmStatus === 'error' ? { label: t('Error'), tone: 'error', icon: 'alert-circle' }
    : qvac.llmStatus === 'downloaded' || (model && downloaded.includes(model.id)) ? { label: t('Downloaded'), tone: 'info', icon: 'checkmark-done-outline' }
    : { label: t('Not downloaded'), tone: 'neutral', icon: 'cloud-outline' };
  const modelLine = model ? [model.label, formatSize(model.sizeMB)].filter(Boolean).join(' · ') : t('No model selected');
  const statusLine = aiMode === 'off' ? t('Prismo is off')
    : qvac.llmStatus === 'downloading' ? `${t('Downloading model…')} ${progress}%`
    : modelLine;

  // Downloaded weights the user is not using (chat or speech model): safe to remove in bulk.
  const unused = downloaded.filter(id => id !== config.modelId && id !== config.sttModelId);
  const unusedMB = unused.reduce((sum, id) => sum + (catalog.find(m => m.id === id)?.sizeMB ?? (qvac.sttCatalog ?? []).find(s => s.id === id)?.sizeMB ?? 0), 0);
  const busy = qvac.llmStatus === 'downloading' || qvac.llmStatus === 'loading';
  const confirmDeleteUnused = () => Alert.alert(t('Delete unused models?'), t('Removes downloaded models you are not using. You can download them again later.'), [
    { text: t('Cancel'), style: 'cancel' },
    { text: t('Delete'), style: 'destructive', onPress: async () => {
      try { for (const id of unused) await qvac.deleteModel(id); setActionError(''); }
      catch { setActionError(t('Unable to apply changes. Try again.')); }
    } },
  ]);
  const exportDiagnostics = () => { void Share.share({ message: voiceDiagnosticReport() }).catch(() => setActionError(t('Unable to apply changes. Try again.'))); };

  const voiceLabel = config.ttsEngine === 'system' ? t('System voice') : `Supertonic 3 · ${config.ttsVoice ?? 'F1'}`;

  const switchColors = { false: theme.colors.border.medium, true: theme.colors.primary[500] };
  const inset = theme.spacing[4] + 32 + theme.spacing[3];

  return <View style={styles.screen}>
    <ScreenHeader title={t('Prismo settings')} showBack />
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {/* ---- Status header ---- */}
      <Card variant="elevated" style={styles.hero}>
        <View style={styles.heroTop} accessible accessibilityLabel={`${t('Model status')}: ${statusLine}, ${status.label}`}>
          <View style={styles.heroIcon}><Ionicons name="sparkles" size={24} color={theme.colors.primary[500]} /></View>
          <View style={styles.rowText}>
            <Text style={styles.heroTitle}>Prismo</Text>
            <Text style={styles.hint} numberOfLines={2}>{statusLine}</Text>
          </View>
          <Badge label={status.label} tone={status.tone} icon={status.icon} size="md" />
        </View>
        {aiMode !== 'off' && qvac.llmStatus === 'downloading' && <View style={styles.progressTrack} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: progress }}>
          <View style={[styles.progressFill, { width: `${progress}%` }]} />
        </View>}
        {aiMode !== 'off' && qvac.llmStatus === 'error' && !!qvac.error && <Text accessibilityRole="alert" style={styles.errorText}>{t(qvac.error)}</Text>}
        <Divider />
        <Pressable style={styles.heroAction} accessibilityRole="button" onPress={() => setSheet('Model')}>
          <Text style={styles.heroActionText}>{t('Manage model')}</Text>
          <Ionicons name="chevron-forward" size={16} color={theme.colors.primary[500]} />
        </Pressable>
      </Card>

      {/* ---- Model ---- */}
      <Section title={t('Model')}>
        <Row icon="power-outline" label={t('Use Prismo')} description={aiMode === 'off' ? t('Prismo is off') : t('Runs privately on this device')}
          right={<Switch accessibilityLabel={t('Use Prismo')} value={aiMode !== 'off'} disabled={busy} trackColor={switchColors}
            onValueChange={on => { dispatch(setAiMode(on ? 'local' : 'off')); }} />} />
        <Divider style={{ marginLeft: inset }} />
        <Row icon="phone-portrait-outline" label={t('On this device')} description={model ? modelLine : t('Model, downloads and diagnostics')} onPress={() => setSheet('Model')} />
      </Section>

      {/* ---- Voice & responses ---- */}
      <Section title={t('Voice')}>
        <Row icon="volume-high-outline" label={t('Voice')} description={voiceLabel} onPress={() => setSheet('Voice')} />
        <Divider style={{ marginLeft: inset }} />
        <Row icon="chatbubble-outline" label={t('Responses')} description={t('Tone and personal instructions')} />
        <View style={styles.body}>
          <View style={styles.choices}>{TONES.map(([label, persona]) => {
            const selected = cfg.persona === persona;
            return <Pressable key={label} accessibilityRole="radio" accessibilityState={{ selected }} style={[styles.choice, selected && styles.choiceActive]}
              onPress={() => dispatch(setMindConfig({ persona }))}><Text style={[styles.choiceLabel, selected && styles.choiceLabelActive]}>{t(label)}</Text></Pressable>;
          })}</View>
          <TextInput accessibilityLabel={t('Personal instructions')} multiline value={t(cfg.persona)} style={styles.input}
            placeholder={t('How should Prismo help you?')} placeholderTextColor={theme.colors.text.tertiary}
            onChangeText={persona => dispatch(setMindConfig({ persona }))} />
          <Text style={styles.hint}>{t('Changes apply to your next message.')}</Text>
        </View>
      </Section>

      {/* ---- Memory & privacy ---- */}
      <Section title={t('Memory & privacy')}>
        <Row icon="bookmark-outline" label={t('Remember my preferences')} description={t('Turning memory off does not delete saved memories.')}
          right={<Switch accessibilityLabel={t('Remember my preferences')} value={cfg.memoryEnabled} trackColor={switchColors}
            onValueChange={memoryEnabled => { dispatch(setMindConfig({ memoryEnabled })); }} />} />
        <Divider style={{ marginLeft: inset }} />
        <Row icon="albums-outline" label={t('Saved memories')} description={memories.length ? `${memories.length}` : t('See and delete saved memories')}
          expanded={memoriesOpen} onPress={() => { setMemoriesOpen(!memoriesOpen); if (!memoriesOpen) void refreshMemory(); }} />
        {memoriesOpen && <View style={styles.body}>
          {!!memoryError && <Text accessibilityRole="alert" style={styles.errorText}>{memoryError}</Text>}
          {memories.length === 0 && !memoryError && <Text style={styles.hint}>{t('No saved memories yet.')}</Text>}
          {memories.map((memory, i) => <React.Fragment key={memory.id}>
            {i > 0 && <Divider />}
            <View style={styles.memoryRow}>
              <Text style={[styles.hint, { flex: 1, color: theme.colors.text.primary }]}>{memory.text}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel={t('Delete memory')} style={styles.iconButton}
                onPress={async () => { try { await removeMindMemory(memory.id); await refreshMemory(); } catch { setMemoryError(t('Unable to clear memory. Try again.')); } }}>
                <Ionicons name="trash-outline" size={18} color={theme.colors.error[500]} />
              </Pressable>
            </View>
          </React.Fragment>)}
        </View>}
      </Section>

      {/* ---- Payments & permissions ---- */}
      <Section title={t('Payments & permissions')}>
        <Row icon="finger-print-outline" label={t('Confirm with biometrics or PIN')} description={t('You review wallet payments before sending. Require biometrics or PIN from:')} />
        <View style={styles.body}>
          <View style={styles.choices}>{AUTH_THRESHOLDS.map(([label, value]) => {
            const selected = cfg.confirmAuthThresholdSats === value;
            return <Pressable key={value} accessibilityRole="radio" accessibilityState={{ selected }} style={[styles.choice, selected && styles.choiceActive]}
              onPress={() => dispatch(setMindConfig({ confirmAuthThresholdSats: value }))}><Text style={[styles.choiceLabel, selected && styles.choiceLabelActive]}>{value === 0 ? t(label) : label}</Text></Pressable>;
          })}</View>
        </View>
        <Divider style={{ marginLeft: inset }} />
        <Row icon="wallet-outline" label={t('Agent wallet')} description={t('Confirmations and agent budget')} onPress={() => navigation?.navigate('AgentWallet')} />
      </Section>

      {/* ---- Advanced ---- */}
      <Section title={t('Advanced')}>
        <Row icon="mic-outline" label={t('Speech recognition')} description={t('Speech-to-text (Whisper)')} onPress={() => setSheet('Voice')} />
        <Divider style={{ marginLeft: inset }} />
        <Row icon="share-outline" label={t('Export voice diagnostics')} onPress={exportDiagnostics} />
      </Section>
      {!!actionError && <Text accessibilityRole="alert" style={[styles.errorText, { marginTop: theme.spacing[2] }]}>{actionError}</Text>}

      {/* ---- Danger zone: destructive actions grouped last ---- */}
      {(unused.length > 0 || memories.length > 0) && <Section title={t('Danger zone')}>
        {unused.length > 0 && <Row danger icon="trash-outline" label={t('Delete unused models')} disabled={busy} onPress={confirmDeleteUnused}
          description={[`${unused.length}`, formatSize(unusedMB || undefined)].filter(Boolean).join(' · ')} chevron={false} />}
        {unused.length > 0 && memories.length > 0 && <Divider style={{ marginLeft: inset }} />}
        {memories.length > 0 && <Row danger icon="close-circle-outline" label={t('Clear memory')} description={t('Delete all saved memories')} onPress={confirmClear} chevron={false} />}
      </Section>}
    </ScrollView>
    {sheet && <QVACSettingsSheet visible initialTab={sheet} onClose={() => setSheet(null)} catalog={qvac.catalog} config={qvac.config}
      llmStatus={qvac.llmStatus} combinedProgress={qvac.combinedProgress} onSelectModel={qvac.setModel} deviceMemGb={qvac.deviceMemGb}
      recommendedModelId={qvac.recommendedModelId} aiMode={aiMode} onSetAiMode={mode => { dispatch(setAiMode(mode)); }}
      downloadedModelIds={qvac.downloadedModelIds} onDeleteModel={qvac.deleteModel} sttCatalog={qvac.sttCatalog} ttsOptions={qvac.ttsOptions}
      onSetSttModel={qvac.setSttModel} onSetTtsEngine={qvac.setTtsEngine} onSetTtsVoice={qvac.setTtsVoice} />}
  </View>;
}
