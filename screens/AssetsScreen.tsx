// screens/AssetsScreen.tsx
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
  ScrollView,
  ActivityIndicator,
  Image,
  Alert,
} from 'react-native';
import { useDispatch, useSelector } from 'react-redux';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { AppDispatch, RootState } from '../store';
import { loadAssets, syncAssets } from '../store/slices/assetsSlice';
import { AssetRecord } from '../services/DatabaseService';
import { useAssetIcon } from '../utils';
import { theme } from '../theme';
import { Card, Button } from '../components';
import { IssueAssetModal } from '../components/IssueAssetModal';

interface Props {
  navigation: any;
}

export default function AssetsScreen({ navigation }: Props) {
  const dispatch = useDispatch<AppDispatch>();
  const { activeWallet } = useSelector((state: RootState) => state.wallet);
  const { rgbAssets, isLoading } = useSelector((state: RootState) => state.assets);
  const [refreshing, setRefreshing] = useState(false);
  const [showIssueModal, setShowIssueModal] = useState(false);

  // Asset Icon Component
  const AssetIcon = ({ ticker }: { ticker: string }) => {
    const { iconUrl } = useAssetIcon(ticker);
    
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

  useEffect(() => {
    if (activeWallet) {
      loadAssetData();
    }
  }, [activeWallet]);

  const loadAssetData = async () => {
    if (!activeWallet) return;
    try {
      await dispatch(loadAssets(activeWallet.id));
    } catch (error) {
      console.error('Failed to load assets:', error);
      Alert.alert('Error', 'Failed to load assets');
    }
  };

  const handleRefresh = async () => {
    if (!activeWallet) return;
    setRefreshing(true);
    try {
      await dispatch(syncAssets(activeWallet.id));
    } catch (error) {
      console.error('Failed to sync assets:', error);
      Alert.alert('Error', 'Failed to sync assets');
    } finally {
      setRefreshing(false);
    }
  };

  const handleIssueSuccess = () => {
    // Refresh the assets list after successful issuance
    loadAssetData();
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
          <Text style={styles.headerTitle}>RGB Assets</Text>
          <TouchableOpacity
            style={styles.issueHeaderButton}
            onPress={() => setShowIssueModal(true)}
          >
            <Ionicons name="add" size={24} color={theme.colors.text.inverse} />
          </TouchableOpacity>
        </View>

        <View style={styles.headerStats}>
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{rgbAssets?.length || 0}</Text>
            <Text style={styles.statLabel}>Assets</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={styles.statValue}>
              {rgbAssets?.reduce((sum: number, asset: AssetRecord) => sum + asset.balance, 0)?.toLocaleString() || '0'}
            </Text>
            <Text style={styles.statLabel}>Total Tokens</Text>
          </View>
        </View>
      </LinearGradient>
    </View>
  );

  const renderAssetItem = (asset: AssetRecord, index: number) => (
    <TouchableOpacity
      key={asset.asset_id}
      style={[styles.assetCard, index === 0 && styles.firstAssetCard]}
      onPress={() => navigation.navigate('AssetDetail', { 
        asset: {
          ...asset,
          isRGB: true
        }
      })}
    >
      <View style={styles.assetCardHeader}>
        <View style={styles.assetCardLeft}>
          <AssetIcon ticker={asset.ticker} />
          <View style={styles.assetInfo}>
            <Text style={styles.assetTicker}>{asset.ticker}</Text>
            <Text style={styles.assetName}>{asset.name}</Text>
          </View>
        </View>
        <Ionicons name="chevron-forward" size={20} color={theme.colors.gray[400]} />
      </View>

      <View style={styles.assetCardStats}>
        <View style={styles.assetStat}>
          <Text style={styles.assetStatLabel}>Balance</Text>
          <Text style={styles.assetStatValue}>
            {asset.balance.toFixed(asset.precision || 0)}
          </Text>
        </View>
        <View style={styles.assetStat}>
          <Text style={styles.assetStatLabel}>Supply</Text>
          <Text style={styles.assetStatValue}>
            {asset.issued_supply?.toLocaleString() || 'N/A'}
          </Text>
        </View>
        <View style={styles.assetStat}>
          <Text style={styles.assetStatLabel}>Precision</Text>
          <Text style={styles.assetStatValue}>
            {asset.precision || 0}
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );

  const renderEmptyState = () => (
    <View style={styles.emptyState}>
      <View style={styles.emptyIcon}>
        <Ionicons name="diamond-outline" size={64} color={theme.colors.gray[400]} />
      </View>
      <Text style={styles.emptyTitle}>No RGB Assets Yet</Text>
      <Text style={styles.emptyDescription}>
        Issue your first RGB asset to get started with tokenization on Bitcoin
      </Text>
      <Button
        title="Issue Your First Asset"
        variant="primary"
        size="lg"
        onPress={() => setShowIssueModal(true)}
        style={styles.emptyButton}
        icon={<Ionicons name="add" size={20} color={theme.colors.text.inverse} />}
      />
    </View>
  );

  const renderAssetsList = () => (
    <ScrollView 
      style={styles.assetsList}
      contentContainerStyle={styles.assetsListContent}
      showsVerticalScrollIndicator={false}
    >
             {rgbAssets && rgbAssets.length > 0 
         ? rgbAssets.map((asset: AssetRecord, index: number) => renderAssetItem(asset, index))
         : renderEmptyState()
       }
    </ScrollView>
  );

  const renderFloatingButton = () => (
    <TouchableOpacity
      style={styles.floatingButton}
      onPress={() => setShowIssueModal(true)}
      activeOpacity={0.8}
    >
      <LinearGradient
        colors={['#4338ca', '#7c3aed'] as [string, string]}
        style={styles.floatingButtonGradient}
      >
        <Ionicons name="add" size={24} color={theme.colors.text.inverse} />
      </LinearGradient>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container}>
      {renderHeader()}
      
      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={theme.colors.primary[500]} />
          <Text style={styles.loadingText}>Loading assets...</Text>
        </View>
      ) : (
        <>
          <ScrollView
            style={styles.scrollView}
            refreshControl={
              <RefreshControl 
                refreshing={refreshing} 
                onRefresh={handleRefresh}
                tintColor={theme.colors.primary[500]}
              />
            }
            showsVerticalScrollIndicator={false}
          >
            {renderAssetsList()}
          </ScrollView>
          
          {rgbAssets && rgbAssets.length > 0 && renderFloatingButton()}
        </>
      )}

      {/* Issue Asset Modal */}
      <IssueAssetModal
        visible={showIssueModal}
        onClose={() => setShowIssueModal(false)}
        onSuccess={handleIssueSuccess}
      />
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
  
  issueHeaderButton: {
    width: 40,
    height: 40,
    borderRadius: theme.borderRadius.base,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  
  headerStats: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: theme.spacing[5],
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: theme.borderRadius.lg,
    marginHorizontal: theme.spacing[5],
    paddingVertical: theme.spacing[4],
  },
  
  statItem: {
    alignItems: 'center',
    flex: 1,
  },
  
  statValue: {
    fontSize: theme.typography.fontSize['2xl'],
    fontWeight: '700',
    color: theme.colors.text.inverse,
    marginBottom: theme.spacing[1],
  },
  
  statLabel: {
    fontSize: theme.typography.fontSize.sm,
    color: 'rgba(255, 255, 255, 0.8)',
  },
  
  statDivider: {
    width: 1,
    height: 40,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    marginHorizontal: theme.spacing[6],
  },
  
  scrollView: {
    flex: 1,
  },
  
  assetsList: {
    flex: 1,
    paddingHorizontal: theme.spacing[5],
  },
  
  assetsListContent: {
    paddingBottom: theme.spacing[6],
  },
  
  assetCard: {
    backgroundColor: theme.colors.surface.primary,
    borderRadius: theme.borderRadius.xl,
    padding: theme.spacing[5],
    marginBottom: theme.spacing[4],
    borderWidth: 1,
    borderColor: theme.colors.border.light,
    ...theme.shadows.sm,
  },
  
  firstAssetCard: {
    marginTop: 0,
  },
  
  assetCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: theme.spacing[4],
  },
  
  assetCardLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  
  assetIconContainer: {
    width: 48,
    height: 48,
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.gray[100],
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: theme.spacing[3],
  },
  
  assetIconImage: {
    width: 32,
    height: 32,
    borderRadius: 16,
  },
  
  assetInfo: {
    flex: 1,
  },
  
  assetTicker: {
    fontSize: theme.typography.fontSize.lg,
    fontWeight: '700',
    color: theme.colors.primary[500],
    marginBottom: theme.spacing[1],
  },
  
  assetName: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.text.secondary,
  },
  
  assetCardStats: {
    flexDirection: 'row',
    backgroundColor: theme.colors.background.secondary,
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing[3],
  },
  
  assetStat: {
    flex: 1,
    alignItems: 'center',
  },
  
  assetStatLabel: {
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.text.muted,
    marginBottom: theme.spacing[1],
  },
  
  assetStatValue: {
    fontSize: theme.typography.fontSize.sm,
    fontWeight: '600',
    color: theme.colors.text.primary,
  },
  
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: theme.spacing[10],
    paddingHorizontal: theme.spacing[6],
  },
  
  emptyIcon: {
    width: 120,
    height: 120,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.gray[100],
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: theme.spacing[6],
  },
  
  emptyTitle: {
    fontSize: theme.typography.fontSize.xl,
    fontWeight: '700',
    color: theme.colors.text.primary,
    marginBottom: theme.spacing[3],
    textAlign: 'center',
  },
  
  emptyDescription: {
    fontSize: theme.typography.fontSize.base,
    color: theme.colors.text.secondary,
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: theme.spacing[8],
    maxWidth: 280,
  },
  
  emptyButton: {
    paddingHorizontal: theme.spacing[8],
  },
  
  floatingButton: {
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
  
  floatingButtonGradient: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
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
});