// screens/AssetsScreen.tsx — every asset, one clear list.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
  ScrollView,
} from 'react-native';
import { useSelector } from 'react-redux';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { RootState } from '../store';
import { theme } from '../theme';
import { ScreenHeader } from '../components/ScreenHeader';
import { AmountText } from '../components/AmountText';
import { AssetList, AssetListSettingsButton } from '../components/AssetList';
import { AssetListSettingsSheet } from '../components/AssetListSettingsSheet';
import { useRgbWalletSheets } from '../components/rgb/RgbWalletTools';
import { rgbAccountAdapter } from '../services/protocols';
import { rgbWalletSupport } from '../utils/rgb-wallet';
import { usePolicy } from '../hooks/usePolicy';
import { useBitcoinPrice, useDisplayAmount } from '../utils/bitcoinUnits';
import { tokenValueSats } from '../utils/portfolio';
import { btcInputFromWallet, buildAssetInventory, inventoryBtc, inventoryTokens, liteUsdAssetIds as liteUsdIdsOf } from '../utils/asset-inventory';
import { useAssetInventory } from '../hooks/useAssetInventory';
import { assetDetailForItem } from '../utils/asset-list-model';
import { useAssetListView } from '../hooks/useAssetListView';
import { snapshotWalletKey } from '../services/balanceSnapshot';
import { requestBalanceRefresh, type BalanceRefreshResult } from '../services/balanceRefresh';

interface Props {
  navigation: any;
  route?: { params?: { issue?: boolean } };
}

