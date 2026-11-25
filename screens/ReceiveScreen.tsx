import { ActionableError } from '../components/ActionableError';
import { depositAmountLabel } from '../utils/deposit-receipt';
import { NetworkIcon } from '../components/NetworkIcon';
import { BridgeEntryCard } from '../components/receive/BridgeEntryCard';
import { ReceiveConnectionNotice } from '../components/receive/ReceiveConnectionNotice';
import { needsSeparateLightningInvoice, receiveAmountSats } from '../utils/receive-request';
import { useReceiveGeneration } from '../hooks/useReceiveGeneration';
import { ReceiveOutcomeCard } from '../components/receive/ReceiveOutcomeCard';
import { receivePresentation } from '../utils/receive-presentation';
import { useForegroundClock } from '../hooks/useForegroundClock';
import { InvoiceExpiry, invoiceExpiry } from '../components/payments/InvoiceExpiry';
import { PaymentNetworkLabel } from '../components/payments/PaymentNetworkLabel';
// screens/ReceiveScreen.tsx
import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  AppState,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { useIsFocused } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { RootState } from '../store';
import { protocolManager, rgbAccountAdapter, rgbAccountIsOnDevice } from '../services/protocols';
import { buildUnifiedReceiveURI } from '@kaleidorg/wallet-engine';
import { selectDisclosureLevel, setLastBtcReceiveRoute } from '../store/slices/settingsSlice';
import { isRgbConnecting, subscribeRgbConnecting } from '../services/protocols/wdk';
import { rgbBackupStatus, onRgbBackupStatus, runRgbBackup } from '../services/protocols/rgbBackup';
import { useRefreshableProtocolStatus } from '../hooks/useProtocol';
import { useAssetInventory } from '../hooks/useAssetInventory';
import { inventoryBtc, inventoryTokens } from '../utils/asset-inventory';
import type { AccountId } from '../utils/account-routing';
import { useAppTheme } from '../theme/ThemeProvider';
import { createReceiveStyles } from './receive/styles';
import { ReceiveQr } from '../components/receive/ReceiveQr';
import { ReceiveStatus, type ReceiveStatusValue } from '../components/receive/ReceiveStatus';
import { ReceiveRequestActions } from '../components/receive/ReceiveRequestActions';
import { ReceiveRoutePicker } from '../components/receive/ReceiveRoutePicker';
import { ScreenHeader } from '../components/ScreenHeader';
import { AmountText } from '../components/AmountText';
import { requestKind } from '../components/receive/ReceiveRequestDetails';
import DepositSuccessOverlay from '../components/DepositSuccessOverlay';
import {
  useDepositDetection,
  type DepositDetectionEvent,
  type DepositLayer,
} from '../hooks/useDepositDetection';
import { useSparkAutoClaim } from '../hooks/useSparkAutoClaim';
import { AssetIcon } from '../components/AssetIcon';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { RgbIcon } from '../components/ProtocolIcons';
import { NetworkStack } from '../components/NetworkStack';
import { AmountEditorModal } from '../components/AmountEditorModal';
import { RgbAssetSheet, type RgbAssetChoice } from '../components/receive/RgbAssetSheet';
import { RgbInvoiceOptions, type RgbUtxoState } from '../components/receive/RgbInvoiceOptions';
import { RgbUtxoSheet } from '../components/rgb/RgbUtxoSheet';
import { refreshRgbAssets } from '../store/slices/assetsSlice';
import { rgbInvoiceWatch, rgbWalletSupport } from '../utils/rgb-wallet';
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
  accountsOnChain, chainLabel, defaultDestination, destinationsFor, initialReceiveRoute, legacyRoute, lightningDestinations,
  methodsFor, rgbAccountLabel, rgbCanReceiveOnchain, accountLabel, routeOf, universalChains, universalLightning,
  methodIcons, receiveAccountIcon, receiveAssetFamily, receiveAssetLabel, receiveSummary,
  type LegacyNetwork, type ReceiveAccountInfo, type ReceiveAsset, type ReceiveCaps, type ReceiveChain, type ReceiveMethodId, type ReceiveParams,
} from '../utils/receive-routes';
import { MyAddressPanel } from '../components/receive/MyAddressPanel';
import { Sheet } from '../components/Sheet';
import { SegmentedControl } from '../components/SegmentedControl';
import { arkadeReceiveOptions, receiveAccountChain } from '../services/kaleidoPay/connect';
import { rgbLibModule } from '../services/protocols/rgbL1';
import { claimArkadeLightningReceive, createArkadeLightningReceive, type ArkadeLightningReceive } from '../services/kaleidoPay/arkadeIntents';
import { BarkBoardingPanel } from '../components/receive/BarkBoardingPanel';
import NostrContactsSelector from '../components/NostrContactsSelector';
import { contactKeyFor, recordContactEvent } from '../services/contactHistory';
import {
  ANY_RGB_ASSET_ID, DEFAULT_RGB_RECEIVE_OPTIONS, NO_RGB_RECEIVE_SUPPORT, RGB_COLLECTIBLE_RECEIVE_AMOUNT_ERROR,
  listRgbUtxos, rgbInvoiceParams, rgbReceiveErrorMessage, rgbReceiveSupport, rgbReceiveUsesProxyV1,
  type RgbReceiveOptions,
} from '../utils/rgb-receive';
import { parseRgbReceiveAmount } from '../utils/rgb-amount';
import { useFeature } from '../hooks/useFeature';

const NEW_RGB_ASSET_ID = ANY_RGB_ASSET_ID;
const nativeRgbSupportsBfa = () => rgbLibModule().supportsBfa?.() === true;
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
  route?: { params?: ReceiveParams };
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
  protocol?: DepositDetectionEvent['protocol'];
  assetId?: string;
  amount?: number;
  amountSource?: DepositDetectionEvent['amountSource'];
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
      return 'Ark';
    case 'bark':
      return 'Bark';
    default:
      return 'all layers';
  }
}

export default function ReceiveScreen(props: Props) {
  const params = props.route?.params;
  const asset = params?.selectedAsset;
  // If navigation reuses Receive for a new request, discard the previous code and its work together.
  const requestKey = JSON.stringify([
    asset?.asset_id, asset && receiveAssetFamily(asset),
    params?.prefilledAmountSat, params?.prefilledNetwork, params?.prefilledAssetTicker,
  ]);
  return <ReceiveRequestScreen key={requestKey} {...props} />;
}

