// screens/DashboardScreen.tsx
import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Alert,
  Dimensions,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useDispatch, useSelector } from 'react-redux';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { RootState } from '../store';
import { initializeRGBApiService } from '../services/initializeServices';
import { setBtcBalance } from '../store/slices/walletSlice';
import { setRgbAssets } from '../store/slices/assetsSlice';
import RGBApiService from '../services/RGBApiService';
import PriceService from '../services/PriceService';

const { width } = Dimensions.get('window');

interface Props {
  navigation: any;
}

interface BitcoinPrice {
  bitcoin: {
    usd: number;
  };
}

interface NiaAsset {
  asset_id: string;
  asset_iface: string;
  ticker: string;
  name: string;
  details: string | null;
  precision: number;
  issued_supply: number;
  timestamp: number;
  added_at: number;
  balance: {
    settled: number;
    future: number;
    spendable: number;
    offchain_outbound?: number;
    offchain_inbound?: number;
  };
  media: string | null;
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

export default function DashboardScreen({ navigation }: Props) {
  const dispatch = useDispatch();
  const { nodeInfo, networkInfo } = useSelector((state: RootState) => state.node);
  const settings = useSelector((state: RootState) => state.settings);
  const [isNodeUnlocked, setIsNodeUnlocked] = useState(false);
  const [isConnecting, setIsConnecting] = useState(true);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [apiService, setApiService] = useState<RGBApiService | null>(null);

  // Initialize API service
  const initializeApi = useCallback(() => {
    try {
      console.log('Initializing API service...');
      const service = initializeRGBApiService();
      setApiService(service);
      return service;
    } catch (error) {
      console.error('Failed to initialize API service:', error);
      setConnectionError(error instanceof Error ? error.message : 'Failed to initialize API service');
      return null;
    }
  }, [settings.nodeUrl]);

  const checkNodeStatus = async () => {
    try {
      setIsConnecting(true);
      setConnectionError(null);

      // Make sure we have a valid API service
      const service = apiService || initializeApi();
      if (!service) {
        throw new Error('Could not initialize API service');
      }

      console.log('Checking node status...');
      const info = await service.getNodeInfo();
      console.log('Node info received:', info);
      
      setIsNodeUnlocked(true);
      return true;
    } catch (error) {
      console.error('Failed to get node info:', error);
      setIsNodeUnlocked(false);
      setConnectionError(error instanceof Error ? error.message : 'Unknown error occurred');
      return false;
    } finally {
      setIsConnecting(false);
    }
  };

  const loadDashboardData = async () => {
    if (!apiService) {
      console.error('Cannot load dashboard data: API service not initialized');
      return;
    }

    try {
      setLoading(true);
      console.log('Loading dashboard data...');

      // Load BTC balance
      console.log('Fetching BTC balance...');
      const balance = await apiService.getBtcBalance();
      console.log('BTC balance received:', balance);
      setBtcBalanceState(balance);
      dispatch(setBtcBalance(balance));

      // Load RGB assets
      console.log('Fetching RGB assets...');
      const assetsResponse = await apiService.listAssets();
      const assets = assetsResponse.nia || [];
      console.log('RGB assets received:', assets);
      setRgbAssetsState(assets);
      
      // Convert NiaAsset to AssetRecord before dispatching
      const assetRecords = assets.map(asset => ({
        wallet_id: 1, // Default wallet ID since we're not using multiple wallets
        asset_id: asset.asset_id,
        ticker: asset.ticker,
        name: asset.name,
        precision: asset.precision,
        issued_supply: asset.issued_supply,
        balance: asset.balance.spendable,
        last_updated: Date.now()
      }));
      dispatch(setRgbAssets(assetRecords));

      // Load channels
      console.log('Fetching channels...');
      const channelsResponse = await apiService.listChannels();
      console.log('Channels received:', channelsResponse);
      setChannels(channelsResponse.channels || []);

      // Sync wallet
      console.log('Syncing wallet...');
      await apiService.sync();
      console.log('Wallet sync complete');
    } catch (error) {
      console.error('Failed to load dashboard data:', error);
      Alert.alert('Error', 'Failed to load wallet data');
    } finally {
      setLoading(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      console.log('Dashboard screen focused, initializing...');
      const initializeScreen = async () => {
        const service = initializeApi();
        if (!service) {
          console.error('Failed to initialize API service on screen focus');
          return;
        }

        const isUnlocked = await checkNodeStatus();
        if (isUnlocked) {
          loadDashboardData();
        }
      };
      initializeScreen();
    }, [settings.nodeUrl])
  );

  const fetchBitcoinPrice = async () => {
    try {
      const priceService = PriceService.getInstance();
      const price = await priceService.getBitcoinPrice();
      setBitcoinPrice(price);
    } catch (error) {
      console.error('Failed to fetch Bitcoin price:', error);
      // Keep the last known price if available
      if (!bitcoinPrice) {
        setBitcoinPrice(0);
      }
    }
  };

  useEffect(() => {
    fetchBitcoinPrice();
    const priceInterval = setInterval(fetchBitcoinPrice, 30000); // Update every 30 seconds
    return () => clearInterval(priceInterval);
  }, []);

  const [refreshing, setRefreshing] = useState(false);
  const [bitcoinPrice, setBitcoinPrice] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [btcBalance, setBtcBalanceState] = useState<{
    vanilla: { settled: number; future: number; spendable: number };
    colored: { settled: number; future: number; spendable: number };
  }>({
    vanilla: { settled: 0, future: 0, spendable: 0 },
    colored: { settled: 0, future: 0, spendable: 0 },
  });
  const [rgbAssets, setRgbAssetsState] = useState<NiaAsset[]>([]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadDashboardData();
    setRefreshing(false);
  };

  const formatSatoshis = (satoshis: number): string => {
    return (satoshis / 100000000).toFixed(8);
  };

  const formatUSD = (satoshis: number): string => {
    const btc = satoshis / 100000000;
    const usd = btc * bitcoinPrice;
    return usd.toFixed(2);
  };

  const getTotalBtcBalance = (): number => {
    if (!btcBalance) return 0;
    return btcBalance.vanilla.spendable + btcBalance.colored.spendable;
  };

  // Calculate Lightning Network balances
  const offChainBalance = channels.reduce(
    (sum, channel) => sum + channel.local_balance_sat,
    0
  );

  const totalInboundLiquidity = channels.reduce(
    (sum, channel) => sum + channel.inbound_balance_msat / 1000,
    0
  );

  const totalOutboundLiquidity = channels.reduce(
    (sum, channel) => sum + channel.outbound_balance_msat / 1000,
    0
  );

  const totalBalance = offChainBalance + getTotalBtcBalance();

  const renderBalanceCard = () => (
    <View style={styles.balanceCard}>
      <Text style={styles.balanceLabel}>Total Balance</Text>
      <Text style={styles.balanceAmount}>
        {formatSatoshis(totalBalance)} BTC
      </Text>
      <Text style={styles.balanceUsd}>
        ${formatUSD(totalBalance)} USD
      </Text>
      
      <View style={styles.balanceDetails}>
        <View style={styles.balanceRow}>
          <Text style={styles.balanceDetailLabel}>On-chain Balance:</Text>
          <Text style={styles.balanceDetailValue}>
            {btcBalance ? formatSatoshis(getTotalBtcBalance()) : '0.00000000'} BTC
          </Text>
        </View>
        <View style={styles.balanceRow}>
          <Text style={styles.balanceDetailLabel}>Lightning Balance:</Text>
          <Text style={styles.balanceDetailValue}>
            {formatSatoshis(offChainBalance)} BTC
          </Text>
        </View>
      </View>

      <View style={styles.balanceDetails}>
        <View style={styles.balanceRow}>
          <Text style={styles.balanceDetailLabel}>Inbound Capacity:</Text>
          <Text style={styles.balanceDetailValue}>
            {formatSatoshis(totalInboundLiquidity)} BTC
          </Text>
        </View>
        <View style={styles.balanceRow}>
          <Text style={styles.balanceDetailLabel}>Outbound Capacity:</Text>
          <Text style={styles.balanceDetailValue}>
            {formatSatoshis(totalOutboundLiquidity)} BTC
          </Text>
        </View>
      </View>
    </View>
  );

  const renderActionButtons = () => (
    <View style={styles.actionButtons}>
      <TouchableOpacity
        style={styles.actionButton}
        onPress={() => navigation.navigate('Receive')}
      >
        <Ionicons name="arrow-down" size={24} color="white" />
        <Text style={styles.actionButtonText}>Deposit</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.actionButton}
        onPress={() => navigation.navigate('Send')}
      >
        <Ionicons name="arrow-up" size={24} color="white" />
        <Text style={styles.actionButtonText}>Pay</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.actionButton}
        onPress={() => navigation.navigate('QRScanner')}
      >
        <Ionicons name="qr-code" size={24} color="white" />
        <Text style={styles.actionButtonText}>Scan</Text>
      </TouchableOpacity>
    </View>
  );

  const renderRGBAssets = () => (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>RGB Assets</Text>
        <TouchableOpacity onPress={() => navigation.navigate('Assets')}>
          <Text style={styles.seeAllText}>See All</Text>
        </TouchableOpacity>
      </View>

      {rgbAssets.length === 0 ? (
        <View style={styles.emptyState}>
          <Ionicons name="diamond-outline" size={48} color="#ccc" />
          <Text style={styles.emptyStateText}>No RGB assets yet</Text>
          <TouchableOpacity
            style={styles.issueAssetButton}
            onPress={() => navigation.navigate('IssueAsset')}
          >
            <Text style={styles.issueAssetButtonText}>Issue New Asset</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {rgbAssets.map((asset) => (
            <TouchableOpacity
              key={asset.asset_id}
              style={styles.assetCard}
              onPress={() => navigation.navigate('AssetDetail', { asset })}
            >
              <Text style={styles.assetTicker}>{asset.ticker}</Text>
              <Text style={styles.assetName}>{asset.name}</Text>
              <Text style={styles.assetBalance}>
                {asset.balance.spendable.toFixed(asset.precision)}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
    </View>
  );

  const renderNetworkInfo = () => (
    <View style={styles.networkInfo}>
      <View style={styles.networkRow}>
        <Text style={styles.networkLabel}>Network:</Text>
        <Text style={styles.networkValue}>{networkInfo?.network || 'Unknown'}</Text>
      </View>
      <View style={styles.networkRow}>
        <Text style={styles.networkLabel}>Block Height:</Text>
        <Text style={styles.networkValue}>{networkInfo?.height || 0}</Text>
      </View>
      <View style={styles.networkRow}>
        <Text style={styles.networkLabel}>Channels:</Text>
        <Text style={styles.networkValue}>{channels.length || 0}</Text>
      </View>
    </View>
  );

  if (isConnecting) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centerContent}>
          <ActivityIndicator size="large" color="#007AFF" />
          <Text style={styles.loadingText}>Connecting to node...</Text>
          <Text style={styles.loadingDetails}>URL: {settings.nodeUrl || 'Not configured'}</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!isNodeUnlocked) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centerContent}>
          <Ionicons name="warning-outline" size={48} color="#FF3B30" />
          <Text style={styles.errorText}>Failed to connect to node</Text>
          <Text style={styles.nodeUrlText}>URL: {settings.nodeUrl || 'Not configured'}</Text>
          {connectionError && (
            <Text style={styles.errorDetails}>{connectionError}</Text>
          )}
          <TouchableOpacity
            style={styles.retryButton}
            onPress={checkNodeStatus}
          >
            <Text style={styles.retryButtonText}>Retry Connection</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.settingsButton}
            onPress={() => navigation.navigate('Settings')}
          >
            <Text style={styles.settingsButtonText}>Check Settings</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Rate Wallet</Text>
          <TouchableOpacity onPress={() => navigation.navigate('Settings')}>
            <Ionicons name="settings-outline" size={24} color="#333" />
          </TouchableOpacity>
        </View>

        {renderBalanceCard()}
        {renderActionButtons()}
        {renderRGBAssets()}
        {renderNetworkInfo()}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  scrollView: {
    flex: 1,
  },
  centerContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    paddingBottom: 10,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
  },
  balanceCard: {
    backgroundColor: 'white',
    margin: 20,
    marginTop: 10,
    borderRadius: 15,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  balanceLabel: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
  },
  balanceAmount: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#333',
    textAlign: 'center',
    marginVertical: 5,
  },
  balanceUsd: {
    fontSize: 18,
    color: '#666',
    textAlign: 'center',
    marginBottom: 20,
  },
  balanceDetails: {
    borderTopWidth: 1,
    borderTopColor: '#eee',
    paddingTop: 15,
  },
  balanceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  balanceDetailLabel: {
    fontSize: 14,
    color: '#666',
  },
  balanceDetailValue: {
    fontSize: 14,
    color: '#333',
    fontWeight: '500',
  },
  actionButtons: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingHorizontal: 20,
    marginBottom: 20,
  },
  actionButton: {
    backgroundColor: '#007AFF',
    borderRadius: 15,
    paddingVertical: 15,
    paddingHorizontal: 20,
    alignItems: 'center',
    minWidth: (width - 80) / 3,
  },
  actionButtonText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
    marginTop: 5,
  },
  section: {
    marginHorizontal: 20,
    marginBottom: 20,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 15,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
  },
  seeAllText: {
    fontSize: 16,
    color: '#007AFF',
  },
  emptyState: {
    backgroundColor: 'white',
    borderRadius: 15,
    padding: 40,
    alignItems: 'center',
  },
  emptyStateText: {
    fontSize: 16,
    color: '#666',
    marginTop: 10,
    marginBottom: 20,
  },
  issueAssetButton: {
    backgroundColor: '#007AFF',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 20,
  },
  issueAssetButtonText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
  },
  assetCard: {
    backgroundColor: 'white',
    borderRadius: 15,
    padding: 15,
    marginRight: 15,
    minWidth: 120,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  assetTicker: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#007AFF',
    marginBottom: 5,
  },
  assetName: {
    fontSize: 12,
    color: '#666',
    marginBottom: 10,
  },
  assetBalance: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
  },
  networkInfo: {
    backgroundColor: 'white',
    margin: 20,
    borderRadius: 15,
    padding: 20,
  },
  networkRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  networkLabel: {
    fontSize: 14,
    color: '#666',
  },
  networkValue: {
    fontSize: 14,
    color: '#333',
    fontWeight: '500',
  },
  errorText: {
    fontSize: 16,
    color: '#666',
  },
  retryButton: {
    backgroundColor: '#007AFF',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 20,
    marginTop: 20,
  },
  retryButtonText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
  },
  loadingText: {
    fontSize: 16,
    color: '#666',
    marginTop: 16,
  },
  errorDetails: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginHorizontal: 32,
    marginTop: 8,
    marginBottom: 24,
  },
  settingsButton: {
    backgroundColor: '#8E8E93',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 20,
    marginTop: 12,
  },
  settingsButtonText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
  },
  loadingDetails: {
    fontSize: 14,
    color: '#666',
    marginTop: 8,
  },
  nodeUrlText: {
    fontSize: 14,
    color: '#666',
    marginTop: 8,
    marginBottom: 8,
  },
});