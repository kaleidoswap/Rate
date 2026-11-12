import React, { useState } from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppTheme } from '../../theme/ThemeProvider';
import { NetworkIcon } from '../NetworkIcon';
import { Sheet } from '../Sheet';
import { feedback } from '../../utils/feedback';
import type { AccountId } from '../../utils/account-routing';
import {
  chainLabel, type ChainGroup, type ReceiveChain, type ReceiveDestination, type ReceiveMethodId,
} from '../../utils/receive-routes';

const METHOD_LABELS: Record<ReceiveMethodId, string> = {
  universal: 'Any wallet', lightning: 'Lightning', onchain: 'On-chain', spark: 'Spark', ark: 'Ark',
};
const ACCOUNT_ICON: Record<AccountId, string> = { RGB: 'rgb', SPARK: 'spark', ARKADE: 'arkade', BARK: 'bark' };
/** Lightning into the RGB account lands on the RGB Lightning Node. */
const accountIcon = (account: AccountId, lightning: boolean) => (lightning && account === 'RGB' ? 'rln' : ACCOUNT_ICON[account]);

interface Choice<K extends string> {
  key: K;
  title: string;
  detail?: string;
  badge?: string;
  icon?: string;
  disabled?: string;
}

function OptionRow<K extends string>({ choice, active, onSelect }: { choice: Choice<K>; active: boolean; onSelect: () => void }) {
  const t = useAppTheme();
  const disabled = !!choice.disabled;
  return <TouchableOpacity
    accessibilityRole="radio" accessibilityState={{ checked: active, disabled }}
    accessibilityLabel={[choice.title, choice.badge, choice.detail, choice.disabled].filter(Boolean).join(', ')}
    disabled={disabled} activeOpacity={0.7}
    onPress={() => { feedback.select(); onSelect(); }}
    style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing[3], padding: t.spacing[3], borderRadius: t.borderRadius.lg,
      borderWidth: 1, borderColor: active ? t.colors.primary[500] : t.colors.border.light, opacity: disabled ? 0.5 : 1 }}>
    {!!choice.icon && <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: t.colors.surface.secondary, alignItems: 'center', justifyContent: 'center' }}>
      <NetworkIcon network={choice.icon} size={20} />
    </View>}
    <View style={{ flex: 1, gap: 2 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing[2] }}>
        <Text style={{ color: t.colors.text.primary, fontWeight: '600' }}>{choice.title}</Text>
        {!!choice.badge && <Text style={{ color: t.colors.text.tertiary, fontSize: t.typography.fontSize.xs }}>{choice.badge}</Text>}
      </View>
      {!!(choice.disabled ?? choice.detail) && <Text style={{ color: choice.disabled ? t.colors.warning[500] : t.colors.text.secondary, fontSize: t.typography.fontSize.sm }}>{choice.disabled ?? choice.detail}</Text>}
    </View>
    <Ionicons name={active ? 'radio-button-on' : 'radio-button-off'} size={20} color={active ? t.colors.primary[500] : t.colors.text.tertiary} />
  </TouchableOpacity>;
}

function destinationChoices(destinations: ReceiveDestination[], amountSats: number, showChain: boolean, iconOf: (account: AccountId) => string): Choice<AccountId>[] {
  return destinations.map(d => ({
    key: d.account, title: d.label, detail: d.detail, icon: iconOf(d.account),
    badge: showChain ? chainLabel(d.chain) : undefined,
    disabled: !d.available ? d.reason ?? 'Not available' : undefined,
  })).map(c => {
    const d = destinations.find(x => x.account === c.key)!;
    return !c.disabled && d.needsAmount && amountSats <= 0 ? { ...c, detail: `${d.detail}. Add an amount first.` } : c;
  });
}

/**
 * How the payment arrives and where it lands — one row, one sheet. The sheet
 * lists the methods and, for the chosen one, the accounts side by side, so a
 * payment route is picked in a single place instead of a sheet inside a sheet.
 */
