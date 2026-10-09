import React, { useState } from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppTheme } from '../../theme/ThemeProvider';
import { SegmentedTabs } from '../SegmentedTabs';
import { NetworkIcon } from '../NetworkIcon';
import { NetworkStack } from '../NetworkStack';
import { Sheet } from '../Sheet';
import { OnchainIcon } from '../ProtocolIcons';
import { feedback } from '../../utils/feedback';
import type { AccountId } from '../../utils/account-routing';
import {
  chainLabel, type ChainGroup, type ReceiveChain, type ReceiveDestination, type ReceiveMethodId,
} from '../../utils/receive-routes';

const METHOD_LABELS: Record<ReceiveMethodId, string> = {
  universal: 'Any wallet', lightning: 'Lightning', onchain: 'On-chain', spark: 'Spark', ark: 'Ark',
};
const METHOD_ICONS: Record<ReceiveMethodId, 'qr-code-outline' | 'flash-outline' | 'logo-bitcoin' | 'sparkles-outline' | 'planet-outline'> = {
  universal: 'qr-code-outline', lightning: 'flash-outline', onchain: 'logo-bitcoin', spark: 'sparkles-outline', ark: 'planet-outline',
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

/** A labelled row showing the current choice; opens a sheet with the options. */
function ChoiceRow<K extends string>({ label, title, choices, selected, onSelect, icon, sheetTitle, footnote }: {
  label: string; title: string; choices: Choice<K>[]; selected: K | null; onSelect: (key: K) => void;
  icon?: string; sheetTitle: string; footnote?: string;
}) {
  const t = useAppTheme();
  const [open, setOpen] = useState(false);
  const many = choices.length > 1;
  return <>
    <TouchableOpacity
      accessibilityRole="button" accessibilityLabel={`${label}: ${title}${many ? '. Change' : ''}`}
      disabled={!many} onPress={() => { feedback.select(); setOpen(true); }} activeOpacity={0.7}
      style={{ minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: t.spacing[3], paddingHorizontal: t.spacing[4],
        borderRadius: t.borderRadius.lg, backgroundColor: t.colors.surface.primary, borderWidth: 1, borderColor: t.colors.border.light }}>
      <Text style={{ color: t.colors.text.secondary, fontSize: t.typography.fontSize.sm }}>{label}</Text>
      <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: t.spacing[2] }}>
        {!!icon && <NetworkIcon network={icon} size={18} />}
        <Text style={{ color: t.colors.text.primary, fontWeight: '600', flexShrink: 1 }} numberOfLines={1}>{title}</Text>
      </View>
      {many && <Ionicons name="chevron-down" size={18} color={t.colors.text.secondary} />}
    </TouchableOpacity>
    <Sheet visible={open} onClose={() => setOpen(false)} title={sheetTitle}>
        <ScrollView style={{ maxHeight: 480 }} contentContainerStyle={{ paddingBottom: t.spacing[2], gap: t.spacing[2] }}>
          {choices.map(choice => {
            const active = choice.key === selected;
            return <TouchableOpacity key={choice.key}
              accessibilityRole="radio" accessibilityState={{ checked: active, disabled: !!choice.disabled }}
              accessibilityLabel={[choice.title, choice.badge, choice.detail, choice.disabled].filter(Boolean).join(', ')}
              disabled={!!choice.disabled} activeOpacity={0.7}
              onPress={() => { feedback.select(); setOpen(false); if (!active) onSelect(choice.key); }}
              style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing[3], padding: t.spacing[3], borderRadius: t.borderRadius.lg,
                borderWidth: 1, borderColor: active ? t.colors.primary[500] : t.colors.border.light, opacity: choice.disabled ? 0.5 : 1 }}>
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
          })}
          {!!footnote && <Text style={{ color: t.colors.text.tertiary, fontSize: t.typography.fontSize.xs, paddingTop: t.spacing[2] }}>{footnote}</Text>}
        </ScrollView>
    </Sheet>
  </>;
}

function MethodIcon({ icons, color, size }: { icons: string[]; color: string; size: number }) {
  if (icons.length > 1) return <NetworkStack networks={icons} size={size} ringColor="transparent" />;
  if (icons[0] === 'onchain') return <OnchainIcon color={color} size={size} />;
  return <NetworkIcon network={icons[0]} size={size} />;
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
 * How the payment arrives (the method tabs) and where it lands (the account). The
 * universal code also shows which network it is for when accounts span several.
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
  const iconOf = (lightning: boolean) => (account: AccountId) => (iconFor ? iconFor(account) : accountIcon(account, lightning));
  const showChain = new Set([...destinations, ...(lightningDestinations ?? [])].map(d => d.chain)).size > 1;
  const current = destinations.find(d => d.account === destination);
  const currentLn = lightningDestinations?.find(d => d.account === lightningDestination);
  const accountTitle = (d?: ReceiveDestination) => (d ? `${d.label}${showChain ? ` · ${chainLabel(d.chain)}` : ''}` : 'Choose an account');
  return <View style={{ gap: t.spacing[3], marginBottom: t.spacing[4] }}>
    {methods.length > 1 && <SegmentedTabs<ReceiveMethodId>
      options={methods.map(m => ({
        key: m, label: METHOD_LABELS[m], icon: METHOD_ICONS[m],
        renderIcon: methodIcons?.[m]?.length
          ? (color, size) => <MethodIcon icons={methodIcons[m]!} color={color} size={size} />
          : m === 'onchain' ? (color, size) => <OnchainIcon color={color} size={size} /> : undefined,
      }))}
      value={method} onChange={onMethod} />}
    {method === 'universal' && !!chains && chains.length > 1 && onChain && <ChoiceRow<ReceiveChain>
      label="Network" sheetTitle="Which network is this code for?"
      title={`${chainLabel(chain ?? chains[0].chain)} · ${(chains.find(g => g.chain === chain) ?? chains[0]).accounts.length} accounts`}
      selected={chain ?? chains[0].chain} onSelect={onChain}
      footnote="One code can only ask for payment on one network. Accounts on other networks are left out."
      choices={chains.map(g => ({ key: g.chain, title: chainLabel(g.chain), detail: g.accounts.map(accountLabel).join(', ') }))} />}
    {method === 'universal' && !!lightningDestinations?.length && onLightningDestination && <ChoiceRow<AccountId>
      label="Lightning to" sheetTitle="Where should Lightning payments land?"
      title={accountTitle(currentLn)} icon={currentLn ? iconOf(true)(currentLn.account) : undefined}
      selected={lightningDestination ?? null} onSelect={onLightningDestination}
      choices={destinationChoices(lightningDestinations, amountSats, showChain, iconOf(true))} />}
    {method !== 'universal' && destinations.length > 0 && <ChoiceRow<AccountId>
      label="Deposit to" sheetTitle={`Where should this ${METHOD_LABELS[method]} payment land?`}
      title={accountTitle(current)} icon={current ? iconOf(method === 'lightning')(current.account) : undefined}
      selected={destination} onSelect={onDestination}
      choices={destinationChoices(destinations, amountSats, showChain, iconOf(method === 'lightning'))} />}
  </View>;
}
