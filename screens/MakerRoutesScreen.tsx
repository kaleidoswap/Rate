import { loadPaymentAttempt, type PaymentAttempt } from '../services/kaleidoPay/attempts';
import { SwapComposer } from '../components/payments/SwapComposer';
import SendScreen from './SendScreen';
import { decodeTarget } from '../services/kaleidoPay/target';
import { MakerReceiveStatus } from '../components/payments/MakerReceiveStatus';
import { useForegroundClock } from '../hooks/useForegroundClock';
import { MakerRouteList } from '../components/payments/MakerRouteList';
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useIsFocused } from '@react-navigation/native';
import { ScreenHeader } from '../components/ScreenHeader';
import { ReceiveRequestActions } from '../components/receive/ReceiveRequestActions';
import { useAppTheme } from '../theme/ThemeProvider';
import { useAppSelector } from '../store/hooks';
import { arkadeReceiveOptions, receiveAccountChain, kaleidoswapMakerUrl } from '../services/kaleidoPay/connect';
import { getPayOptions } from '../services/kaleidoPay/payOptions';
import { createArkadeLightningReceive, claimArkadeLightningReceive, type ArkadeLightningReceive } from '../services/kaleidoPay/arkadeIntents';
import { loadMakerCatalog, parseMakerReceiveReceipt, type MakerCatalog, type MakerRoute } from '../services/makerRoutes';


export default function MakerRoutesScreen({ navigation, unified = false, onOtherAssets }: { navigation: any; unified?: boolean; onOtherAssets?: () => void }) {
  const walletId = useAppSelector(s => s.wallet.activeWallet?.id);
  const opts = arkadeReceiveOptions();
  const network = opts?.network ?? receiveAccountChain('RGB') ?? receiveAccountChain('SPARK') ?? 'mutinynet';
  const url = opts?.makerUrl ?? kaleidoswapMakerUrl(network, getPayOptions().makerUrl);
  // Remount on account/network changes so an old invoice cannot appear for a new wallet.
  return <MakerRoutesSession key={`${walletId}:${network}:${url}`} walletId={walletId} network={network} url={url ?? undefined} navigation={navigation} unified={unified} onOtherAssets={onOtherAssets} />;
}

