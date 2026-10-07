// components/bridge/BridgeOrderTracker.tsx
//
// A cross-chain order in flight: status header, the status pipeline, order
// details, and an honest note when the status can't be read or seems stuck
// (Orchestra's status can lag the delivery itself).
import React from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppTheme } from '../../theme/ThemeProvider';
import type { OrchestraOrder } from '../../services/orchestra/client';
import { STATUS_LABELS, STATUS_PIPELINE, TERMINAL_STATUSES, chainLabel } from '../../utils/orchestra-ui';
import { Button } from '../Button';
import { Callout } from '../Callout';
import { CopyButton } from '../CopyButton';
import { AmountText } from '../AmountText';
import { BridgeAssetIcon } from './BridgeIcons';

export function BridgeOrderTracker({ order, from, to, receivedText, stuck, pollError, onDone }: {
  order: OrchestraOrder;
  from: { ticker: string; chain: string };
  to: { ticker: string; chain: string };
  receivedText?: string;
  stuck: boolean;
  pollError: string | null;
  onDone: () => void;
}) {
  const t = useAppTheme();
  const terminal = TERMINAL_STATUSES.has(order.status);
  const failed = order.status === 'failed' || order.status === 'refunded';
  const currentIdx = STATUS_PIPELINE.indexOf(order.status);
  const card = {
    borderRadius: t.borderRadius.xl, backgroundColor: t.colors.surface.primary,
    borderWidth: 1, borderColor: t.colors.border.light, padding: t.spacing[4],
  };
  const rowLabel = { color: t.colors.text.tertiary, fontSize: t.typography.fontSize.sm };

  const header = order.status === 'completed'
    ? { icon: 'checkmark-circle' as const, color: t.colors.success[500], title: 'Deposit complete', sub: `${to.ticker} delivered to your Spark account` }
    : failed
      ? { icon: 'alert-circle' as const, color: t.colors.error[500], title: `Order ${STATUS_LABELS[order.status].toLowerCase()}`, sub: order.status === 'refunded' ? 'The deposit was sent back to where it came from.' : 'The cross-chain transfer could not be completed.' }
      : { icon: null, color: t.colors.warning[500], title: STATUS_LABELS[order.status] ?? order.status, sub: 'Your deposit is on its way. You can close this screen; it keeps going.' };

  return (
    <View style={{ gap: t.spacing[4] }}>
      <View style={{ alignItems: 'center', gap: t.spacing[2], paddingVertical: t.spacing[3] }} accessibilityLiveRegion="polite">
        {header.icon
          ? <Ionicons name={header.icon} size={48} color={header.color} />
          : <ActivityIndicator size="large" color={header.color} />}
        <Text style={{ color: t.colors.text.primary, fontSize: t.typography.fontSize.xl, fontWeight: '700' }}>{header.title}</Text>
        <Text style={{ color: t.colors.text.secondary, textAlign: 'center' }}>{header.sub}</Text>
      </View>

      {!failed && (
        <View style={card}>
          {STATUS_PIPELINE.map((stage, i) => {
            const done = i < currentIdx || order.status === 'completed';
            const active = i === currentIdx && !done;
            const last = i === STATUS_PIPELINE.length - 1;
            const tint = done ? t.colors.success[500] : active ? t.colors.warning[500] : t.colors.text.muted;
            return (
              <View key={stage} style={{ flexDirection: 'row', gap: t.spacing[3] }}>
                <View style={{ alignItems: 'center' }}>
                  <View style={{
                    width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
                    backgroundColor: done ? t.colors.success[50] : active ? t.colors.warning[50] : t.colors.surface.secondary,
                  }}>
                    {done ? <Ionicons name="checkmark" size={14} color={tint} />
                      : active ? <ActivityIndicator size="small" color={tint} style={{ transform: [{ scale: 0.7 }] }} />
                        : <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: tint }} />}
                  </View>
                  {!last && <View style={{ width: 1, flex: 1, minHeight: 14, marginVertical: 2, backgroundColor: done ? t.colors.success[500] : t.colors.border.light }} />}
                </View>
                <Text style={{
                  paddingTop: 3, paddingBottom: last ? 0 : t.spacing[3], color: done || active ? tint : t.colors.text.tertiary,
                  fontWeight: done || active ? '600' : '400',
                }}>
                  {STATUS_LABELS[stage]}
                </Text>
              </View>
            );
          })}
        </View>
      )}

      <View style={[card, { gap: t.spacing[2.5] }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={rowLabel}>Route</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing[1.5] }}>
            <BridgeAssetIcon ticker={from.ticker} chain={from.chain} size={18} />
            <Text style={{ color: t.colors.text.secondary, fontSize: t.typography.fontSize.sm }}>{from.ticker} on {chainLabel(from.chain)}</Text>
            <Ionicons name="arrow-forward" size={12} color={t.colors.text.tertiary} />
            <BridgeAssetIcon ticker={to.ticker} chain={to.chain} size={18} />
            <Text style={{ color: t.colors.text.secondary, fontSize: t.typography.fontSize.sm }}>{to.ticker}</Text>
          </View>
        </View>
        {!!receivedText && (
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={rowLabel}>{order.status === 'completed' ? 'Received' : 'Receiving'}</Text>
            <AmountText style={{ color: t.colors.success[500], fontWeight: '600' }}>{receivedText}</AmountText>
          </View>
        )}
        {!!order.id && (
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: t.spacing[2] }}>
            <Text style={rowLabel}>Order ID</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', flexShrink: 1 }}>
              <Text numberOfLines={1} style={{ color: t.colors.text.secondary, fontFamily: t.typography.fontFamily.mono, fontSize: t.typography.fontSize.xs, flexShrink: 1 }}>
                {order.id.length > 16 ? `${order.id.slice(0, 14)}…` : order.id}
              </Text>
              <CopyButton value={order.id} size={16} />
            </View>
          </View>
        )}
      </View>

      {!terminal && (pollError || stuck) && (
        <Callout
          tone="warning"
          title={pollError ? 'Status unavailable' : 'Taking longer than usual'}
          message={pollError
            ? `Can't read this order's status right now (${pollError}). The transfer may already be done: check your Spark balance. The order keeps going if you close this screen.`
            : 'The bridge status can lag the delivery itself. Check your Spark balance, or close this screen: the order keeps going and you can come back to it here.'}
        />
      )}

      {(terminal || stuck || !!pollError) && (
        <Button title={terminal ? 'Done' : 'Close'} variant={terminal ? 'primary' : 'secondary'} onPress={onDone} fullWidth />
      )}
    </View>
  );
}
