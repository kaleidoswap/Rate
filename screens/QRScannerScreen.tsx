import { useFocusEffect } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import { isPayable } from '../services/kaleidoPay';
import { rgbInvoiceWallet } from '../services/kaleidoPay/connect';
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
  Clipboard,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions, scanFromURLAsync } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useAppSelector } from '../store/hooks';
import { invoiceExpiry } from '../components/payments/InvoiceExpiry';
import { protocolManager } from '../services/protocols';
import { classifyWithdrawDestination } from '../utils/account-routing';
import { detectCrossChainAddress } from '../utils/crosschain';
import { unwrapCrossChainUri } from '../utils/crosschain-send';
import { decodeBolt11 } from '../utils/decodeInvoice';
import { theme } from '../theme';
import type { RootState } from '../store';

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
  const bitcoinUnit = useAppSelector((s: RootState) => s.settings.bitcoinUnit);
  const btcToEntryUnit = (btc: number): string =>
    bitcoinUnit === 'sats' ? String(Math.round(btc * 1e8)) : btc.toFixed(8);
  const [processing, setProcessing] = useState(false);
  const [scanError, setScanError] = useState('');
  const scanLock = useRef(false);
  const entryAction = useRef(false);
  const scanRevision = useRef(0);
  useFocusEffect(React.useCallback(() => {
    scanLock.current = false; entryAction.current = false; setScanned(false); setProcessing(false); setScanError('');
    return () => { scanRevision.current++; scanLock.current = true; };
  }, []));
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [flashEnabled, setFlashEnabled] = useState(false);

  const scanLineAnim = useRef(new Animated.Value(0)).current;

  const rgbAdapter = protocolManager.getAdapterIfAvailable('RGB_LN');

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
    return () => scanLineAnim.stopAnimation();
  }, [scanned, processing]);

  const handleBarCodeScanned = async ({ data }: { data: string }) => {
    if (scanLock.current) return;
    scanLock.current = true;
    const current = scanRevision.current;
    setScanned(true); setProcessing(true); setScanError('');
    try {
      data = data.trim();
      const expiresAt = invoiceExpiry(data.replace(/^lightning:(\/\/)?/i, ''));
      if (expiresAt !== null && expiresAt <= Date.now()) throw new Error('This invoice has expired. Please request a new one.');
      if (!data) throw new Error('Nothing to read. Paste a payment request or choose another image.');
      if (data.toLowerCase().startsWith('nostr+walletconnect://')) {
        navigation.navigate('NWCConnect', { scanned: data }); return;
      }
      if (captureMode === 'contact') {
        navigation.navigate(returnScreen, { scannedContact: data }); return;
      }
      // Anything payable opens Send as-is: it decodes the code and offers every way to pay it.
      if (isPayable(data)) {
        navigation.navigate('Send', { prefilledAddress: data }); return;
      }
      // An EVM or Solana address: Send offers USDC/USDT from Spark to that chain.
      const crossChain = detectCrossChainAddress(unwrapCrossChainUri(data));
      if (crossChain) {
        navigation.navigate('Send', { prefilledAddress: crossChain.normalized }); return;
      }
      const paymentData = await processScannedData(data);
      if (current !== scanRevision.current) return;
      navigation.navigate('Send', {
        selectedAsset: paymentData.selectedAsset,
        prefilledAddress: ('address' in paymentData ? paymentData.address : paymentData.invoice) || '',
        prefilledAmount: 'amount' in paymentData ? paymentData.amount : undefined,
        label: 'label' in paymentData ? paymentData.label : undefined,
        message: 'message' in paymentData ? paymentData.message : undefined,
        decodedInvoice: 'decodedInvoice' in paymentData ? paymentData.decodedInvoice : undefined,
        decodedRGBInvoice: 'decodedRGBInvoice' in paymentData ? paymentData.decodedRGBInvoice : undefined,
        isLightning: paymentData.type === 'lightning', fromQRScanner: true, paymentType: paymentData.type,
      });
    } catch (error) {
      if (current === scanRevision.current) setScanError(getErrorMessage(error));
      // Keep scanning paused until the user chooses to retry.
    } finally { if (current === scanRevision.current) { entryAction.current = false; setProcessing(false); } }
  };

  const pasteRequest = async () => {
    if (entryAction.current || (scanLock.current && !scanError)) return;
    entryAction.current = true;
    const current = scanRevision.current;
    scanLock.current = true; setProcessing(true); setScanned(true); setScanError('');
    try {
      const data = await Clipboard.getString();
      if (current !== scanRevision.current) return;
      scanLock.current = false; await handleBarCodeScanned({ data });
    } catch { if (current === scanRevision.current) setScanError('Could not read the clipboard. Try again.'); }
    finally { if (current === scanRevision.current) { entryAction.current = false; setProcessing(false); } }
  };
  const chooseImage = async () => {
    if (entryAction.current || (scanLock.current && !scanError)) return;
    entryAction.current = true;
    const current = scanRevision.current;
    scanLock.current = true; setScanned(true); setProcessing(true); setScanError('');
    try {
      const image = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
      if (current !== scanRevision.current) return;
      if (image.canceled) { resetScanner(); return; }
      const codes = await scanFromURLAsync(image.assets[0].uri, ['qr']);
      if (current !== scanRevision.current) return;
      const values = [...new Set(codes.map(qr => qr.data).filter(Boolean))];
      if (!values.length) throw new Error('No QR code found. Choose a clearer image or paste the request.');
      if (values.length > 1) throw new Error('More than one QR code found. Crop the image to the code you want to use.');
      scanLock.current = false;
      await handleBarCodeScanned({ data: values[0] });
    } catch (error) { if (current === scanRevision.current) setScanError(error instanceof Error ? error.message : 'Could not read this image.'); }
    finally { if (current === scanRevision.current) { entryAction.current = false; setProcessing(false); } }
  };

  const UNRECOGNIZED_ERROR =
    'The scanned QR code is not a recognized Bitcoin, Lightning, RGB, Spark, Arkade, EVM or Solana format.';

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
    if (/not connected|Nothing to read/i.test(error?.message ?? '')) return error.message;
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

    // A universal BTC request may contain only a native rail, with no Bitcoin
    // path or Lightning invoice. Do not reinterpret token requests as BTC.
    if (!params.has('assetid')) {
      for (const [key, kind] of [['spark', 'spark'], ['ark', 'arkade']] as const) {
        const nativeAddress = params.get(key);
        if (nativeAddress && classifyWithdrawDestination(nativeAddress) === kind) {
          const amountBtc = Number(params.get('amount'));
          return {
            ...handlePassthroughAddress(nativeAddress, kind),
            amount: Number.isFinite(amountBtc) && amountBtc > 0 ? btcToEntryUnit(amountBtc) : undefined,
          };
        }
      }
    }
    const bundledExpiry = invoiceExpiry(params.get('lightning') ?? '');
    if (bundledExpiry !== null && bundledExpiry <= Date.now()) throw new Error('This invoice has expired. Please request a new one.');
    throw new Error(UNRECOGNIZED_ERROR);
  };

  const handleRGBInvoice = async (invoice: string) => {
    // Decoding an RGB invoice needs an RGB wallet: the node, or RGB on this phone.
    const rgbWallet = rgbInvoiceWallet();
    if (!rgbWallet?.decodeRgbInvoice) {
      throw new Error('Turn on RGB in Settings, or connect your RGB node, to pay RGB invoices.');
    }
    const decodedInvoice = (await rgbWallet.decodeRgbInvoice({ invoice })) as {
      assignment?: { type?: string; value?: number | string };
      asset_id?: string;
    };

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
    const expiresAt = invoiceExpiry(invoice);
    if (expiresAt !== null && expiresAt <= Date.now()) throw new Error('This invoice has expired. Please request a new one.');
    // Decode the BOLT11 locally first — this is node-independent, so a
    // Lightning invoice scans on any wallet (e.g. Spark-only), not just when
    // the RGB node is connected (same approach as the Send screen).
    const local = decodeBolt11(invoice);
    const decodedInvoice: any = {
      amt_msat: local.amountSats ? local.amountSats * 1000 : 0,
      description: local.description || '',
      expiry_sec: local.expirySec || 0,
      asset_id: undefined,
      asset_amount: undefined,
    };

    // Enrich with RGB-over-LN details (asset_id / asset_amount) only when the
    // RGB node is available — best-effort, never blocks the scan.
    if (rgbAdapter?.isConnected()) {
      try {
        const r: any = await rgbAdapter.decodeInvoice(invoice);
        decodedInvoice.amt_msat = r.amt_msat ?? r.amountMsat ?? decodedInvoice.amt_msat;
        decodedInvoice.asset_id = r.asset_id ?? decodedInvoice.asset_id;
        decodedInvoice.asset_amount = r.asset_amount ?? decodedInvoice.asset_amount;
        decodedInvoice.description = r.description || decodedInvoice.description;
      } catch { /* keep the local decode */ }
    }

    const amountBTC = (decodedInvoice.amt_msat ?? 0) / 100000000000; // Convert msat to BTC
    const hasRGBAsset = decodedInvoice.asset_id && decodedInvoice.asset_amount;

    let amount: string | undefined = undefined;
    if (hasRGBAsset) {
      amount = decodedInvoice.asset_amount?.toString();
    } else if ((decodedInvoice.amt_msat ?? 0) > 0) {
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
    scanLock.current = false; entryAction.current = false; setScanned(false); setProcessing(false); setScanError('');
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

          {!processing && !scanned && (
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

    return null;
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />
      <SafeAreaView style={{ flex: 1 }}>
        <View style={styles.header}>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Close scanner" style={styles.iconButton} onPress={() => navigation.goBack()}><Ionicons name="close" size={24} color={theme.colors.text.primary} /></TouchableOpacity>
          <Text style={{ color: theme.colors.text.primary, fontSize: theme.typography.fontSize.lg, fontWeight: '600' }}>{captureMode === 'contact' ? 'Scan contact' : 'Scan to pay'}</Text>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel={flashEnabled ? 'Turn torch off' : 'Turn torch on'} disabled={!permission?.granted} style={styles.iconButton} onPress={toggleFlash}><Ionicons name={flashEnabled ? 'flash' : 'flash-off'} size={24} color={theme.colors.text.primary} /></TouchableOpacity>
        </View>
        <View style={{ flex: 1, overflow: 'hidden' }}>
          {permission?.granted ? <>
            <CameraView style={StyleSheet.absoluteFillObject} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={scanned ? undefined : handleBarCodeScanned} enableTorch={flashEnabled} />
            {renderScanOverlay()}{renderFeedback()}
          </> : <View style={styles.centerContent}>
            <Ionicons name="scan-outline" size={64} color={theme.colors.primary[500]} />
            <Text style={styles.permissionText}>Scan a payment QR code</Text>
            <Text style={{ color: theme.colors.text.secondary, textAlign: 'center', marginBottom: theme.spacing[5] }}>Allow camera access, or use a saved image or copied request below.</Text>
            <TouchableOpacity accessibilityRole="button" style={styles.permissionButton} onPress={() => { if (permission?.canAskAgain === false) void Linking.openSettings().catch(() => setScanError('Open your device settings to enable the camera.')); else void requestPermission().catch(() => setScanError('Camera access could not be requested. Try again.')); }}>
              <Text style={styles.permissionButtonText}>{permission?.canAskAgain === false ? 'Open settings' : 'Enable camera'}</Text>
            </TouchableOpacity>
          </View>}
        </View>
        <View style={{ padding: theme.spacing[5], gap: theme.spacing[4], backgroundColor: theme.colors.background.primary }}>
          {!!scanError && <View style={{ gap: theme.spacing[3] }}><Text accessibilityRole="alert" style={{ color: theme.colors.warning[500] }}>{scanError}</Text><TouchableOpacity accessibilityRole="button" onPress={resetScanner}><Text style={{ color: theme.colors.primary[500], paddingVertical: theme.spacing[3] }}>Scan again</Text></TouchableOpacity></View>}
          <View style={{ flexDirection: 'row', gap: theme.spacing[3] }}>
            <TouchableOpacity accessibilityRole="button" disabled={processing} onPress={() => void pasteRequest()} style={styles.entryAction}><Ionicons name="clipboard-outline" size={24} color={theme.colors.text.primary} /><Text style={styles.entryLabel}>Paste</Text></TouchableOpacity>
            <TouchableOpacity accessibilityRole="button" disabled={processing} onPress={() => void chooseImage()} style={styles.entryAction}><Ionicons name="image-outline" size={24} color={theme.colors.text.primary} /><Text style={styles.entryLabel}>Choose image</Text></TouchableOpacity>
          </View>
          <Text style={{ color: theme.colors.text.secondary, textAlign: 'center' }}>{processing ? 'Reading request…' : captureMode === 'contact' ? 'Scan a contact code or paste their address.' : 'Scan an invoice, address or multi-method request. You’ll review the amount, account and fees before paying.'}</Text>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  entryAction: { flex: 1, alignItems: 'center', gap: theme.spacing[2], padding: theme.spacing[4], borderRadius: theme.borderRadius.xl, backgroundColor: theme.colors.surface.primary },
  entryLabel: { color: theme.colors.text.primary, fontSize: theme.typography.fontSize.base },
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