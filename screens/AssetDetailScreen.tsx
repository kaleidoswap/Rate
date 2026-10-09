// screens/AssetDetailScreen.tsx
//
// One asset: what you hold (big, with its dollar value), what you can do with it
// (Receive / Send / Swap), then its balance breakdown and details as grouped lists
// in the same style as the Dashboard asset list.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { theme, motion } from '../theme';
import { ScreenHeader } from '../components/ScreenHeader';
import { CopyButton } from '../components/CopyButton';
import { AmountText } from '../components/AmountText';
import { AssetIcon } from '../components/AssetIcon';
import { PressableScale } from '../components/PressableScale';
import { RecentActivityWidget } from '../components/RecentActivityWidget';
import { formatUsd } from '../components/AssetList';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { loadBtcBalance } from '../store/slices/walletSlice';
import { feedback } from '../utils/feedback';
import { formatAssetAmount } from '../utils/assetAmount';
import { useRgbTransferWatch } from '../hooks/useRgbTransferWatch';
import { useRgbWalletSheets } from '../components/rgb/RgbWalletTools';
import { refreshRgbAssets } from '../store/slices/assetsSlice';
import { rgbAccountAdapter } from '../services/protocols';
import { rgbWalletSupport } from '../utils/rgb-wallet';
import { refreshRgbTransfers } from '../services/rgbWallet';

type Protocol = 'BTC' | 'RGB' | 'SPARK' | 'ARKADE';

interface AssetParam {
  asset_id: string;
  ticker: string;
  name: string;
  precision?: number;
  issued_supply?: number;
  balance?: number | Record<string, number | undefined>;
  isRGB?: boolean;
  protocol?: Protocol;
  icon?: string;
  /** Unit shown after amounts (e.g. "sats"); defaults to the ticker. */
  unit?: string;
  /** USD value of the balance, when known. */
  fiatValue?: number;
}

interface Props {
  navigation: any;
  route: { params?: { asset?: AssetParam } };
}

const NETWORK_LABEL: Record<Protocol, string> = { BTC: 'Bitcoin', RGB: 'RGB', SPARK: 'Spark', ARKADE: 'Arkade' };

/** "21000" → "21,000"; keeps the decimals as they are. */
function grouped(amount: string): string {
  const [int, frac] = amount.split('.');
  return int.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (frac !== undefined ? `.${frac}` : '');
}

/** Middle-truncates a long id so both ends stay readable. */
function shortId(id: string): string {
  return id.length > 22 ? `${id.slice(0, 10)}…${id.slice(-8)}` : id;
}

/** The balance fields we show, read defensively: callers pass a number, a partial or a full balance. */
function readBalance(balance: AssetParam['balance']) {
  if (typeof balance === 'number') return { available: balance, settled: balance, incoming: 0, inChannels: 0 };
  const b = balance ?? {};
  const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const settled = num(b.settled ?? b.spendable ?? b.available);
  return {
    available: num(b.spendable ?? b.available ?? b.settled),
    settled,
    incoming: Math.max(0, num(b.future) - settled),
    inChannels: num(b.offchain_outbound),
  };
}

