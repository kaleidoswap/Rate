import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, ScrollView, TouchableOpacity, Clipboard, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Crypto from 'expo-crypto';
import { ScreenHeader } from '../components/ScreenHeader';
import { Button } from '../components/Button';
import { ProviderSheet } from '../components/payments/ProviderSheet';
import { useAppTheme } from '../theme/ThemeProvider';
import { useAppSelector } from '../store/hooks';
import { previewPayment, quotePaymentOffers, quoteSpend, formatSpend, bestOffer, executePaymentOffer, checkPaymentStatus, PaymentNotSentError, registerKaleidoPayAccount } from '../services/kaleidoPay';
import type { Network, Preview, PaymentOffer } from '../services/kaleidoPay';
import { loadPaymentAttempt, beginPaymentAttempt, savePaymentAttempt, unresolvedAttempt } from '../services/kaleidoPay/attempts';
import { protocolManager } from '../services/protocols';
import { MobileSparkAdapter } from '../services/protocols/MobileSparkAdapter';
import type { PaymentAttempt } from '../services/kaleidoPay/attempts';

export default function KaleidoPayScreen({ navigation, route }: { navigation: any; route: any }) {
  const t = useAppTheme();
  const walletId = useAppSelector(s => s.wallet.activeWallet?.id);
  const [code, setCode] = useState(route.params?.code ?? '');
  const [network, setNetwork] = useState<Network>('signet');
  const [showNetworks, setShowNetworks] = useState(false);
  const [amount, setAmount] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [offers, setOffers] = useState<PaymentOffer[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [showProviders, setShowProviders] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [reviewUpdated, setReviewUpdated] = useState(false);
  const [previousTotal, setPreviousTotal] = useState('');
  const [attempt, setAttempt] = useState<PaymentAttempt | null>(null);
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
  useEffect(() => { if (route.params?.code !== undefined) setCode(route.params.code); }, [route.params?.code]);
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
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => { clearInterval(timer); revision.current++; }; }, []);
  const selected = offers.find(o => o.id === selectedId);
  const quote = selected?.quote;
  const spend = quote ? quoteSpend(quote) : null;
  const total = spend ? formatSpend(spend.total, spend.asset) : '';
  const expired = !!quote && quote.expiresAt * 1000 <= now;
  const text = { color: t.colors.text.primary, fontSize: t.typography.fontSize.base };
  const muted = { ...text, color: t.colors.text.secondary };
  const card = { padding: t.spacing[5], borderRadius: t.borderRadius.xl, backgroundColor: t.colors.surface.primary, gap: t.spacing[3], marginBottom: t.spacing[4] };
  const row = (label: string, value: string) => <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: t.spacing[3] }}><Text style={muted}>{label}</Text><Text style={{ ...text, textAlign: 'right', flexShrink: 1 }}>{value}</Text></View>;
  const choose = (id: string) => { setSelectedId(id); setReviewUpdated(false); setPreviousTotal(''); };

  async function getOffers(p: Preview, refresh = false) {
    const current = ++revision.current;
    setBusy(true); setError('');
    if (refresh) setPreviousTotal(total);
    try {
      const fresh = previewPayment(code, network, amount, requestId.current);
      const result = await quotePaymentOffers(fresh);
      if (current !== revision.current) return;
      setPreview(fresh); setOffers(result);
      if (!refresh) setSelectedId((bestOffer(result) ?? result.find(o => o.quote && !o.unavailable))?.id);
      // Refresh never switches provider or account, even when its quote fails.
      setReviewUpdated(refresh);
    } catch { if (current === revision.current) setError('Could not get quotes. Please try again.'); }
    finally { if (current === revision.current) setBusy(false); }
  }
  function review() {
    try {
      const p = previewPayment(code, network, amount, requestId.current);
      setPreview(p); setError(''); void getOffers(p);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not read the payment request.'); }
  }
  async function pay() {
    if (paying.current || !walletId || !journalReady || !preview || !selected || !quote || expired || !selected.executable || unresolvedAttempt(attempt)) return;
    paying.current = true; setBusy(true); setError('');
    const next: PaymentAttempt = { id: Crypto.randomUUID(), sourceId: selected.route.sourceId, provider: selected.provider, total, recipient: `${preview.request.amountSat.toLocaleString()} sats`, createdAt: Date.now(), status: 'pending' };
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
      await savePaymentAttempt(walletId, updated);
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
    paying.current = true; setBusy(true);
    try {
      const result = await checkPaymentStatus(attempt.sourceId, attempt.id);
      const updated = { ...attempt, ...result };
      await savePaymentAttempt(walletId, updated); setAttempt(updated);
    } catch { setError('Could not update payment status. Check again before making another payment.'); }
    finally { paying.current = false; setBusy(false); }
  }
  const options = offers.map(o => {
    const s = o.quote ? quoteSpend(o.quote) : null;
    return { id: o.id, name: o.provider, account: o.accountName, amount: s ? formatSpend(s.total, s.asset) : 'Unavailable', amountLabel: 'Total you pay', detail: s ? `Fees ${formatSpend(s.fee, s.asset)} · ${o.route.kind === 'swap' ? 'Conversion included' : 'Direct payment'}` : '', unavailable: o.unavailable,
      expiresAt: o.quote ? o.quote.expiresAt * 1000 : undefined, recommended: bestOffer(offers)?.id === o.id };
  });
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.colors.background.primary }} edges={['left', 'right', 'bottom']}>
      <ScreenHeader title="KaleidoPay" subtitle="Pay with what you have" onBack={() => { if (preview && !attempt && !paying.current) { revision.current++; setBusy(false); setPreview(null); } else if (!paying.current) navigation.goBack(); }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: t.spacing[5] }}>
          {!!error && <Text accessibilityRole="alert" style={{ ...text, color: t.colors.warning[500], marginBottom: t.spacing[4] }}>{error}</Text>}
          {attempt ? <View style={card}>
            <Ionicons name={attempt.status === 'completed' ? 'checkmark-circle-outline' : 'time-outline'} size={48} color={t.colors.primary[500]} />
            <Text style={{ ...text, fontSize: t.typography.fontSize['2xl'], fontWeight: '600' }}>{attempt.status === 'completed' ? 'Payment completed' : attempt.status === 'failed' ? 'Payment failed' : 'Checking payment'}</Text>
            {row('Recipient receives', attempt.recipient)}{row('Total', attempt.total)}{row('Provider', attempt.provider)}
            {!!attempt.reference && <Text selectable style={muted}>Reference: {attempt.reference}</Text>}
            <Text style={muted}>{unresolvedAttempt(attempt) ? 'Your payment may still be processing. Check its status before sending again. We will not switch providers or retry automatically.' : attempt.status === 'failed' ? 'This payment was not sent or the provider confirmed it failed. Review a new quote before trying again.' : 'Your payment is complete.'}</Text>
            {unresolvedAttempt(attempt) ? <Button title="Check status" onPress={() => void checkStatus()} loading={busy} disabled={busy} /> : <Button title={attempt.status === 'failed' ? 'Review a new quote' : 'Done'} onPress={() => { if (attempt.status === 'completed') navigation.goBack(); else { setAttempt(null); if (preview) void getOffers(preview, true); } }} />}
          </View> : !preview ? <>
            <View style={card}>
              <Text style={{ ...text, fontSize: t.typography.fontSize.xl, fontWeight: '600' }}>Who are you paying?</Text>
              <TextInput accessibilityLabel="Payment request" value={code} onChangeText={setCode} multiline autoCapitalize="none" autoCorrect={false} placeholder="Payment link or BOLT12 offer" placeholderTextColor={t.colors.text.muted} style={{ ...text, minHeight: 90, paddingVertical: t.spacing[3] }} />
              <View style={{ flexDirection: 'row', gap: t.spacing[3] }}>
                <Button title="Scan QR" onPress={() => navigation.navigate('QRScanner', { returnScreen: 'KaleidoPay' })} style={{ flex: 1 }} />
                <Button title="Paste" variant="secondary" onPress={() => { Clipboard.getString().then(setCode).catch(() => setError('Could not read the clipboard.')); }} style={{ flex: 1 }} />
              </View>
            </View>
            <View style={card}>
              <Text style={text}>Recipient amount</Text><Text style={muted}>Leave empty if the request includes an amount.</Text>
              <TextInput accessibilityLabel="Amount in sats" keyboardType="number-pad" value={amount} onChangeText={setAmount} placeholder="Amount in sats" placeholderTextColor={t.colors.text.muted} style={{ ...text, paddingVertical: t.spacing[3] }} />
            </View>
            <TouchableOpacity accessibilityRole="button" accessibilityState={{ expanded: showNetworks }} onPress={() => setShowNetworks(v => !v)} style={card}>{row('Payment network', `${network} ▾`)}</TouchableOpacity>
            {showNetworks && <View style={card}><Text style={muted}>Use the network agreed with the recipient. Test addresses cannot distinguish Signet from Mutinynet.</Text>{(['signet', 'mutinynet', 'testnet', 'mainnet'] as Network[]).map(n => <Button key={n} title={n} variant={n === network ? 'primary' : 'secondary'} onPress={() => { setNetwork(n); setShowNetworks(false); }} />)}</View>}
          </> : <>
            <View style={card}>
              <Text style={muted}>{preview.code.label || 'Recipient'} receives</Text>
              <Text style={{ ...text, fontSize: t.typography.fontSize['3xl'], fontWeight: '600' }}>{preview.request.amountSat.toLocaleString()} sats</Text>
              <Text style={muted}>Bitcoin · {network}</Text>
              {!!preview.code.message && <Text style={text}>{preview.code.message}</Text>}
              <Text selectable style={muted}>{preview.code.address || 'BOLT12 offer'}</Text>
            </View>
            <View style={card}>
              <Text style={muted}>You pay with</Text>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="Choose account and provider" onPress={() => setShowProviders(true)}>{row(selected?.accountName ?? 'Choose an account', '›')}</TouchableOpacity>
              {selected && <TouchableOpacity accessibilityRole="button" accessibilityLabel="Compare providers" onPress={() => setShowProviders(true)}>{row('Provider', `${selected.provider} ›`)}</TouchableOpacity>}
              {spend && <>{row('Payment', formatSpend(spend.amount, spend.asset))}{row('Conversion & fees', formatSpend(spend.fee, spend.asset))}<View style={{ height: 1, backgroundColor: t.colors.border.light }} />{row('Total', total)}</>}
              {quote && <Text accessibilityLiveRegion="polite" style={muted}>{expired ? 'Quote expired. Refresh before paying.' : `Quote valid for ${Math.max(0, Math.ceil((quote.expiresAt * 1000 - now) / 1000))}s`}</Text>}
              {!!selected?.unavailable && <Text accessibilityRole="alert" style={muted}>{selected.unavailable}</Text>}
              {!!previousTotal && reviewUpdated && <Text accessibilityRole="alert" style={muted}>Previous total: {previousTotal}. Review the updated quote before paying.</Text>}
              {!busy && !offers.some(o => o.quote) && <Text style={muted}>No live offers available. Connect an account that supports this request and network, then refresh quotes.</Text>}
              {selected && !selected.executable && <Text style={muted}>This account supports quotes only. Payment execution is not available yet.</Text>}
              {busy && <ActivityIndicator color={t.colors.primary[500]} />}
            </View>
            <Button title="Compare providers" variant="secondary" onPress={() => setShowProviders(true)} />
          </>}
        </ScrollView>
        {!attempt && <View style={{ padding: t.spacing[5], gap: t.spacing[3], backgroundColor: t.colors.background.primary }}>
          {!preview ? <Button title="Review payment" disabled={!code.trim() || busy} onPress={review} /> : !quote || expired || selected?.unavailable ? <Button title={busy ? 'Getting quotes…' : 'Refresh quotes'} disabled={busy} onPress={() => void getOffers(preview, true)} /> : reviewUpdated ? <Button title="Review updated quote" disabled={busy} onPress={() => setReviewUpdated(false)} /> : <Button title={total ? `Pay ${total}` : 'Pay'} disabled={busy || !selected?.executable || !walletId || !journalReady} onPress={() => void pay()} />}
          {preview && <Text style={{ ...muted, textAlign: 'center' }}>{!walletId ? 'Set up a wallet to pay.' : 'Only the selected provider will receive this payment.'}</Text>}
        </View>}
      </KeyboardAvoidingView>
      <ProviderSheet visible={showProviders} options={options} selectedId={selectedId} onSelect={choose} onClose={() => setShowProviders(false)} now={now} />
    </SafeAreaView>
  );
}
