// components/QVACSettingsSheet.tsx
import React, { useEffect, useState } from 'react';
import {
  Modal,
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
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
}: Props) {
  const [delegateEnabled, setDelegateEnabled] = useState(config.delegateEnabled);
  const [providerKey, setProviderKey] = useState(config.providerPublicKey);

  // Re-sync local form when the sheet (re)opens or config changes
  useEffect(() => {
    setDelegateEnabled(config.delegateEnabled);
    setProviderKey(config.providerPublicKey);
  }, [config.delegateEnabled, config.providerPublicKey, visible]);

  const delegateDirty =
    delegateEnabled !== config.delegateEnabled ||
    providerKey.trim() !== config.providerPublicKey;

  const applyDelegate = () => {
    onSetDelegate({ enabled: delegateEnabled, providerPublicKey: providerKey });
  };

  const busy = llmStatus === 'downloading' || llmStatus === 'loading';

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
          {/* ---- Model selection ---- */}
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
          <Text style={[styles.sectionTitle, { marginTop: theme.spacing[6] }]}>P2P delegation</Text>
          <Text style={styles.sectionHint}>
            Run inference on a remote QVAC provider (e.g. your Mac) instead of on this device.
            Start a provider there and paste its public key here.
          </Text>

          <View style={styles.toggleRow}>
            <Text style={styles.toggleLabel}>Delegate to a provider</Text>
            <Switch
              value={delegateEnabled}
              onValueChange={setDelegateEnabled}
              trackColor={{ true: theme.colors.primary[500], false: theme.colors.border.medium }}
            />
          </View>

          {delegateEnabled && (
            <TextInput
              style={styles.input}
              value={providerKey}
              onChangeText={setProviderKey}
              placeholder="Provider public key (hex)"
              placeholderTextColor={theme.colors.text.tertiary}
              autoCapitalize="none"
              autoCorrect={false}
              multiline
            />
          )}

          <TouchableOpacity
            style={[styles.applyButton, (!delegateDirty || (delegateEnabled && !providerKey.trim())) && styles.applyDisabled]}
            onPress={applyDelegate}
            disabled={!delegateDirty || (delegateEnabled && !providerKey.trim())}
          >
            <Text style={styles.applyText}>Apply & reload model</Text>
          </TouchableOpacity>

          <Text style={styles.note}>
            On a Mac, run a QVAC provider (see scripts/qvac-provider.mjs) — it prints a public key.
            With delegation on, this device won’t download the weights.
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
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: theme.spacing[2],
  },
  toggleLabel: { fontSize: theme.typography.fontSize.base, color: theme.colors.text.primary, fontWeight: '500' },
  input: {
    borderWidth: 1,
    borderColor: theme.colors.border.medium,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing[3],
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.text.primary,
    backgroundColor: theme.colors.surface.primary,
    minHeight: 56,
    marginVertical: theme.spacing[2],
  },
  applyButton: {
    backgroundColor: theme.colors.primary[600],
    borderRadius: theme.borderRadius.md,
    paddingVertical: theme.spacing[3],
    alignItems: 'center',
    marginTop: theme.spacing[2],
  },
  applyDisabled: { opacity: 0.5 },
  applyText: { color: theme.colors.text.inverse, fontWeight: '700', fontSize: theme.typography.fontSize.base },
  note: { fontSize: theme.typography.fontSize.xs, color: theme.colors.text.tertiary, marginTop: theme.spacing[3], lineHeight: 18 },
});
