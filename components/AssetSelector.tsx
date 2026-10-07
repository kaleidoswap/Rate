/**
 * AssetSelector — the one asset picker (Swap, Receive). A bottom sheet with
 * quick picks, search, and the assets split into what you hold and the rest.
 * Each row says which network the asset moves on and what you hold of it.
 */
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, FlatList } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { theme, motion } from '../theme';
import { AssetIcon } from './AssetIcon';
import { NetworkIcon, networkIconForLabel } from './NetworkIcon';
import { AmountText } from './AmountText';
import { PressableScale } from './PressableScale';
import { Sheet } from './Sheet';
import { resolvePrecision } from '../utils/assetAmount';
import { feedback } from '../utils/feedback';

export interface SelectableAsset {
  asset_id: string;
  ticker: string;
  name: string;
  balance?: number;
  precision?: number;
  protocol?: 'RGB' | 'SPARK' | 'ARKADE';
  icon?: string;
  isRGB?: boolean;
  /** Where the asset moves, in words (e.g. "Spark", "RGB Lightning"). Defaults to the protocol. */
  network?: string;
  /** Balance as it should read, e.g. "12,000 sats". Defaults to the number. */
  balanceLabel?: string;
  /** Why it can't be picked right now; the row is shown dimmed with this line. */
  unavailable?: string;
}

interface AssetSelectorProps {
  visible: boolean;
  onClose: () => void;
  onSelect: (asset: SelectableAsset) => void;
  assets: SelectableAsset[];
  selectedAssetId?: string;
  title?: string;
  subtitle?: string;
  /** Tickers offered as one-tap chips above the list. */
  quickPicks?: string[];
}

const PROTOCOL_NETWORK: Record<string, string> = { RGB: 'RGB', SPARK: 'Spark', ARKADE: 'Arkade' };
const ANIMATED_ROWS = 12;

type Row = { kind: 'header'; title: string } | { kind: 'asset'; asset: SelectableAsset; index: number };

export function groupAssets(assets: SelectableAsset[], search: string): Row[] {
  const q = search.toLowerCase().trim();
  const matches = q
    ? assets.filter(a => a.ticker.toLowerCase().includes(q) || a.name.toLowerCase().includes(q) || a.asset_id.toLowerCase().includes(q))
    : assets;
  const held = matches.filter(a => (a.balance ?? 0) > 0 && !a.unavailable).sort((a, b) => (b.balance ?? 0) - (a.balance ?? 0));
  const rest = matches.filter(a => !held.includes(a));
  const rows: Row[] = [];
  let index = 0;
  const section = (title: string, list: SelectableAsset[]) => {
    if (!list.length) return;
    if (held.length && rest.length) rows.push({ kind: 'header', title });
    for (const asset of list) rows.push({ kind: 'asset', asset, index: index++ });
  };
  section('In your wallet', held);
  section(held.length ? 'Other assets' : 'Assets', rest);
  return rows;
}

export const AssetSelector: React.FC<AssetSelectorProps> = ({
  visible,
  onClose,
  onSelect,
  assets,
  selectedAssetId,
  title = 'Choose an asset',
  subtitle,
  quickPicks = [],
}) => {
  const [search, setSearch] = useState('');
  const rows = useMemo(() => groupAssets(assets, search), [assets, search]);
  const chips = useMemo(
    () => quickPicks.map(t => assets.find(a => a.ticker === t && !a.unavailable)).filter((a): a is SelectableAsset => !!a),
    [assets, quickPicks],
  );

  const pick = (asset: SelectableAsset) => {
    if (asset.unavailable) return;
    feedback.select();
    setSearch('');
    onSelect(asset);
    onClose();
  };

  const renderRow = ({ item }: { item: Row }) => {
    if (item.kind === 'header') return <Text style={styles.section}>{item.title}</Text>;
    const { asset, index } = item;
    const selected = asset.asset_id === selectedAssetId;
    const network = asset.network ?? (asset.protocol ? PROTOCOL_NETWORK[asset.protocol] : undefined);
    const balance = asset.balanceLabel
      ?? (asset.balance !== undefined
        ? asset.balance.toLocaleString(undefined, { maximumFractionDigits: resolvePrecision(asset.precision) })
        : undefined);
    return (
      <Animated.View entering={index < ANIMATED_ROWS ? FadeInDown.delay(index * motion.stagger).duration(motion.duration.base) : undefined}>
        <PressableScale
          scaleTo={0.98}
          onPress={() => pick(asset)}
          disabled={!!asset.unavailable}
          accessibilityRole="button"
          accessibilityState={{ selected, disabled: !!asset.unavailable }}
          accessibilityLabel={`${asset.ticker}, ${asset.name}${network ? `, on ${network}` : ''}${balance ? `, balance ${balance}` : ''}`}
          style={[styles.row, selected && styles.rowSelected, !!asset.unavailable && styles.rowUnavailable]}
        >
          <AssetIcon ticker={asset.ticker} logoUri={asset.icon} protocol={asset.protocol} size={40} showBadge={!!asset.protocol} />
          <View style={styles.info}>
            <View style={styles.topRow}>
              <Text style={styles.ticker}>{asset.ticker}</Text>
              {!!network && (
                <View style={styles.networkTag}>
                  {networkIconForLabel(network) && <NetworkIcon network={networkIconForLabel(network)!} size={11} />}
                  <Text style={styles.networkText}>{network}</Text>
                </View>
              )}
            </View>
            <Text style={styles.name} numberOfLines={1}>{asset.unavailable ?? asset.name}</Text>
          </View>
          {balance !== undefined && (
            <AmountText style={[styles.balance, (asset.balance ?? 0) === 0 && styles.balanceZero]} numberOfLines={1}>{balance}</AmountText>
          )}
          {selected && <Ionicons name="checkmark-circle" size={20} color={theme.colors.primary[500]} style={styles.check} />}
        </PressableScale>
      </Animated.View>
    );
  };

  const close = () => { setSearch(''); onClose(); };

  return (
    <Sheet visible={visible} onClose={close} title={title} subtitle={subtitle} tall>
      {assets.length > 6 && (
        <View style={styles.search}>
          <Ionicons name="search" size={18} color={theme.colors.text.tertiary} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search by name or ticker"
            placeholderTextColor={theme.colors.text.tertiary}
            value={search}
            onChangeText={setSearch}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            accessibilityLabel="Search assets"
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch('')} accessibilityRole="button" accessibilityLabel="Clear search"
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Ionicons name="close-circle" size={18} color={theme.colors.text.tertiary} />
            </TouchableOpacity>
          )}
        </View>
      )}

      {chips.length > 0 && !search && (
        <View style={styles.chips}>
          {chips.map(a => {
            const selected = a.asset_id === selectedAssetId;
            return (
              <PressableScale key={a.asset_id} onPress={() => pick(a)} accessibilityRole="button"
                accessibilityLabel={`Choose ${a.ticker}`} accessibilityState={{ selected }}
                style={[styles.chip, selected && styles.chipSelected]}>
                <AssetIcon ticker={a.ticker} logoUri={a.icon} size={20} showBadge={false} />
                <Text style={[styles.chipText, selected && { color: theme.colors.primary[500] }]}>{a.ticker}</Text>
              </PressableScale>
            );
          })}
        </View>
      )}

      <FlatList
        data={rows}
        keyExtractor={row => (row.kind === 'header' ? `h:${row.title}` : row.asset.asset_id)}
        renderItem={renderRow}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="search-outline" size={28} color={theme.colors.text.tertiary} />
            <Text style={styles.emptyTitle}>{search ? `Nothing matches "${search}"` : 'No assets to choose yet'}</Text>
            {!!search && <Text style={styles.emptyText}>Try the ticker, e.g. BTC or USDT.</Text>}
          </View>
        }
      />
    </Sheet>
  );
};

