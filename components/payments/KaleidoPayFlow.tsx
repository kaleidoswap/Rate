import { formatBitcoinAmount } from '../../utils/bitcoinUnits';
import { useForegroundClock } from '../../hooks/useForegroundClock';
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, ScrollView, TouchableOpacity, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Crypto from 'expo-crypto';
import { ScreenHeader } from '../ScreenHeader';
import { Button } from '../Button';
import { ProviderSheet } from './ProviderSheet';
import { NetworkIcon } from '../NetworkIcon';
import { useAppTheme } from '../../theme/ThemeProvider';
import { useAppSelector } from '../../store/hooks';
import { KALEIDOPAY_DEMO, codeNetwork, prepareKaleidoPay, railLabel, previewPayment, quotePaymentOffers, quoteSpend, formatSpend, bestOffer, executePaymentOffer, checkPaymentStatus, PaymentNotSentError, registerKaleidoPayAccount } from '../../services/kaleidoPay';
import type { Network, Preview, PaymentOffer } from '../../services/kaleidoPay';
import { loadPaymentAttempt, beginPaymentAttempt, savePaymentAttempt, unresolvedAttempt } from '../../services/kaleidoPay/attempts';
import { protocolManager } from '../../services/protocols';
import { MobileSparkAdapter } from '../../services/protocols/MobileSparkAdapter';
import type { PaymentAttempt } from '../../services/kaleidoPay/attempts';

interface Props {
  /** The payment code entered on Send; empty to reopen an unresolved payment. */
  code: string;
  /** Back to Send's input, e.g. to pay something else. */
  onExit: () => void;
  /** Leave Send after a completed payment. */
  onDone: () => void;
}

/**
 * Send's review and pay step for codes KaleidoPay pays (BOLT12 offers, universal
 * QRs, plain addresses): it compares direct payment with swap providers and keeps
 * the payment journal. Rendered by SendScreen, so paying has one screen.
 */
