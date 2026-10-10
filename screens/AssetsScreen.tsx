// screens/AssetsScreen.tsx — every asset, one clear list.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
  ScrollView,
  TextInput,
  DeviceEventEmitter,
} from 'react-native';
import { useSelector } from 'react-redux';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { RootState } from '../store';
import { theme } from '../theme';
import { ScreenHeader } from '../components/ScreenHeader';
import { AmountText } from '../components/AmountText';
import { PressableScale } from '../components/PressableScale';
import { EmptyState } from '../components/EmptyState';
import { AssetIcon } from '../components/AssetIcon';
import { NetworkIcon } from '../components/NetworkIcon';
import { NetworkStack } from '../components/NetworkStack';
import { useRgbWalletSheets } from '../components/rgb/RgbWalletTools';
import { rgbAccountAdapter } from '../services/protocols';
import { rgbWalletSupport } from '../utils/rgb-wallet';
import { usePolicy } from '../hooks/usePolicy';
import { formatBitcoinAmount, useBitcoinPrice, useDisplayAmount } from '../utils/bitcoinUnits';
import { getAssetFamily } from '../utils/account-routing';
import { formatUsd, tokenValueSats } from '../utils/portfolio';
import { inventoryBtc, inventoryTokens, liteUsdAssetIds as liteUsdIdsOf } from '../utils/asset-inventory';
import { useAssetInventory } from '../hooks/useAssetInventory';
import {
  ASSET_FILTERS,
  availableAssetFilters,
  buildAssetListItems,
  dominantHolding,
  filterAssetItems,
  formatTokenAmount,
  networkLabel,
  type AssetFilter,
  type AssetListItem,
} from '../utils/asset-list-model';

interface Props {
  navigation: any;
  route?: { params?: { issue?: boolean } };
}

const REFRESH_TIMEOUT_MS = 15000;
const HIDDEN = '••••';

