// screens/DashboardScreen.tsx
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Alert,
  Dimensions,
  StatusBar,
  Modal,
  DeviceEventEmitter,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useDispatch, useSelector } from 'react-redux';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import { RootState } from '../store';
import { initializeProtocolServices } from '../services/initializeServices';
import { protocolManager } from '../services/protocols';
import { setBtcBalance } from '../store/slices/walletSlice';
import { setRgbAssets } from '../store/slices/assetsSlice';
import { loadNostrProfile } from '../store/slices/nostrSlice';
import {
  selectDisclosureLevel,
  selectAiEnabled,
  selectAiOnboarded,
  setAiMode,
  setAiOnboarded,
} from '../store/slices/settingsSlice';
import QVACService from '../services/QVACService';
import { KaleidoMindOnboarding, type MindAvailability } from '../components/mind/KaleidoMindOnboarding';
import { policyFor, aggregateForLite } from '@kaleidorg/wallet-engine';

import { theme } from '../theme';
import { VoiceAgentOverlay } from '../components/voice-agent/VoiceAgentOverlay';
import {
  BalanceCard,
  ActionButtons,
  AssetList,
  ChannelList,
  MainHeader
} from '../components';
import { formatBitcoinAmount, useBitcoinConversion, useDisplayAmount } from '../utils/bitcoinUnits';
import { formatAssetAmount, getAssetBaseUnitBalance } from '../utils/assetAmount';
import { getAssetFamily } from '../utils/account-routing';
import { isUsdbTokenAddress, USDB_DECIMALS, USDB_NAME, USDB_TICKER } from '../utils/flashnet';
import { RecentActivityWidget } from '../components/RecentActivityWidget';

const { width } = Dimensions.get('window');

interface Props {
  navigation: any;
}

