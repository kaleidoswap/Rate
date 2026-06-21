// screens/ReceiveScreen.tsx
import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Share,
  Clipboard,
  ActivityIndicator,
  Animated,
  Easing,
  InteractionManager,
  Platform,
  AppState,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSelector } from 'react-redux';
import { useIsFocused } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { RootState } from '../store';
// RGBApiService removed — all operations via protocolManager
import { protocolManager } from '../services/protocols';
import { buildUnifiedReceiveURI, LITE_USD } from '@kaleidorg/wallet-engine';
import { selectDisclosureLevel } from '../store/slices/settingsSlice';
import { useRefreshableProtocolStatus } from '../hooks/useProtocol';
import {
  getAssetFamily, resolveReceiveAccounts, getNetworkTypesForAccount,
  type NetworkType as ProtocolNetworkType,
} from '../utils/account-routing';
import { theme } from '../theme';
import DepositSuccessOverlay from '../components/DepositSuccessOverlay';
import {
  useDepositDetection,
  type DepositDetectionEvent,
  type DepositDetectionStatus,
  type DepositLayer,
} from '../hooks/useDepositDetection';
import { useSparkAutoClaim } from '../hooks/useSparkAutoClaim';
import { AssetIcon } from '../components/AssetIcon';
import { AssetSelector } from '../components/AssetSelector';
import { NetworkIcon } from '../components/NetworkIcon';
import { UsdCoinIcon } from '../components/ProtocolIcons';
import { QrCode } from '@kaleidorg/kaleido-ui/native';
import { AmountEditorModal } from '../components/AmountEditorModal';
import { NewAssetSheet, type NewAssetKind } from '../components/NewAssetSheet';
import { useFiatRates } from '../hooks/useFiatRates';
import { PressableScale } from '../components/PressableScale';
import { feedback } from '../utils/feedback';
import { useBitcoinConversion } from '../utils/bitcoinUnits';
import {
  callAbortableAdapterMethod,
  runReceiveOperation as runTimedReceiveOperation,
  upsertReceiveMethod,
  type ReceiveMethod,
  type ReceiveProtocol,
} from '../utils/receive-session';

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

type DepositMonitorStatus = 'idle' | 'generating' | DepositDetectionStatus;

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

const DeferredQrCode = React.memo(function DeferredQrCode({ value, size }: { value: string; size: number }) {
  const [renderValue, setRenderValue] = useState('');
  const scheduledAtRef = React.useRef(0);

  useEffect(() => {
    scheduledAtRef.current = nowMs();
    receiveLog('qr.schedule', { length: value.length, size });
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const interaction = InteractionManager.runAfterInteractions(() => {
      timeoutId = setTimeout(() => setRenderValue(value), 0);
    });
    return () => {
      if (timeoutId) clearTimeout(timeoutId);
      interaction.cancel();
    };
  }, [value]);

  useEffect(() => {
    if (!renderValue) return;
    receiveLog('qr.render', {
      length: renderValue.length,
      size,
      waitedMs: Math.round(nowMs() - scheduledAtRef.current),
    });
  }, [renderValue, size]);

  // Keep the previous usable QR mounted while an enriched URI is waiting for
  // the interaction queue. Clearing it here caused a distracting spinner flash
  // and could interrupt someone who had already started scanning.
  if (!renderValue) {
    return (
      <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="small" color={theme.colors.primary[500]} />
      </View>
    );
  }

  return <QrCode value={renderValue} size={size} />;
});

function DepositMonitorCard({
  visible,
  status,
  layer,
  message,
  accent,
  methodCount,
}: {
  visible: boolean;
  status: DepositMonitorStatus;
  layer?: DepositLayer;
  message?: string;
  accent: string;
  methodCount?: number;
}) {
  const pulse = React.useRef(new Animated.Value(0)).current;
  const rotate = React.useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) return;
    pulse.setValue(0);
    rotate.setValue(0);
    const pulseLoop = Animated.loop(
      Animated.timing(pulse, {
        toValue: 1,
        duration: 1400,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      })
    );
    const rotateLoop = Animated.loop(
      Animated.timing(rotate, {
        toValue: 1,
        duration: 1600,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    pulseLoop.start();
    rotateLoop.start();
    return () => {
      pulseLoop.stop();
      rotateLoop.stop();
    };
  }, [visible, pulse, rotate]);

  if (!visible) return null;

  const layerLabel = formatDepositLayer(layer);
  const title =
    status === 'generating'
      ? 'Preparing receive code'
      : status === 'pending'
        ? `Pending deposit on ${layerLabel}`
        : status === 'claimed'
          ? `Claimed deposit on ${layerLabel}`
          : status === 'failed'
            ? `Deposit failed on ${layerLabel}`
            : status === 'expired'
              ? `Invoice expired on ${layerLabel}`
              : `Watching ${layerLabel}`;
  const subtitle =
    message ||
    (status === 'generating'
      ? 'Building the QR and payment routes'
      : status === 'pending'
        ? 'Waiting for confirmation'
        : status === 'claimed'
          ? 'Refreshing wallet balance'
          : status === 'failed' || status === 'expired'
            ? 'Generate a fresh code when you are ready'
            : 'Checking connected layers for incoming deposits');
  const pulseScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1.45] });
  const pulseOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0] });
  const spin = rotate.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const isProblem = status === 'failed' || status === 'expired';
  const iconName: keyof typeof Ionicons.glyphMap = isProblem ? 'alert-circle' : status === 'claimed' ? 'checkmark-circle' : 'sync';
  const iconColor = isProblem ? theme.colors.warning[500] : status === 'claimed' ? theme.colors.success[500] : accent;
  const isQuietReadyState = status === 'watching' && !message;

  if (isQuietReadyState) {
    const methodsLabel = methodCount
      ? `${methodCount} ${methodCount === 1 ? 'method' : 'methods'}`
      : layerLabel;
    return (
      <View style={styles.depositReadyRow}>
        <View style={[styles.depositReadyDot, { backgroundColor: theme.colors.success[500] }]} />
        <Text style={styles.depositReadyText}>Ready to receive</Text>
        <Text style={styles.depositReadyMeta}>· {methodsLabel}</Text>
        <Ionicons name="radio-outline" size={15} color={theme.colors.text.tertiary} />
      </View>
    );
  }

  return (
    <View style={[styles.depositMonitorCard, { borderColor: iconColor + '30' }]}>
      <View style={styles.depositMonitorIconWrap}>
        <Animated.View
          style={[
            styles.depositMonitorPulse,
            {
              borderColor: iconColor,
              opacity: pulseOpacity,
              transform: [{ scale: pulseScale }],
            },
          ]}
        />
        <Animated.View
          style={[
            styles.depositMonitorIcon,
            { backgroundColor: iconColor + '18' },
            iconName === 'sync' && { transform: [{ rotate: spin }] },
          ]}
        >
          <Ionicons name={iconName} size={18} color={iconColor} />
        </Animated.View>
      </View>
      <View style={styles.depositMonitorText}>
        <Text style={styles.depositMonitorTitle} numberOfLines={1}>{title}</Text>
        <Text style={styles.depositMonitorSubtitle} numberOfLines={2}>{subtitle}</Text>
      </View>
      {status !== 'failed' && status !== 'expired' && status !== 'claimed' && (
        <ActivityIndicator size="small" color={iconColor} />
      )}
    </View>
  );
}

