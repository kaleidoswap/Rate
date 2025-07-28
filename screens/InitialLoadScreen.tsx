import React, { useEffect } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { useDispatch, useSelector } from 'react-redux';
import { RootState } from '../store';
import { RGBNodeService } from '../services/RGBNodeService';
import { setUnlocked, setInitialized } from '../store/slices/walletSlice';
import { resetStore } from '../store';

export default function InitialLoadScreen({ navigation }: { navigation: any }) {
  const dispatch = useDispatch();
  const settings = useSelector((state: RootState) => state.settings);
  const nodeService = RGBNodeService.getInstance();

  useEffect(() => {
    resetAndCheckInitialState();
  }, []);

  const resetAndCheckInitialState = async () => {
    try {
      // Reset the store to clear any cached state
      await resetStore();
      
      // Now check the node connection
      if (settings.nodeType === 'remote') {
        // For remote node, verify connection and proceed to dashboard
        const nodeInitialized = await nodeService.initializeNode();
        if (nodeInitialized) {
          // Set wallet as initialized and unlocked for remote node
          dispatch(setUnlocked(true));
          dispatch(setInitialized(true));
          
          // Navigate directly to dashboard
          navigation.replace('Dashboard');
        } else {
          // If remote connection fails, go to wallet setup where the error will be handled
          navigation.replace('WalletSetup');
        }
      } else {
        // For local node, go to wallet setup to handle initialization
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