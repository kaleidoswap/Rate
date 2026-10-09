import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppTheme } from '../../theme/ThemeProvider';
import { Sheet } from '../Sheet';
import { Callout } from '../Callout';
import { Button } from '../Button';
import { SegmentedTabs } from '../SegmentedTabs';
import { feedback } from '../../utils/feedback';
import { formatAssetAmount } from '../../utils/assetAmount';
import { listRgbUtxos, summarizeUtxos, type RgbUtxo } from '../../utils/rgb-receive';
import {
  RGB_UTXO_COUNTS, RGB_UTXO_SIZES, createUtxosEstimate, rgbWalletErrorMessage, rgbWalletSupport,
} from '../../utils/rgb-wallet';
import { DEFAULT_RGB_FEE_RATES, createRgbUtxos, rgbFeeRates, type RgbFeeRates } from '../../services/rgbWallet';
import { rgbAccountAdapter } from '../../services/protocols';

export interface RgbAssetLabel {
  asset_id: string;
  ticker: string;
  precision?: number;
}

type Speed = 'slow' | 'normal' | 'fast';
const SPEED_LABEL: Record<Speed, string> = { slow: 'Slow', normal: 'Normal', fast: 'Fast' };
const sats = (n: number) => `${n.toLocaleString()} sats`;

/**
 * The RGB account's UTXOs: which hold assets, which are free to receive into,
 * which are plain bitcoin, and creating new colorable ones.
 */
