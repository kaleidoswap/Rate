import React, { useEffect } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { useDispatch } from 'react-redux';
import { RGBNodeService } from '../services/RGBNodeService';
import { setUnlocked, setInitialized } from '../store/slices/walletSlice';
import { autoRestoreNostrConnection } from '../services/initializeServices';

export default function InitialLoadScreen({ navigation }: { navigation: any }) {
  const dispatch = useDispatch();
  const nodeService = RGBNodeService.getInstance();

  useEffect(() => {
    initializeApp();
  }, []);

  const initializeApp = async () => {
    try {
      // Initialize remote node connection
      const nodeInitialized = await nodeService.initializeNode();
      
      // Attempt to auto-restore Nostr connection in parallel
      // Don't block app startup if this fails
      autoRestoreNostrConnection().catch(error => {
        console.log('Nostr auto-restore failed (non-blocking):', error);
      });
      
      if (nodeInitialized) {
        // Set wallet as initialized and unlocked for remote node
        dispatch(setInitialized(true));
        dispatch(setUnlocked(true));
        
        // Navigate directly to dashboard
        navigation.replace('Dashboard');
      } else {
        // If remote connection fails, show error in wallet setup
        navigation.replace('WalletSetup');
      }
    } catch (error) {
      console.error('Initial state check error:', error);
      // On error, go to wallet setup where it will be handled
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