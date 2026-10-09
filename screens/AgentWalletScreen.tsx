// The Agent wallet: a separate budget the assistant pays services from, with
// the user's spending rules and a log of everything it paid.
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Switch, Pressable, Alert, RefreshControl, TextInput } from 'react-native';
import { useSelector } from 'react-redux';
import { Ionicons } from '@expo/vector-icons';
import { theme, leading } from '../theme';
import { AmountText, Badge, Button, Callout, Card, EmptyState, Input, ScreenHeader, Sheet } from '../components';
import PaymentConfirmationModal from '../components/PaymentConfirmationModal';
import { useAgentWallet } from '../hooks/useAgentWallet';
import { usePolicy } from '../hooks/usePolicy';
import { selectMindConfig } from '../store/slices/settingsSlice';
import { formatSats, requiresStrongAuth, type ConfirmReadback } from '../services/aiConfirm';
import { normalizeService, policyProblem, type SpendingPolicy } from '../services/agentWallet/policy';
import { agentEntryTitle } from '../services/agentWallet/activity';
import type { AgentLedgerEntry } from '../services/agentWallet/store';
import ToastService from '../services/ToastService';

type Move = 'topup' | 'withdraw';
type LimitKey = 'perPaymentSats' | 'dailySats' | 'monthlySats' | 'autoApproveSats';

const LIMITS: Array<{ key: LimitKey; label: string; hint: string }> = [
  { key: 'perPaymentSats', label: 'Per payment', hint: 'The most one payment can cost, fees included.' },
  { key: 'dailySats', label: 'Per day', hint: 'Resets at midnight on this phone.' },
  { key: 'monthlySats', label: 'Per month', hint: 'Resets on the first of the month.' },
  { key: 'autoApproveSats', label: 'Pay without asking below', hint: 'Only for services on your allowed list. 0 means always ask.' },
];

const STATUS_LABEL: Record<AgentLedgerEntry['status'], { label: string; color: string }> = {
  paid: { label: 'Paid', color: theme.colors.success[500] },
  pending: { label: 'In progress', color: theme.colors.warning[500] },
  failed: { label: 'Failed', color: theme.colors.error[500] },
  refused: { label: 'Refused', color: theme.colors.text.tertiary },
  cancelled: { label: 'Declined', color: theme.colors.text.tertiary },
};

const errorText = (e: unknown) => (e instanceof Error && e.message ? e.message : 'Something went wrong.');

function moveReadback(kind: Move, sats: number): ConfirmReadback {
  const from = kind === 'topup' ? 'Main wallet (Spark)' : 'Agent wallet';
  const to = kind === 'topup' ? 'Agent wallet' : 'Main wallet (Spark)';
  return {
    kind: 'payment',
    title: kind === 'topup' ? 'Top up Agent wallet' : 'Withdraw to main wallet',
    cta: kind === 'topup' ? 'Top up' : 'Withdraw',
    amount: formatSats(sats),
    amountSats: sats,
    recipientName: to,
    rows: [
      { label: 'From', value: from },
      { label: 'To', value: to },
      { label: 'Fee', value: 'None (Spark to Spark)' },
    ],
    spoken: '',
  };
}

