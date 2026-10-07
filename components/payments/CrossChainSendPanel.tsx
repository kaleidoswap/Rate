/**
 * Send to an EVM or Solana address: USDB or BTC leaves Spark and arrives as
 * USDC/USDT on the chosen chain, through Flashnet Orchestra.
 *
 * Configure (source, chain, token, amount, live estimate) → review → slide to
 * send → the order is followed until it completes. The transfer record is saved
 * before funds move (services/crosschainSend.ts), so reopening Send resumes it
 * and never pays twice.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Crypto from 'expo-crypto';
import { useAppTheme } from '../../theme/ThemeProvider';
import { Button } from '../Button';
import { Callout } from '../Callout';
import { AmountText } from '../AmountText';
import { PressableScale } from '../PressableScale';
import { SegmentedControl } from '../SegmentedControl';
import { SlideToConfirm } from '../SlideToConfirm';
import { NetworkIcon } from '../NetworkIcon';
import { feedback } from '../../utils/feedback';
import { formatBitcoinAmount } from '../../utils/bitcoinUnits';
import { getEstimate, getRoutes, isOrchestraConfigured, type OrchestraAmountMode, type OrchestraEstimate, type OrchestraRoute } from '../../services/orchestra/client';
import {
  CrossChainNotSentError, QuoteChangedError, clearCrossChainSession, loadCrossChainSession, readSparkSource, refreshOrder,
  saveCrossChainSession, sendCrossChain, submitPaid, type SparkSource, type SendProgress,
} from '../../services/crosschainSend';
import type { CrossChainFamily, CrossChainSourceKey } from '../../utils/crosschain';
import {
  FORM_PROBLEM_TEXT, SOURCE_DECIMALS, destChainsFor, destTokensFor, dismissSession, findRoute, formProblem, isUnresolved,
  orchestraParams, parseAmountRaw, resumeAction, shortAddress, sourceInputDecimals, sourceSpendRaw,
  type CrossChainForm, type CrossChainSendSession,
} from '../../utils/crosschain-send';
import {
  POLL_FAILURES_BEFORE_SURFACING, STATUS_LABELS, STATUS_PIPELINE, assetIcon, chainIcon, chainLabel, describeOrchestraFee,
  describePollFailure, formatSmallUnits, fromFixedDecimalUnits,
} from '../../utils/orchestra-ui';

type Step = 'configure' | 'review' | 'sending' | 'status';

interface Props {
  address: string;
  family: CrossChainFamily;
  walletId?: number;
  bitcoinUnit: 'BTC' | 'sats';
  /** The destination field, shown above the form while configuring. */
  header?: React.ReactNode;
  /** Opens another address in Send (an earlier transfer still in progress). */
  onOpenAddress: (address: string) => void;
  onDone: () => void;
}

const POLL_MS = 4000;
const SOURCES: CrossChainSourceKey[] = ['USDB', 'BTC'];

