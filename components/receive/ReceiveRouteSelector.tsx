import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { theme } from '../../theme';
import type { AccountId } from '../../utils/account-routing';
import { NetworkIcon } from '../NetworkIcon';

interface Props {
  axis: 'method' | 'account';
  accounts: AccountId[];
  selectedAccount: AccountId | null;
  nwcWalletType: 'ln' | 'rln' | null | undefined;
  onAxisChange: (axis: 'method' | 'account') => void;
  onAccountChange: (account: AccountId) => void;
}

export function ReceiveRouteSelector({
  axis,
  accounts,
  selectedAccount,
  nwcWalletType,
  onAxisChange,
  onAccountChange,
}: Props) {
  const accountLabel = (account: AccountId) => {
    if (account === 'RGB') return nwcWalletType === 'ln' ? 'Lightning' : 'RGB + Lightning';
    if (account === 'SPARK') return 'Spark';
    return 'Arkade';
  };
  const accountSubtitle = (account: AccountId) => {
    if (account === 'RGB') return nwcWalletType === 'ln' ? 'Connected over NWC' : 'On-chain and channels';
    if (account === 'SPARK') return 'Native Spark balance';
    return 'Ark and boarding';
  };

  return (
    <View style={styles.card}>
      <View style={styles.tabs}>
        {(['method', 'account'] as const).map((candidate) => {
          const active = axis === candidate;
          return (
            <TouchableOpacity
              key={candidate}
              style={[styles.tab, active && styles.activeTab]}
              onPress={() => onAxisChange(candidate)}
              activeOpacity={0.75}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={candidate === 'method' ? 'Choose deposit by method' : 'Choose deposit by account'}
            >
              <Ionicons
                name={candidate === 'method' ? 'git-branch-outline' : 'wallet-outline'}
                size={16}
                color={active ? theme.colors.primary[500] : theme.colors.text.tertiary}
              />
              <Text style={[styles.tabText, active && styles.activeTabText]}>
                {candidate === 'method' ? 'By method' : 'By account'}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {axis === 'account' && (
        <View style={styles.choices}>
          {accounts.map((account) => {
            const active = selectedAccount === account;
            const iconNetwork = account === 'RGB' ? 'lightning' : account;
            const accent = account === 'RGB'
              ? theme.colors.networks.lightning
              : theme.colors.networks[account.toLowerCase() as 'spark' | 'arkade'];
            return (
              <TouchableOpacity
                key={account}
                style={[styles.choice, active && { borderColor: accent, backgroundColor: `${accent}12` }]}
                onPress={() => onAccountChange(account)}
                activeOpacity={0.75}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={`${accountLabel(account)} account, ${accountSubtitle(account)}`}
              >
                <View style={[styles.glyph, { backgroundColor: `${accent}1A` }]}>
                  <NetworkIcon network={iconNetwork} size={18} />
                </View>
                <View style={styles.choiceText}>
                  <Text style={[styles.choiceLabel, active && { color: accent }]}>{accountLabel(account)}</Text>
                  <Text style={styles.choiceSub} numberOfLines={1}>{accountSubtitle(account)}</Text>
                </View>
                {active && <Ionicons name="checkmark-circle" size={18} color={accent} />}
              </TouchableOpacity>
            );
          })}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: theme.spacing[3], padding: 4 },
  tabs: { flexDirection: 'row', gap: 4 },
  tab: {
    flex: 1,
    minHeight: 40,
    borderRadius: theme.borderRadius.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  activeTab: { backgroundColor: `${theme.colors.primary[500]}14` },
  tabText: { fontSize: theme.typography.fontSize.sm, fontWeight: '600', color: theme.colors.text.tertiary },
  activeTabText: { color: theme.colors.primary[500] },
  choices: { marginTop: theme.spacing[2], gap: theme.spacing[2] },
  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[3],
    minHeight: 54,
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border.light,
    backgroundColor: theme.colors.surface.primary,
  },
  glyph: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  choiceText: { flex: 1, minWidth: 0 },
  choiceLabel: { fontSize: theme.typography.fontSize.sm, fontWeight: '700', color: theme.colors.text.primary },
  choiceSub: { marginTop: 1, fontSize: theme.typography.fontSize.xs, color: theme.colors.text.tertiary },
});
