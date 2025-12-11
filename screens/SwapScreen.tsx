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
import KaleidoswapApiService from '../services/KaleidoswapApiService';
import RGBApiService from '../services/RGBApiService';
import { theme } from '../theme';
import { Card, Button, Input, MainHeader } from '../components';

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

  const kaleidoswapApi = KaleidoswapApiService.getInstance();
  const rgbApi = RGBApiService.getInstance();

  // Mock Assets with Logos
  const mockAssets: Asset[] = [
    {
      asset_id: 'BTC',
      ticker: 'BTC',
      name: 'Bitcoin',
      balance: 1.24,
      icon: 'https://cryptologos.cc/logos/bitcoin-btc-logo.png',
      precision: 8
    },
    {
      asset_id: 'USDT',
      ticker: 'USDT',
      name: 'Tether USD',
      balance: 1250.50,
      icon: 'https://cryptologos.cc/logos/tether-usdt-logo.png',
      precision: 6
    },
    {
      asset_id: 'L-BTC',
      ticker: 'L-BTC',
      name: 'Liquid Bitcoin',
      balance: 0.05,
      icon: 'https://upload.wikimedia.org/wikipedia/commons/4/42/Blue_Bitcoin_Logo.png',
      precision: 8
    },
    {
      asset_id: 'RGB',
      ticker: 'RGB',
      name: 'RGB Asset',
      balance: 500,
      icon: 'https://avatars.githubusercontent.com/u/80262078?s=200&v=4',
      precision: 2
    }
  ];

  // Load available assets
  useEffect(() => {
    // In a real app, merge mock assets with real balances
    setAvailableAssets(mockAssets);

    // Set default selection
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

  const loadAvailableAssets = async () => {
    try {
      // Combine BTC with RGB assets
      const assets: Asset[] = [
        {
          asset_id: 'BTC',
          ticker: 'BTC',
          name: 'Bitcoin',
          balance: (walletState?.btcBalance?.vanilla?.spendable || 0) / 100000000,
        },
        ...rgbAssets.map((asset: any) => ({
          asset_id: asset.asset_id,
          ticker: asset.ticker,
          name: asset.name,
          balance: (asset.balance?.spendable || 0) / Math.pow(10, asset.precision || 8),
          precision: asset.precision,
        }))
      ];

      // setAvailableAssets(assets); // Original line, now replaced by mockAssets
    } catch (error) {
      console.error('Failed to load available assets:', error);
    }
  };

  const getQuote = async () => {
    try {
      if (!swapState.fromAmount) return;

      dispatch(setQuoteLoading(true));
      dispatch(clearError());

      // MOCK API DELAY & RESULT
      await new Promise(resolve => setTimeout(resolve, 600));

      const fromAmount = parseFloat(swapState.fromAmount);
      const isSellingBTC = swapState.fromAsset === 'BTC' || swapState.fromAsset === 'L-BTC';
      const price = isSellingBTC ? 95000 : 1 / 95000;

      // Add some random fluctuation
      const rate = price * (1 + (Math.random() * 0.001 - 0.0005));
      const toAmount = fromAmount * rate;
      const fee = fromAmount * 0.001; // 0.1% fee

      const quote: SwapQuote = {
        rfq_id: 'mock-rfq-' + Date.now(),
        from_asset: swapState.fromAsset || 'BTC',
        to_asset: swapState.toAsset || 'USDT',
        from_amount: fromAmount,
        to_amount: parseFloat(toAmount.toFixed(6)),
        fee_amount: parseFloat(fee.toFixed(8)),
        // expiration: Date.now() + 60000, // Removed to fix type error
        exchange_rate: rate,
        expiry_timestamp: Date.now() + 60000,
        maker_pubkey: 'mock-pubkey'
      };

      dispatch(setCurrentQuote(quote));
      // NOTE: In Redux slice you might need an action to set 'toAmount' specifically if it's separate from quote
      // Assuming 'setCurrentQuote' or similar updates the UI's "To" value, 
      // BUT if the UI reads 'toAmount' from state, we might need to dispatch that too.
      // Based on previous code, the UI uses `swapState.toAmount`.
      // Let's assume we need to dispatch a manual set for the UI
      // dispatch(setToAmount(toAmount.toFixed(6))); -> This action might not exist, 
      // so we rely on the UI displaying quote.to_amount if available, or we check if there's a SET_TO_AMOUNT action.
      // Looking at imports: `setFromAmount` exists. `setCurrentQuote` exists. 

    } catch (error) {
      console.error('Failed to get quote:', error);
      dispatch(setError('Failed to fetch quote'));
    } finally {
      dispatch(setQuoteLoading(false));
    }
  };

  const executeSwap = async () => {
    if (!swapState.currentQuote) return;

    try {
      dispatch(setExecuting(true));
      // setShowConfirmModal(false); // Keep modal open to show executing state

      // Step 1: Initialize swap
      // Mock initSwap
      await new Promise(resolve => setTimeout(resolve, 1500)); // Simulate API call
      const initResponse = { swap_string: 'mock-swap-string-' + Date.now() };

      const execution: SwapExecution = {
        rfq_id: swapState.currentQuote.rfq_id,
        swap_string: initResponse.swap_string,
        status: 'pending',
        created_at: Date.now(),
        updated_at: Date.now(),
      };

      dispatch(setCurrentExecution(execution));

      // Step 2: Whitelist trade
      // Mock whitelistTrade
      await new Promise(resolve => setTimeout(resolve, 1000)); // Simulate API call

      dispatch(updateExecutionStatus({
        rfq_id: swapState.currentQuote.rfq_id,
        status: 'whitelisted',
      }));

      // Step 3: Execute swap
      // Mock executeSwap
      await new Promise(resolve => setTimeout(resolve, 2000)); // Simulate API call
      const executeResponse = { success: true, txid: 'mock-txid-' + Date.now() };

      if (executeResponse.success) {
        dispatch(updateExecutionStatus({
          rfq_id: swapState.currentQuote.rfq_id,
          status: 'executing',
          txid: executeResponse.txid,
        }));

        // Start polling for swap status
        startStatusPolling(swapState.currentQuote.rfq_id);
      } else {
        throw new Error('Swap execution failed');
      }

    } catch (error) {
      console.error('Swap execution failed:', error);
      dispatch(updateExecutionStatus({
        rfq_id: swapState.currentQuote?.rfq_id || '',
        status: 'failed',
        error_message: error instanceof Error ? error.message : 'Swap execution failed',
      }));
    } finally {
      // dispatch(setExecuting(false)); // Keep executing state until polling finishes
    }
  };

  const startStatusPolling = (rfqId: string) => {
    let pollCount = 0;
    const maxPolls = 5; // Simulate a few polls before completion/failure

    const interval = setInterval(async () => {
      try {
        pollCount++;
        let swapStatus = 'executing';
        let txid = swapState.currentExecution?.txid;
        let errorMessage = undefined;

        if (pollCount >= maxPolls) {
          // Simulate completion or failure
          if (Math.random() > 0.2) { // 80% chance of success
            swapStatus = 'completed';
          } else {
            swapStatus = 'failed';
            errorMessage = 'Simulated swap failure';
          }
        }

        const swap = {
          status: swapStatus,
          txid: txid,
          error: errorMessage,
        };

        if (swap.status === 'completed' || swap.status === 'failed') {
          dispatch(updateExecutionStatus({
            rfq_id: rfqId,
            status: swap.status,
            txid: swap.txid,
            error_message: swap.error,
          }));

          // Add to history and stop polling
          if (swapState.currentExecution) {
            dispatch(addToHistory({
              ...swapState.currentExecution,
              status: swap.status,
              txid: swap.txid,
              error_message: swap.error,
            }));
          }

          clearInterval(interval);
          setPollingInterval(null);
          setShowConfirmModal(false); // Close modal after final status
          dispatch(setExecuting(false)); // Reset executing state

          // Refresh wallet data
          loadAvailableAssets();
        }
      } catch (error) {
        console.warn('Failed to poll swap status:', error);
      }
    }, 3000); // Poll every 3 seconds

    setPollingInterval(interval);
  };

  const getAssetIcon = (ticker: string) => {
    const asset = mockAssets.find(a => a.ticker === ticker);
    if (asset?.icon) {
      return <Image source={{ uri: asset.icon }} style={{ width: 24, height: 24, borderRadius: 12 }} />;
    }
    if (ticker === 'BTC') return <Ionicons name="logo-bitcoin" size={24} color="#F7931A" />;
    if (ticker === 'USDT') return <Ionicons name="cash" size={24} color="#26A17B" />;
    return <Ionicons name="diamond" size={24} color={theme.colors.primary[500]} />;
  };



  const renderSwapInterface = () => (
    <View style={styles.swapContainer}>
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