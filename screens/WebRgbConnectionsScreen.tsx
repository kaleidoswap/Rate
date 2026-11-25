import React, { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Button, MainHeader } from '../components';
import { useAppLanguage } from '../localization/useAppLanguage';
import { useAppTheme } from '../theme/ThemeProvider';
import { currentWebRgbAccount } from '../services/webrgb/account';
import type { ReceiveParams } from '../utils/receive-routes';
import {
  disconnectWebRgb, onWebRgbChange, restoreWebRgb, webRgbError, webRgbSessions,
} from '../services/webrgb/nwc';

type Props = NativeStackScreenProps<{ WebRgbConnections: undefined; QRScanner: undefined; Receive: ReceiveParams }, 'WebRgbConnections'>;

export default function WebRgbConnectionsScreen({ navigation }: Props) {
  const theme = useAppTheme();
  const { t } = useAppLanguage();
  const [sessions, setSessions] = useState(webRgbSessions);
  const [error, setError] = useState(webRgbError);
  const [busy, setBusy] = useState('');
  useEffect(() => {
    let mounted = true;
    const refresh = () => {
      const current = webRgbSessions();
      const problem = webRgbError();
      setSessions(current);
      setError(problem);
    };
    const unsubscribe = onWebRgbChange(refresh);
    refresh();
    void restoreWebRgb().catch(() => { if (mounted) setError('Could not restore NWC connections.'); });
    return () => { mounted = false; unsubscribe(); };
  }, []);

  async function disconnect(topic: string) {
    setBusy(topic);
    try { await disconnectWebRgb(topic); }
    catch { setError('Could not disconnect this app. Try again.'); }
    finally { setBusy(''); }
  }
  function openMintInvoice() {
    try {
      if (currentWebRgbAccount().account.network !== 'signet') {
        setError('Select Signet in Settings → Advanced → RGB → This phone to receive from Utexo Mint.');
        return;
      }
      setError(null);
      navigation.navigate('Receive', { rgbInvoicePreset: 'utexoMint' });
    } catch {
      setError('Select Signet in Settings → Advanced → RGB → This phone to receive from Utexo Mint.');
    }
  }
  return <View style={{ flex: 1, backgroundColor: theme.colors.background.primary }}>
    <MainHeader title={t('Connected apps')} onBack={() => navigation.goBack()} />
    <ScrollView contentContainerStyle={{ padding: theme.spacing[4], gap: theme.spacing[4] }}>
      {!!error && <Text accessibilityRole="alert" style={{ color: theme.colors.error[500] }}>{t(error)}</Text>}
      {!sessions.length && <Text style={{ color: theme.colors.text.secondary }}>{t('No WebRGB apps connected.')}</Text>}
      {sessions.map(session => <View key={session.topic} style={{ padding: theme.spacing[4], gap: theme.spacing[2], borderRadius: theme.borderRadius.lg, backgroundColor: theme.colors.surface.primary }}>
        <Text style={{ color: theme.colors.text.primary, fontWeight: 'bold' }}>{session.name}</Text>
        <Text selectable style={{ color: theme.colors.text.secondary }}>{session.url}</Text>
        <Button title={t('Disconnect')} variant="secondary" disabled={!!busy} loading={busy === session.topic} onPress={() => void disconnect(session.topic)} />
      </View>)}
      <Button title={t('Scan NWC authorization QR')} onPress={() => navigation.navigate('QRScanner')} />
      <Button title={t('Create Utexo Mint invoice')} variant="secondary" onPress={openMintInvoice} />
      <Text style={{ color: theme.colors.text.secondary }}>{t('Choose “Paste invoice” in Utexo Mint to receive on public Signet.')}</Text>
    </ScrollView>
  </View>;
}
