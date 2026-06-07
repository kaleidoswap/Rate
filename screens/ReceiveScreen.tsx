// screens/ReceiveScreen.tsx
import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  Share,
  Clipboard,
  ActivityIndicator,
  Image,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSelector } from 'react-redux';
import QRCode from 'react-native-qrcode-svg';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { RootState } from '../store';
// RGBApiService removed — all operations via protocolManager
import { protocolManager } from '../services/protocols';
import { buildUnifiedReceiveURI, LITE_USD } from '@kaleidorg/wallet-engine';
import { selectDisclosureLevel } from '../store/slices/settingsSlice';
import { useRefreshableProtocolStatus } from '../hooks/useProtocol';
import {
  getAssetFamily, resolveReceiveAccounts, getNetworkTypesForAccount,
  type AccountId, type NetworkType as ProtocolNetworkType,
} from '../utils/account-routing';
import { theme } from '../theme';
import { Card, Button, Input, ScreenHeader } from '../components';
import DepositSuccessOverlay from '../components/DepositSuccessOverlay';
import { useDepositDetection } from '../hooks/useDepositDetection';
import { AssetIcon } from '../components/AssetIcon';
import { AssetSelector, type SelectableAsset } from '../components/AssetSelector';
import { NetworkIcon } from '../components/NetworkIcon';
import { UsdCoinIcon } from '../components/ProtocolIcons';
import { QrCode } from '@kaleidorg/kaleido-ui/native';
import { AmountEditorModal } from '../components/AmountEditorModal';
import { NewAssetSheet, type NewAssetKind } from '../components/NewAssetSheet';
import { useFiatRates } from '../hooks/useFiatRates';
import { PressableScale } from '../components/PressableScale';
import { feedback } from '../utils/feedback';
import { useFormattedBitcoinAmount, parseInputAmount, useBitcoinConversion } from '../utils/bitcoinUnits';

// Sentinel asset id for receiving an RGB asset the user doesn't hold yet
// (generates a blind RGB invoice with no specific asset_id).
const NEW_RGB_ASSET_ID = 'RGB_NEW';

interface Props {
  navigation: any;
}

interface RGBAsset {
  asset_id: string;
  ticker: string;
  name: string;
  precision?: number;
  balance: number;
}

interface Asset {
  asset_id: string;
  ticker: string;
  name: string;
  isRGB: boolean;
  balance?: number;
}

interface Channel {
  channel_id: string;
  funding_txid: string;
  peer_pubkey: string;
  peer_alias: string;
  short_channel_id: number;
  status: 'Opening' | 'Opened' | 'Closing';
  ready: boolean;
  capacity_sat: number;
  local_balance_sat: number;
  outbound_balance_msat: number;
  inbound_balance_msat: number;
  next_outbound_htlc_limit_msat: number;
  next_outbound_htlc_minimum_msat: number;
  is_usable: boolean;
  public: boolean;
  asset_id: string;
  asset_local_amount: number;
  asset_remote_amount: number;
}

