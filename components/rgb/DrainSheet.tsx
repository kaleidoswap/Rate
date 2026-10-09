import React, { useEffect, useState } from 'react';
import { Alert, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppTheme } from '../../theme/ThemeProvider';
import { Sheet } from '../Sheet';
import { Callout } from '../Callout';
import { Button } from '../Button';
import { Input } from '../Input';
import { CopyButton } from '../CopyButton';
import { SegmentedTabs } from '../SegmentedTabs';
import { feedback } from '../../utils/feedback';
import { listRgbUtxos, summarizeUtxos } from '../../utils/rgb-receive';
import { rgbWalletErrorMessage, validateDrainAddress } from '../../utils/rgb-wallet';
import { bitcoinAddressNetworks } from '../../services/kaleidoPay/target';
import { DEFAULT_RGB_FEE_RATES, drainRgbWallet, rgbAccountNetwork, rgbFeeRates, type RgbFeeRates } from '../../services/rgbWallet';
import { rgbAccountAdapter } from '../../services/protocols';

type Speed = 'slow' | 'normal' | 'fast';
const SPEED_LABEL: Record<Speed, string> = { slow: 'Slow', normal: 'Normal', fast: 'Fast' };
const sats = (n: number) => `${n.toLocaleString()} sats`;

/** Sends all plain bitcoin of RGB on this phone to one address. Outputs holding assets stay. */
export function DrainSheet({ visible, onClose, adapter: given, onDrained }: {
  visible: boolean;
  onClose: () => void;
  adapter?: unknown;
  onDrained?: () => void;
}) {
  const t = useAppTheme();
  const adapter: any = given ?? rgbAccountAdapter();
  const [address, setAddress] = useState('');
  const [network, setNetwork] = useState<string | undefined>();
  const [plainSats, setPlainSats] = useState<number | null>(null);
  const [speed, setSpeed] = useState<Speed>('normal');
  const [fees, setFees] = useState<RgbFeeRates>(DEFAULT_RGB_FEE_RATES);
  const [understood, setUnderstood] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txid, setTxid] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setAddress(''); setUnderstood(false); setError(null); setTxid(null); setSpeed('normal'); setPlainSats(null);
    void rgbAccountNetwork(adapter).then(setNetwork);
    void rgbFeeRates(adapter).then(setFees);
    listRgbUtxos(adapter).then(list => setPlainSats(summarizeUtxos(list).bitcoinSats), () => setPlainSats(null));
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const addressError = address ? validateDrainAddress(address, bitcoinAddressNetworks(address), network) : null;
  const ready = !!address && !addressError && understood && plainSats !== 0;

  const submit = () => {
    if (!ready) { feedback.error(); return; }
    feedback.select();
    Alert.alert(
      'Send all your plain bitcoin?',
      `${plainSats != null ? `About ${sats(plainSats)}, less the network fee,` : 'All of it, less the network fee,'} goes to ${address.trim()}. This can’t be undone. Your assets stay, but until you add bitcoin again you can’t pay fees to send them.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Send all', style: 'destructive', onPress: async () => {
            setBusy(true);
            setError(null);
            try {
              setTxid(await drainRgbWallet(adapter, { address, feeRate: fees[speed] }));
              feedback.success();
              onDrained?.();
            } catch (e) {
              setError(rgbWalletErrorMessage(e, 'drain'));
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  };

  if (txid) {
    return (
      <Sheet visible={visible} onClose={onClose} title="Bitcoin sent" footer={<View style={{ paddingTop: t.spacing[3] }}><Button title="Done" onPress={onClose} /></View>}>
        <View style={{ alignItems: 'center', gap: t.spacing[2], paddingVertical: t.spacing[3] }}>
          <Ionicons name="checkmark-circle" size={44} color={t.colors.success[500]} />
          <Text style={{ color: t.colors.text.secondary, textAlign: 'center' }}>Your plain bitcoin is on its way. It arrives once the transaction confirms.</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing[2] }}>
            <Text selectable numberOfLines={1} ellipsizeMode="middle" style={{ maxWidth: 220, color: t.colors.text.secondary, fontFamily: t.typography.fontFamily.mono, fontSize: t.typography.fontSize.xs }}>{txid}</Text>
            <CopyButton value={txid} size={14} />
          </View>
        </View>
      </Sheet>
    );
  }

  return (
    <Sheet visible={visible} onClose={onClose} tall title="Send all bitcoin" subtitle="Empty the plain bitcoin of your RGB wallet"
      footer={<View style={{ paddingTop: t.spacing[3] }}>
        <Button title="Send all bitcoin" variant="error" onPress={submit} loading={busy} disabled={busy || !ready} />
      </View>}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: t.spacing[3], paddingBottom: t.spacing[3] }}>
        <Callout tone="warning" title="Everything but your assets leaves"
          message="All plain bitcoin goes to the address below in one transaction. Outputs holding RGB assets stay in this wallet and are never spent or destroyed." />
        <Text style={{ color: t.colors.text.secondary, fontSize: t.typography.fontSize.sm }}>
          {plainSats == null ? 'Checking your plain bitcoin…' : plainSats === 0 ? 'There is no plain bitcoin to send.' : `Plain bitcoin now: ${sats(plainSats)}.`}
        </Text>
        <Input label="Bitcoin address" placeholder={network === 'mainnet' ? 'bc1…' : 'tb1…'} autoCapitalize="none" autoCorrect={false}
          value={address} onChangeText={setAddress} error={addressError ?? undefined} accessibilityLabel="Bitcoin address" />
        <SegmentedTabs<Speed> scrollable={false} fill value={speed} onChange={setSpeed}
          options={(['slow', 'normal', 'fast'] as Speed[]).map(s => ({ key: s, label: `${SPEED_LABEL[s]} · ${fees[s]}` }))} />
        <Text style={{ color: t.colors.text.tertiary, fontSize: t.typography.fontSize.xs }}>
          {`Network fee rate ${fees[speed]} sat/vB${fees.live ? '' : ' (default rate)'}, taken from the amount sent.`}
        </Text>
        <TouchableOpacity accessibilityRole="checkbox" accessibilityState={{ checked: understood }} accessibilityLabel="I understand this sends all my plain bitcoin and can’t be undone"
          onPress={() => { feedback.select(); setUnderstood(u => !u); }} style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing[2], paddingVertical: t.spacing[1] }}>
          <Ionicons name={understood ? 'checkbox' : 'square-outline'} size={22} color={understood ? t.colors.primary[500] : t.colors.text.tertiary} />
          <Text style={{ flex: 1, color: t.colors.text.primary, fontSize: t.typography.fontSize.sm }}>I understand this sends all my plain bitcoin and can’t be undone.</Text>
        </TouchableOpacity>
        {!!error && <Callout tone="error" message={error} />}
      </ScrollView>
    </Sheet>
  );
}
