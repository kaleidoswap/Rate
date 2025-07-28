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
} from 'react-native';
import { useDispatch, useSelector } from 'react-redux';
import { AppDispatch, RootState } from '../store';
import { loadAssets, syncAssets } from '../store/slices/assetsSlice';
import { AssetRecord } from '../services/DatabaseService';

interface Props {
  navigation: any;
}

export default function AssetsScreen({ navigation }: Props) {
  const dispatch = useDispatch<AppDispatch>();
  const { activeWallet } = useSelector((state: RootState) => state.wallet);
  const { rgbAssets, isLoading } = useSelector((state: RootState) => state.assets);
  const [refreshing, setRefreshing] = useState(false);

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
    }
  };

  const handleRefresh = async () => {
    if (!activeWallet) return;
    setRefreshing(true);
    try {
      await dispatch(syncAssets(activeWallet.id));
    } catch (error) {
      console.error('Failed to sync assets:', error);
    } finally {
      setRefreshing(false);
    }
  };

  const renderAssetItem = (asset: AssetRecord) => (
    <TouchableOpacity
      key={asset.asset_id}
      style={styles.assetItem}
      onPress={() => navigation.navigate('AssetDetails', { asset })}
    >
      <View style={styles.assetInfo}>
        <Text style={styles.assetName}>{asset.name}</Text>
        <Text style={styles.assetTicker}>{asset.ticker}</Text>
      </View>
      <View style={styles.balanceContainer}>
        <Text style={styles.balanceText}>
          {asset.balance.toLocaleString()} {asset.ticker}
        </Text>
      </View>
    </TouchableOpacity>
  );

  const renderEmptyState = () => (
    <View style={styles.emptyState}>
      <Text style={styles.emptyStateText}>No assets found</Text>
      <TouchableOpacity
        style={styles.issueButton}
        onPress={() => navigation.navigate('IssueAsset')}
      >
        <Text style={styles.issueButtonText}>Issue New Asset</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Assets</Text>
        <TouchableOpacity
          style={styles.issueButton}
          onPress={() => navigation.navigate('IssueAsset')}
        >
          <Text style={styles.issueButtonText}>Issue New Asset</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.assetList}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
        }
      >
        {isLoading ? (
          <ActivityIndicator style={styles.loader} size="large" color="#007AFF" />
        ) : rgbAssets && rgbAssets.length > 0 ? (
          rgbAssets.map(renderAssetItem)
        ) : (
          renderEmptyState()
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
  },
  assetList: {
    flex: 1,
  },
  assetItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  assetInfo: {
    flex: 1,
  },
  assetName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  assetTicker: {
    fontSize: 14,
    color: '#666',
    marginTop: 4,
  },
  balanceContainer: {
    alignItems: 'flex-end',
  },
  balanceText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  emptyStateText: {
    fontSize: 16,
    color: '#666',
    marginBottom: 20,
  },
  issueButton: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  issueButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  loader: {
    marginTop: 20,
  },
});