interface NiaAsset {
  asset_id: string;
  asset_iface: string;
  ticker: string;
  name: string;
  details: string | null;
  precision: number;
  issued_supply: number;
  timestamp: number;
  added_at: number;
  balance: {
    settled: number;
    future: number;
    spendable: number;
    offchain_outbound?: number;
    offchain_inbound?: number;
  };
  media: string | null;
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

/**
 * A time-of-day greeting with a little variety so it changes between opens.
 * `name` (the user's Nostr name, when connected) is used when present; when no
 * Nostr profile name is set we fall back to "anon" so the greeting still reads
 * personally (the wallet stays usable without Nostr).
 */
function buildGreeting(name?: string): string {
  const hour = new Date().getHours();
  const pool =
    hour < 5 ? ['Still up', 'Good night', 'Hi']
    : hour < 12 ? ['Good morning', 'Morning', 'Rise and shine']
    : hour < 17 ? ['Good afternoon', 'Hey there', 'Hi']
    : hour < 21 ? ['Good evening', 'Evening', 'Welcome back']
    : ['Good night', 'Winding down', 'Hi'];
  const phrase = pool[Math.floor(Math.random() * pool.length)];
  return `${phrase}, ${name || 'anon'}`;
}

export default function DashboardScreen({ navigation }: Props) {
  const isScreenFocused = useIsFocused();
  const dispatch = useDispatch();
  const { nodeInfo } = useSelector((state: RootState) => state.node);
  const bitcoinUnit = useSelector((state: RootState) => state.settings.bitcoinUnit);
  // Header greeting uses the Nostr display name when connected; falls back to a
  // name-less greeting otherwise (Nostr stays optional — see header below).
  const nostrName = useSelector((state: RootState) => {
    const p = state.nostr?.profile;
    return (p?.display_name || p?.name || '').trim();
  });
  const greeting = useMemo(() => buildGreeting(nostrName || undefined), [nostrName]);

  // If Nostr is connected but we never pulled the profile (the wallet-side
  // connect path doesn't fetch it, and a restored connection doesn't either),
  // fetch it once so the greeting can show the account's name.
  const nostrConnected = useSelector(
    (state: RootState) => !!(state.nostr?.isConnected || state.nostr?.hasStoredKeys),
  );
  const nostrProfileLoaded = useSelector((state: RootState) => !!state.nostr?.profile);
  const triedNostrProfile = useRef(false);
  useEffect(() => {
    if (nostrConnected && !nostrProfileLoaded && !triedNostrProfile.current) {
      triedNostrProfile.current = true;
      dispatch(loadNostrProfile() as any);
    }
  }, [nostrConnected, nostrProfileLoaded, dispatch]);
  const disclosureLevel = useSelector(selectDisclosureLevel);
  // On-device AI is opt-in; only surface the voice agent FAB once it's enabled
  // so the QVAC Bare worklet can't be started (and crash) before a native rebuild.
  const aiEnabled = useSelector(selectAiEnabled);
  const aiOnboarded = useSelector(selectAiOnboarded);
  const policy = policyFor(disclosureLevel);
  const isLite = disclosureLevel === 'lite';
  const [isNodeUnlocked, setIsNodeUnlocked] = useState(false);
  const [isConnecting, setIsConnecting] = useState(true);
  const [voiceAgentOpen, setVoiceAgentOpen] = useState(false);
  const [voiceAutoListen, setVoiceAutoListen] = useState(false);
  // One-time KaleidoMind onboarding (lets the user pick local / delegate / off).
  const [mindOnboardingOpen, setMindOnboardingOpen] = useState(false);
  const [mindAvailability, setMindAvailability] = useState<MindAvailability | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [protocolsReady, setProtocolsReady] = useState(false);
  // Startup initializes protocols and then fetches balances in the same async
  // focus callback. React state does not update synchronously, so reading
  // `protocolsReady` from that callback used to see the initial false value and
  // skip the first balance load. These refs are the immediate lifecycle gates;
  // state remains the source of truth for rendering.
  const protocolsReadyRef = useRef(false);
  const [refreshing, setRefreshing] = useState(false);
  const { formatSatoshisToUSD } = useBitcoinConversion();
  // Denomination-aware formatter for the headline balance (tap to cycle sats/BTC/fiat).
  const { format: formatDisplayAmount, cycle: cycleDenomination } = useDisplayAmount();
  const [loading, setLoading] = useState(true);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [btcBalance, setBtcBalanceState] = useState<{
    vanilla: { settled: number; future: number; spendable: number };
    colored: { settled: number; future: number; spendable: number };
  }>({
    vanilla: { settled: 0, future: 0, spendable: 0 },
    colored: { settled: 0, future: 0, spendable: 0 },
  });
  const [rgbAssets, setRgbAssetsState] = useState<NiaAsset[]>([]);
  const [isUpdating, setIsUpdating] = useState(false);
  const isUpdatingRef = useRef(false);

  // Modal state for channel details
  const [channelModalVisible, setChannelModalVisible] = useState(false);
  const [selectedChannel, setSelectedChannel] = useState<Channel | null>(null);

  // Open the KaleidoMind voice agent. `autoListen` is set when triggered via a
  // press-and-hold on the FAB, so the assistant starts listening immediately.
  const openVoiceAgent = useCallback((autoListen: boolean) => {
    if (aiEnabled) {
      setVoiceAutoListen(autoListen);
      setVoiceAgentOpen(true);
      return;
    }
    // AI is opt-in (off by default). Re-open the one-time setup so the user
    // can pick how KaleidoMind runs — nothing starts the worklet unprompted.
    QVACService.getInstance()
      .getAvailability()
      .then((a) => setMindAvailability(a))
      .catch(() => {})
      .finally(() => setMindOnboardingOpen(true));
  }, [aiEnabled]);

  // The bottom-nav island's green mic button (in App.tsx, global across tabs)
  // emits this event; it focuses the Wallet tab first so this screen is active.
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener('rate.openVoice', () => openVoiceAgent(true));
    return () => sub.remove();
  }, [openVoiceAgent]);

  // First run: probe whether KaleidoMind can run here, then show the one-time
  // setup so the user decides once (local / delegate / off). Never boots the
  // worklet — getAvailability() only reads device capability.
  useEffect(() => {
    if (aiOnboarded) return;
    let active = true;
    QVACService.getInstance()
      .getAvailability()
      .then((a) => {
        if (active) {
          setMindAvailability(a);
          setMindOnboardingOpen(true);
        }
      })
      .catch(() => {
        if (active) setMindOnboardingOpen(true);
      });
    return () => {
      active = false;
    };
  }, [aiOnboarded]);

  const finishMindOnboarding = useCallback(() => {
    dispatch(setAiOnboarded(true));
    setMindOnboardingOpen(false);
  }, [dispatch]);

  const handleMindLocal = useCallback(() => {
    dispatch(setAiMode('local'));
    finishMindOnboarding();
  }, [dispatch, finishMindOnboarding]);

  const handleMindDelegate = useCallback(() => {
    // Don't commit to 'delegate' until pairing actually succeeds — otherwise
    // backing out of the scanner would strand the user in a desktop mode with no
    // connection. PairDesktopScreen sets aiMode='delegate' on a successful pair.
    finishMindOnboarding();
    navigation.getParent()?.navigate('PairDesktop');
  }, [finishMindOnboarding, navigation]);

  const handleMindSkip = useCallback(() => {
    dispatch(setAiMode('off'));
    finishMindOnboarding();
  }, [dispatch, finishMindOnboarding]);

  // Initialize protocol services (only once)
  const initializeApi = useCallback(async () => {
    if (protocolsReadyRef.current) return true; // Already initialized

    try {
      console.log('Initializing protocol services...');
      const { results } = await initializeProtocolServices();

      const anyConnected = Array.from(results.values()).some(r => r.success);

      // Report which protocols failed (non-blocking). A `skipped:` error is an
      // expected unconfigured state (e.g. RGB with no NWC node paired), not a
      // failure — keep it out of the warning so a fresh wallet logs clean.
      const failed: string[] = [];
      const skipped: string[] = [];
      for (const [proto, result] of results) {
        if (result.success) continue;
        const entry = `${proto}: ${result.error || 'failed'}`;
        (result.error?.startsWith('skipped:') ? skipped : failed).push(entry);
      }
      if (failed.length > 0) {
        console.warn('[Dashboard] Protocol failures:', failed.join(', '));
      }
      if (skipped.length > 0) {
        console.log('[Dashboard] Protocols skipped:', skipped.join(', '));
      }

      if (anyConnected) {
        protocolsReadyRef.current = true;
        setProtocolsReady(true);
        // Show warning toast if some protocols failed but at least one connected
        if (failed.length > 0) {
          const connected = Array.from(results.entries()).filter(([, r]) => r.success).map(([p]) => p);
          setConnectionError(null); // Clear any previous hard error
          console.log(`[Dashboard] Connected: ${connected.join(', ')} | Failed: ${failed.join(', ')}`);
        }
        return true;
      }

      // Check if any adapter is already connected from a previous init
      const protocols: Array<'RGB' | 'SPARK' | 'ARKADE'> = ['RGB', 'SPARK', 'ARKADE'];
      for (const proto of protocols) {
        const adapter = protocolManager.getAdapterIfAvailable(proto);
        if (adapter?.isConnected()) {
          protocolsReadyRef.current = true;
          setProtocolsReady(true);
          return true;
        }
      }

      // Nothing connected — show error with details (include skipped reasons so
      // the user knows what still needs configuring).
      const details = [...failed, ...skipped];
      if (details.length > 0) {
        setConnectionError(`Failed to connect:\n${details.join('\n')}`);
      } else {
        setConnectionError('No wallet protocols connected. Please configure a wallet.');
      }
      return null;
    } catch (error) {
      console.error('Failed to initialize protocol services:', error);
      setConnectionError(error instanceof Error ? error.message : 'Failed to initialize');
      return null;
    }
  }, []);

  const checkNodeStatus = async (skipInitialization = false) => {
    try {
      setIsConnecting(true);
      setConnectionError(null);

      if (!skipInitialization && !protocolsReadyRef.current) {
        await initializeApi();
      }

      // Try any connected adapter
      let info: any = null;
      const protocols: Array<'RGB' | 'SPARK' | 'ARKADE'> = ['RGB', 'SPARK', 'ARKADE'];
      for (const proto of protocols) {
        try {
          const adapter = protocolManager.getAdapterIfAvailable(proto);
          if (adapter?.isConnected()) {
            info = await adapter.getNodeInfo();
            break;
          }
        } catch { /* try next */ }
      }

      if (!info) throw new Error('No wallet connected');
      console.log('Node info received:', info);
      setIsNodeUnlocked(true);
      return true;
    } catch (error) {
      console.error('Failed to get node info:', error);
      setIsNodeUnlocked(false);
      setConnectionError(error instanceof Error ? error.message : 'Unknown error occurred');
      return false;
    } finally {
      setIsConnecting(false);
    }
  };

  const loadDashboardData = async (showLoadingIndicator = true) => {
    if (!protocolsReadyRef.current || isUpdatingRef.current) {
      console.log('Skipping update: Protocols not ready or update in progress');
      return;
    }

    try {
      isUpdatingRef.current = true;
      setIsUpdating(true);
      if (showLoadingIndicator) {
        setLoading(true);
      }
      console.log('Loading dashboard data...');

      // Load via protocolManager (multi-protocol)
      const rgbAdapter = protocolManager.getAdapterIfAvailable('RGB');
      const sparkAdapter = protocolManager.getAdapterIfAvailable('SPARK');
      const arkadeAdapter = protocolManager.getAdapterIfAvailable('ARKADE');

      // Load BTC balance (aggregate from all connected adapters with per-protocol breakdown)
      console.log('Fetching BTC balance...');
      let totalConfirmed = 0, totalUnconfirmed = 0;
      const byProtocol: Record<string, { confirmed: number; unconfirmed: number; total: number }> = {};
      const adapterProtoMap: Array<[any, string]> = [
        [rgbAdapter, 'RGB'], [sparkAdapter, 'SPARK'], [arkadeAdapter, 'ARKADE'],
      ];
      // Fetch every adapter's BTC balance IN PARALLEL — previously serial, so the
      // headline balance waited on the sum of all adapter latencies. Now it waits
      // on the slowest single one.
      const balanceResults = await Promise.all(
        adapterProtoMap.map(async ([adapter, proto]) => {
          if (!adapter?.isConnected()) return null;
          try {
            return { proto, btc: await adapter.getBtcBalance() };
          } catch (e) {
            console.warn('Balance fetch error:', e);
            return null;
          }
        })
      );
      for (const r of balanceResults) {
        if (!r) continue;
        totalConfirmed += r.btc.confirmed;
        totalUnconfirmed += r.btc.unconfirmed;
        byProtocol[r.proto] = r.btc;
      }
      const balance = {
        vanilla: { settled: totalConfirmed, future: totalConfirmed + totalUnconfirmed, spendable: totalConfirmed },
        colored: { settled: 0, future: 0, spendable: 0 },
        byProtocol,
      };
      setBtcBalanceState(balance);
      dispatch(setBtcBalance(balance));

      // Load assets from all connected adapters (with protocol tag)
      console.log('Fetching assets...');
      let assets: any[] = [];
      const adapterMap: Array<[any, 'RGB' | 'SPARK' | 'ARKADE']> = [
        [rgbAdapter, 'RGB'], [sparkAdapter, 'SPARK'], [arkadeAdapter, 'ARKADE'],
      ];
      // Same treatment for assets — fetch each adapter's list concurrently.
      const assetResults = await Promise.all(
        adapterMap.map(async ([adapter, proto]) => {
          if (!adapter?.isConnected()) return [] as any[];
          try {
            const unifiedAssets = await adapter.listAssets();
            return unifiedAssets
              .filter((a: any) => a.id !== 'BTC')
              .map((a: any) => {
                const isUsdb = isUsdbTokenAddress(a.id);
                return {
                  asset_id: a.id,
                  ticker: isUsdb ? USDB_TICKER : a.ticker,
                  name: isUsdb ? USDB_NAME : a.name,
                  precision: isUsdb ? USDB_DECIMALS : a.precision,
                  issued_supply: a.metadata?.issued_supply || 0,
                  protocol: proto,
                  icon: a.icon,
                  balance: {
                    settled: a.balance.settled ?? a.balance.total,
                    future: a.balance.pending,
                    // `available` already folds in on-chain spendable + in-channel
                    // outbound (see NwcRgbAdapter.mapAssetBalance), so it reflects the
                    // real holdings even for an asset held purely in a channel.
                    spendable: a.balance.available,
                    offchain_outbound: a.balance.offchain_outbound ?? a.balance.locked ?? 0,
                    offchain_inbound: a.balance.offchain_inbound ?? 0,
                  },
                };
              });
          } catch (e) {
            console.warn('Asset fetch error:', e);
            return [] as any[];
          }
        })
      );
      assets = assetResults.flat();
      setRgbAssetsState(assets);

      const assetRecords = assets.map((asset: any) => ({
        wallet_id: 1,
        asset_id: asset.asset_id,
        ticker: asset.ticker,
        name: asset.name,
        precision: asset.precision,
        issued_supply: asset.issued_supply,
        // Carry the owning protocol so downstream (activity, asset detail) can
        // tell Spark/Arkade tokens apart from RGB instead of treating all as RGB.
        protocol: asset.protocol,
        balance: getAssetBaseUnitBalance(asset.balance),
        last_updated: Date.now()
      }));
      dispatch(setRgbAssets(assetRecords));

      // Load Lightning channels (RGB only)
      console.log('Fetching Lightning channels...');
      let channelsList: any[] = [];
      if (rgbAdapter?.isConnected()) {
        try { channelsList = await rgbAdapter.listChannels(); } catch { /* no channels */ }
      }
      setChannels(channelsList);

    } catch (error) {
      console.error('Failed to load dashboard data:', error);
      if (showLoadingIndicator) {
        Alert.alert(
          'Error',
          error instanceof Error ? error.message : 'Failed to load dashboard data'
        );
      }
    } finally {
      isUpdatingRef.current = false;
      setIsUpdating(false);
      if (showLoadingIndicator) {
        setLoading(false);
      }
    }
  };

  // Auto-refresh only while Dashboard is actually visible. A parent-stack modal
  // such as Receive keeps this component mounted; polling behind it can otherwise
  // collide with receive-address generation and monopolize the same adapters.
  useEffect(() => {
    let intervalId: NodeJS.Timeout;

    if (!protocolsReady || !isScreenFocused) return;

    const refreshData = async () => {
      if (!isUpdating) {
        await loadDashboardData(false);
      }
    };

    // The focus effect below owns the immediate refresh. This interval handles
    // only subsequent refreshes, avoiding two adapter bursts on focus.
    intervalId = setInterval(refreshData, 30000);

    return () => {
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, [protocolsReady, isScreenFocused, isNodeUnlocked, isConnecting]);

  // A spend elsewhere (KaleidoMind voice/chat payment tools) emits this so the
  // balance reflects it right away — plus a short follow-up once it settles —
  // instead of waiting for the 30s poll. loadDashboardData self-guards on
  // protocolsReady/isUpdating, so a stray emit is a no-op.
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener('rate.refreshBalance', () => {
      void loadDashboardData(false);
      setTimeout(() => void loadDashboardData(false), 2500);
    });
    return () => sub.remove();
  }, [protocolsReady]);

  // Update the useFocusEffect to handle screen focus
  useFocusEffect(
    useCallback(() => {
      const initializeAndLoad = async () => {
        const ready = await initializeApi();
        if (!ready) {
          await checkNodeStatus(true);
          return;
        }

        // Node metadata and balances are independent reads. Fetch them together
        // so a slow getNodeInfo() call cannot hold the headline balance hostage.
        await Promise.all([
          checkNodeStatus(true),
          loadDashboardData(true),
        ]);
      };

      void initializeAndLoad();
    }, [])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await loadDashboardData();
    setRefreshing(false);
  };

  const formatSatoshis = (satoshis: number): string => {
    return formatBitcoinAmount(satoshis, bitcoinUnit);
  };

  const formatUSD = (satoshis: number): string => {
    return formatSatoshisToUSD(satoshis);
  };

  const getTotalBtcBalance = (): number => {
    if (!btcBalance) return 0;
    return btcBalance.vanilla.spendable + btcBalance.colored.spendable;
  };

  const offChainBalance = channels.reduce(
    (sum, channel) => sum + channel.local_balance_sat,
    0
  );

  // Aggregate priced tokens into a sats-equivalent and fold them into the total,
  // matching the extension (totalBTC = btc across protocols + tokenValueSats).
  // Only assets with a known USD price contribute (USDB = $1); BTC is already
  // counted via getTotalBtcBalance()/offChainBalance.
  const btcPriceUSD = useSelector((state: RootState) => state.wallet.btcPriceUSD);
  const tokenValueSats = (() => {
    if (!btcPriceUSD || btcPriceUSD <= 0) return 0;
    let sats = 0;
    for (const a of rgbAssets as any[]) {
      const usd = a?.ticker === USDB_TICKER ? 1 : null;
      if (usd == null) continue;
      const display = getAssetBaseUnitBalance(a.balance) / Math.pow(10, a.precision || 0);
      sats += Math.round(((display * usd) / btcPriceUSD) * 100_000_000);
    }
    return sats;
  })();

  const totalBalance = offChainBalance + getTotalBtcBalance() + tokenValueSats;
  const denominatedTotal = formatDisplayAmount(totalBalance);

  // Lite-mode aggregation: collapse every asset into BTC / USD / other, hiding
  // which network each lives on. BTC is filtered out of `rgbAssets` upstream, so
  // its true total comes from `totalBalance` (on-chain + Lightning). USDt assets
  // bucket into `usd`; everything else stays in `other`.
  const assetTotalBaseUnits = (asset: any): number => {
    const balance = asset?.balance;
    if (typeof balance === 'number') return balance;
    return (
      Number(balance?.settled ?? balance?.total ?? getAssetBaseUnitBalance(balance)) +
      Number(balance?.offchain_inbound ?? 0) +
      Number(balance?.offchain_outbound ?? 0)
    );
  };

  const liteAssets = rgbAssets.map((asset) => ({
    id: asset.asset_id,
    ticker: asset.ticker,
    balance: { total: assetTotalBaseUnits(asset) },
  })) as any;
  const lite = aggregateForLite(liteAssets);
  // The aggregated USD figure is in base units; convert each contributing asset
  // to its human value using its own precision so the display reads as dollars.
  const liteUsdAssetIds = new Set(
    liteAssets
      .filter((a: any) => !lite.other.some((o: any) => o.id === a.id))
      .map((a: any) => a.id)
  );
  const liteUsdDisplay = rgbAssets
    .filter((asset) => liteUsdAssetIds.has(asset.asset_id))
    .reduce((sum, asset) => {
      const total = assetTotalBaseUnits(asset);
      return sum + total / Math.pow(10, asset.precision ?? 0);
    }, 0);
  // Assets the AssetList should show in lite mode: drop USDt (folded into the USD
  // figure) and keep the original rgbAssets shape the list already renders.
  const liteOtherAssets = rgbAssets.filter((asset) =>
    lite.other.some((o: any) => o.id === asset.asset_id)
  );

  // BTC is the wallet's base asset but is filtered out of `rgbAssets` upstream,
  // so it never reached the dashboard AssetList. Surface it at the top of the
  // list (matching AssetsScreen's BTC row). Balance is on-chain + Lightning, and
  // precision follows the BTC/sats display preference so formatAssetAmount renders
  // it the same way the rest of the wallet does.
  const btcListEntry = {
    asset_id: 'BTC',
    ticker: 'BTC',
    name: 'Bitcoin',
    precision: bitcoinUnit === 'BTC' ? 8 : 0,
    balance: { spendable: getTotalBtcBalance() },
  } as any;

  const renderChannelModal = () => (
    <Modal
      visible={channelModalVisible}
      transparent={true}
      animationType="slide"
      onRequestClose={() => setChannelModalVisible(false)}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Channel Details</Text>
            <TouchableOpacity
              style={styles.modalCloseButton}
              onPress={() => setChannelModalVisible(false)}
            >
              <Ionicons name="close" size={24} color={theme.colors.text.primary} />
            </TouchableOpacity>
          </View>

          {selectedChannel && (
            <ScrollView style={styles.modalBody} showsVerticalScrollIndicator={false}>
              {/* Channel Status */}
              <View style={styles.modalSection}>
                <Text style={styles.modalSectionTitle}>Status</Text>
                <View style={styles.modalStatusRow}>
                  <View style={[
                    styles.modalStatusDot,
                    { backgroundColor: selectedChannel.is_usable ? theme.colors.success[500] : theme.colors.error[500] }
                  ]} />
                  <Text style={styles.modalStatusText}>
                    {selectedChannel.ready ? 'Channel Open' : 'Channel Pending'}
                  </Text>
                  {selectedChannel.public ? (
                    <View style={styles.modalPublicBadge}>
                      <Ionicons name="globe-outline" size={12} color={theme.colors.primary[500]} />
                      <Text style={styles.modalPublicText}>Public</Text>
                    </View>
                  ) : (
                    <View style={styles.modalPrivateBadge}>
                      <Ionicons name="lock-closed-outline" size={12} color={theme.colors.gray[500]} />
                      <Text style={styles.modalPrivateText}>Private</Text>
                    </View>
                  )}
                </View>
              </View>

              {/* Peer Information */}
              <View style={styles.modalSection}>
                <Text style={styles.modalSectionTitle}>Peer Information</Text>
                <View style={styles.modalInfoRow}>
                  <Text style={styles.modalInfoLabel}>Alias</Text>
                  <Text style={styles.modalInfoValue}>
                    {selectedChannel.peer_alias || 'Unknown'}
                  </Text>
                </View>
                <View style={styles.modalInfoRow}>
                  <Text style={styles.modalInfoLabel}>Public Key</Text>
                  <Text style={styles.modalInfoValue} numberOfLines={1}>
                    {selectedChannel.peer_pubkey}
                  </Text>
                </View>
              </View>

              {/* Channel Capacity */}
              <View style={styles.modalSection}>
                <Text style={styles.modalSectionTitle}>Capacity</Text>
                <Text style={styles.modalCapacityValue}>
                  {formatSatoshis(selectedChannel.capacity_sat)} {bitcoinUnit}
                </Text>
              </View>

              {/* Bitcoin Liquidity */}
              <View style={styles.modalSection}>
                <Text style={styles.modalSectionTitle}>Bitcoin Liquidity</Text>
                <View style={styles.modalLiquidityContainer}>
                  <View style={styles.modalLiquidityRow}>
                    <View style={styles.modalLiquidityItem}>
                      <View style={styles.modalLiquidityIcon}>
                        <Ionicons name="arrow-up" size={16} color={theme.colors.success[500]} />
                      </View>
                      <View>
                        <Text style={styles.modalLiquidityLabel}>Outbound</Text>
                        <Text style={styles.modalLiquidityValue}>
                          {formatSatoshis(selectedChannel.outbound_balance_msat / 1000)} {bitcoinUnit}
                        </Text>
                      </View>
                    </View>
                    <View style={styles.modalLiquidityItem}>
                      <View style={styles.modalLiquidityIcon}>
                        <Ionicons name="arrow-down" size={16} color={theme.colors.primary[500]} />
                      </View>
                      <View>
                        <Text style={styles.modalLiquidityLabel}>Inbound</Text>
                        <Text style={styles.modalLiquidityValue}>
                          {formatSatoshis(selectedChannel.inbound_balance_msat / 1000)} {bitcoinUnit}
                        </Text>
                      </View>
                    </View>
                  </View>
                  <View style={styles.modalLiquidityBar}>
                    <View style={[
                      styles.modalLiquidityBarFill,
                      {
                        width: `${(selectedChannel.outbound_balance_msat + selectedChannel.inbound_balance_msat) > 0 ?
                          (selectedChannel.outbound_balance_msat / (selectedChannel.outbound_balance_msat + selectedChannel.inbound_balance_msat) * 100) : 0}%`,
                        backgroundColor: theme.colors.success[500]
                      }
                    ]} />
                  </View>
                </View>
              </View>

              {/* RGB Asset Liquidity (if applicable) */}
              {selectedChannel.asset_id && (() => {
                // Channel asset amounts are in base units; divide by the asset's
                // real precision (USDT=6, XAUT=9, …), not a hardcoded 8.
                const channelAssetPrecision =
                  rgbAssets.find((a) => a.asset_id === selectedChannel.asset_id)?.precision ?? 8;
                return (
                <View style={styles.modalSection}>
                  <Text style={styles.modalSectionTitle}>RGB Asset Liquidity</Text>
                  <View style={styles.modalLiquidityContainer}>
                    <View style={styles.modalLiquidityRow}>
                      <View style={styles.modalLiquidityItem}>
                        <View style={styles.modalLiquidityIcon}>
                          <Ionicons name="arrow-up" size={16} color={theme.colors.secondary[500]} />
                        </View>
                        <View>
                          <Text style={styles.modalLiquidityLabel}>Local</Text>
                          <Text style={styles.modalLiquidityValue}>
                            {formatAssetAmount(selectedChannel.asset_local_amount, channelAssetPrecision)}
                          </Text>
                        </View>
                      </View>
                      <View style={styles.modalLiquidityItem}>
                        <View style={styles.modalLiquidityIcon}>
                          <Ionicons name="arrow-down" size={16} color={theme.colors.secondary[600]} />
                        </View>
                        <View>
                          <Text style={styles.modalLiquidityLabel}>Remote</Text>
                          <Text style={styles.modalLiquidityValue}>
                            {formatAssetAmount(selectedChannel.asset_remote_amount, channelAssetPrecision)}
                          </Text>
                        </View>
                      </View>
                    </View>
                  </View>
                </View>
                );
              })()}
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />

      {/* Sticky header: lives outside the ScrollView so it stays fixed while
          content scrolls beneath it. `elevated` gives it a downward shadow. */}
      <MainHeader
        title={greeting}
        showLogo={false}
        showSettings
        elevated
      />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={theme.colors.primary[500]}
            colors={[theme.colors.primary[500]]}
          />
        }
      >
        {/* Unified wallet card: balance + per-network breakdown + action buttons. */}
        <View style={styles.walletCard}>
          <BalanceCard
            totalBalance={totalBalance}
            bitcoinUnit={bitcoinUnit}
            onRefresh={onRefresh}
            refreshing={refreshing}
            formatSatoshis={formatSatoshis}
            formatUSD={formatUSD}
            primaryText={denominatedTotal.primary}
            primaryUnitLabel={denominatedTotal.unitLabel}
            secondaryText={denominatedTotal.secondary}
            onCycleDenomination={cycleDenomination}
            onChainBalance={getTotalBtcBalance()}
            lightningBalance={offChainBalance}
            // Always provide the per-network breakdown; it stays collapsed behind
            // the chevron so it doesn't clutter lite mode.
            byProtocol={(btcBalance as any)?.byProtocol}
            // Shimmer the balance while first connecting (before any data lands).
            loading={(isConnecting || loading) && totalBalance === 0 && !refreshing}
            footer={
              <ActionButtons
                onSend={() => navigation.getParent()?.navigate('Send')}
                onReceive={() => navigation.getParent()?.navigate('Receive')}
                onSwap={() => navigation.getParent()?.navigate('Swap')}
              />
            }
          />
        </View>


        {isLite && liteUsdDisplay > 0 && (
          <View style={styles.liteUsdCard}>
            <View style={styles.liteUsdLeft}>
              <View style={styles.liteUsdIcon}>
                <Ionicons name="cash-outline" size={20} color={theme.colors.success[600]} />
              </View>
              <Text style={styles.liteUsdLabel}>USD</Text>
            </View>
            <Text style={styles.liteUsdValue}>${liteUsdDisplay.toFixed(2)}</Text>
          </View>
        )}

        <AssetList
          // BTC always leads the list; in lite mode hide USDt (it's folded into the
          // USD figure above) and strip the per-asset protocol badge (a network detail).
          assets={[
            btcListEntry,
            ...(isLite
              ? liteOtherAssets.map((a) => ({ ...a, protocol: undefined }))
              // The list mixes protocols (RGB, Spark tokens, Arkade), so tag each
              // asset with its real family for the badge instead of leaving it bare.
              : rgbAssets.map((a) => ({
                  ...a,
                  // rgbAssets never contains BTC (filtered upstream), so the family
                  // is always one of the badge-able protocols.
                  protocol: getAssetFamily(a.asset_id, a.ticker) as 'RGB' | 'SPARK' | 'ARKADE',
                }))),
          ]}
          onViewAll={() => navigation.getParent()?.navigate('Assets')}
          onAssetPress={(asset) => {
            const family = getAssetFamily(asset.asset_id, asset.ticker);
            navigation.getParent()?.navigate('AssetDetail', {
              asset: {
                ...asset,
                // Only RGB assets route through the RGB detail/send flow; Spark
                // tokens and BTC must not be treated as RGB.
                isRGB: family === 'RGB',
                protocol: family,
              }
            });
          }}
          onIssueAsset={() => navigation.getParent()?.navigate('IssueAsset')}
        />

        <RecentActivityWidget
          onViewAll={() => navigation.getParent()?.navigate('History')}
        />

        {policy.showChannelManagement && (
        <ChannelList
          channels={channels}
          bitcoinUnit={bitcoinUnit}
          formatSatoshis={formatSatoshis}
          onViewAll={() => navigation.getParent()?.navigate('Channels')}
          onChannelPress={(channel) => {
            // ChannelList narrows Channel to a UI subset; the runtime object
            // carries the full shape, so widen back to DashboardScreen's Channel.
            setSelectedChannel(channel as unknown as Channel);
            setChannelModalVisible(true);
          }}
          onOpenChannel={() => navigation.getParent()?.navigate('OpenChannel')}
          onBuyChannel={() => navigation.getParent()?.navigate('LSP')}
        />
        )}
      </ScrollView>

      {/* Voice is triggered from the green mic button in the bottom nav island,
          which emits 'rate.openVoice' (see the listener effect above). */}
      <VoiceAgentOverlay
        visible={voiceAgentOpen}
        autoListen={voiceAutoListen}
        onClose={() => setVoiceAgentOpen(false)}
      />

      <KaleidoMindOnboarding
        visible={mindOnboardingOpen}
        availability={mindAvailability}
        onSelectLocal={handleMindLocal}
        onSelectDelegate={handleMindDelegate}
        onSkip={handleMindSkip}
      />

      {renderChannelModal()}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background.primary,
  },
  scrollContent: {
    // Clear the floating (absolutely-positioned) nav island so the last rows
    // stay reachable above it.
    paddingBottom: theme.spacing[32],
  },
  walletCard: {
    // The unified balance + actions card sits just below the sticky header.
    marginHorizontal: theme.spacing[4],
    marginTop: theme.spacing[4],
    marginBottom: theme.spacing[4],
  },
  liteUsdCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: theme.spacing[6],
    marginHorizontal: theme.spacing[4],
    padding: theme.spacing[4],
    backgroundColor: theme.colors.surface.primary,
    borderRadius: theme.borderRadius.xl,
    borderWidth: 1,
    borderColor: theme.colors.border.light,
  },
  liteUsdLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[3],
  },
  liteUsdIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: theme.colors.success[50],
    alignItems: 'center',
    justifyContent: 'center',
  },
  liteUsdLabel: {
    fontSize: theme.typography.fontSize.base,
    fontWeight: '600',
    color: theme.colors.text.primary,
  },
  liteUsdValue: {
    fontSize: theme.typography.fontSize.lg,
    fontWeight: '700',
    color: theme.colors.text.primary,
  },
  headerContainer: {
    marginBottom: theme.spacing[4],
  },
  headerGradient: {
    paddingBottom: theme.spacing[12],
    borderBottomLeftRadius: theme.borderRadius['3xl'],
    borderBottomRightRadius: theme.borderRadius['3xl'],
  },
  headerSafeArea: {
    backgroundColor: 'transparent',
  },
  headerContent: {
    paddingHorizontal: theme.spacing[4],
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing[6],
    marginTop: theme.spacing[2],
  },
  headerLeft: {
    flex: 1,
  },
  greeting: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.text.inverse,
    opacity: 0.8,
    marginBottom: 4,
  },
  headerTitle: {
    fontSize: theme.typography.fontSize['2xl'],
    fontWeight: '700',
    color: theme.colors.text.inverse,
  },
  headerActions: {
    flexDirection: 'row',
    gap: theme.spacing[3],
  },
  headerActionButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  notificationDot: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: theme.colors.error[500],
    borderWidth: 1,
    borderColor: theme.colors.primary[600],
  },
  // Modal Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: theme.colors.background.backdrop,
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: theme.colors.surface.primary,
    borderTopLeftRadius: theme.borderRadius['2xl'],
    borderTopRightRadius: theme.borderRadius['2xl'],
    maxHeight: '80%',
    paddingBottom: theme.spacing[8],
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: theme.spacing[4],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border.light,
  },
  modalTitle: {
    fontSize: theme.typography.fontSize.xl,
    fontWeight: '700',
    color: theme.colors.text.primary,
  },
  modalCloseButton: {
    padding: theme.spacing[2],
  },
  modalBody: {
    padding: theme.spacing[4],
  },
  modalSection: {
    marginBottom: theme.spacing[6],
  },
  modalSectionTitle: {
    fontSize: theme.typography.fontSize.sm,
    fontWeight: '600',
    color: theme.colors.text.secondary,
    marginBottom: theme.spacing[3],
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  modalStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: theme.spacing[2],
  },
  modalStatusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  modalStatusText: {
    fontSize: theme.typography.fontSize.base,
    fontWeight: '500',
    color: theme.colors.text.primary,
    marginRight: theme.spacing[2],
  },
  modalPublicBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.primary[50],
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 4,
    borderRadius: theme.borderRadius.full,
    gap: 4,
  },
  modalPublicText: {
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.primary[600],
    fontWeight: '500',
  },
  modalPrivateBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.gray[100],
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 4,
    borderRadius: theme.borderRadius.full,
    gap: 4,
  },
  modalPrivateText: {
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.gray[600],
    fontWeight: '500',
  },
  modalInfoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing[3],
  },
  modalInfoLabel: {
    fontSize: theme.typography.fontSize.base,
    color: theme.colors.text.secondary,
  },
  modalInfoValue: {
    fontSize: theme.typography.fontSize.base,
    fontWeight: '500',
    color: theme.colors.text.primary,
    maxWidth: '60%',
  },
  modalCapacityValue: {
    fontSize: theme.typography.fontSize['2xl'],
    fontWeight: '700',
    color: theme.colors.text.primary,
  },
  modalLiquidityContainer: {
    backgroundColor: theme.colors.surface.secondary,
    padding: theme.spacing[4],
    borderRadius: theme.borderRadius.xl,
  },
  modalLiquidityRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: theme.spacing[3],
  },
  modalLiquidityItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[3],
  },
  modalLiquidityIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: theme.colors.surface.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalLiquidityLabel: {
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.text.secondary,
    marginBottom: 2,
  },
  modalLiquidityValue: {
    fontSize: theme.typography.fontSize.sm,
    fontWeight: '600',
    color: theme.colors.text.primary,
  },
  modalLiquidityBar: {
    height: 6,
    backgroundColor: theme.colors.gray[200],
    borderRadius: 3,
    overflow: 'hidden',
  },
  modalLiquidityBarFill: {
    height: '100%',
    borderRadius: 3,
  },
});
