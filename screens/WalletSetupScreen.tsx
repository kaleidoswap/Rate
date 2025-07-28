// screens/WalletSetupScreen.tsx
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useDispatch, useSelector } from 'react-redux';
import { RootState } from '../store';
import { RGBNodeService } from '../services/RGBNodeService';
import { DatabaseService } from '../services/DatabaseService';
import { setUnlocked, setInitialized } from '../store/slices/walletSlice';
import { RGBApiService } from '../services/RGBApiService';

interface Props {
  navigation: any;
}

export default function WalletSetupScreen({ navigation }: Props) {
  const dispatch = useDispatch();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nodeService = RGBNodeService.getInstance();
  const dbService = DatabaseService.getInstance();
  const rgbApiService = RGBApiService.getInstance();

  useEffect(() => {
    initializeServices();
  }, []);

  const checkNodeStatus = async (): Promise<boolean> => {
    try {
      // Try to get node info - if this succeeds, the node is running and unlocked
      await rgbApiService.getNodeInfo();
      return true;
    } catch (error) {
      console.log('Node status check error:', error);
      return false;
    }
  };

  const initializeServices = async () => {
    setLoading(true);
    setError(null);
    try {
      // Initialize database
      await dbService.initializeDatabase();
      
      // Check if node is already running and unlocked
      const isNodeUnlocked = await checkNodeStatus();
      
      if (isNodeUnlocked) {
        console.log('Node is already unlocked');
        // Node is already unlocked, set state and navigate to dashboard
        dispatch(setUnlocked(true));
        dispatch(setInitialized(true));
        navigation.replace('Dashboard');
        return;
      }

      // If not unlocked, try to initialize node
      const nodeInitialized = await nodeService.initializeNode();
      if (nodeInitialized) {
        // Set wallet as initialized and unlocked
        dispatch(setUnlocked(true));
        dispatch(setInitialized(true));
        
        // Navigate to dashboard
        navigation.replace('Dashboard');
      } else {
        setError('Failed to connect to remote node. Please check your settings.');
      }
    } catch (error: any) {
      console.error('Initialization error:', error);
      setError(error.message || 'Failed to initialize services');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        style={styles.keyboardAvoidingView}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={styles.container}>
          {loading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color="#007AFF" />
              <Text style={styles.loadingText}>Connecting to remote node...</Text>
            </View>
          ) : error ? (
            <View style={styles.container}>
              <Text style={styles.title}>Connection Error</Text>
              <Text style={styles.message}>{error}</Text>
              <TouchableOpacity
                style={styles.button}
                onPress={() => navigation.navigate('Settings')}
              >
                <Text style={styles.buttonText}>Open Settings</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.button, { marginTop: 10 }]}
                onPress={initializeServices}
              >
                <Text style={styles.buttonText}>Retry Connection</Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  keyboardAvoidingView: {
    flex: 1,
  },
  container: {
    flex: 1,
    padding: 20,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 10,
    fontSize: 16,
    color: '#666',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 20,
    textAlign: 'center',
  },
  message: {
    fontSize: 16,
    color: '#666',
    marginBottom: 30,
    textAlign: 'center',
    lineHeight: 24,
  },
  button: {
    backgroundColor: '#007AFF',
    height: 50,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 30,
    minWidth: 200,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});