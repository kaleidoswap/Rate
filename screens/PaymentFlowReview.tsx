import React, { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useAppTheme } from '../theme/ThemeProvider';
import { Button } from '../components/Button';
import { SegmentedTabs } from '../components/SegmentedTabs';
import { SlideToConfirm } from '../components/SlideToConfirm';
import { PaymentReceiptDetails } from '../components/PaymentReceiptDetails';
import { PaymentOutcome } from '../components/payments/PaymentOutcome';
import DepositSuccessOverlay from '../components/DepositSuccessOverlay';
import type { PaymentAttempt } from '../services/kaleidoPay/attempts';

type Step = 'asset' | 'review' | 'pending' | 'unknown' | 'sent' | 'completed' | 'receive';
type Account = 'arkade' | 'rgb' | 'btc';
/** Development-only scenario player. State changes are local; no payment APIs or storage. */
export function PaymentFlowReview({ initialAccount = 'arkade', initialStep = 'review' }: { initialAccount?: Account; initialStep?: string }) {
  const t = useAppTheme();
  const [account, setAccount] = useState<Account>(initialAccount);
  const [step, setStep] = useState<Step>('review');
  const [asset, setAsset] = useState('USD');
  useEffect(() => { setAccount(initialAccount); setStep(['asset', 'review', 'pending', 'unknown', 'sent', 'completed', 'receive'].includes(initialStep) ? initialStep as Step : 'review'); }, [initialAccount, initialStep]);
  const rgb = account === 'rgb';
  const btc = account === 'btc';
  const amount = rgb ? `25.00 ${asset}` : '500 sats';
  const name = account === 'arkade' ? 'Arkade' : 'RGB wallet · Mutinynet';
  const fee = account === 'arkade' ? '0 sats' : '154 sats';
  const a: PaymentAttempt = { id: 'preview-only', sourceId: account === 'arkade' ? 'arkade' : btc ? 'rgb-btc' : 'rgb-asset', provider: name, accountName: name,
    status: step === 'unknown' ? 'unknown' : step === 'pending' ? 'pending' : 'completed', onchainConfirmed: btc && step === 'completed', destinationRail: btc ? 'btc' : rgb ? 'rgb' : 'ark',
    network: account === 'arkade' ? 'mainnet' : 'mutinynet', recipient: amount, recipientName: 'Alice · esempio', feeDisplay: fee,
    total: rgb ? `${amount} + ${fee}` : account === 'arkade' ? amount : '654 sats', createdAt: Date.now(), reference: step === 'unknown' ? undefined : 'demo-reference-not-a-transaction' };
  const label = { color: t.colors.text.secondary, fontSize: t.typography.fontSize.sm };
  if (!__DEV__) return null;
  return <>
    <ScrollView contentContainerStyle={{ padding: t.spacing[4], gap: t.spacing[4] }}>
      <Text style={{ ...label, color: t.colors.warning[500] }}>ANTEPRIMA · Dati simulati · Nessun fondo viene mosso</Text>
      <SegmentedTabs scrollable={false} fill value={account} options={[{ key: 'arkade', label: 'Arkade' }, { key: 'rgb', label: 'RGB asset' }, { key: 'btc', label: 'RGB BTC' }]} onChange={v => { setAccount(v); setStep(v === 'rgb' ? 'asset' : 'review'); }} />
      {step === 'asset' ? <>
        <Text style={{ color: t.colors.text.primary, fontSize: t.typography.fontSize['2xl'], fontWeight: '700' }}>RGB invoice</Text>
        <Text style={label}>Esempio senza asset prefissato: scegli un asset disponibile nel wallet.</Text>
        {['USD', 'KALEIDO'].map(value => <Button key={value} title={`${value}${asset === value ? ' ✓' : ''}`} variant={asset === value ? 'primary' : 'secondary'} onPress={() => setAsset(value)} />)}
        <Button title="Continue" onPress={() => setStep('review')} />
      </> : step === 'review' ? <>
        <Text style={{ color: t.colors.text.primary, fontSize: t.typography.fontSize['3xl'], fontWeight: '700', textAlign: 'center' }}>{amount}</Text>
        <Text style={{ ...label, textAlign: 'center' }}>to Alice · esempio</Text>
        <PaymentReceiptDetails details={{ amount, recipient: a.recipientName, fees: fee, total: a.total, account: name }} />
        <SlideToConfirm label={`Pay ${amount}`} onConfirm={() => setStep('pending')} />
        {rgb && <Button title="Change asset" variant="ghost" onPress={() => setStep('asset')} />}
      </> : <>
        <PaymentOutcome key={`${account}-${step}`} attempt={a} statusChecking={step === 'pending'} />
        {step === 'pending' || step === 'unknown' ? <Button title={step === 'unknown' ? 'Simula verifica riuscita' : 'Simula esito positivo'} onPress={() => setStep(btc ? 'sent' : 'completed')} /> : btc && step === 'sent' ? <Button title="Simula conferma nel blocco" onPress={() => setStep('completed')} /> : <Button title="Simula ricezione" onPress={() => setStep('receive')} />}
        {step === 'pending' && <Button title="Simula esito non verificato" variant="ghost" onPress={() => setStep('unknown')} />}
        <Button title="Nuovo pagamento di esempio" variant="secondary" onPress={() => setStep('review')} />
      </>}
      <Text style={label}>Controlli anteprima</Text>
      <Button title="Mostra ricezione" variant="ghost" onPress={() => setStep('receive')} />
    </ScrollView>
    <DepositSuccessOverlay visible={step === 'receive'} amountLabel={amount} ticker={rgb ? asset : 'BTC'} account={account === 'arkade' ? 'Arkade' : 'RGB wallet'} network={account === 'arkade' ? 'Ark' : 'Mutinynet'} onDone={() => setStep('review')} onActivity={() => setStep('completed')} />
  </>;
}
