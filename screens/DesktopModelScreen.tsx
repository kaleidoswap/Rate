// Settings → KaleidoMind → Desktop model: pair with the KaleidoSwap desktop
// app and run the assistant's model there. Tools and confirmations stay here.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Switch, Pressable, Alert, TextInput } from 'react-native';
import { useDispatch, useSelector } from 'react-redux';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../theme';
import { ScreenHeader, Button, Callout, Sheet } from '../components';
import { selectMindConfig, setMindConfig } from '../store/slices/settingsSlice';
import {
  DEFAULT_DESKTOP_PORT,
  PairingError,
  describeHealthFailure,
  forgetPairing,
  loadPairing,
  parsePairingPayload,
  refreshDesktopHealth,
  savePairing,
  validatePairing,
  type DesktopPairing,
} from '../services/desktopModel';
import { useDesktopModelStatus } from '../hooks/useDesktopModelStatus';

export const DESKTOP_PRIVACY_TEXT =
  'Your messages, and wallet details the assistant adds to them such as balances and addresses, ' +
  'are sent to the paired desktop over your local network without encryption. Anyone on the same ' +
  'network could read them. Only use this on a network you trust. Payments and other actions still ' +
  'run on this phone and still ask you to confirm.';

const isLoopback = (host: string) => host === 'localhost' || host.startsWith('127.');

interface Props {
  navigation: any;
  route?: { params?: { scannedPairing?: string } };
}

export default function DesktopModelScreen({ navigation, route }: Props) {
  const dispatch = useDispatch();
  const cfg = useSelector(selectMindConfig);
  const status = useDesktopModelStatus();
  const [pairing, setPairing] = useState<DesktopPairing | null>(null);
  const [manualOpen, setManualOpen] = useState(false);

  useEffect(() => {
    let active = true;
    loadPairing().then((p) => {
      if (!active) return;
      setPairing(p);
      if (p) void refreshDesktopHealth({ force: true });
    });
    return () => { active = false; };
  }, []);

  const pair = useCallback(async (p: DesktopPairing) => {
    await savePairing(p);
    setPairing(p);
    setManualOpen(false);
    void refreshDesktopHealth({ force: true });
  }, []);

  const scanned = route?.params?.scannedPairing;
  useEffect(() => {
    if (!scanned) return;
    navigation.setParams?.({ scannedPairing: undefined });
    let p: DesktopPairing;
    try {
      p = parsePairingPayload(scanned);
    } catch (e) {
      Alert.alert('Pairing failed', e instanceof PairingError ? e.message : 'This pairing code could not be read.');
      return;
    }
    Alert.alert(
      'Pair with this desktop?',
      `${p.name ?? 'KaleidoSwap Desktop'} at ${p.host}:${p.port}${p.model ? `\nModel: ${p.model}` : ''}`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Pair', onPress: () => { pair(p).catch(() => Alert.alert('Pairing failed', 'Could not save the pairing on this phone.')); } },
      ],
    );
  }, [scanned, navigation, pair]);

  const setEnabled = (on: boolean) => {
    if (!on) {
      dispatch(setMindConfig({ useDesktopModel: false }));
      return;
    }
    Alert.alert('Use desktop model?', DESKTOP_PRIVACY_TEXT, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Use desktop model',
        onPress: () => {
          dispatch(setMindConfig({ useDesktopModel: true }));
          void refreshDesktopHealth({ force: true });
        },
      },
    ]);
  };

  const forget = () =>
    Alert.alert('Forget desktop', 'This removes the address and token from this phone. The assistant goes back to the on-device model.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Forget',
        style: 'destructive',
        onPress: async () => {
          dispatch(setMindConfig({ useDesktopModel: false }));
          await forgetPairing().catch(() => {});
          setPairing(null);
        },
      },
    ]);

  const statusLine = (() => {
    if (!pairing) return null;
    switch (status.state) {
      case 'connected':
        return { tone: theme.colors.success[500], text: `Connected · ${status.modelId}` };
      case 'checking':
        return { tone: theme.colors.text.secondary, text: 'Checking the desktop…' };
      case 'fallback':
        return {
          tone: theme.colors.warning[500],
          text: status.reason === 'error' ? 'The desktop stopped answering.' : describeHealthFailure(status.reason),
        };
      default:
        return { tone: theme.colors.text.secondary, text: 'Not checked yet' };
    }
  })();

  return (
    <View style={styles.container}>
      <ScreenHeader title="Desktop model" subtitle="Run the assistant on your computer" showBack />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.intro}>
          Pair with the KaleidoSwap desktop app to use the bigger model it runs. Only the model runs on the
          desktop: your keys, tools and skills stay on this phone. If the desktop can't be reached, the
          assistant uses the on-device model.
        </Text>

        <Callout tone="warning" title="Not encrypted" message={DESKTOP_PRIVACY_TEXT} style={styles.callout} />

        <View style={styles.card}>
          <View style={styles.toggleRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowLabel}>Use desktop model</Text>
              <Text style={styles.rowDesc}>{pairing ? 'Off by default.' : 'Pair a desktop first.'}</Text>
            </View>
            <Switch
              accessibilityLabel="Use desktop model"
              value={!!pairing && cfg.useDesktopModel}
              disabled={!pairing}
              onValueChange={setEnabled}
              trackColor={{ true: theme.colors.primary[500], false: theme.colors.border.light }}
              thumbColor="#fff"
            />
          </View>

          {pairing && (
            <View style={styles.details}>
              <Detail label="Desktop" value={pairing.name ?? 'KaleidoSwap Desktop'} />
              <Detail label="Address" value={`${pairing.host}:${pairing.port}`} />
              <Detail label="Model" value={status.state === 'connected' ? status.modelId : pairing.model ?? 'Unknown'} />
              {statusLine && <Text style={[styles.status, { color: statusLine.tone }]}>{statusLine.text}</Text>}
            </View>
          )}
        </View>

        {pairing && isLoopback(pairing.host) && (
          <Callout
            tone="info"
            message="This address only works on the desktop itself. On the desktop, turn on Allow devices on my local network and scan the new code."
            style={styles.callout}
          />
        )}

        <View style={styles.actions}>
          <Button
            title={pairing ? 'Scan a new pairing QR' : 'Scan pairing QR'}
            icon={<Ionicons name="qr-code-outline" size={18} color="#fff" />}
            onPress={() => navigation.navigate('QRScanner', { mode: 'pairing' })}
            fullWidth
          />
          <Button title="Enter manually" variant="secondary" onPress={() => setManualOpen(true)} fullWidth />
          {pairing && (
            <Button title="Test connection" variant="ghost" onPress={() => void refreshDesktopHealth({ force: true })} fullWidth />
          )}
        </View>

        {pairing && (
          <Pressable style={styles.dangerRow} onPress={forget} accessibilityRole="button">
            <Ionicons name="trash-outline" size={18} color={theme.colors.error[500]} />
            <Text style={styles.dangerText}>Forget desktop</Text>
          </Pressable>
        )}
        <View style={{ height: 32 }} />
      </ScrollView>

      <ManualPairingSheet visible={manualOpen} onClose={() => setManualOpen(false)} onPair={pair} />
    </View>
  );
}

