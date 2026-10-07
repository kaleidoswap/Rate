// screens/BridgeScreen.tsx
//
// Receive › Deposit from another chain. Flashnet Orchestra turns USDT/USDC/
// ETH/SOL/TRX sent on Ethereum, Tron, Solana… into BTC or USDB on this
// wallet's Spark account: pick the route and amount, get a one-time deposit
// address, send to it from any wallet, then follow the order until delivery.
// The in-flight deposit is saved, so leaving and coming back resumes it.
import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useAppTheme } from '../theme/ThemeProvider';
import { ScreenHeader } from '../components/ScreenHeader';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { Callout } from '../components/Callout';
import { CopyButton } from '../components/CopyButton';
import { AmountText } from '../components/AmountText';
import { EmptyState } from '../components/EmptyState';
import { SegmentedTabs } from '../components/SegmentedTabs';
import { ReceiveQr } from '../components/receive/ReceiveQr';
import { BridgePicker } from '../components/bridge/BridgePicker';
import { BridgeAssetIcon, ChainIcon } from '../components/bridge/BridgeIcons';
import { BridgeOrderTracker } from '../components/bridge/BridgeOrderTracker';
import { useForegroundClock } from '../hooks/useForegroundClock';
import { protocolManager } from '../services/protocols';
import { receiveAccountChain } from '../services/kaleidoPay/connect';
import ToastService from '../services/ToastService';
import {
  createQuote,
  getEstimate,
  getRoutes,
  getStatus,
  isOrchestraConfigured,
  submitOrder,
  ORCHESTRA_ORIGIN_ERROR_CODE,
  type OrchestraEstimate,
  type OrchestraRoute,
} from '../services/orchestra/client';
import {
  POLL_FAILURES_BEFORE_SURFACING,
  TERMINAL_STATUSES,
  assetIcon,
  chainLabel,
  describeOrchestraFee,
  describePollFailure,
  formatSats,
  formatSmallUnits,
  routeHops,
  toChecksumAddress,
} from '../utils/orchestra-ui';
import {
  bridgeReducer,
  defaultRoute,
  destAssetsFor,
  findRoute,
  formatCountdown,
  initialBridgeState,
  loadBridgeSession,
  orchestraErrorMessage,
  quoteMsLeft,
  resolveDecimals,
  saveBridgeSession,
  sourceAssetsFor,
  sourceChains,
  sparkRoutes,
  validateBridgeAmount,
  type BridgeDestAsset,
} from '../utils/bridge-session';
import { feedback } from '../utils/feedback';
import { useAppSelector } from '../store/hooks';
import { recordFromBridge } from '../utils/crosschain-history';
import { recordCrossChain } from '../services/crosschainHistory';

const DEPOSIT_POLL_MS = 5000;
const STATUS_POLL_MS = 3000;
/** ~90 s of status polls without a final state. */
const STUCK_POLL_THRESHOLD = 30;

/** Runs `fn` every `ms` while enabled, always calling its latest version. */
function usePolling(fn: () => Promise<void>, ms: number, enabled: boolean) {
  const latest = useRef(fn);
  latest.current = fn;
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try { await latest.current(); } catch { /* each poller handles its own errors */ }
      if (!cancelled) timer = setTimeout(tick, ms);
    };
    void tick();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [enabled, ms]);
}

type SparkStatus = 'ready' | 'disconnected' | 'not-mainnet';

function readSparkStatus(): SparkStatus {
  const adapter = protocolManager.getAdapterIfAvailable('SPARK');
  if (!adapter?.isConnected?.()) return 'disconnected';
  const chain = receiveAccountChain('SPARK');
  return chain && chain !== 'mainnet' ? 'not-mainnet' : 'ready';
}

async function sparkAddress(): Promise<string> {
  const adapter = protocolManager.getAdapterIfAvailable('SPARK');
  if (!adapter?.isConnected?.()) throw new Error('Connect your Spark account first.');
  const result: unknown = await adapter.getReceiveAddress('SPARK');
  const address = typeof result === 'string' ? result : (result as { address?: string } | null)?.address;
  if (!address) throw new Error('Could not get your Spark address.');
  return address;
}