export function ReceiveRoutePicker({
  methods, method, onMethod, destinations, destination, onDestination, amountSats,
  chains, chain, onChain, accountLabel = (account) => account, lightningDestinations, lightningDestination, onLightningDestination,
  iconFor, methodIcons,
}: {
  methods: ReceiveMethodId[];
  method: ReceiveMethodId;
  onMethod: (method: ReceiveMethodId) => void;
  destinations: ReceiveDestination[];
  destination: AccountId | null;
  onDestination: (account: AccountId) => void;
  amountSats: number;
  /** An account's display name, for listing what each network includes. */
  accountLabel?: (account: AccountId) => string;
  /** Universal code only. */
  chains?: ChainGroup[];
  chain?: ReceiveChain | null;
  onChain?: (chain: ReceiveChain) => void;
  lightningDestinations?: ReceiveDestination[];
  lightningDestination?: AccountId | null;
  onLightningDestination?: (account: AccountId) => void;
  /** The icon of the account a payment lands in (RGB on this phone, the RGB node, Spark…). */
  iconFor?: (account: AccountId) => string;
  /** Icons per method tab; Ark lists each Ark account it can land in. */
  methodIcons?: Partial<Record<ReceiveMethodId, string[]>>;
}) {
  const t = useAppTheme();
  const [open, setOpen] = useState(false);
  const iconOf = (lightning: boolean) => (account: AccountId) => (iconFor ? iconFor(account) : accountIcon(account, lightning));
  const showChain = new Set([...destinations, ...(lightningDestinations ?? [])].map(d => d.chain)).size > 1;
  const current = destinations.find(d => d.account === destination);
  const currentLn = lightningDestinations?.find(d => d.account === lightningDestination);
  const summary = method === 'universal'
    ? `${METHOD_LABELS[method]}${currentLn ? ` · ${currentLn.label}` : ''}`
    : `${METHOD_LABELS[method]}${current ? ` · ${current.label}` : ''}`;
  const caption = { color: t.colors.text.tertiary, fontSize: t.typography.fontSize.xs, fontWeight: '600' as const, letterSpacing: 0.6, textTransform: 'uppercase' as const, marginTop: t.spacing[2] };
  const footnote = { color: t.colors.text.tertiary, fontSize: t.typography.fontSize.xs, paddingTop: t.spacing[1] };
  return <View style={{ gap: t.spacing[3], marginBottom: t.spacing[4] }}>
    <TouchableOpacity
      accessibilityRole="button" accessibilityLabel={`How they pay: ${summary}. Change`}
      onPress={() => { feedback.select(); setOpen(true); }} activeOpacity={0.7}
      style={{ minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: t.spacing[3], paddingHorizontal: t.spacing[4],
        borderRadius: t.borderRadius.lg, backgroundColor: t.colors.surface.primary, borderWidth: 1, borderColor: t.colors.border.light }}>
      <Text style={{ color: t.colors.text.secondary, fontSize: t.typography.fontSize.sm }}>How they pay</Text>
      <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: t.spacing[2] }}>
        <Text style={{ color: t.colors.text.primary, fontWeight: '600', flexShrink: 1 }} numberOfLines={1}>{summary}</Text>
      </View>
      <Ionicons name="chevron-down" size={18} color={t.colors.text.secondary} />
    </TouchableOpacity>
    <Sheet visible={open} onClose={() => setOpen(false)} title="How they pay">
      <ScrollView style={{ maxHeight: 480 }} contentContainerStyle={{ paddingBottom: t.spacing[2], gap: t.spacing[2] }}>
        <Text style={caption}>Method</Text>
        {methods.map(key => <OptionRow<ReceiveMethodId> key={key} active={key === method}
          choice={{ key, title: METHOD_LABELS[key], icon: methodIcons?.[key]?.[0] }}
          onSelect={() => { onMethod(key); if (key !== 'universal') setOpen(false); }} />)}

        {method === 'universal' && !!chains && chains.length > 1 && onChain && <>
          <Text style={caption}>Network</Text>
          {chains.map(g => <OptionRow<ReceiveChain> key={g.chain} active={(chain ?? chains[0].chain) === g.chain}
            choice={{ key: g.chain, title: chainLabel(g.chain), detail: g.accounts.map(accountLabel).join(', ') }}
            onSelect={() => onChain(g.chain)} />)}
          <Text style={footnote}>One code can only ask for payment on one network. Accounts on other networks are left out.</Text>
        </>}

        {method === 'universal' && !!lightningDestinations?.length && onLightningDestination && <>
          <Text style={caption}>Lightning lands in</Text>
          {destinationChoices(lightningDestinations, amountSats, showChain, iconOf(true)).map(c =>
            <OptionRow<AccountId> key={c.key} active={c.key === lightningDestination} choice={c}
              onSelect={() => { onLightningDestination(c.key); setOpen(false); }} />)}
        </>}

        {method !== 'universal' && destinations.length > 0 && <>
          <Text style={caption}>{METHOD_LABELS[method]} lands in</Text>
          {destinationChoices(destinations, amountSats, showChain, iconOf(method === 'lightning')).map(c =>
            <OptionRow<AccountId> key={c.key} active={c.key === destination} choice={c}
              onSelect={() => { onDestination(c.key); setOpen(false); }} />)}
        </>}
      </ScrollView>
    </Sheet>
  </View>;
}
