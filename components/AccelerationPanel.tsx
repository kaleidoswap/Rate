// components/AccelerationPanel.tsx
//
// "Accelerate transaction" flow shown inside ActivityDetailSheet: lists the
// methods TxAccelerationService offers for a pending on-chain tx, asks for
// confirmation, then runs the chosen one.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../theme';
import { Badge } from './Badge';
import { Button } from './Button';
import { Callout } from './Callout';
import {
    planAcceleration,
    accelerateWithMempool,
    bumpClaimFee,
} from '../services/TxAccelerationService';
import type { AccelerationOption, AccelerationPlan, AccelerationTarget } from '../services/TxAccelerationService';
import { accelerationDeps, accelerationPayerName } from '../services/txAccelerationDeps';

interface Props {
    target: AccelerationTarget;
    onBack: () => void;
}

type Phase =
    | { step: 'loading' }
    | { step: 'choose'; plan: AccelerationPlan }
    | { step: 'confirm'; plan: AccelerationPlan; option: Exclude<AccelerationOption, { kind: 'explorer' }> }
    | { step: 'running'; message: string }
    | { step: 'done'; title: string; message: string }
    | { step: 'error'; message: string; plan?: AccelerationPlan };

const sats = (n: number) => `${n.toLocaleString('en-US')} sats`;

export const AccelerationPanel: React.FC<Props> = ({ target, onBack }) => {
    const [phase, setPhase] = useState<Phase>({ step: 'loading' });

    const load = useCallback(async () => {
        setPhase({ step: 'loading' });
        try {
            setPhase({ step: 'choose', plan: await planAcceleration(target, accelerationDeps) });
        } catch (e: any) {
            setPhase({ step: 'error', message: String(e?.message ?? e) });
        }
    }, [target]);

    useEffect(() => { load(); }, [load]);

    const choose = (plan: AccelerationPlan, option: AccelerationOption) => {
        if (option.kind === 'explorer') {
            Linking.openURL(option.url).catch(() => undefined);
            return;
        }
        setPhase({ step: 'confirm', plan, option });
    };

    const run = async (plan: AccelerationPlan, option: Exclude<AccelerationOption, { kind: 'explorer' }>) => {
        try {
            if (option.kind === 'mempool') {
                setPhase({ step: 'running', message: 'Requesting an invoice from mempool.space…' });
                const result = await accelerateWithMempool({
                    txid: target.txid,
                    bid: option.bid,
                    approvedPrice: option.price,
                    onInvoice: amount => setPhase({ step: 'running', message: `Paying ${sats(amount)} over Lightning…` }),
                }, accelerationDeps);
                setPhase(result === 'accelerating'
                    ? { step: 'done', title: 'Acceleration requested', message: 'Mempool is now prioritising this transaction with its mining pools.' }
                    : { step: 'done', title: 'Payment sent', message: 'Mempool has not confirmed the payment yet. Check the transaction on mempool.space in a few minutes.' });
            } else {
                setPhase({ step: 'running', message: 'Re-signing and broadcasting the claim…' });
                const txid = await bumpClaimFee(option.attemptId, option.feeRate, accelerationDeps);
                setPhase({ step: 'done', title: 'Fee bumped', message: `The replacement claim pays ${option.feeRate} sat/vB.\n${txid}` });
            }
        } catch (e: any) {
            setPhase({ step: 'error', message: String(e?.message ?? e), plan });
        }
    };

    return (
        <View style={styles.container}>
            <TouchableOpacity style={styles.back} onPress={onBack} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Ionicons name="chevron-back" size={18} color={theme.colors.text.secondary} />
                <Text style={styles.backText}>Details</Text>
            </TouchableOpacity>
            <Text style={styles.title}>Accelerate transaction</Text>

            {phase.step === 'loading' && <Centered><ActivityIndicator color={theme.colors.primary[500]} /></Centered>}

            {phase.step === 'running' && (
                <Centered>
                    <ActivityIndicator color={theme.colors.primary[500]} />
                    <Text style={styles.muted}>{phase.message}</Text>
                </Centered>
            )}

            {phase.step === 'choose' && (
                <View style={styles.list}>
                    {phase.plan.notes.map(n => <Text key={n} style={styles.note}>{n}</Text>)}
                    {phase.plan.options.map(o => (
                        <OptionRow key={o.id} option={o} onPress={() => choose(phase.plan, o)} />
                    ))}
                </View>
            )}

            {phase.step === 'confirm' && (
                <View style={styles.list}>
                    <ConfirmSummary option={phase.option} />
                    <Button
                        title={phase.option.kind === 'mempool' ? `Pay ${sats(phase.option.price)}` : 'Bump fee'}
                        onPress={() => run(phase.plan, phase.option)}
                        disabled={phase.option.kind === 'mempool' && !accelerationPayerName()}
                        fullWidth
                    />
                    <Button title="Back" variant="ghost" onPress={() => setPhase({ step: 'choose', plan: phase.plan })} fullWidth />
                </View>
            )}

            {phase.step === 'done' && (
                <View style={styles.list}>
                    <Callout tone="success" title={phase.title} message={phase.message} />
                    <Button title="Done" variant="secondary" onPress={onBack} fullWidth />
                </View>
            )}

            {phase.step === 'error' && (
                <View style={styles.list}>
                    <Callout tone="error" title="Could not accelerate" message={phase.message} />
                    <Button title="Try again" variant="secondary" onPress={load} fullWidth />
                </View>
            )}
        </View>
    );
};

