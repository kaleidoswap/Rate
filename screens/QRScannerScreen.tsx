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
  StatusBar,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSelector } from 'react-redux';
import { protocolManager } from '../services/protocols';
import { classifyWithdrawDestination } from '../utils/account-routing';
import { theme } from '../theme';
import type { RootState } from '../store';
import LottieView from 'lottie-react-native';

const { width, height } = Dimensions.get('window');

interface Props {
  navigation: any;
  route?: any;
}

export default function QRScannerScreen({ navigation, route }: Props) {
  // Contact-capture mode hands the raw scanned string back to the requesting
  // screen instead of decoding it as a payment (used by the Contacts screen).
  const captureMode: 'payment' | 'contact' = route?.params?.mode === 'contact' ? 'contact' : 'payment';
  const returnScreen: string = route?.params?.returnScreen || 'Contacts';
  // Prefill amounts in the user's chosen entry unit so Send interprets them
  // correctly (Send reads a BTC amount as sats when bitcoinUnit === 'sats').
  const bitcoinUnit = useSelector((s: RootState) => s.settings.bitcoinUnit);
  const btcToEntryUnit = (btc: number): string =>
    bitcoinUnit === 'sats' ? String(Math.round(btc * 1e8)) : btc.toFixed(8);
  const [processing, setProcessing] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [flashEnabled, setFlashEnabled] = useState(false);
  const [scanSuccess, setScanSuccess] = useState<boolean | null>(null);

  const scanLineAnim = useRef(new Animated.Value(0)).current;
  const successAnim = useRef<LottieView>(null);
  const errorAnim = useRef<LottieView>(null);

  const rgbAdapter = protocolManager.getAdapterIfAvailable('RGB');

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

    if (!scanned && !processing) {
      startScanAnimation();
    } else {
      scanLineAnim.stopAnimation();
    }
  }, [scanned, processing]);

  const handleBarCodeScanned = async ({ data }: { data: string }) => {
    if (scanned || processing) return;

    setScanned(true);
    setProcessing(true);
    scanLineAnim.stopAnimation();

    // NWC connection string: route to the Connect-a-wallet flow regardless of
    // the scanner mode (it's neither a payment nor a contact).
    if (data.trim().toLowerCase().startsWith('nostr+walletconnect://')) {
      setProcessing(false);
      setScanSuccess(true);
      successAnim.current?.play();
      setTimeout(() => {
        navigation.navigate('NWCConnect', { scanned: data.trim() });
      }, 700);
      return;
    }

    // Contact-capture mode: don't decode as a payment — return the raw string
    // to the requesting screen, which classifies it (npub / NIP-05 / LN addr…).
    if (captureMode === 'contact') {
      setProcessing(false);
      setScanSuccess(true);
      successAnim.current?.play();
      setTimeout(() => {
        navigation.navigate(returnScreen, { scannedContact: data.trim() });
      }, 700);
      return;
    }

    // Haptic feedback

    try {
      const paymentData = await processScannedData(data);
      setProcessing(false);
      setScanSuccess(true);
      successAnim.current?.play();

      // Always go directly to Send screen - no PaymentConfirmation
      setTimeout(() => {
        setScanSuccess(null);
        setScanned(false);
        setProcessing(false);

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
      }, 1000); // Slightly longer to show success animation
    } catch (error) {
      console.error('Error processing scanned data:', error);
      setProcessing(false);
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
      }, 1000);
    }
  };

  const UNRECOGNIZED_ERROR =
    'The scanned QR code is not a recognized Bitcoin, Lightning, RGB, Spark, or Arkade format.';

  const processScannedData = async (raw: string) => {
    let data = raw.trim();

    // Unwrap a `lightning:` URI scheme (wraps a BOLT11 invoice or LNURL).
    if (/^lightning:/i.test(data)) {
      data = data.replace(/^lightning:(\/\/)?/i, '').trim();
    }

    const lower = data.toLowerCase();

    // BIP21 / BIP321 unified Bitcoin URI — may bundle a Lightning invoice.
    if (lower.startsWith('bitcoin:')) {
      return await handleBitcoinURI(data);
    }

    // Use the shared destination classifier so the scanner recognizes the same
    // formats the Send screen does (Lightning, RGB, Spark, Arkade, LNURL…).
    const kind = classifyWithdrawDestination(data);
    switch (kind) {
      case 'lightning':
        // Decode here so we can prefill amount; lowercase for case-insensitive
        // (QR-uppercased) invoices.
        return await handleLightningInvoice(lower);
      case 'rgb':
        return await handleRGBInvoice(data);
      case 'lnurl-pay':
      case 'lightning-address':
        return handlePassthroughAddress(data, 'lightning-address');
      case 'spark':
        return handlePassthroughAddress(data, 'spark');
      case 'arkade':
        return handlePassthroughAddress(data, 'arkade');
      case 'bitcoin':
        return handleBitcoinAddress(data);
      default:
        // classifyWithdrawDestination only covers bech32 BTC addresses; fall
        // back to the broader validator for legacy/testnet base58 addresses.
        if (isValidBitcoinAddress(data)) {
          return handleBitcoinAddress(data);
        }
        throw new Error(UNRECOGNIZED_ERROR);
    }
  };

  // Spark / Arkade / Lightning-address destinations need no client-side
  // decoding — hand the raw string to Send, which re-classifies and routes it.
  const handlePassthroughAddress = (
    address: string,
    type: 'spark' | 'arkade' | 'lightning-address',
  ) => ({
    type,
    address,
    amount: undefined as string | undefined,
    selectedAsset: {
      asset_id: 'BTC',
      ticker: 'BTC',
      name: 'Bitcoin',
      isRGB: false,
    },
  });

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

  const handleBitcoinURI = async (uri: string) => {
    // bitcoin:<address>?<query> — per BIP21/BIP321 the on-chain address may be
    // empty and a Lightning invoice (and other instructions) can ride in the
    // query string.
    const body = uri.slice(uri.indexOf(':') + 1);
    const qIndex = body.indexOf('?');
    let address = (qIndex === -1 ? body : body.slice(0, qIndex)).trim();
    const queryString = qIndex === -1 ? '' : body.slice(qIndex + 1);

    // Query keys are case-insensitive (QR codes are frequently all-uppercase).
    const rawParams = new URLSearchParams(queryString);
    const params = new Map<string, string>();
    rawParams.forEach((value, key) => params.set(key.toLowerCase(), value));

    // BIP21 default → Lightning: when an invoice is bundled, pay over LN.
    const lightningParam = params.get('lightning');
    if (lightningParam) {
      try {
        return await handleLightningInvoice(lightningParam.toLowerCase());
      } catch (error) {
        // A malformed/unusable bundled invoice shouldn't block the on-chain
        // fallback below.
        console.warn('Bundled Lightning invoice unusable, falling back to on-chain:', error);
      }
    }

    // Bech32 addresses may be uppercased in QR codes; normalize them. Legacy
    // base58 addresses are case-sensitive and must be left untouched.
    if (/^(bc1|tb1|bcrt1)/i.test(address)) {
      address = address.toLowerCase();
    }

    if (address && isValidBitcoinAddress(address)) {
      const amountParam = params.get('amount');
      const amount = amountParam ? parseFloat(amountParam) : undefined;
      return {
        type: 'bip21' as const,
        address,
        amount: amount && !isNaN(amount) ? btcToEntryUnit(amount) : undefined,
        label: params.get('label'),
        message: params.get('message'),
        selectedAsset: {
          asset_id: 'BTC',
          ticker: 'BTC',
          name: 'Bitcoin',
          isRGB: false,
        },
      };
    }

    throw new Error(UNRECOGNIZED_ERROR);
  };

  const handleRGBInvoice = async (invoice: string) => {
    // Decoding an RGB invoice requires the RGB/NWC node — don't call it offline.
    if (!rgbAdapter?.isConnected()) {
      throw new Error('RGB node not connected. Please connect it in Settings to scan RGB invoices.');
    }
    // Decode RGB invoice
    const decodedInvoice = await rgbAdapter.decodeRgbInvoice!({ invoice });

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
    // Decoding goes through the RGB/NWC node — don't call it offline.
    if (!rgbAdapter?.isConnected()) {
      throw new Error('RGB node not connected. Please connect it in Settings to scan invoices.');
    }
    // Decode Lightning invoice
    const decodedInvoice = await rgbAdapter.decodeInvoice(invoice);

    const amountBTC = ((decodedInvoice as any).amt_msat ?? decodedInvoice.amountMsat ?? 0) / 100000000000; // Convert msat to BTC
    const hasRGBAsset = decodedInvoice.asset_id && decodedInvoice.asset_amount;

    let amount: string | undefined = undefined;
    if (hasRGBAsset) {
      amount = decodedInvoice.asset_amount?.toString();
    } else if (((decodedInvoice as any).amt_msat ?? decodedInvoice.amountMsat ?? 0) > 0) {
      amount = btcToEntryUnit(amountBTC);
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

  const renderScanOverlay = () => (
    <View style={styles.overlayContainer}>
      {/* Darkened Backgrounds */}
      <View style={styles.overlayTop} />
      <View style={styles.overlayCenter}>
        <View style={styles.overlaySide} />
        <View style={styles.scanWindow}>
          <View style={[styles.corner, styles.topLeft]} />
          <View style={[styles.corner, styles.topRight]} />
          <View style={[styles.corner, styles.bottomLeft]} />
          <View style={[styles.corner, styles.bottomRight]} />

          {!processing && !scanSuccess && (
            <Animated.View
              style={[
                styles.scanLine,
                {
                  transform: [{
                    translateY: scanLineAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0, 260],
                    }),
                  }],
                },
              ]}
            />
          )}
        </View>
        <View style={styles.overlaySide} />
      </View>
      <View style={styles.overlayBottom} />
    </View>
  );

  const renderFeedback = () => {
    if (processing) {
      return (
        <View style={styles.feedbackContainer}>
          <View style={styles.processingBadge}>
            <ActivityIndicator color="white" size="small" />
            <Text style={styles.processingText}>Decoding...</Text>
          </View>
        </View>
      );
    }

    if (scanSuccess !== null) {
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
    }

    return null;
  };

  if (!permission) {
    return (
      <View style={styles.container}>
        <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />
        <SafeAreaView style={styles.centerContent}>
          <ActivityIndicator size="large" color={theme.colors.primary[500]} />
        </SafeAreaView>
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.container}>
        <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />
        <SafeAreaView style={styles.centerContent}>
          <Text style={styles.permissionText}>
            Camera permission is required to scan QR codes
          </Text>
          <TouchableOpacity style={styles.permissionButton} onPress={requestPermission}>
            <Text style={styles.permissionButtonText}>Grant Permission</Text>
          </TouchableOpacity>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />

      <View style={styles.cameraContainer}>
        <CameraView
          style={styles.camera}
          facing="back"
          barcodeScannerSettings={{
            barcodeTypes: ["qr", "code128", "code39", "aztec", "datamatrix", "ean13", "ean8", "pdf417"],
          }}
          onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
          enableTorch={flashEnabled}
        />

        {renderScanOverlay()}
        {renderFeedback()}

        <View style={styles.bottomInstructionContainer}>
          <Text style={styles.instructionText}>
            Align QR code within the frame
          </Text>
          <Text style={styles.subInstructionText}>
            {captureMode === 'contact'
              ? 'npub • NIP-05 • Lightning address • node pubkey'
              : 'Bitcoin • Lightning • RGB • Spark • Arkade'}
          </Text>
        </View>
      </View>

      {/* Header Controls */}
      <SafeAreaView style={styles.headerSafeArea} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.iconButton}
            onPress={() => navigation.goBack()}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Ionicons name="close" size={24} color="white" />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.iconButton}
            onPress={toggleFlash}
          >
            <Ionicons
              name={flashEnabled ? "flash" : "flash-off"}
              size={24}
              color={flashEnabled ? "#FFD700" : "white"}
            />
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </View>
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
  cameraContainer: {
    flex: 1,
  },
  camera: {
    flex: 1,
  },

  // Overlay Mask
  overlayContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  overlayTop: {
    flex: 1,
    width: '100%',
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  overlayCenter: {
    flexDirection: 'row',
    height: 280,
  },
  overlaySide: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  overlayBottom: {
    flex: 1,
    width: '100%',
    backgroundColor: 'rgba(0,0,0,0.6)',
  },

  scanWindow: {
    width: 280,
    height: 280,
    backgroundColor: 'transparent',
    position: 'relative',
  },

  corner: {
    position: 'absolute',
    width: 40,
    height: 40,
    borderColor: theme.colors.primary[400],
    borderWidth: 4,
    borderRadius: 4,
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

  scanLine: {
    height: 2,
    width: '100%',
    backgroundColor: theme.colors.primary[500],
    position: 'absolute',
    top: 0,
    shadowColor: theme.colors.primary[500],
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 10,
  },

  // Feedback & Processing
  feedbackContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 20,
  },
  feedbackAnimation: {
    width: 200,
    height: 200,
  },
  processingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(30, 41, 59, 0.9)',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 30,
    gap: 12,
  },
  processingText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },

  // Header & Controls
  headerSafeArea: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 30,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    // Guarantee clearance from the status bar / sheet grabber so the close
    // button is always reachable even when the top safe-area inset is 0.
    paddingTop: 16,
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.3)',
    justifyContent: 'center',
    alignItems: 'center',
  },

  bottomInstructionContainer: {
    position: 'absolute',
    bottom: 50,
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingHorizontal: 20,
    zIndex: 20,
  },
  instructionText: {
    fontSize: 16,
    color: 'white',
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 4,
    textShadowColor: 'rgba(0,0,0,0.75)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  subInstructionText: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.8)',
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.75)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },

  // Permissions
  permissionText: {
    fontSize: 16,
    color: 'white',
    textAlign: 'center',
    marginBottom: 20,
  },
  permissionButton: {
    backgroundColor: theme.colors.primary[600],
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
  },
  permissionButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
});