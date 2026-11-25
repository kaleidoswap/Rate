import React, { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../App';
import { Button, MainHeader } from '../components';
import { useAppLanguage } from '../localization/useAppLanguage';
import { useAppTheme } from '../theme/ThemeProvider';
import { useAppSelector } from '../store/hooks';
import {
  onPhonePairChanged,
  pairPhone,
  phonePairInfo,
  revokePhonePair,
} from '../services/nwc/phoneWalletHost';
import { parsePhoneInvitation } from '../services/nwc/phoneWalletProtocol';

export default function PhoneWalletScreen({
  navigation,
  route,
}: NativeStackScreenProps<RootStackParamList, 'PhoneWallet'>) {
  const theme = useAppTheme();
  const { t } = useAppLanguage();
  const walletId = useAppSelector((state) => state.wallet.activeWallet?.id);
  const [pair, setPair] = useState(phonePairInfo);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const raw = route?.params?.scanned;
  useEffect(() => onPhonePairChanged(() => setPair(phonePairInfo())), []);
  useEffect(() => {
    setError('');
  }, [raw]);
  const run = async (action: () => Promise<void>) => {
    setError('');
    setBusy(true);
    try {
      await action();
      navigation.setParams({ scanned: undefined });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Browser connection failed.');
    } finally {
      setBusy(false);
    }
  };
  const activePair = pair?.walletId === walletId ? pair : null;
  let candidate;
  let invalid = '';
  if (raw && !activePair) {
    try {
      candidate = parsePhoneInvitation(raw);
    } catch (e) {
      invalid = e instanceof Error ? e.message : 'Invalid pairing invitation.';
    }
  }
  const value = { color: theme.colors.text.primary, fontSize: 17 };
  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background.primary }}>
      <MainHeader title={t('Browser connection')} onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={{ padding: theme.spacing[5], gap: theme.spacing[4] }}>
        {activePair ? (
          <>
            <Text style={value}>
              {t('Paired browser')} · {activePair.network}
            </Text>
            <Text selectable style={{ color: theme.colors.text.secondary }}>
              {activePair.client}
            </Text>
            <Text style={value}>
              {t('Keep the app open to review RGB payments. Each payment requires your passkey.')}
            </Text>
            <Button
              title={t('Disconnect browser')}
              variant="secondary"
              loading={busy}
              onPress={() => void run(() => revokePhonePair(walletId!))}
            />
          </>
        ) : (
          <>
            <Text style={value}>
              {t(
                'In the KaleidoSwap extension, choose the phone wallet and scan its QR code. Your RGB wallet stays on this phone.',
              )}
            </Text>
            {candidate && (
              <>
                <Text style={value}>{t('Browser requesting access')}</Text>
                <Text selectable style={{ color: theme.colors.text.secondary }}>
                  {candidate.client}
                </Text>
                <Text style={value}>
                  {t(
                    'Pair only a code shown by your own browser. This allows it to request RGB payments for you to review.',
                  )}
                </Text>
                <Button
                  title={t('Pair with passkey')}
                  loading={busy}
                  disabled={!walletId}
                  onPress={() => void run(() => pairPhone(raw!, walletId!))}
                />
              </>
            )}
            <Button
              title={t(candidate ? 'Scan another code' : 'Scan browser QR code')}
              disabled={busy}
              variant={candidate ? 'secondary' : 'primary'}
              onPress={() => navigation.navigate('QRScanner', { mode: 'browser' })}
            />
          </>
        )}
        {!!(error || invalid) && (
          <Text accessibilityRole="alert" style={value}>
            {t(error || invalid)}
          </Text>
        )}
      </ScrollView>
    </View>
  );
}