export default function AgentWalletScreen() {
  const { state, refresh, enable, topUp, withdraw, disable, savePolicy } = useAgentWallet();
  const disclosure = usePolicy();
  const advanced = disclosure.showNetworks;
  const mindConfig = useSelector(selectMindConfig);
  const priceUsd = useSelector((s: any) => s?.wallet?.btcPriceUSD) || 0;
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [moveSheet, setMoveSheet] = useState<Move | null>(null);
  const [amountText, setAmountText] = useState('');
  const [pending, setPending] = useState<{ kind: Move; sats: number } | null>(null);
  const [draft, setDraft] = useState<SpendingPolicy | null>(null);
  const [editing, setEditing] = useState<LimitKey | null>(null);
  const [editText, setEditText] = useState('');
  const [newService, setNewService] = useState('');

  useEffect(() => { setDraft(state.policy ? { ...state.policy, allowedServices: [...state.policy.allowedServices] } : null); }, [state.policy]);

  const onRefresh = async () => { setRefreshing(true); await refresh(); setRefreshing(false); };
  const run = async (fn: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    try {
      await fn();
      if (done) ToastService.getInstance().success(done);
    } catch (e) {
      ToastService.getInstance().error(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const persist = (next: SpendingPolicy) => {
    const problem = policyProblem(next);
    if (problem) { ToastService.getInstance().warning(problem); return; }
    setDraft(next);
    void run(() => savePolicy(next));
  };

  const amount = Number(amountText.replace(/[^0-9]/g, ''));
  const amountValid = Number.isInteger(amount) && amount > 0 && (moveSheet !== 'withdraw' || amount <= (state.balanceSats ?? 0));
  const readback = useMemo(() => (pending ? moveReadback(pending.kind, pending.sats) : null), [pending]);

  const confirmMove = async () => {
    if (!pending) return;
    const { kind, sats } = pending;
    setBusy(true);
    try {
      const r = kind === 'topup' ? await topUp(sats) : await withdraw(sats);
      ToastService.getInstance().success(r.status === 'confirmed' ? 'Done.' : 'Sent. It will show once Spark confirms it.');
    } catch (e) {
      ToastService.getInstance().error(errorText(e));
    } finally {
      setBusy(false);
      setPending(null);
    }
  };

  const askDisable = () =>
    Alert.alert(
      'Turn off Agent wallet',
      state.balanceSats ? `${formatSats(state.balanceSats)} will go back to your main wallet first.` : 'The assistant will no longer be able to pay services.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Turn off', style: 'destructive', onPress: () => void run(disable, 'Agent wallet turned off.') },
      ],
    );

  const policy = draft;
  const leftToday = policy && state.totals ? Math.max(0, policy.dailySats - state.totals.todaySats) : null;

  return (
    <View style={styles.container}>
      <ScreenHeader title="Agent wallet" subtitle="What the assistant can spend" showBack />
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.primary[500]} />}
      >
        {!state.loading && !state.enabled && (
          <>
            <Callout
              tone="info"
              icon="wallet-outline"
              title="A separate budget for the assistant"
              message="The assistant pays for things like paid data from this wallet only, never from your main wallet, and only within the limits you set. It has its own funds and comes back with your recovery phrase."
            />
            <Button title="Turn on Agent wallet" onPress={() => void run(enable, 'Agent wallet is on. Top it up to let the assistant pay.')} loading={busy} fullWidth style={styles.gap} />
          </>
        )}

        {state.enabled && (
          <>
            <Card style={styles.balanceCard}>
              <View style={styles.rowBetween}>
                <Text style={styles.label}>Balance</Text>
                {policy?.paused && <Badge label="Paused" tone="warning" size="sm" />}
              </View>
              <AmountText style={styles.balance}>{state.balanceSats == null ? '—' : formatSats(state.balanceSats)}</AmountText>
              {leftToday != null && policy && (
                <Text style={styles.muted}>{formatSats(leftToday)} of {formatSats(policy.dailySats)} left today</Text>
              )}
              <View style={styles.actions}>
                <Button title="Top up" onPress={() => { setAmountText(''); setMoveSheet('topup'); }} disabled={busy} style={styles.flex} />
                <Button title="Withdraw" variant="secondary" onPress={() => { setAmountText(''); setMoveSheet('withdraw'); }} disabled={busy || !state.balanceSats} style={styles.flex} />
              </View>
            </Card>

            {!!state.error && <Callout tone="warning" message={state.error} style={styles.gap} />}

            {policy && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Spending rules</Text>
                <Card>
                  <View style={styles.toggleRow}>
                    <View style={styles.flex}>
                      <Text style={styles.rowLabel}>Pause payments</Text>
                      <Text style={styles.rowDesc}>The assistant can't pay anything while paused.</Text>
                    </View>
                    <Switch
                      value={policy.paused}
                      onValueChange={(v) => persist({ ...policy, paused: v })}
                      trackColor={{ true: theme.colors.primary[500], false: theme.colors.border.light }}
                      thumbColor={theme.colors.text.primary}
                    />
                  </View>
                  {LIMITS.map((l) => (
                    <Pressable
                      key={l.key}
                      style={styles.limitRow}
                      disabled={!advanced}
                      onPress={() => { setEditText(String(policy[l.key])); setEditing(l.key); }}
                    >
                      <Text style={[styles.rowLabel, styles.flex]}>{l.label}</Text>
                      <AmountText style={styles.rowValue}>{formatSats(policy[l.key])}</AmountText>
                      {advanced && <Ionicons name="chevron-forward" size={16} color={theme.colors.text.tertiary} />}
                    </Pressable>
                  ))}
                </Card>

                <Text style={[styles.sectionTitle, styles.gap]}>Allowed services</Text>
                <Text style={styles.sectionHint}>
                  The assistant can pay these on its own below your limit. It always asks before paying any other service.
                </Text>
                <Card>
                  {policy.allowedServices.length === 0 && <Text style={styles.rowDesc}>None yet, so it asks every time.</Text>}
                  {policy.allowedServices.map((s) => (
                    <View key={s} style={styles.limitRow}>
                      <Text style={[styles.rowLabel, styles.flex]}>{s}</Text>
                      {advanced && (
                        <Pressable hitSlop={8} onPress={() => persist({ ...policy, allowedServices: policy.allowedServices.filter((x) => x !== s) })}>
                          <Ionicons name="close-circle" size={20} color={theme.colors.text.tertiary} />
                        </Pressable>
                      )}
                    </View>
                  ))}
                  {advanced && (
                    <View style={styles.addRow}>
                      <TextInput
                        style={styles.addInput}
                        value={newService}
                        onChangeText={setNewService}
                        placeholder="api.example.com"
                        placeholderTextColor={theme.colors.text.tertiary}
                        autoCapitalize="none"
                        autoCorrect={false}
                        keyboardType="url"
                      />
                      <Button
                        title="Add"
                        size="sm"
                        disabled={!normalizeService(newService)}
                        onPress={() => {
                          const host = normalizeService(newService);
                          if (!host || policy.allowedServices.includes(host)) return;
                          setNewService('');
                          persist({ ...policy, allowedServices: [...policy.allowedServices, host] });
                        }}
                      />
                    </View>
                  )}
                </Card>
                {!advanced && <Text style={styles.sectionHint}>Switch to Advanced in Settings, Preferences to change limits and services.</Text>}
              </View>
            )}

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Spend log</Text>
              {state.entries.length === 0 ? (
                <EmptyState icon="receipt-outline" title="Nothing yet" message="Top-ups and what the assistant pays show up here." />
              ) : (
                <Card>
                  {state.entries.slice(0, 50).map((e, i) => (
                    <View key={e.id} style={[styles.logRow, i > 0 && styles.rowBorder]}>
                      <View style={styles.flex}>
                        <Text style={styles.rowLabel} numberOfLines={1}>{agentEntryTitle(e)}</Text>
                        <Text style={styles.rowDesc} numberOfLines={2}>
                          {new Date(e.at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          {e.reason && e.kind === 'spend' ? ` · ${e.reason.replace(/_/g, ' ')}` : ''}
                          {e.error && e.status !== 'paid' ? ` · ${e.error}` : ''}
                        </Text>
                      </View>
                      <View style={styles.logRight}>
                        <AmountText style={styles.rowValue}>{e.kind === 'withdraw' ? '' : e.kind === 'topup' ? '+' : '−'}{formatSats(e.amountSats)}</AmountText>
                        {e.feeSats > 0 && e.status === 'paid' && <Text style={styles.rowDesc}>fee {formatSats(e.feeSats)}</Text>}
                        <Text style={[styles.rowDesc, { color: STATUS_LABEL[e.status].color }]}>{STATUS_LABEL[e.status].label}</Text>
                      </View>
                    </View>
                  ))}
                </Card>
              )}
            </View>

            <Pressable style={styles.dangerRow} onPress={askDisable} disabled={busy}>
              <Ionicons name="power-outline" size={18} color={theme.colors.error[500]} />
              <Text style={styles.dangerText}>Turn off and send funds back</Text>
            </Pressable>
          </>
        )}
        {!state.enabled && !!state.error && <Callout tone="warning" message={state.error} style={styles.gap} />}
      </ScrollView>

      <Sheet
        visible={!!moveSheet}
        onClose={() => setMoveSheet(null)}
        title={moveSheet === 'topup' ? 'Top up Agent wallet' : 'Withdraw to main wallet'}
        subtitle={moveSheet === 'topup' ? 'Moves sats from your main wallet on Spark.' : `Up to ${formatSats(state.balanceSats ?? 0)}.`}
        footer={
          <Button
            title="Review"
            fullWidth
            disabled={!amountValid}
            onPress={() => { const kind = moveSheet!; setMoveSheet(null); setPending({ kind, sats: amount }); }}
          />
        }
      >
        <Input label="Amount (sats)" value={amountText} onChangeText={setAmountText} keyboardType="number-pad" placeholder="5,000" autoFocus />
      </Sheet>

      <Sheet
        visible={!!editing}
        onClose={() => setEditing(null)}
        title={LIMITS.find((l) => l.key === editing)?.label}
        subtitle={LIMITS.find((l) => l.key === editing)?.hint}
        footer={
          <Button
            title="Save"
            fullWidth
            disabled={!/^\d+$/.test(editText.replace(/,/g, ''))}
            onPress={() => {
              if (!policy || !editing) return;
              persist({ ...policy, [editing]: Number(editText.replace(/,/g, '')) });
              setEditing(null);
            }}
          />
        }
      >
        <Input label="Sats" value={editText} onChangeText={setEditText} keyboardType="number-pad" autoFocus />
      </Sheet>

      <PaymentConfirmationModal
        visible={!!readback}
        readback={readback}
        onConfirm={confirmMove}
        onCancel={() => { if (!busy) setPending(null); }}
        loading={busy}
        requireAuth={!!readback && pending?.kind === 'topup' && requiresStrongAuth(readback, mindConfig.confirmAuthThresholdSats)}
        priceUsd={priceUsd}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background.primary },
  content: { padding: theme.spacing[4], paddingBottom: theme.spacing[10] },
  gap: { marginTop: theme.spacing[3] },
  flex: { flex: 1 },
  balanceCard: { padding: theme.spacing[4] },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label: { color: theme.colors.text.secondary, fontSize: theme.typography.fontSize.sm },
  balance: { color: theme.colors.text.primary, fontSize: theme.typography.fontSize['3xl'], fontWeight: theme.typography.fontWeight.bold, marginTop: theme.spacing[1] },
  muted: { color: theme.colors.text.tertiary, fontSize: theme.typography.fontSize.sm, marginTop: theme.spacing[1] },
  actions: { flexDirection: 'row', gap: theme.spacing[3], marginTop: theme.spacing[4] },
  section: { marginTop: theme.spacing[5] },
  sectionTitle: { color: theme.colors.text.primary, fontSize: theme.typography.fontSize.base, fontWeight: theme.typography.fontWeight.bold, marginBottom: theme.spacing[2] },
  sectionHint: { color: theme.colors.text.tertiary, fontSize: theme.typography.fontSize.xs, marginBottom: theme.spacing[2], lineHeight: leading(theme.typography.fontSize.xs, theme.typography.lineHeight.snug) },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing[3], paddingVertical: theme.spacing[2] },
  limitRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing[2], paddingVertical: theme.spacing[3], borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.border.light },
  rowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.border.light },
  rowLabel: { color: theme.colors.text.primary, fontSize: theme.typography.fontSize.sm, fontWeight: theme.typography.fontWeight.semibold },
  rowDesc: { color: theme.colors.text.tertiary, fontSize: theme.typography.fontSize.xs, marginTop: 2, lineHeight: leading(theme.typography.fontSize.xs, theme.typography.lineHeight.snug) },
  rowValue: { color: theme.colors.text.primary, fontSize: theme.typography.fontSize.sm, fontWeight: theme.typography.fontWeight.semibold },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing[2], paddingTop: theme.spacing[3] },
  addInput: { flex: 1, color: theme.colors.text.primary, fontSize: theme.typography.fontSize.sm, backgroundColor: theme.colors.background.secondary, borderRadius: theme.borderRadius.base, paddingHorizontal: theme.spacing[3], paddingVertical: theme.spacing[2] },
  logRow: { flexDirection: 'row', gap: theme.spacing[3], paddingVertical: theme.spacing[2.5] },
  logRight: { alignItems: 'flex-end' },
  dangerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: theme.spacing[2], marginTop: theme.spacing[6], paddingVertical: theme.spacing[3] },
  dangerText: { color: theme.colors.error[500], fontSize: theme.typography.fontSize.sm, fontWeight: theme.typography.fontWeight.semibold },
});
