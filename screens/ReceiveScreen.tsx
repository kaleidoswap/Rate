import { ReceiveConnectionNotice } from '../components/receive/ReceiveConnectionNotice';
import { receiveAmountSats } from '../utils/receive-request';
import { useReceiveGeneration } from '../hooks/useReceiveGeneration';
import { InvoiceExpiry } from '../components/payments/InvoiceExpiry';
// screens/ReceiveScreen.tsx
import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  AppState,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { useIsFocused } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { RootState } from '../store';
// RGBApiService removed — all operations via protocolManager
import { protocolManager } from '../services/protocols';
import { buildUnifiedReceiveURI } from '@kaleidorg/wallet-engine';
import { selectDisclosureLevel, setLastBtcReceiveRoute } from '../store/slices/settingsSlice';
import { useRefreshableProtocolStatus } from '../hooks/useProtocol';
import {
  getAssetFamily, resolveReceiveAccounts, getNetworkTypesForAccount,
  type AccountId,
  type NetworkType as ProtocolNetworkType,
} from '../utils/account-routing';
import { useAppTheme } from '../theme/ThemeProvider';
import { createReceiveStyles } from './receive/styles';
import { ReceiveQr } from '../components/receive/ReceiveQr';
import { ReceiveStatus, type ReceiveStatusValue } from '../components/receive/ReceiveStatus';
import { ReceiveRequestActions } from '../components/receive/ReceiveRequestActions';
import { ReceiveRoutePicker } from '../components/receive/ReceiveRoutePicker';
import { ReceiveRequestDetails, accountName } from '../components/receive/ReceiveRequestDetails';
import DepositSuccessOverlay from '../components/DepositSuccessOverlay';
import {
  useDepositDetection,
  type DepositDetectionEvent,
  type DepositLayer,
} from '../hooks/useDepositDetection';
import { useSparkAutoClaim } from '../hooks/useSparkAutoClaim';
import { AssetIcon } from '../components/AssetIcon';
import { AssetSelector } from '../components/AssetSelector';
import { UsdCoinIcon } from '../components/ProtocolIcons';
import { AmountEditorModal } from '../components/AmountEditorModal';
import { NewAssetSheet, type NewAssetKind } from '../components/NewAssetSheet';
import { useFiatRates } from '../hooks/useFiatRates';
import { feedback } from '../utils/feedback';
import {
  callAbortableAdapterMethod,
  runReceiveOperation as runTimedReceiveOperation,
  upsertReceiveMethod,
  type ReceiveMethod,
  type ReceiveMonitorKind,
  type ReceiveProtocol,
} from '../utils/receive-session';
import {
  accountsOnChain, chainLabel, defaultDestination, destinationsFor, legacyRoute, lightningDestinations,
  methodsFor, rgbAccountLabel, routeOf, universalChains, universalLightning,
  type ReceiveAccountInfo, type ReceiveCaps, type ReceiveChain, type ReceiveMethodId,
} from '../utils/receive-routes';
import { arkadeReceiveOptions, receiveAccountChain } from '../services/kaleidoPay/connect';
import { claimArkadeLightningReceive, createArkadeLightningReceive, type ArkadeLightningReceive } from '../services/kaleidoPay/arkadeIntents';
import { BarkBoardingPanel } from '../components/receive/BarkBoardingPanel';

// Sentinel asset id for receiving an RGB asset the user doesn't hold yet
// (generates a blind RGB invoice with no specific asset_id).
const NEW_RGB_ASSET_ID = 'RGB_NEW';
// Verbose receive logging is opt-in even in dev. In an Expo dev client every
// console.log is a bridge round-trip, and the unified flow emits ~12+ lines per
// generation plus one on every tap — enough to visibly stall the JS thread while
// the screen is generating. Set `global.__RECEIVE_DEBUG__ = true` to trace.
const RECEIVE_DEBUG = (globalThis as any).__RECEIVE_DEBUG__ === true;
const nowMs = () => (globalThis.performance?.now ? globalThis.performance.now() : Date.now());
const receiveLog = (event: string, details?: Record<string, unknown>) => {
  if (!RECEIVE_DEBUG) return;
  if (details) {
    console.log(`[ReceiveScreen] ${event}`, details);
  } else {
    console.log(`[ReceiveScreen] ${event}`);
  }
};

interface Props {
  navigation: any;
}

interface RGBAsset {
  asset_id: string;
  ticker: string;
  name: string;
  precision?: number;
  balance: number;
}

