import { rgbAmountUnits } from '../utils/rgb-amount';
import { paymentPollingRemaining, awaitingOnchainConfirmation, paymentPresentation } from '../utils/payment-presentation';
import { checkOnchainConfirmation } from '../services/kaleidoPay/onchainConfirmation';
import { PaymentOutcome } from '../components/payments/PaymentOutcome';
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
import Animated, { FadeInDown } from 'react-native-reanimated';
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
import { contactKeyFor, recordContactEvent, removeContactEvent, updateContactEventStatus } from '../services/contactHistory';
import { confirmRemovePayment } from '../components/payments/confirmRemovePayment';
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
  bestOffer, executePaymentOffer, checkPaymentStatus, paymentAccountNetwork, PaymentNotSentError,
} from '../services/kaleidoPay';
import type { PayTarget, Preview, PaymentOffer, RequestAsset } from '../services/kaleidoPay';
import { usePayAccounts, inspectRgbRequest, prepareRgbRequest, prepareSparkTokenRequest, sendableSparkTokens } from '../services/kaleidoPay/connect';
import type { SparkToken } from '../services/kaleidoPay/sparkPay';
import type { RgbRequestAsset } from '../services/kaleidoPay/connect';
import { rgbL1FeeOptions, setRgbL1FeeSpeed, type RgbFeeSpeed } from '../services/kaleidoPay/rgbL1Pay';
import { SegmentedTabs } from '../components/SegmentedTabs';
import { loadPaymentAttempt, beginPaymentAttempt, savePaymentAttempt, updatePaymentAttempt, unresolvedAttempt, dismissPaymentAttempt } from '../services/kaleidoPay/attempts';
import type { PaymentAttempt } from '../services/kaleidoPay/attempts';
import { ActionableError } from '../components/ActionableError';

interface Props { navigation: any; route: any }

