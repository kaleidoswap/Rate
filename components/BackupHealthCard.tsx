import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, StyleProp, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../theme';
import type { BackupHealth } from '../hooks/useBackupHealth';

interface BackupHealthCardProps {
  health: BackupHealth;
  /** Optional "Learn more" / details handler. */
  onLearnMore?: () => void;
  style?: StyleProp<ViewStyle>;
}

/**
 * Honest backup-status surface. Plain Bitcoin is recoverable from the seed; RGB
 * assets and Lightning channels are NOT — they live in node-side state. This
 * card makes that gap loud (Bitcoin Design Guide: clear recovery expectations)
 * rather than implying the seed alone covers everything.
 *
 * Renders nothing when the wallet is fully seed-recoverable (severity 'ok').
 */
export const BackupHealthCard: React.FC<BackupHealthCardProps> = ({ health, onLearnMore, style }) => {
  if (health.severity === 'ok') return null;

  const isWarning = health.severity === 'warning';
  const accent = isWarning ? theme.colors.warning[500] : theme.colors.info[500];

  const parts: string[] = [];
  if (health.rgbAssetsWithBalance > 0) {
    parts.push(
      `${health.rgbAssetsWithBalance} RGB asset${health.rgbAssetsWithBalance === 1 ? '' : 's'} with a balance`,
    );
  }
  if (health.channelCount > 0) {
    parts.push(`${health.channelCount} Lightning channel${health.channelCount === 1 ? '' : 's'}`);
  }
  const atRiskSummary = parts.join(' · ');

  const title = isWarning ? 'Your assets need more than the seed' : 'Backup reminder';
  const body = isWarning
    ? 'Your 12-word phrase restores your Bitcoin, but RGB assets and Lightning channels live in node state — the seed alone cannot recover them. Keep your node data safe and do not wipe it.'
    : 'Your 12-word phrase restores your Bitcoin. Lightning channel state lives in node data and is not recoverable from the seed alone.';

  return (
    <View
      style={[styles.container, { borderColor: accent + '55', backgroundColor: accent + '12' }, style]}
      accessibilityRole="summary"
      accessibilityLabel={`${title}. ${body}${atRiskSummary ? ` At risk: ${atRiskSummary}.` : ''}`}
    >
      <View style={styles.headerRow}>
        <Ionicons
          name={isWarning ? 'warning-outline' : 'shield-half-outline'}
          size={18}
          color={accent}
        />
        <Text style={[styles.title, { color: accent }]}>{title}</Text>
      </View>

      <Text style={styles.body}>{body}</Text>

      {!!atRiskSummary && (
        <Text style={styles.atRisk}>
          At risk on seed-only recovery: <Text style={styles.atRiskStrong}>{atRiskSummary}</Text>
        </Text>
      )}

      {!!onLearnMore && (
        <TouchableOpacity
          onPress={onLearnMore}
          accessibilityRole="button"
          accessibilityLabel="Learn how to protect your assets"
          style={styles.learnMore}
        >
          <Text style={[styles.learnMoreText, { color: accent }]}>How to protect my assets</Text>
          <Ionicons name="chevron-forward" size={14} color={accent} />
        </TouchableOpacity>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    marginHorizontal: 16,
    marginTop: 8,
    gap: 6,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    fontSize: 14,
    fontWeight: '700',
  },
  body: {
    fontSize: 13,
    lineHeight: 18,
    color: theme.colors.text.secondary,
  },
  atRisk: {
    fontSize: 12,
    color: theme.colors.text.tertiary,
    marginTop: 2,
  },
  atRiskStrong: {
    fontWeight: '700',
    color: theme.colors.text.secondary,
  },
  learnMore: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    marginTop: 4,
  },
  learnMoreText: {
    fontSize: 13,
    fontWeight: '600',
  },
});
