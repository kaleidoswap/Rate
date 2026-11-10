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


export default function MakerRoutesScreen({ navigation }: { navigation: any }) {
  const walletId = useAppSelector(s => s.wallet.activeWallet?.id);
  const opts = arkadeReceiveOptions();
  const network = opts?.network ?? receiveAccountChain('RGB') ?? receiveAccountChain('SPARK') ?? 'mutinynet';
  const url = opts?.makerUrl ?? kaleidoswapMakerUrl(network, getPayOptions().makerUrl);
  // Remount on account/network changes so an old invoice cannot appear for a new wallet.
  return <MakerRoutesSession key={`${walletId}:${network}:${url}`} walletId={walletId} network={network} url={url ?? undefined} navigation={navigation} />;
}

function MakerRoutesSession({ walletId, network, url, navigation }: { walletId?: number; network: MakerCatalog['network']; url?: string; navigation: any }) {
  const t = useAppTheme(); const focused = useIsFocused();
  const now = useForegroundClock(focused);
  const [catalog, setCatalog] = useState<MakerCatalog>();
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [amount, setAmount] = useState(''); const [selection, setSelection] = useState<MakerRoute>();
  const [receipt, setReceipt] = useState<ArkadeLightningReceive>(); const [phase, setPhase] = useState('');
  const [journalReady, setJournalReady] = useState(false);
  const flight = useRef(false); const alive = useRef(true);
  const key = `rate-maker-receive:${walletId}:${network}:${url}`;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(key).then(raw => {
      if (!active) return;
      if (raw) { setReceipt(parseMakerReceiveReceipt(raw)); }
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
  useEffect(() => { if (focused) void refresh(); }, [focused, url, network]);
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
  const generate = async () => {
    if (flight.current || receipt || !journalReady || !url || !selection || walletId == null) return;
    const sats = /^\d+$/.test(amount) ? Number(amount) : NaN;
    if (!Number.isSafeInteger(sats) || sats < selection.min || sats > selection.max) { setError('Enter a whole-satoshi amount within the published range.'); return; }
    flight.current = true; setBusy(true); setError('');
    try {
      const current = await loadMakerCatalog(url, network);
      const fresh = current.routes.find(r => r.id === selection.id && r.action === 'receive-arkade');
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
  const connected = !!arkadeReceiveOptions() && walletId != null;
  const text = { color: t.colors.text.primary, fontSize: t.typography.fontSize.base };
  return <SafeAreaView style={{ flex: 1, backgroundColor: t.colors.background.primary }}>
    <ScreenHeader title="Maker routes" subtitle={`KaleidoSwap · ${network}`} />
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: t.spacing[4], gap: t.spacing[4] }}>
      <Text style={{ ...text, fontSize: t.typography.fontSize['2xl'], fontWeight: '700' }}>Move between networks</Text>
      <Text style={{ color: t.colors.text.secondary }}>Choose an available route. Review the complete total before paying.</Text>
      {!!error && <Text accessibilityRole="alert" style={{ color: t.colors.error[500] }}>{error}</Text>}
      {busy && <ActivityIndicator accessibilityLabel="Loading maker" />}
      {!receipt && catalog && <MakerRouteList catalog={catalog} connected={connected} onChoose={choose} />}
      {!receipt && selection && <View style={{ gap: t.spacing[3] }}>
        <Text style={text}>Amount to receive in Arkade (sats)</Text>
        <TextInput accessibilityLabel="Amount to receive in Arkade sats" keyboardType="number-pad" value={amount} onChangeText={setAmount} style={{ ...text, minHeight: 48, padding: t.spacing[3], backgroundColor: t.colors.surface.primary, borderRadius: t.borderRadius.lg }} />
        <TouchableOpacity accessibilityRole="button" disabled={busy || !journalReady} onPress={() => void generate()} style={{ minHeight: 48, justifyContent: 'center' }}><Text style={{ color: t.colors.primary[500] }}>Generate Lightning request</Text></TouchableOpacity>
      </View>}
      {receipt && <View style={{ gap: t.spacing[3] }}>
        <Text style={text}>{phase === 'settled' ? 'Received in Arkade' : phase === 'funded' ? 'Payment received · claiming' : phase === 'checking' ? 'Connection interrupted · checking saved request' : ['failed', 'refunded', 'cancelled'].includes(phase) ? 'Request closed' : 'Waiting for payment or confirmation'}</Text>
        <Text style={text}>You receive {receipt.amountSats.toLocaleString()} sats · sender pays {receipt.payAmountSats.toLocaleString()} sats</Text>
        <Text style={{ color: t.colors.text.secondary }}>Provider: {receipt.provider}. Requests are restored after reopening.</Text>
        {receipt.expiresAt * 1000 <= now && phase !== 'settled' && <Text style={{ color: t.colors.text.secondary }}>Payment window closed. Checking the existing swap; do not pay this invoice again.</Text>}
        {receipt.expiresAt * 1000 > now && phase !== 'settled' && !['failed', 'refunded', 'cancelled'].includes(phase) && <ReceiveRequestActions value={receipt.invoice} network={network} showValue />}
        {['settled', 'failed', 'refunded', 'cancelled'].includes(phase) && <TouchableOpacity accessibilityRole="button" onPress={() => { void AsyncStorage.removeItem(key).then(() => { setReceipt(undefined); setSelection(undefined); setPhase(''); }).catch(() => setError('Could not close the saved request.')); }} style={{ minHeight: 48, justifyContent: 'center' }}><Text style={{ color: t.colors.primary[500] }}>Done</Text></TouchableOpacity>}
      </View>}
      {!busy && !receipt && <TouchableOpacity accessibilityRole="button" onPress={() => void refresh()} style={{ minHeight: 48, justifyContent: 'center' }}><Text style={{ color: t.colors.primary[500] }}>Refresh routes</Text></TouchableOpacity>}
    </ScrollView>
  </SafeAreaView>;
}
