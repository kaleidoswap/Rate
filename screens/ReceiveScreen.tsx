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
  const { rgbAssets = [], btcBalance } = useSelector((state: RootState) => state.wallet) as { 
    rgbAssets: RGBAsset[];
    btcBalance: any;
  };
  
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

  const apiService = RGBApiService.getInstance();

  // Combine BTC with RGB assets
  const allAssets: Asset[] = [
    { 
      asset_id: 'BTC', 
      ticker: 'BTC', 
      name: 'Bitcoin',
      isRGB: false,
      balance: btcBalance?.vanilla?.spendable || 0,
    },
    ...rgbAssets.map((asset: RGBAsset) => ({
      asset_id: asset.asset_id,
      ticker: asset.ticker,
      name: asset.name,
      isRGB: true,
      balance: asset.balance.spendable,
    }))
  ];

  const generateAddress = async () => {
    if (!selectedAsset) return;
    
    setLoading(true);
    try {
      if (selectedAsset.asset_id === 'BTC') {
        if (networkType === 'on-chain') {
          const result = await apiService.getNewAddress();
          setAddress(result);
        } else {
          // Lightning invoice for BTC
          const result = await apiService.createLightningInvoice({
            amount_msat: amount ? parseFloat(amount) * 100000000 * 1000 : undefined,
            description: `Receive ${amount ? amount + ' ' : ''}${selectedAsset.ticker}`,
          });
          setAddress(result.invoice);
        }
      } else {
        // For RGB assets, create an RGB invoice
        const result = await apiService.getRGBInvoice({
          asset_id: selectedAsset.asset_id,
          min_confirmations: 1,
          duration_seconds: 3600, // 1 hour
        });
        setAddress(result.invoice);
      }
    } catch (error) {
      console.error('Failed to generate address:', error);
      Alert.alert('Error', 'Failed to generate address');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (selectedAsset) {
      setAddress('');
      generateAddress();
    }
  }, [selectedAsset, networkType, amount]);

  const copyToClipboard = async () => {
    await Clipboard.setString(address);
    Alert.alert('Copied', 'Address copied to clipboard');
  };

  const shareAddress = async () => {
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
    const { iconUrl } = useAssetIcon(asset.ticker);
    
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

  const renderHeader = () => (
    <LinearGradient
      colors={['#667eea', '#764ba2']}
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
        <Text style={styles.headerTitle}>Receive Payment</Text>
        <View style={styles.headerSpacer} />
      </View>
      
      {/* Asset Selector in Header */}
      <TouchableOpacity 
        style={styles.assetSelector}
        onPress={() => setShowAssetSelector(!showAssetSelector)}
      >
        <AssetIcon asset={selectedAsset} />
        <View style={styles.assetInfo}>
          <Text style={styles.assetTicker}>{selectedAsset.ticker}</Text>
          <Text style={styles.assetName}>{selectedAsset.name}</Text>
        </View>
        <Ionicons 
          name={showAssetSelector ? "chevron-up" : "chevron-down"} 
          size={20} 
          color={theme.colors.text.inverse} 
        />
      </TouchableOpacity>
      
      {/* Asset Dropdown */}
      {showAssetSelector && (
        <View style={styles.assetDropdown}>
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
            >
              <AssetIcon asset={asset} />
              <View style={styles.assetOptionInfo}>
                <Text style={styles.assetOptionTicker}>{asset.ticker}</Text>
                <Text style={styles.assetOptionName}>{asset.name}</Text>
                {asset.balance && (
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
        </View>
      )}
    </LinearGradient>
  );

  const renderNetworkSelector = () => {
    // Only show network selector for BTC
    if (selectedAsset.isRGB) return null;

    return (
      <Card style={styles.networkCard}>
        <Text style={styles.sectionTitle}>Network Type</Text>
        <View style={styles.networkSelector}>
          <TouchableOpacity
            style={[
              styles.networkButton,
              networkType === 'on-chain' && styles.networkButtonActive
            ]}
            onPress={() => setNetworkType('on-chain')}
          >
            <Ionicons 
              name="link" 
              size={18} 
              color={networkType === 'on-chain' ? theme.colors.text.inverse : theme.colors.text.secondary} 
            />
            <Text style={[
              styles.networkButtonText,
              networkType === 'on-chain' && styles.networkButtonTextActive
            ]}>
              On-chain
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.networkButton,
              networkType === 'lightning' && styles.networkButtonActive
            ]}
            onPress={() => setNetworkType('lightning')}
          >
            <Ionicons 
              name="flash" 
              size={18} 
              color={networkType === 'lightning' ? theme.colors.text.inverse : theme.colors.text.secondary} 
            />
            <Text style={[
              styles.networkButtonText,
              networkType === 'lightning' && styles.networkButtonTextActive
            ]}>
              Lightning
            </Text>
          </TouchableOpacity>
        </View>
      </Card>
    );
  };

  const renderAmountInput = () => {
    // Show amount input for Lightning or RGB assets
    const showAmount = networkType === 'lightning' || selectedAsset.isRGB;
    if (!showAmount) return null;

    return (
      <Card style={styles.amountCard}>
        <Text style={styles.sectionTitle}>
          Amount {networkType === 'lightning' ? '(Optional)' : ''}
        </Text>
        <Text style={styles.amountDescription}>
          {selectedAsset.isRGB 
            ? `Specify the amount of ${selectedAsset.ticker} for the invoice`
            : 'Specify an amount for the Lightning invoice'
          }
        </Text>
        <Input
          placeholder="0.00000000"
          value={amount}
          onChangeText={setAmount}
          keyboardType="decimal-pad"
          variant="outlined"
          rightIcon={<Text style={styles.currencyLabel}>{selectedAsset.ticker}</Text>}
        />
      </Card>
    );
  };

  const renderQRCode = () => {
    if (!address) return null;

    const qrTitle = selectedAsset.isRGB 
      ? 'RGB Asset Invoice'
      : selectedAsset.asset_id === 'BTC' && networkType === 'lightning' 
      ? 'Lightning Invoice'
      : 'Bitcoin Address';

    return (
      <Card variant="elevated" style={styles.qrCard}>
        <View style={styles.qrHeader}>
          <Text style={styles.qrTitle}>{qrTitle}</Text>
          {amount && (
            <Text style={styles.qrAmount}>
              {amount} {selectedAsset.ticker}
            </Text>
          )}
        </View>

        <View style={styles.qrContainer}>
          <QRCode
            value={address}
            size={200}
            backgroundColor={theme.colors.surface.primary}
            color={theme.colors.text.primary}
          />
        </View>

        <View style={styles.addressContainer}>
          <Text style={styles.addressText} numberOfLines={3} selectable>
            {address}
          </Text>
        </View>

        <View style={styles.qrActions}>
          <TouchableOpacity style={styles.qrActionButton} onPress={copyToClipboard}>
            <Ionicons name="copy" size={20} color={theme.colors.primary[500]} />
            <Text style={styles.qrActionText}>Copy</Text>
          </TouchableOpacity>
          
          <TouchableOpacity style={styles.qrActionButton} onPress={shareAddress}>
            <Ionicons name="share" size={20} color={theme.colors.primary[500]} />
            <Text style={styles.qrActionText}>Share</Text>
          </TouchableOpacity>
          
          <TouchableOpacity style={styles.qrActionButton} onPress={generateAddress}>
            <Ionicons name="refresh" size={20} color={theme.colors.primary[500]} />
            <Text style={styles.qrActionText}>New</Text>
          </TouchableOpacity>
        </View>
      </Card>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      {renderHeader()}
      
      <ScrollView 
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}
      >
        {renderNetworkSelector()}
        {renderAmountInput()}

        {loading ? (
          <Card style={styles.loadingCard}>
            <ActivityIndicator size="large" color={theme.colors.primary[500]} />
            <Text style={styles.loadingText}>
              Generating {networkType === 'lightning' || selectedAsset.isRGB ? 'invoice' : 'address'}...
            </Text>
          </Card>
        ) : (
          renderQRCode()
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background.secondary,
  },
  
  headerGradient: {
    paddingBottom: theme.spacing[4],
  },
  
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing[5],
    paddingTop: theme.spacing[4],
    marginBottom: theme.spacing[4],
  },
  
  backButton: {
    width: 40,
    height: 40,
    borderRadius: theme.borderRadius.base,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  
  headerTitle: {
    fontSize: theme.typography.fontSize.xl,
    fontWeight: '700',
    color: theme.colors.text.inverse,
  },
  
  headerSpacer: {
    width: 40,
  },
  
  assetSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.spacing[5],
    paddingVertical: theme.spacing[3],
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    marginHorizontal: theme.spacing[5],
    borderRadius: theme.borderRadius.lg,
  },
  
  assetIconContainer: {
    width: 32,
    height: 32,
    borderRadius: theme.borderRadius.base,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: theme.spacing[3],
  },
  
  assetIconImage: {
    width: 24,
    height: 24,
    borderRadius: 12,
  },
  
  assetInfo: {
    flex: 1,
  },
  
  assetTicker: {
    fontSize: theme.typography.fontSize.lg,
    fontWeight: '700',
    color: theme.colors.text.inverse,
  },
  
  assetName: {
    fontSize: theme.typography.fontSize.sm,
    color: 'rgba(255, 255, 255, 0.8)',
  },
  
  assetDropdown: {
    backgroundColor: theme.colors.surface.primary,
    marginHorizontal: theme.spacing[5],
    marginTop: theme.spacing[2],
    borderRadius: theme.borderRadius.lg,
    maxHeight: 300,
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
  },
  
  assetOptionBalance: {
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.text.muted,
    marginTop: theme.spacing[1],
  },
  
  scrollView: {
    flex: 1,
    paddingHorizontal: theme.spacing[5],
  },
  
  networkCard: {
    marginTop: theme.spacing[5],
    marginBottom: theme.spacing[4],
  },
  
  sectionTitle: {
    fontSize: theme.typography.fontSize.lg,
    fontWeight: '600',
    color: theme.colors.text.primary,
    marginBottom: theme.spacing[3],
  },
  
  networkSelector: {
    flexDirection: 'row',
    backgroundColor: theme.colors.gray[100],
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing[1],
  },
  
  networkButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: theme.spacing[3],
    borderRadius: theme.borderRadius.base,
    gap: theme.spacing[2],
  },
  
  networkButtonActive: {
    backgroundColor: theme.colors.primary[500],
  },
  
  networkButtonText: {
    fontSize: theme.typography.fontSize.sm,
    fontWeight: '500',
    color: theme.colors.text.secondary,
  },
  
  networkButtonTextActive: {
    color: theme.colors.text.inverse,
  },
  
  amountCard: {
    marginBottom: theme.spacing[4],
  },
  
  amountDescription: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.text.secondary,
    marginBottom: theme.spacing[3],
  },
  
  currencyLabel: {
    fontSize: theme.typography.fontSize.sm,
    fontWeight: '500',
    color: theme.colors.text.secondary,
  },
  
  qrCard: {
    alignItems: 'center',
    marginBottom: theme.spacing[4],
  },
  
  qrHeader: {
    alignItems: 'center',
    marginBottom: theme.spacing[4],
  },
  
  qrTitle: {
    fontSize: theme.typography.fontSize.lg,
    fontWeight: '600',
    color: theme.colors.text.primary,
    textAlign: 'center',
  },
  
  qrAmount: {
    fontSize: theme.typography.fontSize.base,
    fontWeight: '500',
    color: theme.colors.primary[600],
    marginTop: theme.spacing[1],
  },
  
  qrContainer: {
    padding: theme.spacing[4],
    backgroundColor: theme.colors.surface.primary,
    borderRadius: theme.borderRadius.lg,
    marginBottom: theme.spacing[4],
  },
  
  addressContainer: {
    width: '100%',
    backgroundColor: theme.colors.gray[50],
    borderRadius: theme.borderRadius.base,
    padding: theme.spacing[3],
    marginBottom: theme.spacing[4],
  },
  
  addressText: {
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.text.primary,
    fontFamily: 'monospace',
    textAlign: 'center',
  },
  
  qrActions: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    width: '100%',
  },
  
  qrActionButton: {
    alignItems: 'center',
    padding: theme.spacing[3],
  },
  
  qrActionText: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.primary[500],
    marginTop: theme.spacing[1],
    fontWeight: '500',
  },
  
  loadingCard: {
    alignItems: 'center',
    paddingVertical: theme.spacing[8],
    marginBottom: theme.spacing[4],
  },
  
  loadingText: {
    fontSize: theme.typography.fontSize.base,
    color: theme.colors.text.secondary,
    marginTop: theme.spacing[4],
  },
});