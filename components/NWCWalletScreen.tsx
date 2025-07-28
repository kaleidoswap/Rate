// components/NWCWalletScreen.tsx
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  Clipboard,
  ActivityIndicator,
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { initializeNostrWalletConnect, getNostrWalletConnectStatus } from '../services/initializeServices';
import NostrService from '../services/NostrService';

interface NWCStatus {
  isRunning: boolean;
  connections: number;
  supportedMethods: string[];
}

interface ConnectionInfo {
  connectionString: string;
  walletPubkey: string;
  permissions: string[];
}

const NWCWalletScreen: React.FC = () => {
  const [status, setStatus] = useState<NWCStatus | null>(null);
  const [connectionInfo, setConnectionInfo] = useState<ConnectionInfo | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);

  useEffect(() => {
    checkStatus();
    const interval = setInterval(checkStatus, 5000); // Check status every 5 seconds
    return () => clearInterval(interval);
  }, []);

  const checkStatus = async () => {
    try {
      const nwcStatus = await getNostrWalletConnectStatus();
      setStatus(nwcStatus);
      setIsInitialized(nwcStatus?.isRunning || false);
    } catch (error) {
      console.error('Failed to get NWC status:', error);
    }
  };

  const initializeNWC = async () => {
    setIsLoading(true);
    try {
      const success = await initializeNostrWalletConnect();
      if (success) {
        Alert.alert('Success', 'Nostr Wallet Connect initialized successfully');
        setIsInitialized(true);
        await generateConnectionString();
      } else {
        Alert.alert('Error', 'Failed to initialize Nostr Wallet Connect');
      }
    } catch (error) {
      console.error('Failed to initialize NWC:', error);
      Alert.alert('Error', 'Failed to initialize Nostr Wallet Connect');
    } finally {
      setIsLoading(false);
    }
  };

  const generateConnectionString = async (permissions?: string[]) => {
    setIsLoading(true);
    try {
      const nostrService = NostrService.getInstance();
      
      const defaultPermissions = permissions || [
        'pay_invoice',
        'make_invoice',
        'get_balance',
        'get_info',
        'list_transactions',
      ];

      const connectionString = await nostrService.getWalletConnectInfo(
        defaultPermissions,
        'wallet@example.com' // Optional Lightning Address
      );

      const walletPubkey = await nostrService.getWalletPubkey();

      if (connectionString && walletPubkey) {
        setConnectionInfo({
          connectionString,
          walletPubkey,
          permissions: defaultPermissions,
        });
        Alert.alert(
          'Connection String Generated', 
          'Share this with your Nostr client to connect'
        );
      } else {
        Alert.alert('Error', 'Failed to generate connection string');
      }
    } catch (error) {
      console.error('Failed to generate connection string:', error);
      Alert.alert('Error', 'Failed to generate connection string');
    } finally {
      setIsLoading(false);
    }
  };

  const copyConnectionString = () => {
    if (connectionInfo?.connectionString) {
      Clipboard.setString(connectionInfo.connectionString);
      Alert.alert('Copied', 'Connection string copied to clipboard');
    }
  };

  const generateRestrictedConnection = () => {
    Alert.alert(
      'Select Permissions',
      'Choose what the client can do',
      [
        {
          text: 'Read Only',
          onPress: () => generateConnectionString(['get_balance', 'get_info', 'list_transactions']),
        },
        {
          text: 'Payment Only',
          onPress: () => generateConnectionString(['pay_invoice', 'get_balance']),
        },
        {
          text: 'Invoice Only',
          onPress: () => generateConnectionString(['make_invoice', 'get_balance']),
        },
        {
          text: 'Full Access',
          onPress: () => generateConnectionString(),
        },
        { text: 'Cancel', style: 'cancel' },
      ]
    );
  };

  const renderStatus = () => (
    <View style={styles.statusContainer}>
      <Text style={styles.sectionTitle}>Service Status</Text>
      
      <View style={styles.statusRow}>
        <Text style={styles.statusLabel}>Status:</Text>
        <View style={[
          styles.statusIndicator,
          { backgroundColor: status?.isRunning ? '#4CAF50' : '#F44336' }
        ]}>
          <Text style={styles.statusText}>
            {status?.isRunning ? 'Running' : 'Stopped'}
          </Text>
        </View>
      </View>

      <View style={styles.statusRow}>
        <Text style={styles.statusLabel}>Active Connections:</Text>
        <Text style={styles.statusValue}>{status?.connections || 0}</Text>
      </View>

      <View style={styles.statusRow}>
        <Text style={styles.statusLabel}>Supported Methods:</Text>
        <Text style={styles.statusValue}>{status?.supportedMethods?.length || 0}</Text>
      </View>

      {status?.supportedMethods && (
        <View style={styles.methodsList}>
          {status.supportedMethods.map((method, index) => (
            <Text key={index} style={styles.methodItem}>• {method}</Text>
          ))}
        </View>
      )}
    </View>
  );

  const renderConnectionInfo = () => {
    if (!connectionInfo) return null;

    return (
      <View style={styles.connectionContainer}>
        <Text style={styles.sectionTitle}>Connection Information</Text>
        
        <View style={styles.qrContainer}>
          <QRCode
            value={connectionInfo.connectionString}
            size={200}
            backgroundColor="white"
            color="black"
          />
        </View>

        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Wallet Pubkey:</Text>
          <Text style={styles.infoValue} numberOfLines={1} ellipsizeMode="middle">
            {connectionInfo.walletPubkey}
          </Text>
        </View>

        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Permissions:</Text>
          <View style={styles.permissionsList}>
            {connectionInfo.permissions.map((permission, index) => (
              <Text key={index} style={styles.permissionItem}>• {permission}</Text>
            ))}
          </View>
        </View>

        <TouchableOpacity style={styles.copyButton} onPress={copyConnectionString}>
          <Text style={styles.copyButtonText}>Copy Connection String</Text>
        </TouchableOpacity>
      </View>
    );
  };

  const renderControls = () => (
    <View style={styles.controlsContainer}>
      <Text style={styles.sectionTitle}>Controls</Text>
      
      {!isInitialized ? (
        <TouchableOpacity 
          style={[styles.button, styles.primaryButton]} 
          onPress={initializeNWC}
          disabled={isLoading}
        >
          {isLoading ? (
            <ActivityIndicator color="white" />
          ) : (
            <Text style={styles.buttonText}>Initialize NWC Service</Text>
          )}
        </TouchableOpacity>
      ) : (
        <>
          <TouchableOpacity 
            style={[styles.button, styles.primaryButton]} 
            onPress={() => generateConnectionString()}
            disabled={isLoading}
          >
            {isLoading ? (
              <ActivityIndicator color="white" />
            ) : (
              <Text style={styles.buttonText}>Generate Full Access Connection</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity 
            style={[styles.button, styles.secondaryButton]} 
            onPress={generateRestrictedConnection}
            disabled={isLoading}
          >
            <Text style={styles.secondaryButtonText}>Generate Restricted Connection</Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  );

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
      <Text style={styles.title}>Nostr Wallet Connect</Text>
      <Text style={styles.subtitle}>
        Connect external Nostr clients to your RGB Lightning Node
      </Text>

      {renderStatus()}
      {renderControls()}
      {renderConnectionInfo()}

      <View style={styles.infoBox}>
        <Text style={styles.infoBoxTitle}>💡 How to use:</Text>
        <Text style={styles.infoBoxText}>
          1. Initialize the NWC service{'\n'}
          2. Generate a connection string{'\n'}
          3. Scan the QR code or copy the string{'\n'}
          4. Import it in your Nostr client{'\n'}
          5. Start making payments remotely!
        </Text>
      </View>

      <View style={styles.warningBox}>
        <Text style={styles.warningBoxTitle}>⚠️ Security Notice:</Text>
        <Text style={styles.warningBoxText}>
          Only share connection strings with trusted devices. 
          Each connection has different permissions - choose wisely!
        </Text>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  contentContainer: {
    padding: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#333',
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
    marginBottom: 30,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 15,
  },
  statusContainer: {
    backgroundColor: 'white',
    padding: 20,
    borderRadius: 12,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  statusLabel: {
    fontSize: 16,
    color: '#666',
    flex: 1,
  },
  statusValue: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
  },
  statusIndicator: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusText: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 12,
  },
  methodsList: {
    marginTop: 10,
    paddingLeft: 10,
  },
  methodItem: {
    fontSize: 14,
    color: '#666',
    marginBottom: 2,
  },
  controlsContainer: {
    backgroundColor: 'white',
    padding: 20,
    borderRadius: 12,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  button: {
    padding: 15,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 10,
  },
  primaryButton: {
    backgroundColor: '#2196F3',
  },
  secondaryButton: {
    backgroundColor: 'transparent',
    borderWidth: 2,
    borderColor: '#2196F3',
  },
  buttonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
  secondaryButtonText: {
    color: '#2196F3',
    fontSize: 16,
    fontWeight: 'bold',
  },
  connectionContainer: {
    backgroundColor: 'white',
    padding: 20,
    borderRadius: 12,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  qrContainer: {
    alignItems: 'center',
    marginBottom: 20,
    padding: 20,
    backgroundColor: 'white',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#eee',
  },
  infoRow: {
    marginBottom: 15,
  },
  infoLabel: {
    fontSize: 14,
    color: '#666',
    marginBottom: 5,
  },
  infoValue: {
    fontSize: 12,
    color: '#333',
    fontFamily: 'monospace',
    backgroundColor: '#f5f5f5',
    padding: 8,
    borderRadius: 4,
  },
  permissionsList: {
    paddingLeft: 10,
  },
  permissionItem: {
    fontSize: 14,
    color: '#666',
    marginBottom: 2,
  },
  copyButton: {
    backgroundColor: '#4CAF50',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 10,
  },
  copyButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
  infoBox: {
    backgroundColor: '#E3F2FD',
    padding: 15,
    borderRadius: 8,
    marginBottom: 15,
    borderLeftWidth: 4,
    borderLeftColor: '#2196F3',
  },
  infoBoxTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#1976D2',
    marginBottom: 8,
  },
  infoBoxText: {
    fontSize: 14,
    color: '#1976D2',
    lineHeight: 20,
  },
  warningBox: {
    backgroundColor: '#FFF3E0',
    padding: 15,
    borderRadius: 8,
    marginBottom: 20,
    borderLeftWidth: 4,
    borderLeftColor: '#FF9800',
  },
  warningBoxTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#F57C00',
    marginBottom: 8,
  },
  warningBoxText: {
    fontSize: 14,
    color: '#F57C00',
    lineHeight: 20,
  },
});

export default NWCWalletScreen; 