export function RgbUtxoSheet({ visible, onClose, assets = [], adapter: given, reason, onCreated }: {
  visible: boolean;
  onClose: () => void;
  /** Labels allocations with a ticker in the asset's precision. */
  assets?: RgbAssetLabel[];
  adapter?: unknown;
  /** Why the sheet was opened (e.g. issuing needs a free UTXO), shown on top. */
  reason?: string;
  onCreated?: () => void;
}) {
  const t = useAppTheme();
  const adapter: any = given ?? rgbAccountAdapter();
  const support = rgbWalletSupport(adapter);
  const [state, setState] = useState<{ loading: boolean; error?: string; list?: RgbUtxo[] }>({ loading: false });
  const [num, setNum] = useState<number>(3);
  const [size, setSize] = useState<number>(3000);
  const [speed, setSpeed] = useState<Speed>('normal');
  const [fees, setFees] = useState<RgbFeeRates>(DEFAULT_RGB_FEE_RATES);
  const [creating, setCreating] = useState(false);
  const [result, setResult] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);

  const load = useCallback(async () => {
    if (!support.listUtxos) return;
    setState(s => ({ ...s, loading: true, error: undefined }));
    try {
      setState({ loading: false, list: await listRgbUtxos(adapter) });
    } catch {
      setState({ loading: false, error: 'Couldn’t load your UTXOs. Pull to try again.' });
    }
  }, [adapter, support.listUtxos]);

  useEffect(() => {
    if (!visible) { setResult(null); return; }
    void load();
    if (support.createUtxos) void rgbFeeRates(adapter).then(setFees);
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const summary = state.list ? summarizeUtxos(state.list) : null;
  const feeRate = fees[speed];
  const estimate = createUtxosEstimate({ num, size, feeRate, bitcoinSats: summary?.bitcoinSats });
  const label = (assetId?: string) => assets.find(a => a.asset_id === assetId);

  const create = () => {
    feedback.select();
    Alert.alert(
      `Create ${num} UTXO${num === 1 ? '' : 's'}?`,
      `${num} × ${sats(size)} plus about ${sats(estimate.feeSats)} in fees (${feeRate} sat/vB), from your plain bitcoin. The sats stay yours.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Create', onPress: async () => {
            setCreating(true);
            setResult(null);
            try {
              await createRgbUtxos(adapter, { num, size, feeRate });
              feedback.success();
              setResult({ tone: 'success', message: 'Created. They can be used once the transaction confirms, usually within an hour.' });
              onCreated?.();
              void load();
            } catch (e) {
              setResult({ tone: 'error', message: rgbWalletErrorMessage(e, 'utxos') });
            } finally {
              setCreating(false);
            }
          },
        },
      ],
    );
  };

  const caption = (text: string) => (
    <Text style={{ color: t.colors.text.tertiary, fontSize: t.typography.fontSize.xs, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6 }}>{text}</Text>
  );
  const stat = (title: string, value: string, tint: string) => (
    <View style={{ flex: 1, padding: t.spacing[3], borderRadius: t.borderRadius.lg, borderWidth: 1, borderColor: t.colors.border.light, gap: 2 }}>
      <Text style={{ color: tint, fontSize: t.typography.fontSize.lg, fontWeight: '700' }}>{value}</Text>
      <Text style={{ color: t.colors.text.secondary, fontSize: t.typography.fontSize.xs }}>{title}</Text>
    </View>
  );
  const row = (u: RgbUtxo, detail: React.ReactNode) => (
    <View key={u.outpoint} style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing[3], paddingVertical: t.spacing[2],
      borderBottomWidth: 1, borderBottomColor: t.colors.border.light }}>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text style={{ color: t.colors.text.secondary, fontSize: t.typography.fontSize.xs, fontFamily: t.typography.fontFamily.mono }}
          numberOfLines={1} ellipsizeMode="middle">{u.outpoint}</Text>
        {detail}
      </View>
      <Text style={{ color: t.colors.text.primary, fontSize: t.typography.fontSize.sm, fontVariant: ['tabular-nums'] }}>{sats(u.sats)}</Text>
    </View>
  );
  const allocationText = (u: RgbUtxo) => {
    if (!u.assets.length) return u.pending ? 'Reserved for an open invoice' : 'Holds an asset';
    return u.assets.map(a => {
      const known = label(a.assetId);
      const amount = known ? `${formatAssetAmount(a.amount, known.precision ?? 0)} ${known.ticker}` : `${a.amount.toLocaleString()} units`;
      return a.settled ? amount : `${amount} incoming`;
    }).join(' · ');
  };

  return (
    <Sheet visible={visible} onClose={onClose} tall title="UTXOs" subtitle="The bitcoin outputs behind your RGB assets">
      <ScrollView contentContainerStyle={{ gap: t.spacing[4], paddingBottom: t.spacing[4] }}>
        {!!reason && <Callout tone="warning" message={reason} />}
        <Text style={{ color: t.colors.text.secondary, fontSize: t.typography.fontSize.sm }}>
          RGB assets sit on bitcoin outputs. A colorable output can hold assets: free ones can receive a blinded invoice or a new
          issuance. Plain bitcoin pays fees and funds new colorable outputs.
        </Text>

        {!support.listUtxos && <Callout tone="info" message="Your RGB node doesn’t share its UTXOs over this connection. Manage them on the node." />}
        {state.loading && !state.list && <ActivityIndicator color={t.colors.primary[500]} />}
        {!!state.error && <Callout tone="warning" message={state.error} />}

        {summary && <>
          <View style={{ flexDirection: 'row', gap: t.spacing[2] }}>
            {stat('Holding assets', String(summary.colored.length), t.colors.text.primary)}
            {stat('Free to receive', String(summary.free.length), summary.free.length ? t.colors.success[500] : t.colors.warning[500])}
            {stat('Plain bitcoin', sats(summary.bitcoinSats), t.colors.text.primary)}
          </View>
          {summary.free.length === 0 && <Callout tone="warning"
            message={support.createUtxos
              ? 'No free colorable UTXO. Create some below to issue assets or receive with a blinded invoice.'
              : 'No free colorable UTXO. Witness invoices still work: the sender creates the output.'} />}

          <View style={{ gap: t.spacing[1] }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              {caption('Holding assets')}
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="Refresh UTXOs" onPress={() => void load()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                {state.loading ? <ActivityIndicator size="small" color={t.colors.text.tertiary} /> : <Ionicons name="refresh" size={14} color={t.colors.text.tertiary} />}
              </TouchableOpacity>
            </View>
            {summary.colored.length === 0 && <Text style={{ color: t.colors.text.tertiary, fontSize: t.typography.fontSize.sm }}>None yet.</Text>}
            {summary.colored.map(u => row(u, <Text style={{ color: t.colors.text.primary, fontSize: t.typography.fontSize.sm }}>{allocationText(u)}</Text>))}
          </View>
          <View style={{ gap: t.spacing[1] }}>
            {caption('Free to receive')}
            {summary.free.length === 0 && <Text style={{ color: t.colors.text.tertiary, fontSize: t.typography.fontSize.sm }}>None.</Text>}
            {summary.free.map(u => row(u, null))}
          </View>
          <View style={{ gap: t.spacing[1] }}>
            {caption('Plain bitcoin')}
            {summary.bitcoin.length === 0 && <Text style={{ color: t.colors.text.tertiary, fontSize: t.typography.fontSize.sm }}>None.</Text>}
            {summary.bitcoin.map(u => row(u, null))}
          </View>
        </>}

        {support.createUtxos && <View style={{ gap: t.spacing[3] }}>
          {caption('Create colorable UTXOs')}
          <SegmentedTabs<string> scrollable={false} fill value={String(num)} onChange={(k) => setNum(Number(k))}
            options={RGB_UTXO_COUNTS.map(n => ({ key: String(n), label: `${n}` }))} />
          <SegmentedTabs<string> scrollable={false} fill value={String(size)} onChange={(k) => setSize(Number(k))}
            options={RGB_UTXO_SIZES.map(n => ({ key: String(n), label: `${n.toLocaleString()} sats` }))} />
          <SegmentedTabs<Speed> scrollable={false} fill value={speed} onChange={setSpeed}
            options={(['slow', 'normal', 'fast'] as Speed[]).map(s => ({ key: s, label: `${SPEED_LABEL[s]} · ${fees[s]}` }))} />
          <Text style={{ color: t.colors.text.secondary, fontSize: t.typography.fontSize.sm }}>
            {`${num} UTXO${num === 1 ? '' : 's'} of ${sats(size)}, about ${sats(estimate.feeSats)} in fees at ${feeRate} sat/vB${fees.live ? '' : ' (default rate)'}.`}
          </Text>
          {summary && !estimate.enough && <Callout tone="warning"
            message={`This needs about ${sats(estimate.totalSats)} of plain bitcoin; you have ${sats(summary.bitcoinSats)}. Pick fewer or smaller UTXOs, or add bitcoin first.`} />}
          {result && <Callout tone={result.tone} message={result.message} />}
          <Button title={`Create ${num} UTXO${num === 1 ? '' : 's'}`} onPress={create} loading={creating}
            disabled={creating || (!!summary && !estimate.enough)}
            icon={<Ionicons name="add-circle-outline" size={16} color={t.colors.text.primary} />} />
        </View>}
      </ScrollView>
    </Sheet>
  );
}