export function CrossChainSendPanel({ address, family, walletId, bitcoinUnit, header, onOpenAddress, onDone }: Props) {
  const t = useAppTheme();
  const configured = isOrchestraConfigured();
  const [routes, setRoutes] = useState<OrchestraRoute[]>([]);
  const [spark, setSpark] = useState<SparkSource | null>(null);
  const [source, setSource] = useState<CrossChainSourceKey>('USDB');
  const [destChain, setDestChain] = useState(family === 'solana' ? 'solana' : 'base');
  const [destToken, setDestToken] = useState('USDC');
  const [mode, setMode] = useState<OrchestraAmountMode>('exact_in');
  const [amount, setAmount] = useState('');
  const [estimate, setEstimate] = useState<OrchestraEstimate | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [estimateError, setEstimateError] = useState('');
  const [step, setStep] = useState<Step>('configure');
  const [stage, setStage] = useState<SendProgress['stage']>('quoting');
  const [session, setSession] = useState<CrossChainSendSession | null>(null);
  const [blocking, setBlocking] = useState<CrossChainSendSession | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [unreadable, setUnreadable] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [pollError, setPollError] = useState('');
  const pollFailures = useRef(0);
  const working = useRef(false);
  const resumed = useRef<string | null>(null);

  // Routes, Spark balances and any transfer already under way.
  useEffect(() => {
    let live = true;
    if (configured) getRoutes().then(r => { if (live) setRoutes(r); }).catch(() => {});
    readSparkSource().then(s => {
      if (!live) return;
      setSpark(s);
      if (s.usdb?.available) setSource('USDB'); else if (s.btcSat > 0) setSource('BTC');
    }).catch(() => { if (live) setSpark({ connected: false, mainnet: false, btcSat: 0, usdb: null }); });
    return () => { live = false; };
  }, [configured]);

  useEffect(() => {
    let live = true;
    setSessionReady(false); setBlocking(null);
    if (!walletId) { setSessionReady(true); return; }
    loadCrossChainSession(walletId).then(saved => {
      if (!live) return;
      if (!isUnresolved(saved)) { if (saved) void clearCrossChainSession(walletId).catch(() => {}); }
      else if (saved.recipient === address) { setSession(saved); setSource(saved.source); setDestChain(saved.destChain); setDestToken(saved.destToken); setStep('status'); }
      else setBlocking(saved);
      setSessionReady(true);
    }).catch(() => { if (live) { setUnreadable(true); setSessionReady(true); } });
    return () => { live = false; };
  }, [walletId, address]);

  // ---- form ----------------------------------------------------------------
  const chains = useMemo(() => destChainsFor(routes, family), [routes, family]);
  const tokens = useMemo(() => destTokensFor(routes, destChain), [routes, destChain]);
  useEffect(() => { if (chains.length && !chains.some(c => c.chain === destChain)) setDestChain(chains[0].chain); }, [chains, destChain]);
  useEffect(() => { if (tokens.length && !tokens.includes(destToken)) setDestToken(tokens[0]); }, [tokens, destToken]);
  const route = findRoute(routes, destChain, destToken, source);
  const routeKnown = routes.length === 0 ? configured : !!route;
  const exactOut = !!route?.exactOutEligible;
  useEffect(() => { if (!exactOut && mode === 'exact_out') setMode('exact_in'); }, [exactOut, mode]);
  const destDecimals = route?.destination?.decimals ?? 6;
  const inputDecimals = mode === 'exact_in' ? sourceInputDecimals(source, bitcoinUnit) : destDecimals;
  // Smallest units of the pinned side: sats (typed in sats or BTC), USDB base units, or the destination token's.
  const amountRaw = parseAmountRaw(amount, inputDecimals);
  const spendableRaw = !spark ? '0' : source === 'BTC' ? String(spark.btcSat) : String(spark.usdb?.available ?? 0);
  const form: CrossChainForm = { source, destChain, destToken, recipient: address, family, mode, amountRaw: amountRaw ?? '0' };
  const problem = spark ? formProblem({
    sparkConnected: spark.connected, mainnet: spark.mainnet, spendableRaw, form, typedAmount: amount, inputDecimals, routeKnown, estimate,
  }) : null;

  // Live estimate, debounced. Kept through review so the numbers being confirmed stay on screen.
  const estimateKey = amountRaw && configured && (step === 'configure' || step === 'review')
    ? JSON.stringify(orchestraParams(form)) : '';
  useEffect(() => {
    if (step === 'review') return;
    setEstimate(null); setEstimateError('');
    if (!estimateKey) { setEstimating(false); return; }
    if (mode === 'exact_in' && problem === 'exceeds-balance') { setEstimating(false); return; }
    let live = true;
    setEstimating(true);
    const timer = setTimeout(() => {
      getEstimate(JSON.parse(estimateKey))
        .then(e => { if (live) setEstimate(e); })
        .catch(e => { if (live) setEstimateError(e instanceof Error && /unsupported_amount_mode/.test(e.message) ? "This route can't target an exact amount received." : 'Could not get a price for this transfer.'); })
        .finally(() => { if (live) setEstimating(false); });
    }, 400);
    return () => { live = false; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estimateKey]);

  // ---- formatting ----------------------------------------------------------
  const fmtSource = (raw: string, key: CrossChainSourceKey = source) => key === 'BTC'
    ? `${formatBitcoinAmount(raw, bitcoinUnit)} ${bitcoinUnit}`
    : `${formatSmallUnits(raw, SOURCE_DECIMALS.USDB)} USDB`;
  const fmtDest = (raw: string, token = destToken, decimals = destDecimals) => `${formatSmallUnits(raw, decimals)} ${token}`;
  const spendRaw = sourceSpendRaw(form, estimate);
  const receiveRaw = mode === 'exact_out' ? form.amountRaw : estimate?.estimatedOut;
  const fee = describeOrchestraFee(estimate, { sourceAmountRaw: spendRaw ?? undefined, sourceAsset: source, destAmountRaw: receiveRaw, destAsset: destToken });
  const sourceUnit = source === 'BTC' ? bitcoinUnit : 'USDB';
  const maxValue = source === 'BTC' ? (bitcoinUnit === 'BTC' ? fromFixedDecimalUnits(spendableRaw, 8) : spendableRaw) : fromFixedDecimalUnits(spendableRaw, SOURCE_DECIMALS.USDB);

  // ---- actions -------------------------------------------------------------
  const canReview = !!walletId && sessionReady && !blocking && !unreadable && !problem && !!estimate && !estimating;

  const review = () => { if (canReview) { feedback.select(); setError(''); setStep('review'); } };

  async function send() {
    if (working.current || !walletId || !estimate) return;
    working.current = true; setBusy(true); setError(''); setStage('quoting'); setStep('sending');
    try {
      const result = await sendCrossChain({
        walletId, form, reviewed: estimate, destDecimals, id: Crypto.randomUUID(),
        onProgress: p => { setStage(p.stage); if (p.session) setSession(p.session); },
      });
      resumed.current = result.id; // sendCrossChain already tried the submit
      setSession(result); setStep('status'); pollFailures.current = 0; setPollError('');
      if (result.phase === 'submitted' || result.phase === 'done') feedback.send(); else feedback.warning();
    } catch (e) {
      if (e instanceof QuoteChangedError) {
        const q = e.quote;
        setEstimate({ ...estimate, estimatedOut: q.estimatedOut, requiredAmountIn: q.requiredAmountIn ?? q.amountIn, feeAmount: q.feeAmount, totalFeeAmount: q.totalFeeAmount, feeAsset: q.feeAsset, feeBps: q.feeBps });
        setError(e.message); setStep('review');
      } else {
        setError(`${e instanceof Error ? e.message : 'The transfer could not start.'}${e instanceof CrossChainNotSentError ? '' : ' Nothing was sent.'}`);
        setStep('configure');
      }
    } finally {
      working.current = false; setBusy(false);
      void readSparkSource().then(setSpark).catch(() => {});
    }
  }

  const retrySubmit = useCallback(async (attempts = 1) => {
    if (working.current || !walletId || !session) return;
    working.current = true; setBusy(true);
    try { setSession(await submitPaid(walletId, session, attempts)); }
    finally { working.current = false; setBusy(false); }
  }, [walletId, session]);

  // Resume once: submit a paid transfer, or check one whose payment didn't confirm.
  useEffect(() => {
    if (step !== 'status' || !session || resumed.current === session.id) return;
    const action = resumeAction(session);
    if (action !== 'submit' && action !== 'verify') return;
    resumed.current = session.id;
    void retrySubmit(action === 'submit' ? 3 : 1);
  }, [step, session, retrySubmit]);

  // Follow a submitted order.
  const tracking = step === 'status' && resumeAction(session) === 'track';
  useEffect(() => {
    if (!tracking || !walletId || !session) return;
    let live = true;
    const timer = setTimeout(async () => {
      try {
        const next = await refreshOrder(walletId, session);
        if (!live) return;
        pollFailures.current = 0; setPollError('');
        setSession(next);
        if (next.phase === 'done') { void clearCrossChainSession(walletId).catch(() => {}); void readSparkSource().then(setSpark).catch(() => {}); }
      } catch (e) {
        if (!live) return;
        const msg = e instanceof Error ? e.message : String(e);
        pollFailures.current += 1;
        if (pollFailures.current >= POLL_FAILURES_BEFORE_SURFACING || /ORIGIN/.test(msg)) setPollError(describePollFailure(msg));
        setSession(s => (s ? { ...s } : s)); // schedule the next poll
      }
    }, session.order?.status === 'processing' && pollFailures.current === 0 ? 1500 : POLL_MS);
    return () => { live = false; clearTimeout(timer); };
  }, [tracking, walletId, session]);

  const startOver = () => {
    if (!walletId || !session) return;
    const paid = session.phase === 'paid';
    Alert.alert(
      'Start a new transfer?',
      paid
        ? `This payment already left your Spark wallet. Starting over does not get it back; keep reference ${session.quoteId} to ask support about it.`
        : 'Only continue if your Spark activity shows this payment did not go out. If it did, sending again pays twice.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Start a new transfer', style: 'destructive', onPress: async () => {
          try {
            await saveCrossChainSession(walletId, dismissSession(session, Date.now()));
            setSession(null); setError(''); resumed.current = null; setStep('configure');
          } catch { setError('Could not update the transfer record. Try again.'); }
        } },
      ],
    );
  };

  const discardUnreadable = () => {
    if (!walletId) return;
    Alert.alert('Discard the old transfer record?', 'Only continue if your Spark activity shows no cross-chain transfer waiting to finish.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: () => { void clearCrossChainSession(walletId).then(() => setUnreadable(false)).catch(() => {}); } },
    ]);
  };

  // ---- presentation --------------------------------------------------------
  const text = { color: t.colors.text.primary, fontSize: t.typography.fontSize.base };
  const muted = { ...text, color: t.colors.text.secondary };
  const small = { color: t.colors.text.tertiary, fontSize: t.typography.fontSize.xs };
  const caption = { ...small, fontWeight: '600' as const, letterSpacing: 0.6, textTransform: 'uppercase' as const };
  const card = { padding: t.spacing[4], borderRadius: t.borderRadius.lg, backgroundColor: t.colors.surface.primary, borderWidth: 1, borderColor: t.colors.border.light, gap: t.spacing[3] };
  const row = (label: string, value: string, note?: string) => (
    <View key={label} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: t.spacing[3] }}>
      <Text style={muted}>{label}</Text>
      <View style={{ alignItems: 'flex-end', flexShrink: 1 }}>
        <AmountText style={{ ...text, textAlign: 'right' }}>{value}</AmountText>
        {!!note && <Text style={small}>{note}</Text>}
      </View>
    </View>
  );
  const pill = (active: boolean, disabled = false) => ({
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: t.spacing[2], minHeight: 44, paddingHorizontal: t.spacing[3],
    borderRadius: t.borderRadius.full, borderWidth: 1.5, opacity: disabled ? 0.45 : 1,
    borderColor: active ? t.colors.primary[500] : t.colors.border.light, backgroundColor: active ? t.colors.primary[50] : t.colors.surface.primary,
  });
  const icon = (src: ReturnType<typeof chainIcon>, size = 18) => src ? <Image source={src} style={{ width: size, height: size, borderRadius: size / 2 }} /> : null;
  const route2 = (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', gap: t.spacing[2], padding: t.spacing[3], borderRadius: t.borderRadius.lg, borderWidth: 1, borderColor: t.colors.border.light }}>
      <NetworkIcon network="spark" size={16} /><Text style={{ ...small, color: t.colors.text.primary, fontWeight: '600' }}>Spark · {source}</Text>
      <Ionicons name="arrow-forward" size={12} color={t.colors.text.tertiary} />
      <Ionicons name="swap-horizontal" size={15} color={t.colors.text.secondary} /><Text style={{ ...small, color: t.colors.text.primary, fontWeight: '600' }}>Flashnet</Text>
      <Ionicons name="arrow-forward" size={12} color={t.colors.text.tertiary} />
      {icon(chainIcon(destChain), 16)}<Text style={{ ...small, color: t.colors.text.primary, fontWeight: '600' }}>{chainLabel(destChain)} · {destToken}</Text>
    </View>
  );

  const renderConfigure = () => <>
    {header}
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing[3], marginTop: t.spacing[3], padding: t.spacing[3], borderRadius: t.borderRadius.lg, backgroundColor: t.colors.primary[50], borderWidth: 1, borderColor: t.colors.primary[500] }}>
      <View style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: t.colors.background.secondary }}>
        {icon(chainIcon(family === 'solana' ? 'solana' : 'ethereum'), 22)}
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ ...text, fontWeight: '600' }}>{family === 'solana' ? 'Solana address' : 'EVM address'}</Text>
        <Text style={{ ...small, color: t.colors.text.secondary }}>Send USDC or USDT from your Spark balance</Text>
      </View>
      <Ionicons name="checkmark-circle" size={20} color={t.colors.primary[500]} />
    </View>

    {!configured ? <Callout tone="warning" style={{ marginTop: t.spacing[4] }} message="Sending to other chains isn't available in this build." /> : <>
      {unreadable && <View style={{ marginTop: t.spacing[4], gap: t.spacing[2] }}>
        <Callout tone="warning" message="Could not read your previous cross-chain transfer. Check your Spark activity before sending again." />
        <Button title="Discard the old record" variant="secondary" onPress={discardUnreadable} />
      </View>}
      {blocking && <View style={{ marginTop: t.spacing[4], gap: t.spacing[2] }}>
        <Callout tone="warning" title="A transfer is still in progress"
          message={`Your transfer to ${shortAddress(blocking.recipient)} on ${chainLabel(blocking.destChain)} hasn't finished. Finish it before starting another.`} />
        <Button title="Open it" variant="secondary" onPress={() => onOpenAddress(blocking.recipient)} />
      </View>}

      <Text style={[caption, { marginTop: t.spacing[5], marginBottom: t.spacing[2] }]}>Send from Spark</Text>
      <View style={{ flexDirection: 'row', gap: t.spacing[2] }}>
        {SOURCES.map(key => {
          const raw = !spark ? null : key === 'BTC' ? String(spark.btcSat) : String(spark.usdb?.available ?? 0);
          const empty = raw === null || BigInt(raw) <= 0n;
          const active = source === key;
          return (
            <PressableScale key={key} scaleTo={0.96} disabled={empty} accessibilityRole="radio" accessibilityState={{ checked: active, disabled: empty }}
              accessibilityLabel={`Send ${key === 'BTC' ? 'bitcoin' : 'USDB'}${raw !== null ? `, ${fmtSource(raw, key)} available` : ''}`}
              onPress={() => { if (!active) { feedback.select(); setSource(key); setAmount(''); } }}
              style={[pill(active, empty), { flex: 1, borderRadius: t.borderRadius.lg, paddingVertical: t.spacing[2] }]}>
              {icon(key === 'BTC' ? chainIcon('bitcoin') : assetIcon('USDB'), 22)}
              <View style={{ flexShrink: 1 }}>
                <Text style={{ ...text, fontWeight: '600', color: active ? t.colors.primary[500] : t.colors.text.primary }}>{key === 'BTC' ? 'Bitcoin' : 'USDB'}</Text>
                <AmountText numberOfLines={1} style={small}>{raw === null ? '…' : fmtSource(raw, key)}</AmountText>
              </View>
            </PressableScale>
          );
        })}
      </View>

      <Text style={[caption, { marginTop: t.spacing[5], marginBottom: t.spacing[2] }]}>Recipient gets</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: t.spacing[2] }}>
        {chains.map(c => {
          const active = c.chain === destChain;
          return (
            <PressableScale key={c.chain} scaleTo={0.96} accessibilityRole="radio" accessibilityState={{ checked: active }} accessibilityLabel={`On ${c.label}`}
              onPress={() => { if (!active) { feedback.select(); setDestChain(c.chain); } }} style={pill(active)}>
              {icon(chainIcon(c.chain))}
              <Text style={{ ...text, fontWeight: '600', color: active ? t.colors.primary[500] : t.colors.text.primary }}>{c.label}</Text>
            </PressableScale>
          );
        })}
      </ScrollView>
      <View style={{ flexDirection: 'row', gap: t.spacing[2], marginTop: t.spacing[2] }}>
        {tokens.map(tk => {
          const active = tk === destToken;
          return (
            <PressableScale key={tk} scaleTo={0.96} accessibilityRole="radio" accessibilityState={{ checked: active }} accessibilityLabel={`Receive ${tk}`}
              onPress={() => { if (!active) { feedback.select(); setDestToken(tk); } }} style={pill(active)}>
              {icon(assetIcon(tk))}
              <Text style={{ ...text, fontWeight: '600', color: active ? t.colors.primary[500] : t.colors.text.primary }}>{tk}</Text>
            </PressableScale>
          );
        })}
      </View>

      <View style={[card, { marginTop: t.spacing[5] }]}>
        {exactOut && <SegmentedControl<OrchestraAmountMode> accessibilityLabel="Amount is"
          options={[{ key: 'exact_in', label: 'You send' }, { key: 'exact_out', label: 'They receive' }]}
          value={mode} onChange={m => { setMode(m); setAmount(''); }} />}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={text}>{mode === 'exact_in' ? `You send, in ${sourceUnit}` : `They receive, in ${destToken}`}</Text>
          {mode === 'exact_in' && BigInt(spendableRaw) > 0n && <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Send all ${sourceUnit}`} hitSlop={8} onPress={() => setAmount(maxValue)}>
            <Text style={{ ...small, color: t.colors.primary[500], fontWeight: '600' }}>Max</Text>
          </TouchableOpacity>}
        </View>
        <TextInput accessibilityLabel={mode === 'exact_in' ? `Amount to send in ${sourceUnit}` : `Amount to receive in ${destToken}`} keyboardType="decimal-pad"
          value={amount} onChangeText={setAmount} placeholder="0" placeholderTextColor={t.colors.text.muted}
          style={{ ...text, fontSize: t.typography.fontSize['2xl'], paddingVertical: t.spacing[2] }} />
        <Text style={small}>{fmtSource(spendableRaw)} available on Spark</Text>
      </View>

      {(estimate || estimating || estimateError) && <View style={[card, { marginTop: t.spacing[3] }]}>
        {estimating ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing[2] }}>
          <ActivityIndicator size="small" color={t.colors.text.tertiary} /><Text style={small}>Getting a price…</Text>
        </View> : estimateError ? <Text style={{ ...muted, color: t.colors.warning[500] }}>{estimateError}</Text> : estimate && <>
          {mode === 'exact_in'
            ? row('They receive', `≈ ${fmtDest(estimate.estimatedOut)}`)
            : row('You send', spendRaw ? `≈ ${fmtSource(spendRaw)}` : '—')}
          {fee && row('Fee', fee.text, fee.note)}
          {row('Arrives', 'Usually within minutes')}
        </>}
      </View>}

      {!!problem && !!amount.trim() && problem !== 'no-amount' && <Text accessibilityRole="alert" style={{ ...muted, color: t.colors.warning[500], marginTop: t.spacing[3] }}>{FORM_PROBLEM_TEXT[problem]}</Text>}
      {!!problem && ['spark-disconnected', 'not-mainnet', 'no-balance'].includes(problem) && !amount.trim() && <Callout tone="warning" style={{ marginTop: t.spacing[3] }} message={FORM_PROBLEM_TEXT[problem]} />}
    </>}
  </>;

  const renderReview = () => <>
    <View style={{ alignItems: 'center', gap: 2, paddingTop: t.spacing[2], paddingBottom: t.spacing[4] }}>
      <Text style={muted}>They receive {mode === 'exact_in' ? 'about' : 'exactly'}</Text>
      <AmountText style={{ ...text, fontSize: t.typography.fontSize['4xl'], fontWeight: '700' }}>{receiveRaw ? fmtDest(receiveRaw) : '—'}</AmountText>
      <Text style={small}>on {chainLabel(destChain)}</Text>
    </View>
    <View style={card}>
      {row('You send', spendRaw ? `${mode === 'exact_out' ? '≈ ' : ''}${fmtSource(spendRaw)}` : '—', 'from Spark')}
      {fee && row('Fee', fee.text, fee.note)}
      {row('Network', `${chainLabel(destChain)} · ${destToken}`)}
      <View style={{ gap: 2 }}>
        <Text style={muted}>To</Text>
        <Text selectable style={{ ...text, fontFamily: t.typography.fontFamily.mono, fontSize: t.typography.fontSize.sm }}>{address}</Text>
      </View>
    </View>
    <View style={{ marginTop: t.spacing[3] }}>{route2}</View>
    <Callout tone="warning" style={{ marginTop: t.spacing[3] }}
      message={`Transfers to other chains can't be reversed. Check that this is a ${chainLabel(destChain)} address that accepts ${destToken}.`} />
  </>;

  const renderSending = () => (
    <View style={{ alignItems: 'center', gap: t.spacing[3], paddingTop: t.spacing[8] }}>
      <ActivityIndicator color={t.colors.primary[500]} />
      <Text accessibilityLiveRegion="polite" style={muted}>
        {stage === 'quoting' ? 'Getting your quote…' : stage === 'paying' ? 'Paying from Spark…' : 'Submitting the order…'}
      </Text>
      <Text style={{ ...small, textAlign: 'center' }}>Keep the app open until this finishes.</Text>
    </View>
  );

  const renderStatus = (s: CrossChainSendSession) => {
    const status = s.order?.status;
    const done = status === 'completed';
    const failed = status === 'failed' || status === 'refunded';
    const checking = s.phase === 'paying';
    const tone = done ? t.colors.primary[500] : failed ? t.colors.error[500] : checking || s.lastError ? t.colors.warning[500] : t.colors.primary[500];
    const title = done ? 'Delivered' : status === 'refunded' ? 'Refunded' : failed ? 'Transfer failed'
      : checking ? (s.lastError ? 'Transfer needs checking' : 'Checking your transfer')
        : s.phase === 'paid' ? (s.lastError ? 'Paid, order not submitted yet' : 'Submitting the order')
          : status ? STATUS_LABELS[status] : 'In progress';
    const current = status ? STATUS_PIPELINE.indexOf(status) : -1;
    const delivered = s.order?.amountOut ?? s.expectedOutRaw;
    return <View style={{ gap: t.spacing[4] }}>
      <View style={{ alignItems: 'center', gap: t.spacing[2], paddingTop: t.spacing[6] }}>
        <View style={{ width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center', backgroundColor: tone + '26' }}>
          {busy ? <ActivityIndicator color={tone} /> : <Ionicons name={done ? 'checkmark' : failed ? 'close' : 'time-outline'} size={40} color={tone} />}
        </View>
        <Text accessibilityRole="header" style={muted}>{title}</Text>
        {delivered && <AmountText style={{ ...text, fontSize: t.typography.fontSize['3xl'], fontWeight: '700' }}>{done ? '' : '≈ '}{fmtDest(delivered, s.destToken, s.destDecimals)}</AmountText>}
        <Text style={muted}>to {shortAddress(s.recipient)} on {chainLabel(s.destChain)}</Text>
      </View>

      <View style={card}>
        {row('Sent from Spark', fmtSource(s.sourceAmountRaw, s.source))}
        {s.order && STATUS_PIPELINE.map((p, i) => {
          const reached = done || (current >= 0 && i <= current);
          return <View key={p} style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing[2] }}>
            <Ionicons name={reached ? 'checkmark-circle' : 'ellipse-outline'} size={16} color={reached ? t.colors.primary[500] : t.colors.text.tertiary} />
            <Text style={{ ...small, color: reached ? t.colors.text.primary : t.colors.text.tertiary, fontWeight: i === current ? '600' : '400' }}>{STATUS_LABELS[p]}</Text>
          </View>;
        })}
        {status && !STATUS_PIPELINE.includes(status) && !failed && <Text style={small}>{STATUS_LABELS[status]}</Text>}
        <Text selectable style={small}>Reference: {s.order?.id ?? s.quoteId}</Text>
      </View>

      {checking && <Callout tone="warning" message={`We couldn't confirm that the payment left Spark${s.lastError ? ` (${s.lastError})` : ''}. Do not send again. Check again in a moment; if your Spark activity shows nothing went out, you can start a new transfer.`} />}
      {s.phase === 'paid' && !!s.lastError && <Callout tone="warning" message={`Your payment left Spark, but the order wasn't accepted yet (${s.lastError}). Retrying moves no funds.`} />}
      {!!pollError && s.phase === 'submitted' && <Text style={{ ...small, color: t.colors.warning[500], textAlign: 'center' }}>Status updates paused: {pollError}. The transfer continues.</Text>}
      {failed && <Text style={{ ...muted, textAlign: 'center' }}>{status === 'refunded' ? 'The funds went back to your Spark wallet.' : 'The transfer did not complete. If funds left Spark they are refunded there.'}</Text>}
      {s.phase === 'submitted' && <Text style={{ ...muted, textAlign: 'center' }}>You can leave this screen; reopening Send picks the transfer up again.</Text>}
    </View>;
  };

  // ---- footer --------------------------------------------------------------
  const sendLabel = `Send ${spendRaw ? fmtSource(spendRaw) : ''}`.trim();
  const footer = () => {
    if (step === 'configure') return configured ? <Button title={estimating ? 'Getting a price…' : 'Review'} disabled={!canReview} onPress={review} /> : null;
    if (step === 'review') return <>
      <SlideToConfirm label={sendLabel} loading={busy} disabled={busy || !estimate} onConfirm={() => void send()} />
      <Button title="Edit" variant="secondary" disabled={busy} onPress={() => { setError(''); setStep('configure'); }} />
    </>;
    if (step !== 'status' || !session) return null;
    const action = resumeAction(session);
    if (action === 'verify' || action === 'submit') return <>
      <Button title={action === 'verify' ? 'Check again' : 'Retry'} loading={busy} disabled={busy} onPress={() => void retrySubmit(1)} />
      {!busy && <Button title="Start a new transfer" variant="secondary" onPress={startOver} />}
    </>;
    if (session.phase === 'done') return <Button title="Done" onPress={onDone} />;
    return null;
  };

  return <>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: t.spacing[5] }}>
      {!!error && <View accessibilityRole="alert" style={{ flexDirection: 'row', gap: t.spacing[2], alignItems: 'flex-start', marginBottom: t.spacing[4] }}>
        <Ionicons name="alert-circle-outline" size={18} color={t.colors.warning[500]} />
        <Text style={{ ...text, color: t.colors.warning[500], flex: 1 }}>{error}</Text>
      </View>}
      {step === 'configure' ? renderConfigure() : step === 'review' ? renderReview() : step === 'sending' ? renderSending() : session ? renderStatus(session) : null}
    </ScrollView>
    <View style={{ padding: t.spacing[5], gap: t.spacing[3], backgroundColor: t.colors.background.primary }}>
      {footer()}
      {step === 'configure' && configured && !walletId && <Text style={{ ...muted, textAlign: 'center' }}>Set up a wallet to send.</Text>}
    </View>
  </>;
}

export default CrossChainSendPanel;
