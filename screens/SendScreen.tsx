// screens/SendScreen.tsx
//
// The one way to pay. Whatever is entered (Lightning invoice or address, BOLT12
// offer, bitcoin address, Spark, Ark or RGB invoice) is decoded into a
// payment request; every connected account then offers its ways to pay it, directly
// or through a swap provider, priced the same way. The user reviews the total and
// pays; the payment journal keeps an unresolved payment from being paid twice.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, View, Text, TextInput, ScrollView, TouchableOpacity, ActivityIndicator, KeyboardAvoidingView, Platform, Clipboard } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Crypto from 'expo-crypto';
import { ScreenHeader } from '../components/ScreenHeader';
import { Button } from '../components/Button';
import { Badge } from '../components/Badge';
import { ProviderSheet } from '../components/payments/ProviderSheet';
import { NetworkIcon } from '../components/NetworkIcon';
import { AmountEditorModal } from '../components/AmountEditorModal';
import NostrContactsSelector from '../components/NostrContactsSelector';
import { useAppTheme } from '../theme/ThemeProvider';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { loadBtcBalance } from '../store/slices/walletSlice';
import { useFiatRates } from '../hooks/useFiatRates';
import { useForegroundClock } from '../hooks/useForegroundClock';
import { formatBitcoinAmount, formatSatoshisToUSD } from '../utils/bitcoinUnits';
import { chainLabel, type ReceiveChain } from '../utils/receive-routes';
import {
  KALEIDOPAY_DEMO, decodeTarget, prepareKaleidoPay, railLabel, previewInput, quotePaymentOffers, quoteSpend, formatSpend,
  bestOffer, executePaymentOffer, checkPaymentStatus, PaymentNotSentError,
} from '../services/kaleidoPay';
import type { PayTarget, Preview, PaymentOffer, RequestAsset } from '../services/kaleidoPay';
import { usePayAccounts, prepareRgbRequest } from '../services/kaleidoPay/connect';
import type { RgbRequestAsset } from '../services/kaleidoPay/connect';
import { loadPaymentAttempt, beginPaymentAttempt, savePaymentAttempt, unresolvedAttempt, dismissPaymentAttempt } from '../services/kaleidoPay/attempts';
import type { PaymentAttempt } from '../services/kaleidoPay/attempts';

