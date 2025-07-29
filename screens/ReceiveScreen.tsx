// screens/ReceiveScreen.tsx
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  Share,
  Clipboard,
  ActivityIndicator,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSelector } from 'react-redux';
import QRCode from 'react-native-qrcode-svg';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { RootState } from '../store';
import RGBApiService from '../services/RGBApiService';
import { theme } from '../theme';
import { Card, Button, Input } from '../components';
import { useAssetIcon } from '../utils';
import { useFormattedBitcoinAmount, parseInputAmount } from '../utils/bitcoinUnits';

interface Props {
  navigation: any;
}

interface RGBAsset {
  asset_id: string;
  ticker: string;
  name: string;
  balance: {
    settled: number;
    future: number;
    spendable: number;
  };
}

interface Asset {
  asset_id: string;
  ticker: string;
  name: string;
  isRGB: boolean;
  balance?: number;
}

export default function ReceiveScreen({ navigation }: Props) {
  const walletState = useSelector((state: RootState) => state.wallet);
  const bitcoinUnit = useSelector((state: RootState) => state.settings.bitcoinUnit);
  
  // Safe destructuring with fallbacks
  const rgbAssets = (walletState?.rgbAssets || []) as RGBAsset[];
  const btcBalance = walletState?.btcBalance;
  
  const [selectedAsset, setSelectedAsset] = useState<Asset>({
    asset_id: 'BTC',
    ticker: 'BTC',
    name: 'Bitcoin',
    isRGB: false,
  });
  const [networkType, setNetworkType] = useState<'on-chain' | 'lightning'>('on-chain');
  const [address, setAddress] = useState('');
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [showAssetSelector, setShowAssetSelector] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apiService = RGBApiService.getInstance();

  // Combine BTC with RGB assets with proper validation
  const allAssets: Asset[] = [
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
      balance: asset.balance?.spendable || 0,
    })) : [])
  ];

  // Enhanced validation function
  const validateAddressOrInvoice = (data: any): string | null => {
    if (!data) return null;
    
    const cleanData = typeof data === 'string' ? data.trim() : String(data).trim();
    
    if (cleanData.length === 0) return null;
    
    // More lenient validation - accept any non-empty string that looks like an address or invoice
    if (cleanData.length < 10) return null;
    
    return cleanData;
  };

  // Check if amount is required and valid
  const isAmountRequired = (): boolean => {
    return networkType === 'lightning';
  };

  const isAmountValid = (): boolean => {
    if (!isAmountRequired()) return true;
    
    const numAmount = parseFloat(amount);
    return !isNaN(numAmount) && numAmount > 0;
  };

  const generateAddress = async () => {
    if (!selectedAsset) return;
    
    // Clear previous error
    setError(null);
    
    // Validate amount if required
    if (isAmountRequired() && !isAmountValid()) {
      setError('Please enter a valid amount for Lightning invoices');
      return;
    }
    
    setLoading(true);
    try {
      let result: any = null;
      
      if (selectedAsset.asset_id === 'BTC') {
        if (networkType === 'on-chain') {
          const response = await apiService.getNewAddress();
          result = response;
        } else {
          // Lightning invoice for BTC
          if (!amount || !isAmountValid()) {
            throw new Error('Amount is required for Lightning invoices');
          }
          
          const amountMsat = Math.round(parseFloat(amount) * (bitcoinUnit === 'BTC' ? 100000000 * 1000 : 1000));
          
          const response = await apiService.createLightningInvoice({
            amount_msat: amountMsat,
            description: `Receive ${amount} ${bitcoinUnit}`,
            duration_seconds: 3600, // 1 hour expiry
          });
          result = response?.invoice;
        }
      } else {
        // For RGB assets
        if (networkType === 'on-chain') {
          // Create RGB invoice for on-chain transfer
          const response = await apiService.getRGBInvoice({
            asset_id: selectedAsset.asset_id,
            min_confirmations: 1,
            duration_seconds: 3600, // 1 hour
          });
          result = response?.invoice;
        } else {
          // Lightning invoice for RGB asset
          if (!amount || !isAmountValid()) {
            throw new Error('Amount is required for RGB Lightning invoices');
          }
          
          const assetAmount = parseFloat(amount);

          const response = await apiService.createLightningInvoice({
            asset_id: selectedAsset.asset_id,
            asset_amount: assetAmount,
            description: `Receive ${amount} ${selectedAsset.ticker}`,
            duration_seconds: 3600, // 1 hour expiry
          });
          result = response?.invoice;
        }
      }

      // Enhanced validation with better error handling
      const validatedResult = validateAddressOrInvoice(result);
      if (validatedResult) {
        setAddress(validatedResult);
        setError(null);
      } else {
        throw new Error('Unable to generate a valid address or invoice. Please try again.');
      }
    } catch (error) {
      console.error('Failed to generate address:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to generate address. Please try again.';
      setError(errorMessage);
      setAddress(''); // Reset address on error
    } finally {
      setLoading(false);
    }
  };

  // Auto-generate address when conditions change
  useEffect(() => {
    if (selectedAsset) {
      setAddress('');
      setError(null);
      
      // Only auto-generate if amount is not required, or if it's valid
      if (!isAmountRequired() || isAmountValid()) {
        generateAddress();
      }
    }
  }, [selectedAsset, networkType]);

  // Generate address when amount changes for lightning
  useEffect(() => {
    if (networkType === 'lightning' && amount && isAmountValid()) {
      const timeoutId = setTimeout(() => {
        generateAddress();
      }, 500); // Debounce amount changes
      
      return () => clearTimeout(timeoutId);
    }
  }, [amount]);

  const copyToClipboard = async () => {
    if (!address) return;
    await Clipboard.setString(address);
    Alert.alert('Copied', 'Address copied to clipboard');
  };

  const shareAddress = async () => {
    if (!address) return;
    try {
      await Share.share({
        message: address,
        title: `${selectedAsset?.ticker} ${networkType === 'lightning' ? 'Invoice' : 'Address'}`,
      });
    } catch (error) {
      console.error('Failed to share:', error);
    }
  };

  const AssetIcon = ({ asset }: { asset: Asset }) => {
    const { iconUrl } = useAssetIcon(asset?.ticker || '');
    
    if (!asset) return null;
    
    if (asset.ticker === 'BTC') {
      return (
        <View style={styles.assetIconContainer}>
          <Ionicons name="logo-bitcoin" size={24} color="#F7931A" />
        </View>
      );
    }
    
    if (iconUrl) {
      return (
        <View style={styles.assetIconContainer}>
          <Image source={{ uri: iconUrl }} style={styles.assetIconImage} />
        </View>
      );
    }
    
    return (
      <View style={styles.assetIconContainer}>
        <Ionicons name="diamond" size={24} color={theme.colors.primary[500]} />
      </View>
    );
  };

  const renderHeader = () => {
    return (
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
            <Text style={styles.headerTitle}>Receive</Text>
            <TouchableOpacity
              style={styles.helpButton}
              onPress={() => Alert.alert('Help', 'Generate addresses and invoices to receive payments')}
            >
              <Ionicons name="help-circle-outline" size={24} color={theme.colors.text.inverse} />
            </TouchableOpacity>
          </View>
          
          {/* Asset Selector */}
          {selectedAsset && (
            <TouchableOpacity 
              style={styles.assetSelector}
              onPress={() => setShowAssetSelector(!showAssetSelector)}
              activeOpacity={0.8}
            >
              <AssetIcon asset={selectedAsset} />
              <View style={styles.assetInfo}>
                <Text style={styles.assetTicker}>{selectedAsset.ticker}</Text>
                <Text style={styles.assetName}>{selectedAsset.name}</Text>
                {typeof selectedAsset.balance === 'number' && (
                  <Text style={styles.assetBalance}>
                    Balance: {selectedAsset.balance.toLocaleString()}
                  </Text>
                )}
              </View>
              <View style={styles.chevronContainer}>
                <Ionicons 
                  name={showAssetSelector ? "chevron-up" : "chevron-down"} 
                  size={20} 
                  color="rgba(255, 255, 255, 0.8)" 
                />
              </View>
            </TouchableOpacity>
          )}
        </LinearGradient>
        
        {/* Asset Dropdown */}
        {showAssetSelector && allAssets.length > 0 && (
          <View style={styles.assetDropdown}>
            <ScrollView style={styles.assetDropdownScroll} nestedScrollEnabled>
              {allAssets.map((asset) => (
                <TouchableOpacity
                  key={asset.asset_id}
                  style={[
                    styles.assetOption,
                    selectedAsset.asset_id === asset.asset_id && styles.assetOptionSelected
                  ]}
                  onPress={() => {
                    setSelectedAsset(asset);
                    setShowAssetSelector(false);
                  }}
                  activeOpacity={0.7}
                >
                  <AssetIcon asset={asset} />
                  <View style={styles.assetOptionInfo}>
                    <Text style={styles.assetOptionTicker}>{asset.ticker}</Text>
                    <Text style={styles.assetOptionName}>{asset.name}</Text>
                    {typeof asset.balance === 'number' && (
                      <Text style={styles.assetOptionBalance}>
                        Balance: {asset.balance.toLocaleString()}
                      </Text>
                    )}
                  </View>
                  {selectedAsset.asset_id === asset.asset_id && (
                    <Ionicons name="checkmark-circle" size={20} color={theme.colors.success[500]} />
                  )}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}
      </View>
    );
  };

  const renderNetworkTabs = () => {
    return (
      <View style={styles.networkTabsContainer}>
        <View style={styles.networkTabs}>
          <TouchableOpacity
            style={[
              styles.networkTab,
              networkType === 'on-chain' && styles.networkTabActive
            ]}
            onPress={() => setNetworkType('on-chain')}
            activeOpacity={0.8}
          >
            <Ionicons 
              name="link" 
              size={18} 
              color={networkType === 'on-chain' ? theme.colors.primary[500] : theme.colors.text.secondary} 
            />
            <Text style={[
              styles.networkTabText,
              networkType === 'on-chain' && styles.networkTabTextActive
            ]}>
              {selectedAsset?.isRGB ? 'RGB On-chain' : 'On-chain'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.networkTab,
              networkType === 'lightning' && styles.networkTabActive
            ]}
            onPress={() => setNetworkType('lightning')}
            activeOpacity={0.8}
          >
            <Ionicons 
              name="flash" 
              size={18} 
              color={networkType === 'lightning' ? theme.colors.primary[500] : theme.colors.text.secondary} 
            />
            <Text style={[
              styles.networkTabText,
              networkType === 'lightning' && styles.networkTabTextActive
            ]}>
              {selectedAsset?.isRGB ? 'RGB Lightning' : 'Lightning'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const renderAmountInput = () => {
    if (!selectedAsset) return null;
    
    const showAmount = isAmountRequired() || selectedAsset.isRGB;
    if (!showAmount) return null;

    const isRequired = isAmountRequired();

    // Quick amount buttons for BTC
    const renderQuickAmounts = () => {
      if (selectedAsset.ticker !== 'BTC') return null;
      
      const quickAmounts = bitcoinUnit === 'BTC' 
        ? ['0.001', '0.005', '0.01'] 
        : ['1000', '5000', '10000'];
      
      return (
        <View style={styles.quickAmounts}>
          {quickAmounts.map((amt) => (
            <TouchableOpacity
              key={amt}
              style={[
                styles.quickAmountButton,
                amount === amt && styles.quickAmountButtonSelected
              ]}
              onPress={() => setAmount(amt)}
            >
              <Text style={[
                styles.quickAmountText,
                amount === amt && styles.quickAmountTextSelected
              ]}>
                {amt} {bitcoinUnit}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      );
    };

    return (
      <View style={styles.amountSection}>
        <Text style={styles.sectionTitle}>
          Amount {isRequired ? '(Required)' : '(Optional)'}
        </Text>
        <Text style={styles.sectionDescription}>
          {selectedAsset.isRGB 
            ? networkType === 'lightning'
              ? `Enter the amount of ${selectedAsset.ticker} to receive via Lightning`
              : `Specify the amount of ${selectedAsset.ticker} for the RGB invoice`
            : isRequired
              ? `Enter the amount of ${bitcoinUnit} to receive`
              : 'Leave empty for any amount or specify a fixed amount'
          }
        </Text>
        
        {/* Error message for amount */}
        {isRequired && amount && !isAmountValid() && (
          <View style={styles.errorMessage}>
            <Ionicons name="warning" size={16} color={theme.colors.error[500]} />
            <Text style={styles.errorMessageText}>Please enter a valid amount</Text>
          </View>
        )}
        
        <View style={styles.inputContainer}>
          <Input
            placeholder={bitcoinUnit === 'BTC' ? "0.00000000" : "0"}
            value={amount}
            onChangeText={(value) => {
              // Clean and format the input
              const cleanValue = value.replace(/[^0-9.]/g, '');
              const parts = cleanValue.split('.');
              if (parts.length > 2) return; // Only allow one decimal point
              
              // Limit decimal places based on unit
              const maxDecimals = bitcoinUnit === 'BTC' ? 8 : 0;
              if (parts[1] && parts[1].length > maxDecimals) return;
              
              setAmount(parseInputAmount(cleanValue, bitcoinUnit));
            }}
            keyboardType="decimal-pad"
            variant="outlined"
            style={
              isRequired && amount && !isAmountValid() 
                ? { ...styles.amountInput, ...styles.amountInputError }
                : styles.amountInput
            }
          />
          <View style={styles.currencyLabel}>
            <Text style={styles.currencyText}>
              {selectedAsset.ticker === 'BTC' ? bitcoinUnit : selectedAsset.ticker}
            </Text>
          </View>
        </View>
        
        {renderQuickAmounts()}
        
        {selectedAsset.ticker === 'BTC' && amount && isAmountValid() && (
          <Text style={styles.approximateValue}>
            ≈ ${((bitcoinUnit === 'sats' ? parseFloat(amount) / 100000000 : parseFloat(amount)) * 50000).toLocaleString()} USD
          </Text>
        )}
      </View>
    );
  };

  // Helper function to validate address for QR code
  const isValidQRData = (data: string): boolean => {
    return validateAddressOrInvoice(data) !== null;
  };

  const renderContent = () => {
    if (loading) {
      return (
        <View style={styles.loadingSection}>
          <ActivityIndicator size="large" color={theme.colors.primary[500]} />
          <Text style={styles.loadingText}>
            Generating {networkType === 'lightning' ? 'invoice' : 'address'}...
          </Text>
        </View>
      );
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

    // Render QR code
    const qrTitle = selectedAsset.isRGB 
      ? 'RGB Asset Invoice'
      : selectedAsset.asset_id === 'BTC' && networkType === 'lightning' 
      ? 'Lightning Invoice'
      : 'Bitcoin Address';

    return (
      <View style={styles.qrSection}>
        <View style={styles.qrHeader}>
          <Text style={styles.qrTitle}>{qrTitle}</Text>
          {amount && selectedAsset.ticker && (
            <View style={styles.qrAmountContainer}>
              <Text style={styles.qrAmount}>
                {amount} {selectedAsset.ticker}
              </Text>
            </View>
          )}
        </View>

        <View style={styles.qrContainer}>
          <View style={styles.qrCodeWrapper}>
            <QRCode
              value={address}
              size={220}
              backgroundColor={theme.colors.surface.primary || '#FFFFFF'}
              color={theme.colors.text.primary || '#000000'}
              logoSize={40}
              logoMargin={8}
              logoBorderRadius={8}
            />
          </View>
        </View>

        <View style={styles.addressContainer}>
          <Text style={styles.addressLabel}>Address/Invoice</Text>
          <Text style={styles.addressText} numberOfLines={4} selectable>
            {address}
          </Text>
        </View>

        <View style={styles.qrActions}>
          <TouchableOpacity 
            style={styles.qrActionButton} 
            onPress={copyToClipboard}
            activeOpacity={0.7}
          >
            <View style={styles.qrActionIcon}>
              <Ionicons name="copy" size={18} color={theme.colors.primary[500]} />
            </View>
            <Text style={styles.qrActionText}>Copy</Text>
          </TouchableOpacity>
          
          <TouchableOpacity 
            style={styles.qrActionButton} 
            onPress={shareAddress}
            activeOpacity={0.7}
          >
            <View style={styles.qrActionIcon}>
              <Ionicons name="share" size={18} color={theme.colors.primary[500]} />
            </View>
            <Text style={styles.qrActionText}>Share</Text>
          </TouchableOpacity>
          
          <TouchableOpacity 
            style={styles.qrActionButton} 
            onPress={generateAddress}
            activeOpacity={0.7}
          >
            <View style={styles.qrActionIcon}>
              <Ionicons name="refresh" size={18} color={theme.colors.primary[500]} />
            </View>
            <Text style={styles.qrActionText}>New</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      {renderHeader()}
      {renderNetworkTabs()}
      
      <ScrollView 
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {renderAmountInput()}
        {renderContent()}
      </ScrollView>
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
  
  scrollView: {
    flex: 1,
  },
  
  scrollContent: {
    paddingHorizontal: theme.spacing[5],
    paddingBottom: theme.spacing[6],
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
  qrSection: {
    backgroundColor: theme.colors.surface.primary,
    borderRadius: theme.borderRadius.xl,
    padding: theme.spacing[6],
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
  
  qrHeader: {
    alignItems: 'center',
    marginBottom: theme.spacing[5],
  },
  
  qrTitle: {
    fontSize: theme.typography.fontSize.xl,
    fontWeight: '700',
    color: theme.colors.text.primary,
    textAlign: 'center',
    marginBottom: theme.spacing[2],
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
    marginBottom: theme.spacing[5],
  },
  
  qrCodeWrapper: {
    padding: theme.spacing[5],
    backgroundColor: theme.colors.surface.primary,
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