const Centered: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <View style={styles.centered}>{children}</View>
);

const OptionRow: React.FC<{ option: AccelerationOption; onPress: () => void }> = ({ option, onPress }) => {
    let icon: keyof typeof Ionicons.glyphMap;
    let label: string;
    let detail: string;
    let value: string | undefined;
    if (option.kind === 'mempool') {
        icon = 'rocket-outline';
        label = 'Mempool Accelerator';
        detail = `Up to ${option.feeRate} sat/vB · paid over Lightning`;
        value = sats(option.price);
    } else if (option.kind === 'rbf-claim') {
        icon = 'trending-up-outline';
        label = `Bump claim fee · ${option.label}`;
        detail = `${option.feeRate} sat/vB · recipient gets ${sats(option.extraFee)} less`;
        value = `+${sats(option.extraFee)}`;
    } else {
        icon = 'open-outline';
        label = 'Open on mempool.space';
        detail = 'View the transaction and other acceleration options';
    }
    return (
        <TouchableOpacity style={styles.option} onPress={onPress} activeOpacity={0.7}>
            <Ionicons name={icon} size={20} color={theme.colors.primary[500]} />
            <View style={styles.optionBody}>
                <View style={styles.optionLabelRow}>
                    <Text style={styles.optionLabel}>{label}</Text>
                    {option.kind === 'mempool' && option.recommended && <Badge label="Recommended" tone="primary" size="sm" />}
                </View>
                <Text style={styles.optionDetail}>{detail}</Text>
            </View>
            {value && <Text style={styles.optionValue}>{value}</Text>}
        </TouchableOpacity>
    );
};

const ConfirmSummary: React.FC<{ option: Exclude<AccelerationOption, { kind: 'explorer' }> }> = ({ option }) => {
    if (option.kind === 'mempool') {
        const payer = accelerationPayerName();
        return payer ? (
            <Callout
                tone="info"
                title={`Pay ${sats(option.price)} to mempool.space`}
                message={`Paid from ${payer} over Lightning. Mempool asks mining pools to include this transaction at up to ${option.feeRate} sat/vB. The fee is not refunded if the transaction confirms on its own first.`}
            />
        ) : (
            <Callout tone="warning" title="No Lightning wallet" message="Connect Spark or RGB Lightning to pay for acceleration." />
        );
    }
    return (
        <Callout
            tone="warning"
            title={`Raise the claim fee to ${option.feeRate} sat/vB`}
            message={`The claim is re-signed with a ${sats(option.fee)} fee. The extra ${sats(option.extraFee)} comes out of the claimed amount, so the recipient receives that much less.`}
        />
    );
};

const styles = StyleSheet.create({
    container: {
        paddingTop: theme.spacing[3],
        gap: theme.spacing[3],
    },
    back: { flexDirection: 'row', alignItems: 'center', gap: 2 },
    backText: { fontSize: theme.typography.fontSize.sm, color: theme.colors.text.secondary, fontWeight: '600' },
    title: { fontSize: theme.typography.fontSize.xl, fontWeight: '700', color: theme.colors.text.primary },
    centered: { alignItems: 'center', gap: theme.spacing[3], paddingVertical: theme.spacing[8] },
    muted: { fontSize: theme.typography.fontSize.sm, color: theme.colors.text.secondary, textAlign: 'center' },
    list: { gap: theme.spacing[2] },
    note: { fontSize: theme.typography.fontSize.xs, color: theme.colors.text.tertiary },
    option: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing[3],
        backgroundColor: theme.colors.surface.primary,
        borderRadius: theme.borderRadius.lg,
        borderWidth: 1,
        borderColor: theme.colors.border.light,
        padding: theme.spacing[4],
    },
    optionBody: { flex: 1, gap: 2 },
    optionLabelRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing[2], flexWrap: 'wrap' },
    optionLabel: { fontSize: theme.typography.fontSize.sm, fontWeight: '600', color: theme.colors.text.primary },
    optionDetail: { fontSize: theme.typography.fontSize.xs, color: theme.colors.text.tertiary },
    optionValue: {
        fontSize: theme.typography.fontSize.sm,
        fontWeight: '600',
        color: theme.colors.text.primary,
        fontFamily: theme.typography.fontFamily.mono,
        fontVariant: ['tabular-nums'],
    },
});

export default AccelerationPanel;
