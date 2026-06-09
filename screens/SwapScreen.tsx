// screens/SwapScreen.tsx
import React, { useState, useEffect, useCallback } from 'react';
import {
  TextInput,
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
import { useDispatch, useSelector } from 'react-redux';
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
import { getAssetDisplayBalance } from '../utils/assetAmount';
import {
  SwapPair, SwapVenueFilter, SwapProgress,
  findPair, allTickers, tradableTickers, findPairAsset,
  getAssetId, isBtcTicker, getQuoteLayers, isFlashnetPair,
  normalizeMakerPairs, buildFlashnetPairs, validateSwapString,
  QUOTE_DEBOUNCE_MS, QUOTE_REFRESH_MS, DEFAULT_FLASHNET_SLIPPAGE_BPS,
} from '../utils/swap-model';
import { BTC_ASSET_PUBKEY } from '../utils/flashnet';
import { theme } from '../theme';
import { feedback } from '../utils/feedback';
import { swapStatusVisual } from '../utils/paymentStatus';
import { Card, Button, Input, MainHeader, AssetIcon } from '../components';

interface Props {
  navigation: any;
}

interface Asset {
  asset_id: string;
  ticker: string;
  name: string;
  balance: number;
  icon?: string;
  precision?: number;
}

export default function SwapScreen({ navigation }: Props) {
  const dispatch = useDispatch();
  const swapState = useSelector((state: RootState) => state.swap);
  const walletState = useSelector((state: RootState) => state.wallet);
  const assetsState = useSelector((state: RootState) => state.assets);
  const rgbAssets = (assetsState?.rgbAssets || []);
  // The wallet is sats-first by default. The BTC-side amount field is therefore
  // entered/shown in this unit — NOT BTC. Treating the input as BTC (the old
  // behaviour) multiplied every BTC swap amount by 1e8, blowing past the maker's
  // max and silently returning no quote.
  const bitcoinUnit = useSelector((state: RootState) => state.settings?.bitcoinUnit || 'sats');

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

  const [showAssetPicker, setShowAssetPicker] = useState<'from' | 'to' | null>(null);
  const [availableAssets, setAvailableAssets] = useState<Asset[]>([]);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [pollingInterval, setPollingInterval] = useState<NodeJS.Timeout | null>(null);
  const [tradingPairs, setTradingPairs] = useState<SwapPair[]>([]);
  const [venueFilter, setVenueFilter] = useState<SwapVenueFilter>('all');
  const [swapProgress, setSwapProgress] = useState<SwapProgress>('idle');
  const [pairsLoading, setPairsLoading] = useState(false);
  const [quoteSecsLeft, setQuoteSecsLeft] = useState<number | null>(null);
  // Set once a swap settles so the confirm modal shows a success screen instead
  // of silently closing (the Flashnet path had no confirmation at all).
  const [swapSuccess, setSwapSuccess] = useState<
    { fromAmount: number; fromTicker: string; toAmount: number; toTicker: string; txid?: string } | null
  >(null);

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
  };

  // Build a history entry from a settled quote so swaps (both venues) show up in
  // the History screen with real amounts.
  const recordSwapHistory = (
    q: SwapQuote,
    status: SwapExecution['status'],
    txid?: string,
    swapString?: string,
  ) => {
    dispatch(addToHistory({
      rfq_id: q.rfq_id,
      swap_string: swapString || '',
      status,
      created_at: Date.now(),
      updated_at: Date.now(),
      txid,
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
    if (!swapState.toAsset) dispatch(setToAsset('USDT'));
  }, []);

  // Clear polling interval on unmount
  useEffect(() => {
    return () => {
      if (pollingInterval) {
        clearInterval(pollingInterval);
      }
    };
  }, [pollingInterval]);

  // Auto-Quote Logic
  useEffect(() => {
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

    return () => clearTimeout(timer);
  }, [swapState.fromAmount, swapState.fromAsset, swapState.toAsset]);

  // Always-fresh handle to getQuote for use inside intervals (avoids stale closures).
  const getQuoteRef = React.useRef<() => void>(() => {});

  // Live quote expiry countdown + auto-refresh (mirrors the extension's behaviour:
  // quotes are short-lived, so we tick a countdown and refresh as it ages out).
  useEffect(() => {
    const q = swapState.currentQuote;
    if (!q || swapState.isExecuting || showConfirmModal) {
      setQuoteSecsLeft(null);
      return;
    }
    let lastRefresh = Date.now();
    const tick = () => {
      const left = Math.max(0, Math.round((q.expiry_timestamp - Date.now()) / 1000));
      setQuoteSecsLeft(left);
      const aged = Date.now() - lastRefresh >= QUOTE_REFRESH_MS;
      if (left <= 0 || aged) {
        lastRefresh = Date.now();
        getQuoteRef.current?.();
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [swapState.currentQuote, swapState.isExecuting, showConfirmModal]);

  const loadTradingPairs = async () => {
    setPairsLoading(true);
    try {
      let makerPairs: SwapPair[] = [];
      let flashnetPairs: SwapPair[] = [];

      // Load Kaleidoswap pairs (via RGB adapter / kaleido-sdk maker)
      try {
        const rgbAdapter = protocolManager.getAdapterIfAvailable('RGB');
        if (rgbAdapter?.isConnected()) {
          const client = kaleidoClientManager.getClient();
          const rawPairs = await client.maker.listPairs();
          makerPairs = normalizeMakerPairs((rawPairs as any)?.pairs || rawPairs || []);
          console.log(`[SwapScreen] Loaded ${makerPairs.length} Kaleidoswap pairs`);
        }
      } catch (err) {
        console.warn('[SwapScreen] Failed to load Kaleidoswap pairs:', err);
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
          const sparkInventory = (rgbAssets || []).map((a: any) => ({
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
      }

      setTradingPairs([...makerPairs, ...flashnetPairs]);
    } catch (error) {
      console.error('[SwapScreen] Failed to load trading pairs:', error);
    } finally {
      setPairsLoading(false);
    }
  };

  const loadAvailableAssets = () => {
    try {
      // Keyed by ticker so held-asset balances win over pair-derived placeholders.
      const byTicker = new Map<string, Asset>();
      byTicker.set('BTC', {
        asset_id: 'BTC',
        ticker: 'BTC',
        name: 'Bitcoin',
        // Balance is in the active BTC unit (sats by default) so the MAX
        // button and the amount field agree with how the input is parsed.
        balance: satsToBtcDisplay(walletState?.btcBalance?.vanilla?.spendable || 0),
        precision: bitcoinUnit === 'sats' ? 0 : 8,
      });
      for (const asset of rgbAssets as any[]) {
        byTicker.set(asset.ticker, {
          asset_id: asset.asset_id,
          ticker: asset.ticker,
          name: asset.name,
          balance: getAssetDisplayBalance(asset.balance, asset.precision || 0),
          precision: asset.precision,
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
  }, [tradingPairs, rgbAssets, walletState?.btcBalance?.vanilla?.spendable, bitcoinUnit]);

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
    try {
      if (!swapState.fromAmount) return;

      dispatch(setQuoteLoading(true));
      dispatch(clearError());

      const fromAmount = parseFloat(swapState.fromAmount);
      const fromTicker = swapState.fromAsset || 'BTC';
      const toTicker = swapState.toAsset || 'USDT';

      // Find the matching pair
      const pair = findPair(filteredPairs, fromTicker, toTicker);

      if (!pair) {
        dispatch(setError(`No trading pair found for ${fromTicker}/${toTicker}`));
        return;
      }

      if (isFlashnetPair(pair)) {
        // Flashnet: simulate the swap against the pool to get a real output amount.
        try {
          const client = flashnetClientManager.getClient();
          const poolId = pair.poolId || flashnetClientManager.getPoolId();
          const fromAssetSide = pair.base.ticker === fromTicker ? pair.base : pair.quote;
          const toAssetSide = pair.base.ticker === toTicker ? pair.base : pair.quote;
          const fromAssetId = getAssetId(fromAssetSide);
          const toAssetId = getAssetId(toAssetSide);
          const fromPrecision = fromAssetSide.precision;
          const toPrecision = toAssetSide.precision;
          // Flashnet settles in sats (not msats). BTC input is in the active unit.
          const rawAmount = isBtcTicker(fromTicker) ? btcDisplayToSats(fromAmount) : Math.round(fromAmount * Math.pow(10, fromPrecision));

          let toAmount = 0;
          let toAmountRaw = 0;
          let feeAmount = 0;
          let rate = 0;
          try {
            const sim: any = await client.simulateSwap({
              poolId,
              assetInAddress: fromAssetId,
              assetOutAddress: toAssetId,
              amountIn: String(rawAmount),
              maxSlippageBps: DEFAULT_FLASHNET_SLIPPAGE_BPS,
            });
            const rawOut = Number(sim?.amountOut ?? sim?.amount_out ?? 0);
            toAmountRaw = rawOut;
            toAmount = isBtcTicker(toTicker) ? satsToBtcDisplay(rawOut) : rawOut / Math.pow(10, toPrecision);
            const rawFee = Number(sim?.feePaidAssetIn ?? sim?.fee_paid_asset_in ?? 0);
            feeAmount = isBtcTicker(fromTicker) ? satsToBtcDisplay(rawFee) : rawFee / Math.pow(10, fromPrecision);
            rate = fromAmount > 0 ? toAmount / fromAmount : Number(sim?.executionPrice ?? 0);
          } catch (simErr) {
            console.warn('[SwapScreen] Flashnet simulate failed, showing estimate:', simErr);
          }

          const quote: SwapQuote = {
            rfq_id: `flashnet-${Date.now()}`,
            from_asset: fromTicker,
            to_asset: toTicker,
            from_amount: fromAmount,
            to_amount: toAmount,
            fee_amount: feeAmount,
            exchange_rate: rate,
            expiry_timestamp: Date.now() + 30000,
            maker_pubkey: poolId || '',
            venue: 'flashnet',
            from_asset_id: fromAssetId,
            to_asset_id: toAssetId,
            // Flashnet works in sats (not msats): rawAmount is the exact input,
            // and the simulated output in smallest units (used verbatim on execute).
            from_amount_raw: rawAmount,
            to_amount_raw: toAmountRaw,
          };

          dispatch(setCurrentQuote(quote));
        } catch (err) {
          console.error('[SwapScreen] Flashnet quote failed:', err);
          dispatch(setError('Failed to get Flashnet quote'));
        }
      } else {
        // Kaleidoswap: real quote via maker API (requires RGB node)
        try {
          if (!kaleidoClientManager.isInitialized()) {
            dispatch(setError('KaleidoSwap requires an RGB node connection. Please configure in Settings.'));
            return;
          }
          const rgbAdapter = protocolManager.getAdapter('RGB');
          const fromAsset = pair.base.ticker === fromTicker ? pair.base : pair.quote;
          const toAsset = pair.base.ticker === toTicker ? pair.base : pair.quote;
          const fromAssetId = getAssetId(fromAsset);
          const toAssetId = getAssetId(toAsset);
          const fromPrecision = fromAsset.precision;
          // BTC input is in the active unit (sats by default); the maker quotes
          // the BTC leg in msats. sats → msats is ×1000.
          const rawFromAmount = isBtcTicker(fromTicker)
            ? btcDisplayToSats(fromAmount) * 1000 // active unit → sats → msats
            : Math.round(fromAmount * Math.pow(10, fromPrecision));

          const { fromLayer, toLayer } = getQuoteLayers(pair, fromAssetId, toAssetId);

          const client = kaleidoClientManager.getClient();
          const quoteResponse = await client.maker.getQuote({
            from_asset: { asset_id: fromAssetId, layer: fromLayer as any, amount: rawFromAmount },
            to_asset: { asset_id: toAssetId, layer: toLayer as any },
          }) as any;

          // Raw, maker-quoted integers (smallest units). The maker echoes the
          // exact legs it will encode into the swapstring; keep these verbatim
          // for initSwap + swapstring validation (re-deriving from the rounded
          // display amount is what previously broke execution).
          const rawToAmount = Number(quoteResponse.to_asset?.amount || 0);
          const rawFromAmountQuoted = Number(quoteResponse.from_asset?.amount || rawFromAmount);
          const quotedFromAssetId = quoteResponse.from_asset?.asset_id || fromAssetId;
          const quotedToAssetId = quoteResponse.to_asset?.asset_id || toAssetId;
          const toPrecision = toAsset.precision;
          const displayToAmount = isBtcTicker(toTicker)
            ? satsToBtcDisplay(rawToAmount / 1000) // msats → sats → active unit
            : rawToAmount / Math.pow(10, toPrecision);

          const quote: SwapQuote = {
            rfq_id: quoteResponse.rfq_id || `kaleido-${Date.now()}`,
            from_asset: fromTicker,
            to_asset: toTicker,
            from_amount: fromAmount,
            to_amount: parseFloat(displayToAmount.toFixed(toPrecision)),
            fee_amount: quoteResponse.fee?.final_fee || 0,
            exchange_rate: quoteResponse.price || 0,
            expiry_timestamp: quoteResponse.expires_at ? quoteResponse.expires_at * 1000 : Date.now() + 60000,
            maker_pubkey: quoteResponse.maker_pubkey || '',
            from_asset_id: quotedFromAssetId,
            to_asset_id: quotedToAssetId,
            from_amount_raw: rawFromAmountQuoted,
            to_amount_raw: rawToAmount,
          };

          dispatch(setCurrentQuote(quote));
        } catch (err: any) {
          console.error('[SwapScreen] Kaleidoswap quote failed:', err);
          dispatch(setError(err?.message || 'Failed to get quote'));
        }
      }
    } catch (error) {
      console.error('Failed to get quote:', error);
      dispatch(setError('Failed to fetch quote'));
    } finally {
      dispatch(setQuoteLoading(false));
    }
  };

  // Keep the interval's handle pointing at the latest getQuote.
  getQuoteRef.current = getQuote;

  const executeSwap = async () => {
    if (!swapState.currentQuote) return;
    const quote = swapState.currentQuote;

    try {
      dispatch(setExecuting(true));

      // Detect venue from the pair
      const pair = findPair(filteredPairs, quote.from_asset, quote.to_asset);

      if (pair && isFlashnetPair(pair)) {
        // ── Flashnet execution (single step) ──
        setSwapProgress('execute');
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
          ? quote.to_amount * 1e8
          : quote.to_amount * Math.pow(10, toPrecision));

        const result = await client.executeSwap({
          poolId,
          assetInAddress: fromAssetId,
          assetOutAddress: toAssetId,
          amountIn: String(rawAmount),
          // Floor the output at 95% of the quote to bound slippage, matching
          // rate-extension (a `minAmountOut` of '0' offered no protection).
          minAmountOut: String(Math.floor(rawToAmount * 0.95)),
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
          throw new Error('KaleidoSwap requires an RGB node connection.');
        }
        const client = kaleidoClientManager.getClient();
        const fromAsset = pair ? (pair.base.ticker === quote.from_asset ? pair.base : pair.quote) : null;
        const toAsset = pair ? (pair.base.ticker === quote.to_asset ? pair.base : pair.quote) : null;
        const fromPrecision = fromAsset?.precision || 8;
        const toPrecision = toAsset?.precision || 8;
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

        // Step 1: Init swap. The maker SDK's SwapRequest is a FLAT shape
        // ({ rfq_id, from_asset, from_amount, to_asset, to_amount }) — passing a
        // nested { asset_id, amount, layer } object (as the old `as any` cast
        // did) sent the asset as an object and the amounts as undefined, so the
        // swap never initialised. Mirrors rate-extension's INIT_SWAP route.
        setSwapProgress('init');
        const initResult = await client.maker.initSwap({
          rfq_id: quote.rfq_id,
          from_asset: fromAssetId,
          from_amount: rawFromAmount,
          to_asset: toAssetId,
          to_amount: rawToAmount,
        }) as any;

        const swapstring = initResult?.swapstring || initResult?.swap_string || '';
        const paymentHash = initResult?.payment_hash || '';

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

        // Start polling for final status
        startStatusPolling(quote.rfq_id);
      }
    } catch (error) {
      console.error('Swap execution failed:', error);
      setSwapProgress('idle');
      dispatch(updateExecutionStatus({
        rfq_id: quote.rfq_id,
        status: 'failed',
        error_message: error instanceof Error ? error.message : 'Swap execution failed',
      }));
      dispatch(setExecuting(false));
    }
  };

  const startStatusPolling = (rfqId: string) => {
    let pollCount = 0;
    const maxPolls = 20;

    const interval = setInterval(async () => {
      try {
        pollCount++;

        // Poll via kaleido-sdk maker API
        const rgbAdapter = protocolManager.getAdapterIfAvailable('RGB');
        if (!rgbAdapter?.isConnected()) {
          console.warn('[SwapScreen] RGB adapter not connected, stopping poll');
          clearInterval(interval);
          return;
        }

        let status: any;
        try {
          status = await rgbAdapter.getSwapStatus?.(rfqId);
        } catch {
          // Swap status not available yet
          if (pollCount >= maxPolls) {
            dispatch(updateExecutionStatus({ rfq_id: rfqId, status: 'failed', error_message: 'Swap timed out' }));
            clearInterval(interval);
            setPollingInterval(null);
            setShowConfirmModal(false);
            dispatch(setExecuting(false));
          }
          return;
        }

        const swapStatus = status?.status || 'pending';

        if (swapStatus === 'confirmed' || swapStatus === 'completed' || swapStatus === 'failed') {
          if (swapStatus === 'failed') feedback.error();
          else feedback.swap();
          dispatch(updateExecutionStatus({
            rfq_id: rfqId,
            status: swapStatus === 'failed' ? 'failed' : 'completed',
            error_message: swapStatus === 'failed' ? 'Swap failed' : undefined,
          }));

          // Record an enriched history entry (amounts/tickers from the quote).
          if (swapState.currentQuote) {
            recordSwapHistory(
              swapState.currentQuote,
              swapStatus === 'failed' ? 'failed' : 'completed',
              swapState.currentExecution?.txid,
              swapState.currentExecution?.swap_string,
            );
          } else if (swapState.currentExecution) {
            dispatch(addToHistory({
              ...swapState.currentExecution,
              status: swapStatus === 'failed' ? 'failed' : 'completed',
            }));
          }

          clearInterval(interval);
          setPollingInterval(null);
          dispatch(setExecuting(false));
          if (swapStatus === 'failed') {
            setShowConfirmModal(false);
          } else {
            const q = swapState.currentQuote;
            if (q) {
              setSwapSuccess({
                fromAmount: q.from_amount,
                fromTicker: q.from_asset,
                toAmount: q.to_amount,
                toTicker: q.to_asset,
                txid: swapState.currentExecution?.txid,
              });
            }
          }
          refreshAfterSwap();
        }
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
  const assetByTicker = (ticker: string) =>
    availableAssets.find(a => a.ticker === ticker);



  const rgbConnected = protocolManager.getAdapterIfAvailable('RGB')?.isConnected() ?? false;
  const sparkConnected = protocolManager.getAdapterIfAvailable('SPARK')?.isConnected() ?? false;

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
      <View style={{ flexDirection: 'row', marginBottom: 12, borderRadius: 10, backgroundColor: theme.colors.background.secondary, padding: 3 }}>
        {venues.map(venue => (
          <TouchableOpacity
            key={venue.id}
            onPress={() => setVenueFilter(venue.id)}
            style={{
              flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center',
              backgroundColor: venueFilter === venue.id ? theme.colors.primary[500] : 'transparent',
            }}
          >
            <Text style={{
              fontSize: 13, fontWeight: venueFilter === venue.id ? '600' : '400',
              color: venueFilter === venue.id ? '#fff' : theme.colors.text.secondary,
            }}>
              {venue.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    );
  };

  const renderSwapInterface = () => (
    <View style={styles.swapContainer}>
      {/* Venue filter tabs */}
      {renderVenueFilter()}

      {/* From Section */}
      <View style={styles.swapInputContainer}>
        <View style={styles.swapInputHeader}>
          <Text style={styles.swapLabel}>You Pay</Text>
          {swapState.fromAsset && (
            <TouchableOpacity
              style={styles.maxButton}
              onPress={() => {
                const asset = assetByTicker(swapState.fromAsset);
                if (asset) {
                  dispatch(setFromAmount(asset.balance.toString()));
                }
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
            onChangeText={(text) => dispatch(setFromAmount(text))}
            placeholder="0"
            placeholderTextColor={theme.colors.text.tertiary}
            keyboardType="decimal-pad"
            style={styles.amountInput}
          />
          <TouchableOpacity
            style={styles.assetSelectorToken}
            onPress={() => setShowAssetPicker('from')}
          >
            {swapState.fromAsset ? (
              <>
                {getAssetIcon(swapState.fromAsset)}
                <Text style={styles.assetSelectorTokenText}>
                  {swapState.fromAsset}
                </Text>
              </>
            ) : (
              <Text style={styles.selectAssetTokenText}>Select</Text>
            )}
            <Ionicons name="chevron-down" size={16} color={theme.colors.text.primary} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Swap Arrow Overlay */}
      <View style={styles.swapArrowContainer}>
        <TouchableOpacity
          style={styles.swapArrowButton}
          onPress={() => dispatch(swapAssets())}
        >
          <Ionicons name="arrow-down" size={24} color={theme.colors.primary[500]} />
        </TouchableOpacity>
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

          <TouchableOpacity
            style={styles.assetSelectorToken}
            onPress={() => setShowAssetPicker('to')}
          >
            {swapState.toAsset ? (
              <>
                {getAssetIcon(swapState.toAsset)}
                <Text style={styles.assetSelectorTokenText}>
                  {swapState.toAsset}
                </Text>
              </>
            ) : (
              <Text style={styles.selectAssetTokenText}>Select</Text>
            )}
            <Ionicons name="chevron-down" size={16} color={theme.colors.text.primary} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Quote Info & Fees (Accordion Style) */}
      {swapState.currentQuote && (
        <View style={styles.quoteInfoContainer}>
          <View style={styles.quoteInfoRow}>
            <Text style={styles.quoteInfoLabel}>Rate</Text>
            <Text style={styles.quoteInfoValue}>
              1 {swapState.fromAsset} ≈ {swapState.currentQuote.exchange_rate.toFixed(2)} {swapState.toAsset}
            </Text>
          </View>
          <View style={styles.quoteInfoRow}>
            <Text style={styles.quoteInfoLabel}>Network Fee</Text>
            <Text style={styles.quoteInfoValue}>
              {swapState.currentQuote.fee_amount} {swapState.fromAsset}
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
        </View>
      )}

      {/* Main Action Button */}
      <Button
        title={swapState.isQuoteLoading ? 'Fetching Best Price...' : (swapState.currentQuote ? 'Swap' : 'Enter Amount')}
        onPress={() => setShowConfirmModal(true)}
        disabled={!swapState.currentQuote || swapState.isQuoteLoading || !swapState.fromAmount}
        loading={swapState.isQuoteLoading}
        variant="primary"
        fullWidth
        style={styles.getQuoteButton}
        size="lg"
      />
    </View>
  );

  const renderAssetPicker = () => {
    if (!showAssetPicker) return null;

    // Restrict choices to what's actually tradable: destinations must pair with
    // the current source; sources are any ticker present in a loaded pair. Falls
    // back to the full asset list before pairs have loaded.
    const tickers = showAssetPicker === 'to'
      ? tradableTickers(filteredPairs, swapState.fromAsset)
      : allTickers(filteredPairs);
    const pickerAssets = tickers.length
      ? tickers.map(t => assetByTicker(t)).filter((a): a is Asset => !!a)
      : availableAssets;

    return (
      <View style={styles.modalOverlay}>
        <View style={styles.assetPickerModal}>
          <View style={styles.assetPickerHeader}>
            <Text style={styles.assetPickerTitle}>
              Select {showAssetPicker === 'from' ? 'Source' : 'Destination'} Asset
            </Text>
            <TouchableOpacity onPress={() => setShowAssetPicker(null)}>
              <Ionicons name="close" size={24} color={theme.colors.text.primary} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.assetPickerList}>
            {pickerAssets.map((asset) => (
              <TouchableOpacity
                key={asset.asset_id}
                style={styles.assetPickerItem}
                onPress={() => {
                  // Swap state identifies assets by TICKER (matches findPair /
                  // the quote logic). Storing asset_id here previously broke both
                  // the chip label and pair lookup.
                  if (showAssetPicker === 'from') {
                    dispatch(setFromAsset(asset.ticker));
                  } else {
                    dispatch(setToAsset(asset.ticker));
                  }
                  setShowAssetPicker(null);
                }}
              >
                {getAssetIcon(asset.ticker)}
                <View style={styles.assetPickerInfo}>
                  <Text style={styles.assetPickerTicker}>{asset.ticker}</Text>
                  <Text style={styles.assetPickerName}>{asset.name}</Text>
                  <Text style={styles.assetPickerBalance}>
                    Balance: {asset.balance.toFixed(asset.precision || 8)}
                  </Text>
                </View>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      </View>
    );
  };

  const renderProgressSteps = () => {
    const pair = findPair(filteredPairs, swapState.currentQuote!.from_asset, swapState.currentQuote!.to_asset);
    const flash = pair ? isFlashnetPair(pair) : false;
    const steps = flash
      ? [{ key: 'execute', label: 'Executing swap' }, { key: 'done', label: 'Completed' }]
      : [
          { key: 'init', label: 'Requesting swap' },
          { key: 'taker', label: 'Preparing channels' },
          { key: 'execute', label: 'Atomic swap' },
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

  const renderConfirmModal = () => {
    // Success screen — shown for both venues once a swap settles.
    if (swapSuccess) {
      return (
        <View style={styles.modalOverlay}>
          <View style={styles.confirmModal}>
            <View style={{ alignItems: 'center', paddingVertical: 8 }}>
              <View style={[styles.progressDot, styles.progressDotDone, { width: 56, height: 56, borderRadius: 28, marginBottom: 12 }]}>
                <Ionicons name="checkmark" size={32} color={theme.colors.text.inverse} />
              </View>
              <Text style={styles.confirmTitle}>Swap Complete</Text>
              <Text style={{ color: theme.colors.text.secondary, marginTop: 6, textAlign: 'center' }}>
                {formatDisplayAmount(swapSuccess.fromAmount, swapSuccess.fromTicker)} {unitLabelFor(swapSuccess.fromTicker)}
                {'  →  '}
                {formatDisplayAmount(swapSuccess.toAmount, swapSuccess.toTicker)} {unitLabelFor(swapSuccess.toTicker)}
              </Text>
              {!!swapSuccess.txid && (
                <Text style={{ color: theme.colors.text.tertiary, marginTop: 8, fontSize: 12 }}>
                  {swapSuccess.txid.substring(0, 18)}…
                </Text>
              )}
            </View>
            <Button
              title="Done"
              variant="primary"
              fullWidth
              style={{ marginTop: 16 }}
              onPress={() => {
                setSwapSuccess(null);
                setShowConfirmModal(false);
                setSwapProgress('idle');
                dispatch(resetSwap());
              }}
            />
          </View>
        </View>
      );
    }

    if (!showConfirmModal || !swapState.currentQuote) return null;

    // currentQuote stores tickers (see from_asset: fromTicker in loadQuote).
    const fromTicker = swapState.currentQuote.from_asset;
    const toTicker = swapState.currentQuote.to_asset;

    return (
      <View style={styles.modalOverlay}>
        <View style={styles.confirmModal}>
          <Text style={styles.confirmTitle}>Confirm Swap</Text>

          {swapState.isExecuting ? (
            renderProgressSteps()
          ) : (
          <View style={styles.confirmDetails}>
            <View style={styles.confirmRow}>
              <Text style={styles.confirmLabel}>From:</Text>
              <Text style={styles.confirmValue}>
                {formatDisplayAmount(swapState.currentQuote.from_amount, fromTicker)} {unitLabelFor(fromTicker)}
              </Text>
            </View>

            <View style={styles.confirmRow}>
              <Text style={styles.confirmLabel}>To:</Text>
              <Text style={styles.confirmValue}>
                {formatDisplayAmount(swapState.currentQuote.to_amount, toTicker)} {unitLabelFor(toTicker)}
              </Text>
            </View>

            <View style={styles.confirmRow}>
              <Text style={styles.confirmLabel}>Fee:</Text>
              <Text style={styles.confirmValue}>
                {swapState.currentQuote.fee_amount} {unitLabelFor(fromTicker)}
              </Text>
            </View>

            <View style={styles.confirmRow}>
              <Text style={styles.confirmLabel}>Rate:</Text>
              <Text style={styles.confirmValue}>
                1 {fromTicker} = {swapState.currentQuote.exchange_rate.toFixed(8)} {toTicker}
              </Text>
            </View>
          </View>
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
                title="Confirm Swap"
                variant="primary"
                onPress={executeSwap}
                style={styles.confirmActionButton}
              />
            </View>
          )}
        </View>
      </View>
    );
  };

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
            onPress={() => Alert.alert('Help', 'Swap Bitcoin and RGB assets using Lightning Network')}
          >
            <Ionicons name="help-circle-outline" size={24} color={theme.colors.text.inverse} />
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background.secondary,
  },

  scrollView: {
    flex: 1,
  },

  helpButton: {
    width: 40,
    height: 40,
    borderRadius: theme.borderRadius.base,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  scrollContent: {
    paddingHorizontal: theme.spacing[5],
    paddingBottom: theme.spacing[6],
  },

  errorCard: {
    marginBottom: theme.spacing[4],
    backgroundColor: theme.colors.error[50],
    borderWidth: 1,
    borderColor: theme.colors.error[200],
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
    color: theme.colors.error[700],
  },

  swapContainer: {
    gap: theme.spacing[2],
  },

  swapInputContainer: {
    backgroundColor: theme.colors.surface.primary,
    borderRadius: theme.borderRadius['2xl'],
    padding: theme.spacing[4],
    borderWidth: 1,
    borderColor: theme.colors.border.light,
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
    color: theme.colors.primary[600],
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
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.full,
    gap: theme.spacing[2],
    minWidth: 100,
    justifyContent: 'space-between',
  },

  assetSelectorTokenText: {
    fontSize: theme.typography.fontSize.base,
    fontWeight: '600',
    color: theme.colors.text.primary,
  },

  selectAssetTokenText: {
    fontSize: theme.typography.fontSize.base,
    fontWeight: '600',
    color: theme.colors.text.primary,
  },

  swapArrowContainer: {
    position: 'absolute',
    left: '50%',
    top: '38%',
    marginLeft: -20,
    zIndex: 10,
  },

  swapArrowButton: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: theme.colors.background.primary,
    borderWidth: 4,
    borderColor: theme.colors.background.secondary,
    alignItems: 'center',
    justifyContent: 'center',
    ...theme.shadows.sm,
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
    height: 56,
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
    color: theme.colors.primary[700],
    fontWeight: '500',
  },

  newSwapButton: {
    marginTop: theme.spacing[2],
  },

  // Modal styles
  modalOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
  },

  assetPickerModal: {
    backgroundColor: theme.colors.surface.primary,
    borderRadius: theme.borderRadius.xl,
    margin: theme.spacing[5],
    maxHeight: '80%',
    width: '90%',
  },

  assetPickerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: theme.spacing[5],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border.light,
  },

  assetPickerTitle: {
    fontSize: theme.typography.fontSize.lg,
    fontWeight: '600',
    color: theme.colors.text.primary,
  },

  assetPickerList: {
    maxHeight: 400,
  },

  assetPickerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: theme.spacing[4],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border.light,
    gap: theme.spacing[3],
  },

  assetPickerInfo: {
    flex: 1,
  },

  assetPickerTicker: {
    fontSize: theme.typography.fontSize.base,
    fontWeight: '600',
    color: theme.colors.text.primary,
  },

  assetPickerName: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.text.secondary,
  },

  assetPickerBalance: {
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.text.tertiary,
  },

  confirmModal: {
    backgroundColor: theme.colors.surface.primary,
    borderRadius: theme.borderRadius.xl,
    padding: theme.spacing[6],
    margin: theme.spacing[5],
    width: '90%',
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
