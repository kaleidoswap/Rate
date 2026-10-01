import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, ScrollView, TouchableOpacity, Clipboard, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScreenHeader } from '../components/ScreenHeader';
import { useAppTheme } from '../theme/ThemeProvider';
import { previewPayment, quotePayment } from '../services/kaleidoPay';
import type { Network, Preview, Quote } from '../services/kaleidoPay';

export default function KaleidoPayScreen({ navigation, route }: { navigation: any; route: any }) {
  const theme = useAppTheme();
  const [code, setCode] = useState(route.params?.code ?? '');
  const [network, setNetwork] = useState<Network>('signet');
  const [amount, setAmount] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const revision = useRef(0);
  const requestId = useRef(`kaleidopay-${Date.now()}`);
  useEffect(() => { if (route.params?.code !== undefined) setCode(route.params.code); }, [route.params?.code]);
  useEffect(() => { revision.current++; setPreview(null); setQuote(null); setError(''); setBusy(false); }, [code, network, amount]);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => { clearInterval(timer); revision.current++; }; }, []);
  const text = { color: theme.colors.text.primary, fontSize: 16 };
  const muted = { ...text, color: theme.colors.text.secondary };
  const box = { padding: theme.spacing[4], borderRadius: theme.borderRadius.md, backgroundColor: theme.colors.background.secondary, marginBottom: theme.spacing[4] };
  const button = (label: string, action: () => void, disabled = false) => (
    <TouchableOpacity accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={action}
      style={{ ...box, backgroundColor: theme.colors.primary[500], opacity: disabled ? 0.5 : 1 }}>
      <Text style={{ ...text, color: theme.colors.text.inverse, textAlign: 'center' }}>{label}</Text>
    </TouchableOpacity>
  );
  function review() {
    revision.current++; setQuote(null); setError(''); setBusy(false);
    try { setPreview(previewPayment(code, network, amount, requestId.current)); }
    catch (e) { setPreview(null); setError(e instanceof Error ? e.message : 'Could not read this payment request.'); }
  }
  async function fetchQuote() {
    if (!preview) return;
    const current = ++revision.current;
    setBusy(true); setError(''); setQuote(null);
    try { const result = await quotePayment(preview); if (current === revision.current) setQuote(result); }
    catch (e) { if (current === revision.current) setError(e instanceof Error ? e.message : 'Could not get a quote.'); }
    finally { if (current === revision.current) setBusy(false); }
  }
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background.primary }}>
      <ScreenHeader title="KaleidoPay" subtitle="Pay with what you have. Receive what you want." />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: theme.spacing[6] }}>
        <Text style={text}>Payment request</Text>
        <TextInput accessibilityLabel="Payment request" value={code} onChangeText={setCode} multiline autoCapitalize="none" autoCorrect={false}
          placeholder="Paste a payment link or BOLT12 offer" placeholderTextColor={theme.colors.text.muted} style={{ ...box, ...text, minHeight: 90 }} />
        <View style={{ flexDirection: 'row', gap: theme.spacing[4] }}>
          {button('Paste', () => { Clipboard.getString().then(setCode).catch(() => setError('Could not read the clipboard.')); })}
          {button('Scan', () => navigation.navigate('QRScanner', { returnScreen: 'KaleidoPay' }))}
        </View>
        <Text style={text}>Payment network</Text>
        <Text style={muted}>Choose the network agreed with the recipient. Test addresses alone cannot distinguish Signet from Mutinynet.</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing[2], marginVertical: theme.spacing[4] }}>
          {(['signet', 'mutinynet', 'testnet', 'mainnet'] as Network[]).map(n => (
            <TouchableOpacity key={n} accessibilityRole="radio" accessibilityState={{ selected: n === network }} onPress={() => setNetwork(n)}
              style={{ ...box, backgroundColor: n === network ? theme.colors.primary[500] : theme.colors.background.secondary }}>
              <Text style={{ ...text, color: n === network ? theme.colors.text.inverse : theme.colors.text.primary }}>{n === 'mutinynet' ? 'Mutinynet' : n.charAt(0).toUpperCase() + n.slice(1)}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text style={text}>Amount in sats (if not included in the request)</Text>
        <TextInput accessibilityLabel="Amount in sats" keyboardType="number-pad" value={amount} onChangeText={setAmount} style={{ ...box, ...text }} placeholder="50000" placeholderTextColor={theme.colors.text.muted} />
        {button('Review request', review, !code.trim())}
        {!!error && <Text accessibilityRole="alert" style={{ ...text, color: theme.colors.error[500], marginBottom: theme.spacing[4] }}>{error}</Text>}
        {preview && <View style={box}>
          <Text style={text}>Recipient receives: {preview.request.amountSat.toLocaleString()} sats</Text>
          {!!preview.code.label && <Text style={muted}>{preview.code.label}</Text>}
          {!!preview.code.message && <Text style={muted}>{preview.code.message}</Text>}
          <Text selectable style={muted}>{preview.code.address ?? 'BOLT12 offer'}</Text>
          {preview.plan.status === 'ready' ? <>
            <Text style={text}>{preview.plan.route.kind === 'direct' ? 'Direct payment' : 'Payment with a swap'}</Text>
            <Text style={muted}>{preview.plan.route.from} → {preview.plan.route.to}</Text>
            <Text style={muted}>From: {preview.plan.route.sourceId}</Text>
            {button(busy ? 'Getting quote…' : 'Get fee quote', () => { void fetchQuote(); }, busy)}
          </> : <Text style={muted}>No connected account supports this request on {network}. Connect a supported account, then review again.</Text>}
          {!!preview.code.offer && <Text style={muted}>The offer and recipient details must be verified by the connected account before a quote is accepted.</Text>}
          {busy && <ActivityIndicator color={theme.colors.primary[500]} />}
          {quote ? <>
            <Text style={text}>Fees: {quote.feeSat.toLocaleString()} sats</Text>
            <Text style={text}>You spend: {quote.totalSat.toLocaleString()} sats</Text>
            <Text style={muted}>{quote.expiresAt * 1000 <= now ? 'Quote expired. Get a new quote.' : `Quote valid for ${Math.ceil((quote.expiresAt * 1000 - now) / 1000)} seconds`}</Text>
          </> : <Text style={muted}>Fees and total cost will appear after a live quote.</Text>}
        </View>}
        <Text style={muted}>Preview only. No payment is sent from this screen yet.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}