interface Props { navigation: any; route: any }

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

  const [input, setInput] = useState<string>(route.params?.prefilledAddress ?? route.params?.address ?? '');
  const [contactName, setContactName] = useState<string | undefined>(route.params?.contactName);
  const [amountSat, setAmountSat] = useState<number | undefined>(undefined);
  const [assetAmount, setAssetAmount] = useState('');
  const [rgbAsset, setRgbAsset] = useState<RgbRequestAsset | null>(null);
  const [showAmountEditor, setShowAmountEditor] = useState(false);
  const [showContacts, setShowContacts] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
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
  const now = useForegroundClock(offers.some(o => !!o.quote) && !attempt);
  const revision = useRef(0);
  const paying = useRef(false);
  const requestId = useRef(Crypto.randomUUID());

  const { target, error: decodeError } = useMemo(() => decodeQuietly(input), [input]);
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
  }, [input, amountSat, assetAmount]);
  useEffect(() => { setRgbAsset(null); setAssetAmount(''); }, [input]);

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

  const selected = offers.find(o => o.id === selectedId);
  const quote = selected?.quote;
  const spend = quote ? quoteSpend(quote) : null;
  const total = spend ? displaySpend(spend.total, spend.asset) : '';
  const expired = !!quote && quote.expiresAt * 1000 <= now;

  const getOffers = useCallback(async (refresh = false) => {
    const current = ++revision.current;
    setBusy(true); setError('');
    if (refresh) setPreviousTotal(total);
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
      }
      const fresh = await previewInput(input, fixedSat ?? amountSat, requestId.current, { asset });
      if (current !== revision.current) return;
      if (fresh.plan.status !== 'ready') { setPreview(fresh); setOffers([]); setError(fresh.plan.reason); return; }
      const result = await quotePaymentOffers(fresh);
      if (current !== revision.current) return;
      setPreview(fresh); setOffers(result);
      if (!refresh) setSelectedId((bestOffer(result.filter(o => o.executable)) ?? result.find(o => o.executable && o.quote && !o.unavailable) ?? bestOffer(result))?.id);
      // Refresh never switches the chosen way to pay, even when its quote fails.
      setReviewUpdated(refresh);
    } catch (e) {
      if (current === revision.current) setError(e instanceof Error ? e.message : 'Could not get quotes. Please try again.');
    } finally { if (current === revision.current) setBusy(false); }
  }, [input, fixedSat, amountSat, assetAmount, rgbAsset, target, total]);

  function review() {
    if (!target) { setError(decodeError ?? 'Paste or scan something to pay.'); return; }
    if (target.kind !== 'rgb' && fixedSat === undefined && !amountSat) { setShowAmountEditor(true); return; }
    void getOffers();
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
    try {
      const result = await executePaymentOffer(preview, selected, next.id);
      const updated = { ...next, ...result };
      setAttempt(updated);
      try { await savePaymentAttempt(walletId, updated); }
      catch { setError('The payment result could not be saved. Keep this receipt; reopening will check the payment again.'); }
    } catch (e) {
      const updated: PaymentAttempt = { ...next, status: e instanceof PaymentNotSentError ? 'failed' : 'unknown' };
      setAttempt(updated);
      setError(e instanceof PaymentNotSentError ? `${e.message} Nothing was sent.` : 'Payment status needs checking. Do not send again.');
      try { await savePaymentAttempt(walletId, updated); } catch { /* The durable pending record forces a status check on reopen. */ }
    } finally {
      paying.current = false; setBusy(false);
      void dispatch(loadBtcBalance());
    }
  }

  async function checkStatus() {
    if (!attempt || !walletId || paying.current) return;
    paying.current = true; setBusy(true); setError('');
    try {
      const result = await checkPaymentStatus(attempt.sourceId, attempt.id);
      const updated = { ...attempt, ...result };
      await savePaymentAttempt(walletId, updated); setAttempt(updated);
      if (result.status === 'completed') void dispatch(loadBtcBalance());
    } catch { setError('Could not update payment status. Check again before making another payment.'); }
    finally { paying.current = false; setBusy(false); }
  }

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

  const resetToInput = () => { revision.current++; setBusy(false); setPreview(null); setOffers([]); };

  // ---- presentation ---------------------------------------------------------
  const text = { color: t.colors.text.primary, fontSize: t.typography.fontSize.base };
  const muted = { ...text, color: t.colors.text.secondary };
  const card = { padding: t.spacing[5], borderRadius: t.borderRadius.xl, backgroundColor: t.colors.surface.primary, gap: t.spacing[3], marginBottom: t.spacing[4] };
  const row = (label: string, value: string) => <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: t.spacing[3] }}><Text style={muted}>{label}</Text><Text style={{ ...text, textAlign: 'right', flexShrink: 1 }}>{value}</Text></View>;
  const railIcon = (r: string) => ({ ln: 'lightning', btc: 'onchain', ark: 'arkade' } as Record<string, string>)[r.split(':')[0]] ?? r.split(':')[0];
  const describe = (o: PaymentOffer) => {
    const chain = o.route.from.split(':')[1];
    const account = [o.accountName, chain && chain !== 'mainnet' ? chainLabel(chain as ReceiveChain) : ''].filter(Boolean).join(' · ');
    return o.route.kind === 'swap'
      ? { icon: 'swap', group: 'Through a provider', subtitle: [`${account} via ${railLabel(o.route.to)}`, o.providerDetail].filter(Boolean).join(' · '), preferred: false }
      : { icon: railIcon(o.route.to), group: 'Direct', subtitle: `${account} · direct`, preferred: !!preview && o.route.to.split(':')[0] === preview.request.acceptedRails[0]?.split(':')[0] };
  };
  const best = bestOffer(offers);
  const feeText = (fee: number, asset: Parameters<typeof displaySpend>[1]) => fee === 0 ? 'No fee' : `${displaySpend(fee, asset)} fee`;
  const options = offers.map(o => {
    const s = o.quote ? quoteSpend(o.quote) : null;
    return { id: o.id, name: o.provider, account: o.accountName, amount: s ? displaySpend(s.total, s.asset) : 'Unavailable', amountLabel: 'Total you pay', detail: s ? `Fees ${displaySpend(s.fee, s.asset)}` : '', unavailable: o.unavailable,
      expiresAt: o.quote ? o.quote.expiresAt * 1000 : undefined, recommended: best?.id === o.id, fee: s ? feeText(s.fee, s.asset) : undefined, ...describe(o) };
  });
  const selectedView = selected ? describe(selected) : null;
  const liveOptions = options.filter(o => !o.unavailable).length;
  const shownSat = fixedSat ?? amountSat;
  const usdOf = (sats: number) => usd ? ` · ≈ $${formatSatoshisToUSD(sats, usd)}` : '';

  const headerTitle = attempt ? 'Payment' : preview ? 'Review Payment' : 'Send';
  const onBack = () => {
    if (paying.current) return;
    if (preview && !attempt) { resetToInput(); return; }
    navigation.goBack();
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.colors.background.primary }} edges={['left', 'right', 'bottom']}>
      <ScreenHeader title={headerTitle} onBack={onBack} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: t.spacing[5] }}>
          {KALEIDOPAY_DEMO && <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing[2], padding: t.spacing[3], borderRadius: t.borderRadius.lg, backgroundColor: t.colors.warning[500] + '22', marginBottom: t.spacing[4] }}>
            <Ionicons name="flask-outline" size={16} color={t.colors.warning[500]} />
            <Text style={{ ...muted, color: t.colors.warning[500], flex: 1, fontSize: t.typography.fontSize.sm }}>Demo build: quotes are live, the payment step is simulated. No funds move.</Text>
          </View>}
          {!!error && <Text accessibilityRole="alert" style={{ ...text, color: t.colors.warning[500], marginBottom: t.spacing[4] }}>{error}</Text>}
          {journalUnreadable && !attempt && <Button title="Start a new payment" variant="secondary" onPress={startNewPayment} style={{ marginBottom: t.spacing[4] }} />}

          {attempt ? <View style={card}>
            <Ionicons name={attempt.status === 'completed' ? 'checkmark-circle-outline' : attempt.status === 'failed' ? 'close-circle-outline' : 'time-outline'} size={48} color={t.colors.primary[500]} />
            <Text style={{ ...text, fontSize: t.typography.fontSize['2xl'], fontWeight: '600' }}>{attempt.status === 'completed' ? 'Payment completed' : attempt.status === 'failed' ? 'Payment failed' : busy ? 'Sending payment' : attempt.status === 'unknown' ? 'Payment needs checking' : 'Payment in progress'}</Text>
            {KALEIDOPAY_DEMO && attempt.status === 'completed' && <Text style={{ ...muted, color: t.colors.warning[500] }}>Simulated in this demo build. No funds moved.</Text>}
            {row('Recipient receives', attempt.recipient)}{row('Total', attempt.total)}{row('Paid with', attempt.provider)}
            {!!attempt.reference && <Text selectable style={muted}>Reference: {attempt.reference}</Text>}
            <Text style={muted}>{unresolvedAttempt(attempt) ? 'Your payment is still being checked. You can leave and come back to check its status. Do not send it again.' : attempt.status === 'failed' ? 'This payment was not sent, or the provider confirmed it failed. Review a new quote before trying again.' : 'Your payment is complete.'}</Text>
            {unresolvedAttempt(attempt) ? <>
              <Button title="Check status" onPress={() => void checkStatus()} loading={busy} disabled={busy} />
              {attempt.status === 'unknown' && !busy && <Button title="Start a new payment" variant="secondary" onPress={startNewPayment} />}
            </> : <Button title={attempt.status === 'failed' ? 'Review a new quote' : 'Done'} onPress={() => { if (attempt.status === 'completed') navigation.goBack(); else { setAttempt(null); if (preview) void getOffers(true); } }} />}
          </View> : !preview ? <>
            <View style={card}>
              <Text style={{ ...text, fontSize: t.typography.fontSize.xl, fontWeight: '600' }}>Who are you paying?</Text>
              {!!contactName && <Text style={muted}>{contactName}</Text>}
              <TextInput accessibilityLabel="Payment request" value={input} onChangeText={v => { setInput(v); setContactName(undefined); }} multiline autoCapitalize="none" autoCorrect={false}
                placeholder="Address, invoice, Lightning address or offer" placeholderTextColor={t.colors.text.muted} style={{ ...text, minHeight: 72, paddingVertical: t.spacing[3] }} />
              {target ? <Text style={muted}>{KIND_LABEL[target.kind]}{target.description ? ` · ${target.description}` : ''}</Text>
                : input.trim() ? <Text style={{ ...muted, color: t.colors.warning[500] }}>{decodeError}</Text> : null}
              <View style={{ flexDirection: 'row', gap: t.spacing[3] }}>
                <Button title="Scan" onPress={() => navigation.navigate('QRScanner')} style={{ flex: 1 }} />
                <Button title="Paste" variant="secondary" onPress={() => void paste()} style={{ flex: 1 }} />
                <Button title="Contacts" variant="secondary" onPress={() => setShowContacts(true)} style={{ flex: 1 }} />
              </View>
            </View>
            {target?.kind === 'rgb' ? (rgbAsset && !rgbAsset.amount ? <View style={card}>
              <Text style={text}>Amount in {rgbAsset.ticker}</Text>
              <TextInput accessibilityLabel={`Amount in ${rgbAsset.ticker}`} keyboardType="decimal-pad" value={assetAmount} onChangeText={setAssetAmount}
                placeholder={`Amount in ${rgbAsset.ticker}`} placeholderTextColor={t.colors.text.muted} style={{ ...text, paddingVertical: t.spacing[3] }} />
            </View> : null) : target ? <TouchableOpacity accessibilityRole="button" accessibilityLabel="Amount" disabled={fixedSat !== undefined}
              onPress={() => setShowAmountEditor(true)} style={card}>
              {row(fixedSat !== undefined ? 'Amount (set by recipient)' : 'Amount', shownSat ? formatSats(shownSat) + usdOf(shownSat) : 'Set amount')}
            </TouchableOpacity> : null}
          </> : <>
            <View style={card}>
              <Text style={muted}>{preview.code.label || contactName || 'Recipient'} receives</Text>
              <Text style={{ ...text, fontSize: t.typography.fontSize['3xl'], fontWeight: '600' }}>
                {preview.request.asset ? formatSpend(preview.request.asset.amount, preview.request.asset) : formatSats(preview.request.amountSat)}
              </Text>
              <Text numberOfLines={1} ellipsizeMode="middle" selectable style={muted}>{KIND_LABEL[preview.code.lnurl ? 'lnurl' : preview.code.kind]} · {preview.code.lnurl ?? preview.code.raw}</Text>
              {!!(preview.code.message || preview.code.description) && <Text style={text}>{preview.code.message || preview.code.description}</Text>}
            </View>
            <View style={card}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={muted}>You pay with</Text>
                {liveOptions > 1 && <TouchableOpacity accessibilityRole="button" onPress={() => setShowProviders(true)} hitSlop={8}><Text style={{ ...muted, color: t.colors.primary[500] }}>Compare {liveOptions} ways ›</Text></TouchableOpacity>}
              </View>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="Choose how to pay" onPress={() => setShowProviders(true)}
                style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing[3], padding: t.spacing[3], borderRadius: t.borderRadius.lg, backgroundColor: t.colors.background.primary }}>
                <View style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: t.colors.surface.primary }}>
                  {!selectedView || selectedView.icon === 'swap' ? <Ionicons name="swap-horizontal" size={20} color={t.colors.text.secondary} /> : <NetworkIcon network={selectedView.icon} size={22} />}
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text numberOfLines={1} style={{ ...text, fontWeight: '600' }}>{selected?.provider ?? 'Choose how to pay'}</Text>
                  {!!selectedView && <Text numberOfLines={1} style={{ ...muted, fontSize: t.typography.fontSize.sm }}>{selectedView.subtitle}</Text>}
                  {!!selected && (selectedView?.preferred || best?.id === selected.id) && <View style={{ flexDirection: 'row', gap: t.spacing[2], marginTop: 4 }}>
                    {selectedView?.preferred && <Badge label="Their choice" tone="primary" size="md" />}
                    {best?.id === selected.id && <Badge label="Best price" tone="success" size="md" />}
                  </View>}
                </View>
                <Ionicons name="chevron-forward" size={18} color={t.colors.text.secondary} />
              </TouchableOpacity>
              {spend && <>
                {row('They receive', displaySpend(spend.amount, spend.asset))}
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: t.spacing[3] }}>
                  <Text style={muted}>{selected?.route.kind === 'swap' ? 'Swap & fees' : 'Fees'}</Text>
                  <Text style={{ ...text, color: spend.fee === 0 ? t.colors.success[500] : t.colors.text.primary }}>{spend.fee === 0 ? 'No fee' : displaySpend(spend.fee, spend.asset)}</Text>
                </View>
                <View style={{ height: 1, backgroundColor: t.colors.border.light }} />
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: t.spacing[3] }}>
                  <Text style={{ ...text, fontWeight: '600' }}>You pay</Text>
                  <Text style={{ ...text, fontWeight: '600', fontSize: t.typography.fontSize.lg }}>{total}</Text>
                </View>
              </>}
              {quote && <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Ionicons name="time-outline" size={14} color={expired ? t.colors.warning[500] : t.colors.text.secondary} />
                <Text accessibilityLiveRegion="polite" style={{ ...muted, fontSize: t.typography.fontSize.sm, color: expired ? t.colors.warning[500] : t.colors.text.secondary }}>{expired ? 'Quote expired. Refresh before paying.' : `Quote valid for ${Math.max(0, Math.ceil((quote.expiresAt * 1000 - now) / 1000))}s`}</Text>
              </View>}
              {!!selected?.unavailable && <Text accessibilityRole="alert" style={{ ...muted, color: t.colors.warning[500] }}>{selected.unavailable}</Text>}
              {!!previousTotal && reviewUpdated && <Text accessibilityRole="alert" style={muted}>Previous total: {previousTotal}. Review the updated quote before paying.</Text>}
              {!busy && preview.plan.status === 'ready' && !offers.some(o => o.quote) && <Text style={muted}>No way to pay this right now. Check your balances and connected accounts, then refresh.</Text>}
              {selected && !selected.executable && <Text style={muted}>This account can quote but cannot pay yet.</Text>}
              {busy && <ActivityIndicator color={t.colors.primary[500]} />}
            </View>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Payment details" accessibilityState={{ expanded: showDetails }}
              onPress={() => setShowDetails(v => !v)} style={{ minHeight: 48, paddingVertical: t.spacing[3] }}>{row('Details', showDetails ? '⌃' : '⌄')}</TouchableOpacity>
            {showDetails && <View style={card}>
              {selected && row('Paid with', selected.provider)}
              {selected && row('Route', selected.route.kind === 'swap' ? 'Conversion included' : 'Direct payment')}
              {preview.request.acceptedRails.length > 1 && row('They accept', preview.request.acceptedRails.map(railLabel).join(', '))}
              <Button title="Compare ways to pay" variant="secondary" onPress={() => setShowProviders(true)} />
            </View>}
          </>}
        </ScrollView>
        {!attempt && <View style={{ padding: t.spacing[5], gap: t.spacing[3], backgroundColor: t.colors.background.primary }}>
          {!preview
            ? <Button title={busy ? 'Getting quotes…' : 'Review payment'} disabled={!target || busy || !journalReady} onPress={review} />
            : !quote || quote.expiresAt * 1000 <= Date.now() || selected?.unavailable
              ? <Button title={busy ? 'Getting quotes…' : 'Refresh quotes'} disabled={busy} onPress={() => void getOffers(true)} />
              : reviewUpdated
                ? <Button title="Review updated quote" disabled={busy} onPress={() => setReviewUpdated(false)} />
                : <Button title={total ? `Pay ${total}` : 'Pay'} disabled={busy || !selected?.executable || !walletId || !journalReady} onPress={() => void pay()} />}
          {preview && <Text style={{ ...muted, textAlign: 'center' }}>{!walletId ? 'Set up a wallet to pay.' : 'Review the total before confirming.'}</Text>}
        </View>}
      </KeyboardAvoidingView>
      <ProviderSheet visible={showProviders} options={options} selectedId={selectedId} onSelect={id => { setSelectedId(id); setReviewUpdated(false); setPreviousTotal(''); }}
        onClose={() => setShowProviders(false)} now={now} title="Ways to pay" intro="Same payment, different routes. Totals include every fee." />
      <AmountEditorModal visible={showAmountEditor} onClose={() => setShowAmountEditor(false)} initialSats={amountSat} rates={rates} bitcoinUnit={bitcoinUnit}
        onConfirm={sats => { setAmountSat(sats > 0 ? sats : undefined); setShowAmountEditor(false); }} />
      <NostrContactsSelector visible={showContacts} onClose={() => setShowContacts(false)}
        onSelectContact={c => { setShowContacts(false); const dest = c.lightning_address || c.node_pubkey; if (dest) { setInput(dest); setContactName(c.name); } }} />
    </SafeAreaView>
  );
}
