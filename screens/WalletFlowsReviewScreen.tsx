import { ArkadeMaintenanceSettings } from '../components/ArkadeMaintenanceSettings';
import type { ArkadeHealth } from '../services/protocols/arkadeMaintenance';
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAppTheme } from '../theme/ThemeProvider';
import { ScreenHeader } from '../components/ScreenHeader';
import { SegmentedTabs } from '../components/SegmentedTabs';
import { Button } from '../components/Button';
import type { ActivityPeriod } from '../utils/activity-search';
import HistoryScreen from './HistoryScreen';
import type { ActivityItem } from '../services/ActivityService';
import DepositSuccessOverlay from '../components/DepositSuccessOverlay';
import { ReceiveQr } from '../components/receive/ReceiveQr';
import { ReceiveStatus } from '../components/receive/ReceiveStatus';
import { ReceiveOutcomeCard } from '../components/receive/ReceiveOutcomeCard';
import { ReceiveRequestActions } from '../components/receive/ReceiveRequestActions';

/** Native UI review only: the QR is deliberately not a payable destination. */
export default function WalletFlowsReviewScreen({ navigation, route }: { navigation: any; route?: { params?: { page?: string; state?: string; query?: string; period?: string } } }) {
  const t = useAppTheme();
  const [page, setPage] = useState<'history' | 'receive' | 'arkade'>('history');
  const [state, setState] = useState<'watching' | 'expired' | 'pending' | 'confirmed'>('watching');
  const [generation, setGeneration] = useState(1);
  useEffect(() => {
    setPage(route?.params?.page === 'arkade' ? 'arkade' : route?.params?.page === 'receive' ? 'receive' : 'history');
    const next = route?.params?.state;
    setState(next === 'expired' || next === 'pending' || next === 'confirmed' ? next : 'watching');
  }, [route?.params]);
  const items = useMemo<ActivityItem[]>(() => [
    { id: 'demo-alice', type: 'send', source: 'payment', asset: 'BTC', assetTicker: 'sats', assetPrecision: 0, rawSats: 5000, amount: '5,000', contactName: 'Alice', status: 'confirmed', timestamp: Date.now() - 3600000, txid: 'demo-payment-alice', layer: 'LN', fee: 12, account: 'Spark', network: 'mainnet' },
    { id: 'demo-bob', type: 'receive', source: 'payment', asset: 'BTC', assetTicker: 'sats', assetPrecision: 0, rawSats: 25000, amount: '25,000', contactName: 'Bob', status: 'pending', timestamp: Date.now() - 60000, txid: 'demo-payment-bob', layer: 'LN', account: 'Spark' },
    { id: 'demo-coffee', type: 'send', source: 'payment', asset: 'BTC', assetTicker: 'sats', assetPrecision: 0, rawSats: 3500, amount: '3,500', contactName: 'Caffè Centrale', status: 'confirmed', timestamp: Date.now() - 15 * 86400000, txid: 'demo-coffee-123', layer: 'LN', fee: 0, account: 'Spark' },
  ], []);
  const demoHealth = useMemo<ArkadeHealth>(() => ({ checkedAt: Date.now(), count: 3, expiring: 1, recoverable: '1200', subdust: '20',
    balance: { available: 42000, total: 48200, boardingConfirmed: 5000, boardingUnconfirmed: 0, recoverable: 1200, pendingRecovery: 0, locked: 0, exited: 0 },
    nextExpiry: Date.now() + 2 * 86400000, enabled: true, endpoint: 'https://delegate.arkade.money', delegateFee: '0', eligible: 2, verified: 2, lastDelegatedAt: Date.now() - 3600000, persistent: true,
    coins: [{ id: 'example:0', sats: 42000, state: 'settled', expiry: Date.now() + 2 * 86400000 }] }), []);
  const fresh = () => { setGeneration(g => g + 1); setState('watching'); };
  return <SafeAreaView edges={['left', 'right', 'bottom']} style={{ flex: 1, backgroundColor: t.colors.background.primary }}>
    <ScreenHeader title={page === 'arkade' ? 'Arkade' : 'Activity & Receive'} onBack={() => navigation.goBack()} />
    <SegmentedTabs fill value={page} onChange={setPage} style={{ margin: t.spacing[4] }} options={[{ key: 'history', label: 'Activity' }, { key: 'receive', label: 'Receive' }, { key: 'arkade', label: 'Arkade' }]} />
    {page === 'arkade' ? <ScrollView contentContainerStyle={{ padding: t.spacing[4] }}><Text style={{ color: t.colors.warning[500], marginBottom: t.spacing[3] }}>ANTEPRIMA · Dati di esempio · Nessuna operazione sui fondi</Text><ArkadeMaintenanceSettings connected busy={false} onSave={() => {}} onBusyChange={() => {}} previewHealth={demoHealth} /></ScrollView> : page === 'history' ? <HistoryScreen previewItems={items} previewQuery={route?.params?.query} previewPeriod={['7d', '30d', '90d'].includes(route?.params?.period ?? '') ? route?.params?.period as ActivityPeriod : 'all'} /> : <ScrollView contentContainerStyle={{ padding: t.spacing[4], gap: t.spacing[4] }}>
      <Text style={{ color: t.colors.warning[500], fontSize: t.typography.fontSize.sm }}>PREVIEW · Example request · Cannot receive funds</Text>
      <Text style={{ color: t.colors.text.primary, fontSize: t.typography.fontSize['2xl'], fontWeight: '700' }}>Receive 5,000 sats</Text>
      {state === 'watching' ? <>
        <ReceiveQr value={`kaleidoswap-demo:non-payable-request-${generation}`} size={200} label="example code" />
        <ReceiveStatus visible status="watching" />
        <ReceiveRequestActions value={`kaleidoswap-demo:non-payable-request-${generation}`} label="example request" />
        <Button title="Simulate expiry" variant="secondary" onPress={() => setState('expired')} />
        <Button title="Simulate incoming payment" variant="secondary" onPress={() => setState('pending')} />
      </> : <>
        <ReceiveOutcomeCard status={state} onRefresh={fresh} onActivity={state === 'pending' ? undefined : () => setPage('history')} hint="Keep this screen open until the payment arrives." />
        {state === 'pending' && <Button title="Simulate confirmation" onPress={() => setState('confirmed')} />}
      </>}
    </ScrollView>}
    <DepositSuccessOverlay visible={page === 'receive' && state === 'confirmed'} ticker="BTC" amountLabel="5,000 sats" amountIsBalanceChange account="Arkade" network="Ark" onDone={fresh} onActivity={() => setPage('history')} />
  </SafeAreaView>;
}
