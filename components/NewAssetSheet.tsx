/**
 * NewAssetSheet — bottom sheet opened by the "+" on the Receive screen.
 * Offers a fresh receive on a new protocol/asset (Spark, Arkade, or a new RGB
 * asset), mirroring rate-extension's "new asset" selection. Options are gated by
 * the protocols that are actually connected. A footer entry opens the full
 * existing-asset picker.
 */
import React from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../theme';
import { NetworkIcon } from './NetworkIcon';
import { RgbIcon } from './ProtocolIcons';

export type NewAssetKind = 'spark' | 'arkade' | 'rgb';

interface NewAssetSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Which protocols are connected/available right now. */
  available: { spark?: boolean; arkade?: boolean; rgb?: boolean };
  onPick: (kind: NewAssetKind) => void;
  /** Open the full existing-asset picker instead. */
  onChooseExisting: () => void;
}

// Per-network leg colours sourced from the shared theme tokens so the sheet's
// accents match the rest of the app (and the web) instead of drifting hexes.
const NETWORK_COLORS = {
  spark: theme.colors.networks.spark,
  arkade: theme.colors.networks.arkade,
  rgb: theme.colors.networks.rgb,
} as const;

export const NewAssetSheet: React.FC<NewAssetSheetProps> = ({
  visible,
  onClose,
  available,
  onPick,
  onChooseExisting,
}) => {
  const options: Array<{
    kind: NewAssetKind;
    title: string;
    subtitle: string;
    icon: React.ReactNode;
    color: string;
    show: boolean;
  }> = [
    {
      kind: 'arkade',
      title: 'New Arkade address',
      subtitle: 'Receive off-chain on Arkade',
      icon: <NetworkIcon network="arkade" size={22} />,
      color: NETWORK_COLORS.arkade,
      show: !!available.arkade,
    },
    {
      kind: 'spark',
      title: 'New Spark address',
      subtitle: 'Receive instantly on Spark',
      icon: <NetworkIcon network="spark" size={22} />,
      color: NETWORK_COLORS.spark,
      show: !!available.spark,
    },
    {
      kind: 'rgb',
      title: 'New RGB address (L1)',
      subtitle: 'On-chain RGB invoice (Layer 1)',
      icon: <RgbIcon size={22} />,
      color: NETWORK_COLORS.rgb,
      show: !!available.rgb,
    },
  ];

  const visibleOptions = options.filter((o) => o.show);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.headerRow}>
            <Text style={styles.title}>Receive new asset</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Ionicons name="close" size={22} color={theme.colors.text.tertiary} />
            </TouchableOpacity>
          </View>

          {visibleOptions.length === 0 ? (
            <Text style={styles.empty}>
              No additional protocols connected. Connect Spark, Arkade or an RGB node in Settings.
            </Text>
          ) : (
            visibleOptions.map((o) => (
              <TouchableOpacity
                key={o.kind}
                style={[styles.option, { borderLeftColor: o.color }]}
                activeOpacity={0.7}
                onPress={() => { onPick(o.kind); onClose(); }}
              >
                <View style={[styles.optionIcon, { backgroundColor: o.color + '1A' }]}>{o.icon}</View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.optionTitle}>{o.title}</Text>
                  <Text style={styles.optionSub}>{o.subtitle}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={theme.colors.text.tertiary} />
              </TouchableOpacity>
            ))
          )}

          <TouchableOpacity
            style={styles.existingBtn}
            activeOpacity={0.7}
            onPress={() => { onChooseExisting(); onClose(); }}
          >
            <Ionicons name="albums-outline" size={18} color={theme.colors.text.secondary} />
            <Text style={styles.existingText}>Choose an existing asset</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: theme.colors.background.backdrop },
  sheet: {
    backgroundColor: theme.colors.surface.primary,
    borderTopLeftRadius: theme.borderRadius.xl,
    borderTopRightRadius: theme.borderRadius.xl,
    paddingHorizontal: theme.spacing[5],
    paddingTop: theme.spacing[2.5],
    paddingBottom: theme.spacing[8],
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: theme.colors.border.medium,
    marginBottom: theme.spacing[3.5],
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: theme.spacing[4],
  },
  title: { fontSize: theme.typography.fontSize.lg, fontWeight: '700', color: theme.colors.text.primary },
  empty: {
    fontSize: theme.typography.fontSize.sm,
    lineHeight: 19,
    color: theme.colors.text.tertiary,
    marginBottom: theme.spacing[2],
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[3],
    padding: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    borderLeftWidth: 3,
    backgroundColor: theme.colors.background.secondary,
    marginBottom: theme.spacing[2.5],
  },
  optionIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionTitle: { fontSize: theme.typography.fontSize.base, fontWeight: '600', color: theme.colors.text.primary },
  optionSub: { fontSize: theme.typography.fontSize.xs, color: theme.colors.text.tertiary, marginTop: 2 },
  existingBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing[2],
    marginTop: theme.spacing[1],
    paddingVertical: 13,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border.medium,
    borderStyle: 'dashed',
  },
  existingText: { fontSize: theme.typography.fontSize.sm, fontWeight: '600', color: theme.colors.text.secondary },
});

export default NewAssetSheet;
