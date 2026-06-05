// screens/SendScreen.tsx
import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  ActivityIndicator,
  Clipboard,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSelector } from 'react-redux';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { RootState } from '../store';
// RGBApiService removed — all operations via protocolManager
import { NetworkIcon } from '../components/NetworkIcon';
import { PressableScale } from '../components/PressableScale';
import { haptic } from '../utils/haptics';
import { protocolManager } from '../services/protocols';
import { useRefreshableProtocolStatus } from '../hooks/useProtocol';
import {
  classifyWithdrawDestination, resolveSendRoutes, resolveActiveSendRoute,
  METHOD_META, type DestinationKind, type ResolvedSendRoute, type RouteOption,
} from '../utils/account-routing';
import { theme } from '../theme';
import { Card, Button, Input, ScreenHeader } from '../components';
import { useAssetIcon } from '../utils';
import { useFormattedBitcoinAmount, parseInputAmount, convertAmountToUnit, useBitcoinConversion } from '../utils/bitcoinUnits';

interface Props {
  navigation: any;
  route: any;
}

type AddressType = 'unknown' | 'bitcoin' | 'lightning' | 'lightning-address' | 'lnurl-pay' | 'rgb' | 'spark' | 'arkade' | 'invalid';

interface RGBAsset {
  asset_id: string;
  ticker: string;
  name: string;
  balance: number;
  precision: number;
}

interface Asset {
  asset_id: string;
  ticker: string;
  name: string;
  isRGB: boolean;
  balance?: number;
  precision?: number;
}

interface DecodedInvoice {
  payment_hash: string;
  amt_msat: number;
  asset_id?: string;
  asset_amount?: number;
  description: string;
  expiry_sec: number;
  payee_pubkey: string;
}

// Define the enums needed for the RGB invoice response
enum AssetSchema {
  Nia = 'Nia',
  Uda = 'Uda',
  Cfa = 'Cfa',
}

enum BitcoinNetwork {
  Mainnet = 'Mainnet',
  Testnet = 'Testnet',
  Signet = 'Signet',
  Regtest = 'Regtest',
}

interface Assignment {
  type: 'Fungible' | 'NonFungible' | 'InflationRight' | 'ReplaceRight' | 'Any';
  value?: number;
}

// Define the base RGB invoice response type to match the service
interface BaseRGBInvoiceResponse {
  recipient_id: string;
  asset_schema: AssetSchema;
  asset_id: string;
  assignment: Assignment;
  network: BitcoinNetwork;
  expiration_timestamp: number;
  transport_endpoints: string[];
}

// Extend it with our additional fields
interface DecodedRGBInvoice extends BaseRGBInvoiceResponse {
  amount: number | null;
}

