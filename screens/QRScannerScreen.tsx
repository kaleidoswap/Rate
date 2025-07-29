// screens/QRScannerScreen.tsx
import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Dimensions,
  Animated,
  Easing,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import RGBApiService from '../services/RGBApiService';
import { theme } from '../theme';
import LottieView from 'lottie-react-native';

const { width, height } = Dimensions.get('window');

interface Props {
  navigation: any;
}

export default function QRScannerScreen({ navigation }: Props) {
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [flashEnabled, setFlashEnabled] = useState(false);
  const [scanSuccess, setScanSuccess] = useState<boolean | null>(null);
  
  const scanLineAnim = useRef(new Animated.Value(0)).current;
  const successAnim = useRef<LottieView>(null);
  const errorAnim = useRef<LottieView>(null);
  
  const apiService = RGBApiService.getInstance();

  useEffect(() => {
    if (!permission) {
      requestPermission();
    }
  }, [permission, requestPermission]);

  useEffect(() => {
    // Start scanning animation
    const startScanAnimation = () => {
      scanLineAnim.setValue(0);
      Animated.loop(
        Animated.sequence([
          Animated.timing(scanLineAnim, {
            toValue: 1,
            duration: 2500,
            easing: Easing.bezier(0.4, 0.0, 0.6, 1.0),
            useNativeDriver: true,
          }),
        ])
      ).start();
    };

    if (!scanned) {
      startScanAnimation();
    } else {
      scanLineAnim.stopAnimation();
    }
  }, [scanned]);

  const handleBarCodeScanned = async ({ data }: { data: string }) => {
    if (scanned) return;
    
    setScanned(true);
    scanLineAnim.stopAnimation();
    
    try {
      const paymentData = await processScannedData(data);
      setScanSuccess(true);
      successAnim.current?.play();
      
      // Always go directly to Send screen - no PaymentConfirmation
      setTimeout(() => {
        setScanSuccess(null);
        setScanned(false);
        
        navigation.navigate('Send', {
          selectedAsset: paymentData.selectedAsset,
          prefilledAddress: ('address' in paymentData ? paymentData.address : paymentData.invoice) || '',
          prefilledAmount: 'amount' in paymentData ? paymentData.amount : undefined,
          label: 'label' in paymentData ? paymentData.label : undefined,
          message: 'message' in paymentData ? paymentData.message : undefined,
          decodedInvoice: 'decodedInvoice' in paymentData ? paymentData.decodedInvoice : undefined,
          decodedRGBInvoice: 'decodedRGBInvoice' in paymentData ? paymentData.decodedRGBInvoice : undefined,
          isLightning: paymentData.type === 'lightning',
          fromQRScanner: true,
          paymentType: paymentData.type,
        });
      }, 600); // Faster transition
    } catch (error) {
      console.error('Error processing scanned data:', error);
      setScanSuccess(false);
      errorAnim.current?.play();
      
      setTimeout(() => {
        setScanSuccess(null);
        setScanned(false);
        
        const errorMessage = getErrorMessage(error);
        Alert.alert('Scan Error', errorMessage, [
          { 
            text: 'Try Again', 
            onPress: () => resetScanner(),
            style: 'default'
          },
          { 
            text: 'Cancel', 
            onPress: () => navigation.goBack(),
            style: 'cancel'
          }
        ]);
      }, 600);
    }
  };

  const parseBIP21URI = (uri: string): { address: string; amount?: number; label?: string; message?: string } | null => {
    try {
      // Handle bitcoin: URI format
      if (!uri.startsWith('bitcoin:')) {
        return null;
      }

      const withoutPrefix = uri.substring(8); // Remove 'bitcoin:'
      const [address, queryString] = withoutPrefix.split('?');
      
      if (!address || !isValidBitcoinAddress(address)) {
        return null;
      }

      const result: any = { address };

      if (queryString) {
        const params = new URLSearchParams(queryString);
        if (params.get('amount')) {
          result.amount = parseFloat(params.get('amount')!);
        }
        if (params.get('label')) {
          result.label = params.get('label');
        }
        if (params.get('message')) {
          result.message = params.get('message');
        }
      }

      return result;
    } catch (error) {
      console.error('Error parsing BIP21 URI:', error);
      return null;
    }
  };

  const processScannedData = async (data: string) => {
    // Determine what type of data was scanned and return payment data
    if (data.startsWith('rgb:')) {
      // RGB Invoice
      return await handleRGBInvoice(data);
    } else if (data.startsWith('lnbc') || data.startsWith('lnbcrt') || data.startsWith('lntb')) {
      // Lightning Network Invoice
      return await handleLightningInvoice(data);
    } else if (data.startsWith('bitcoin:')) {
      // BIP21 URI
      return await handleBIP21URI(data);
    } else if (isValidBitcoinAddress(data)) {
      // Plain Bitcoin Address
      return handleBitcoinAddress(data);
    } else {
      // Unknown format - throw error to be handled by caller
      throw new Error('The scanned QR code is not a recognized Bitcoin, Lightning, or RGB format.');
    }
  };

  // Better error message handling
  const getErrorMessage = (error: any): string => {
    if (error?.message?.includes('decode')) {
      return 'Invalid QR code format. Please scan a valid Bitcoin address, Lightning invoice, or RGB invoice.';
    }
    if (error?.message?.includes('network')) {
      return 'Network error. Please check your connection and try again.';
    }
    if (error?.message?.includes('expired')) {
      return 'This invoice has expired. Please request a new one.';
    }
    if (error?.message?.includes('recognized')) {
      return error.message;
    }
    return 'Unable to process this QR code. Please verify it\'s a valid payment code and try again.';
  };

  const handleBIP21URI = async (uri: string) => {
    const parsed = parseBIP21URI(uri);
    if (!parsed) {
      throw new Error('Invalid BIP21 URI format');
    }

    const { address, amount, label, message } = parsed;
    
    const paymentData = {
      type: 'bip21' as const,
      address,
      amount: amount ? amount.toFixed(8) : undefined,
      label,
      message,
      selectedAsset: {
        asset_id: 'BTC',
        ticker: 'BTC',
        name: 'Bitcoin',
        isRGB: false,
      },
    };

    return paymentData;
  };

  const handleRGBInvoice = async (invoice: string) => {
    // Decode RGB invoice
    const decodedInvoice = await apiService.decodeRGBInvoice({ invoice });
    
    // Extract amount from assignment if it's a fungible assignment
    let invoiceAmount: string | undefined = undefined;
    if (decodedInvoice.assignment && decodedInvoice.assignment.type === 'Fungible' && decodedInvoice.assignment.value) {
      invoiceAmount = decodedInvoice.assignment.value.toString();
    }
    
    const paymentData = {
      type: 'rgb' as const,
      invoice,
      amount: invoiceAmount,
      decodedRGBInvoice: decodedInvoice,
      selectedAsset: decodedInvoice.asset_id ? {
        asset_id: decodedInvoice.asset_id,
        ticker: 'RGB',
        name: 'RGB Asset',
        isRGB: true,
      } : {
        asset_id: 'BTC',
        ticker: 'BTC',
        name: 'Bitcoin',
        isRGB: false,
      },
    };

    return paymentData;
  };

  const handleLightningInvoice = async (invoice: string) => {
    // Decode Lightning invoice
    const decodedInvoice = await apiService.decodeLnInvoice({ invoice });
    
    const amountBTC = decodedInvoice.amt_msat / 100000000000; // Convert msat to BTC
    const hasRGBAsset = decodedInvoice.asset_id && decodedInvoice.asset_amount;
    
    let amount: string | undefined = undefined;
    if (hasRGBAsset) {
      amount = decodedInvoice.asset_amount?.toString();
    } else if (decodedInvoice.amt_msat > 0) {
      amount = amountBTC.toFixed(8);
    }
    
    const paymentData = {
      type: 'lightning' as const,
      invoice,
      amount,
      decodedInvoice,
      selectedAsset: hasRGBAsset && decodedInvoice.asset_id ? {
        asset_id: decodedInvoice.asset_id,
        ticker: 'RGB',
        name: 'RGB Asset',
        isRGB: true,
      } : {
        asset_id: 'BTC',
        ticker: 'BTC',
        name: 'Bitcoin',
        isRGB: false,
      },
    };

    return paymentData;
  };

  const handleBitcoinAddress = (address: string) => {
    const paymentData = {
      type: 'bitcoin' as const,
      address,
      amount: undefined,
      selectedAsset: {
        asset_id: 'BTC',
        ticker: 'BTC',
        name: 'Bitcoin',
        isRGB: false,
      },
    };

    return paymentData;
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

  const renderScanAnimation = () => (
    <View style={styles.scanArea}>
      <View style={[styles.corner, styles.topLeft]} />
      <View style={[styles.corner, styles.topRight]} />
      <View style={[styles.corner, styles.bottomLeft]} />
      <View style={[styles.corner, styles.bottomRight]} />
      
      <Animated.View
        style={[
          styles.scanLine,
          {
            transform: [{
              translateY: scanLineAnim.interpolate({
                inputRange: [0, 1],
                outputRange: [0, 280],
              }),
            }],
          },
        ]}
      />
    </View>
  );

  const renderFeedbackAnimation = () => {
    if (scanSuccess === null) return null;

    return (
      <View style={styles.feedbackContainer}>
        <LottieView
          ref={scanSuccess ? successAnim : errorAnim}
          source={scanSuccess ? require('../assets/animations/success.json') : require('../assets/animations/error.json')}
          style={styles.feedbackAnimation}
          autoPlay={false}
          loop={false}
        />
      </View>
    );
  };

  const renderScanInstructions = () => (
    <View style={styles.scanInstructions}>
      <View style={styles.instructionItem}>
        <Ionicons name="qr-code" size={24} color="white" />
        <Text style={styles.instructionText}>QR Codes</Text>
      </View>
      <View style={styles.instructionItem}>
        <Ionicons name="flash" size={24} color="#FFD700" />
        <Text style={styles.instructionText}>Lightning</Text>
      </View>
      <View style={styles.instructionItem}>
        <Ionicons name="diamond" size={24} color="#10b981" />
        <Text style={styles.instructionText}>RGB Assets</Text>
      </View>
      <View style={styles.instructionItem}>
        <Ionicons name="logo-bitcoin" size={24} color="#F7931A" />
        <Text style={styles.instructionText}>Bitcoin</Text>
      </View>
    </View>
  );

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
      <LinearGradient
        colors={['rgba(0,0,0,0.8)', 'transparent']}
        style={styles.headerGradient}
      >
        <View style={styles.header}>
          <TouchableOpacity 
            style={styles.headerButton} 
            onPress={() => navigation.goBack()}
          >
            <Ionicons name="arrow-back" size={24} color="white" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Scan QR Code</Text>
          <TouchableOpacity 
            style={styles.headerButton} 
            onPress={toggleFlash}
          >
            <Ionicons 
              name={flashEnabled ? "flash" : "flash-off"} 
              size={24} 
              color="white" 
            />
          </TouchableOpacity>
        </View>
      </LinearGradient>

      <View style={styles.cameraContainer}>
        <CameraView
          style={styles.camera}
          facing="back"
          barcodeScannerSettings={{
            barcodeTypes: ["qr", "code128", "code39", "aztec", "datamatrix", "ean13", "ean8", "pdf417"],
          }}
          onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
          enableTorch={flashEnabled}
          ratio="16:9"
        />
        
        <View style={styles.overlay}>
          {renderScanAnimation()}
          {renderFeedbackAnimation()}
          {renderScanInstructions()}
        </View>

        <LinearGradient
          colors={['transparent', 'rgba(0,0,0,0.8)']}
          style={styles.instructionsGradient}
        >
          <View style={styles.instructions}>
            <Text style={styles.instructionText}>
              Point your camera at a QR code
            </Text>
            <Text style={styles.subInstructionText}>
              Supports Bitcoin addresses, Lightning invoices, and RGB invoices
            </Text>
          </View>
        </LinearGradient>
      </View>

      <View style={styles.bottomControls}>
        {scanned && (
          <TouchableOpacity 
            style={styles.scanAgainButton} 
            onPress={() => setScanned(false)}
          >
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
    width: 280,
    height: 280,
    position: 'relative',
    borderRadius: 24,
    overflow: 'hidden',
  },
  corner: {
    position: 'absolute',
    width: 40,
    height: 40,
    borderColor: '#00ff88',
    borderWidth: 4,
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
  headerGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 1,
    height: 120,
  },
  headerButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scanLine: {
    height: 2,
    width: '100%',
    backgroundColor: theme.colors.primary[500],
    position: 'absolute',
    top: 0,
  },
  feedbackContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.7)',
  },
  feedbackAnimation: {
    width: 150,
    height: 150,
  },
  instructionsGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 160,
  },
  
  scanInstructions: {
    position: 'absolute',
    top: 80,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingHorizontal: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    paddingVertical: 12,
  },
  
  instructionItem: {
    alignItems: 'center',
    gap: 4,
  },
});