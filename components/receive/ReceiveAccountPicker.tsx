import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { theme, motion, protocolTint } from '../../theme';
import { NetworkIcon } from '../NetworkIcon';
import { PressableScale } from '../PressableScale';
import { AmountText } from '../AmountText';
import { OnchainIcon } from '../ProtocolIcons';
import type { AccountId } from '../../utils/account-routing';
import { chainLabel, type AccountMethod, type ReceiveChain, type ReceiveMethodId } from '../../utils/receive-routes';

const ACCOUNT_ICON: Record<AccountId, string> = { RGB: 'rgb', SPARK: 'spark', ARKADE: 'arkade', BARK: 'bark' };
const ACCOUNT_TAGLINE: Record<AccountId, string> = {
  SPARK: 'Instant, low fees',
  ARKADE: 'Ark, self-custodial',
  BARK: 'Ark by Second',
  RGB: 'Your channels',
};
const METHOD_LABEL: Record<ReceiveMethodId, string> = {
  universal: 'Any wallet', spark: 'Spark', ark: 'Ark', lightning: 'Lightning', onchain: 'On-chain',
};
const METHOD_ICON: Record<ReceiveMethodId, keyof typeof Ionicons.glyphMap> = {
  universal: 'qr-code-outline', spark: 'sparkles-outline', ark: 'planet-outline', lightning: 'flash-outline', onchain: 'logo-bitcoin',
};

export interface ReceiveAccountCard {
  account: AccountId;
  label: string;
  chain?: ReceiveChain;
  /** Spendable sats, when known. */
  balanceSats?: number;
}

/**
 * Receive by account: choose where the money lands, then how it gets there. Each
 * account lists only the ways it can actually be paid, its own native one first.
 */
