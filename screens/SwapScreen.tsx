// screens/SwapScreen.tsx
import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
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
import { Card, Button, Input } from '../components';

interface Props {
  navigation: any;
}

interface Asset {
  asset_id: string;
  ticker: string;
  name: string;
  balance: number;
  precision?: number;
}

export default function SwapScreen({ navigation }: Props) {
  const dispatch = useDispatch();
  const swapState = useSelector((state: RootState) => state.swap);
  const walletState = useSelector((state: RootState) => state.wallet);
  const rgbAssets = (walletState?.rgbAssets || []);
  
  const [showAssetPicker, setShowAssetPicker] = useState<'from' | 'to' | null>(null);
  const [availableAssets, setAvailableAssets] = useState<Asset[]>([]);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [pollingInterval, setPollingInterval] = useState<NodeJS.Timeout | null>(null);

  const kaleidoswapApi = KaleidoswapApiService.getInstance();
  const rgbApi = RGBApiService.getInstance();

  // Load available assets
  useEffect(() => {
    loadAvailableAssets();
  }, [walletState]);

  // Clear polling interval on unmount
  useEffect(() => {
    return () => {
      if (pollingInterval) {
        clearInterval(pollingInterval);
      }
    };
  }, [pollingInterval]);

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
      
      setAvailableAssets(assets);
    } catch (error) {
      console.error('Failed to load available assets:', error);
    }
  };

  const getQuote = async () => {
    if (!swapState.fromAsset || !swapState.toAsset || !swapState.fromAmount) {
      Alert.alert('Error', 'Please select assets and enter an amount');
      return;
    }

    const fromAmount = parseFloat(swapState.fromAmount);
    if (isNaN(fromAmount) || fromAmount <= 0) {
      Alert.alert('Error', 'Please enter a valid amount');
      return;
    }

    // Check balance
    const fromAssetInfo = availableAssets.find(a => a.asset_id === swapState.fromAsset);
    if (fromAssetInfo && fromAmount > fromAssetInfo.balance) {
      Alert.alert('Error', `Insufficient ${fromAssetInfo.ticker} balance`);
      return;
    }

    try {
      dispatch(setQuoteLoading(true));
      dispatch(clearError());

      const quote = await kaleidoswapApi.getQuote({
        from_asset: swapState.fromAsset,
        to_asset: swapState.toAsset,
        from_amount: fromAmount,
      });

      dispatch(setCurrentQuote(quote));
      setShowConfirmModal(true);
    } catch (error) {
      console.error('Failed to get quote:', error);
      dispatch(setError(error instanceof Error ? error.message : 'Failed to get quote'));
    } finally {
      dispatch(setQuoteLoading(false));
    }
  };

  const executeSwap = async () => {
    if (!swapState.currentQuote) return;

    try {
      dispatch(setExecuting(true));
      setShowConfirmModal(false);

      // Step 1: Initialize swap
      const initResponse = await kaleidoswapApi.initSwap({
        rfq_id: swapState.currentQuote.rfq_id,
      });

      const execution: SwapExecution = {
        rfq_id: swapState.currentQuote.rfq_id,
        swap_string: initResponse.swap_string,
        status: 'pending',
        created_at: Date.now(),
        updated_at: Date.now(),
      };

      dispatch(setCurrentExecution(execution));

      // Step 2: Whitelist trade
      await kaleidoswapApi.whitelistTrade({
        swap_string: initResponse.swap_string,
      });

      dispatch(updateExecutionStatus({
        rfq_id: swapState.currentQuote.rfq_id,
        status: 'whitelisted',
      }));

      // Step 3: Execute swap
      const executeResponse = await kaleidoswapApi.executeSwap({
        rfq_id: swapState.currentQuote.rfq_id,
      });

      if (executeResponse.success) {
        dispatch(updateExecutionStatus({
          rfq_id: swapState.currentQuote.rfq_id,
          status: 'executing',
          txid: executeResponse.txid,
        }));

        // Start polling for swap status
        startStatusPolling(swapState.currentQuote.rfq_id);
      } else {
        throw new Error(executeResponse.message || 'Swap execution failed');
      }

    } catch (error) {
      console.error('Swap execution failed:', error);
      dispatch(updateExecutionStatus({
        rfq_id: swapState.currentQuote?.rfq_id || '',
        status: 'failed',
        error_message: error instanceof Error ? error.message : 'Swap execution failed',
      }));
    } finally {
      dispatch(setExecuting(false));
    }
  };

  const startStatusPolling = (rfqId: string) => {
    const interval = setInterval(async () => {
      try {
        const swap = await rgbApi.getSwap({ rfq_id: rfqId });
        
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

          // Refresh wallet data
          loadAvailableAssets();
        }
      } catch (error) {
        console.warn('Failed to poll swap status:', error);
      }
    }, 5000); // Poll every 5 seconds

    setPollingInterval(interval);
  };

  const getAssetIcon = (ticker: string) => {
    if (ticker === 'BTC') {
      return <Ionicons name="logo-bitcoin" size={24} color="#F7931A" />;
    }
    return <Ionicons name="diamond" size={24} color={theme.colors.primary[500]} />;
  };

  const renderHeader = () => (
    <View style={styles.headerContainer}>
      <LinearGradient
        colors={['#4338ca', '#7c3aed'] as [string, string]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.headerGradient}
      >
        <View style={styles.header}>
          <TouchableOpacity 
            style={styles.backButton}
            onPress={() => navigation.goBack()}
          >
            <Ionicons name="arrow-back" size={24} color={theme.colors.text.inverse} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Swap Assets</Text>
          <TouchableOpacity
            style={styles.helpButton}
            onPress={() => Alert.alert('Help', 'Swap Bitcoin and RGB assets using Lightning Network')}
          >
            <Ionicons name="help-circle-outline" size={24} color={theme.colors.text.inverse} />
          </TouchableOpacity>
        </View>
      </LinearGradient>
    </View>
  );

  const renderAssetSelector = (type: 'from' | 'to') => {
    const selectedAsset = type === 'from' ? swapState.fromAsset : swapState.toAsset;
    const assetInfo = availableAssets.find(a => a.asset_id === selectedAsset);

    return (
      <View style={styles.assetSelectorContainer}>
        <Text style={styles.assetLabel}>
          {type === 'from' ? 'From' : 'To'}
        </Text>
        <TouchableOpacity
          style={styles.assetSelector}
          onPress={() => setShowAssetPicker(type)}
        >
          <View style={styles.assetSelectorContent}>
            {assetInfo ? (
              <>
                {getAssetIcon(assetInfo.ticker)}
                <View style={styles.assetInfo}>
                  <Text style={styles.assetTicker}>{assetInfo.ticker}</Text>
                  <Text style={styles.assetName}>{assetInfo.name}</Text>
                  {type === 'from' && (
                    <Text style={styles.assetBalance}>
                      Balance: {assetInfo.balance.toFixed(assetInfo.precision || 8)}
                    </Text>
                  )}
                </View>
              </>
            ) : (
              <Text style={styles.selectAssetText}>Select Asset</Text>
            )}
            <Ionicons name="chevron-down" size={20} color={theme.colors.text.secondary} />
          </View>
        </TouchableOpacity>
      </View>
    );
  };

  const renderSwapInterface = () => (
    <Card style={styles.swapCard}>
      {renderAssetSelector('from')}
      
      <View style={styles.amountContainer}>
        <Text style={styles.amountLabel}>Amount</Text>
        <Input
          value={swapState.fromAmount}
          onChangeText={(text) => dispatch(setFromAmount(text))}
          placeholder="0.00000000"
          keyboardType="decimal-pad"
          variant="outlined"
          size="lg"
        />
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
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.swapArrowContainer}>
        <TouchableOpacity
          style={styles.swapArrowButton}
          onPress={() => dispatch(swapAssets())}
        >
          <Ionicons name="swap-vertical" size={24} color={theme.colors.primary[500]} />
        </TouchableOpacity>
      </View>

      {renderAssetSelector('to')}

      {swapState.toAmount && (
        <View style={styles.toAmountContainer}>
          <Text style={styles.toAmountLabel}>You will receive</Text>
          <Text style={styles.toAmountValue}>
            ≈ {swapState.toAmount} {availableAssets.find(a => a.asset_id === swapState.toAsset)?.ticker}
          </Text>
        </View>
      )}

      <Button
        title={swapState.isQuoteLoading ? 'Getting Quote...' : 'Get Quote'}
        onPress={getQuote}
        disabled={!swapState.fromAsset || !swapState.toAsset || !swapState.fromAmount || swapState.isQuoteLoading}
        loading={swapState.isQuoteLoading}
        variant="primary"
        fullWidth
        style={styles.getQuoteButton}
      />
    </Card>
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
    <SafeAreaView style={styles.container}>
      {renderHeader()}
      
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background.secondary,
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
  
  scrollView: {
    flex: 1,
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
  
  swapCard: {
    padding: theme.spacing[5],
    marginBottom: theme.spacing[4],
  },
  
  assetSelectorContainer: {
    marginBottom: theme.spacing[4],
  },
  
  assetLabel: {
    fontSize: theme.typography.fontSize.sm,
    fontWeight: '600',
    color: theme.colors.text.primary,
    marginBottom: theme.spacing[2],
  },
  
  assetSelector: {
    borderWidth: 1,
    borderColor: theme.colors.border.light,
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing[4],
    backgroundColor: theme.colors.background.secondary,
  },
  
  assetSelectorContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[3],
  },
  
  assetInfo: {
    flex: 1,
  },
  
  assetTicker: {
    fontSize: theme.typography.fontSize.base,
    fontWeight: '600',
    color: theme.colors.text.primary,
  },
  
  assetName: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.text.secondary,
  },
  
  assetBalance: {
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.text.muted,
  },
  
  selectAssetText: {
    flex: 1,
    fontSize: theme.typography.fontSize.base,
    color: theme.colors.text.secondary,
  },
  
  amountContainer: {
    marginBottom: theme.spacing[4],
    position: 'relative',
  },
  
  amountLabel: {
    fontSize: theme.typography.fontSize.sm,
    fontWeight: '600',
    color: theme.colors.text.primary,
    marginBottom: theme.spacing[2],
  },
  
  maxButton: {
    position: 'absolute',
    right: theme.spacing[3],
    top: 32,
    backgroundColor: theme.colors.primary[50],
    borderWidth: 1,
    borderColor: theme.colors.primary[200],
    borderRadius: theme.borderRadius.base,
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
  },
  
  maxButtonText: {
    fontSize: theme.typography.fontSize.xs,
    fontWeight: '600',
    color: theme.colors.primary[600],
  },
  
  swapArrowContainer: {
    alignItems: 'center',
    marginVertical: theme.spacing[2],
  },
  
  swapArrowButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: theme.colors.primary[50],
    borderWidth: 2,
    borderColor: theme.colors.primary[200],
    alignItems: 'center',
    justifyContent: 'center',
  },
  
  toAmountContainer: {
    marginBottom: theme.spacing[4],
    padding: theme.spacing[3],
    backgroundColor: theme.colors.primary[50],
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.primary[200],
  },
  
  toAmountLabel: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.primary[600],
    marginBottom: theme.spacing[1],
  },
  
  toAmountValue: {
    fontSize: theme.typography.fontSize.lg,
    fontWeight: '600',
    color: theme.colors.primary[700],
  },
  
  getQuoteButton: {
    marginTop: theme.spacing[2],
  },
  
  statusCard: {
    padding: theme.spacing[4],
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
  },
  
  statusProgressText: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.text.secondary,
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
    color: theme.colors.text.muted,
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