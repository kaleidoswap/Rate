// screens/QRScannerScreen.tsx
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import RGBApiService from '../services/RGBApiService';

const { width, height } = Dimensions.get('window');

interface Props {
  navigation: any;
}

export default function QRScannerScreen({ navigation }: Props) {
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [flashEnabled, setFlashEnabled] = useState(false);

  const apiService = RGBApiService.getInstance();

  useEffect(() => {
    if (!permission) {
      requestPermission();
    }
  }, [permission, requestPermission]);

  const handleBarCodeScanned = async ({ data }: { data: string }) => {
    if (scanned) return;
    
    setScanned(true);
    
    try {
      await processScannedData(data);
    } catch (error) {
      console.error('Error processing scanned data:', error);
      Alert.alert('Error', 'Failed to process scanned code');
      setScanned(false);
    }
  };

  const processScannedData = async (data: string) => {
    // Determine what type of data was scanned
    if (data.startsWith('rgb:')) {
      // RGB Invoice
      await handleRGBInvoice(data);
    } else if (data.startsWith('lnbc') || data.startsWith('lnbcrt') || data.startsWith('lntb')) {
      // Lightning Network Invoice
      await handleLightningInvoice(data);
    } else if (isValidBitcoinAddress(data)) {
      // Bitcoin Address
      handleBitcoinAddress(data);
    } else {
      // Unknown format
      Alert.alert(
        'Unknown Format',
        'The scanned QR code is not a recognized Bitcoin, Lightning, or RGB format.',
        [
          { text: 'Scan Again', onPress: () => setScanned(false) },
          { text: 'Cancel', onPress: () => navigation.goBack() }
        ]
      );
    }
  };

  const handleRGBInvoice = async (invoice: string) => {
    try {
      // Decode RGB invoice
      const decodedInvoice = await apiService.decodeRgbInvoice({ invoice });
      
      Alert.alert(
        'RGB Invoice Detected',
        `Asset: ${decodedInvoice.asset_id || 'Any'}\nRecipient: ${decodedInvoice.recipient_id}`,
        [
          {
            text: 'Send Assets',
            onPress: () => {
              navigation.navigate('SendRGB', {
                recipientId: decodedInvoice.recipient_id,
                assetId: decodedInvoice.asset_id,
                amount: decodedInvoice.amount,
              });
            }
          },
          {
            text: 'Cancel',
            onPress: () => navigation.goBack(),
            style: 'cancel'
          }
        ]
      );
    } catch (error) {
      Alert.alert('Error', 'Failed to decode RGB invoice');
      setScanned(false);
    }
  };

  const handleLightningInvoice = async (invoice: string) => {
    try {
      // Decode Lightning invoice
      const decodedInvoice = await apiService.decodeLnInvoice({ invoice });
      
      const amountBTC = decodedInvoice.amt_msat / 100000000000; // Convert msat to BTC
      const hasRGBAsset = decodedInvoice.asset_id && decodedInvoice.asset_amount;
      
      let message = `Amount: ${amountBTC.toFixed(8)} BTC`;
      if (hasRGBAsset) {
        message += `\nRGB Asset: ${decodedInvoice.asset_id}\nAsset Amount: ${decodedInvoice.asset_amount}`;
      }
      message += `\nPayee: ${decodedInvoice.payee_pubkey}`;
      
      Alert.alert(
        'Lightning Invoice Detected',
        message,
        [
          {
            text: 'Pay Invoice',
            onPress: () => {
              navigation.navigate('PayInvoice', {
                invoice,
                decodedInvoice,
              });
            }
          },
          {
            text: 'Cancel',
            onPress: () => navigation.goBack(),
            style: 'cancel'
          }
        ]
      );
    } catch (error) {
      Alert.alert('Error', 'Failed to decode Lightning invoice');
      setScanned(false);
    }
  };

  const handleBitcoinAddress = (address: string) => {
    Alert.alert(
      'Bitcoin Address Detected',
      `Address: ${address}`,
      [
        {
          text: 'Send Bitcoin',
          onPress: () => {
            navigation.navigate('SendBTC', { address });
          }
        },
        {
          text: 'Cancel',
          onPress: () => navigation.goBack(),
          style: 'cancel'
        }
      ]
    );
  };

  const isValidBitcoinAddress = (address: string): boolean => {
    // Basic validation for Bitcoin addresses
    const regexes = [
      /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/, // Legacy (P2PKH/P2SH)
      /^bc1[a-z0-9]{39,59}$/, // Bech32 (P2WPKH/P2WSH)
      /^bc1p[a-z0-9]{58}$/, // Bech32m (P2TR)
      /^[2mn][a-km-zA-HJ-NP-Z1-9]{25,34}$/, // Testnet
      /^tb1[a-z0-9]{39,59}$/, // Testnet Bech32
      /^bcrt1[a-z0-9]{39,59}$/, // Regtest
    ];
    
    return regexes.some(regex => regex.test(address));
  };

  const toggleFlash = () => {
    setFlashEnabled(!flashEnabled);
  };

  const resetScanner = () => {
    setScanned(false);
  };

  if (!permission) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centerContent}>
          <Text style={styles.permissionText}>Requesting camera permission...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centerContent}>
          <Text style={styles.permissionText}>
            Camera permission is required to scan QR codes
          </Text>
          <TouchableOpacity style={styles.permissionButton} onPress={requestPermission}>
            <Text style={styles.permissionButtonText}>Grant Permission</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={24} color="white" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Scan QR Code</Text>
        <TouchableOpacity onPress={toggleFlash}>
          <Ionicons 
            name={flashEnabled ? "flash" : "flash-off"} 
            size={24} 
            color="white" 
          />
        </TouchableOpacity>
      </View>

      <View style={styles.cameraContainer}>
        <CameraView
          style={styles.camera}
          facing="back"
          barcodeScannerSettings={{
            barcodeTypes: ["qr"],
          }}
          onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
          enableTorch={flashEnabled}
        />
        
        {/* Scanner overlay */}
        <View style={styles.overlay}>
          <View style={styles.scanArea}>
            <View style={[styles.corner, styles.topLeft]} />
            <View style={[styles.corner, styles.topRight]} />
            <View style={[styles.corner, styles.bottomLeft]} />
            <View style={[styles.corner, styles.bottomRight]} />
          </View>
        </View>

        {/* Instructions */}
        <View style={styles.instructions}>
          <Text style={styles.instructionText}>
            Point your camera at a QR code
          </Text>
          <Text style={styles.subInstructionText}>
            Supports Bitcoin addresses, Lightning invoices, and RGB invoices
          </Text>
        </View>
      </View>

      {/* Bottom controls */}
      <View style={styles.bottomControls}>
        {scanned && (
          <TouchableOpacity style={styles.scanAgainButton} onPress={resetScanner}>
            <Text style={styles.scanAgainButtonText}>Scan Again</Text>
          </TouchableOpacity>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'black',
  },
  centerContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: 'white',
  },
  cameraContainer: {
    flex: 1,
    position: 'relative',
  },
  camera: {
    flex: 1,
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scanArea: {
    width: 250,
    height: 250,
    position: 'relative',
  },
  corner: {
    position: 'absolute',
    width: 30,
    height: 30,
    borderColor: '#007AFF',
    borderWidth: 3,
  },
  topLeft: {
    top: 0,
    left: 0,
    borderBottomWidth: 0,
    borderRightWidth: 0,
  },
  topRight: {
    top: 0,
    right: 0,
    borderBottomWidth: 0,
    borderLeftWidth: 0,
  },
  bottomLeft: {
    bottom: 0,
    left: 0,
    borderTopWidth: 0,
    borderRightWidth: 0,
  },
  bottomRight: {
    bottom: 0,
    right: 0,
    borderTopWidth: 0,
    borderLeftWidth: 0,
  },
  instructions: {
    position: 'absolute',
    bottom: 100,
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  instructionText: {
    fontSize: 18,
    color: 'white',
    textAlign: 'center',
    marginBottom: 8,
    fontWeight: '600',
  },
  subInstructionText: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.8)',
    textAlign: 'center',
  },
  bottomControls: {
    padding: 20,
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
  },
  scanAgainButton: {
    backgroundColor: '#007AFF',
    paddingVertical: 12,
    paddingHorizontal: 30,
    borderRadius: 25,
  },
  scanAgainButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  permissionText: {
    fontSize: 16,
    color: 'white',
    textAlign: 'center',
    marginBottom: 20,
  },
  permissionButton: {
    backgroundColor: '#007AFF',
    paddingVertical: 15,
    paddingHorizontal: 30,
    borderRadius: 10,
  },
  permissionButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
});