function SendScreen({ navigation, route }: Props) {
  const walletState = useSelector((state: RootState) => state.wallet);
  const assetsState = useSelector((state: RootState) => state.assets);
  const rgbAssets = (assetsState?.rgbAssets || []) as RGBAsset[];
  const btcBalance = walletState?.btcBalance;
  const bitcoinUnit = useSelector((state: RootState) => state.settings.bitcoinUnit);
  const { formatSatoshisToUSD } = useBitcoinConversion();

  const [selectedAsset, setSelectedAsset] = useState<Asset>({
    asset_id: 'BTC',
    ticker: 'BTC',
    name: 'Bitcoin',
    isRGB: false,
    balance: btcBalance?.vanilla?.spendable || 0,
  });
  const [address, setAddress] = useState('');
  const [amount, setAmount] = useState('');
  const [feeRate, setFeeRate] = useState('normal');
  const [customFee, setCustomFee] = useState(1.0);
  const [loading, setLoading] = useState(false);
  const [isDecodingInvoice, setIsDecodingInvoice] = useState(false);
  const [addressType, setAddressType] = useState<AddressType>('unknown');
  const [decodedInvoice, setDecodedInvoice] = useState<DecodedInvoice | null>(null);
  const [decodedRGBInvoice, setDecodedRGBInvoice] = useState<DecodedRGBInvoice | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [showAssetSelector, setShowAssetSelector] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [paymentStep, setPaymentStep] = useState<'input' | 'review' | 'sending'>('input');
  const [sendRoutes, setSendRoutes] = useState<RouteOption[]>([]);
  const [activeRoute, setActiveRoute] = useState<ResolvedSendRoute | null>(null);

  // All operations via protocolManager
  const getProtocolStatus = useRefreshableProtocolStatus();

  // Fee rate options
  const feeRates = [
    { label: 'Slow', value: 'slow', rate: 1, icon: 'time-outline' },
    { label: 'Normal', value: 'normal', rate: 2, icon: 'flash-outline' },
    { label: 'Fast', value: 'fast', rate: 3, icon: 'rocket-outline' },
    { label: 'Custom', value: 'custom', rate: customFee, icon: 'settings-outline' },
  ];

  // Combine BTC with RGB assets
  const allAssets: Asset[] = [
    { 
      asset_id: 'BTC', 
      ticker: 'BTC', 
      name: 'Bitcoin',
      isRGB: false,
      balance: btcBalance?.vanilla?.spendable || 0,
    },
    ...(Array.isArray(rgbAssets) ? rgbAssets.map((asset: RGBAsset) => ({
      asset_id: asset.asset_id,
      ticker: asset.ticker,
      name: asset.name,
      isRGB: true,
      balance: asset.balance || 0,
      precision: asset.precision,
    })) : [])
  ];

  useEffect(() => {
    // Handle route parameters from QR scanner or other navigation
    if (route.params?.selectedAsset) {
      // If selectedAsset is provided directly, use it
      setSelectedAsset(route.params.selectedAsset);
    } else if (route.params?.assetId) {
      // Legacy support for assetId parameter
      const asset = allAssets.find(a => a.asset_id === route.params.assetId);
      if (asset) {
        setSelectedAsset(asset);
      }
    }

    if (route.params?.prefilledAddress || route.params?.address) {
      const addressToSet = route.params.prefilledAddress || route.params.address;
      setAddress(addressToSet);
      detectAddressType(addressToSet);
    }

    if (route.params?.prefilledAmount) {
      setAmount(route.params.prefilledAmount);
    }

    // Handle pre-decoded invoices from QR scanner
    if (route.params?.decodedInvoice) {
      setDecodedInvoice(route.params.decodedInvoice);
      setAddressType('lightning');
    }

    if (route.params?.decodedRGBInvoice) {
      setDecodedRGBInvoice(route.params.decodedRGBInvoice);
      setAddressType('rgb');
    }

    if (route.params?.isLightning) {
      setAddressType('lightning');
    }

    // Auto-advance to review step if coming from QR scanner with complete data
    if (route.params?.fromQRScanner) {
      const hasCompleteData = route.params?.prefilledAmount && 
        (route.params?.decodedInvoice?.amt_msat > 0 || route.params?.decodedRGBInvoice?.amount);
      
      if (hasCompleteData) {
        // Small delay to allow state to settle, then show review
        setTimeout(() => {
          setPaymentStep('review');
        }, 300);
      }
    }
  }, [route.params]);

  const isLightningAddress = (input: string): boolean => {
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    return emailRegex.test(input);
  };

  const detectAddressType = useCallback(async (input: string) => {
    if (!input) {
      setAddressType('unknown');
      setDecodedInvoice(null);
      setDecodedRGBInvoice(null);
      setValidationError(null);
      return;
    }

    setIsDecodingInvoice(true);
    setAddressType('unknown');
    setDecodedInvoice(null);
    setDecodedRGBInvoice(null);
    setValidationError(null);

    try {
      // Unified destination classification + route resolution
      const destKind = classifyWithdrawDestination(input);
      const addrType: AddressType = destKind === 'lnurl-pay' ? 'lnurl-pay'
        : destKind === 'unknown' ? 'unknown' : destKind as AddressType;
      setAddressType(addrType);

      // Resolve send routes
      const accounts = getProtocolStatus();
      const { routes } = resolveSendRoutes({ destinationType: destKind, selectedAssetId: selectedAsset.asset_id, accounts });
      setSendRoutes(routes);
      const active = resolveActiveSendRoute({ destinationType: destKind, selectedAssetId: selectedAsset.asset_id, accounts });
      setActiveRoute(active || null);

      if (destKind === 'lightning') {
        try {
          const rgbAdapter = protocolManager.getAdapter('RGB');
          const decodedResult = await rgbAdapter.decodeInvoice(input);
          const decoded = {
            payment_hash: decodedResult.paymentHash || decodedResult.payment_hash || '',
            amt_msat: decodedResult.amountMsat || decodedResult.amount_msat || (decodedResult.amount ? decodedResult.amount * 1000 : 0),
            asset_id: decodedResult.asset_id,
            asset_amount: decodedResult.asset_amount,
            description: decodedResult.description || '',
            expiry_sec: 0,
            payee_pubkey: decodedResult.destination || decodedResult.payee_pubkey || '',
          };
          setDecodedInvoice(decoded);
          setAddressType('lightning');
          
          // Auto-set asset and amount if specified in invoice
          if (decoded.asset_id) {
            const asset = allAssets.find(a => a.asset_id === decoded.asset_id);
            if (asset) {
              setSelectedAsset(asset);
              if (decoded.asset_amount) {
                setAmount(decoded.asset_amount.toString());
              }
            }
          } else if (decoded.amt_msat > 0) {
            // BTC Lightning invoice with amount
            const amountBTC = decoded.amt_msat / 100000000000; // Convert msat to BTC
            setAmount(amountBTC.toFixed(8));
            // Ensure BTC is selected for BTC invoices
            const btcAsset = allAssets.find(a => a.asset_id === 'BTC');
            if (btcAsset) {
              setSelectedAsset(btcAsset);
            }
          }
        } catch (error) {
          setAddressType('invalid');
          setValidationError('Failed to decode Lightning invoice');
        }
      } else if (input.startsWith('rgb')) {
        // RGB invoice
        try {
          const rgbAdapterRgb = protocolManager.getAdapter('RGB');
          const decoded = await rgbAdapterRgb.decodeRgbInvoice?.({ invoice: input }) as any;
          
          // Extract amount from assignment if it's a fungible assignment
          let invoiceAmount: number | null = null;
          if (decoded.assignment && decoded.assignment.type === 'Fungible' && decoded.assignment.value) {
            invoiceAmount = decoded.assignment.value;
          }
          
          const decodedWithAmount: DecodedRGBInvoice = {
            ...decoded,
            amount: invoiceAmount,
          };
          setDecodedRGBInvoice(decodedWithAmount);
          setAddressType('rgb');
          
          // Auto-set asset if specified
          if (decoded.asset_id) {
            const asset = allAssets.find(a => a.asset_id === decoded.asset_id);
            if (asset) {
              setSelectedAsset(asset);
              // Set amount if specified in invoice
              if (invoiceAmount) {
                const precision = asset.precision || 8;
                const formattedAmount = invoiceAmount / Math.pow(10, precision);
                setAmount(formattedAmount.toString());
              }
            } else {
              setValidationError(`You don't have the requested asset: ${decoded.asset_id.substring(0, 8)}...`);
            }
          }
        } catch (error) {
          setAddressType('invalid');
          setValidationError('Failed to decode RGB invoice');
        }
      } else if (destKind === 'bitcoin' || destKind === 'lightning-address' || destKind === 'lnurl-pay' || destKind === 'spark' || destKind === 'arkade') {
        const btcAsset = allAssets.find(a => a.asset_id === 'BTC');
        if (btcAsset) setSelectedAsset(btcAsset);
      } else if (destKind === 'invalid') {
        setValidationError('Invalid address format. Please enter a valid Bitcoin, Lightning, Spark, Arkade, or RGB address.');
      }
    } catch (error) {
      console.error('Failed to decode input:', error);
      setAddressType('invalid');
      setValidationError('Failed to decode input. Please check the address format.');
    } finally {
      setIsDecodingInvoice(false);
    }
  }, [allAssets]);

  const handlePasteFromClipboard = async () => {
    try {
      const text = await Clipboard.getString();
      if (text) {
        setAddress(text);
        await detectAddressType(text);
      }
    } catch (error) {
      console.error('Failed to read clipboard:', error);
      Alert.alert('Error', 'Failed to read from clipboard');
    }
  };

  const getMaxAmount = (): string => {
    if (!selectedAsset) return '0';
    
    if (selectedAsset.asset_id === 'BTC') {
      const availableBalance = selectedAsset.balance || 0;
      return (availableBalance / 100000000).toFixed(8);
    } else {
      const balance = selectedAsset.balance || 0;
      const precision = selectedAsset.precision || 8;
      return (balance / Math.pow(10, precision)).toFixed(precision);
    }
  };

  // Format available balance using the hook at component level
  const maxAmount = getMaxAmount();
  const formattedMaxAmount = useFormattedBitcoinAmount(maxAmount);

  const validateInputs = (): boolean => {
    if (!address.trim()) {
      Alert.alert('Missing Address', 'Please enter a recipient address or scan a QR code.');
      return false;
    }

    if (addressType === 'invalid') {
      Alert.alert('Invalid Address', 'Please enter a valid Bitcoin address, Lightning invoice, or RGB invoice.');
      return false;
    }

    // For invoices with fixed amounts, don't require amount input
    const hasFixedAmount = 
      (addressType === 'lightning' && decodedInvoice?.amt_msat && decodedInvoice.amt_msat > 0) ||
      (addressType === 'rgb' && decodedRGBInvoice?.amount);

    if (!hasFixedAmount && (!amount.trim() || parseFloat(amount) <= 0)) {
      Alert.alert('Missing Amount', 'Please enter a valid amount to send.');
      return false;
    }

    // Validate balance
    if (selectedAsset) {
      const inputAmount = parseFloat(amount || '0');
      const availableBalance = selectedAsset.asset_id === 'BTC' 
        ? (selectedAsset.balance || 0) / 100000000
        : (selectedAsset.balance || 0) / Math.pow(10, selectedAsset.precision || 8);

      if (inputAmount > availableBalance) {
        Alert.alert(
          'Insufficient Balance', 
          `You don't have enough ${selectedAsset.ticker}. Available: ${availableBalance.toFixed(selectedAsset.asset_id === 'BTC' ? 8 : selectedAsset.precision || 8)} ${selectedAsset.ticker}`
        );
        return false;
      }
    }

    return true;
  };

  const handleSend = async () => {
    if (!validateInputs()) return;
    
    if (paymentStep === 'input') {
      setPaymentStep('review');
      return;
    }
    
    // We're in review step, proceed with sending
    setPaymentStep('sending');
    setLoading(true);

    try {
      const route = activeRoute;
      const protocol = route?.protocol || 'RGB';
      const method = route?.method || 'lightning';

      if (method === 'spark') {
        // Spark transfer
        const sparkAdapter = protocolManager.getAdapter('SPARK');
        const amountSats = bitcoinUnit === 'BTC'
          ? Math.round(parseFloat(amount) * 1e8)
          : Math.round(parseFloat(amount));
        await sparkAdapter.sendPayment({ invoice: address, amount: amountSats });
        Alert.alert('Payment Sent!', 'Spark payment sent successfully!', [{ text: 'OK', onPress: () => navigation.goBack() }]);

      } else if (method === 'arkade' || method === 'boarding') {
        // Arkade transfer or offboard
        const arkadeAdapter = protocolManager.getAdapter('ARKADE');
        const amountSats = bitcoinUnit === 'BTC'
          ? Math.round(parseFloat(amount) * 1e8)
          : Math.round(parseFloat(amount));
        if (method === 'boarding') {
          await arkadeAdapter.sendBtcOnchain?.({ address, amount: amountSats });
        } else {
          await arkadeAdapter.sendPayment({ invoice: address, amount: amountSats });
        }
        Alert.alert('Payment Sent!', 'Arkade payment sent successfully!', [{ text: 'OK', onPress: () => navigation.goBack() }]);

      } else if (addressType === 'lightning' || addressType === 'lightning-address' || addressType === 'lnurl-pay') {
        // Lightning payment — route to the correct protocol
        const lnAdapter = protocolManager.getAdapter(protocol);
        await lnAdapter.sendPayment({ invoice: address });
        Alert.alert('Payment Sent!', 'Lightning payment sent successfully!', [{ text: 'OK', onPress: () => navigation.goBack() }]);

      } else if (addressType === 'bitcoin') {
        // On-chain BTC — route to correct protocol
        const feeRateNum = feeRate === 'custom' ? customFee : feeRates.find(f => f.value === feeRate)?.rate || 2;
        const btcAdapter = protocolManager.getAdapter(protocol);
        await btcAdapter.sendBtcOnchain?.({ address, amount: parseFloat(amount), feeRate: feeRateNum });
        Alert.alert('Payment Sent!', 'Bitcoin transaction broadcasted successfully!', [{ text: 'OK', onPress: () => navigation.goBack() }]);

      } else if (addressType === 'rgb') {
        const rgbSendAdapter = protocolManager.getAdapter('RGB');
        await rgbSendAdapter.sendAsset?.({ asset_id: selectedAsset.asset_id, recipientId: address, amount: parseFloat(amount) });
        Alert.alert('Asset Sent!', 'RGB asset transfer completed successfully!', [{ text: 'OK', onPress: () => navigation.goBack() }]);
      }
    } catch (error) {
      console.error('Send error:', error);
      Alert.alert(
        'Error',
        error instanceof Error ? error.message : 'Failed to send payment'
      );
    } finally {
      setLoading(false);
    }
  };

  const AssetIcon = ({ asset }: { asset: Asset }) => {
    if (!asset) return null;
    
    if (asset.ticker === 'BTC') {
      return (
        <View style={styles.assetIconContainer}>
          <Ionicons name="logo-bitcoin" size={20} color="#F7931A" />
        </View>
      );
    }
    
    return (
      <View style={styles.assetIconContainer}>
        <Ionicons name="diamond" size={20} color={theme.colors.primary[500]} />
      </View>
    );
  };

  const renderHeader = () => (
    <ScreenHeader
      title={paymentStep === 'review' ? 'Review Payment' : paymentStep === 'sending' ? 'Sending...' : 'Send'}
      showBack={true}
      rightAction={
        <TouchableOpacity
          onPress={() => Alert.alert('Help', 'Send Bitcoin, Lightning payments, or RGB assets')}
          style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.15)' }}
        >
          <Ionicons name="help-circle-outline" size={22} color={theme.colors.text.inverse} />
        </TouchableOpacity>
      }
    />
  );

  const renderAddressInput = () => (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Recipient</Text>
      <Text style={styles.sectionDescription}>
        Enter a Bitcoin address, Lightning invoice, Lightning address, or RGB invoice
      </Text>
      
      <View style={styles.inputContainer}>
        <Input
          placeholder="Paste address or invoice..."
          value={address}
          onChangeText={(text) => {
            setAddress(text);
            detectAddressType(text);
          }}
          multiline={addressType === 'lightning' && address.length > 50}
          variant="outlined"
          style={styles.addressInput}
        />
        <View style={styles.inputActions}>
          <TouchableOpacity
            style={styles.inputActionButton}
            onPress={handlePasteFromClipboard}
          >
            <Ionicons name="clipboard-outline" size={18} color={theme.colors.primary[500]} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.inputActionButton}
            onPress={() => navigation.navigate('QRScanner')}
          >
            <Ionicons name="qr-code-outline" size={18} color={theme.colors.primary[500]} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Address Type Indicator */}
      {addressType !== 'unknown' && addressType !== 'invalid' && !isDecodingInvoice && (
        <View style={styles.addressTypeIndicator}>
          <View style={[
            styles.addressTypeIcon,
            { backgroundColor:
              addressType === 'lightning' || addressType === 'lightning-address' || addressType === 'lnurl-pay' ? '#FACC15'
              : addressType === 'spark' ? '#60A5FA'
              : addressType === 'arkade' ? '#A855F7'
              : addressType === 'bitcoin' ? '#F7931A'
              : '#2BEE79'
            }
          ]}>
            <NetworkIcon
              network={
                addressType === 'lightning' || addressType === 'lightning-address' || addressType === 'lnurl-pay' ? 'lightning'
                : addressType === 'spark' ? 'spark'
                : addressType === 'arkade' ? 'arkade'
                : addressType === 'bitcoin' ? 'bitcoin'
                : 'rgb'
              }
              size={14}
              color="white"
            />
          </View>
          <Text style={styles.addressTypeText}>
            {addressType === 'lightning' ? 'Lightning Invoice'
              : addressType === 'lightning-address' ? 'Lightning Address'
              : addressType === 'lnurl-pay' ? 'LNURL Pay'
              : addressType === 'spark' ? 'Spark Address'
              : addressType === 'arkade' ? 'Arkade Address'
              : addressType === 'bitcoin' ? 'Bitcoin Address'
              : 'RGB Invoice'
            }
          </Text>
        </View>
      )}

      {/* Route selector — shows available send routes when multiple exist */}
      {sendRoutes.length > 1 && addressType !== 'unknown' && addressType !== 'invalid' && (
        <View style={{ marginTop: 14, gap: 8 }}>
          <Text style={{ fontSize: 12, fontWeight: '600', color: theme.colors.text.tertiary, textTransform: 'uppercase', letterSpacing: 0.4 }}>
            Send via
          </Text>
          {sendRoutes.map((route) => {
            const selected = activeRoute?.account === route.account && activeRoute?.method === route.method;
            const disabled = !!route.disabled;
            return (
              <PressableScale
                key={`${route.account}-${route.method}`}
                onPress={() => { if (!disabled) { haptic.selection(); setActiveRoute({ ...route, protocol: route.account }); } }}
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 14,
                  backgroundColor: selected ? theme.colors.primary[50] : theme.colors.background.secondary,
                  borderWidth: 1,
                  borderColor: selected ? theme.colors.primary[500] : theme.colors.border.light,
                  opacity: disabled ? 0.5 : 1,
                }}
              >
                <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: theme.colors.surface.secondary, alignItems: 'center', justifyContent: 'center' }}>
                  <NetworkIcon network={String(route.account).toLowerCase()} size={20} />
                </View>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={{ fontSize: 14, fontWeight: '600', color: theme.colors.text.primary }}>
                      {METHOD_META[route.method]?.label || route.method}
                    </Text>
                    {route.recommended && (
                      <View style={{ backgroundColor: theme.colors.primary[500], borderRadius: 8, paddingHorizontal: 6, paddingVertical: 1 }}>
                        <Text style={{ fontSize: 9, fontWeight: '800', color: theme.colors.text.inverse, letterSpacing: 0.3 }}>BEST</Text>
                      </View>
                    )}
                  </View>
                  <Text style={{ fontSize: 11.5, color: disabled ? theme.colors.error[500] : theme.colors.text.tertiary, marginTop: 1 }} numberOfLines={1}>
                    {disabled ? (route.disabledReason || 'Unavailable') : route.summary}
                  </Text>
                </View>
                <Ionicons
                  name={selected ? 'radio-button-on' : 'radio-button-off'}
                  size={20}
                  color={selected ? theme.colors.primary[500] : theme.colors.text.tertiary}
                />
              </PressableScale>
            );
          })}
        </View>
      )}

      {/* Decoding Indicator */}
      {isDecodingInvoice && (
        <View style={styles.decodingIndicator}>
          <ActivityIndicator size="small" color={theme.colors.primary[500]} />
          <Text style={styles.decodingText}>Analyzing input...</Text>
        </View>
      )}

      {/* Validation Error */}
      {validationError && (
        <View style={styles.errorContainer}>
          <Ionicons name="warning-outline" size={16} color={theme.colors.error[500]} />
          <Text style={styles.errorText}>{validationError}</Text>
        </View>
      )}

      {/* Decoded Invoice Info */}
      {renderInvoiceDetails()}
    </View>
  );

  const renderInvoiceDetails = () => {
    if (decodedInvoice && addressType === 'lightning') {
      return (
        <View style={styles.invoiceDetails}>
          <Text style={styles.invoiceDetailsTitle}>Lightning Invoice Details</Text>
          {decodedInvoice.amt_msat > 0 && (
            <View style={styles.invoiceDetailRow}>
              <Text style={styles.invoiceDetailLabel}>Amount:</Text>
              <Text style={styles.invoiceDetailValue}>
                {(decodedInvoice.amt_msat / 1000).toLocaleString()} sats
              </Text>
            </View>
          )}
          {decodedInvoice.description && (
            <View style={styles.invoiceDetailRow}>
              <Text style={styles.invoiceDetailLabel}>Description:</Text>
              <Text style={styles.invoiceDetailValue}>{decodedInvoice.description}</Text>
            </View>
          )}
        </View>
      );
    }

    if (decodedRGBInvoice && addressType === 'rgb') {
      const asset = allAssets.find(a => a.asset_id === decodedRGBInvoice.asset_id);
      
      return (
        <View style={styles.invoiceDetails}>
          <Text style={styles.invoiceDetailsTitle}>RGB Invoice Details</Text>
          <View style={styles.invoiceDetailRow}>
            <Text style={styles.invoiceDetailLabel}>Asset:</Text>
            <Text style={styles.invoiceDetailValue}>{asset?.ticker || 'Unknown'}</Text>
          </View>
          {decodedRGBInvoice.amount && (
            <View style={styles.invoiceDetailRow}>
              <Text style={styles.invoiceDetailLabel}>Amount:</Text>
              <Text style={styles.invoiceDetailValue}>
                {(decodedRGBInvoice.amount / Math.pow(10, asset?.precision || 8)).toFixed(asset?.precision || 8)} {asset?.ticker}
              </Text>
            </View>
          )}
        </View>
      );
    }

    return null;
  };

  const renderAssetSelector = () => {
    // Don't show asset selector if invoice specifies the asset
    if ((addressType === 'lightning' && decodedInvoice?.asset_id) || 
        (addressType === 'rgb' && decodedRGBInvoice?.asset_id)) {
      return null;
    }

    // For bitcoin addresses, force BTC
    if (addressType === 'bitcoin') {
      return null;
    }

    return (
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Asset</Text>
        <TouchableOpacity
          style={styles.assetSelector}
          onPress={() => setShowAssetSelector(!showAssetSelector)}
        >
          <AssetIcon asset={selectedAsset} />
          <View style={styles.assetInfo}>
            <Text style={styles.assetTicker}>{selectedAsset.ticker}</Text>
            <Text style={styles.assetName}>{selectedAsset.name}</Text>
            <Text style={styles.assetBalance}>
              Balance: {selectedAsset.asset_id === 'BTC' 
                ? ((selectedAsset.balance || 0) / 100000000).toFixed(8)
                : ((selectedAsset.balance || 0) / Math.pow(10, selectedAsset.precision || 8)).toFixed(selectedAsset.precision || 8)
              } {selectedAsset.ticker}
            </Text>
          </View>
          <Ionicons 
            name={showAssetSelector ? "chevron-up" : "chevron-down"} 
            size={20} 
            color={theme.colors.text.secondary} 
          />
        </TouchableOpacity>

        {showAssetSelector && (
          <View style={styles.assetDropdown}>
            <ScrollView style={styles.assetDropdownScroll} nestedScrollEnabled>
              {allAssets.map((asset, index) => (
                <TouchableOpacity
                  key={`asset-${asset.asset_id}-${index}`}
                  style={[
                    styles.assetOption,
                    selectedAsset.asset_id === asset.asset_id && styles.assetOptionSelected
                  ]}
                  onPress={() => {
                    setSelectedAsset(asset);
                    setShowAssetSelector(false);
                  }}
                >
                  <AssetIcon asset={asset} />
                  <View style={styles.assetOptionInfo}>
                    <Text style={styles.assetOptionTicker}>{asset.ticker}</Text>
                    <Text style={styles.assetOptionName}>{asset.name}</Text>
                    <Text style={styles.assetOptionBalance}>
                      Balance: {asset.asset_id === 'BTC' 
                        ? ((asset.balance || 0) / 100000000).toFixed(8)
                        : ((asset.balance || 0) / Math.pow(10, asset.precision || 8)).toFixed(asset.precision || 8)
                      } {asset.ticker}
                    </Text>
                  </View>
                  {selectedAsset.asset_id === asset.asset_id && (
                    <Ionicons name="checkmark-circle" size={20} color={theme.colors.success[500]} />
                  )}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}
      </View>
    );
  };

  const renderAmountInput = () => {
    // Don't show amount input if invoice specifies the amount
    const invoiceHasAmount = (addressType === 'lightning' && decodedInvoice?.amt_msat && decodedInvoice.amt_msat > 0) ||
                          (addressType === 'rgb' && decodedRGBInvoice?.amount);
    
    if (invoiceHasAmount) {
      return null;
    }

    const maxAmount = getMaxAmount();
    const maxAmountNum = parseFloat(maxAmount);

    // Calculate quick amount percentages of max
    const getQuickAmounts = () => {
      if (selectedAsset.ticker !== 'BTC' || !maxAmountNum) return [];
      
      const percentages = [0.25, 0.5, 0.75];
      return percentages.map(pct => {
        const amt = maxAmountNum * pct;
        return bitcoinUnit === 'BTC'
          ? amt.toFixed(8)
          : Math.floor(amt).toString();
      });
    };

    return (
      <View style={styles.section}>
        <View style={styles.amountHeader}>
          <Text style={styles.sectionTitle}>Amount ({selectedAsset.ticker === 'BTC' ? bitcoinUnit : selectedAsset.ticker})</Text>
          <TouchableOpacity
            style={styles.maxButton}
            onPress={() => setAmount(maxAmount)}
          >
            <Text style={styles.maxButtonText}>MAX</Text>
          </TouchableOpacity>
        </View>
        
        <Input
          placeholder={bitcoinUnit === 'BTC' ? "0.00000000" : "0"}
          value={amount}
          onChangeText={(value) => {
            // Clean and format the input
            const cleanValue = value.replace(/[^0-9.]/g, '');
            const parts = cleanValue.split('.');
            if (parts.length > 2) return; // Only allow one decimal point
            
            // Limit decimal places based on unit
            const maxDecimals = bitcoinUnit === 'BTC' ? 8 : 0;
            if (parts[1] && parts[1].length > maxDecimals) return;
            
            const newAmount = parseInputAmount(cleanValue, bitcoinUnit);
            // Validate against max amount
            if (parseFloat(newAmount || '0') > maxAmountNum) {
              setAmount(maxAmount);
            } else {
              setAmount(newAmount);
            }
          }}
          keyboardType="decimal-pad"
          variant="outlined"
          size="lg"
          style={styles.amountInput}
        />
        
        {/* Quick amount buttons */}
        <View style={styles.quickAmounts}>
                  {getQuickAmounts().map((amt, index) => (
          <TouchableOpacity
            key={`quick-amount-${amt}-${index}`}
            style={styles.quickAmountButton}
            onPress={() => setAmount(amt)}
          >
            <Text style={styles.quickAmountText}>
              {amt} {bitcoinUnit}
            </Text>
          </TouchableOpacity>
        ))}
        </View>
        
        <View style={styles.balanceInfo}>
          <Text style={styles.balanceText}>
            Available: {formattedMaxAmount} {bitcoinUnit}
          </Text>
          {selectedAsset.asset_id === 'BTC' && amount && (
            <Text style={styles.usdValue}>
              ≈ ${parseFloat(formatSatoshisToUSD(amount)).toLocaleString()} USD
            </Text>
          )}
        </View>
      </View>
    );
  };

  const renderFeeSelector = () => {
    // Only show fee selector for on-chain transactions
    if (addressType === 'lightning' || addressType === 'lightning-address') {
      return null;
    }

    return (
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Network Fee</Text>
        <View style={styles.feeSelector}>
          {feeRates.map((fee, index) => (
            <TouchableOpacity
              key={`fee-rate-${fee.value}-${index}`}
              style={[
                styles.feeButton,
                feeRate === fee.value && styles.feeButtonActive
              ]}
              onPress={() => setFeeRate(fee.value)}
            >
              <Ionicons 
                name={fee.icon as any} 
                size={16} 
                color={feeRate === fee.value ? theme.colors.text.inverse : theme.colors.text.secondary} 
              />
              <Text style={[
                styles.feeButtonText,
                feeRate === fee.value && styles.feeButtonTextActive
              ]}>
                {fee.label}
              </Text>
              <Text style={[
                styles.feeButtonRate,
                feeRate === fee.value && styles.feeButtonRateActive
              ]}>
                {fee.rate} sat/vB
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {feeRate === 'custom' && (
          <View style={styles.customFeeContainer}>
            <Input
              label="Custom Fee Rate (sat/vB)"
              placeholder="1.0"
              value={customFee.toString()}
              onChangeText={(text) => setCustomFee(parseFloat(text) || 1.0)}
              keyboardType="decimal-pad"
              variant="outlined"
            />
          </View>
        )}
      </View>
    );
  };

  const renderSendButton = () => {
    // Hide send button during review and sending steps
    if (paymentStep === 'review' || paymentStep === 'sending') return null;

    const hasAddress = address && addressType !== 'invalid' && addressType !== 'unknown';
    const hasFixedAmount = (decodedInvoice?.amt_msat && decodedInvoice.amt_msat > 0) || decodedRGBInvoice?.amount;
    const hasAmount = amount || hasFixedAmount;
    const canSend = hasAddress && hasAmount;

    // Dynamic button text based on state
    let buttonTitle = 'Continue';
    if (!hasAddress) {
      buttonTitle = 'Enter Address or Scan QR';
    } else if (!hasAmount) {
      buttonTitle = 'Enter Amount';
    } else {
      buttonTitle = 'Review Payment';
    }

    return (
      <View style={styles.sendButtonContainer}>
        <Button
          title={buttonTitle}
          onPress={handleSend}
          disabled={!canSend}
          variant="primary"
          fullWidth={true}
          size="lg"
          style={styles.sendButton}
        />
        
        {/* Quick actions for better UX */}
        {!hasAddress && (
          <View style={styles.quickActionsContainer}>
            <TouchableOpacity
              style={styles.quickActionButton}
              onPress={() => navigation.navigate('QRScanner')}
            >
              <Ionicons name="qr-code-outline" size={20} color={theme.colors.primary[500]} />
              <Text style={styles.quickActionText}>Scan QR</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.quickActionButton}
              onPress={handlePasteFromClipboard}
            >
              <Ionicons name="clipboard-outline" size={20} color={theme.colors.primary[500]} />
              <Text style={styles.quickActionText}>Paste</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  };

  const renderPaymentReview = () => {
    if (paymentStep !== 'review') return null;

    const effectiveAmount = amount || 
      (decodedInvoice?.amt_msat ? (decodedInvoice.amt_msat / 100000000000).toFixed(8) : '0') ||
      (decodedRGBInvoice?.amount ? (decodedRGBInvoice.amount / Math.pow(10, selectedAsset.precision || 8)).toFixed(selectedAsset.precision || 8) : '0');

    return (
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Review Payment</Text>
        
        <View style={styles.reviewCard}>
          <View style={styles.reviewHeader}>
            <AssetIcon asset={selectedAsset} />
            <View style={styles.reviewHeaderText}>
              <Text style={styles.reviewAmount}>
                {effectiveAmount} {selectedAsset.ticker === 'BTC' ? bitcoinUnit : selectedAsset.ticker}
              </Text>
              <Text style={styles.reviewAsset}>{selectedAsset.name}</Text>
            </View>
          </View>

          <View style={styles.reviewDetails}>
            <View style={styles.reviewRow}>
              <Text style={styles.reviewLabel}>To</Text>
              <Text style={styles.reviewValue} numberOfLines={2}>
                {address.length > 40 ? `${address.slice(0, 20)}...${address.slice(-20)}` : address}
              </Text>
            </View>
            
            {addressType === 'lightning' && decodedInvoice?.description && (
              <View style={styles.reviewRow}>
                <Text style={styles.reviewLabel}>Description</Text>
                <Text style={styles.reviewValue}>{decodedInvoice.description}</Text>
              </View>
            )}

            {(addressType === 'bitcoin' || addressType === 'rgb') && (
              <View style={styles.reviewRow}>
                <Text style={styles.reviewLabel}>Network Fee</Text>
                <Text style={styles.reviewValue}>
                  {feeRate === 'custom' ? customFee : feeRates.find(f => f.value === feeRate)?.rate} sat/vB
                </Text>
              </View>
            )}

            {selectedAsset.ticker === 'BTC' && effectiveAmount && (
              <View style={styles.reviewRow}>
                <Text style={styles.reviewLabel}>USD Value</Text>
                <Text style={styles.reviewValue}>
                  ≈ ${parseFloat(formatSatoshisToUSD(effectiveAmount)).toLocaleString()}
                </Text>
              </View>
            )}
          </View>

          <View style={styles.reviewActions}>
            <Button
              title="Edit"
              variant="secondary"
              onPress={() => setPaymentStep('input')}
              style={styles.reviewEditButton}
            />
            <Button
              title={
                addressType === 'lightning' ? 'Pay Invoice' :
                addressType === 'rgb' ? 'Send RGB Asset' :
                'Send Bitcoin'
              }
              variant="primary"
              onPress={handleSend}
              loading={loading}
              style={styles.reviewConfirmButton}
            />
          </View>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right', 'bottom']}>
      {renderHeader()}
      
      <ScrollView 
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {renderAddressInput()}
        {renderAssetSelector()}
        {renderAmountInput()}
        {renderFeeSelector()}
        {renderPaymentReview()}
      </ScrollView>

      {renderSendButton()}
      
      {/* Loading overlay when sending */}
      {paymentStep === 'sending' && (
        <View style={styles.sendingOverlay}>
          <View style={styles.sendingContent}>
            <ActivityIndicator size="large" color={theme.colors.primary[500]} />
            <Text style={styles.sendingText}>Processing Payment...</Text>
            <Text style={styles.sendingSubtext}>This may take a few moments</Text>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background.secondary,
  },
  
  headerContainer: {
    marginBottom: theme.spacing[4],
  },
  
  headerGradient: {
    paddingTop: theme.spacing[2],
    paddingBottom: theme.spacing[6],
    borderBottomLeftRadius: theme.borderRadius['2xl'],
    borderBottomRightRadius: theme.borderRadius['2xl'],
  },
  
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing[5],
    paddingTop: theme.spacing[4],
  },
  
  backButton: {
    width: 40,
    height: 40,
    borderRadius: theme.borderRadius.base,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  
  headerTitle: {
    fontSize: theme.typography.fontSize.xl,
    fontWeight: '700',
    color: theme.colors.text.inverse,
  },
  
  helpButton: {
    width: 40,
    height: 40,
    borderRadius: theme.borderRadius.base,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  
  scrollView: {
    flex: 1,
  },
  
  scrollContent: {
    paddingHorizontal: theme.spacing[5],
    paddingBottom: theme.spacing[6],
  },
  
  section: {
    marginBottom: theme.spacing[6],
  },
  
  sectionTitle: {
    fontSize: theme.typography.fontSize.lg,
    fontWeight: '700',
    color: theme.colors.text.primary,
    marginBottom: theme.spacing[2],
  },
  
  sectionDescription: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.text.secondary,
    marginBottom: theme.spacing[4],
    lineHeight: 20,
  },
  
  inputContainer: {
    position: 'relative',
  },
  
  addressInput: {
    paddingRight: theme.spacing[20], // Space for action buttons
  },
  
  inputActions: {
    position: 'absolute',
    right: theme.spacing[3],
    top: '50%',
    transform: [{ translateY: -16 }],
    flexDirection: 'row',
    gap: theme.spacing[2],
  },
  
  inputActionButton: {
    width: 32,
    height: 32,
    borderRadius: theme.borderRadius.base,
    backgroundColor: theme.colors.primary[50],
    alignItems: 'center',
    justifyContent: 'center',
  },
  
  addressTypeIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: theme.spacing[2],
    gap: theme.spacing[2],
  },
  
  addressTypeIcon: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  
  lightningIcon: {
    backgroundColor: '#f59e0b',
  },
  
  bitcoinIcon: {
    backgroundColor: '#F7931A',
  },
  
  rgbIcon: {
    backgroundColor: '#10b981',
  },
  
  addressTypeText: {
    fontSize: theme.typography.fontSize.sm,
    fontWeight: '500',
    color: theme.colors.text.secondary,
  },
  
  decodingIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: theme.spacing[2],
    gap: theme.spacing[2],
  },
  
  decodingText: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.primary[500],
  },
  
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: theme.spacing[2],
    padding: theme.spacing[3],
    backgroundColor: theme.colors.error[50],
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.error[50], // Changed from 200 to 50
    gap: theme.spacing[2],
  },
  
  errorText: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.error[600],
    flex: 1,
  },
  
  invoiceDetails: {
    marginTop: theme.spacing[4],
    padding: theme.spacing[4],
    backgroundColor: theme.colors.primary[50],
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.primary[100], // Changed from 200 to 100
  },
  
  invoiceDetailsTitle: {
    fontSize: theme.typography.fontSize.base,
    fontWeight: '600',
    color: theme.colors.primary[700],
    marginBottom: theme.spacing[3],
  },
  
  invoiceDetailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing[2],
  },
  
  invoiceDetailLabel: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.primary[600],
  },
  
  invoiceDetailValue: {
    fontSize: theme.typography.fontSize.sm,
    fontWeight: '500',
    color: theme.colors.primary[700], // Changed from 800 to 700
    flex: 1,
    textAlign: 'right',
  },
  
  assetSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: theme.spacing[4],
    backgroundColor: theme.colors.surface.primary,
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border.light,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 3.84,
    elevation: 5,
  },
  
  assetIconContainer: {
    width: 32,
    height: 32,
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.gray[100],
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: theme.spacing[3],
  },
  
  assetInfo: {
    flex: 1,
  },
  
  assetTicker: {
    fontSize: theme.typography.fontSize.base,
    fontWeight: '700',
    color: theme.colors.text.primary,
    marginBottom: theme.spacing[1],
  },
  
  assetName: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.text.secondary,
    marginBottom: theme.spacing[1],
  },
  
  assetBalance: {
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.text.muted,
  },
  
  assetDropdown: {
    backgroundColor: theme.colors.surface.primary,
    marginTop: theme.spacing[2],
    borderRadius: theme.borderRadius.lg,
    maxHeight: 300,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.15,
    shadowRadius: 6.27,
    elevation: 10,
  },
  
  assetDropdownScroll: {
    maxHeight: 280,
  },
  
  assetOption: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: theme.spacing[4],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border.light,
  },
  
  assetOptionSelected: {
    backgroundColor: theme.colors.primary[50],
  },
  
  assetOptionInfo: {
    flex: 1,
    marginLeft: theme.spacing[3],
  },
  
  assetOptionTicker: {
    fontSize: theme.typography.fontSize.base,
    fontWeight: '600',
    color: theme.colors.text.primary,
  },
  
  assetOptionName: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.text.secondary,
    marginBottom: theme.spacing[1],
  },
  
  assetOptionBalance: {
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.text.muted,
  },
  
  amountHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing[4],
  },
  
  maxButton: {
    backgroundColor: theme.colors.primary[50],
    borderWidth: 1,
    borderColor: theme.colors.primary[100], // Changed from 200 to 100
    borderRadius: theme.borderRadius.base,
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
  },
  
  maxButtonText: {
    fontSize: theme.typography.fontSize.sm,
    fontWeight: '600',
    color: theme.colors.primary[600],
  },
  
  amountInput: {
    marginBottom: theme.spacing[3],
  },
  
  balanceInfo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  
  balanceText: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.text.secondary,
  },
  
  usdValue: {
    fontSize: theme.typography.fontSize.sm,
    fontWeight: '500',
    color: theme.colors.text.primary,
  },
  
  feeSelector: {
    flexDirection: 'row',
    gap: theme.spacing[2],
  },
  
  feeButton: {
    flex: 1,
    flexDirection: 'column',
    alignItems: 'center',
    padding: theme.spacing[3],
    backgroundColor: theme.colors.gray[100],
    borderRadius: theme.borderRadius.lg,
    borderWidth: 2,
    borderColor: 'transparent',
    gap: theme.spacing[1],
  },
  
  feeButtonActive: {
    backgroundColor: theme.colors.primary[500],
    borderColor: theme.colors.primary[600],
  },
  
  feeButtonText: {
    fontSize: theme.typography.fontSize.sm,
    fontWeight: '500',
    color: theme.colors.text.secondary,
  },
  
  feeButtonTextActive: {
    color: theme.colors.text.inverse,
  },
  
  feeButtonRate: {
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.text.muted,
  },
  
  feeButtonRateActive: {
    color: 'rgba(255, 255, 255, 0.8)',
  },
  
  customFeeContainer: {
    marginTop: theme.spacing[4],
  },
  
  sendButtonContainer: {
    padding: theme.spacing[5],
    backgroundColor: theme.colors.surface.primary,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border.light,
  },
  
  sendButton: {
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 8,
  },
  
  // Modal styles
  modalOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
  },
  
  modalContent: {
    backgroundColor: theme.colors.surface.primary,
    borderRadius: theme.borderRadius.xl,
    padding: theme.spacing[6],
    marginHorizontal: theme.spacing[5],
    width: '90%',
    maxWidth: 400,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 8,
    },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 12,
  },
  
  modalTitle: {
    fontSize: theme.typography.fontSize.xl,
    fontWeight: '700',
    color: theme.colors.text.primary,
    textAlign: 'center',
    marginBottom: theme.spacing[6],
  },
  
  confirmationDetails: {
    marginBottom: theme.spacing[6],
  },
  
  confirmationRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingVertical: theme.spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border.light,
    gap: theme.spacing[4],
  },
  
  confirmationLabel: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.text.secondary,
    fontWeight: '500',
    minWidth: 80,
  },
  
  confirmationValue: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.text.primary,
    fontWeight: '600',
    flex: 1,
    textAlign: 'right',
  },
  
  modalActions: {
    flexDirection: 'row',
    gap: theme.spacing[3],
  },
  
  modalCancelButton: {
    flex: 1,
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
    backgroundColor: theme.colors.gray[100],
    borderRadius: theme.borderRadius.lg,
    alignItems: 'center',
  },
  
  modalCancelText: {
    fontSize: theme.typography.fontSize.base,
    fontWeight: '600',
    color: theme.colors.text.secondary,
  },
  
  modalConfirmButton: {
    flex: 1,
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
    backgroundColor: theme.colors.primary[500],
    borderRadius: theme.borderRadius.lg,
    alignItems: 'center',
  },
  
  modalConfirmText: {
    fontSize: theme.typography.fontSize.base,
    fontWeight: '600',
    color: theme.colors.text.inverse,
  },
  
  quickAmounts: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: theme.spacing[3],
    marginBottom: theme.spacing[4],
    gap: theme.spacing[2],
  },
  
  quickAmountButton: {
    flex: 1,
    backgroundColor: theme.colors.primary[50],
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: theme.colors.primary[100],
  },
  
  quickAmountText: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.primary[700],
    fontWeight: '600',
  },

  quickActionsContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: theme.spacing[4],
    marginTop: theme.spacing[3],
  },

  quickActionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.primary[50],
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[4],
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.primary[100],
    gap: theme.spacing[2],
  },

  quickActionText: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.primary[700],
    fontWeight: '500',
  },

  reviewCard: {
    backgroundColor: theme.colors.surface.primary,
    borderRadius: theme.borderRadius.xl,
    padding: theme.spacing[5],
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },

  reviewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: theme.spacing[4],
    paddingBottom: theme.spacing[4],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border.light,
  },

  reviewHeaderText: {
    marginLeft: theme.spacing[3],
    flex: 1,
  },

  reviewAmount: {
    fontSize: theme.typography.fontSize['2xl'],
    fontWeight: '700',
    color: theme.colors.text.primary,
  },

  reviewAsset: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.text.secondary,
    marginTop: theme.spacing[1],
  },

  reviewDetails: {
    marginBottom: theme.spacing[5],
  },

  reviewRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingVertical: theme.spacing[3],
    gap: theme.spacing[3],
  },

  reviewLabel: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.text.secondary,
    fontWeight: '500',
    minWidth: 80,
  },

  reviewValue: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.text.primary,
    fontWeight: '600',
    flex: 1,
    textAlign: 'right',
    lineHeight: 20,
  },

  reviewActions: {
    flexDirection: 'row',
    gap: theme.spacing[3],
  },

  reviewEditButton: {
    flex: 1,
  },

  reviewConfirmButton: {
    flex: 2,
  },

  sendingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
  },

  sendingContent: {
    backgroundColor: theme.colors.surface.primary,
    borderRadius: theme.borderRadius.xl,
    padding: theme.spacing[8],
    alignItems: 'center',
    minWidth: 200,
  },

  sendingText: {
    fontSize: theme.typography.fontSize.lg,
    fontWeight: '600',
    color: theme.colors.text.primary,
    marginTop: theme.spacing[4],
    textAlign: 'center',
  },

  sendingSubtext: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.text.secondary,
    marginTop: theme.spacing[2],
    textAlign: 'center',
  },
});

export default SendScreen;