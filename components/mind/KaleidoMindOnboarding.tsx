import React from 'react';
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { theme, leading } from '../../theme';

export interface MindAvailability {
  /** The QVAC worklet can run on this device at all (false on the Simulator). */
  runtimeAvailable: boolean;
  /** This device has enough RAM to run the model locally with good UX. */
  localCapable: boolean;
  /** Total device RAM in GB, for the explanatory copy. */
  deviceMemGb: number;
}

interface Props {
  visible: boolean;
  availability: MindAvailability | null;
  /** Run the model on this device. */
  onSelectLocal: () => void;
  /** Pair with a desktop and delegate inference to it. */
  onSelectDelegate: () => void;
  /** Decide later — keep AI off. */
  onSkip: () => void;
}

interface OptionProps {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle: string;
  badge?: string;
  disabled?: boolean;
  recommended?: boolean;
  onPress: () => void;
}

const Option: React.FC<OptionProps> = ({ icon, title, subtitle, badge, disabled, recommended, onPress }) => (
  <TouchableOpacity
    style={[styles.option, recommended && styles.optionRecommended, disabled && styles.optionDisabled]}
    onPress={onPress}
    disabled={disabled}
    activeOpacity={0.85}
  >
    <View style={[styles.optionIcon, recommended && styles.optionIconRecommended]}>
      <Ionicons name={icon} size={22} color={recommended ? theme.colors.text.inverse : theme.colors.primary[500]} />
    </View>
    <View style={styles.optionBody}>
      <View style={styles.optionTitleRow}>
        <Text style={styles.optionTitle}>{title}</Text>
        {recommended && (
          <View style={styles.recPill}>
            <Text style={styles.recPillText}>Recommended</Text>
          </View>
        )}
        {badge && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{badge}</Text>
          </View>
        )}
      </View>
      <Text style={styles.optionSubtitle}>{subtitle}</Text>
    </View>
    {!disabled && <Ionicons name="chevron-forward" size={18} color={theme.colors.text.tertiary} />}
  </TouchableOpacity>
);

/**
 * One-time KaleidoMind setup. Lets the user decide how the on-device AI runs —
 * locally, delegated to a desktop, or off — and steers away from options the
 * device can't support (so we never boot the worklet where it would crash).
 */
