import { runReceiveOperation as boundedBalanceRead } from '../utils/receive-session';
import { WalletSetupPrompt } from '../components/WalletSetupPrompt';
import { useAppSelector } from '../store/hooks';
import { bitcoinByNetwork, btcBalanceFromProtocols, mainnetBitcoinByNetwork, summarizeBitcoinBalances, withProtocolBalance, type BtcBalanceState } from '../utils/wallet-balance-summary';
import { saveBalanceSnapshot, snapshotWalletKey, takeBalanceSnapshot, type SnapshotChannel } from '../services/balanceSnapshot';
import { registerBalanceRefresh, type BalanceRefreshResult } from '../services/balanceRefresh';
import { adapterChain, receiveAccountChain } from '../services/kaleidoPay/connect';
import { chainLabel } from '../utils/receive-routes';
import type { AccountId } from '../utils/account-routing';
import { toEngineProtocol } from '../utils/protocol-bridge'
import { failedAccounts, offlineAccountNames } from '../utils/offline-accounts';
// screens/DashboardScreen.tsx
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Dimensions,
  StatusBar,
  DeviceEventEmitter,
  AppState,
  Alert,
} from 'react-native';
import { useFeature } from '../hooks/useFeature';
import { useDispatch, useSelector } from 'react-redux';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import { RootState } from '../store';
import { initializeProtocolServices } from '../services/initializeServices';
import { protocolManager, rgbAccountAdapter } from '../services/protocols';
import { setBtcBalance, setWalletPortfolio } from '../store/slices/walletSlice';
import { setProtocolAssets } from '../store/slices/assetsSlice';
import { loadNostrProfile } from '../store/slices/nostrSlice';
import {
  selectDisclosureLevel,
} from '../store/slices/settingsSlice';
import { policyFor } from '@kaleidorg/wallet-engine';

import { theme } from '../theme';
import {
  BalanceCard,
  ActionButtons,
  AssetList,
  SectionHeader,
  ChannelList,
  MainHeader
} from '../components';
import { Sheet } from '../components/Sheet';
import { AssetListSettingsButton } from '../components/AssetList';
import { AssetListSettingsSheet } from '../components/AssetListSettingsSheet';
import { RecentActivityWidget } from '../components/RecentActivityWidget';
import { InsightCards } from '../components/mind/InsightCards';
import { ProfileChip } from '../components/ProfileChip';
import { formatBitcoinAmount, useBitcoinConversion, useDisplayAmount } from '../utils/bitcoinUnits';
import { formatAssetAmount } from '../utils/assetAmount';
import {
  assetRecordFromUnified, buildAssetInventory, inventoryBtc, inventoryTokens, liteUsdAssetIds as liteUsdIdsOf, replaceProtocolAssets, withSnapshotFallback,
  type InventoryAsset, type InventoryRecord,
} from '../utils/asset-inventory';
import { breakdownAssetRows, tokenValueSats as priceTokensInSats } from '../utils/portfolio';

import { assetDetailForItem } from '../utils/asset-list-model';
import { useAssetListView } from '../hooks/useAssetListView';
import { readBarkRecovery, syncBarkForUpdates } from '../services/BarkService';
import { getStoredHandle } from '../services/kaleidoswapMe';
import { markWalletStartup } from '../utils/walletPerformance';
import { qualifySnapshotNetworks } from '../services/portfolioNetworks';

const { width } = Dimensions.get('window');

interface Props {
  navigation: any;
}

interface Channel {
  channel_id: string;
  funding_txid: string;
  peer_pubkey: string;
  peer_alias: string;
  short_channel_id: number;
  status: 'Opening' | 'Opened' | 'Closing';
  ready: boolean;
  capacity_sat: number;
  local_balance_sat: number;
  outbound_balance_msat: number;
  inbound_balance_msat: number;
  next_outbound_htlc_limit_msat: number;
  next_outbound_htlc_minimum_msat: number;
  is_usable: boolean;
  public: boolean;
  asset_id: string;
  asset_local_amount: number;
  asset_remote_amount: number;
}

/**
 * A time-of-day greeting with a little variety so it changes between opens.
 * The name is never part of it: the profile chip shows the name right under
 * the greeting, so appending it here would only repeat it.
 */
