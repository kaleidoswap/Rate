import { WalletSetupPrompt } from '../components/WalletSetupPrompt';
import { useAppSelector } from '../store/hooks';
import { bitcoinByNetwork, btcBalanceFromProtocols, summarizeBitcoinBalances, withProtocolBalance } from '../utils/wallet-balance-summary';
import { loadBalanceSnapshot, saveBalanceSnapshot, snapshotWalletKey, type SnapshotChannel } from '../services/balanceSnapshot';
import { receiveAccountChain } from '../services/kaleidoPay/connect';
import { chainLabel } from '../utils/receive-routes';
import type { AccountId } from '../utils/account-routing';
import { toEngineProtocol } from '../utils/protocol-bridge'
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
} from 'react-native';
import { useDispatch, useSelector } from 'react-redux';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import { RootState } from '../store';
import { initializeProtocolServices } from '../services/initializeServices';
import { protocolManager, rgbAccountAdapter } from '../services/protocols';
import { setBtcBalance } from '../store/slices/walletSlice';
import { setRgbAssets } from '../store/slices/assetsSlice';
import { loadNostrProfile } from '../store/slices/nostrSlice';
import {
  selectDisclosureLevel,
} from '../store/slices/settingsSlice';
import { policyFor, aggregateForLite } from '@kaleidorg/wallet-engine';

import { theme } from '../theme';
import {
  BalanceCard,
  ActionButtons,
  AssetList,
  ChannelList,
  MainHeader
} from '../components';
import { Sheet } from '../components/Sheet';
import { formatBitcoinAmount, useBitcoinConversion, useDisplayAmount } from '../utils/bitcoinUnits';
import { formatAssetAmount, getAssetBaseUnitBalance } from '../utils/assetAmount';
import { getAssetFamily } from '../utils/account-routing';
import { isUsdbTokenAddress, USDB_DECIMALS, USDB_NAME, USDB_TICKER } from '../utils/flashnet';
import { assetUsdValue, formatUsd, tokenValueSats as priceTokensInSats, tokenValueUsd } from '../utils/portfolio';

const LITE_USD_ID = 'lite-usd';
import { readBarkRecovery, syncBarkForUpdates } from '../services/BarkService';

const { width } = Dimensions.get('window');

interface Props {
  navigation: any;
}

