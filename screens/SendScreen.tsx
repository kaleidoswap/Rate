// screens/SendScreen.tsx
//
// The one way to pay. Whatever is entered (Lightning invoice or address, BOLT12
// offer, bitcoin address, Spark, Ark or RGB invoice) is decoded into a
// payment request; every connected account then offers its ways to pay it, directly
// or through a swap provider, priced the same way. The user reviews the total and
// pays; the payment journal keeps an unresolved payment from being paid twice.
// An EVM or Solana address opens the cross-chain send (USDC/USDT from Spark).
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, View, Text, TextInput, ScrollView, TouchableOpacity, ActivityIndicator, KeyboardAvoidingView, Platform, Clipboard, Share } from 'react-native';
import Animated, { FadeInDown, ZoomIn } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Crypto from 'expo-crypto';
import { ScreenHeader } from '../components/ScreenHeader';
import { Button } from '../components/Button';
import { PressableScale } from '../components/PressableScale';
import { SlideToConfirm } from '../components/SlideToConfirm';
import { AmountText } from '../components/AmountText';
import { ProviderSheet } from '../components/payments/ProviderSheet';
import { NetworkIcon } from '../components/NetworkIcon';
import { AmountEditorModal } from '../components/AmountEditorModal';
import { SendDestinationsHint } from '../components/payments/SendDestinationsHint';
import { CrossChainSendPanel } from '../components/payments/CrossChainSendPanel';
import { detectCrossChainAddress } from '../utils/crosschain';
import { isUnresolved, unwrapCrossChainUri } from '../utils/crosschain-send';
import { loadCrossChainSession } from '../services/crosschainSend';
import NostrContactsSelector from '../components/NostrContactsSelector';
import { contactKeyFor, recordContactEvent, updateContactEventStatus } from '../services/contactHistory';
import { useAppTheme } from '../theme/ThemeProvider';
import { motion, protocolTint } from '../theme';
import { feedback } from '../utils/feedback';
import { groupOffersByAccount, offerAccount, railOf, PAY_ACCOUNT_NAME, type PayAccountId } from '../utils/send-accounts';
import type { Contact } from '../store/slices/contactsSlice';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { loadBtcBalance } from '../store/slices/walletSlice';
import { useFiatRates } from '../hooks/useFiatRates';
import { useForegroundClock } from '../hooks/useForegroundClock';
import { formatBitcoinAmount, formatSatoshisToUSD } from '../utils/bitcoinUnits';
import {
  KALEIDOPAY_DEMO, decodeTarget, prepareKaleidoPay, railLabel, previewInput, quotePaymentOffers, quoteSpend, formatSpend,
  bestOffer, executePaymentOffer, checkPaymentStatus, PaymentNotSentError,
} from '../services/kaleidoPay';
import type { PayTarget, Preview, PaymentOffer, RequestAsset } from '../services/kaleidoPay';
import { usePayAccounts, prepareRgbRequest, prepareSparkTokenRequest, sendableSparkTokens } from '../services/kaleidoPay/connect';
import type { SparkToken } from '../services/kaleidoPay/sparkPay';
import type { RgbRequestAsset } from '../services/kaleidoPay/connect';
import { rgbL1FeeOptions, setRgbL1FeeSpeed, type RgbFeeSpeed } from '../services/kaleidoPay/rgbL1Pay';
import { SegmentedTabs } from '../components/SegmentedTabs';
import { loadPaymentAttempt, beginPaymentAttempt, savePaymentAttempt, unresolvedAttempt, dismissPaymentAttempt } from '../services/kaleidoPay/attempts';
import type { PaymentAttempt } from '../services/kaleidoPay/attempts';

interface Props { navigation: any; route: any }

// Re-checks of an unresolved payment: quick at first, then every 15 s, for at most 10 minutes.
const STATUS_POLL_DELAYS_MS = [3_000, 5_000, 10_000, 15_000];
const STATUS_POLL_LIMIT_MS = 10 * 60_000;

// RGB on this phone pays on-chain from these accounts, at a speed chosen in the review.
const RGB_ONCHAIN_SOURCES = new Set(['rgb-btc', 'rgb-asset']);
const SPEED_LABEL: Record<RgbFeeSpeed, string> = { slow: 'Slow', normal: 'Normal', fast: 'Fast' };

const KIND_LABEL: Record<PayTarget['kind'], string> = {
  bolt11: 'Lightning invoice', lnurl: 'Lightning address', offer: 'Lightning offer', bitcoin: 'Bitcoin address',
  spark: 'Spark address', ark: 'Ark address', rgb: 'RGB invoice',
};

function decodeQuietly(text: string): { target?: PayTarget; error?: string } {
  if (!text.trim()) return {};
  try { return { target: decodeTarget(text) }; } catch (e) { return { error: e instanceof Error ? e.message : 'Not payable' }; }
}

