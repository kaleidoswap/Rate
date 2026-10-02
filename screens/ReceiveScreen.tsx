import { ReceiveConnectionNotice } from '../components/receive/ReceiveConnectionNotice';
import { receiveAmountSats } from '../utils/receive-request';
import { useReceiveGeneration } from '../hooks/useReceiveGeneration';
import { InvoiceExpiry } from '../components/payments/InvoiceExpiry';
import { barkNetworkLabel } from '../services/BarkService';
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
import { buildUnifiedReceiveURI, LITE_USD } from '@kaleidorg/wallet-engine';
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
import { ReceiveMethodsSheet } from '../components/receive/ReceiveMethodsSheet';
import DepositSuccessOverlay from '../components/DepositSuccessOverlay';
import {
  useDepositDetection,
  type DepositDetectionEvent,
  type DepositLayer,
} from '../hooks/useDepositDetection';
import { useSparkAutoClaim } from '../hooks/useSparkAutoClaim';
import { AssetIcon } from '../components/AssetIcon';
import { AssetSelector } from '../components/AssetSelector';
import { NetworkIcon } from '../components/NetworkIcon';
import { UsdCoinIcon } from '../components/ProtocolIcons';
import { AmountEditorModal } from '../components/AmountEditorModal';
import { NewAssetSheet, type NewAssetKind } from '../components/NewAssetSheet';
import { useFiatRates } from '../hooks/useFiatRates';
import { ReceiveRouteSelector } from '../components/receive/ReceiveRouteSelector';
import { feedback } from '../utils/feedback';
import {
  callAbortableAdapterMethod,
  runReceiveOperation as runTimedReceiveOperation,
  upsertReceiveMethod,
  type ReceiveMethod,
  type ReceiveProtocol,
} from '../utils/receive-session';
import { resolvePrecision } from '../utils/assetAmount';
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
    case 'liquid':
      return 'Liquid';
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
  

  
  // Get asset precision for validation (similar to desktop app)
  const getAssetPrecision = (ticker: string): number => {
    if (ticker === 'BTC') {
      return bitcoinUnit === 'BTC' ? 8 : 0; // 8 decimals for BTC, 0 for sats
    }
    const rgbAsset = rgbAssets.find(asset => asset.ticker === ticker);
    return resolvePrecision(rgbAsset?.precision); // Default to 8 if not found
  };

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
  const unifiedMethods = receiveMethods.map((method) => method.label);
  const unifiedAddresses = receiveMethods;
  // The raw address breakdown is hidden behind a collapsed section by default —
  // the QR (and its single "Copy" affordance) is the primary way to receive, so
  // the list of individual addresses only appears when the user expands it.
  const [showPaymentOptions, setShowPaymentOptions] = useState(false);
  // Per-address "show full" toggles in the unified address list (keyed by row).
  // Collapse/expand the full address inside the single-network receive card.
  // Unified-receive asset selector: BTC (default) or USD. USD builds a BIP321 QR
  // embedding the USD-receiving methods (Liquid USDt, RGB USDT invoice, Spark).
  const [unifiedAsset, setUnifiedAsset] = useState<'BTC' | 'USD'>('BTC');
  // Lite mode: a single private BIP321 QR (BTC/$ toggle) with the advanced
  // network picker hidden behind "Show all networks".
  const disclosureLevel = useAppSelector(selectDisclosureLevel);
  const nwcWalletType = useAppSelector((state: RootState) => state.nostr?.nwcWalletType);
  const nwcCapabilities = useAppSelector((state: RootState) => state.nostr?.nwcCapabilities ?? []);
  const lastBtcReceiveRoute = useAppSelector((state: RootState) => state.settings.lastBtcReceiveRoute);
  const isLite = disclosureLevel === 'lite';
  // Advanced receive mirrors the extension's two ways into the same route
  // matrix: choose how the sender will pay, or choose which account to top up.
  const [routeAxis, setRouteAxis] = useState<'method' | 'account'>('method');
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
      liquidAddress?: string;
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
    setShowPaymentOptions(false);
    setError(null);
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
  const fiatRates = useFiatRates();

  // Channel helpers — drive which RGB networks are actually receivable.
  const hasAnyUsableChannel = (): boolean => channels.some((c) => c.is_usable);
  const hasUsableChannelForAsset = (assetId: string): boolean =>
    channels.some((c) => c.is_usable && c.asset_id === assetId);

  // Determine available network types for the SELECTED asset. Only surface a
  // network where the asset actually lives:
  //  • RGB asset → RGB-L1 (on-chain) always; RGB-LN only if a usable channel for
  //    THIS asset exists. (Spark/Liquid would appear only if the same asset also
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
    setRouteAxis(lastBtcReceiveRoute.axis);
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
          const preferSpark = selectedAccount === 'SPARK';
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
          // BTC Lightning invoice. Open-amount: if the user typed a number we bind
          // it (in sats); otherwise we mint an amount-less BOLT11 the sender fills in.
          const cleanAmount = amount.replace(/,/g, '');
          const amountSats = receiveAmountSats(amount, bitcoinUnit) || undefined;

          // Honour an explicit account choice; otherwise prefer the connected
          // NWC/RGB Lightning wallet and fall back to Spark.
          // `layer: 'BTC_LN'` is REQUIRED for Spark — without it the Spark adapter
          // mints a native Spark sats invoice (a `spark…` string), not a BOLT11.
          const rgbLn = protocolManager.getAdapterIfAvailable('RGB_LN');
          const sparkLn = protocolManager.getAdapterIfAvailable('SPARK');
          const barkLn = protocolManager.getAdapterIfAvailable('BARK');
          const preferSpark = selectedAccount === 'SPARK';
          const rgbCanCreateInvoice = rgbLn?.isConnected()
            && (nwcWalletType == null || nwcCapabilities.includes('createInvoice'));
          const useBarkLn = selectedAccount === 'BARK'
            || (!rgbCanCreateInvoice && !sparkLn?.isConnected() && !!barkLn?.isConnected());
          if (useBarkLn) {
            // Bark when chosen explicitly, or as the last resort when it is the only
            // Lightning-capable wallet; otherwise the RGB → Spark default is unchanged.
            if (!barkLn?.isConnected()) throw new Error('Bark is not connected');
            if (!amountSats) throw new Error('Set an amount: Bark Lightning invoices need one.');
            const invoice = await runReceiveOperation('Create Bark Lightning invoice', () =>
              barkLn.createInvoice({
                layer: 'BTC_LN',
                amount: amountSats,
                description: `Receive ${cleanAmount} ${bitcoinUnit}`,
                expirySeconds,
              }));
            result = invoice.invoice;
            methodMeta = {
              key: 'lightning-bark',
              label: 'Lightning invoice',
              protocol: 'BARK',
              kind: 'invoice',
              layer: 'lightning',
              monitor: 'invoice',
              assetId: 'BTC',
            };
          } else if (!preferSpark && rgbCanCreateInvoice) {
            const invoice = await runReceiveOperation('Create RGB Lightning invoice', (signal) =>
              callAbortableAdapterMethod<any>(
                rgbLn,
                'createInvoice',
                [{
                  layer: 'BTC_LN',
                  ...(amountSats ? { amount: amountSats } : {}),
                  description: amountSats ? `Receive ${cleanAmount} ${bitcoinUnit}` : 'Receive Bitcoin',
                  expirySeconds,
                }],
                signal,
              ));
            result = invoice.invoice;
            methodMeta = {
              key: 'lightning-rgb',
              label: 'Lightning invoice',
              protocol: 'RGB',
              kind: 'invoice',
              layer: 'lightning',
              monitor: 'invoice',
              assetId: 'BTC',
            };
          } else if (sparkLn?.isConnected()) {
            const invoice = await runReceiveOperation('Create Spark Lightning invoice', () =>
              sparkLn.createInvoice({
                layer: 'BTC_LN',
                ...(amountSats ? { amount: amountSats } : {}),
                description: amountSats ? `Receive ${cleanAmount} ${bitcoinUnit}` : 'Receive Bitcoin',
                expirySeconds,
              }));
            result = invoice.invoice;
            methodMeta = {
              key: 'lightning-spark',
              label: 'Lightning invoice',
              protocol: 'SPARK',
              kind: 'invoice',
              layer: 'lightning',
              monitor: 'invoice',
              assetId: 'BTC',
            };
          } else {
            throw new Error('No wallet connected for Lightning invoice');
          }
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
          // RGB-over-Lightning invoice. Open-amount: if the user did enter a
          // number, scale it to BASE units (10^precision) for the node; otherwise
          // mint an amount-less RGB-LN invoice the sender fills in.
          const cleanAmount = amount.replace(/,/g, '');
          const parsed = parseFloat(cleanAmount);
          const precision = getAssetPrecision(selectedAsset.ticker);
          const assetAmount =
            !isNaN(parsed) && parsed > 0
              ? Math.round(parsed * Math.pow(10, precision))
              : undefined;

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
                ...(assetAmount ? { assetAmount } : {}),
                description: assetAmount
                  ? `Receive ${cleanAmount} ${selectedAsset.ticker}`
                  : `Receive ${selectedAsset.ticker}`,
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
  // USD (USDt) across protocols — Liquid USDt, an RGB USDT invoice (RGB-LN or
  // RGB-L1), and the Spark address. Caller has already reset loading/error state.
  const generateUsdUnifiedUri = async (generationId: number, allowRgb: boolean) => {
    const isCurrentGeneration = () => unifiedGenerationRef.current === generationId;
    const startedAt = nowMs();
    receiveLog('unified.usd.start', { generationId });
    const rgb = protocolManager.getAdapterIfAvailable('RGB_LN');
    const spark = protocolManager.getAdapterIfAvailable('SPARK');
    const liquid = protocolManager.getAdapterIfAvailable('LIQUID');
    receiveLog('unified.usd.adapters', {
      generationId,
      rgb: !!rgb?.isConnected(),
      spark: !!spark?.isConnected(),
      liquid: !!liquid?.isConnected(),
    });

    let sparkAddress: string | undefined;
    let liquidAddress: string | undefined;
    let rgbInvoice: string | undefined;

    // The RGB USDT asset (from the loaded RGB assets), for an RGB invoice.
    const usdtRgb = rgbAssets.find((a) => /usdt/i.test(a.ticker));

    try {
      await Promise.allSettled([
        // 1) Liquid USDt — assets ride on the same confidential address.
        (async () => {
          const taskStartedAt = nowMs();
          if (!liquid?.isConnected()) return;
          try {
            const addr = await runReceiveOperation(
              'Create Liquid USD address',
              () => liquid.getReceiveAddress(),
            );
            if (addr?.address) liquidAddress = addr.address;
            receiveLog('unified.usd.liquid.done', {
              generationId,
              ok: !!addr?.address,
              ms: Math.round(nowMs() - taskStartedAt),
            });
          } catch (e) { console.warn('USD: Liquid address failed', e); }
        })(),

        // 2) RGB USDT invoice (covers RGB-LN and RGB on-chain L1).
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

        // 3) Spark address (for a Spark USD token transfer).
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

      if (!sparkAddress && !liquidAddress && !rgbInvoice) {
        if (isCurrentGeneration()) {
          receiveLog('unified.usd.empty', {
            generationId,
            ms: Math.round(nowMs() - startedAt),
          });
          setUnifiedError('No USD receive method available. Connect Liquid, an RGB node, or Spark.');
        }
        return;
      }

      if (!isCurrentGeneration()) {
        receiveLog('unified.usd.stale', { generationId, activeGenerationId: unifiedGenerationRef.current });
        return;
      }

      const methods: string[] = [];
      if (liquidAddress) methods.push('Liquid USDt');
      if (rgbInvoice) methods.push('RGB USDT');
      if (sparkAddress) methods.push('Spark');

      setReceiveMethods(
        [
          liquidAddress && {
            key: 'liquid',
            label: 'Liquid USDt',
            value: liquidAddress,
            protocol: 'LIQUID',
            kind: 'address',
            layer: 'liquid',
            monitor: 'balance',
            assetId: LITE_USD.assetId,
          },
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
        liquidAddress,
        rgbInvoice,
        assetId: LITE_USD.assetId, // Liquid USDt asset id
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
    if (!preserveExisting) {
      setUnifiedUri('');
      setReceiveMethods([]);
      unifiedCollectedRef.current = null;
    }

    if (unifiedAsset === 'USD') {
      await generateUsdUnifiedUri(generationId, reason === 'manual');
      return;
    }

    const rgb = protocolManager.getAdapterIfAvailable('RGB_LN');
    const spark = protocolManager.getAdapterIfAvailable('SPARK');
    const arkade = protocolManager.getAdapterIfAvailable('ARKADE');
    const liquid = protocolManager.getAdapterIfAvailable('LIQUID');
    receiveLog('unified.adapters', {
      generationId,
      rgb: !!rgb?.isConnected(),
      spark: !!spark?.isConnected(),
      arkade: !!arkade?.isConnected(),
      liquid: !!liquid?.isConnected(),
    });

    // Optional amount (in sats) for the Lightning leg / BIP21 amount.
    const amountSats = receiveAmountSats(amount, bitcoinUnit);

    // Reuse native addresses only when the user explicitly refreshes Lightning.
    const cached = unifiedCollectedRef.current;
    const reuseAddrs = preserveExisting && includeLightning && !!cached;
    const collected: {
      btcAddress?: string;
      lightningInvoice?: string;
      sparkAddress?: string;
      arkadeAddress?: string;
      liquidAddress?: string;
    } = reuseAddrs ? { ...cached!.collected, lightningInvoice: undefined } : {};
    // When reusing, carry the Spark deposit address forward.
    let nextSparkDepositAddress: string | null = reuseAddrs ? cached!.sparkDeposit : null;
    let nextMethods: ReceiveMethod[] = reuseAddrs
      ? cached!.methods.filter((method) => method.layer !== 'lightning')
      : [];
    const addMethod = (method: ReceiveMethod) => {
      nextMethods = upsertReceiveMethod(nextMethods, method);
    };
    const buildCurrentUnifiedUri = () => buildUnifiedReceiveURI({
      btcAddress: collected.btcAddress,
      lightningInvoice: collected.lightningInvoice,
      sparkAddress: collected.sparkAddress,
      arkadeAddress: collected.arkadeAddress,
      liquidAddress: collected.liquidAddress,
      amountBtc: amountSats > 0 ? amountSats / 1e8 : undefined,
      label: 'KaleidoSwap',
    });

    const addressTasks: Array<() => Promise<void>> = reuseAddrs ? [] : [
      // 1) BTC on-chain — prefer RGB, then Spark static deposit, then Arkade boarding.
      async () => {
        const taskStartedAt = nowMs();
        try {
          // Automatic unified generation must stay on local/lightweight adapters.
          // RGB/NWC on-chain generation remains available through manual refresh
          // and the explicit On-chain network.
          const rgbCanCreateOnchainAddress = rgb?.isConnected()
            && nwcWalletType !== 'ln'
            && (nwcWalletType == null || nwcCapabilities.includes('onchain'));
          if (reason === 'manual' && rgbCanCreateOnchainAddress) {
            const addr = await runReceiveOperation<any>(
              'Create unified RGB Bitcoin address',
              (signal) => callAbortableAdapterMethod<any>(
                rgb,
                'getReceiveAddress',
                [],
                signal,
              ),
            );
            if (addr?.address) collected.btcAddress = addr.address;
            if (addr?.address) {
              addMethod({
                key: 'onchain',
                label: 'Bitcoin on-chain',
                value: addr.address,
                protocol: 'RGB',
                kind: 'address',
                layer: 'onchain',
                monitor: 'balance',
                assetId: 'BTC',
              });
            }
          }
          if (!collected.btcAddress && spark?.isConnected()) {
            const addr = await runReceiveOperation(
              'Create unified Spark Bitcoin address',
              () => spark.getReceiveAddress('BTC'),
            ).catch((error) => {
              console.warn('Spark deposit address unavailable; trying Arkade:', error);
              return null;
            });
            if (addr?.address) {
              collected.btcAddress = addr.address;
              // Spark on-chain deposit → needs claim/sweep (useSparkAutoClaim).
              nextSparkDepositAddress = addr.address;
              addMethod({
                key: 'onchain',
                label: 'Bitcoin on-chain',
                value: addr.address,
                protocol: 'SPARK',
                kind: 'address',
                layer: 'spark',
                monitor: 'spark-claim',
                assetId: 'BTC',
              });
            }
          }
          if (!collected.btcAddress && arkade?.isConnected()) {
            const addr = await runReceiveOperation<any>(
              'Create unified Arkade boarding address',
              () => (arkade as any).getBoardingAddress(),
            );
            if (addr?.address) collected.btcAddress = addr.address;
            if (addr?.address) {
              addMethod({
                key: 'onchain',
                label: 'Bitcoin on-chain',
                value: addr.address,
                protocol: 'ARKADE',
                kind: 'address',
                layer: 'onchain',
                monitor: 'balance',
                assetId: 'BTC',
              });
            }
          }
          receiveLog('unified.onchain.done', {
            generationId,
            ok: !!collected.btcAddress,
            ms: Math.round(nowMs() - taskStartedAt),
          });
        } catch (e) { console.warn('Unified: on-chain address failed', e); }
      },

      // 2) Spark native address.
      async () => {
        const taskStartedAt = nowMs();
        if (!spark?.isConnected()) return;
        try {
          const addr = await runReceiveOperation(
            'Create unified Spark address',
            () => spark.getReceiveAddress('SPARK'),
          );
          if (addr?.address) collected.sparkAddress = addr.address;
          if (addr?.address) {
            addMethod({
              key: 'spark',
              label: 'Spark',
              value: addr.address,
              protocol: 'SPARK',
              kind: 'address',
              layer: 'spark',
              monitor: 'balance',
              assetId: 'BTC',
            });
          }
          receiveLog('unified.spark.done', {
            generationId,
            ok: !!addr?.address,
            ms: Math.round(nowMs() - taskStartedAt),
          });
        } catch (e) { console.warn('Unified: Spark address failed', e); }
      },

      // 4) Arkade native (ark) address.
      async () => {
        const taskStartedAt = nowMs();
        if (!arkade?.isConnected()) return;
        try {
          const addr = await runReceiveOperation(
            'Create unified Arkade address',
            () => arkade.getReceiveAddress(),
          );
          if (addr?.address) collected.arkadeAddress = addr.address;
          if (addr?.address) {
            addMethod({
              key: 'arkade',
              label: 'Arkade',
              value: addr.address,
              protocol: 'ARKADE',
              kind: 'address',
              layer: 'arkade',
              monitor: 'balance',
              assetId: 'BTC',
            });
          }
          receiveLog('unified.arkade.done', {
            generationId,
            ok: !!addr?.address,
            ms: Math.round(nowMs() - taskStartedAt),
          });
        } catch (e) { console.warn('Unified: Arkade address failed', e); }
      },

      // 5) Liquid (L-BTC / USDt) address.
      async () => {
        const taskStartedAt = nowMs();
        if (!liquid?.isConnected()) return;
        try {
          const addr = await runReceiveOperation(
            'Create unified Liquid address',
            () => liquid.getReceiveAddress(),
          );
          if (addr?.address) collected.liquidAddress = addr.address;
          if (addr?.address) {
            addMethod({
              key: 'liquid',
              label: 'Liquid',
              value: addr.address,
              protocol: 'LIQUID',
              kind: 'address',
              layer: 'liquid',
              monitor: 'balance',
              assetId: 'BTC',
            });
          }
          receiveLog('unified.liquid.done', {
            generationId,
            ok: !!addr?.address,
            ms: Math.round(nowMs() - taskStartedAt),
          });
        } catch (e) { console.warn('Unified: Liquid address failed', e); }
      },
    ];

    // The Lightning invoice mint is the one leg that depends on `amount` and is
    // the slowest call, so it always runs when requested — even on the reuse pass
    // (which skips every address derivation above).
    const lightningTasks: Array<() => Promise<void>> = includeLightning
      ? [
          async () => {
            const taskStartedAt = nowMs();
            // Automatic enrichment uses Spark only. An explicit user action may
            // add RGB Lightning; that request is abortable through the NWC client.
            const rgbCanCreateInvoice = rgb?.isConnected()
              && (nwcWalletType == null || nwcCapabilities.includes('createInvoice'));
            const lnAdapter = reason === 'manual'
              ? rgbCanCreateInvoice ? rgb : spark?.isConnected() ? spark : undefined
              : spark?.isConnected() ? spark : undefined;
            if (!lnAdapter) return;
            try {
              const invoice = await runReceiveOperation('Create unified Lightning invoice', (signal) =>
                callAbortableAdapterMethod<any>(
                  lnAdapter,
                  'createInvoice',
                  [{
                    layer: 'BTC_LN', // force a BOLT11 (Spark would otherwise mint a native Spark invoice)
                    amount: amountSats > 0 ? amountSats : undefined,
                    description: 'Unified receive',
                    expirySeconds,
                  }],
                  signal,
                ));
              if (invoice?.invoice) {
                collected.lightningInvoice = invoice.invoice;
                const protocol: ReceiveProtocol = lnAdapter === spark ? 'SPARK' : 'RGB';
                addMethod({
                  key: 'lightning',
                  label: 'Lightning invoice',
                  value: invoice.invoice,
                  protocol,
                  kind: 'invoice',
                  layer: 'lightning',
                  monitor: 'invoice',
                  assetId: 'BTC',
                });
              }
              receiveLog('unified.lightning.done', {
                generationId,
                ok: !!invoice?.invoice,
                ms: Math.round(nowMs() - taskStartedAt),
              });
            } catch (e) { console.warn('Unified: Lightning invoice failed', e); }
          },
        ]
      : [];

    // Collect all methods before publishing. A visible request must never be
    // silently replaced by a partial/final version or an automatic upgrade.
    for (const task of [...addressTasks, ...lightningTasks]) {
      if (!isCurrentGeneration()) return;
      await task();
    }
    if (!isCurrentGeneration()) {
      receiveLog('unified.stale', { generationId, activeGenerationId: unifiedGenerationRef.current });
      return;
    }

    const methods: string[] = [];
    if (collected.btcAddress) methods.push('On-chain');
    if (collected.lightningInvoice) methods.push('Lightning');
    if (collected.sparkAddress) methods.push('Spark');
    if (collected.arkadeAddress) methods.push('Arkade');
    if (collected.liquidAddress) methods.push('Liquid');

    if (methods.length === 0) {
      receiveLog('unified.empty', {
        generationId,
        ms: Math.round(nowMs() - startedAt),
      });
      setUnifiedError(
        rgb?.isConnected() && reason !== 'manual'
          ? 'RGB receive is available. Tap Try Again to generate it explicitly without blocking the screen in the background.'
          : 'No receive method available. Connect a wallet (RGB, Spark, Arkade, or Liquid) to use unified receive.',
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
    networkType === 'unified' ? JSON.stringify([unifiedAsset, amount, expirySeconds]) : null,
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
    networkType !== 'unified' ? JSON.stringify([selectedAsset.asset_id, networkType, arkadeSubMode, selectedAccount, amount, expirySeconds]) : null,
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
      setRouteAxis('method');
      setSelectedAccount(null);
      setNetworkType('unified');
    };
    const selectUsd = () => {
      feedback.select();
      if (isUsd && networkType === 'unified') return;
      resetReceiveSurface();
      // USD always routes through the unified USD aggregator (Liquid USDt + RGB
      // USDT + Spark) — see generateUsdUnifiedUri, which finds the held RGB USDT
      // itself. Use the synthetic 'USD' asset (not a specific RGB USDT) so the
      // behaviour is identical whether or not an RGB USDT is held, and force the
      // unified view so the aggregator actually runs.
      setUnifiedAsset('USD');
      setSelectedAsset({ asset_id: 'USD', ticker: 'USD', name: 'US Dollar', isRGB: false });
      setRouteAxis('method');
      setSelectedAccount(null);
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

  const renderRouteAxisSelector = () => {
    if (isLite) return null;

    const status = getProtocolStatus();
    const family = getAssetFamily(selectedAsset.asset_id, selectedAsset.ticker);
    const accounts = resolveReceiveAccounts({ assetFamily: family, accounts: status });
    const effectiveAccount =
      (selectedAccount && accounts.includes(selectedAccount) ? selectedAccount : null)
      ?? accounts[0]
      ?? null;
    const chooseAccount = (account: AccountId) => {
      feedback.select();
      resetReceiveSurface();
      setSelectedAccount(account);
      let nextNetwork: ReceiveMode;
      if (account === 'SPARK') {
        nextNetwork = 'spark';
      } else if (account === 'ARKADE') {
        nextNetwork = 'arkade';
      } else if (account === 'BARK') {
        nextNetwork = 'bark';
      } else {
        nextNetwork = nwcWalletType === 'ln' && family === 'BTC' ? 'lightning' : 'onchain';
      }
      setNetworkType(nextNetwork);
      if (selectedAsset.ticker === 'BTC') {
        dispatch(setLastBtcReceiveRoute({ axis: 'account', network: nextNetwork, account }));
      }
    };

    return (
      <ReceiveRouteSelector
        axis={routeAxis}
        accounts={accounts}
        selectedAccount={effectiveAccount}
        nwcWalletType={nwcWalletType}
        onAccountChange={chooseAccount}
        onAxisChange={(axis) => {
          if (routeAxis === axis) return;
          feedback.select();
          resetReceiveSurface();
          setRouteAxis(axis);
          if (axis === 'method') {
            setSelectedAccount(null);
            setNetworkType('unified');
            if (selectedAsset.ticker === 'BTC') {
              dispatch(setLastBtcReceiveRoute({ axis: 'method', network: 'unified', account: null }));
            }
          } else if (effectiveAccount) {
            chooseAccount(effectiveAccount);
          }
          setShowPaymentOptions(true);
        }}
      />
    );
  };

  // Advanced route choices; the main list opens individual payment codes.
  const renderNetworkChoices = () => {
    const canUseAll = selectedAsset.ticker === 'BTC' || /usd/i.test(selectedAsset.ticker);
    const isRgbAsset = getAssetFamily(selectedAsset.asset_id, selectedAsset.ticker) === 'RGB';
    const selectableNetworks = availableNetworkTypes;
    const options: Array<{ id: ReceiveMode; label: string; sub: string }> = [
      ...(canUseAll && networkType !== 'unified'
        ? [{
            id: 'unified' as ReceiveMode,
            label: 'Combined QR',
            // USD is a different protocol set than BTC — reflect it in the hint.
            sub: /usd/i.test(selectedAsset.ticker)
              ? 'Liquid · Spark · optional RGB'
              : 'On-chain · Spark · Arkade · optional Lightning',
          }]
        : []),
      ...(selectableNetworks.includes('onchain')
        ? [{ id: 'onchain' as ReceiveMode, label: isRgbAsset ? 'RGB on-chain' : 'On-chain', sub: isRgbAsset ? 'RGB account · network fee · slower' : 'Bitcoin wallet · network fee · slower' }] : []),
      ...(selectableNetworks.includes('lightning')
        ? [{ id: 'lightning' as ReceiveMode, label: isRgbAsset ? 'RGB Lightning' : 'Lightning', sub: isRgbAsset ? 'Instant · in-channel (RGB-LN)' : 'Instant · low fee' }] : []),
      ...(selectableNetworks.includes('spark')
        ? [{ id: 'spark' as ReceiveMode, label: 'Spark', sub: 'Spark balance · instant · low fee' }] : []),
      ...(selectableNetworks.includes('arkade')
        ? [{ id: 'arkade' as ReceiveMode, label: 'Arkade', sub: 'Arkade balance · off-chain' }] : []),
      ...(selectableNetworks.includes('bark')
        ? [{ id: 'bark' as ReceiveMode, label: 'Bark', sub: `Bark balance · off-chain · ${barkNetworkLabel()}` }] : []),
    ];
    const current = options.find((o) => o.id === networkType) || options[0];
    if (!current) return null;

    const glyph = (id: ReceiveMode, c: string) =>
      id === 'unified'
        ? <Ionicons name="apps" size={18} color={c} />
        : <NetworkIcon network={id as ProtocolNetworkType} size={18} color={c} />;

    return (
      <View>
        <View>
          {options.filter(o => o.id === 'unified' || !receiveMethods.some(method => method.layer === o.id || method.key === o.id || (o.id === 'arkade' && method.protocol === 'ARKADE' && method.layer !== 'lightning'))).map((o) => {
            const active = o.id === networkType;
            const c = NETWORK_COLORS[o.id] || theme.colors.primary[500];
            return (
              <TouchableOpacity
                key={o.id}
                accessibilityRole="button" accessibilityLabel={`Receive with ${o.label}`}
                style={{ minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: theme.spacing[3], borderBottomWidth: 1, borderBottomColor: theme.colors.border.light }}
                onPress={() => {
                  receiveLog('tap.networkOption', { from: networkType, to: o.id });
                  feedback.select();
                  if (active) {
                    void generateAddress();
                    setShowPaymentOptions(false);
                    return;
                  }
                  resetReceiveSurface();
                  setRouteAxis('method');
                  setSelectedAccount(null);
                  setNetworkType(o.id);
                  if (selectedAsset.ticker === 'BTC') {
                    dispatch(setLastBtcReceiveRoute({
                      axis: 'method',
                      network: o.id,
                      account: null,
                    }));
                  }
                  setShowPaymentOptions(false);
                }}
                activeOpacity={0.7}
              >
                <View style={{ width: 40, height: 40, borderRadius: theme.borderRadius.lg, backgroundColor: theme.colors.surface.secondary, alignItems: 'center', justifyContent: 'center' }}>
                  {glyph(o.id, c)}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.netOptionLabel, active && { color: c }]}>{o.label}</Text>

                </View>
                <Ionicons name="chevron-forward" size={18} color={theme.colors.text.secondary} />
              </TouchableOpacity>
            );
          })}
        </View>
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
          <Text style={styles.amountRowLabel}>{summary ? 'Requested amount' : required ? 'Amount required' : 'Add amount · optional'}</Text>
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
          <Text style={[styles.universalRequestTitle, { flex: 1 }]}>Scan to pay</Text>
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
      </View>
    );
  };

  const renderContent = () => {
    if (networkType === 'unified') {
      return renderUnifiedContent();
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

    // Render QR code with network-aware title
    const qrTitle = networkType === 'spark' ? 'Spark Address'
      : networkType === 'arkade' ? (arkadeSubMode === 'boarding' ? 'Boarding Address' : 'Arkade Address')
      : networkType === 'bark' ? (arkadeSubMode === 'boarding' ? 'Bark Deposit Address' : 'Bark Address')
      : networkType === 'lightning' ? 'Lightning Invoice'
      : selectedAsset.isRGB ? 'RGB Invoice'
      : 'On-chain Address';

    const netColor = NETWORK_COLORS[networkType] || theme.colors.primary[500];
    const addrLabel = networkType === 'lightning' ? 'Lightning Invoice'
      : networkType === 'spark' ? 'Spark Address'
      : networkType === 'arkade' ? (arkadeSubMode === 'boarding' ? 'Boarding Address' : 'Arkade Address')
      : networkType === 'bark' ? (arkadeSubMode === 'boarding' ? 'Bark Deposit Address' : 'Bark Address')
      : 'Deposit Address';
    return (
      <View style={styles.qrSection}>
        {/* Type/amount chip on the left, small refresh tucked top-right. */}
        <View style={styles.qrTopBar}>
          <View style={[styles.qrMethodsChip, { backgroundColor: netColor + '18' }]}>
            <NetworkIcon network={networkType as ProtocolNetworkType} size={14} color={netColor} />
            <Text style={[styles.qrMethodsChipText, { color: netColor, marginLeft: 6 }]} numberOfLines={1}>
              {qrTitle}{amount && selectedAsset.ticker ? `  ·  ${amount} ${selectedAsset.ticker === 'BTC' ? bitcoinUnit : selectedAsset.ticker}` : ''}
            </Text>
          </View>
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
        <ReceiveRequestActions value={address} label={addrLabel} showValue />
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
        {selectedAsset.asset_id === 'BTC' && <TouchableOpacity accessibilityRole="button" accessibilityLabel="Create a reusable payment QR" onPress={() => { cancelReceiveWork(); navigation.navigate('MerchantOffer'); }}
          style={{ padding: theme.spacing[4], marginBottom: theme.spacing[3] }}>
          <Text style={{ color: theme.colors.primary[500], fontWeight: '600' }}>Reusable payment QR →</Text>
          <Text style={{ color: theme.colors.text.secondary }}>Receive multiple payments with one BOLT12 offer</Text>
        </TouchableOpacity>}
        {renderContent()}
        {networkType === 'bark' && arkadeSubMode === 'boarding' && <BarkBoardingPanel />}
        <ReceiveStatus
          visible={monitorVisible}
          status={monitorStatus}
          message={depositMonitor.message}
        />
        <TouchableOpacity style={styles.addrListHeader} accessibilityRole="button"
          accessibilityLabel="Payment methods" onPress={() => setShowPaymentOptions(true)}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.addrLabel, { marginBottom: 4 }]}>Payment methods</Text>
            <Text style={styles.universalRequestSubtitle}>{networkType === 'unified' ? unifiedMethods.join(' · ') : 'Choose how to receive'}</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={theme.colors.text.secondary} />
        </TouchableOpacity>
      </ScrollView>

      <ReceiveMethodsSheet visible={showPaymentOptions}
        onAdvancedOpen={() => { if (!channelsLoading && getProtocolStatus().RGB) void loadChannels(); }}
        additionalMethods={renderNetworkChoices()}
        methods={receiveMethods} qrSize={qrSize} showCountdown={showCountdown}
        onClose={() => setShowPaymentOptions(false)}
        onRefresh={() => {
          if (networkType === 'unified') void generateUnifiedUri({ includeLightning: true, preserveExisting: true, reason: 'manual' });
          else void generateAddress();
        }}>
        {networkType === 'unified' && !unifiedLoading
          && getProtocolStatus().RGB
          && !receiveMethods.some((method) => method.protocol === 'RGB') && (
          <TouchableOpacity
            style={styles.addRgbBtn}
            onPress={() => generateUnifiedUri({
              includeLightning: true,
              preserveExisting: true,
              reason: 'manual',
            })}
            activeOpacity={0.7}
          >
            <Ionicons name="add-circle-outline" size={18} color={theme.colors.primary[500]} />
            <Text style={styles.addRgbText}>
              {unifiedAsset === 'USD' ? 'Add RGB USDT method' : 'Add RGB / Lightning method'}
            </Text>
          </TouchableOpacity>
        )}

        {(networkType === 'arkade' || networkType === 'bark') && <View>
          {(['ark', 'boarding'] as const).map(mode => <TouchableOpacity key={mode}
            accessibilityRole="radio" accessibilityState={{ checked: arkadeSubMode === mode }}
            onPress={() => { resetReceiveSurface(); setArkadeSubMode(mode); }}
            style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: theme.spacing[3] }}>
            <Ionicons name={arkadeSubMode === mode ? 'radio-button-on' : 'radio-button-off'} size={20} color={theme.colors.primary[500]} />
            <Text style={{ color: theme.colors.text.primary }}>
              {mode === 'ark' ? `Receive on ${networkType === 'bark' ? 'Bark' : 'Arkade'}` : 'Deposit from Bitcoin'}
            </Text>
          </TouchableOpacity>)}
        </View>}
      </ReceiveMethodsSheet>

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
