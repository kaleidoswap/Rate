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
  StatusBar,
  Modal,
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

import { theme } from '../theme';
import {
  BalanceCard,
  ActionButtons,
  AssetList,
  ChannelList,
  MainHeader
} from '../components';
import { formatBitcoinAmount, useBitcoinConversion } from '../utils/bitcoinUnits';

const { width } = Dimensions.get('window');

interface Props {
  navigation: any;
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
  const { nodeInfo } = useSelector((state: RootState) => state.node);
  const bitcoinUnit = useSelector((state: RootState) => state.settings.bitcoinUnit);
  const [isNodeUnlocked, setIsNodeUnlocked] = useState(false);
  const [isConnecting, setIsConnecting] = useState(true);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [apiService, setApiService] = useState<RGBApiService | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const { formatSatoshisToUSD } = useBitcoinConversion();
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

  // Modal state for channel details
  const [channelModalVisible, setChannelModalVisible] = useState(false);
  const [selectedChannel, setSelectedChannel] = useState<Channel | null>(null);

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
  }, []);

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
    }, [])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await loadDashboardData();
    setRefreshing(false);
  };

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
                  </View>
                </View>
              )}
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={theme.colors.primary[500]}
            colors={[theme.colors.primary[500]]}
          />
        }
      >
        <MainHeader
          greeting={getGreeting()}
          title="Rate Wallet"
          showNotification
          showSettings
        >
          <BalanceCard
            totalBalance={totalBalance}
            bitcoinUnit={bitcoinUnit}
            onRefresh={onRefresh}
            refreshing={refreshing}
            formatSatoshis={formatSatoshis}
            formatUSD={formatUSD}
            onChainBalance={getTotalBtcBalance()}
            lightningBalance={offChainBalance}
          />
        </MainHeader>

        <ActionButtons
          onSend={() => navigation.navigate('Send')}
          onReceive={() => navigation.navigate('Receive')}
          onSwap={() => navigation.navigate('Swap')}
          onHistory={() => navigation.navigate('History')}
        />

        <AssetList
          assets={rgbAssets}
          onViewAll={() => navigation.navigate('Assets')}
          onAssetPress={(asset) => navigation.navigate('AssetDetail', {
            asset: {
              ...asset,
              isRGB: true
            }
          })}
          onIssueAsset={() => navigation.navigate('IssueAsset')}
        />

        <ChannelList
          channels={channels}
          bitcoinUnit={bitcoinUnit}
          formatSatoshis={formatSatoshis}
          onViewAll={() => navigation.navigate('Channels')}
          onChannelPress={(channel) => {
            setSelectedChannel(channel);
            setChannelModalVisible(true);
          }}
          onOpenChannel={() => navigation.navigate('OpenChannel')}
          onBuyChannel={() => navigation.navigate('LSP')}
        />
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
  scrollContent: {
    paddingBottom: theme.spacing[24],
  },
  headerContainer: {
    marginBottom: theme.spacing[4],
  },
  headerGradient: {
    paddingBottom: theme.spacing[12],
    borderBottomLeftRadius: theme.borderRadius['3xl'],
    borderBottomRightRadius: theme.borderRadius['3xl'],
  },
  headerSafeArea: {
    backgroundColor: 'transparent',
  },
  headerContent: {
    paddingHorizontal: theme.spacing[4],
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing[6],
    marginTop: theme.spacing[2],
  },
  headerLeft: {
    flex: 1,
  },
  greeting: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.text.inverse,
    opacity: 0.8,
    marginBottom: 4,
  },
  headerTitle: {
    fontSize: theme.typography.fontSize['2xl'],
    fontWeight: '700',
    color: theme.colors.text.inverse,
  },
  headerActions: {
    flexDirection: 'row',
    gap: theme.spacing[3],
  },
  headerActionButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  notificationDot: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: theme.colors.error[500],
    borderWidth: 1,
    borderColor: theme.colors.primary[600],
  },
  // Modal Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: theme.colors.surface.primary,
    borderTopLeftRadius: theme.borderRadius['2xl'],
    borderTopRightRadius: theme.borderRadius['2xl'],
    maxHeight: '80%',
    paddingBottom: theme.spacing[8],
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
    marginBottom: theme.spacing[6],
  },
  modalSectionTitle: {
    fontSize: theme.typography.fontSize.sm,
    fontWeight: '600',
    color: theme.colors.text.secondary,
    marginBottom: theme.spacing[3],
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  modalStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: theme.spacing[2],
  },
  modalStatusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  modalStatusText: {
    fontSize: theme.typography.fontSize.base,
    fontWeight: '500',
    color: theme.colors.text.primary,
    marginRight: theme.spacing[2],
  },
  modalPublicBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.primary[50],
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 4,
    borderRadius: theme.borderRadius.full,
    gap: 4,
  },
  modalPublicText: {
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.primary[600],
    fontWeight: '500',
  },
  modalPrivateBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.gray[100],
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 4,
    borderRadius: theme.borderRadius.full,
    gap: 4,
  },
  modalPrivateText: {
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.gray[600],
    fontWeight: '500',
  },
  modalInfoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing[3],
  },
  modalInfoLabel: {
    fontSize: theme.typography.fontSize.base,
    color: theme.colors.text.secondary,
  },
  modalInfoValue: {
    fontSize: theme.typography.fontSize.base,
    fontWeight: '500',
    color: theme.colors.text.primary,
    maxWidth: '60%',
  },
  modalCapacityValue: {
    fontSize: theme.typography.fontSize['2xl'],
    fontWeight: '700',
    color: theme.colors.text.primary,
  },
  modalLiquidityContainer: {
    backgroundColor: theme.colors.surface.secondary,
    padding: theme.spacing[4],
    borderRadius: theme.borderRadius.xl,
  },
  modalLiquidityRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: theme.spacing[3],
  },
  modalLiquidityItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[3],
  },
  modalLiquidityIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: theme.colors.surface.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalLiquidityLabel: {
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.text.secondary,
    marginBottom: 2,
  },
  modalLiquidityValue: {
    fontSize: theme.typography.fontSize.sm,
    fontWeight: '600',
    color: theme.colors.text.primary,
  },
  modalLiquidityBar: {
    height: 6,
    backgroundColor: theme.colors.gray[200],
    borderRadius: 3,
    overflow: 'hidden',
  },
  modalLiquidityBarFill: {
    height: '100%',
    borderRadius: 3,
  },
});