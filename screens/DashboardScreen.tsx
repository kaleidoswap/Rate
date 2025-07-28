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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useDispatch, useSelector } from 'react-redux';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { RootState } from '../store';
import RGBApiService from '../services/RGBApiService';
import DatabaseService from '../services/DatabaseService';
import { setBtcBalance } from '../store/slices/walletSlice';
import { setRgbAssets } from '../store/slices/assetsSlice';
import { setTransactions } from '../store/slices/transactionsSlice';

const { width } = Dimensions.get('window');

interface Props {
  navigation: any;
}

interface BitcoinPrice {
  bitcoin: {
    usd: number;
  };
}

export default function DashboardScreen({ navigation }: Props) {
  const dispatch = useDispatch();
  const { activeWallet, btcBalance, rgbAssets, isUnlocked } = useSelector(
    (state: RootState) => state.wallet
  );
  const { nodeInfo, networkInfo } = useSelector((state: RootState) => state.node);

  const [refreshing, setRefreshing] = useState(false);
  const [bitcoinPrice, setBitcoinPrice] = useState<number>(0);
  const [loading, setLoading] = useState(true);

  const apiService = RGBApiService.getInstance();
  const dbService = DatabaseService.getInstance();

  useFocusEffect(
    useCallback(() => {
      if (isUnlocked && activeWallet) {
        loadDashboardData();
      }
    }, [isUnlocked, activeWallet])
  );

  useEffect(() => {
    fetchBitcoinPrice();
    const priceInterval = setInterval(fetchBitcoinPrice, 30000); // Update every 30 seconds
    return () => clearInterval(priceInterval);
  }, []);

  const fetchBitcoinPrice = async () => {
    try {
      const response = await fetch(
        'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd'
      );
      const data: BitcoinPrice = await response.json();
      setBitcoinPrice(data.bitcoin.usd);
    } catch (error) {
      console.warn('Failed to fetch Bitcoin price:', error);
    }
  };

  const loadDashboardData = async () => {
    if (!activeWallet) return;

    try {
      setLoading(true);

      // Load BTC balance
      const balance = await apiService.getBtcBalance();
      dispatch(setBtcBalance(balance));

      // Load RGB assets
      const assetsResponse = await apiService.listAssets();
      const assetsFromDb = await dbService.getAssetsByWallet(activeWallet.id!);

      // Update database with latest asset info
      for (const asset of assetsResponse.nia) {
        await dbService.upsertAsset({
          wallet_id: activeWallet.id!,
          asset_id: asset.asset_id,
          ticker: asset.ticker,
          name: asset.name,
          precision: asset.precision,
          issued_supply: asset.issued_supply,
          balance: asset.balance.settled,
          last_updated: Date.now(),
        });
      }

      // Get updated assets from database
      const updatedAssets = await dbService.getAssetsByWallet(activeWallet.id!);
      dispatch(setRgbAssets(updatedAssets));

      // Load recent transactions
      const transactions = await dbService.getTransactionsByWallet(activeWallet.id!, 20);
      dispatch(setTransactions(transactions));

      // Sync wallet
      await apiService.syncWallet();
    } catch (error) {
      console.error('Failed to load dashboard data:', error);
      Alert.alert('Error', 'Failed to load wallet data');
    } finally {
      setLoading(false);
    }
  };

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

  const renderBalanceCard = () => (
    <View style={styles.balanceCard}>
      <Text style={styles.balanceLabel}>Total Balance</Text>
      <Text style={styles.balanceAmount}>
        {formatSatoshis(getTotalBtcBalance())} BTC
      </Text>
      <Text style={styles.balanceUsd}>
        ${formatUSD(getTotalBtcBalance())} USD
      </Text>
      
      <View style={styles.balanceDetails}>
        <View style={styles.balanceRow}>
          <Text style={styles.balanceDetailLabel}>Vanilla Wallet:</Text>
          <Text style={styles.balanceDetailValue}>
            {btcBalance ? formatSatoshis(btcBalance.vanilla.spendable) : '0.00000000'} BTC
          </Text>
        </View>
        <View style={styles.balanceRow}>
          <Text style={styles.balanceDetailLabel}>Colored Wallet:</Text>
          <Text style={styles.balanceDetailValue}>
            {btcBalance ? formatSatoshis(btcBalance.colored.spendable) : '0.00000000'} BTC
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
                {asset.balance.toFixed(asset.precision)}
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
        <Text style={styles.networkValue}>{nodeInfo?.num_channels || 0}</Text>
      </View>
    </View>
  );

  if (!isUnlocked || !activeWallet) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centerContent}>
          <Text style={styles.errorText}>Wallet not unlocked</Text>
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
});