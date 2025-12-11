import React, { useEffect } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { useDispatch } from 'react-redux';
import { RGBNodeService } from '../services/RGBNodeService';
import DatabaseService, { NetworkConfig } from '../services/DatabaseService';
import RGBApiService from '../services/RGBApiService';
import { setUnlocked, setInitialized, setActiveWallet } from '../store/slices/walletSlice';
import { autoRestoreNostrConnection } from '../services/initializeServices';

export default function InitialLoadScreen({ navigation }: { navigation: any }) {
  const dispatch = useDispatch();
  const nodeService = RGBNodeService.getInstance();

  useEffect(() => {
    initializeApp();
  }, []);

  const initializeApp = async () => {
    try {
      // Initialize database first
      const dbService = DatabaseService.getInstance();
      await dbService.initializeDatabase();
      
      // Load active wallet
      let activeWallet = await dbService.getActiveWallet();

      // If no active wallet, try to find any wallet and make it active (Single Wallet enforcement)
      if (!activeWallet) {
        const wallets = await dbService.getAllWallets();
        if (wallets.length > 0) {
          activeWallet = wallets[0];
          await dbService.setActiveWallet(activeWallet.id!);
        }
      }

      if (activeWallet) {
        // Set active wallet in Redux
        dispatch(setActiveWallet(activeWallet));

        // Initialize RLN if enabled
        const rlnConfig = activeWallet.networks?.find((n: NetworkConfig) => n.type === 'rln' && n.enabled);
        if (rlnConfig && rlnConfig.config) {
          try {
            const config = JSON.parse(rlnConfig.config);
            let apiUrl = '';

            if (config.type === 'remote' && config.url) {
              apiUrl = config.url;
            } else if (config.type === 'local') {
              apiUrl = 'http://127.0.0.1:3000'; // Default local URL
            }

            if (apiUrl) {
              // Initialize API service with wallet's node URL
              const apiService = RGBApiService.getInstance();
              apiService.initialize({
                baseURL: apiUrl,
                timeout: 30000,
              });

              // Initialize node service (sets status to running)
              await nodeService.initializeNode();
            }
          } catch (e) {
            console.error('Failed to parse/init RLN config:', e);
          }
        }

        dispatch(setInitialized(true));
        dispatch(setUnlocked(true));

        // Attempt to auto-restore Nostr connection in parallel
        autoRestoreNostrConnection().catch(error => {
          console.log('Nostr auto-restore failed (non-blocking):', error);
        });

        navigation.replace('Dashboard');
        return;
      }

      // If absolutely no wallets, go to WalletSetup (Onboarding)
      navigation.replace('WalletSetup');

    } catch (error) {
      console.error('Initial state check error:', error);
      // Fallback to Setup if something critical fails
      navigation.replace('WalletSetup');
    }
  };

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color="#007AFF" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
});
