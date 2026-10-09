// screens/SwapScreen.tsx
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { usePolicy } from '../hooks/usePolicy';
import {
  TextInput,
  useWindowDimensions,
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { RootState } from '../store';
import {
  setFromAsset,
  setToAsset,
  setFromAmount,
  swapAssets,
  setCurrentQuote,
  setQuoteLoading,
  setExecuting,
  setCurrentExecution,
  updateExecutionStatus,
  addToHistory,
  setError,
  clearError,
  resetSwap,
  SwapQuote,
  SwapExecution
} from '../store/slices/swapSlice';
import { protocolManager } from '../services/protocols';
import { kaleidoClientManager, flashnetClientManager } from '../services/protocols';
import { syncAssets } from '../store/slices/assetsSlice';
import { getAssetDisplayBalance, resolvePrecision } from '../utils/assetAmount';
import { inventoryBtc, inventoryTokens } from '../utils/asset-inventory';
import { useAssetInventory } from '../hooks/useAssetInventory';
import {
  SwapPair, SwapVenueFilter, SwapProgress,
  findPair, allTickers, tradableTickers, findPairAsset, getPairAsset,
  getAssetId, isBtcTicker, getQuoteLayers, isFlashnetPair, getAssetNetwork,
  normalizeMakerPairs, buildFlashnetPairs, validateSwapString, swapRateLabel, maxSwapSendRaw,
  QUOTE_DEBOUNCE_MS, QUOTE_REFRESH_MS, DEFAULT_FLASHNET_SLIPPAGE_BPS, MSATS_PER_SAT, RLN_HTLC_MIN_MSAT,
} from '../utils/swap-model';
import { minimumSwapOutput, quoteHasExpired } from '../utils/swap-review';
import { describeSwapFailure, isConnectionFailure, SWAP_FAILED_COPY, SWAP_UNCONFIRMED_COPY, type SwapFailureCopy } from '../utils/swap-errors';
import { ProviderSheet } from '../components/payments/ProviderSheet';
import {
  fetchSwapOffers, bestSwapOffer, assertSwapQuoteProvider, swapProviderName, type SwapOffer,
  loadChannelLiquidity, quoteChannelShortfall, type ChannelLiquidity,
} from '../services/swapQuotes';
import { BTC_ASSET_PUBKEY } from '../utils/flashnet';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, ZoomIn, FadeInDown } from 'react-native-reanimated';
import { theme, motion } from '../theme';
import { feedback } from '../utils/feedback';
import { swapStatusVisual } from '../utils/paymentStatus';
import { Card, Button, Input, MainHeader, AssetIcon, AssetSelector, PressableScale, Sheet, AmountText, Callout } from '../components';
import { NetworkIcon, networkIconForLabel } from '../components/NetworkIcon';
import { ExplainButton } from '../components/mind/ExplainSheet';

interface Props {
  navigation: any;
  route?: { params?: { fromAsset?: string; toAsset?: string; fromAmountSat?: number; fromAmountUnits?: number } };
}

interface Asset {
  asset_id: string;
  ticker: string;
  name: string;
  balance: number;
  icon?: string;
  precision?: number;
}

