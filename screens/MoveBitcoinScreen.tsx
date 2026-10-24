// screens/MoveBitcoinScreen.tsx
//
// Move bitcoin between Spark and Arkade over Lightning, through the KaleidoSwap
// maker or another Arkade Intents solver (services/layerSwap/sparkArkade.ts).
// Form → quote review (with the quote's deadline) → progress → result.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme, protocolColor, protocolTint } from '../theme';
import { Card, Button, Input, MainHeader, AmountText, Callout } from '../components';
import {
  LAYER_SWAP_LABEL, defaultLayerSwapDeps, executeLayerSwap, layerSwapNetwork, quoteLayerSwap,
  type LayerSwapDirection, type LayerSwapOutcome, type LayerSwapQuote, type LayerSwapStep,
} from '../services/layerSwap/sparkArkade';

interface Props {
  navigation: any;
  route?: { params?: { direction?: LayerSwapDirection; amountSat?: number } };
}

type Phase = 'form' | 'quoting' | 'review' | 'running' | 'result';

const sats = (n: number) => `${n.toLocaleString()} sats`;
const PROTOCOL: Record<string, 'SPARK' | 'ARKADE'> = { Spark: 'SPARK', Arkade: 'ARKADE' };

const STEP_LABEL: Record<LayerSwapStep, string> = {
  paying: 'Paying the Lightning invoice',
  settling: 'Waiting for the swap to settle',
  claiming: 'Claiming into Arkade',
};

