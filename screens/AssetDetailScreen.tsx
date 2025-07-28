// screens/AssetDetailScreen.tsx
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Dimensions,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSelector } from 'react-redux';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { RootState } from '../store';
import RGBApiService from '../services/RGBApiService';
import { theme } from '../theme';
import { Card, Button } from '../components';
import { useAssetIcon } from '../utils';

const { width } = Dimensions.get('window');

interface Props {
  navigation: any;
  route: {
    params?: {
      asset?: {
        asset_id: string;
        ticker: string;
        name: string;
        precision?: number;
        issued_supply?: number;
        balance?: {
          settled: number;
          future: number;
          spendable: number;
        };
        isRGB?: boolean;
      };
    };
  };
}

export default function AssetDetailScreen({ navigation, route }: Props) {
  // Safe extraction with fallback
  const asset = route?.params?.asset;
  
  // If no asset is provided, navigate back
  if (!asset || !asset.asset_id || !asset.ticker || !asset.name) {
    React.useEffect(() => {
      console.warn('AssetDetailScreen: Invalid asset data, navigating back');
      navigation.goBack();
    }, [navigation]);
    return null;
  }

  const walletState = useSelector((state: RootState) => state.wallet);
  const { iconUrl } = useAssetIcon(asset.ticker);
  
  const [loading, setLoading] = useState(false);
  const [assetDetails, setAssetDetails] = useState(asset);
  const [refreshing, setRefreshing] = useState(false);
  
  const apiService = RGBApiService.getInstance();
  const isBTC = asset.asset_id === 'BTC';

  useEffect(() => {
    loadAssetDetails();
  }, []);

  const loadAssetDetails = async () => {
    if (isBTC || !apiService) return;
    
    try {
      setLoading(true);
      // For RGB assets, we could fetch more detailed information
      // For now, we'll use the asset data passed from the previous screen
      setAssetDetails(asset);
    } catch (error) {
      console.error('Failed to load asset details:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadAssetDetails();
    setRefreshing(false);
  };

  const handleSend = () => {
    navigation.navigate('Send', { 
      selectedAsset: {
        asset_id: assetDetails.asset_id,
        ticker: assetDetails.ticker,
        name: assetDetails.name,
        isRGB: !isBTC,
      }
    });
  };

  const handleReceive = () => {
    navigation.navigate('Receive', { 
      selectedAsset: {
        asset_id: assetDetails.asset_id,
        ticker: assetDetails.ticker,
        name: assetDetails.name,
        isRGB: !isBTC,
      }
    });
  };

  const AssetIcon = () => {
    if (isBTC) {
      return (
        <View style={styles.iconContainer}>
          <Ionicons name="logo-bitcoin" size={48} color="#F7931A" />
        </View>
      );
    }
    
    if (iconUrl) {
      return (
        <View style={styles.iconContainer}>
          <Image source={{ uri: iconUrl }} style={styles.iconImage} />
        </View>
      );
    }
    
    return (
      <View style={styles.iconContainer}>
        <Ionicons name="diamond" size={48} color={theme.colors.primary[500]} />
      </View>
    );
  };

  const renderHeader = () => {
    const balance = isBTC 
      ? walletState.btcBalance?.vanilla?.spendable || 0
      : assetDetails.balance?.spendable || 0;

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
            <Text style={styles.headerTitle}>Asset Details</Text>
            <TouchableOpacity
              style={styles.moreButton}
              onPress={() => Alert.alert('More Options', 'Additional asset options coming soon')}
            >
              <Ionicons name="ellipsis-horizontal" size={24} color={theme.colors.text.inverse} />
            </TouchableOpacity>
          </View>

          <View style={styles.assetInfo}>
            <AssetIcon />
            <View style={styles.assetTextInfo}>
              <Text style={styles.assetTicker}>{assetDetails.ticker}</Text>
              <Text style={styles.assetName}>{assetDetails.name}</Text>
              <View style={styles.assetTypeContainer}>
                <Text style={styles.assetType}>
                  {isBTC ? 'Bitcoin' : 'RGB Asset'}
                </Text>
              </View>
            </View>
          </View>

          <View style={styles.balanceContainer}>
            <Text style={styles.balanceLabel}>Available Balance</Text>
            <Text style={styles.balanceAmount}>
              {balance.toLocaleString(undefined, {
                minimumFractionDigits: isBTC ? 8 : (assetDetails.precision || 0),
                maximumFractionDigits: isBTC ? 8 : (assetDetails.precision || 0),
              })}
            </Text>
            <Text style={styles.balanceTicker}>{assetDetails.ticker}</Text>
          </View>
        </LinearGradient>
      </View>
    );
  };

  const renderActionButtons = () => (
    <View style={styles.actionsContainer}>
      <TouchableOpacity style={styles.actionButton} onPress={handleReceive}>
        <View style={styles.actionIconContainer}>
          <Ionicons name="arrow-down" size={24} color={theme.colors.success[500]} />
        </View>
        <Text style={styles.actionText}>Receive</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.actionButton} onPress={handleSend}>
        <View style={styles.actionIconContainer}>
          <Ionicons name="arrow-up" size={24} color={theme.colors.primary[500]} />
        </View>
        <Text style={styles.actionText}>Send</Text>
      </TouchableOpacity>

      {!isBTC && (
        <TouchableOpacity 
          style={styles.actionButton} 
          onPress={() => Alert.alert('Feature Coming Soon', 'Asset transfers will be available soon')}
        >
          <View style={styles.actionIconContainer}>
            <Ionicons name="swap-horizontal" size={24} color={theme.colors.secondary[500]} />
          </View>
          <Text style={styles.actionText}>Transfer</Text>
        </TouchableOpacity>
      )}
    </View>
  );

  const renderAssetDetails = () => {
    const details = [
      { label: 'Asset ID', value: assetDetails.asset_id, copyable: true },
      { label: 'Ticker', value: assetDetails.ticker },
      { label: 'Name', value: assetDetails.name },
    ];

    if (!isBTC) {
      details.push(
        { label: 'Precision', value: assetDetails.precision?.toString() || 'N/A' },
        { label: 'Issued Supply', value: assetDetails.issued_supply?.toLocaleString() || 'N/A' }
      );
    }

    if (assetDetails.balance) {
      details.push(
        { label: 'Settled Balance', value: assetDetails.balance.settled.toLocaleString() },
        { label: 'Future Balance', value: assetDetails.balance.future.toLocaleString() },
        { label: 'Spendable Balance', value: assetDetails.balance.spendable.toLocaleString() }
      );
    }

    return (
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Asset Information</Text>
        <Card style={styles.detailsCard}>
          {details.map((detail, index) => (
            <View key={index} style={styles.detailRow}>
              <Text style={styles.detailLabel}>{detail.label}</Text>
              <View style={styles.detailValueContainer}>
                <Text style={styles.detailValue} numberOfLines={1}>
                  {detail.value}
                </Text>
                {detail.copyable && (
                  <TouchableOpacity 
                    style={styles.copyButton}
                    onPress={() => {
                      // Copy to clipboard implementation would go here
                      Alert.alert('Copied', `${detail.label} copied to clipboard`);
                    }}
                  >
                    <Ionicons name="copy-outline" size={16} color={theme.colors.primary[500]} />
                  </TouchableOpacity>
                )}
              </View>
            </View>
          ))}
        </Card>
      </View>
    );
  };

  const renderQuickActions = () => (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Quick Actions</Text>
      <View style={styles.quickActionsGrid}>
        <TouchableOpacity 
          style={styles.quickActionCard}
          onPress={() => navigation.navigate('QRScanner')}
        >
          <View style={styles.quickActionIcon}>
            <Ionicons name="qr-code-outline" size={24} color={theme.colors.primary[500]} />
          </View>
          <Text style={styles.quickActionText}>Scan QR</Text>
        </TouchableOpacity>

        <TouchableOpacity 
          style={styles.quickActionCard}
          onPress={handleRefresh}
        >
          <View style={styles.quickActionIcon}>
            <Ionicons name="refresh-outline" size={24} color={theme.colors.secondary[500]} />
          </View>
          <Text style={styles.quickActionText}>Refresh</Text>
        </TouchableOpacity>

        <TouchableOpacity 
          style={styles.quickActionCard}
          onPress={() => Alert.alert('History', 'Transaction history coming soon')}
        >
          <View style={styles.quickActionIcon}>
            <Ionicons name="time-outline" size={24} color={theme.colors.warning[500]} />
          </View>
          <Text style={styles.quickActionText}>History</Text>
        </TouchableOpacity>

        <TouchableOpacity 
          style={styles.quickActionCard}
          onPress={() => Alert.alert('Export', 'Export options coming soon')}
        >
          <View style={styles.quickActionIcon}>
            <Ionicons name="share-outline" size={24} color={theme.colors.secondary[500]} />
          </View>
          <Text style={styles.quickActionText}>Export</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={theme.colors.primary[500]} />
          <Text style={styles.loadingText}>Loading asset details...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {renderHeader()}
      {renderActionButtons()}
      
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          refreshing ? undefined : undefined // We can add RefreshControl here if needed
        }
      >
        {renderAssetDetails()}
        {renderQuickActions()}
        
        <View style={styles.bottomPadding} />
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
    paddingBottom: theme.spacing[8],
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
  
  moreButton: {
    width: 40,
    height: 40,
    borderRadius: theme.borderRadius.base,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  
  assetInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.spacing[5],
    marginBottom: theme.spacing[6],
  },
  
  iconContainer: {
    width: 64,
    height: 64,
    borderRadius: theme.borderRadius.xl,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: theme.spacing[4],
  },
  
  iconImage: {
    width: 48,
    height: 48,
    borderRadius: 24,
  },
  
  assetTextInfo: {
    flex: 1,
  },
  
  assetTicker: {
    fontSize: theme.typography.fontSize['2xl'],
    fontWeight: '700',
    color: theme.colors.text.inverse,
    marginBottom: theme.spacing[1],
  },
  
  assetName: {
    fontSize: theme.typography.fontSize.base,
    color: 'rgba(255, 255, 255, 0.8)',
    marginBottom: theme.spacing[2],
  },
  
  assetTypeContainer: {
    alignSelf: 'flex-start',
  },
  
  assetType: {
    fontSize: theme.typography.fontSize.xs,
    color: 'rgba(255, 255, 255, 0.7)',
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    borderRadius: theme.borderRadius.base,
  },
  
  balanceContainer: {
    alignItems: 'center',
    paddingHorizontal: theme.spacing[5],
  },
  
  balanceLabel: {
    fontSize: theme.typography.fontSize.sm,
    color: 'rgba(255, 255, 255, 0.8)',
    marginBottom: theme.spacing[2],
  },
  
  balanceAmount: {
    fontSize: theme.typography.fontSize['3xl'],
    fontWeight: '700',
    color: theme.colors.text.inverse,
    marginBottom: theme.spacing[1],
  },
  
  balanceTicker: {
    fontSize: theme.typography.fontSize.base,
    color: 'rgba(255, 255, 255, 0.8)',
  },
  
  actionsContainer: {
    flexDirection: 'row',
    paddingHorizontal: theme.spacing[5],
    marginTop: -theme.spacing[6],
    marginBottom: theme.spacing[5],
    justifyContent: 'space-between',
  },
  
  actionButton: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: theme.colors.surface.primary,
    paddingVertical: theme.spacing[4],
    marginHorizontal: theme.spacing[2],
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
  
  actionIconContainer: {
    width: 48,
    height: 48,
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.gray[50],
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: theme.spacing[2],
  },
  
  actionText: {
    fontSize: theme.typography.fontSize.sm,
    fontWeight: '600',
    color: theme.colors.text.primary,
  },
  
  scrollView: {
    flex: 1,
  },
  
  scrollContent: {
    paddingHorizontal: theme.spacing[5],
    paddingBottom: theme.spacing[6],
  },
  
  section: {
    marginBottom: theme.spacing[6],
  },
  
  sectionTitle: {
    fontSize: theme.typography.fontSize.lg,
    fontWeight: '700',
    color: theme.colors.text.primary,
    marginBottom: theme.spacing[4],
  },
  
  detailsCard: {
    padding: theme.spacing[5],
  },
  
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: theme.spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.gray[100],
  },
  
  detailLabel: {
    fontSize: theme.typography.fontSize.sm,
    fontWeight: '600',
    color: theme.colors.text.secondary,
    flex: 1,
  },
  
  detailValueContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 2,
    justifyContent: 'flex-end',
  },
  
  detailValue: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.text.primary,
    textAlign: 'right',
    flex: 1,
  },
  
  copyButton: {
    marginLeft: theme.spacing[2],
    padding: theme.spacing[1],
  },
  
  quickActionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  
  quickActionCard: {
    width: (width - theme.spacing[5] * 2 - theme.spacing[3]) / 2,
    backgroundColor: theme.colors.surface.primary,
    padding: theme.spacing[4],
    borderRadius: theme.borderRadius.xl,
    alignItems: 'center',
    marginBottom: theme.spacing[3],
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 3.84,
    elevation: 5,
  },
  
  quickActionIcon: {
    width: 48,
    height: 48,
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.gray[50],
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: theme.spacing[3],
  },
  
  quickActionText: {
    fontSize: theme.typography.fontSize.sm,
    fontWeight: '600',
    color: theme.colors.text.primary,
    textAlign: 'center',
  },
  
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  
  loadingText: {
    fontSize: theme.typography.fontSize.base,
    color: theme.colors.text.secondary,
    marginTop: theme.spacing[4],
  },
  
  bottomPadding: {
    height: theme.spacing[4],
  },
}); 