const styles = StyleSheet.create({
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[2.5],
    backgroundColor: theme.colors.background.secondary,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border.light,
    paddingHorizontal: theme.spacing[3.5],
    minHeight: 44,
    marginBottom: theme.spacing[3],
  },
  searchInput: {
    flex: 1,
    fontSize: theme.typography.fontSize.base,
    color: theme.colors.text.primary,
    paddingVertical: theme.spacing[2.5],
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing[2], marginBottom: theme.spacing[3] },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[1.5],
    paddingVertical: theme.spacing[1.5],
    paddingLeft: theme.spacing[1.5],
    paddingRight: theme.spacing[3],
    minHeight: 36,
    borderRadius: theme.borderRadius.full,
    borderWidth: 1,
    borderColor: theme.colors.border.light,
    backgroundColor: theme.colors.background.secondary,
  },
  chipSelected: { borderColor: theme.colors.primary[500], backgroundColor: theme.colors.primary[50] },
  chipText: { fontSize: theme.typography.fontSize.sm, fontWeight: theme.typography.fontWeight.semibold, color: theme.colors.text.primary },
  list: { paddingBottom: theme.spacing[6] },
  section: {
    fontSize: theme.typography.fontSize.xs,
    fontWeight: theme.typography.fontWeight.semibold,
    color: theme.colors.text.tertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: theme.spacing[3],
    marginBottom: theme.spacing[1.5],
    marginLeft: theme.spacing[1],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: 'transparent',
    marginBottom: theme.spacing[1],
    minHeight: 60,
  },
  rowSelected: { backgroundColor: theme.colors.primary[50], borderColor: theme.colors.primary[500] },
  rowUnavailable: { opacity: 0.45 },
  info: { flex: 1, marginLeft: theme.spacing[3], marginRight: theme.spacing[2], minWidth: 0 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing[1.5] },
  ticker: { fontSize: theme.typography.fontSize.base, fontWeight: theme.typography.fontWeight.semibold, color: theme.colors.text.primary },
  networkTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: theme.spacing[1.5],
    paddingVertical: 1,
    borderRadius: theme.borderRadius.sm,
    backgroundColor: theme.colors.background.secondary,
    borderWidth: 1,
    borderColor: theme.colors.border.light,
  },
  networkText: { fontSize: 10, fontWeight: theme.typography.fontWeight.semibold, color: theme.colors.text.secondary, letterSpacing: 0.2 },
  name: { fontSize: theme.typography.fontSize.xs, color: theme.colors.text.tertiary, marginTop: 2 },
  balance: {
    fontSize: theme.typography.fontSize.sm,
    fontWeight: theme.typography.fontWeight.semibold,
    color: theme.colors.text.primary,
    maxWidth: 130,
    textAlign: 'right',
  },
  balanceZero: { color: theme.colors.text.tertiary, fontWeight: theme.typography.fontWeight.normal },
  check: { marginLeft: theme.spacing[2] },
  empty: { alignItems: 'center', paddingTop: theme.spacing[12], gap: theme.spacing[2] },
  emptyTitle: { fontSize: theme.typography.fontSize.sm, color: theme.colors.text.secondary, fontWeight: theme.typography.fontWeight.medium },
  emptyText: { fontSize: theme.typography.fontSize.xs, color: theme.colors.text.tertiary },
});

export default AssetSelector;