function MakerRoutesSession({ walletId, network, url, navigation, unified, onOtherAssets }: { unified?: boolean; onOtherAssets?: () => void; walletId?: number; network: MakerCatalog['network']; url?: string; navigation: any }) {
  const t = useAppTheme(); const focused = useIsFocused();
  const now = useForegroundClock(focused);
  const [catalog, setCatalog] = useState<MakerCatalog>();
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [amount, setAmount] = useState(''); const [selection, setSelection] = useState<MakerRoute>();
  const [receipt, setReceipt] = useState<ArkadeLightningReceive>(); const [phase, setPhase] = useState('');
  const [journalReady, setJournalReady] = useState(false);
  const [browseRoutes, setBrowseRoutes] = useState(!!unified);
  const [sendReview, setSendReview] = useState<string>();
  const [lastPayment, setLastPayment] = useState<PaymentAttempt | null>(null);
  const [resumeId, setResumeId] = useState<string>();
  useEffect(() => {
    let active = true;
    if (unified && walletId != null) void loadPaymentAttempt(walletId).then(p => { if (active) setLastPayment(p?.sourceId === 'arkade' ? p : null); }).catch(() => {});
    return () => { active = false; };
  }, [walletId, unified, focused, sendReview, resumeId]);
  const flight = useRef(false); const alive = useRef(true);
  const key = `rate-maker-receive:${walletId}:${network}:${url}`;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(key).then(raw => {
      if (!active) return;
      if (raw) { setReceipt(parseMakerReceiveReceipt(raw)); setPhase('checking'); }
      setJournalReady(true);
    }).catch(() => { if (active) setError('Could not restore the previous request. Reopen this screen before creating another.'); });
    return () => { active = false; };
  }, [key]);
  const refresh = async () => {
    if (!url) { setError('Configure a maker for this wallet network in Settings.'); return; }
    setBusy(true); setError(''); setCatalog(undefined);
    try { const next = await loadMakerCatalog(url, network); if (alive.current) setCatalog(next); }
    catch (e) { if (alive.current) setError(e instanceof Error ? e.message : 'Could not load maker routes.'); }
    finally { if (alive.current) setBusy(false); }
  };
  // Restoring a receipt must not depend on the catalogue being online.
  useEffect(() => { if (focused && journalReady && (!receipt || browseRoutes)) void refresh(); }, [focused, url, network, journalReady, !!receipt, browseRoutes]);
  useEffect(() => {
    if (!receipt || !focused) return;
    let stopped = false, running = false;
    const tick = async () => {
      if (stopped || running) return;
      const opts = arkadeReceiveOptions();
      if (!opts || opts.network !== network || opts.makerUrl !== url) return;
      running = true;
      try {
        const next = await claimArkadeLightningReceive(opts.wallet, opts.arkServerUrl, receipt.rfqId);
        if (!stopped && next) { setPhase(next); if (['settled', 'failed', 'refunded', 'cancelled'].includes(next)) stopped = true; }
      } catch { if (!stopped) setPhase('checking'); } finally { running = false; }
    };
    void tick(); const timer = setInterval(() => void tick(), 5000);
    return () => { stopped = true; clearInterval(timer); };
  }, [receipt, focused, network, url]);
  const choose = (r: MakerRoute) => {
    if (receipt) { setError('Check the existing request before creating another.'); return; }
    if (r.action === 'send-arkade') navigation.navigate('Send', { makerNetwork: network, makerUrl: url });
    else setSelection(r);
  };
  const generate = async (chosen = selection) => {
    if (flight.current || receipt || !journalReady || !url || !chosen || walletId == null) return;
    const sats = /^\d+$/.test(amount) ? Number(amount) : NaN;
    if (!Number.isSafeInteger(sats) || sats < chosen.min || sats > chosen.max) { setError('Enter a whole-satoshi amount within the published range.'); return; }
    flight.current = true; setBusy(true); setError('');
    try {
      const current = await loadMakerCatalog(url, network);
      const fresh = current.routes.find(r => r.id === chosen.id && r.action === 'receive-arkade');
      if (!fresh) throw new Error('This route is no longer available.');
      if (sats < fresh.min || sats > fresh.max) throw new Error('The maker changed its limits. Refresh routes and review the amount.');
      const opts = arkadeReceiveOptions();
      if (!opts || opts.network !== network || opts.makerUrl !== url) throw new Error('The Arkade wallet or maker changed. Reopen this screen.');
      const next = await createArkadeLightningReceive({ ...opts, providerId: 'kaleidoswap' }, sats);
      // SDK persists recovery before it returns; retain the public invoice for UI restoration too.
      if (alive.current) { setReceipt(next); setPhase('prepared'); }
      await AsyncStorage.setItem(key, JSON.stringify(next));
    } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : 'Could not create the request.'); }
    finally { flight.current = false; if (alive.current) setBusy(false); }
  };
  const review = (r: MakerRoute, invoice: string) => {
    setError('');
    if (r.action === 'receive-arkade') { void generate(r).then(() => setBrowseRoutes(false)); return; }
    try {
      const target = decodeTarget(invoice);
      if (target.kind !== 'bolt11') throw new Error('Paste a Lightning invoice for this swap.');
      if (!target.networks?.includes(network)) throw new Error('This invoice belongs to another network.');
      if (target.amountSat != null && target.amountSat !== Number(amount)) throw new Error(`The invoice requests ${target.amountSat.toLocaleString()} sats. Update the amount before reviewing.`);
      setSendReview(invoice);
    } catch (e) { setError(e instanceof Error ? e.message : 'Invalid Lightning invoice.'); }
  };
  if (sendReview || resumeId) return <SendScreen navigation={{ ...navigation, goBack: () => { setSendReview(undefined); setResumeId(undefined); } }} route={{ params: { prefilledAddress: sendReview, prefilledAmountSat: Number(amount), makerNetwork: network, makerUrl: url, swapContext: true, resumePayment: !!resumeId, paymentAttemptId: resumeId } }} />;
  const connected = !!arkadeReceiveOptions() && walletId != null;
  const text = { color: t.colors.text.primary, fontSize: t.typography.fontSize.base };
  return <SafeAreaView style={{ flex: 1, backgroundColor: t.colors.background.primary }}>
    <ScreenHeader title={unified ? "Swap" : "Maker routes"} subtitle={unified ? "Asset, network and fees in one place" : `KaleidoSwap · ${network}`} />
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: t.spacing[4], gap: t.spacing[4] }}>
      <Text style={{ ...text, fontSize: t.typography.fontSize['3xl'], fontWeight: '700' }}>{unified ? 'Swap your way' : 'Move your bitcoin'}</Text>
      <Text style={{ color: t.colors.text.secondary }}>{unified ? 'Choose the asset and network on each side.' : 'Lightning and Arkade, connected. Choose what you want to do.'}</Text>
      {!!error && <Text accessibilityRole="alert" style={{ color: t.colors.error[500] }}>{error}</Text>}
      {network !== 'mainnet' && <Text style={{ color: t.colors.warning[500], fontSize: t.typography.fontSize.sm }}>Test network · {network === 'mutinynet' ? 'Mutinynet' : network}</Text>}
      {busy && (!receipt || browseRoutes) && <ActivityIndicator accessibilityLabel="Loading maker" />}
      {!unified && receipt && browseRoutes && <TouchableOpacity accessibilityRole="button" onPress={() => setBrowseRoutes(false)} style={{ padding: t.spacing[4], borderRadius: t.borderRadius.lg, backgroundColor: t.colors.surface.highlight, minHeight: 48 }}><Text style={{ color: t.colors.primary[500] }}>Saved request · View status</Text><Text style={{ color: t.colors.text.secondary }}>Your request is kept. Check its status before starting another.</Text></TouchableOpacity>}
      {!unified && (!receipt || browseRoutes) && catalog && <MakerRouteList catalog={catalog} connected={connected} onChoose={choose} onSavedRequest={receipt ? () => setBrowseRoutes(false) : undefined} />}
      {unified && lastPayment && <TouchableOpacity accessibilityRole="button" onPress={() => setResumeId(lastPayment.id)} style={{ minHeight: 48, justifyContent: 'center' }}><Text style={{ color: t.colors.primary[500] }}>Last Arkade payment · View status</Text></TouchableOpacity>}
      {unified && (!receipt || browseRoutes) && <SwapComposer catalog={catalog} amount={amount} onAmount={setAmount} onRoute={setSelection} onReview={review} busy={busy || !journalReady} connected={connected} savedRequest={!!receipt} onSavedRequest={() => setBrowseRoutes(false)} onOtherAssets={onOtherAssets} />}
      {!unified && !receipt && selection && <View style={{ gap: t.spacing[3] }}>
        <Text style={text}>Amount to receive in Arkade (sats)</Text>
        <TextInput accessibilityLabel="Amount to receive in Arkade sats" keyboardType="number-pad" value={amount} onChangeText={setAmount} style={{ ...text, minHeight: 48, padding: t.spacing[3], backgroundColor: t.colors.surface.primary, borderRadius: t.borderRadius.lg }} />
        <TouchableOpacity accessibilityRole="button" disabled={busy || !journalReady} onPress={() => void generate()} accessibilityState={{ disabled: busy || !journalReady }} style={{ minHeight: 52, borderRadius: t.borderRadius.lg, backgroundColor: busy || !journalReady ? t.colors.surface.secondary : t.colors.primary[500], alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: t.colors.text.inverse, fontWeight: '600' }}>Generate Lightning request</Text></TouchableOpacity>
      </View>}
      {receipt && !browseRoutes && <MakerReceiveStatus receipt={receipt} phase={phase} connected={connected} now={now}>
        {connected && phase !== 'checking' && receipt.expiresAt * 1000 > now && phase !== 'settled' && !['failed', 'refunded', 'cancelled'].includes(phase) && <ReceiveRequestActions value={receipt.invoice} network={network} showValue />}
        {['settled', 'failed', 'refunded', 'cancelled'].includes(phase) && <TouchableOpacity accessibilityRole="button" onPress={() => { void AsyncStorage.removeItem(key).then(() => { setReceipt(undefined); setSelection(undefined); setPhase(''); setBrowseRoutes(false); }).catch(() => setError('Could not close the saved request.')); }} style={{ minHeight: 52, borderRadius: t.borderRadius.lg, backgroundColor: t.colors.primary[500], alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: t.colors.text.inverse, fontWeight: '600' }}>Done</Text></TouchableOpacity>}
        <TouchableOpacity accessibilityRole="button" onPress={() => setBrowseRoutes(true)} style={{ minHeight: 48, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: t.colors.primary[500] }}>{unified ? 'Back to Swap' : 'Browse routes'}</Text></TouchableOpacity>
      </MakerReceiveStatus>}
      {!busy && !receipt && <TouchableOpacity accessibilityRole="button" onPress={() => void refresh()} style={{ minHeight: 48, justifyContent: 'center' }}><Text style={{ color: t.colors.primary[500] }}>Refresh routes</Text></TouchableOpacity>}
    </ScrollView>
  </SafeAreaView>;
}