export default function AssetDetailScreen({ navigation, route }: Props) {
  const passed = route?.params?.asset;
  const dispatch = useAppDispatch();
  const storeAssets = useAppSelector(s => (s as any).assets?.rgbAssets) as AssetParam[] | undefined;
  const [refreshing, setRefreshing] = useState(false);
  const valid = !!passed?.asset_id && !!passed?.ticker && !!passed?.name;

  useEffect(() => {
    if (!valid) navigation.goBack();
  }, [valid, navigation]);

  // Prefer the live record (balances refresh in the store) over the snapshot we were opened with.
  const asset = useMemo<AssetParam | undefined>(() => {
    if (!passed) return undefined;
    const live = storeAssets?.find(a => a.asset_id === passed.asset_id);
    return live ? { ...passed, balance: live.balance ?? passed.balance } : passed;
  }, [passed, storeAssets]);

  // An RGB asset's pending transfers move forward while this screen is open; history and balance follow.
  const advanced = useAppSelector(s => (s as any).settings?.disclosureLevel) === 'advanced';
  const [historyKey, setHistoryKey] = useState(0);
  const watchRgb = valid && passed!.asset_id !== 'BTC' && (passed!.isRGB ?? (passed!.protocol ?? 'RGB') === 'RGB');
  useRgbTransferWatch({
    assetId: passed?.asset_id ?? '',
    enabled: !!watchRgb,
    onChange: () => { setHistoryKey(k => k + 1); void dispatch(refreshRgbAssets() as any); },
  });
  const rgbSheets = useRgbWalletSheets();

  // A pull also moves an RGB asset's transfers forward and re-reads its balance and history.
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      if (watchRgb) {
        await refreshRgbTransfers(rgbAccountAdapter()).catch(() => undefined);
        await dispatch(refreshRgbAssets() as any);
        setHistoryKey(k => k + 1);
      }
      await dispatch(loadBtcBalance() as any);
    } catch { /* the pull just ends */ }
    setRefreshing(false);
  }, [dispatch, watchRgb]);

  if (!valid || !asset) return null;

  const isBTC = asset.asset_id === 'BTC';
  const protocol: Protocol = isBTC ? 'BTC' : asset.protocol ?? (asset.isRGB === false ? 'SPARK' : 'RGB');
  const isRGB = asset.isRGB ?? protocol === 'RGB';
  const precision = asset.precision ?? 0;
  const unit = asset.unit ?? asset.ticker;
  const fmt = (baseUnits: number) => grouped(formatAssetAmount(baseUnits, precision));
  const bal = readBalance(asset.balance);
  const fiat = asset.fiatValue !== undefined && asset.fiatValue > 0 ? formatUsd(asset.fiatValue) : null;
  const subtitle = isBTC ? 'Spark, Arkade, Lightning & on-chain' : `${NETWORK_LABEL[protocol]} asset`;

  const selectedAsset = { asset_id: asset.asset_id, ticker: asset.ticker, name: asset.name, isRGB };
  const actions: Array<{ key: string; label: string; icon: keyof typeof Ionicons.glyphMap; tint: string; onPress: () => void }> = [
    { key: 'receive', label: 'Receive', icon: 'arrow-down', tint: theme.colors.success[500], onPress: () => navigation.navigate('Receive', { selectedAsset }) },
    { key: 'swap', label: 'Swap', icon: 'swap-horizontal', tint: theme.colors.brand.violet, onPress: () => navigation.navigate('Swap') },
    { key: 'send', label: 'Send', icon: 'arrow-up', tint: theme.colors.primary[500], onPress: () => navigation.navigate('Send', { selectedAsset }) },
  ];

  // Only what the hero doesn't already say: no repeated name, ticker, network or balance.
  const detailRows: Array<{ label: string; value: string; copy?: string }> = [
    ...(bal.inChannels > 0 ? [{ label: 'In Lightning channels', value: `${fmt(bal.inChannels)} ${unit}` }] : []),
    ...(!isBTC && asset.issued_supply ? [{ label: 'Issued supply', value: `${fmt(asset.issued_supply)} ${asset.ticker}` }] : []),
    ...(!isBTC ? [{ label: 'Decimals', value: String(precision) }] : []),
    ...(!isBTC ? [{ label: 'Asset ID', value: shortId(asset.asset_id), copy: asset.asset_id }] : []),
  ];

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <ScreenHeader title={asset.name} showBack onBack={() => navigation.goBack()} />
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.primary[500]} />}
      >
        <Animated.View entering={FadeInDown.duration(motion.duration.base)} style={styles.hero}>
          <AssetIcon ticker={asset.ticker} protocol={isBTC ? undefined : (protocol as 'RGB' | 'SPARK' | 'ARKADE')} logoUri={asset.icon} size={48} />
          <Text style={styles.heroSub}>{subtitle}</Text>
          <AmountText style={styles.heroAmount} accessibilityLabel={`Balance ${fmt(bal.available)} ${unit}${fiat ? `, about ${fiat}` : ''}`}>
            {fmt(bal.available)} <Text style={styles.heroUnit}>{unit}</Text>
          </AmountText>
          {fiat && <AmountText style={styles.heroFiat}>≈ {fiat}</AmountText>}
          {bal.incoming > 0 && (
            <View style={styles.pendingPill}>
              <Ionicons name="time-outline" size={13} color={theme.colors.warning[500]} />
              <Text style={styles.pendingText}>+{fmt(bal.incoming)} {unit} incoming</Text>
            </View>
          )}
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(motion.stagger).duration(motion.duration.base)} style={styles.actions}>
          {actions.map(a => (
            <PressableScale key={a.key} scaleTo={0.95} accessibilityRole="button" accessibilityLabel={`${a.label} ${asset.ticker}`}
              onPress={() => { feedback.select(); a.onPress(); }} style={styles.action}>
              <View style={[styles.actionIcon, { backgroundColor: `${a.tint}22` }]}>
                <Ionicons name={a.icon} size={22} color={a.tint} />
              </View>
              <Text style={styles.actionLabel}>{a.label}</Text>
            </PressableScale>
          ))}
        </Animated.View>

        {detailRows.length > 0 && <Animated.View entering={FadeInDown.delay(motion.stagger * 2).duration(motion.duration.base)}>
          <View style={styles.group}>
            {detailRows.map((d, i) => (
              <View key={d.label} style={[styles.row, i < detailRows.length - 1 && styles.rowDivider]}>
                <Text style={styles.rowLabel}>{d.label}</Text>
                <View style={styles.rowRight}>
                  <Text style={[styles.rowValue, d.copy && styles.mono]} numberOfLines={1}>{d.value}</Text>
                  {d.copy && <CopyButton value={d.copy} size={16} color={theme.colors.primary[500]} />}
                </View>
              </View>
            ))}
          </View>
        </Animated.View>}

        {advanced && isRGB && !isBTC && rgbWalletSupport(rgbAccountAdapter()).listUtxos && (
          <PressableScale accessibilityRole="button" accessibilityLabel="UTXOs" onPress={() => { feedback.select(); rgbSheets.openUtxos(); }} style={[styles.group, styles.row]}>
            <Text style={styles.rowLabel}>UTXOs holding this and other RGB assets</Text>
            <Ionicons name="chevron-forward" size={16} color={theme.colors.text.tertiary} />
          </PressableScale>
        )}

        {/* This asset's payments, after its details. */}
        <RecentActivityWidget assetId={isBTC ? 'BTC' : asset.asset_id} assetTicker={asset.ticker} title="History" style={styles.history} refreshKey={historyKey} />
        {rgbSheets.sheets}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background.primary },
  content: { paddingHorizontal: theme.spacing[4], paddingBottom: theme.spacing[8], gap: theme.spacing[4] },
  hero: { alignItems: 'center', paddingTop: theme.spacing[2], gap: 2 },
  heroSub: { marginTop: theme.spacing[2], fontSize: theme.typography.fontSize.xs, color: theme.colors.text.secondary },
  heroAmount: { marginTop: theme.spacing[1], fontSize: theme.typography.fontSize['4xl'], fontWeight: '700', color: theme.colors.text.primary },
  heroUnit: { fontSize: theme.typography.fontSize.lg, fontWeight: '500', color: theme.colors.text.secondary },
  heroFiat: { fontSize: theme.typography.fontSize.base, color: theme.colors.text.secondary },
  pendingPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: theme.spacing[2],
    paddingHorizontal: theme.spacing[3], paddingVertical: 6, borderRadius: theme.borderRadius.full,
    backgroundColor: `${theme.colors.warning[500]}1A`,
  },
  pendingText: { fontSize: theme.typography.fontSize.xs, color: theme.colors.warning[500], fontWeight: '600' },
  actions: { flexDirection: 'row', justifyContent: 'center', gap: theme.spacing[6] },
  history: { marginTop: 0, paddingHorizontal: 0 },
  action: { alignItems: 'center', gap: theme.spacing[1], minWidth: 64 },
  actionIcon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  actionLabel: { fontSize: theme.typography.fontSize.sm, fontWeight: '600', color: theme.colors.text.primary },
  // Same grouped surface as the Dashboard asset list.
  group: {
    borderRadius: theme.borderRadius.xl, backgroundColor: theme.colors.surface.primary,
    borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border.light, overflow: 'hidden',
  },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing[3], minHeight: 44, paddingHorizontal: theme.spacing[4], paddingVertical: theme.spacing[2.5] },
  rowDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.border.light },
  rowLabel: { fontSize: theme.typography.fontSize.sm, color: theme.colors.text.secondary },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing[2], flexShrink: 1 },
  rowValue: { fontSize: theme.typography.fontSize.sm, color: theme.colors.text.primary, fontWeight: '500', flexShrink: 1, textAlign: 'right' },
  mono: { fontFamily: theme.typography.fontFamily.mono },
});