export default function SwapScreen({ navigation, route }: Props) {
  const dispatch = useAppDispatch();
  const { height: screenHeight } = useWindowDimensions();
  const swapState = useAppSelector((state: RootState) => state.swap);
  const walletState = useAppSelector((state: RootState) => state.wallet);
  // The shared asset inventory; what is tradable is decided below, from the pairs.
  const inventory = useAssetInventory();
  const tokens = useMemo(() => inventoryTokens(inventory), [inventory]);
  // The wallet is sats-first by default. The BTC-side amount field is therefore
  // entered/shown in this unit — NOT BTC. Treating the input as BTC (the old
  // behaviour) multiplied every BTC swap amount by 1e8, blowing past the maker's
  // max and silently returning no quote.
  const bitcoinUnit = useAppSelector((state: RootState) => state.settings?.bitcoinUnit || 'sats');

  // Convert a BTC-side display value (in the active unit) to integer sats, and back.
  const btcDisplayToSats = (val: number) => (bitcoinUnit === 'sats' ? Math.round(val) : Math.round(val * 1e8));
  const satsToBtcDisplay = (sats: number) => (bitcoinUnit === 'sats' ? Math.round(sats) : sats / 1e8);
  // Human label for the BTC side, e.g. "sats" or "BTC".
  const btcUnitLabel = bitcoinUnit === 'sats' ? 'sats' : 'BTC';

  // Format a display amount for a given ticker: sats render as whole integers,
  // BTC/tokens trim trailing zeros. Keeps the UI readable in either unit.
  const formatDisplayAmount = (value: number, ticker: string): string => {
    if (!Number.isFinite(value)) return '0';
    if (isBtcTicker(ticker) && bitcoinUnit === 'sats') return Math.round(value).toLocaleString('en-US');
    return parseFloat(value.toFixed(8)).toString();
  };
  // The unit shown next to a ticker (BTC side respects the active unit).
  const unitLabelFor = (ticker: string) => (isBtcTicker(ticker) ? btcUnitLabel : ticker);
  const quoteLegLabel = (amount: number, ticker: string) => `${formatDisplayAmount(amount, ticker)} ${unitLabelFor(ticker)}`;
  // Flashnet takes its fee from the asset paid in, the maker from the asset paid out.
  const formatQuoteFee = (q: SwapQuote): string => {
    const ticker = q.venue === 'flashnet' ? q.from_asset : q.to_asset;
    return `${formatDisplayAmount(q.fee_amount, ticker)} ${unitLabelFor(ticker)}`;
  };

  const [showAssetPicker, setShowAssetPicker] = useState<'from' | 'to' | null>(null);
  // The flip arrow turns half a revolution per tap.
  const flipTurns = useSharedValue(0);
  const flipIconStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${flipTurns.value * 180}deg` }] }));
  const [availableAssets, setAvailableAssets] = useState<Asset[]>([]);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [reviewQuote, setReviewQuote] = useState<SwapQuote | null>(null);
  const [previousReviewQuote, setPreviousReviewQuote] = useState<SwapQuote | null>(null);
  const [providerOffers, setProviderOffers] = useState<SwapOffer[]>([]);
  const [showProviders, setShowProviders] = useState(false);
  const selectedProvider = React.useRef<string | undefined>(undefined);
  const quotePairs = React.useRef(new WeakMap<SwapQuote, SwapPair>());
  const executingRef = React.useRef(false);
  const quoteRequestRef = React.useRef(0);
  const lastAutoRefreshRef = React.useRef(0);
  const [pollingInterval, setPollingInterval] = useState<NodeJS.Timeout | null>(null);
  const [tradingPairs, setTradingPairs] = useState<SwapPair[]>([]);
  const [venueFilter, setVenueFilter] = useState<SwapVenueFilter>('all');
  // Lite hides venues, the maker and account names: the best price is picked for you.
  const policy = usePolicy();
  const [swapProgress, setSwapProgress] = useState<SwapProgress>('idle');
  const [pairsLoading, setPairsLoading] = useState(false);
  // A venue whose prices failed to load, so an empty list says why.
  const [pairsFailed, setPairsFailed] = useState(false);
  const [quoteSecsLeft, setQuoteSecsLeft] = useState<number | null>(null);
  // The RGB node's channels: what a maker swap can carry (channels unknown = no guard).
  const [liquidity, setLiquidity] = useState<ChannelLiquidity>({ htlcMinMsat: RLN_HTLC_MIN_MSAT });
  // Set once a swap settles so the confirm modal shows a success screen instead
  // of silently closing (the Flashnet path had no confirmation at all).
  const [swapSuccess, setSwapSuccess] = useState<
    { fromAmount: number; fromTicker: string; toAmount: number; toTicker: string; txid?: string } | null
  >(null);
  // Set when a swap fails or never confirms, so the sheet ends on a result either way.
  // `unconfirmed`: no final status yet, so the swap may still complete.
  const [swapFailure, setSwapFailure] = useState<(SwapFailureCopy & { unconfirmed?: boolean }) | null>(null);

  // After any swap, refresh balances everywhere: the global asset list (so a
  // freshly bought Spark token like USDB appears in Assets/Dashboard), the local
  // picker list, and the pair list. Spark inbound token transfers can settle a
  // few seconds AFTER executeSwap returns, so force a wallet sync + re-poll a
  // couple of times rather than reading a single (possibly pre-settlement) value.
  const refreshAfterSwap = () => {
    const walletId = walletState?.activeWallet?.id;
    const sync = () => {
      if (walletId) dispatch(syncAssets(walletId) as any);
      loadAvailableAssets();
    };
    const sparkAdapter: any = protocolManager.getAdapterIfAvailable('SPARK');
    Promise.resolve(sparkAdapter?.refreshBalances?.()).catch(() => {}).finally(sync);
    setTimeout(sync, 4000);
    setTimeout(sync, 12000);
    loadTradingPairs();
    void refreshLiquidity();
  };

  const refreshLiquidity = async () => {
    try { setLiquidity(await loadChannelLiquidity()); } catch { setLiquidity({ htlcMinMsat: RLN_HTLC_MIN_MSAT }); }
  };

  // Build a history entry from a settled quote so swaps (both venues) show up in
  // the History screen with real amounts.
  const recordSwapHistory = (
    q: SwapQuote,
    status: SwapExecution['status'],
    txid?: string,
    swapString?: string,
    errorMessage?: string,
  ) => {
    dispatch(addToHistory({
      rfq_id: q.rfq_id,
      swap_string: swapString || '',
      status,
      created_at: Date.now(),
      updated_at: Date.now(),
      txid,
      error_message: errorMessage,
      from_asset: q.from_asset,
      to_asset: q.to_asset,
      from_amount: q.from_amount,
      to_amount: q.to_amount,
      venue: q.venue,
    }));
  };

  // Load trading pairs and assets on mount
  useEffect(() => {
    loadTradingPairs();
    loadAvailableAssets();

    if (!swapState.fromAsset) dispatch(setFromAsset('BTC'));
    // The destination comes from the loaded pairs (USDT on the RGB node, USDB on
    // Spark): presetting one here showed it for a moment, then swapped it.
  }, []);

  // Prefilled from KaleidoMind: the pair and amount the user asked for; quoting and review stay here.
  useEffect(() => {
    const p = route?.params;
    if (!p?.fromAsset || !p.toAsset) return;
    dispatch(setFromAsset(p.fromAsset));
    dispatch(setToAsset(p.toAsset));
    if (isBtcTicker(p.fromAsset) && Number.isSafeInteger(p.fromAmountSat) && p.fromAmountSat! > 0) {
      dispatch(setFromAmount(String(satsToBtcDisplay(p.fromAmountSat!))));
    } else if (!isBtcTicker(p.fromAsset) && Number.isFinite(p.fromAmountUnits) && p.fromAmountUnits! > 0) {
      dispatch(setFromAmount(String(p.fromAmountUnits)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route?.params]);

  // Clear polling interval on unmount
  useEffect(() => {
    return () => {
      if (pollingInterval) {
        clearInterval(pollingInterval);
      }
    };
  }, [pollingInterval]);

  useEffect(() => { selectedProvider.current = undefined; }, [swapState.fromAsset, swapState.toAsset, venueFilter]);

  // Invalidate quotes immediately when the input changes, including in-flight responses.
  useEffect(() => {
    quoteRequestRef.current += 1;
    dispatch(setCurrentQuote(null));
    setProviderOffers([]);
    dispatch(setQuoteLoading(false));
    const timer = setTimeout(() => {
      if (swapState.fromAmount && parseFloat(swapState.fromAmount) > 0 && swapState.fromAsset && swapState.toAsset) {
        getQuote();
      } else {
        // Reset quote if amount is cleared
        if (swapState.currentQuote) {
          dispatch(setCurrentQuote(null));
        }
      }
    }, 500); // 500ms debounce

    return () => { clearTimeout(timer); quoteRequestRef.current += 1; };
  }, [swapState.fromAmount, swapState.fromAsset, swapState.toAsset, venueFilter, bitcoinUnit, tradingPairs]);

  // Always-fresh handle to getQuote for use inside intervals (avoids stale closures).
  const getQuoteRef = React.useRef<() => void>(() => {});

  // Live quote expiry countdown + auto-refresh (mirrors the extension's behaviour:
  // quotes are short-lived, so we tick a countdown and refresh as it ages out).
  useEffect(() => {
    const q = showConfirmModal ? reviewQuote : swapState.currentQuote;
    if (!q || swapState.isExecuting) {
      setQuoteSecsLeft(null);
      return;
    }
    const tick = () => {
      const left = Math.max(0, Math.round((q.expiry_timestamp - Date.now()) / 1000));
      setQuoteSecsLeft(left);
      const aged = Date.now() - q.expiry_timestamp >= -QUOTE_REFRESH_MS;
      if (!showConfirmModal && !swapState.isQuoteLoading && (left <= 0 || aged) && Date.now() - lastAutoRefreshRef.current >= QUOTE_REFRESH_MS) {
        lastAutoRefreshRef.current = Date.now();
        getQuoteRef.current?.();
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [swapState.currentQuote, swapState.isExecuting, showConfirmModal, reviewQuote, swapState.isQuoteLoading]);

  const loadTradingPairs = async () => {
    setPairsLoading(true);
    setPairsFailed(false);
    let failed = false;
    try {
      let makerPairs: SwapPair[] = [];
      let flashnetPairs: SwapPair[] = [];

      // Load Kaleidoswap pairs (via RGB adapter / kaleido-sdk maker)
      try {
        const rgbAdapter = protocolManager.getAdapterIfAvailable('RGB_LN');
        if (rgbAdapter?.isConnected()) {
          const client = kaleidoClientManager.getClient();
          const rawPairs = await client.maker.listPairs();
          makerPairs = normalizeMakerPairs((rawPairs as any)?.pairs || rawPairs || []);
          console.log(`[SwapScreen] Loaded ${makerPairs.length} Kaleidoswap pairs`);
        }
      } catch (err) {
        console.warn('[SwapScreen] Failed to load Kaleidoswap pairs:', err);
        failed = true;
      }

      // Load Flashnet pools (via Spark → Flashnet)
      try {
        if (flashnetClientManager.isInitialized()) {
          const client = flashnetClientManager.getClient();
          const pools = await client.listPools({ sort: 'TVL_DESC' });
          const poolArray = Array.isArray(pools) ? pools : (pools as any)?.pools || [];
          // listPools returns asset addresses as HEX pubkeys, but USDB (and the
          // wallet inventory) are keyed by the bech32m btkn1… identifier. Encode
          // each side so the pair builder can recognise USDB and match holdings.
          const enriched = poolArray.map((p: any) => {
            const encode = (addr?: string) => {
              if (!addr || addr === BTC_ASSET_PUBKEY) return undefined;
              try { return client.encodeTokenAddress(addr); } catch { return undefined; }
            };
            return {
              ...p,
              assetABech32Address: p.assetABech32Address || encode(p.assetAAddress),
              assetBBech32Address: p.assetBBech32Address || encode(p.assetBAddress),
            };
          });
          // Feed held Spark assets so pool addresses resolve to real
          // ticker/name/precision (the SDK pool payload carries none).
          const sparkInventory = tokens.map((a) => ({
            asset_id: a.asset_id,
            ticker: a.ticker,
            name: a.name,
            precision: a.precision,
          }));
          flashnetPairs = buildFlashnetPairs(enriched, sparkInventory);
          console.log(`[SwapScreen] Loaded ${flashnetPairs.length} Flashnet pairs`);
        }
      } catch (err) {
        console.warn('[SwapScreen] Failed to load Flashnet pools:', err);
        failed = true;
      }

      setTradingPairs([...makerPairs, ...flashnetPairs]);
    } catch (error) {
      console.error('[SwapScreen] Failed to load trading pairs:', error);
      failed = true;
    } finally {
      setPairsFailed(failed);
      setPairsLoading(false);
    }
  };

  const loadAvailableAssets = () => {
    try {
      // Keyed by ticker so held-asset balances win over pair-derived placeholders.
      const byTicker = new Map<string, Asset>();
      const btc = inventoryBtc(inventory);
      byTicker.set(btc.ticker, {
        asset_id: btc.asset_id,
        ticker: btc.ticker,
        name: btc.name,
        // Balance is in the active BTC unit (sats by default) so the MAX
        // button and the amount field agree with how the input is parsed.
        // assetByTicker narrows it to the account the pair's venue spends from.
        balance: satsToBtcDisplay(btc.spendable ?? btc.balance),
        precision: bitcoinUnit === 'sats' ? 0 : 8,
      });
      for (const asset of tokens) {
        byTicker.set(asset.ticker, {
          asset_id: asset.asset_id,
          ticker: asset.ticker,
          name: asset.name,
          balance: getAssetDisplayBalance(asset.balance, asset.precision),
          precision: asset.precision,
          icon: asset.icon,
        });
      }
      // Surface every ticker that appears in a loaded pair (e.g. Flashnet's USDB)
      // even when the wallet holds none yet — otherwise the destination is
      // unreachable and the pair looks missing.
      for (const ticker of allTickers(tradingPairs)) {
        if (byTicker.has(ticker)) continue;
        const pairAsset = findPairAsset(tradingPairs, ticker);
        byTicker.set(ticker, {
          asset_id: pairAsset ? getAssetId(pairAsset) : ticker,
          ticker,
          name: pairAsset?.name || ticker,
          balance: 0,
          precision: pairAsset?.precision ?? 8,
        });
      }
      setAvailableAssets(Array.from(byTicker.values()));
    } catch (error) {
      console.error('Failed to load available assets:', error);
    }
  };

  // Get filtered pairs based on venue selection
  const filteredPairs = tradingPairs.filter(p => {
    if (venueFilter === 'all') return true;
    return p.venue === venueFilter;
  });

  // Rebuild the selectable asset list whenever the loaded pairs, held assets, or
  // BTC unit change — so a freshly loaded Flashnet USDB pair becomes selectable.
  useEffect(() => {
    loadAvailableAssets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tradingPairs, inventory, bitcoinUnit]);

  // Once pairs load, make sure the from/to selection actually forms a real pair.
  // A Spark-only wallet (no RLN) has no BTC/USDT pair, so fall back to the first
  // available pair (preferring BTC as the source) — i.e. Flashnet BTC/USDB.
  useEffect(() => {
    if (!tradingPairs.length) return;
    if (findPair(filteredPairs, swapState.fromAsset, swapState.toAsset)) return;
    const preferred = filteredPairs.find(p => p.base.ticker === 'BTC') || filteredPairs[0];
    if (preferred) {
      dispatch(setFromAsset(preferred.base.ticker));
      dispatch(setToAsset(preferred.quote.ticker));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tradingPairs, venueFilter]);

  const getQuote = async () => {
    const requestId = ++quoteRequestRef.current;
    if (!Number.isFinite(Number(swapState.fromAmount)) || Number(swapState.fromAmount) <= 0) return;
    dispatch(setQuoteLoading(true)); dispatch(clearError());
    try {
      const offers = await fetchSwapOffers(filteredPairs, swapState.fromAsset, swapState.toAsset, Number(swapState.fromAmount), bitcoinUnit);
      if (requestId !== quoteRequestRef.current) return;
      setProviderOffers(offers);
      offers.forEach(o => { if (o.quote) quotePairs.current.set(o.quote, o.pair); });
      const selected = selectedProvider.current
        ? offers.find(o => o.id === selectedProvider.current)
        : bestSwapOffer(offers) ?? offers.find(o => o.quote);
      if (selected) selectedProvider.current = selected.id;
      dispatch(setCurrentQuote(selected?.quote ?? null));
      if (!selected?.quote) dispatch(setError(selected?.unavailable ?? 'No live quote from the selected provider. Compare providers or refresh.'));
      return selected?.quote;
    } finally { if (requestId === quoteRequestRef.current) dispatch(setQuoteLoading(false)); }
  };

  // Keep the interval's handle pointing at the latest getQuote.
  getQuoteRef.current = getQuote;

  const refreshReviewQuote = async () => {
    const updated = await getQuote();
    if (updated) {
      setPreviousReviewQuote(reviewQuote);
      setReviewQuote(updated);
    }
  };

  const executeSwap = async () => {
    if (!reviewQuote || executingRef.current || swapState.isExecuting) return;
    const quote = reviewQuote;
    if (quoteHasExpired(quote.expiry_timestamp)) {
      setQuoteSecsLeft(0);
      return;
    }
    if (quote.to_amount <= 0 || quote.from_amount !== Number(swapState.fromAmount) ||
        quote.from_asset !== swapState.fromAsset || quote.to_asset !== swapState.toAsset) {
      dispatch(setError('The payment amount changed. Request a new quote.'));
      setShowConfirmModal(false);
      return;
    }
    executingRef.current = true;
    // Once the provider has the swap, a failure belongs in Activity.
    let started = false;
    let swapString = '';
    // Set once our node has whitelisted the swap: from then on the maker can
    // settle it, so an error only means we don't know the outcome yet.
    let followUp: (() => void) | null = null;
    let flashnetSubmitted = false;

    try {
      dispatch(setExecuting(true));

      // Execute the exact route that produced the reviewed quote. Never infer a provider from tickers.
      const pair = quotePairs.current.get(quote);
      if (!pair) throw new Error('This quote is no longer available. Refresh and review again.');
      assertSwapQuoteProvider(quote);

      if (pair && isFlashnetPair(pair)) {
        // ── Flashnet execution (single step) ──
        setSwapProgress('execute');
        started = true;
        const client = flashnetClientManager.getClient();
        const poolId = pair.poolId || flashnetClientManager.getPoolId();
        const fromAssetId = getAssetId(pair.base.ticker === quote.from_asset ? pair.base : pair.quote);
        const toAssetId = getAssetId(pair.base.ticker === quote.to_asset ? pair.base : pair.quote);
        const fromPrecision = (pair.base.ticker === quote.from_asset ? pair.base : pair.quote).precision;
        const toPrecision = (pair.base.ticker === quote.to_asset ? pair.base : pair.quote).precision;
        const rawAmount = quote.from_amount_raw ?? (isBtcTicker(quote.from_asset)
          ? btcDisplayToSats(quote.from_amount)
          : Math.round(quote.from_amount * Math.pow(10, fromPrecision)));
        const rawToAmount = quote.to_amount_raw ?? Math.round(isBtcTicker(quote.to_asset)
          ? btcDisplayToSats(quote.to_amount)
          : quote.to_amount * Math.pow(10, toPrecision));

        flashnetSubmitted = true;
        const result = await client.executeSwap({
          poolId: poolId || '',
          assetInAddress: fromAssetId,
          assetOutAddress: toAssetId,
          amountIn: String(rawAmount),
          // Submit the same integer minimum shown in the review.
          minAmountOut: String(minimumSwapOutput(rawToAmount, DEFAULT_FLASHNET_SLIPPAGE_BPS)),
          maxSlippageBps: DEFAULT_FLASHNET_SLIPPAGE_BPS,
        });

        setSwapProgress('done');
        feedback.swap();
        dispatch(updateExecutionStatus({
          rfq_id: quote.rfq_id,
          status: 'completed',
          txid: result?.outboundTransferId || '',
        }));
        // Flashnet settles instantly (no status polling), so record history here.
        recordSwapHistory(quote, 'completed', result?.outboundTransferId || '');
        dispatch(setExecuting(false));
        // Keep the modal open and show a success screen (Flashnet settles
        // instantly — no status polling — so this is the only confirmation).
        setSwapSuccess({
          fromAmount: quote.from_amount,
          fromTicker: quote.from_asset,
          toAmount: quote.to_amount,
          toTicker: quote.to_asset,
          txid: result?.outboundTransferId || '',
        });
        refreshAfterSwap();
      } else {
        // ── Kaleidoswap execution (3-step: init → taker → execute) ──
        if (!kaleidoClientManager.isInitialized()) {
          throw new Error('KaleidoSwap needs your RGB Lightning node. Connect it in Settings.');
        }
        const client = kaleidoClientManager.getClient();
        const fromAsset = pair ? (pair.base.ticker === quote.from_asset ? pair.base : pair.quote) : null;
        const toAsset = pair ? (pair.base.ticker === quote.to_asset ? pair.base : pair.quote) : null;
        const fromPrecision = resolvePrecision(fromAsset?.precision);
        const toPrecision = resolvePrecision(toAsset?.precision);
        // Prefer the exact integers the maker quoted (stored on the quote); only
        // fall back to re-deriving from the display amount for older quotes that
        // predate the raw fields. The maker encodes these exact values into the
        // swapstring, so they MUST match for validateSwapString to pass.
        const fromAssetId = quote.from_asset_id
          ?? (fromAsset ? getAssetId(fromAsset) : quote.from_asset);
        const toAssetId = quote.to_asset_id
          ?? (toAsset ? getAssetId(toAsset) : quote.to_asset);
        const rawFromAmount = quote.from_amount_raw ?? (isBtcTicker(quote.from_asset)
          ? Math.round(quote.from_amount * 1e8 * 1000)
          : Math.round(quote.from_amount * Math.pow(10, fromPrecision)));
        const rawToAmount = quote.to_amount_raw ?? (isBtcTicker(quote.to_asset)
          ? Math.round(quote.to_amount * 1e8 * 1000)
          : Math.round(quote.to_amount * Math.pow(10, toPrecision)));

        // The channels may have changed since the quote: stop before the maker locks anything.
        const shortfall = quoteChannelShortfall(quote, await loadChannelLiquidity(), quoteLegLabel);
        if (shortfall) throw new Error(`Can't swap: ${shortfall}`);

        // Step 1: Init swap. The maker SDK's SwapRequest is a FLAT shape
        // ({ rfq_id, from_asset, from_amount, to_asset, to_amount }) — passing a
        // nested { asset_id, amount, layer } object (as the old `as any` cast
        // did) sent the asset as an object and the amounts as undefined, so the
        // swap never initialised. Mirrors rate-extension's INIT_SWAP route.
        setSwapProgress('init');
        started = true;
        const initResult = await client.maker.initSwap({
          rfq_id: quote.rfq_id,
          from_asset: fromAssetId,
          from_amount: rawFromAmount,
          to_asset: toAssetId,
          to_amount: rawToAmount,
        }) as any;

        const swapstring = initResult?.swapstring || initResult?.swap_string || '';
        const paymentHash = initResult?.payment_hash || '';
        // The maker looks a swap up by payment hash, with the token it issued at init.
        const accessToken: string | undefined = initResult?.access_token || undefined;
        swapString = swapstring;

        // Safety check: verify the maker's swapstring encodes the exact terms we
        // agreed to before whitelisting it on our node. Abort on any mismatch.
        if (!validateSwapString(swapstring, rawFromAmount, fromAssetId, rawToAmount, toAssetId, paymentHash)) {
          throw new Error('Swap verification failed — the returned terms did not match your quote. Aborted for your safety.');
        }

        const execution: SwapExecution = {
          rfq_id: quote.rfq_id,
          swap_string: swapstring,
          status: 'pending',
          created_at: Date.now(),
          updated_at: Date.now(),
        };
        dispatch(setCurrentExecution(execution));

        // Step 2: Taker whitelist
        setSwapProgress('taker');
        await client.rln.whitelistSwap(swapstring);
        dispatch(updateExecutionStatus({ rfq_id: quote.rfq_id, status: 'whitelisted' }));
        followUp = () => startStatusPolling(paymentHash, accessToken, quote, execution);

        // Step 3: Confirm swap
        setSwapProgress('execute');
        const takerPubkey = await client.rln.getTakerPubkey();
        await client.maker.executeSwap({
          swapstring,
          taker_pubkey: takerPubkey,
          payment_hash: paymentHash,
        } as any);

        dispatch(updateExecutionStatus({ rfq_id: quote.rfq_id, status: 'executing' }));
        setSwapProgress('done');

        startStatusPolling(paymentHash, accessToken, quote, execution);
      }
    } catch (error) {
      console.error('Swap execution failed:', error);
      if (followUp) {
        setSwapProgress('done');
        followUp();
        return;
      }
      const copy = describeSwapFailure(error);
      // A Flashnet request that timed out may still have gone through.
      if (flashnetSubmitted && isConnectionFailure(error)) {
        setSwapProgress('idle');
        recordSwapHistory(quote, 'pending', undefined, swapString, error instanceof Error ? error.message : copy.title);
        setSwapFailure({ ...SWAP_UNCONFIRMED_COPY, unconfirmed: true });
        dispatch(setExecuting(false));
        refreshAfterSwap();
        return;
      }
      feedback.error();
      setSwapProgress('idle');
      dispatch(updateExecutionStatus({ rfq_id: quote.rfq_id, status: 'failed', error_message: copy.message }));
      if (started) {
        recordSwapHistory(quote, 'failed', undefined, swapString, error instanceof Error ? error.message : copy.title);
      }
      setSwapFailure(copy);
      dispatch(setExecuting(false));
    } finally {
      executingRef.current = false;
    }
  };

  // `quote` and `execution` are passed in rather than read from swapState: the
  // interval callback would otherwise see the values captured at render time
  // (before setCurrentExecution landed), losing swap_string/txid in history.
  const startStatusPolling = (paymentHash: string, accessToken: string | undefined, quote: SwapQuote, execution: SwapExecution) => {
    const rfqId = quote.rfq_id;
    let pollCount = 0;
    const maxPolls = 20; // × 3s ≈ 1 minute

    // Single exit path so every outcome clears the interval and the spinner.
    const stop = (interval: ReturnType<typeof setInterval>) => {
      clearInterval(interval);
      setPollingInterval(null);
      dispatch(setExecuting(false));
    };
    // No final status: recorded as pending, since the swap may still settle.
    const giveUp = (interval: ReturnType<typeof setInterval>, reason: string) => {
      recordSwapHistory(quote, 'pending', execution.txid, execution.swap_string, reason);
      stop(interval);
      setSwapFailure({ ...SWAP_UNCONFIRMED_COPY, unconfirmed: true });
      refreshAfterSwap();
    };

    const interval = setInterval(async () => {
      try {
        pollCount++;

        const rgbAdapter = protocolManager.getAdapterIfAvailable('RGB_LN');
        if (!rgbAdapter?.isConnected()) {
          console.warn('[SwapScreen] RGB adapter not connected, stopping poll');
          giveUp(interval, 'Lost connection to the RGB Lightning node');
          return;
        }

        let status: any;
        try {
          status = await rgbAdapter.getSwapStatus?.(paymentHash, accessToken);
        } catch {
          // Swap status not available yet
          status = undefined;
        }

        const swapStatus = status?.status || 'pending';

        if (swapStatus === 'confirmed' || swapStatus === 'completed' || swapStatus === 'failed') {
          const failed = swapStatus === 'failed';
          if (failed) feedback.error();
          else feedback.swap();
          dispatch(updateExecutionStatus({
            rfq_id: rfqId,
            status: failed ? 'failed' : 'completed',
            error_message: failed ? SWAP_FAILED_COPY.message : undefined,
          }));

          // Record an enriched history entry (amounts/tickers from the quote).
          recordSwapHistory(
            quote,
            failed ? 'failed' : 'completed',
            status?.txid ?? execution.txid,
            execution.swap_string,
            failed ? 'The maker reported the swap as failed' : undefined,
          );

          stop(interval);
          if (failed) {
            setSwapFailure(SWAP_FAILED_COPY);
          } else {
            setSwapSuccess({
              fromAmount: quote.from_amount,
              fromTicker: quote.from_asset,
              toAmount: quote.to_amount,
              toTicker: quote.to_asset,
              txid: status?.txid ?? execution.txid,
            });
          }
          refreshAfterSwap();
          return;
        }

        // Still pending (or status unavailable): give up after maxPolls.
        if (pollCount >= maxPolls) giveUp(interval, 'Not confirmed within a minute');
      } catch (error) {
        console.warn('Failed to poll swap status:', error);
      }
    }, 3000);

    setPollingInterval(interval);
  };

  const getAssetIcon = (ticker: string) => {
    return <AssetIcon ticker={ticker} size={28} showBadge={false} />;
  };

  // Look up an available asset by ticker (swap state stores tickers, not ids).
  // A swap spends BTC from one account: Spark for Flashnet, the RGB node for
  // KaleidoSwap. The wallet-wide total would let MAX ask for more than that account
  // holds, so BTC shows the balance of the account the pair's venue uses (the larger
  // one when both venues serve it).
  const selectedPairs = filteredPairs.filter(p =>
    [swapState.fromAsset, swapState.toAsset].filter(Boolean).every(t => p.base.ticker === t || p.quote.ticker === t));
  const btcBalanceForSwap = (): number | undefined => {
    const byProtocol = (walletState?.btcBalance as any)?.byProtocol as
      Record<string, { confirmed: number; total: number }> | undefined;
    if (!byProtocol) return undefined;
    const venues = new Set(selectedPairs.map(p => p.venue ?? 'kaleidoswap'));
    const sats = [
      ...(venues.size === 0 || venues.has('flashnet') ? [byProtocol.SPARK?.confirmed ?? 0] : []),
      ...(venues.size === 0 || venues.has('kaleidoswap') ? [byProtocol.RGB?.total ?? 0] : []),
    ];
    return satsToBtcDisplay(Math.max(0, ...sats));
  };
  const assetByTicker = (ticker: string) => {
    const asset = availableAssets.find(a => a.ticker === ticker);
    const btc = asset && isBtcTicker(ticker) ? btcBalanceForSwap() : undefined;
    return asset && btc !== undefined ? { ...asset, balance: btc } : asset;
  };
  // What the node's channels can send when only the maker serves this pair (Flashnet
  // doesn't use channels), in the display unit; undefined when unknown.
  const makerSendCapacity = (): number | undefined => {
    if (!selectedPairs.length || selectedPairs.some(isFlashnetPair)) return undefined;
    const asset = getPairAsset(selectedPairs[0], swapState.fromAsset);
    if (!asset) return undefined;
    const raw = maxSwapSendRaw({ assetId: getAssetId(asset), ticker: asset.ticker }, liquidity.channels, liquidity.htlcMinMsat);
    if (raw === undefined) return undefined;
    return isBtcTicker(asset.ticker) ? satsToBtcDisplay(Math.floor(raw / MSATS_PER_SAT)) : raw / 10 ** asset.precision;
  };
  // MAX and the input clamp: the balance, capped by channel capacity when it applies.
  const maxSendable = (): number => {
    const balance = assetByTicker(swapState.fromAsset)?.balance ?? 0;
    const cap = makerSendCapacity();
    return cap !== undefined && cap > 0 ? Math.min(balance, cap) : balance;
  };



  const rgbConnected = protocolManager.getAdapterIfAvailable('RGB_LN')?.isConnected() ?? false;
  const sparkConnected = protocolManager.getAdapterIfAvailable('SPARK')?.isConnected() ?? false;

  useEffect(() => { void refreshLiquidity(); }, [rgbConnected]);

  // The KaleidoSwap maker URL this wallet trades against, read from its RGB (RLN)
  // network config — the same value initializeWdkProtocols feeds into the maker
  // client. Surfacing it on the create screen lets the user see which provider is
  // serving pairs (and spot a missing/misconfigured maker when a pair like
  // BTC/USD turns up empty).
  const makerProviderUrl = React.useMemo<string | null>(() => {
    const rln: any = walletState?.activeWallet?.networks?.find(
      (n: any) => n.type === 'rln' && n.enabled,
    );
    if (!rln?.config) return null;
    try {
      const cfg = typeof rln.config === 'string' ? JSON.parse(rln.config) : rln.config;
      return cfg?.makerUrl || cfg?.baseUrl || cfg?.url || null;
    } catch {
      return null;
    }
  }, [walletState?.activeWallet]);

  // If the active venue filter points at a disconnected venue, fall back to All.
  useEffect(() => {
    if (venueFilter === 'kaleidoswap' && !rgbConnected) setVenueFilter('all');
    if (venueFilter === 'flashnet' && !sparkConnected) setVenueFilter('all');
  }, [venueFilter, rgbConnected, sparkConnected]);

  const renderVenueFilter = () => {
    // Only surface venues whose protocol is actually connected. KaleidoSwap
    // needs an RLN/RGB node; Flashnet needs Spark. With a single venue there's
    // nothing to switch between, so hide the strip entirely.
    const venues: Array<{ id: SwapVenueFilter; label: string }> = [
      { id: 'all', label: 'All' },
      ...(rgbConnected ? [{ id: 'kaleidoswap' as const, label: 'KaleidoSwap' }] : []),
      ...(sparkConnected ? [{ id: 'flashnet' as const, label: 'Flashnet' }] : []),
    ];
    if (venues.length <= 2) return null;

    return (
      <View style={{ flexDirection: 'row', marginBottom: theme.spacing[3], borderRadius: theme.borderRadius.base, backgroundColor: theme.colors.background.secondary, padding: 3 }}>
        {venues.map(venue => (
          <TouchableOpacity
            key={venue.id}
            onPress={() => setVenueFilter(venue.id)}
            style={{
              flex: 1, paddingVertical: theme.spacing[2], borderRadius: theme.spacing[2], alignItems: 'center',
              backgroundColor: venueFilter === venue.id ? theme.colors.primary[500] : 'transparent',
            }}
          >
            <Text style={{
              fontSize: theme.typography.fontSize.sm, fontWeight: venueFilter === venue.id ? '600' : '400',
              // Selected tab fills with bright brand green; text.inverse (dark navy)
              // is the readable on-green colour (plain white reads as low-contrast).
              color: venueFilter === venue.id ? theme.colors.text.inverse : theme.colors.text.secondary,
            }}>
              {venue.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    );
  };

  // Why there is nothing to swap: still loading, no swap account, or prices failed.
  const renderPairsNotice = () => {
    if (pairsLoading && tradingPairs.length === 0) {
      return <View style={styles.makerInfoRow}>
        <ActivityIndicator size="small" color={theme.colors.primary[500]} />
        <Text style={styles.makerInfoLabel}>Loading swap prices…</Text>
      </View>;
    }
    if (tradingPairs.length > 0) return null;
    const noAccount = !rgbConnected && !sparkConnected;
    const message = noAccount ? 'Swaps need Spark or your RGB Lightning node. Connect one to see prices.'
      : pairsFailed ? 'Swap prices could not be loaded.'
      : 'No swaps are available for your accounts right now.';
    return <View style={[styles.makerInfoRow, { flexWrap: 'wrap' }]}>
      <Ionicons name={noAccount ? 'link-outline' : 'cloud-offline-outline'} size={14} color={theme.colors.text.secondary} />
      <Text style={[styles.makerInfoLabel, { flex: 1 }]}>{message}</Text>
      <TouchableOpacity accessibilityRole="button" onPress={() => (noAccount ? navigation.navigate('Settings') : void loadTradingPairs())}>
        <Text style={[styles.makerInfoLabel, { color: theme.colors.primary[500] }]}>{noAccount ? 'Settings' : 'Retry'}</Text>
      </TouchableOpacity>
    </View>;
  };

  const liquidityShortfall = swapState.currentQuote ? quoteChannelShortfall(swapState.currentQuote, liquidity, quoteLegLabel) : null;

  const renderSwapInterface = () => (
    <View style={styles.swapContainer}>
      {renderPairsNotice()}
      {/* Venue filter tabs (Advanced only: Lite picks the best price for you) */}
      {policy.showRouteSelector && renderVenueFilter()}

      {/* KaleidoSwap maker provider — shows which maker is serving pairs so an
          empty pair list (e.g. "No trading pair found for BTC/USD") is debuggable. */}
      {policy.showRouteSelector && rgbConnected && venueFilter !== 'flashnet' && (
        <View style={styles.makerInfoRow}>
          <Ionicons name="server-outline" size={13} color={theme.colors.text.tertiary} />
          <Text style={styles.makerInfoLabel}>Maker</Text>
          <Text style={styles.makerInfoUrl} numberOfLines={1}>
            {makerProviderUrl || 'not configured'}
          </Text>
        </View>
      )}

      {/* From Section */}
      <View style={styles.swapInputContainer}>
        <View style={styles.swapInputHeader}>
          <Text style={styles.swapLabel}>You Pay</Text>
          {swapState.fromAsset && (
            <TouchableOpacity
              style={styles.maxButton}
              onPress={() => {
                if (assetByTicker(swapState.fromAsset)) dispatch(setFromAmount(maxSendable().toString()));
              }}
            >
              <Text style={styles.maxButtonText}>MAX</Text>
              <Text style={styles.balanceText}>
                {formatDisplayAmount(assetByTicker(swapState.fromAsset)?.balance || 0, swapState.fromAsset)} {unitLabelFor(swapState.fromAsset)}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.swapInputRow}>
          <TextInput
            value={swapState.fromAmount}
            onChangeText={(text) => {
              // Limit the quote input to the available balance for the selected
              // from-asset/network (same idea as the extension's clamp-to-max) and,
              // for maker swaps, to what the channels can send.
              const max = maxSendable();
              const n = parseFloat(text.replace(/,/g, ''));
              if (max > 0 && Number.isFinite(n) && n > max) {
                dispatch(setFromAmount(String(max)));
              } else {
                dispatch(setFromAmount(text));
              }
            }}
            placeholder="0"
            placeholderTextColor={theme.colors.text.tertiary}
            keyboardType="decimal-pad"
            style={styles.amountInput}
          />
          {renderTokenButton('from')}
        </View>
      </View>

      {/* Direction flip — a card-colored circle sitting in the seam between the
          two cards (mirrors the extension's swap_vert button). */}
      <View style={styles.swapArrowContainer} pointerEvents="box-none">
        <PressableScale
          style={styles.swapArrowButton}
          scaleTo={0.9}
          onPress={() => {
            feedback.tap();
            flipTurns.value = withSpring(flipTurns.value + 1, motion.springSnappy);
            dispatch(swapAssets());
          }}
          accessibilityRole="button"
          accessibilityLabel="Flip swap direction"
        >
          <Animated.View style={flipIconStyle}>
            <Ionicons name="swap-vertical" size={22} color={theme.colors.primary[500]} />
          </Animated.View>
        </PressableScale>
      </View>

      {/* To Section */}
      <View style={styles.swapInputContainer}>
        <View style={styles.swapInputHeader}>
          <Text style={styles.swapLabel}>You Receive</Text>
        </View>

        <View style={styles.swapInputRow}>
          {swapState.isQuoteLoading ? (
            <ActivityIndicator color={theme.colors.text.secondary} style={{ alignSelf: 'flex-start', marginLeft: 4, height: 48 }} />
          ) : (
            <Text style={[
              styles.amountText,
              !swapState.currentQuote?.to_amount && styles.amountTextPlaceholder
            ]}>
              {swapState.currentQuote?.to_amount ? formatDisplayAmount(swapState.currentQuote.to_amount, swapState.toAsset) : '0'}
            </Text>
          )}

          {renderTokenButton('to')}
        </View>
      </View>

      {providerOffers.length > 0 && <TouchableOpacity accessibilityRole="button" accessibilityLabel="Compare swap providers"
        onPress={() => setShowProviders(true)} style={styles.quoteInfoContainer}>
        <View style={styles.quoteInfoRow}><Text style={styles.quoteInfoLabel}>Provider</Text><Text style={styles.quoteInfoValue}>{swapProviderName(providerOffers.find(o => o.id === selectedProvider.current)?.pair ?? providerOffers[0].pair)} ›</Text></View>
        <Text style={styles.quoteInfoLabel}>{providerOffers.filter(o => o.quote).length} live quotes · Compare costs and accounts</Text>
      </TouchableOpacity>}
      {/* Quote Info & Fees (Accordion Style) */}
      {swapState.currentQuote && (
        <Animated.View entering={FadeInDown.duration(motion.duration.base)} style={styles.quoteInfoContainer}>
          <View style={styles.quoteInfoRow}>
            <Text style={styles.quoteInfoLabel}>Rate</Text>
            <Text style={styles.quoteInfoValue}>
              {swapRateLabel(swapState.currentQuote, bitcoinUnit)}
            </Text>
          </View>
          <View style={styles.quoteInfoRow}>
            <Text style={styles.quoteInfoLabel}>Swap fee</Text>
            <Text style={styles.quoteInfoValue}>
              {formatQuoteFee(swapState.currentQuote)}
            </Text>
          </View>
          {quoteSecsLeft != null && (
            <View style={styles.quoteInfoRow}>
              <Text style={styles.quoteInfoLabel}>Quote expires</Text>
              <View style={styles.expiryPill}>
                <Ionicons
                  name="time-outline"
                  size={13}
                  color={quoteSecsLeft <= 5 ? theme.colors.warning[500] : theme.colors.primary[500]}
                />
                <Text style={[styles.expiryText, quoteSecsLeft <= 5 && { color: theme.colors.warning[500] }]}>
                  {quoteSecsLeft > 0 ? `in ${quoteSecsLeft}s` : 'refreshing…'}
                </Text>
              </View>
            </View>
          )}
        </Animated.View>
      )}

      {!!liquidityShortfall && (
        <Callout tone="warning" title="Not enough channel liquidity" message={liquidityShortfall.charAt(0).toUpperCase() + liquidityShortfall.slice(1)} style={{ marginTop: theme.spacing[3] }} />
      )}

      {/* Main Action Button */}
      <Button
        title={swapState.isQuoteLoading ? 'Comparing quotes…' : (swapState.currentQuote ? 'Review swap' : Number(swapState.fromAmount) > 0 ? 'Refresh quotes' : 'Enter Amount')}
        onPress={() => {
          if (!swapState.currentQuote) { void getQuote(); return; }
          if (liquidityShortfall) return;
          setReviewQuote(swapState.currentQuote);
          setPreviousReviewQuote(null);
          setShowConfirmModal(true);
        }}
        disabled={swapState.isQuoteLoading || !!liquidityShortfall || !Number.isFinite(Number(swapState.fromAmount)) || Number(swapState.fromAmount) <= 0}
        loading={swapState.isQuoteLoading}
        variant="primary"
        fullWidth
        style={styles.getQuoteButton}
        size="lg"
      />
    </View>
  );

  const networkLabelFor = (ticker: string) =>
    ({ Spark: 'Spark', LN: 'Lightning', 'RGB-LN': 'RGB Lightning' } as const)[getAssetNetwork(filteredPairs, ticker)];

  const renderTokenButton = (side: 'from' | 'to') => {
    const ticker = side === 'from' ? swapState.fromAsset : swapState.toAsset;
    return (
      <PressableScale
        style={[styles.assetSelectorToken, !ticker && styles.assetSelectorTokenEmpty]}
        onPress={() => { feedback.tap(); setShowAssetPicker(side); }}
        accessibilityRole="button"
        accessibilityLabel={ticker ? `${side === 'from' ? 'Paying with' : 'Receiving'} ${ticker}. Change asset` : `Choose the asset you ${side === 'from' ? 'pay with' : 'receive'}`}
      >
        {ticker ? (
          <>
            {getAssetIcon(ticker)}
            <View>
              <Text style={styles.assetSelectorTokenText}>{ticker}</Text>
              <View style={styles.assetSelectorTokenNetworkRow}>
                {networkIconForLabel(networkLabelFor(ticker)) && <NetworkIcon network={networkIconForLabel(networkLabelFor(ticker))!} size={10} />}
                <Text style={styles.assetSelectorTokenNetwork}>{networkLabelFor(ticker)}</Text>
              </View>
            </View>
          </>
        ) : pairsLoading && tradingPairs.length === 0 ? (
          <ActivityIndicator size="small" color={theme.colors.text.inverse} accessibilityLabel="Loading assets" />
        ) : (
          <Text style={styles.selectAssetTokenText}>Choose asset</Text>
        )}
        <Ionicons name="chevron-down" size={16} color={ticker ? theme.colors.text.secondary : theme.colors.text.inverse} />
      </PressableScale>
    );
  };

  const renderAssetPicker = () => {
    const side = showAssetPicker;
    // Restrict choices to what's actually tradable: destinations must pair with
    // the current source; sources are any ticker present in a loaded pair. Falls
    // back to the full asset list before pairs have loaded.
    const tickers = side === 'to'
      ? tradableTickers(filteredPairs, swapState.fromAsset)
      : allTickers(filteredPairs);
    const pickerAssets = tickers.length
      ? tickers.map(t => assetByTicker(t)).filter((a): a is Asset => !!a)
      : availableAssets.map(a => assetByTicker(a.ticker) ?? a);
    const other = side === 'from' ? swapState.toAsset : swapState.fromAsset;

    return (
      <AssetSelector
        visible={!!side}
        onClose={() => setShowAssetPicker(null)}
        title={side === 'to' ? 'You receive' : 'You pay'}
        subtitle={side === 'to' && swapState.fromAsset ? `Assets you can get for ${swapState.fromAsset}` : 'Assets with a market right now'}
        quickPicks={['BTC', 'USDT']}
        selectedAssetId={pickerAssets.find(a => a.ticker === (side === 'from' ? swapState.fromAsset : swapState.toAsset))?.asset_id}
        assets={pickerAssets.map(asset => ({
          asset_id: asset.asset_id,
          ticker: asset.ticker,
          name: asset.ticker === other ? `Selected as ${side === 'from' ? 'what you receive' : 'what you pay'} · tap to flip` : asset.name,
          icon: asset.icon,
          precision: asset.precision,
          balance: asset.balance,
          network: networkLabelFor(asset.ticker),
          balanceLabel: `${formatDisplayAmount(asset.balance, asset.ticker)} ${unitLabelFor(asset.ticker)}`,
        }))}
        onSelect={asset => {
          // Swap state identifies assets by TICKER (matches findPair / the quote logic).
          // Picking the other side's asset flips the pair instead of making it X → X.
          if (asset.ticker === other) dispatch(swapAssets());
          else if (side === 'from') dispatch(setFromAsset(asset.ticker));
          else dispatch(setToAsset(asset.ticker));
        }}
      />
    );
  };

  const renderProgressSteps = () => {
    const pair = reviewQuote ? quotePairs.current.get(reviewQuote) : undefined;
    const flash = pair ? isFlashnetPair(pair) : false;
    const steps = flash
      ? [{ key: 'execute', label: 'Executing swap' }, { key: 'done', label: 'Completed' }]
      : [
          { key: 'init', label: 'Requesting swap' },
          { key: 'taker', label: 'Preparing channels' },
          { key: 'execute', label: 'Swapping' },
          { key: 'done', label: 'Completed' },
        ];
    const order = ['idle', 'init', 'taker', 'execute', 'done'];
    const currentIdx = order.indexOf(swapProgress);
    return (
      <View style={styles.progressSteps}>
        {steps.map((s, i) => {
          const stepIdx = order.indexOf(s.key);
          const done = currentIdx > stepIdx;
          const active = swapProgress === s.key;
          return (
            <View key={s.key} style={styles.progressStepRow}>
              <View style={[
                styles.progressDot,
                done && styles.progressDotDone,
                active && styles.progressDotActive,
              ]}>
                {done ? (
                  <Ionicons name="checkmark" size={14} color={theme.colors.text.inverse} />
                ) : active ? (
                  <ActivityIndicator size="small" color={theme.colors.text.inverse} />
                ) : (
                  <Text style={styles.progressDotNum}>{i + 1}</Text>
                )}
              </View>
              <Text style={[styles.progressStepLabel, (done || active) && { color: theme.colors.text.primary }]}>
                {s.label}
              </Text>
            </View>
          );
        })}
      </View>
    );
  };

  const finishSwap = () => {
    setSwapSuccess(null);
    setShowConfirmModal(false);
    setSwapProgress('idle');
    dispatch(resetSwap());
  };

  // Leave the failure view; the amount and pair stay for another go.
  const closeFailure = () => {
    setSwapFailure(null);
    setShowConfirmModal(false);
    setSwapProgress('idle');
    dispatch(setCurrentExecution(null));
    dispatch(clearError());
  };

  // Retry with a fresh quote: the failed one is spent or stale.
  const retrySwap = async () => {
    setSwapFailure(null);
    setSwapProgress('idle');
    dispatch(setCurrentExecution(null));
    const fresh = await getQuote();
    if (fresh) {
      setReviewQuote(fresh);
      setPreviousReviewQuote(null);
    } else {
      setShowConfirmModal(false);
    }
  };

  const renderConfirmBody = () => {
    // Failure screen: what happened in plain words, and a way to try again.
    if (swapFailure) {
      return (
        <View>
          <View style={{ alignItems: 'center', paddingVertical: theme.spacing[2] }}>
            <Animated.View entering={ZoomIn.springify().damping(motion.springSnappy.damping)}
              style={[styles.progressDot, styles.successDot, swapFailure.unconfirmed ? styles.progressDotPending : styles.progressDotFailed]}>
              <Ionicons name={swapFailure.unconfirmed ? 'time-outline' : 'close'} size={32} color={theme.colors.text.inverse} />
            </Animated.View>
            <Text style={styles.confirmTitle}>{swapFailure.title}</Text>
            <Text style={{ color: theme.colors.text.secondary, marginTop: theme.spacing[1.5], textAlign: 'center' }}>
              {swapFailure.message}
            </Text>
            <ExplainButton style={{ marginTop: theme.spacing[3] }}
              subject={{ type: 'error', context: 'swap', title: swapFailure.title, message: swapFailure.message }} />
          </View>
          <View style={[styles.confirmActions, { marginTop: theme.spacing[4] }]}>
            <Button title="Done" variant="secondary" onPress={closeFailure} style={styles.confirmActionButton} />
            {swapFailure.unconfirmed ? (
              // The first swap may still settle: no new swap from here.
              <Button title="View Activity" variant="primary" style={styles.confirmActionButton}
                onPress={() => { closeFailure(); navigation.navigate('Dashboard', { screen: 'Activity' }); }} />
            ) : (
              <Button title="Try again" variant="primary" onPress={retrySwap} style={styles.confirmActionButton} />
            )}
          </View>
        </View>
      );
    }

    // Success screen — shown for both venues once a swap settles.
    if (swapSuccess) {
      return (
        <View>
          <View style={{ alignItems: 'center', paddingVertical: theme.spacing[2] }}>
            <Animated.View entering={ZoomIn.springify().damping(motion.springSnappy.damping)}
              style={[styles.progressDot, styles.progressDotDone, styles.successDot]}>
              <Ionicons name="checkmark" size={32} color={theme.colors.text.inverse} />
            </Animated.View>
            <Text style={styles.confirmTitle}>Swap complete</Text>
            <Text style={{ color: theme.colors.text.secondary, marginTop: theme.spacing[1.5], textAlign: 'center' }}>
              {formatDisplayAmount(swapSuccess.fromAmount, swapSuccess.fromTicker)} {unitLabelFor(swapSuccess.fromTicker)}
              {'  →  '}
              {formatDisplayAmount(swapSuccess.toAmount, swapSuccess.toTicker)} {unitLabelFor(swapSuccess.toTicker)}
            </Text>
            {!!swapSuccess.txid && (
              <Text style={{ color: theme.colors.text.tertiary, marginTop: theme.spacing[2], fontSize: theme.typography.fontSize.xs }}>
                {swapSuccess.txid.substring(0, 18)}…
              </Text>
            )}
          </View>
          <Button title="Done" variant="primary" fullWidth style={{ marginTop: theme.spacing[4] }} onPress={finishSwap} />
        </View>
      );
    }

    if (!reviewQuote) return null;

    // currentQuote stores tickers (see from_asset: fromTicker in loadQuote).
    const fromTicker = reviewQuote.from_asset;
    const toTicker = reviewQuote.to_asset;

    const isFlashnet = reviewQuote.venue === 'flashnet';
    const pair = quotePairs.current.get(reviewQuote);
    const toPrecision = pair ? (pair.base.ticker === toTicker ? pair.base.precision : pair.quote.precision) : 8;
    const rawOut = reviewQuote.to_amount_raw ?? (isBtcTicker(toTicker)
      ? btcDisplayToSats(reviewQuote.to_amount) : Math.round(reviewQuote.to_amount * 10 ** toPrecision));
    const validOutput = Number.isSafeInteger(rawOut) && rawOut > 0;
    const minRaw = isFlashnet && validOutput ? minimumSwapOutput(rawOut, DEFAULT_FLASHNET_SLIPPAGE_BPS) : rawOut;
    const minDisplay = !isFlashnet ? reviewQuote.to_amount : isBtcTicker(toTicker) ? satsToBtcDisplay(minRaw) : minRaw / 10 ** toPrecision;
    const expired = quoteHasExpired(reviewQuote.expiry_timestamp);

    return (
      <View>
        {swapState.error && <Text style={styles.quoteChangeNotice}>{swapState.error}</Text>}

        {/* What leaves and what arrives, the two numbers that matter, at the top. */}
        <View style={styles.reviewHero}>
          <View style={styles.reviewLeg}>
            {getAssetIcon(fromTicker)}
            <View style={{ flex: 1 }}>
              <Text style={styles.reviewLegLabel}>You pay</Text>
              <AmountText style={styles.reviewLegAmount}>{formatDisplayAmount(reviewQuote.from_amount, fromTicker)} {unitLabelFor(fromTicker)}</AmountText>
            </View>
          </View>
          <View style={styles.reviewArrow}><Ionicons name="arrow-down" size={16} color={theme.colors.text.secondary} /></View>
          <View style={styles.reviewLeg}>
            {getAssetIcon(toTicker)}
            <View style={{ flex: 1 }}>
              <Text style={styles.reviewLegLabel}>You receive</Text>
              <AmountText style={[styles.reviewLegAmount, { color: theme.colors.primary[500] }]}>{formatDisplayAmount(reviewQuote.to_amount, toTicker)} {unitLabelFor(toTicker)}</AmountText>
            </View>
          </View>
        </View>

        {swapState.isExecuting ? (
          renderProgressSteps()
        ) : (
        <ScrollView style={{ maxHeight: Math.min(360, screenHeight * 0.4) }} contentContainerStyle={styles.confirmDetails}>
          {previousReviewQuote && (previousReviewQuote.to_amount !== reviewQuote.to_amount || previousReviewQuote.fee_amount !== reviewQuote.fee_amount) && (
            <Text style={styles.quoteChangeNotice} accessibilityLiveRegion="polite">
              Quote updated: {formatDisplayAmount(previousReviewQuote.to_amount, toTicker)} → {formatDisplayAmount(reviewQuote.to_amount, toTicker)} {unitLabelFor(toTicker)}. Fee: {formatQuoteFee(previousReviewQuote)} → {formatQuoteFee(reviewQuote)}. Review these changes before confirming.
            </Text>
          )}
          {pair && <View style={styles.confirmRow}>
            <Text style={styles.confirmLabel}>Provider</Text>
            <Text style={styles.confirmValue}>{swapProviderName(pair)} · {isFlashnetPair(pair) ? 'Spark' : 'RGB Lightning node'}</Text>
          </View>}
          <View style={styles.confirmRow}>
            <Text style={styles.confirmLabel}>Rate</Text>
            <Text style={styles.confirmValue}>
              {swapRateLabel(reviewQuote, bitcoinUnit)}
            </Text>
          </View>
          <View style={styles.confirmRow}>
            <Text style={styles.confirmLabel}>Fee</Text>
            <Text style={styles.confirmValue}>
              {formatQuoteFee(reviewQuote)}
            </Text>
          </View>
          <View style={styles.confirmRow}>
            <Text style={styles.confirmLabel}>Minimum received</Text>
            <Text style={styles.confirmValue}>{validOutput ? `${formatDisplayAmount(minDisplay, toTicker)} ${unitLabelFor(toTicker)}` : 'Unavailable'}</Text>
          </View>
          <View style={styles.confirmRow}>
            <Text style={styles.confirmLabel}>Slippage tolerance</Text>
            <Text style={styles.confirmValue}>{isFlashnet ? `${DEFAULT_FLASHNET_SLIPPAGE_BPS / 100}%` : 'Fixed quote'}</Text>
          </View>
          <View style={styles.confirmRow}>
            <Text style={styles.confirmLabel}>Quote expires</Text>
            <Text style={[styles.confirmValue, expired && { color: theme.colors.warning[500] }]}>{expired ? 'Expired — refresh to continue' : `In ${quoteSecsLeft ?? Math.ceil((reviewQuote.expiry_timestamp - Date.now()) / 1000)}s`}</Text>
          </View>
        </ScrollView>
        )}

        {!swapState.isExecuting && (
          <View style={styles.confirmActions}>
            <Button
              title="Cancel"
              variant="secondary"
              onPress={() => setShowConfirmModal(false)}
              style={styles.confirmActionButton}
            />
            <Button
              title={expired ? 'Refresh quote' : 'Confirm swap'}
              variant="primary"
              onPress={expired ? refreshReviewQuote : executeSwap}
              loading={swapState.isQuoteLoading}
              disabled={swapState.isQuoteLoading || !validOutput}
              style={styles.confirmActionButton}
            />
          </View>
        )}
      </View>
    );
  };

  const renderConfirmModal = () => (
    <Sheet
      visible={!!swapSuccess || !!swapFailure || (showConfirmModal && !!reviewQuote)}
      title={swapSuccess || swapFailure ? undefined : swapState.isExecuting ? 'Swapping…' : 'Review swap'}
      onClose={() => {
        // A running swap can't be walked away from mid-step; the sheet stays until it settles.
        if (swapState.isExecuting) return;
        if (swapSuccess) finishSwap();
        else if (swapFailure) closeFailure();
        else setShowConfirmModal(false);
      }}
    >
      {renderConfirmBody()}
    </Sheet>
  );

  const renderExecutionStatus = () => {
    if (!swapState.currentExecution) return null;

    return (
      <Card style={styles.statusCard}>
        <Text style={styles.statusTitle}>Swap Status</Text>
        <View style={styles.statusContent}>
          <View style={styles.statusRow}>
            <Text style={styles.statusLabel}>Status:</Text>
            <Text style={[styles.statusValue, { color: swapStatusVisual(swapState.currentExecution.status).color }]}>
              {swapStatusVisual(swapState.currentExecution.status).label}
            </Text>
          </View>

          {swapState.currentExecution.status === 'failed' && !!swapState.currentExecution.error_message && (
            <View style={styles.statusRow}>
              <Text style={styles.statusLabel}>Reason:</Text>
              <Text style={[styles.statusValue, { color: theme.colors.error[500], flexShrink: 1, textAlign: 'right' }]}>
                {swapState.currentExecution.error_message}
              </Text>
            </View>
          )}

          {swapState.currentExecution.txid && (
            <View style={styles.statusRow}>
              <Text style={styles.statusLabel}>Transaction:</Text>
              <Text style={styles.statusValue}>
                {swapState.currentExecution.txid.substring(0, 16)}...
              </Text>
            </View>
          )}

          {swapState.currentExecution.status === 'executing' && (
            <View style={styles.statusProgress}>
              <ActivityIndicator size="small" color={theme.colors.primary[500]} />
              <Text style={styles.statusProgressText}>Processing swap...</Text>
            </View>
          )}
        </View>

        {(swapState.currentExecution.status === 'completed' || swapState.currentExecution.status === 'failed') && (
          <Button
            title="New Swap"
            variant="primary"
            onPress={() => dispatch(resetSwap())}
            style={styles.newSwapButton}
          />
        )}
      </Card>
    );
  };

  return (
    <View style={styles.container}>
      <MainHeader
        title="Swap Assets"
        onBack={() => navigation.goBack()}
        rightAction={
          <TouchableOpacity
            style={styles.helpButton}
            accessibilityRole="button"
            accessibilityLabel="How swaps work"
            onPress={() => Alert.alert('Swaps', 'Exchange bitcoin for your other assets, or back. You see the price and every fee before you confirm, and the swap either completes in full or not at all.')}
          >
            <Ionicons name="help-circle-outline" size={20} color={theme.colors.text.primary} />
          </TouchableOpacity>
        }
      />

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {swapState.error && (
          <Card style={styles.errorCard}>
            <View style={styles.errorContent}>
              <Ionicons name="warning-outline" size={20} color={theme.colors.error[500]} />
              <Text style={styles.errorText}>{swapState.error}</Text>
              <TouchableOpacity onPress={() => dispatch(clearError())}>
                <Ionicons name="close" size={20} color={theme.colors.error[500]} />
              </TouchableOpacity>
            </View>
          </Card>
        )}

        {renderSwapInterface()}
        {renderExecutionStatus()}
      </ScrollView>

      {renderAssetPicker()}
      {renderConfirmModal()}
      <ProviderSheet visible={showProviders} selectedId={selectedProvider.current} onClose={() => setShowProviders(false)}
        options={providerOffers.map(o => ({ id: o.id, name: swapProviderName(o.pair), account: policy.showNetworks ? (isFlashnetPair(o.pair) ? 'Spark' : 'RGB Lightning node') : undefined,
          amountLabel: 'You receive', amount: o.quote ? `${formatDisplayAmount(o.quote.to_amount, o.quote.to_asset)} ${unitLabelFor(o.quote.to_asset)}` : 'Unavailable',
          detail: o.quote ? `Fee ${formatQuoteFee(o.quote)}` : '',
          unavailable: o.unavailable, expiresAt: o.quote?.expiry_timestamp, recommended: bestSwapOffer(providerOffers)?.id === o.id }))}
        onSelect={id => { const chosen = providerOffers.find(o => o.id === id); if (!chosen?.quote || quoteHasExpired(chosen.quote.expiry_timestamp)) return;
          quoteRequestRef.current++; dispatch(setQuoteLoading(false)); selectedProvider.current = id; dispatch(clearError()); dispatch(setCurrentQuote(chosen.quote)); }} />
    </View>
  );
}

const styles = StyleSheet.create({
  quoteChangeNotice: { color: theme.colors.warning[500], fontSize: theme.typography.fontSize.sm, lineHeight: 20, marginBottom: theme.spacing[3] },
  container: {
    flex: 1,
    backgroundColor: theme.colors.background.secondary,
  },

  scrollView: {
    flex: 1,
  },

  helpButton: {
    // Mirrors MainHeader's `iconBtn` so the two header controls are one shape.
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: theme.colors.surface.secondary,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border.light,
    alignItems: 'center',
    justifyContent: 'center',
  },

  scrollContent: {
    paddingHorizontal: theme.spacing[5],
    paddingTop: theme.spacing[4],
    paddingBottom: theme.spacing[6],
  },

  errorCard: {
    marginBottom: theme.spacing[4],
    backgroundColor: theme.colors.error[50],
    borderWidth: 1,
    // error[100] is the dark-theme translucent red tint; [200] is a light-theme
    // value that reads as a bright pink border on the dark canvas.
    borderColor: theme.colors.error[100],
  },

  errorContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[3],
    padding: theme.spacing[3],
  },

  errorText: {
    flex: 1,
    fontSize: theme.typography.fontSize.sm,
    // error[700] is a light-theme dark red; error[500] is the on-dark readable red.
    color: theme.colors.error[500],
  },

  swapContainer: {
    gap: theme.spacing[2],
  },

  makerInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[1.5],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderRadius: theme.borderRadius.base,
    backgroundColor: theme.colors.background.secondary,
  },
  makerInfoLabel: {
    fontSize: theme.typography.fontSize.xs,
    fontWeight: theme.typography.fontWeight.semibold,
    color: theme.colors.text.tertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  makerInfoUrl: {
    flex: 1,
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.text.secondary,
  },

  swapInputContainer: {
    backgroundColor: theme.colors.surface.primary,
    borderRadius: theme.borderRadius['2xl'],
    padding: theme.spacing[4],
  },

  swapInputHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing[3],
  },

  swapLabel: {
    fontSize: theme.typography.fontSize.sm,
    fontWeight: '500',
    color: theme.colors.text.secondary,
  },

  maxButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[2],
  },

  maxButtonText: {
    fontSize: theme.typography.fontSize.xs,
    fontWeight: '700',
    // primary[600] is a light-theme dark green; primary[500] is the on-dark accent.
    color: theme.colors.primary[500],
    backgroundColor: theme.colors.primary[50],
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 2,
    borderRadius: theme.borderRadius.sm,
  },

  balanceText: {
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.text.tertiary,
  },

  swapInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing[3],
  },

  amountInputWrapper: {
    flex: 1,
    marginBottom: 0,
  },

  amountInput: {
    flex: 1,
    fontSize: 28,
    fontWeight: '600',
    color: theme.colors.text.primary,
    paddingHorizontal: 0,
    backgroundColor: 'transparent',
    borderWidth: 0,
    height: 48,
  },

  amountText: {
    flex: 1,
    fontSize: 28,
    fontWeight: '600',
    color: theme.colors.text.primary,
  },

  amountTextPlaceholder: {
    color: theme.colors.text.tertiary,
  },

  assetSelectorToken: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.background.tertiary,
    borderWidth: 1,
    borderColor: theme.colors.border.light,
    paddingVertical: theme.spacing[1.5],
    paddingLeft: theme.spacing[1.5],
    paddingRight: theme.spacing[3],
    borderRadius: theme.borderRadius.full,
    gap: theme.spacing[2],
    minHeight: 44,
  },

  assetSelectorTokenEmpty: {
    backgroundColor: theme.colors.primary[500],
    borderColor: theme.colors.primary[500],
    paddingLeft: theme.spacing[4],
  },

  assetSelectorTokenNetworkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    marginTop: -1,
  },
  assetSelectorTokenNetwork: {
    fontSize: 10,
    color: theme.colors.text.tertiary,
  },

  assetSelectorTokenText: {
    fontSize: theme.typography.fontSize.base,
    fontWeight: '600',
    color: theme.colors.text.primary,
  },

  selectAssetTokenText: {
    fontSize: theme.typography.fontSize.base,
    fontWeight: '600',
    color: theme.colors.text.inverse,
  },

  // In-flow, centered in the seam between the two cards (overlapping both via
  // negative margins) so it always sits at the true divider — no fragile %.
  swapArrowContainer: {
    alignSelf: 'center',
    marginTop: -18,
    marginBottom: -18,
    zIndex: 10,
  },

  swapArrowButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: theme.colors.surface.elevated,
    alignItems: 'center',
    justifyContent: 'center',
    ...theme.shadows.md,
  },

  quoteInfoContainer: {
    padding: theme.spacing[4],
    backgroundColor: theme.colors.primary[50],
    borderRadius: theme.borderRadius.xl,
    gap: theme.spacing[2],
  },

  quoteInfoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },

  quoteInfoLabel: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.text.secondary,
  },

  quoteInfoValue: {
    fontSize: theme.typography.fontSize.sm,
    fontWeight: '600',
    color: theme.colors.text.primary,
  },

  getQuoteButton: {
    marginTop: theme.spacing[2],
  },

  // Status Styles
  statusCard: {
    padding: theme.spacing[4],
    borderRadius: theme.borderRadius['2xl'],
  },

  statusTitle: {
    fontSize: theme.typography.fontSize.lg,
    fontWeight: '600',
    color: theme.colors.text.primary,
    marginBottom: theme.spacing[3],
  },

  statusContent: {
    marginBottom: theme.spacing[4],
  },

  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing[2],
  },

  statusLabel: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.text.secondary,
  },

  statusValue: {
    fontSize: theme.typography.fontSize.sm,
    fontWeight: '600',
    color: theme.colors.text.primary,
  },

  statusProgress: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[2],
    marginTop: theme.spacing[3],
    backgroundColor: theme.colors.primary[50],
    padding: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
  },

  statusProgressText: {
    fontSize: theme.typography.fontSize.sm,
    // primary[700] is a light-theme dark green; primary[500] reads on dark.
    color: theme.colors.primary[500],
    fontWeight: '500',
  },

  newSwapButton: {
    marginTop: theme.spacing[2],
  },


  successDot: { width: 56, height: 56, borderRadius: theme.borderRadius.full, marginBottom: theme.spacing[3] },

  reviewHero: {
    backgroundColor: theme.colors.background.secondary,
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border.light,
    padding: theme.spacing[4],
    marginBottom: theme.spacing[4],
  },

  reviewLeg: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing[3] },

  reviewLegLabel: { fontSize: theme.typography.fontSize.xs, color: theme.colors.text.tertiary },

  reviewLegAmount: { fontSize: theme.typography.fontSize.xl, fontWeight: '700', color: theme.colors.text.primary },

  reviewArrow: {
    width: 28,
    height: 28,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surface.primary,
    borderWidth: 1,
    borderColor: theme.colors.border.light,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: theme.spacing[1.5],
    marginLeft: 0,
  },


  confirmTitle: {
    fontSize: theme.typography.fontSize.xl,
    fontWeight: '700',
    color: theme.colors.text.primary,
    textAlign: 'center',
    marginBottom: theme.spacing[5],
  },

  confirmDetails: {
    marginBottom: theme.spacing[5],
  },

  confirmRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: theme.spacing[2],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border.light,
  },

  confirmLabel: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.text.secondary,
  },

  confirmValue: {
    fontSize: theme.typography.fontSize.sm,
    fontWeight: '600',
    color: theme.colors.text.primary,
  },

  confirmActions: {
    flexDirection: 'row',
    gap: theme.spacing[3],
  },

  confirmActionButton: {
    flex: 1,
  },

  expiryPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },

  expiryText: {
    fontSize: theme.typography.fontSize.sm,
    fontWeight: '600',
    color: theme.colors.primary[500],
  },

  progressSteps: {
    gap: theme.spacing[4],
    marginVertical: theme.spacing[5],
  },

  progressStepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[3],
  },

  progressDot: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: theme.colors.surface.tertiary,
    borderWidth: 1,
    borderColor: theme.colors.border.medium,
    alignItems: 'center',
    justifyContent: 'center',
  },

  progressDotActive: {
    backgroundColor: theme.colors.primary[500],
    borderColor: theme.colors.primary[500],
  },

  progressDotDone: {
    backgroundColor: theme.colors.success[500],
    borderColor: theme.colors.success[500],
  },

  progressDotFailed: {
    backgroundColor: theme.colors.error[500],
    borderColor: theme.colors.error[500],
  },

  progressDotPending: {
    backgroundColor: theme.colors.warning[500],
    borderColor: theme.colors.warning[500],
  },

  progressDotNum: {
    fontSize: theme.typography.fontSize.sm,
    fontWeight: '700',
    color: theme.colors.text.tertiary,
  },

  progressStepLabel: {
    fontSize: theme.typography.fontSize.base,
    fontWeight: '500',
    color: theme.colors.text.tertiary,
  },
}); 
