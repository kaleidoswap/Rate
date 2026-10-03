// components/receive/BarkBoardingPanel.tsx
//
// Second step of Bark's "Deposit from Bitcoin" in the Receive screen. Funds sent
// to the Bark on-chain address land in Bark's separate on-chain wallet; once
// confirmed they are boarded into Bark (Ark) here, after an explicit review.
// (Arkade settles its boarding address automatically; Bark needs this step.)
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { theme } from '../../theme';
import { Button } from '../Button';
import {
  barkNetworkLabel,
  boardBarkFunds,
  getBarkBoardingTerms,
  readBarkOnchain,
} from '../../services/BarkService';

// The deposit address has no other watcher, so the panel polls while it is open:
// a deposit shows up as pending, then confirmed, without leaving the screen.
const REFRESH_MS = 30_000;

export function BarkBoardingPanel() {
  const [onchain, setOnchain] = useState<{ confirmedSats: number; pendingSats: number } | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try { setOnchain(await readBarkOnchain()); setLoadFailed(false); }
    catch { setLoadFailed(true); } // keep the last balance shown; say it couldn't refresh
    finally { setRefreshing(false); }
  }, []);
  useEffect(() => {
    void load();
    const id = setInterval(() => { void load(); }, REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  const review = async () => {
    const value = Number(amount);
    if (!Number.isSafeInteger(value) || value <= 0) {
      Alert.alert('Board funds', 'Enter a positive whole number of sats.');
      return;
    }
    setBusy(true);
    try {
      const terms = await getBarkBoardingTerms();
      if (value < terms.minBoardAmountSats) throw new Error(`Minimum boarding amount: ${terms.minBoardAmountSats} sats.`);
      Alert.alert(
        'Move on-chain funds into Bark?',
        `${value.toLocaleString()} sats on ${barkNetworkLabel()}. Network fees apply. Bark requires ${terms.requiredConfirmations} confirmations.`,
        [
          { text: 'Cancel', style: 'cancel', onPress: () => setBusy(false) },
          {
            text: 'Board funds',
            onPress: () => {
              void (async () => {
                try {
                  await boardBarkFunds(value);
                  setAmount('');
                  Alert.alert('Boarding submitted', 'It appears in your Bark balance after confirmation.');
                  await load();
                } catch (e) {
                  Alert.alert('Check boarding status', (e as any)?.code === 'PAYMENT_OUTCOME_UNKNOWN'
                    ? 'Boarding may have been submitted. Refresh and check pending boarding before retrying.'
                    : e instanceof Error ? e.message : 'Boarding failed');
                } finally { setBusy(false); }
              })();
            },
          },
        ],
        { cancelable: false },
      );
    } catch (e) {
      setBusy(false);
      Alert.alert('Board funds', e instanceof Error ? e.message : 'Could not read boarding terms');
    }
  };

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Board into Bark</Text>
      <Text style={styles.body}>
        After the deposit confirms, move it into your Bark balance. Leave enough on-chain for fees.
      </Text>
      {onchain === null && !loadFailed ? <ActivityIndicator color={theme.colors.primary[500]} /> : (
        <View style={styles.row}>
          <Text style={[styles.body, styles.flex]}>
            {onchain
              ? `On-chain: ${onchain.confirmedSats.toLocaleString()} sats confirmed · ${onchain.pendingSats.toLocaleString()} pending`
              : 'Could not read the on-chain balance.'}
            {onchain && loadFailed ? ' (could not refresh)' : ''}
          </Text>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Refresh on-chain balance" onPress={() => void load()} disabled={refreshing} hitSlop={8}>
            {refreshing ? <ActivityIndicator size="small" color={theme.colors.primary[500]} /> : <Text style={styles.link}>Refresh</Text>}
          </TouchableOpacity>
        </View>
      )}
      <TextInput
        accessibilityLabel="Boarding amount in sats"
        placeholder="Amount in sats"
        placeholderTextColor={theme.colors.text.tertiary}
        keyboardType="number-pad"
        value={amount}
        onChangeText={setAmount}
        editable={!busy}
        style={styles.input}
      />
      <Button title="Review boarding" onPress={() => void review()} disabled={busy} loading={busy} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: theme.spacing[3],
    padding: theme.spacing[4],
    marginTop: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface.primary,
  },
  title: {
    fontSize: theme.typography.fontSize.base,
    fontWeight: theme.typography.fontWeight.semibold,
    color: theme.colors.text.primary,
  },
  body: { fontSize: theme.typography.fontSize.sm, color: theme.colors.text.secondary },
  row: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing[3] },
  flex: { flex: 1 },
  link: { fontSize: theme.typography.fontSize.sm, color: theme.colors.primary[500], fontWeight: theme.typography.fontWeight.semibold },
  input: {
    color: theme.colors.text.primary,
    padding: theme.spacing[3],
    borderRadius: theme.borderRadius.base,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border.medium,
  },
});

export default BarkBoardingPanel;