// Re-checks of an unresolved payment: quick at first, then every 15 s, for at most 10 minutes.
const STATUS_POLL_DELAYS_MS = [3_000, 5_000, 10_000, 15_000];
const STATUS_POLL_LIMIT_MS = 10 * 60_000;
// A reviewed total is re-priced on its own shortly before it expires, a few times at most
// (then Refresh takes over), so the slider stays usable while the screen is open.
const AUTO_REFRESH_LEAD_MS = 10_000;
const AUTO_REFRESH_LIMIT = 5;

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
    // Adapters expose spendable funds as confirmed; total includes locked/pending funds.
    for (const k of ['SPARK', 'ARKADE', 'BARK', 'RGB'] as PayAccountId[]) { const b = byProtocol?.[k]; if (b) out[k] = b.confirmed; }
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
  const [rgbChoices, setRgbChoices] = useState<RgbRequestAsset[]>([]);
  const [rgbReading, setRgbReading] = useState(false);
  const [rgbBitcoin, setRgbBitcoin] = useState<number>();
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
  const [receiptExpanded, setReceiptExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  // The total the user last saw for the selected way to pay: a higher one needs another review.
  const [accepted, setAccepted] = useState<{ id: string; asset?: string; total: number; label: string } | null>(null);
  const [attempt, setAttempt] = useState<PaymentAttempt | null>(null);
  const [statusTimedOut, setStatusTimedOut] = useState(false);
  const [statusChecking, setStatusChecking] = useState(false);
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
    if (Number.isSafeInteger(p.prefilledAmountSat) && p.prefilledAmountSat > 0) {
      setAmountSat(p.prefilledAmountSat);
    } else if (p.prefilledAmount) {
      const n = Number(p.prefilledAmount);
      if (Number.isFinite(n) && n > 0) setAmountSat(bitcoinUnit === 'BTC' ? Math.round(n * 1e8) : Math.round(n));
    }
  }, [route.params]);

  // Anything that changes the request discards the reviewed quotes.
  useEffect(() => {
    revision.current++;
    setPreview(null); setOffers([]); setSelectedId(undefined); setError(''); setBusy(false); setAccepted(null);
  }, [input, amountSat, assetAmount, sparkToken, rgbAsset?.id]);
  useEffect(() => { setRgbAsset(null); setAssetAmount(''); setSparkToken(null); }, [input]);
  useEffect(() => {
    let active = true;
    setRgbChoices([]); setRgbBitcoin(undefined);
    if (target?.kind !== 'rgb') { setRgbReading(false); return; }
    setRgbReading(true);
    void inspectRgbRequest(target.rgbInvoice!).then(result => {
      if (active) { setRgbAsset(result.asset); setRgbChoices(result.choices); setRgbBitcoin(result.bitcoinAvailable); if (!result.asset && !result.choices.length) setError('No spendable RGB assets in the connected wallet.'); }
    }).catch(e => { if (active) setError(e.message); }).finally(() => { if (active) setRgbReading(false); });
    return () => { active = false; };
  }, [input]);
  // Start the slow setup (wallet syncs, server keys) as soon as Send opens, not on Continue.
  useEffect(() => { void prepareKaleidoPay(); }, []);
  // Each visit starts at the Normal fee speed.
  useEffect(() => { setRgbL1FeeSpeed('normal'); return () => setRgbL1FeeSpeed('normal'); }, []);

  // Only reopen an existing receipt when explicitly selected from Activity.
  useEffect(() => {
    let active = true;
    setJournalReady(false); setJournalUnreadable(false); setAttempt(null);
    if (!walletId) { setJournalReady(true); return; }
    loadPaymentAttempt(walletId, route.params?.paymentAttemptId)
      .then(saved => { if (active) { if (route.params?.resumePayment && saved) setAttempt(saved); setJournalReady(true); } })
      .catch(() => { if (active) { setJournalUnreadable(true); setError('Could not read your previous payment record. Check your wallet activity before paying again.'); } });
    return () => { active = false; revision.current++; };
  }, [walletId, route.params?.resumePayment, route.params?.paymentAttemptId]);
  useEffect(() => () => { revision.current++; }, []);
  // Resume an old cross-chain transfer only when explicitly requested.
  useEffect(() => {
    if (!walletId || !route.params?.resumeCrossChain || route.params?.prefilledAddress || route.params?.address) return;
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
    if (!journalReady || (!unresolvedAttempt(attempt) && !awaitingOnchainConfirmation(attempt))) return;
    let active = true;
    const remaining = paymentPollingRemaining(attempt!.createdAt, Date.now(), STATUS_POLL_LIMIT_MS);
    setStatusTimedOut(remaining === 0);
    if (remaining === 0) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const until = Date.now() + remaining;
    const deadlineTimer = setTimeout(() => {
      if (active) { active = false; clearTimeout(timer); setStatusTimedOut(true); }
    }, remaining);
    const poll = async (round: number) => {
      await checkStatusRef.current(round > 0);
      if (!active) return;
      if (Date.now() >= until) { setStatusTimedOut(true); return; }
      timer = setTimeout(() => void poll(round + 1), STATUS_POLL_DELAYS_MS[Math.min(round, STATUS_POLL_DELAYS_MS.length - 1)]);
    };
    void prepareKaleidoPay().then(() => { if (active) void poll(0); }).catch(() => { if (active) void poll(0); });
    return () => { active = false; clearTimeout(timer); clearTimeout(deadlineTimer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt?.id, attempt?.status, attempt?.dismissedAt, attempt?.onchainConfirmed, journalReady]);

  const selected = offers.find(o => o.id === selectedId);
  const quote = selected?.quote;
  const spend = quote ? quoteSpend(quote) : null;
  const total = spend ? displaySpend(spend.total, spend.asset) : '';
  const expired = !!quote && quote.expiresAt * 1000 <= now;
  const totalRose = !!(selected && spend && accepted && accepted.id === selected.id && (accepted.asset !== spend.asset.id || spend.total > accepted.total));

  // The offers this screen shows: hidden accounts (Bark in Lite) are never picked for the user.
  const visibleOffers = useCallback((list: PaymentOffer[]) => {
    const ids = new Set(groupOffersByAccount(list, { advanced, balances: balancesSat }).flatMap(c => c.offers.map(o => o.id)));
    return list.filter(o => ids.has(o.id) || !offerAccount(o));
  }, [advanced, balancesSat]);

  const acceptOffer = (o?: PaymentOffer) => {
    if (!o?.quote) return;
    const s = quoteSpend(o.quote);
    setAccepted({ id: o.id, asset: s.asset.id, total: s.total, label: displaySpend(s.total, s.asset) });
  };
  const acceptRef = useRef(acceptOffer);
  acceptRef.current = acceptOffer;
  const selectedIdRef = useRef<string | undefined>(undefined);
  selectedIdRef.current = selectedId;
  const autoRefreshes = useRef(0);

  // `quiet`: re-quoted because the user changed the fee speed, so the new total needs no second review.
  // `background`: the automatic re-price before expiry; it neither blocks the screen nor reports failures.
  const getOffers = useCallback(async (refresh = false, quiet = false, background = false) => {
    const current = ++revision.current;
    if (!background) { setBusy(true); setError(''); setMoreQuotes(false); autoRefreshes.current = 0; }
    try {
      await prepareKaleidoPay();
      if (current !== revision.current) return;
      let asset: RequestAsset | undefined;
      if (target?.kind === 'rgb') {
        // The RGB node reads the invoice's asset (and amount, when it has one).
        const decoded = await prepareRgbRequest(target.rgbInvoice!, undefined, rgbAsset?.id);
        if (current !== revision.current) return;
        if (!rgbAsset) setRgbAsset(decoded);
        const units = rgbAmountUnits(assetAmount, decoded.precision);
        if (!decoded.amount && units === undefined) { setError(`Enter how much ${decoded.ticker} to send.`); return; }
        if (rgbAsset?.available !== undefined && (decoded.amount ?? units!) > rgbAsset.available) { setError(`Not enough ${decoded.ticker}. Available: ${formatSpend(rgbAsset.available, rgbAsset)}.`); return; }
        asset = { id: decoded.id, ticker: decoded.ticker, precision: decoded.precision, amount: decoded.amount ?? units! };
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
      if (current !== revision.current || (background && (paying.current || attemptRef.current))) return;
      if (fresh.plan.status !== 'ready') { setPreview(fresh); setOffers([]); setError(fresh.plan.reason); return; }
      // Show quotes as they arrive: the first payable one ends the wait, slower providers fill in after.
      let picked = refresh;
      let chosenAgain = !quiet;
      const show = (list: PaymentOffer[], done: boolean) => {
        // A payment started meanwhile keeps the offer it was started with.
        if (current !== revision.current || (background && (paying.current || attemptRef.current))) return;
        setPreview(fresh); setOffers(list);
        const shown = visibleOffers(list);
        const best = bestOffer(shown.filter(o => o.executable)) ?? shown.find(o => o.executable && o.quote && !o.unavailable);
        // Pick once, the first time something payable shows (or at the end); later quotes never move the selection.
        if (!picked && (best || done)) { picked = true; const first = best ?? bestOffer(shown); setSelectedId(first?.id); acceptRef.current(first); }
        // A fee speed the user picked is its own review of the new total.
        if (!chosenAgain) { const same = list.find(o => o.id === selectedIdRef.current); if (same?.quote) { chosenAgain = true; acceptRef.current(same); } }
        if (best || done) setBusy(false);
        if (!background) setMoreQuotes(!done);
      };
      const result = await quotePaymentOffers(fresh, partial => show(partial, false));
      // Refresh never switches the chosen way to pay, even when its quote fails.
      show(result, true);
    } catch (e) {
      if (current === revision.current && !background) setError(e instanceof Error ? e.message : 'Could not check the fees. Please try again.');
    } finally { if (current === revision.current && !background) { setBusy(false); setMoreQuotes(false); } }
  }, [input, fixedSat, amountSat, assetAmount, rgbAsset, sparkToken, target, visibleOffers]);

  // Re-price the selected way to pay before it expires (at once when the app comes back
  // after expiry). An equal or lower total keeps the slider; a higher one asks for a review.
  useEffect(() => {
    if (!quote || !preview || attempt || busy || autoRefreshes.current >= AUTO_REFRESH_LIMIT) return;
    const remaining = quote.expiresAt * 1000 - Date.now();
    const wait = remaining > 2 * AUTO_REFRESH_LEAD_MS ? remaining - AUTO_REFRESH_LEAD_MS : Math.max(0, remaining);
    const timer = setTimeout(() => {
      if (paying.current) return;
      autoRefreshes.current++;
      void getOffers(true, false, true);
    }, wait);
    return () => clearTimeout(timer);
  }, [quote, preview, attempt, busy, expired, getOffers]);

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
    const next: PaymentAttempt = { destinationRail: selected.route.to, network: paymentAccountNetwork(selected.route.sourceId) ?? preview.request.network, recipientName, feeDisplay: spend ? (selected.route.sourceId === 'rgb-asset' ? `~${selected.quote?.feeSat ?? 0} sats (BTC)` : displaySpend(spend.fee, spend.asset)) : undefined, accountName: selected.accountName || selected.provider, id: Crypto.randomUUID(), sourceId: selected.route.sourceId, provider: selected.provider, total, recipient, createdAt: Date.now(), status: 'pending' };
    try {
      await beginPaymentAttempt(walletId, next); // No send unless the recovery record is durable.
    } catch {
      setError('Could not start a new payment. Reopen Send to check your previous payment.');
      setJournalReady(false); paying.current = false; setBusy(false); return;
    }
    setAttempt(next);
    // A payment to a picked contact goes into that contact's history too.
    const toContact = contactName && input.trim() ? { contactKey: contactKeyFor(input), contactName } : null;
    const logForContact = (status: PaymentAttempt['status'], reference?: string) => {
      if (!toContact) return;
      void recordContactEvent(walletId, { id: next.id, ...toContact, direction: 'sent', amount: recipient, status, createdAt: next.createdAt, attemptId: next.id, reference }).catch(() => {});
    };
    logForContact('pending');
    try {
      const result = await executePaymentOffer(preview, selected, next.id);
      const updated = { ...next, ...result };
      setAttempt(updated);
      resultCue(updated.status);
      logForContact(updated.status, updated.reference);
      try { await updatePaymentAttempt(walletId, updated); }
      catch { setError('The payment result could not be saved. Keep this receipt; reopening will check the payment again.'); }
    } catch (e) {
      const updated: PaymentAttempt = { ...next, status: e instanceof PaymentNotSentError ? 'failed' : 'unknown', detail: e instanceof PaymentNotSentError ? `${e.message} Nothing was sent.` : 'Payment status needs checking. Do not send again.' };
      setAttempt(updated);
      resultCue(updated.status);
      logForContact(updated.status, updated.reference);
      setError(e instanceof PaymentNotSentError ? `${e.message} Nothing was sent.` : 'Payment status needs checking. Do not send again.');
      try { await updatePaymentAttempt(walletId, updated); } catch { /* The durable pending record forces a status check on reopen. */ }
    } finally {
      paying.current = false; setBusy(false);
      void dispatch(loadBtcBalance());
    }
  }

  async function readPaymentStatus(sourceId: string, id: string) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        checkPaymentStatus(sourceId, id),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Status check timed out')), 20_000); }),
      ]);
    } finally { clearTimeout(timer); }
  }

  // `quiet`: a background re-check, which neither blocks the screen nor reports its own failure.
  async function checkStatus(quiet = false) {
    if (!attempt || !walletId || paying.current || checking.current) return;
    if (RGB_ONCHAIN_SOURCES.has(attempt.sourceId) && attempt.network && paymentAccountNetwork(attempt.sourceId) !== attempt.network) {
      if (!quiet) setError(`Connect your RGB wallet on ${attempt.network} to verify this payment.`);
      return;
    }
    const lock = quiet ? checking : paying;
    lock.current = true; setStatusChecking(true);
    if (!quiet) { setBusy(true); setError(''); }
    try {
      const providerResult = attempt.status === 'completed' ? attempt : await readPaymentStatus(attempt.sourceId, attempt.id);
      const result = await checkOnchainConfirmation({ ...attempt, ...(attempt.status === 'completed' ? {} : providerResult) });
      // A background result is dropped when nothing changed, or the record changed meanwhile (checked, dismissed).
      if (attemptRef.current !== attempt) return;
      if (!quiet && result.status === 'unknown') setError(result.detail || 'No payment receipt is available yet. Check Activity; do not send again.');
      const updated = { ...attempt, ...result, lastCheckedAt: Date.now(), checkFailed: false };
      if (!await updatePaymentAttempt(walletId, updated)) return;
      if (attemptRef.current !== attempt) return;
      setAttempt(updated);
      if (updated.status !== attempt.status) resultCue(updated.status);
      void updateContactEventStatus(walletId, attempt.id, updated.status, updated.reference).catch(() => {});
      if (result.status === 'completed') void dispatch(loadBtcBalance());
    } catch { if (!quiet) setError('Could not update payment status. Check again before making another payment.'); }
    finally { lock.current = false; setStatusChecking(false); if (!quiet) setBusy(false); }
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
            attemptRef.current = null; setAttempt(null); setJournalUnreadable(false); setError(''); setJournalReady(true);
          } catch { setError('Could not update the payment record. Try again.'); }
        } },
      ],
    );
  }

  // Pending or needing a check: removes the local record only (Activity, the contact's history).
  function removeFromActivity() {
    const current = attempt;
    if (!walletId || !current || paying.current) return;
    confirmRemovePayment(async () => {
      try {
        await dismissPaymentAttempt(walletId, current);
        void removeContactEvent(walletId, current.id).catch(() => {});
        attemptRef.current = null; setAttempt(null); setError(''); setJournalReady(true);
        if (route.params?.resumePayment && navigation.canGoBack?.()) navigation.goBack();
      } catch { setError('Could not update the payment record. Try again.'); }
    });
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
  const recipientName = preview?.code.label || contactName || target?.label || (input.trim().length > 52 ? `${input.trim().slice(0, 18)}…${input.trim().slice(-10)}` : input.trim()) || 'Recipient';
  const feeText = (fee: number, asset: Parameters<typeof displaySpend>[1]) => fee === 0 ? 'No fee' : `+${displaySpend(fee, asset)}`;

  // Pay from: the ways to pay grouped by the account they spend from.
  const choices = groupOffersByAccount(offers, { advanced, balances: balancesSat, now });
  const shownOffers = visibleOffers(offers);
  const best = bestOffer(shownOffers);
  const accountHeading = (o: PaymentOffer) => {
    const account = offerAccount(o);
    if (!account) return 'Other';
    const sats = balancesSat[account];
    const name = o.accountName || PAY_ACCOUNT_NAME[account];
    return sats === undefined ? name : `${name} · ${formatSats(sats)}`;
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
            {[contactName ?? target.label, target.description && `“${target.description}”`, expiresIn !== undefined && `expires in ${expiresIn} min`].filter(Boolean).join(' · ') || (target.kind === 'rgb' ? rgbReading ? 'Reading asset and amount…' : rgbAsset ? `${rgbAsset.ticker} · ${rgbAsset.amount ? formatSpend(rgbAsset.amount, rgbAsset) : 'Enter amount'}` : 'Choose an asset below' : 'Ready to pay')}
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

    {target?.kind === 'rgb' && rgbChoices.length > 0 && <View style={{ gap: t.spacing[2], marginTop: t.spacing[3] }}>
      <Text style={caption}>Pay with</Text>
      {rgbChoices.map(asset => <Button key={asset.id} title={`${asset.ticker}${asset.available === undefined ? '' : ` · ${formatSpend(asset.available, asset)} available`}${rgbAsset?.id === asset.id ? ' ✓' : ''}`} variant={rgbAsset?.id === asset.id ? 'secondary' : 'ghost'} onPress={() => { setRgbAsset(asset); setAssetAmount(''); }} />)}
    </View>}
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
    </View> : target?.kind === 'rgb' ? (rgbAsset ? <View style={[card, { marginTop: t.spacing[4], gap: t.spacing[3] }]}>
      <Text style={caption}>Asset to send · {rgbAsset.ticker}</Text>
      <Text style={text}>{rgbAsset.available === undefined ? 'Available balance could not be loaded' : `Available: ${formatSpend(rgbAsset.available, rgbAsset)}`}</Text>
      {rgbBitcoin !== undefined && <Text style={small}>Bitcoin available for fees: {formatSats(rgbBitcoin)}</Text>}
      <Text style={text}>Amount in {rgbAsset.ticker}</Text>
      {rgbAsset.amount ? <>
        <AmountText style={{ ...text, fontSize: t.typography.fontSize['3xl'] }}>{formatSpend(rgbAsset.amount, rgbAsset)}</AmountText>
        <Text style={small}>Amount set by the invoice</Text>
      </> : <>
        <TextInput accessibilityLabel={`Amount in ${rgbAsset.ticker}`} keyboardType="decimal-pad" value={assetAmount} onChangeText={setAssetAmount}
          placeholder="0" placeholderTextColor={t.colors.text.muted} style={{ ...text, fontSize: t.typography.fontSize['3xl'], paddingVertical: t.spacing[3], borderBottomWidth: 1, borderColor: t.colors.primary[500] }} />
        {rgbAsset.available !== undefined && <Button title={`Use available ${rgbAsset.ticker}`} variant="ghost" onPress={() => setAssetAmount((rgbAsset.available! / 10 ** rgbAsset.precision).toFixed(rgbAsset.precision))} />}
        <Text style={small}>Enter the amount to send. Bitcoin is needed separately for network fees.</Text>
      </>}
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
    if (preview.code.kind === 'rgb') return <View style={{ gap: t.spacing[4] }}>
      <Text style={caption}>Review RGB transfer</Text>
      <AmountText style={{ ...text, fontSize: t.typography.fontSize['3xl'], fontWeight: '700' }}>{amountLabel}</AmountText>
      <Text style={muted} numberOfLines={2}>To {recipientName}</Text>
      <View style={[card, { gap: t.spacing[3] }]}>
        <Text style={text}>{selected?.accountName || 'RGB wallet'} · {selected ? paymentAccountNetwork(selected.route.sourceId) ?? preview.request.network : preview.request.network}</Text>
        <Text style={text}>{rgbAsset?.available === undefined ? 'Available balance could not be loaded' : `Available: ${formatSpend(rgbAsset.available, rgbAsset)}`}</Text>
        {rgbBitcoin !== undefined && <Text style={text}>Bitcoin available for fees: {formatSats(rgbBitcoin)}</Text>}
        <Text style={text}>Bitcoin network fee: {quote ? `approximately ${quote.feeSat} sats` : 'Not available'}</Text>
        <Text style={small}>The recipient receives {amountLabel}. The network fee is paid separately in bitcoin.</Text>
      </View>
      {feeOptions && <SegmentedTabs<RgbFeeSpeed> scrollable={false} fill value={feeSpeed} onChange={chooseSpeed}
        options={feeOptions.map(o => ({ key: o.speed, label: `${SPEED_LABEL[o.speed]} · ${formatSats(o.feeSat)}` }))} />}
      {offers.filter(o => o.unavailable).map(o => <Text key={o.id} accessibilityRole="alert" style={{ ...text, color: t.colors.warning[500] }}>{o.unavailable}</Text>)}
      {expired && <Text style={muted}>Refresh the transfer details before sending.</Text>}
      {busy && <ActivityIndicator color={t.colors.primary[500]} />}
      <Button title="Edit amount or invoice" variant="secondary" onPress={resetToInput} />
    </View>;
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
        {options.length > 1 && <TouchableOpacity accessibilityRole="button" accessibilityLabel="Change account" onPress={() => setShowProviders(true)} hitSlop={8}>
          <Text style={{ ...small, color: t.colors.primary[500], fontWeight: '600' }}>Change account ›</Text>
        </TouchableOpacity>}
      </View>

      <View style={{ gap: t.spacing[2] }}>
        {choices.filter(c => c.account === selectedAccount).map((c, i) => {
          const active = c.account === selectedAccount;
          const shown = active && selected ? selected : c.best;
          const s = shown?.quote ? quoteSpend(shown.quote) : null;
          const blocked = !c.best;
          return (
            <Animated.View key={c.account} entering={FadeInDown.delay(i * motion.stagger).duration(motion.duration.base)}>
              <PressableScale scaleTo={0.98} disabled={blocked} onPress={() => { if (c.best && !active) { feedback.select(); setSelectedId(c.best.id); acceptOffer(c.best); } }}
                accessibilityRole="radio" accessibilityState={{ checked: active, disabled: blocked }}
                accessibilityLabel={`Pay from ${PAY_ACCOUNT_NAME[c.account]}${balancesSat[c.account] !== undefined ? `, balance ${formatSats(balancesSat[c.account]!)}` : ''}. ${blocked ? c.reason : s ? `Total ${displaySpend(s.total, s.asset)}` : ''}`}
                style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing[3], padding: t.spacing[3], borderRadius: t.borderRadius.lg, borderWidth: 1.5,
                  borderColor: active ? t.colors.primary[500] : t.colors.border.light, backgroundColor: active ? t.colors.primary[50] : t.colors.surface.primary, opacity: blocked ? 0.5 : 1 }}>
                {iconChip(c.account.toLowerCase(), 36)}
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={{ ...text, fontWeight: '600' }}>{c.best?.accountName || PAY_ACCOUNT_NAME[c.account]}</Text>
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

      {advanced && selected && selectedAccount && <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', gap: t.spacing[2], marginTop: t.spacing[3], padding: t.spacing[3], borderRadius: t.borderRadius.lg, borderWidth: 1, borderColor: t.colors.border.light }}>
        <NetworkIcon network={selectedAccount.toLowerCase()} size={16} /><Text style={{ ...small, color: t.colors.text.primary, fontWeight: '600' }}>{selected?.accountName || PAY_ACCOUNT_NAME[selectedAccount]}</Text>
        <Ionicons name="arrow-forward" size={12} color={t.colors.text.tertiary} />
        {via && <><Ionicons name="swap-horizontal" size={15} color={t.colors.text.secondary} /><Text style={{ ...small, color: t.colors.text.primary, fontWeight: '600' }}>{selected.provider}</Text>
          <Ionicons name="arrow-forward" size={12} color={t.colors.text.tertiary} /></>}
        <NetworkIcon network={railIcon(selected.route.to)} size={16} /><Text style={{ ...small, color: t.colors.text.primary, fontWeight: '600' }}>{railLabel(selected.route.to)}</Text>
        <Ionicons name="arrow-forward" size={12} color={t.colors.text.tertiary} />
        <Ionicons name="person-circle-outline" size={16} color={t.colors.text.secondary} /><Text style={{ ...small, color: t.colors.text.primary, fontWeight: '600' }} numberOfLines={1}>{recipientName}</Text>
      </View>}

      {spend && <View style={{ marginTop: t.spacing[3], gap: t.spacing[2], padding: t.spacing[4], backgroundColor: t.colors.surface.primary, borderRadius: t.borderRadius.lg }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Text style={muted}>Fee</Text><AmountText style={text}>{displaySpend(spend.fee, spend.asset)}</AmountText></View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Text style={text}>Total you pay</Text><AmountText style={{ ...text, fontWeight: '700' }}>{total}</AmountText></View>
      </View>}

      {feeOptions && feeOption && <View style={{ marginTop: t.spacing[3], gap: t.spacing[2] }}>
        <Text style={caption}>Network fee</Text>
        <SegmentedTabs<RgbFeeSpeed> scrollable={false} fill value={feeSpeed} onChange={chooseSpeed}
          options={feeOptions.map(o => ({ key: o.speed, label: `${SPEED_LABEL[o.speed]} · ${formatSats(o.feeSat)}` }))} />
        <Text style={small}>{`About ${formatSats(feeOption.feeSat)} at ${feeOption.rate} sat/vB${feeOption.live ? '' : ' (default rate)'}. Slower costs less and takes longer to confirm.`}</Text>
      </View>}

      <View style={{ gap: t.spacing[2], marginTop: t.spacing[3], alignItems: 'center' }}>
        {/* Only a swap holds a market price; a direct payment's fee is re-checked on its own, so it shows no timer. */}
        {spend && quote && (expired || via) && <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Ionicons name="time-outline" size={14} color={expired ? t.colors.warning[500] : t.colors.text.secondary} />
          <Text accessibilityLiveRegion="polite" style={{ ...muted, fontSize: t.typography.fontSize.sm, color: expired ? t.colors.warning[500] : t.colors.text.secondary }}>
            {expired ? 'This price expired. Refresh to see the current total.' : `Swap price held for ${Math.max(0, Math.ceil((quote.expiresAt * 1000 - now) / 1000))}s`}
          </Text>
        </View>}
        {!!selected?.unavailable && <Text accessibilityRole="alert" style={{ ...muted, color: t.colors.warning[500], textAlign: 'center' }}>{selected.unavailable}</Text>}
        {totalRose && <Text accessibilityRole="alert" style={{ ...muted, textAlign: 'center' }}>The total went up from {accepted!.label} to {total}. Check it before paying.</Text>}
        {!busy && preview.plan.status === 'ready' && !offers.some(o => o.quote) && <Text style={{ ...muted, textAlign: 'center' }}>No way to pay this right now. Check your balances and connected accounts, then refresh.</Text>}
        {selected && !selected.executable && <Text style={{ ...muted, textAlign: 'center' }}>This account can't pay this yet. Choose another account.</Text>}
        {busy && <ActivityIndicator color={t.colors.primary[500]} />}
        {!busy && moreQuotes && <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing[2] }}>
          <ActivityIndicator size="small" color={t.colors.text.tertiary} />
          <Text style={small}>Checking other ways to pay…</Text>
        </View>}
      </View>
    </>;
  };

  const shareReceipt = (a: PaymentAttempt) => {
    void Share.share({ message: [paymentPresentation(a).title, paymentPresentation(a).detail, `Amount ${a.recipient}`, `Recipient ${a.recipientName || 'Not recorded'}`, `Quoted fees ${a.feeDisplay ?? 'Not recorded'}`, `Quoted total ${a.total}`, `From ${a.accountName || a.provider}`, `Requested ${new Date(a.createdAt).toLocaleString()}`, a.reference && `Reference ${a.reference}`].filter(Boolean).join('\n') });
  };

  const renderResult = (a: PaymentAttempt) => {
    const done = a.status === 'completed';
    const chainWaiting = awaitingOnchainConfirmation(a);
    const failed = a.status === 'failed';
    return <View style={{ gap: t.spacing[4] }}>
      <PaymentOutcome attempt={a} busy={busy} statusChecking={statusChecking} statusTimedOut={statusTimedOut} error={error} demo={KALEIDOPAY_DEMO} expanded={receiptExpanded} onExpandedChange={setReceiptExpanded} />
      {(unresolvedAttempt(a) || chainWaiting) && !busy && !statusChecking && <Button
        title={chainWaiting ? 'Check confirmation' : 'Verify payment'} variant="secondary"
        onPress={() => void checkStatus()} />}
      {unresolvedAttempt(a) && !busy && <Button title="Remove from Activity" variant="ghost" onPress={removeFromActivity} />}
      {done && receiptExpanded && <Button title="Share receipt" variant="ghost" onPress={() => shareReceipt(a)} />}
      {failed ? <Button title={a.sourceId === 'rgb-asset' ? 'Review transfer' : 'Review again'}
        onPress={() => { setAttempt(null); if (preview) void getOffers(true); }} />
        : <Button title="Done" onPress={() => navigation.goBack()} />}

    </View>;
  };

  const payLabel = total ? `${target?.kind === 'rgb' ? 'Send' : 'Pay'} ${total}` : 'Pay';

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
            <Text style={{ ...muted, color: t.colors.warning[500], flex: 1, fontSize: t.typography.fontSize.sm }}>Demo build: fees are live, the payment step is simulated. No funds move.</Text>
          </View>}
          {!!error && !attempt && <ActionableError message={error} context="send" />}
          {journalUnreadable && !attempt && <Button title="Start a new payment" variant="secondary" onPress={startNewPayment} style={{ marginBottom: t.spacing[4] }} />}
          {attempt ? renderResult(attempt) : preview ? renderReview() : renderInput()}
        </ScrollView>}
        {!crossChain && !attempt && <View style={{ padding: t.spacing[5], gap: t.spacing[3], backgroundColor: t.colors.background.primary }}>
          {!preview
            ? <Button title={busy ? (target?.kind === 'rgb' ? 'Checking transfer…' : 'Checking fees…') : (target?.kind === 'rgb' ? 'Review transfer' : 'Continue')} disabled={!target || busy || !journalReady || rgbReading || (target?.kind === 'rgb' && !rgbAsset)} onPress={review} />
            : !quote || quote.expiresAt * 1000 <= Date.now() || selected?.unavailable
              ? <Button title={busy ? (target?.kind === 'rgb' ? 'Checking transfer…' : 'Checking fees…') : (target?.kind === 'rgb' ? 'Refresh transfer' : 'Refresh')} disabled={busy} onPress={() => void getOffers(true)} />
              : totalRose
                ? <Button title={target?.kind === 'rgb' ? 'Accept new transfer total' : 'Accept new total'} disabled={busy} onPress={() => acceptOffer(selected)} />
                : <SlideToConfirm label={payLabel} loading={busy} disabled={!selected?.executable || !walletId || !journalReady} onConfirm={() => void pay()} />}
          {preview && !walletId && <Text style={{ ...muted, textAlign: 'center' }}>Set up a wallet to pay.</Text>}
        </View>}
      </KeyboardAvoidingView>
      <ProviderSheet visible={showProviders} options={options} selectedId={selectedId} onSelect={id => { setSelectedId(id); acceptOffer(offers.find(o => o.id === id)); }}
        onClose={() => setShowProviders(false)} now={now} title="Change account" intro="Choose an account for this payment. Available balances and totals include fees." />
      <AmountEditorModal visible={showAmountEditor} onClose={() => { continueAfterAmount.current = false; setShowAmountEditor(false); }} initialSats={amountSat} rates={rates} bitcoinUnit={bitcoinUnit}
        onConfirm={sats => { continueNow.current = continueAfterAmount.current && sats > 0; setAmountSat(sats > 0 ? sats : undefined); setShowAmountEditor(false); }} />
      <NostrContactsSelector visible={showContacts} onClose={() => setShowContacts(false)}
        onSelectContact={c => { setShowContacts(false); const dest = c.lightning_address || c.node_pubkey; if (dest) { setInput(dest); setContactName(c.name); } }} />
    </SafeAreaView>
  );
}