function ReceiveRequestScreen({ navigation, route: navRoute }: Props) {
  const merchantOfferOn = useFeature('merchantOffer');
  const dispatch = useAppDispatch();
  const theme = useAppTheme();
  const styles = useMemo(() => createReceiveStyles(theme), [theme]);
  // The shared asset inventory (bitcoin plus every account's assets). It is
  // memoized on the wallet's bitcoin balance and the asset list only, so price
  // ticks or history updates don't re-render this screen.
  const inventory = useAssetInventory();
  // The receive/deposit flow always denominates BTC in sats (matches rate-extension):
  // integer-sats input, sats quick-amounts, and a correct ≈USD conversion. The global
  // BTC/sats display preference intentionally does NOT apply on this screen — otherwise
  // the amount field would show BTC and the USD estimate (which expects sats) would be
  // off by 1e8.
  const bitcoinUnit = 'sats' as const;

  const { width: screenWidth, height: screenHeight } = useWindowDimensions();

  const assets = useMemo(() => inventoryTokens(inventory), [inventory]);
  const rgbAssets = useMemo(() => assets.filter(asset => asset.protocol === 'RGB'), [assets]);
  // Bitcoin as the asset pickers list it.
  const btcAsset = (): ReceiveAsset => {
    const btc = inventoryBtc(inventory);
    return { asset_id: btc.asset_id, ticker: btc.ticker, name: btc.name, protocol: 'BTC' };
  };
  

  
  // Must call hooks first before any other code
  const rgbConnecting = React.useSyncExternalStore(subscribeRgbConnecting, isRgbConnecting);
  const backup = React.useSyncExternalStore(onRgbBackupStatus, rgbBackupStatus);
  const getProtocolStatus = useRefreshableProtocolStatus();

  const passedAsset = navRoute?.params?.selectedAsset;
  const startRoute = initialReceiveRoute(passedAsset);
  const [selectedAsset, setSelectedAsset] = useState<ReceiveAsset>(() => passedAsset ?? btcAsset());
  const [awaitingPrefilledAsset, setAwaitingPrefilledAsset] = useState(() => !passedAsset && !!navRoute?.params?.prefilledAssetTicker);
  const appliedPrefill = useRef(false);

  // Default to the single "All networks" QR; specific networks are opt-in.
  const [networkType, setNetworkType] = useState<LegacyNetwork>(startRoute.networkType);
  const [address, setAddress] = useState('');
  // Unified receive (single BIP21 QR embedding all available methods)
  const [unifiedUri, setUnifiedUri] = useState('');
  const [unifiedLoading, setUnifiedLoading] = useState(false);
  const [unifiedError, setUnifiedError] = useState<string | null>(null);
  // The methods on screen, including any invoice shown separately from the universal code.
  const [receiveMethods, setReceiveMethods] = useState<ReceiveMethod[]>([]);
  const receiveNetworks = receiveMethods.map(method => receiveAccountChain(method.protocol));
  const unifiedReceiveNetwork = receiveNetworks.length > 0 && receiveNetworks.every(n => n && n === receiveNetworks[0]) ? receiveNetworks[0] : undefined;
  // Universal code: the network it is for (null = the one most accounts are on) and
  // where its Lightning leg lands (null = automatic).
  const [universalChain, setUniversalChain] = useState<ReceiveChain | null>(null);
  const [universalLn, setUniversalLn] = useState<AccountId | null>(null);
  // A Lightning receive into Arkade through a swap provider, while it is on screen.
  const [arkadeReceive, setArkadeReceive] = useState<ArkadeLightningReceive | null>(null);
  // Lite mode: a single private BIP321 QR (BTC/$ toggle) with the advanced
  // network picker hidden behind "Show all networks".
  const disclosureLevel = useAppSelector(selectDisclosureLevel);
  const nwcWalletType = useAppSelector((state: RootState) => state.nostr?.nwcWalletType);
  const nwcCapabilities = useAppSelector((state: RootState) => state.nostr?.nwcCapabilities ?? []);
  // The reusable QR is issued by a connected receiving node; without one it can't work.
  const hasReceivingNode = useAppSelector((state: RootState) => (state.nostr?.nwcConnections?.length ?? 0) > 0);
  const lastBtcReceiveRoute = useAppSelector((state: RootState) => state.settings.lastBtcReceiveRoute);
  const walletId = useAppSelector((state: RootState) => state.wallet?.activeWallet?.id);
  const isLite = disclosureLevel === 'lite';
  // The account the payment lands in, for methods more than one account can receive.
  const [selectedAccount, setSelectedAccount] = useState<AccountId | null>(startRoute.selectedAccount);
  const restoredBtcRoute = useRef(false);
  // Receive by method (how it arrives, then where it lands) or by account (the reverse).
  // Request (a one-off code) or My address (the reusable ones).
  const [receiveTab, setReceiveTab] = useState<'request' | 'address'>('request');
  const [showOptions, setShowOptions] = useState(false);
  // What the request is for: the Lightning invoice description.
  const [note, setNote] = useState('');
  // Who the request is for (optional): it goes into that contact's history.
  const [requestContact, setRequestContact] = useState<{ name: string; key: string } | null>(null);
  const [showContactPicker, setShowContactPicker] = useState(false);
  const requestEventId = useRef<string | null>(null);
  const requestScrollView = useRef<ScrollView>(null);
  const [amount, setAmount] = useState('');
  const [expirySeconds, setExpirySeconds] = useState(3600);
  const [showCountdown, setShowCountdown] = useState(false);

  const [loading, setLoading] = useState(false);
  const [showRgbAssets, setShowRgbAssets] = useState(false);
  const [rgbOptions, setRgbOptions] = useState<RgbReceiveOptions>(DEFAULT_RGB_RECEIVE_OPTIONS);
  const [rgbAmountDraft, setRgbAmountDraft] = useState<{ text: string; precision: number } | null>(null);
  const [rgbInvoiceEditing, setRgbInvoiceEditing] = useState(false);
  const [rgbUtxos, setRgbUtxos] = useState<RgbUtxoState | null>(null);
  const [showCreateUtxos, setShowCreateUtxos] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [channelsLoading, setChannelsLoading] = useState(false);
  const [channelsLoaded, setChannelsLoaded] = useState(false);
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
  const separateArkadeInvoice = networkType === 'unified' && needsSeparateLightningInvoice(arkadeReceive) ? arkadeReceive : null;
  const receiveTarget = unifiedUri || address || separateArkadeInvoice?.invoice;
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
    // An incoming RGB transfer shows as incoming in the asset's balance.
    if (event.layer === 'rgb' && event.status === 'pending') void dispatch(refreshRgbAssets());
    setDepositMonitor({
      ...event,
      status: event.status,
      layer: event.layer,
      message: event.message,
      updatedAt: Date.now(),
    });
  }, [dispatch]);
  const handleDepositDetected = React.useCallback((event?: DepositDetectionEvent) => {
    feedback.receive();
    if (event?.layer === 'rgb') void dispatch(refreshRgbAssets());
    setDepositMonitor({
      ...event,
      status: event?.status === 'claimed' ? 'claimed' : 'confirmed',
      layer: event?.layer ?? 'all',
      message: event?.message,
      updatedAt: Date.now(),
    });
    setShowDepositSuccess(true);
  }, [dispatch]);
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
    const stop = () => { cancelled = true; clearInterval(timer); };
    const tick = async () => {
      if (running) return;
      running = true;
      try {
        const phase = await claimArkadeLightningReceive(options.wallet, options.arkServerUrl, arkadeReceive.rfqId);
        if (cancelled) return;
        if (phase === 'settled') {
          stop();
          handleDepositDetected({
            layer: 'lightning', status: 'confirmed', protocol: 'ARKADE', assetId: 'BTC',
            amount: arkadeReceive.amountSats, amountSource: 'payment',
          });
        } else if (phase === 'funded') {
          handleDepositStatus({ layer: 'lightning', status: 'pending', protocol: 'ARKADE', message: 'Payment received by the swap provider · claiming into Arkade' });
        } else if (phase === 'cancelled' || phase === 'refunded' || phase === 'failed') {
          // Terminal: nothing left to claim.
          stop();
          handleDepositStatus({ layer: 'lightning', status: 'failed', protocol: 'ARKADE', message: 'The swap did not complete. No funds left your wallet.' });
        }
      } catch { /* the next pass retries */ } finally { running = false; }
    };
    const timer = setInterval(() => { void tick(); }, 5_000);
    void tick();
    return stop;
  }, [arkadeReceive, isFocused, isAppActive, showDepositSuccess, handleDepositDetected, handleDepositStatus]);
  const fiatRates = useFiatRates();


  // ── Route model: how the payment arrives (method) and which account it lands in ──
  const requestedSats = receiveAmountSats(amount, bitcoinUnit);
  const caps: ReceiveCaps = {
    nwcWalletType,
    nwcCapabilities,
    rgbChannels: !channelsLoaded ? 'unknown' : channels.some((c) => c.is_usable) ? 'some' : 'none',
    rgbOnDevice: rgbAccountIsOnDevice(),
  };
  const rgbLabel = rgbAccountLabel(caps);
  const connectedNow = getProtocolStatus();
  // Bark is an Advanced account: Lite never offers it as a place to receive.
  const receiveAccounts: ReceiveAccountInfo[] = (['RGB', 'SPARK', 'ARKADE', 'BARK'] as AccountId[])
    .filter((account) => connectedNow[account] && (account !== 'BARK' || !isLite))
    .map((account) => ({ account, chain: receiveAccountChain(account) }));
  const assetFamily = receiveAssetFamily(selectedAsset);
  // On shorter phones, leave room for RGB amount and sharing around the code.
  const qrLimit = assetFamily === 'RGB' ? Math.min(248, screenHeight * 0.36) : 248;
  const qrSize = Math.max(96, Math.round(Math.min(qrLimit, screenWidth - 104)));
  // A request for any asset has no contract on the node's Lightning channel.
  const heldRgbAsset = assetFamily === 'RGB' ? rgbAssets.find((a) => a.asset_id === selectedAsset.asset_id) : undefined;
  const receiveMethodIds: ReceiveMethodId[] = methodsFor(assetFamily, receiveAccounts, caps)
    .filter((m) => assetFamily !== 'RGB' || heldRgbAsset || m === 'onchain');
  const route = routeOf({ networkType, arkadeSubMode, selectedAccount });
  const destinationsOf = (method: ReceiveMethodId) => destinationsFor(method, receiveAccounts, caps, assetFamily);
  const routeDestinations = destinationsOf(route.method);
  // A remembered account that can't take this asset (Arkade for an RGB asset) never names the route.
  const routeDestination = route.account && routeDestinations.some((d) => d.account === route.account)
    ? route.account
    : defaultDestination(routeDestinations, null, requestedSats);
  const routeTarget = routeDestinations.find((d) => d.account === routeDestination);
  const rgbAdapterNow = rgbAccountAdapter();
  const rgbConnected = !!rgbAdapterNow?.isConnected();
  const rgbSupport = rgbReceiveSupport(rgbConnected ? rgbAdapterNow : null);
  const rgbOnchain = assetFamily === 'RGB' && networkType === 'onchain';
  const rgbProxyV1 = rgbOnchain && rgbConnected && rgbReceiveUsesProxyV1(rgbAdapterNow, nativeRgbSupportsBfa);
  const assetRouteAvailable = !awaitingPrefilledAsset &&
    (assetFamily === 'BTC' || receiveMethodIds.includes(route.method));
  const showRgbInvoiceOptions = assetRouteAvailable && assetFamily === 'RGB';
  const canChooseRgb = rgbConnected && rgbCanReceiveOnchain(caps);
  const rgbAmount = rgbAmountDraft?.text ?? '';
  // Keep units stable while a holding refreshes in the background.
  const rgbPrecision = rgbAmountDraft?.precision ?? heldRgbAsset?.precision;
  const parsedRgbAmount = rgbPrecision === undefined ? { kind: 'open' } as const : parseRgbReceiveAmount(rgbAmount, rgbPrecision);
  const rgbAmountError = parsedRgbAmount.kind === 'invalid' ? parsedRgbAmount.message
    : error === RGB_COLLECTIBLE_RECEIVE_AMOUNT_ERROR ? error : undefined;
  const rgbAmountUnits = parsedRgbAmount.kind === 'fixed' ? parsedRgbAmount.amount : undefined;
  const requestedRgbAmount = rgbAmountUnits === undefined ? undefined : `${rgbAmount.trim()} ${selectedAsset.ticker || selectedAsset.name}`;
  const showRgbDraft = showRgbInvoiceOptions && (rgbInvoiceEditing || !!rgbAmountError);
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

  const universalNotes = [
    ...receiveAccounts
      .filter((a) => activeChain && a.chain !== activeChain)
      .map((a) => `${accountLabel(a.account, caps)} isn't included: it's on ${chainLabel(a.chain)}.`),
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
    const next = legacyRoute(method, dest);
    if (next.networkType === networkType && next.arkadeSubMode === arkadeSubMode && next.selectedAccount === selectedAccount) return;
    resetReceiveSurface();
    setNetworkType(next.networkType);
    setArkadeSubMode(next.arkadeSubMode);
    setSelectedAccount(next.selectedAccount);
    if (assetFamily === 'BTC' && next.arkadeSubMode === 'ark') {
      dispatch(setLastBtcReceiveRoute({
        axis: 'method',
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
      || assetFamily !== 'BTC'
      || awaitingPrefilledAsset
      || !lastBtcReceiveRoute
    ) return;
    const saved = routeOf({ networkType: lastBtcReceiveRoute.network, arkadeSubMode: 'ark', selectedAccount: lastBtcReceiveRoute.account });
    if (saved.method !== 'universal' && !receiveMethodIds.includes(saved.method)) return;
    restoredBtcRoute.current = true;
    setSelectedAccount(lastBtcReceiveRoute.account);
    setNetworkType(lastBtcReceiveRoute.network);
  }, [receiveMethodIds, isLite, lastBtcReceiveRoute, assetFamily, awaitingPrefilledAsset]);
  
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
      return { invoice: receive.invoice, protocol: 'ARKADE', monitor: 'none', arkade: receive };
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
      if (!rgb?.isConnected()) throw new Error('Your RGB Lightning node isn’t connected');
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
    if (!assetRouteAvailable || rgbAmountError || rgbInvoiceEditing) return;

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

    setLoading(true);
    try {
      let result: any = null;
      let methodMeta: Omit<ReceiveMethod, 'value'> | null = null;

      // ── Spark network ──
      if (networkType === 'spark') {
        try {
          const sparkAdapter = protocolManager.getAdapterIfAvailable('SPARK');
          if (!sparkAdapter?.isConnected()) throw new Error('Connect your Spark account to receive on Spark.');
          if (assetFamily === 'BTC' && requestedSats > 0) {
            // Amount-bound native Spark invoice (sats).
            const invoice = await runReceiveOperation('Create Spark invoice', () =>
              sparkAdapter.createInvoice({
                amount: requestedSats,
                description: note || `Receive ${requestedSats} ${bitcoinUnit}`,
                expirySeconds,
              }));
            result = invoice.invoice;
            methodMeta = {
              key: 'spark-invoice',
              label: 'Spark invoice',
              protocol: 'SPARK',
              kind: 'invoice',
              layer: 'spark',
              monitor: 'balance',
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
              assetId: selectedAsset.asset_id === 'BTC' ? 'SPARK_ALL' : selectedAsset.asset_id,
            };
          }
        } catch (err: any) {
          throw new Error(`Spark: ${err.message || 'Failed to generate address'}`, { cause: err });
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
          throw new Error(`Arkade: ${err.message || 'Failed to generate address'}`, { cause: err });
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
              monitor: 'balance',
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
          throw new Error(`Bark: ${err.message || 'Failed to generate address'}`, { cause: err });
        }
      }
      // ── RGB / Legacy: on-chain + lightning ──
      else if (selectedAsset.asset_id === 'BTC') {
        if (networkType === 'onchain') {
          // Honour the account picked in "By account" mode. In method mode the
          // existing RGB → Spark priority remains the default.
          const rgbAdapter = rgbAccountAdapter();
          const sparkAdapter = protocolManager.getAdapterIfAvailable('SPARK');
          const preferSpark = routeDestination === 'SPARK';
          if (!preferSpark && rgbAdapter?.isConnected() && rgbCanReceiveOnchain(caps)) {
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
          const created = await createLightningInvoice(account, requestedSats, note || 'Receive Bitcoin');
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
          const rgbAssetAdapter = rgbAccountAdapter();
          if (!rgbAssetAdapter?.isConnected() || !rgbAssetAdapter.createRgbInvoice) {
            throw new Error('Turn on RGB in Settings, or connect your RGB node, to receive RGB assets.');
          }
          // No asset id (RGB_NEW) receives any RGB asset, including one not held yet.
          const params = rgbInvoiceParams({
            assetId: selectedAsset.asset_id,
            expirySeconds,
            options: rgbOptions,
            amount: rgbAmountUnits,
            support: rgbReceiveSupport(rgbAssetAdapter),
            proxyV1: rgbReceiveUsesProxyV1(rgbAssetAdapter, nativeRgbSupportsBfa),
          });
          const issuedAt = Date.now();
          const rgbInvoice = await runReceiveOperation('Create RGB asset invoice', (signal) =>
            callAbortableAdapterMethod<any>(rgbAssetAdapter, 'createRgbInvoice', [params], signal));
          result = rgbInvoice?.invoice ?? rgbInvoice?.recipient_id;
          const expiration = Number(rgbInvoice?.expiration_timestamp ?? rgbInvoice?.expirationTimestamp);
          // Watch the invoice's own transfer where the account lists transfers; else its balance.
          const watch = rgbInvoiceWatch(rgbInvoice, rgbWalletSupport(rgbAssetAdapter), selectedAsset.asset_id === NEW_RGB_ASSET_ID ? 'none' : 'balance');
          methodMeta = {
            key: 'rgb-onchain',
            label: 'RGB invoice',
            protocol: 'RGB',
            kind: 'invoice',
            layer: 'rgb',
            assetId: selectedAsset.asset_id,
            expiresAt: Number.isSafeInteger(expiration) && expiration > 0
              ? expiration * 1000
              : issuedAt + Number(params.duration_seconds) * 1000,
            ...watch,
          };
        } else {
          const rgbAssetLnAdapter = protocolManager.getAdapterIfAvailable('RGB_LN');
          if (!rgbAssetLnAdapter?.isConnected()) {
            throw new Error('Connect your RGB Lightning node in Settings to receive RGB assets.');
          }
          const assetInvoice = await runReceiveOperation('Create RGB Lightning asset invoice', (signal) =>
            callAbortableAdapterMethod<any>(
              rgbAssetLnAdapter,
              'createInvoice',
              [{
                asset: selectedAsset.asset_id,
                ...(rgbAmountUnits === undefined ? {} : { assetAmount: rgbAmountUnits }),
                description: note || `Receive ${selectedAsset.ticker}`,
                expirySeconds: rgbOptions.durationSeconds ?? expirySeconds,
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

      // Any address or invoice is longer than this; a shorter value is a failed call.
      const trimmed = typeof result === 'string' ? result.trim() : '';
      const validatedResult = trimmed.length >= 10 ? trimmed : null;
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
      setError(rgbReceiveErrorMessage(errorMessage, { advanced: rgbOnchain && rgbSupport.invoiceKind, onDevice: rgbAccountIsOnDevice() }));
      setAddress('');
    } finally {
      if (isCurrentGeneration()) setLoading(false);
    }
  };

  // ──────────────────────────────────────────────────────────────────────
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
    if (!assetRouteAvailable || assetFamily !== 'BTC') return;
    const startedAt = nowMs();
    const generationId = unifiedGenerationRef.current + 1;
    unifiedGenerationRef.current = generationId;
    const isCurrentGeneration = () => unifiedGenerationRef.current === generationId;
    receiveLog('unified.start', {
      generationId,
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

    // One code carries one network: only accounts on the chosen chain take part
    // (a test setup can have Spark on regtest and Arkade on mutinynet).
    const on = (account: AccountId) => universalAccounts.some((a) => a.account === account);
    const rgb = on('RGB') ? rgbAccountAdapter() : undefined;
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
          if (rgb?.isConnected() && rgbCanReceiveOnchain(caps) && (reason === 'manual' || (!spark?.isConnected() && !arkade?.isConnected()))) {
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
              const created = await createLightningInvoice(universalLnAccount, amountSats, note || 'Receive Bitcoin');
              if (created.invoice) {
                if (!needsSeparateLightningInvoice(created.arkade ?? null)) {
                  collected.lightningInvoice = created.invoice;
                }
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

    if (methods.length === 0 && !needsSeparateLightningInvoice(nextArkadeReceive)) {
      receiveLog('unified.empty', {
        generationId,
        ms: Math.round(nowMs() - startedAt),
      });
      setUnifiedError(
        rgb?.isConnected() && reason !== 'manual'
          ? 'RGB receive is ready. Tap Try Again to show it.'
          : 'None of your accounts could create a payment code. Check that they are connected, then try again.',
      );
      setUnifiedLoading(false);
      return;
    }

    try {
      const uri = methods.length ? buildCurrentUnifiedUri() : '';

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
    networkType === 'unified' && assetRouteAvailable && assetFamily === 'BTC' ? JSON.stringify([amount, expirySeconds, activeChain, universalLnAccount, note]) : null,
    () => setUnifiedLoading(true),
    () => { void generateUnifiedUri({ includeLightning: true, reason: 'auto' }); },
    () => { unifiedGenerationRef.current += 1; },
    isFocused && isAppActive && !unifiedUri && !separateArkadeInvoice,
  );

  // A single request identity prevents overlapping amount/network regeneration.
  const cancelScheduledAddress = useReceiveGeneration(
    networkType !== 'unified' && assetRouteAvailable && !awaitingAmount && !rgbAmountError && !rgbInvoiceEditing
      ? JSON.stringify([selectedAsset.asset_id, networkType, arkadeSubMode, routeDestination, amount, expirySeconds, note, showRgbInvoiceOptions ? [rgbOptions, rgbAmountUnits] : null])
      : null,
    () => { setAddress(''); setError(null); setLoading(true); },
    () => { void generateAddress(); },
    () => { addressGenerationRef.current += 1; },
    isFocused && isAppActive && !address,
  );

  // ── Amount <-> sats bridging for the multi-currency editor ────────────────
  const SATS_PER_BTC = 1e8;
  const currentAmountSats = receiveAmountSats(amount, bitcoinUnit);
  useEffect(() => {
    if (!requestContact || walletId == null) return;
    const id = requestEventId.current ?? `req-${Date.now()}`;
    requestEventId.current = id;
    void recordContactEvent(walletId, {
      id, contactKey: requestContact.key, contactName: requestContact.name, direction: 'requested',
      amount: currentAmountSats > 0 ? `${currentAmountSats.toLocaleString('en-US')} sats` : '', note: note || undefined,
      status: 'open', createdAt: Date.now(),
    }).catch(() => {});
  }, [requestContact, currentAmountSats, note, walletId]);


  const applyAmountSats = (sats: number) => {
    const next = !sats || sats <= 0 ? '' : String(Math.round(sats));
    if (next === amount) return;
    // Hide/cancel the old request before the debounced replacement starts.
    resetReceiveSurface();
    setAmount(next);
  };

  // Human label for the current requested amount (BTC view + ≈USD).
  const isGeneratingReceive =
    (networkType === 'unified' && unifiedLoading && !receiveTarget) ||
    (networkType !== 'unified' && loading && !address);
  const deadlines = useMemo(() => receiveMethods
    .filter(method => method.value !== separateArkadeInvoice?.invoice)
    .map(method => method.expiresAt ?? invoiceExpiry(method.value)).filter((deadline): deadline is number => deadline !== null),
  [receiveMethods, separateArkadeInvoice]);
  // The maker's offer can close before the BOLT11 stops being payable. Keep polling old
  // payments until they resolve, while showing new payers only an active maker request.
  const separateExpiry = separateArkadeInvoice ? separateArkadeInvoice.expiresAt * 1000 : null;
  const requestNow = useForegroundClock(isFocused && (deadlines.length > 0 || separateExpiry !== null));
  const separateExpired = separateExpiry !== null && separateExpiry <= requestNow;
  const arkadeInvoiceFailed = !!separateArkadeInvoice &&
    depositMonitor.layer === 'lightning' && depositMonitor.protocol === 'ARKADE' && depositMonitor.status === 'failed';
  const separateFailed = !!unifiedUri && arkadeInvoiceFailed;
  const presentationStatus = separateFailed ? 'idle' : depositMonitor.status;
  const requestPresentation = receivePresentation(presentationStatus,
    deadlines.some(deadline => deadline <= requestNow) || (!unifiedUri && separateExpired));
  const showOutcome = ['expired', 'pending', 'confirmed', 'claimed', 'failed'].includes(requestPresentation);
  const refreshRequest = () => {
    if (arkadeInvoiceFailed) {
      setArkadeReceive(null);
      setReceiveMethods(methods => methods.filter(method => method.value !== separateArkadeInvoice?.invoice));
    }
    setDepositMonitor({ status: 'idle' });
    if (networkType === 'unified') void generateUnifiedUri({ includeLightning: true, preserveExisting: true, reason: 'manual' });
    else void generateAddress();
  };
  const monitorStatus: DepositMonitorStatus =
    isGeneratingReceive ? 'generating' : presentationStatus === 'idle' ? 'watching' : presentationStatus;
  const monitorVisible =
    isGeneratingReceive ||
    (!!receiveTarget && !showDepositSuccess) ||
    ['pending', 'claimed', 'failed', 'expired'].includes(depositMonitor.status);

  const selectReceiveAsset = (asset: ReceiveAsset) => {
    appliedPrefill.current = true;
    setAwaitingPrefilledAsset(false);
    cancelScheduledAddress.current();
    resetReceiveSurface();
    setRgbAmountDraft(null);
    setRgbInvoiceEditing(false);
    setRgbOptions(DEFAULT_RGB_RECEIVE_OPTIONS);
    setSelectedAsset(asset);
    const next = initialReceiveRoute(asset);
    setSelectedAccount(next.selectedAccount);
    setArkadeSubMode(next.arkadeSubMode);
    setNetworkType(next.networkType);
    if (asset.asset_id !== 'BTC') setAmount('');
  };

  // An RGB asset is received on-chain into the RGB account.
  const receiveRgbAsset = (asset: RgbAssetChoice | null) => {
    if (assetFamily === 'RGB' && networkType === 'onchain' && selectedAsset.asset_id === (asset?.asset_id ?? NEW_RGB_ASSET_ID)) return;
    selectReceiveAsset(asset
      ? { ...asset, protocol: 'RGB' }
      : { asset_id: NEW_RGB_ASSET_ID, ticker: 'RGB', name: 'Any RGB asset', protocol: 'RGB' });
  };

  // Prefilled from KaleidoMind once: the asset, network (Advanced only) and amount asked for.
  useEffect(() => {
    const p = navRoute?.params;
    if (appliedPrefill.current || !p || (!p.prefilledAmountSat && !p.prefilledNetwork && !p.prefilledAssetTicker)) return;
    if (p.selectedAsset && p.selectedAsset.asset_id !== 'BTC') {
      appliedPrefill.current = true;
      return;
    }
    if (!p.selectedAsset && p.prefilledAssetTicker) {
      const candidates = assets.filter(asset => asset.ticker.toUpperCase() === p.prefilledAssetTicker!.toUpperCase());
      if (candidates.length === 1) selectReceiveAsset(candidates[0]);
      return;
    }
    appliedPrefill.current = true;
    if (p.prefilledNetwork && !isLite) {
      restoredBtcRoute.current = true;
      setNetworkType(p.prefilledNetwork);
    }
    if (Number.isSafeInteger(p.prefilledAmountSat) && p.prefilledAmountSat! > 0) setAmount(String(p.prefilledAmountSat));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navRoute?.params, assets]);

  const loadRgbUtxos = async () => {
    const adapter = rgbAccountAdapter();
    if (!adapter?.isConnected()) return;
    setRgbUtxos({ loading: true });
    try {
      const list = await runTimedReceiveOperation('List RGB UTXOs', () => listRgbUtxos(adapter), 15_000);
      setRgbUtxos({ loading: false, list });
    } catch {
      setRgbUtxos({ loading: false, error: 'Couldn’t load your receive slots. Try again.' });
    }
  };

  const startRgbInvoiceEdit = () => {
    if (rgbInvoiceEditing) return;
    cancelScheduledAddress.current();
    resetReceiveSurface();
    setRgbInvoiceEditing(true);
  };

  const changeRgbOptions = (next: RgbReceiveOptions) => {
    if (next.kind === rgbOptions.kind && next.durationSeconds === rgbOptions.durationSeconds && next.minConfirmations === rgbOptions.minConfirmations) return;
    startRgbInvoiceEdit();
    setRgbOptions(next);
  };

  const changeRgbAmount = (next: string) => {
    if (next === rgbAmount || rgbPrecision === undefined) return;
    startRgbInvoiceEdit();
    setRgbAmountDraft({ text: next, precision: rgbPrecision });
  };

  const updateRgbInvoice = () => {
    if (rgbAmountError) return;
    Keyboard.dismiss();
    setRgbInvoiceEditing(false);
    requestScrollView.current?.scrollTo({ y: 0, animated: true });
  };

  // iOS presents one modal at a time: close the options sheet before opening another.
  const afterOptions = (open: () => void) => {
    if (!showOptions) { open(); return; }
    setShowOptions(false);
    setTimeout(open, 350);
  };

  const lightningAddressAvailable = receiveAccounts.some((a) => a.account === 'SPARK' && a.chain === 'mainnet');
  const showAddressTab = assetFamily === 'BTC' && !awaitingPrefilledAsset && (lightningAddressAvailable || hasReceivingNode);
  const assetIconProtocol = assetFamily === 'BTC' ? undefined : assetFamily;

  // The RGB asset picker and the route picker are separate controls.
  const renderOptionsPill = () => {
    const asset = receiveAssetLabel(selectedAsset);
    const { text: summary, icons } = receiveSummary({
      method: route.method,
      account: networkType === 'unified' ? universalLnAccount : routeDestination,
      caps,
      included: networkType === 'unified' ? universalAccounts.map((a) => a.account) : [],
    });
    return (
      <TouchableOpacity
        accessibilityRole="button" accessibilityLabel={assetFamily === 'RGB' ? `${summary}. Change receive network` : `${asset}, ${summary}. Change receive options`}
        onPress={() => { feedback.select(); setShowOptions(true); }} activeOpacity={0.7} style={styles.optionsPill}
      >
        {assetFamily !== 'RGB' && <>
          <AssetIcon ticker={selectedAsset.ticker} protocol={assetIconProtocol} size={16} showBadge={false} />
          <Text style={styles.optionsPillAsset} numberOfLines={1}>{asset}</Text>
          {!!summary && <Text style={styles.optionsPillSummary}>·</Text>}
        </>}
        {icons.length > 0 && <NetworkStack networks={icons} size={16} />}
        {!!summary && <Text style={styles.optionsPillSummary} numberOfLines={1}>{summary}</Text>}
        <Ionicons name="chevron-down" size={14} color={theme.colors.text.secondary} />
      </TouchableOpacity>
    );
  };

  const renderAssetTabs = () => {
    const accent = theme.colors.primary[500];
    const isBtc = assetFamily === 'BTC' && !awaitingPrefilledAsset;
    const isRgb = assetFamily === 'RGB';
    const isAnyRgb = selectedAsset.asset_id === NEW_RGB_ASSET_ID;
    const rgbChoiceLabel = isRgb ? receiveAssetLabel(selectedAsset) : 'RGB asset';
    const selectedStyle = { borderColor: accent, backgroundColor: accent + '15' };
    const selectBtc = () => {
      feedback.select();
      if (isBtc && networkType === 'unified') return;
      selectReceiveAsset(btcAsset());
    };
    return (
      <View style={styles.assetTabs}>
        <TouchableOpacity accessibilityRole="tab" accessibilityState={{ selected: isBtc }} accessibilityLabel="Receive BTC"
          style={[styles.assetTab, isRgb && styles.btcAlternativeTab, isBtc && selectedStyle]} onPress={selectBtc} activeOpacity={0.7}>
          <AssetIcon ticker="BTC" size={20} showBadge={false} />
          <Text style={[styles.assetTabText, isBtc && { color: accent }]}>BTC</Text>
        </TouchableOpacity>
        {(canChooseRgb || isRgb) && <TouchableOpacity accessibilityRole="button" accessibilityState={{ expanded: showRgbAssets }}
          accessibilityLabel={isRgb ? `Change RGB asset, ${rgbChoiceLabel}` : 'Choose an RGB asset'}
          onPress={() => { feedback.select(); setShowRgbAssets(true); }} activeOpacity={0.7}
          style={[styles.assetTab, isRgb && selectedStyle]}>
          {isRgb && !isAnyRgb
            ? <AssetIcon ticker={selectedAsset.ticker} logoUri={heldRgbAsset?.icon} protocol="RGB" size={20} showBadge={false} />
            : <RgbIcon size={20} />}
          <Text style={[styles.assetTabText, isRgb && { color: accent }]} numberOfLines={1}>{rgbChoiceLabel}</Text>
          <Ionicons name="chevron-down" size={14} color={theme.colors.text.secondary} />
        </TouchableOpacity>}
        {rgbConnecting && !rgbConnected && !isRgb && <Text accessibilityLiveRegion="polite" style={styles.assetTabText}>RGB · Connecting…</Text>}
        {assetFamily !== 'BTC' && !isRgb && <View style={[styles.assetTab, selectedStyle]}>
          <AssetIcon ticker={selectedAsset.ticker} protocol={assetIconProtocol} size={20} showBadge={false} />
          <Text style={[styles.assetTabText, { color: accent }]} numberOfLines={1}>{selectedAsset.ticker}</Text>
        </View>}
      </View>
    );
  };

  // ── Amount row with pencil edit (opens the multi-currency editor) ─────────
  const renderAmountRowInner = () => {
    // This editor enters Bitcoin amounts; RGB uses the selected token's precision.
    if (assetFamily !== 'BTC') return null;
    // Arkade and on-chain addresses don't carry an amount; offering one there
    // would suggest the payer is asked for it when they aren't.
    if (networkType === 'arkade' || networkType === 'bark' || networkType === 'onchain') return null;
    const usd = fiatRates['usd'];
    const edit = () => {
      receiveLog('tap.amountRow', { amount, networkType, asset: selectedAsset.ticker });
      setShowAmountEditor(true);
    };
    // With an amount it is the headline under the QR; without, a small "add" pill.
    if (currentAmountSats > 0) {
      const sub = [usd ? `≈ $${((currentAmountSats / SATS_PER_BTC) * usd).toFixed(2)}` : null, note ? `“${note}”` : null].filter(Boolean).join(' · ');
      return (
        <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Edit request, ${currentAmountSats.toLocaleString('en-US')} sats${sub ? `, ${sub}` : ''}`}
          onPress={edit} activeOpacity={0.7} style={{ alignItems: 'center', marginTop: theme.spacing[2], marginBottom: theme.spacing[1] }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: theme.spacing[1.5] }}>
            <AmountText style={styles.amountHeadline}>{currentAmountSats.toLocaleString('en-US')}</AmountText>
            <Text style={styles.amountHeadlineUnit}>sats</Text>
            <Ionicons name="pencil" size={14} color={theme.colors.primary[500]} />
          </View>
          {!!sub && <Text style={styles.amountRowLabel} numberOfLines={1}>{sub}</Text>}
        </TouchableOpacity>
      );
    }
    return (
      <TouchableOpacity
        accessibilityRole="button" accessibilityLabel={note ? `Add requested amount, note ${note}` : 'Add requested amount'}
        style={{
          alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: theme.spacing[2],
          minHeight: 40, paddingHorizontal: theme.spacing[4], marginTop: theme.spacing[3], marginBottom: theme.spacing[1],
          borderRadius: theme.borderRadius.full, borderWidth: 1,
          borderColor: awaitingAmount ? theme.colors.warning[500] : theme.colors.border.light,
          backgroundColor: theme.colors.surface.primary,
        }}
        onPress={edit}
        activeOpacity={0.7}
      >
        <Ionicons name="add-circle-outline" size={18} color={theme.colors.primary[500]} />
        <Text style={[styles.amountRowLabel, { color: theme.colors.text.primary, fontWeight: '600' }]} numberOfLines={1}>
          {awaitingAmount ? 'Add amount · required' : note ? `Add amount · “${note}”` : 'Add amount or note'}
        </Text>
      </TouchableOpacity>
    );
  };

  const renderAmountRow = () => renderAmountRowInner();

  // Clean QR-sized loader (no copy text) — a spinner sitting where the QR will be.
  const renderQrLoading = () => (
    <View style={styles.qrSection}><ReceiveQr value="" size={qrSize} /></View>
  );

  const qrOnScreen = networkType === 'unified'
    ? !!receiveTarget
    : !(awaitingAmount && routeTarget) && !showRgbDraft && !loading && !error && !!address;
  // Arkade and Bark complete a Lightning receive from this device (a swap the
  // app claims), so the payer's money only lands while the app stays open.
  const claimsOnDevice = receiveMethods.some((m) => m.layer === 'lightning' && (m.protocol === 'ARKADE' || m.protocol === 'BARK'));
  const detectedAmount = depositAmountLabel(depositMonitor.amount, depositMonitor.assetId, assets);
  const renderStatus = () => (
    <ReceiveStatus visible={monitorVisible} status={monitorStatus} message={separateFailed ? undefined : depositMonitor.message} amountLabel={detectedAmount} requestOnly={assetFamily === 'RGB'}
      hint={claimsOnDevice ? 'Keep this screen open until it arrives' : undefined} />
  );

  const renderOutcome = () => <ReceiveOutcomeCard status={requestPresentation} onRefresh={refreshRequest}
    detectedAmount={detectedAmount} message={depositMonitor.message}
    requestedAmount={assetFamily === 'BTC' && currentAmountSats > 0 ? `${currentAmountSats.toLocaleString('en-US')} sats` : requestedRgbAmount}
    onActivity={claimsOnDevice && requestPresentation === 'pending' ? undefined : () => navigation.navigate('Dashboard', { screen: 'Activity' })}
    hint={claimsOnDevice ? 'Keep this screen open until the payment arrives.' : undefined} />;

  const shareAsset = assetFamily !== 'BTC'
    ? (requestedRgbAmount ?? (selectedAsset.asset_id === NEW_RGB_ASSET_ID ? 'Any RGB asset' : selectedAsset.ticker))
    : currentAmountSats > 0 ? `${currentAmountSats.toLocaleString()} sats` : 'BTC';

  const renderSeparateArkade = () => {
    if (!separateArkadeInvoice) return null;
    const paid = `${separateArkadeInvoice.payAmountSats.toLocaleString()} sats`;
    const received = `${separateArkadeInvoice.amountSats.toLocaleString()} sats`;
    const canShareInvoice = !separateExpired && !unifiedLoading;
    return (
      <View style={styles.qrSection}>
        <Text style={styles.universalRequestTitle}>Lightning into Arkade</Text>
        <Text style={styles.promptText}>The sender pays {paid}. You receive {received} in Arkade.</Text>
        {separateFailed ? <>
          <Text style={styles.promptText}>This Lightning invoice could not be completed.</Text>
          <TouchableOpacity accessibilityRole="button" onPress={refreshRequest} style={styles.generateButton}>
            <Text style={styles.generateButtonText}>Create a fresh Lightning invoice</Text>
          </TouchableOpacity>
        </> : <>
          {canShareInvoice && <View style={styles.qrContainer}>
            <ReceiveQr value={separateArkadeInvoice.invoice} size={qrSize} label="Arkade Lightning invoice" />
          </View>}
          {!unifiedLoading && <InvoiceExpiry invoice={separateArkadeInvoice.invoice} expiresAt={separateExpiry ?? undefined}
            showCountdown={showCountdown} onRefresh={refreshRequest} />}
          {canShareInvoice && <ReceiveRequestActions value={separateArkadeInvoice.invoice} label="Arkade Lightning invoice"
            summary={`${paid} via Lightning · ${received} received in Arkade`} network={receiveAccountChain('ARKADE')} />}
        </>}
      </View>
    );
  };

  const renderUnifiedBody = () => {
    if (showOutcome && receiveTarget) return unifiedLoading ? renderQrLoading() : renderOutcome();
    const accent = theme.colors.networks.unified;
    // Show the loader until the complete request is ready to be published.
    if (unifiedLoading && !unifiedUri) {
      return renderQrLoading();
    }
    if (separateArkadeInvoice && !unifiedUri) return <>
      {renderSeparateArkade()}
      {renderStatus()}
      {renderAmountRow()}
    </>;

    if (unifiedError && !unifiedUri) {
      return (
        <View style={styles.errorContainer}>
          <Ionicons name="alert-circle" size={48} color={theme.colors.error[500]} />
          <ActionableError message={unifiedError} context="receive" />
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
            {separateArkadeInvoice ? 'Bitcoin request' : 'Scan with any wallet'}{activeChain && activeChain !== 'mainnet' ? ` · ${chainLabel(activeChain)}` : ''}
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
        {renderStatus()}
        {networkType !== 'unified' && routeDestination && (
          <Text style={{ color: theme.colors.text.tertiary, fontSize: theme.typography.fontSize.xs, textAlign: 'center' }}>
            Lands in {accountLabel(routeDestination, caps)}
          </Text>
        )}
        {renderAmountRow()}

        {receiveMethods.filter(a => a.value !== separateArkadeInvoice?.invoice && /^ln(bc|tb|bcrt)/i.test(a.value)).map(a => <InvoiceExpiry showCountdown={showCountdown} key={a.key} invoice={a.value} onRefresh={() => { void generateUnifiedUri({ includeLightning: true, preserveExisting: true, reason: 'manual' }); }} />)}
        <ReceiveRequestActions value={unifiedUri} summary={`${shareAsset} · Bitcoin payment request`} network={unifiedReceiveNetwork} />
        {renderSeparateArkade()}
      </View>
    );
  };

  const renderContent = () => {
    if (awaitingPrefilledAsset) return (
      <View style={styles.promptContainer}>
        <Text style={styles.promptText}>Choose the asset from your portfolio to receive it.</Text>
      </View>
    );
    if (!assetRouteAvailable) return (
      <View style={styles.promptContainer}>
        <Text style={styles.promptText}>{assetFamily === 'RGB'
          ? 'Connect the RGB account to receive this asset.'
          : assetFamily === 'SPARK' ? 'Connect your Spark account to receive this asset.' : 'Receiving this asset is unavailable.'}</Text>
      </View>
    );
    if (networkType === 'unified') {
      return renderUnifiedBody();
    }

    if (showRgbDraft) return (
      <View style={styles.rgbInvoiceDraft}>
        <Ionicons name="create-outline" size={20} color={theme.colors.primary[500]} />
        <Text accessibilityLiveRegion="polite" style={styles.rgbInvoiceDraftText}>
          {rgbAmountError ? 'Enter a valid amount to update the invoice.' : 'Update to create a new invoice.'}
        </Text>
      </View>
    );

    if (showOutcome && address && !loading) return renderOutcome();

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
      return renderQrLoading();
    }

    if (error) {
      return (
        <View style={styles.errorContainer}>
          <Ionicons name="alert-circle" size={48} color={theme.colors.error[500]} />
          <ActionableError message={error} context="receive" />
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
    const title = method ? requestKind(method) : 'Bitcoin address';
    const shareAmount = arkadeReceive && method?.layer === 'lightning'
      ? `${arkadeReceive.payAmountSats.toLocaleString()} sats` : shareAsset;
    const shareRoute = assetFamily === 'SPARK' ? 'Spark' : method?.layer === 'rgb' ? 'RGB on-chain' : title;
    const swapNote = arkadeReceive && method?.protocol === 'ARKADE' && method.layer === 'lightning'
      ? `The sender pays ${arkadeReceive.payAmountSats.toLocaleString()} sats. You receive ${arkadeReceive.amountSats.toLocaleString()} sats in Arkade.`
      : undefined;
    const isRgbRequest = assetFamily === 'RGB';
    const actions = <ReceiveRequestActions value={address} summary={`${shareAmount} · ${shareRoute}`} label={title}
      network={method ? receiveAccountChain(method.protocol) : undefined} showNetworkLabel={!isRgbRequest} />;
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

        <View style={[styles.qrContainer, isRgbRequest && styles.rgbQrContainer]}>
          <ReceiveQr value={address} size={qrSize} label={isRgbRequest ? title : undefined} />
        </View>
        {isRgbRequest && actions}
        {renderStatus()}
        {renderAmountRow()}
        {assetFamily === 'SPARK' && <Text style={styles.promptText}>Ask the sender to select {selectedAsset.ticker} in their Spark wallet.</Text>}
        {!!swapNote && <Text style={styles.promptText}>{swapNote}</Text>}

        <InvoiceExpiry showCountdown={showCountdown} invoice={address} onRefresh={() => { void generateAddress(); }} />
        {!isRgbRequest && actions}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right', 'bottom']}>
      <ScreenHeader
        title="Receive"
        showBack
        onBack={() => {
          cancelReceiveWork();
          navigation.goBack();
        }}
      />

      <KeyboardAvoidingView style={styles.requestBody} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          ref={requestScrollView}
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          <ReceiveConnectionNotice hasRequest={!!receiveTarget} />
          {showAddressTab && (
            <SegmentedControl<'request' | 'address'>
              accessibilityLabel="Receive with a one-time request or your address"
              options={[
                { key: 'request', label: 'Request', icon: 'qr-code-outline' },
                { key: 'address', label: 'My address', icon: 'at-outline' },
              ]}
              value={receiveTab}
              onChange={(tab) => { feedback.select(); setReceiveTab(tab); }}
              style={{ marginBottom: theme.spacing[3] }}
            />
          )}
          {showAddressTab && receiveTab === 'address' ? (
            <MyAddressPanel
              walletId={walletId}
              qrSize={qrSize}
              showLightningAddress={lightningAddressAvailable}
              showOffer={merchantOfferOn && hasReceivingNode}
              onManageAddress={() => { cancelReceiveWork(); navigation.navigate('LightningAddress'); }}
              onOpenOffer={() => { cancelReceiveWork(); navigation.navigate('MerchantOffer'); }}
            />
          ) : <>
            {renderAssetTabs()}
            {!awaitingPrefilledAsset && renderOptionsPill()}
            {showRgbInvoiceOptions && <PaymentNetworkLabel request={address} network={routeTarget?.chain} />}
            {showRgbInvoiceOptions && (rgbPrecision === undefined
              ? <Text style={styles.rgbOpenAmount}>Any amount</Text>
              : <Input
                  label={`Amount (${selectedAsset.ticker || selectedAsset.name})`}
                  accessibilityHint="Leave blank to accept any amount."
                  placeholder="Any amount"
                  value={rgbAmount}
                  onChangeText={changeRgbAmount}
                  onSubmitEditing={rgbInvoiceEditing ? updateRgbInvoice : undefined}
                  error={rgbAmountError}
                  keyboardType={rgbPrecision === 0 ? 'number-pad' : 'decimal-pad'}
                  returnKeyType="done"
                  size="sm"
                  style={styles.rgbAmount}
                />)}
            {renderContent()}
            {showRgbInvoiceOptions && <RgbInvoiceOptions
              key={`${selectedAsset.asset_id}:${route.method}`}
              support={rgbOnchain ? rgbSupport : { ...NO_RGB_RECEIVE_SUPPORT, expiry: true }}
              options={rgbOptions}
              onChange={changeRgbOptions}
              requestExpirySeconds={expirySeconds}
              proxyV1={rgbProxyV1}
              utxos={rgbUtxos}
              onLoadUtxos={() => { void loadRgbUtxos(); }}
              onCreateUtxos={rgbSupport.createUtxos ? () => setShowCreateUtxos(true) : undefined}
            />}

            {networkType === 'bark' && arkadeSubMode === 'boarding' && <BarkBoardingPanel />}
            {/* With a QR on screen the status sits right under it; otherwise here. */}
            {!qrOnScreen && renderStatus()}
          </>}

        </ScrollView>
        {showRgbDraft && <View style={styles.rgbEditFooter}>
          <Button title="Update invoice" onPress={updateRgbInvoice} disabled={!!rgbAmountError} fullWidth />
        </View>}
      </KeyboardAvoidingView>

      {/* The pill opens the routes directly: one sheet, not a sheet inside a sheet. */}
      <Sheet visible={showOptions} onClose={() => setShowOptions(false)} title="How they pay">
        <ScrollView style={{ maxHeight: 520 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <ReceiveRoutePicker embedded
            methods={receiveMethodIds}
            method={route.method}
            onMethod={(method) => { selectRoute(method); if (method !== 'universal') setShowOptions(false); }}
            destinations={routeDestinations}
            destination={routeDestination}
            onDestination={(account) => { selectRoute(route.method, account); setShowOptions(false); }}
            amountSats={requestedSats}
            chains={chainGroups}
            accountLabel={(account) => accountLabel(account, caps)}
            iconFor={(account) => receiveAccountIcon(account, caps)}
            methodIcons={Object.fromEntries(receiveMethodIds.map((m) => [m, methodIcons(m, receiveAccounts, caps)]))}
            chain={activeChain}
            onChain={(chain) => {
              if (chain === activeChain) return;
              feedback.select();
              resetReceiveSurface();
              setUniversalChain(chain);
              setUniversalLn(null);
            }}
            lightningDestinations={universalLnOptions}
            lightningDestination={universalLnAccount}
            onLightningDestination={(account) => {
              feedback.select();
              resetReceiveSurface();
              setUniversalLn(account);
              setShowOptions(false);
            }}
          />
          {connectedNow.SPARK && <BridgeEntryCard onPress={() => afterOptions(() => { cancelReceiveWork(); navigation.navigate('Bridge'); })} />}
        </ScrollView>
      </Sheet>

      <RgbAssetSheet
        visible={showRgbAssets}
        onClose={() => setShowRgbAssets(false)}
        accountLabel={rgbLabel}
        held={rgbAssets}
        selectedAssetId={selectedAsset.asset_id}
        onPickAny={() => receiveRgbAsset(null)}
        onPickAsset={receiveRgbAsset}
      />
      <RgbUtxoSheet
        visible={showCreateUtxos}
        onClose={() => setShowCreateUtxos(false)}
        assets={rgbAssets}
        reason="A private invoice needs a free receive slot to receive into."
        onCreated={() => { void loadRgbUtxos(); }}
      />

      {/* Amount editor — WDK AmountInput (BTC ↔ USD) inside a bottom sheet */}
      <NostrContactsSelector visible={showContactPicker} onClose={() => setShowContactPicker(false)} intent="request"
        onConnectNostr={() => navigation.navigate('NostrSettings')}
        onSelectContact={(c) => { const dest = c.lightning_address || c.npub || c.node_pubkey; if (dest) { requestEventId.current = null; setRequestContact({ name: c.name, key: contactKeyFor(dest) }); } setShowContactPicker(false); }} />
      <AmountEditorModal
        visible={showAmountEditor}
        onClose={() => setShowAmountEditor(false)}
        requestOptions={{ expirySeconds, showCountdown, note }}
        initialSats={currentAmountSats}
        rates={fiatRates}
        bitcoinUnit={bitcoinUnit}
        onConfirm={(sats, options) => {
          if (options) {
            setShowCountdown(options.showCountdown);
            if (options.expirySeconds !== expirySeconds) { resetReceiveSurface(); setExpirySeconds(options.expirySeconds); }
            if ((options.note ?? '') !== note) { resetReceiveSurface(); setNote(options.note ?? ''); }
          }
          receiveLog('amount.confirm', { sats, previousAmount: amount, networkType });
          applyAmountSats(sats);
        }}
      />

      <DepositSuccessOverlay
        visible={showDepositSuccess}
        // A newly received RGB asset is named once the asset list refreshes; never show its raw id meanwhile.
        ticker={depositMonitor.assetId === 'MULTIPLE' ? 'Multiple assets' : depositMonitor.assetId === 'BTC' ? 'BTC' : assets.find(a => a.asset_id === depositMonitor.assetId)?.ticker
          ?? (depositMonitor.assetId?.startsWith('rgb:') ? 'RGB asset' : depositMonitor.assetId && depositMonitor.assetId !== selectedAsset.asset_id ? depositMonitor.assetId : selectedAsset.ticker)}
        amountLabel={detectedAmount}
        amountIsBalanceChange={depositMonitor.amountSource === 'balance'}
        account={depositMonitor.protocol === 'RGB' ? rgbLabel : depositMonitor.protocol === 'ARKADE' ? 'Arkade' : depositMonitor.protocol === 'SPARK' ? 'Spark' : depositMonitor.protocol === 'BARK' ? 'Bark' : undefined}
        network={depositMonitor.layer ? formatDepositLayer(depositMonitor.layer) : networkType === 'unified' ? undefined : networkType}
        receivedAt={depositMonitor.updatedAt}
        backup={depositMonitor.layer === 'rgb' && rgbAccountIsOnDevice() ? backup : undefined}
        onBackup={() => { void runRgbBackup(true); }}
        onActivity={() => { setShowDepositSuccess(false); cancelReceiveWork(); navigation.navigate('Dashboard', { screen: 'Activity' }); }}
        onDone={() => {
          setShowDepositSuccess(false);
          setDepositMonitor({ status: 'idle' });
          navigation.goBack();
        }}
      />
    </SafeAreaView>
  );
}
