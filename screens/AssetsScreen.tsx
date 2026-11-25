// screens/AssetsScreen.tsx — every asset, one clear list.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
  ScrollView,
  DeviceEventEmitter,
} from 'react-native';
import { useSelector } from 'react-redux';
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
import { inventoryBtc, inventoryTokens, liteUsdAssetIds as liteUsdIdsOf } from '../utils/asset-inventory';
import { useAssetInventory } from '../hooks/useAssetInventory';
import { assetDetailForItem } from '../utils/asset-list-model';
import { useAssetListView } from '../hooks/useAssetListView';
import { snapshotWalletKey } from '../services/balanceSnapshot';

interface Props {
  navigation: any;
  route?: { params?: { issue?: boolean } };
}

const REFRESH_TIMEOUT_MS = 15000;

export default function AssetsScreen({ navigation, route }: Props) {
  // The shared asset inventory: the dashboard's refresh writes it.
  const btcBalance = useSelector((state: RootState) => state.wallet.btcBalance);
  const walletKey = useSelector((state: RootState) => snapshotWalletKey(state.wallet.activeWallet));
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
  const [refreshing, setRefreshing] = useState(false);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Lite folds its dollar assets into one USD line on the dashboard; do the same here.
  const liteUsdAssetIds = useMemo(() => (isLite ? liteUsdIdsOf(tokens) : undefined), [tokens, isLite]);
  const testProtocols = useMemo(() => {
    const { onchain, lightning, spark, arkade, bark } = btcBalance?.networkChains ?? {};
    return new Set([
      ...(onchain || lightning ? ['RGB'] : []),
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
});