export const KaleidoMindOnboarding: React.FC<Props> = ({
  visible,
  availability,
  onSelectLocal,
  onSelectDelegate,
  onSkip,
}) => {
  const runtimeAvailable = availability?.runtimeAvailable ?? true;
  const localCapable = availability?.localCapable ?? true;
  const localRecommended = runtimeAvailable && localCapable;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onSkip}>
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.hero}>
            <View style={styles.heroIcon}>
              <Ionicons name="sparkles" size={30} color={theme.colors.primary[500]} />
            </View>
            <View style={styles.titleRow}>
              <Text style={styles.title}>Meet KaleidoMind</Text>
              <View style={styles.experimentalBadge}>
                <Text style={styles.experimentalText}>Experimental</Text>
              </View>
            </View>
            <Text style={styles.subtitle}>
              A private AI assistant that can check balances, create invoices and send payments by
              voice or chat — all without your keys leaving the wallet. It's experimental — it can
              make mistakes, so review actions before confirming. Choose how it runs.
            </Text>
          </View>

          {!runtimeAvailable && (
            <View style={styles.notice}>
              <Ionicons name="information-circle" size={18} color={theme.colors.warning[500]} />
              <Text style={styles.noticeText}>
                On-device AI isn’t available here (it needs a physical device). You can connect a
                desktop to use KaleidoMind, or set it up later.
              </Text>
            </View>
          )}

          <Option
            icon="phone-portrait-outline"
            title="Run on this device"
            subtitle={
              runtimeAvailable
                ? localCapable
                  ? 'Fully private — the model runs locally. Downloads ~400 MB on first use.'
                  : `This device has ~${availability?.deviceMemGb ?? '?'} GB RAM; a small model will run but may be slow.`
                : 'Not available on this device.'
            }
            recommended={localRecommended}
            disabled={!runtimeAvailable}
            badge={!runtimeAvailable ? 'Unavailable' : undefined}
            onPress={onSelectLocal}
          />

          <Option
            icon="desktop-outline"
            title="Connect a desktop"
            subtitle="Delegate inference to a paired KaleidoSwap desktop. Your phone stays light; the desktop does the heavy lifting."
            recommended={!localRecommended && runtimeAvailable}
            onPress={onSelectDelegate}
          />

          <Option
            icon="moon-outline"
            title="Not now"
            subtitle="Keep KaleidoMind off. You can turn it on anytime from Settings."
            onPress={onSkip}
          />

          <Text style={styles.footnote}>You can change this later in the KaleidoMind settings.</Text>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background.primary },
  content: { padding: theme.spacing[5], paddingBottom: theme.spacing[10] },
  hero: { alignItems: 'center', marginBottom: theme.spacing[6], marginTop: theme.spacing[4] },
  heroIcon: {
    width: 64,
    height: 64,
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.background.secondary,
    borderWidth: 1,
    borderColor: theme.colors.border.medium,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: theme.spacing[4],
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[2],
    marginBottom: theme.spacing[2],
  },
  title: {
    fontSize: theme.typography.fontSize['2xl'],
    fontWeight: theme.typography.fontWeight.extrabold,
    color: theme.colors.text.primary,
  },
  experimentalBadge: {
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 2,
    borderRadius: theme.borderRadius.full ?? 999,
    backgroundColor: `${theme.colors.warning[500]}22`,
    borderWidth: 1,
    borderColor: `${theme.colors.warning[500]}55`,
  },
  experimentalText: {
    fontSize: theme.typography.fontSize.xs,
    fontWeight: theme.typography.fontWeight.semibold,
    color: theme.colors.warning[500],
  },
  subtitle: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.text.secondary,
    textAlign: 'center',
    lineHeight: leading(theme.typography.fontSize.sm, theme.typography.lineHeight.normal),
  },
  notice: {
    flexDirection: 'row',
    gap: theme.spacing[2],
    backgroundColor: theme.colors.background.secondary,
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.warning[500],
    padding: theme.spacing[3],
    marginBottom: theme.spacing[4],
  },
  noticeText: { flex: 1, fontSize: theme.typography.fontSize.xs, color: theme.colors.text.secondary, lineHeight: leading(theme.typography.fontSize.xs, theme.typography.lineHeight.normal) },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[3],
    backgroundColor: theme.colors.background.secondary,
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border.medium,
    padding: theme.spacing[4],
    marginBottom: theme.spacing[3],
  },
  optionRecommended: { borderColor: theme.colors.primary[500] },
  optionDisabled: { opacity: 0.55 },
  optionIcon: {
    width: 44,
    height: 44,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.background.tertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionIconRecommended: { backgroundColor: theme.colors.primary[500] },
  optionBody: { flex: 1 },
  optionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing[2], marginBottom: 2 },
  optionTitle: { fontSize: theme.typography.fontSize.base, fontWeight: theme.typography.fontWeight.bold, color: theme.colors.text.primary },
  optionSubtitle: { fontSize: theme.typography.fontSize.xs, color: theme.colors.text.tertiary, lineHeight: leading(theme.typography.fontSize.xs, theme.typography.lineHeight.snug) },
  recPill: {
    backgroundColor: theme.colors.primary[500],
    borderRadius: theme.borderRadius.full,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 1,
  },
  recPillText: { fontSize: 10, fontWeight: theme.typography.fontWeight.bold, color: theme.colors.text.inverse }, // dark text on green primary pill (correct contrast)
  badge: {
    backgroundColor: theme.colors.background.tertiary,
    borderRadius: theme.borderRadius.full,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 1,
  },
  badgeText: { fontSize: 10, fontWeight: theme.typography.fontWeight.bold, color: theme.colors.text.tertiary },
  footnote: {
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.text.tertiary,
    textAlign: 'center',
    marginTop: theme.spacing[3],
  },
});

export default KaleidoMindOnboarding;
