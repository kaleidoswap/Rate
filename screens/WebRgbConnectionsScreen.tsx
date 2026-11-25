import React, { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Button, MainHeader } from '../components';
import { useAppLanguage } from '../localization/useAppLanguage';
import { useAppTheme } from '../theme/ThemeProvider';
import {
  disconnectWalletConnect, onWalletConnectChange, restoreWalletConnect, walletConnectError, walletConnectSessions,
} from '../services/webrgb/walletConnect';

type Props = NativeStackScreenProps<{ WebRgbConnections: { pairing?: boolean } | undefined; QRScanner: undefined }, 'WebRgbConnections'>;

export default function WebRgbConnectionsScreen({ navigation, route }: Props) {
  const theme = useAppTheme();
  const { t } = useAppLanguage();
  const [sessions, setSessions] = useState(walletConnectSessions);
  const [error, setError] = useState(walletConnectError);
  const [waiting, setWaiting] = useState(route.params?.pairing === true);
  const [busy, setBusy] = useState('');
  useEffect(() => {
    let mounted = true;
    const refresh = () => {
      const current = walletConnectSessions();
      const problem = walletConnectError();
      setSessions(current);
      setError(problem);
      if (current.length || problem) setWaiting(false);
    };
    const unsubscribe = onWalletConnectChange(refresh);
    refresh();
    void restoreWalletConnect().catch(() => { if (mounted) setError('Could not restore WalletConnect sessions.'); });
    return () => { mounted = false; unsubscribe(); };
  }, []);

  async function disconnect(topic: string) {
    setBusy(topic);
    try { await disconnectWalletConnect(topic); }
    catch { setError('Could not disconnect this app. Try again.'); }
    finally { setBusy(''); }
  }
  return <View style={{ flex: 1, backgroundColor: theme.colors.background.primary }}>
    <MainHeader title={t('Connected apps')} onBack={() => navigation.goBack()} />
    <ScrollView contentContainerStyle={{ padding: theme.spacing[4], gap: theme.spacing[4] }}>
      {!!error && <Text accessibilityRole="alert" style={{ color: theme.colors.error[500] }}>{t(error)}</Text>}
      {!sessions.length && <Text style={{ color: theme.colors.text.secondary }}>{t(waiting && !error
        ? 'Waiting for the app to request a connection.' : 'No WebRGB apps connected.')}</Text>}
      {sessions.map(session => <View key={session.topic} style={{ padding: theme.spacing[4], gap: theme.spacing[2], borderRadius: theme.borderRadius.lg, backgroundColor: theme.colors.surface.primary }}>
        <Text style={{ color: theme.colors.text.primary, fontWeight: 'bold' }}>{session.name}</Text>
        <Text selectable style={{ color: theme.colors.text.secondary }}>{session.url}</Text>
        <Button title={t('Disconnect')} variant="secondary" disabled={!!busy} loading={busy === session.topic} onPress={() => void disconnect(session.topic)} />
      </View>)}
      <Button title={t('Scan WalletConnect QR')} onPress={() => navigation.navigate('QRScanner')} />
    </ScrollView>
  </View>;
}