export default function ReceiveScreen({ navigation }: Props) {
  const walletState = useSelector((state: RootState) => state.wallet);
  const assetsState = useSelector((state: RootState) => state.assets);
  const bitcoinUnit = useSelector((state: RootState) => state.settings.bitcoinUnit);
  const { formatSatoshisToUSD } = useBitcoinConversion();
  
  // Safe destructuring with fallbacks
  const rgbAssets = (assetsState?.rgbAssets || []) as RGBAsset[];
  const btcBalance = walletState?.btcBalance;
  

  
  // Get asset precision for validation (similar to desktop app)
  const getAssetPrecision = (ticker: string): number => {
    if (ticker === 'BTC') {
      return bitcoinUnit === 'BTC' ? 8 : 0; // 8 decimals for BTC, 0 for sats
    }
    const rgbAsset = rgbAssets.find(asset => asset.ticker === ticker);
    return rgbAsset?.precision || 8; // Default to 8 if not found
  };

  // Format asset amount with proper precision
  const formatAssetAmount = (amount: number, ticker: string): string => {
    const precision = getAssetPrecision(ticker);
    return amount.toFixed(precision);
  };
  
  // Must call hooks first before any other code
  const getProtocolStatus = useRefreshableProtocolStatus();

  const [selectedAsset, setSelectedAsset] = useState<Asset>({
    asset_id: 'BTC',
    ticker: 'BTC',
    name: 'Bitcoin',
    isRGB: false,
  });

  // Default to first available network based on connected protocols
  const getDefaultNetwork = (): ProtocolNetworkType => {
    const status = getProtocolStatus();
    if (status.SPARK) return 'spark';
    if (status.RGB) return 'onchain';
    if (status.ARKADE) return 'arkade';
    return 'onchain';
  };
  // Network selection allows the per-protocol types plus a 'unified' single-QR mode.
  type ReceiveMode = ProtocolNetworkType | 'unified';
  // Default to the single "All networks" QR; specific networks are opt-in.
  const [networkType, setNetworkType] = useState<ReceiveMode>('unified');
  const [address, setAddress] = useState('');
  // Unified receive (single BIP21 QR embedding all available methods)
  const [unifiedUri, setUnifiedUri] = useState('');
  const [unifiedLoading, setUnifiedLoading] = useState(false);
  const [unifiedError, setUnifiedError] = useState<string | null>(null);
  const [unifiedMethods, setUnifiedMethods] = useState<string[]>([]);
  // Per-method address breakdown for the Pro/advanced address list.
  const [unifiedAddresses, setUnifiedAddresses] = useState<
    Array<{ key: string; label: string; value: string }>
  >([]);
  const [showAddressInfo, setShowAddressInfo] = useState(false);
  // Per-address "show full" toggles in the unified address list (keyed by row).
  const [expandedAddrs, setExpandedAddrs] = useState<Record<string, boolean>>({});
  // Collapse/expand the full address inside the single-network receive card.
  const [showFullAddr, setShowFullAddr] = useState(false);
  // Unified-receive asset selector: BTC (default) or USD. USD builds a BIP321 QR
  // embedding the USD-receiving methods (Liquid USDt, RGB USDT invoice, Spark).
  const [unifiedAsset, setUnifiedAsset] = useState<'BTC' | 'USD'>('BTC');
  // Lite mode: a single private BIP321 QR (BTC/$ toggle) with the advanced
  // network picker hidden behind "Show all networks".
  const disclosureLevel = useSelector(selectDisclosureLevel);
  const isLite = disclosureLevel === 'lite';
  const [showAllNetworks, setShowAllNetworks] = useState(false);
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [showAssetSelector, setShowAssetSelector] = useState(false);
  // "+" opens the new-asset chooser (Spark / Arkade / new RGB asset).
  const [showNewAsset, setShowNewAsset] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [channelsLoading, setChannelsLoading] = useState(false);
  const [maxDepositAmount, setMaxDepositAmount] = useState<number>(0);
  const [isUserTyping, setIsUserTyping] = useState(false);
  const [arkadeSubMode, setArkadeSubMode] = useState<'ark' | 'boarding'>('ark');
  // Network selector dropdown (All selected by default; specific networks hidden).
  const [showNetworkDropdown, setShowNetworkDropdown] = useState(false);
  // Multi-currency amount editor (BTC / sats / USD / other fiat).
  const [showAmountEditor, setShowAmountEditor] = useState(false);
  const [showDepositSuccess, setShowDepositSuccess] = useState(false);

  // Watch for an incoming deposit whenever a receive address / invoice is shown,
  // then celebrate with the success overlay (mirrors rate-extension).
  const receiveTarget = unifiedUri || address;
  const handleDepositDetected = React.useCallback(() => {
    feedback.swap();
    setShowDepositSuccess(true);
  }, []);
  useDepositDetection({
    enabled: !!receiveTarget && !showDepositSuccess,
    networkType,
    assetId: selectedAsset?.asset_id,
    invoice: networkType === 'lightning' ? address : undefined,
    onDetected: handleDepositDetected,
  });
  const fiatRates = useFiatRates();

  // Channel helpers — drive which RGB networks are actually receivable.
  const hasAnyUsableChannel = (): boolean => channels.some((c) => c.is_usable);
  const hasUsableChannelForAsset = (assetId: string): boolean =>
    channels.some((c) => c.is_usable && c.asset_id === assetId);

  // Determine available network types for the SELECTED asset. Only surface a
  // network where the asset actually lives:
  //  • RGB asset → RGB-L1 (on-chain) always; RGB-LN only if a usable channel for
  //    THIS asset exists. (Spark/Liquid would appear only if the same asset also
  //    existed there — it doesn't for an NWC-RLN asset.)
  //  • BTC / other families → resolved via account routing.
  const availableNetworkTypes = useMemo((): ProtocolNetworkType[] => {
    const status = getProtocolStatus();
    const family = getAssetFamily(selectedAsset.asset_id, selectedAsset.ticker);
    const networks = new Set<ProtocolNetworkType>();

    if (family === 'RGB') {
      if (status.RGB) {
        networks.add('onchain'); // RGB-L1
        const id = selectedAsset.asset_id;
        const lnReady =
          id === NEW_RGB_ASSET_ID || id === 'USD'
            ? hasAnyUsableChannel()
            : hasUsableChannelForAsset(id);
        if (lnReady) networks.add('lightning'); // RGB-LN — only with a channel
      }
    } else {
      const accounts = resolveReceiveAccounts({ assetFamily: family, accounts: status });
      for (const account of accounts) {
        for (const net of getNetworkTypesForAccount(account, family)) networks.add(net);
      }
      // BTC Lightning needs a usable channel (Spark brings its own LN liquidity).
      if (networks.has('lightning') && !hasAnyUsableChannel() && !status.SPARK) {
        networks.delete('lightning');
      }
    }

    return Array.from(networks);
  }, [selectedAsset, getProtocolStatus, channels]);
  
  // Constants for HTLC calculations (from desktop app)
  const MSATS_PER_SAT = 1000;
  const RGB_HTLC_MIN_SAT = 3000;

  // Load Lightning channels
  const loadChannels = async () => {
    if (channelsLoading) return;
    
    try {
      setChannelsLoading(true);
      const rgbAdapter = protocolManager.getAdapterIfAvailable('RGB');
      const channelsResponse = rgbAdapter?.isConnected() ? await rgbAdapter.listChannels() : { channels: [] };
      const channelsList = Array.isArray(channelsResponse) ? channelsResponse : channelsResponse.channels || [];
      setChannels(channelsList);
    } catch (error) {
      console.error('Failed to load channels:', error);
    } finally {
      setChannelsLoading(false);
    }
  };

  // Calculate max deposit amount based on HTLC limits (from desktop app)
  const calculateMaxDepositAmount = (asset: string): number => {
    if (channels.length === 0) {
      return 0;
    }

    if (asset === 'BTC') {
      const channelHtlcLimits = channels
        .filter(channel => channel.is_usable)
        .map(channel => channel.next_outbound_htlc_limit_msat / MSATS_PER_SAT);

      if (channelHtlcLimits.length === 0 || Math.max(...channelHtlcLimits) <= 0) {
        return 0;
      }

      const maxHtlcLimit = Math.max(...channelHtlcLimits);
      const maxDepositableAmount = maxHtlcLimit - RGB_HTLC_MIN_SAT;
      return Math.max(0, maxDepositableAmount);
    } else {
      // For RGB assets, we still need to consider the BTC HTLC limits
      // since RGB transfers require BTC for fees
      return calculateMaxDepositAmount('BTC');
    }
  };

  // Get assets available for Lightning (assets that have channels)
  const getLightningAssets = (): Asset[] => {
    const lightningAssets: Asset[] = [
      { 
        asset_id: 'BTC', 
        ticker: 'BTC', 
        name: 'Bitcoin',
        isRGB: false,
        balance: btcBalance?.vanilla?.spendable || 0,
      }
    ];

    // Add RGB assets that have Lightning channels
    const rgbAssetsWithChannels = channels
      .filter(channel => channel.asset_id && channel.asset_id !== 'BTC' && channel.is_usable)
      .map(channel => {
        const rgbAsset = rgbAssets.find(asset => asset.asset_id === channel.asset_id);
        return rgbAsset ? {
          asset_id: rgbAsset.asset_id,
          ticker: rgbAsset.ticker,
          name: rgbAsset.name,
          isRGB: true,
          balance: rgbAsset.balance || 0,
        } : null;
      })
      .filter(asset => asset !== null) as Asset[];

    // Remove duplicates
    const uniqueRgbAssets = rgbAssetsWithChannels.filter((asset, index, self) => 
      index === self.findIndex(a => a.asset_id === asset.asset_id)
    );

    return [...lightningAssets, ...uniqueRgbAssets];
  };

  // Get assets available for on-chain (all assets)
  const getOnChainAssets = (): Asset[] => [
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
    })) : [])
  ];

  // Get available assets based on network type (memoized to prevent re-renders)
  const allAssets: Asset[] = useMemo(() => {
    return networkType === 'lightning' 
      ? getLightningAssets() 
      : getOnChainAssets();
  }, [networkType, rgbAssets, btcBalance, channels]);

  // Enhanced validation function
  const validateAddressOrInvoice = (data: any): string | null => {
    if (!data) return null;
    
    const cleanData = typeof data === 'string' ? data.trim() : String(data).trim();
    
    if (cleanData.length === 0) return null;
    
    // More lenient validation - accept any non-empty string that looks like an address or invoice
    if (cleanData.length < 10) return null;
    
    return cleanData;
  };

  // Check if amount is required and valid. RGB invoices (L1 + LN) are open-amount
  // — the sender chooses how much asset to send — so no amount is required for
  // them. Only a plain BTC Lightning invoice needs an amount up front.
  const isAmountRequired = (): boolean => {
    if (selectedAsset?.isRGB) return false;
    return networkType === 'lightning';
  };

  const isAmountValid = (): boolean => {
    if (!isAmountRequired()) return true;
    
    const numAmount = parseFloat(amount);
    return !isNaN(numAmount) && numAmount > 0;
  };

  const generateAddress = async () => {
    if (!selectedAsset) return;

    setError(null);

    if (isAmountRequired() && !isAmountValid()) {
      setError('Please enter a valid amount');
      return;
    }

    setLoading(true);
    try {
      let result: any = null;

      // ── Spark network ──
      if (networkType === 'spark') {
        try {
          const sparkAdapter = protocolManager.getAdapter('SPARK');
          if (amount && isAmountValid()) {
            const cleanAmount = amount.replace(/,/g, '');
            const numericAmount = parseFloat(cleanAmount);
            const amountSats = bitcoinUnit === 'BTC'
              ? Math.round(numericAmount * 1e8)
              : Math.round(numericAmount);
            const invoice = await sparkAdapter.createInvoice({
              amount: amountSats,
              description: `Receive ${cleanAmount} ${bitcoinUnit}`,
              expirySeconds: 3600,
            });
            result = invoice.invoice;
          } else {
            const addr = await sparkAdapter.getReceiveAddress();
            result = addr.address;
          }
        } catch (err: any) {
          throw new Error(`Spark: ${err.message || 'Failed to generate address'}`);
        }
      }
      // ── Arkade network ──
      else if (networkType === 'arkade') {
        try {
          const arkadeAdapter = protocolManager.getAdapter('ARKADE');
          if (arkadeSubMode === 'boarding') {
            const addr = await arkadeAdapter.getReceiveAddress('boarding');
            result = addr.address;
          } else {
            const addr = await arkadeAdapter.getReceiveAddress();
            result = addr.address;
          }
        } catch (err: any) {
          throw new Error(`Arkade: ${err.message || 'Failed to generate address'}`);
        }
      }
      // ── RGB / Legacy: on-chain + lightning ──
      else if (selectedAsset.asset_id === 'BTC') {
        if (networkType === 'onchain') {
          // Use whichever adapter is connected for on-chain address
          const rgbAdapter = protocolManager.getAdapterIfAvailable('RGB');
          const sparkAdapter = protocolManager.getAdapterIfAvailable('SPARK');
          if (rgbAdapter?.isConnected()) {
            const addr = await rgbAdapter.getReceiveAddress();
            result = addr.address;
          } else if (sparkAdapter?.isConnected()) {
            // Spark can provide a single-use deposit address for on-chain BTC
            const addr = await sparkAdapter.getReceiveAddress('onchain');
            result = addr.address;
          } else {
            throw new Error('No wallet connected for on-chain deposit');
          }
        } else {
          // Lightning invoice for BTC
          if (!amount || !isAmountValid()) {
            throw new Error('Amount is required for Lightning invoices');
          }
          const cleanAmount = amount.replace(/,/g, '');
          const numericAmount = parseFloat(cleanAmount);
          const amountSats = bitcoinUnit === 'BTC'
            ? Math.round(numericAmount * 1e8)
            : Math.round(numericAmount);

          // Try RGB first (Lightning), then Spark (also supports Lightning)
          const rgbLn = protocolManager.getAdapterIfAvailable('RGB');
          const sparkLn = protocolManager.getAdapterIfAvailable('SPARK');
          if (rgbLn?.isConnected()) {
            const invoice = await rgbLn.createInvoice({
              amount: amountSats,
              description: `Receive ${cleanAmount} ${bitcoinUnit}`,
              expirySeconds: 3600,
            });
            result = invoice.invoice;
          } else if (sparkLn?.isConnected()) {
            const invoice = await sparkLn.createInvoice({
              amount: amountSats,
              description: `Receive ${cleanAmount} ${bitcoinUnit}`,
              expirySeconds: 3600,
            });
            result = invoice.invoice;
          } else {
            throw new Error('No wallet connected for Lightning invoice');
          }
        }
      } else {
        // RGB assets (require RGB adapter)
        if (networkType === 'onchain') {
          const rgbAssetAdapter = protocolManager.getAdapterIfAvailable('RGB');
          if (!rgbAssetAdapter?.isConnected()) {
            throw new Error('RGB node required for on-chain RGB asset deposits. Please configure in Settings.');
          }
          // 'RGB_NEW' = a blind invoice (no asset_id) that can receive any RGB
          // asset the user doesn't hold yet — the "New RGB asset" entry point.
          const rgbInvoice = await rgbAssetAdapter.createRgbInvoice?.({
            ...(selectedAsset.asset_id === NEW_RGB_ASSET_ID ? {} : { asset_id: selectedAsset.asset_id }),
            min_confirmations: 1,
            duration_seconds: 3600,
          });
          result = rgbInvoice?.invoice ?? rgbInvoice?.recipient_id;
        } else {
          // RGB-over-Lightning invoice. Open-amount: if the user did enter a
          // number, scale it to BASE units (10^precision) for the node; otherwise
          // mint an amount-less RGB-LN invoice the sender fills in.
          const cleanAmount = amount.replace(/,/g, '');
          const parsed = parseFloat(cleanAmount);
          const precision = getAssetPrecision(selectedAsset.ticker);
          const assetAmount =
            !isNaN(parsed) && parsed > 0
              ? Math.round(parsed * Math.pow(10, precision))
              : undefined;

          const rgbAssetLnAdapter = protocolManager.getAdapterIfAvailable('RGB');
          if (!rgbAssetLnAdapter?.isConnected()) {
            throw new Error('RGB node required for RGB Lightning deposits. Please configure in Settings.');
          }
          const assetInvoice = await rgbAssetLnAdapter.createInvoice({
            asset: selectedAsset.asset_id,
            ...(assetAmount ? { assetAmount } : {}),
            description: assetAmount
              ? `Receive ${cleanAmount} ${selectedAsset.ticker}`
              : `Receive ${selectedAsset.ticker}`,
            expirySeconds: 3600,
          });
          result = assetInvoice.invoice;
        }
      }

      const validatedResult = validateAddressOrInvoice(result);
      if (validatedResult) {
        setAddress(validatedResult);
        setError(null);
      } else {
        throw new Error('Unable to generate a valid address or invoice. Please try again.');
      }
    } catch (error) {
      console.error('Failed to generate address:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to generate address. Please try again.';
      if (errorMessage.includes('No uncolored UTXOs')) {
        setError('No uncolored UTXOs available. Please create UTXOs first or try a different network.');
      } else {
        setError(errorMessage);
      }
      setAddress('');
    } finally {
      setLoading(false);
    }
  };

  // ──────────────────────────────────────────────────────────────────────
  // USD unified receive: a BIP321 QR (address-less) embedding the ways to receive
  // USD (USDt) across protocols — Liquid USDt, an RGB USDT invoice (RGB-LN or
  // RGB-L1), and the Spark address. Caller has already reset loading/error state.
  const generateUsdUnifiedUri = async () => {
    const rgb = protocolManager.getAdapterIfAvailable('RGB');
    const spark = protocolManager.getAdapterIfAvailable('SPARK');
    const liquid = protocolManager.getAdapterIfAvailable('LIQUID');

    const methods: string[] = [];
    let sparkAddress: string | undefined;
    let liquidAddress: string | undefined;
    let rgbInvoice: string | undefined;

    // The RGB USDT asset (from the loaded RGB assets), for an RGB invoice.
    const usdtRgb = rgbAssets.find((a) => /usdt/i.test(a.ticker));

    try {
      // 1) Liquid USDt — assets ride on the same confidential address.
      if (liquid?.isConnected()) {
        try {
          const addr = await liquid.getReceiveAddress();
          if (addr?.address) { liquidAddress = addr.address; methods.push('Liquid USDt'); }
        } catch (e) { console.warn('USD: Liquid address failed', e); }
      }
      // 2) RGB USDT invoice (covers RGB-LN and RGB on-chain L1).
      if (rgb?.isConnected() && usdtRgb?.asset_id && rgb.createRgbInvoice) {
        try {
          const inv: any = await rgb.createRgbInvoice({ assetId: usdtRgb.asset_id });
          const invoice = inv?.invoice ?? inv?.recipient_id;
          if (invoice) { rgbInvoice = invoice; methods.push('RGB USDT'); }
        } catch (e) { console.warn('USD: RGB invoice failed', e); }
      }
      // 3) Spark address (for a Spark USD token transfer).
      if (spark?.isConnected()) {
        try {
          const addr = await spark.getReceiveAddress();
          if (addr?.address) { sparkAddress = addr.address; methods.push('Spark'); }
        } catch (e) { console.warn('USD: Spark address failed', e); }
      }

      if (!sparkAddress && !liquidAddress && !rgbInvoice) {
        setUnifiedError('No USD receive method available. Connect Liquid, an RGB node, or Spark.');
        return;
      }

      setUnifiedAddresses(
        [
          liquidAddress && { key: 'liquid', label: 'Liquid USDt', value: liquidAddress },
          rgbInvoice && { key: 'rgb', label: 'RGB USDT invoice', value: rgbInvoice },
          sparkAddress && { key: 'spark', label: 'Spark', value: sparkAddress },
        ].filter(Boolean) as Array<{ key: string; label: string; value: string }>
      );

      const uri = buildUnifiedReceiveURI({
        sparkAddress,
        liquidAddress,
        rgbInvoice,
        assetId: LITE_USD.assetId, // Liquid USDt asset id
        label: 'KaleidoSwap USD',
      });
      setUnifiedUri(uri);
      setUnifiedMethods(methods);
    } catch (e: any) {
      console.error('USD: unified receive failed', e);
      setUnifiedError(e?.message || 'Failed to build USD receive code.');
    } finally {
      setUnifiedLoading(false);
    }
  };

  // Unified receive: build ONE BIP321 QR embedding every available method.
  // Defensive — each adapter call is wrapped so a missing/disconnected
  // protocol is silently skipped rather than failing the whole QR.
  // ──────────────────────────────────────────────────────────────────────
  const generateUnifiedUri = async () => {
    setUnifiedError(null);
    setUnifiedLoading(true);
    setUnifiedUri('');
    setUnifiedMethods([]);
    setUnifiedAddresses([]);

    if (unifiedAsset === 'USD') {
      await generateUsdUnifiedUri();
      return;
    }

    const rgb = protocolManager.getAdapterIfAvailable('RGB');
    const spark = protocolManager.getAdapterIfAvailable('SPARK');
    const arkade = protocolManager.getAdapterIfAvailable('ARKADE');
    const liquid = protocolManager.getAdapterIfAvailable('LIQUID');

    // Optional amount (in sats) for the Lightning leg / BIP21 amount.
    let amountSats = 0;
    if (amount && isAmountValid()) {
      const cleanAmount = amount.replace(/,/g, '');
      const numericAmount = parseFloat(cleanAmount);
      if (!isNaN(numericAmount) && numericAmount > 0) {
        amountSats = bitcoinUnit === 'BTC'
          ? Math.round(numericAmount * 1e8)
          : Math.round(numericAmount);
      }
    }

    // Progressive collection: every adapter is queried in PARALLEL, and as each
    // method resolves we rebuild the QR + address list so the user sees whatever
    // is ready first instead of waiting for the slowest protocol.
    const collected: {
      btcAddress?: string;
      lightningInvoice?: string;
      sparkAddress?: string;
      arkadeAddress?: string;
      liquidAddress?: string;
    } = {};
    let anyShown = false;

    const rebuild = () => {
      const methods: string[] = [];
      if (collected.btcAddress) methods.push('On-chain');
      if (collected.lightningInvoice) methods.push('Lightning');
      if (collected.sparkAddress) methods.push('Spark');
      if (collected.arkadeAddress) methods.push('Arkade');
      if (collected.liquidAddress) methods.push('Liquid');
      if (methods.length === 0) return;

      setUnifiedAddresses(
        [
          collected.btcAddress && { key: 'onchain', label: 'Bitcoin on-chain', value: collected.btcAddress },
          collected.lightningInvoice && { key: 'lightning', label: 'Lightning invoice', value: collected.lightningInvoice },
          collected.sparkAddress && { key: 'spark', label: 'Spark', value: collected.sparkAddress },
          collected.arkadeAddress && { key: 'arkade', label: 'Arkade', value: collected.arkadeAddress },
          collected.liquidAddress && { key: 'liquid', label: 'Liquid', value: collected.liquidAddress },
        ].filter(Boolean) as Array<{ key: string; label: string; value: string }>
      );
      setUnifiedMethods(methods);

      try {
        const uri = buildUnifiedReceiveURI({
          btcAddress: collected.btcAddress,
          lightningInvoice: collected.lightningInvoice,
          sparkAddress: collected.sparkAddress,
          arkadeAddress: collected.arkadeAddress,
          liquidAddress: collected.liquidAddress,
          amountBtc: amountSats > 0 ? amountSats / 1e8 : undefined,
          label: 'KaleidoSwap',
        });
        setUnifiedUri(uri);
        // Hide the spinner as soon as we have something scannable.
        if (!anyShown) { anyShown = true; setUnifiedLoading(false); }
      } catch (e: any) {
        console.error('Unified: buildUnifiedReceiveURI failed', e);
      }
    };

    const tasks: Promise<void>[] = [
      // 1) BTC on-chain — prefer RGB, then Spark single-use deposit, then Arkade boarding.
      (async () => {
        try {
          if (rgb?.isConnected()) {
            const addr = await rgb.getReceiveAddress();
            if (addr?.address) collected.btcAddress = addr.address;
          }
          if (!collected.btcAddress && spark?.isConnected()) {
            const addr = await spark.getReceiveAddress('onchain');
            if (addr?.address) collected.btcAddress = addr.address;
          }
          if (!collected.btcAddress && arkade?.isConnected()) {
            const addr = await arkade.getReceiveAddress('boarding');
            if (addr?.address) collected.btcAddress = addr.address;
          }
        } catch (e) { console.warn('Unified: on-chain address failed', e); }
        if (collected.btcAddress) rebuild();
      })(),

      // 2) Lightning invoice (RGB node first, then Spark).
      (async () => {
        const lnAdapter = rgb?.isConnected() ? rgb : spark?.isConnected() ? spark : undefined;
        if (!lnAdapter) return;
        try {
          const invoice = await lnAdapter.createInvoice({
            amount: amountSats > 0 ? amountSats : undefined,
            description: 'Unified receive',
            expirySeconds: 3600,
          });
          if (invoice?.invoice) { collected.lightningInvoice = invoice.invoice; rebuild(); }
        } catch (e) { console.warn('Unified: Lightning invoice failed', e); }
      })(),

      // 3) Spark native address.
      (async () => {
        if (!spark?.isConnected()) return;
        try {
          const addr = await spark.getReceiveAddress();
          if (addr?.address) { collected.sparkAddress = addr.address; rebuild(); }
        } catch (e) { console.warn('Unified: Spark address failed', e); }
      })(),

      // 4) Arkade native (ark) address.
      (async () => {
        if (!arkade?.isConnected()) return;
        try {
          const addr = await arkade.getReceiveAddress();
          if (addr?.address) { collected.arkadeAddress = addr.address; rebuild(); }
        } catch (e) { console.warn('Unified: Arkade address failed', e); }
      })(),

      // 5) Liquid (L-BTC / USDt) address.
      (async () => {
        if (!liquid?.isConnected()) return;
        try {
          const addr = await liquid.getReceiveAddress();
          if (addr?.address) { collected.liquidAddress = addr.address; rebuild(); }
        } catch (e) { console.warn('Unified: Liquid address failed', e); }
      })(),
    ];

    await Promise.allSettled(tasks);

    // BIP321 allows an address-less URI, so a single method is enough.
    if (!anyShown) {
      setUnifiedError('No receive method available. Connect a wallet (RGB, Spark, Arkade, or Liquid) to use unified receive.');
    }
    setUnifiedLoading(false);
  };

  const copyUnifiedUri = async () => {
    if (!unifiedUri) return;
    await Clipboard.setString(unifiedUri);
    Alert.alert('Copied', 'Unified receive URI copied to clipboard');
  };

  // Generate the unified URI when that mode is selected, or amount changes.
  useEffect(() => {
    if (networkType !== 'unified') return;
    const timeoutId = setTimeout(() => {
      generateUnifiedUri();
    }, 300);
    return () => clearTimeout(timeoutId);
  }, [networkType, amount, unifiedAsset]);

  // Keep the unified BTC/USD asset in sync with the selected asset tab.
  useEffect(() => {
    if (selectedAsset.ticker === 'BTC') {
      setUnifiedAsset('BTC');
    } else if (/usd/i.test(selectedAsset.ticker)) {
      setUnifiedAsset('USD');
    }
  }, [selectedAsset]);

  // "All networks" can only encode BTC or USD — a custom RGB asset falls back
  // to a specific on-chain (RGB) invoice.
  useEffect(() => {
    const t = selectedAsset.ticker;
    const isBtcOrUsd = t === 'BTC' || /usd/i.test(t);
    if (!isBtcOrUsd && networkType === 'unified') {
      setNetworkType('onchain');
    }
  }, [selectedAsset, networkType]);

  // Load channels on mount AND when the network type changes. Mounting needs them
  // so the network selector can decide whether RGB-LN is offered (a channel for
  // the asset must exist) before the user ever taps Lightning.
  useEffect(() => {
    loadChannels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (networkType === 'lightning') {
      loadChannels();
    }
  }, [networkType]);

  // Update max amounts when network or channels change
  useEffect(() => {
    if (networkType === 'lightning' && selectedAsset) {
      const maxAmount = calculateMaxDepositAmount(
        selectedAsset.asset_id === 'BTC' ? 'BTC' : selectedAsset.asset_id
      );
      setMaxDepositAmount(maxAmount);
    } else {
      setMaxDepositAmount(0);
    }
  }, [networkType, selectedAsset, channels]);

  // Reset selected asset if not available in current network type
  useEffect(() => {
    if (selectedAsset && allAssets.length > 0) {
      const isAssetAvailable =
        selectedAsset.asset_id === NEW_RGB_ASSET_ID ||
        allAssets.some(asset => asset.asset_id === selectedAsset.asset_id);
      if (!isAssetAvailable) {
        // Reset to BTC if current asset is not available
        const btcAsset = allAssets.find(asset => asset.asset_id === 'BTC');
        if (btcAsset) {
          setSelectedAsset(btcAsset);
        } else if (allAssets.length > 0) {
          setSelectedAsset(allAssets[0]);
        }
      }
    }
  }, [allAssets]);

  // Auto-generate address when conditions change
  useEffect(() => {
    if (networkType === 'unified') return; // unified has its own generator
    if (selectedAsset) {
      setAddress('');
      setError(null);

      // Show the loader straight away (during the debounce window) when we know
      // we'll auto-generate — otherwise the "Generate address" prompt flashes
      // in between while switching networks.
      const willAutoGenerate = !isAmountRequired() || isAmountValid();
      if (willAutoGenerate) setLoading(true);

      // Only auto-generate if amount is not required, or if it's valid
      // Use a small delay to avoid interfering with user input
      const timeoutId = setTimeout(() => {
        if (!isAmountRequired() || isAmountValid()) {
          generateAddress();
        }
      }, 300); // Increased delay to reduce interference
      
      return () => clearTimeout(timeoutId);
    }
  }, [selectedAsset, networkType]);

  // Generate address when amount changes for lightning (only when user stops typing)
  useEffect(() => {
    if (networkType === 'lightning' && amount && isAmountValid() && !isUserTyping) {
      const timeoutId = setTimeout(() => {
        if (!isUserTyping) { // Double check user isn't typing
          generateAddress();
        }
      }, 2000);
      
      return () => clearTimeout(timeoutId);
    }
  }, [amount, isUserTyping]);

  // Regenerate address when channels change (for lightning network)
  useEffect(() => {
    if (networkType === 'lightning' && selectedAsset && channels.length > 0) {
      const timeoutId = setTimeout(() => {
        if (!isAmountRequired() || isAmountValid()) {
          generateAddress();
        }
      }, 500);
      
      return () => clearTimeout(timeoutId);
    }
  }, [channels]);

  const [copied, setCopied] = useState(false);
  const copyToClipboard = async () => {
    if (!address) return;
    await Clipboard.setString(address);
    feedback.select();
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  const shareAddress = async () => {
    if (!address) return;
    try {
      await Share.share({
        message: address,
        title: `${selectedAsset?.ticker} ${networkType === 'lightning' ? 'Invoice' : 'Address'}`,
      });
    } catch (error) {
      console.error('Failed to share:', error);
    }
  };

  // AssetIcon is now imported from components/AssetIcon

  // ── Amount <-> sats bridging for the multi-currency editor ────────────────
  const SATS_PER_BTC = 1e8;
  const currentAmountSats = (() => {
    if (!amount) return 0;
    const n = parseFloat(amount.replace(/,/g, ''));
    if (isNaN(n) || n <= 0) return 0;
    return bitcoinUnit === 'BTC' ? Math.round(n * SATS_PER_BTC) : Math.round(n);
  })();

  const applyAmountSats = (sats: number) => {
    if (!sats || sats <= 0) {
      setAmount('');
      return;
    }
    setAmount(bitcoinUnit === 'BTC' ? (sats / SATS_PER_BTC).toString() : String(Math.round(sats)));
  };

  // Human label for the current requested amount (BTC view + ≈USD).
  const amountSummary = (): string | null => {
    if (!currentAmountSats) return null;
    const unit = bitcoinUnit === 'BTC'
      ? `${(currentAmountSats / SATS_PER_BTC).toFixed(8)} BTC`
      : `${currentAmountSats.toLocaleString()} sats`;
    const usd = fiatRates['usd'];
    return usd
      ? `${unit}  ·  ≈ $${((currentAmountSats / SATS_PER_BTC) * usd).toFixed(2)}`
      : unit;
  };

  const renderHeader = () => (
    <View>
      <ScreenHeader title="Receive" showBack={true} />

      {/* Asset Selector — below header, above network tabs */}
      <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 }}>
        {selectedAsset && (
          <TouchableOpacity
            onPress={() => setShowAssetSelector(true)}
            activeOpacity={0.7}
            style={{
              flexDirection: 'row', alignItems: 'center',
              backgroundColor: theme.colors.surface.primary,
              borderRadius: 14, padding: 12,
              shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 2,
            }}
          >
            <AssetIcon ticker={selectedAsset.ticker} protocol={selectedAsset.isRGB ? 'RGB' : undefined} size={36} showBadge={false} />
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={{ fontSize: 16, fontWeight: '600', color: theme.colors.text.primary }}>{selectedAsset.ticker}</Text>
              <Text style={{ fontSize: 12, color: theme.colors.text.tertiary }}>{selectedAsset.name}</Text>
            </View>
            <Ionicons name="chevron-down" size={18} color={theme.colors.gray[400]} />
          </TouchableOpacity>
        )}
      </View>

      {/* Asset Selector Modal */}
      <AssetSelector
        visible={showAssetSelector}
        onClose={() => setShowAssetSelector(false)}
        onSelect={(asset) => {
          setSelectedAsset({
            asset_id: asset.asset_id,
            ticker: asset.ticker,
            name: asset.name,
            isRGB: asset.isRGB || asset.protocol === 'RGB',
            balance: asset.balance,
          });
        }}
        assets={allAssets.map(a => ({
          asset_id: a.asset_id,
          ticker: a.ticker,
          name: a.name,
          balance: a.balance,
          isRGB: a.isRGB,
          protocol: a.isRGB ? 'RGB' as const : undefined,
        }))}
        selectedAssetId={selectedAsset?.asset_id}
        title="Select Asset"
      />
    </View>
  );

  // Network color coding (matches rate-extension)
  const NETWORK_COLORS: Record<string, string> = {
    'onchain': '#F7931A', // Bitcoin orange
    'lightning': '#FACC15', // Lightning yellow
    'spark': '#60A5FA',     // Spark blue
    'arkade': '#A855F7',    // Arkade purple
    'unified': '#10B981',   // Unified / all-networks green
  };

  const NETWORK_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
    'onchain': 'link',
    'lightning': 'flash',
    'spark': 'sparkles',
    'arkade': 'shield-checkmark',
  };

  const NETWORK_LABELS: Record<string, string> = {
    'onchain': 'On-chain',
    'lightning': 'Lightning',
    'spark': 'Spark',
    'arkade': 'Arkade',
  };

  const renderNetworkTabs = () => {
    // Lite mode abstracts away networks/layers: no manual picker, just the
    // unified single-QR receive (networkType defaults to 'unified').
    if (isLite) return null;

    const onChainAssets = getOnChainAssets();
    const lightningAssets = getLightningAssets();

    // Build list of available networks with metadata
    // Only show networks that are actually available (based on connected protocols)
    // The 'unified' chip is always offered first — it produces a single QR
    // embedding every method the connected adapters can provide.
    const allNetworks: Array<{ id: ReceiveMode; label: string; icon: keyof typeof Ionicons.glyphMap; color: string; subtitle: string; available: boolean }> = [
      { id: 'unified' as ReceiveMode, label: 'All networks', icon: 'apps' as keyof typeof Ionicons.glyphMap, color: NETWORK_COLORS['unified'], subtitle: 'one QR', available: true },
      ...(availableNetworkTypes.includes('onchain') ? [{ id: 'onchain' as ProtocolNetworkType, label: 'On-chain', icon: 'link' as keyof typeof Ionicons.glyphMap, color: NETWORK_COLORS['onchain'], subtitle: onChainAssets.length === 1 ? '1 asset' : `${onChainAssets.length} assets`, available: true }] : []),
      ...(availableNetworkTypes.includes('lightning') ? [{ id: 'lightning' as ProtocolNetworkType, label: 'Lightning', icon: 'flash' as keyof typeof Ionicons.glyphMap, color: NETWORK_COLORS['lightning'], subtitle: lightningAssets.length === 0 ? 'no channels' : lightningAssets.length === 1 ? '1 asset' : `${lightningAssets.length} assets`, available: lightningAssets.length > 0 }] : []),
      ...(availableNetworkTypes.includes('spark') ? [{ id: 'spark' as ProtocolNetworkType, label: 'Spark', icon: 'sparkles' as keyof typeof Ionicons.glyphMap, color: NETWORK_COLORS['spark'], subtitle: 'instant', available: true }] : []),
      ...(availableNetworkTypes.includes('arkade') ? [{ id: 'arkade' as ProtocolNetworkType, label: 'Arkade', icon: 'shield-checkmark' as keyof typeof Ionicons.glyphMap, color: NETWORK_COLORS['arkade'], subtitle: arkadeSubMode === 'boarding' ? 'boarding' : 'off-chain', available: true }] : []),
    ];

    return (
      <View style={styles.networkTabsContainer}>
        {/* Account chips — horizontal scrollable */}
        <Text style={{ fontSize: 11, fontWeight: '600', color: theme.colors.text.tertiary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8, paddingHorizontal: 4 }}>
          Destination Network
        </Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {allNetworks.map((net) => {
              const isActive = networkType === net.id;
              return (
                <PressableScale
                  key={net.id}
                  onPress={() => { feedback.select(); setNetworkType(net.id); }}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    paddingHorizontal: 14,
                    paddingVertical: 10,
                    borderRadius: 12,
                    backgroundColor: isActive ? net.color + '20' : theme.colors.background.secondary,
                    borderWidth: isActive ? 1.5 : 1,
                    borderColor: isActive ? net.color : theme.colors.background.tertiary || 'rgba(255,255,255,0.08)',
                    opacity: net.available ? 1 : 0.4,
                  }}
                >
                  {net.id === 'unified' ? (
                    <Ionicons name={net.icon} size={18} color={isActive ? net.color : theme.colors.text.secondary} />
                  ) : (
                    <NetworkIcon network={net.id} size={18} color={isActive ? net.color : theme.colors.text.secondary} />
                  )}
                  <View style={{ marginLeft: 8 }}>
                    <Text style={{ fontSize: 13, fontWeight: isActive ? '600' : '500', color: isActive ? net.color : theme.colors.text.primary }}>
                      {net.label}
                    </Text>
                    <Text style={{ fontSize: 10, color: isActive ? net.color + 'AA' : theme.colors.text.tertiary, marginTop: 1 }}>
                      {net.subtitle}
                    </Text>
                  </View>
                  {isActive && (
                    <View style={{ marginLeft: 8, width: 6, height: 6, borderRadius: 3, backgroundColor: net.color }} />
                  )}
                </PressableScale>
              );
            })}
          </View>
        </ScrollView>

        {/* Arkade sub-mode toggle */}
        {networkType === 'arkade' && (
          <TouchableOpacity
            onPress={() => setArkadeSubMode(arkadeSubMode === 'ark' ? 'boarding' : 'ark')}
            style={{
              flexDirection: 'row', alignItems: 'center', padding: 10, borderRadius: 10, marginBottom: 12,
              backgroundColor: NETWORK_COLORS['arkade'] + '15',
              borderWidth: 1, borderColor: NETWORK_COLORS['arkade'] + '30',
            }}
          >
            <Ionicons name="swap-horizontal" size={16} color={NETWORK_COLORS['arkade']} />
            <Text style={{ marginLeft: 8, fontSize: 13, color: NETWORK_COLORS['arkade'], fontWeight: '500' }}>
              {arkadeSubMode === 'ark' ? 'Switch to Boarding (on-chain deposit)' : 'Switch to Ark (off-chain receive)'}
            </Text>
          </TouchableOpacity>
        )}

        {/* Warning for Lightning with limited assets */}
        {networkType === 'lightning' && lightningAssets.length === 1 && (
          <View style={styles.networkWarning}>
            <Ionicons name="information-circle" size={16} color={theme.colors.warning?.[500] || '#EAB308'} />
            <Text style={styles.networkWarningText}>
              Only Bitcoin available. Open RGB Lightning channels to receive RGB assets.
            </Text>
          </View>
        )}
      </View>
    );
  };

  const renderAmountInput = () => {
    if (!selectedAsset) return null;
    
    const showAmount = isAmountRequired() || selectedAsset.isRGB || networkType === 'unified';
    if (!showAmount) return null;

    const isRequired = isAmountRequired();

    // Quick amount buttons for BTC
    const renderQuickAmounts = () => {
      if (selectedAsset.ticker !== 'BTC') return null;
      
      const quickAmounts = bitcoinUnit === 'BTC' 
        ? ['0.001', '0.005', '0.01'] 
        : ['1000', '5000', '10000'];
      
      return (
        <View style={styles.quickAmounts}>
          {quickAmounts.map((amt) => (
            <TouchableOpacity
              key={amt}
              style={[
                styles.quickAmountButton,
                amount === amt && styles.quickAmountButtonSelected
              ]}
              onPress={() => setAmount(amt)}
            >
              <Text style={[
                styles.quickAmountText,
                amount === amt && styles.quickAmountTextSelected
              ]}>
                {amt} {bitcoinUnit}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      );
    };

    return (
      <View style={styles.amountSection}>
        <Text style={styles.sectionTitle}>
          Amount {isRequired ? '(Required)' : '(Optional)'}
        </Text>
        <Text style={styles.sectionDescription}>
          {selectedAsset.isRGB 
            ? networkType === 'lightning'
              ? `Enter the amount of ${selectedAsset.ticker} to receive via Lightning`
              : `Specify the amount of ${selectedAsset.ticker} for the RGB invoice`
            : isRequired
              ? `Enter the amount of ${bitcoinUnit} to receive`
              : 'Leave empty for any amount or specify a fixed amount'
          }
        </Text>
        
        {/* Error message for amount */}
        {isRequired && amount && !isAmountValid() && (
          <View style={styles.errorMessage}>
            <Ionicons name="warning" size={16} color={theme.colors.error[500]} />
            <Text style={styles.errorMessageText}>Please enter a valid amount</Text>
          </View>
        )}
        
        <View style={styles.inputContainer}>
          <Input
            placeholder={bitcoinUnit === 'BTC' ? "0.00000000" : "0"}
            value={amount}
            onChangeText={(value) => {
              // Set typing flag to prevent interference
              setIsUserTyping(true);
              
              // Clear typing flag after user stops typing
              setTimeout(() => setIsUserTyping(false), 3000);
              
              // Simplified input handling to prevent focus issues
              let cleanValue = value.replace(/[^\d.,]/g, '');
              
              // Remove extra commas
              cleanValue = cleanValue.replace(/,/g, '');
              
              // Handle multiple decimal points
              const parts = cleanValue.split('.');
              if (parts.length > 2) {
                cleanValue = parts[0] + '.' + parts.slice(1).join('');
              }
              
              // Basic precision limit
              const precision = getAssetPrecision(selectedAsset.ticker);
              const decimalParts = cleanValue.split('.');
              if (decimalParts.length === 2 && decimalParts[1].length > precision) {
                return; // Don't update if exceeds precision
              }
              
              // Quick max amount check for lightning (without complex formatting)
              if (networkType === 'lightning' && maxDepositAmount > 0) {
                const numValue = parseFloat(cleanValue);
                if (!isNaN(numValue) && numValue > maxDepositAmount) {
                  return; // Don't update if exceeds max
                }
              }

              setAmount(cleanValue);
            }}
            onFocus={() => setIsUserTyping(true)}
            onBlur={() => {
              setTimeout(() => setIsUserTyping(false), 100);
            }}
            keyboardType="decimal-pad"
            variant="outlined"
            style={
              isRequired && amount && !isAmountValid() 
                ? { ...styles.amountInput, ...styles.amountInputError }
                : styles.amountInput
            }
            autoFocus={false}
          />
          <View style={styles.currencyLabel}>
            <Text style={styles.currencyText}>
              {selectedAsset.ticker === 'BTC' ? bitcoinUnit : selectedAsset.ticker}
            </Text>
          </View>
        </View>
        
        {renderQuickAmounts()}
        
        {/* Lightning warnings and limits */}
        {networkType === 'lightning' && (
          <View style={styles.lightningWarnings}>
            {selectedAsset.isRGB && (
              <View style={styles.warningContainer}>
                <Ionicons name="information-circle" size={16} color={theme.colors.primary[500]} />
                <Text style={styles.warningText}>
                  3,000 sats required for RGB asset transfers via Lightning
                </Text>
              </View>
            )}
            
            {maxDepositAmount === 0 && (
              <View style={[styles.warningContainer, styles.errorWarning]}>
                <Ionicons name="warning" size={16} color={theme.colors.warning[500]} />
                <Text style={[styles.warningText, styles.errorWarningText]}>
                  No active Lightning channels found. Lightning deposits are not available.
                </Text>
              </View>
            )}
            
            {maxDepositAmount > 0 && (
              <View style={styles.warningContainer}>
                <Ionicons name="flash" size={16} color={theme.colors.success[500]} />
                <Text style={styles.warningText}>
                  Max Lightning deposit: {formatAssetAmount(maxDepositAmount, selectedAsset.ticker)} {selectedAsset.ticker}
                </Text>
              </View>
            )}
          </View>
        )}
        
        {selectedAsset.ticker === 'BTC' && amount && isAmountValid() && (
          <Text style={styles.approximateValue}>
            ≈ ${parseFloat(formatSatoshisToUSD(amount.replace(/,/g, ''))).toLocaleString()} USD
          </Text>
        )}
      </View>
    );
  };

  // Helper function to validate address for QR code
  const isValidQRData = (data: string): boolean => {
    return validateAddressOrInvoice(data) !== null;
  };

  // Unified single-QR receive view (wraps the body with a BTC/USD asset selector).
  // Pro/extension-style list of every address embedded in the unified QR. Each
  // row copies its address; a collapsible panel explains them; "Add RGB address"
  // jumps to the advanced asset picker.
  const renderUnifiedAddressList = () => {
    if (!unifiedAddresses.length) return null;
    const colorFor = (key: string): string =>
      (NETWORK_COLORS as Record<string, string>)[key] ?? theme.colors.primary[500];
    const trunc = (v: string) => (v.length > 30 ? `${v.slice(0, 16)}…${v.slice(-10)}` : v);
    return (
      <View style={styles.addrListSection}>
        <Text style={styles.addrListTitle}>Addresses</Text>
        {unifiedAddresses.map((a) => {
          const isOpen = !!expandedAddrs[a.key];
          return (
            <View key={a.key} style={styles.addrRow}>
              <View style={[styles.addrDot, { backgroundColor: colorFor(a.key) }]} />
              <View style={{ flex: 1 }}>
                <Text style={styles.addrLabel}>{a.label}</Text>
                {isOpen ? (
                  <Text style={styles.uriFull} selectable>{a.value}</Text>
                ) : (
                  <Text style={styles.addrValue} numberOfLines={1}>{trunc(a.value)}</Text>
                )}
              </View>
              {/* Per-address "show full" — the full value lives here, not on the URI. */}
              <TouchableOpacity
                onPress={() => setExpandedAddrs((p) => ({ ...p, [a.key]: !p[a.key] }))}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                style={{ paddingHorizontal: 4 }}
                activeOpacity={0.7}
              >
                <Ionicons
                  name={isOpen ? 'chevron-up' : 'chevron-down'}
                  size={16}
                  color={theme.colors.text.tertiary}
                />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={async () => {
                  await Clipboard.setString(a.value);
                  feedback.select();
                  Alert.alert('Copied', `${a.label} copied to clipboard`);
                }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                style={{ paddingHorizontal: 4 }}
                activeOpacity={0.7}
              >
                <Ionicons name="copy-outline" size={18} color={theme.colors.text.tertiary} />
              </TouchableOpacity>
            </View>
          );
        })}

        <TouchableOpacity
          style={styles.addrInfoToggle}
          onPress={() => setShowAddressInfo((v) => !v)}
          activeOpacity={0.7}
        >
          <Ionicons name="information-circle-outline" size={16} color={theme.colors.text.tertiary} />
          <Text style={styles.addrInfoToggleText}>What are these addresses?</Text>
          <Ionicons
            name={showAddressInfo ? 'chevron-up' : 'chevron-down'}
            size={16}
            color={theme.colors.text.tertiary}
          />
        </TouchableOpacity>
        {showAddressInfo && (
          <Text style={styles.addrInfoBody}>
            The single QR above carries several ways to be paid — a sender's wallet automatically picks
            whichever it supports: Bitcoin on-chain, Lightning (instant, low fee), Spark, Arkade or
            Liquid. You can also copy any individual address above.
          </Text>
        )}

        <TouchableOpacity
          style={styles.addRgbBtn}
          activeOpacity={0.7}
          onPress={() => {
            setShowAllNetworks(true);
            setShowAssetSelector(true);
          }}
        >
          <Ionicons name="add-circle-outline" size={18} color={theme.colors.primary[500]} />
          <Text style={styles.addRgbText}>Add RGB address</Text>
        </TouchableOpacity>
      </View>
    );
  };

  // Handle a pick from the "+" new-asset sheet: switch to a fresh receive on the
  // chosen protocol (Spark / Arkade address, or a blind RGB invoice).
  const handleNewAsset = (kind: NewAssetKind) => {
    feedback.select();
    if (kind === 'spark') {
      setSelectedAsset({ asset_id: 'BTC', ticker: 'BTC', name: 'Bitcoin', isRGB: false, balance: btcBalance?.vanilla?.spendable || 0 });
      setNetworkType('spark');
    } else if (kind === 'arkade') {
      setSelectedAsset({ asset_id: 'BTC', ticker: 'BTC', name: 'Bitcoin', isRGB: false, balance: btcBalance?.vanilla?.spendable || 0 });
      setNetworkType('arkade');
    } else {
      // New RGB asset → blind RGB invoice via the on-chain RGB path.
      setSelectedAsset({ asset_id: NEW_RGB_ASSET_ID, ticker: 'RGB', name: 'New RGB asset', isRGB: true });
      setNetworkType('onchain');
    }
  };

  // ── Asset tabs: BTC | USD | (custom) | + ──────────────────────────────────
  const renderAssetTabs = () => {
    const accent = theme.colors.primary[500];
    const t = selectedAsset.ticker;
    const isBtc = t === 'BTC';
    const isUsd = /usd/i.test(t);
    const isCustom = !isBtc && !isUsd;

    const selectBtc = () => {
      feedback.select();
      setSelectedAsset({
        asset_id: 'BTC', ticker: 'BTC', name: 'Bitcoin', isRGB: false,
        balance: btcBalance?.vanilla?.spendable || 0,
      });
    };
    const selectUsd = () => {
      feedback.select();
      const usdt = rgbAssets.find((a) => /usdt/i.test(a.ticker));
      if (usdt) {
        setSelectedAsset({
          asset_id: usdt.asset_id, ticker: usdt.ticker, name: usdt.name,
          isRGB: true, balance: usdt.balance || 0,
        });
      } else {
        setSelectedAsset({ asset_id: 'USD', ticker: 'USD', name: 'US Dollar', isRGB: false });
      }
    };

    const Tab = (
      key: string,
      active: boolean,
      onPress: () => void,
      icon: React.ReactNode,
      label: string
    ) => (
      <TouchableOpacity
        key={key}
        style={[styles.assetTab, active && { borderColor: accent, backgroundColor: accent + '15' }]}
        onPress={onPress}
        activeOpacity={0.7}
      >
        {icon}
        <Text style={[styles.assetTabText, active && { color: accent, fontWeight: '700' }]}>
          {label}
        </Text>
      </TouchableOpacity>
    );

    return (
      <View style={styles.assetTabs}>
        {Tab('BTC', isBtc, selectBtc, <AssetIcon ticker="BTC" size={20} showBadge={false} />, 'BTC')}
        {Tab('USD', isUsd, selectUsd, <UsdCoinIcon size={20} />, 'USD')}
        {isCustom &&
          Tab('custom', true, () => {}, (
            <AssetIcon
              ticker={t}
              protocol={selectedAsset.isRGB ? 'RGB' : undefined}
              size={20}
              showBadge={false}
            />
          ), t)}
        <TouchableOpacity
          style={styles.assetAddTab}
          onPress={() => { feedback.select(); setShowNewAsset(true); }}
          activeOpacity={0.7}
        >
          <Ionicons name="add" size={20} color={theme.colors.text.secondary} />
        </TouchableOpacity>
      </View>
    );
  };

  // ── Network selector: "All" by default, specific networks behind a dropdown ─
  const renderNetworkDropdown = () => {
    const canUseAll = selectedAsset.ticker === 'BTC' || /usd/i.test(selectedAsset.ticker);
    const isRgbAsset = getAssetFamily(selectedAsset.asset_id, selectedAsset.ticker) === 'RGB';
    const options: Array<{ id: ReceiveMode; label: string; sub: string }> = [
      ...(canUseAll
        ? [{ id: 'unified' as ReceiveMode, label: 'All networks', sub: 'On-chain · Lightning · Spark · Arkade' }]
        : []),
      ...(availableNetworkTypes.includes('onchain')
        ? [{ id: 'onchain' as ReceiveMode, label: isRgbAsset ? 'RGB on-chain' : 'On-chain', sub: isRgbAsset ? 'RGB Layer 1 (L1)' : 'Bitcoin Layer 1' }] : []),
      ...(availableNetworkTypes.includes('lightning')
        ? [{ id: 'lightning' as ReceiveMode, label: isRgbAsset ? 'RGB Lightning' : 'Lightning', sub: isRgbAsset ? 'Instant · in-channel (RGB-LN)' : 'Instant · low fee' }] : []),
      ...(availableNetworkTypes.includes('spark')
        ? [{ id: 'spark' as ReceiveMode, label: 'Spark', sub: 'Instant' }] : []),
      ...(availableNetworkTypes.includes('arkade')
        ? [{ id: 'arkade' as ReceiveMode, label: 'Arkade', sub: 'Off-chain' }] : []),
    ];
    const current = options.find((o) => o.id === networkType) || options[0];
    if (!current) return null;
    const color = NETWORK_COLORS[current.id] || theme.colors.primary[500];

    const glyph = (id: ReceiveMode, c: string) =>
      id === 'unified'
        ? <Ionicons name="apps" size={18} color={c} />
        : <NetworkIcon network={id as ProtocolNetworkType} size={18} color={c} />;

    return (
      <View style={styles.netSelectorWrap}>
        <TouchableOpacity
          style={[styles.netSelector, showNetworkDropdown && { borderColor: color }]}
          onPress={() => { feedback.select(); setShowNetworkDropdown((v) => !v); }}
          activeOpacity={0.7}
        >
          <View style={[styles.netGlyph, { backgroundColor: color + '1A' }]}>
            {glyph(current.id, color)}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.netSelectorLabel}>{current.label}</Text>
            <Text style={styles.netSelectorSub} numberOfLines={1}>{current.sub}</Text>
          </View>
          <Ionicons
            name={showNetworkDropdown ? 'chevron-up' : 'chevron-down'}
            size={18}
            color={theme.colors.text.tertiary}
          />
        </TouchableOpacity>

        {showNetworkDropdown && (
          <View style={styles.netDropdown}>
            {options.map((o) => {
              const active = o.id === networkType;
              const c = NETWORK_COLORS[o.id] || theme.colors.primary[500];
              return (
                <TouchableOpacity
                  key={o.id}
                  style={[styles.netOption, active && { backgroundColor: c + '12' }]}
                  onPress={() => {
                    feedback.select();
                    setNetworkType(o.id);
                    setShowNetworkDropdown(false);
                  }}
                  activeOpacity={0.7}
                >
                  <View style={[styles.netGlyph, { backgroundColor: c + '1A' }]}>
                    {glyph(o.id, c)}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.netOptionLabel, active && { color: c }]}>{o.label}</Text>
                    <Text style={styles.netSelectorSub} numberOfLines={1}>{o.sub}</Text>
                  </View>
                  {active && <Ionicons name="checkmark-circle" size={18} color={c} />}
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      </View>
    );
  };

  // ── Amount row with pencil edit (opens the multi-currency editor) ─────────
  const renderAmountRow = () => {
    // The amount editor works in BTC/sats/fiat — it can't express an RGB asset
    // amount, and RGB invoices are open-amount anyway, so hide it for RGB assets.
    if (selectedAsset?.isRGB) return null;
    const summary = amountSummary();
    const required = isAmountRequired();
    return (
      <TouchableOpacity
        style={styles.amountRow}
        onPress={() => setShowAmountEditor(true)}
        activeOpacity={0.7}
      >
        <View style={styles.amountRowIcon}>
          <Ionicons name="cash-outline" size={18} color={theme.colors.primary[500]} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.amountRowLabel}>
            {summary ? 'Requested amount' : required ? 'Amount required' : 'Add amount'}
          </Text>
          <Text style={styles.amountRowValue} numberOfLines={1}>
            {summary || 'Optional — set in BTC, USD or other fiat'}
          </Text>
        </View>
        <View style={styles.amountEditBtn}>
          <Ionicons name="pencil" size={16} color={theme.colors.primary[500]} />
        </View>
      </TouchableOpacity>
    );
  };

  const renderUnifiedContent = () => {
    const accent = NETWORK_COLORS['unified'];
    return (
      <>
        {renderUnifiedBody(accent)}
        {renderUnifiedAddressList()}
      </>
    );
  };

  // Middle-truncate a long address/invoice for the collapsed card.
  const truncMid = (v: string, head = 22, tail = 14) =>
    v.length > head + tail + 1 ? `${v.slice(0, head)}…${v.slice(-tail)}` : v;

  // Reusable receive card: collapsed address/URI with copy + expand + share,
  // icon-driven to match rate-extension. Tapping the row copies; the chevron
  // reveals the full value; share lives as a small icon action.
  const renderUriCard = ({
    value, accent, label, icon, expanded, onToggle, onCopy, onShare,
  }: {
    value: string;
    accent: string;
    label: string;
    icon: React.ReactNode;
    // Expand ("Show full") is opt-in. The unified payment-request URI omits it —
    // the full value of each method is read/expanded in the address list below.
    expanded?: boolean;
    onToggle?: () => void;
    onCopy: () => void;
    onShare: () => void;
  }) => (
    <View style={[styles.uriCard, { borderLeftColor: accent }]}>
      <TouchableOpacity style={styles.uriCardRow} onPress={onCopy} activeOpacity={0.7}>
        <View style={[styles.uriIconWrap, { backgroundColor: accent + '1A' }]}>{icon}</View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.uriLabel}>{label}</Text>
          <Text style={styles.uriValue} numberOfLines={1}>{truncMid(value)}</Text>
        </View>
        <View style={styles.uriCopyBtn}>
          <Ionicons
            name={copied ? 'checkmark' : 'copy-outline'}
            size={18}
            color={copied ? theme.colors.success[500] : accent}
          />
        </View>
      </TouchableOpacity>

      {expanded && onToggle && <Text style={styles.uriFull} selectable>{value}</Text>}

      <View style={styles.uriActions}>
        {onToggle ? (
          <TouchableOpacity style={styles.uriActionChip} onPress={onToggle} activeOpacity={0.7}>
            <Ionicons
              name={expanded ? 'chevron-up' : 'chevron-down'}
              size={14}
              color={theme.colors.text.tertiary}
            />
            <Text style={styles.uriActionChipText}>{expanded ? 'Hide' : 'Show full'}</Text>
          </TouchableOpacity>
        ) : null}
        <View style={{ flex: 1 }} />
        <TouchableOpacity style={styles.uriIconAction} onPress={onShare} activeOpacity={0.7}>
          <Ionicons name="share-outline" size={18} color={theme.colors.text.secondary} />
        </TouchableOpacity>
      </View>
    </View>
  );

  // Clean QR-sized loader (no copy text) — a spinner sitting where the QR will be.
  const renderQrLoading = (accent: string) => (
    <View style={styles.qrSection}>
      <View style={styles.qrContainer}>
        <View style={[styles.qrCodeWrapper, styles.qrLoadingBox]}>
          <ActivityIndicator size="large" color={accent} />
        </View>
      </View>
    </View>
  );

  const renderUnifiedBody = (accent: string) => {
    // Only block on the spinner until the FIRST method is ready; after that the
    // QR is shown and remaining methods stream in (see the inline indicator).
    if (unifiedLoading && !unifiedUri) {
      return renderQrLoading(accent);
    }

    if (unifiedError && !unifiedUri) {
      return (
        <View style={styles.errorContainer}>
          <Ionicons name="alert-circle" size={48} color={theme.colors.error[500]} />
          <Text style={styles.errorText}>{unifiedError}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={generateUnifiedUri} activeOpacity={0.7}>
            <Text style={styles.retryButtonText}>Try Again</Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (!unifiedUri) {
      return (
        <View style={styles.promptContainer}>
          <Ionicons name="apps-outline" size={48} color={accent} />
          <Text style={styles.promptText}>
            Generate a single QR that any wallet can pay — on-chain, Lightning, Spark and Arkade combined.
          </Text>
          <TouchableOpacity style={[styles.generateButton, { backgroundColor: accent }]} onPress={generateUnifiedUri} activeOpacity={0.7}>
            <Text style={styles.generateButtonText}>Generate</Text>
          </TouchableOpacity>
        </View>
      );
    }

    return (
      <View style={styles.qrSection}>
        {/* Small refresh tucked top-right — the methods are already listed in the
            network selector above, so no duplicate methods chip here. */}
        <View style={styles.qrTopBar}>
          {unifiedLoading ? (
            <View style={styles.qrStreamHint}>
              <ActivityIndicator size="small" color={theme.colors.text.tertiary} />
              <Text style={styles.qrStreamHintText}>Adding more methods…</Text>
            </View>
          ) : (
            <View style={{ flex: 1 }} />
          )}
          <TouchableOpacity
            onPress={generateUnifiedUri}
            style={styles.qrRefreshBtn}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            activeOpacity={0.7}
          >
            <Ionicons name="refresh" size={15} color={theme.colors.text.tertiary} />
          </TouchableOpacity>
        </View>

        <View style={styles.qrContainer}>
          <View style={styles.qrCodeWrapper}>
            <QrCode value={unifiedUri} size={200} />
          </View>
        </View>

        {renderUriCard({
          value: unifiedUri,
          accent,
          label: 'Payment request',
          icon: <Ionicons name="apps" size={16} color={accent} />,
          // No "Show full" here — the composite BIP321 URI isn't meant to be read;
          // each method's full address is expandable in the list below.
          onCopy: copyUnifiedUri,
          onShare: async () => {
            try {
              await Share.share({ message: unifiedUri, title: 'Payment request' });
            } catch (e) { console.error('Failed to share unified URI:', e); }
          },
        })}
      </View>
    );
  };

  const renderContent = () => {
    if (networkType === 'unified') {
      return renderUnifiedContent();
    }

    if (loading) {
      return renderQrLoading(NETWORK_COLORS[networkType] || theme.colors.primary[500]);
    }

    if (error) {
      return (
        <View style={styles.errorContainer}>
          <Ionicons name="alert-circle" size={48} color={theme.colors.error[500]} />
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity 
            style={styles.retryButton} 
            onPress={generateAddress}
            activeOpacity={0.7}
          >
            <Text style={styles.retryButtonText}>Try Again</Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (isAmountRequired() && !isAmountValid()) {
      return (
        <View style={styles.promptContainer}>
          <Ionicons name="calculator" size={48} color={theme.colors.primary[500]} />
          <Text style={styles.promptText}>
            Please enter an amount to generate a Lightning invoice
          </Text>
        </View>
      );
    }

    if (!address) {
      return (
        <View style={styles.promptContainer}>
          <Ionicons name="qr-code-outline" size={48} color={theme.colors.primary[500]} />
          <Text style={styles.promptText}>
            Generate an address or invoice to receive payments
          </Text>
          <TouchableOpacity 
            style={styles.generateButton} 
            onPress={generateAddress}
            activeOpacity={0.7}
          >
            <Text style={styles.generateButtonText}>Generate</Text>
          </TouchableOpacity>
        </View>
      );
    }

    // Render QR code with network-aware title
    const qrTitle = networkType === 'spark' ? 'Spark Address'
      : networkType === 'arkade' ? (arkadeSubMode === 'boarding' ? 'Boarding Address' : 'Arkade Address')
      : networkType === 'lightning' ? 'Lightning Invoice'
      : selectedAsset.isRGB ? 'RGB Invoice'
      : 'On-chain Address';

    const netColor = NETWORK_COLORS[networkType] || theme.colors.primary[500];
    const addrLabel = networkType === 'lightning' ? 'Lightning Invoice'
      : networkType === 'spark' ? 'Spark Address'
      : networkType === 'arkade' ? (arkadeSubMode === 'boarding' ? 'Boarding Address' : 'Arkade Address')
      : 'Deposit Address';
    return (
      <View style={styles.qrSection}>
        {/* Type/amount chip on the left, small refresh tucked top-right. */}
        <View style={styles.qrTopBar}>
          <View style={[styles.qrMethodsChip, { backgroundColor: netColor + '18' }]}>
            <NetworkIcon network={networkType as ProtocolNetworkType} size={14} color={netColor} />
            <Text style={[styles.qrMethodsChipText, { color: netColor, marginLeft: 6 }]} numberOfLines={1}>
              {qrTitle}{amount && selectedAsset.ticker ? `  ·  ${amount} ${selectedAsset.ticker === 'BTC' ? bitcoinUnit : selectedAsset.ticker}` : ''}
            </Text>
          </View>
          <TouchableOpacity
            onPress={generateAddress}
            style={styles.qrRefreshBtn}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            activeOpacity={0.7}
          >
            <Ionicons name="refresh" size={15} color={theme.colors.text.tertiary} />
          </TouchableOpacity>
        </View>

        <View style={styles.qrContainer}>
          <View style={styles.qrCodeWrapper}>
            <QrCode value={address} size={200} />
          </View>
        </View>

        {renderUriCard({
          value: address,
          accent: netColor,
          label: addrLabel,
          icon: <NetworkIcon network={networkType} size={16} color={netColor} />,
          expanded: showFullAddr,
          onToggle: () => setShowFullAddr((v) => !v),
          onCopy: copyToClipboard,
          onShare: shareAddress,
        })}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right', 'bottom']}>
      <ScreenHeader title="Receive" showBack={true} />

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        {renderAssetTabs()}
        {renderNetworkDropdown()}
        {renderAmountRow()}
        {renderContent()}
      </ScrollView>

      {/* Asset picker (opened by the "+" tab) */}
      <AssetSelector
        visible={showAssetSelector}
        onClose={() => setShowAssetSelector(false)}
        onSelect={(asset) => {
          setSelectedAsset({
            asset_id: asset.asset_id,
            ticker: asset.ticker,
            name: asset.name,
            isRGB: asset.isRGB || asset.protocol === 'RGB',
            balance: asset.balance,
          });
        }}
        assets={allAssets.map((a) => ({
          asset_id: a.asset_id,
          ticker: a.ticker,
          name: a.name,
          balance: a.balance,
          isRGB: a.isRGB,
          protocol: a.isRGB ? ('RGB' as const) : undefined,
        }))}
        selectedAssetId={selectedAsset?.asset_id}
        title="Select Asset"
      />

      {/* "+" new-asset chooser (Spark / Arkade / new RGB asset) */}
      <NewAssetSheet
        visible={showNewAsset}
        onClose={() => setShowNewAsset(false)}
        available={(() => {
          const status = getProtocolStatus();
          return { spark: !!status.SPARK, arkade: !!status.ARKADE, rgb: !!status.RGB };
        })()}
        onPick={handleNewAsset}
        onChooseExisting={() => setShowAssetSelector(true)}
      />

      {/* Amount editor — WDK AmountInput (BTC ↔ USD) inside a bottom sheet */}
      <AmountEditorModal
        visible={showAmountEditor}
        onClose={() => setShowAmountEditor(false)}
        initialSats={currentAmountSats}
        rates={fiatRates}
        bitcoinUnit={bitcoinUnit}
        balanceSats={btcBalance?.vanilla?.spendable || 0}
        onConfirm={applyAmountSats}
      />

      <DepositSuccessOverlay
        visible={showDepositSuccess}
        ticker={selectedAsset?.ticker || 'BTC'}
        network={networkType === 'unified' ? undefined : networkType}
        onDone={() => {
          setShowDepositSuccess(false);
          navigation.goBack();
        }}
      />
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
    marginBottom: theme.spacing[6],
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
  
  assetSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.spacing[5],
    paddingVertical: theme.spacing[4],
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    marginHorizontal: theme.spacing[5],
    borderRadius: theme.borderRadius.xl,
  },
  
  assetIconContainer: {
    width: 40,
    height: 40,
    borderRadius: theme.borderRadius.lg,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: theme.spacing[3],
  },
  
  assetIconImage: {
    width: 28,
    height: 28,
    borderRadius: 14,
  },
  
  assetInfo: {
    flex: 1,
  },
  
  assetTicker: {
    fontSize: theme.typography.fontSize.lg,
    fontWeight: '700',
    color: theme.colors.text.inverse,
    marginBottom: theme.spacing[1],
  },
  
  assetName: {
    fontSize: theme.typography.fontSize.sm,
    color: 'rgba(255, 255, 255, 0.8)',
    marginBottom: theme.spacing[1],
  },
  
  assetBalance: {
    fontSize: theme.typography.fontSize.xs,
    color: 'rgba(255, 255, 255, 0.7)',
  },
  
  chevronContainer: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  
  assetDropdown: {
    backgroundColor: theme.colors.surface.primary,
    marginHorizontal: theme.spacing[5],
    marginTop: theme.spacing[2],
    borderRadius: theme.borderRadius.xl,
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
  
  // Network Tabs
  networkTabsContainer: {
    paddingHorizontal: theme.spacing[5],
    marginBottom: theme.spacing[5],
    marginTop: -theme.spacing[2], // Slight overlap with header
  },
  
  networkTabs: {
    flexDirection: 'row',
    backgroundColor: theme.colors.surface.primary,
    borderRadius: theme.borderRadius.xl,
    padding: theme.spacing[1],
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 3.84,
    elevation: 5,
  },
  
  networkTab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
    borderRadius: theme.borderRadius.lg,
    gap: theme.spacing[2],
  },
  
  networkTabActive: {
    backgroundColor: theme.colors.primary[50],
  },
  
  networkTabText: {
    fontSize: theme.typography.fontSize.sm,
    fontWeight: '600',
    color: theme.colors.text.secondary,
  },
  
  networkTabTextActive: {
    color: theme.colors.primary[500],
  },

  networkTabContent: {
    alignItems: 'center',
  },

  networkTabSubtext: {
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.text.muted,
    marginTop: theme.spacing[1],
  },

  networkTabSubtextActive: {
    color: theme.colors.primary[500],
  },

  networkTabDisabled: {
    opacity: 0.6,
  },

  networkTabLoader: {
    marginLeft: theme.spacing[2],
  },

  networkWarning: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.warning[50],
    borderRadius: theme.borderRadius.base,
    padding: theme.spacing[3],
    marginTop: theme.spacing[3],
    marginHorizontal: theme.spacing[1],
    gap: theme.spacing[2],
  },

  networkWarningText: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.warning[600],
    flex: 1,
    lineHeight: 18,
  },
  
  scrollView: {
    flex: 1,
  },
  
  scrollContent: {
    paddingHorizontal: theme.spacing[5],
    paddingTop: theme.spacing[3],
    paddingBottom: theme.spacing[10],
  },
  
  // Amount Section
  amountSection: {
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
  
  errorMessage: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.error[50],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderRadius: theme.borderRadius.base,
    marginBottom: theme.spacing[3],
    gap: theme.spacing[2],
  },
  
  errorMessageText: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.error[600],
    fontWeight: '500',
  },
  
  inputContainer: {
    position: 'relative',
  },
  
  amountInput: {
    paddingRight: theme.spacing[16], // Make room for currency label
  },
  
  amountInputError: {
    borderColor: theme.colors.error[500],
    borderWidth: 2,
  },
  
  currencyLabel: {
    position: 'absolute',
    right: theme.spacing[4],
    top: '50%',
    transform: [{ translateY: -10 }],
    backgroundColor: theme.colors.gray[100],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[1],
    borderRadius: theme.borderRadius.base,
  },
  
  currencyText: {
    fontSize: theme.typography.fontSize.sm,
    fontWeight: '600',
    color: theme.colors.text.secondary,
  },

  quickAmounts: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: theme.spacing[3],
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
  
  quickAmountButtonSelected: {
    backgroundColor: theme.colors.primary[100],
    borderColor: theme.colors.primary[500],
  },
  
  quickAmountText: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.primary[700],
    fontWeight: '600',
  },
  
  quickAmountTextSelected: {
    color: theme.colors.primary[700],
    fontWeight: '700',
  },
  
  approximateValue: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.text.secondary,
    marginTop: theme.spacing[2],
    textAlign: 'right',
  },

  lightningWarnings: {
    marginTop: theme.spacing[3],
    gap: theme.spacing[2],
  },

  warningContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.primary[50],
    borderRadius: theme.borderRadius.base,
    padding: theme.spacing[3],
    gap: theme.spacing[2],
    borderWidth: 1,
    borderColor: theme.colors.primary[500] + '20', // 20% opacity
  },

  errorWarning: {
    backgroundColor: theme.colors.warning[50],
    borderColor: theme.colors.warning[500] + '20', // 20% opacity
  },

  warningText: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.primary[600],
    flex: 1,
    lineHeight: 18,
  },

  errorWarningText: {
    color: theme.colors.warning[600],
  },
  
  // Content sections
  loadingSection: {
    backgroundColor: theme.colors.surface.primary,
    borderRadius: theme.borderRadius.xl,
    padding: theme.spacing[12],
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.15,
    shadowRadius: 6.27,
    elevation: 10,
  },
  
  loadingText: {
    fontSize: theme.typography.fontSize.base,
    color: theme.colors.text.secondary,
    marginTop: theme.spacing[4],
    textAlign: 'center',
  },

  errorContainer: {
    backgroundColor: theme.colors.surface.primary,
    borderRadius: theme.borderRadius.xl,
    padding: theme.spacing[8],
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.15,
    shadowRadius: 6.27,
    elevation: 10,
  },
  
  errorText: {
    fontSize: theme.typography.fontSize.base,
    color: theme.colors.text.secondary,
    marginTop: theme.spacing[4],
    marginBottom: theme.spacing[6],
    textAlign: 'center',
    lineHeight: 22,
  },
  
  promptContainer: {
    backgroundColor: theme.colors.surface.primary,
    borderRadius: theme.borderRadius.xl,
    padding: theme.spacing[8],
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.15,
    shadowRadius: 6.27,
    elevation: 10,
  },
  
  promptText: {
    fontSize: theme.typography.fontSize.base,
    color: theme.colors.text.secondary,
    marginTop: theme.spacing[4],
    marginBottom: theme.spacing[6],
    textAlign: 'center',
    lineHeight: 22,
  },
  
  retryButton: {
    backgroundColor: theme.colors.primary[500],
    paddingHorizontal: theme.spacing[6],
    paddingVertical: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
  },
  
  retryButtonText: {
    fontSize: theme.typography.fontSize.sm,
    fontWeight: '600',
    color: theme.colors.text.inverse,
  },
  
  generateButton: {
    backgroundColor: theme.colors.primary[500],
    paddingHorizontal: theme.spacing[8],
    paddingVertical: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
  },
  
  generateButtonText: {
    fontSize: theme.typography.fontSize.base,
    fontWeight: '600',
    color: theme.colors.text.inverse,
  },
  
  // QR Section
  assetTabs: {
    flexDirection: 'row',
    gap: theme.spacing[2],
    marginBottom: theme.spacing[3],
  },
  assetTab: {
    flex: 1,
    flexDirection: 'row',
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[2],
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1.5,
    borderColor: theme.colors.border.medium,
    backgroundColor: theme.colors.surface.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  assetTabText: {
    fontSize: theme.typography.fontSize.base,
    fontWeight: '600',
    color: theme.colors.text.secondary,
  },
  addrListSection: {
    marginHorizontal: 16,
    marginTop: 8,
    backgroundColor: theme.colors.surface.primary,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.colors.border.light,
    padding: 12,
  },
  addrListTitle: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: theme.colors.text.tertiary,
    marginBottom: 6,
    paddingHorizontal: 4,
  },
  addrRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border.light,
  },
  addrDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  addrLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: theme.colors.text.primary,
  },
  addrValue: {
    fontSize: 12,
    color: theme.colors.text.muted,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    marginTop: 1,
  },
  addrInfoToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 12,
    paddingHorizontal: 4,
  },
  addrInfoToggleText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
    color: theme.colors.text.tertiary,
  },
  addrInfoBody: {
    fontSize: 12,
    lineHeight: 18,
    color: theme.colors.text.muted,
    paddingHorizontal: 4,
    paddingBottom: 8,
  },
  addRgbBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 4,
    paddingVertical: 11,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.colors.border.medium,
    borderStyle: 'dashed',
  },
  addRgbText: {
    fontSize: 14,
    fontWeight: '700',
    color: theme.colors.primary[500],
  },
  qrSection: {
    backgroundColor: theme.colors.surface.primary,
    borderRadius: theme.borderRadius.xl,
    paddingHorizontal: theme.spacing[6],
    paddingTop: theme.spacing[4],
    paddingBottom: theme.spacing[5],
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.15,
    shadowRadius: 6.27,
    elevation: 10,
  },

  qrHeader: {
    alignItems: 'center',
    marginBottom: theme.spacing[3],
  },

  qrTitle: {
    fontSize: theme.typography.fontSize.lg,
    fontWeight: '700',
    color: theme.colors.text.primary,
    textAlign: 'center',
    marginBottom: theme.spacing[1],
  },
  
  qrAmountContainer: {
    backgroundColor: theme.colors.primary[50],
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[2],
    borderRadius: theme.borderRadius.full,
  },
  
  qrAmount: {
    fontSize: theme.typography.fontSize.base,
    fontWeight: '600',
    color: theme.colors.primary[600],
  },
  
  qrContainer: {
    alignItems: 'center',
    marginBottom: theme.spacing[5],
  },
  
  qrCodeWrapper: {
    padding: theme.spacing[4],
    backgroundColor: '#FFFFFF', // QR must sit on white to stay scannable
    borderRadius: theme.borderRadius.xl,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 3.84,
    elevation: 5,
  },

  // Compact methods/label chip above the QR
  qrMethodsChip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[1],
    borderRadius: theme.borderRadius.full,
    marginBottom: theme.spacing[4],
    maxWidth: '100%',
  },
  qrMethodsChipText: {
    fontSize: theme.typography.fontSize.xs,
    fontWeight: '700',
  },

  // Top bar above the QR (chip on the left, small refresh on the right)
  qrTopBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    gap: theme.spacing[2],
    marginBottom: theme.spacing[4],
    minHeight: 30,
  },
  qrRefreshBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surface.secondary,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border.light,
  },
  qrStreamHint: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  qrStreamHintText: {
    fontSize: 11,
    color: theme.colors.text.tertiary,
    fontWeight: '500',
  },
  // Loading placeholder sized to match the QR (200 + 16 padding each side)
  qrLoadingBox: {
    width: 232,
    height: 232,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Collapsible receive card (address / unified URI)
  uriCard: {
    width: '100%',
    backgroundColor: theme.colors.gray[50],
    borderRadius: theme.borderRadius.lg,
    borderLeftWidth: 3,
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[3],
    marginBottom: theme.spacing[2],
  },
  uriCardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[3],
  },
  uriIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  uriLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: theme.colors.text.tertiary,
  },
  uriValue: {
    fontSize: 12,
    color: theme.colors.text.primary,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    marginTop: 2,
  },
  uriCopyBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surface.primary,
  },
  uriFull: {
    fontSize: 12,
    lineHeight: 18,
    color: theme.colors.text.secondary,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    marginTop: theme.spacing[3],
    paddingTop: theme.spacing[3],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.colors.border.light,
  },
  uriActions: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: theme.spacing[2],
  },
  uriActionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 6,
    borderRadius: 8,
  },
  uriActionChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: theme.colors.text.tertiary,
  },
  uriIconAction: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surface.primary,
  },

  // Asset "+" tab (square add button)
  assetAddTab: {
    width: 44,
    paddingVertical: theme.spacing[2],
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1.5,
    borderColor: theme.colors.border.medium,
    backgroundColor: theme.colors.surface.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Network selector + dropdown
  netSelectorWrap: {
    marginBottom: theme.spacing[4],
  },
  netSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[3],
    padding: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1.5,
    borderColor: theme.colors.border.medium,
    backgroundColor: theme.colors.surface.primary,
  },
  netGlyph: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  netSelectorLabel: {
    fontSize: theme.typography.fontSize.base,
    fontWeight: '700',
    color: theme.colors.text.primary,
  },
  netSelectorSub: {
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.text.tertiary,
    marginTop: 1,
  },
  netDropdown: {
    marginTop: theme.spacing[2],
    backgroundColor: theme.colors.surface.primary,
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border.light,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 6,
  },
  netOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border.light,
  },
  netOptionLabel: {
    fontSize: theme.typography.fontSize.sm,
    fontWeight: '600',
    color: theme.colors.text.primary,
  },

  // Amount row with pencil edit
  amountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[3],
    marginBottom: theme.spacing[4],
    padding: theme.spacing[4],
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface.primary,
    borderWidth: 1,
    borderColor: theme.colors.border.light,
  },
  amountRowIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: theme.colors.primary[50],
    alignItems: 'center',
    justifyContent: 'center',
  },
  amountRowLabel: {
    fontSize: theme.typography.fontSize.xs,
    fontWeight: '700',
    color: theme.colors.text.tertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  amountRowValue: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.text.primary,
    marginTop: 2,
  },
  amountEditBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: theme.colors.primary[50],
    alignItems: 'center',
    justifyContent: 'center',
  },
  
  addressContainer: {
    width: '100%',
    backgroundColor: theme.colors.gray[50],
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing[4],
    marginBottom: theme.spacing[5],
  },
  
  addressLabel: {
    fontSize: theme.typography.fontSize.sm,
    fontWeight: '600',
    color: theme.colors.text.secondary,
    marginBottom: theme.spacing[2],
  },
  
  addressText: {
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.text.primary,
    fontFamily: 'monospace',
    lineHeight: 16,
  },
  
  qrActions: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    width: '100%',
    paddingTop: theme.spacing[2],
  },
  
  qrActionButton: {
    alignItems: 'center',
    padding: theme.spacing[3],
    flex: 1,
  },
  
  qrActionIcon: {
    width: 40,
    height: 40,
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.primary[50],
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: theme.spacing[2],
  },
  
  qrActionText: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.primary[500],
    fontWeight: '600',
  },
});