interface Asset {
  asset_id: string;
  ticker: string;
  name: string;
  isRGB: boolean;
  balance?: number;
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

type DepositMonitorStatus = ReceiveStatusValue;

interface DepositMonitorState {
  status: DepositMonitorStatus;
  layer?: DepositLayer;
  message?: string;
  updatedAt?: number;
}

function formatDepositLayer(layer?: DepositLayer): string {
  switch (layer) {
    case 'all':
      return 'all layers';
    case 'onchain':
      return 'Bitcoin L1';
    case 'lightning':
      return 'Lightning';
    case 'rgb':
      return 'RGB';
    case 'spark':
      return 'Spark';
    case 'arkade':
      return 'Arkade';
    default:
      return 'all layers';
  }
}

export default function ReceiveScreen({ navigation }: Props) {
  const dispatch = useAppDispatch();
  const theme = useAppTheme();
  const styles = useMemo(() => createReceiveStyles(theme), [theme]);
  // Narrow selectors: subscribe to ONLY the two fields this screen reads. The
  // previous coarse `state.wallet` / `state.assets` selectors re-rendered this
  // ~3k-line component on any unrelated change (price ticks, tx history, etc.).
  const btcBalance = useAppSelector((state: RootState) => state.wallet?.btcBalance);
  const rgbAssetsRaw = useAppSelector((state: RootState) => state.assets?.rgbAssets);
  // The receive/deposit flow always denominates BTC in sats (matches rate-extension):
  // integer-sats input, sats quick-amounts, and a correct ≈USD conversion. The global
  // BTC/sats display preference intentionally does NOT apply on this screen — otherwise
  // the amount field would show BTC and the USD estimate (which expects sats) would be
  // off by 1e8.
  const bitcoinUnit = 'sats' as 'BTC' | 'sats';

  // Fit the QR within the phone width while preserving a generous quiet zone.
  const { width: screenWidth } = useWindowDimensions();
  const qrSize = Math.max(96, Math.min(248, Math.round(screenWidth - 104)));
  
  // Safe destructuring with fallbacks
  const rgbAssets = (rgbAssetsRaw || []) as RGBAsset[];
  

  
  // Must call hooks first before any other code
  const getProtocolStatus = useRefreshableProtocolStatus();

  const [selectedAsset, setSelectedAsset] = useState<Asset>({
    asset_id: 'BTC',
    ticker: 'BTC',
    name: 'Bitcoin',
    isRGB: false,
  });

  // Network selection allows the per-protocol types plus a 'unified' single-QR mode.
  type ReceiveMode = ProtocolNetworkType | 'unified';
  // Default to the single "All networks" QR; specific networks are opt-in.
  const [networkType, setNetworkType] = useState<ReceiveMode>('unified');
  const [address, setAddress] = useState('');
  // Unified receive (single BIP21 QR embedding all available methods)
  const [unifiedUri, setUnifiedUri] = useState('');
  const [unifiedLoading, setUnifiedLoading] = useState(false);
  const [unifiedError, setUnifiedError] = useState<string | null>(null);
  // Single source of truth for every leg encoded in the visible QR. Generation,
  // address disclosure, deposit monitoring, and Spark claiming all consume this.
  const [receiveMethods, setReceiveMethods] = useState<ReceiveMethod[]>([]);
  const unifiedAddresses = receiveMethods;
  // Universal code: the network it is for (null = the one most accounts are on) and
  // where its Lightning leg lands (null = automatic).
  const [universalChain, setUniversalChain] = useState<ReceiveChain | null>(null);
  const [universalLn, setUniversalLn] = useState<AccountId | null>(null);
  // A Lightning receive into Arkade through a swap provider, while it is on screen.
  const [arkadeReceive, setArkadeReceive] = useState<ArkadeLightningReceive | null>(null);
  // Unified-receive asset selector: BTC (default) or USD. USD builds a BIP321 QR
  // embedding the USD-receiving methods (RGB USDT invoice, Spark).
  const [unifiedAsset, setUnifiedAsset] = useState<'BTC' | 'USD'>('BTC');
  // Lite mode: a single private BIP321 QR (BTC/$ toggle) with the advanced
  // network picker hidden behind "Show all networks".
  const disclosureLevel = useAppSelector(selectDisclosureLevel);
  const nwcWalletType = useAppSelector((state: RootState) => state.nostr?.nwcWalletType);
  const nwcCapabilities = useAppSelector((state: RootState) => state.nostr?.nwcCapabilities ?? []);
  const lastBtcReceiveRoute = useAppSelector((state: RootState) => state.settings.lastBtcReceiveRoute);
  const isLite = disclosureLevel === 'lite';
  // The account the payment lands in, for methods more than one account can receive.
  const [selectedAccount, setSelectedAccount] = useState<AccountId | null>(null);
  const restoredBtcRoute = useRef(false);
  const [amount, setAmount] = useState('');
  const [expirySeconds, setExpirySeconds] = useState(3600);
  const [showCountdown, setShowCountdown] = useState(false);

  const [loading, setLoading] = useState(false);
  const [showAssetSelector, setShowAssetSelector] = useState(false);
  // "+" opens the new-asset chooser (Spark / Arkade / new RGB asset).
  const [showNewAsset, setShowNewAsset] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [channelsLoading, setChannelsLoading] = useState(false);
  const [channelsLoaded, setChannelsLoaded] = useState(false);
  const [, setMaxDepositAmount] = useState<number>(0);
  const [arkadeSubMode, setArkadeSubMode] = useState<'ark' | 'boarding'>('ark');
  // Multi-currency amount editor (BTC / sats / USD / other fiat).
  const [showAmountEditor, setShowAmountEditor] = useState(false);
  const [showDepositSuccess, setShowDepositSuccess] = useState(false);
  const [depositMonitor, setDepositMonitor] = useState<DepositMonitorState>({ status: 'idle' });
  // The Spark BTC L1 deposit address currently on screen (if any).
  // Spark on-chain deposits must be claimed in — useSparkAutoClaim polls this.
  const sparkDepositAddress =
    receiveMethods.find((method) => method.monitor === 'spark-claim')?.value ?? null;
  const unifiedGenerationRef = React.useRef(0);
  const addressGenerationRef = React.useRef(0);
  const receiveAbortRef = React.useRef(new AbortController());
  const runReceiveOperation = React.useCallback(<T,>(
    operation: string,
    task: (signal: AbortSignal) => Promise<T>,
    timeoutMs = 8_000,
  ) => runTimedReceiveOperation(
    operation,
    task,
    timeoutMs,
    receiveAbortRef.current.signal,
  ), []);
  // Explicit Lightning refreshes reuse the existing native/deposit addresses.
  const unifiedCollectedRef = React.useRef<{
    collected: {
      btcAddress?: string;
      lightningInvoice?: string;
      sparkAddress?: string;
      arkadeAddress?: string;
    };
    sparkDeposit: string | null;
    methods: ReceiveMethod[];
  } | null>(null);

  const cancelReceiveWork = React.useCallback(() => {
    receiveAbortRef.current.abort(new Error('Receive screen work cancelled'));
    receiveAbortRef.current = new AbortController();
    unifiedGenerationRef.current += 1;
    addressGenerationRef.current += 1;
    setUnifiedLoading(false);
    setLoading(false);
  }, []);

  const resetReceiveSurface = React.useCallback(() => {
    cancelReceiveWork();
    setError(null);
    setArkadeReceive(null);
    setUnifiedError(null);
    setAddress('');
    setUnifiedUri('');
    setReceiveMethods([]);
    setDepositMonitor({ status: 'idle' });
    unifiedCollectedRef.current = null;
  }, [cancelReceiveWork]);

  // Watch for an incoming deposit whenever a receive address / invoice is shown,
  // then celebrate with the success overlay (mirrors rate-extension).
  const receiveTarget = unifiedUri || address;
  const isFocused = useIsFocused();
  const [isAppActive, setIsAppActive] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      setIsAppActive(state === 'active');
    });
    return () => subscription.remove();
  }, []);
  useEffect(() => {
    if (!isFocused || !isAppActive) cancelReceiveWork();
  }, [isFocused, isAppActive, cancelReceiveWork]);
  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', cancelReceiveWork);
    return unsubscribe;
  }, [navigation, cancelReceiveWork]);
  useEffect(() => () => {
    receiveAbortRef.current.abort(new Error('Receive screen unmounted'));
    unifiedGenerationRef.current += 1;
    addressGenerationRef.current += 1;
  }, []);
  const handleDepositStatus = React.useCallback((event: DepositDetectionEvent) => {
    setDepositMonitor({
      status: event.status,
      layer: event.layer,
      message: event.message,
      updatedAt: Date.now(),
    });
  }, []);
  const handleDepositDetected = React.useCallback((event?: DepositDetectionEvent) => {
    feedback.swap();
    setDepositMonitor({
      status: event?.status === 'claimed' ? 'claimed' : 'confirmed',
      layer: event?.layer ?? 'all',
      message: event?.message,
      updatedAt: Date.now(),
    });
    setShowDepositSuccess(true);
  }, []);
  useDepositDetection({
    enabled: !!receiveTarget && !showDepositSuccess && isFocused && isAppActive,
    methods: receiveMethods,
    onDetected: handleDepositDetected,
    onStatus: handleDepositStatus,
  });
  // Spark on-chain deposits don't show up via balance polling until claimed —
  // sweep on mount + poll-claim the on-screen deposit address.
  useSparkAutoClaim({
    address: sparkDepositAddress,
    enabled: !showDepositSuccess && isFocused && isAppActive,
    onClaimed: handleDepositDetected,
    onStatus: handleDepositStatus,
  });
  // A Lightning receive into Arkade settles only when the wallet claims the provider's
  // lockup, so poll a claim pass while the request is on screen. Restarts finish an
  // interrupted claim through the Arkade account's recovery pass.
  useEffect(() => {
    if (!arkadeReceive || !isFocused || !isAppActive || showDepositSuccess) return;
    const options = arkadeReceiveOptions();
    if (!options) return;
    let cancelled = false;
    let running = false;
    const tick = async () => {
      if (running) return;
      running = true;
      try {
        const phase = await claimArkadeLightningReceive(options.wallet, options.arkServerUrl, arkadeReceive.rfqId);
        if (cancelled) return;
        if (phase === 'settled') handleDepositDetected({ layer: 'lightning', status: 'confirmed', protocol: 'ARKADE' });
        else if (phase === 'funded') handleDepositStatus({ layer: 'lightning', status: 'pending', protocol: 'ARKADE', message: 'Payment received by the swap provider · claiming into Arkade' });
        else if (phase === 'cancelled' || phase === 'refunded' || phase === 'failed') handleDepositStatus({ layer: 'lightning', status: 'failed', protocol: 'ARKADE', message: 'The swap did not complete. No funds left your wallet.' });
      } catch { /* the next pass retries */ } finally { running = false; }
    };
    const timer = setInterval(() => { void tick(); }, 5_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [arkadeReceive, isFocused, isAppActive, showDepositSuccess, handleDepositDetected, handleDepositStatus]);
  const fiatRates = useFiatRates();

  // Channel helpers — drive which RGB networks are actually receivable.
  const hasAnyUsableChannel = (): boolean => channels.some((c) => c.is_usable);
  const hasUsableChannelForAsset = (assetId: string): boolean =>
    channels.some((c) => c.is_usable && c.asset_id === assetId);

  // Determine available network types for the SELECTED asset. Only surface a
  // network where the asset actually lives:
  //  • RGB asset → RGB-L1 (on-chain) always; RGB-LN only if a usable channel for
  //    THIS asset exists. (Spark would appear only if the same asset also
  //    existed there — it doesn't for an NWC-RLN asset.)
  //  • BTC / other families → resolved via account routing.
  const availableNetworkTypes = useMemo((): ProtocolNetworkType[] => {
    const status = getProtocolStatus();
    const family = getAssetFamily(selectedAsset.asset_id, selectedAsset.ticker);
    const networks = new Set<ProtocolNetworkType>();

    if (family === 'RGB') {
      if (status.RGB) {
        networks.add('onchain'); // RGB-L1
        const id = selectedAsset.asset_id;
        const lnReady =
          id === NEW_RGB_ASSET_ID || id === 'USD'
            ? hasAnyUsableChannel()
            : hasUsableChannelForAsset(id);
        if (lnReady) networks.add('lightning'); // RGB-LN — only with a channel
      }
    } else {
      const accounts = resolveReceiveAccounts({ assetFamily: family, accounts: status });
      for (const account of accounts) {
        for (const net of getNetworkTypesForAccount(account, family)) {
          // A plain NIP-47 wallet is Lightning-only. It shares the RGB_LN
          // adapter slot but cannot derive an on-chain/RGB address.
          if (account === 'RGB' && nwcWalletType === 'ln' && net === 'onchain') continue;
          if (
            account === 'RGB'
            && nwcWalletType === 'ln'
            && net === 'lightning'
            && !nwcCapabilities.includes('createInvoice')
          ) continue;
          networks.add(net);
        }
      }
      // An external plain NWC Lightning wallet creates invoices without exposing
      // channel inventory. RLN needs usable inbound liquidity; Spark brings its
      // own Lightning bridge.
      if (
        networks.has('lightning')
        && !hasAnyUsableChannel()
        && !status.SPARK
        && !(nwcWalletType === 'ln' && nwcCapabilities.includes('createInvoice'))
      ) {
        networks.delete('lightning');
      }
    }

    return Array.from(networks);
  }, [selectedAsset, getProtocolStatus, channels, nwcWalletType, nwcCapabilities]);

  // ── Route model: how the payment arrives (method) and which account it lands in ──
  const requestedSats = receiveAmountSats(amount, bitcoinUnit);
  const caps: ReceiveCaps = {
    nwcWalletType,
    nwcCapabilities,
    rgbChannels: !channelsLoaded ? 'unknown' : channels.some((c) => c.is_usable) ? 'some' : 'none',
  };
  const rgbLabel = rgbAccountLabel(caps);
  const connectedNow = getProtocolStatus();
  const receiveAccounts: ReceiveAccountInfo[] = (['RGB', 'SPARK', 'ARKADE', 'BARK'] as AccountId[])
    .filter((account) => connectedNow[account])
    .map((account) => ({ account, chain: receiveAccountChain(account) }));
  const isUsdAsset = /usd/i.test(selectedAsset.ticker);
  const assetFamily = isUsdAsset ? 'USD' as const : getAssetFamily(selectedAsset.asset_id, selectedAsset.ticker);
  const isRgbFamily = assetFamily === 'RGB';
  const receiveMethodIds: ReceiveMethodId[] = methodsFor(assetFamily, receiveAccounts, caps);
  const route = routeOf({ networkType, arkadeSubMode, selectedAccount });
  const destinationsOf = (method: ReceiveMethodId) => (isRgbFamily
    ? receiveAccounts.filter((a) => a.account === 'RGB').map((a) => ({
        account: 'RGB' as const, label: rgbLabel, chain: a.chain, needsAmount: false, available: true,
        detail: method === 'lightning' ? 'Your RGB channels' : 'Your RGB wallet',
      }))
    : destinationsFor(method, receiveAccounts, caps));
  const routeDestinations = destinationsOf(route.method);
  const routeDestination = route.account ?? defaultDestination(routeDestinations, null, requestedSats);
  const routeTarget = routeDestinations.find((d) => d.account === routeDestination);
  // A fixed-amount destination (Bark, Arkade Lightning) waits for an amount instead of failing.
  const awaitingAmount = networkType === 'lightning' && !!routeTarget?.needsAmount && requestedSats <= 0;

  // Universal code: one network, every account on it.
  const chainGroups = universalChains(receiveAccounts);
  const activeChain: ReceiveChain | null = chainGroups.some((g) => g.chain === universalChain)
    ? universalChain
    : chainGroups[0]?.chain ?? null;
  const universalAccounts = accountsOnChain(receiveAccounts, activeChain);
  const universalLnOptions = lightningDestinations(universalAccounts, caps);
  const universalLnAccount = universalLightning(universalLnOptions, universalLn, requestedSats);
  const nameOf = (account: AccountId) => (account === 'RGB' ? rgbLabel : accountName({ protocol: account }));
  const universalNotes = [
    ...receiveAccounts
      .filter((a) => activeChain && a.chain !== activeChain)
      .map((a) => `${nameOf(a.account)} isn't included: it's on ${chainLabel(a.chain)}.`),
    ...(() => {
      const chosen = universalLnOptions.find((d) => d.account === universalLn);
      if (chosen?.needsAmount && requestedSats <= 0) return [`Add an amount to include Lightning into ${chosen.label}.`];
      if (!universalLnAccount && universalLnOptions.some((d) => d.available)) return ['Add an amount to include Lightning: the accounts on this network need one.'];
      return [];
    })(),
  ];

  const selectRoute = (method: ReceiveMethodId, account?: AccountId | null) => {
    feedback.select();
    const dest = account ?? defaultDestination(
      destinationsOf(method),
      method === route.method ? routeDestination : selectedAccount,
      requestedSats,
    );
    const next = isRgbFamily
      ? { networkType: (method === 'lightning' ? 'lightning' : 'onchain') as ReceiveMode, arkadeSubMode: 'ark' as const, selectedAccount: 'RGB' as AccountId }
      : legacyRoute(method, dest);
    if (next.networkType === networkType && next.arkadeSubMode === arkadeSubMode && next.selectedAccount === selectedAccount) return;
    resetReceiveSurface();
    setNetworkType(next.networkType);
    setArkadeSubMode(next.arkadeSubMode);
    setSelectedAccount(next.selectedAccount);
    if (selectedAsset.ticker === 'BTC' && next.arkadeSubMode === 'ark') {
      dispatch(setLastBtcReceiveRoute({
        axis: next.selectedAccount ? 'account' : 'method',
        network: next.networkType,
        account: next.selectedAccount,
      }));
    }
  };

  // Channels decide whether the RGB node can take Lightning; read them once up front.
  useEffect(() => {
    if (getProtocolStatus().RGB && nwcWalletType !== 'ln') void loadChannels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (
      restoredBtcRoute.current
      || isLite
      || selectedAsset.ticker !== 'BTC'
      || !lastBtcReceiveRoute
    ) return;
    const routeAvailable = lastBtcReceiveRoute.network === 'unified'
      || availableNetworkTypes.includes(lastBtcReceiveRoute.network);
    if (!routeAvailable) return;
    restoredBtcRoute.current = true;
    setSelectedAccount(lastBtcReceiveRoute.account);
    setNetworkType(lastBtcReceiveRoute.network);
  }, [availableNetworkTypes, isLite, lastBtcReceiveRoute, selectedAsset.ticker]);
  
  // Constants for HTLC calculations (from desktop app)
  const MSATS_PER_SAT = 1000;
  const RGB_HTLC_MIN_SAT = 3000;

  // Load Lightning channels
  const loadChannels = async () => {
    if (channelsLoading) return;
    
    try {
      setChannelsLoading(true);
      const rgbAdapter = protocolManager.getAdapterIfAvailable('RGB_LN');
      const channelsResponse = rgbAdapter?.isConnected()
        ? await runReceiveOperation<any>('Load RGB Lightning channels', (signal) =>
            callAbortableAdapterMethod<any>(rgbAdapter, 'listChannels', [], signal))
        : { channels: [] };
      const channelsList = Array.isArray(channelsResponse) ? channelsResponse : channelsResponse.channels || [];
      setChannels(channelsList);
      setChannelsLoaded(true);
    } catch (error) {
      console.error('Failed to load channels:', error);
    } finally {
      setChannelsLoading(false);
    }
  };

  // Calculate max deposit amount based on HTLC limits (from desktop app)
  const calculateMaxDepositAmount = (asset: string): number => {
    if (channels.length === 0) {
      return 0;
    }

    if (asset === 'BTC') {
      const channelHtlcLimits = channels
        .filter(channel => channel.is_usable)
        .map(channel => channel.next_outbound_htlc_limit_msat / MSATS_PER_SAT);

      if (channelHtlcLimits.length === 0 || Math.max(...channelHtlcLimits) <= 0) {
        return 0;
      }

      const maxHtlcLimit = Math.max(...channelHtlcLimits);
      const maxDepositableAmount = maxHtlcLimit - RGB_HTLC_MIN_SAT;
      return Math.max(0, maxDepositableAmount);
    } else {
      // For RGB assets, we still need to consider the BTC HTLC limits
      // since RGB transfers require BTC for fees
      return calculateMaxDepositAmount('BTC');
    }
  };

  // Get assets available for Lightning (assets that have channels)
  const getLightningAssets = (): Asset[] => {
    const lightningAssets: Asset[] = [
      { 
        asset_id: 'BTC', 
        ticker: 'BTC', 
        name: 'Bitcoin',
        isRGB: false,
        balance: btcBalance?.vanilla?.spendable || 0,
      }
    ];

    // Add RGB assets that have Lightning channels
    const rgbAssetsWithChannels = channels
      .filter(channel => channel.asset_id && channel.asset_id !== 'BTC' && channel.is_usable)
      .map(channel => {
        const rgbAsset = rgbAssets.find(asset => asset.asset_id === channel.asset_id);
        return rgbAsset ? {
          asset_id: rgbAsset.asset_id,
          ticker: rgbAsset.ticker,
          name: rgbAsset.name,
          isRGB: true,
          balance: rgbAsset.balance || 0,
        } : null;
      })
      .filter(asset => asset !== null) as Asset[];

    // Remove duplicates
    const uniqueRgbAssets = rgbAssetsWithChannels.filter((asset, index, self) => 
      index === self.findIndex(a => a.asset_id === asset.asset_id)
    );

    return [...lightningAssets, ...uniqueRgbAssets];
  };

  // Get assets available for on-chain (all assets)
  const getOnChainAssets = (): Asset[] => [
    { 
      asset_id: 'BTC', 
      ticker: 'BTC', 
      name: 'Bitcoin',
      isRGB: false,
      balance: btcBalance?.vanilla?.spendable || 0,
    },
    ...(Array.isArray(rgbAssets) ? rgbAssets.map((asset: RGBAsset) => ({
      asset_id: asset.asset_id,
      ticker: asset.ticker,
      name: asset.name,
      isRGB: true,
      balance: asset.balance || 0,
    })) : [])
  ];

  // Get available assets based on network type (memoized to prevent re-renders)
  const allAssets: Asset[] = useMemo(() => {
    return networkType === 'lightning' 
      ? getLightningAssets() 
      : getOnChainAssets();
  }, [networkType, rgbAssets, btcBalance, channels]);

  // Enhanced validation function
  const validateAddressOrInvoice = (data: any): string | null => {
    if (!data) return null;
    
    const cleanData = typeof data === 'string' ? data.trim() : String(data).trim();
    
    if (cleanData.length === 0) return null;
    
    // More lenient validation - accept any non-empty string that looks like an address or invoice
    if (cleanData.length < 10) return null;
    
    return cleanData;
  };

  // Check if amount is required and valid. RGB invoices (L1 + LN) are open-amount
  // — the sender chooses how much asset to send — so no amount is required for
  // them. Only a plain BTC Lightning invoice needs an amount up front.
  // No receive flow strictly requires an amount: BTC Lightning, RGB-LN and RGB-L1
  // invoices are all open-amount (the sender chooses how much to send). The amount
  // is offered as an OPTIONAL convenience via the amount row + AmountEditorModal.
  const isAmountRequired = (): boolean => false;

  const isAmountValid = (): boolean => {
    if (!isAmountRequired()) return true;
    
    const numAmount = parseFloat(amount);
    return !isNaN(numAmount) && numAmount > 0;
  };

  // A Lightning invoice that pays into `account`. `layer: 'BTC_LN'` matters for Spark:
  // without it the adapter mints a native Spark invoice, not a BOLT11.
  const createLightningInvoice = async (
    account: AccountId,
    amountSats: number,
    description: string,
  ): Promise<{ invoice: string; protocol: ReceiveProtocol; monitor: ReceiveMonitorKind; arkade?: ArkadeLightningReceive }> => {
    const amountPart = amountSats > 0 ? { amount: amountSats } : {};
    if (account === 'ARKADE') {
      if (amountSats <= 0) throw new Error('Set an amount: Lightning into Arkade needs one.');
      const options = arkadeReceiveOptions();
      if (!options) throw new Error('Arkade is not connected');
      // A real swap request to a provider (RFQ), which can take a while over Nostr.
      const receive = await runReceiveOperation(
        'Create Arkade Lightning invoice',
        () => createArkadeLightningReceive(options, amountSats),
        30_000,
      );
      // The swap lands as an Arkade balance once claimed; the claim loop watches it.
      return { invoice: receive.invoice, protocol: 'ARKADE', monitor: 'balance', arkade: receive };
    }
    if (account === 'BARK') {
      const bark = protocolManager.getAdapterIfAvailable('BARK');
      if (!bark?.isConnected()) throw new Error('Bark is not connected');
      if (amountSats <= 0) throw new Error('Set an amount: Bark Lightning invoices need one.');
      // No expirySeconds: Bark sets its own invoice expiry and rejects a custom one.
      const invoice = await runReceiveOperation('Create Bark Lightning invoice', () =>
        bark.createInvoice({ layer: 'BTC_LN', amount: amountSats, description }));
      return { invoice: invoice.invoice, protocol: 'BARK', monitor: 'invoice' };
    }
    if (account === 'RGB') {
      const rgb = protocolManager.getAdapterIfAvailable('RGB_LN');
      if (!rgb?.isConnected()) throw new Error('Your Lightning node is not connected');
      const invoice = await runReceiveOperation<any>('Create RGB Lightning invoice', (signal) =>
        callAbortableAdapterMethod<any>(rgb, 'createInvoice', [{ layer: 'BTC_LN', ...amountPart, description, expirySeconds }], signal));
      return { invoice: invoice.invoice, protocol: 'RGB', monitor: 'invoice' };
    }
    const spark = protocolManager.getAdapterIfAvailable('SPARK');
    if (!spark?.isConnected()) throw new Error('Spark is not connected');
    const invoice = await runReceiveOperation('Create Spark Lightning invoice', () =>
      spark.createInvoice({ layer: 'BTC_LN', ...amountPart, description, expirySeconds }));
    return { invoice: invoice.invoice, protocol: 'SPARK', monitor: 'invoice' };
  };

  const generateAddress = async () => {
    cancelScheduledAddress.current();
    if (!selectedAsset) return;

    const generationId = addressGenerationRef.current + 1;
    addressGenerationRef.current = generationId;
    const isCurrentGeneration = () => addressGenerationRef.current === generationId;
    const startedAt = nowMs();
    receiveLog('address.start', {
      generationId,
      networkType,
      asset: selectedAsset.ticker,
      amount,
      arkadeSubMode,
    });
    setError(null);
    setReceiveMethods([]);

    if (isAmountRequired() && !isAmountValid()) {
      setError('Please enter a valid amount');
      return;
    }

    setLoading(true);
    try {
      let result: any = null;
      let methodMeta: Omit<ReceiveMethod, 'value'> | null = null;

      // ── Spark network ──
      if (networkType === 'spark') {
        try {
          const sparkAdapter = protocolManager.getAdapter('SPARK');
          const cleanAmount = amount.replace(/,/g, '');
          const numericAmount = parseFloat(cleanAmount);
          if (!isNaN(numericAmount) && numericAmount > 0) {
            // Amount-bound native Spark invoice (sats).
            const invoice = await runReceiveOperation('Create Spark invoice', () =>
              sparkAdapter.createInvoice({
                amount: receiveAmountSats(amount, bitcoinUnit),
                description: `Receive ${cleanAmount} ${bitcoinUnit}`,
                expirySeconds,
              }));
            result = invoice.invoice;
            methodMeta = {
              key: 'spark-invoice',
              label: 'Spark invoice',
              protocol: 'SPARK',
              kind: 'invoice',
              layer: 'spark',
              monitor: 'invoice',
              assetId: selectedAsset.asset_id,
            };
          } else {
            const addr = await runReceiveOperation<any>(
              'Create Spark address',
              () => sparkAdapter.getReceiveAddress('SPARK'),
            );
            result = addr.address;
            methodMeta = {
              key: 'spark',
              label: 'Spark',
              protocol: 'SPARK',
              kind: 'address',
              layer: 'spark',
              monitor: 'balance',
              assetId: selectedAsset.asset_id,
            };
          }
        } catch (err: any) {
          throw new Error(`Spark: ${err.message || 'Failed to generate address'}`);
        }
      }
      // ── Arkade network ──
      else if (networkType === 'arkade') {
        try {
          const arkadeAdapter = protocolManager.getAdapter('ARKADE');
          if (arkadeSubMode === 'boarding') {
            const addr = await runReceiveOperation<any>(
              'Create Arkade boarding address',
              () => (arkadeAdapter as any).getBoardingAddress(),
            );
            result = addr.address;
            methodMeta = {
              key: 'arkade-boarding',
              label: 'Arkade boarding',
              protocol: 'ARKADE',
              kind: 'address',
              layer: 'onchain',
              monitor: 'balance',
              assetId: selectedAsset.asset_id,
            };
          } else {
            const addr = await runReceiveOperation(
              'Create Arkade address',
              () => arkadeAdapter.getReceiveAddress(),
            );
            result = addr.address;
            methodMeta = {
              key: 'arkade',
              label: 'Arkade',
              protocol: 'ARKADE',
              kind: 'address',
              layer: 'arkade',
              monitor: 'balance',
              assetId: selectedAsset.asset_id,
            };
          }
        } catch (err: any) {
          throw new Error(`Arkade: ${err.message || 'Failed to generate address'}`);
        }
      }
      // ── Bark (Second's Ark) ──
      // Same `tark1…` prefix as Arkade but a different Ark server, so it is
      // chosen by account/mode, never inferred from the address.
      else if (networkType === 'bark') {
        try {
          const barkAdapter = protocolManager.getAdapter('BARK');
          if (arkadeSubMode === 'boarding') {
            // Funds Bark's separate on-chain wallet; BarkBoardingPanel boards it
            // into Bark once confirmed (Bark doesn't settle boarding on its own).
            result = await runReceiveOperation(
              'Create Bark deposit address',
              () => (barkAdapter as any).backend.getOnchainAddress(),
            );
            methodMeta = {
              key: 'bark-boarding',
              label: 'Bark deposit',
              protocol: 'BARK',
              kind: 'address',
              layer: 'onchain',
              monitor: 'none',
              assetId: selectedAsset.asset_id,
            };
          } else {
            const addr = await runReceiveOperation(
              'Create Bark address',
              () => barkAdapter.getReceiveAddress(),
            );
            result = addr.address;
            methodMeta = {
              key: 'bark',
              label: 'Bark',
              protocol: 'BARK',
              kind: 'address',
              layer: 'bark',
              monitor: 'balance',
              assetId: selectedAsset.asset_id,
            };
          }
        } catch (err: any) {
          throw new Error(`Bark: ${err.message || 'Failed to generate address'}`);
        }
      }
      // ── RGB / Legacy: on-chain + lightning ──
      else if (selectedAsset.asset_id === 'BTC') {
        if (networkType === 'onchain') {
          // Honour the account picked in "By account" mode. In method mode the
          // existing RGB → Spark priority remains the default.
          const rgbAdapter = protocolManager.getAdapterIfAvailable('RGB_LN');
          const sparkAdapter = protocolManager.getAdapterIfAvailable('SPARK');
          const preferSpark = routeDestination === 'SPARK';
          const rgbCanReceiveOnchain = rgbAdapter?.isConnected()
            && nwcWalletType !== 'ln'
            && (nwcWalletType == null || nwcCapabilities.includes('onchain'));
          if (!preferSpark && rgbCanReceiveOnchain) {
            const addr = await runReceiveOperation(
              'Create RGB Bitcoin address',
              (signal) => callAbortableAdapterMethod<any>(
                rgbAdapter,
                'getReceiveAddress',
                [],
                signal,
              ),
            );
            result = addr.address;
            methodMeta = {
              key: 'onchain-rgb',
              label: 'Bitcoin on-chain',
              protocol: 'RGB',
              kind: 'address',
              layer: 'onchain',
              monitor: 'balance',
              assetId: 'BTC',
            };
          } else if (sparkAdapter?.isConnected()) {
            // Spark provides a static deposit address for on-chain BTC; the
            // deposit must be claimed in — track it for useSparkAutoClaim.
            const addr = await runReceiveOperation<any>(
              'Create Spark Bitcoin deposit address',
              () => sparkAdapter.getReceiveAddress('BTC'),
            );
            result = addr.address;
            methodMeta = {
              key: 'onchain-spark',
              label: 'Bitcoin on-chain',
              protocol: 'SPARK',
              kind: 'address',
              layer: 'spark',
              monitor: 'spark-claim',
              assetId: 'BTC',
            };
          } else {
            throw new Error('No wallet connected for on-chain deposit');
          }
        } else {
          // BTC Lightning invoice into the chosen account. Open-amount where the account
          // allows it; Bark and Arkade need the amount up front.
          const account = routeDestination;
          if (!account) throw new Error('No wallet connected for Lightning invoice');
          const created = await createLightningInvoice(account, requestedSats, 'Receive Bitcoin');
          result = created.invoice;
          if (created.arkade && isCurrentGeneration()) setArkadeReceive(created.arkade);
          methodMeta = {
            key: `lightning-${account.toLowerCase()}`,
            label: 'Lightning invoice',
            protocol: created.protocol,
            kind: 'invoice',
            layer: 'lightning',
            monitor: created.monitor,
            assetId: 'BTC',
          };
        }
      } else {
        // RGB assets (require RGB adapter)
        if (networkType === 'onchain') {
          const rgbAssetAdapter = protocolManager.getAdapterIfAvailable('RGB_LN');
          if (!rgbAssetAdapter?.isConnected() || !rgbAssetAdapter.createRgbInvoice) {
            throw new Error('RGB node required for on-chain RGB asset deposits. Please configure in Settings.');
          }
          // 'RGB_NEW' = a blind invoice (no asset_id) that can receive any RGB
          // asset the user doesn't hold yet — the "New RGB asset" entry point.
          const rgbInvoice = await runReceiveOperation('Create RGB asset invoice', (signal) =>
            callAbortableAdapterMethod<any>(
              rgbAssetAdapter,
              'createRgbInvoice',
              [{
                ...(selectedAsset.asset_id === NEW_RGB_ASSET_ID ? {} : { asset_id: selectedAsset.asset_id }),
                min_confirmations: 1,
                duration_seconds: expirySeconds,
              }],
              signal,
            ));
          result = rgbInvoice?.invoice ?? rgbInvoice?.recipient_id;
          methodMeta = {
            key: 'rgb-onchain',
            label: 'RGB invoice',
            protocol: 'RGB',
            kind: 'invoice',
            layer: 'rgb',
            monitor: selectedAsset.asset_id === NEW_RGB_ASSET_ID ? 'none' : 'balance',
            assetId: selectedAsset.asset_id,
          };
        } else {
          // RGB-over-Lightning invoice, always open-amount: the sender fills it in.
          // `amount` is the BTC/sats request (the amount row is hidden for RGB
          // assets), so it must never be read as asset units here.
          const rgbAssetLnAdapter = protocolManager.getAdapterIfAvailable('RGB_LN');
          if (!rgbAssetLnAdapter?.isConnected()) {
            throw new Error('RGB node required for RGB Lightning deposits. Please configure in Settings.');
          }
          const assetInvoice = await runReceiveOperation('Create RGB Lightning asset invoice', (signal) =>
            callAbortableAdapterMethod<any>(
              rgbAssetLnAdapter,
              'createInvoice',
              [{
                asset: selectedAsset.asset_id,
                description: `Receive ${selectedAsset.ticker}`,
                expirySeconds,
              }],
              signal,
            ));
          result = assetInvoice.invoice;
          methodMeta = {
            key: 'rgb-lightning',
            label: 'RGB Lightning invoice',
            protocol: 'RGB',
            kind: 'invoice',
            layer: 'lightning',
            monitor: 'invoice',
            assetId: selectedAsset.asset_id,
          };
        }
      }

      const validatedResult = validateAddressOrInvoice(result);
      if (!isCurrentGeneration()) {
        receiveLog('address.stale', { generationId, activeGenerationId: addressGenerationRef.current });
        return;
      }
      if (validatedResult) {
        setAddress(validatedResult);
        if (methodMeta) setReceiveMethods([{ ...methodMeta, value: validatedResult }]);
        setError(null);
        receiveLog('address.complete', {
          networkType,
          asset: selectedAsset.ticker,
          length: validatedResult.length,
          ms: Math.round(nowMs() - startedAt),
        });
      } else {
        throw new Error('Unable to generate a valid address or invoice. Please try again.');
      }
    } catch (error) {
      if (!isCurrentGeneration()) {
        receiveLog('address.staleError', { generationId, activeGenerationId: addressGenerationRef.current });
        return;
      }
      console.error('Failed to generate address:', error);
      receiveLog('address.error', {
        generationId,
        networkType,
        asset: selectedAsset.ticker,
        ms: Math.round(nowMs() - startedAt),
      });
      const errorMessage = error instanceof Error ? error.message : 'Failed to generate address. Please try again.';
      if (errorMessage.includes('No uncolored UTXOs')) {
        setError('No uncolored UTXOs available. Please create UTXOs first or try a different network.');
      } else {
        setError(errorMessage);
      }
      setAddress('');
    } finally {
      if (isCurrentGeneration()) setLoading(false);
    }
  };

  // ──────────────────────────────────────────────────────────────────────
  // USD unified receive: a BIP321 QR (address-less) embedding the ways to receive
  // USD (USDt) across protocols — an RGB USDT invoice (RGB-LN or RGB-L1) and
  // the Spark address. Caller has already reset loading/error state.
  const generateUsdUnifiedUri = async (generationId: number, allowRgb: boolean) => {
    const isCurrentGeneration = () => unifiedGenerationRef.current === generationId;
    const startedAt = nowMs();
    receiveLog('unified.usd.start', { generationId });
    const rgb = protocolManager.getAdapterIfAvailable('RGB_LN');
    const spark = protocolManager.getAdapterIfAvailable('SPARK');
    receiveLog('unified.usd.adapters', {
      generationId,
      rgb: !!rgb?.isConnected(),
      spark: !!spark?.isConnected(),
    });

    let sparkAddress: string | undefined;
    let rgbInvoice: string | undefined;

    // The RGB USDT asset (from the loaded RGB assets), for an RGB invoice.
    const usdtRgb = rgbAssets.find((a) => /usdt/i.test(a.ticker));

    try {
      await Promise.allSettled([
        // 1) RGB USDT invoice (covers RGB-LN and RGB on-chain L1).
        (async () => {
          const taskStartedAt = nowMs();
          if (!allowRgb || !rgb?.isConnected() || !usdtRgb?.asset_id || !rgb.createRgbInvoice) return;
          try {
            const inv: any = await runReceiveOperation(
              'Create RGB USDT invoice',
              (signal) => callAbortableAdapterMethod<any>(
                rgb,
                'createRgbInvoice',
                [{ assetId: usdtRgb.asset_id }],
                signal,
              ),
            );
            const invoice = inv?.invoice ?? inv?.recipient_id;
            if (invoice) rgbInvoice = invoice;
            receiveLog('unified.usd.rgb.done', {
              generationId,
              ok: !!invoice,
              ms: Math.round(nowMs() - taskStartedAt),
            });
          } catch (e) { console.warn('USD: RGB invoice failed', e); }
        })(),

        // 2) Spark address (for a Spark USD token transfer).
        (async () => {
          const taskStartedAt = nowMs();
          if (!spark?.isConnected()) return;
          try {
            const addr = await runReceiveOperation(
              'Create Spark USD address',
              () => spark.getReceiveAddress('SPARK'),
            );
            if (addr?.address) sparkAddress = addr.address;
            receiveLog('unified.usd.spark.done', {
              generationId,
              ok: !!addr?.address,
              ms: Math.round(nowMs() - taskStartedAt),
            });
          } catch (e) { console.warn('USD: Spark address failed', e); }
        })(),
      ]);

      if (!sparkAddress && !rgbInvoice) {
        if (isCurrentGeneration()) {
          receiveLog('unified.usd.empty', {
            generationId,
            ms: Math.round(nowMs() - startedAt),
          });
          setUnifiedError('No USD receive method available. Connect an RGB node or Spark.');
        }
        return;
      }

      if (!isCurrentGeneration()) {
        receiveLog('unified.usd.stale', { generationId, activeGenerationId: unifiedGenerationRef.current });
        return;
      }

      const methods: string[] = [];
      if (rgbInvoice) methods.push('RGB USDT');
      if (sparkAddress) methods.push('Spark');

      setReceiveMethods(
        [
          rgbInvoice && usdtRgb && {
            key: 'rgb',
            label: 'RGB USDT invoice',
            value: rgbInvoice,
            protocol: 'RGB',
            kind: 'invoice',
            layer: 'rgb',
            monitor: 'balance',
            assetId: usdtRgb.asset_id,
          },
          sparkAddress && {
            key: 'spark',
            label: 'Spark',
            value: sparkAddress,
            protocol: 'SPARK',
            kind: 'address',
            layer: 'spark',
            monitor: 'none',
            assetId: 'USD',
          },
        ].filter(Boolean) as ReceiveMethod[],
      );

      const uri = buildUnifiedReceiveURI({
        sparkAddress,
        rgbInvoice,
        // Marks this as a token request, so no wallet pays it as plain bitcoin.
        assetId: usdtRgb?.asset_id ?? 'USD',
        label: 'KaleidoSwap USD',
      });
      setUnifiedUri(uri);
      receiveLog('unified.usd.complete', {
        generationId,
        methods,
        uriLength: uri.length,
        ms: Math.round(nowMs() - startedAt),
      });
    } catch (e: any) {
      console.error('USD: unified receive failed', e);
      if (isCurrentGeneration()) {
        setUnifiedError(e?.message || 'Failed to build USD receive code.');
      }
    } finally {
      if (isCurrentGeneration()) {
        setUnifiedLoading(false);
      }
    }
  };

  // Unified receive: build ONE BIP321 QR embedding every available method.
  // Defensive — each adapter call is wrapped so a missing/disconnected
  // protocol is silently skipped rather than failing the whole QR.
  // ──────────────────────────────────────────────────────────────────────
  const generateUnifiedUri = async ({
    includeLightning = true,
    preserveExisting = false,
    reason = 'manual',
  }: {
    includeLightning?: boolean;
    preserveExisting?: boolean;
    reason?: string;
  } = {}) => {
    cancelScheduledUnified.current();
    const startedAt = nowMs();
    const generationId = unifiedGenerationRef.current + 1;
    unifiedGenerationRef.current = generationId;
    const isCurrentGeneration = () => unifiedGenerationRef.current === generationId;
    receiveLog('unified.start', {
      generationId,
      unifiedAsset,
      amount,
      networkType,
      includeLightning,
      preserveExisting,
      reason,
    });

    setUnifiedError(null);
    setUnifiedLoading(true);
    // A manual refresh keeps the current code on screen until the new one is ready:
    // clearing it re-armed the automatic generation, which then replaced the refresh.
    if (!preserveExisting && reason !== 'manual') {
      setUnifiedUri('');
      setReceiveMethods([]);
      unifiedCollectedRef.current = null;
    }

    if (unifiedAsset === 'USD') {
      await generateUsdUnifiedUri(generationId, reason === 'manual');
      return;
    }

    // One code carries one network: only accounts on the chosen chain take part
    // (a test setup can have Spark on regtest and Arkade on mutinynet).
    const on = (account: AccountId) => universalAccounts.some((a) => a.account === account);
    const rgb = on('RGB') ? protocolManager.getAdapterIfAvailable('RGB_LN') : undefined;
    const spark = on('SPARK') ? protocolManager.getAdapterIfAvailable('SPARK') : undefined;
    const arkade = on('ARKADE') ? protocolManager.getAdapterIfAvailable('ARKADE') : undefined;
    const bark = on('BARK') ? protocolManager.getAdapterIfAvailable('BARK') : undefined;
    receiveLog('unified.adapters', {
      generationId,
      chain: activeChain,
      rgb: !!rgb?.isConnected(),
      spark: !!spark?.isConnected(),
      arkade: !!arkade?.isConnected(),
      bark: !!bark?.isConnected(),
    });

    // Optional amount (in sats) for the Lightning leg / BIP21 amount.
    const amountSats = requestedSats;

    // Reuse native addresses only when the user explicitly refreshes Lightning.
    const cached = unifiedCollectedRef.current;
    const reuseAddrs = preserveExisting && includeLightning && !!cached;
    const collected: {
      btcAddress?: string;
      lightningInvoice?: string;
      sparkAddress?: string;
      arkadeAddress?: string;
    } = reuseAddrs ? { ...cached!.collected, lightningInvoice: undefined } : {};
    // When reusing, carry the Spark deposit address forward.
    let nextSparkDepositAddress: string | null = reuseAddrs ? cached!.sparkDeposit : null;
    let nextMethods: ReceiveMethod[] = reuseAddrs
      ? cached!.methods.filter((method) => method.layer !== 'lightning')
      : [];
    const addMethod = (method: ReceiveMethod) => {
      nextMethods = upsertReceiveMethod(nextMethods, method);
    };
    let nextArkadeReceive: ArkadeLightningReceive | null = null;
    const buildCurrentUnifiedUri = () => buildUnifiedReceiveURI({
      btcAddress: collected.btcAddress,
      lightningInvoice: collected.lightningInvoice,
      sparkAddress: collected.sparkAddress,
      arkadeAddress: collected.arkadeAddress,
      amountBtc: amountSats > 0 ? amountSats / 1e8 : undefined,
      label: 'KaleidoSwap',
    });

    const addressTasks: Array<() => Promise<void>> = reuseAddrs ? [] : [
      // 1) Bitcoin on-chain: the RGB node, else Spark's deposit address, else Arkade boarding.
      async () => {
        const taskStartedAt = nowMs();
        try {
          // The RGB/NWC address is a remote round trip; automatic generation uses it only
          // when no local account on this chain can give an address.
          const rgbCanCreateOnchainAddress = rgb?.isConnected()
            && nwcWalletType !== 'ln'
            && (nwcWalletType == null || nwcCapabilities.includes('onchain'));
          if (rgbCanCreateOnchainAddress && (reason === 'manual' || (!spark?.isConnected() && !arkade?.isConnected()))) {
            const addr = await runReceiveOperation<any>(
              'Create unified RGB Bitcoin address',
              (signal) => callAbortableAdapterMethod<any>(rgb, 'getReceiveAddress', [], signal),
            ).catch(() => null);
            if (addr?.address) {
              collected.btcAddress = addr.address;
              addMethod({
                key: 'onchain', label: 'Bitcoin on-chain', value: addr.address,
                protocol: 'RGB', kind: 'address', layer: 'onchain', monitor: 'balance', assetId: 'BTC',
              });
            }
          }
          if (!collected.btcAddress && spark?.isConnected()) {
            const addr = await runReceiveOperation('Create unified Spark Bitcoin address', () => spark.getReceiveAddress('BTC'))
              .catch(() => null);
            if (addr?.address) {
              collected.btcAddress = addr.address;
              // Spark on-chain deposit → needs claim/sweep (useSparkAutoClaim).
              nextSparkDepositAddress = addr.address;
              addMethod({
                key: 'onchain', label: 'Bitcoin on-chain', value: addr.address,
                protocol: 'SPARK', kind: 'address', layer: 'spark', monitor: 'spark-claim', assetId: 'BTC',
              });
            }
          }
          if (!collected.btcAddress && arkade?.isConnected()) {
            const addr = await runReceiveOperation<any>('Create unified Arkade boarding address', () => (arkade as any).getBoardingAddress())
              .catch(() => null);
            if (addr?.address) {
              collected.btcAddress = addr.address;
              addMethod({
                key: 'onchain', label: 'Bitcoin on-chain', value: addr.address,
                protocol: 'ARKADE', kind: 'address', layer: 'onchain', monitor: 'balance', assetId: 'BTC',
              });
            }
          }
          receiveLog('unified.onchain.done', { generationId, ok: !!collected.btcAddress, ms: Math.round(nowMs() - taskStartedAt) });
        } catch (e) { console.warn('Unified: on-chain address failed', e); }
      },

      // 2) Spark native address.
      async () => {
        if (!spark?.isConnected()) return;
        try {
          const addr = await runReceiveOperation('Create unified Spark address', () => spark.getReceiveAddress('SPARK'));
          if (addr?.address) {
            collected.sparkAddress = addr.address;
            addMethod({
              key: 'spark', label: 'Spark', value: addr.address,
              protocol: 'SPARK', kind: 'address', layer: 'spark', monitor: 'balance', assetId: 'BTC',
            });
          }
        } catch (e) { console.warn('Unified: Spark address failed', e); }
      },

      // 3) Ark address: Arkade, else Bark (a code holds one Ark address).
      async () => {
        const ark = arkade?.isConnected() ? arkade : bark?.isConnected() ? bark : undefined;
        if (!ark) return;
        const protocol: ReceiveProtocol = ark === arkade ? 'ARKADE' : 'BARK';
        try {
          const addr = await runReceiveOperation(`Create unified ${protocol === 'ARKADE' ? 'Arkade' : 'Bark'} address`, () => ark.getReceiveAddress());
          if (addr?.address) {
            collected.arkadeAddress = addr.address;
            addMethod({
              key: 'ark', label: protocol === 'ARKADE' ? 'Arkade' : 'Bark', value: addr.address,
              protocol, kind: 'address', layer: protocol === 'ARKADE' ? 'arkade' : 'bark', monitor: 'balance', assetId: 'BTC',
            });
          }
        } catch (e) { console.warn('Unified: Ark address failed', e); }
      },
    ];

    // The Lightning leg lands in the chosen account (automatic: Spark, the RGB node,
    // then Bark with an amount). It always runs when requested, even on the reuse pass.
    const lightningTasks: Array<() => Promise<void>> = includeLightning && universalLnAccount
      ? [
          async () => {
            const taskStartedAt = nowMs();
            try {
              const created = await createLightningInvoice(universalLnAccount, amountSats, 'Receive Bitcoin');
              if (created.invoice) {
                collected.lightningInvoice = created.invoice;
                if (created.arkade) nextArkadeReceive = created.arkade;
                addMethod({
                  key: 'lightning', label: 'Lightning invoice', value: created.invoice,
                  protocol: created.protocol, kind: 'invoice', layer: 'lightning', monitor: created.monitor, assetId: 'BTC',
                });
              }
              receiveLog('unified.lightning.done', { generationId, ok: !!created.invoice, ms: Math.round(nowMs() - taskStartedAt) });
            } catch (e) { console.warn('Unified: Lightning invoice failed', e); }
          },
        ]
      : [];

    // Every leg is fetched at once (each is bounded by its own timeout), and the
    // code is published only when all have answered: a visible request is never
    // silently replaced by a partial version.
    await Promise.all([...addressTasks, ...lightningTasks].map((task) => task()));
    if (!isCurrentGeneration()) {
      receiveLog('unified.stale', { generationId, activeGenerationId: unifiedGenerationRef.current });
      return;
    }

    const methods: string[] = [];
    if (collected.btcAddress) methods.push('On-chain');
    if (collected.lightningInvoice) methods.push('Lightning');
    if (collected.sparkAddress) methods.push('Spark');
    if (collected.arkadeAddress) methods.push('Ark');

    if (methods.length === 0) {
      receiveLog('unified.empty', {
        generationId,
        ms: Math.round(nowMs() - startedAt),
      });
      setUnifiedError(
        rgb?.isConnected() && reason !== 'manual'
          ? 'RGB receive is available. Tap Try Again to generate it explicitly without blocking the screen in the background.'
          : 'None of your accounts could create a payment code. Check that they are connected, then try again.',
      );
      setUnifiedLoading(false);
      return;
    }

    try {
      const uri = buildCurrentUnifiedUri();

      // Keep addresses available for an explicit invoice refresh.
      unifiedCollectedRef.current = {
        collected: { ...collected },
        sparkDeposit: nextSparkDepositAddress,
        methods: nextMethods,
      };

      setReceiveMethods(nextMethods);
      setArkadeReceive(nextArkadeReceive);
      setUnifiedUri(uri);
      receiveLog('unified.complete', {
        generationId,
        methods,
        uriLength: uri.length,
        ms: Math.round(nowMs() - startedAt),
      });
    } catch (e: any) {
      console.error('Unified: buildUnifiedReceiveURI failed', e);
      setUnifiedError(e?.message || 'Failed to build receive code.');
    }
    setUnifiedLoading(false);
  };

  const cancelScheduledUnified = useReceiveGeneration(
    networkType === 'unified' ? JSON.stringify([unifiedAsset, amount, expirySeconds, activeChain, universalLnAccount]) : null,
    () => setUnifiedLoading(true),
    () => { void generateUnifiedUri({ includeLightning: true, reason: 'auto' }); },
    () => { unifiedGenerationRef.current += 1; },
    isFocused && isAppActive && !unifiedUri,
  );

  // Keep the unified BTC/USD asset in sync with the selected asset tab.
  useEffect(() => {
    if (selectedAsset.ticker === 'BTC') {
      setUnifiedAsset('BTC');
    } else if (/usd/i.test(selectedAsset.ticker)) {
      setUnifiedAsset('USD');
    }
  }, [selectedAsset]);

  // "All networks" can only encode BTC or USD — a custom RGB asset falls back
  // to a specific on-chain (RGB) invoice.
  useEffect(() => {
    const t = selectedAsset.ticker;
    const isBtcOrUsd = t === 'BTC' || /usd/i.test(t);
    if (!isBtcOrUsd && networkType === 'unified') {
      setNetworkType('onchain');
    }
  }, [selectedAsset.asset_id, networkType, arkadeSubMode, selectedAccount]);

  // Update max amounts when network or channels change
  useEffect(() => {
    if (networkType === 'lightning' && selectedAsset) {
      const maxAmount = calculateMaxDepositAmount(
        selectedAsset.asset_id === 'BTC' ? 'BTC' : selectedAsset.asset_id
      );
      setMaxDepositAmount(maxAmount);
    } else {
      setMaxDepositAmount(0);
    }
  }, [networkType, selectedAsset, channels]);

  // Reset selected asset if not available in current network type
  useEffect(() => {
    if (selectedAsset && allAssets.length > 0) {
      const isAssetAvailable =
        selectedAsset.asset_id === NEW_RGB_ASSET_ID ||
        // Synthetic 'USD' isn't a real per-network asset (it's the multi-protocol
        // USD aggregator) so it never appears in allAssets — don't bounce it to BTC.
        selectedAsset.asset_id === 'USD' ||
        /usd/i.test(selectedAsset.ticker) ||
        allAssets.some(asset => asset.asset_id === selectedAsset.asset_id);
      if (!isAssetAvailable) {
        // Reset to BTC if current asset is not available
        const btcAsset = allAssets.find(asset => asset.asset_id === 'BTC');
        if (btcAsset) {
          setSelectedAsset(btcAsset);
        } else if (allAssets.length > 0) {
          setSelectedAsset(allAssets[0]);
        }
      }
    }
  }, [allAssets]);

  // A single request identity prevents overlapping amount/network regeneration.
  const cancelScheduledAddress = useReceiveGeneration(
    networkType !== 'unified' && !awaitingAmount ? JSON.stringify([selectedAsset.asset_id, networkType, arkadeSubMode, routeDestination, amount, expirySeconds]) : null,
    () => { setAddress(''); setError(null); setLoading(true); },
    () => { void generateAddress(); },
    () => { addressGenerationRef.current += 1; },
    isFocused && isAppActive && !address,
  );

  // ── Amount <-> sats bridging for the multi-currency editor ────────────────
  const SATS_PER_BTC = 1e8;
  const currentAmountSats = receiveAmountSats(amount, bitcoinUnit);

  const applyAmountSats = (sats: number) => {
    const next = !sats || sats <= 0 ? ''
      : bitcoinUnit === 'BTC' ? (sats / SATS_PER_BTC).toString() : String(Math.round(sats));
    if (next === amount) return;
    // Hide/cancel the old request before the debounced replacement starts.
    resetReceiveSurface();
    setAmount(next);
  };

  // Human label for the current requested amount (BTC view + ≈USD).
  const amountSummary = (): string | null => {
    if (!currentAmountSats) return null;
    const unit = bitcoinUnit === 'BTC'
      ? `${(currentAmountSats / SATS_PER_BTC).toFixed(8)} BTC`
      : `${currentAmountSats.toLocaleString()} sats`;
    const usd = fiatRates['usd'];
    return usd
      ? `${unit}  ·  ≈ $${((currentAmountSats / SATS_PER_BTC) * usd).toFixed(2)}`
      : unit;
  };

  // Network color coding — sourced from the shared theme tokens so Send and
  // Receive stay in sync (matches rate-extension).
  const NETWORK_COLORS: Record<string, string> = theme.colors.networks;
  const isGeneratingReceive =
    (networkType === 'unified' && unifiedLoading && !unifiedUri) ||
    (networkType !== 'unified' && loading && !address);
  const monitorStatus: DepositMonitorStatus =
    isGeneratingReceive ? 'generating' : depositMonitor.status === 'idle' ? 'watching' : depositMonitor.status;
  const monitorVisible =
    isGeneratingReceive ||
    (!!receiveTarget && !showDepositSuccess) ||
    ['pending', 'claimed', 'failed', 'expired'].includes(depositMonitor.status);

  // Handle a pick from the "+" new-asset sheet: switch to a fresh receive on the
  // chosen protocol (Spark / Arkade address, or a blind RGB invoice).
  const handleNewAsset = (kind: NewAssetKind) => {
    feedback.select();
    resetReceiveSurface();
    if (kind === 'spark') {
      setSelectedAsset({ asset_id: 'BTC', ticker: 'BTC', name: 'Bitcoin', isRGB: false, balance: btcBalance?.vanilla?.spendable || 0 });
      setNetworkType('spark');
    } else if (kind === 'arkade') {
      setSelectedAsset({ asset_id: 'BTC', ticker: 'BTC', name: 'Bitcoin', isRGB: false, balance: btcBalance?.vanilla?.spendable || 0 });
      setNetworkType('arkade');
    } else {
      // New RGB asset → blind RGB invoice via the on-chain RGB path.
      setSelectedAsset({ asset_id: NEW_RGB_ASSET_ID, ticker: 'RGB', name: 'New RGB asset', isRGB: true });
      setNetworkType('onchain');
    }
  };

  // ── Asset tabs: BTC | USD | (custom) | + ──────────────────────────────────
  const renderAssetTabs = () => {
    const accent = theme.colors.primary[500];
    const t = selectedAsset.ticker;
    const isBtc = t === 'BTC';
    const isUsd = /usd/i.test(t);
    const isCustom = !isBtc && !isUsd;

    const selectBtc = () => {
      feedback.select();
      if (isBtc && networkType === 'unified') return;
      resetReceiveSurface();
      setUnifiedAsset('BTC');
      setSelectedAsset({
        asset_id: 'BTC', ticker: 'BTC', name: 'Bitcoin', isRGB: false,
        balance: btcBalance?.vanilla?.spendable || 0,
      });
      setSelectedAccount(null);
      setArkadeSubMode('ark');
      setNetworkType('unified');
    };
    const selectUsd = () => {
      feedback.select();
      if (isUsd && networkType === 'unified') return;
      resetReceiveSurface();
      // USD always routes through the unified USD aggregator (RGB USDT + Spark) — see generateUsdUnifiedUri, which finds the held RGB USDT
      // itself. Use the synthetic 'USD' asset (not a specific RGB USDT) so the
      // behaviour is identical whether or not an RGB USDT is held, and force the
      // unified view so the aggregator actually runs.
      setUnifiedAsset('USD');
      setSelectedAsset({ asset_id: 'USD', ticker: 'USD', name: 'US Dollar', isRGB: false });
      setSelectedAccount(null);
      setArkadeSubMode('ark');
      setNetworkType('unified');
    };

    const Tab = (
      key: string,
      active: boolean,
      onPress: () => void,
      icon: React.ReactNode,
      label: string
    ) => (
      <TouchableOpacity
        key={key}
        accessibilityRole="tab" accessibilityLabel={`Receive ${label}`} accessibilityState={{ selected: active }}
        style={[styles.assetTab, active && { borderColor: accent, backgroundColor: accent + '15' }]}
        onPress={onPress}
        activeOpacity={0.7}
      >
        {icon}
        <Text
          style={[styles.assetTabText, active && { color: accent, fontWeight: '700' }]}
          numberOfLines={1}
        >
          {label}
        </Text>
      </TouchableOpacity>
    );

    return (
      <View style={styles.assetTabs}>
        {Tab('BTC', isBtc, selectBtc, <AssetIcon ticker="BTC" size={20} showBadge={false} />, 'BTC')}
        {Tab('USD', isUsd, selectUsd, <UsdCoinIcon size={20} />, 'USD')}
        {isCustom &&
          Tab('custom', true, () => {}, (
            <AssetIcon
              ticker={t}
              protocol={selectedAsset.isRGB ? 'RGB' : undefined}
              size={20}
              showBadge={false}
            />
          ), t)}
        <TouchableOpacity
          style={styles.assetAddTab}
          accessibilityRole="button" accessibilityLabel="Receive another asset"
          onPress={() => { feedback.select(); setShowNewAsset(true); }}
          activeOpacity={0.7}
        >
          <Ionicons name="add" size={20} color={theme.colors.text.secondary} />
        </TouchableOpacity>
      </View>
    );
  };

  // ── Amount row with pencil edit (opens the multi-currency editor) ─────────
  const renderAmountRow = () => {
    // The amount editor works in BTC/sats/fiat — it can't express an RGB asset
    // amount, and RGB invoices are open-amount anyway, so hide it for RGB assets.
    if (selectedAsset?.isRGB) return null;
    // Arkade and on-chain addresses don't carry an amount; offering one there
    // would suggest the payer is asked for it when they aren't.
    if (networkType === 'arkade' || networkType === 'bark' || networkType === 'onchain') return null;
    const summary = amountSummary();
    const required = isAmountRequired();
    return (
      <TouchableOpacity
        accessibilityRole="button" accessibilityLabel={summary ? `Edit requested amount, ${summary}` : 'Add requested amount'}
        style={[styles.amountRow, { paddingVertical: theme.spacing[2], borderWidth: 0, backgroundColor: 'transparent' }]}
        onPress={() => {
          receiveLog('tap.amountRow', { amount, networkType, asset: selectedAsset.ticker });
          setShowAmountEditor(true);
        }}
        activeOpacity={0.7}
      >
        <View style={{ flex: 1 }}>
          <Text style={styles.amountRowLabel}>{summary ? 'Requested amount' : required || awaitingAmount ? 'Amount required' : 'Add amount · optional'}</Text>
          {!!summary && <Text style={styles.amountRowValue}>{summary}</Text>}
        </View>
        <Ionicons name={summary ? 'pencil-outline' : 'add-circle-outline'} size={22} color={theme.colors.primary[500]} />
      </TouchableOpacity>
    );
  };

  const renderUnifiedContent = () => {
    const accent = NETWORK_COLORS['unified'];
    return renderUnifiedBody(accent);
  };

  // Clean QR-sized loader (no copy text) — a spinner sitting where the QR will be.
  const renderQrLoading = (_accent: string) => (
    <View style={styles.qrSection}><ReceiveQr value="" size={qrSize} /></View>
  );

  const renderUnifiedBody = (accent: string) => {
    // Show the loader until the complete request is ready to be published.
    if (unifiedLoading && !unifiedUri) {
      return renderQrLoading(accent);
    }

    if (unifiedError && !unifiedUri) {
      return (
        <View style={styles.errorContainer}>
          <Ionicons name="alert-circle" size={48} color={theme.colors.error[500]} />
          <Text style={styles.errorText}>{unifiedError}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={() => generateUnifiedUri()} activeOpacity={0.7}>
            <Text style={styles.retryButtonText}>Try Again</Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (!unifiedUri) {
      return (
        <View style={styles.promptContainer}>
          <Ionicons name="apps-outline" size={48} color={accent} />
          <Text style={styles.promptText}>
            Generate a single QR that any wallet can pay — on-chain, Lightning, Spark and Arkade combined.
          </Text>
          <TouchableOpacity style={[styles.generateButton, { backgroundColor: accent }]} onPress={() => generateUnifiedUri()} activeOpacity={0.7}>
            <Text style={styles.generateButtonText}>Generate</Text>
          </TouchableOpacity>
        </View>
      );
    }

    return (
      <View style={styles.qrSection}>
        {/* Explain the universal request in plain language. This gives the user
            confidence that one QR intentionally covers several Bitcoin rails. */}
        <View style={styles.qrTopBar}>
          <Text style={[styles.universalRequestTitle, { flex: 1 }]}>
            Scan with any wallet{unifiedAsset === 'BTC' && activeChain && activeChain !== 'mainnet' ? ` · ${chainLabel(activeChain)}` : ''}
          </Text>
          <TouchableOpacity
            onPress={() => generateUnifiedUri()}
            style={styles.qrRefreshBtn}
            accessibilityRole="button" accessibilityLabel="Refresh payment request"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            activeOpacity={0.7}
          >
            <Ionicons name="refresh" size={15} color={theme.colors.text.tertiary} />
          </TouchableOpacity>
        </View>

        {unifiedLoading && (
          <View style={styles.qrStreamHint}>
            <ActivityIndicator size="small" color={accent} />
            <Text style={styles.qrStreamHintText}>
              Updating your request…
            </Text>
          </View>
        )}

        <View style={styles.qrContainer}>
          <ReceiveQr value={unifiedUri} size={qrSize} />
        </View>
        {renderAmountRow()}

        {unifiedAddresses.filter(a => /^ln(bc|tb|bcrt)/i.test(a.value)).map(a => <InvoiceExpiry showCountdown={showCountdown} key={a.key} invoice={a.value} onRefresh={() => { void generateUnifiedUri({ includeLightning: true, preserveExisting: true, reason: 'manual' }); }} />)}
        <ReceiveRequestActions value={unifiedUri} />
        <ReceiveRequestDetails
          methods={receiveMethods}
          universal
          notes={unifiedAsset === 'BTC' ? universalNotes : []}
          qrSize={qrSize}
          rgbLabel={rgbLabel}
          onRefresh={() => { void generateUnifiedUri({ includeLightning: true, preserveExisting: true, reason: 'manual' }); }}
        />
      </View>
    );
  };

  const renderContent = () => {
    if (networkType === 'unified') {
      return renderUnifiedContent();
    }

    if (awaitingAmount && routeTarget) {
      return (
        <View style={styles.promptContainer}>
          <Ionicons name="calculator-outline" size={48} color={theme.colors.primary[500]} />
          <Text style={styles.promptText}>
            Lightning into {routeTarget.label} needs a fixed amount. Add how much you want to receive.
          </Text>
          <TouchableOpacity style={styles.generateButton} onPress={() => setShowAmountEditor(true)} activeOpacity={0.7}>
            <Text style={styles.generateButtonText}>Add amount</Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (loading) {
      return renderQrLoading(NETWORK_COLORS[networkType] || theme.colors.primary[500]);
    }

    if (error) {
      return (
        <View style={styles.errorContainer}>
          <Ionicons name="alert-circle" size={48} color={theme.colors.error[500]} />
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity 
            style={styles.retryButton} 
            onPress={generateAddress}
            activeOpacity={0.7}
          >
            <Text style={styles.retryButtonText}>Try Again</Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (isAmountRequired() && !isAmountValid()) {
      return (
        <View style={styles.promptContainer}>
          <Ionicons name="calculator" size={48} color={theme.colors.primary[500]} />
          <Text style={styles.promptText}>
            Please enter an amount to generate a Lightning invoice
          </Text>
          {renderAmountRow()}
        </View>
      );
    }

    if (!address) {
      return (
        <View style={styles.promptContainer}>
          <Ionicons name="qr-code-outline" size={48} color={theme.colors.primary[500]} />
          <Text style={styles.promptText}>
            Generate an address or invoice to receive payments
          </Text>
          <TouchableOpacity 
            style={styles.generateButton} 
            onPress={generateAddress}
            activeOpacity={0.7}
          >
            <Text style={styles.generateButtonText}>Generate</Text>
          </TouchableOpacity>
        </View>
      );
    }

    const method = receiveMethods[0];
    const title = networkType === 'lightning' ? (selectedAsset.isRGB ? 'RGB Lightning invoice' : 'Lightning invoice')
      : networkType === 'spark' ? (method?.kind === 'invoice' ? 'Spark invoice' : 'Spark address')
      : (networkType === 'arkade' || networkType === 'bark') && arkadeSubMode === 'ark' ? 'Ark address'
      : selectedAsset.isRGB ? 'RGB invoice'
      : 'Bitcoin address';
    const swapNote = arkadeReceive && method?.protocol === 'ARKADE' && method.layer === 'lightning'
      ? `The sender pays ${arkadeReceive.payAmountSats.toLocaleString()} sats; ${(arkadeReceive.payAmountSats - arkadeReceive.amountSats).toLocaleString()} sats go to ${arkadeReceive.provider} for the swap.`
      : undefined;
    return (
      <View style={styles.qrSection}>
        <View style={styles.qrTopBar}>
          <Text style={[styles.universalRequestTitle, { flex: 1 }]}>{title}</Text>
          <TouchableOpacity
            onPress={generateAddress}
            style={styles.qrRefreshBtn}
            accessibilityRole="button" accessibilityLabel="Refresh payment request"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            activeOpacity={0.7}
          >
            <Ionicons name="refresh" size={15} color={theme.colors.text.tertiary} />
          </TouchableOpacity>
        </View>

        <View style={styles.qrContainer}>
          <ReceiveQr value={address} size={qrSize} />
        </View>
        {renderAmountRow()}

        <InvoiceExpiry showCountdown={showCountdown} invoice={address} onRefresh={() => { void generateAddress(); }} />
        <ReceiveRequestActions value={address} label={title} />
        <ReceiveRequestDetails
          methods={method ? [method] : []}
          universal={false}
          qrSize={qrSize}
          rgbLabel={rgbLabel}
          extra={swapNote}
        />
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right', 'bottom']}>
      <View style={styles.receiveHeader}>
        <TouchableOpacity
          accessibilityRole="button" accessibilityLabel="Back"
          onPress={() => {
            cancelReceiveWork();
            navigation.goBack();
          }}
          style={styles.receiveBackButton}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          activeOpacity={0.7}
        >
          <Ionicons name="arrow-back" size={20} color={theme.colors.text.primary} />
        </TouchableOpacity>
        <Text style={styles.receiveHeaderTitle}>Receive</Text>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <ReceiveConnectionNotice hasRequest={!!(unifiedUri || address)} />
        {renderAssetTabs()}
        <ReceiveRoutePicker
          methods={receiveMethodIds}
          method={route.method}
          onMethod={(method) => selectRoute(method)}
          destinations={routeDestinations}
          destination={routeDestination}
          onDestination={(account) => selectRoute(route.method, account)}
          amountSats={requestedSats}
          chains={unifiedAsset === 'BTC' ? chainGroups : undefined}
          chain={activeChain}
          onChain={(chain) => {
            if (chain === activeChain) return;
            feedback.select();
            resetReceiveSurface();
            setUniversalChain(chain);
            setUniversalLn(null);
          }}
          lightningDestinations={unifiedAsset === 'BTC' ? universalLnOptions : undefined}
          lightningDestination={universalLnAccount}
          onLightningDestination={(account) => {
            feedback.select();
            resetReceiveSurface();
            setUniversalLn(account);
          }}
        />
        {renderContent()}
        {networkType === 'bark' && arkadeSubMode === 'boarding' && <BarkBoardingPanel />}
        <ReceiveStatus
          visible={monitorVisible}
          status={monitorStatus}
          message={depositMonitor.message}
        />
        {selectedAsset.asset_id === 'BTC' && (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Create a reusable payment QR"
            onPress={() => { cancelReceiveWork(); navigation.navigate('MerchantOffer'); }}
            style={styles.addrListHeader}
            activeOpacity={0.7}
          >
            <Ionicons name="repeat-outline" size={20} color={theme.colors.primary[500]} />
            <View style={{ flex: 1, marginLeft: theme.spacing[3] }}>
              <Text style={[styles.addrLabel, { marginBottom: 2 }]}>Reusable payment QR</Text>
              <Text style={styles.universalRequestSubtitle}>One BOLT12 code for many payments</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={theme.colors.text.secondary} />
          </TouchableOpacity>
        )}
      </ScrollView>

      {/* Asset picker (opened by the "+" tab) */}
      <AssetSelector
        visible={showAssetSelector}
        onClose={() => setShowAssetSelector(false)}
        onSelect={(asset) => {
          resetReceiveSurface();
          setSelectedAsset({
            asset_id: asset.asset_id,
            ticker: asset.ticker,
            name: asset.name,
            isRGB: asset.isRGB || asset.protocol === 'RGB',
            balance: asset.balance,
          });
        }}
        assets={allAssets.map((a) => ({
          asset_id: a.asset_id,
          ticker: a.ticker,
          name: a.name,
          balance: a.balance,
          isRGB: a.isRGB,
          protocol: a.isRGB ? ('RGB' as const) : undefined,
        }))}
        selectedAssetId={selectedAsset?.asset_id}
        title="Select Asset"
      />

      {/* "+" new-asset chooser (Spark / Arkade / new RGB asset) */}
      <NewAssetSheet
        visible={showNewAsset}
        onClose={() => setShowNewAsset(false)}
        available={(() => {
          const status = getProtocolStatus();
          return { spark: !!status.SPARK, arkade: !!status.ARKADE, rgb: !!status.RGB };
        })()}
        onPick={handleNewAsset}
        onChooseExisting={() => setShowAssetSelector(true)}
      />

      {/* Amount editor — WDK AmountInput (BTC ↔ USD) inside a bottom sheet */}
      <AmountEditorModal
        visible={showAmountEditor}
        onClose={() => setShowAmountEditor(false)}
        requestOptions={{ expirySeconds, showCountdown }}
        initialSats={currentAmountSats}
        rates={fiatRates}
        bitcoinUnit={bitcoinUnit}
        onConfirm={(sats, options) => {
          if (options) {
            setShowCountdown(options.showCountdown);
            if (options.expirySeconds !== expirySeconds) { resetReceiveSurface(); setExpirySeconds(options.expirySeconds); }
          }
          receiveLog('amount.confirm', { sats, previousAmount: amount, networkType });
          applyAmountSats(sats);
        }}
      />

      <DepositSuccessOverlay
        visible={showDepositSuccess}
        ticker={selectedAsset?.ticker || 'BTC'}
        network={depositMonitor.layer ? formatDepositLayer(depositMonitor.layer) : networkType === 'unified' ? undefined : networkType}
        onDone={() => {
          setShowDepositSuccess(false);
          setDepositMonitor({ status: 'idle' });
          navigation.goBack();
        }}
      />
    </SafeAreaView>
  );
}