export function KaleidoPayFlow({ code, onExit, onDone }: Props) {
  const t = useAppTheme();
  const bitcoinUnit = useAppSelector(s => s.settings.bitcoinUnit);
  const [showDetails, setShowDetails] = useState(false);
  const autoReviewed = useRef<string | null>(null);
  const formatSats = (sats: number) => `${formatBitcoinAmount(sats, bitcoinUnit)} ${bitcoinUnit}`;
  const displaySpend: typeof formatSpend = (value, asset) => asset.id === 'BTC' && asset.ticker === 'sats' ? formatSats(value) : formatSpend(value, asset);
  const walletId = useAppSelector(s => s.wallet.activeWallet?.id);
  const [network, setNetwork] = useState<Network>('signet');
  const [showNetworks, setShowNetworks] = useState(false);
  const [amount, setAmount] = useState('');
  const amountInSats = bitcoinUnit === 'BTC' && amount ? String(Math.round(Number(amount) * 1e8)) : amount;
  const [preview, setPreview] = useState<Preview | null>(null);
  const [offers, setOffers] = useState<PaymentOffer[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [showProviders, setShowProviders] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [reviewUpdated, setReviewUpdated] = useState(false);
  const [previousTotal, setPreviousTotal] = useState('');
  const [attempt, setAttempt] = useState<PaymentAttempt | null>(null);
  const now = useForegroundClock(offers.some(offer => !!offer.quote) && !attempt);
  const [journalReady, setJournalReady] = useState(false);
  const revision = useRef(0);
  const paying = useRef(false);
  const requestId = useRef(Crypto.randomUUID());
  useEffect(() => {
    if (!walletId) return;
    try {
      const adapter = protocolManager.getAdapter('SPARK');
      const account = adapter instanceof MobileSparkAdapter ? adapter.createPaymentAccount(walletId) : null;
      if (account) return registerKaleidoPayAccount(account);
    } catch { /* Disconnected accounts are not advertised as payment routes. */ }
  }, [walletId]);
  // A scanned code names its network (offer chain or address); the picker stays as an override.
  useEffect(() => { const detected = codeNetwork(code); if (detected) setNetwork(detected); }, [code]);
  useEffect(() => {
    revision.current++; setPreview(null); setOffers([]); setSelectedId(undefined); setError(''); setBusy(false); setPreviousTotal('');
  }, [code, network, amount]);
  useEffect(() => {
    let active = true;
    setJournalReady(false); setAttempt(null);
    if (!walletId) { setJournalReady(true); return; }
    loadPaymentAttempt(walletId).then(saved => { if (active) { if (unresolvedAttempt(saved)) setAttempt(saved); setJournalReady(true); } })
      .catch(() => { if (active) setError('Could not check your previous payment. Reopen this screen before paying.'); });
    return () => { active = false; revision.current++; };
  }, [walletId]);
  useEffect(() => () => { revision.current++; }, []);
  const selected = offers.find(o => o.id === selectedId);
  const quote = selected?.quote;
  const spend = quote ? quoteSpend(quote) : null;
  const total = spend ? displaySpend(spend.total, spend.asset) : '';
  const expired = !!quote && quote.expiresAt * 1000 <= now;
  const text = { color: t.colors.text.primary, fontSize: t.typography.fontSize.base };
  const muted = { ...text, color: t.colors.text.secondary };
  const card = { padding: t.spacing[5], borderRadius: t.borderRadius.xl, backgroundColor: t.colors.surface.primary, gap: t.spacing[3], marginBottom: t.spacing[4] };
  const row = (label: string, value: string) => <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: t.spacing[3] }}><Text style={muted}>{label}</Text><Text style={{ ...text, textAlign: 'right', flexShrink: 1 }}>{value}</Text></View>;
  const choose = (id: string) => { setSelectedId(id); setReviewUpdated(false); setPreviousTotal(''); };

  async function getOffers(refresh = false) {
    const current = ++revision.current;
    setBusy(true); setError('');
    if (refresh) setPreviousTotal(total);
    try {
      await prepareKaleidoPay();
      if (current !== revision.current) return;
      const fresh = previewPayment(code, network, amountInSats, requestId.current);
      const result = await quotePaymentOffers(fresh);
      if (current !== revision.current) return;
      setPreview(fresh); setOffers(result);
      if (!refresh) setSelectedId((bestOffer(result.filter(o => o.executable)) ?? result.find(o => o.executable && o.quote && !o.unavailable) ?? bestOffer(result))?.id);
      // Refresh never switches provider or account, even when its quote fails.
      setReviewUpdated(refresh);
    } catch { if (current === revision.current) setError('Could not get quotes. Please try again.'); }
    finally { if (current === revision.current) setBusy(false); }
  }
  function review() {
    try {
      const p = previewPayment(code, network, amountInSats, requestId.current);
      setPreview(p); setError(''); void getOffers();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not read the payment request.'); }
  }
  async function pay() {
    if (paying.current || !walletId || !journalReady || !preview || !selected || !quote || quote.expiresAt * 1000 <= Date.now() || !selected.executable || unresolvedAttempt(attempt)) return;
    paying.current = true; setBusy(true); setError('');
    const next: PaymentAttempt = { id: Crypto.randomUUID(), sourceId: selected.route.sourceId, provider: selected.provider, total, recipient: formatSats(preview.request.amountSat), createdAt: Date.now(), status: 'pending' };
    try {
      await beginPaymentAttempt(walletId, next); // No send unless recovery record is durable.
    } catch {
      setError('Could not start a new payment. Reopen this screen to check previous payment progress.');
      setJournalReady(false);
      paying.current = false; setBusy(false); return;
    }
    setAttempt(next);
    try {
      const result = await executePaymentOffer(preview, selected, next.id);
      const updated = { ...next, ...result };
      // Show the result even if persisting it fails; disk retains pending and
      // forces a status check on restart instead of allowing another payment.
      setAttempt(updated);
      try { await savePaymentAttempt(walletId, updated); }
      catch { setError('The payment result could not be saved. Keep this receipt; reopening will check the payment again.'); }
    } catch (e) {
      const updated: PaymentAttempt = { ...next, status: e instanceof PaymentNotSentError ? 'failed' : 'unknown' };
      setAttempt(updated);
      setError(e instanceof PaymentNotSentError ? `${e.message} Nothing was sent.` : 'Payment status needs checking. Do not send again.');
      try { await savePaymentAttempt(walletId, updated); } catch { /* Keep the durable pending record; reopening requires a status check. */ }
    }
    finally { paying.current = false; setBusy(false); }
  }
  async function checkStatus() {
    if (!attempt || !walletId || paying.current) return;
    paying.current = true; setBusy(true); setError('');
    try {
      const result = await checkPaymentStatus(attempt.sourceId, attempt.id);
      const updated = { ...attempt, ...result };
      await savePaymentAttempt(walletId, updated); setAttempt(updated);
    } catch { setError('Could not update payment status. Check again before making another payment.'); }
    finally { paying.current = false; setBusy(false); }
  }
  useEffect(() => {
    // Scanning an amount-bound request opens its review directly; amountless
    // requests keep the editor visible. No payment is executed by this effect.
    if (!journalReady || attempt || !code || autoReviewed.current === code) return;
    autoReviewed.current = code;
    try { previewPayment(code, network, amountInSats, requestId.current); }
    catch { return; }
    review();
  }, [journalReady, attempt, code]);

  // Reopened from Activity with no unresolved payment left: back to Send's input.
  useEffect(() => { if (journalReady && !attempt && !code) onExit(); }, [journalReady, attempt, code]);

  const railId = (r: string) => r === 'ln' ? `ln:${network}` : r;
  const railIcon = (r: string) => ({ ln: 'lightning', btc: 'onchain' } as Record<string, string>)[r.split(':')[0]] ?? r.split(':')[0];
  const describe = (o: PaymentOffer) => o.route.kind === 'swap'
    ? { icon: 'swap', group: 'Through a swap provider', subtitle: [`${o.accountName} via ${railLabel(o.route.from)}`, o.providerDetail].filter(Boolean).join(' · '), preferred: false }
    : { icon: railIcon(o.route.to), group: 'Direct', subtitle: `${o.accountName} · direct, no swap`,
      preferred: !!preview && o.route.to === railId(preview.request.acceptedRails[0]) };
  const best = bestOffer(offers);
  const feeText = (fee: number, asset: Parameters<typeof displaySpend>[1]) => fee === 0 ? 'No fee' : `${displaySpend(fee, asset)} fee`;
  const options = offers.map(o => {
    const s = o.quote ? quoteSpend(o.quote) : null;
    return { id: o.id, name: o.provider, account: o.accountName, amount: s ? displaySpend(s.total, s.asset) : 'Unavailable', amountLabel: 'Total you pay', detail: s ? `Fees ${displaySpend(s.fee, s.asset)}` : '', unavailable: o.unavailable,
      expiresAt: o.quote ? o.quote.expiresAt * 1000 : undefined, recommended: best?.id === o.id, fee: s ? feeText(s.fee, s.asset) : undefined, ...describe(o) };
  });
  const selectedView = selected ? describe(selected) : null;
  const liveOptions = options.filter(o => !o.unavailable).length;
  const pill = (label: string, color: string) => (
    <View key={label} style={{ paddingHorizontal: t.spacing[2], paddingVertical: 2, borderRadius: t.borderRadius.full, backgroundColor: color + '22' }}>
      <Text style={{ color, fontSize: t.typography.fontSize.xs, fontWeight: '600' }}>{label}</Text>
    </View>
  );
  const chip = (label: string, icon: string, index: number) => (
    <View key={label + index} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, paddingHorizontal: t.spacing[3], borderRadius: t.borderRadius.full, backgroundColor: t.colors.background.primary }}>
      <Text style={{ ...muted, fontSize: t.typography.fontSize.xs }}>{index + 1}</Text>
      {icon === 'swap' ? null : <NetworkIcon network={icon} size={14} />}
      <Text style={{ ...text, fontSize: t.typography.fontSize.sm }}>{label}</Text>
    </View>
  );
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.colors.background.primary }} edges={['left', 'right', 'bottom']}>
      <ScreenHeader title={preview ? 'Review Payment' : 'Pay'} onBack={() => { if (preview && !attempt && !paying.current) { revision.current++; setBusy(false); setPreview(null); } else if (!paying.current) { if (attempt && !unresolvedAttempt(attempt)) onDone(); else onExit(); } }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: t.spacing[5] }}>
          {KALEIDOPAY_DEMO && <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing[2], padding: t.spacing[3], borderRadius: t.borderRadius.lg, backgroundColor: t.colors.warning[500] + '22', marginBottom: t.spacing[4] }}>
            <Ionicons name="flask-outline" size={16} color={t.colors.warning[500]} />
            <Text style={{ ...muted, color: t.colors.warning[500], flex: 1, fontSize: t.typography.fontSize.sm }}>Demo build: quotes are live, the payment step is simulated. No funds move.</Text>
          </View>}
          {!!error && <Text accessibilityRole="alert" style={{ ...text, color: t.colors.warning[500], marginBottom: t.spacing[4] }}>{error}</Text>}
          {attempt ? <View style={card}>
            <Ionicons name={attempt.status === 'completed' ? 'checkmark-circle-outline' : 'time-outline'} size={48} color={t.colors.primary[500]} />
            <Text style={{ ...text, fontSize: t.typography.fontSize['2xl'], fontWeight: '600' }}>{attempt.status === 'completed' ? 'Payment completed' : attempt.status === 'failed' ? 'Payment failed' : busy ? 'Sending payment' : attempt.status === 'unknown' ? 'Payment needs checking' : 'Payment in progress'}</Text>
            {KALEIDOPAY_DEMO && attempt.status === 'completed' && <Text style={{ ...muted, color: t.colors.warning[500] }}>Simulated in this demo build. No funds moved.</Text>}
            {row('Recipient receives', attempt.recipient)}{row('Total', attempt.total)}{row('Provider', attempt.provider)}
            {!!attempt.reference && <Text selectable style={muted}>Reference: {attempt.reference}</Text>}
            <Text style={muted}>{unresolvedAttempt(attempt) ? 'Your payment is still being checked. You can leave and return here to check its status. Do not send it again.' : attempt.status === 'failed' ? 'This payment was not sent or the provider confirmed it failed. Review a new quote before trying again.' : 'Your payment is complete.'}</Text>
            {unresolvedAttempt(attempt) ? <Button title="Check status" onPress={() => void checkStatus()} loading={busy} disabled={busy} /> : <Button title={attempt.status === 'failed' ? 'Review a new quote' : 'Done'} onPress={() => { if (attempt.status === 'completed') onDone(); else { setAttempt(null); if (preview) void getOffers(true); } }} />}
          </View> : !preview ? <>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Change recipient" onPress={onExit} style={card}>
              <Text style={muted}>Paying</Text>
              <Text numberOfLines={2} ellipsizeMode="middle" selectable style={text}>{code}</Text>
              <Text style={{ ...muted, color: t.colors.primary[500] }}>Change</Text>
            </TouchableOpacity>
            <View style={card}>
              <Text style={text}>Recipient amount</Text><Text style={muted}>Leave empty if the request includes an amount.</Text>
              <TextInput accessibilityLabel={`Amount in ${bitcoinUnit}`} keyboardType="decimal-pad" value={amount} onChangeText={setAmount} placeholder={`Amount in ${bitcoinUnit}`} placeholderTextColor={t.colors.text.muted} style={{ ...text, paddingVertical: t.spacing[3] }} />
            </View>
            <TouchableOpacity accessibilityRole="button" accessibilityState={{ expanded: showNetworks }} onPress={() => setShowNetworks(v => !v)} style={card}>{row('Payment network', `${network} ▾`)}</TouchableOpacity>
            {showNetworks && <View style={card}><Text style={muted}>Use the network agreed with the recipient. Test addresses cannot distinguish Signet from Mutinynet.</Text>{(['signet', 'mutinynet', 'testnet', 'mainnet'] as Network[]).map(n => <Button key={n} title={n} variant={n === network ? 'primary' : 'secondary'} onPress={() => { setNetwork(n); setShowNetworks(false); }} />)}</View>}
          </> : <>
            <View style={card}>
              <Text style={muted}>{preview.code.label || 'Recipient'} receives</Text>
              <Text style={{ ...text, fontSize: t.typography.fontSize['3xl'], fontWeight: '600' }}>{formatSats(preview.request.amountSat)}</Text>
              <Text numberOfLines={1} ellipsizeMode="middle" selectable style={muted}>Bitcoin · {network} · {preview.code.address || 'BOLT12 offer'}</Text>
              {!!preview.code.message && <Text style={text}>{preview.code.message}</Text>}
              {preview.request.acceptedRails.length > 1 && <>
                <Text style={{ ...muted, fontSize: t.typography.fontSize.xs, letterSpacing: 1.2, textTransform: 'uppercase', marginTop: t.spacing[2] }}>They accept, in order</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing[2] }}>{preview.request.acceptedRails.map((r, i) => chip(railLabel(r), railIcon(r), i))}</View>
              </>}
            </View>
            <View style={card}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={muted}>You pay with</Text>
                {liveOptions > 1 && <TouchableOpacity accessibilityRole="button" onPress={() => setShowProviders(true)} hitSlop={8}><Text style={{ ...muted, color: t.colors.primary[500] }}>Compare {liveOptions} ways ›</Text></TouchableOpacity>}
              </View>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="Choose account and provider" onPress={() => setShowProviders(true)}
                style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing[3], padding: t.spacing[3], borderRadius: t.borderRadius.lg, backgroundColor: t.colors.background.primary }}>
                <View style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: t.colors.surface.primary }}>
                  {!selectedView || selectedView.icon === 'swap' ? <Ionicons name="swap-horizontal" size={20} color={t.colors.text.secondary} /> : <NetworkIcon network={selectedView.icon} size={22} />}
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text numberOfLines={1} style={{ ...text, fontWeight: '600' }}>{selected?.provider ?? 'Choose how to pay'}</Text>
                  {!!selectedView && <Text numberOfLines={1} style={{ ...muted, fontSize: t.typography.fontSize.sm }}>{selectedView.subtitle}</Text>}
                  {!!selected && (selectedView?.preferred || best?.id === selected.id) && <View style={{ flexDirection: 'row', gap: t.spacing[2], marginTop: 4 }}>
                    {selectedView?.preferred && pill('Their choice', t.colors.primary[500])}
                    {best?.id === selected.id && pill('Best price', t.colors.success[500])}
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
              {!busy && !offers.some(o => o.quote) && <Text style={muted}>No live offers available. Connect an account that supports this request and network, then refresh quotes.</Text>}
              {selected && !selected.executable && <Text style={muted}>This account supports quotes only. Payment execution is not available yet.</Text>}
              {busy && <ActivityIndicator color={t.colors.primary[500]} />}
            </View>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Payment details" accessibilityState={{ expanded: showDetails }}
              onPress={() => setShowDetails(v => !v)} style={{ minHeight: 48, paddingVertical: t.spacing[3] }}>{row('Details', showDetails ? '⌃' : '⌄')}</TouchableOpacity>
            {showDetails && <View style={card}>
              {selected && row('Provider', selected.provider)}
              {selected && row('Route', selected.route.kind === 'swap' ? 'Conversion included' : 'Direct payment')}
              <Button title="Compare ways to pay" variant="secondary" onPress={() => setShowProviders(true)} />
            </View>}
          </>}
        </ScrollView>
        {!attempt && <View style={{ padding: t.spacing[5], gap: t.spacing[3], backgroundColor: t.colors.background.primary }}>
          {!preview ? <Button title="Review payment" disabled={!code.trim() || busy} onPress={review} /> : !quote || quote.expiresAt * 1000 <= Date.now() || selected?.unavailable ? <Button title={busy ? 'Getting quotes…' : 'Refresh quotes'} disabled={busy} onPress={() => void getOffers(true)} /> : reviewUpdated ? <Button title="Review updated quote" disabled={busy} onPress={() => setReviewUpdated(false)} /> : <Button title={total ? `Pay ${total}` : 'Pay'} disabled={busy || !selected?.executable || !walletId || !journalReady} onPress={() => void pay()} />}
          {preview && <Text style={{ ...muted, textAlign: 'center' }}>{!walletId ? 'Set up a wallet to pay.' : 'Review the total before confirming.'}</Text>}
        </View>}
      </KeyboardAvoidingView>
      <ProviderSheet visible={showProviders} options={options} selectedId={selectedId} onSelect={choose} onClose={() => setShowProviders(false)} now={now}
        title="Ways to pay" intro="Same payment, different routes. Totals include every fee." />
    </SafeAreaView>
  );
}