export default function MoveBitcoinScreen({ navigation, route }: Props) {
  const deps = useMemo(() => defaultLayerSwapDeps(), []);
  const [direction, setDirection] = useState<LayerSwapDirection>(route?.params?.direction ?? 'spark-to-arkade');
  const [amount, setAmount] = useState(route?.params?.amountSat ? String(route.params.amountSat) : '');
  const [phase, setPhase] = useState<Phase>('form');
  const [quote, setQuote] = useState<LayerSwapQuote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<LayerSwapStep>('paying');
  const [outcome, setOutcome] = useState<LayerSwapOutcome | null>(null);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const quoteRequest = useRef(0);
  const abort = useRef<AbortController | null>(null);

  const availability = layerSwapNetwork(deps);
  const { from, to } = LAYER_SWAP_LABEL[direction];
  const amountSat = /^\d+$/.test(amount) ? Number(amount) : 0;

  // The review shows how long the quote holds; past it, Confirm asks for a new one.
  useEffect(() => {
    if (phase !== 'review') return;
    const timer = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(timer);
  }, [phase]);
  useEffect(() => () => abort.current?.abort(), []);

  const secondsLeft = quote ? quote.expiresAt - now : 0;
  const expired = phase === 'review' && secondsLeft <= 0;

  const getQuote = useCallback(async () => {
    const request = ++quoteRequest.current;
    setError(null);
    setPhase('quoting');
    try {
      const q = await quoteLayerSwap(deps, direction, amountSat);
      if (request !== quoteRequest.current) return;
      setQuote(q);
      setNow(Math.floor(Date.now() / 1000));
      setPhase('review');
    } catch (e) {
      if (request !== quoteRequest.current) return;
      setError(e instanceof Error ? e.message : 'Could not get a quote.');
      setPhase('form');
    }
  }, [deps, direction, amountSat]);

  const confirm = useCallback(async () => {
    if (!quote) return;
    abort.current = new AbortController();
    setError(null);
    setStep('paying');
    setPhase('running');
    try {
      const result = await executeLayerSwap(deps, quote, { onStep: setStep, signal: abort.current.signal });
      setOutcome(result);
      setPhase('result');
    } catch (e) {
      // Thrown only when nothing was paid.
      setError(e instanceof Error ? e.message : 'The move could not start. Nothing was sent.');
      setPhase('form');
    }
  }, [deps, quote]);

  const flip = () => {
    quoteRequest.current++;
    setDirection(d => (d === 'spark-to-arkade' ? 'arkade-to-spark' : 'spark-to-arkade'));
    setQuote(null);
    setError(null);
    setPhase('form');
  };

  const restart = () => { setQuote(null); setOutcome(null); setAmount(''); setPhase('form'); };

  const renderWallet = (name: string, label: string) => (
    <View style={styles.walletRow}>
      <View style={[styles.walletDot, { backgroundColor: protocolTint(PROTOCOL[name]) }]}>
        <View style={[styles.walletDotInner, { backgroundColor: protocolColor(PROTOCOL[name]) }]} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.walletLabel}>{label}</Text>
        <Text style={styles.walletName}>{name}</Text>
      </View>
    </View>
  );

  const renderForm = () => (
    <>
      <Card style={styles.card}>
        {renderWallet(from, 'From')}
        <View style={styles.flipRow}>
          <View style={styles.flipLine} />
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Swap direction" onPress={flip} style={styles.flipButton} disabled={phase === 'quoting'}>
            <Ionicons name="swap-vertical" size={18} color={theme.colors.primary[500]} />
          </TouchableOpacity>
          <View style={styles.flipLine} />
        </View>
        {renderWallet(to, 'To')}
      </Card>

      <Input
        label={`Amount to receive on ${to} (sats)`}
        value={amount}
        onChangeText={t => { quoteRequest.current++; setAmount(t.replace(/[^0-9]/g, '')); setError(null); if (phase === 'quoting') setPhase('form'); }}
        keyboardType="number-pad"
        placeholder="50,000"
        editable={phase !== 'quoting'}
      />

      <Text style={styles.hint}>
        Moves over Lightning through the KaleidoSwap maker (or another Arkade Intents provider). You see the fee before confirming.
      </Text>

      {'unavailable' in availability && <Callout tone="warning" message={availability.unavailable} style={styles.gap} />}
      {error && <Callout tone="error" message={error} style={styles.gap} />}

      <Button
        title={phase === 'quoting' ? 'Getting a quote…' : 'Get quote'}
        onPress={getQuote}
        loading={phase === 'quoting'}
        disabled={phase === 'quoting' || amountSat <= 0 || 'unavailable' in availability}
        fullWidth
        style={styles.gap}
      />
    </>
  );

  const row = (label: string, value: string, color?: string) => (
    <View style={styles.row} key={label}>
      <Text style={styles.rowLabel}>{label}</Text>
      <AmountText style={[styles.rowValue, color ? { color } : null]}>{value}</AmountText>
    </View>
  );

  const renderReview = () => quote && (
    <>
      <Card style={styles.card}>
        <Text style={styles.eyebrow}>{`FROM ${from.toUpperCase()}`}</Text>
        <AmountText style={styles.big}>{sats(quote.spendSat)}</AmountText>
        <View style={styles.divider} />
        <Text style={styles.eyebrow}>{`TO ${to.toUpperCase()}`}</Text>
        <AmountText style={[styles.big, { color: theme.colors.primary[500] }]}>{sats(quote.receiveSat)}</AmountText>
      </Card>
      <Card style={styles.card}>
        {row('Fees (provider + network)', sats(quote.feeSat))}
        {row('Provider', quote.provider)}
        {row('Network', quote.network)}
        {quote.estimatedSeconds ? row('Usually takes', `~${quote.estimatedSeconds}s`) : null}
        {row('Quote valid for', expired ? 'expired' : `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, '0')}`,
          secondsLeft <= 10 ? theme.colors.warning[500] : undefined)}
      </Card>
      <Callout
        tone="info"
        message={direction === 'spark-to-arkade'
          ? 'Spark pays the provider’s Lightning invoice; Arkade claims the bitcoin. If the provider does not deliver, the payment returns to Spark.'
          : 'Arkade funds a swap that pays your Spark invoice. If it does not complete, your Arkade funds are refunded.'}
        style={styles.gap}
      />
      <View style={[styles.buttons, styles.gap]}>
        <Button title="Cancel" variant="secondary" onPress={() => { setQuote(null); setPhase('form'); }} style={{ flex: 1 }} />
        <Button title={expired ? 'New quote' : 'Confirm move'} onPress={expired ? getQuote : confirm} style={{ flex: 2 }} />
      </View>
    </>
  );

  const renderRunning = () => (
    <Card style={[styles.card, styles.center]}>
      <ActivityIndicator size="large" color={theme.colors.primary[500]} />
      <Text style={styles.title}>{STEP_LABEL[step]}</Text>
      <Text style={styles.hint}>
        {quote ? `${sats(quote.receiveSat)} from ${from} to ${to}. ` : ''}
        You can leave this screen: the move finishes in the background.
      </Text>
    </Card>
  );

  const renderResult = () => outcome && (
    <Card style={[styles.card, styles.center]}>
      <Ionicons
        name={outcome.status === 'completed' ? 'checkmark-circle' : outcome.status === 'pending' ? 'time-outline' : 'close-circle'}
        size={56}
        color={outcome.status === 'completed' ? theme.colors.primary[500] : outcome.status === 'pending' ? theme.colors.warning[500] : theme.colors.error[500]}
      />
      <Text style={styles.title}>
        {outcome.status === 'completed' ? `Moved to ${to}` : outcome.status === 'pending' ? 'Still in progress' : 'Move did not complete'}
      </Text>
      {quote && outcome.status === 'completed' && <AmountText style={styles.big}>{`+ ${sats(quote.receiveSat)}`}</AmountText>}
      <Text style={styles.hint}>
        {outcome.status === 'pending'
          ? `The swap is still settling. It finishes on its own and your ${to} balance updates when it does.`
          : outcome.status === 'failed' ? outcome.reason : `Your ${to} balance updates in a moment.`}
      </Text>
      <Button title="Done" onPress={() => navigation.goBack()} fullWidth style={styles.gap} />
      {outcome.status === 'failed' && <Button title="Try again" variant="ghost" onPress={restart} fullWidth />}
    </Card>
  );

  return (
    <View style={styles.container}>
      <MainHeader title="Move bitcoin" subtitle="Spark ⇄ Arkade" onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {(phase === 'form' || phase === 'quoting') && renderForm()}
        {phase === 'review' && renderReview()}
        {phase === 'running' && renderRunning()}
        {phase === 'result' && renderResult()}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background.secondary },
  content: { padding: theme.spacing[4], paddingBottom: theme.spacing[8] },
  card: { marginBottom: theme.spacing[3] },
  center: { alignItems: 'center', gap: theme.spacing[3], paddingVertical: theme.spacing[6] },
  gap: { marginTop: theme.spacing[3] },
  walletRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing[3] },
  walletDot: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  walletDotInner: { width: 12, height: 12, borderRadius: 6 },
  walletLabel: { color: theme.colors.text.secondary, fontSize: theme.typography.fontSize.xs },
  walletName: { color: theme.colors.text.primary, fontSize: theme.typography.fontSize.lg, fontWeight: '600' },
  flipRow: { flexDirection: 'row', alignItems: 'center', marginVertical: theme.spacing[2] },
  flipLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: theme.colors.border.light },
  flipButton: {
    width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center',
    backgroundColor: theme.colors.surface.secondary, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border.light,
  },
  hint: { color: theme.colors.text.secondary, fontSize: theme.typography.fontSize.sm, lineHeight: 20, textAlign: 'left' },
  eyebrow: { color: theme.colors.text.secondary, fontSize: theme.typography.fontSize.xs, letterSpacing: 0.5 },
  big: { color: theme.colors.text.primary, fontSize: theme.typography.fontSize['2xl'], fontWeight: '600', marginTop: theme.spacing[1] },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: theme.colors.border.light, marginVertical: theme.spacing[3] },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: theme.spacing[1] },
  rowLabel: { color: theme.colors.text.secondary, fontSize: theme.typography.fontSize.sm },
  rowValue: { color: theme.colors.text.primary, fontSize: theme.typography.fontSize.sm },
  title: { color: theme.colors.text.primary, fontSize: theme.typography.fontSize.xl, fontWeight: '700', textAlign: 'center' },
  buttons: { flexDirection: 'row', gap: theme.spacing[2] },
});