export default function AssetsScreen({ navigation, route }: Props) {
  // The shared asset inventory: the dashboard's refresh writes it.
  const btcBalance = useSelector((state: RootState) => state.wallet.btcBalance);
  const inventory = useAssetInventory();
  const btc = inventoryBtc(inventory);
  const tokens = useMemo(() => inventoryTokens(inventory), [inventory]);
  const bitcoinUnit = useSelector((state: RootState) => state.settings.bitcoinUnit);
  const hideBalances = useSelector((state: RootState) => state.settings.hideBalances);
  const btcPriceUSD = useBitcoinPrice();
  const { format: formatDisplayAmount, cycle: cycleDenomination } = useDisplayAmount();
  const policy = usePolicy();
  const isLite = policy.level === 'lite';
  // Issuing RGB assets is an Advanced surface, offered only where the RGB account can issue.
  const canIssue = policy.showExperimental && rgbWalletSupport(rgbAccountAdapter()).issue.length > 0;
  const rgbSheets = useRgbWalletSheets({
    onViewAsset: (a) => navigation.navigate('AssetDetail', {
      asset: { asset_id: a.assetId, ticker: a.ticker, name: a.name, precision: a.precision, issued_supply: a.supply, isRGB: true, protocol: 'RGB', balance: { settled: a.supply, future: a.supply, spendable: a.supply } },
    }),
  });
  // "Issue asset" elsewhere in the app opens this screen with the issue form up.
  useEffect(() => {
    if (route?.params?.issue && canIssue) rgbSheets.openIssue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route?.params?.issue]);
  const [filter, setFilter] = useState<AssetFilter>('all');
  const [query, setQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Lite folds its dollar assets into one USD line on the dashboard; do the same here.
  const liteUsdAssetIds = useMemo(() => (isLite ? liteUsdIdsOf(tokens) : undefined), [tokens, isLite]);

  const items = useMemo(() => buildAssetListItems({
    btcNetworks: btc.networks,
    btcAvailable: btc.balance,
    // Before any balance is known, bitcoin isn't listed as zero.
    showBtc: btcBalance != null,
    assets: tokens,
    btcPriceUSD,
    liteUsdAssetIds,
  }), [btc, btcBalance, tokens, btcPriceUSD, liteUsdAssetIds]);

  const filters = policy.showNetworks ? availableAssetFilters(items) : (['all'] as AssetFilter[]);
  const activeFilter = filters.includes(filter) ? filter : 'all';
  const shown = filterAssetItems(items, activeFilter, query);

  // The headline matches the dashboard's: bitcoin held plus dollar tokens at $1.
  const totalSats = (btcBalance?.summary?.total ?? btcBalance?.vanilla?.spendable ?? 0)
    + tokenValueSats(tokens, btcPriceUSD, liteUsdAssetIds);
  const total = formatDisplayAmount(totalSats);

  // A refresh ends when the dashboard writes new balances (or after a while).
  useEffect(() => {
    if (!refreshing) return;
    setRefreshing(false);
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [btcBalance, inventory]);
  useEffect(() => () => { if (refreshTimer.current) clearTimeout(refreshTimer.current); }, []);

  const refresh = () => {
    setRefreshing(true);
    DeviceEventEmitter.emit('rate.refreshBalance');
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => setRefreshing(false), REFRESH_TIMEOUT_MS);
  };

  const openItem = (item: AssetListItem) => {
    if (item.isBtc) {
      const sats = item.amount;
      navigation.navigate('AssetDetail', {
        asset: {
          asset_id: 'BTC', ticker: 'BTC', name: 'Bitcoin', isRGB: false,
          precision: bitcoinUnit === 'BTC' ? 8 : 0, unit: bitcoinUnit, balance: { spendable: sats },
          fiatValue: item.usdValue,
        },
      });
      return;
    }
    // A token on several networks opens where most of it lives.
    const token = dominantHolding(item)?.token;
    if (!token) return;
    const family = getAssetFamily(token.asset_id, token.ticker);
    navigation.navigate('AssetDetail', {
      asset: {
        ...token,
        balance: token.balanceDetail ?? token.balance,
        isRGB: family === 'RGB',
        protocol: family,
        locations: item.holdings.map(h => ({ label: networkLabel(h.network), amount: h.amount, unit: item.ticker })),
        fiatValue: item.unitUsd !== undefined ? (dominantHolding(item)?.amount ?? 0) * item.unitUsd : undefined,
      },
    });
  };

  const amountText = (item: AssetListItem): { amount: string; unit: string } => {
    if (item.isBtc) return { amount: formatBitcoinAmount(item.amount, bitcoinUnit), unit: bitcoinUnit };
    return { amount: formatTokenAmount(item.amount, item.precision), unit: item.ticker };
  };

  // "Spark", or "3 networks" when it lives on several (the icons say which).
  const whereLabel = (item: AssetListItem): string =>
    item.networks.length === 1 ? networkLabel(item.networks[0]) : `${item.networks.length} networks`;

  const renderRow = (item: AssetListItem, index: number) => {
    const { amount, unit } = amountText(item);
    const fiat = item.usdValue !== undefined && item.usdValue > 0 ? formatUsd(item.usdValue) : null;
    const empty = item.amount <= 0;
    const ticker = item.ticker !== item.name ? item.ticker : '';
    return (
      <PressableScale
        key={item.key}
        scaleTo={0.98}
        onPress={() => openItem(item)}
        accessibilityRole="button"
        accessibilityLabel={hideBalances
          ? `${item.name}`
          : `${item.name}, ${amount} ${unit}${fiat ? `, about ${fiat}` : ''}${policy.showNetworks && item.networks.length ? `, on ${item.networks.map(networkLabel).join(', ')}` : ''}`}
        style={[styles.row, index < shown.length - 1 && styles.rowDivider]}
      >
        <AssetIcon ticker={item.ticker} logoUri={item.icon} size={40} showBadge={false} />
        <View style={styles.info}>
          <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
          {policy.showNetworks && item.networks.length > 0 ? (
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
          <AmountText style={[styles.amount, empty && styles.amountEmpty]} numberOfLines={1}>
            {hideBalances ? HIDDEN : amount} <Text style={styles.unit}>{unit}</Text>
          </AmountText>
          {fiat && <AmountText style={styles.fiat} numberOfLines={1}>{hideBalances ? HIDDEN : `≈ ${fiat}`}</AmountText>}
        </View>
        <Ionicons name="chevron-forward" size={16} color={theme.colors.text.tertiary} />
      </PressableScale>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScreenHeader
        title="Assets"
        showBack
        rightAction={canIssue ? (
          <TouchableOpacity style={styles.addButton} onPress={rgbSheets.openIssue}
            accessibilityRole="button" accessibilityLabel="Issue a new asset">
            <Ionicons name="add" size={22} color={theme.colors.text.primary} />
          </TouchableOpacity>
        ) : undefined}
      />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh}
            tintColor={theme.colors.primary[500]} colors={[theme.colors.primary[500]]} />
        }
      >
        <TouchableOpacity style={styles.totalBlock} onPress={cycleDenomination} accessibilityRole="button"
          accessibilityLabel={`Total balance ${total.primary} ${total.unitLabel}. Tap to change unit.`}>
          <Text style={styles.totalLabel}>Total balance</Text>
          <View style={styles.totalRow}>
            <AmountText style={styles.totalAmount} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{total.primary}</AmountText>
            {!total.hidden && (total.unitLabel === 'sats' || total.unitLabel === 'BTC') && (
              <Text style={styles.totalUnit}>{total.unitLabel}</Text>
            )}
          </View>
          {!!total.secondary && <AmountText style={styles.totalSecondary}>{total.secondary}</AmountText>}
        </TouchableOpacity>

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
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
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
      </ScrollView>

      {rgbSheets.sheets}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background.primary,
  },
  scroll: { flex: 1 },
  scrollContent: {
    paddingHorizontal: theme.spacing[4],
    paddingBottom: theme.spacing[8],
    gap: theme.spacing[3],
  },
  addButton: {
    width: 36,
    height: 36,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surface.secondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  totalBlock: {
    alignItems: 'center',
    paddingTop: theme.spacing[4],
    paddingBottom: theme.spacing[2],
  },
  totalLabel: {
    fontSize: theme.typography.fontSize.xs,
    fontWeight: theme.typography.fontWeight.medium,
    color: theme.colors.text.secondary,
  },
  totalRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'center',
    gap: theme.spacing[1.5],
    maxWidth: '100%',
  },
  totalAmount: {
    fontSize: theme.typography.fontSize['3xl'],
    fontWeight: '900',
    color: theme.colors.text.primary,
  },
  totalUnit: {
    fontSize: theme.typography.fontSize.base,
    fontWeight: theme.typography.fontWeight.medium,
    color: theme.colors.text.secondary,
  },
  totalSecondary: {
    fontFamily: theme.typography.fontFamily.mono,
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.text.tertiary,
    marginTop: theme.spacing[0.5],
  },
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
  // Same row style as the dashboard's asset list.
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
