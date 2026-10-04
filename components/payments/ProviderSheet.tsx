import { useForegroundClock } from '../../hooks/useForegroundClock';
import React from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppTheme } from '../../theme/ThemeProvider';
import { NetworkIcon } from '../NetworkIcon';
import { Sheet } from '../Sheet';

export interface ProviderOption {
  id: string;
  name: string;
  account?: string;
  amount: string;
  amountLabel: string;
  detail: string;
  expiresAt?: number;
  unavailable?: string;
  recommended?: boolean;
  /** NetworkIcon name, or 'swap' for a provider route. */
  icon?: string;
  /** One line under the name; replaces `account` and `detail` when set. */
  subtitle?: string;
  /** Shown under the amount, e.g. "No fee" or "150 sats fee". */
  fee?: string;
  /** Section heading; options keep their order within a section. */
  group?: string;
  /** The receiver's first choice. */
  preferred?: boolean;
}

/** Shared by exact-output payments and exact-input swaps; never ranks unlike assets. */
export function ProviderSheet({ visible, options, selectedId, onSelect, onClose, now, title = 'Compare providers', intro = 'Compare the same payment. Your selection stays fixed until you change it.' }: {
  visible: boolean; options: ProviderOption[]; selectedId?: string;
  onSelect: (id: string) => void; onClose: () => void; now?: number; title?: string; intro?: string;
}) {
  const t = useAppTheme();
  const clock = useForegroundClock(visible && now === undefined);
  const currentTime = now ?? clock;
  const reasonOf = (o: ProviderOption) => o.unavailable || (o.expiresAt !== undefined && o.expiresAt <= currentTime ? 'Quote expired. Refresh to compare again.' : '');
  const live = options.filter(o => !reasonOf(o));
  const groups: [string, ProviderOption[]][] = [];
  for (const o of live) {
    const key = o.group ?? '';
    const found = groups.find(g => g[0] === key);
    if (found) found[1].push(o); else groups.push([key, [o]]);
  }
  const unavailable = options.filter(o => reasonOf(o));
  if (unavailable.length) groups.push(['Not available now', unavailable]);
  const soonest = Math.min(...live.flatMap(o => o.expiresAt === undefined ? [] : [o.expiresAt]));
  const muted = { color: t.colors.text.secondary, fontSize: t.typography.fontSize.sm };

  const badge = (label: string, color: string) => (
    <View key={label} style={{ paddingHorizontal: t.spacing[2], paddingVertical: 2, borderRadius: t.borderRadius.full, backgroundColor: color + '22' }}>
      <Text style={{ color, fontSize: t.typography.fontSize.xs, fontWeight: '600' }}>{label}</Text>
    </View>
  );

  const card = (option: ProviderOption) => {
    const reason = reasonOf(option);
    const selected = selectedId === option.id;
    const subtitle = option.subtitle ?? [option.account, option.detail].filter(Boolean).join(' · ');
    const freeFee = option.fee === 'No fee';
    return (
      <TouchableOpacity key={option.id} disabled={!!reason} accessibilityRole="radio" accessibilityState={{ checked: selected, disabled: !!reason }}
        accessibilityLabel={`${option.name}. ${option.amountLabel} ${option.amount}. ${reason || option.fee || option.detail}. ${subtitle}`}
        onPress={() => {
          if (option.expiresAt !== undefined && option.expiresAt <= (now ?? Date.now())) return;
          onSelect(option.id); onClose();
        }}
        style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing[3], padding: t.spacing[3], borderRadius: t.borderRadius.lg, opacity: reason ? 0.55 : 1,
          backgroundColor: selected ? t.colors.primary[50] : t.colors.background.secondary, borderWidth: selected ? 1.5 : 1, borderColor: selected ? t.colors.primary[500] : t.colors.border.light }}>
        <View style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: t.colors.surface.secondary }}>
          {option.icon === 'swap' || !option.icon
            ? <Ionicons name="swap-horizontal" size={20} color={t.colors.text.secondary} />
            : <NetworkIcon network={option.icon} size={22} />}
        </View>
        <View style={{ flex: 1, gap: 4 }}>
          <Text numberOfLines={2} style={{ color: t.colors.text.primary, fontSize: t.typography.fontSize.base, fontWeight: '600' }}>{option.name}</Text>
          <Text numberOfLines={2} style={{ ...muted, color: reason ? t.colors.warning[500] : t.colors.text.secondary }}>{reason || subtitle}</Text>
          {!reason && (option.preferred || option.recommended) && <View style={{ flexDirection: 'row', gap: t.spacing[2], marginTop: 2 }}>
            {option.preferred && badge('Their choice', t.colors.primary[500])}
            {option.recommended && badge('Best price', t.colors.success[500])}
          </View>}
        </View>
        <View style={{ alignItems: 'flex-end', gap: 4 }}>
          <Text style={{ color: t.colors.text.primary, fontSize: t.typography.fontSize.base, fontWeight: '600' }}>{reason ? '—' : option.amount}</Text>
          {!reason && <Text style={{ ...muted, color: freeFee ? t.colors.success[500] : t.colors.text.secondary }}>{option.fee ?? option.amountLabel}</Text>}
        </View>
        <Ionicons name={selected ? 'radio-button-on' : 'radio-button-off'} size={22} color={selected ? t.colors.primary[500] : t.colors.text.tertiary} />
      </TouchableOpacity>
    );
  };

  return (
    <Sheet visible={visible} onClose={onClose} title={title} tall>
      <ScrollView contentContainerStyle={{ paddingBottom: t.spacing[4], gap: t.spacing[3] }} showsVerticalScrollIndicator={false}>
        <Text style={muted}>
          {intro}{Number.isFinite(soonest) ? ` Quotes valid for ${Math.max(0, Math.ceil((soonest - currentTime) / 1000))}s.` : ''}
        </Text>
        {!options.length && <Text style={{ color: t.colors.text.secondary }}>No offers yet. Request live quotes to compare providers.</Text>}
        {groups.map(([heading, list]) => (
          <View key={heading || 'options'} style={{ gap: t.spacing[2], marginTop: t.spacing[2] }}>
            {!!heading && <Text style={{ ...muted, fontSize: t.typography.fontSize.xs, fontWeight: '600', letterSpacing: 0.8, textTransform: 'uppercase', color: t.colors.text.tertiary }}>{heading}</Text>}
            {list.map(card)}
          </View>
        ))}
      </ScrollView>
    </Sheet>
  );
}
