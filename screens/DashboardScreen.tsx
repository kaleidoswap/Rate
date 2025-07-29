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
  StatusBar,
  Platform,
  Image,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useDispatch, useSelector } from 'react-redux';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { DrawerActions } from '@react-navigation/native';
import { RootState } from '../store';
import { initializeRGBApiService } from '../services/initializeServices';
import { setBtcBalance } from '../store/slices/walletSlice';
import { setRgbAssets } from '../store/slices/assetsSlice';
import RGBApiService from '../services/RGBApiService';

import { theme } from '../theme';
import { Card, Button } from '../components';
import { useAssetIcon } from '../utils';
import { formatBitcoinAmount, useBitcoinConversion } from '../utils/bitcoinUnits';

const { width } = Dimensions.get('window');
const statusBarHeight = StatusBar.currentHeight || 0;

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
  const bitcoinUnit = useSelector((state: RootState) => state.settings.bitcoinUnit);
  const [isNodeUnlocked, setIsNodeUnlocked] = useState(false);
  const [isConnecting, setIsConnecting] = useState(true);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [apiService, setApiService] = useState<RGBApiService | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const { bitcoinPrice, formatSatoshisToUSD } = useBitcoinConversion();
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
  const [isUpdating, setIsUpdating] = useState(false);
  const [lastUpdateTime, setLastUpdateTime] = useState<Date | null>(null);
  
  // Modal state for channel details
  const [channelModalVisible, setChannelModalVisible] = useState(false);
  const [selectedChannel, setSelectedChannel] = useState<Channel | null>(null);

  // Asset Icon Component
  const AssetIcon = ({ ticker }: { ticker: string }) => {
    const { iconUrl } = useAssetIcon(ticker);
    
    if (iconUrl) {
      return (
        <View style={styles.assetIconContainer}>
          <Image source={{ uri: iconUrl }} style={styles.assetIconImage} resizeMode="contain" />
        </View>
      );
    }
    
    return (
      <View style={styles.assetIconContainer}>
        <Ionicons name="diamond" size={20} color={theme.colors.primary[500]} />
      </View>
    );
  };

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

  const loadDashboardData = async (showLoadingIndicator = true) => {
    if (!apiService || isUpdating) {
      console.log('Skipping update: Service not ready or update in progress');
      return;
    }

    try {
      setIsUpdating(true);
      if (showLoadingIndicator) {
        setLoading(true);
      }
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
        wallet_id: 1,
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

      setLastUpdateTime(new Date());
    } catch (error) {
      console.error('Failed to load dashboard data:', error);
      if (showLoadingIndicator) {
        Alert.alert(
          'Error',
          error instanceof Error ? error.message : 'Failed to load dashboard data'
        );
      }
    } finally {
      setIsUpdating(false);
      if (showLoadingIndicator) {
        setLoading(false);
      }
    }
  };



  // Add this useEffect for auto-refresh of wallet data
  useEffect(() => {
    let intervalId: NodeJS.Timeout;

    const refreshData = async () => {
      if (isNodeUnlocked && !isConnecting && !isUpdating) {
        await loadDashboardData(false); // Don't show loading indicator for background updates
      }
    };

    // Initial load
    if (isNodeUnlocked && !isConnecting) {
      refreshData();
    }

    // Set up polling every 30 seconds
    intervalId = setInterval(refreshData, 30000);

    return () => {
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, [isNodeUnlocked, isConnecting]);



  // Update the useFocusEffect to handle screen focus
  useFocusEffect(
    useCallback(() => {
      const initializeAndLoad = async () => {
        const isUnlocked = await checkNodeStatus();
        if (isUnlocked) {
          await loadDashboardData(true); // Show loading indicator for manual refresh
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

  // Move the hook usage to the component level
  const formatSatoshis = (satoshis: number): string => {
    return formatBitcoinAmount(satoshis, bitcoinUnit);
  };

  const formatUSD = (satoshis: number): string => {
    return formatSatoshisToUSD(satoshis);
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

  // Get current hour to determine greeting
  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  };

  const renderHeader = () => (
    <View style={styles.headerContainer}>
      <LinearGradient
        colors={['#4338ca', '#7c3aed'] as [string, string]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.headerGradient}
      >
        <SafeAreaView style={styles.headerSafeArea}>
          <View style={styles.headerContent}>
            <View style={styles.headerTop}>
              <View style={styles.headerLeft}>
                <Text style={styles.greeting}>{getGreeting()}</Text>
                <Text style={styles.headerTitle}>Rate Wallet</Text>
              </View>
              <View style={styles.headerActions}>
                <TouchableOpacity 
                  style={styles.headerActionButton}
                  onPress={() => navigation.navigate('Notifications')}
                >
                  <Ionicons name="notifications-outline" size={20} color={theme.colors.text.inverse} />
                  <View style={styles.notificationDot} />
                </TouchableOpacity>
                <TouchableOpacity 
                  style={styles.headerActionButton}
                  onPress={() => {
                    const drawerNavigation = navigation.getParent();
                    if (drawerNavigation) {
                      drawerNavigation.dispatch(DrawerActions.openDrawer());
                    }
                  }}
                >
                  <Ionicons name="ellipsis-horizontal" size={20} color={theme.colors.text.inverse} />
                </TouchableOpacity>
              </View>
            </View>

          {/* Enhanced Balance Display */}
          <View style={styles.balanceSection}>
            <View style={styles.totalBalanceContainer}>
              <Text style={styles.balanceLabel}>Total Portfolio</Text>
              <View style={styles.balanceRow}>
                <Text style={styles.balanceAmount}>
                  {formatSatoshis(totalBalance)}
                </Text>
                <Text style={styles.balanceCurrency}>{bitcoinUnit}</Text>
              </View>
              <Text style={styles.balanceUsd}>
                ${formatUSD(totalBalance)} USD
              </Text>
              
              {/* Price Change Indicator */}
              <View style={styles.priceChangeContainer}>
                <Ionicons name="trending-up" size={12} color="#10b981" />
                <Text style={styles.priceChange}>+2.4% today</Text>
              </View>
            </View>

            <TouchableOpacity 
              style={styles.refreshButton} 
              onPress={onRefresh}
              disabled={refreshing}
            >
              <Ionicons 
                name="refresh" 
                size={16} 
                color={theme.colors.text.inverse} 
                style={refreshing ? { transform: [{ rotate: '180deg' }] } : {}}
              />
            </TouchableOpacity>
          </View>

          {/* Balance Breakdown */}
          <View style={styles.balanceBreakdown}>
            <View style={styles.breakdownItem}>
              <View style={styles.breakdownIcon}>
                <Ionicons name="wallet" size={14} color="#10b981" />
              </View>
              <View style={styles.breakdownText}>
                <Text style={styles.breakdownLabel}>On-chain</Text>
                <Text style={styles.breakdownValue}>
                  {formatSatoshis(getTotalBtcBalance())}
                </Text>
              </View>
            </View>
            
            <View style={styles.breakdownDivider} />
            
            <View style={styles.breakdownItem}>
              <View style={styles.breakdownIcon}>
                <Ionicons name="flash" size={14} color="#f59e0b" />
              </View>
              <View style={styles.breakdownText}>
                <Text style={styles.breakdownLabel}>Lightning</Text>
                <Text style={styles.breakdownValue}>
                  {formatSatoshis(offChainBalance)}
                </Text>
              </View>
            </View>
          </View>
        </View>
        </SafeAreaView>
      </LinearGradient>
    </View>
  );

  const renderActionButtons = () => (
    <View style={styles.actionButtonsContainer}>
      <View style={styles.actionButtons}>
        {/* Receive Button */}
        <TouchableOpacity 
          style={styles.actionButton}
          onPress={() => navigation.navigate('Receive')}
          activeOpacity={0.7}
        >
          <LinearGradient
            colors={['#10b981', '#059669'] as [string, string]}
            style={styles.actionButtonGradient}
          >
            <Ionicons name="arrow-down" size={18} color="white" />
          </LinearGradient>
          <Text style={styles.actionButtonText}>Receive</Text>
        </TouchableOpacity>

        {/* Swap Button */}
        <TouchableOpacity 
          style={styles.actionButton}
          onPress={() => navigation.navigate('Swap')}
          activeOpacity={0.7}
        >
          <LinearGradient
            colors={['#f59e0b', '#d97706'] as [string, string]}
            style={styles.actionButtonGradient}
          >
            <Ionicons name="swap-horizontal" size={18} color="white" />
          </LinearGradient>
          <Text style={styles.actionButtonText}>Swap</Text>
        </TouchableOpacity>

        {/* Send Button */}
        <TouchableOpacity 
          style={styles.actionButton}
          onPress={() => navigation.navigate('Send')}
          activeOpacity={0.7}
        >
          <LinearGradient
            colors={['#ef4444', '#dc2626'] as [string, string]}
            style={styles.actionButtonGradient}
          >
            <Ionicons name="arrow-up" size={18} color="white" />
          </LinearGradient>
          <Text style={styles.actionButtonText}>Send</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  const renderRGBAssets = () => (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>RGB Assets</Text>
        <TouchableOpacity onPress={() => navigation.navigate('Assets')}>
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
        <View style={styles.assetsVerticalContainer}>
          {rgbAssets.slice(0, 3).map((asset, index) => (
            <TouchableOpacity
              key={asset.asset_id}
              style={styles.assetVerticalCard}
              onPress={() => navigation.navigate('AssetDetail', { 
                asset: {
                  ...asset,
                  isRGB: true
                }
              })}
            >
              <View style={styles.assetVerticalContent}>
                <View style={styles.assetVerticalLeft}>
                  <AssetIcon ticker={asset.ticker} />
                  <View style={styles.assetVerticalInfo}>
                    <Text style={styles.assetVerticalTicker}>{asset.ticker}</Text>
                    <Text style={styles.assetVerticalName}>{asset.name}</Text>
                  </View>
                </View>
                <View style={styles.assetVerticalRight}>
                  <Text style={styles.assetVerticalBalance}>
                    {asset.balance.spendable.toFixed(asset.precision)}
                  </Text>
                  <Ionicons name="chevron-forward" size={16} color={theme.colors.gray[400]} />
                </View>
              </View>
            </TouchableOpacity>
          ))}
          {rgbAssets.length > 3 && (
            <TouchableOpacity 
              style={styles.viewMoreButton}
              onPress={() => navigation.navigate('Assets')}
            >
              <Text style={styles.viewMoreText}>View {rgbAssets.length - 3} more assets</Text>
              <Ionicons name="chevron-forward" size={16} color={theme.colors.primary[500]} />
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );

  const renderChannels = () => (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Lightning Channels</Text>
        <TouchableOpacity onPress={() => navigation.navigate('Channels')}>
          <Text style={styles.sectionAction}>View All</Text>
        </TouchableOpacity>
      </View>

      {channels.length === 0 ? (
        <Card style={styles.emptyCard}>
          <View style={styles.emptyState}>
            <View style={styles.emptyIcon}>
              <Ionicons name="flash-outline" size={28} color={theme.colors.gray[400]} />
            </View>
            <Text style={styles.emptyTitle}>No channels yet</Text>
            <Text style={styles.emptyDescription}>
              Open your first Lightning channel to start transacting
            </Text>
            <View style={styles.emptyActions}>
              <Button
                title="Open Channel"
                variant="secondary"
                size="sm"
                onPress={() => navigation.navigate('OpenChannel')}
                style={styles.emptyButton}
              />
              <Button
                title="Buy Channel"
                variant="primary"
                size="sm"
                onPress={() => navigation.navigate('LSP')}
                style={styles.emptyButton}
              />
            </View>
          </View>
        </Card>
      ) : (
        <View style={styles.channelsVerticalContainer}>
          {channels.slice(0, 3).map((channel, index) => (
            <TouchableOpacity
              key={channel.channel_id}
              style={styles.channelVerticalCard}
              onPress={() => {
                setSelectedChannel(channel);
                setChannelModalVisible(true);
              }}
            >
              <View style={styles.channelVerticalContent}>
                <View style={styles.channelVerticalLeft}>
                  <View style={styles.channelVerticalStatus}>
                    <View style={[
                      styles.channelVerticalStatusDot,
                      { backgroundColor: channel.is_usable ? theme.colors.success[500] : theme.colors.error[500] }
                    ]} />
                    <View style={styles.channelVerticalInfo}>
                      <Text style={styles.channelVerticalPeerName} numberOfLines={1}>
                        {channel.peer_alias || channel.peer_pubkey.slice(0, 8)}
                      </Text>
                      <View style={styles.channelVerticalStatusRow}>
                        <Text style={[
                          styles.channelVerticalStatusText,
                          { color: channel.ready ? theme.colors.success[500] : theme.colors.warning[500] }
                        ]}>
                          {channel.ready ? 'Open' : 'Pending'}
                        </Text>
                        <Text style={styles.channelVerticalCapacity}>
                          {formatSatoshis(channel.capacity_sat)} {bitcoinUnit}
                        </Text>
                      </View>
                    </View>
                  </View>
                </View>
                <View style={styles.channelVerticalRight}>
                  <View style={styles.channelVerticalTopRow}>
                    <View style={styles.channelVerticalLiquidity}>
                      <View style={styles.liquidityVerticalRow}>
                        <View style={styles.liquidityVerticalItem}>
                          <Ionicons name="arrow-up" size={10} color={theme.colors.success[500]} />
                          <Text style={styles.liquidityVerticalAmount}>
                            {formatSatoshis(channel.outbound_balance_msat / 1000)}
                          </Text>
                        </View>
                        <View style={styles.liquidityVerticalItem}>
                          <Ionicons name="arrow-down" size={10} color={theme.colors.primary[500]} />
                          <Text style={styles.liquidityVerticalAmount}>
                            {formatSatoshis(channel.inbound_balance_msat / 1000)}
                          </Text>
                        </View>
                      </View>
                      <View style={styles.liquidityVerticalBar}>
                        <View style={[
                          styles.liquidityVerticalBarFill,
                          { 
                            width: `${(channel.outbound_balance_msat + channel.inbound_balance_msat) > 0 ? 
                              (channel.outbound_balance_msat / (channel.outbound_balance_msat + channel.inbound_balance_msat) * 100) : 0}%`,
                            backgroundColor: theme.colors.success[500]
                          }
                        ]} />
                      </View>
                    </View>
                    <Ionicons name="chevron-forward" size={14} color={theme.colors.gray[400]} />
                  </View>
                </View>
              </View>
            </TouchableOpacity>
          ))}
          {channels.length > 3 && (
            <TouchableOpacity 
              style={styles.viewMoreButton}
              onPress={() => navigation.navigate('Channels')}
            >
              <Text style={styles.viewMoreText}>View {channels.length - 3} more channels</Text>
              <Ionicons name="chevron-forward" size={16} color={theme.colors.primary[500]} />
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );

  const renderChannelModal = () => (
    <Modal
      visible={channelModalVisible}
      transparent={true}
      animationType="slide"
      onRequestClose={() => setChannelModalVisible(false)}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Channel Details</Text>
            <TouchableOpacity 
              style={styles.modalCloseButton}
              onPress={() => setChannelModalVisible(false)}
            >
              <Ionicons name="close" size={24} color={theme.colors.text.primary} />
            </TouchableOpacity>
          </View>
          
          {selectedChannel && (
            <ScrollView style={styles.modalBody} showsVerticalScrollIndicator={false}>
              {/* Channel Status */}
              <View style={styles.modalSection}>
                <Text style={styles.modalSectionTitle}>Status</Text>
                <View style={styles.modalStatusRow}>
                  <View style={[
                    styles.modalStatusDot,
                    { backgroundColor: selectedChannel.is_usable ? theme.colors.success[500] : theme.colors.error[500] }
                  ]} />
                  <Text style={styles.modalStatusText}>
                    {selectedChannel.ready ? 'Channel Open' : 'Channel Pending'}
                  </Text>
                  {selectedChannel.public ? (
                    <View style={styles.modalPublicBadge}>
                      <Ionicons name="globe-outline" size={12} color={theme.colors.primary[500]} />
                      <Text style={styles.modalPublicText}>Public</Text>
                    </View>
                  ) : (
                    <View style={styles.modalPrivateBadge}>
                      <Ionicons name="lock-closed-outline" size={12} color={theme.colors.gray[500]} />
                      <Text style={styles.modalPrivateText}>Private</Text>
                    </View>
                  )}
                </View>
              </View>

              {/* Peer Information */}
              <View style={styles.modalSection}>
                <Text style={styles.modalSectionTitle}>Peer Information</Text>
                <View style={styles.modalInfoRow}>
                  <Text style={styles.modalInfoLabel}>Alias</Text>
                  <Text style={styles.modalInfoValue}>
                    {selectedChannel.peer_alias || 'Unknown'}
                  </Text>
                </View>
                <View style={styles.modalInfoRow}>
                  <Text style={styles.modalInfoLabel}>Public Key</Text>
                  <Text style={styles.modalInfoValue} numberOfLines={1}>
                    {selectedChannel.peer_pubkey}
                  </Text>
                </View>
              </View>

              {/* Channel Capacity */}
              <View style={styles.modalSection}>
                <Text style={styles.modalSectionTitle}>Capacity</Text>
                <Text style={styles.modalCapacityValue}>
                  {formatSatoshis(selectedChannel.capacity_sat)} {bitcoinUnit}
                </Text>
              </View>

              {/* Bitcoin Liquidity */}
              <View style={styles.modalSection}>
                <Text style={styles.modalSectionTitle}>Bitcoin Liquidity</Text>
                <View style={styles.modalLiquidityContainer}>
                  <View style={styles.modalLiquidityRow}>
                    <View style={styles.modalLiquidityItem}>
                      <View style={styles.modalLiquidityIcon}>
                        <Ionicons name="arrow-up" size={16} color={theme.colors.success[500]} />
                      </View>
                      <View>
                        <Text style={styles.modalLiquidityLabel}>Outbound</Text>
                        <Text style={styles.modalLiquidityValue}>
                          {formatSatoshis(selectedChannel.outbound_balance_msat / 1000)} {bitcoinUnit}
                        </Text>
                      </View>
                    </View>
                    <View style={styles.modalLiquidityItem}>
                      <View style={styles.modalLiquidityIcon}>
                        <Ionicons name="arrow-down" size={16} color={theme.colors.primary[500]} />
                      </View>
                      <View>
                        <Text style={styles.modalLiquidityLabel}>Inbound</Text>
                        <Text style={styles.modalLiquidityValue}>
                          {formatSatoshis(selectedChannel.inbound_balance_msat / 1000)} {bitcoinUnit}
                        </Text>
                      </View>
                    </View>
                  </View>
                  <View style={styles.modalLiquidityBar}>
                    <View style={[
                      styles.modalLiquidityBarFill,
                      { 
                        width: `${(selectedChannel.outbound_balance_msat + selectedChannel.inbound_balance_msat) > 0 ? 
                          (selectedChannel.outbound_balance_msat / (selectedChannel.outbound_balance_msat + selectedChannel.inbound_balance_msat) * 100) : 0}%`,
                        backgroundColor: theme.colors.success[500]
                      }
                    ]} />
                  </View>
                </View>
              </View>

              {/* RGB Asset Liquidity (if applicable) */}
              {selectedChannel.asset_id && (
                <View style={styles.modalSection}>
                  <Text style={styles.modalSectionTitle}>RGB Asset Liquidity</Text>
                  <View style={styles.modalLiquidityContainer}>
                    <View style={styles.modalLiquidityRow}>
                      <View style={styles.modalLiquidityItem}>
                        <View style={styles.modalLiquidityIcon}>
                          <Ionicons name="arrow-up" size={16} color={theme.colors.secondary[500]} />
                        </View>
                        <View>
                          <Text style={styles.modalLiquidityLabel}>Local</Text>
                          <Text style={styles.modalLiquidityValue}>
                            {(selectedChannel.asset_local_amount / Math.pow(10, 8)).toFixed(2)}
                          </Text>
                        </View>
                      </View>
                      <View style={styles.modalLiquidityItem}>
                        <View style={styles.modalLiquidityIcon}>
                          <Ionicons name="arrow-down" size={16} color={theme.colors.secondary[600]} />
                        </View>
                        <View>
                          <Text style={styles.modalLiquidityLabel}>Remote</Text>
                          <Text style={styles.modalLiquidityValue}>
                            {(selectedChannel.asset_remote_amount / Math.pow(10, 8)).toFixed(2)}
                          </Text>
                        </View>
                      </View>
                    </View>
                    <View style={styles.modalLiquidityBar}>
                      <View style={[
                        styles.modalLiquidityBarFill,
                        { 
                          width: `${(selectedChannel.asset_local_amount + selectedChannel.asset_remote_amount) > 0 ? 
                            (selectedChannel.asset_local_amount / (selectedChannel.asset_local_amount + selectedChannel.asset_remote_amount) * 100) : 0}%`,
                          backgroundColor: theme.colors.secondary[500]
                        }
                      ]} />
                    </View>
                  </View>
                </View>
              )}

              {/* Technical Details */}
              <View style={styles.modalSection}>
                <Text style={styles.modalSectionTitle}>Technical Details</Text>
                <View style={styles.modalInfoRow}>
                  <Text style={styles.modalInfoLabel}>Channel ID</Text>
                  <Text style={styles.modalInfoValue} numberOfLines={1}>
                    {selectedChannel.channel_id}
                  </Text>
                </View>
                {selectedChannel.short_channel_id && (
                  <View style={styles.modalInfoRow}>
                    <Text style={styles.modalInfoLabel}>Short Channel ID</Text>
                    <Text style={styles.modalInfoValue}>
                      {selectedChannel.short_channel_id}
                    </Text>
                  </View>
                )}
                <View style={styles.modalInfoRow}>
                  <Text style={styles.modalInfoLabel}>Funding TxID</Text>
                  <Text style={styles.modalInfoValue} numberOfLines={1}>
                    {selectedChannel.funding_txid}
                  </Text>
                </View>
              </View>
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
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
    <View style={styles.container}>
      {renderHeader()}
      {renderActionButtons()}
      
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
        {renderRGBAssets()}
        {renderChannels()}
        
        {/* Bottom padding */}
        <View style={styles.bottomPadding} />
      </ScrollView>
      
      {renderChannelModal()}
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
  
  scrollContent: {
    paddingBottom: 20,
  },
  
  centerContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: theme.spacing[5],
  },
  
  // Enhanced Header
  headerContainer: {
    marginBottom: theme.spacing[4],
  },
  
  headerGradient: {
    paddingTop: Platform.OS === 'android' ? statusBarHeight : 0,
    paddingBottom: theme.spacing[6],
    borderBottomLeftRadius: theme.borderRadius['2xl'],
    borderBottomRightRadius: theme.borderRadius['2xl'],
  },
  
  headerSafeArea: {
    backgroundColor: 'transparent',
  },
  
  headerContent: {
    paddingHorizontal: theme.spacing[5],
  },
  
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: theme.spacing[6],
  },
  
  headerLeft: {
    flex: 1,
  },
  
  greeting: {
    fontSize: theme.typography.fontSize.sm,
    color: 'rgba(255, 255, 255, 0.8)',
    marginBottom: theme.spacing[1],
    fontWeight: '500',
  },
  
  headerTitle: {
    fontSize: theme.typography.fontSize['3xl'],
    fontWeight: '700',
    color: theme.colors.text.inverse,
  },
  
  headerActions: {
    flexDirection: 'row',
    gap: theme.spacing[2],
  },
  
  headerActionButton: {
    width: 40,
    height: 40,
    borderRadius: theme.borderRadius.base,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  
  notificationDot: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#ef4444',
  },
  
  balanceSection: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: theme.spacing[5],
  },
  
  totalBalanceContainer: {
    flex: 1,
  },
  
  balanceLabel: {
    fontSize: theme.typography.fontSize.sm,
    color: 'rgba(255, 255, 255, 0.8)',
    marginBottom: theme.spacing[2],
    fontWeight: '500',
  },
  
  balanceRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginBottom: theme.spacing[1],
  },
  
  balanceAmount: {
    fontSize: theme.typography.fontSize['4xl'],
    fontWeight: '700',
    color: theme.colors.text.inverse,
    marginRight: theme.spacing[2],
  },
  
  balanceCurrency: {
    fontSize: theme.typography.fontSize.lg,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.8)',
  },
  
  balanceUsd: {
    fontSize: theme.typography.fontSize.lg,
    color: 'rgba(255, 255, 255, 0.8)',
    marginBottom: theme.spacing[2],
  },
  
  priceChangeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[1],
  },
  
  priceChange: {
    fontSize: theme.typography.fontSize.sm,
    color: '#10b981',
    fontWeight: '500',
  },
  
  refreshButton: {
    width: 36,
    height: 36,
    borderRadius: theme.borderRadius.base,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  
  balanceBreakdown: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing[4],
  },
  
  breakdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  
  breakdownIcon: {
    width: 32,
    height: 32,
    borderRadius: theme.borderRadius.base,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: theme.spacing[3],
  },
  
  breakdownText: {
    flex: 1,
  },
  
  breakdownLabel: {
    fontSize: theme.typography.fontSize.xs,
    color: 'rgba(255, 255, 255, 0.7)',
    marginBottom: theme.spacing[1],
  },
  
  breakdownValue: {
    fontSize: theme.typography.fontSize.sm,
    fontWeight: '600',
    color: theme.colors.text.inverse,
  },
  
  breakdownDivider: {
    width: 1,
    height: 32,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    marginHorizontal: theme.spacing[4],
  },
  
  // Enhanced Action Buttons
  actionButtonsContainer: {
    paddingHorizontal: theme.spacing[5],
    marginBottom: theme.spacing[4],
    marginTop: -theme.spacing[4],
  },
  
  actionButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: theme.colors.surface.primary,
    borderRadius: theme.borderRadius.xl,
    padding: theme.spacing[4],
    ...theme.shadows.md,
  },
  
  actionButton: {
    alignItems: 'center',
    flex: 1,
  },
  
  actionButtonGradient: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: theme.spacing[2],
    ...theme.shadows.sm,
  },
  
  actionButtonText: {
    fontSize: theme.typography.fontSize.xs,
    fontWeight: '600',
    color: theme.colors.text.primary,
  },
  
  section: {
    paddingHorizontal: theme.spacing[5],
    marginBottom: theme.spacing[6],
  },
  
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing[4],
  },
  
  sectionTitle: {
    fontSize: theme.typography.fontSize.xl,
    fontWeight: '700',
    color: theme.colors.text.primary,
  },
  
  sectionAction: {
    fontSize: theme.typography.fontSize.sm,
    fontWeight: '600',
    color: theme.colors.primary[500],
  },
  
  emptyCard: {
    paddingVertical: theme.spacing[8],
  },
  
  emptyState: {
    alignItems: 'center',
  },
  
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.gray[100],
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: theme.spacing[4],
  },
  
  emptyTitle: {
    fontSize: theme.typography.fontSize.lg,
    fontWeight: '600',
    color: theme.colors.text.primary,
    marginBottom: theme.spacing[2],
  },
  
  emptyDescription: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.text.secondary,
    textAlign: 'center',
    marginBottom: theme.spacing[5],
  },
  
  emptyButton: {
    paddingHorizontal: theme.spacing[6],
  },
  
  floatingAIButton: {
    position: 'absolute',
    right: theme.spacing[5],
    bottom: theme.spacing[5],
    width: 56,
    height: 56,
    borderRadius: 28,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  
  floatingAIGradient: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  
  bottomPadding: {
    height: theme.spacing[4],
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
  
  assetIconContainer: {
    width: 32,
    height: 32,
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.gray[100],
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: theme.spacing[3],
  },
  
  assetIconImage: {
    width: 24,
    height: 24,
    borderRadius: 12,
  },
  emptyActions: {
    flexDirection: 'row',
    gap: theme.spacing[3],
    marginTop: theme.spacing[4],
  },

  // New styles for vertical layouts
  assetsVerticalContainer: {
    marginTop: theme.spacing[4],
  },
  assetVerticalCard: {
    backgroundColor: theme.colors.surface.primary,
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing[4],
    marginBottom: theme.spacing[3],
    borderWidth: 1,
    borderColor: theme.colors.border.light,
    ...theme.shadows.sm,
  },
  assetVerticalContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  assetVerticalLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  assetVerticalInfo: {
    marginLeft: theme.spacing[3],
  },
  assetVerticalTicker: {
    fontSize: theme.typography.fontSize.base,
    fontWeight: '700',
    color: theme.colors.primary[500],
  },
  assetVerticalName: {
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.text.secondary,
  },
  assetVerticalRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  assetVerticalBalance: {
    fontSize: theme.typography.fontSize.base,
    fontWeight: '600',
    color: theme.colors.text.primary,
    marginRight: theme.spacing[2],
  },
  viewMoreButton: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
    backgroundColor: theme.colors.surface.primary,
    borderRadius: theme.borderRadius.lg,
    marginTop: theme.spacing[3],
    ...theme.shadows.sm,
  },
  viewMoreText: {
    fontSize: theme.typography.fontSize.sm,
    fontWeight: '600',
    color: theme.colors.primary[500],
  },

  channelsVerticalContainer: {
    marginTop: theme.spacing[4],
  },
  channelVerticalCard: {
    backgroundColor: theme.colors.surface.primary,
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing[4],
    marginBottom: theme.spacing[3],
    borderWidth: 1,
    borderColor: theme.colors.border.light,
    ...theme.shadows.sm,
  },
     channelVerticalContent: {
     flexDirection: 'row',
     alignItems: 'flex-start',
   },
   channelVerticalLeft: {
     flex: 1,
     flexDirection: 'row',
     alignItems: 'center',
     marginRight: theme.spacing[3],
   },
   channelVerticalStatus: {
     flexDirection: 'row',
     alignItems: 'center',
   },
   channelVerticalStatusDot: {
     width: 10,
     height: 10,
     borderRadius: 5,
     marginRight: theme.spacing[2],
   },
   channelVerticalInfo: {
     flex: 1,
     marginLeft: theme.spacing[2],
   },
   channelVerticalPeerName: {
     fontSize: theme.typography.fontSize.base,
     fontWeight: '600',
     color: theme.colors.text.primary,
     marginBottom: theme.spacing[1],
   },
   channelVerticalStatusRow: {
     flexDirection: 'row',
     alignItems: 'center',
     flexWrap: 'wrap',
   },
   channelVerticalStatusText: {
     fontSize: theme.typography.fontSize.xs,
     fontWeight: '600',
     marginRight: theme.spacing[2],
   },
   channelVerticalCapacity: {
     fontSize: theme.typography.fontSize.xs,
     color: theme.colors.text.secondary,
   },
   channelVerticalRight: {
     alignItems: 'flex-end',
     justifyContent: 'space-between',
     minWidth: 80,
   },
   channelVerticalTopRow: {
     flexDirection: 'row',
     alignItems: 'center',
     justifyContent: 'flex-end',
   },
   channelVerticalLiquidity: {
     alignItems: 'flex-end',
     marginRight: theme.spacing[2],
   },
   liquidityVerticalRow: {
     flexDirection: 'column',
     alignItems: 'flex-end',
     marginBottom: theme.spacing[1],
   },
   liquidityVerticalItem: {
     flexDirection: 'row',
     alignItems: 'center',
     marginBottom: theme.spacing[0.5],
   },
   liquidityVerticalAmount: {
     fontSize: theme.typography.fontSize.xs,
     fontWeight: '600',
     color: theme.colors.text.primary,
     marginLeft: theme.spacing[1],
   },
   liquidityVerticalBar: {
     width: 60,
     height: 4,
     backgroundColor: theme.colors.gray[200],
     borderRadius: 2,
     marginTop: theme.spacing[1],
   },
   liquidityVerticalBarFill: {
     height: '100%',
     borderRadius: 2,
   },

  // Modal styles
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  modalContent: {
    backgroundColor: theme.colors.surface.primary,
    borderRadius: theme.borderRadius.xl,
    width: '90%',
    maxHeight: '80%',
    ...theme.shadows.lg,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: theme.spacing[4],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border.light,
  },
  modalTitle: {
    fontSize: theme.typography.fontSize.xl,
    fontWeight: '700',
    color: theme.colors.text.primary,
  },
  modalCloseButton: {
    padding: theme.spacing[2],
  },
  modalBody: {
    padding: theme.spacing[4],
  },
  modalSection: {
    marginBottom: theme.spacing[4],
  },
  modalSectionTitle: {
    fontSize: theme.typography.fontSize.lg,
    fontWeight: '600',
    color: theme.colors.text.primary,
    marginBottom: theme.spacing[2],
  },
  modalStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: theme.spacing[1],
  },
  modalStatusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: theme.spacing[2],
  },
  modalStatusText: {
    fontSize: theme.typography.fontSize.base,
    fontWeight: '600',
    color: theme.colors.text.primary,
  },
  modalPublicBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.success[50],
    borderRadius: theme.borderRadius.md,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    marginLeft: theme.spacing[3],
  },
  modalPublicText: {
    fontSize: theme.typography.fontSize.xs,
    fontWeight: '600',
    color: theme.colors.success[500],
    marginLeft: theme.spacing[1],
  },
  modalPrivateBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.warning[50],
    borderRadius: theme.borderRadius.md,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    marginLeft: theme.spacing[3],
  },
  modalPrivateText: {
    fontSize: theme.typography.fontSize.xs,
    fontWeight: '600',
    color: theme.colors.warning[500],
    marginLeft: theme.spacing[1],
  },
  modalInfoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: theme.spacing[1],
  },
  modalInfoLabel: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.text.secondary,
  },
  modalInfoValue: {
    fontSize: theme.typography.fontSize.base,
    fontWeight: '600',
    color: theme.colors.text.primary,
    flexShrink: 1,
  },
  modalCapacityValue: {
    fontSize: theme.typography.fontSize.lg,
    fontWeight: '600',
    color: theme.colors.text.primary,
  },
  modalLiquidityContainer: {
    marginTop: theme.spacing[2],
  },
  modalLiquidityRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: theme.spacing[1],
  },
  modalLiquidityItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  modalLiquidityIcon: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: theme.colors.gray[100],
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: theme.spacing[2],
  },
  modalLiquidityLabel: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.text.secondary,
  },
  modalLiquidityValue: {
    fontSize: theme.typography.fontSize.base,
    fontWeight: '600',
    color: theme.colors.text.primary,
  },
  modalLiquidityBar: {
    width: '100%',
    height: 8,
    backgroundColor: theme.colors.gray[200],
    borderRadius: 4,
    marginTop: theme.spacing[1],
  },
  modalLiquidityBarFill: {
    height: '100%',
    borderRadius: 4,
  },
});