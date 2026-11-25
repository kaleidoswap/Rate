import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppTheme } from '../theme/ThemeProvider';
import { formatBitcoinAmount } from '../utils/bitcoinUnits';
import { formatUsd } from '../utils/portfolio';
import { feedback } from '../utils/feedback';
import { btcNetworkLabel, formatTokenAmount, networkLabel, type AssetListItem } from '../utils/asset-list-model';
import { AmountText } from './AmountText';
import { AssetIcon } from './AssetIcon';
import { EmptyState } from './EmptyState';
import { NetworkStack } from './NetworkStack';
import { PressableScale } from './PressableScale';

export { formatUsd };

interface Props {
  items: readonly AssetListItem[];
  bitcoinUnit: 'BTC' | 'sats';
  showNetworks: boolean;
  hideBalances?: boolean;
  emptyReason?: 'search' | 'network' | 'hidden';
  onOpenSettings?: () => void;
  onAssetPress: (item: AssetListItem) => void;
}

const HIDDEN = '••••';

const EMPTY_STATES = {
  search: { icon: 'search-outline', title: 'No matching assets', message: 'Try another name, ticker or asset ID.' },
  network: { icon: 'layers-outline', title: 'Nothing on this network', message: 'Choose another network in Asset settings.' },
  hidden: { icon: 'eye-off-outline', title: 'Assets are hidden', message: 'Choose which assets to show in Asset settings.' },
  default: { icon: 'layers-outline', title: 'No assets yet', message: 'Assets you receive will appear here.' },
} as const;

export function AssetListSettingsButton({ onPress, filtered = false }: { onPress: () => void; filtered?: boolean }) {
  const theme = useAppTheme();
  const styles = makeStyles(theme);
  return (
    <PressableScale
      onPress={() => { feedback.select(); onPress(); }}
      style={styles.settingsButton}
      accessibilityRole="button"
      accessibilityLabel="Asset settings"
      accessibilityHint={filtered ? 'List filters are active' : 'Filter the list or change which assets are shown'}
    >
      <Ionicons name="options-outline" size={20} color={filtered ? theme.colors.primary[500] : theme.colors.text.secondary} />
      {filtered && <View style={styles.filterIndicator} />}
    </PressableScale>
  );
}

/** Group the portfolio rows within the owning screen's vertical scroll. */
export function AssetList({ items, bitcoinUnit, showNetworks, hideBalances = false, emptyReason, onOpenSettings, onAssetPress }: Props) {
  const theme = useAppTheme();
  const styles = makeStyles(theme);

  const amountText = (item: AssetListItem): { amount: string; unit: string } => {
    if (item.isBtc) return { amount: formatBitcoinAmount(item.amount, bitcoinUnit), unit: bitcoinUnit };
    return { amount: formatTokenAmount(item.amount, item.precision), unit: item.ticker };
  };

  // "Spark", or "3 networks" when it lives on several (the icons say which).
  const whereLabel = (item: AssetListItem): string =>
    item.networks.length === 1 ? locationLabel(item, item.networks[0]) : `${item.networks.length} networks`;

  const locationLabel = (item: AssetListItem, network: AssetListItem['networks'][number]) => {
    const chain = item.isBtc ? item.holdings.find(holding => holding.network === network)?.chain : undefined;
    return chain ? btcNetworkLabel(network, chain) : networkLabel(network);
  };

  const renderRow = (item: AssetListItem, index: number) => {
    const { amount, unit } = amountText(item);
    const fiat = !hideBalances && item.usdValue !== undefined && item.usdValue > 0 ? formatUsd(item.usdValue) : null;
    const empty = !hideBalances && item.amount <= 0;
    const ticker = item.ticker !== item.name ? item.ticker : '';
    const location = showNetworks && item.networks.length ? `, on ${item.networks.map(network => locationLabel(item, network)).join(', ')}` : '';
    const identifier = item.assetIdLabel ? `, asset ID ${item.holdings[0].token?.asset_id}` : '';
    return (
      <PressableScale
        key={item.key}
        scaleTo={0.98}
        onPress={() => { feedback.select(); onAssetPress(item); }}
        accessibilityRole="button"
        accessibilityLabel={hideBalances
          ? `${item.name}${location}, balance hidden${identifier}`
          : `${item.name}, ${amount} ${unit}${fiat ? `, about ${fiat}` : ''}${location}${identifier}`}
        style={[styles.row, index < items.length - 1 && styles.rowDivider]}
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
          {item.assetIdLabel && <Text style={styles.subtitle} numberOfLines={1}>{item.assetIdLabel}</Text>}
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

  if (items.length) return <View style={styles.group}>{items.map(renderRow)}</View>;
  const empty = EMPTY_STATES[emptyReason ?? 'default'];
  return <EmptyState {...empty} actionLabel={emptyReason ? 'Edit asset settings' : undefined} onAction={onOpenSettings} />;
}

const makeStyles = (theme: ReturnType<typeof useAppTheme>) => StyleSheet.create({
  settingsButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: theme.borderRadius.full,
  },
  filterIndicator: {
    position: 'absolute', top: 9, right: 9,
    width: 6, height: 6, borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.primary[500],
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
