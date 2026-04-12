// screens/ReceiveScreen.tsx
import React, { useState, useEffect, useMemo } from 'react';
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
// RGBApiService removed — all operations via protocolManager
import { protocolManager } from '../services/protocols';
import { useRefreshableProtocolStatus } from '../hooks/useProtocol';
import {
  getAssetFamily, resolveReceiveAccounts, getNetworkTypesForAccount,
  type AccountId, type NetworkType as ProtocolNetworkType,
} from '../utils/account-routing';
import { theme } from '../theme';
import { Card, Button, Input, ScreenHeader } from '../components';
import { AssetIcon } from '../components/AssetIcon';
import { AssetSelector, type SelectableAsset } from '../components/AssetSelector';
import { NetworkIcon } from '../components/NetworkIcon';
import { useFormattedBitcoinAmount, parseInputAmount, useBitcoinConversion } from '../utils/bitcoinUnits';

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

export default function ReceiveScreen({ navigation }: Props) {
  const walletState = useSelector((state: RootState) => state.wallet);
  const assetsState = useSelector((state: RootState) => state.assets);
  const bitcoinUnit = useSelector((state: RootState) => state.settings.bitcoinUnit);
  const { formatSatoshisToUSD } = useBitcoinConversion();
  
  // Safe destructuring with fallbacks
  const rgbAssets = (assetsState?.rgbAssets || []) as RGBAsset[];
  const btcBalance = walletState?.btcBalance;
  

  
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
  const [networkType, setNetworkType] = useState<ProtocolNetworkType>(getDefaultNetwork());
  const [address, setAddress] = useState('');
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [showAssetSelector, setShowAssetSelector] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [channelsLoading, setChannelsLoading] = useState(false);
  const [maxDepositAmount, setMaxDepositAmount] = useState<number>(0);
  const [isUserTyping, setIsUserTyping] = useState(false);
  const [arkadeSubMode, setArkadeSubMode] = useState<'ark' | 'boarding'>('ark');

  // Determine available network types based on connected protocols and selected asset
  const availableNetworkTypes = useMemo((): ProtocolNetworkType[] => {
    const status = getProtocolStatus();
    const family = getAssetFamily(selectedAsset.asset_id, selectedAsset.ticker);
    const accounts = resolveReceiveAccounts({ assetFamily: family, accounts: status });

    const networks = new Set<ProtocolNetworkType>();
    for (const account of accounts) {
      for (const net of getNetworkTypesForAccount(account, family)) {
        networks.add(net);
      }
    }

    // Always include on-chain and lightning if RGB is connected (legacy compatibility)
    if (status.RGB) {
      networks.add('onchain');
      networks.add('lightning');
    }

    return Array.from(networks);
  }, [selectedAsset, getProtocolStatus]);
  
  // Constants for HTLC calculations (from desktop app)
  const MSATS_PER_SAT = 1000;
  const RGB_HTLC_MIN_SAT = 3000;

  // Load Lightning channels
  const loadChannels = async () => {
    if (channelsLoading) return;
    
    try {
      setChannelsLoading(true);
      const rgbAdapter = protocolManager.getAdapterIfAvailable('RGB');
      const channelsResponse = rgbAdapter?.isConnected() ? await rgbAdapter.listChannels() : { channels: [] };
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

    setError(null);

    if (isAmountRequired() && !isAmountValid()) {
      setError('Please enter a valid amount');
      return;
    }

    setLoading(true);
    try {
      let result: any = null;

      // ── Spark network ──
      if (networkType === 'spark') {
        try {
          const sparkAdapter = protocolManager.getAdapter('SPARK');
          if (amount && isAmountValid()) {
            const cleanAmount = amount.replace(/,/g, '');
            const numericAmount = parseFloat(cleanAmount);
            const amountSats = bitcoinUnit === 'BTC'
              ? Math.round(numericAmount * 1e8)
              : Math.round(numericAmount);
            const invoice = await sparkAdapter.createInvoice({
              amount: amountSats,
              description: `Receive ${cleanAmount} ${bitcoinUnit}`,
              expirySeconds: 3600,
            });
            result = invoice.invoice;
          } else {
            const addr = await sparkAdapter.getReceiveAddress();
            result = addr.address;
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
            const addr = await arkadeAdapter.getReceiveAddress('boarding');
            result = addr.address;
          } else {
            const addr = await arkadeAdapter.getReceiveAddress();
            result = addr.address;
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
            const addr = await rgbAdapter.getReceiveAddress();
            result = addr.address;
          } else if (sparkAdapter?.isConnected()) {
            // Spark can provide a single-use deposit address for on-chain BTC
            const addr = await sparkAdapter.getReceiveAddress('onchain');
            result = addr.address;
          } else {
            throw new Error('No wallet connected for on-chain deposit');
          }
        } else {
          // Lightning invoice for BTC
          if (!amount || !isAmountValid()) {
            throw new Error('Amount is required for Lightning invoices');
          }
          const cleanAmount = amount.replace(/,/g, '');
          const numericAmount = parseFloat(cleanAmount);
          const amountSats = bitcoinUnit === 'BTC'
            ? Math.round(numericAmount * 1e8)
            : Math.round(numericAmount);

          // Try RGB first (Lightning), then Spark (also supports Lightning)
          const rgbLn = protocolManager.getAdapterIfAvailable('RGB');
          const sparkLn = protocolManager.getAdapterIfAvailable('SPARK');
          if (rgbLn?.isConnected()) {
            const invoice = await rgbLn.createInvoice({
              amount: amountSats,
              description: `Receive ${cleanAmount} ${bitcoinUnit}`,
              expirySeconds: 3600,
            });
            result = invoice.invoice;
          } else if (sparkLn?.isConnected()) {
            const invoice = await sparkLn.createInvoice({
              amount: amountSats,
              description: `Receive ${cleanAmount} ${bitcoinUnit}`,
              expirySeconds: 3600,
            });
            result = invoice.invoice;
          } else {
            throw new Error('No wallet connected for Lightning invoice');
          }
        }
      } else {
        // RGB assets (require RGB adapter)
        if (networkType === 'onchain') {
          const rgbAssetAdapter = protocolManager.getAdapterIfAvailable('RGB');
          if (!rgbAssetAdapter?.isConnected()) {
            throw new Error('RGB node required for on-chain RGB asset deposits. Please configure in Settings.');
          }
          const rgbInvoice = await rgbAssetAdapter.createRgbInvoice?.({
            asset_id: selectedAsset.asset_id,
            min_confirmations: 1,
            duration_seconds: 3600,
          });
          result = rgbInvoice?.invoice;
        } else {
          // Lightning invoice for RGB asset
          if (!amount || !isAmountValid()) {
            throw new Error('Amount is required for RGB Lightning invoices');
          }
          const cleanAmount = amount.replace(/,/g, '');
          const assetAmount = parseFloat(cleanAmount);

          const rgbAssetLnAdapter = protocolManager.getAdapterIfAvailable('RGB');
          if (!rgbAssetLnAdapter?.isConnected()) {
            throw new Error('RGB node required for RGB Lightning deposits. Please configure in Settings.');
          }
          const assetInvoice = await rgbAssetLnAdapter.createInvoice({
            asset: selectedAsset.asset_id,
            assetAmount,
            description: `Receive ${cleanAmount} ${selectedAsset.ticker}`,
            expirySeconds: 3600,
          });
          result = assetInvoice.invoice;
        }
      }

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
      if (errorMessage.includes('No uncolored UTXOs')) {
        setError('No uncolored UTXOs available. Please create UTXOs first or try a different network.');
      } else {
        setError(errorMessage);
      }
      setAddress('');
    } finally {
      setLoading(false);
    }
  };

  // Load channels when component mounts or network type changes
  useEffect(() => {
    if (networkType === 'lightning') {
      loadChannels();
    }
  }, [networkType]);

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
      const isAssetAvailable = allAssets.some(asset => asset.asset_id === selectedAsset.asset_id);
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
    if (selectedAsset) {
      setAddress('');
      setError(null);
      
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

  // Generate address when amount changes for lightning (only when user stops typing)
  useEffect(() => {
    if (networkType === 'lightning' && amount && isAmountValid() && !isUserTyping) {
      const timeoutId = setTimeout(() => {
        if (!isUserTyping) { // Double check user isn't typing
          generateAddress();
        }
      }, 2000);
      
      return () => clearTimeout(timeoutId);
    }
  }, [amount, isUserTyping]);

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

  // AssetIcon is now imported from components/AssetIcon

  const renderHeader = () => (
    <View>
      <ScreenHeader title="Receive" showBack={true} />

      {/* Asset Selector — below header, above network tabs */}
      <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 }}>
        {selectedAsset && (
          <TouchableOpacity
            onPress={() => setShowAssetSelector(true)}
            activeOpacity={0.7}
            style={{
              flexDirection: 'row', alignItems: 'center',
              backgroundColor: theme.colors.surface.primary,
              borderRadius: 14, padding: 12,
              shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 2,
            }}
          >
            <AssetIcon ticker={selectedAsset.ticker} protocol={selectedAsset.isRGB ? 'RGB' : undefined} size={36} showBadge={false} />
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={{ fontSize: 16, fontWeight: '600', color: theme.colors.text.primary }}>{selectedAsset.ticker}</Text>
              <Text style={{ fontSize: 12, color: theme.colors.text.tertiary }}>{selectedAsset.name}</Text>
            </View>
            <Ionicons name="chevron-down" size={18} color={theme.colors.gray[400]} />
          </TouchableOpacity>
        )}
      </View>

      {/* Asset Selector Modal */}
      <AssetSelector
        visible={showAssetSelector}
        onClose={() => setShowAssetSelector(false)}
        onSelect={(asset) => {
          setSelectedAsset({
            asset_id: asset.asset_id,
            ticker: asset.ticker,
            name: asset.name,
            isRGB: asset.isRGB || asset.protocol === 'RGB',
            balance: asset.balance,
          });
        }}
        assets={allAssets.map(a => ({
          asset_id: a.asset_id,
          ticker: a.ticker,
          name: a.name,
          balance: a.balance,
          isRGB: a.isRGB,
          protocol: a.isRGB ? 'RGB' as const : undefined,
        }))}
        selectedAssetId={selectedAsset?.asset_id}
        title="Select Asset"
      />
    </View>
  );

  // Network color coding (matches rate-extension)
  const NETWORK_COLORS: Record<string, string> = {
    'onchain': '#F7931A', // Bitcoin orange
    'lightning': '#FACC15', // Lightning yellow
    'spark': '#60A5FA',     // Spark blue
    'arkade': '#A855F7',    // Arkade purple
  };

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
    const onChainAssets = getOnChainAssets();
    const lightningAssets = getLightningAssets();

    // Build list of available networks with metadata
    // Only show networks that are actually available (based on connected protocols)
    const allNetworks: Array<{ id: ProtocolNetworkType; label: string; icon: keyof typeof Ionicons.glyphMap; color: string; subtitle: string; available: boolean }> = [
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
                <TouchableOpacity
                  key={net.id}
                  onPress={() => setNetworkType(net.id)}
                  activeOpacity={0.7}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    paddingHorizontal: 14,
                    paddingVertical: 10,
                    borderRadius: 12,
                    backgroundColor: isActive ? net.color + '20' : theme.colors.background.secondary,
                    borderWidth: isActive ? 1.5 : 1,
                    borderColor: isActive ? net.color : theme.colors.background.tertiary || 'rgba(255,255,255,0.08)',
                    opacity: net.available ? 1 : 0.4,
                  }}
                >
                  <NetworkIcon network={net.id} size={18} color={isActive ? net.color : theme.colors.text.secondary} />
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
                </TouchableOpacity>
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
            <Ionicons name="information-circle" size={16} color={theme.colors.warning?.[500] || '#EAB308'} />
            <Text style={styles.networkWarningText}>
              Only Bitcoin available. Open RGB Lightning channels to receive RGB assets.
            </Text>
          </View>
        )}
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
              // Set typing flag to prevent interference
              setIsUserTyping(true);
              
              // Clear typing flag after user stops typing
              setTimeout(() => setIsUserTyping(false), 3000);
              
              // Simplified input handling to prevent focus issues
              let cleanValue = value.replace(/[^\d.,]/g, '');
              
              // Remove extra commas
              cleanValue = cleanValue.replace(/,/g, '');
              
              // Handle multiple decimal points
              const parts = cleanValue.split('.');
              if (parts.length > 2) {
                cleanValue = parts[0] + '.' + parts.slice(1).join('');
              }
              
              // Basic precision limit
              const precision = getAssetPrecision(selectedAsset.ticker);
              const decimalParts = cleanValue.split('.');
              if (decimalParts.length === 2 && decimalParts[1].length > precision) {
                return; // Don't update if exceeds precision
              }
              
              // Quick max amount check for lightning (without complex formatting)
              if (networkType === 'lightning' && maxDepositAmount > 0) {
                const numValue = parseFloat(cleanValue);
                if (!isNaN(numValue) && numValue > maxDepositAmount) {
                  return; // Don't update if exceeds max
                }
              }

              setAmount(cleanValue);
            }}
            onFocus={() => setIsUserTyping(true)}
            onBlur={() => {
              setTimeout(() => setIsUserTyping(false), 100);
            }}
            keyboardType="decimal-pad"
            variant="outlined"
            style={
              isRequired && amount && !isAmountValid() 
                ? { ...styles.amountInput, ...styles.amountInputError }
                : styles.amountInput
            }
            autoFocus={false}
          />
          <View style={styles.currencyLabel}>
            <Text style={styles.currencyText}>
              {selectedAsset.ticker === 'BTC' ? bitcoinUnit : selectedAsset.ticker}
            </Text>
          </View>
        </View>
        
        {renderQuickAmounts()}
        
        {/* Lightning warnings and limits */}
        {networkType === 'lightning' && (
          <View style={styles.lightningWarnings}>
            {selectedAsset.isRGB && (
              <View style={styles.warningContainer}>
                <Ionicons name="information-circle" size={16} color={theme.colors.primary[500]} />
                <Text style={styles.warningText}>
                  3,000 sats required for RGB asset transfers via Lightning
                </Text>
              </View>
            )}
            
            {maxDepositAmount === 0 && (
              <View style={[styles.warningContainer, styles.errorWarning]}>
                <Ionicons name="warning" size={16} color={theme.colors.warning[500]} />
                <Text style={[styles.warningText, styles.errorWarningText]}>
                  No active Lightning channels found. Lightning deposits are not available.
                </Text>
              </View>
            )}
            
            {maxDepositAmount > 0 && (
              <View style={styles.warningContainer}>
                <Ionicons name="flash" size={16} color={theme.colors.success[500]} />
                <Text style={styles.warningText}>
                  Max Lightning deposit: {formatAssetAmount(maxDepositAmount, selectedAsset.ticker)} {selectedAsset.ticker}
                </Text>
              </View>
            )}
          </View>
        )}
        
        {selectedAsset.ticker === 'BTC' && amount && isAmountValid() && (
          <Text style={styles.approximateValue}>
            ≈ ${parseFloat(formatSatoshisToUSD(amount.replace(/,/g, ''))).toLocaleString()} USD
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

    // Render QR code with network-aware title
    const qrTitle = networkType === 'spark' ? 'Spark Address'
      : networkType === 'arkade' ? (arkadeSubMode === 'boarding' ? 'Boarding Address' : 'Arkade Address')
      : networkType === 'lightning' ? 'Lightning Invoice'
      : selectedAsset.isRGB ? 'RGB Invoice'
      : 'On-chain Address';

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
          <View style={[styles.qrCodeWrapper, {
            borderColor: NETWORK_COLORS[networkType] || theme.colors.primary[500],
            borderWidth: 2,
            shadowColor: NETWORK_COLORS[networkType] || theme.colors.primary[500],
            shadowOffset: { width: 0, height: 0 },
            shadowOpacity: 0.3,
            shadowRadius: 12,
            elevation: 6,
          }]}>
            <QRCode
              value={address}
              size={170}
              backgroundColor="#FFFFFF"
              color="#000000"
              logoSize={30}
              logoMargin={4}
              logoBorderRadius={6}
            />
            {/* Network badge overlay */}
            <View style={{
              position: 'absolute', top: -1, right: -1,
              flexDirection: 'row', alignItems: 'center',
              backgroundColor: NETWORK_COLORS[networkType] || theme.colors.primary[500],
              paddingHorizontal: 8, paddingVertical: 4,
              borderBottomLeftRadius: 8, borderTopRightRadius: 12,
            }}>
              <NetworkIcon network={networkType} size={14} color="#fff" />
              <Text style={{ fontSize: 10, fontWeight: '600', color: '#fff', marginLeft: 4 }}>
                {NETWORK_LABELS[networkType] || networkType}
              </Text>
            </View>
          </View>
        </View>

        {/* Address card with left border accent */}
        <TouchableOpacity style={[styles.addressContainer, {
          borderLeftWidth: 3,
          borderLeftColor: NETWORK_COLORS[networkType] || theme.colors.primary[500],
        }]} onPress={copyToClipboard} activeOpacity={0.7}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
            <NetworkIcon network={networkType} size={16} color={NETWORK_COLORS[networkType] || theme.colors.primary[500]} />
            <Text style={[styles.addressLabel, { marginLeft: 6, marginBottom: 0 }]}>
              {networkType === 'lightning' ? 'Lightning Invoice'
                : networkType === 'spark' ? 'Spark Address'
                : networkType === 'arkade' ? (arkadeSubMode === 'boarding' ? 'Boarding Address' : 'Arkade Address')
                : 'Deposit Address'}
            </Text>
          </View>
          <Text style={[styles.addressText, { fontFamily: 'monospace' }]} numberOfLines={3} selectable>
            {address.length > 50 ? `${address.slice(0, 20)}...${address.slice(-16)}` : address}
          </Text>
        </TouchableOpacity>

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
    <SafeAreaView style={styles.container} edges={['left', 'right', 'bottom']}>
      {renderHeader()}
      {renderNetworkTabs()}
      
      <ScrollView 
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
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