export default function BridgeScreen({ navigation }: { navigation: any }) {
  const t = useAppTheme();
  const { width } = useWindowDimensions();
  const qrSize = Math.min(220, width - t.spacing[5] * 2 - t.spacing[4] * 2);

  const [state, dispatch] = useReducer(bridgeReducer, initialBridgeState);
  const [routes, setRoutes] = useState<OrchestraRoute[]>([]);
  const [routesStatus, setRoutesStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loaded, setLoaded] = useState(false);
  const [resumed, setResumed] = useState(false);
  const [spark, setSpark] = useState<SparkStatus>(readSparkStatus);
  useFocusEffect(useCallback(() => { setSpark(readSparkStatus()); }, []));

  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  // ── Load routes and any saved session ──
  const loadRoutes = useCallback(async () => {
    setRoutesStatus('loading');
    try {
      const all = sparkRoutes(await getRoutes());
      if (!mounted.current) return all;
      setRoutes(all);
      setRoutesStatus('ready');
      return all;
    } catch {
      if (mounted.current) setRoutesStatus('error');
      return [];
    }
  }, []);

  useEffect(() => {
    if (!isOrchestraConfigured()) { setLoaded(true); return; }
    void (async () => {
      const [saved, available] = await Promise.all([loadBridgeSession(), loadRoutes()]);
      if (!mounted.current) return;
      if (saved && saved.step !== 'select') {
        dispatch({ type: 'restore', session: saved });
        setResumed(true);
      } else {
        const keep = saved && findRoute(available, saved.sourceChain, saved.sourceAsset, saved.destAsset);
        const pick = keep ?? defaultRoute(available);
        if (saved && keep) dispatch({ type: 'restore', session: saved });
        else if (pick) {
          dispatch({ type: 'selectSource', chain: pick.sourceChain, asset: pick.sourceAsset });
          dispatch({ type: 'selectDest', asset: pick.destinationAsset.toUpperCase() as BridgeDestAsset });
        }
      }
      setLoaded(true);
    })();
  }, [loadRoutes]);

  // Choose a route when they arrive after a failed first load.
  useEffect(() => {
    if (!loaded || state.step !== 'select' || state.sourceChain || routes.length === 0) return;
    const pick = defaultRoute(routes);
    if (pick) dispatch({ type: 'selectSource', chain: pick.sourceChain, asset: pick.sourceAsset });
  }, [loaded, routes, state.step, state.sourceChain]);

  // ── Persist whatever is in flight ──
  // Only the step, quote and order matter for a resume; typing an amount doesn't.
  const latestState = useRef(state);
  latestState.current = state;
  const walletId = useAppSelector((s) => s.wallet.activeWallet?.id);
  useEffect(() => {
    if (!loaded) return;
    void saveBridgeSession(latestState.current);
    void recordCrossChain(walletId, recordFromBridge(latestState.current, Date.now()));
  }, [loaded, walletId, state.step, state.quote, state.order]);

  // ── Derived selection ──
  const route = findRoute(routes, state.sourceChain, state.sourceAsset, state.destAsset);
  const decimals = resolveDecimals(state, route);
  const amountCheck = validateBridgeAmount(state.amount, decimals.source, state.sourceAsset);
  const chains = useMemo(() => sourceChains(routes), [routes]);
  const assets = useMemo(() => sourceAssetsFor(routes, state.sourceChain), [routes, state.sourceChain]);
  const dests = useMemo(() => destAssetsFor(routes, state.sourceChain, state.sourceAsset), [routes, state.sourceChain, state.sourceAsset]);

  const chooseSource = (chain: string, asset?: string) => {
    const nextAsset = asset ?? (sourceAssetsFor(routes, chain).includes(state.sourceAsset) ? state.sourceAsset : sourceAssetsFor(routes, chain)[0]);
    if (!nextAsset) return;
    dispatch({ type: 'selectSource', chain, asset: nextAsset });
    const offered = destAssetsFor(routes, chain, nextAsset);
    if (offered.length && !offered.includes(state.destAsset)) dispatch({ type: 'selectDest', asset: offered[0] });
  };

  const formatDest = useCallback((raw: string | undefined) => {
    if (!raw || !/^\d+$/.test(raw)) return undefined;
    return state.destAsset === 'BTC' ? formatSats(raw) : `${formatSmallUnits(raw, decimals.dest ?? 6)} USDB`;
  }, [state.destAsset, decimals.dest]);

  // ── Live estimate (debounced) ──
  const [estimate, setEstimate] = useState<OrchestraEstimate | null>(null);
  const [estimateLoading, setEstimateLoading] = useState(false);
  const [estimateError, setEstimateError] = useState<string | null>(null);
  const estimateKey = state.step === 'select' && route && amountCheck.ok
    ? `${state.sourceChain}|${state.sourceAsset}|${state.destAsset}|${amountCheck.raw}`
    : null;
  useEffect(() => {
    setEstimate(null);
    setEstimateError(null);
    if (!estimateKey) { setEstimateLoading(false); return; }
    const [sourceChain, sourceAsset, destinationAsset, amount] = estimateKey.split('|');
    let cancelled = false;
    setEstimateLoading(true);
    const handle = setTimeout(async () => {
      try {
        const est = await getEstimate({ sourceChain, sourceAsset, destinationChain: 'spark', destinationAsset, amount });
        if (!cancelled) setEstimate(est);
      } catch (err) {
        if (!cancelled) setEstimateError(orchestraErrorMessage(err, "Couldn't price this amount. Try another."));
      } finally {
        if (!cancelled) setEstimateLoading(false);
      }
    }, 400);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [estimateKey]);

  // ── Quote ──
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const quoteInFlight = useRef(false);
  const requestQuote = useCallback(async () => {
    if (quoteInFlight.current || !amountCheck.ok || decimals.source === undefined || decimals.dest === undefined) return;
    quoteInFlight.current = true;
    setQuoteLoading(true);
    setQuoteError(null);
    try {
      const recipientAddress = await sparkAddress();
      const quote = await createQuote({
        sourceChain: state.sourceChain,
        sourceAsset: state.sourceAsset,
        destinationChain: 'spark',
        destinationAsset: state.destAsset,
        amount: amountCheck.raw,
        recipientAddress,
      });
      if (!mounted.current) return;
      if (!quote?.quoteId || !quote.depositAddress) throw new Error('The bridge returned no deposit address.');
      dispatch({ type: 'quoteCreated', quote, sourceDecimals: decimals.source, destDecimals: decimals.dest });
    } catch (err) {
      if (mounted.current) setQuoteError(orchestraErrorMessage(err, err instanceof Error && !/Orchestra/.test(err.message) ? err.message : 'Could not create a deposit address. Try again.'));
    } finally {
      quoteInFlight.current = false;
      if (mounted.current) setQuoteLoading(false);
    }
  }, [amountCheck, decimals.source, decimals.dest, state.sourceChain, state.sourceAsset, state.destAsset]);

  // ── Deposit step: countdown, re-quote on expiry, detection ──
  const now = useForegroundClock(state.step === 'deposit');
  const msLeft = quoteMsLeft(state.quote, now);
  const quoteExpired = state.step === 'deposit' && !!state.quote && msLeft <= 0;

  useEffect(() => {
    if (quoteExpired && !quoteLoading && !quoteError) void requestQuote();
  }, [quoteExpired, quoteLoading, quoteError, requestQuote]);

  // Client keys may only learn about a deposit by submitting the quote: it
  // fails until the deposit is seen, then returns the order and its read token.
  const submitInFlight = useRef(false);
  const detectDeposit = async (txHash?: string) => {
    const quote = state.quote;
    if (!quote || submitInFlight.current) return false;
    submitInFlight.current = true;
    try {
      const result = await submitOrder(txHash ? { quoteId: quote.quoteId, txHash } : { quoteId: quote.quoteId });
      if (!mounted.current) return true;
      dispatch({
        type: 'orderDetected',
        order: { id: result.orderId, quoteId: quote.quoteId, status: (result.status || 'processing') as never, readToken: result.readToken },
      });
      feedback.success();
      return true;
    } finally {
      submitInFlight.current = false;
    }
  };
  usePolling(async () => { try { await detectDeposit(); } catch { /* not funded yet */ } }, DEPOSIT_POLL_MS, state.step === 'deposit' && !!state.quote);

  const [txHash, setTxHash] = useState('');
  const [txSubmitting, setTxSubmitting] = useState(false);
  const [txError, setTxError] = useState<string | null>(null);
  const submitTxHash = async () => {
    const hash = txHash.trim();
    if (!hash) return;
    setTxSubmitting(true);
    setTxError(null);
    try {
      if (!(await detectDeposit(hash))) setTxError('Still checking the last attempt. Try again in a moment.');
    } catch (err) {
      if (mounted.current) setTxError(orchestraErrorMessage(err, "That transaction isn't visible yet. We keep checking on our own."));
    } finally {
      if (mounted.current) setTxSubmitting(false);
    }
  };

  // ── Tracking step ──
  const [pollAttempts, setPollAttempts] = useState(0);
  const [pollError, setPollError] = useState<string | null>(null);
  const pollFailures = useRef(0);
  useEffect(() => {
    if (state.step !== 'tracking') { setPollAttempts(0); setPollError(null); pollFailures.current = 0; }
  }, [state.step]);

  const order = state.order;
  const tracking = state.step === 'tracking' && !!order && !TERMINAL_STATUSES.has(order.status);
  usePolling(async () => {
    if (!order) return;
    setPollAttempts((n) => n + 1);
    try {
      const updated = await getStatus({ id: order.id, readToken: order.readToken });
      if (!mounted.current) return;
      pollFailures.current = 0;
      setPollError(null);
      dispatch({ type: 'orderUpdated', update: updated });
      const status = String(updated?.status ?? '').toLowerCase();
      if (status === 'completed') {
        feedback.success();
        ToastService.getInstance().success(`${state.destAsset} delivered to your Spark account`);
      } else if (status === 'failed' || status === 'refunded') {
        feedback.error();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      pollFailures.current += 1;
      if (msg.includes(ORCHESTRA_ORIGIN_ERROR_CODE) || pollFailures.current >= POLL_FAILURES_BEFORE_SURFACING) {
        if (mounted.current) setPollError(describePollFailure(msg));
      }
    }
  }, STATUS_POLL_MS, tracking);

  // ── Actions ──
  const close = () => navigation.goBack();
  const startOver = () => {
    const reset = () => { setQuoteError(null); setTxHash(''); setTxError(null); setResumed(false); dispatch({ type: 'startOver' }); };
    if (state.step !== 'deposit') { reset(); return; }
    Alert.alert(
      'Start over?',
      "Only if you haven't sent anything to this address yet. A deposit already on its way still arrives, but this screen stops following it.",
      [{ text: 'Keep this address', style: 'cancel' }, { text: 'Start over', style: 'destructive', onPress: reset }],
    );
  };
  const finish = () => { dispatch({ type: 'startOver' }); navigation.goBack(); };

  // ── Styles ──
  const card = {
    borderRadius: t.borderRadius.xl, backgroundColor: t.colors.surface.primary,
    borderWidth: 1, borderColor: t.colors.border.light, padding: t.spacing[4],
  };
  const caption = { color: t.colors.text.tertiary, fontSize: t.typography.fontSize.xs, fontWeight: '600' as const };
  const rowLabel = { color: t.colors.text.tertiary, fontSize: t.typography.fontSize.sm };
  const rowValue = { color: t.colors.text.secondary, fontSize: t.typography.fontSize.sm, textAlign: 'right' as const, flexShrink: 1 };
  const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: t.spacing[3] }}>
      <Text style={rowLabel}>{label}</Text>
      {children}
    </View>
  );

  // ── Render: select ──
  const renderSelect = () => {
    if (spark !== 'ready') {
      return (
        <View style={{ gap: t.spacing[4] }}>
          <Callout
            tone="info"
            title={spark === 'disconnected' ? 'Needs your Spark account' : 'Mainnet only'}
            message={spark === 'disconnected'
              ? 'Deposits from another chain arrive as BTC or USDB in your Spark account. Turn on Spark in Settings, then come back here.'
              : 'Deposits from another chain only work with a mainnet Spark account. This wallet uses Spark on a test network.'}
          />
          <Button title="Back" variant="secondary" onPress={close} fullWidth />
        </View>
      );
    }
    if (routesStatus === 'loading' && routes.length === 0) {
      return (
        <View style={{ alignItems: 'center', paddingVertical: t.spacing[16], gap: t.spacing[3] }}>
          <ActivityIndicator color={t.colors.primary[500]} />
          <Text style={{ color: t.colors.text.secondary }}>Loading networks…</Text>
        </View>
      );
    }
    if (routes.length === 0) {
      return (
        <EmptyState
          icon="git-compare-outline"
          title={routesStatus === 'error' ? "Couldn't load networks" : 'No networks available'}
          message="Deposits from other chains are unavailable right now. Try again in a moment."
          actionLabel="Try again"
          onAction={() => { void loadRoutes(); }}
        />
      );
    }

    const fee = describeOrchestraFee(estimate, {
      sourceAmountRaw: amountCheck.ok ? amountCheck.raw : undefined,
      sourceAsset: state.sourceAsset,
      destAmountRaw: estimate?.estimatedOut,
      destAsset: state.destAsset,
    });
    const hops = routeHops(estimate?.route);
    const showAmountError = !amountCheck.ok && amountCheck.reason !== 'empty';

    return (
      <View style={{ gap: t.spacing[4] }}>
        <View style={{ flexDirection: 'row', gap: t.spacing[3] }}>
          <BridgePicker
            caption="From network"
            title="Send from"
            selectedId={state.sourceChain}
            onSelect={(chain) => chooseSource(chain)}
            options={chains.map((chain) => ({
              id: chain,
              label: chainLabel(chain),
              description: sourceAssetsFor(routes, chain).join(', '),
              icon: <ChainIcon chain={chain} size={24} />,
            }))}
          />
          <BridgePicker
            caption="Asset"
            title={`Asset on ${chainLabel(state.sourceChain)}`}
            selectedId={state.sourceAsset}
            onSelect={(asset) => chooseSource(state.sourceChain, asset)}
            options={assets.map((asset) => ({
              id: asset,
              label: asset,
              icon: <BridgeAssetIcon ticker={asset} chain={state.sourceChain} size={24} />,
            }))}
          />
        </View>

        <View style={{ gap: t.spacing[1.5] }}>
          <Text style={caption}>Receive in Spark as</Text>
          <SegmentedTabs<BridgeDestAsset>
            scrollable={false}
            fill
            value={state.destAsset}
            onChange={(asset) => dispatch({ type: 'selectDest', asset })}
            options={(['BTC', 'USDB'] as BridgeDestAsset[]).map((asset) => ({
              key: asset,
              label: asset === 'BTC' ? 'Bitcoin' : 'USDB',
              disabled: !dests.includes(asset),
              renderIcon: (_color: string, size: number) => <BridgeAssetIcon ticker={asset} size={size + 4} />,
            }))}
          />
        </View>

        <Input
          label={`Amount of ${state.sourceAsset || 'the asset'} to send`}
          value={state.amount}
          onChangeText={(text) => dispatch({ type: 'setAmount', amount: text })}
          placeholder="0.00"
          keyboardType="decimal-pad"
          autoCorrect={false}
          error={showAmountError ? amountCheck.message : undefined}
          leftIcon={state.sourceAsset && assetIcon(state.sourceAsset) ? <BridgeAssetIcon ticker={state.sourceAsset} size={20} /> : undefined}
          rightIcon={<Text style={{ color: t.colors.text.secondary, fontWeight: '600' }}>{state.sourceAsset}</Text>}
        />

        {(estimateLoading || estimate || estimateError) && (
          <View style={[card, { gap: t.spacing[2.5] }]} accessibilityLiveRegion="polite">
            {estimateLoading && !estimate ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing[2] }}>
                <ActivityIndicator size="small" color={t.colors.primary[500]} />
                <Text style={rowLabel}>Checking the rate…</Text>
              </View>
            ) : estimateError ? (
              <Text style={{ color: t.colors.warning[500], fontSize: t.typography.fontSize.sm }}>{estimateError}</Text>
            ) : estimate ? (
              <>
                <Row label="You receive (est.)">
                  <AmountText style={{ color: t.colors.text.primary, fontWeight: '700', fontSize: t.typography.fontSize.base }}>
                    ~{formatDest(estimate.estimatedOut) ?? '—'}
                  </AmountText>
                </Row>
                {!!fee && (
                  <Row label="Bridge fee (est.)">
                    <View style={{ alignItems: 'flex-end', flexShrink: 1 }}>
                      <AmountText style={rowValue}>{fee.text}</AmountText>
                      {!!fee.note && <Text style={{ color: t.colors.text.tertiary, fontSize: t.typography.fontSize.xs }}>{fee.note}</Text>}
                    </View>
                  </Row>
                )}
                {hops.length > 1 && <Row label="Route"><Text style={rowValue}>{hops.join(' → ')}</Text></Row>}
              </>
            ) : null}
          </View>
        )}

        {!!quoteError && <Callout tone="error" message={quoteError} />}

        <Button
          title={quoteLoading ? 'Getting address…' : 'Get deposit address'}
          onPress={() => { feedback.tap(); void requestQuote(); }}
          loading={quoteLoading}
          disabled={!route || !amountCheck.ok || quoteLoading}
          fullWidth
        />
        <Text style={{ color: t.colors.text.tertiary, fontSize: t.typography.fontSize.xs, textAlign: 'center' }}>
          Bridged by Flashnet. The final amount is set when you get the address.
        </Text>
      </View>
    );
  };

  // ── Render: deposit ──
  const renderDeposit = () => {
    const quote = state.quote;
    if (!quote) return null;
    const address = toChecksumAddress(quote.depositAddress);
    const sendText = `${formatSmallUnits(quote.amountIn, decimals.source ?? 0)} ${state.sourceAsset}`;
    const fee = describeOrchestraFee(quote, {
      sourceAmountRaw: quote.amountIn,
      sourceAsset: state.sourceAsset,
      destAmountRaw: quote.estimatedOut,
      destAsset: state.destAsset,
    });
    const hops = routeHops(quote.route);
    const network = chainLabel(state.sourceChain);

    return (
      <View style={{ gap: t.spacing[4] }}>
        {resumed && (
          <Text style={{ color: t.colors.text.tertiary, fontSize: t.typography.fontSize.xs, textAlign: 'center' }}>
            Picked up where you left off
          </Text>
        )}
        <View style={[card, { gap: t.spacing[3] }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing[2] }}>
            <View style={{ flex: 1, gap: t.spacing[1] }}>
              <Text style={caption}>YOU SEND</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing[1.5] }}>
                <BridgeAssetIcon ticker={state.sourceAsset} chain={state.sourceChain} size={20} />
                <AmountText numberOfLines={1} style={{ color: t.colors.text.primary, fontWeight: '700', flexShrink: 1 }}>{sendText}</AmountText>
              </View>
              <Text style={{ color: t.colors.text.tertiary, fontSize: t.typography.fontSize.xs }}>on {network}</Text>
            </View>
            <Ionicons name="arrow-forward" size={16} color={t.colors.text.tertiary} />
            <View style={{ flex: 1, gap: t.spacing[1], alignItems: 'flex-end' }}>
              <Text style={caption}>YOU RECEIVE (EST.)</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing[1.5] }}>
                <AmountText numberOfLines={1} style={{ color: t.colors.success[500], fontWeight: '700', flexShrink: 1 }}>~{formatDest(quote.estimatedOut) ?? '—'}</AmountText>
                <BridgeAssetIcon ticker={state.destAsset} chain="spark" size={20} />
              </View>
              <Text style={{ color: t.colors.text.tertiary, fontSize: t.typography.fontSize.xs }}>in your Spark account</Text>
            </View>
          </View>
          <View style={{ height: 1, backgroundColor: t.colors.border.light }} />
          {!!fee && (
            <Row label="Bridge fee">
              <View style={{ alignItems: 'flex-end', flexShrink: 1 }}>
                <AmountText style={rowValue}>{fee.text}</AmountText>
                {!!fee.note && <Text style={{ color: t.colors.text.tertiary, fontSize: t.typography.fontSize.xs }}>{fee.note}</Text>}
              </View>
            </Row>
          )}
          {hops.length > 1 && <Row label="Route"><Text style={rowValue}>{hops.join(' → ')}</Text></Row>}
          <Row label="Address valid for">
            <AmountText style={[rowValue, {
              fontWeight: '600',
              color: quoteExpired ? t.colors.error[500] : msLeft < 60_000 ? t.colors.warning[500] : t.colors.text.secondary,
            }]}>
              {quoteExpired ? 'Expired' : formatCountdown(msLeft)}
            </AmountText>
          </Row>
        </View>

        <Callout
          tone="warning"
          title={`Send only ${state.sourceAsset} on ${network}`}
          message={`Send exactly ${sendText} on the ${network} network. Other assets or networks sent to this address can be lost.`}
        />

        {quoteExpired ? (
          <Callout tone="error" title="This address expired" message={quoteError ?? "Don't send to it. Getting a fresh address…"}>
            {!!quoteError && <Button title="Try again" size="sm" variant="secondary" onPress={() => { setQuoteError(null); }} style={{ marginTop: t.spacing[2] }} />}
          </Callout>
        ) : (
          <View style={[card, { alignItems: 'center', gap: t.spacing[3] }]}>
            <ReceiveQr value={address} size={qrSize} />
            <Text selectable style={{ color: t.colors.text.primary, fontFamily: t.typography.fontFamily.mono, fontSize: t.typography.fontSize.sm, textAlign: 'center' }}>
              {address}
            </Text>
            <CopyButton value={address} label="Copy address" copiedLabel="Address copied" color={t.colors.primary[500]} />
          </View>
        )}

        {!quoteExpired && (
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: t.spacing[2] }} accessibilityLiveRegion="polite">
            <ActivityIndicator size="small" color={t.colors.warning[500]} />
            <Text style={{ color: t.colors.warning[500], fontWeight: '600' }}>Waiting for your deposit…</Text>
          </View>
        )}

        <View style={[card, { gap: t.spacing[2] }]}>
          <Text style={{ color: t.colors.text.secondary, fontSize: t.typography.fontSize.sm }}>
            Already sent? Paste the transaction hash to speed things up (optional).
          </Text>
          <Input
            value={txHash}
            onChangeText={(text) => { setTxHash(text.trim()); setTxError(null); }}
            placeholder={/^0x/i.test(quote.depositAddress) ? '0x…' : 'Transaction hash'}
            autoCapitalize="none"
            autoCorrect={false}
            size="sm"
            error={txError ?? undefined}
            accessibilityLabel="Transaction hash"
          />
          <Button title="Submit" size="sm" variant="secondary" onPress={() => { void submitTxHash(); }} disabled={!txHash || txSubmitting} loading={txSubmitting} />
        </View>

        <Button title="Start over" variant="ghost" onPress={startOver} />
      </View>
    );
  };

  // ── Render: tracking ──
  const renderTracking = () => {
    if (!order) return null;
    const terminal = TERMINAL_STATUSES.has(order.status);
    return (
      <View style={{ gap: t.spacing[3] }}>
        <BridgeOrderTracker
          order={order}
          from={{ ticker: state.sourceAsset, chain: state.sourceChain }}
          to={{ ticker: state.destAsset, chain: 'spark' }}
          receivedText={formatDest(order.amountOut)}
          stuck={tracking && pollAttempts >= STUCK_POLL_THRESHOLD}
          pollError={pollError}
          onDone={terminal ? finish : close}
        />
        {terminal && <Button title="New deposit" variant="ghost" onPress={startOver} />}
      </View>
    );
  };

  const body = !isOrchestraConfigured()
    ? <EmptyState icon="git-compare-outline" title="Not available" message="Deposits from another chain aren't available in this build." />
    : !loaded
      ? <View style={{ alignItems: 'center', paddingVertical: t.spacing[16] }}><ActivityIndicator color={t.colors.primary[500]} /></View>
      : state.step === 'deposit' ? renderDeposit()
        : state.step === 'tracking' ? renderTracking()
          : renderSelect();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.colors.background.primary }} edges={['top', 'left', 'right', 'bottom']}>
      <ScreenHeader title="From another chain" showBack onBack={close} />
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: t.spacing[5], paddingTop: t.spacing[2], paddingBottom: t.spacing[10] }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
      >
        {body}
      </ScrollView>
    </SafeAreaView>
  );
}
