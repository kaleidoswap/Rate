// screens/NWCConnectScreen.tsx
import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Alert } from 'react-native';
import * as SecureStore from 'expo-secure-store';

import { Button, Input, MainHeader } from '../components';
import { theme } from '../theme';
import {
  NWCClient,
  parseNwcUri,
  type NwcGetInfoResult,
} from '../services/nwc/NWCExternalClient';

const STORAGE_KEY = 'nwc_connection_string';

interface Props {
  navigation: any;
}

/**
 * Connect this app to an external NWC (Nostr Wallet Connect) wallet — e.g. the
 * KaleidoSwap desktop hub — by pasting its `nostr+walletconnect://` string.
 * Verifies the connection (info + balance) and can pay a Lightning invoice.
 */
const NWCConnectScreen: React.FC<Props> = ({ navigation }) => {
  const [connectionString, setConnectionString] = useState('');
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(false);
  const [info, setInfo] = useState<NwcGetInfoResult | null>(null);
  const [balanceSats, setBalanceSats] = useState<number | null>(null);

  const [invoice, setInvoice] = useState('');
  const [paying, setPaying] = useState(false);

  useEffect(() => {
    SecureStore.getItemAsync(STORAGE_KEY).then((stored) => {
      if (stored) {
        setConnectionString(stored);
        setSaved(true);
      }
    });
  }, []);

  const handleConnect = async () => {
    const uri = connectionString.trim();
    try {
      parseNwcUri(uri);
    } catch (e) {
      Alert.alert('Invalid connection string', e instanceof Error ? e.message : '');
      return;
    }
    setLoading(true);
    let client: NWCClient | null = null;
    try {
      client = new NWCClient(uri, { timeoutMs: 20_000 });
      const [nodeInfo, balance] = await Promise.all([client.getInfo(), client.getBalance()]);
      setInfo(nodeInfo);
      setBalanceSats(Math.floor(balance.balance / 1000));
      await SecureStore.setItemAsync(STORAGE_KEY, uri);
      setSaved(true);
    } catch (e) {
      Alert.alert('Connection failed', e instanceof Error ? e.message : 'Could not reach the wallet');
    } finally {
      client?.close();
      setLoading(false);
    }
  };

  const handleDisconnect = async () => {
    await SecureStore.deleteItemAsync(STORAGE_KEY);
    setConnectionString('');
    setSaved(false);
    setInfo(null);
    setBalanceSats(null);
    Alert.alert('Disconnected', 'NWC wallet removed');
  };

  const handlePay = async () => {
    const inv = invoice.trim();
    if (!inv) return;
    setPaying(true);
    let client: NWCClient | null = null;
    try {
      client = new NWCClient(connectionString.trim(), { timeoutMs: 90_000 });
      const res = await client.payInvoice({ invoice: inv });
      Alert.alert('Payment sent', `Preimage ${res.preimage.slice(0, 16)}…`);
      setInvoice('');
      const balance = await client.getBalance();
      setBalanceSats(Math.floor(balance.balance / 1000));
    } catch (e) {
      Alert.alert('Payment failed', e instanceof Error ? e.message : '');
    } finally {
      client?.close();
      setPaying(false);
    }
  };

  return (
    <View style={styles.container}>
      <MainHeader title="Nostr Wallet Connect" onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.intro}>
          Paste a connection string from a NWC wallet (e.g. the KaleidoSwap desktop app) to pay and
          check balances through it.
        </Text>

        <Input
          label="Connection string"
          placeholder="nostr+walletconnect://..."
          value={connectionString}
          onChangeText={setConnectionString}
          autoCapitalize="none"
          autoCorrect={false}
          multiline
          editable={!loading}
        />

        <Button
          title={loading ? 'Connecting…' : saved ? 'Reconnect' : 'Connect'}
          onPress={handleConnect}
          disabled={loading || !connectionString.trim()}
          loading={loading}
        />

        {info && balanceSats !== null && (
          <View style={styles.card}>
            <View style={styles.statsRow}>
              <View style={styles.stat}>
                <Text style={styles.statLabel}>Balance</Text>
                <Text style={styles.statValue}>{balanceSats.toLocaleString()} sats</Text>
              </View>
              <View style={styles.stat}>
                <Text style={styles.statLabel}>Network</Text>
                <Text style={styles.statValue}>{info.network ?? '—'}</Text>
              </View>
            </View>

            <Input
              label="Pay a Lightning invoice"
              placeholder="lnbc..."
              value={invoice}
              onChangeText={setInvoice}
              autoCapitalize="none"
              autoCorrect={false}
              multiline
              editable={!paying}
            />
            <Button
              title={paying ? 'Paying…' : 'Pay invoice'}
              onPress={handlePay}
              disabled={paying || !invoice.trim()}
              loading={paying}
            />
          </View>
        )}

        {saved && (
          <View style={styles.disconnect}>
            <Button title="Disconnect wallet" variant="secondary" onPress={handleDisconnect} />
          </View>
        )}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background.primary,
  },
  content: {
    padding: theme.spacing[6],
    gap: theme.spacing[4],
  },
  intro: {
    color: theme.colors.text.secondary,
    fontSize: 14,
    lineHeight: 20,
  },
  card: {
    backgroundColor: theme.colors.surface.primary,
    borderRadius: 16,
    padding: theme.spacing[4],
    gap: theme.spacing[4],
    marginTop: theme.spacing[2],
  },
  statsRow: {
    flexDirection: 'row',
    gap: theme.spacing[4],
  },
  stat: {
    flex: 1,
  },
  statLabel: {
    color: theme.colors.text.muted,
    fontSize: 12,
    marginBottom: 4,
  },
  statValue: {
    color: theme.colors.text.primary,
    fontSize: 16,
    fontWeight: '700',
  },
  disconnect: {
    marginTop: theme.spacing[6],
  },
});

export default NWCConnectScreen;