export default function AssetsScreen({ navigation, route }: Props) {
  const walletKey = useSelector((state: RootState) => snapshotWalletKey(state.wallet.activeWallet));
  const recordedPortfolio = useSelector((state: RootState) => state.wallet.portfolio);
  const portfolio = recordedPortfolio?.walletKey === walletKey ? recordedPortfolio : null;
  const liveBalance = useSelector((state: RootState) => recordedPortfolio && !portfolio ? null : state.wallet.btcBalance);
  const liveInventory = useAssetInventory();
  const btcBalance = portfolio ? portfolio.btcBalance : liveBalance;
  const inventory = useMemo(() => portfolio
    ? buildAssetInventory({ btc: btcInputFromWallet(portfolio.btcBalance), assets: portfolio.assets })
    : liveBalance ? liveInventory : [], [portfolio, liveBalance, liveInventory]);
  const btc = inventoryBtc(inventory);
  const tokens = useMemo(() => inventoryTokens(inventory), [inventory]);
  const bitcoinUnit = useSelector((state: RootState) => state.settings.bitcoinUnit);
  const hideBalances = useSelector((state: RootState) => state.settings.hideBalances);
  const btcPriceUSD = useBitcoinPrice() || portfolio?.btcPriceUSD || 0;
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
  const [refreshing, setRefreshing] = useState(false);
  const [refreshResult, setRefreshResult] = useState<BalanceRefreshResult>();
  const refreshRequest = useRef<Promise<BalanceRefreshResult> | undefined>(undefined);
  useEffect(() => {
    setRefreshing(false);
    setRefreshResult(undefined);
    return () => { refreshRequest.current = undefined; };
  }, [walletKey]);
  useFocusEffect(useCallback(() => {
    if (walletKey) void requestBalanceRefresh(walletKey).catch(() => undefined);
  }, [walletKey]));
  useEffect(() => {
    if (portfolio?.status === 'current') setRefreshResult(undefined);
  }, [portfolio?.status, portfolio?.updatedAt]);

  // Lite folds its dollar assets into one USD line on the dashboard; do the same here.
  const liteUsdAssetIds = useMemo(() => (isLite ? liteUsdIdsOf(tokens) : undefined), [tokens, isLite]);
  const testProtocols = useMemo(() => {
    const { onchain, spark, arkade, bark } = btcBalance?.networkChains ?? {};
    return new Set([
      ...(onchain ? ['RGB'] : []),
      ...(spark ? ['SPARK'] : []),
      ...(arkade ? ['ARKADE'] : []),
      ...(bark ? ['BARK'] : []),
    ]);
  }, [btcBalance?.networkChains]);

  const assetList = useAssetListView({
    btcNetworks: btc.networks,
    btcMainnetNetworks: btcBalance?.mainnetNetworks,
    btcNetworkChains: btcBalance?.networkChains,
    btcAvailable: btc.balance,
    // Before any balance is known, bitcoin isn't listed as zero.
    showBtc: btcBalance != null,
    assets: tokens,
    btcPriceUSD,
    liteUsdAssetIds,
    testProtocols,
  }, walletKey);

  // The headline matches the dashboard's: bitcoin held plus dollar tokens at $1.
  const totalSats = (btcBalance?.summary?.total ?? btcBalance?.vanilla?.spendable ?? 0)
    + tokenValueSats(tokens, btcPriceUSD, testProtocols);
  const total = formatDisplayAmount(totalSats);
  const hasHoldings = btcBalance != null || tokens.length > 0;
  const balanceStatus = refreshResult === 'unavailable' ? 'Could not refresh your balances.'
    : portfolio?.status === 'cached' ? 'Showing the last known balances.'
    : portfolio?.status === 'partial' || (!portfolio && refreshResult === 'partial') ? 'Some balances could not be refreshed.' : null;

  const refresh = async () => {
    if (refreshRequest.current) return;
    setRefreshing(true);
    setRefreshResult(undefined);
    const request = requestBalanceRefresh(walletKey);
    refreshRequest.current = request;
    const result = await request.catch((): BalanceRefreshResult => 'unavailable');
    if (refreshRequest.current === request) {
      refreshRequest.current = undefined;
      setRefreshing(false);
      setRefreshResult(result);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScreenHeader
        title="Assets"
        showBack
        rightAction={(
          <View style={styles.headerActions}>
            <AssetListSettingsButton onPress={assetList.openSettings} filtered={assetList.filtered} />
            {canIssue && (
              <TouchableOpacity style={styles.addButton} onPress={rgbSheets.openIssue}
                accessibilityRole="button" accessibilityLabel="Issue a new asset">
                <Ionicons name="add" size={22} color={theme.colors.text.primary} />
              </TouchableOpacity>
            )}
          </View>
        )}
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
          disabled={!hasHoldings}
          accessibilityLabel={hasHoldings ? `Total balance ${total.primary} ${total.unitLabel}. Tap to change unit.` : 'Total balance unavailable'}>
          <Text style={styles.totalLabel}>Total balance</Text>
          <View style={styles.totalRow}>
            <AmountText style={styles.totalAmount} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{hasHoldings ? total.primary : '—'}</AmountText>
            {hasHoldings && !total.hidden && (total.unitLabel === 'sats' || total.unitLabel === 'BTC') && (
              <Text style={styles.totalUnit}>{total.unitLabel}</Text>
            )}
          </View>
          {hasHoldings && !!total.secondary && <AmountText style={styles.totalSecondary}>{total.secondary}</AmountText>}
          {balanceStatus && <Text style={styles.balanceStatus} accessibilityLiveRegion="polite">
            {balanceStatus}{portfolio?.updatedAt ? ` Last updated ${new Date(portfolio.updatedAt).toLocaleString()}.` : ''}
          </Text>}
        </TouchableOpacity>

        <AssetList
          {...assetList.listProps}
          bitcoinUnit={bitcoinUnit}
          hideBalances={hideBalances}
          onAssetPress={(item) => {
            const asset = assetDetailForItem(item, bitcoinUnit);
            if (asset) navigation.navigate('AssetDetail', { asset });
          }}
        />
      </ScrollView>

      <AssetListSettingsSheet {...assetList.settingsProps} />
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
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing[1] },
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
  balanceStatus: {
    color: theme.colors.text.secondary,
    fontSize: theme.typography.fontSize.sm,
    marginTop: theme.spacing[2],
    textAlign: 'center',
  },
});
