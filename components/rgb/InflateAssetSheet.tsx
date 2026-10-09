import React, { useEffect, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppTheme } from '../../theme/ThemeProvider';
import { Sheet } from '../Sheet';
import { Callout } from '../Callout';
import { Button } from '../Button';
import { Input } from '../Input';
import { SegmentedTabs } from '../SegmentedTabs';
import { feedback } from '../../utils/feedback';
import { formatAssetAmount } from '../../utils/assetAmount';
import { rgbWalletErrorMessage, validateRgbInflate } from '../../utils/rgb-wallet';
import { DEFAULT_RGB_FEE_RATES, inflateRgbAsset, rgbFeeRates, type RgbFeeRates } from '../../services/rgbWallet';

type Speed = 'slow' | 'normal' | 'fast';
const SPEED_LABEL: Record<Speed, string> = { slow: 'Slow', normal: 'Normal', fast: 'Fast' };

/** Issue more of an IFA asset, within the inflation rights this wallet holds. */
export function InflateAssetSheet({ visible, onClose, adapter, asset, rights, onInflated }: {
  visible: boolean;
  onClose: () => void;
  adapter: unknown;
  asset: { asset_id: string; ticker: string; precision: number };
  /** Base units still allowed. */
  rights: number;
  onInflated?: () => void;
}) {
  const t = useAppTheme();
  const [amount, setAmount] = useState('');
  const [touched, setTouched] = useState(false);
  const [speed, setSpeed] = useState<Speed>('normal');
  const [fees, setFees] = useState<RgbFeeRates>(DEFAULT_RGB_FEE_RATES);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    if (!visible) return;
    setAmount(''); setTouched(false); setResult(null); setSpeed('normal');
    void rgbFeeRates(adapter).then(setFees);
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const fmt = (base: number) => `${formatAssetAmount(base, asset.precision)} ${asset.ticker}`;
  const checked = validateRgbInflate(amount, asset.precision, rights);
  const shownError = touched || amount ? checked.error : undefined;

  const submit = () => {
    setTouched(true);
    if (checked.amount == null) { feedback.error(); return; }
    const base = checked.amount;
    feedback.select();
    Alert.alert(
      `Issue ${fmt(base)} more?`,
      `The new ${asset.ticker} is yours, and the supply grows for everyone who holds it. Your rights shrink to ${fmt(rights - base)}. This needs a bitcoin transaction at ${fees[speed]} sat/vB.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Issue', onPress: async () => {
            setBusy(true);
            setResult(null);
            try {
              await inflateRgbAsset(adapter, { assetId: asset.asset_id, amount: base, feeRate: fees[speed] });
              feedback.success();
              setResult({ tone: 'success', message: 'Issued. It counts once the transaction confirms.' });
              onInflated?.();
            } catch (e) {
              setResult({ tone: 'error', message: rgbWalletErrorMessage(e, 'inflate') });
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  };

  return (
    <Sheet visible={visible} onClose={onClose} title={`Issue more ${asset.ticker}`} subtitle={`You can issue up to ${fmt(rights)} more`}
      footer={<View style={{ paddingTop: t.spacing[3] }}>
        <Button title={checked.amount != null ? `Issue ${fmt(checked.amount)}` : 'Issue more'} onPress={submit} loading={busy}
          disabled={busy || result?.tone === 'success'} icon={<Ionicons name="add-circle-outline" size={16} color={t.colors.text.primary} />} />
      </View>}>
      <View style={{ gap: t.spacing[3] }}>
        <Input label="Amount" placeholder="0" keyboardType="decimal-pad" value={amount} onChangeText={setAmount} error={shownError} accessibilityLabel="Amount to issue" />
        <SegmentedTabs<Speed> scrollable={false} fill value={speed} onChange={setSpeed}
          options={(['slow', 'normal', 'fast'] as Speed[]).map(s => ({ key: s, label: `${SPEED_LABEL[s]} · ${fees[s]}` }))} />
        <Text style={{ color: t.colors.text.secondary, fontSize: t.typography.fontSize.sm }}>
          {`Network fee rate ${fees[speed]} sat/vB${fees.live ? '' : ' (default rate)'}, paid from your plain bitcoin.`}
        </Text>
        {result && <Callout tone={result.tone} message={result.message} />}
      </View>
    </Sheet>
  );
}
