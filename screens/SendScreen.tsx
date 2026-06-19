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
  Modal,
} from 'react-native';
import { AmountInput as WdkAmountInput, AssetSelector as WdkAssetSelector } from '@kaleidorg/kaleido-ui/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { KeyboardAvoidingView, Platform } from 'react-native';
import { useSelector, useDispatch } from 'react-redux';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { RootState } from '../store';
import { loadBtcBalance } from '../store/slices/walletSlice';
// RGBApiService removed — all operations via protocolManager
import { NetworkIcon } from '../components/NetworkIcon';
import { PressableScale } from '../components/PressableScale';
import NostrContactsSelector from '../components/NostrContactsSelector';
import { feedback } from '../utils/feedback';
import { resolveLightningAddressToInvoice } from '../utils/lnurl';
import { decodeBolt11 } from '../utils/decodeInvoice';
import type { PaymentType } from './PaymentSuccessScreen';
import { protocolManager } from '../services/protocols';
import { useRefreshableProtocolStatus } from '../hooks/useProtocol';
import {
  classifyWithdrawDestination, resolveSendRoutes, resolveActiveSendRoute,
  METHOD_META, type DestinationKind, type ResolvedSendRoute, type RouteOption,
} from '../utils/account-routing';
import { theme } from '../theme';
import { Card, Button, Input, ScreenHeader } from '../components';
import { AssetIcon as TokenAssetIcon } from '../components/AssetIcon';
import { useAssetIcon } from '../utils';
import { formatBitcoinAmount, parseInputAmount, convertAmountToUnit, useBitcoinConversion } from '../utils/bitcoinUnits';

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
  const dispatch = useDispatch<any>();
  const walletState = useSelector((state: RootState) => state.wallet);
  const assetsState = useSelector((state: RootState) => state.assets);
  const rgbAssets = (assetsState?.rgbAssets || []) as RGBAsset[];
  const btcBalance = walletState?.btcBalance;
  const isBalanceLoading = useSelector((state: RootState) => state.wallet.isBalanceLoading);
  const bitcoinUnit = useSelector((state: RootState) => state.settings.bitcoinUnit);
  const { formatSatoshisToUSD, bitcoinPrice } = useBitcoinConversion();

  // Refresh BTC balances when the screen opens — balances aren't persisted, so
  // arriving here cold (e.g. straight from the QR scanner) would otherwise show
  // a stale "0" until the next dashboard refresh.
  useEffect(() => {
    dispatch(loadBtcBalance());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
  // Amount entry mode for the WDK AmountInput. Fiat entry is only meaningful
  // for BTC (RGB assets have no USD price), so it's gated on `canEnterFiat`.
  const [amountMode, setAmountMode] = useState<'token' | 'fiat'>('token');
  const [fiatInput, setFiatInput] = useState('');
  const [showContactPicker, setShowContactPicker] = useState(false);

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

  // Spendable BTC for the currently chosen route. When a route is selected
  // (e.g. "Pays from Spark") show that account's balance specifically; before a
  // route is resolved fall back to the cross-protocol total. This is what makes
  // the amount screen show a real balance instead of "0".
  const btcSpendableSats = useCallback((): number => {
    const acct = activeRoute?.account as 'RGB' | 'SPARK' | 'ARKADE' | undefined;
    const perAccount = acct ? btcBalance?.byProtocol?.[acct]?.total : undefined;
    if (typeof perAccount === 'number') return perAccount;
    return btcBalance?.vanilla?.spendable || 0;
  }, [activeRoute?.account, btcBalance]);

  // Keep the selected asset's balance/precision in sync with live wallet data.
  // `selectedAsset` is seeded once from state at mount, so without this its
  // balance stays frozen at the mount-time value (showing "0" when balances
  // haven't loaded yet) even after the wallet/asset balances arrive.
  useEffect(() => {
    setSelectedAsset((prev) => {
      if (prev.asset_id === 'BTC') {
        const live = btcSpendableSats();
        if (live === prev.balance) return prev;
        return { ...prev, balance: live };
      }
      const live = allAssets.find((a) => a.asset_id === prev.asset_id);
      if (!live) return prev;
      if (live.balance === prev.balance && live.precision === prev.precision) return prev;
      return { ...prev, balance: live.balance, precision: live.precision };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [btcBalance, rgbAssets, activeRoute?.account]);

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
          const trimmed = input.trim();
          // Decode the BOLT11 locally first — this is node-independent, so a
          // Lightning invoice is recognized on any wallet (e.g. Spark-only),
          // not just when the RGB node is connected.
          const local = decodeBolt11(trimmed);
          const decoded: any = {
            payment_hash: '',
            amt_msat: local.amountSats ? local.amountSats * 1000 : 0,
            asset_id: undefined,
            asset_amount: undefined,
            description: local.description || '',
            expiry_sec: local.expirySec || 0,
            payee_pubkey: '',
          };

          // Enrich with RGB-over-LN details (asset_id / asset_amount) only when
          // the RGB node is available — best-effort, never blocks detection.
          const rgbAdapter = protocolManager.getAdapterIfAvailable?.('RGB');
          if (rgbAdapter?.decodeInvoice) {
            try {
              const r: any = await rgbAdapter.decodeInvoice(trimmed);
              decoded.payment_hash = r.paymentHash || r.payment_hash || decoded.payment_hash;
              decoded.amt_msat = r.amountMsat || r.amount_msat || (r.amount ? r.amount * 1000 : decoded.amt_msat);
              decoded.asset_id = r.asset_id ?? decoded.asset_id;
              decoded.asset_amount = r.asset_amount ?? decoded.asset_amount;
              decoded.description = r.description || decoded.description;
              decoded.payee_pubkey = r.destination || r.payee_pubkey || decoded.payee_pubkey;
            } catch { /* keep the local decode */ }
          }

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
            // BTC Lightning invoice with amount — set it in the active entry
            // unit so it displays correctly (sats vs BTC).
            const sats = Math.round(decoded.amt_msat / 1000);
            setAmount(bitcoinUnit === 'sats' ? String(sats) : (sats / 1e8).toFixed(8));
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
          const rgbAdapterRgb = protocolManager.getAdapterIfAvailable('RGB');
          // Decoding requires the RGB/NWC node — don't call it offline.
          if (!rgbAdapterRgb?.isConnected()) {
            setAddressType('invalid');
            setValidationError('RGB node not connected. Please connect it in Settings.');
            return;
          }
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
  }, [allAssets, bitcoinUnit]);

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

  const handleSelectContact = (contact: { name?: string; lightning_address?: string; node_pubkey?: string }) => {
    const dest = contact.lightning_address || contact.node_pubkey;
    if (!dest) {
      Alert.alert('No payment method', 'This contact has no Lightning address or pubkey.');
      return;
    }
    feedback.select();
    setShowContactPicker(false);
    setAddress(dest);
    detectAddressType(dest);
  };

  const getMaxAmount = (): string => {
    if (!selectedAsset) return '0';
    
    if (selectedAsset.asset_id === 'BTC') {
      const availableBalance = selectedAsset.balance || 0; // sats
      // Return in the active entry unit so it matches `amount` (and the
      // clamp/compare logic) regardless of the sats/BTC setting.
      return bitcoinUnit === 'sats'
        ? String(Math.floor(availableBalance))
        : (availableBalance / 100000000).toFixed(8);
    } else {
      const balance = selectedAsset.balance || 0;
      const precision = selectedAsset.precision || 8;
      return (balance / Math.pow(10, precision)).toFixed(precision);
    }
  };

  // Format available balance. getMaxAmount() returns a display string in the
  // asset's own units (BTC for the BTC asset, precision-scaled for RGB assets).
  // BTC balances are sats-native, so render them via the explicit sats formatter;
  // other assets are already in display units and keep their ticker.
  const maxAmount = getMaxAmount();
  const isBtcAsset = selectedAsset?.asset_id === 'BTC';
  const availableLabel = isBtcAsset
    ? `${formatBitcoinAmount(selectedAsset?.balance || 0, bitcoinUnit)} ${bitcoinUnit}`
    : `${maxAmount} ${selectedAsset?.ticker || ''}`;

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

    // Validate balance in the asset's SMALLEST unit. `selectedAsset.balance` is
    // already raw (sats for BTC, base units for RGB) and `amount` is entered in
    // the active bitcoinUnit — comparing a sats input against a whole-BTC balance
    // (the old bug) produced false "Insufficient Balance" errors in sats mode.
    // Only enforce the client-side balance check when we actually know a
    // positive balance. If it's still 0 (balances load asynchronously and
    // aren't persisted), skip it and let the protocol report a real shortfall —
    // otherwise a slow balance load blocks an otherwise-valid payment.
    if (selectedAsset && (selectedAsset.balance || 0) > 0) {
      const isBtc = selectedAsset.asset_id === 'BTC';
      const precision = selectedAsset.precision || 8;
      const availableRaw = selectedAsset.balance || 0;
      const inputRaw = isBtc
        ? (bitcoinUnit === 'BTC'
            ? Math.round((parseFloat(amount || '0') || 0) * 1e8)
            : Math.round(parseFloat(amount || '0') || 0))
        : Math.round((parseFloat(amount || '0') || 0) * Math.pow(10, precision));

      if (inputRaw > availableRaw) {
        const availableDisplay = isBtc
          ? `${formatBitcoinAmount(availableRaw, bitcoinUnit)} ${bitcoinUnit}`
          : `${(availableRaw / Math.pow(10, precision)).toFixed(precision)} ${selectedAsset.ticker}`;
        Alert.alert(
          'Insufficient Balance',
          `You don't have enough ${selectedAsset.ticker}. Available: ${availableDisplay}`
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

      // Captured per branch so we navigate to a single, consistent success
      // screen instead of a bare Alert.
      let successType: PaymentType = 'lightning';
      let result: any = null;

      if (method === 'spark') {
        // Spark transfer
        const sparkAdapter = protocolManager.getAdapter('SPARK');
        const amountSats = bitcoinUnit === 'BTC'
          ? Math.round(parseFloat(amount) * 1e8)
          : Math.round(parseFloat(amount));
        result = await sparkAdapter.sendPayment({ invoice: address, amount: amountSats });
        successType = 'spark';

      } else if (method === 'arkade' || method === 'boarding') {
        // Arkade transfer or offboard
        const arkadeAdapter = protocolManager.getAdapter('ARKADE');
        const amountSats = bitcoinUnit === 'BTC'
          ? Math.round(parseFloat(amount) * 1e8)
          : Math.round(parseFloat(amount));

        const feeSats = await assertArkadeFeeCovered(arkadeAdapter, address, amountSats);
        result = method === 'boarding' && typeof arkadeAdapter.sendBtcOnchain === 'function'
          ? await arkadeAdapter.sendBtcOnchain({ address, amount: amountSats })
          : await arkadeAdapter.sendPayment({ invoice: address, amount: amountSats });
        ensureSuccessfulArkadeResult(result);
        if (result.fee == null || Number(result.fee) === 0) {
          result = { ...result, fee: feeSats };
        }
        successType = method === 'boarding' ? 'boarding' : 'arkade';

      } else if (addressType === 'lightning' || addressType === 'lightning-address' || addressType === 'lnurl-pay') {
        // Lightning payment — route to the correct protocol
        const lnAdapter = protocolManager.getAdapter(protocol);
        const enteredSats = amountSatsFromBtcUnits(amount);

        // A Lightning address / LNURL is not payable directly — resolve it to a
        // concrete BOLT11 invoice for the entered amount first (protocols like
        // Spark can only pay an invoice, not a user@domain string).
        let invoiceToPay = address;
        if (addressType === 'lightning-address' || addressType === 'lnurl-pay') {
          if (enteredSats <= 0) throw new Error('Enter an amount to pay this Lightning address.');
          invoiceToPay = await resolveLightningAddressToInvoice(address, enteredSats);
        }

        // Amountless (0-amount) BOLT11: the invoice carries no amount, so pass
        // the entered amount explicitly — required by Spark, honored by RGB.
        const isAmountlessInvoice =
          addressType === 'lightning' &&
          (!decodedInvoice || !decodedInvoice.amt_msat || decodedInvoice.amt_msat === 0) &&
          !decodedInvoice?.asset_id;
        if (isAmountlessInvoice && enteredSats <= 0) {
          throw new Error('Enter an amount to pay this Lightning invoice.');
        }

        result = await lnAdapter.sendPayment(
          isAmountlessInvoice
            ? { invoice: invoiceToPay, amount: enteredSats }
            : { invoice: invoiceToPay },
        );
        successType = 'lightning';

      } else if (addressType === 'bitcoin') {
        // On-chain BTC — route to correct protocol
        const feeRateNum = feeRate === 'custom' ? customFee : feeRates.find(f => f.value === feeRate)?.rate || 2;
        const btcAdapter = protocolManager.getAdapter(protocol);
        // sendBtcOnchain expects sats; convert from the active unit (BTC mode
        // previously sent e.g. 0.001 instead of 100000 sats).
        const onchainSats = bitcoinUnit === 'BTC'
          ? Math.round(parseFloat(amount) * 1e8)
          : Math.round(parseFloat(amount));
        if (typeof btcAdapter.sendBtcOnchain !== 'function') {
          throw new Error(`${protocol} does not support Bitcoin on-chain withdrawals from this wallet version.`);
        }
        result = await btcAdapter.sendBtcOnchain({ address, amount: onchainSats, feeRate: feeRateNum });
        ensureSuccessfulProtocolResult(result, `${protocol} on-chain withdrawal`);
        successType = 'bitcoin';

      } else if (addressType === 'rgb') {
        const rgbSendAdapter = protocolManager.getAdapterIfAvailable('RGB');
        // Don't attempt an RGB send over a node that isn't connected.
        if (!rgbSendAdapter?.isConnected()) {
          throw new Error('RGB node not connected. Please connect it in Settings.');
        }
        // RGB amounts are base units (input is whole tokens) — scale by precision,
        // otherwise "10" would send 10 base units (0.00001 of a precision-6 asset).
        const rgbBaseUnits = Math.round((parseFloat(amount) || 0) * Math.pow(10, selectedAsset.precision || 8));
        result = await rgbSendAdapter.sendAsset?.({ asset_id: selectedAsset.asset_id, recipientId: address, amount: rgbBaseUnits });
        successType = 'rgb';
      }

      goToPaymentSuccess(successType, result);
    } catch (error) {
      console.error('Send error:', error);
      feedback.error();
      setPaymentStep('review');
      Alert.alert(
        'Payment Failed',
        error instanceof Error ? error.message : 'Failed to send payment'
      );
    } finally {
      setLoading(false);
    }
  };

  const assertArkadeFeeCovered = async (
    arkadeAdapter: any,
    destination: string,
    amountSats: number,
  ): Promise<number> => {
    const quote = await arkadeAdapter.executeProtocolOperation?.('quoteSendTransaction', {
      to: destination,
      value: amountSats,
    });
    const feeSats = Number(quote?.fee);
    if (!Number.isFinite(feeSats)) {
      throw new Error('Could not estimate the Arkade network fee. Please try again.');
    }

    const balance = await arkadeAdapter.getBtcBalance?.();
    const availableSats = Number(balance?.total ?? balance?.confirmed ?? 0);
    if (!Number.isFinite(availableSats)) {
      throw new Error('Could not read your Arkade balance. Please try again.');
    }
    if (amountSats + feeSats > availableSats) {
      throw new Error(
        `Insufficient Arkade balance. This payment needs ${amountSats.toLocaleString()} sats plus a ${feeSats.toLocaleString()} sats network fee.`
      );
    }

    return feeSats;
  };

  const ensureSuccessfulArkadeResult = (result: any) => {
    if (!result) {
      throw new Error('Arkade did not return a payment result.');
    }
    if (result.status === 'failed' || result.error) {
      throw new Error(result.error || 'Arkade payment failed.');
    }
    const reference = result.txid || result.txId || result.paymentHash || result.payment_hash || result.hash;
    if (!reference || (typeof reference === 'string' && reference.trim() === '')) {
      throw new Error('Arkade did not return a transaction ID. The payment was not confirmed.');
    }
  };

  const ensureSuccessfulProtocolResult = (result: any, label: string) => {
    if (!result) {
      throw new Error(`${label} did not return a payment result.`);
    }
    if (result.status === 'failed' || result.error) {
      throw new Error(result.error || `${label} failed.`);
    }
    const reference = result.txid || result.txId || result.paymentHash || result.payment_hash || result.hash;
    if (!reference || (typeof reference === 'string' && reference.trim() === '')) {
      throw new Error(`${label} did not return a transaction ID.`);
    }
  };

  // Builds the display payload from current state and routes to the clean
  // success screen (which owns the success haptic + chime). `result` is the
  // adapter return value, mined for a txid / payment hash / preimage reference.
  const goToPaymentSuccess = (paymentType: PaymentType, result: any) => {
    const isBtc = selectedAsset.asset_id === 'BTC';
    const unit = isBtc ? bitcoinUnit : selectedAsset.ticker;
    const fiat = isBtc && bitcoinPrice > 0 && amount
      ? `≈ $${parseFloat(formatSatoshisToUSD(amountSatsFromBtcUnits(amount))).toLocaleString()}`
      : undefined;

    const reference =
      result?.txid || result?.txId || result?.payment_hash ||
      result?.paymentHash || result?.hash || result?.preimage || undefined;
    const referenceLabel =
      paymentType === 'lightning' ? 'Payment hash'
      : paymentType === 'rgb' ? 'Transaction'
      : 'Transaction ID';

    // Surface the on-chain fee rate on the receipt for on-chain sends only
    // (same rule as the fee selector).
    const fee = result?.fee != null && Number.isFinite(Number(result.fee))
      ? `${Number(result.fee).toLocaleString()} sats`
      : (addressType === 'bitcoin' || addressType === 'rgb')
      ? `${feeRate === 'custom' ? customFee : feeRates.find(f => f.value === feeRate)?.rate} sat/vB`
      : undefined;

    navigation.navigate('PaymentSuccess', {
      amount: amount || '0',
      unit,
      fiat,
      recipient: address,
      paymentType,
      status: result?.status === 'pending' ? 'pending' : 'confirmed',
      fee,
      reference: typeof reference === 'string' ? reference : undefined,
      referenceLabel,
    });
  };

  // Real asset iconography (CDN logos, e.g. the orange ₿ for BTC) with an RGB
  // protocol badge — matching the WDK asset-selector rows shown in the modal,
  // instead of generic Ionicons glyphs.
  const AssetIcon = ({ asset }: { asset: Asset }) => {
    if (!asset) return null;
    return (
      <View style={styles.assetIconContainer}>
        <TokenAssetIcon
          ticker={asset.ticker}
          name={asset.name}
          protocol={asset.isRGB ? 'RGB' : undefined}
          showBadge={!!asset.isRGB}
          size={36}
        />
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

  // Once a recipient is decoded we collapse the raw input into a compact
  // summary — there's no value in showing a 400-char Lightning invoice in full.
  const isLnDest = addressType === 'lightning' || addressType === 'lightning-address' || addressType === 'lnurl-pay';
  const recipientLocked = !!address && addressType !== 'unknown' && addressType !== 'invalid' && !isDecodingInvoice;
  const recipientColor = isLnDest ? theme.colors.networks.lightning
    : addressType === 'spark' ? theme.colors.networks.spark
    : addressType === 'arkade' ? theme.colors.networks.arkade
    : addressType === 'bitcoin' ? theme.colors.networks.onchain
    : theme.colors.primary[500];
  const recipientNetwork = isLnDest ? 'lightning'
    : addressType === 'spark' ? 'spark'
    : addressType === 'arkade' ? 'arkade'
    : addressType === 'bitcoin' ? 'bitcoin'
    : 'rgb';
  const recipientLabel = addressType === 'lightning' ? 'Lightning Invoice'
    : addressType === 'lightning-address' ? 'Lightning Address'
    : addressType === 'lnurl-pay' ? 'LNURL Pay'
    : addressType === 'spark' ? 'Spark Address'
    : addressType === 'arkade' ? 'Arkade Address'
    : addressType === 'bitcoin' ? 'Bitcoin Address'
    : 'RGB Invoice';

  const renderAddressInput = () => (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Who are you paying?</Text>
      {!recipientLocked && (
        <Text style={styles.sectionDescription}>
          Paste or scan an address/invoice, or pick a contact. We'll work out the rest.
        </Text>
      )}

      {recipientLocked ? (
        <View style={styles.recipientCard}>
          <View style={[styles.recipientIcon, { backgroundColor: recipientColor }]}>
            <NetworkIcon network={recipientNetwork} size={16} color="white" />
          </View>
          <View style={styles.recipientBody}>
            <Text style={styles.recipientType}>{recipientLabel}</Text>
            <Text style={styles.recipientAddress} numberOfLines={1} ellipsizeMode="middle">
              {address}
            </Text>
          </View>
          <TouchableOpacity
            onPress={() => { feedback.select(); setAddress(''); detectAddressType(''); }}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="close-circle" size={24} color={theme.colors.text.muted} />
          </TouchableOpacity>
        </View>
      ) : (
        <Input
          placeholder="Address, invoice, or Lightning address…"
          value={address}
          onChangeText={(text) => {
            setAddress(text);
            detectAddressType(text);
          }}
          variant="outlined"
          rightIcon={address ? (
            <TouchableOpacity
              onPress={() => { setAddress(''); detectAddressType(''); }}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="close-circle" size={20} color={theme.colors.text.muted} />
            </TouchableOpacity>
          ) : undefined}
        />
      )}

      {/* Empty-state entry methods — the primary way to start a payment.
          Shown only before a recipient is entered; once `address` is set the
          input + clear button take over and these collapse. */}
      {!address && (
        <View style={styles.entryMethods}>
          <PressableScale
            style={styles.entryPrimary}
            onPress={() => { feedback.select(); navigation.navigate('QRScanner'); }}
          >
            <Ionicons name="qr-code-outline" size={22} color={theme.colors.text.inverse} />
            <Text style={styles.entryPrimaryText}>Scan QR code</Text>
          </PressableScale>
          <View style={styles.entrySecondaryRow}>
            <PressableScale style={styles.entrySecondary} onPress={handlePasteFromClipboard}>
              <Ionicons name="clipboard-outline" size={20} color={theme.colors.primary[500]} />
              <Text style={styles.entrySecondaryText}>Paste</Text>
            </PressableScale>
            <PressableScale style={styles.entrySecondary} onPress={() => { feedback.select(); setShowContactPicker(true); }}>
              <Ionicons name="people-outline" size={20} color={theme.colors.primary[500]} />
              <Text style={styles.entrySecondaryText}>Contacts</Text>
            </PressableScale>
          </View>
        </View>
      )}

      {/* Route selector — whenever more than one account can pay the
          destination, always let the user choose which to spend from. The
          auto-router still pre-selects the best route as the default. */}
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
                onPress={() => { if (!disabled) { feedback.select(); setActiveRoute({ ...route, protocol: route.account }); } }}
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

  // ── WDK AssetSelector mapping ──────────────────────────────────────────
  // CDN → DiceBear logo, matching components/AssetIcon's resolution order.
  const assetLogoUri = (ticker: string): string => {
    const norm = ticker.toUpperCase().trim();
    if (/^[A-Z0-9-]{1,12}$/.test(norm)) {
      return `https://raw.githubusercontent.com/kaleidoswap/coinmarketcap-icons-cryptos/refs/heads/main/icons/${norm.toLowerCase()}.png`;
    }
    return `https://api.dicebear.com/9.x/shapes/svg?seed=${encodeURIComponent(ticker)}&backgroundType=gradientLinear&radius=50`;
  };
  const ASSET_COLORS: Record<string, string> = {
    BTC: '#F7931A', USDT: '#26A17B', USDC: '#2775CA', XAUT: '#D4AF37',
  };

  const assetToToken = (a: Asset) => {
    const isBtc = a.asset_id === 'BTC';
    const balanceStr = isBtc
      ? `${formatBitcoinAmount(a.balance || 0, bitcoinUnit)} ${bitcoinUnit}`
      : `${((a.balance || 0) / Math.pow(10, a.precision || 8)).toLocaleString(undefined, { maximumFractionDigits: a.precision || 8 })}`;
    return {
      id: a.asset_id,
      symbol: a.ticker,
      name: a.name,
      balance: balanceStr,
      balanceUSD: isBtc ? `$${formatSatoshisToUSD(a.balance || 0)}` : '',
      icon: { uri: assetLogoUri(a.ticker) },
      color: ASSET_COLORS[a.ticker.toUpperCase()] || '#64748B',
      hasBalance: (a.balance || 0) > 0,
    };
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
          onPress={() => { feedback.select(); setShowAssetSelector(true); }}
        >
          <AssetIcon asset={selectedAsset} />
          <View style={styles.assetInfo}>
            <Text style={styles.assetTicker}>{selectedAsset.ticker}</Text>
            <Text style={styles.assetName}>{selectedAsset.name}</Text>
            <Text style={styles.assetBalance}>
              Balance: {selectedAsset.asset_id === 'BTC'
                ? `${formatBitcoinAmount(selectedAsset.balance || 0, bitcoinUnit)} ${bitcoinUnit}`
                : `${((selectedAsset.balance || 0) / Math.pow(10, selectedAsset.precision || 8)).toFixed(selectedAsset.precision || 8)} ${selectedAsset.ticker}`}
            </Text>
          </View>
          <Ionicons name="chevron-down" size={20} color={theme.colors.text.secondary} />
        </TouchableOpacity>

        <Modal
          visible={showAssetSelector}
          transparent
          animationType="slide"
          onRequestClose={() => setShowAssetSelector(false)}
        >
          <View style={styles.assetSheetBackdrop}>
            <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setShowAssetSelector(false)} />
            <View style={styles.assetSheet}>
              <View style={styles.assetSheetHandle} />
              <View style={styles.assetSheetHeader}>
                <Text style={styles.assetSheetTitle}>Select asset</Text>
                <TouchableOpacity onPress={() => setShowAssetSelector(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                  <Ionicons name="close" size={24} color={theme.colors.text.secondary} />
                </TouchableOpacity>
              </View>
              <WdkAssetSelector
                tokens={allAssets.map(assetToToken)}
                recentTokens={['BTC']}
                onSelectToken={(token) => {
                  const picked = allAssets.find((a) => a.asset_id === token.id);
                  if (picked) {
                    feedback.select();
                    setSelectedAsset(picked);
                    setAmountMode('token');
                  }
                  setShowAssetSelector(false);
                }}
              />
            </View>
          </View>
        </Modal>
      </View>
    );
  };

  // Canonical amount (`amount`) is always in the asset's display units (BTC or
  // sats for BTC per bitcoinUnit; precision-scaled units for RGB). The WDK
  // AmountInput drives this via token or (BTC-only) fiat entry.
  const setAmountClamped = (next: string) => {
    const maxNum = parseFloat(getMaxAmount());
    // Only clamp once we actually know a positive spendable balance. While
    // balances are still loading (max is 0/unknown) clamping would silently
    // force the entry back to 0 — that's what previously sent a 0-amount
    // Lightning payment to Spark. validateInputs() still catches real overspends.
    if (maxNum > 0 && parseFloat(next || '0') > maxNum) {
      setAmount(getMaxAmount());
      return;
    }
    setAmount(next);
  };

  const amountSatsFromBtcUnits = (v: string): number =>
    bitcoinUnit === 'BTC' ? Math.round((parseFloat(v) || 0) * 1e8) : Math.round(parseFloat(v) || 0);

  const handleAmountChange = (text: string) => {
    const clean = text.replace(/[^0-9.]/g, '');
    const parts = clean.split('.');
    if (parts.length > 2) return; // single decimal point

    if (amountMode === 'fiat') {
      if (parts[1] && parts[1].length > 2) return; // cents
      setFiatInput(clean);
      const usd = parseFloat(clean) || 0;
      const sats = bitcoinPrice > 0 ? Math.round((usd / bitcoinPrice) * 1e8) : 0;
      setAmountClamped(bitcoinUnit === 'BTC' ? (sats / 1e8).toFixed(8) : String(sats));
      return;
    }

    const maxDecimals = selectedAsset.asset_id === 'BTC'
      ? (bitcoinUnit === 'BTC' ? 8 : 0)
      : (selectedAsset.precision || 8);
    if (parts[1] && parts[1].length > maxDecimals) return;
    const normalized = selectedAsset.asset_id === 'BTC' ? parseInputAmount(clean, bitcoinUnit) : clean;
    setAmountClamped(normalized);
  };

  const renderAmountInput = () => {
    // Don't show amount input if invoice specifies the amount
    const invoiceHasAmount = (addressType === 'lightning' && decodedInvoice?.amt_msat && decodedInvoice.amt_msat > 0) ||
                          (addressType === 'rgb' && decodedRGBInvoice?.amount);

    if (invoiceHasAmount) {
      return null;
    }

    const isBtc = selectedAsset.asset_id === 'BTC';
    const canEnterFiat = isBtc && bitcoinPrice > 0;
    const maxAmount = getMaxAmount();

    const tokenSymbol = isBtc ? bitcoinUnit : selectedAsset.ticker;
    const tokenBalance = isBtc
      ? `${formatBitcoinAmount(selectedAsset.balance || 0, bitcoinUnit)}`
      : `${((selectedAsset.balance || 0) / Math.pow(10, selectedAsset.precision || 8)).toLocaleString(undefined, { maximumFractionDigits: selectedAsset.precision || 8 })}`;
    const tokenBalanceUSD = isBtc ? `$${formatSatoshisToUSD(selectedAsset.balance || 0)}` : '—';

    // Secondary conversion line.
    const secondary = (() => {
      if (!amount) return '';
      if (amountMode === 'token' && isBtc) {
        return `≈ $${formatSatoshisToUSD(amountSatsFromBtcUnits(amount))} USD`;
      }
      if (amountMode === 'fiat') {
        return `≈ ${formatBitcoinAmount(amountSatsFromBtcUnits(amount), bitcoinUnit)} ${bitcoinUnit}`;
      }
      return '';
    })();

    const onToggleMode = () => {
      if (!canEnterFiat) return;
      feedback.select();
      setAmountMode((m) => {
        const next = m === 'token' ? 'fiat' : 'token';
        if (next === 'fiat') {
          setFiatInput(amount ? formatSatoshisToUSD(amountSatsFromBtcUnits(amount)) : '');
        }
        return next;
      });
    };

    const balanceLoading = isBtc && isBalanceLoading && (selectedAsset.balance || 0) === 0;

    return (
      <View style={styles.section}>
        <WdkAmountInput
          label={`Amount (${amountMode === 'fiat' ? 'USD' : tokenSymbol})`}
          value={amountMode === 'fiat' ? fiatInput : amount}
          onChangeText={handleAmountChange}
          tokenSymbol={tokenSymbol}
          tokenBalance={balanceLoading ? 'Loading…' : tokenBalance}
          tokenBalanceUSD={balanceLoading ? '' : tokenBalanceUSD}
          inputMode={amountMode}
          onToggleInputMode={onToggleMode}
          onUseMax={() => { feedback.select(); setAmountMode('token'); setAmount(maxAmount); }}
          error={validationError || undefined}
          editable={!loading}
        />

        {secondary ? <Text style={styles.amountSecondary}>{secondary}</Text> : null}
      </View>
    );
  };

  const renderFeeSelector = () => {
    // Match rate-extension: the sat/vB fee rate applies to on-chain operations
    // only — a plain Bitcoin send and an RGB transfer (which anchors a UTXO on
    // L1). Lightning, Spark and Arkade transfers carry no on-chain fee rate.
    if (addressType !== 'bitcoin' && addressType !== 'rgb') {
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

    // No recipient yet → the empty-state hero (Scan / Paste / Contacts) owns
    // entry, so we don't show a dead sticky CTA here. Avoid the previous
    // duplicate action rows and the non-actionable "Enter Address" button.
    if (!hasAddress) return null;

    const canSend = hasAmount;
    const buttonTitle = hasAmount ? 'Review Payment' : 'Enter Amount';

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

      {/* Keep the focused amount field above the keyboard. */}
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
      >
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
        >
          {paymentStep === 'input' && (
            <>
              {renderAddressInput()}
              {/* Destination-first: only reveal the payment details once we've
                  decoded a valid recipient, so the screen starts focused on
                  paste / scan / pick-a-contact. */}
              {address && addressType !== 'unknown' && addressType !== 'invalid' && !isDecodingInvoice && (
                <>
                  {renderAssetSelector()}
                  {renderAmountInput()}
                  {renderFeeSelector()}
                </>
              )}
            </>
          )}
          {renderPaymentReview()}
        </ScrollView>

        {renderSendButton()}
      </KeyboardAvoidingView>

      <NostrContactsSelector
        visible={showContactPicker}
        onSelectContact={handleSelectContact}
        onClose={() => setShowContactPicker(false)}
      />

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
  
  flex: {
    flex: 1,
  },

  scrollView: {
    flex: 1,
  },

  recipientCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[3],
    padding: theme.spacing[3] + 2,
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface.primary,
    borderWidth: 1,
    borderColor: theme.colors.border.light,
  },
  recipientIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recipientBody: {
    flex: 1,
  },
  recipientType: {
    fontSize: theme.typography.fontSize.xs,
    fontWeight: '700',
    color: theme.colors.text.tertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 2,
  },
  recipientAddress: {
    fontSize: theme.typography.fontSize.sm,
    fontFamily: 'monospace',
    color: theme.colors.text.primary,
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
  
  entryMethods: {
    marginTop: theme.spacing[5],
    gap: theme.spacing[3],
  },

  entryPrimary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[4],
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.primary[500],
    minHeight: 56,
    ...theme.shadows.sm,
  },

  entryPrimaryText: {
    fontSize: theme.typography.fontSize.base,
    fontWeight: '700',
    color: theme.colors.text.inverse,
  },

  entrySecondaryRow: {
    flexDirection: 'row',
    gap: theme.spacing[3],
  },

  entrySecondary: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface.primary,
    borderWidth: 1,
    borderColor: theme.colors.border.light,
    minHeight: 48,
  },

  entrySecondaryText: {
    fontSize: theme.typography.fontSize.sm,
    fontWeight: '600',
    color: theme.colors.text.primary,
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
    backgroundColor: theme.colors.networks.lightning,
  },

  bitcoinIcon: {
    backgroundColor: theme.colors.networks.bitcoin,
  },

  rgbIcon: {
    backgroundColor: theme.colors.primary[500],
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
  assetSheetBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  assetSheet: {
    maxHeight: '80%',
    backgroundColor: theme.colors.background.secondary,
    borderTopLeftRadius: theme.borderRadius['2xl'],
    borderTopRightRadius: theme.borderRadius['2xl'],
    paddingTop: theme.spacing[3],
    paddingBottom: theme.spacing[6],
  },
  assetSheetHandle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: theme.colors.border.medium,
    marginBottom: theme.spacing[3],
  },
  assetSheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing[5],
    marginBottom: theme.spacing[3],
  },
  assetSheetTitle: {
    fontSize: theme.typography.fontSize.lg,
    fontWeight: '700',
    color: theme.colors.text.primary,
  },
  amountSecondary: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.text.tertiary,
    marginTop: -theme.spacing[2],
    marginBottom: theme.spacing[2],
    marginLeft: theme.spacing[1],
  },

  assetIconContainer: {
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