export default function SendScreen({ navigation, route }: Props) {
  const t = useAppTheme();
  const dispatch = useAppDispatch();
  const bitcoinUnit = useAppSelector(s => s.settings.bitcoinUnit);
  const walletId = useAppSelector(s => s.wallet.activeWallet?.id);
  const rates = useFiatRates();
  usePayAccounts(walletId);
  // Bark is an Advanced account: Lite shows it only when it holds funds.
  const advanced = useAppSelector(s => s.settings.disclosureLevel) !== 'lite';
  const byProtocol = useAppSelector(s => s.wallet.btcBalance?.byProtocol);
  const balancesSat = useMemo(() => {
    const out: Partial<Record<PayAccountId, number>> = {};
    // Spark's total includes transfers not yet claimed; only the confirmed part can pay.
    for (const k of ['SPARK', 'ARKADE', 'BARK', 'RGB'] as PayAccountId[]) { const b = byProtocol?.[k]; if (b) out[k] = k === 'SPARK' ? b.confirmed : b.total; }
    return out;
  }, [byProtocol]);
  const contacts = useAppSelector(s => s.contacts?.contacts);
  const recentContacts = useMemo(() => (contacts ?? [])
    .filter(c => c.lightning_address || c.node_pubkey)
    .sort((a, b) => Number(b.is_favorite) - Number(a.is_favorite) || b.updated_at - a.updated_at)
    .slice(0, 8), [contacts]);

  const [input, setInput] = useState<string>(route.params?.prefilledAddress ?? route.params?.address ?? '');
  const [contactName, setContactName] = useState<string | undefined>(route.params?.contactName);
  const [amountSat, setAmountSat] = useState<number | undefined>(undefined);
  const [assetAmount, setAssetAmount] = useState('');
  const [rgbAsset, setRgbAsset] = useState<RgbRequestAsset | null>(null);
  // A Spark address can be paid in bitcoin or in a Spark token the wallet holds (e.g. USDB).
  const [sparkTokenList, setSparkTokenList] = useState<SparkToken[]>([]);
  const [sparkToken, setSparkToken] = useState<SparkToken | null>(null);
  const [moreQuotes, setMoreQuotes] = useState(false);
  const [showAmountEditor, setShowAmountEditor] = useState(false);
  const [showContacts, setShowContacts] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [offers, setOffers] = useState<PaymentOffer[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [showProviders, setShowProviders] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [reviewUpdated, setReviewUpdated] = useState(false);
  const [previousTotal, setPreviousTotal] = useState('');
  const [attempt, setAttempt] = useState<PaymentAttempt | null>(null);
  const [journalReady, setJournalReady] = useState(false);
  const [journalUnreadable, setJournalUnreadable] = useState(false);
  const [feeSpeed, setFeeSpeed] = useState<RgbFeeSpeed>('normal');
  const now = useForegroundClock(offers.some(o => !!o.quote) && !attempt);
  const revision = useRef(0);
  const paying = useRef(false);
  const checking = useRef(false);
  const requestId = useRef(Crypto.randomUUID());

  const { target, error: decodeError } = useMemo(() => decodeQuietly(input), [input]);
  // Only what the wallet's own decoding rejects can be an address on another chain.
  const crossChain = useMemo(() => (target ? null : detectCrossChainAddress(unwrapCrossChainUri(input))), [target, input]);
  const fixedSat = target?.amountSat;
  const formatSats = (sats: number) => `${formatBitcoinAmount(sats, bitcoinUnit)} ${bitcoinUnit}`;
  const displaySpend: typeof formatSpend = (value, asset) => asset.id === 'BTC' && asset.ticker === 'sats' ? formatSats(value) : formatSpend(value, asset);
  const usd = rates.usd;

  // Prefilled from a scan, a contact, an asset page or chat.
  useEffect(() => {
    const p = route.params ?? {};
    if (p.prefilledAddress || p.address) setInput(p.prefilledAddress || p.address);
    if (p.contactName) setContactName(p.contactName);
    if (p.prefilledAmount) {
      const n = Number(p.prefilledAmount);
      if (Number.isFinite(n) && n > 0) setAmountSat(bitcoinUnit === 'BTC' ? Math.round(n * 1e8) : Math.round(n));
    }
  }, [route.params]);

  // Anything that changes the request discards the reviewed quotes.
  useEffect(() => {
    revision.current++;
    setPreview(null); setOffers([]); setSelectedId(undefined); setError(''); setBusy(false); setPreviousTotal('');
  }, [input, amountSat, assetAmount, sparkToken]);
  useEffect(() => { setRgbAsset(null); setAssetAmount(''); setSparkToken(null); }, [input]);
  // Start the slow setup (wallet syncs, server keys) as soon as Send opens, not on Continue.
  useEffect(() => { void prepareKaleidoPay(); }, []);
  // Each visit starts at the Normal fee speed.
  useEffect(() => { setRgbL1FeeSpeed('normal'); return () => setRgbL1FeeSpeed('normal'); }, []);

  // The payment journal: an unresolved payment is shown before anything new can be paid.
  useEffect(() => {
    let active = true;
    setJournalReady(false); setAttempt(null);
    if (!walletId) { setJournalReady(true); return; }
    loadPaymentAttempt(walletId)
      .then(saved => { if (active) { if (unresolvedAttempt(saved)) setAttempt(saved); setJournalReady(true); } })
      .catch(() => { if (active) { setJournalUnreadable(true); setError('Could not read your previous payment record. Check your wallet activity before paying again.'); } });
    return () => { active = false; revision.current++; };
  }, [walletId]);
  useEffect(() => () => { revision.current++; }, []);
  // A transfer to another chain still under way reopens where it left off.
  useEffect(() => {
    if (!walletId || route.params?.prefilledAddress || route.params?.address) return;
    let active = true;
    loadCrossChainSession(walletId)
      .then(saved => { if (active && isUnresolved(saved)) setInput(current => current.trim() ? current : saved.recipient); })
      .catch(() => { /* the cross-chain panel reports an unreadable record */ });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletId]);
  // An unresolved payment is re-checked as soon as Send can reach its account, then
  // again with backoff while it stays open, so its outcome shows without a manual check.
  const checkStatusRef = useRef<(quiet?: boolean) => Promise<void>>(async () => {});
  const attemptRef = useRef(attempt);
  useEffect(() => {
    if (!journalReady || !unresolvedAttempt(attempt)) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const until = Date.now() + STATUS_POLL_LIMIT_MS;
    const poll = async (round: number) => {
      await checkStatusRef.current(round > 0);
      if (!active || Date.now() >= until) return;
      timer = setTimeout(() => void poll(round + 1), STATUS_POLL_DELAYS_MS[Math.min(round, STATUS_POLL_DELAYS_MS.length - 1)]);
    };
    void prepareKaleidoPay().then(() => { if (active) void poll(0); });
    return () => { active = false; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt?.id, attempt?.status, attempt?.dismissedAt, journalReady]);

  const selected = offers.find(o => o.id === selectedId);
  const quote = selected?.quote;
  const spend = quote ? quoteSpend(quote) : null;
  const total = spend ? displaySpend(spend.total, spend.asset) : '';
  const expired = !!quote && quote.expiresAt * 1000 <= now;

  // The offers this screen shows: hidden accounts (Bark in Lite) are never picked for the user.
  const visibleOffers = useCallback((list: PaymentOffer[]) => {
    const ids = new Set(groupOffersByAccount(list, { advanced, balances: balancesSat }).flatMap(c => c.offers.map(o => o.id)));
    return list.filter(o => ids.has(o.id) || !offerAccount(o));
  }, [advanced, balancesSat]);

  // `quiet`: re-quoted because the user changed the fee speed, so the new total needs no second review.
  const getOffers = useCallback(async (refresh = false, quiet = false) => {
    const current = ++revision.current;
    setBusy(true); setError(''); setMoreQuotes(false);
    if (refresh && !quiet) setPreviousTotal(total);
    try {
      await prepareKaleidoPay();
      if (current !== revision.current) return;
      let asset: RequestAsset | undefined;
      if (target?.kind === 'rgb') {
        // The RGB node reads the invoice's asset (and amount, when it has one).
        const decoded = rgbAsset ?? await prepareRgbRequest(target.rgbInvoice!);
        if (current !== revision.current) return;
        if (!rgbAsset) setRgbAsset(decoded);
        const units = Number(assetAmount);
        if (!decoded.amount && !(units > 0)) { setError(`Enter how much ${decoded.ticker} to send.`); return; }
        asset = { id: decoded.id, ticker: decoded.ticker, precision: decoded.precision, amount: decoded.amount ?? Math.round(units * 10 ** decoded.precision) };
      } else if (!sparkToken) {
        prepareSparkTokenRequest(null);
      } else {
        const units = Number(assetAmount.replace(',', '.'));
        const amount = Math.round(units * 10 ** sparkToken.precision);
        if (!(amount > 0)) { setError(`Enter how much ${sparkToken.ticker} to send.`); return; }
        prepareSparkTokenRequest(sparkToken);
        asset = { id: sparkToken.id, ticker: sparkToken.ticker, precision: sparkToken.precision, amount };
      }
      const fresh = await previewInput(input, asset && target?.kind !== 'rgb' ? undefined : fixedSat ?? amountSat, requestId.current, { asset });
      if (current !== revision.current) return;
      if (fresh.plan.status !== 'ready') { setPreview(fresh); setOffers([]); setError(fresh.plan.reason); return; }
      // Show quotes as they arrive: the first payable one ends the wait, slower providers fill in after.
      let picked = refresh;
      const show = (list: PaymentOffer[], done: boolean) => {
        if (current !== revision.current) return;
        setPreview(fresh); setOffers(list);
        const shown = visibleOffers(list);
        const best = bestOffer(shown.filter(o => o.executable)) ?? shown.find(o => o.executable && o.quote && !o.unavailable);
        // Pick once, the first time something payable shows (or at the end); later quotes never move the selection.
        if (!picked && (best || done)) { picked = true; setSelectedId((best ?? bestOffer(shown))?.id); }
        if (best || done) setBusy(false);
        setMoreQuotes(!done);
      };
      const result = await quotePaymentOffers(fresh, partial => show(partial, false));
      show(result, true);
      if (current !== revision.current) return;
      // Refresh never switches the chosen way to pay, even when its quote fails.
      setReviewUpdated(refresh && !quiet);
    } catch (e) {
      if (current === revision.current) setError(e instanceof Error ? e.message : 'Could not get quotes. Please try again.');
    } finally { if (current === revision.current) { setBusy(false); setMoreQuotes(false); } }
  }, [input, fixedSat, amountSat, assetAmount, rgbAsset, sparkToken, target, total, visibleOffers]);

  // A Spark address can also be paid in the Spark tokens this wallet holds.
  const sparkAddressTarget = target?.kind === 'spark' && fixedSat === undefined;
  useEffect(() => {
    let live = true;
    setSparkTokenList([]);
    if (sparkAddressTarget) void sendableSparkTokens().then(list => { if (live) setSparkTokenList(list); });
    return () => { live = false; };
  }, [sparkAddressTarget, input]);

  // Continue on a request without an amount asks for one, then carries on.
  // (The editor closes right after confirming, so the intent is latched on confirm.)
  const continueAfterAmount = useRef(false);
  const continueNow = useRef(false);
  useEffect(() => {
    if (continueNow.current && amountSat) { continueNow.current = false; void getOffers(); }
  }, [amountSat, getOffers]);

  function review() {
    if (!target) { setError(decodeError ?? 'Paste or scan something to pay.'); return; }
    if (target.kind !== 'rgb' && !sparkToken && fixedSat === undefined && !amountSat) { continueAfterAmount.current = true; setShowAmountEditor(true); return; }
    void getOffers();
  }

  function resultCue(status: PaymentAttempt['status']) {
    if (status === 'completed') feedback.send();
    else if (status === 'failed') feedback.error();
  }

  async function pay() {
    if (paying.current || !walletId || !journalReady || !preview || !selected || !quote || quote.expiresAt * 1000 <= Date.now() || !selected.executable || unresolvedAttempt(attempt)) return;
    paying.current = true; setBusy(true); setError('');
    const recipient = preview.request.asset ? formatSpend(preview.request.asset.amount, preview.request.asset) : formatSats(preview.request.amountSat);
    const next: PaymentAttempt = { id: Crypto.randomUUID(), sourceId: selected.route.sourceId, provider: selected.provider, total, recipient, createdAt: Date.now(), status: 'pending' };
    try {
      await beginPaymentAttempt(walletId, next); // No send unless the recovery record is durable.
    } catch {
      setError('Could not start a new payment. Reopen Send to check your previous payment.');
      setJournalReady(false); paying.current = false; setBusy(false); return;
    }
    setAttempt(next);
    // A payment to a picked contact goes into that contact's history too.
    const toContact = contactName && input.trim() ? { contactKey: contactKeyFor(input), contactName } : null;
    const logForContact = (status: PaymentAttempt['status']) => {
      if (!toContact) return;
      void recordContactEvent(walletId, { id: next.id, ...toContact, direction: 'sent', amount: recipient, status, createdAt: next.createdAt, attemptId: next.id }).catch(() => {});
    };
    logForContact('pending');
    try {
      const result = await executePaymentOffer(preview, selected, next.id);
      const updated = { ...next, ...result };
      setAttempt(updated);
      resultCue(updated.status);
      logForContact(updated.status);
      try { await savePaymentAttempt(walletId, updated); }
      catch { setError('The payment result could not be saved. Keep this receipt; reopening will check the payment again.'); }
    } catch (e) {
      const updated: PaymentAttempt = { ...next, status: e instanceof PaymentNotSentError ? 'failed' : 'unknown' };
      setAttempt(updated);
      resultCue(updated.status);
      logForContact(updated.status);
      setError(e instanceof PaymentNotSentError ? `${e.message} Nothing was sent.` : 'Payment status needs checking. Do not send again.');
      try { await savePaymentAttempt(walletId, updated); } catch { /* The durable pending record forces a status check on reopen. */ }
    } finally {
      paying.current = false; setBusy(false);
      void dispatch(loadBtcBalance());
    }
  }

  // `quiet`: a background re-check, which neither blocks the screen nor reports its own failure.
  async function checkStatus(quiet = false) {
    if (!attempt || !walletId || paying.current || (quiet && checking.current)) return;
    const lock = quiet ? checking : paying;
    lock.current = true;
    if (!quiet) { setBusy(true); setError(''); }
    try {
      const result = await checkPaymentStatus(attempt.sourceId, attempt.id);
      // A background result is dropped when nothing changed, or the record changed meanwhile (checked, dismissed).
      if (quiet && (attemptRef.current !== attempt || (result.status === attempt.status && result.reference === attempt.reference))) return;
      const updated = { ...attempt, ...result };
      await savePaymentAttempt(walletId, updated); setAttempt(updated);
      if (updated.status !== attempt.status) resultCue(updated.status);
      void updateContactEventStatus(walletId, attempt.id, updated.status).catch(() => {});
      if (result.status === 'completed') void dispatch(loadBtcBalance());
    } catch { if (!quiet) setError('Could not update payment status. Check again before making another payment.'); }
    finally { lock.current = false; if (!quiet) setBusy(false); }
  }
  checkStatusRef.current = checkStatus;
  attemptRef.current = attempt;

  function startNewPayment() {
    if (!walletId || paying.current) return;
    Alert.alert(
      'Start a new payment?',
      'Only continue if your wallet activity shows this payment did not go through. If it did, paying again pays twice. A swap that is already under way keeps being completed in the background.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Start a new payment', style: 'destructive', onPress: async () => {
          try {
            await dismissPaymentAttempt(walletId, journalUnreadable ? null : attempt);
            setAttempt(null); setJournalUnreadable(false); setError(''); setJournalReady(true);
          } catch { setError('Could not update the payment record. Try again.'); }
        } },
      ],
    );
  }

  async function paste() {
    try { const text = await Clipboard.getString(); if (text) { setInput(text.trim()); setContactName(undefined); } }
    catch { setError('Could not read the clipboard.'); }
  }

  const pickContact = (c: Contact) => { const dest = c.lightning_address || c.node_pubkey; if (dest) { feedback.select(); setInput(dest); setContactName(c.name); } };
  const iconButton = { width: 40, height: 40, borderRadius: t.borderRadius.md, alignItems: 'center' as const, justifyContent: 'center' as const, backgroundColor: t.colors.background.secondary };

  const resetToInput = () => { revision.current++; setBusy(false); setPreview(null); setOffers([]); };

  // ---- presentation ---------------------------------------------------------
  const text = { color: t.colors.text.primary, fontSize: t.typography.fontSize.base };
  const muted = { ...text, color: t.colors.text.secondary };
  const small = { color: t.colors.text.tertiary, fontSize: t.typography.fontSize.xs };
  const caption = { ...small, fontWeight: '600' as const, letterSpacing: 0.6, textTransform: 'uppercase' as const };
  const card = { padding: t.spacing[4], borderRadius: t.borderRadius.lg, backgroundColor: t.colors.surface.primary, borderWidth: 1, borderColor: t.colors.border.light, gap: t.spacing[3] };
  const row = (label: string, value: string) => <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: t.spacing[3] }}><Text style={muted}>{label}</Text><AmountText style={{ ...text, textAlign: 'right', flexShrink: 1 }}>{value}</AmountText></View>;
  const railIcon = (r: string) => ({ ln: 'lightning', btc: 'onchain', ark: 'arkade', spark: 'spark', rgb: 'rgb' } as Record<string, string>)[railOf(r)] ?? railOf(r);
  const recipientName = preview?.code.label || contactName || target?.label || 'Recipient';
  const feeText = (fee: number, asset: Parameters<typeof displaySpend>[1]) => fee === 0 ? 'No fee' : `+${displaySpend(fee, asset)}`;

  // Pay from: the ways to pay grouped by the account they spend from.
  const choices = groupOffersByAccount(offers, { advanced, balances: balancesSat, now });
  const shownOffers = visibleOffers(offers);
  const best = bestOffer(shownOffers);
  const accountHeading = (o: PaymentOffer) => {
    const account = offerAccount(o);
    if (!account) return 'Other';
    const sats = balancesSat[account];
    return sats === undefined ? PAY_ACCOUNT_NAME[account] : `${PAY_ACCOUNT_NAME[account]} · ${formatSats(sats)}`;
  };
  const options = shownOffers.map(o => {
    const s = o.quote ? quoteSpend(o.quote) : null;
    const swap = o.route.kind === 'swap';
    return { id: o.id, name: o.provider, account: o.accountName, amount: s ? displaySpend(s.total, s.asset) : 'Unavailable', amountLabel: 'Total you pay', detail: s ? `Fees ${displaySpend(s.fee, s.asset)}` : '', unavailable: o.unavailable,
      expiresAt: o.quote ? o.quote.expiresAt * 1000 : undefined, recommended: best?.id === o.id, fee: s ? (s.fee === 0 ? 'No fee' : `${displaySpend(s.fee, s.asset)} fee`) : undefined,
      icon: swap ? 'swap' : railIcon(o.route.to), group: accountHeading(o),
      subtitle: swap ? [`Swap to ${railLabel(o.route.to)}`, o.providerDetail].filter(Boolean).join(' · ') : `${railLabel(o.route.to)}, direct`,
      preferred: !swap && !!preview && railOf(o.route.to) === railOf(preview.request.acceptedRails[0] ?? '') };
  });
  const liveOptions = options.filter(o => !o.unavailable).length;
  const shownSat = fixedSat ?? amountSat;
  const usdOf = (sats: number) => usd ? `≈ $${formatSatoshisToUSD(sats, usd)}` : '';
  const selectedAccount = selected ? offerAccount(selected) : null;
  const feeOptions = selected && RGB_ONCHAIN_SOURCES.has(selected.route.sourceId) ? rgbL1FeeOptions() : null;
  const feeOption = feeOptions?.find(o => o.speed === feeSpeed);
  const chooseSpeed = (next: RgbFeeSpeed) => {
    if (next === feeSpeed || busy) return;
    feedback.select();
    setFeeSpeed(next);
    setRgbL1FeeSpeed(next);
    setPreviousTotal('');
    void getOffers(true, true);
  };

  const headerTitle = attempt ? (attempt.status === 'completed' ? 'Sent' : 'Payment') : 'Send';
  const onBack = () => {
    if (paying.current) return;
    if (preview && !attempt) { resetToInput(); return; }
    navigation.goBack();
  };

  const targetIcon = (kind: PayTarget['kind']) => ({ bolt11: 'lightning', lnurl: 'lightning', offer: 'lightning', bitcoin: 'onchain', spark: 'spark', ark: 'arkade', rgb: 'rgb' } as Record<string, string>)[kind];
  const expiresIn = target?.invoiceExpiresAt ? Math.max(0, Math.round((target.invoiceExpiresAt - now) / 60_000)) : undefined;
  const iconChip = (network: string, size = 36) => (
    <View style={{ width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: protocolTint(network === 'rgb' ? 'RGB' : network.toUpperCase(), 0.16) }}>
      <NetworkIcon network={network} size={Math.round(size * 0.55)} />
    </View>
  );
  const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('') || '?';
  const avatarColors = [t.colors.networks.spark, t.colors.networks.arkade, t.colors.networks.lightning, t.colors.networks.bitcoin, t.colors.primary[500]];

  const renderField = () => (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing[2], paddingLeft: t.spacing[4], paddingRight: t.spacing[2], minHeight: 56,
      borderRadius: t.borderRadius.lg, backgroundColor: t.colors.surface.primary, borderWidth: 1, borderColor: target || crossChain ? t.colors.primary[500] : t.colors.border.light }}>
      <TextInput accessibilityLabel="Payment request" value={input} onChangeText={v => { setInput(v); setContactName(undefined); }} autoCapitalize="none" autoCorrect={false}
        placeholder="Paste an invoice or address" placeholderTextColor={t.colors.text.muted}
        style={{ ...text, flex: 1, fontFamily: input ? t.typography.fontFamily.mono : undefined, fontSize: input ? t.typography.fontSize.sm : t.typography.fontSize.base, paddingVertical: t.spacing[3] }} />
      {input ? (
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Clear" onPress={() => { setInput(''); setContactName(undefined); }} hitSlop={8} style={iconButton}>
          <Ionicons name="close" size={18} color={t.colors.text.secondary} />
        </TouchableOpacity>
      ) : (
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Paste" onPress={() => void paste()} style={iconButton}>
          <Ionicons name="clipboard-outline" size={18} color={t.colors.text.secondary} />
        </TouchableOpacity>
      )}
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="Scan" onPress={() => navigation.navigate('QRScanner')} style={iconButton}>
        <Ionicons name="scan-outline" size={18} color={t.colors.text.secondary} />
      </TouchableOpacity>
    </View>
  );

  const renderInput = () => <>
    {renderField()}

    {target ? (
      <Animated.View entering={FadeInDown.duration(motion.duration.base)} style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing[3], marginTop: t.spacing[3], padding: t.spacing[3],
        borderRadius: t.borderRadius.lg, backgroundColor: t.colors.primary[50], borderWidth: 1, borderColor: t.colors.primary[500] }}>
        {iconChip(targetIcon(target.kind))}
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ ...text, fontWeight: '600' }}>{KIND_LABEL[target.kind]}{fixedSat !== undefined ? ` · ${formatSats(fixedSat)}` : ''}</Text>
          <Text style={{ ...small, color: t.colors.text.secondary }} numberOfLines={2}>
            {[contactName ?? target.label, target.description && `“${target.description}”`, expiresIn !== undefined && `expires in ${expiresIn} min`].filter(Boolean).join(' · ') || 'Ready to pay'}
          </Text>
        </View>
        <Ionicons name="checkmark-circle" size={20} color={t.colors.primary[500]} />
      </Animated.View>
    ) : input.trim() ? (
      <View accessibilityRole="alert" style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing[2], marginTop: t.spacing[3], padding: t.spacing[3], borderRadius: t.borderRadius.lg, backgroundColor: t.colors.warning[500] + '1A' }}>
        <Ionicons name="alert-circle-outline" size={18} color={t.colors.warning[500]} />
        <Text style={{ ...muted, color: t.colors.warning[500], flex: 1 }}>{decodeError}</Text>
      </View>
    ) : null}

    {sparkAddressTarget && sparkTokenList.length > 0 && <View style={{ marginTop: t.spacing[4], gap: t.spacing[2] }}>
      <Text style={caption}>Pay in</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: t.spacing[2] }}>
        {[null, ...sparkTokenList].map(token => {
          const active = (token?.id ?? null) === (sparkToken?.id ?? null);
          const label = token ? token.ticker : 'Bitcoin';
          return (
            <PressableScale key={token?.id ?? 'btc'} scaleTo={0.96} accessibilityRole="radio" accessibilityState={{ checked: active }}
              accessibilityLabel={token ? `Pay in ${token.ticker}, ${formatSpend(token.available, token)} available` : 'Pay in bitcoin'}
              onPress={() => { if (!active) { feedback.select(); setSparkToken(token); setAssetAmount(''); } }}
              style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing[2], minHeight: 44, paddingHorizontal: t.spacing[3], borderRadius: t.borderRadius.full,
                borderWidth: 1.5, borderColor: active ? t.colors.primary[500] : t.colors.border.light, backgroundColor: active ? t.colors.primary[50] : t.colors.surface.primary }}>
              {!token ? <Ionicons name="logo-bitcoin" size={16} color={t.colors.networks.bitcoin} />
                : /^USD/i.test(token.ticker) ? <Ionicons name="logo-usd" size={16} color={t.colors.success[500]} />
                : <NetworkIcon network="spark" size={16} />}
              <Text style={{ ...text, fontWeight: '600', color: active ? t.colors.primary[500] : t.colors.text.primary }}>{label}</Text>
            </PressableScale>
          );
        })}
      </ScrollView>
    </View>}

    {sparkToken ? <View style={[card, { marginTop: t.spacing[3] }]}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={text}>Amount in {sparkToken.ticker}</Text>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Send all ${sparkToken.ticker}`} hitSlop={8}
          onPress={() => setAssetAmount((sparkToken.available / 10 ** sparkToken.precision).toFixed(sparkToken.precision).replace(/\.?0+$/, ''))}>
          <Text style={{ ...small, color: t.colors.primary[500], fontWeight: '600' }}>Max</Text>
        </TouchableOpacity>
      </View>
      <TextInput accessibilityLabel={`Amount in ${sparkToken.ticker}`} keyboardType="decimal-pad" value={assetAmount} onChangeText={setAssetAmount} autoFocus
        placeholder="0" placeholderTextColor={t.colors.text.muted} style={{ ...text, fontSize: t.typography.fontSize['2xl'], paddingVertical: t.spacing[2] }} />
      <Text style={small}>{formatSpend(sparkToken.available, sparkToken)} available · sent over Spark, no fee</Text>
    </View> : target?.kind === 'rgb' ? (rgbAsset && !rgbAsset.amount ? <View style={[card, { marginTop: t.spacing[3] }]}>
      <Text style={text}>Amount in {rgbAsset.ticker}</Text>
      <TextInput accessibilityLabel={`Amount in ${rgbAsset.ticker}`} keyboardType="decimal-pad" value={assetAmount} onChangeText={setAssetAmount}
        placeholder={`Amount in ${rgbAsset.ticker}`} placeholderTextColor={t.colors.text.muted} style={{ ...text, paddingVertical: t.spacing[3] }} />
    </View> : null) : target && fixedSat === undefined ? (
      <TouchableOpacity accessibilityRole="button" accessibilityLabel={shownSat ? `Amount, ${formatSats(shownSat)}. Change` : 'Add amount'} onPress={() => setShowAmountEditor(true)}
        style={{ alignItems: 'center', gap: 2, paddingVertical: t.spacing[5] }}>
        <AmountText style={{ ...text, fontSize: t.typography.fontSize['4xl'], fontWeight: '700', color: shownSat ? t.colors.text.primary : t.colors.text.tertiary }}>
          {shownSat ? formatBitcoinAmount(shownSat, bitcoinUnit) : '0'} <Text style={{ ...muted, fontSize: t.typography.fontSize.lg }}>{bitcoinUnit}</Text>
        </AmountText>
        <Text style={{ ...small, color: t.colors.primary[500] }}>{shownSat ? `${usdOf(shownSat)} · tap to change` : 'Tap to enter an amount'}</Text>
      </TouchableOpacity>
    ) : null}

    {!target && <View style={{ marginTop: t.spacing[5], gap: t.spacing[3] }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={caption}>{recentContacts.length ? 'Recent' : 'Contacts'}</Text>
        <TouchableOpacity accessibilityRole="button" onPress={() => setShowContacts(true)} hitSlop={8}>
          <Text style={{ ...small, color: t.colors.primary[500], fontWeight: '600' }}>All contacts</Text>
        </TouchableOpacity>
      </View>
      {recentContacts.length ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: t.spacing[3] }}>
        {recentContacts.map((c, i) => (
          <PressableScale key={c.id} accessibilityRole="button" accessibilityLabel={`Pay ${c.name}`} onPress={() => pickContact(c)} style={{ alignItems: 'center', gap: t.spacing[1], width: 60 }}>
            <View style={{ width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: avatarColors[i % avatarColors.length] }}>
              <Text style={{ color: t.colors.text.inverse, fontWeight: '700' }}>{initials(c.name)}</Text>
            </View>
            <Text numberOfLines={1} style={{ ...small, color: t.colors.text.secondary }}>{c.name.split(' ')[0]}</Text>
          </PressableScale>
        ))}
      </ScrollView> : <Text style={muted}>People you pay often will show here.</Text>}
    </View>}

    {!target && <View style={{ marginTop: t.spacing[5] }}><SendDestinationsHint /></View>}
  </>;

  const renderReview = () => {
    if (!preview) return null;
    const amountLabel = preview.request.asset ? formatSpend(preview.request.asset.amount, preview.request.asset) : formatSats(preview.request.amountSat);
    const via = selected?.route.kind === 'swap';
    return <>
      <View style={{ alignItems: 'center', gap: 2, paddingTop: t.spacing[2], paddingBottom: t.spacing[4] }}>
        <Text style={muted}>You send to {recipientName}</Text>
        <AmountText style={{ ...text, fontSize: t.typography.fontSize['4xl'], fontWeight: '700' }}>{amountLabel}</AmountText>
        {!preview.request.asset && !!usd && <Text style={small}>{usdOf(preview.request.amountSat)}{fixedSat !== undefined ? ' · set by the request' : ''}</Text>}
        {!!(preview.code.message || preview.code.description) && <Text style={{ ...muted, fontSize: t.typography.fontSize.sm }}>“{preview.code.message || preview.code.description}”</Text>}
      </View>

      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: t.spacing[2] }}>
        <Text style={caption}>Pay from</Text>
        {liveOptions > 1 && <TouchableOpacity accessibilityRole="button" accessibilityLabel="Compare ways to pay" onPress={() => setShowProviders(true)} hitSlop={8}>
          <Text style={{ ...small, color: t.colors.primary[500], fontWeight: '600' }}>Compare all ›</Text>
        </TouchableOpacity>}
      </View>

      <View style={{ gap: t.spacing[2] }}>
        {choices.map((c, i) => {
          const active = c.account === selectedAccount;
          const shown = active && selected ? selected : c.best;
          const s = shown?.quote ? quoteSpend(shown.quote) : null;
          const blocked = !c.best;
          return (
            <Animated.View key={c.account} entering={FadeInDown.delay(i * motion.stagger).duration(motion.duration.base)}>
              <PressableScale scaleTo={0.98} disabled={blocked} onPress={() => { if (c.best && !active) { feedback.select(); setSelectedId(c.best.id); setReviewUpdated(false); setPreviousTotal(''); } }}
                accessibilityRole="radio" accessibilityState={{ checked: active, disabled: blocked }}
                accessibilityLabel={`Pay from ${PAY_ACCOUNT_NAME[c.account]}${balancesSat[c.account] !== undefined ? `, balance ${formatSats(balancesSat[c.account]!)}` : ''}. ${blocked ? c.reason : s ? `Total ${displaySpend(s.total, s.asset)}` : ''}`}
                style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing[3], padding: t.spacing[3], borderRadius: t.borderRadius.lg, borderWidth: 1.5,
                  borderColor: active ? t.colors.primary[500] : t.colors.border.light, backgroundColor: active ? t.colors.primary[50] : t.colors.surface.primary, opacity: blocked ? 0.5 : 1 }}>
                {iconChip(c.account.toLowerCase(), 36)}
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={{ ...text, fontWeight: '600' }}>{PAY_ACCOUNT_NAME[c.account]}</Text>
                  {balancesSat[c.account] !== undefined && <AmountText style={small}>{formatSats(balancesSat[c.account]!)}</AmountText>}
                </View>
                <View style={{ alignItems: 'flex-end', gap: 2, maxWidth: '45%' }}>
                  {s ? <AmountText style={{ ...text, fontWeight: '600', color: s.fee === 0 ? t.colors.success[500] : t.colors.text.primary }}>{feeText(s.fee, s.asset)}</AmountText>
                    : <Text style={{ ...small, color: t.colors.warning[500] }} numberOfLines={2}>{c.reason}</Text>}
                  {!!s && shown?.id === best?.id && <Text style={{ ...small, color: t.colors.primary[500] }}>Best price</Text>}
                  {!!s && via && active && <Text style={small}>via {selected?.provider}</Text>}
                </View>
                {active && <Ionicons name="checkmark-circle" size={20} color={t.colors.primary[500]} />}
              </PressableScale>
            </Animated.View>
          );
        })}
      </View>

      {selected && selectedAccount && <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', gap: t.spacing[2], marginTop: t.spacing[3], padding: t.spacing[3], borderRadius: t.borderRadius.lg, borderWidth: 1, borderColor: t.colors.border.light }}>
        <NetworkIcon network={selectedAccount.toLowerCase()} size={16} /><Text style={{ ...small, color: t.colors.text.primary, fontWeight: '600' }}>{PAY_ACCOUNT_NAME[selectedAccount]}</Text>
        <Ionicons name="arrow-forward" size={12} color={t.colors.text.tertiary} />
        {via && <><Ionicons name="swap-horizontal" size={15} color={t.colors.text.secondary} /><Text style={{ ...small, color: t.colors.text.primary, fontWeight: '600' }}>{selected.provider}</Text>
          <Ionicons name="arrow-forward" size={12} color={t.colors.text.tertiary} /></>}
        <NetworkIcon network={railIcon(selected.route.to)} size={16} /><Text style={{ ...small, color: t.colors.text.primary, fontWeight: '600' }}>{railLabel(selected.route.to)}</Text>
        <Ionicons name="arrow-forward" size={12} color={t.colors.text.tertiary} />
        <Ionicons name="person-circle-outline" size={16} color={t.colors.text.secondary} /><Text style={{ ...small, color: t.colors.text.primary, fontWeight: '600' }} numberOfLines={1}>{recipientName}</Text>
      </View>}

      {feeOptions && feeOption && <View style={{ marginTop: t.spacing[3], gap: t.spacing[2] }}>
        <Text style={caption}>Network fee</Text>
        <SegmentedTabs<RgbFeeSpeed> scrollable={false} fill value={feeSpeed} onChange={chooseSpeed}
          options={feeOptions.map(o => ({ key: o.speed, label: `${SPEED_LABEL[o.speed]} · ${formatSats(o.feeSat)}` }))} />
        <Text style={small}>{`About ${formatSats(feeOption.feeSat)} at ${feeOption.rate} sat/vB${feeOption.live ? '' : ' (default rate)'}. Slower costs less and takes longer to confirm.`}</Text>
      </View>}

      <View style={{ gap: t.spacing[2], marginTop: t.spacing[3], alignItems: 'center' }}>
        {spend && quote && <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Ionicons name="time-outline" size={14} color={expired ? t.colors.warning[500] : t.colors.text.secondary} />
          <Text accessibilityLiveRegion="polite" style={{ ...muted, fontSize: t.typography.fontSize.sm, color: expired ? t.colors.warning[500] : t.colors.text.secondary }}>
            {expired ? 'Quote expired. Refresh before paying.' : `Total ${total} · quote valid ${Math.max(0, Math.ceil((quote.expiresAt * 1000 - now) / 1000))}s`}
          </Text>
        </View>}
        {!!selected?.unavailable && <Text accessibilityRole="alert" style={{ ...muted, color: t.colors.warning[500], textAlign: 'center' }}>{selected.unavailable}</Text>}
        {!!previousTotal && reviewUpdated && <Text accessibilityRole="alert" style={{ ...muted, textAlign: 'center' }}>Previous total: {previousTotal}. Review the updated quote before paying.</Text>}
        {!busy && preview.plan.status === 'ready' && !offers.some(o => o.quote) && <Text style={{ ...muted, textAlign: 'center' }}>No way to pay this right now. Check your balances and connected accounts, then refresh.</Text>}
        {selected && !selected.executable && <Text style={{ ...muted, textAlign: 'center' }}>This account can quote but cannot pay yet.</Text>}
        {busy && <ActivityIndicator color={t.colors.primary[500]} />}
        {!busy && moreQuotes && <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing[2] }}>
          <ActivityIndicator size="small" color={t.colors.text.tertiary} />
          <Text style={small}>Checking other ways to pay…</Text>
        </View>}
      </View>
    </>;
  };

  const shareReceipt = (a: PaymentAttempt) => {
    void Share.share({ message: [`Paid ${a.recipient}${preview ? ` to ${recipientName}` : ''}`, `Total ${a.total}`, `From ${a.provider}`, a.reference && `Reference ${a.reference}`].filter(Boolean).join('\n') });
  };

  const renderResult = (a: PaymentAttempt) => {
    const done = a.status === 'completed';
    const failed = a.status === 'failed';
    const tone = done ? t.colors.primary[500] : failed ? t.colors.error[500] : t.colors.warning[500];
    const title = done ? 'Payment completed' : failed ? 'Payment failed' : busy ? 'Sending payment' : a.status === 'unknown' ? 'Payment needs checking' : 'Payment in progress';
    return <View style={{ gap: t.spacing[4] }}>
      <View style={{ alignItems: 'center', gap: t.spacing[2], paddingTop: t.spacing[6] }}>
        <Animated.View entering={ZoomIn.springify().damping(motion.springSnappy.damping)}
          style={{ width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center', backgroundColor: tone + '26' }}>
          {busy ? <ActivityIndicator color={tone} /> : <Ionicons name={done ? 'checkmark' : failed ? 'close' : 'time-outline'} size={40} color={tone} />}
        </Animated.View>
        <Text accessibilityRole="header" style={{ ...muted }}>{title}</Text>
        <AmountText style={{ ...text, fontSize: t.typography.fontSize['3xl'], fontWeight: '700' }}>{a.recipient}</AmountText>
        {!!preview && <Text style={muted}>{done ? 'sent to' : 'to'} {recipientName}</Text>}
      </View>
      {KALEIDOPAY_DEMO && done && <Text style={{ ...muted, color: t.colors.warning[500], textAlign: 'center' }}>Simulated in this demo build. No funds moved.</Text>}
      <View style={card}>
        {row('Total', a.total)}{row('Paid with', a.provider)}
        {!!a.reference && <Text selectable style={{ ...small, color: t.colors.text.secondary }}>Reference: {a.reference}</Text>}
      </View>
      <Text style={{ ...muted, textAlign: 'center' }}>{unresolvedAttempt(a) ? 'Your payment is still being checked. You can leave and come back to check its status. Do not send it again.' : failed ? 'This payment was not sent, or the provider confirmed it failed. Review a new quote before trying again.' : 'Your payment is complete.'}</Text>
      {unresolvedAttempt(a) ? <>
        <Button title="Check status" onPress={() => void checkStatus()} loading={busy} disabled={busy} />
        {a.status === 'unknown' && !busy && <Button title="Start a new payment" variant="secondary" onPress={startNewPayment} />}
      </> : <>
        {done && <View style={{ flexDirection: 'row', gap: t.spacing[3] }}>
          <Button title="View in Activity" variant="secondary" onPress={() => navigation.navigate('Dashboard', { screen: 'Activity' })} style={{ flex: 1 }} />
          <Button title="Share receipt" variant="secondary" onPress={() => shareReceipt(a)} style={{ flex: 1 }} />
        </View>}
        <Button title={failed ? 'Review a new quote' : 'Done'} onPress={() => { if (done) navigation.goBack(); else { setAttempt(null); if (preview) void getOffers(true); } }} />
      </>}
    </View>;
  };

  const payLabel = total ? `Pay ${total}` : 'Pay';

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.colors.background.primary }} edges={['left', 'right', 'bottom']}>
      <ScreenHeader title={headerTitle} onBack={onBack} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {crossChain && !attempt && !preview ? (
          <CrossChainSendPanel key={crossChain.normalized} address={crossChain.normalized} family={crossChain.family} walletId={walletId} bitcoinUnit={bitcoinUnit}
            header={renderField()} onOpenAddress={a => { setInput(a); setContactName(undefined); }} onDone={() => navigation.goBack()} />
        ) : <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: t.spacing[5] }}>
          {KALEIDOPAY_DEMO && <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing[2], padding: t.spacing[3], borderRadius: t.borderRadius.lg, backgroundColor: t.colors.warning[500] + '22', marginBottom: t.spacing[4] }}>
            <Ionicons name="flask-outline" size={16} color={t.colors.warning[500]} />
            <Text style={{ ...muted, color: t.colors.warning[500], flex: 1, fontSize: t.typography.fontSize.sm }}>Demo build: quotes are live, the payment step is simulated. No funds move.</Text>
          </View>}
          {!!error && <View accessibilityRole="alert" style={{ flexDirection: 'row', gap: t.spacing[2], alignItems: 'flex-start', marginBottom: t.spacing[4] }}>
            <Ionicons name="alert-circle-outline" size={18} color={t.colors.warning[500]} />
            <Text style={{ ...text, color: t.colors.warning[500], flex: 1 }}>{error}</Text>
          </View>}
          {journalUnreadable && !attempt && <Button title="Start a new payment" variant="secondary" onPress={startNewPayment} style={{ marginBottom: t.spacing[4] }} />}
          {attempt ? renderResult(attempt) : preview ? renderReview() : renderInput()}
        </ScrollView>}
        {!crossChain && !attempt && <View style={{ padding: t.spacing[5], gap: t.spacing[3], backgroundColor: t.colors.background.primary }}>
          {!preview
            ? <Button title={busy ? 'Getting quotes…' : 'Continue'} disabled={!target || busy || !journalReady} onPress={review} />
            : !quote || quote.expiresAt * 1000 <= Date.now() || selected?.unavailable
              ? <Button title={busy ? 'Getting quotes…' : 'Refresh quotes'} disabled={busy} onPress={() => void getOffers(true)} />
              : reviewUpdated
                ? <Button title="Review updated quote" disabled={busy} onPress={() => setReviewUpdated(false)} />
                : <SlideToConfirm label={payLabel} loading={busy} disabled={!selected?.executable || !walletId || !journalReady} onConfirm={() => void pay()} />}
          {preview && !walletId && <Text style={{ ...muted, textAlign: 'center' }}>Set up a wallet to pay.</Text>}
        </View>}
      </KeyboardAvoidingView>
      <ProviderSheet visible={showProviders} options={options} selectedId={selectedId} onSelect={id => { setSelectedId(id); setReviewUpdated(false); setPreviousTotal(''); }}
        onClose={() => setShowProviders(false)} now={now} title="Ways to pay" intro="Same payment, every account that can pay it. Totals include every fee." />
      <AmountEditorModal visible={showAmountEditor} onClose={() => { continueAfterAmount.current = false; setShowAmountEditor(false); }} initialSats={amountSat} rates={rates} bitcoinUnit={bitcoinUnit}
        onConfirm={sats => { continueNow.current = continueAfterAmount.current && sats > 0; setAmountSat(sats > 0 ? sats : undefined); setShowAmountEditor(false); }} />
      <NostrContactsSelector visible={showContacts} onClose={() => setShowContacts(false)}
        onSelectContact={c => { setShowContacts(false); const dest = c.lightning_address || c.node_pubkey; if (dest) { setInput(dest); setContactName(c.name); } }} />
    </SafeAreaView>
  );
}