export function ReceiveAccountPicker({ accounts, account, onAccount, methods, method, onMethod, amountSats, showChain }: {
  accounts: ReceiveAccountCard[];
  account: AccountId | null;
  onAccount: (account: AccountId) => void;
  /** The ways in for the selected account. */
  methods: AccountMethod[];
  method: ReceiveMethodId | null;
  onMethod: (method: ReceiveMethodId) => void;
  amountSats: number;
  /** Show each account's network (when they are not all on the same one). */
  showChain?: boolean;
}) {
  const current = methods.find(m => m.method === method);
  const detail = current
    ? current.destination.needsAmount && amountSats <= 0 ? `${current.destination.detail}. Add an amount first.` : current.destination.detail
    : undefined;

  return (
    <View style={styles.wrap}>
      <View style={styles.grid} accessibilityRole="radiogroup" accessibilityLabel="Account">
        {accounts.map(card => {
          const active = card.account === account;
          const tint = protocolTint(card.account === 'RGB' ? 'RGB' : card.account, 0.16);
          return (
            <PressableScale
              key={card.account}
              scaleTo={0.97}
              disabled={accounts.length < 2}
              onPress={() => { if (!active) onAccount(card.account); }}
              accessibilityRole="radio"
              accessibilityState={{ checked: active }}
              accessibilityLabel={`${card.label}${card.balanceSats !== undefined ? `, ${card.balanceSats.toLocaleString('en-US')} sats` : ''}${showChain && card.chain ? `, ${chainLabel(card.chain)}` : ''}`}
              style={[styles.card, accounts.length === 1 && styles.cardSolo, active && styles.cardActive]}
            >
              <View style={styles.cardTop}>
                <View style={[styles.iconWrap, { backgroundColor: tint }]}>
                  <NetworkIcon network={ACCOUNT_ICON[card.account]} size={22} />
                </View>
                {active
                  ? <Ionicons name="checkmark-circle" size={20} color={theme.colors.primary[500]} />
                  : showChain && card.chain && card.chain !== 'mainnet' && <Text style={styles.chain}>{chainLabel(card.chain)}</Text>}
              </View>
              <Text style={styles.cardName} numberOfLines={1}>{card.label}</Text>
              {card.balanceSats !== undefined
                ? <AmountText style={styles.cardSub} numberOfLines={1}>{card.balanceSats.toLocaleString('en-US')} sats</AmountText>
                : <Text style={styles.cardSub} numberOfLines={1}>{ACCOUNT_TAGLINE[card.account]}</Text>}
            </PressableScale>
          );
        })}
      </View>

      {methods.length > 0 && (
        <View style={styles.methods}>
          <Text style={styles.caption}>Receive with</Text>
          <View style={styles.methodRow} accessibilityRole="radiogroup" accessibilityLabel="How the payment arrives">
            {methods.map(({ method: m, destination }) => {
              const active = m === method;
              const blocked = !destination.available;
              return (
                <PressableScale
                  key={m}
                  scaleTo={0.96}
                  disabled={blocked}
                  onPress={() => { if (!active) onMethod(m); }}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: active, disabled: blocked }}
                  accessibilityLabel={[METHOD_LABEL[m], blocked ? destination.reason : destination.needsAmount ? 'needs an amount' : undefined].filter(Boolean).join(', ')}
                  style={[styles.method, active && styles.methodActive, blocked && styles.methodBlocked]}
                >
                  {m === 'onchain'
                    ? <OnchainIcon size={16} color={active ? theme.colors.text.inverse : theme.colors.text.secondary} />
                    : <Ionicons name={METHOD_ICON[m]} size={16} color={active ? theme.colors.text.inverse : theme.colors.text.secondary} />}
                  <Text style={[styles.methodText, active && styles.methodTextActive]} numberOfLines={1}>{METHOD_LABEL[m]}</Text>
                </PressableScale>
              );
            })}
          </View>
          {!!(detail || methods.some(m => !m.destination.available)) && (
            <Animated.View key={`${account}:${method}`} entering={FadeIn.duration(motion.duration.base)} style={styles.detailRow}>
              <Ionicons name="information-circle-outline" size={15} color={theme.colors.text.tertiary} />
              <Text style={styles.detail}>
                {detail ?? ''}
                {methods.filter(m => !m.destination.available).map(m => `${detail ? ' ' : ''}${METHOD_LABEL[m.method]}: ${m.destination.reason ?? 'not available'}`).join(' ')}
              </Text>
            </Animated.View>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: theme.spacing[4] },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing[2.5] },
  card: {
    flexGrow: 1,
    flexBasis: '46%',
    minHeight: 96,
    padding: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface.primary,
    borderWidth: 1.5,
    borderColor: theme.colors.border.light,
    gap: 2,
  },
  cardSolo: { flexBasis: '100%' },
  cardActive: { borderColor: theme.colors.primary[500], backgroundColor: theme.colors.primary[50] },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: theme.spacing[2] },
  iconWrap: { width: 36, height: 36, borderRadius: theme.borderRadius.full, alignItems: 'center', justifyContent: 'center' },
  chain: {
    fontSize: 10,
    fontWeight: theme.typography.fontWeight.semibold,
    color: theme.colors.warning[500],
    borderWidth: 1,
    borderColor: theme.colors.warning[500],
    borderRadius: theme.borderRadius.sm,
    paddingHorizontal: theme.spacing[1.5],
    paddingVertical: 1,
    overflow: 'hidden',
  },
  cardName: { fontSize: theme.typography.fontSize.base, fontWeight: theme.typography.fontWeight.semibold, color: theme.colors.text.primary },
  cardSub: { fontSize: theme.typography.fontSize.xs, color: theme.colors.text.tertiary },
  methods: { gap: theme.spacing[2] },
  caption: {
    fontSize: theme.typography.fontSize.xs,
    fontWeight: theme.typography.fontWeight.semibold,
    color: theme.colors.text.tertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  methodRow: { flexDirection: 'row', gap: theme.spacing[2] },
  method: {
    flex: 1,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing[1.5],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.full,
    borderWidth: 1,
    borderColor: theme.colors.border.light,
    backgroundColor: theme.colors.surface.secondary,
  },
  methodActive: { backgroundColor: theme.colors.primary[500], borderColor: theme.colors.primary[500] },
  methodBlocked: { opacity: 0.4 },
  methodText: { fontSize: theme.typography.fontSize.sm, fontWeight: theme.typography.fontWeight.semibold, color: theme.colors.text.secondary },
  methodTextActive: { color: theme.colors.text.inverse },
  detailRow: { flexDirection: 'row', gap: theme.spacing[1.5], alignItems: 'flex-start' },
  detail: { flex: 1, fontSize: theme.typography.fontSize.xs, color: theme.colors.text.secondary, lineHeight: 17 },
});