const Detail: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <View style={styles.detailRow}>
    <Text style={styles.detailLabel}>{label}</Text>
    <Text style={styles.detailValue} numberOfLines={1}>{value}</Text>
  </View>
);

const ManualPairingSheet: React.FC<{
  visible: boolean;
  onClose: () => void;
  onPair: (p: DesktopPairing) => Promise<void>;
}> = ({ visible, onClose, onPair }) => {
  const [host, setHost] = useState('');
  const [port, setPort] = useState(String(DEFAULT_DESKTOP_PORT));
  const [token, setToken] = useState('');
  const [error, setError] = useState('');

  const submit = async () => {
    setError('');
    try {
      await onPair(validatePairing({ host, port, token }));
      setHost(''); setPort(String(DEFAULT_DESKTOP_PORT)); setToken('');
    } catch (e) {
      setError(e instanceof PairingError ? e.message : 'Could not save the pairing on this phone.');
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="Enter desktop details" subtitle="Shown under the QR code in the desktop app.">
      <TextInput style={styles.input} value={host} onChangeText={setHost} placeholder="Address, e.g. 192.168.1.20" placeholderTextColor={theme.colors.text.tertiary} autoCapitalize="none" autoCorrect={false} keyboardType="url" />
      <TextInput style={styles.input} value={port} onChangeText={setPort} placeholder="Port" placeholderTextColor={theme.colors.text.tertiary} keyboardType="number-pad" />
      <TextInput style={styles.input} value={token} onChangeText={setToken} placeholder="Token" placeholderTextColor={theme.colors.text.tertiary} autoCapitalize="none" autoCorrect={false} secureTextEntry />
      {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
      <Button title="Pair" onPress={() => void submit()} disabled={!host.trim() || !token.trim()} fullWidth />
    </Sheet>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background.primary },
  content: { padding: theme.spacing[4], gap: theme.spacing[4] },
  intro: { color: theme.colors.text.secondary, fontSize: theme.typography.fontSize.sm },
  callout: { marginBottom: 0 },
  card: { backgroundColor: theme.colors.surface.primary, borderRadius: theme.borderRadius.md, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border.light, padding: theme.spacing[3.5] },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing[3] },
  rowLabel: { color: theme.colors.text.primary, fontSize: theme.typography.fontSize.sm, fontWeight: theme.typography.fontWeight.semibold },
  rowDesc: { color: theme.colors.text.tertiary, fontSize: theme.typography.fontSize.xs, marginTop: 2 },
  details: { marginTop: theme.spacing[3], paddingTop: theme.spacing[3], borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.border.light, gap: theme.spacing[2] },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', gap: theme.spacing[3] },
  detailLabel: { color: theme.colors.text.secondary, fontSize: theme.typography.fontSize.sm },
  detailValue: { color: theme.colors.text.primary, fontSize: theme.typography.fontSize.sm, fontWeight: theme.typography.fontWeight.semibold, flexShrink: 1 },
  status: { fontSize: theme.typography.fontSize.xs, marginTop: theme.spacing[1] },
  actions: { gap: theme.spacing[2.5] },
  dangerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: theme.spacing[2], paddingVertical: theme.spacing[3] },
  dangerText: { color: theme.colors.error[500], fontSize: theme.typography.fontSize.sm, fontWeight: theme.typography.fontWeight.semibold },
  input: { color: theme.colors.text.primary, fontSize: theme.typography.fontSize.sm, backgroundColor: theme.colors.background.secondary, borderRadius: theme.borderRadius.base, padding: theme.spacing[3], marginBottom: theme.spacing[2.5], borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border.light },
  error: { color: theme.colors.error[500], fontSize: theme.typography.fontSize.xs, marginBottom: theme.spacing[2.5] },
});