interface NiaAsset {
  asset_id: string;
  asset_iface: string;
  ticker: string;
  name: string;
  details: string | null;
  precision: number;
  issued_supply: number;
  timestamp: number;
  added_at: number;
  balance: {
    settled: number;
    future: number;
    spendable: number;
    offchain_outbound?: number;
    offchain_inbound?: number;
  };
  media: string | null;
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
 * `name` (the user's Nostr name, when connected) is used when present.
 */
function buildGreeting(name?: string): string {
  const hour = new Date().getHours();
  const pool =
    hour < 5 ? ['Still up', 'Good night', 'Hi']
    : hour < 12 ? ['Good morning', 'Morning', 'Rise and shine']
    : hour < 17 ? ['Good afternoon', 'Hey there', 'Hi']
    : hour < 21 ? ['Good evening', 'Evening', 'Welcome back']
    : ['Good night', 'Winding down', 'Hi'];
  const phrase = pool[Math.floor(Math.random() * pool.length)];
  return name ? `${phrase}, ${name}` : phrase;
}

/**
 * Accounts on a test network, with the network's name. Their sats have no value:
 * kept out of the total and its fiat figure, and shown on their own line.
 */
function testNetworkLabels(): Partial<Record<AccountId, string>> {
  const out: Partial<Record<AccountId, string>> = {};
  for (const account of ['RGB', 'SPARK', 'ARKADE', 'BARK'] as AccountId[]) {
    const chain = receiveAccountChain(account);
    if (chain && chain !== 'mainnet') out[account] = chainLabel(chain);
  }
  return out;
}

const EMPTY_BTC_BALANCE = {
  vanilla: { settled: 0, future: 0, spendable: 0 },
  colored: { settled: 0, future: 0, spendable: 0 },
};

const ACCOUNT_NAMES: Record<string, string> = {
  RGB_LN: 'your RGB Lightning node', SPARK: 'Spark', ARKADE: 'Arkade', BARK: 'Bark',
};

export default function DashboardScreen({ navigation }: Props) {
  const isScreenFocused = useIsFocused();
  const activeWallet = useAppSelector(state => state.wallet.activeWallet);
  const needsSetup = !activeWallet?.encrypted_mnemonic;
  const dispatch = useDispatch();
  const { nodeInfo } = useSelector((state: RootState) => state.node);
  const bitcoinUnit = useSelector((state: RootState) => state.settings.bitcoinUnit);
  // Header greeting uses the Nostr display name when connected; falls back to a
  // name-less greeting otherwise (Nostr stays optional — see header below).
  const nostrName = useSelector((state: RootState) => {
    const p = state.nostr?.profile;
    return (p?.display_name || p?.name || '').trim();
  });
  const greeting = useMemo(() => buildGreeting(nostrName || undefined), [nostrName]);

  // If Nostr is connected but we never pulled the profile (the wallet-side
  // connect path doesn't fetch it, and a restored connection doesn't either),
  // fetch it once so the greeting can show the account's name.
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
  const [isNodeUnlocked, setIsNodeUnlocked] = useState(false);
  const [isConnecting, setIsConnecting] = useState(true);
  const [balanceWarning, setBalanceWarning] = useState<string | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  // Accounts that failed to connect (by name), so the banner can say which one.
  const [offlineAccounts, setOfflineAccounts] = useState<string[]>([]);
  const [protocolsReady, setProtocolsReady] = useState(false);
  // Startup initializes protocols and then fetches balances in the same async
  // focus callback. React state does not update synchronously, so reading
  // `protocolsReady` from that callback used to see the initial false value and
  // skip the first balance load. These refs are the immediate lifecycle gates;
  // state remains the source of truth for rendering.
  const protocolsReadyRef = useRef(false);
  const [refreshing, setRefreshing] = useState(false);
  // The same live BTC price the fiat figures use (redux's btcPriceUSD is rarely set).
  const { formatSatoshisToUSD, bitcoinPrice: liveBtcPrice } = useBitcoinConversion();
  // Denomination-aware formatter for the headline balance (tap to cycle sats/BTC/fiat).
  const { format: formatDisplayAmount, cycle: cycleDenomination } = useDisplayAmount();
  const [loading, setLoading] = useState(true);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [btcBalance, setBtcBalanceState] = useState<{
    vanilla: { settled: number; future: number; spendable: number };
    colored: { settled: number; future: number; spendable: number };
    byProtocol?: Record<string, { confirmed: number; unconfirmed: number; total: number }>;
  }>(EMPTY_BTC_BALANCE);
  const [rgbAssets, setRgbAssetsState] = useState<NiaAsset[]>([]);
  const [isUpdating, setIsUpdating] = useState(false);
  const isUpdatingRef = useRef(false);
  // Last known balances (per wallet) shown at launch until the live ones land.
  const [showingSnapshot, setShowingSnapshot] = useState(false);
  const [snapshotChannels, setSnapshotChannels] = useState<SnapshotChannel[]>([]);
  const [snapshotPrice, setSnapshotPrice] = useState(0);
  const [channelsLive, setChannelsLive] = useState(false);
  const walletKey = snapshotWalletKey(activeWallet);
  const walletKeyRef = useRef(walletKey);
  const activeWalletRef = useRef(activeWallet);
  activeWalletRef.current = activeWallet;
  // Set once live data has started replacing the snapshot for this wallet.
  const liveDataRef = useRef(false);
  const btcPriceRef = useRef(0);

  // Modal state for channel details
  const [channelModalVisible, setChannelModalVisible] = useState(false);
  const [selectedChannel, setSelectedChannel] = useState<Channel | null>(null);

  // Initialize protocol services (only once)
  const initializeApi = useCallback(async () => {
    if (needsSetup) return false;
    if (protocolsReadyRef.current) return true; // Already initialized

    try {
      console.log('Initializing protocol services...');
      const { results } = await initializeProtocolServices();

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
      setOfflineAccounts(Array.from(results.entries())
        .filter(([, r]) => !r.success && !r.error?.startsWith('skipped:'))
        .map(([p]) => ACCOUNT_NAMES[String(p)] ?? String(p)));
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
      setConnectionError(error instanceof Error ? error.message : 'Failed to initialize');
      return null;
    }
  }, [needsSetup]);

  const checkNodeStatus = async (skipInitialization = false) => {
    try {
      setIsConnecting(true);
      setConnectionError(null);

      if (!skipInitialization && !protocolsReadyRef.current) {
        if (!await initializeApi()) return false;
      }

      // Try any connected adapter
      let info: any = null;
      const protocols: Array<'RGB' | 'SPARK' | 'ARKADE' | 'BARK'> = ['RGB', 'SPARK', 'ARKADE', 'BARK'];
      for (const proto of protocols) {
        try {
          const adapter = protocolManager.getAdapterIfAvailable(toEngineProtocol(proto));
          if (adapter?.isConnected()) {
            info = await adapter.getNodeInfo();
            break;
          }
        } catch { /* try next */ }
      }

      if (!info) throw new Error('No wallet connected');
      console.log('Node info received:', info);
      setIsNodeUnlocked(true);
      return true;
    } catch (error) {
      console.error('Failed to get node info:', error);
      setIsNodeUnlocked(false);
      setConnectionError(error instanceof Error ? error.message : 'Unknown error occurred');
      return false;
    } finally {
      setIsConnecting(false);
    }
  };

  const loadDashboardData = async (showLoadingIndicator = true) => {
    if (!protocolsReadyRef.current || isUpdatingRef.current) {
      console.log('Skipping update: Protocols not ready or update in progress');
      return;
    }

    // Results for a wallet the user has since switched away from are dropped.
    const walletAtStart = activeWalletRef.current;
    const keyAtStart = snapshotWalletKey(walletAtStart);
    const current = () => walletKeyRef.current === keyAtStart;

    try {
      isUpdatingRef.current = true;
      setIsUpdating(true);
      if (showLoadingIndicator) {
        setLoading(true);
      }
      console.log('Loading dashboard data...');

      // Load via protocolManager (multi-protocol)
      const rgbAdapter = rgbAccountAdapter(); // the node, or RGB on this phone
      const sparkAdapter = protocolManager.getAdapterIfAvailable('SPARK');
      const arkadeAdapter = protocolManager.getAdapterIfAvailable('ARKADE');
      const barkAdapter = protocolManager.getAdapterIfAvailable('BARK');

      // Balances, assets and channels are all fetched at once, and each account's
      // figure lands on screen as soon as it returns: the headline no longer waits
      // for the slowest account (or for assets) before showing anything.
      console.log('Fetching BTC balance...');
      const adapterProtoMap: Array<[any, string]> = [
        [rgbAdapter, 'RGB'], [sparkAdapter, 'SPARK'], [arkadeAdapter, 'ARKADE'], [barkAdapter, 'BARK'],
      ];
      const balancesTask = Promise.all(
        adapterProtoMap.map(async ([adapter, proto]) => {
          if (!adapter?.isConnected()) return null;
          try {
            // A failed sync (server unreachable) must not hide the last known Bark balance.
            if (proto === 'BARK') await syncBarkForUpdates().catch((e) => console.warn('Bark sync failed:', e));
            const btc = await adapter.getBtcBalance();
            if (current()) {
              liveDataRef.current = true;
              setBtcBalanceState(prev => withProtocolBalance(prev as any, proto, btc));
            }
            return { proto, btc };
          } catch (e) {
            console.warn('Balance fetch error:', e);
            return null;
          }
        })
      );

      console.log('Fetching assets...');
      const adapterMap: Array<[any, 'RGB' | 'SPARK' | 'ARKADE']> = [
        [rgbAdapter, 'RGB'], [sparkAdapter, 'SPARK'], [arkadeAdapter, 'ARKADE'],
      ];
      const assetsTask = Promise.all(
        adapterMap.map(async ([adapter, proto]) => {
          if (!adapter?.isConnected()) return [] as any[];
          try {
            const unifiedAssets = await adapter.listAssets();
            const mapped = unifiedAssets
              .filter((a: any) => a.id !== 'BTC')
              .map((a: any) => {
                const isUsdb = isUsdbTokenAddress(a.id);
                return {
                  asset_id: a.id,
                  ticker: isUsdb ? USDB_TICKER : a.ticker,
                  name: isUsdb ? USDB_NAME : a.name,
                  precision: isUsdb ? USDB_DECIMALS : a.precision,
                  issued_supply: a.metadata?.issued_supply || 0,
                  protocol: proto,
                  icon: a.icon,
                  balance: {
                    settled: a.balance.settled ?? a.balance.total,
                    future: a.balance.pending,
                    // `available` already folds in on-chain spendable + in-channel
                    // outbound (see NwcRgbAdapter.mapAssetBalance), so it reflects the
                    // real holdings even for an asset held purely in a channel.
                    spendable: a.balance.available,
                    offchain_outbound: a.balance.offchain_outbound ?? a.balance.locked ?? 0,
                    offchain_inbound: a.balance.offchain_inbound ?? 0,
                  },
                };
              });
            // This account's assets replace whatever it showed before.
            if (current()) {
              liveDataRef.current = true;
              setRgbAssetsState(prev => [...prev.filter((x: any) => x.protocol !== proto), ...mapped]);
            }
            return mapped;
          } catch (e) {
            console.warn('Asset fetch error:', e);
            return [] as any[];
          }
        })
      );

      // Lightning channels (RGB node only). Plain NIP-47 wallets can create/pay
      // invoices but do not expose RLN channel management.
      console.log('Fetching Lightning channels...');
      const connectedWalletType = (rgbAdapter as any)?.walletType?.() ?? nwcWalletType;
      const canManageChannels = connectedWalletType == null || nwcCapabilities.includes('manageChannels');
      const channelsTask: Promise<any[]> = rgbAdapter?.isConnected() && connectedWalletType !== 'ln' && canManageChannels
        ? Promise.resolve().then(() => rgbAdapter.listChannels()).catch(() => [] as any[])
        : Promise.resolve([]);

      const [balanceResults, assetResults, channelsList] = await Promise.all([balancesTask, assetsTask, channelsTask]);
      if (!current()) return;

      const connectedCount = adapterProtoMap.filter(([adapter]) => adapter?.isConnected()).length;
      const okBalances = balanceResults.filter(Boolean) as Array<{ proto: string; btc: { confirmed: number; unconfirmed: number; total: number } }>;
      // Bark recovery (moved from the old Bark screen): an incomplete restore can
      // omit funds, so say so next to the total rather than on a separate page.
      const barkRecovery = await readBarkRecovery().catch(() => null);
      setBalanceWarning(
        barkRecovery === 'failed' || barkRecovery === 'incomplete'
          ? 'Bark recovery is incomplete, so its balance may omit funds.'
          : okBalances.length < connectedCount
            ? 'Some balances are unavailable. Your total may be incomplete.' : null);

      const assets = assetResults.flat();
      setRgbAssetsState(assets);
      setChannels(channelsList);
      setChannelsLive(true);
      dispatch(setRgbAssets(assets.map((asset: any) => ({
        wallet_id: 1,
        asset_id: asset.asset_id,
        ticker: asset.ticker,
        name: asset.name,
        precision: asset.precision,
        issued_supply: asset.issued_supply,
        // Carry the owning protocol so downstream (activity, asset detail) can
        // tell Spark/Arkade tokens apart from RGB instead of treating all as RGB.
        protocol: asset.protocol,
        icon: asset.icon,
        balance: getAssetBaseUnitBalance(asset.balance),
        // The full breakdown (in channels, incoming) for the asset detail screen.
        balanceDetail: asset.balance,
        last_updated: Date.now()
      })) as any));

      // Every account failed: keep the last figures on screen (the warning says why)
      // rather than replacing them with zero.
      if (connectedCount > 0 && okBalances.length === 0) return;

      const byProtocol: Record<string, { confirmed: number; unconfirmed: number; total: number }> = {};
      // Bark is a layer like Arkade/Spark: counted in the total and shown in the breakdown.
      for (const r of okBalances) byProtocol[r.proto] = r.btc;
      const balance = btcBalanceFromProtocols(byProtocol);
      liveDataRef.current = true;
      setBtcBalanceState(balance);
      setShowingSnapshot(false);
      const rgbIsLightning = typeof (rgbAdapter as any)?.walletType === 'function';
      dispatch(setBtcBalance({
        ...balance,
        summary: summarizeBitcoinBalances(byProtocol, channelsList, rgbIsLightning, new Set(Object.keys(testNetworkLabels()))),
        networks: bitcoinByNetwork(byProtocol, channelsList, rgbIsLightning),
      }));
      void saveBalanceSnapshot(walletAtStart, {
        byProtocol, assets, channels: channelsList, btcPriceUSD: btcPriceRef.current,
      });
    } catch (error) {
      console.error('Failed to load dashboard data:', error);
      // Shown in the banner above the balance, not as a modal on top of it.
      if (showLoadingIndicator) setBalanceWarning('Your balances could not be refreshed.');
    } finally {
      isUpdatingRef.current = false;
      setIsUpdating(false);
      if (showLoadingIndicator) {
        setLoading(false);
      }
      // A load that started for the previous wallet blocked the new wallet's first load.
      if (!current() && protocolsReadyRef.current) void loadDashboardData(false);
    }
  };

  // Auto-refresh only while Dashboard is actually visible. A parent-stack modal
  // such as Receive keeps this component mounted; polling behind it can otherwise
  // collide with receive-address generation and monopolize the same adapters.
  useEffect(() => {
    let intervalId: NodeJS.Timeout;

    if (!protocolsReady || !isScreenFocused) return;

    const refreshData = async () => {
      if (!isUpdating) {
        await loadDashboardData(false);
      }
    };

    // The focus effect below owns the immediate refresh. This interval handles
    // only subsequent refreshes, avoiding two adapter bursts on focus.
    intervalId = setInterval(refreshData, 30000);

    return () => {
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, [protocolsReady, isScreenFocused, isNodeUnlocked, isConnecting]);

  // A spend elsewhere (KaleidoMind voice/chat payment tools) emits this so the
  // balance reflects it right away — plus a short follow-up once it settles —
  // instead of waiting for the 30s poll. loadDashboardData self-guards on
  // protocolsReady/isUpdating, so a stray emit is a no-op.
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener('rate.refreshBalance', () => {
      void loadDashboardData(false);
      setTimeout(() => void loadDashboardData(false), 2500);
    });
    return () => sub.remove();
  }, [protocolsReady]);

  const connectAndLoad = async () => {
    if (needsSetup) {
      protocolsReadyRef.current = false;
      setProtocolsReady(false);
      setIsConnecting(false);
      setLoading(false);
      setConnectionError(null);
      return;
    }
    setIsConnecting(true);
    setConnectionError(null);
    try {
      if (!await initializeApi()) return;
      await Promise.all([checkNodeStatus(true), loadDashboardData(true)]);
    } finally {
      // Both a failed connection and a missing wallet are terminal UI states.
      setIsConnecting(false);
      setLoading(false);
    }
  };

  useEffect(() => {
    protocolsReadyRef.current = false;
    setProtocolsReady(false);
  }, [activeWallet]);

  // A different wallet starts from its own last balances (or blank), never the
  // previous wallet's figures.
  useEffect(() => {
    walletKeyRef.current = walletKey;
    liveDataRef.current = false;
    setBtcBalanceState(EMPTY_BTC_BALANCE);
    setRgbAssetsState([]);
    setChannels([]);
    setChannelsLive(false);
    setSnapshotChannels([]);
    setShowingSnapshot(false);
    if (!walletKey || needsSetup) return;
    let cancelled = false;
    void loadBalanceSnapshot(activeWalletRef.current).then((snap) => {
      if (cancelled || !snap || walletKeyRef.current !== walletKey || liveDataRef.current) return;
      setBtcBalanceState(btcBalanceFromProtocols(snap.byProtocol));
      setRgbAssetsState(snap.assets as NiaAsset[]);
      setSnapshotChannels(snap.channels);
      setSnapshotPrice(snap.btcPriceUSD);
      setShowingSnapshot(true);
    });
    return () => { cancelled = true; };
  }, [walletKey, needsSetup]);

  useFocusEffect(
    useCallback(() => {
      void connectAndLoad();
    }, [activeWallet])
  );

  const onRefresh = async () => {
    if (refreshing || isConnecting || needsSetup) return;
    setRefreshing(true);
    try {
      if (connectionError) protocolsReadyRef.current = false;
      await connectAndLoad();
    } finally {
      setRefreshing(false);
    }
  };

  const formatSatoshis = (satoshis: number): string => {
    return formatBitcoinAmount(satoshis, bitcoinUnit);
  };

  const formatUSD = (satoshis: number): string => {
    return formatSatoshisToUSD(satoshis);
  };

  const getTotalBtcBalance = (): number => {
    if (!btcBalance) return 0;
    return btcBalance.vanilla.spendable + btcBalance.colored.spendable;
  };

  const offChainBalance = (channelsLive ? channels : snapshotChannels).reduce(
    (sum, channel) => sum + channel.local_balance_sat,
    0
  );
  const hasChannelCapableNode =
    (protocolManager.getAdapterIfAvailable('RGB_LN')?.isConnected() ?? false)
    && ((protocolManager.getAdapterIfAvailable('RGB_LN') as any)?.walletType?.() ?? nwcWalletType) !== 'ln'
    && (nwcWalletType == null || nwcCapabilities.includes('manageChannels'));

  const btcPriceUSD = liveBtcPrice || snapshotPrice;
  btcPriceRef.current = btcPriceUSD;
  const protocolBalances = (btcBalance as any).byProtocol as Record<string, { confirmed: number; unconfirmed: number; total: number }> | undefined;
  // NWC reports Lightning funds already; HTTP RLN reports on-chain funds.
  const rgbBalanceIsLightning = typeof (rgbAccountAdapter() as any)?.walletType === 'function';
  // Accounts on a test network hold sats with no value: kept out of the total and its
  // fiat figure, and shown on their own line.
  const testNetworks = testNetworkLabels();
  // Until this wallet's channels load, its last known ones stand in for the total.
  const summaryChannels = channelsLive ? channels : snapshotChannels;
  const bitcoinSummary = summarizeBitcoinBalances(
    protocolBalances ?? {}, summaryChannels, rgbBalanceIsLightning, new Set(Object.keys(testNetworks)),
  );
  const availableBtc = bitcoinSummary.available;
  const pendingBtc = bitcoinSummary.unavailable;

  // Lite-mode aggregation: collapse every asset into BTC / USD / other, hiding
  // which network each lives on. BTC is filtered out of `rgbAssets` upstream, so
  // its true total comes from `totalBalance` (on-chain + Lightning). USDt assets
  // bucket into `usd`; everything else stays in `other`.
  const assetTotalBaseUnits = (asset: any): number => {
    const balance = asset?.balance;
    if (typeof balance === 'number') return balance;
    return (
      Number(balance?.settled ?? balance?.total ?? getAssetBaseUnitBalance(balance)) +
      Number(balance?.offchain_inbound ?? 0) +
      Number(balance?.offchain_outbound ?? 0)
    );
  };

  const liteAssets = rgbAssets.map((asset) => ({
    id: asset.asset_id,
    ticker: asset.ticker,
    balance: { total: assetTotalBaseUnits(asset) },
  })) as any;
  const lite = aggregateForLite(liteAssets);
  // The aggregated USD figure is in base units; convert each contributing asset
  // to its human value using its own precision so the display reads as dollars.
  const liteUsdAssetIds = new Set<string>(
    liteAssets
      .filter((a: any) => !lite.other.some((o: any) => o.id === a.id))
      .map((a: any) => a.id)
  );
  const liteUsdDisplay = rgbAssets
    .filter((asset) => liteUsdAssetIds.has(asset.asset_id))
    .reduce((sum, asset) => {
      const total = assetTotalBaseUnits(asset);
      return sum + total / Math.pow(10, asset.precision ?? 0);
    }, 0);
  // Assets the AssetList should show in lite mode: drop USDt (folded into the USD
  // figure) and keep the original rgbAssets shape the list already renders.
  const liteOtherAssets = rgbAssets.filter((asset) =>
    lite.other.some((o: any) => o.id === asset.asset_id)
  );

  // Dollar stablecoins (and whatever Lite folds into its USD line) join the total
  // at $1, as sats at the live price — the extension's totalBTC = btc + tokenValueSats.
  const tokenValueSats = priceTokensInSats(rgbAssets as any[], btcPriceUSD, liteUsdAssetIds);
  const tokenUsd = tokenValueUsd(rgbAssets as any[], liteUsdAssetIds);
  const totalBalance = bitcoinSummary.total + tokenValueSats;
  const denominatedTotal = formatDisplayAmount(totalBalance);

  // BTC is the wallet's base asset but is filtered out of `rgbAssets` upstream,
  // so it never reached the dashboard AssetList. Surface it at the top of the
  // list (matching AssetsScreen's BTC row). Balance is on-chain + Lightning, and
  // precision follows the BTC/sats display preference so formatAssetAmount renders
  // it the same way the rest of the wallet does.
  const btcListEntry = {
    asset_id: 'BTC',
    ticker: 'BTC',
    name: 'Bitcoin',
    precision: bitcoinUnit === 'BTC' ? 8 : 0,
    balance: { spendable: availableBtc },
    unit: bitcoinUnit,
    fiatValue: btcPriceUSD ? (availableBtc / 100_000_000) * btcPriceUSD : undefined,
  } as any;
  // Dollar stablecoins are worth their face value.
  const usdValueOf = (asset: any): number | undefined => assetUsdValue(asset, liteUsdAssetIds);

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
              rgbAssets.find((a) => a.asset_id === selectedChannel.asset_id)?.precision ?? 8;
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
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />

      {/* Sticky header: lives outside the ScrollView so it stays fixed while
          content scrolls beneath it. `elevated` gives it a downward shadow. */}
      <MainHeader
        title={greeting}
        showLogo={false}
        showSettings
        elevated
      />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
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
        {!connectionError && !balanceWarning && offlineAccounts.length > 0 && (
          <TouchableOpacity style={styles.placesLink} accessibilityRole="button" onPress={onRefresh}>
            <Ionicons name="cloud-offline-outline" size={20} color={theme.colors.warning[500]} />
            <Text style={{ flex: 1, color: theme.colors.text.secondary }}>
              {offlineAccounts.join(', ')} {offlineAccounts.length === 1 ? 'is' : 'are'} offline, so the total may be incomplete. Tap to retry.
            </Text>
          </TouchableOpacity>
        )}
        {(connectionError || balanceWarning) && (
          <TouchableOpacity style={styles.placesLink} accessibilityRole="button" onPress={onRefresh}>
            <Ionicons name="cloud-offline-outline" size={20} color={theme.colors.warning[500]} />
            <Text style={{ flex: 1, color: theme.colors.text.secondary }}>
              {connectionError
                ? (offlineAccounts.length ? `Can't reach ${offlineAccounts.join(', ')}. Tap to retry.` : 'Wallet connection unavailable. Tap to retry.')
                : `${balanceWarning} Tap to retry.`}
            </Text>
          </TouchableOpacity>
        )}
        {/* Unified wallet card: balance + per-network breakdown + action buttons. */}
        <View style={styles.walletCard}>
          {connectionError && totalBalance === 0 ? (
            <View style={{ padding: theme.spacing[6], gap: theme.spacing[2] }}>
              <Text style={{ color: theme.colors.text.primary, fontSize: theme.typography.fontSize.lg }}>Balance unavailable</Text>
              <Text style={{ color: theme.colors.text.secondary }}>Reconnect to see your balance and make payments.</Text>
            </View>
          ) :

          <BalanceCard
            totalBalance={totalBalance}
            pendingBtc={pendingBtc}
            testBtc={bitcoinSummary.test}
            testNetworks={testNetworks}
            includesTokenValue={tokenValueSats > 0}
            tokenValueText={tokenUsd > 0 ? formatUsd(tokenUsd) : undefined}
            rgbBalanceIsLightning={rgbBalanceIsLightning}
            bitcoinUnit={bitcoinUnit}
            onRefresh={onRefresh}
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
            byProtocol={(btcBalance as any)?.byProtocol}
            // Shimmer the balance while first connecting (before any data lands).
            loading={(isConnecting || loading) && totalBalance === 0 && !refreshing && !showingSnapshot}
            updating={showingSnapshot && (isConnecting || isUpdating || loading)}
            footer={
              <ActionButtons
                onSend={() => navigation.getParent()?.navigate('Send')}
                onReceive={() => navigation.getParent()?.navigate('Receive')}
                onSwap={() => navigation.getParent()?.navigate('Swap')}
              />
            }
          />}
        </View>



        <AssetList
          // BTC always leads the list; in lite mode hide USDt (it's folded into the
          // USD figure above) and strip the per-asset protocol badge (a network detail).
          assets={[
            btcListEntry,
            // Lite folds every dollar stablecoin into one USD line.
            ...(isLite && liteUsdDisplay > 0 ? [{
              asset_id: LITE_USD_ID, ticker: 'USD', name: 'US Dollar', precision: 2,
              balance: { spendable: Math.round(liteUsdDisplay * 100) },
              fiatValue: liteUsdDisplay,
            }] : []),
            ...(isLite
              ? liteOtherAssets.map((a) => ({ ...a, protocol: undefined, fiatValue: usdValueOf(a) }))
              // The list mixes protocols (RGB, Spark tokens, Arkade), so tag each
              // asset with its real family for the badge instead of leaving it bare.
              : rgbAssets.map((a) => ({
                  ...a,
                  // rgbAssets never contains BTC (filtered upstream), so the family
                  // is always one of the badge-able protocols.
                  protocol: getAssetFamily(a.asset_id, a.ticker) as 'RGB' | 'SPARK' | 'ARKADE',
                  fiatValue: usdValueOf(a),
                }))),
          ]}
          onViewAll={() => navigation.getParent()?.navigate('Assets')}
          onAssetPress={(asset) => {
            if (asset.asset_id === LITE_USD_ID) { navigation.getParent()?.navigate('Assets'); return; }
            const family = getAssetFamily(asset.asset_id, asset.ticker);
            navigation.getParent()?.navigate('AssetDetail', {
              asset: {
                ...asset,
                // Only RGB assets route through the RGB detail/send flow; Spark
                // tokens and BTC must not be treated as RGB.
                isRGB: family === 'RGB',
                protocol: family,
              }
            });
          }}
          onIssueAsset={() => navigation.getParent()?.navigate('Assets', { issue: true })}
        />

        <TouchableOpacity
          accessibilityRole="button"
          onPress={() => navigation.navigate('Map')}
          style={styles.placesLink}
        >
          <Ionicons name="map-outline" size={22} color={theme.colors.text.secondary} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: theme.colors.text.primary, fontSize: theme.typography.fontSize.base }}>Places to pay</Text>
            <Text style={{ color: theme.colors.text.secondary, fontSize: theme.typography.fontSize.sm }}>Find nearby businesses accepting bitcoin</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={theme.colors.text.secondary} />
        </TouchableOpacity>
        </>}

        {!needsSetup && policy.showChannelManagement && hasChannelCapableNode && (
        <ChannelList
          channels={channels}
          bitcoinUnit={bitcoinUnit}
          formatSatoshis={formatSatoshis}
          onChannelPress={(channel) => {
            // ChannelList narrows Channel to a UI subset; the runtime object
            // carries the full shape, so widen back to DashboardScreen's Channel.
            setSelectedChannel(channel as unknown as Channel);
            setChannelModalVisible(true);
          }}
          onOpenChannel={() => navigation.getParent()?.navigate('LSP')}
        />
        )}
      </ScrollView>

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
  placesLink: {
    flexDirection: 'row', alignItems: 'center', gap: theme.spacing[3],
    margin: theme.spacing[4], padding: theme.spacing[4],
    borderRadius: theme.borderRadius.lg, backgroundColor: theme.colors.surface.primary,
  },
  walletCard: {
    // The unified balance + actions card sits just below the sticky header.
    marginHorizontal: theme.spacing[4],
    marginTop: theme.spacing[4],
    marginBottom: theme.spacing[4],
  },
  headerContainer: {
    marginBottom: theme.spacing[4],
  },
  headerGradient: {
    paddingBottom: theme.spacing[12],
    borderBottomLeftRadius: theme.borderRadius['3xl'],
    borderBottomRightRadius: theme.borderRadius['3xl'],
  },
  headerSafeArea: {
    backgroundColor: 'transparent',
  },
  headerContent: {
    paddingHorizontal: theme.spacing[4],
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing[6],
    marginTop: theme.spacing[2],
  },
  headerLeft: {
    flex: 1,
  },
  greeting: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.text.inverse,
    opacity: 0.8,
    marginBottom: 4,
  },
  headerTitle: {
    fontSize: theme.typography.fontSize['2xl'],
    fontWeight: '700',
    color: theme.colors.text.inverse,
  },
  headerActions: {
    flexDirection: 'row',
    gap: theme.spacing[3],
  },
  headerActionButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  notificationDot: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: theme.colors.error[500],
    borderWidth: 1,
    borderColor: theme.colors.primary[600],
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