function buildGreeting(): string {
  const hour = new Date().getHours();
  const pool =
    hour < 5 ? ['Still up', 'Good night', 'Hi']
    : hour < 12 ? ['Good morning', 'Morning', 'Rise and shine']
    : hour < 17 ? ['Good afternoon', 'Hey there', 'Hi']
    : hour < 21 ? ['Good evening', 'Evening', 'Welcome back']
    : ['Good night', 'Winding down', 'Hi'];
  return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * Accounts on a test network, with the network's name. Their sats have no value:
 * kept out of the total and its fiat figure, and shown on their own line.
 */
type PortfolioTestNetworks = Partial<Record<AccountId | 'LN', string>>;

function testNetworkLabels(lastKnown?: PortfolioTestNetworks): PortfolioTestNetworks {
  const out: PortfolioTestNetworks = {};
  for (const account of ['RGB', 'SPARK', 'ARKADE', 'BARK'] as AccountId[]) {
    const chain = receiveAccountChain(account);
    if (chain && chain !== 'mainnet') out[account] = chainLabel(chain);
    if (!chain && lastKnown?.[account]) out[account] = lastKnown[account];
  }
  const node = protocolManager.getAdapterIfAvailable('RGB_LN');
  const lnChain = node?.isConnected() && node !== rgbAccountAdapter() ? adapterChain('RGB_LN', node) : undefined;
  if (lnChain && lnChain !== 'mainnet') out.LN = chainLabel(lnChain);
  if (!lnChain && lastKnown?.LN) out.LN = lastKnown.LN;
  return out;
}

function btcNetworkChains(testNetworks: ReturnType<typeof testNetworkLabels>) {
  return { onchain: testNetworks.RGB, lightning: testNetworks.LN ?? testNetworks.RGB, spark: testNetworks.SPARK, arkade: testNetworks.ARKADE, bark: testNetworks.BARK };
}

function portfolioBalance(balance: BtcBalanceState, channels: SnapshotChannel[], rgbIsLightning: boolean, testNetworks = testNetworkLabels()) {
  const balances = balance.byProtocol ?? {};
  const testProtocols = new Set(Object.keys(testNetworks).filter(account => testNetworks[account as AccountId | 'LN']));
  return {
    ...balance,
    summary: summarizeBitcoinBalances(balances, channels, rgbIsLightning, testProtocols),
    networks: bitcoinByNetwork(balances, channels, rgbIsLightning),
    mainnetNetworks: mainnetBitcoinByNetwork(balances, channels, rgbIsLightning, testProtocols),
    networkChains: btcNetworkChains(testNetworks),
  };
}

const EMPTY_BTC_BALANCE = {
  vanilla: { settled: 0, future: 0, spendable: 0 },
  colored: { settled: 0, future: 0, spendable: 0 },
};
const EMPTY_CHANNELS: SnapshotChannel[] = [];
const EMPTY_ASSETS: InventoryRecord[] = [];

/** Lite's group includes assets held in a Lightning channel. */
function assetTotalBaseUnits(asset: InventoryAsset): number {
  const detail = asset.balanceDetail;
  return detail ? Number(detail.settled ?? asset.balance)
    + Number(detail.offchain_inbound ?? 0) + Number(detail.offchain_outbound ?? 0) : asset.balance;
}

/** How long the first balance waits for every account before showing the connected ones. */
const EARLY_BALANCE_MS = 2_500;

function anyAccountConnected(): boolean {
  return (['RGB', 'SPARK', 'ARKADE', 'BARK'] as const).some(
    (p) => protocolManager.getAdapterIfAvailable(toEngineProtocol(p))?.isConnected() ?? false,
  );
}

export default function DashboardScreen({ navigation }: Props) {
  const isScreenFocused = useIsFocused();
  const lspOn = useFeature('lsp');
  const activeWallet = useAppSelector(state => state.wallet.activeWallet);
  const walletKey = snapshotWalletKey(activeWallet);
  const [displayWalletKey, setDisplayWalletKey] = useState(walletKey);
  const displayingCurrentWallet = walletKey === displayWalletKey;
  const needsSetup = !activeWallet?.encrypted_mnemonic;
  const dispatch = useDispatch();
  const bitcoinUnit = useSelector((state: RootState) => state.settings.bitcoinUnit);
  // Top-left identity is the user's Nostr profile, with the greeting above the name.
  const nostrProfile = useSelector((state: RootState) => state.nostr?.profile ?? null);
  const hasNostrIdentity = useSelector((state: RootState) => !!state.nostr?.publicKey);
  const greeting = useMemo(() => buildGreeting(), []);
  const openProfile = useCallback(
    () => navigation.navigate(hasNostrIdentity ? 'Profile' : 'NostrSettings'),
    [navigation, hasNostrIdentity],
  );
  // The identity's payable line: the kaleidoswap.me handle when set, else the
  // Nostr lightning address. Under the name in the profile chip.
  const [payableLine, setPayableLine] = useState<string | null>(null);
  useFocusEffect(useCallback(() => {
    let active = true;
    const id = activeWallet?.id;
    if (id == null) { setPayableLine(null); return; }
    void getStoredHandle(id).then(handle => {
      if (active) setPayableLine(handle?.lightningAddress ?? (nostrProfile?.lud16?.trim() || null));
    }, () => {});
    return () => { active = false; };
  }, [activeWallet?.id, nostrProfile?.lud16]));

  // If Nostr is connected but we never pulled the profile (the wallet-side
  // connect path doesn't fetch it, and a restored connection doesn't either),
  // fetch it once so the header can show the account's name.
  const nostrConnected = useSelector(
    (state: RootState) => !!(state.nostr?.isConnected || state.nostr?.hasStoredKeys),
  );
  const nostrProfileLoaded = useSelector((state: RootState) => !!state.nostr?.profile);
  const nwcWalletType = useSelector((state: RootState) => state.nostr?.nwcWalletType);
  const nwcCapabilities = useSelector((state: RootState) => state.nostr?.nwcCapabilities ?? []);
  const triedNostrProfile = useRef(false);
  useEffect(() => {
    if (nostrConnected && !nostrProfileLoaded && !triedNostrProfile.current) {
      triedNostrProfile.current = true;
      dispatch(loadNostrProfile() as any);
    }
  }, [nostrConnected, nostrProfileLoaded, dispatch]);
  const disclosureLevel = useSelector(selectDisclosureLevel);
  const policy = policyFor(disclosureLevel);
  const isLite = disclosureLevel === 'lite';
  const [isConnecting, setIsConnecting] = useState(true);
  const [balanceUpdatedAt, setBalanceUpdatedAt] = useState<number | undefined>();
  const [balanceWarning, setBalanceWarning] = useState<string | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  // Accounts that failed to connect at startup; the banner names those still not connected.
  const [startupFailures, setStartupFailures] = useState<string[]>([]);
  const attemptedAccounts = useRef(new Set<string>());
  const offlineAccounts = offlineAccountNames(startupFailures, (p) =>
    protocolManager.getAdapterIfAvailable(p as any)?.isConnected() ?? false);
  const [protocolsReady, setProtocolsReady] = useState(false);
  // Startup initializes protocols and then fetches balances in the same async
  // focus callback. React state does not update synchronously, so reading
  // `protocolsReady` from that callback used to see the initial false value and
  // skip the first balance load. These refs are the immediate lifecycle gates;
  // state remains the source of truth for rendering.
  const protocolsReadyRef = useRef(false);
  const [showChannels, setShowChannels] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  // The same live BTC price the fiat figures use (redux's btcPriceUSD is rarely set).
  const { formatSatoshisToUSD, bitcoinPrice: liveBtcPrice } = useBitcoinConversion();
  // Denomination-aware formatter for the headline balance (tap to cycle sats/BTC/fiat).
  const { format: formatDisplayAmount, cycle: cycleDenomination } = useDisplayAmount();
  const [loading, setLoading] = useState(true);
  const [pendingBalanceAccounts, setPendingBalanceAccounts] = useState<string[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [btcBalance, setBtcBalanceState] = useState<BtcBalanceState>(EMPTY_BTC_BALANCE);
  const balanceStateRef = useRef(btcBalance);
  const setDisplayedBalance = (balance: BtcBalanceState) => {
    balanceStateRef.current = balance;
    setBtcBalanceState(balance);
  };
  // Live assets are in redux (the asset inventory every screen reads); the
  // last known ones stand in here until this wallet's accounts answer.
  const liveAssets = useAppSelector(state => state.assets.rgbAssets) as InventoryRecord[];
  const liveAssetsRef = useRef(liveAssets);
  liveAssetsRef.current = liveAssets;
  const [snapshotAssets, setSnapshotAssets] = useState<InventoryRecord[]>([]);
  const snapshotAssetsRef = useRef<InventoryRecord[]>([]);
  // Accounts that listed their assets live for this wallet: until then their last known ones show.
  const [listedProtocols, setListedProtocols] = useState<string[]>([]);
  const listedProtocolsRef = useRef(new Set<string>());
  const initDoneRef = useRef(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const refreshFlight = useRef<{ wallet: typeof activeWallet; work: Promise<BalanceRefreshResult> } | undefined>(undefined);
  // Last known balances (per wallet) shown at launch until the live ones land.
  const [showingSnapshot, setShowingSnapshot] = useState(false);
  const [snapshotChannels, setSnapshotChannels] = useState<SnapshotChannel[]>([]);
  const [snapshotPrice, setSnapshotPrice] = useState(0);
  const [snapshotRgbIsLightning, setSnapshotRgbIsLightning] = useState<boolean>();
  const snapshotTestNetworks = useRef<PortfolioTestNetworks>({});
  const lastRgbIsLightning = useRef<boolean | undefined>(undefined);
  const [channelsLive, setChannelsLive] = useState(false);
  const lastChannelsRef = useRef<SnapshotChannel[]>([]);
  const lastCompleteAt = useRef<number | undefined>(undefined);
  const snapshotReady = useRef<Promise<void>>(Promise.resolve());
  const activeWalletRef = useRef(activeWallet);
  activeWalletRef.current = activeWallet;
  const btcPriceRef = useRef(0);
  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);
  const currentWallet = (wallet: typeof activeWallet) => mountedRef.current && activeWalletRef.current === wallet;

  // Modal state for channel details
  const [channelModalVisible, setChannelModalVisible] = useState(false);
  const [selectedChannel, setSelectedChannel] = useState<Channel | null>(null);

  // Initialize protocol services (only once)
  const initializeApi = useCallback(async () => {
    if (needsSetup) return false;
    if (protocolsReadyRef.current) return true; // Already initialized
    const walletAtStart = activeWalletRef.current;

    try {
      console.log('Initializing protocol services...');
      const { results } = await initializeProtocolServices();
      if (!currentWallet(walletAtStart)) return false;

      const anyConnected = Array.from(results.values()).some(r => r.success);

      // Report which protocols failed (non-blocking). A `skipped:` error is an
      // expected unconfigured state (e.g. RGB with no NWC node paired), not a
      // failure — keep it out of the warning so a fresh wallet logs clean.
      const failed: string[] = [];
      const skipped: string[] = [];
      for (const [proto, result] of results) {
        if (result.success) continue;
        const entry = `${proto}: ${result.error || 'failed'}`;
        (result.error?.startsWith('skipped:') ? skipped : failed).push(entry);
      }
      if (failed.length > 0) {
        console.warn('[Dashboard] Protocol failures:', failed.join(', '));
      }
      const failedProtocols = failedAccounts(results);
      attemptedAccounts.current = new Set([...failedProtocols, ...Array.from(results).filter(([, result]) => result.success).map(([protocol]) => protocol)]);
      setStartupFailures(failedProtocols);
      if (skipped.length > 0) {
        console.log('[Dashboard] Protocols skipped:', skipped.join(', '));
      }

      if (anyConnected) {
        protocolsReadyRef.current = true;
        setProtocolsReady(true);
        // Show warning toast if some protocols failed but at least one connected
        if (failed.length > 0) {
          const connected = Array.from(results.entries()).filter(([, r]) => r.success).map(([p]) => p);
          setConnectionError(null); // Clear any previous hard error
          console.log(`[Dashboard] Connected: ${connected.join(', ')} | Failed: ${failed.join(', ')}`);
        }
        return true;
      }

      // Check if any adapter is already connected from a previous init
      const protocols: Array<'RGB' | 'SPARK' | 'ARKADE' | 'BARK'> = ['RGB', 'SPARK', 'ARKADE', 'BARK'];
      for (const proto of protocols) {
        const adapter = protocolManager.getAdapterIfAvailable(toEngineProtocol(proto));
        if (adapter?.isConnected()) {
          protocolsReadyRef.current = true;
          setProtocolsReady(true);
          return true;
        }
      }

      // Nothing connected — show error with details (include skipped reasons so
      // the user knows what still needs configuring).
      const details = [...failed, ...skipped];
      if (details.length > 0) {
        setConnectionError(`Failed to connect:\n${details.join('\n')}`);
      } else {
        setConnectionError('No wallet protocols connected. Please configure a wallet.');
      }
      return null;
    } catch (error) {
      console.error('Failed to initialize protocol services:', error);
      if (currentWallet(walletAtStart)) setConnectionError(error instanceof Error ? error.message : 'Failed to initialize');
      return null;
    }
  }, [needsSetup]);

  const loadDashboardData = async (showLoadingIndicator = true): Promise<BalanceRefreshResult> => {
    const walletAtStart = activeWalletRef.current;
    const keyAtStart = snapshotWalletKey(walletAtStart);
    const current = () => currentWallet(walletAtStart);
    if (!protocolsReadyRef.current || !keyAtStart) return 'unavailable';

    try {
      setIsUpdating(true);
      if (showLoadingIndicator) setLoading(true);

      const rgbAdapter = rgbAccountAdapter();
      const sparkAdapter = protocolManager.getAdapterIfAvailable('SPARK');
      const arkadeAdapter = protocolManager.getAdapterIfAvailable('ARKADE');
      const barkAdapter = protocolManager.getAdapterIfAvailable('BARK');
      // A plain NWC Lightning wallet has its own line beside RGB on this phone.
      const nodeSlot = protocolManager.getAdapterIfAvailable('RGB_LN');
      const lightningWallet = nodeSlot !== rgbAdapter ? nodeSlot : null;
      const requestedBalances = [
        [rgbAdapter, 'RGB'], [sparkAdapter, 'SPARK'], [arkadeAdapter, 'ARKADE'],
        [barkAdapter, 'BARK'], [lightningWallet, 'LN'],
      ] as const;
      const connected = requestedBalances.filter(([adapter]) => adapter?.isConnected());
      const attempted = attemptedAccounts.current;
      const absent = (protocol: typeof requestedBalances[number][1]) => initDoneRef.current && (
        protocol === 'RGB' ? !attempted.has('RGB_LN') && !attempted.has('RGB_L1')
          : protocol === 'LN' ? !attempted.has('RGB_LN') || rgbAdapter === nodeSlot
          : !attempted.has(protocol)
      );
      const offlineBalances = requestedBalances.filter(([adapter, protocol]) => !adapter?.isConnected() && !absent(protocol));
      let barkSyncFailed = false;

      setPendingBalanceAccounts(connected.map(([, protocol]) => protocol));
      const balancesTask = Promise.all(connected.map(async ([adapter, protocol]) => {
        try {
          // A failed Bark sync must not hide the last local balance.
          if (protocol === 'BARK') {
            await boundedBalanceRead('Bark sync', () => syncBarkForUpdates(), 20_000)
              .catch(error => { barkSyncFailed = true; console.warn('Bark sync failed:', error); });
          }
          const btc = await boundedBalanceRead(`${protocol} balance`, () => adapter!.getBtcBalance(), 60_000);
          if (current()) {
            markWalletStartup('first-live-balance');
            setDisplayedBalance(withProtocolBalance(balanceStateRef.current, protocol, btc));
          }
          return { protocol, btc };
        } catch (error) {
          console.warn('Balance fetch error:', error);
          return { protocol };
        } finally {
          if (current()) setPendingBalanceAccounts(accounts => accounts.filter(p => p !== protocol));
        }
      }));

      const requestedAssets = [[rgbAdapter, 'RGB'], [sparkAdapter, 'SPARK'], [arkadeAdapter, 'ARKADE']] as const;
      const assetsTask = Promise.all(requestedAssets.map(async ([adapter, protocol]) => {
        let assets: InventoryRecord[] | undefined;
        if (adapter?.isConnected()) {
          try {
            const records = await boundedBalanceRead(`${protocol} assets`, () => adapter.listAssets(), 60_000);
            assets = records.map(asset => assetRecordFromUnified(asset, protocol))
              .filter((record): record is InventoryRecord => record !== null);
          } catch (error) {
            console.warn('Asset fetch error:', error);
            return { protocol, failed: true as const };
          }
        } else if (absent(protocol)) {
          // No configured adapter after initialization is the only missing account
          // that may clear its previous rows. An error is never an empty list.
          assets = [];
        }
        if (assets && current()) {
          dispatch(setProtocolAssets({ protocol, assets, walletKey: keyAtStart }));
          listedProtocolsRef.current.add(protocol);
          setListedProtocols(Array.from(listedProtocolsRef.current));
        }
        return { protocol, assets };
      }));

      const connectedWalletType = (rgbAdapter as any)?.walletType?.() ?? nwcWalletType;
      const canManageChannels = connectedWalletType == null || nwcCapabilities.includes('manageChannels');
      const hasChannels = rgbAdapter?.isConnected() && connectedWalletType !== 'ln' && canManageChannels;
      const channelsTask: Promise<Channel[] | undefined> = hasChannels && rgbAdapter
        ? boundedBalanceRead('Lightning channels', async () => await rgbAdapter.listChannels() as Channel[], 60_000)
          .catch(error => { console.warn('Channel fetch error:', error); return undefined; })
        : Promise.resolve(rgbAdapter?.isConnected() || absent('RGB') ? [] : undefined);
      const [balanceResults, assetResults, channelsList] = await Promise.all([balancesTask, assetsTask, channelsTask]);
      const barkRecovery = barkAdapter?.isConnected()
        ? await boundedBalanceRead('Bark recovery', () => readBarkRecovery(), 10_000).catch(() => null)
        : null;
      await snapshotReady.current;
      if (!current()) return 'unavailable';

      const balanceFailures = balanceResults.filter(result => !result.btc).map(result => result.protocol);
      const assetFailures = assetResults.filter(result => result.failed).map(result => result.protocol);
      const channelsFailed = !!hasChannels && channelsList === undefined;
      const barkIncomplete = barkSyncFailed || barkRecovery === 'failed' || barkRecovery === 'incomplete';
      const complete = initDoneRef.current && connected.length > 0 && offlineBalances.length === 0
        && !balanceFailures.length && !assetFailures.length && !channelsFailed && !barkIncomplete;
      const warnings = [
        balanceFailures.length ? `Could not refresh ${balanceFailures.join(', ')} balances.` : null,
        assetFailures.length ? `Could not refresh ${assetFailures.join(', ')} assets.` : null,
        channelsFailed ? 'Could not refresh Lightning channels.' : null,
        barkIncomplete ? 'Bark recovery is incomplete, so its balance may omit funds.' : null,
        initDoneRef.current && offlineBalances.length ? 'Some accounts could not refresh. Your total may be incomplete.' : null,
      ].filter(Boolean);
      setBalanceWarning(warnings.length ? warnings.join(' ') : null);

      if (channelsList) {
        lastChannelsRef.current = channelsList;
        setChannels(channelsList);
        setChannelsLive(true);
      }

      let assets = withSnapshotFallback(liveAssetsRef.current, snapshotAssetsRef.current);
      for (const result of assetResults) {
        if (result.assets) assets = replaceProtocolAssets(assets, result.protocol, result.assets);
      }
      // Keep the display's last known assets even across multiple partial refreshes.
      snapshotAssetsRef.current = assets;
      setSnapshotAssets(assets);

      const byProtocol = { ...balanceStateRef.current.byProtocol };
      if (initDoneRef.current) {
        for (const [adapter, protocol] of requestedBalances) {
          if (!adapter?.isConnected() && absent(protocol)) delete byProtocol[protocol];
        }
      }
      const balance = btcBalanceFromProtocols(byProtocol);
      setDisplayedBalance(balance);
      setShowingSnapshot(false);
      const rgbIsLightning = rgbAdapter?.isConnected() ? typeof (rgbAdapter as any)?.walletType === 'function' : !!lastRgbIsLightning.current;
      lastRgbIsLightning.current = rgbIsLightning;
      setSnapshotRgbIsLightning(rgbIsLightning);
      const testNetworks = testNetworkLabels(complete ? undefined : snapshotTestNetworks.current);
      snapshotTestNetworks.current = testNetworks;
      const btc = portfolioBalance(balance, lastChannelsRef.current, rgbIsLightning, testNetworks);
      if (complete) {
        lastCompleteAt.current = Date.now();
        setBalanceUpdatedAt(lastCompleteAt.current);
        // A partial refresh never replaces the last complete on-disk snapshot.
        void saveBalanceSnapshot(walletAtStart, {
          byProtocol, assets, channels: lastChannelsRef.current, btcPriceUSD: btcPriceRef.current, rgbBalanceIsLightning: rgbIsLightning, testNetworks,
        });
      }
      const liveBalances = Object.fromEntries(balanceResults.flatMap(result => result.btc ? [[result.protocol, result.btc]] : []));
      if (Object.keys(liveBalances).length) {
        dispatch(setBtcBalance({ walletKey: keyAtStart,
          balance: complete ? btc : portfolioBalance(btcBalanceFromProtocols(liveBalances), channelsList ?? [], rgbIsLightning),
        }));
      }
      dispatch(setWalletPortfolio({
        walletKey: keyAtStart, btcBalance: Object.keys(byProtocol).length ? btc : null, assets, btcPriceUSD: btcPriceRef.current,
        updatedAt: lastCompleteAt.current, status: complete ? 'current' : 'partial',
      }));
      if (complete) return 'complete';
      return balanceResults.some(result => result.btc) || assets.length > 0 ? 'partial' : 'unavailable';
    } catch (error) {
      console.error('Failed to load dashboard data:', error);
      if (current()) setBalanceWarning('Your balances could not be refreshed.');
      return 'unavailable';
    } finally {
      if (current()) {
        setIsUpdating(false);
        if (showLoadingIndicator) setLoading(false);
      }
    }
  };

  const connectAndLoad = async (): Promise<BalanceRefreshResult> => {
    const walletAtStart = activeWalletRef.current;
    setIsConnecting(true);
    setConnectionError(null);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      // Show accounts that are already connected without waiting for every SDK.
      const init = initializeApi();
      const initFirst = await Promise.race([
        init.then(() => true),
        new Promise<false>(resolve => { timer = setTimeout(() => resolve(false), EARLY_BALANCE_MS); }),
      ]);
      if (timer) clearTimeout(timer);
      if (!currentWallet(walletAtStart)) return 'unavailable';
      if (!initFirst && anyAccountConnected()) {
        protocolsReadyRef.current = true;
        setProtocolsReady(true);
        await loadDashboardData(true);
      }
      if (!await init || !currentWallet(walletAtStart)) return 'unavailable';
      initDoneRef.current = true;
      return await loadDashboardData(initFirst);
    } finally {
      if (currentWallet(walletAtStart)) {
        setIsConnecting(false);
        setLoading(false);
      }
    }
  };

  const runRefresh = (): Promise<BalanceRefreshResult> => {
    const wallet = activeWalletRef.current;
    if (!wallet?.encrypted_mnemonic) return Promise.resolve('unavailable');
    if (refreshFlight.current?.wallet === wallet) return refreshFlight.current.work;

    const work = (protocolsReadyRef.current ? loadDashboardData(false) : connectAndLoad())
      .catch((): BalanceRefreshResult => 'unavailable')
      .finally(() => { if (refreshFlight.current?.work === work) refreshFlight.current = undefined; });
    refreshFlight.current = { wallet, work };
    return work;
  };

  const refreshRef = useRef(runRefresh);
  refreshRef.current = runRefresh;
  useEffect(() => {
    setDisplayWalletKey(walletKey);
    protocolsReadyRef.current = false;
    initDoneRef.current = false;
    attemptedAccounts.current.clear();
    setProtocolsReady(false);
    setStartupFailures([]);
    setBalanceWarning(null);
  }, [activeWallet]);

  // A different wallet starts with its own local snapshot, independently of the network.
  useEffect(() => {
    setDisplayedBalance(EMPTY_BTC_BALANCE);
    setPendingBalanceAccounts([]);
    snapshotAssetsRef.current = [];
    setSnapshotAssets([]);
    listedProtocolsRef.current.clear();
    setListedProtocols([]);
    setChannels([]);
    setChannelsLive(false);
    lastChannelsRef.current = [];
    setSnapshotChannels([]);
    setSnapshotPrice(0);
    setSnapshotRgbIsLightning(undefined);
    lastRgbIsLightning.current = undefined;
    snapshotTestNetworks.current = {};
    setShowingSnapshot(false);
    lastCompleteAt.current = undefined;
    setBalanceUpdatedAt(undefined);
    snapshotReady.current = Promise.resolve();
    const walletAtStart = activeWalletRef.current;
    if (!walletKey || needsSetup || !walletAtStart) return;

    let cancelled = false;
    snapshotReady.current = takeBalanceSnapshot(walletAtStart).then(async stored => {
      if (!stored) return;
      const snap = await qualifySnapshotNetworks(walletAtStart, stored);
      if (cancelled || snapshotWalletKey(activeWalletRef.current) !== walletKey
        || (!Object.keys(snap.byProtocol).length && !snap.assets.length && !snap.channels.length)) return;
      const balance = btcBalanceFromProtocols({ ...snap.byProtocol, ...balanceStateRef.current.byProtocol });
      setDisplayedBalance(balance);
      snapshotAssetsRef.current = snap.assets;
      setSnapshotAssets(snap.assets);
      lastChannelsRef.current = snap.channels;
      setSnapshotChannels(snap.channels);
      setSnapshotPrice(snap.btcPriceUSD);
      setSnapshotRgbIsLightning(snap.rgbBalanceIsLightning);
      lastRgbIsLightning.current = snap.rgbBalanceIsLightning;
      snapshotTestNetworks.current = snap.testNetworks ?? {};
      lastCompleteAt.current = snap.savedAt;
      setBalanceUpdatedAt(snap.savedAt);
      setShowingSnapshot(true);
      dispatch(setWalletPortfolio({
        walletKey, btcBalance: Object.keys(snap.byProtocol).length ? portfolioBalance(balance, snap.channels, snap.rgbBalanceIsLightning
          ?? (typeof (rgbAccountAdapter() as any)?.walletType === 'function'), testNetworkLabels(snap.testNetworks)) : null,
        assets: snap.assets, btcPriceUSD: snap.btcPriceUSD, updatedAt: snap.savedAt, status: 'cached',
      }));
    });
    return () => { cancelled = true; };
  }, [walletKey, needsSetup]);

  // All triggers share the in-flight request, including Assets pull-to-refresh.
  const refreshWallet = () => {
    if (connectionError || offlineAccounts.length) protocolsReadyRef.current = false;
    return runRefresh();
  };
  const manualRefreshRef = useRef(refreshWallet);
  manualRefreshRef.current = refreshWallet;
  useEffect(() => {
    if (!walletKey || needsSetup) return;
    return registerBalanceRefresh(walletKey, () => manualRefreshRef.current());
  }, [walletKey, needsSetup]);

  useFocusEffect(useCallback(() => {
    if (AppState?.currentState !== 'background' && AppState?.currentState !== 'inactive') void manualRefreshRef.current();
    const subscription = AppState?.addEventListener('change', state => {
      if (state === 'active') void manualRefreshRef.current();
    });
    return () => subscription?.remove();
  }, [activeWallet]));

  useEffect(() => {
    if (!walletKey || !protocolsReady || !isScreenFocused) return;
    const timer = setInterval(() => {
      if (AppState?.currentState !== 'background' && AppState?.currentState !== 'inactive') void refreshRef.current();
    }, 30_000);
    return () => clearInterval(timer);
  }, [walletKey, protocolsReady, isScreenFocused]);

  // Payments request an immediate refresh and a coalesced settling follow-up.
  useEffect(() => {
    if (!walletKey || needsSetup) return;
    let settling: ReturnType<typeof setTimeout> | undefined;
    let payment = 0;
    let active = true;
    const refresh = () => {
      if (AppState?.currentState !== 'background' && AppState?.currentState !== 'inactive') return manualRefreshRef.current();
    };
    const sub = DeviceEventEmitter.addListener('rate.refreshBalance', () => {
      const attempt = ++payment;
      const work = refresh();
      if (settling) clearTimeout(settling);
      settling = setTimeout(async () => {
        await work;
        if (active && payment === attempt) void refresh();
      }, 2500);
    });
    return () => { active = false; sub.remove(); if (settling) clearTimeout(settling); };
  }, [walletKey, needsSetup]);

  const onRefresh = async (silent = false) => {
    if (!silent) setRefreshing(true);
    try {
      await refreshWallet();
    } finally {
      if (!silent && mountedRef.current) setRefreshing(false);
    }
  };

  const formatSatoshis = (satoshis: number): string => {
    return formatBitcoinAmount(satoshis, bitcoinUnit);
  };

  const formatUSD = (satoshis: number): string => {
    return formatSatoshisToUSD(satoshis);
  };

  const getTotalBtcBalance = (): number => {
    if (!displayingCurrentWallet) return 0;
    return btcBalance.vanilla.spendable + btcBalance.colored.spendable;
  };

  const hasChannelCapableNode =
    (protocolManager.getAdapterIfAvailable('RGB_LN')?.isConnected() ?? false)
    && ((protocolManager.getAdapterIfAvailable('RGB_LN') as any)?.walletType?.() ?? nwcWalletType) !== 'ln'
    && (nwcWalletType == null || nwcCapabilities.includes('manageChannels'));

  const btcPriceUSD = liveBtcPrice || snapshotPrice;
  btcPriceRef.current = btcPriceUSD;
  const protocolBalances = displayingCurrentWallet ? btcBalance.byProtocol : undefined;
  // NWC reports Lightning funds already; HTTP RLN reports on-chain funds.
  const rgbAdapter = rgbAccountAdapter();
  const rgbBalanceIsLightning = rgbAdapter?.isConnected()
    ? typeof (rgbAdapter as any)?.walletType === 'function' : !!snapshotRgbIsLightning;
  // Accounts on a test network hold sats with no value: kept out of the total and its
  // fiat figure, and shown on their own line.
  const { RGB, SPARK, ARKADE, BARK, LN } = showingSnapshot ? snapshotTestNetworks.current : testNetworkLabels(snapshotTestNetworks.current);
  const testNetworks = useMemo(() => ({ RGB, SPARK, ARKADE, BARK, LN }), [RGB, SPARK, ARKADE, BARK, LN]);
  const testProtocols = useMemo(() => new Set(Object.keys(testNetworks).filter(account => testNetworks[account as AccountId | 'LN'])), [testNetworks]);
  // Until this wallet's channels load, its last known ones stand in for the total.
  const summaryChannels = displayingCurrentWallet ? (channelsLive ? channels : snapshotChannels) : EMPTY_CHANNELS;
  const offChainBalance = summaryChannels.reduce((sum, channel) => sum + channel.local_balance_sat, 0);
  const bitcoinSummary = useMemo(() => summarizeBitcoinBalances(
    protocolBalances ?? {}, summaryChannels, rgbBalanceIsLightning, testProtocols,
  ), [protocolBalances, summaryChannels, rgbBalanceIsLightning, testProtocols]);
  const availableBtc = bitcoinSummary.available;
  const pendingBtc = bitcoinSummary.unavailable;

  // The shared asset inventory, fed with this screen's own bitcoin figures (live
  // per account, or the last known ones) and, until the accounts answer, the
  // last known assets of accounts that haven't listed theirs yet.
  const inventory = useMemo(() => buildAssetInventory({
    btc: {
      available: availableBtc,
      networks: bitcoinByNetwork(protocolBalances ?? {}, summaryChannels, rgbBalanceIsLightning),
    },
    assets: displayingCurrentWallet ? withSnapshotFallback(liveAssets, snapshotAssets, listedProtocols) : EMPTY_ASSETS,
  }), [availableBtc, protocolBalances, summaryChannels, rgbBalanceIsLightning, displayingCurrentWallet, liveAssets, snapshotAssets, listedProtocols]);
  const btcEntry = inventoryBtc(inventory);
  const tokens = useMemo(() => inventoryTokens(inventory), [inventory]);

  // Lite collapses every asset into BTC / USD / other, hiding which network each
  // lives on. Its USD line counts what is held anywhere (in channels too).
  const liteUsdAssetIds = useMemo(() => liteUsdIdsOf(tokens), [tokens]);
  const listedAssets = useMemo(() => isLite ? tokens.map(token => liteUsdAssetIds.has(token.asset_id)
    ? { ...token, balance: assetTotalBaseUnits(token) } : token) : tokens, [isLite, tokens, liteUsdAssetIds]);
  // Dollar stablecoins (and whatever Lite folds into its USD line) join the total
  // at $1, as sats at the live price — the extension's totalBTC = btc + tokenValueSats.
  const tokenValueSats = useMemo(() => priceTokensInSats(tokens, btcPriceUSD, testProtocols), [tokens, btcPriceUSD, testProtocols]);
  const liveTotalBalance = bitcoinSummary.total + tokenValueSats;
  const lastCompleteTotal = useRef<{ wallet: string | null; value: number } | null>(null);
  const balanceRefreshing = isConnecting || isUpdating || loading || pendingBalanceAccounts.length > 0;
  useEffect(() => {
    if (displayingCurrentWallet && !balanceRefreshing && balanceUpdatedAt && !showingSnapshot && !balanceWarning && !offlineAccounts.length) {
      lastCompleteTotal.current = { wallet: walletKey, value: liveTotalBalance };
    }
  }, [walletKey, displayingCurrentWallet, liveTotalBalance, balanceRefreshing, balanceUpdatedAt, showingSnapshot, balanceWarning, offlineAccounts.length]);
  const holdingBalance = balanceRefreshing && lastCompleteTotal.current?.wallet === walletKey;
  const totalBalance = holdingBalance ? lastCompleteTotal.current!.value : liveTotalBalance;
  const denominatedTotal = formatDisplayAmount(totalBalance);
  const balanceUnavailable = !!connectionError && totalBalance === 0 && balanceUpdatedAt === undefined;
  const offlineNames = offlineAccounts.join(', ');
  const partialBalanceNotice = offlineNames
    ? `${offlineNames.replace(/^./, c => c.toUpperCase())} ${offlineAccounts.length === 1 ? 'is' : 'are'} offline, so the total may be incomplete.`
    : null;
  const connectionNotice = offlineNames ? `Can't reach ${offlineNames}.` : 'Wallet connection unavailable.';
  const balanceNotice = connectionError ? connectionNotice : partialBalanceNotice ?? balanceWarning;
  const showBtcAsset = displayingCurrentWallet && (balanceUpdatedAt !== undefined || Object.keys(protocolBalances ?? {}).length > 0
    || (!balanceRefreshing && !connectionError && !balanceWarning));
  const showAssets = showBtcAsset || tokens.length > 0;
  const mainnetNetworks = useMemo(() => mainnetBitcoinByNetwork(protocolBalances ?? {}, summaryChannels, rgbBalanceIsLightning, testProtocols),
    [protocolBalances, summaryChannels, rgbBalanceIsLightning, testProtocols]);
  const networkChains = useMemo(() => btcNetworkChains(testNetworks), [testNetworks]);
  const assetList = useAssetListView({
    btcNetworks: btcEntry.networks,
    btcMainnetNetworks: mainnetNetworks,
    btcNetworkChains: networkChains,
    btcAvailable: btcEntry.balance,
    showBtc: showBtcAsset,
    // Keep Lite's dollar row based on settled and channel amounts.
    assets: listedAssets,
    btcPriceUSD,
    liteUsdAssetIds: isLite ? liteUsdAssetIds : undefined,
    testProtocols,
  }, walletKey);

  const renderChannelModal = () => (
    <Sheet
      visible={channelModalVisible}
      onClose={() => setChannelModalVisible(false)}
      title="Channel Details"
    >
      {selectedChannel && (
        <ScrollView showsVerticalScrollIndicator={false}>
          {/* Channel Status */}
          <View style={styles.modalSection}>
            <Text style={styles.modalSectionTitle}>Status</Text>
            <View style={styles.modalStatusRow}>
              <View style={[
                styles.modalStatusDot,
                { backgroundColor: selectedChannel.is_usable ? theme.colors.success[500] : theme.colors.error[500] }
              ]} />
              <Text style={styles.modalStatusText}>
                {selectedChannel.ready ? 'Channel Open' : 'Channel Pending'}
              </Text>
              {selectedChannel.public ? (
                <View style={styles.modalPublicBadge}>
                  <Ionicons name="globe-outline" size={12} color={theme.colors.primary[500]} />
                  <Text style={styles.modalPublicText}>Public</Text>
                </View>
              ) : (
                <View style={styles.modalPrivateBadge}>
                  <Ionicons name="lock-closed-outline" size={12} color={theme.colors.gray[500]} />
                  <Text style={styles.modalPrivateText}>Private</Text>
                </View>
              )}
            </View>
          </View>

          {/* Peer Information */}
          <View style={styles.modalSection}>
            <Text style={styles.modalSectionTitle}>Peer Information</Text>
            <View style={styles.modalInfoRow}>
              <Text style={styles.modalInfoLabel}>Alias</Text>
              <Text style={styles.modalInfoValue}>
                {selectedChannel.peer_alias || 'Unknown'}
              </Text>
            </View>
            <View style={styles.modalInfoRow}>
              <Text style={styles.modalInfoLabel}>Public Key</Text>
              <Text style={styles.modalInfoValue} numberOfLines={1}>
                {selectedChannel.peer_pubkey}
              </Text>
            </View>
          </View>

          {/* Channel Capacity */}
          <View style={styles.modalSection}>
            <Text style={styles.modalSectionTitle}>Capacity</Text>
            <Text style={styles.modalCapacityValue}>
              {formatSatoshis(selectedChannel.capacity_sat)} {bitcoinUnit}
            </Text>
          </View>

          {/* Bitcoin Liquidity */}
          <View style={styles.modalSection}>
            <Text style={styles.modalSectionTitle}>Bitcoin Liquidity</Text>
            <View style={styles.modalLiquidityContainer}>
              <View style={styles.modalLiquidityRow}>
                <View style={styles.modalLiquidityItem}>
                  <View style={styles.modalLiquidityIcon}>
                    <Ionicons name="arrow-up" size={16} color={theme.colors.success[500]} />
                  </View>
                  <View>
                    <Text style={styles.modalLiquidityLabel}>Outbound</Text>
                    <Text style={styles.modalLiquidityValue}>
                      {formatSatoshis(selectedChannel.outbound_balance_msat / 1000)} {bitcoinUnit}
                    </Text>
                  </View>
                </View>
                <View style={styles.modalLiquidityItem}>
                  <View style={styles.modalLiquidityIcon}>
                    <Ionicons name="arrow-down" size={16} color={theme.colors.primary[500]} />
                  </View>
                  <View>
                    <Text style={styles.modalLiquidityLabel}>Inbound</Text>
                    <Text style={styles.modalLiquidityValue}>
                      {formatSatoshis(selectedChannel.inbound_balance_msat / 1000)} {bitcoinUnit}
                    </Text>
                  </View>
                </View>
              </View>
              <View style={styles.modalLiquidityBar}>
                <View style={[
                  styles.modalLiquidityBarFill,
                  {
                    width: `${(selectedChannel.outbound_balance_msat + selectedChannel.inbound_balance_msat) > 0 ?
                      (selectedChannel.outbound_balance_msat / (selectedChannel.outbound_balance_msat + selectedChannel.inbound_balance_msat) * 100) : 0}%`,
                    backgroundColor: theme.colors.success[500]
                  }
                ]} />
              </View>
            </View>
          </View>

          {/* RGB Asset Liquidity (if applicable) */}
          {selectedChannel.asset_id && (() => {
            // Channel asset amounts are in base units; divide by the asset's
            // real precision (USDT=6, XAUT=9, …), not a hardcoded 8.
            const channelAssetPrecision =
              tokens.find((a) => a.asset_id === selectedChannel.asset_id)?.precision ?? 8;
            return (
            <View style={styles.modalSection}>
              <Text style={styles.modalSectionTitle}>RGB Asset Liquidity</Text>
              <View style={styles.modalLiquidityContainer}>
                <View style={styles.modalLiquidityRow}>
                  <View style={styles.modalLiquidityItem}>
                    <View style={styles.modalLiquidityIcon}>
                      <Ionicons name="arrow-up" size={16} color={theme.colors.secondary[500]} />
                    </View>
                    <View>
                      <Text style={styles.modalLiquidityLabel}>Local</Text>
                      <Text style={styles.modalLiquidityValue}>
                        {formatAssetAmount(selectedChannel.asset_local_amount, channelAssetPrecision)}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.modalLiquidityItem}>
                    <View style={styles.modalLiquidityIcon}>
                      <Ionicons name="arrow-down" size={16} color={theme.colors.secondary[600]} />
                    </View>
                    <View>
                      <Text style={styles.modalLiquidityLabel}>Remote</Text>
                      <Text style={styles.modalLiquidityValue}>
                        {formatAssetAmount(selectedChannel.asset_remote_amount, channelAssetPrecision)}
                      </Text>
                    </View>
                  </View>
                </View>
              </View>
            </View>
            );
          })()}
        </ScrollView>
      )}
    </Sheet>
  );

  return (
    <View style={styles.container} onLayout={() => { if (!needsSetup) markWalletStartup('dashboard-visible'); }}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />

      {/* Sticky header: lives outside the ScrollView so it stays fixed while
          content scrolls beneath it. `elevated` gives it a downward shadow. */}
      <MainHeader
        leftNode={
          <ProfileChip
            profile={nostrProfile}
            hasIdentity={hasNostrIdentity}
            greeting={greeting}
            subtitle={payableLine}
            onPress={openProfile}
          />
        }
        showLogo={false}
        showSettings
        elevated
      />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => onRefresh()}
            tintColor={theme.colors.primary[500]}
            colors={[theme.colors.primary[500]]}
          />
        }
      >
        {needsSetup ? (
          <WalletSetupPrompt
            hasExistingWallet={!!activeWallet}
            onCreate={() => navigation.navigate('WalletSetup')}
            onRestore={() => navigation.navigate('WalletRestore')}
          />
        ) : <>
        {balanceNotice && !balanceUnavailable && (
          <TouchableOpacity
            style={styles.connectionNotice}
            accessibilityRole="button"
            accessibilityLabel={`${balanceNotice} Retry connection`}
            accessibilityState={{ disabled: refreshing || isConnecting }}
            disabled={refreshing || isConnecting}
            onPress={() => void onRefresh()}
          >
            <Ionicons name="cloud-offline-outline" size={20} color={theme.colors.warning[500]} />
            <Text style={[styles.noticeMessage, styles.inlineNoticeMessage]}>{balanceNotice}</Text>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        )}
        <View style={styles.walletCard}>
          {balanceUnavailable ? (
            <View style={styles.unavailableCard}>
              <View style={styles.unavailableHeader}>
                <Ionicons name="cloud-offline-outline" size={20} color={theme.colors.warning[500]} />
                <Text accessibilityRole="header" style={styles.unavailableTitle}>Balance unavailable</Text>
              </View>
              <Text style={styles.noticeMessage}>
                {balanceNotice} Reconnect to see your balance and make payments.
              </Text>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Retry wallet connection"
                accessibilityState={{ disabled: refreshing || isConnecting }}
                disabled={refreshing || isConnecting}
                onPress={() => void onRefresh()}
                style={styles.retryButton}
              >
                <Text style={styles.retryText}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) :
          <BalanceCard
            totalBalance={totalBalance}
            holdingBalance={holdingBalance}
            pendingBtc={pendingBtc}
            availableBtc={availableBtc}
            stale={!!connectionError || !!balanceWarning || offlineAccounts.length > 0 || showingSnapshot}
            lastUpdatedAt={balanceUpdatedAt}
            testBtc={bitcoinSummary.test}
            testNetworks={testNetworks}
            assetRows={breakdownAssetRows(tokens, { foldedUsdAssetIds: isLite ? liteUsdAssetIds : undefined, testProtocols })}
            rgbBalanceIsLightning={rgbBalanceIsLightning}
            showLightning={hasChannelCapableNode}
            bitcoinUnit={bitcoinUnit}
            onRefresh={() => onRefresh(true)}
            refreshing={refreshing}
            formatSatoshis={formatSatoshis}
            formatUSD={formatUSD}
            hideAmounts={denominatedTotal.hidden}
            primaryText={denominatedTotal.primary}
            primaryUnitLabel={denominatedTotal.unitLabel}
            secondaryText={denominatedTotal.secondary}
            onCycleDenomination={cycleDenomination}
            onChainBalance={getTotalBtcBalance()}
            lightningBalance={offChainBalance}
            // Always provide the per-network breakdown; it stays collapsed behind
            // the chevron so it doesn't clutter lite mode.
            byProtocol={protocolBalances}
            // Show a dash while first connecting, before any balance is available.
            loading={!displayingCurrentWallet || ((isConnecting || loading) && totalBalance === 0 && !refreshing && !showingSnapshot)}
            updating={isConnecting || isUpdating || loading}
            pendingAccounts={pendingBalanceAccounts.map(p => ({ RGB: 'RGB', LN: 'Lightning', SPARK: 'Spark', ARKADE: 'Arkade', BARK: 'Bark' }[p] ?? p))}
            footer={
              <ActionButtons
                onSend={() => navigation.getParent()?.navigate('Send')}
                onReceive={() => navigation.getParent()?.navigate('Receive')}
                onSwap={() => navigation.getParent()?.navigate('Swap')}
              />
            }
          />}
        </View>

        {showAssets && (
          <View style={styles.assetsSection}>
            <SectionHeader
              title="Assets"
              actionLabel="Open Assets"
              onAction={() => navigation.getParent()?.navigate('Assets')}
              trailingAction={<AssetListSettingsButton onPress={assetList.openSettings} filtered={assetList.filtered} />}
            />
            <AssetList
              {...assetList.listProps}
              bitcoinUnit={bitcoinUnit}
              hideBalances={denominatedTotal.hidden}
              onAssetPress={(item) => {
                const asset = assetDetailForItem(item, bitcoinUnit);
                if (asset) navigation.getParent()?.navigate('AssetDetail', { asset });
              }}
            />
          </View>
        )}
        <InsightCards
          channels={channels}
          onAction={(action) => (action.kind === 'navigate'
            ? navigation.getParent()?.navigate(action.screen, action.params)
            : navigation.navigate('Activity'))}
        />
        </>}

        {!needsSetup && policy.showChannelManagement && hasChannelCapableNode && (lspOn || channels.length > 0) && (
        <View>
        <TouchableOpacity accessibilityRole="button" accessibilityState={{ expanded: showChannels }} style={styles.placesLink} onPress={() => setShowChannels(!showChannels)}>
          <Ionicons name="git-branch-outline" size={20} color={theme.colors.text.secondary} />
          <Text style={{ flex: 1, color: theme.colors.text.primary }}>Manage Lightning channels</Text>
          <Ionicons name={showChannels ? 'chevron-up' : 'chevron-down'} size={18} color={theme.colors.text.secondary} />
        </TouchableOpacity>
        {showChannels && <ChannelList
          channels={channels}
          bitcoinUnit={bitcoinUnit}
          formatSatoshis={formatSatoshis}
          onChannelPress={(channel) => {
            // ChannelList narrows Channel to a UI subset; the runtime object
            // carries the full shape, so widen back to DashboardScreen's Channel.
            setSelectedChannel(channel as unknown as Channel);
            setChannelModalVisible(true);
          }}
          onOpenChannel={() => lspOn
            ? navigation.getParent()?.navigate('LSP')
            : Alert.alert('Lightning channels', 'Turn on Lightning channels in Settings → Labs to open one.')}
        />}
        </View>
        )}
      </ScrollView>

      <AssetListSettingsSheet {...assetList.settingsProps} />
      {renderChannelModal()}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background.primary,
  },
  scrollContent: {
    paddingBottom: theme.spacing[6],
  },
  assetsSection: {
    paddingHorizontal: theme.spacing[4],
    marginBottom: theme.spacing[4],
  },
  placesLink: {
    flexDirection: 'row', alignItems: 'center', gap: theme.spacing[3],
    margin: theme.spacing[4], padding: theme.spacing[4],
    borderRadius: theme.borderRadius.lg, backgroundColor: theme.colors.surface.primary,
  },
  connectionNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[3],
    minHeight: 44,
    marginHorizontal: theme.spacing[4],
    marginTop: theme.spacing[4],
    padding: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.warning[50],
  },
  noticeMessage: {
    color: theme.colors.text.secondary,
    fontSize: theme.typography.fontSize.sm,
  },
  inlineNoticeMessage: {
    flex: 1,
    minWidth: 0,
  },
  unavailableCard: {
    gap: theme.spacing[3],
    padding: theme.spacing[4],
    borderRadius: theme.borderRadius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border.light,
    backgroundColor: theme.colors.surface.primary,
  },
  unavailableHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[2],
  },
  unavailableTitle: {
    flex: 1,
    color: theme.colors.text.primary,
    fontSize: theme.typography.fontSize.lg,
    fontWeight: theme.typography.fontWeight.bold,
  },
  retryButton: {
    alignSelf: 'flex-start',
    minHeight: 44,
    paddingHorizontal: theme.spacing[4],
    justifyContent: 'center',
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.primary[50],
  },
  retryText: {
    color: theme.colors.primary[500],
    fontSize: theme.typography.fontSize.sm,
    fontWeight: theme.typography.fontWeight.semibold,
  },
  walletCard: {
    // The unified balance + actions card sits just below the sticky header.
    marginHorizontal: theme.spacing[4],
    marginTop: theme.spacing[4],
    marginBottom: theme.spacing[4],
  },
  // Modal Styles
  modalSection: {
    marginBottom: theme.spacing[6],
  },
  modalSectionTitle: {
    fontSize: theme.typography.fontSize.sm,
    fontWeight: '600',
    color: theme.colors.text.secondary,
    marginBottom: theme.spacing[3],
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  modalStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: theme.spacing[2],
  },
  modalStatusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  modalStatusText: {
    fontSize: theme.typography.fontSize.base,
    fontWeight: '500',
    color: theme.colors.text.primary,
    marginRight: theme.spacing[2],
  },
  modalPublicBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.primary[50],
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 4,
    borderRadius: theme.borderRadius.full,
    gap: 4,
  },
  modalPublicText: {
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.primary[600],
    fontWeight: '500',
  },
  modalPrivateBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.gray[100],
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 4,
    borderRadius: theme.borderRadius.full,
    gap: 4,
  },
  modalPrivateText: {
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.gray[600],
    fontWeight: '500',
  },
  modalInfoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing[3],
  },
  modalInfoLabel: {
    fontSize: theme.typography.fontSize.base,
    color: theme.colors.text.secondary,
  },
  modalInfoValue: {
    fontSize: theme.typography.fontSize.base,
    fontWeight: '500',
    color: theme.colors.text.primary,
    maxWidth: '60%',
  },
  modalCapacityValue: {
    fontSize: theme.typography.fontSize['2xl'],
    fontWeight: '700',
    color: theme.colors.text.primary,
  },
  modalLiquidityContainer: {
    backgroundColor: theme.colors.surface.secondary,
    padding: theme.spacing[4],
    borderRadius: theme.borderRadius.xl,
  },
  modalLiquidityRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: theme.spacing[3],
  },
  modalLiquidityItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[3],
  },
  modalLiquidityIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: theme.colors.surface.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalLiquidityLabel: {
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.text.secondary,
    marginBottom: 2,
  },
  modalLiquidityValue: {
    fontSize: theme.typography.fontSize.sm,
    fontWeight: '600',
    color: theme.colors.text.primary,
  },
  modalLiquidityBar: {
    height: 6,
    backgroundColor: theme.colors.gray[200],
    borderRadius: 3,
    overflow: 'hidden',
  },
  modalLiquidityBarFill: {
    height: '100%',
    borderRadius: 3,
  },
});
