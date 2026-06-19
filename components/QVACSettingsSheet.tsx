// components/QVACSettingsSheet.tsx
import React, { useState } from 'react';
import {
  Modal,
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  TextInput,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { theme, leading } from '../theme';
import type { QVACModel, SttModel, TtsOption, TtsEngine } from '../services/qvacModels';
import type { QVACConfig, ModelStatus } from '../services/QVACService';
import type { AiMode } from '../store/slices/settingsSlice';

interface Props {
  visible: boolean;
  onClose: () => void;
  catalog: QVACModel[];
  config: QVACConfig;
  llmStatus: ModelStatus;
  combinedProgress: number;
  onSelectModel: (id: string) => void;
  onSetDelegate: (opts: { enabled: boolean; providerPublicKey: string }) => void;
  /** Open the QR scanner to pair with a desktop provider. */
  onScanQR: () => void;
  /** Forget the paired desktop: clears engine delegation + stored pairing. */
  onDisconnectDesktop?: () => void;
  /** Friendly name of the currently-paired desktop, if any. */
  providerName?: string | null;
  /** Total device RAM in GB (shown next to the model list). */
  deviceMemGb?: number;
  /** Model id recommended for this device — badged in the list. */
  recommendedModelId?: string;
  /** Current KaleidoMind mode: off | local | delegate. */
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
}

/** Extract a 64–66 char hex provider key from pasted text (QR payload or raw). */
function parsePubkey(raw: string): string | null {
  const m = raw.trim().match(/[0-9a-fA-F]{64,66}/);
  return m ? m[0].toLowerCase() : null;
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
  onSetDelegate,
  onScanQR,
  onDisconnectDesktop,
  providerName,
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
}: Props) {
  const busy = llmStatus === 'downloading' || llmStatus === 'loading';
  const hasProvider = !!config.providerPublicKey;
  const isDownloaded = (id: string) => downloadedModelIds.includes(id);

  const confirmDisconnect = () => {
    Alert.alert(
      'Disconnect desktop?',
      `Forget “${providerName || 'this desktop'}” and stop delegating to it? KaleidoMind will switch back to running on this device. You can pair again anytime.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Disconnect', style: 'destructive', onPress: () => onDisconnectDesktop?.() },
      ]
    );
  };

  const confirmDelete = (id: string, label: string) => {
    Alert.alert(
      'Delete model?',
      `Remove “${label}” from this device? You can download it again later.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => onDeleteModel(id) },
      ]
    );
  };

  // Paste-a-pubkey delegation (alternative to scanning the QR).
  const [showPaste, setShowPaste] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const pastedKey = parsePubkey(pasteText);
  const pasteInvalid = pasteText.trim().length > 0 && !pastedKey;

  const shortKey = hasProvider
    ? `${config.providerPublicKey.slice(0, 10)}…${config.providerPublicKey.slice(-6)}`
    : '';

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <Text style={styles.title}>AI Settings</Text>
          <TouchableOpacity onPress={onClose} hitSlop={10}>
            <Ionicons name="close" size={26} color={theme.colors.text.primary} />
          </TouchableOpacity>
        </View>

        {busy && (
          <View style={styles.busyBar}>
            <ActivityIndicator size="small" color={theme.colors.primary[500]} />
            <Text style={styles.busyText}>
              {llmStatus === 'downloading' ? `Downloading model… ${combinedProgress}%` : 'Loading model…'}
            </Text>
          </View>
        )}

        <ScrollView contentContainerStyle={styles.content}>
          {/* ---- KaleidoMind mode ---- */}
          <Text style={styles.sectionTitle}>KaleidoMind</Text>
          <Text style={styles.sectionHint}>
            Choose how the assistant runs. You can change this anytime.
          </Text>
          <View style={styles.modeGroup}>
            {([
              { key: 'off', icon: 'moon-outline', label: 'Off' },
              { key: 'local', icon: 'phone-portrait-outline', label: 'On this device' },
              { key: 'delegate', icon: 'desktop-outline', label: 'Desktop' },
            ] as { key: AiMode; icon: keyof typeof Ionicons.glyphMap; label: string }[]).map((m) => {
              const active = aiMode === m.key;
              return (
                <TouchableOpacity
                  key={m.key}
                  style={[styles.modeBtn, active && styles.modeBtnActive]}
                  onPress={() => onSetAiMode(m.key)}
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
            <TouchableOpacity style={styles.designRow} onPress={onDesignAgent} activeOpacity={0.85}>
              <Ionicons name="construct-outline" size={18} color={theme.colors.primary[500]} />
              <View style={{ flex: 1 }}>
                <Text style={styles.designLabel}>Design your agent</Text>
                <Text style={styles.designHint}>Personality, connectors, context & memory</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={theme.colors.text.tertiary} />
            </TouchableOpacity>
          )}

          {aiMode === 'off' && (
            <Text style={styles.disabledNote}>
              KaleidoMind is off. Pick “On this device” or “Desktop” to use it.
            </Text>
          )}
          {aiMode === 'delegate' && (
            <Text style={styles.disabledNote}>
              {hasProvider
                ? `Delegating to ${providerName || 'your desktop'}. Use “Disconnect this desktop” below to unpair.`
                : 'No desktop connected yet — scan the pairing QR, or switch to “Off”.'}
            </Text>
          )}

          {/* ---- Model picker (on-device mode only; Desktop shows connection only) ---- */}
          {aiMode === 'local' && (
          <>
          <Text style={styles.sectionTitle}>On-device model</Text>
          <Text style={styles.sectionHint}>
            {deviceMemGb
              ? `Your device has ~${deviceMemGb} GB RAM. The recommended model fits it best; smaller models run faster.`
              : 'Smaller models run on a phone; larger ones need a desktop.'}
          </Text>

          {catalog.filter((m) => m.localCapable).map((m) => {
            const selected = m.id === config.modelId;
            const recommended = m.id === recommendedModelId;
            return (
              <TouchableOpacity
                key={m.id}
                style={[styles.modelRow, selected && styles.modelRowSelected]}
                onPress={() => onSelectModel(m.id)}
              >
                <View style={styles.modelInfo}>
                  <View style={styles.modelLabelRow}>
                    <Text style={styles.modelLabel}>
                      {m.label}
                      {m.supportsTools ? '  🛠' : ''}
                    </Text>
                    {recommended && (
                      <View style={styles.recPill}>
                        <Text style={styles.recPillText}>Recommended</Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.modelMeta}>
                    {m.params} · {(m.sizeMB / 1024).toFixed(m.sizeMB < 1024 ? 0 : 1)}
                    {m.sizeMB < 1024 ? ` MB` : ` GB`} · {TIER_LABEL[m.tier]}
                    {isDownloaded(m.id) ? ' · ✓ Downloaded' : ''}
                  </Text>
                </View>
                <View style={styles.modelRight}>
                  {isDownloaded(m.id) && !(selected && busy) && (
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
          {aiMode === 'local' && (
          <>
          <Text style={[styles.sectionTitle, { marginTop: theme.spacing[6] }]}>Voice mode</Text>
          <Text style={styles.sectionHint}>
            Speech recognition and the spoken reply run on-device.
          </Text>

          <Text style={styles.subSectionTitle}>Speech-to-text (Whisper)</Text>
          {sttCatalog.map((s) => {
            const selected = s.id === config.sttModelId;
            return (
              <TouchableOpacity
                key={s.id}
                style={[styles.modelRow, selected && styles.modelRowSelected]}
                onPress={() => onSetSttModel(s.id)}
              >
                <View style={styles.modelInfo}>
                  <Text style={styles.modelLabel}>{s.label}</Text>
                  <Text style={styles.modelMeta}>
                    {s.lang === 'en' ? 'English only' : 'Multilingual'} · {s.sizeMB} MB
                    {isDownloaded(s.id) ? ' · ✓ Downloaded' : ''}
                  </Text>
                </View>
                <View style={styles.modelRight}>
                  {isDownloaded(s.id) && (
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

          <Text style={[styles.subSectionTitle, { marginTop: theme.spacing[4] }]}>Voice output</Text>
          {ttsOptions.map((t) => {
            const selected = t.id === config.ttsEngine;
            return (
              <TouchableOpacity
                key={t.id}
                style={[styles.modelRow, selected && styles.modelRowSelected]}
                onPress={() => onSetTtsEngine(t.id)}
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
          </>
          )}

          {/* ---- Desktop pairing (only in Desktop mode) ---- */}
          {aiMode === 'delegate' && (
          <>
          <Text style={[styles.sectionTitle, { marginTop: theme.spacing[6] }]}>Connect a desktop</Text>
          <Text style={styles.sectionHint}>
            Inference runs on a Mac/PC running KaleidoMind. Selecting “Desktop” above is what enables delegation.
          </Text>

          {hasProvider ? (
            <>
              <View style={styles.providerChip}>
                <View style={[styles.dot, config.delegateEnabled ? styles.dotOn : styles.dotOff]} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.providerName} numberOfLines={1}>
                    {providerName || 'Desktop provider'}
                  </Text>
                  <Text style={styles.providerKey}>{shortKey}</Text>
                </View>
                <View style={styles.activePill}>
                  <Text style={styles.activePillText}>{config.delegateEnabled ? 'Active' : 'Paired'}</Text>
                </View>
              </View>

              <TouchableOpacity style={styles.scanButtonGhost} onPress={onScanQR}>
                <Ionicons name="qr-code-outline" size={18} color={theme.colors.primary[500]} />
                <Text style={styles.scanGhostText}>Scan a different desktop</Text>
              </TouchableOpacity>

              {onDisconnectDesktop && (
                <TouchableOpacity style={styles.disconnectButton} onPress={confirmDisconnect}>
                  <Ionicons name="unlink-outline" size={18} color={theme.colors.error[500]} />
                  <Text style={styles.disconnectText}>Disconnect this desktop</Text>
                </TouchableOpacity>
              )}
            </>
          ) : (
            <TouchableOpacity style={styles.scanButtonPrimary} onPress={onScanQR}>
              <Ionicons name="qr-code-outline" size={20} color={theme.colors.text.inverse} />
              <Text style={styles.scanPrimaryText}>Scan QR from desktop</Text>
            </TouchableOpacity>
          )}

          {/* Paste a public key instead of scanning */}
          <TouchableOpacity
            style={styles.pasteToggle}
            onPress={() => setShowPaste((v) => !v)}
            hitSlop={8}
          >
            <Ionicons
              name={showPaste ? 'chevron-down' : 'chevron-forward'}
              size={16}
              color={theme.colors.text.secondary}
            />
            <Text style={styles.pasteToggleText}>Or paste the desktop public key</Text>
          </TouchableOpacity>

          {showPaste && (
            <View>
              <TextInput
                style={[styles.pasteInput, pasteInvalid && styles.pasteInputError]}
                value={pasteText}
                onChangeText={setPasteText}
                placeholder="Paste the 64-char hex public key"
                placeholderTextColor={theme.colors.text.tertiary}
                autoCapitalize="none"
                autoCorrect={false}
                multiline
              />
              {pasteInvalid && (
                <Text style={styles.pasteError}>That doesn't look like a public key (need 64 hex chars).</Text>
              )}
              <TouchableOpacity
                style={[styles.useKeyButton, !pastedKey && styles.useKeyButtonDisabled]}
                disabled={!pastedKey}
                onPress={() => {
                  if (!pastedKey) return;
                  onSetDelegate({ enabled: true, providerPublicKey: pastedKey });
                  setPasteText('');
                  setShowPaste(false);
                }}
              >
                <Ionicons name="link-outline" size={18} color={theme.colors.text.inverse} />
                <Text style={styles.useKeyText}>Use this key &amp; delegate</Text>
              </TouchableOpacity>
            </View>
          )}

          <Text style={styles.note}>
            On your Mac, open KaleidoMind → Pair to show the QR (or copy the public key).
            Scan it, or paste the key above.
          </Text>
          </>
          )}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
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
  providerChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[3],
    padding: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border.light,
    backgroundColor: theme.colors.surface.primary,
    marginBottom: theme.spacing[2],
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
  dotOn: { backgroundColor: theme.colors.success[500] },
  dotOff: { backgroundColor: theme.colors.border.medium },
  providerName: { fontSize: theme.typography.fontSize.base, fontWeight: theme.typography.fontWeight.semibold, color: theme.colors.text.primary },
  providerKey: { fontSize: theme.typography.fontSize.xs, color: theme.colors.text.tertiary, marginTop: 2, fontFamily: 'Courier' },
  activePill: {
    backgroundColor: theme.colors.success[500],
    borderRadius: theme.borderRadius.full,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 2,
  },
  activePillText: { color: theme.colors.text.inverse, fontSize: 11, fontWeight: theme.typography.fontWeight.bold },

  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: theme.spacing[2],
  },
  toggleLabel: { fontSize: theme.typography.fontSize.base, color: theme.colors.text.primary, fontWeight: theme.typography.fontWeight.medium },

  // Scan buttons
  scanButtonPrimary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing[2],
    backgroundColor: theme.colors.primary[500], // [500] not [600]: dark theme only overrides intent ramps at 50/100
    borderRadius: theme.borderRadius.md,
    paddingVertical: theme.spacing[3],
    marginTop: theme.spacing[1],
  },
  scanPrimaryText: { color: theme.colors.text.inverse, fontWeight: theme.typography.fontWeight.bold, fontSize: theme.typography.fontSize.base },
  scanButtonGhost: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.primary[500],
    paddingVertical: theme.spacing[3],
    marginTop: theme.spacing[1],
  },
  scanGhostText: { color: theme.colors.primary[500], fontWeight: theme.typography.fontWeight.semibold, fontSize: theme.typography.fontSize.sm }, // [500] not [600] for dark-bg visibility
  disconnectButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.error[500],
    paddingVertical: theme.spacing[3],
    marginTop: theme.spacing[2],
  },
  disconnectText: { color: theme.colors.error[500], fontWeight: theme.typography.fontWeight.semibold, fontSize: theme.typography.fontSize.sm },

  // Paste-pubkey
  pasteToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[1],
    marginTop: theme.spacing[3],
    paddingVertical: theme.spacing[1],
  },
  pasteToggleText: { color: theme.colors.text.secondary, fontSize: theme.typography.fontSize.sm, fontWeight: theme.typography.fontWeight.semibold },
  pasteInput: {
    borderWidth: 1,
    borderColor: theme.colors.border.medium,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing[3],
    marginTop: theme.spacing[2],
    minHeight: 56,
    color: theme.colors.text.primary,
    fontFamily: 'Courier',
    fontSize: theme.typography.fontSize.xs,
    backgroundColor: theme.colors.surface.primary,
  },
  pasteInputError: { borderColor: theme.colors.error[500] },
  pasteError: { color: theme.colors.error[500], fontSize: theme.typography.fontSize.xs, marginTop: theme.spacing[1] },
  useKeyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing[2],
    backgroundColor: theme.colors.primary[500], // [500] not [600]: dark theme only overrides intent ramps at 50/100
    borderRadius: theme.borderRadius.md,
    paddingVertical: theme.spacing[3],
    marginTop: theme.spacing[2],
  },
  useKeyButtonDisabled: { opacity: 0.4 },
  useKeyText: { color: theme.colors.text.inverse, fontWeight: theme.typography.fontWeight.bold, fontSize: theme.typography.fontSize.base },

  note: { fontSize: theme.typography.fontSize.xs, color: theme.colors.text.tertiary, marginTop: theme.spacing[3], lineHeight: leading(theme.typography.fontSize.xs, theme.typography.lineHeight.normal) },
});
