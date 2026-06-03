// components/QVACSettingsSheet.tsx
import React from 'react';
import {
  Modal,
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Switch,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../theme';
import type { QVACModel } from '../services/qvacModels';
import type { QVACConfig, ModelStatus } from '../services/QVACService';

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
  /** Friendly name of the currently-paired desktop, if any. */
  providerName?: string | null;
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
  providerName,
}: Props) {
  const busy = llmStatus === 'downloading' || llmStatus === 'loading';
  const hasProvider = !!config.providerPublicKey;

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
            <ActivityIndicator size="small" color={theme.colors.primary[600]} />
            <Text style={styles.busyText}>
              {llmStatus === 'downloading' ? `Downloading model… ${combinedProgress}%` : 'Loading model…'}
            </Text>
          </View>
        )}

        <ScrollView contentContainerStyle={styles.content}>
          {/* ---- On-device model ---- */}
          <Text style={styles.sectionTitle}>On-device model</Text>
          <Text style={styles.sectionHint}>
            Smaller models run on a phone; larger ones need a Mac or P2P delegation.
          </Text>

          {catalog.map((m) => {
            const selected = m.id === config.modelId;
            const delegateOnly = !m.localCapable;
            const disabled = delegateOnly && !config.delegateEnabled;
            return (
              <TouchableOpacity
                key={m.id}
                style={[styles.modelRow, selected && styles.modelRowSelected, disabled && styles.modelRowDisabled]}
                onPress={() => !disabled && onSelectModel(m.id)}
                disabled={disabled}
              >
                <View style={styles.modelInfo}>
                  <Text style={styles.modelLabel}>
                    {m.label}
                    {m.supportsTools ? '  🛠' : ''}
                  </Text>
                  <Text style={styles.modelMeta}>
                    {m.params} · {(m.sizeMB / 1024).toFixed(m.sizeMB < 1024 ? 0 : 1)}
                    {m.sizeMB < 1024 ? ` MB` : ` GB`} · {TIER_LABEL[m.tier]}
                    {delegateOnly ? ' · P2P only' : ''}
                  </Text>
                </View>
                {selected ? (
                  <Ionicons name="checkmark-circle" size={22} color={theme.colors.primary[600]} />
                ) : (
                  <Ionicons name="ellipse-outline" size={22} color={theme.colors.border.medium} />
                )}
              </TouchableOpacity>
            );
          })}

          {/* ---- P2P delegation ---- */}
          <Text style={[styles.sectionTitle, { marginTop: theme.spacing[6] }]}>Desktop brain (P2P)</Text>
          <Text style={styles.sectionHint}>
            Run inference on a desktop running KaleidoMind instead of on this device.
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
                {config.delegateEnabled && (
                  <View style={styles.activePill}>
                    <Text style={styles.activePillText}>Active</Text>
                  </View>
                )}
              </View>

              <View style={styles.toggleRow}>
                <Text style={styles.toggleLabel}>Delegate to this desktop</Text>
                <Switch
                  value={config.delegateEnabled}
                  onValueChange={(v) =>
                    onSetDelegate({ enabled: v, providerPublicKey: config.providerPublicKey })
                  }
                  trackColor={{ true: theme.colors.primary[500], false: theme.colors.border.medium }}
                />
              </View>

              <TouchableOpacity style={styles.scanButtonGhost} onPress={onScanQR}>
                <Ionicons name="qr-code-outline" size={18} color={theme.colors.primary[600]} />
                <Text style={styles.scanGhostText}>Scan a different desktop</Text>
              </TouchableOpacity>
            </>
          ) : (
            <TouchableOpacity style={styles.scanButtonPrimary} onPress={onScanQR}>
              <Ionicons name="qr-code-outline" size={20} color={theme.colors.text.inverse} />
              <Text style={styles.scanPrimaryText}>Scan QR from desktop</Text>
            </TouchableOpacity>
          )}

          <Text style={styles.note}>
            On your Mac, open KaleidoMind → Pair and scan the QR shown there. No typing needed.
          </Text>
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
  title: { fontSize: theme.typography.fontSize.xl, fontWeight: '700', color: theme.colors.text.primary },
  busyBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[2],
    backgroundColor: theme.colors.primary[50],
  },
  busyText: { color: theme.colors.primary[700], fontSize: theme.typography.fontSize.sm, fontWeight: '600' },
  content: { padding: theme.spacing[4], paddingBottom: theme.spacing[10] },
  sectionTitle: { fontSize: theme.typography.fontSize.lg, fontWeight: '700', color: theme.colors.text.primary, marginBottom: theme.spacing[1] },
  sectionHint: { fontSize: theme.typography.fontSize.xs, color: theme.colors.text.tertiary, marginBottom: theme.spacing[3], lineHeight: 18 },
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
  modelLabel: { fontSize: theme.typography.fontSize.base, fontWeight: '600', color: theme.colors.text.primary },
  modelMeta: { fontSize: theme.typography.fontSize.xs, color: theme.colors.text.tertiary, marginTop: 2 },

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
  providerName: { fontSize: theme.typography.fontSize.base, fontWeight: '600', color: theme.colors.text.primary },
  providerKey: { fontSize: theme.typography.fontSize.xs, color: theme.colors.text.tertiary, marginTop: 2, fontFamily: 'Courier' },
  activePill: {
    backgroundColor: theme.colors.success[500],
    borderRadius: 999,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 2,
  },
  activePillText: { color: theme.colors.text.inverse, fontSize: 11, fontWeight: '700' },

  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: theme.spacing[2],
  },
  toggleLabel: { fontSize: theme.typography.fontSize.base, color: theme.colors.text.primary, fontWeight: '500' },

  // Scan buttons
  scanButtonPrimary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing[2],
    backgroundColor: theme.colors.primary[600],
    borderRadius: theme.borderRadius.md,
    paddingVertical: theme.spacing[3],
    marginTop: theme.spacing[1],
  },
  scanPrimaryText: { color: theme.colors.text.inverse, fontWeight: '700', fontSize: theme.typography.fontSize.base },
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
  scanGhostText: { color: theme.colors.primary[600], fontWeight: '600', fontSize: theme.typography.fontSize.sm },
  note: { fontSize: theme.typography.fontSize.xs, color: theme.colors.text.tertiary, marginTop: theme.spacing[3], lineHeight: 18 },
});
