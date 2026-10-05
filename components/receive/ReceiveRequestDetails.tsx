import React, { useState } from 'react';
import { Modal, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAppTheme } from '../../theme/ThemeProvider';
import { CopyButton } from '../CopyButton';
import { NetworkIcon } from '../NetworkIcon';
import { ReceiveQr } from './ReceiveQr';
import { ReceiveRequestActions } from './ReceiveRequestActions';
import { InvoiceExpiry } from '../payments/InvoiceExpiry';
import type { ReceiveMethod } from '../../utils/receive-session';

/** Where each request lands, in words. */
export function accountName(method: Pick<ReceiveMethod, 'protocol'>, rgbLabel = 'RGB Lightning node'): string {
  switch (method.protocol) {
    case 'SPARK': return 'Spark';
    case 'ARKADE': return 'Arkade';
    case 'BARK': return 'Bark';
    default: return rgbLabel;
  }
}

/** What kind of code it is, in words. */
export function requestKind(method: Pick<ReceiveMethod, 'kind' | 'layer' | 'key'>): string {
  if (method.layer === 'lightning') return method.key.startsWith('rgb') ? 'RGB Lightning invoice' : 'Lightning invoice';
  if (method.layer === 'rgb') return 'RGB invoice';
  if (method.layer === 'onchain' || method.key.startsWith('onchain')) return 'Bitcoin address';
  if (method.layer === 'spark') return method.kind === 'invoice' ? 'Spark invoice' : 'Spark address';
  return 'Ark address';
}

/** Long codes stay readable: the start and end, which is what people compare. */
export function middleEllipsis(value: string, head = 14, tail = 10): string {
  return value.length > head + tail + 1 ? `${value.slice(0, head)}…${value.slice(-tail)}` : value;
}

/** Addresses in groups of four, the way people read them back. Invoices are too long to group. */
export function groupAddress(value: string): string {
  return value.length <= 100 ? value.replace(/(.{4})(?=.)/g, '$1 ') : value;
}

function iconFor(method: ReceiveMethod): string {
  if (method.layer === 'lightning') return 'lightning';
  if (method.layer === 'onchain' || method.key.startsWith('onchain')) return 'onchain';
  if (method.layer === 'rgb') return 'rgb';
  return method.protocol.toLowerCase();
}

