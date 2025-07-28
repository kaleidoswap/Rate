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
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect } from '@react-navigation/native';
import { RootState } from '../store';
import { initializeRGBApiService } from '../services/initializeServices';
import { setBtcBalance } from '../store/slices/walletSlice';
import { setRgbAssets } from '../store/slices/assetsSlice';
import RGBApiService from '../services/RGBApiService';
import PriceService from '../services/PriceService';
import { theme } from '../theme';
import { Card, Button } from '../components';

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

      // Load Lightning channels
      console.log('Fetching Lightning channels...');
      const channelsResponse = await apiService.listChannels();
      const channelsList = channelsResponse.channels || [];
      console.log('Channels received:', channelsList);
      setChannels(channelsList);

    } catch (error) {
      console.error('Failed to load dashboard data:', error);
      Alert.alert(
        'Error',
        error instanceof Error ? error.message : 'Failed to load dashboard data'
      );
    } finally {
      setLoading(false);
    }
  };

  const fetchBitcoinPrice = async () => {
    try {
      const priceService = PriceService.getInstance();
      const price = await priceService.getBitcoinPrice();
      setBitcoinPrice(price);
    } catch (error) {
      console.error('Failed to fetch Bitcoin price:', error);
      if (!bitcoinPrice) {
        setBitcoinPrice(0);
      }
    }
  };

  useEffect(() => {
    fetchBitcoinPrice();
    const priceInterval = setInterval(fetchBitcoinPrice, 30000);
    return () => clearInterval(priceInterval);
  }, []);

  useFocusEffect(
    useCallback(() => {
      const initializeAndLoad = async () => {
        await checkNodeStatus();
        if (isNodeUnlocked) {
          await loadDashboardData();
        }
      };
      initializeAndLoad();
    }, [settings.nodeUrl])
  );

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

  const offChainBalance = channels.reduce(
    (sum, channel) => sum + channel.local_balance_sat,
    0
  );

  const totalBalance = offChainBalance + getTotalBtcBalance();

  const renderHeader = () => (
    <LinearGradient
      colors={['#667eea', '#764ba2']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.headerGradient}
    >
      <View style={styles.header}>
        <View style={styles.headerContent}>
          <View style={styles.headerText}>
            <Text style={styles.greeting}>Good morning</Text>
            <Text style={styles.headerTitle}>Rate Wallet</Text>
          </View>
          <TouchableOpacity 
            style={styles.settingsButton}
            onPress={() => navigation.navigate('Settings')}
          >
            <Ionicons name="settings-outline" size={20} color={theme.colors.text.inverse} />
          </TouchableOpacity>
        </View>
      </View>
    </LinearGradient>
  );

  const renderBalanceCard = () => (
    <Card variant="elevated" style={styles.balanceCard}>
      <View style={styles.balanceHeader}>
        <Text style={styles.balanceLabel}>Total Balance</Text>
        <TouchableOpacity style={styles.refreshButton} onPress={onRefresh}>
          <Ionicons name="refresh" size={18} color={theme.colors.gray[500]} />
        </TouchableOpacity>
      </View>
      
      <View style={styles.balanceAmountContainer}>
        <Text style={styles.balanceAmount}>
          {formatSatoshis(totalBalance)}
        </Text>
        <Text style={styles.balanceCurrency}>BTC</Text>
      </View>
      
      <Text style={styles.balanceUsd}>
        ${formatUSD(totalBalance)} USD
      </Text>
      
      <View style={styles.balanceBreakdown}>
        <View style={styles.balanceItem}>
          <View style={styles.balanceIconContainer}>
            <Ionicons name="wallet" size={14} color={theme.colors.primary[500]} />
          </View>
          <View style={styles.balanceItemText}>
            <Text style={styles.balanceItemLabel}>On-chain</Text>
            <Text style={styles.balanceItemValue}>
              {formatSatoshis(getTotalBtcBalance())} BTC
            </Text>
          </View>
        </View>
        
        <View style={styles.balanceItem}>
          <View style={styles.balanceIconContainer}>
            <Ionicons name="flash" size={14} color={theme.colors.warning[500]} />
          </View>
          <View style={styles.balanceItemText}>
            <Text style={styles.balanceItemLabel}>Lightning</Text>
            <Text style={styles.balanceItemValue}>
              {formatSatoshis(offChainBalance)} BTC
            </Text>
          </View>
        </View>
      </View>
    </Card>
  );

  const renderRGBAssets = () => (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>RGB Assets</Text>
        <TouchableOpacity>
          <Text style={styles.sectionAction}>View All</Text>
        </TouchableOpacity>
      </View>

      {rgbAssets.length === 0 ? (
        <Card style={styles.emptyCard}>
          <View style={styles.emptyState}>
            <View style={styles.emptyIcon}>
              <Ionicons name="diamond-outline" size={28} color={theme.colors.gray[400]} />
            </View>
            <Text style={styles.emptyTitle}>No RGB assets yet</Text>
            <Text style={styles.emptyDescription}>
              Issue your first RGB asset to get started
            </Text>
            <Button
              title="Issue Asset"
              variant="secondary"
              size="sm"
              onPress={() => navigation.navigate('IssueAsset')}
              style={styles.emptyButton}
            />
          </View>
        </Card>
      ) : (
        <ScrollView 
          horizontal 
          showsHorizontalScrollIndicator={false}
          style={styles.assetsScroll}
        >
          {rgbAssets.map((asset, index) => (
            <TouchableOpacity
              key={asset.asset_id}
              style={[styles.assetCard, index === 0 && styles.firstAssetCard]}
              onPress={() => navigation.navigate('AssetDetail', { asset })}
            >
              <View style={styles.assetHeader}>
                <Text style={styles.assetTicker}>{asset.ticker}</Text>
                <Ionicons name="chevron-forward" size={14} color={theme.colors.gray[400]} />
              </View>
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

  const renderQuickStats = () => (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Network Status</Text>
      <Card style={styles.statsCard}>
        <View style={styles.statsGrid}>
          <View style={styles.statItem}>
            <Text style={styles.statLabel}>Network</Text>
            <Text style={styles.statValue}>{networkInfo?.network || 'Unknown'}</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={styles.statLabel}>Block Height</Text>
            <Text style={styles.statValue}>{networkInfo?.height || 0}</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={styles.statLabel}>Channels</Text>
            <Text style={styles.statValue}>{channels.length}</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={styles.statLabel}>BTC Price</Text>
            <Text style={styles.statValue}>${bitcoinPrice.toLocaleString()}</Text>
          </View>
        </View>
      </Card>
    </View>
  );

  const renderFloatingAIButton = () => (
    <TouchableOpacity
      style={styles.floatingAIButton}
      onPress={() => navigation.navigate('AIAssistant')}
      activeOpacity={0.8}
    >
      <LinearGradient
        colors={['#667eea', '#764ba2']}
        style={styles.floatingAIGradient}
      >
        <Ionicons name="chatbubble-ellipses" size={20} color={theme.colors.text.inverse} />
      </LinearGradient>
    </TouchableOpacity>
  );

  const renderCompactActions = () => (
    <View style={styles.compactActionsContainer}>
      <View style={styles.compactActions}>
        <TouchableOpacity 
          style={styles.compactActionButton}
          onPress={() => navigation.navigate('Receive')}
        >
          <View style={[styles.compactActionIcon, styles.receiveIcon]}>
            <Ionicons name="arrow-down" size={18} color={theme.colors.success[500]} />
          </View>
          <Text style={styles.compactActionText}>Receive</Text>
        </TouchableOpacity>
        
        <TouchableOpacity 
          style={styles.scanActionButton}
          onPress={() => navigation.navigate('QRScanner')}
        >
          <LinearGradient
            colors={['#667eea', '#764ba2']}
            style={styles.scanActionGradient}
          >
            <Ionicons name="camera" size={22} color={theme.colors.text.inverse} />
          </LinearGradient>
        </TouchableOpacity>
        
        <TouchableOpacity 
          style={styles.compactActionButton}
          onPress={() => navigation.navigate('Send')}
        >
          <View style={[styles.compactActionIcon, styles.sendIcon]}>
            <Ionicons name="arrow-up" size={18} color={theme.colors.text.inverse} />
          </View>
          <Text style={styles.compactActionText}>Send</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  if (isConnecting) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centerContent}>
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={theme.colors.primary[500]} />
            <Text style={styles.loadingText}>Connecting to node...</Text>
            <Text style={styles.loadingDetails}>URL: {settings.nodeUrl || 'Not configured'}</Text>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  if (!isNodeUnlocked) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centerContent}>
          <Card style={styles.errorCard}>
            <View style={styles.errorState}>
              <View style={styles.errorIcon}>
                <Ionicons name="warning-outline" size={48} color={theme.colors.error[500]} />
              </View>
              <Text style={styles.errorTitle}>Failed to connect to node</Text>
              <Text style={styles.errorDescription}>
                {connectionError || 'Unable to establish connection'}
              </Text>
              <Text style={styles.nodeUrl}>URL: {settings.nodeUrl || 'Not configured'}</Text>
              
              <View style={styles.errorActions}>
                <Button
                  title="Retry Connection"
                  variant="primary"
                  onPress={checkNodeStatus}
                  style={styles.errorButton}
                />
                <Button
                  title="Check Settings"
                  variant="secondary"
                  onPress={() => navigation.navigate('Settings')}
                  style={styles.errorButton}
                />
              </View>
            </View>
          </Card>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {renderHeader()}
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl 
            refreshing={refreshing} 
            onRefresh={onRefresh}
            tintColor={theme.colors.primary[500]}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        {renderBalanceCard()}
        {renderRGBAssets()}
        {renderQuickStats()}
        
        {/* Bottom padding for compact actions */}
        <View style={styles.bottomPadding} />
      </ScrollView>
      
      {renderCompactActions()}
    </SafeAreaView>
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
  
  scrollContent: {
    paddingBottom: 80, // Space for compact actions
  },
  
  centerContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: theme.spacing[5],
  },
  
  // Smaller Header
  headerGradient: {
    paddingBottom: theme.spacing[4], // Reduced from spacing[8]
  },
  
  header: {
    paddingTop: theme.spacing[2], // Reduced from spacing[4]
    paddingHorizontal: theme.spacing[5],
    paddingBottom: theme.spacing[3], // Added bottom padding
  },
  
  headerContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center', // Changed to center for better alignment
  },
  
  headerText: {
    flex: 1,
  },
  
  greeting: {
    fontSize: theme.typography.fontSize.xs, // Smaller
    color: theme.colors.text.inverse,
    opacity: 0.8,
    marginBottom: theme.spacing[1],
  },
  
  headerTitle: {
    fontSize: theme.typography.fontSize['2xl'], // Smaller from 3xl
    fontWeight: '700',
    color: theme.colors.text.inverse,
  },
  
  settingsButton: {
    width: 36, // Smaller
    height: 36,
    borderRadius: theme.borderRadius.base,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  
  // Always visible balance card
  balanceCard: {
    marginHorizontal: theme.spacing[5],
    marginTop: theme.spacing[5], // Always visible, no overlap
    marginBottom: theme.spacing[6],
  },
  
  balanceHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing[4], // Reduced
  },
  
  balanceLabel: {
    fontSize: theme.typography.fontSize.sm, // Smaller
    color: theme.colors.text.secondary,
    fontWeight: '500',
  },
  
  refreshButton: {
    width: 28, // Smaller
    height: 28,
    borderRadius: theme.borderRadius.base,
    backgroundColor: theme.colors.gray[100],
    alignItems: 'center',
    justifyContent: 'center',
  },
  
  balanceAmountContainer: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'center',
    marginBottom: theme.spacing[2],
  },
  
  balanceAmount: {
    fontSize: theme.typography.fontSize['3xl'], // Smaller from 4xl
    fontWeight: '700',
    color: theme.colors.text.primary,
  },
  
  balanceCurrency: {
    fontSize: theme.typography.fontSize.base, // Smaller
    fontWeight: '600',
    color: theme.colors.text.secondary,
    marginLeft: theme.spacing[2],
  },
  
  balanceUsd: {
    fontSize: theme.typography.fontSize.base, // Smaller
    color: theme.colors.text.secondary,
    textAlign: 'center',
    marginBottom: theme.spacing[4], // Reduced
  },
  
  balanceBreakdown: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: theme.spacing[4], // Reduced
    borderTopWidth: 1,
    borderTopColor: theme.colors.border.light,
  },
  
  balanceItem: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  
  balanceIconContainer: {
    width: 28, // Smaller
    height: 28,
    borderRadius: theme.borderRadius.base,
    backgroundColor: theme.colors.gray[100],
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: theme.spacing[2], // Reduced
  },
  
  balanceItemText: {
    flex: 1,
  },
  
  balanceItemLabel: {
    fontSize: theme.typography.fontSize.xs, // Smaller
    color: theme.colors.text.secondary,
    marginBottom: theme.spacing[1],
  },
  
  balanceItemValue: {
    fontSize: theme.typography.fontSize.xs, // Smaller
    fontWeight: '600',
    color: theme.colors.text.primary,
  },
  
  section: {
    paddingHorizontal: theme.spacing[5],
    marginBottom: theme.spacing[6], // Reduced
  },
  
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing[3], // Reduced
  },
  
  sectionTitle: {
    fontSize: theme.typography.fontSize.lg, // Smaller
    fontWeight: '700',
    color: theme.colors.text.primary,
  },
  
  sectionAction: {
    fontSize: theme.typography.fontSize.xs, // Smaller
    fontWeight: '500',
    color: theme.colors.primary[500],
  },
  
  emptyCard: {
    paddingVertical: theme.spacing[6], // Reduced
  },
  
  emptyState: {
    alignItems: 'center',
  },
  
  emptyIcon: {
    width: 56, // Smaller
    height: 56,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.gray[100],
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: theme.spacing[3],
  },
  
  emptyTitle: {
    fontSize: theme.typography.fontSize.base, // Smaller
    fontWeight: '600',
    color: theme.colors.text.primary,
    marginBottom: theme.spacing[2],
  },
  
  emptyDescription: {
    fontSize: theme.typography.fontSize.xs, // Smaller
    color: theme.colors.text.secondary,
    textAlign: 'center',
    marginBottom: theme.spacing[4],
  },
  
  emptyButton: {
    paddingHorizontal: theme.spacing[4], // Reduced
  },
  
  assetsScroll: {
    marginLeft: -theme.spacing[5],
  },
  
  assetCard: {
    width: 120, // Smaller
    backgroundColor: theme.colors.surface.primary,
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing[3], // Reduced
    marginLeft: theme.spacing[5],
    borderWidth: 1,
    borderColor: theme.colors.border.light,
  },
  
  firstAssetCard: {
    marginLeft: theme.spacing[5],
  },
  
  assetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing[2],
  },
  
  assetTicker: {
    fontSize: theme.typography.fontSize.sm, // Smaller
    fontWeight: '700',
    color: theme.colors.primary[500],
  },
  
  assetName: {
    fontSize: 10, // Smaller
    color: theme.colors.text.secondary,
    marginBottom: theme.spacing[2],
  },
  
  assetBalance: {
    fontSize: theme.typography.fontSize.base, // Smaller
    fontWeight: '600',
    color: theme.colors.text.primary,
  },
  
  statsCard: {
    padding: theme.spacing[4], // Reduced
  },
  
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  
  statItem: {
    width: '50%',
    marginBottom: theme.spacing[3], // Reduced
  },
  
  statLabel: {
    fontSize: theme.typography.fontSize.xs, // Smaller
    color: theme.colors.text.secondary,
    marginBottom: theme.spacing[1],
  },
  
  statValue: {
    fontSize: theme.typography.fontSize.sm, // Smaller
    fontWeight: '600',
    color: theme.colors.text.primary,
  },
  
  // Smaller Floating AI Button
  floatingAIButton: {
    position: 'absolute',
    right: theme.spacing[4],
    bottom: 100, // Above compact actions
    width: 48, // Smaller
    height: 48,
    borderRadius: 24,
    elevation: 6, // Reduced
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
  },
  
  floatingAIGradient: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  
  // Compact Actions
  compactActionsContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(255, 255, 255, 0.98)',
    borderTopWidth: 1,
    borderTopColor: theme.colors.border.light,
    paddingBottom: theme.spacing[6], // Safe area
  },
  
  compactActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[5],
  },
  
  compactActionButton: {
    alignItems: 'center',
    flex: 1,
  },
  
  compactActionIcon: {
    width: 36, // Smaller
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: theme.spacing[1],
  },
  
  sendIcon: {
    backgroundColor: theme.colors.primary[500],
  },
  
  receiveIcon: {
    backgroundColor: theme.colors.success[50],
    borderWidth: 1.5,
    borderColor: theme.colors.success[500],
  },
  
  compactActionText: {
    fontSize: 11, // Smaller
    fontWeight: '500',
    color: theme.colors.text.primary,
  },
  
  scanActionButton: {
    marginHorizontal: theme.spacing[4],
  },
  
  scanActionGradient: {
    width: 48, // Smaller
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 3,
  },
  
  bottomPadding: {
    height: theme.spacing[2],
  },
  
  loadingContainer: {
    alignItems: 'center',
  },
  
  loadingText: {
    fontSize: theme.typography.fontSize.lg,
    fontWeight: '600',
    color: theme.colors.text.primary,
    marginTop: theme.spacing[4],
    marginBottom: theme.spacing[2],
  },
  
  loadingDetails: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.text.secondary,
    textAlign: 'center',
  },
  
  errorCard: {
    width: '100%',
    paddingVertical: theme.spacing[8],
  },
  
  errorState: {
    alignItems: 'center',
  },
  
  errorIcon: {
    width: 80,
    height: 80,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.error[50],
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: theme.spacing[5],
  },
  
  errorTitle: {
    fontSize: theme.typography.fontSize.xl,
    fontWeight: '700',
    color: theme.colors.text.primary,
    marginBottom: theme.spacing[2],
    textAlign: 'center',
  },
  
  errorDescription: {
    fontSize: theme.typography.fontSize.base,
    color: theme.colors.text.secondary,
    textAlign: 'center',
    marginBottom: theme.spacing[3],
  },
  
  nodeUrl: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.text.muted,
    textAlign: 'center',
    marginBottom: theme.spacing[6],
  },
  
  errorActions: {
    width: '100%',
    gap: theme.spacing[3],
  },
  
  errorButton: {
    width: '100%',
  },
});