export default function ReceiveScreen({ navigation }: Props) {
  // Narrow selectors: subscribe to ONLY the two fields this screen reads. The
  // previous coarse `state.wallet` / `state.assets` selectors re-rendered this
  // ~3k-line component on any unrelated change (price ticks, tx history, etc.).
  const btcBalance = useSelector((state: RootState) => state.wallet?.btcBalance);
  const rgbAssetsRaw = useSelector((state: RootState) => state.assets?.rgbAssets);
  // The receive/deposit flow always denominates BTC in sats (matches rate-extension):
  // integer-sats input, sats quick-amounts, and a correct ≈USD conversion. The global
  // BTC/sats display preference intentionally does NOT apply on this screen — otherwise
  // the amount field would show BTC and the USD estimate (which expects sats) would be
  // off by 1e8.
  const bitcoinUnit = 'sats' as 'BTC' | 'sats';
  const { formatSatoshisToUSD } = useBitcoinConversion();

  // Keep the complete primary task (QR + Copy/Share) visible on common phone
  // heights. The previous 248px maximum pushed the actions below the fold even
  // though a ~220px high-contrast QR remains comfortably scannable.
  const { width: screenWidth } = useWindowDimensions();
  const qrSize = Math.max(172, Math.min(220, Math.round(screenWidth - 144)));
  
  // Safe destructuring with fallbacks
  const rgbAssets = (rgbAssetsRaw || []) as RGBAsset[];
  

  
  // Get asset precision for validation (similar to desktop app)
  const getAssetPrecision = (ticker: string): number => {
    if (ticker === 'BTC') {
      return bitcoinUnit === 'BTC' ? 8 : 0; // 8 decimals for BTC, 0 for sats
    }
    const rgbAsset = rgbAssets.find(asset => asset.ticker === ticker);
    return rgbAsset?.precision || 8; // Default to 8 if not found
  };

  // Format asset amount with proper precision
  const formatAssetAmount = (amount: number, ticker: string): string => {
    const precision = getAssetPrecision(ticker);
    return amount.toFixed(precision);
  };
  
  // Must call hooks first before any other code
  const getProtocolStatus = useRefreshableProtocolStatus();

  const [selectedAsset, setSelectedAsset] = useState<Asset>({
    asset_id: 'BTC',
    ticker: 'BTC',
    name: 'Bitcoin',
    isRGB: false,
  });

  // Default to first available network based on connected protocols
  const getDefaultNetwork = (): ProtocolNetworkType => {
    const status = getProtocolStatus();
    if (status.SPARK) return 'spark';
    if (status.RGB) return 'onchain';
    if (status.ARKADE) return 'arkade';
    return 'onchain';
  };
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
  const unifiedAddresses = receiveMethods.map(({ key, label, value }) => ({ key, label, value }));
  const [showAddressInfo, setShowAddressInfo] = useState(false);
  // The raw address breakdown is hidden behind a collapsed section by default —
  // the QR (and its single "Copy" affordance) is the primary way to receive, so
  // the list of individual addresses only appears when the user expands it.
  const [showAddresses, setShowAddresses] = useState(false);
  // Per-address "show full" toggles in the unified address list (keyed by row).
  const [expandedAddrs, setExpandedAddrs] = useState<Record<string, boolean>>({});
  // Collapse/expand the full address inside the single-network receive card.
  const [showFullAddr, setShowFullAddr] = useState(false);
  // Unified-receive asset selector: BTC (default) or USD. USD builds a BIP321 QR
  // embedding the USD-receiving methods (Liquid USDt, RGB USDT invoice, Spark).
  const [unifiedAsset, setUnifiedAsset] = useState<'BTC' | 'USD'>('BTC');
  // Lite mode: a single private BIP321 QR (BTC/$ toggle) with the advanced
  // network picker hidden behind "Show all networks".
  const disclosureLevel = useSelector(selectDisclosureLevel);
  const isLite = disclosureLevel === 'lite';
  const [showAllNetworks, setShowAllNetworks] = useState(false);
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [showAssetSelector, setShowAssetSelector] = useState(false);
  // "+" opens the new-asset chooser (Spark / Arkade / new RGB asset).
  const [showNewAsset, setShowNewAsset] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [channelsLoading, setChannelsLoading] = useState(false);
  const [maxDepositAmount, setMaxDepositAmount] = useState<number>(0);
  const [arkadeSubMode, setArkadeSubMode] = useState<'ark' | 'boarding'>('ark');
  // Network selector dropdown (All selected by default; specific networks hidden).
  const [showNetworkDropdown, setShowNetworkDropdown] = useState(false);
  // Multi-currency amount editor (BTC / sats / USD / other fiat).
  const [showAmountEditor, setShowAmountEditor] = useState(false);
  const [showDepositSuccess, setShowDepositSuccess] = useState(false);
  const [depositMonitor, setDepositMonitor] = useState<DepositMonitorState>({ status: 'idle' });
  // The Spark single-use BTC L1 deposit address currently on screen (if any).
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
  // Caches the non-Lightning legs (on-chain / Spark / Arkade / Liquid addresses)
  // from the fast first pass so the follow-up "add Lightning" pass can reuse them
  // instead of re-deriving every address — halving the adapter/Spark-crypto work
  // (and JS-thread stalls) on mount. See generateUnifiedUri's two-pass flow.
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
    setShowNetworkDropdown(false);
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
  // sweep on mount + poll-claim the on-screen single-use deposit address.
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
        for (const net of getNetworkTypesForAccount(account, family)) networks.add(net);
      }
      // BTC Lightning needs a usable channel (Spark brings its own LN liquidity).
      if (networks.has('lightning') && !hasAnyUsableChannel() && !status.SPARK) {
        networks.delete('lightning');
      }
    }

    return Array.from(networks);
  }, [selectedAsset, getProtocolStatus, channels]);
  
  // Constants for HTLC calculations (from desktop app)
  const MSATS_PER_SAT = 1000;
  const RGB_HTLC_MIN_SAT = 3000;

  // Load Lightning channels
  const loadChannels = async () => {
    if (channelsLoading) return;
    
    try {
      setChannelsLoading(true);
      const rgbAdapter = protocolManager.getAdapterIfAvailable('RGB');
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
                amount: Math.round(numericAmount),
                description: `Receive ${cleanAmount} sats`,
                expirySeconds: 3600,
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
              () => sparkAdapter.getReceiveAddress(),
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
            const addr = await runReceiveOperation(
              'Create Arkade boarding address',
              () => arkadeAdapter.getReceiveAddress('boarding'),
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
      // ── RGB / Legacy: on-chain + lightning ──
      else if (selectedAsset.asset_id === 'BTC') {
        if (networkType === 'onchain') {
          // Use whichever adapter is connected for on-chain address
          const rgbAdapter = protocolManager.getAdapterIfAvailable('RGB');
          const sparkAdapter = protocolManager.getAdapterIfAvailable('SPARK');
          if (rgbAdapter?.isConnected()) {
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
            // Spark provides a single-use deposit address for on-chain BTC; the
            // deposit must be claimed in — track it for useSparkAutoClaim.
            const addr = await runReceiveOperation<any>(
              'Create Spark Bitcoin deposit address',
              () => sparkAdapter.getReceiveAddress('onchain'),
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
          const numericAmount = parseFloat(cleanAmount);
          const amountSats =
            !isNaN(numericAmount) && numericAmount > 0 ? Math.round(numericAmount) : undefined;

          // Try RGB first (Lightning), then Spark (also supports Lightning).
          // `layer: 'BTC_LN'` is REQUIRED for Spark — without it the Spark adapter
          // mints a native Spark sats invoice (a `spark…` string), not a BOLT11.
          const rgbLn = protocolManager.getAdapterIfAvailable('RGB');
          const sparkLn = protocolManager.getAdapterIfAvailable('SPARK');
          if (rgbLn?.isConnected()) {
            const invoice = await runReceiveOperation('Create RGB Lightning invoice', (signal) =>
              callAbortableAdapterMethod<any>(
                rgbLn,
                'createInvoice',
                [{
                  layer: 'BTC_LN',
                  ...(amountSats ? { amount: amountSats } : {}),
                  description: amountSats ? `Receive ${cleanAmount} sats` : 'Receive Bitcoin',
                  expirySeconds: 3600,
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
                description: amountSats ? `Receive ${cleanAmount} sats` : 'Receive Bitcoin',
                expirySeconds: 3600,
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
          const rgbAssetAdapter = protocolManager.getAdapterIfAvailable('RGB');
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
                duration_seconds: 3600,
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

          const rgbAssetLnAdapter = protocolManager.getAdapterIfAvailable('RGB');
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
                expirySeconds: 3600,
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
    const rgb = protocolManager.getAdapterIfAvailable('RGB');
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
              () => spark.getReceiveAddress(),
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

    const rgb = protocolManager.getAdapterIfAvailable('RGB');
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
    let amountSats = 0;
    if (amount && isAmountValid()) {
      const cleanAmount = amount.replace(/,/g, '');
      const numericAmount = parseFloat(cleanAmount);
      if (!isNaN(numericAmount) && numericAmount > 0) {
        amountSats = bitcoinUnit === 'BTC'
          ? Math.round(numericAmount * 1e8)
          : Math.round(numericAmount);
      }
    }

    // Query every adapter in parallel, then publish one final QR. Updating the
    // QR progressively for each method made the screen feel frozen on mobile:
    // each new URI forces a full QR matrix rebuild and SVG reconciliation.
    //
    // The two-pass flow (fast pass without Lightning, then a follow-up that adds
    // the LN invoice) used to re-derive ALL addresses on the second pass. The
    // on-chain/Spark/Arkade/Liquid addresses don't change between passes, so when
    // this is the LN-upgrade pass (preserveExisting + includeLightning) we reuse
    // the cached legs and only mint the Lightning invoice — halving the adapter
    // work and Spark-crypto JS-thread stalls on mount.
    const cached = unifiedCollectedRef.current;
    const reuseAddrs = preserveExisting && includeLightning && !!cached;
    const collected: {
      btcAddress?: string;
      lightningInvoice?: string;
      sparkAddress?: string;
      arkadeAddress?: string;
      liquidAddress?: string;
    } = reuseAddrs ? { ...cached!.collected, lightningInvoice: undefined } : {};
    // When reusing, carry the Spark single-use deposit address forward.
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
      // 1) BTC on-chain — prefer RGB, then Spark single-use deposit, then Arkade boarding.
      async () => {
        const taskStartedAt = nowMs();
        try {
          // Automatic unified generation must stay on local/lightweight adapters.
          // RGB/NWC on-chain generation remains available through manual refresh
          // and the explicit On-chain network.
          if (reason === 'manual' && rgb?.isConnected()) {
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
              () => spark.getReceiveAddress('onchain'),
            );
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
            const addr = await runReceiveOperation(
              'Create unified Arkade boarding address',
              () => arkade.getReceiveAddress('boarding'),
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
            () => spark.getReceiveAddress(),
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
            const lnAdapter = reason === 'manual'
              ? rgb?.isConnected() ? rgb : spark?.isConnected() ? spark : undefined
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
                    expirySeconds: 3600,
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

    // Run adapters sequentially so synchronous native/crypto work cannot pile up
    // in one event-loop turn. Publish the first usable URI immediately, keep it
    // stable while collecting the rest, then publish one final enriched URI.
    let publishedFirstMethod = !!unifiedUri && preserveExisting;
    for (const task of [...addressTasks, ...lightningTasks]) {
      if (!isCurrentGeneration()) return;
      await task();
      if (!publishedFirstMethod && nextMethods.length > 0 && isCurrentGeneration()) {
        try {
          setReceiveMethods([...nextMethods]);
          setUnifiedUri(buildCurrentUnifiedUri());
          publishedFirstMethod = true;
        } catch {
          // A partial method may not yet be representable; the final build below
          // will surface a useful error if no combination succeeds.
        }
      }
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

      // Cache the legs so the follow-up "add Lightning" pass can reuse them
      // instead of re-deriving every address (see reuseAddrs above).
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

  const copyUnifiedUri = async () => {
    if (!unifiedUri) return;
    receiveLog('tap.copyUnified', { length: unifiedUri.length });
    await Clipboard.setString(unifiedUri);
    // Inline checkmark on the card (matches the address list) — no modal Alert.
    feedback.select();
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  // Generate the unified URI when that mode is selected, or amount changes.
  // Two passes: a fast one (on-chain + Spark address) so a QR appears quickly,
  // then a follow-up that mints the Lightning invoice and merges it in (reusing
  // the already-derived addresses — see reuseAddrs in generateUnifiedUri).
  //
  // Adapter calls can perform synchronous crypto on the JS thread, so the fast
  // pass waits for the navigation transition. A later Lightning enrichment is
  // only automatic when Spark is connected; RGB/NWC remains explicit.
  useEffect(() => {
    if (networkType !== 'unified') return;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let lightningTimeoutId: ReturnType<typeof setTimeout> | null = null;
    const fastInteraction = InteractionManager.runAfterInteractions(() => {
      timeoutId = setTimeout(() => {
        generateUnifiedUri({ includeLightning: false, reason: 'auto-fast' });
      }, 450);
    });
    const lightningInteraction = InteractionManager.runAfterInteractions(() => {
      lightningTimeoutId = setTimeout(() => {
        // Do not launch an automatic RGB/NWC request in the background. On
        // devices where the relay is slow that request can monopolize the JS
        // thread for its full timeout, including the Back gesture. Spark's
        // invoice path is local enough to safely enrich the unified QR.
        if (protocolManager.getAdapterIfAvailable('SPARK')?.isConnected()) {
          generateUnifiedUri({ includeLightning: true, preserveExisting: true, reason: 'auto-lightning' });
        }
      }, 5000);
    });
    return () => {
      fastInteraction.cancel();
      lightningInteraction.cancel();
      if (timeoutId) clearTimeout(timeoutId);
      if (lightningTimeoutId) clearTimeout(lightningTimeoutId);
      unifiedGenerationRef.current += 1;
    };
  }, [networkType, amount, unifiedAsset]);

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
  }, [selectedAsset, networkType]);

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

  // Auto-generate address when conditions change
  useEffect(() => {
    if (networkType === 'unified') return; // unified has its own generator
    if (selectedAsset) {
      setAddress('');
      setError(null);

      // Show the loader straight away (during the debounce window) when we know
      // we'll auto-generate — otherwise the "Generate address" prompt flashes
      // in between while switching networks.
      const willAutoGenerate = !isAmountRequired() || isAmountValid();
      if (willAutoGenerate) setLoading(true);

      // Only auto-generate if amount is not required, or if it's valid
      // Use a small delay to avoid interfering with user input
      const timeoutId = setTimeout(() => {
        if (!isAmountRequired() || isAmountValid()) {
          generateAddress();
        }
      }, 300); // Increased delay to reduce interference
      
      return () => clearTimeout(timeoutId);
    }
  }, [selectedAsset, networkType]);

  // Regenerate the Lightning invoice a moment after the amount changes (the amount
  // is set via the AmountEditorModal, so debounce to avoid re-minting mid-edit).
  useEffect(() => {
    if (networkType === 'lightning' && amount && isAmountValid()) {
      const timeoutId = setTimeout(() => generateAddress(), 2000);
      return () => clearTimeout(timeoutId);
    }
  }, [amount]);

  // Regenerate address when channels change (for lightning network)
  useEffect(() => {
    if (networkType === 'lightning' && selectedAsset && channels.length > 0) {
      const timeoutId = setTimeout(() => {
        if (!isAmountRequired() || isAmountValid()) {
          generateAddress();
        }
      }, 500);
      
      return () => clearTimeout(timeoutId);
    }
  }, [channels]);

  const [copied, setCopied] = useState(false);
  // Which address-list row was just copied (inline checkmark, auto-resets) —
  // avoids a disruptive modal Alert on every copy.
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const copyToClipboard = async () => {
    if (!address) return;
    receiveLog('tap.copyAddress', { length: address.length, networkType });
    await Clipboard.setString(address);
    feedback.select();
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  const shareAddress = async () => {
    if (!address) return;
    receiveLog('tap.shareAddress', { length: address.length, networkType });
    try {
      await Share.share({
        message: address,
        title: `${selectedAsset?.ticker} ${networkType === 'lightning' ? 'Invoice' : 'Address'}`,
      });
    } catch (error) {
      console.error('Failed to share:', error);
    }
  };

  // AssetIcon is now imported from components/AssetIcon

  // ── Amount <-> sats bridging for the multi-currency editor ────────────────
  const SATS_PER_BTC = 1e8;
  const currentAmountSats = (() => {
    if (!amount) return 0;
    const n = parseFloat(amount.replace(/,/g, ''));
    if (isNaN(n) || n <= 0) return 0;
    return bitcoinUnit === 'BTC' ? Math.round(n * SATS_PER_BTC) : Math.round(n);
  })();

  const applyAmountSats = (sats: number) => {
    if (!sats || sats <= 0) {
      setAmount('');
      return;
    }
    setAmount(bitcoinUnit === 'BTC' ? (sats / SATS_PER_BTC).toString() : String(Math.round(sats)));
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
  const currentAccent = NETWORK_COLORS[networkType] || theme.colors.primary[500];
  const isGeneratingReceive =
    (networkType === 'unified' && unifiedLoading && !unifiedUri) ||
    (networkType !== 'unified' && loading && !address);
  const selectedNetworkLayer: DepositLayer =
    networkType === 'unified'
      ? 'all'
      : networkType === 'onchain'
        ? selectedAsset.isRGB ? 'rgb' : 'onchain'
        : networkType;
  const monitorLayer = depositMonitor.layer ?? selectedNetworkLayer;
  const monitorStatus: DepositMonitorStatus =
    isGeneratingReceive ? 'generating' : depositMonitor.status === 'idle' ? 'watching' : depositMonitor.status;
  const monitorVisible =
    isGeneratingReceive ||
    (!!receiveTarget && !showDepositSuccess) ||
    ['pending', 'claimed', 'failed', 'expired'].includes(depositMonitor.status);

  const NETWORK_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
    'onchain': 'link',
    'lightning': 'flash',
    'spark': 'sparkles',
    'arkade': 'shield-checkmark',
  };

  const NETWORK_LABELS: Record<string, string> = {
    'onchain': 'On-chain',
    'lightning': 'Lightning',
    'spark': 'Spark',
    'arkade': 'Arkade',
  };

  const renderNetworkTabs = () => {
    // Lite mode abstracts away networks/layers: no manual picker, just the
    // unified single-QR receive (networkType defaults to 'unified').
    if (isLite) return null;

    const onChainAssets = getOnChainAssets();
    const lightningAssets = getLightningAssets();

    // Build list of available networks with metadata
    // Only show networks that are actually available (based on connected protocols)
    // The 'unified' chip is always offered first — it produces a single QR
    // embedding every method the connected adapters can provide.
    const allNetworks: Array<{ id: ReceiveMode; label: string; icon: keyof typeof Ionicons.glyphMap; color: string; subtitle: string; available: boolean }> = [
      { id: 'unified' as ReceiveMode, label: 'All networks', icon: 'apps' as keyof typeof Ionicons.glyphMap, color: NETWORK_COLORS['unified'], subtitle: 'one QR', available: true },
      ...(availableNetworkTypes.includes('onchain') ? [{ id: 'onchain' as ProtocolNetworkType, label: 'On-chain', icon: 'link' as keyof typeof Ionicons.glyphMap, color: NETWORK_COLORS['onchain'], subtitle: onChainAssets.length === 1 ? '1 asset' : `${onChainAssets.length} assets`, available: true }] : []),
      ...(availableNetworkTypes.includes('lightning') ? [{ id: 'lightning' as ProtocolNetworkType, label: 'Lightning', icon: 'flash' as keyof typeof Ionicons.glyphMap, color: NETWORK_COLORS['lightning'], subtitle: lightningAssets.length === 0 ? 'no channels' : lightningAssets.length === 1 ? '1 asset' : `${lightningAssets.length} assets`, available: lightningAssets.length > 0 }] : []),
      ...(availableNetworkTypes.includes('spark') ? [{ id: 'spark' as ProtocolNetworkType, label: 'Spark', icon: 'sparkles' as keyof typeof Ionicons.glyphMap, color: NETWORK_COLORS['spark'], subtitle: 'instant', available: true }] : []),
      ...(availableNetworkTypes.includes('arkade') ? [{ id: 'arkade' as ProtocolNetworkType, label: 'Arkade', icon: 'shield-checkmark' as keyof typeof Ionicons.glyphMap, color: NETWORK_COLORS['arkade'], subtitle: arkadeSubMode === 'boarding' ? 'boarding' : 'off-chain', available: true }] : []),
    ];

    return (
      <View style={styles.networkTabsContainer}>
        {/* Account chips — horizontal scrollable */}
        <Text style={{ fontSize: 11, fontWeight: '600', color: theme.colors.text.tertiary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8, paddingHorizontal: 4 }}>
          Destination Network
        </Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {allNetworks.map((net) => {
              const isActive = networkType === net.id;
              return (
                <PressableScale
                  key={net.id}
                  onPress={() => { feedback.select(); setNetworkType(net.id); }}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    paddingHorizontal: 14,
                    paddingVertical: 10,
                    borderRadius: 12,
                    backgroundColor: isActive ? net.color + '20' : theme.colors.background.secondary,
                    borderWidth: isActive ? 1.5 : 1,
                    borderColor: isActive ? net.color : theme.colors.border.light,
                    opacity: net.available ? 1 : 0.4,
                  }}
                >
                  {net.id === 'unified' ? (
                    <Ionicons name={net.icon} size={18} color={isActive ? net.color : theme.colors.text.secondary} />
                  ) : (
                    <NetworkIcon network={net.id} size={18} color={isActive ? net.color : theme.colors.text.secondary} />
                  )}
                  <View style={{ marginLeft: 8 }}>
                    <Text style={{ fontSize: 13, fontWeight: isActive ? '600' : '500', color: isActive ? net.color : theme.colors.text.primary }}>
                      {net.label}
                    </Text>
                    <Text style={{ fontSize: 10, color: isActive ? net.color + 'AA' : theme.colors.text.tertiary, marginTop: 1 }}>
                      {net.subtitle}
                    </Text>
                  </View>
                  {isActive && (
                    <View style={{ marginLeft: 8, width: 6, height: 6, borderRadius: 3, backgroundColor: net.color }} />
                  )}
                </PressableScale>
              );
            })}
          </View>
        </ScrollView>

        {/* Arkade sub-mode toggle */}
        {networkType === 'arkade' && (
          <TouchableOpacity
            onPress={() => setArkadeSubMode(arkadeSubMode === 'ark' ? 'boarding' : 'ark')}
            style={{
              flexDirection: 'row', alignItems: 'center', padding: 10, borderRadius: 10, marginBottom: 12,
              backgroundColor: NETWORK_COLORS['arkade'] + '15',
              borderWidth: 1, borderColor: NETWORK_COLORS['arkade'] + '30',
            }}
          >
            <Ionicons name="swap-horizontal" size={16} color={NETWORK_COLORS['arkade']} />
            <Text style={{ marginLeft: 8, fontSize: 13, color: NETWORK_COLORS['arkade'], fontWeight: '500' }}>
              {arkadeSubMode === 'ark' ? 'Switch to Boarding (on-chain deposit)' : 'Switch to Ark (off-chain receive)'}
            </Text>
          </TouchableOpacity>
        )}

        {/* Warning for Lightning with limited assets */}
        {networkType === 'lightning' && lightningAssets.length === 1 && (
          <View style={styles.networkWarning}>
            <Ionicons name="information-circle" size={16} color={theme.colors.warning[500]} />
            <Text style={styles.networkWarningText}>
              Only Bitcoin available. Open RGB Lightning channels to receive RGB assets.
            </Text>
          </View>
        )}
      </View>
    );
  };

  // Helper function to validate address for QR code
  const isValidQRData = (data: string): boolean => {
    return validateAddressOrInvoice(data) !== null;
  };

  // Unified single-QR receive view (wraps the body with a BTC/USD asset selector).
  // Pro/extension-style list of every address embedded in the unified QR. Each
  // row copies its address; a collapsible panel explains them; "Add RGB address"
  // jumps to the advanced asset picker.
  const renderUnifiedAddressList = () => {
    if (!unifiedAddresses.length) return null;
    const colorFor = (key: string): string =>
      (NETWORK_COLORS as Record<string, string>)[key] ?? theme.colors.primary[500];
    const trunc = (v: string) => (v.length > 30 ? `${v.slice(0, 16)}…${v.slice(-10)}` : v);
    const rgbConnected = !!getProtocolStatus().RGB;
    return (
      <View style={styles.addrListSection}>
        {/* Collapsed by default — the QR above is the primary receive surface, so
            the raw per-method addresses stay tucked away until tapped. */}
        <TouchableOpacity
          style={styles.addrListHeader}
          onPress={() => setShowAddresses((v) => !v)}
          activeOpacity={0.7}
        >
          <Text style={styles.addrListTitle}>Addresses</Text>
          <View style={styles.addrListHeaderRight}>
            <Text style={styles.addrListCount}>
              {unifiedAddresses.length} {unifiedAddresses.length === 1 ? 'address' : 'addresses'}
            </Text>
            <Ionicons
              name={showAddresses ? 'chevron-up' : 'chevron-down'}
              size={18}
              color={theme.colors.text.tertiary}
            />
          </View>
        </TouchableOpacity>
        {showAddresses && unifiedAddresses.map((a, idx) => {
          const isOpen = !!expandedAddrs[a.key];
          const isCopied = copiedKey === a.key;
          const isLast = idx === unifiedAddresses.length - 1;
          const copyAddr = async () => {
            receiveLog('tap.copyUnifiedMethod', { key: a.key, length: a.value.length });
            await Clipboard.setString(a.value);
            feedback.select();
            setCopiedKey(a.key);
            setTimeout(() => setCopiedKey((k) => (k === a.key ? null : k)), 1600);
          };
          const dotColor = colorFor(a.key);
          return (
            <View key={a.key} style={[styles.addrRow, isLast && styles.addrRowLast]}>
              {/* Tap anywhere on the label/value to copy (large target); the
                  chevron expands the full value, the icon mirrors the copy. */}
              <TouchableOpacity style={styles.addrRowMain} onPress={copyAddr} activeOpacity={0.6}>
                <View style={[styles.addrDot, { backgroundColor: dotColor }]} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.addrLabel}>{a.label}</Text>
                  {isOpen ? (
                    <Text style={styles.uriFull} selectable>{a.value}</Text>
                  ) : (
                    <Text style={styles.addrValue} numberOfLines={1}>{trunc(a.value)}</Text>
                  )}
                </View>
              </TouchableOpacity>
              {/* Per-address "show full" — the full value lives here, not on the URI. */}
              <TouchableOpacity
                onPress={() => setExpandedAddrs((p) => ({ ...p, [a.key]: !p[a.key] }))}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                style={styles.addrIconBtn}
                activeOpacity={0.7}
              >
                <Ionicons
                  name={isOpen ? 'chevron-up' : 'chevron-down'}
                  size={16}
                  color={theme.colors.text.tertiary}
                />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={copyAddr}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                style={styles.addrIconBtn}
                activeOpacity={0.7}
              >
                <Ionicons
                  name={isCopied ? 'checkmark' : 'copy-outline'}
                  size={18}
                  color={isCopied ? theme.colors.success[500] : dotColor}
                />
              </TouchableOpacity>
            </View>
          );
        })}

        {showAddresses && (
          <>
            <TouchableOpacity
              style={styles.addrInfoToggle}
              onPress={() => setShowAddressInfo((v) => !v)}
              activeOpacity={0.7}
            >
              <Ionicons name="information-circle-outline" size={16} color={theme.colors.text.tertiary} />
              <Text style={styles.addrInfoToggleText}>What are these addresses?</Text>
              <Ionicons
                name={showAddressInfo ? 'chevron-up' : 'chevron-down'}
                size={16}
                color={theme.colors.text.tertiary}
              />
            </TouchableOpacity>
            {showAddressInfo && (
              <Text style={styles.addrInfoBody}>
                The single QR above carries several ways to be paid — a sender's wallet automatically picks
                whichever it supports: Bitcoin on-chain, Lightning (instant, low fee), Spark, Arkade or
                Liquid. You can also copy any individual address above.
              </Text>
            )}
          </>
        )}

        {/* Only offer an RGB receive when an RGB node is actually connected —
            otherwise there is no RGB address to add. */}
        {rgbConnected && (
          <TouchableOpacity
            style={styles.addRgbBtn}
            activeOpacity={0.7}
            onPress={() => {
              setShowAllNetworks(true);
              setShowAssetSelector(true);
            }}
          >
            <Ionicons name="add-circle-outline" size={18} color={theme.colors.primary[500]} />
            <Text style={styles.addRgbText}>Add RGB address</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  };

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
          onPress={() => { feedback.select(); setShowNewAsset(true); }}
          activeOpacity={0.7}
        >
          <Ionicons name="add" size={20} color={theme.colors.text.secondary} />
        </TouchableOpacity>
      </View>
    );
  };

  // ── Network selector: "All" by default, specific networks behind a dropdown ─
  const renderNetworkDropdown = () => {
    const canUseAll = selectedAsset.ticker === 'BTC' || /usd/i.test(selectedAsset.ticker);
    const isRgbAsset = getAssetFamily(selectedAsset.asset_id, selectedAsset.ticker) === 'RGB';
    const options: Array<{ id: ReceiveMode; label: string; sub: string }> = [
      ...(canUseAll
        ? [{
            id: 'unified' as ReceiveMode,
            label: 'All networks',
            // USD is a different protocol set than BTC — reflect it in the hint.
            sub: /usd/i.test(selectedAsset.ticker)
              ? 'Liquid · Spark · optional RGB'
              : 'On-chain · Spark · Arkade · optional Lightning',
          }]
        : []),
      ...(availableNetworkTypes.includes('onchain')
        ? [{ id: 'onchain' as ReceiveMode, label: isRgbAsset ? 'RGB on-chain' : 'On-chain', sub: isRgbAsset ? 'RGB Layer 1 (L1)' : 'Bitcoin Layer 1' }] : []),
      ...(availableNetworkTypes.includes('lightning')
        ? [{ id: 'lightning' as ReceiveMode, label: isRgbAsset ? 'RGB Lightning' : 'Lightning', sub: isRgbAsset ? 'Instant · in-channel (RGB-LN)' : 'Instant · low fee' }] : []),
      ...(availableNetworkTypes.includes('spark')
        ? [{ id: 'spark' as ReceiveMode, label: 'Spark', sub: 'Instant' }] : []),
      ...(availableNetworkTypes.includes('arkade')
        ? [{ id: 'arkade' as ReceiveMode, label: 'Arkade', sub: 'Off-chain' }] : []),
    ];
    const current = options.find((o) => o.id === networkType) || options[0];
    if (!current) return null;
    const color = NETWORK_COLORS[current.id] || theme.colors.primary[500];

    const glyph = (id: ReceiveMode, c: string) =>
      id === 'unified'
        ? <Ionicons name="apps" size={18} color={c} />
        : <NetworkIcon network={id as ProtocolNetworkType} size={18} color={c} />;

    return (
      <View style={styles.netSelectorWrap}>
        <TouchableOpacity
          style={[styles.netSelector, showNetworkDropdown && { borderColor: color }]}
          onPress={() => {
            receiveLog('tap.networkSelector', { current: current.id, open: !showNetworkDropdown });
            feedback.select();
            if (!showNetworkDropdown && !channelsLoading && getProtocolStatus().RGB) {
              // Channel discovery is an advanced/network-specific NWC request.
              // Start it only after the user asks to see network choices, never
              // during the default Receive opening sequence.
              setTimeout(() => void loadChannels(), 0);
            }
            setShowNetworkDropdown((v) => !v);
          }}
          activeOpacity={0.7}
        >
          <View style={[styles.netGlyph, { backgroundColor: color + '1A' }]}>
            {glyph(current.id, color)}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.netSelectorLabel}>{current.label}</Text>
            <Text style={styles.netSelectorSub} numberOfLines={1}>{current.sub}</Text>
          </View>
          <Ionicons
            name={showNetworkDropdown ? 'chevron-up' : 'chevron-down'}
            size={18}
            color={theme.colors.text.tertiary}
          />
        </TouchableOpacity>

        {showNetworkDropdown && (
          <View style={styles.netDropdown}>
            {options.map((o) => {
              const active = o.id === networkType;
              const c = NETWORK_COLORS[o.id] || theme.colors.primary[500];
              return (
                <TouchableOpacity
                  key={o.id}
                  style={[styles.netOption, active && { backgroundColor: c + '12' }]}
                  onPress={() => {
                    receiveLog('tap.networkOption', { from: networkType, to: o.id });
                    feedback.select();
                    if (active) {
                      setShowNetworkDropdown(false);
                      return;
                    }
                    resetReceiveSurface();
                    setNetworkType(o.id);
                    setShowNetworkDropdown(false);
                  }}
                  activeOpacity={0.7}
                >
                  <View style={[styles.netGlyph, { backgroundColor: c + '1A' }]}>
                    {glyph(o.id, c)}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.netOptionLabel, active && { color: c }]}>{o.label}</Text>
                    <Text style={styles.netSelectorSub} numberOfLines={1}>{o.sub}</Text>
                  </View>
                  {active && <Ionicons name="checkmark-circle" size={18} color={c} />}
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      </View>
    );
  };

  // ── Amount row with pencil edit (opens the multi-currency editor) ─────────
  const renderAmountRow = () => {
    // The amount editor works in BTC/sats/fiat — it can't express an RGB asset
    // amount, and RGB invoices are open-amount anyway, so hide it for RGB assets.
    if (selectedAsset?.isRGB) return null;
    const summary = amountSummary();
    const required = isAmountRequired();
    return (
      <TouchableOpacity
        style={styles.amountRow}
        onPress={() => {
          receiveLog('tap.amountRow', { amount, networkType, asset: selectedAsset.ticker });
          setShowAmountEditor(true);
        }}
        activeOpacity={0.7}
      >
        <View style={styles.amountRowIcon}>
          <Ionicons name="cash-outline" size={18} color={theme.colors.primary[500]} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.amountRowLabel}>
            {summary ? 'Requested amount' : required ? 'Amount required' : 'Add amount'}
          </Text>
          <Text style={styles.amountRowValue} numberOfLines={1}>
            {summary || 'Optional — tap to set in BTC, USD or fiat'}
          </Text>
        </View>
        <View style={styles.amountEditBtn}>
          <Ionicons name="pencil" size={16} color={theme.colors.primary[500]} />
        </View>
      </TouchableOpacity>
    );
  };

  const renderUnifiedContent = () => {
    const accent = NETWORK_COLORS['unified'];
    return renderUnifiedBody(accent);
  };

  // Middle-truncate a long address/invoice for the collapsed card.
  const truncMid = (v: string, head = 22, tail = 14) =>
    v.length > head + tail + 1 ? `${v.slice(0, head)}…${v.slice(-tail)}` : v;

  // Reusable receive card: collapsed address/URI with copy + expand + share,
  // icon-driven to match rate-extension. Tapping the row copies; the chevron
  // reveals the full value; share lives as a small icon action.
  const renderUriCard = ({
    value, accent, label, icon, expanded, onToggle, onCopy, onShare,
  }: {
    value: string;
    accent: string;
    label: string;
    icon: React.ReactNode;
    // Expand ("Show full") is opt-in. The unified payment-request URI omits it —
    // the full value of each method is read/expanded in the address list below.
    expanded?: boolean;
    onToggle?: () => void;
    onCopy: () => void;
    onShare: () => void;
  }) => (
    <View style={[styles.uriCard, { borderColor: accent + '40' }]}>
      {/* Header: method icon + label + the (truncated) value. Tapping copies. */}
      <TouchableOpacity style={styles.uriCardRow} onPress={onCopy} activeOpacity={0.6}>
        <View style={[styles.uriIconWrap, { backgroundColor: accent + '1A' }]}>{icon}</View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[styles.uriLabel, { color: accent }]}>{label}</Text>
          <Text style={styles.uriValue} numberOfLines={1}>{truncMid(value)}</Text>
        </View>
        {onToggle && (
          <TouchableOpacity
            onPress={onToggle}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={styles.uriChevronBtn}
            activeOpacity={0.7}
          >
            <Ionicons
              name={expanded ? 'chevron-up' : 'chevron-down'}
              size={18}
              color={theme.colors.text.tertiary}
            />
          </TouchableOpacity>
        )}
      </TouchableOpacity>

      {expanded && onToggle && <Text style={styles.uriFull} selectable>{value}</Text>}

      {/* Primary Copy (accent-filled, inline ✓ feedback) + outline Share. */}
      <View style={styles.uriActions}>
        <TouchableOpacity
          style={[styles.uriPrimaryBtn, { backgroundColor: copied ? theme.colors.success[500] : accent }]}
          onPress={onCopy}
          activeOpacity={0.85}
        >
          <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={16} color="#FFFFFF" />
          <Text style={styles.uriPrimaryBtnText}>{copied ? 'Copied' : 'Copy'}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.uriSecondaryBtn, { borderColor: accent + '40' }]}
          onPress={onShare}
          activeOpacity={0.7}
        >
          <Ionicons name="share-outline" size={16} color={accent} />
          <Text style={[styles.uriSecondaryBtnText, { color: accent }]}>Share</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  // Clean QR-sized loader (no copy text) — a spinner sitting where the QR will be.
  const renderQrLoading = (accent: string) => (
    <View style={styles.qrSection}>
      <View style={styles.qrContainer}>
        <View style={[styles.qrCodeWrapper, { width: qrSize + 32, height: qrSize + 32, alignItems: 'center', justifyContent: 'center' }]}>
          <ActivityIndicator size="large" color={accent} />
        </View>
      </View>
    </View>
  );

  const renderUnifiedBody = (accent: string) => {
    // Only block on the spinner until the FIRST method is ready; after that the
    // QR is shown and remaining methods stream in (see the inline indicator).
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
          <View style={styles.universalRequestHeading}>
            <View style={[styles.universalRequestIcon, { backgroundColor: accent + '1A' }]}>
              <Ionicons name="apps" size={16} color={accent} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.universalRequestTitle}>Universal payment request</Text>
              <Text style={styles.universalRequestSubtitle} numberOfLines={1}>
                Automatically routes supported Bitcoin payments
              </Text>
            </View>
          </View>
          <TouchableOpacity
            onPress={() => generateUnifiedUri()}
            style={styles.qrRefreshBtn}
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
              {unifiedMethods.length > 0
                ? `${unifiedMethods.length} ${unifiedMethods.length === 1 ? 'method' : 'methods'} ready · adding another…`
                : 'Creating the first payment method…'}
            </Text>
          </View>
        )}

        {!unifiedLoading
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

        <View style={styles.qrContainer}>
          <View style={styles.qrCodeWrapper}>
            <DeferredQrCode value={unifiedUri} size={qrSize} />
          </View>
        </View>

        {renderUriCard({
          value: unifiedUri,
          accent,
          label: 'Payment request',
          icon: <Ionicons name="apps" size={16} color={accent} />,
          // No "Show full" here — the composite BIP321 URI isn't meant to be read;
          // each method's full address is expandable in the list below.
          onCopy: copyUnifiedUri,
          onShare: async () => {
            try {
              await Share.share({ message: unifiedUri, title: 'Payment request' });
            } catch (e) { console.error('Failed to share unified URI:', e); }
          },
        })}
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
      : networkType === 'lightning' ? 'Lightning Invoice'
      : selectedAsset.isRGB ? 'RGB Invoice'
      : 'On-chain Address';

    const netColor = NETWORK_COLORS[networkType] || theme.colors.primary[500];
    const addrLabel = networkType === 'lightning' ? 'Lightning Invoice'
      : networkType === 'spark' ? 'Spark Address'
      : networkType === 'arkade' ? (arkadeSubMode === 'boarding' ? 'Boarding Address' : 'Arkade Address')
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
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            activeOpacity={0.7}
          >
            <Ionicons name="refresh" size={15} color={theme.colors.text.tertiary} />
          </TouchableOpacity>
        </View>

        <View style={styles.qrContainer}>
          <View style={styles.qrCodeWrapper}>
            <DeferredQrCode value={address} size={qrSize} />
          </View>
        </View>

        {renderUriCard({
          value: address,
          accent: netColor,
          label: addrLabel,
          icon: <NetworkIcon network={networkType} size={16} color={netColor} />,
          expanded: showFullAddr,
          onToggle: () => setShowFullAddr((v) => !v),
          onCopy: copyToClipboard,
          onShare: shareAddress,
        })}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right', 'bottom']}>
      <View style={styles.receiveHeader}>
        <TouchableOpacity
          onPress={() => {
            cancelReceiveWork();
            navigation.goBack();
          }}
          style={styles.receiveBackButton}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          activeOpacity={0.7}
        >
          <Ionicons name="arrow-back" size={26} color={theme.colors.text.primary} />
        </TouchableOpacity>
        <Text style={styles.receiveHeaderTitle}>Receive</Text>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="always"
        keyboardDismissMode="on-drag"
      >
        {renderAssetTabs()}
        {renderNetworkDropdown()}
        {renderAmountRow()}
        {renderContent()}
        <DepositMonitorCard
          visible={monitorVisible}
          status={monitorStatus}
          layer={monitorLayer}
          message={depositMonitor.message}
          accent={currentAccent}
          methodCount={networkType === 'unified' ? unifiedMethods.length : 1}
        />
        {networkType === 'unified' && renderUnifiedAddressList()}
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
        initialSats={currentAmountSats}
        rates={fiatRates}
        bitcoinUnit={bitcoinUnit}
        balanceSats={btcBalance?.vanilla?.spendable || 0}
        onConfirm={(sats) => {
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background.secondary,
  },

  receiveHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[5],
    paddingTop: theme.spacing[3],
    paddingBottom: theme.spacing[3],
    backgroundColor: theme.colors.background.secondary,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border.light,
    zIndex: 30,
    elevation: 30,
  },

  receiveBackButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: theme.colors.surface.secondary,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border.light,
    alignItems: 'center',
    justifyContent: 'center',
  },

  receiveHeaderTitle: {
    flex: 1,
    fontSize: 28,
    fontWeight: '800',
    color: theme.colors.text.primary,
  },
  
  headerContainer: {
    marginBottom: theme.spacing[4],
  },
  
  headerGradient: {
    paddingTop: theme.spacing[2],
    paddingBottom: theme.spacing[6],
    borderBottomLeftRadius: theme.borderRadius['2xl'],
    borderBottomRightRadius: theme.borderRadius['2xl'],
  },
  
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing[5],
    paddingTop: theme.spacing[4],
    marginBottom: theme.spacing[6],
  },
  
  backButton: {
    width: 40,
    height: 40,
    borderRadius: theme.borderRadius.base,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  
  headerTitle: {
    fontSize: theme.typography.fontSize.xl,
    fontWeight: '700',
    color: theme.colors.text.inverse,
  },
  
  helpButton: {
    width: 40,
    height: 40,
    borderRadius: theme.borderRadius.base,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  
  assetSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.spacing[5],
    paddingVertical: theme.spacing[4],
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    marginHorizontal: theme.spacing[5],
    borderRadius: theme.borderRadius.xl,
  },
  
  assetIconContainer: {
    width: 40,
    height: 40,
    borderRadius: theme.borderRadius.lg,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: theme.spacing[3],
  },
  
  assetIconImage: {
    width: 28,
    height: 28,
    borderRadius: 14,
  },
  
  assetInfo: {
    flex: 1,
  },
  
  assetTicker: {
    fontSize: theme.typography.fontSize.lg,
    fontWeight: '700',
    color: theme.colors.text.inverse,
    marginBottom: theme.spacing[1],
  },
  
  assetName: {
    fontSize: theme.typography.fontSize.sm,
    color: 'rgba(255, 255, 255, 0.8)',
    marginBottom: theme.spacing[1],
  },
  
  assetBalance: {
    fontSize: theme.typography.fontSize.xs,
    color: 'rgba(255, 255, 255, 0.7)',
  },
  
  chevronContainer: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  
  assetDropdown: {
    backgroundColor: theme.colors.surface.primary,
    marginHorizontal: theme.spacing[5],
    marginTop: theme.spacing[2],
    borderRadius: theme.borderRadius.xl,
    maxHeight: 300,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.15,
    shadowRadius: 6.27,
    elevation: 10,
  },
  
  assetDropdownScroll: {
    maxHeight: 280,
  },
  
  assetOption: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: theme.spacing[4],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border.light,
  },
  
  assetOptionSelected: {
    backgroundColor: theme.colors.primary[50],
  },
  
  assetOptionInfo: {
    flex: 1,
    marginLeft: theme.spacing[3],
  },
  
  assetOptionTicker: {
    fontSize: theme.typography.fontSize.base,
    fontWeight: '600',
    color: theme.colors.text.primary,
  },
  
  assetOptionName: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.text.secondary,
    marginBottom: theme.spacing[1],
  },
  
  assetOptionBalance: {
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.text.muted,
  },
  
  // Network Tabs
  networkTabsContainer: {
    paddingHorizontal: theme.spacing[5],
    marginBottom: theme.spacing[5],
    marginTop: -theme.spacing[2], // Slight overlap with header
  },
  
  networkTabs: {
    flexDirection: 'row',
    backgroundColor: theme.colors.surface.primary,
    borderRadius: theme.borderRadius.xl,
    padding: theme.spacing[1],
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 3.84,
    elevation: 5,
  },
  
  networkTab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
    borderRadius: theme.borderRadius.lg,
    gap: theme.spacing[2],
  },
  
  networkTabActive: {
    backgroundColor: theme.colors.primary[50],
  },
  
  networkTabText: {
    fontSize: theme.typography.fontSize.sm,
    fontWeight: '600',
    color: theme.colors.text.secondary,
  },
  
  networkTabTextActive: {
    color: theme.colors.primary[500],
  },

  networkTabContent: {
    alignItems: 'center',
  },

  networkTabSubtext: {
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.text.muted,
    marginTop: theme.spacing[1],
  },

  networkTabSubtextActive: {
    color: theme.colors.primary[500],
  },

  networkTabDisabled: {
    opacity: 0.6,
  },

  networkTabLoader: {
    marginLeft: theme.spacing[2],
  },

  networkWarning: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.warning[50],
    borderRadius: theme.borderRadius.base,
    padding: theme.spacing[3],
    marginTop: theme.spacing[3],
    marginHorizontal: theme.spacing[1],
    gap: theme.spacing[2],
  },

  networkWarningText: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.warning[600],
    flex: 1,
    lineHeight: 18,
  },
  
  scrollView: {
    flex: 1,
    zIndex: 0,
  },
  
  scrollContent: {
    paddingHorizontal: theme.spacing[5],
    paddingTop: theme.spacing[2],
    paddingBottom: theme.spacing[10],
  },
  
  // Amount Section
  amountSection: {
    marginBottom: theme.spacing[6],
  },
  
  sectionTitle: {
    fontSize: theme.typography.fontSize.lg,
    fontWeight: '700',
    color: theme.colors.text.primary,
    marginBottom: theme.spacing[2],
  },
  
  sectionDescription: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.text.secondary,
    marginBottom: theme.spacing[4],
    lineHeight: 20,
  },
  
  errorMessage: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.error[50],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderRadius: theme.borderRadius.base,
    marginBottom: theme.spacing[3],
    gap: theme.spacing[2],
  },
  
  errorMessageText: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.error[600],
    fontWeight: '500',
  },
  
  inputContainer: {
    position: 'relative',
  },
  
  amountInput: {
    paddingRight: theme.spacing[16], // Make room for currency label
  },
  
  amountInputError: {
    borderColor: theme.colors.error[500],
    borderWidth: 2,
  },
  
  currencyLabel: {
    position: 'absolute',
    right: theme.spacing[4],
    top: '50%',
    transform: [{ translateY: -10 }],
    backgroundColor: theme.colors.gray[100],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[1],
    borderRadius: theme.borderRadius.base,
  },
  
  currencyText: {
    fontSize: theme.typography.fontSize.sm,
    fontWeight: '600',
    color: theme.colors.text.secondary,
  },

  quickAmounts: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: theme.spacing[3],
    gap: theme.spacing[2],
  },
  
  quickAmountButton: {
    flex: 1,
    backgroundColor: theme.colors.primary[50],
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: theme.colors.primary[100],
  },
  
  quickAmountButtonSelected: {
    backgroundColor: theme.colors.primary[100],
    borderColor: theme.colors.primary[500],
  },
  
  quickAmountText: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.primary[700],
    fontWeight: '600',
  },
  
  quickAmountTextSelected: {
    color: theme.colors.primary[700],
    fontWeight: '700',
  },
  
  approximateValue: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.text.secondary,
    marginTop: theme.spacing[2],
    textAlign: 'right',
  },

  lightningWarnings: {
    marginTop: theme.spacing[3],
    gap: theme.spacing[2],
  },

  warningContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.primary[50],
    borderRadius: theme.borderRadius.base,
    padding: theme.spacing[3],
    gap: theme.spacing[2],
    borderWidth: 1,
    borderColor: theme.colors.primary[500] + '20', // 20% opacity
  },

  errorWarning: {
    backgroundColor: theme.colors.warning[50],
    borderColor: theme.colors.warning[500] + '20', // 20% opacity
  },

  warningText: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.primary[600],
    flex: 1,
    lineHeight: 18,
  },

  errorWarningText: {
    color: theme.colors.warning[600],
  },
  
  // Content sections
  loadingSection: {
    backgroundColor: theme.colors.surface.primary,
    borderRadius: theme.borderRadius.xl,
    padding: theme.spacing[12],
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.15,
    shadowRadius: 6.27,
    elevation: 10,
  },
  
  loadingText: {
    fontSize: theme.typography.fontSize.base,
    color: theme.colors.text.secondary,
    marginTop: theme.spacing[4],
    textAlign: 'center',
  },

  errorContainer: {
    backgroundColor: theme.colors.surface.primary,
    borderRadius: theme.borderRadius.xl,
    padding: theme.spacing[8],
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.15,
    shadowRadius: 6.27,
    elevation: 10,
  },
  
  errorText: {
    fontSize: theme.typography.fontSize.base,
    color: theme.colors.text.secondary,
    marginTop: theme.spacing[4],
    marginBottom: theme.spacing[6],
    textAlign: 'center',
    lineHeight: 22,
  },
  
  promptContainer: {
    backgroundColor: theme.colors.surface.primary,
    borderRadius: theme.borderRadius.xl,
    padding: theme.spacing[8],
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.15,
    shadowRadius: 6.27,
    elevation: 10,
  },
  
  promptText: {
    fontSize: theme.typography.fontSize.base,
    color: theme.colors.text.secondary,
    marginTop: theme.spacing[4],
    marginBottom: theme.spacing[6],
    textAlign: 'center',
    lineHeight: 22,
  },
  
  retryButton: {
    backgroundColor: theme.colors.primary[500],
    paddingHorizontal: theme.spacing[6],
    paddingVertical: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
  },
  
  retryButtonText: {
    fontSize: theme.typography.fontSize.sm,
    fontWeight: '600',
    color: theme.colors.text.inverse,
  },
  
  generateButton: {
    backgroundColor: theme.colors.primary[500],
    paddingHorizontal: theme.spacing[8],
    paddingVertical: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
  },
  
  generateButtonText: {
    fontSize: theme.typography.fontSize.base,
    fontWeight: '600',
    color: theme.colors.text.inverse,
  },
  
  // QR Section
  assetTabs: {
    flexDirection: 'row',
    gap: theme.spacing[2],
    marginBottom: theme.spacing[3],
    zIndex: 20,
    elevation: 20,
  },
  assetTab: {
    flex: 1,
    flexDirection: 'row',
    gap: theme.spacing[2],
    minHeight: 44,
    paddingVertical: theme.spacing[2],
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1.5,
    borderColor: theme.colors.border.medium,
    backgroundColor: theme.colors.surface.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  assetTabText: {
    fontSize: theme.typography.fontSize.base,
    fontWeight: '600',
    color: theme.colors.text.secondary,
    flexShrink: 1,
  },
  addrListSection: {
    // No horizontal margin: this list lives inside the already-padded scroll
    // content, so it must align edge-to-edge with the QR card above it (a 16px
    // margin here left it visibly narrower and offset).
    marginTop: 4,
    backgroundColor: theme.colors.surface.primary,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.colors.border.light,
    padding: 10,
  },
  addrListHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  addrListHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  addrListCount: {
    fontSize: 12,
    color: theme.colors.text.tertiary,
  },
  addrListTitle: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: theme.colors.text.tertiary,
  },
  addrRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border.light,
  },
  // Last row sits directly above the "What are these addresses?" toggle — drop
  // the divider so the section doesn't read as having a dangling separator.
  addrRowLast: {
    borderBottomWidth: 0,
  },
  // Tap target covering the dot + label + value (copies the address).
  addrRowMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minWidth: 0,
  },
  addrIconBtn: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addrDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  addrLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: theme.colors.text.primary,
  },
  addrValue: {
    fontSize: 12,
    color: theme.colors.text.muted,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    marginTop: 1,
  },
  addrInfoToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 12,
    paddingHorizontal: 4,
  },
  addrInfoToggleText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
    color: theme.colors.text.tertiary,
  },
  addrInfoBody: {
    fontSize: 12,
    lineHeight: 18,
    color: theme.colors.text.muted,
    paddingHorizontal: 4,
    paddingBottom: 8,
  },
  addRgbBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 4,
    paddingVertical: 11,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.colors.border.medium,
    borderStyle: 'dashed',
  },
  addRgbText: {
    fontSize: 14,
    fontWeight: '700',
    color: theme.colors.primary[500],
  },
  qrSection: {
    backgroundColor: 'transparent',
    paddingHorizontal: 0,
    paddingTop: theme.spacing[1],
    paddingBottom: theme.spacing[2],
    alignItems: 'center',
    zIndex: 0,
  },

  qrHeader: {
    alignItems: 'center',
    marginBottom: theme.spacing[3],
  },

  qrTitle: {
    fontSize: theme.typography.fontSize.lg,
    fontWeight: '700',
    color: theme.colors.text.primary,
    textAlign: 'center',
    marginBottom: theme.spacing[1],
  },
  
  qrAmountContainer: {
    backgroundColor: theme.colors.primary[50],
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[2],
    borderRadius: theme.borderRadius.full,
  },
  
  qrAmount: {
    fontSize: theme.typography.fontSize.base,
    fontWeight: '600',
    color: theme.colors.primary[600],
  },
  
  qrContainer: {
    alignItems: 'center',
    marginBottom: theme.spacing[3],
  },
  
  qrCodeWrapper: {
    padding: theme.spacing[4],
    backgroundColor: '#FFFFFF', // QR must sit on white to stay scannable
    borderRadius: theme.borderRadius.xl,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 3.84,
    elevation: 5,
  },

  // Compact methods/label chip above the QR
  qrMethodsChip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[1],
    borderRadius: theme.borderRadius.full,
    marginBottom: theme.spacing[4],
    maxWidth: '100%',
  },
  qrMethodsChipText: {
    fontSize: theme.typography.fontSize.xs,
    fontWeight: '700',
  },

  // Top bar above the QR (chip on the left, small refresh on the right)
  qrTopBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    gap: theme.spacing[2],
    marginBottom: theme.spacing[3],
    minHeight: 42,
  },
  qrRefreshBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surface.secondary,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border.light,
  },
  qrStreamHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    marginTop: -theme.spacing[2],
    marginBottom: theme.spacing[2],
    paddingLeft: theme.spacing[1],
  },
  qrStreamHintText: {
    fontSize: 11,
    color: theme.colors.text.secondary,
    fontWeight: '500',
  },
  universalRequestHeading: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[2],
    minWidth: 0,
  },
  universalRequestIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  universalRequestTitle: {
    fontSize: theme.typography.fontSize.sm,
    fontWeight: '700',
    color: theme.colors.text.primary,
  },
  universalRequestSubtitle: {
    fontSize: 11,
    color: theme.colors.text.secondary,
    marginTop: 2,
  },

  // Collapsible receive card (address / unified URI)
  uriCard: {
    width: '100%',
    backgroundColor: theme.colors.surface.primary,
    borderRadius: 16,
    borderWidth: 1,
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[3],
    marginBottom: theme.spacing[1],
  },
  uriCardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[3],
  },
  uriIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  uriLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  uriValue: {
    fontSize: 13,
    color: theme.colors.text.primary,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    marginTop: 3,
  },
  uriChevronBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  uriFull: {
    fontSize: 12,
    lineHeight: 18,
    color: theme.colors.text.secondary,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    marginTop: theme.spacing[3],
    paddingTop: theme.spacing[3],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.colors.border.light,
  },
  uriActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: theme.spacing[3],
  },
  // Primary "Copy" — accent-filled pill, flips to green ✓ on copy.
  uriPrimaryBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 40,
    borderRadius: 12,
  },
  uriPrimaryBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  // Secondary "Share" — outline pill in the method accent.
  uriSecondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 40,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
  },
  uriSecondaryBtnText: {
    fontSize: 14,
    fontWeight: '700',
  },

  // Asset "+" tab (square add button)
  assetAddTab: {
    width: 44,
    minHeight: 44,
    paddingVertical: theme.spacing[2],
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1.5,
    borderColor: theme.colors.border.medium,
    backgroundColor: theme.colors.surface.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Network selector + dropdown
  netSelectorWrap: {
    marginBottom: theme.spacing[4],
    zIndex: 15,
    elevation: 15,
  },
  netSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[3],
    padding: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1.5,
    borderColor: theme.colors.border.medium,
    backgroundColor: theme.colors.surface.primary,
  },
  netGlyph: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  netSelectorLabel: {
    fontSize: theme.typography.fontSize.base,
    fontWeight: '700',
    color: theme.colors.text.primary,
  },
  netSelectorSub: {
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.text.tertiary,
    marginTop: 1,
  },
  netDropdown: {
    marginTop: theme.spacing[2],
    backgroundColor: theme.colors.surface.primary,
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border.light,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 6,
  },
  netOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border.light,
  },
  netOptionLabel: {
    fontSize: theme.typography.fontSize.sm,
    fontWeight: '600',
    color: theme.colors.text.primary,
  },

  depositMonitorCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[3],
    marginBottom: theme.spacing[4],
    padding: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface.primary,
    borderWidth: 1,
    borderColor: theme.colors.border.light,
  },
  depositMonitorIconWrap: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
  depositMonitorPulse: {
    position: 'absolute',
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 2,
  },
  depositMonitorIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  depositMonitorText: {
    flex: 1,
    minWidth: 0,
  },
  depositMonitorTitle: {
    fontSize: theme.typography.fontSize.sm,
    fontWeight: '700',
    color: theme.colors.text.primary,
  },
  depositMonitorSubtitle: {
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.text.tertiary,
    marginTop: 2,
    lineHeight: 16,
  },
  depositReadyRow: {
    width: '100%',
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.spacing[3],
    marginBottom: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface.primary,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border.light,
  },
  depositReadyDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    marginRight: theme.spacing[2],
  },
  depositReadyText: {
    fontSize: theme.typography.fontSize.xs,
    fontWeight: '700',
    color: theme.colors.text.primary,
  },
  depositReadyMeta: {
    flex: 1,
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.text.tertiary,
    marginLeft: 4,
  },

  // Amount row with pencil edit
  amountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[3],
    marginBottom: theme.spacing[4],
    padding: theme.spacing[4],
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface.primary,
    borderWidth: 1,
    borderColor: theme.colors.border.light,
  },
  amountRowIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: theme.colors.primary[50],
    alignItems: 'center',
    justifyContent: 'center',
  },
  amountRowLabel: {
    fontSize: theme.typography.fontSize.xs,
    fontWeight: '700',
    color: theme.colors.text.tertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  amountRowValue: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.text.primary,
    marginTop: 2,
  },
  amountEditBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: theme.colors.primary[50],
    alignItems: 'center',
    justifyContent: 'center',
  },
  
  addressContainer: {
    width: '100%',
    backgroundColor: theme.colors.gray[50],
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing[4],
    marginBottom: theme.spacing[5],
  },
  
  addressLabel: {
    fontSize: theme.typography.fontSize.sm,
    fontWeight: '600',
    color: theme.colors.text.secondary,
    marginBottom: theme.spacing[2],
  },
  
  addressText: {
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.text.primary,
    fontFamily: 'monospace',
    lineHeight: 16,
  },
  
  qrActions: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    width: '100%',
    paddingTop: theme.spacing[2],
  },
  
  qrActionButton: {
    alignItems: 'center',
    padding: theme.spacing[3],
    flex: 1,
  },
  
  qrActionIcon: {
    width: 40,
    height: 40,
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.primary[50],
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: theme.spacing[2],
  },
  
  qrActionText: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.primary[500],
    fontWeight: '600',
  },
});
