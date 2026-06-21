// screens/NostrSettingsScreen.tsx
//
// Dedicated home for everything Nostr: identity/keys, profile, relays
// (all via NostrProfileManager) plus a link to connect an external Lightning
// wallet (NWC). Broken out of the main Settings screen so social settings have
// their own space.
import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useSelector } from 'react-redux';
import { Ionicons } from '@expo/vector-icons';
import { RootState } from '../store';
import { theme } from '../theme';
import { ScreenHeader } from '../components';
import NostrProfileManager from '../components/NostrProfileManager';

interface Props {
  navigation: any;
}

export default function NostrSettingsScreen({ navigation }: Props) {
  const nostrState = useSelector((state: RootState) => state.nostr);
  const connected = !!nostrState.connectedWallet;
  const typeLabel =
    nostrState.nwcWalletType === 'rln' ? 'RGB Lightning Node' : connected ? 'Lightning wallet' : null;

  return (
    <View style={styles.container}>
      <ScreenHeader title="Nostr" showBack />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Identity, profile, keys & relays */}
        <NostrProfileManager navigation={navigation} />

        {/* Wallet Connect — connect an external Lightning wallet (client) */}
        <Text style={styles.sectionLabel}>Wallet Connect</Text>
        <View style={styles.card}>
          <TouchableOpacity
            style={styles.row}
            activeOpacity={0.7}
            onPress={() => navigation.navigate('NWCConnect')}
          >
            <View style={[styles.rowIcon, { backgroundColor: theme.colors.warning[50] }]}>
              <Ionicons name="flash-outline" size={18} color={theme.colors.warning[500]} />
            </View>
            <View style={styles.rowText}>
              <Text style={styles.rowLabel}>Connect a Lightning wallet</Text>
              <Text style={styles.rowDescription}>
                {connected ? `Connected · ${typeLabel}` : 'Pay & check balances via NWC'}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={theme.colors.text.tertiary} />
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background.secondary,
  },
  scroll: {
    flex: 1,
  },
  content: {
    padding: theme.spacing[4],
    paddingBottom: theme.spacing[10],
  },
  sectionLabel: {
    fontSize: theme.typography.fontSize.xs,
    fontWeight: '700',
    color: theme.colors.text.tertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: theme.spacing[5],
    marginBottom: theme.spacing[2],
    marginLeft: theme.spacing[1],
  },
  card: {
    backgroundColor: theme.colors.surface.primary,
    borderRadius: theme.borderRadius.xl,
    borderWidth: 1,
    borderColor: theme.colors.border.light,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: theme.spacing[4],
    gap: theme.spacing[3],
  },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: theme.borderRadius.base,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: {
    flex: 1,
  },
  rowLabel: {
    fontSize: theme.typography.fontSize.base,
    fontWeight: '600',
    color: theme.colors.text.primary,
  },
  rowDescription: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.text.tertiary,
    marginTop: 2,
  },
});