/** One code on its own, for a sender whose wallet can't read the combined one. */
function CodeSheet({ method, onClose, qrSize, rgbLabel, onRefresh }: {
  method: ReceiveMethod | null; onClose: () => void; qrSize: number; rgbLabel?: string; onRefresh?: () => void;
}) {
  const t = useAppTheme();
  return <Modal visible={!!method} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
    <SafeAreaView style={{ flex: 1, backgroundColor: t.colors.background.primary }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', padding: t.spacing[4] }}>
        <Text accessibilityRole="header" style={{ flex: 1, color: t.colors.text.primary, fontSize: t.typography.fontSize.xl, fontWeight: '600' }}>
          {method ? requestKind(method) : ''}
        </Text>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="close" size={24} color={t.colors.text.primary} />
        </TouchableOpacity>
      </View>
      {method && <ScrollView contentContainerStyle={{ padding: t.spacing[5], gap: t.spacing[4] }}>
        <Text style={{ color: t.colors.text.secondary, textAlign: 'center' }}>Lands in {accountName(method, rgbLabel)}</Text>
        <ReceiveQr value={method.value} size={qrSize} />
        <InvoiceExpiry invoice={method.value} onRefresh={onRefresh} />
        <Text selectable style={{ color: t.colors.text.primary, fontFamily: t.typography.fontFamily.mono, fontSize: t.typography.fontSize.sm, textAlign: 'center' }}>
          {groupAddress(method.value)}
        </Text>
        <ReceiveRequestActions value={method.value} label={requestKind(method)} />
      </ScrollView>}
    </SafeAreaView>
  </Modal>;
}

/**
 * The request in words under the QR. A single code shows itself in full; the
 * universal code lists every way it can be paid, each with its own copy and QR.
 */
export function ReceiveRequestDetails({ methods, universal, notes = [], qrSize, rgbLabel, onRefresh, extra }: {
  methods: ReceiveMethod[];
  universal: boolean;
  /** Accounts left out of the code, and why. */
  notes?: string[];
  qrSize: number;
  rgbLabel?: string;
  onRefresh?: () => void;
  /** A line under the single code, e.g. what the sender pays for a swap. */
  extra?: string;
}) {
  const t = useAppTheme();
  const [shown, setShown] = useState<ReceiveMethod | null>(null);
  const [expanded, setExpanded] = useState(false);
  if (!methods.length) return null;
  // Stretch: the parent centres the QR, which would otherwise shrink this card to its content.
  const card = { alignSelf: 'stretch' as const, borderRadius: t.borderRadius.lg, backgroundColor: t.colors.surface.primary, borderWidth: 1, borderColor: t.colors.border.light };

  if (!universal) {
    const method = methods[0];
    const long = method.value.length > 100;
    return <View style={[card, { padding: t.spacing[4], gap: t.spacing[2], marginTop: t.spacing[3] }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing[2] }}>
        <NetworkIcon network={iconFor(method)} size={16} />
        <Text style={{ flex: 1, color: t.colors.text.secondary, fontSize: t.typography.fontSize.sm }}>
          {requestKind(method)} · {accountName(method, rgbLabel)}
        </Text>
        <CopyButton value={method.value} label="Copy" />
      </View>
      <TouchableOpacity disabled={!long} accessibilityRole={long ? 'button' : undefined}
        accessibilityLabel={long ? `${expanded ? 'Hide' : 'Show'} the full ${requestKind(method)}` : undefined}
        onPress={() => setExpanded(v => !v)} activeOpacity={0.7}>
        <Text selectable style={{ color: t.colors.text.primary, fontFamily: t.typography.fontFamily.mono, fontSize: t.typography.fontSize.base }}>
          {long && !expanded ? middleEllipsis(method.value, 24, 16) : groupAddress(method.value)}
        </Text>
        {long && <Text style={{ color: t.colors.primary[500], fontSize: t.typography.fontSize.sm, marginTop: t.spacing[1] }}>{expanded ? 'Show less' : 'Show full invoice'}</Text>}
      </TouchableOpacity>
      {!!extra && <Text style={{ color: t.colors.text.secondary, fontSize: t.typography.fontSize.sm }}>{extra}</Text>}
    </View>;
  }

  return <View style={[card, { marginTop: t.spacing[3], overflow: 'hidden' }]}>
    <Text style={{ color: t.colors.text.secondary, fontSize: t.typography.fontSize.sm, padding: t.spacing[4], paddingBottom: t.spacing[2] }}>
      Any of these can pay this code
    </Text>
    {methods.map((method, i) => <View key={method.key}
      style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing[3], paddingHorizontal: t.spacing[4], paddingVertical: t.spacing[3],
        borderTopWidth: i ? 1 : 0, borderTopColor: t.colors.border.light }}>
      <NetworkIcon network={iconFor(method)} size={22} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ color: t.colors.text.primary, fontWeight: '600' }}>{requestKind(method)}</Text>
        <Text style={{ color: t.colors.text.tertiary, fontSize: t.typography.fontSize.xs }} numberOfLines={1}>
          {accountName(method, rgbLabel)} · {middleEllipsis(method.value)}
        </Text>
      </View>
      <CopyButton value={method.value} />
      <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Show the ${requestKind(method)} on its own`}
        onPress={() => setShown(method)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={{ padding: t.spacing[1] }}>
        <Ionicons name="qr-code-outline" size={18} color={t.colors.text.secondary} />
      </TouchableOpacity>
    </View>)}
    {notes.map(note => <Text key={note} style={{ color: t.colors.text.tertiary, fontSize: t.typography.fontSize.xs, paddingHorizontal: t.spacing[4], paddingBottom: t.spacing[3] }}>
      {note}
    </Text>)}
    <CodeSheet method={shown} onClose={() => setShown(null)} qrSize={qrSize} rgbLabel={rgbLabel} onRefresh={onRefresh} />
  </View>;
}
