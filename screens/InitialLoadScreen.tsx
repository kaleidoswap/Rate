import React, { useEffect } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { useDispatch } from 'react-redux';
import DatabaseService, { NetworkConfig } from '../services/DatabaseService';
import { setUnlocked, setInitialized, setActiveWallet } from '../store/slices/walletSlice';
import { autoRestoreNostrConnection, initializeProtocolServices } from '../services/initializeServices';

export default function InitialLoadScreen({ navigation }: { navigation: any }) {
  const dispatch = useDispatch();

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

        // Initialize protocol services for all enabled networks
        try {
          await initializeProtocolServices();
        } catch (e) {
          console.error('Failed to initialize protocol services:', e);
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
