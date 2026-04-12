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
import {
  SwapPair, SwapVenueFilter, SwapProgress,
  findPair, allTickers, tradableTickers, findPairAsset,
  getAssetId, isBtcTicker, getQuoteLayers, isFlashnetPair,
  normalizeMakerPairs, buildFlashnetPairs,
  QUOTE_DEBOUNCE_MS, DEFAULT_FLASHNET_SLIPPAGE_BPS,
} from '../utils/swap-model';
import { theme } from '../theme';
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

  const [showAssetPicker, setShowAssetPicker] = useState<'from' | 'to' | null>(null);
  const [availableAssets, setAvailableAssets] = useState<Asset[]>([]);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [pollingInterval, setPollingInterval] = useState<NodeJS.Timeout | null>(null);
  const [tradingPairs, setTradingPairs] = useState<SwapPair[]>([]);
  const [venueFilter, setVenueFilter] = useState<SwapVenueFilter>('all');
  const [swapProgress, setSwapProgress] = useState<SwapProgress>('idle');
  const [pairsLoading, setPairsLoading] = useState(false);

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
          const pools = await flashnetClientManager.getClient().listPools({ sort: 'TVL_DESC' });
          const poolArray = Array.isArray(pools) ? pools : (pools as any)?.pools || [];
          flashnetPairs = buildFlashnetPairs(poolArray);
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

  const loadAvailableAssets = async () => {
    try {
      const assets: Asset[] = [
        {
          asset_id: 'BTC',
          ticker: 'BTC',
          name: 'Bitcoin',
          balance: (walletState?.btcBalance?.vanilla?.spendable || 0) / 100000000,
          precision: 8,
        },
        ...rgbAssets.map((asset: any) => ({
          asset_id: asset.asset_id,
          ticker: asset.ticker,
          name: asset.name,
          balance: (asset.balance?.spendable || 0) / Math.pow(10, asset.precision || 8),
          precision: asset.precision,
        }))
      ];
      setAvailableAssets(assets);
    } catch (error) {
      console.error('Failed to load available assets:', error);
    }
  };

  // Get filtered pairs based on venue selection
  const filteredPairs = tradingPairs.filter(p => {
    if (venueFilter === 'all') return true;
    return p.venue === venueFilter;
  });

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
        // Flashnet: simulate quote from pool reserves (client-side)
        try {
          const client = flashnetClientManager.getClient();
          const poolId = pair.poolId || flashnetClientManager.getPoolId();
          // Use simulateSwap if available, otherwise build a simple estimate
          const fromAssetId = getAssetId(pair.base.ticker === fromTicker ? pair.base : pair.quote);
          const toAssetId = getAssetId(pair.base.ticker === toTicker ? pair.base : pair.quote);
          const fromPrecision = (pair.base.ticker === fromTicker ? pair.base : pair.quote).precision;
          const rawAmount = isBtcTicker(fromTicker) ? Math.round(fromAmount * 1e8) : Math.round(fromAmount * Math.pow(10, fromPrecision));

          const quote: SwapQuote = {
            rfq_id: `flashnet-${Date.now()}`,
            from_asset: fromTicker,
            to_asset: toTicker,
            from_amount: fromAmount,
            to_amount: 0, // Will be filled by execution
            fee_amount: 0,
            exchange_rate: 0,
            expiry_timestamp: Date.now() + 60000,
            maker_pubkey: poolId || '',
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
          const rawFromAmount = isBtcTicker(fromTicker)
            ? Math.round(fromAmount * 1e8 * 1000) // msats
            : Math.round(fromAmount * Math.pow(10, fromPrecision));

          const { fromLayer, toLayer } = getQuoteLayers(pair, fromAssetId, toAssetId);

          const client = kaleidoClientManager.getClient();
          const quoteResponse = await client.maker.getQuote({
            from_asset: { asset_id: fromAssetId, layer: fromLayer as any, amount: rawFromAmount },
            to_asset: { asset_id: toAssetId, layer: toLayer as any },
          }) as any;

          const toAmount = Number(quoteResponse.to_asset?.amount || 0);
          const toPrecision = toAsset.precision;
          const displayToAmount = isBtcTicker(toTicker)
            ? toAmount / 1000 / 1e8 // msats → BTC
            : toAmount / Math.pow(10, toPrecision);

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
        const rawAmount = isBtcTicker(quote.from_asset)
          ? Math.round(quote.from_amount * 1e8)
          : Math.round(quote.from_amount * Math.pow(10, fromPrecision));

        const result = await client.executeSwap({
          poolId,
          assetInAddress: fromAssetId,
          assetOutAddress: toAssetId,
          amountIn: String(rawAmount),
          minAmountOut: '0', // TODO: calculate from slippage
          maxSlippageBps: DEFAULT_FLASHNET_SLIPPAGE_BPS,
        });

        setSwapProgress('done');
        dispatch(updateExecutionStatus({
          rfq_id: quote.rfq_id,
          status: 'completed',
          txid: result?.outboundTransferId || '',
        }));
        dispatch(setExecuting(false));
        setShowConfirmModal(false);
        loadAvailableAssets();
      } else {
        // ── Kaleidoswap execution (3-step: init → taker → execute) ──
        if (!kaleidoClientManager.isInitialized()) {
          throw new Error('KaleidoSwap requires an RGB node connection.');
        }
        const client = kaleidoClientManager.getClient();
        const fromAsset = pair ? (pair.base.ticker === quote.from_asset ? pair.base : pair.quote) : null;
        const toAsset = pair ? (pair.base.ticker === quote.to_asset ? pair.base : pair.quote) : null;
        const fromAssetId = fromAsset ? getAssetId(fromAsset) : quote.from_asset;
        const toAssetId = toAsset ? getAssetId(toAsset) : quote.to_asset;
        const fromPrecision = fromAsset?.precision || 8;
        const toPrecision = toAsset?.precision || 8;
        const rawFromAmount = isBtcTicker(quote.from_asset)
          ? Math.round(quote.from_amount * 1e8 * 1000)
          : Math.round(quote.from_amount * Math.pow(10, fromPrecision));
        const rawToAmount = isBtcTicker(quote.to_asset)
          ? Math.round(quote.to_amount * 1e8 * 1000)
          : Math.round(quote.to_amount * Math.pow(10, toPrecision));

        // Step 1: Init swap
        setSwapProgress('init');
        const initResult = await client.maker.initSwap({
          rfq_id: quote.rfq_id,
          from_asset: { asset_id: fromAssetId, amount: rawFromAmount, layer: 'RGB_LN' },
          to_asset: { asset_id: toAssetId, amount: rawToAmount, layer: 'RGB_LN' },
        } as any) as any;

        const swapstring = initResult?.swapstring || initResult?.swap_string || '';
        const paymentHash = initResult?.payment_hash || '';

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
          dispatch(updateExecutionStatus({
            rfq_id: rfqId,
            status: swapStatus === 'failed' ? 'failed' : 'completed',
            error_message: swapStatus === 'failed' ? 'Swap failed' : undefined,
          }));

          if (swapState.currentExecution) {
            dispatch(addToHistory({
              ...swapState.currentExecution,
              status: swapStatus === 'failed' ? 'failed' : 'completed',
            }));
          }

          clearInterval(interval);
          setPollingInterval(null);
          setShowConfirmModal(false);
          dispatch(setExecuting(false));
          loadAvailableAssets();
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



  const rgbConnected = protocolManager.getAdapterIfAvailable('RGB')?.isConnected() ?? false;
  const sparkConnected = protocolManager.getAdapterIfAvailable('SPARK')?.isConnected() ?? false;

  const renderVenueFilter = () => {
    const venues: Array<{ id: SwapVenueFilter; label: string; available: boolean }> = [
      { id: 'all', label: 'All', available: true },
      { id: 'kaleidoswap', label: 'KaleidoSwap', available: rgbConnected },
      { id: 'flashnet', label: 'Flashnet', available: sparkConnected },
    ];

    return (
      <View style={{ flexDirection: 'row', marginBottom: 12, borderRadius: 10, backgroundColor: theme.colors.background.secondary, padding: 3 }}>
        {venues.map(venue => (
          <TouchableOpacity
            key={venue.id}
            onPress={() => venue.available && setVenueFilter(venue.id)}
            style={{
              flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center',
              backgroundColor: venueFilter === venue.id ? theme.colors.primary[500] : 'transparent',
              opacity: venue.available ? 1 : 0.35,
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
                const asset = availableAssets.find(a => a.asset_id === swapState.fromAsset);
                if (asset) {
                  dispatch(setFromAmount(asset.balance.toString()));
                }
              }}
            >
              <Text style={styles.maxButtonText}>MAX</Text>
              <Text style={styles.balanceText}>
                {availableAssets.find(a => a.asset_id === swapState.fromAsset)?.balance.toFixed(4) || '0.00'}
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
                {getAssetIcon(availableAssets.find(a => a.asset_id === swapState.fromAsset)?.ticker || '')}
                <Text style={styles.assetSelectorTokenText}>
                  {availableAssets.find(a => a.asset_id === swapState.fromAsset)?.ticker}
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
              {swapState.currentQuote?.to_amount ? swapState.currentQuote.to_amount.toFixed(6) : '0'}
            </Text>
          )}

          <TouchableOpacity
            style={styles.assetSelectorToken}
            onPress={() => setShowAssetPicker('to')}
          >
            {swapState.toAsset ? (
              <>
                {getAssetIcon(availableAssets.find(a => a.asset_id === swapState.toAsset)?.ticker || '')}
                <Text style={styles.assetSelectorTokenText}>
                  {availableAssets.find(a => a.asset_id === swapState.toAsset)?.ticker}
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
              1 {availableAssets.find(a => a.asset_id === swapState.fromAsset)?.ticker} ≈ {swapState.currentQuote.exchange_rate.toFixed(2)} {availableAssets.find(a => a.asset_id === swapState.toAsset)?.ticker}
            </Text>
          </View>
          <View style={styles.quoteInfoRow}>
            <Text style={styles.quoteInfoLabel}>Network Fee</Text>
            <Text style={styles.quoteInfoValue}>
              {swapState.currentQuote.fee_amount} {availableAssets.find(a => a.asset_id === swapState.fromAsset)?.ticker}
            </Text>
          </View>
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
            {availableAssets.map((asset) => (
              <TouchableOpacity
                key={asset.asset_id}
                style={styles.assetPickerItem}
                onPress={() => {
                  if (showAssetPicker === 'from') {
                    dispatch(setFromAsset(asset.asset_id));
                  } else {
                    dispatch(setToAsset(asset.asset_id));
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

  const renderConfirmModal = () => {
    if (!showConfirmModal || !swapState.currentQuote) return null;

    const fromAsset = availableAssets.find(a => a.asset_id === swapState.currentQuote!.from_asset);
    const toAsset = availableAssets.find(a => a.asset_id === swapState.currentQuote!.to_asset);

    return (
      <View style={styles.modalOverlay}>
        <View style={styles.confirmModal}>
          <Text style={styles.confirmTitle}>Confirm Swap</Text>

          <View style={styles.confirmDetails}>
            <View style={styles.confirmRow}>
              <Text style={styles.confirmLabel}>From:</Text>
              <Text style={styles.confirmValue}>
                {swapState.currentQuote.from_amount} {fromAsset?.ticker}
              </Text>
            </View>

            <View style={styles.confirmRow}>
              <Text style={styles.confirmLabel}>To:</Text>
              <Text style={styles.confirmValue}>
                {swapState.currentQuote.to_amount} {toAsset?.ticker}
              </Text>
            </View>

            <View style={styles.confirmRow}>
              <Text style={styles.confirmLabel}>Fee:</Text>
              <Text style={styles.confirmValue}>
                {swapState.currentQuote.fee_amount} {fromAsset?.ticker}
              </Text>
            </View>

            <View style={styles.confirmRow}>
              <Text style={styles.confirmLabel}>Rate:</Text>
              <Text style={styles.confirmValue}>
                1 {fromAsset?.ticker} = {swapState.currentQuote.exchange_rate.toFixed(8)} {toAsset?.ticker}
              </Text>
            </View>
          </View>

          <View style={styles.confirmActions}>
            <Button
              title="Cancel"
              variant="secondary"
              onPress={() => setShowConfirmModal(false)}
              style={styles.confirmActionButton}
            />
            <Button
              title={swapState.isExecuting ? 'Executing...' : 'Confirm Swap'}
              variant="primary"
              onPress={executeSwap}
              loading={swapState.isExecuting}
              disabled={swapState.isExecuting}
              style={styles.confirmActionButton}
            />
          </View>
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
            <Text style={[styles.statusValue, {
              color: swapState.currentExecution.status === 'completed'
                ? theme.colors.success[500]
                : swapState.currentExecution.status === 'failed'
                  ? theme.colors.error[500]
                  : theme.colors.warning[500]
            }]}>
              {swapState.currentExecution.status.toUpperCase()}
            </Text>
          </View>

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
}); 