import React, { useState } from 'react';
import { ScrollView, View, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAppTheme } from '../theme/ThemeProvider';
import { ScreenHeader } from '../components/ScreenHeader';
import { SegmentedTabs } from '../components/SegmentedTabs';
import { BackupWordCheck, backupWordsMatch } from '../components/BackupWordCheck';
import { BalanceCard } from '../components/BalanceCard';
import { PaymentReceiptDetails } from '../components/PaymentReceiptDetails';
import { Button } from '../components/Button';

/** Development only. Real UI components, public sample words and fictional funds; no wallet operations. */
export default function WalletReviewScreen({ navigation }: { navigation: any }) {
  const t = useAppTheme();
  const [page, setPage] = useState<'backup' | 'balance' | 'receipt'>('backup');
  const [answers, setAnswers] = useState(['', '', '']);
  const [stale, setStale] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [payment, setPayment] = useState<'review' | 'unknown' | 'completed'>('review');
  const matched = backupWordsMatch('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about', answers);
  const text = { color: t.colors.text.secondary, fontSize: t.typography.fontSize.base };
  const title = { color: t.colors.text.primary, fontSize: t.typography.fontSize['2xl'], fontWeight: '700' as const };
  const details = { amount: '5,000 sats', recipient: 'Alice', fees: '12 sats', total: '5,012 sats', account: 'Spark', ...(payment !== 'review' ? { createdAt: 1791649800000, reference: 'demo-payment-001' } : {}) };
  return <SafeAreaView edges={['left', 'right', 'bottom']} style={{ flex: 1, backgroundColor: t.colors.background.primary }}>
    <ScreenHeader title="Wallet review" onBack={() => navigation.goBack()} />
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: t.spacing[5], gap: t.spacing[4] }}>
      <Text style={{ ...text, color: t.colors.warning[500], fontSize: t.typography.fontSize.sm }}>PREVIEW · Example data · No funds moved</Text>
      <SegmentedTabs fill value={page} onChange={setPage} options={[{ key: 'backup', label: 'Backup' }, { key: 'balance', label: 'Balance' }, { key: 'receipt', label: 'Payment' }]} />
      {page === 'backup' && <>
        <Text style={title}>Check your backup</Text>
        <BackupWordCheck answers={answers} onChange={setAnswers} />
        <Text style={text}>{matched ? 'All three words match. Your backup is checked.' : answers.every(a => a.trim()) ? 'The words do not match yet. Check your saved copy.' : 'Demo only: each requested word is “abandon”. Never use these sample words for a wallet.'}</Text>
        <Button title="Continue" disabled={!matched} onPress={() => setPage('balance')} />
        <Text style={{ ...title, fontSize: t.typography.fontSize.lg }}>Two parts to your backup</Text>
        <Text style={text}>Your recovery phrase restores your wallet keys. RGB assets also need their encrypted data backup.</Text>
        <Text style={text}>Security & backup → RGB data backup lets you check the latest backup, retry or export a copy.</Text>
      </>}
      {page === 'balance' && <>
        <BalanceCard totalBalance={250000} availableBtc={235000} pendingBtc={15000} stale={stale} lastUpdatedAt={1791649800000}
          hideAmounts={hidden} primaryText={hidden ? '••••' : '250,000'} primaryUnitLabel="sats" secondaryText={hidden ? '••••' : '≈ $250.00'}
          bitcoinUnit="sats" onRefresh={() => setStale(false)} refreshing={false}
          formatSatoshis={n => n.toLocaleString('en-US')} formatUSD={n => (n / 1000).toFixed(2)}
          onChainBalance={0} lightningBalance={0} byProtocol={{ SPARK: { confirmed: 200000, unconfirmed: 0, total: 200000 }, ARKADE: { confirmed: 35000, unconfirmed: 15000, total: 50000 } }} />
        {stale && <Text style={{ ...text, color: t.colors.warning[500] }}>Could not refresh Arkade. Your total may be incomplete.</Text>}
        <Button title={stale ? 'Show updated balance' : 'Simulate unavailable account'} variant="secondary" onPress={() => setStale(!stale)} />
        <Button title={hidden ? 'Show amounts' : 'Hide amounts'} variant="secondary" onPress={() => setHidden(!hidden)} />
        <Button title="Review example payment" onPress={() => setPage('receipt')} />
      </>}
      {page === 'receipt' && <>
        <Text style={title}>{payment === 'review' ? 'Review payment' : payment === 'unknown' ? 'Payment needs checking' : 'Payment completed'}</Text>
        <Text style={text}>{payment === 'unknown' ? 'Do not send again. Verify the outcome of this payment first.' : payment === 'completed' ? '5,000 sats sent to Alice · simulated' : 'Review the recipient and all costs before approving.'}</Text>
        <PaymentReceiptDetails details={details} />
        <Text style={{ ...text, fontSize: t.typography.fontSize.sm }}>Fees and total are from the approved quote. The provider may settle an estimated fee differently.</Text>
        {payment === 'review' && <Button title="Confirm demo payment" onPress={() => setPayment('unknown')} />}
        {payment === 'unknown' && <Button title="Verify payment" onPress={() => setPayment('completed')} />}
        {payment === 'completed' && <Button title="Review another example" variant="secondary" onPress={() => setPayment('review')} />}
      </>}
    </ScrollView>
  </SafeAreaView>;
}
