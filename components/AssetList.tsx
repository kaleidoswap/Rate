import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppTheme } from '../theme/ThemeProvider';
import { formatBitcoinAmount } from '../utils/bitcoinUnits';
import { formatUsd } from '../utils/portfolio';
import { feedback } from '../utils/feedback';
import {
  ASSET_FILTERS, availableAssetFilters, filterAssetItems, formatTokenAmount, networkLabel,
  type AssetFilter, type AssetListItem,
} from '../utils/asset-list-model';
import { AmountText } from './AmountText';
import { AssetIcon } from './AssetIcon';
import { EmptyState } from './EmptyState';
import { NetworkIcon } from './NetworkIcon';
import { NetworkStack } from './NetworkStack';
import { PressableScale } from './PressableScale';

export { formatUsd };

interface Props {
  items: readonly AssetListItem[];
  bitcoinUnit: 'BTC' | 'sats';
  showNetworks: boolean;
  hideBalances?: boolean;
  onAssetPress: (item: AssetListItem) => void;
}

const HIDDEN = '••••';

/** Search and group the portfolio within the owning screen's vertical scroll. */
export function AssetList({ items, bitcoinUnit, showNetworks, hideBalances = false, onAssetPress }: Props) {
  const theme = useAppTheme();
  const styles = makeStyles(theme);
  const [filter, setFilter] = useState<AssetFilter>('all');
  const [query, setQuery] = useState('');
  const filters: AssetFilter[] = showNetworks ? availableAssetFilters(items) : ['all'];
  const activeFilter = filters.includes(filter) ? filter : 'all';
  const shown = filterAssetItems(items, activeFilter, query);

  const amountText = (item: AssetListItem): { amount: string; unit: string } => {
    if (item.isBtc) return { amount: formatBitcoinAmount(item.amount, bitcoinUnit), unit: bitcoinUnit };
    return { amount: formatTokenAmount(item.amount, item.precision), unit: item.ticker };
  };

  // "Spark", or "3 networks" when it lives on several (the icons say which).
  const whereLabel = (item: AssetListItem): string =>
    item.networks.length === 1 ? networkLabel(item.networks[0]) : `${item.networks.length} networks`;

  const renderRow = (item: AssetListItem, index: number) => {
    const { amount, unit } = amountText(item);
    const fiat = !hideBalances && item.usdValue !== undefined && item.usdValue > 0 ? formatUsd(item.usdValue) : null;
    const empty = !hideBalances && item.amount <= 0;
    const ticker = item.ticker !== item.name ? item.ticker : '';
    const location = showNetworks && item.networks.length ? `, on ${item.networks.map(networkLabel).join(', ')}` : '';
    return (
      <PressableScale
        key={item.key}
        scaleTo={0.98}
        onPress={() => { feedback.select(); onAssetPress(item); }}
        accessibilityRole="button"
        accessibilityLabel={hideBalances
          ? `${item.name}${location}, balance hidden`
          : `${item.name}, ${amount} ${unit}${fiat ? `, about ${fiat}` : ''}${location}`}
        style={[styles.row, index < shown.length - 1 && styles.rowDivider]}
      >
        <AssetIcon ticker={item.ticker} logoUri={item.icon} size={40} showBadge={false} />
        <View style={styles.info}>
          <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
          {showNetworks && item.networks.length > 0 ? (
            <View style={styles.subtitleRow}>
              {!!ticker && <Text style={styles.subtitle}>{ticker}</Text>}
              {!!ticker && <Text style={styles.subtitle}>·</Text>}
              <NetworkStack networks={item.networks} label={whereLabel(item)} />
            </View>
          ) : (
            !!ticker && <Text style={styles.subtitle} numberOfLines={1}>{ticker}</Text>
          )}
        </View>
        <View style={styles.amounts}>
          <AmountText
            style={[styles.amount, empty && styles.amountEmpty]}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.75}
          >
            {hideBalances ? HIDDEN : amount}{!hideBalances && <Text style={styles.unit}>{` ${unit}`}</Text>}
          </AmountText>
          {fiat && <AmountText style={styles.fiat} numberOfLines={1}>{`≈ ${fiat}`}</AmountText>}
        </View>
        <Ionicons name="chevron-forward" size={16} color={theme.colors.text.tertiary} />
      </PressableScale>
    );
  };

  return (
    <View style={styles.list}>
      <View style={styles.search}>
        <Ionicons name="search" size={16} color={theme.colors.text.tertiary} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search assets"
          placeholderTextColor={theme.colors.text.tertiary}
          style={styles.searchInput}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          accessibilityLabel="Search assets"
        />
        {!!query && (
          <TouchableOpacity onPress={() => setQuery('')} accessibilityRole="button" accessibilityLabel="Clear search"
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="close-circle" size={16} color={theme.colors.text.tertiary} />
          </TouchableOpacity>
        )}
      </View>

      {filters.length > 1 && (
        <ScrollView
          horizontal
          keyboardShouldPersistTaps="handled"
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chips}
        >
          {ASSET_FILTERS.filter((f) => filters.includes(f.key)).map((f) => {
            const selected = f.key === activeFilter;
            return (
              <TouchableOpacity
                key={f.key}
                onPress={() => setFilter(f.key)}
                style={[styles.chip, selected && styles.chipSelected]}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityLabel={`Show ${f.key === 'all' ? 'all assets' : `assets on ${f.label}`}`}
              >
                {f.key === 'all'
                  ? <Ionicons name="apps" size={14} color={selected ? theme.colors.text.primary : theme.colors.text.secondary} />
                  : <NetworkIcon network={f.key} size={14} />}
                <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{f.label}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}

      {shown.length > 0 ? (
        <View style={styles.group}>{shown.map(renderRow)}</View>
      ) : (
        <EmptyState
          icon={query ? 'search-outline' : 'layers-outline'}
          title={query ? 'No matching assets' : items.length ? 'Nothing on this network' : 'No assets yet'}
          message={query
            ? 'Try another name or ticker.'
            : items.length ? 'Pick another network to see what you hold there.' : 'Assets you receive will appear here.'}
        />
      )}
    </View>
  );
}

const makeStyles = (theme: ReturnType<typeof useAppTheme>) => StyleSheet.create({
  list: { gap: theme.spacing[3] },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    minHeight: 44,
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface.primary,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border.light,
  },
  searchInput: {
    flex: 1,
    paddingVertical: theme.spacing[2],
    fontSize: theme.typography.fontSize.base,
    color: theme.colors.text.primary,
  },
  chips: {
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[0.5],
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[1.5],
    minHeight: 34,
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surface.primary,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border.light,
  },
  chipSelected: {
    backgroundColor: theme.colors.surface.secondary,
    borderColor: theme.colors.primary[500],
  },
  chipText: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.text.secondary,
  },
  chipTextSelected: {
    color: theme.colors.text.primary,
    fontWeight: theme.typography.fontWeight.semibold,
  },
  group: {
    borderRadius: theme.borderRadius.xl,
    backgroundColor: theme.colors.surface.primary,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border.light,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[3],
    minHeight: 64,
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
  },
  rowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border.light,
  },
  info: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  name: {
    fontSize: theme.typography.fontSize.base,
    fontWeight: '600',
    color: theme.colors.text.primary,
  },
  subtitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[1],
  },
  subtitle: {
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.text.secondary,
  },
  amounts: {
    alignItems: 'flex-end',
    gap: 2,
    maxWidth: '48%',
  },
  amount: {
    fontSize: theme.typography.fontSize.base,
    fontWeight: '600',
    color: theme.colors.text.primary,
  },
  amountEmpty: {
    color: theme.colors.text.tertiary,
  },
  unit: {
    fontSize: theme.typography.fontSize.sm,
    fontWeight: '500',
    color: theme.colors.text.secondary,
  },
  fiat: {
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.text.secondary,
  },
});
