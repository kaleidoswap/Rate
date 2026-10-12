// components/QVACSettingsSheet.tsx
import React, { useMemo, useRef, useState, useEffect } from 'react';
import {
  Modal,
  Platform,
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { leading, type Theme } from '../theme';
import { useAppTheme } from '../theme/ThemeProvider';
import type { QVACModel, SttModel, TtsOption, TtsEngine } from '../services/qvacModels';
import type { QVACConfig, ModelStatus } from '../services/QVACService';
import { speak, stopSpeak } from '../services/qvacTts';
import { getAppLanguage } from '../localization/language';
import type { AiMode } from '../store/slices/settingsSlice';

interface Props {
  visible: boolean;
  onClose: () => void;
  catalog: QVACModel[];
  config: QVACConfig;
  llmStatus: ModelStatus;
  combinedProgress: number;
  onSelectModel: (id: string) => void;
  /** Total device RAM in GB (shown next to the model list). */
  deviceMemGb?: number;
  /** Model id recommended for this device — badged in the list. */
  recommendedModelId?: string;
  /** Current KaleidoMind mode: off | local. */
  aiMode: AiMode;
  /** Switch the KaleidoMind mode. 'off' keeps the QVAC worklet from starting. */
  onSetAiMode: (mode: AiMode) => void;
  /** Ids of models with weights already downloaded on this device. */
  downloadedModelIds: string[];
  /** Delete a downloaded model's weights from disk. */
  onDeleteModel: (id: string) => void;
  /** Speech-to-text (Whisper) models for the voice mode. */
  sttCatalog: SttModel[];
  /** Text-to-speech engine options for the voice mode. */
  ttsOptions: TtsOption[];
  /** Switch the speech-to-text model. */
  onSetSttModel: (id: string) => void;
  /** Switch the text-to-speech engine. */
  onSetTtsEngine: (engine: TtsEngine) => void;
  /** Open the "Design your agent" screen (personality, connectors, context). */
  onDesignAgent?: () => void;
  onSetTtsVoice?: (voice: 'F1' | 'M1') => Promise<void>;
}

const TIER_LABEL: Record<string, string> = {
  phone: 'Phone',
  pro: 'Pro / high-RAM',
  mac: 'Mac / desktop',
};

export default function QVACSettingsSheet({
  visible,
  onClose,
  catalog,
  config,
  llmStatus,
  combinedProgress,
  onSelectModel,
  deviceMemGb,
  recommendedModelId,
  aiMode,
  onSetAiMode,
  downloadedModelIds,
  onDeleteModel,
  sttCatalog,
  ttsOptions,
  onSetSttModel,
  onSetTtsEngine,
  onDesignAgent,
  onSetTtsVoice,
}: Props) {
  const theme = useAppTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const [openingPersonalization, setOpeningPersonalization] = useState(false);
  const [tab, setTab] = useState<'Model' | 'Voice'>('Model');
  const [pending, setPending] = useState(false);
  const actionLock = useRef(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState(false);
  const previewActive = useRef(false);
  const [recognition, setRecognition] = useState(false);
  useEffect(() => () => { if (previewActive.current) void stopSpeak(); }, []);
  const act = async (action: () => unknown) => {
    if (actionLock.current) return;
    actionLock.current = true; setPending(true); setError('');
    try { await action(); } catch (e) { setError(e instanceof Error ? e.message : 'Unable to apply changes. Try again.'); }
    finally { actionLock.current = false; setPending(false); }
  };
  const listen = async () => {
    if (previewActive.current) { previewActive.current = false; setPreview(false); await stopSpeak(); return; }
    previewActive.current = true; setPreview(true); setError('');
    try {
      await speak(getAppLanguage() === 'it' ? 'Ciao, sono Prismo. Come posso aiutarti oggi?' : 'Hi, I am Prismo. How can I help you today?', {
        onFallback: () => setError('Supertonic is unavailable. This preview uses the system voice.'),
        onDone: () => { previewActive.current = false; setPreview(false); },
        onError: () => { previewActive.current = false; setPreview(false); setError('Unable to play voice. Try again.'); },
      });
    } catch { previewActive.current = false; setPreview(false); setError('Unable to play voice. Try again.'); }
  };
  const busy = pending || llmStatus === 'downloading' || llmStatus === 'loading';
  const isDownloaded = (id: string) => downloadedModelIds.includes(id);

  const confirmDelete = (id: string, label: string) => {
    Alert.alert(
      'Delete model?',
      `Remove “${label}” from this device? You can download it again later.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => { void act(() => onDeleteModel(id)); } },
      ]
    );
  };

  return (
    <Modal visible={visible && !openingPersonalization} onDismiss={() => { if (openingPersonalization) onDesignAgent?.(); }} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <Text style={styles.title}>Prismo settings</Text>
          <TouchableOpacity onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close model settings">
            <Ionicons name="close" size={26} color={theme.colors.text.primary} />
          </TouchableOpacity>
        </View>

        {busy && (
          <View style={styles.busyBar}>
            <ActivityIndicator size="small" color={theme.colors.primary[500]} />
            <Text style={styles.busyText}>
              {llmStatus === 'downloading' ? `Downloading model… ${combinedProgress}%` : 'Applying changes…'}
            </Text>
          </View>
        )}

        {!!error && <Text accessibilityRole="alert" style={[styles.sectionHint, { color: theme.colors.error[500], padding: theme.spacing[4] }]}>{error}</Text>}
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.modeGroup}>
            {(['Model', 'Voice'] as const).map(item => <TouchableOpacity key={item}
              accessibilityRole="tab" accessibilityState={{ selected: tab === item }}
              style={[styles.modeBtn, tab === item && styles.modeBtnActive]} onPress={() => setTab(item)}>
              <Text style={[styles.modeBtnLabel, tab === item && styles.modeBtnLabelActive]}>{item}</Text>
            </TouchableOpacity>)}
          </View>
          {/* ---- KaleidoMind mode ---- */}
          <Text style={styles.sectionTitle}>Agent</Text>
          <Text style={styles.sectionHint}>
            Choose how the assistant runs. You can change this anytime.
          </Text>
          <View style={styles.modeGroup}>
            {([
              { key: 'off', icon: 'moon-outline', label: 'Off' },
              { key: 'local', icon: 'phone-portrait-outline', label: 'On this device' },
            ] as { key: AiMode; icon: keyof typeof Ionicons.glyphMap; label: string }[]).map((m) => {
              const active = aiMode === m.key;
              return (
                <TouchableOpacity
                  key={m.key}
                  style={[styles.modeBtn, active && styles.modeBtnActive]}
                  disabled={busy || preview}
                  onPress={() => { void act(() => onSetAiMode(m.key)); }}
                  activeOpacity={0.85}
                >
                  <Ionicons
                    name={m.icon}
                    size={20}
                    color={active ? theme.colors.text.inverse : theme.colors.text.secondary}
                  />
                  <Text style={[styles.modeBtnLabel, active && styles.modeBtnLabelActive]}>{m.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {onDesignAgent && aiMode !== 'off' && (
            <TouchableOpacity style={styles.designRow} onPress={() => { if (Platform.OS === 'ios') setOpeningPersonalization(true); else onDesignAgent?.(); }} activeOpacity={0.85}>
              <Ionicons name="construct-outline" size={18} color={theme.colors.primary[500]} />
              <View style={{ flex: 1 }}>
                <Text style={styles.designLabel}>Personalize Prismo</Text>
                <Text style={styles.designHint}>Personality, payments & memory</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={theme.colors.text.tertiary} />
            </TouchableOpacity>
          )}

          {aiMode === 'off' && (
            <Text style={styles.disabledNote}>
              Prismo is off. Pick “On this device” to use it.
            </Text>
          )}

          {/* ---- Model picker (on-device mode only) ---- */}
          {aiMode === 'local' && tab === 'Model' && (
          <>
          <Text style={styles.sectionTitle}>On-device model</Text>
          <Text style={styles.sectionHint}>
            {deviceMemGb
              ? `Your device has ~${deviceMemGb} GB RAM. The recommended model fits it best; smaller models run faster.`
              : 'Smaller models run faster and use less memory.'}
          </Text>

          {catalog.filter((m) => m.localCapable && m.tier === 'phone').map((m) => {
            const selected = m.id === config.modelId;
            const recommended = m.id === recommendedModelId;
            return (
              <TouchableOpacity
                key={m.id}
                style={[styles.modelRow, selected && styles.modelRowSelected]}
                disabled={busy || preview}
                accessibilityRole="radio" accessibilityState={{ selected, disabled: busy || preview }}
                onPress={() => { void act(() => onSelectModel(m.id)); }}
              >
                <View style={styles.modelInfo}>
                  <View style={styles.modelLabelRow}>
                    <Text style={styles.modelLabel}>
                      {m.label}

                    </Text>
                    {recommended && (
                      <View style={styles.recPill}>
                        <Text style={styles.recPillText}>Recommended</Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.modelMeta}>
                    {m.params} · {m.sizeMB < 1024 ? `${Math.round(m.sizeMB)} MB` : `${(m.sizeMB / 1024).toFixed(1)} GB`} · {TIER_LABEL[m.tier]}
                    {isDownloaded(m.id) ? ' · ✓ Downloaded' : ''}
                  </Text>
                </View>
                <View style={styles.modelRight}>
                  {isDownloaded(m.id) && !selected && !busy && (
                    <TouchableOpacity
                      onPress={() => confirmDelete(m.id, m.label)}
                      hitSlop={10}
                      style={styles.trashBtn}
                      accessibilityLabel={`Delete ${m.label}`}
                    >
                      <Ionicons name="trash-outline" size={18} color={theme.colors.error[500]} />
                    </TouchableOpacity>
                  )}
                  {selected ? (
                    <Ionicons name="checkmark-circle" size={22} color={theme.colors.primary[500]} />
                  ) : (
                    <Ionicons name="ellipse-outline" size={22} color={theme.colors.border.medium} />
                  )}
                </View>
              </TouchableOpacity>
            );
          })}
          </>
          )}

          {/* ---- Voice mode: STT + TTS (on-device mode only) ---- */}
          {aiMode === 'local' && tab === 'Voice' && (
          <>
          <Text style={[styles.sectionTitle, { marginTop: theme.spacing[6] }]}>Voice mode</Text>
          <Text style={styles.sectionHint}>
            Speech recognition and the spoken reply run on-device.
          </Text>

          <Text style={[styles.subSectionTitle, { marginTop: theme.spacing[4] }]}>Voice output</Text>
          {ttsOptions.map((t) => {
            const selected = t.id === config.ttsEngine;
            return (
              <TouchableOpacity
                key={t.id}
                style={[styles.modelRow, selected && styles.modelRowSelected]}
                disabled={busy || preview}
                onPress={() => { void act(() => onSetTtsEngine(t.id)); }}
              >
                <View style={styles.modelInfo}>
                  <Text style={styles.modelLabel}>{t.label}</Text>
                  <Text style={styles.modelMeta}>{t.hint}</Text>
                </View>
                {selected ? (
                  <Ionicons name="checkmark-circle" size={22} color={theme.colors.primary[500]} />
                ) : (
                  <Ionicons name="ellipse-outline" size={22} color={theme.colors.border.medium} />
                )}
              </TouchableOpacity>
            );
          })}
          {config.ttsEngine === 'supertonic' && onSetTtsVoice && <>
            <Text style={styles.subSectionTitle}>Prismo’s voice</Text>
            <View style={styles.modeGroup}>
              {(['F1', 'M1'] as const).map(voice => <TouchableOpacity key={voice} disabled={busy || preview}
                accessibilityRole="radio" accessibilityState={{ selected: (config.ttsVoice ?? 'F1') === voice, disabled: busy || preview }}
                style={[styles.modeBtn, (config.ttsVoice ?? 'F1') === voice && styles.modeBtnActive]}
                onPress={() => { void act(() => onSetTtsVoice(voice)); }}>
                <Text style={[styles.modeBtnLabel, (config.ttsVoice ?? 'F1') === voice && styles.modeBtnLabelActive]}>{voice === 'F1' ? 'Feminine · F1' : 'Masculine · M1'}</Text>
              </TouchableOpacity>)}
            </View>
          </>}
          <TouchableOpacity style={styles.designRow} disabled={busy} accessibilityRole="button" onPress={() => { void listen(); }}>
            <Ionicons name={preview ? 'stop-circle-outline' : 'play-circle-outline'} size={24} color={theme.colors.primary[500]} />
            <Text style={styles.designLabel}>{preview ? 'Stop preview' : 'Listen to voice'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.designRow} accessibilityRole="button" accessibilityState={{ expanded: recognition }} onPress={() => setRecognition(!recognition)}>
            <Text style={[styles.designLabel, { flex: 1 }]}>Speech recognition</Text>
            <Ionicons name={recognition ? 'chevron-up' : 'chevron-down'} size={20} color={theme.colors.text.secondary} />
          </TouchableOpacity>
          {recognition && <>
          <Text style={styles.subSectionTitle}>Speech-to-text (Whisper)</Text>
          {sttCatalog.filter(s => s.id !== 'whisper-large-v3-turbo' && (s.lang !== 'en' || getAppLanguage() === 'en')).map((s) => {
            const selected = s.id === config.sttModelId;
            return (
              <TouchableOpacity
                key={s.id}
                style={[styles.modelRow, selected && styles.modelRowSelected]}
                disabled={busy || preview}
                onPress={() => { void act(() => onSetSttModel(s.id)); }}
              >
                <View style={styles.modelInfo}>
                  <Text style={styles.modelLabel}>{s.label}</Text>
                  <Text style={styles.modelMeta}>
                    {s.lang === 'en' ? 'English only' : 'Multilingual'} · {s.sizeMB} MB
                    {isDownloaded(s.id) ? ' · ✓ Downloaded' : ''}
                  </Text>
                </View>
                <View style={styles.modelRight}>
                  {isDownloaded(s.id) && !selected && !busy && (
                    <TouchableOpacity
                      onPress={() => confirmDelete(s.id, s.label)}
                      hitSlop={10}
                      style={styles.trashBtn}
                      accessibilityLabel={`Delete ${s.label}`}
                    >
                      <Ionicons name="trash-outline" size={18} color={theme.colors.error[500]} />
                    </TouchableOpacity>
                  )}
                  {selected ? (
                    <Ionicons name="checkmark-circle" size={22} color={theme.colors.primary[500]} />
                  ) : (
                    <Ionicons name="ellipse-outline" size={22} color={theme.colors.border.medium} />
                  )}
                </View>
              </TouchableOpacity>
            );
          })}

          </>}
          </>
          )}

        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const makeStyles = (theme: Theme) => StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background.primary },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border.light,
  },
  title: { fontSize: theme.typography.fontSize.xl, fontWeight: theme.typography.fontWeight.bold, color: theme.colors.text.primary },
  busyBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[2],
    backgroundColor: theme.colors.primary[50],
  },
  busyText: { color: theme.colors.primary[500], fontSize: theme.typography.fontSize.sm, fontWeight: theme.typography.fontWeight.semibold }, // [500] not [700]: dark theme only overrides intent ramps at 50/100
  content: { padding: theme.spacing[4], paddingBottom: theme.spacing[10] },
  modeGroup: {
    flexDirection: 'row',
    gap: theme.spacing[2],
    marginBottom: theme.spacing[2],
  },
  modeBtn: {
    flex: 1,
    alignItems: 'center',
    gap: theme.spacing[1],
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[1],
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border.medium,
    backgroundColor: theme.colors.background.secondary,
  },
  modeBtnActive: { borderColor: theme.colors.primary[500], backgroundColor: theme.colors.primary[500] },
  modeBtnLabel: { fontSize: theme.typography.fontSize.xs, fontWeight: theme.typography.fontWeight.semibold, color: theme.colors.text.secondary, textAlign: 'center' },
  modeBtnLabelActive: { color: theme.colors.text.inverse },
  disabledNote: { fontSize: theme.typography.fontSize.xs, color: theme.colors.text.tertiary, fontStyle: 'italic', marginTop: theme.spacing[1], marginBottom: theme.spacing[4] },
  designRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing[3], backgroundColor: theme.colors.surface.primary, borderRadius: theme.borderRadius.md, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border.light, padding: theme.spacing[3.5], marginTop: theme.spacing[3], marginBottom: theme.spacing[4] },
  designLabel: { fontSize: theme.typography.fontSize.base, fontWeight: theme.typography.fontWeight.bold, color: theme.colors.text.primary },
  designHint: { fontSize: theme.typography.fontSize.xs, color: theme.colors.text.tertiary, marginTop: 2 },
  sectionTitle: { fontSize: theme.typography.fontSize.lg, fontWeight: theme.typography.fontWeight.bold, color: theme.colors.text.primary, marginBottom: theme.spacing[1] },
  subSectionTitle: { fontSize: theme.typography.fontSize.sm, fontWeight: theme.typography.fontWeight.bold, color: theme.colors.text.secondary, marginBottom: theme.spacing[2], textTransform: 'uppercase', letterSpacing: 0.5 },
  sectionHint: { fontSize: theme.typography.fontSize.xs, color: theme.colors.text.tertiary, marginBottom: theme.spacing[3], lineHeight: leading(theme.typography.fontSize.xs, theme.typography.lineHeight.normal) },
  modelRight: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing[2] },
  trashBtn: { padding: theme.spacing[1] },
  modelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border.light,
    backgroundColor: theme.colors.surface.primary,
    marginBottom: theme.spacing[2],
  },
  modelRowSelected: { borderColor: theme.colors.primary[500], backgroundColor: theme.colors.primary[50] },
  modelRowDisabled: { opacity: 0.45 },
  modelInfo: { flex: 1, paddingRight: theme.spacing[2] },
  modelLabelRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing[2], flexWrap: 'wrap' },
  modelLabel: { fontSize: theme.typography.fontSize.base, fontWeight: theme.typography.fontWeight.semibold, color: theme.colors.text.primary },
  modelMeta: { fontSize: theme.typography.fontSize.xs, color: theme.colors.text.tertiary, marginTop: 2 },
  recPill: {
    backgroundColor: theme.colors.primary[500],
    borderRadius: theme.borderRadius.full,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 1,
  },
  recPillText: { color: theme.colors.text.inverse, fontSize: 10, fontWeight: theme.typography.fontWeight.bold },

  // Provider chip

  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: theme.spacing[2],
  },
  toggleLabel: { fontSize: theme.typography.fontSize.base, color: theme.colors.text.primary, fontWeight: theme.typography.fontWeight.medium },

  // Scan buttons

  // Paste-pubkey

});
