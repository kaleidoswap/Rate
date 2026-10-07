// components/bridge/BridgePicker.tsx
//
// A tappable field showing the current choice (icon + label) that opens a
// sheet listing every option with its artwork.
import React, { useState } from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppTheme } from '../../theme/ThemeProvider';
import { feedback } from '../../utils/feedback';
import { Sheet } from '../Sheet';

export interface BridgePickerOption {
  id: string;
  label: string;
  description?: string;
  icon: React.ReactNode;
}

export function BridgePicker({ caption, title, options, selectedId, onSelect, disabled }: {
  caption: string;
  title: string;
  options: BridgePickerOption[];
  selectedId: string;
  onSelect: (id: string) => void;
  disabled?: boolean;
}) {
  const t = useAppTheme();
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.id === selectedId);
  const canOpen = !disabled && options.length > 1;

  return (
    <View style={{ flex: 1, gap: t.spacing[1.5] }}>
      <Text style={{ color: t.colors.text.tertiary, fontSize: t.typography.fontSize.xs, fontWeight: '600' }}>{caption}</Text>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={`${caption}: ${selected?.label ?? 'none'}${canOpen ? '. Change' : ''}`}
        disabled={!canOpen}
        activeOpacity={0.7}
        onPress={() => { feedback.select(); setOpen(true); }}
        style={{
          minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: t.spacing[2.5],
          paddingHorizontal: t.spacing[3], borderRadius: t.borderRadius.lg, borderWidth: 1,
          borderColor: t.colors.border.light, backgroundColor: t.colors.surface.primary,
        }}
      >
        {selected?.icon}
        <Text numberOfLines={1} style={{ flex: 1, color: t.colors.text.primary, fontWeight: '600', fontSize: t.typography.fontSize.base }}>
          {selected?.label ?? '—'}
        </Text>
        {canOpen && <Ionicons name="chevron-down" size={16} color={t.colors.text.secondary} />}
      </TouchableOpacity>

      <Sheet visible={open} onClose={() => setOpen(false)} title={title}>
        <ScrollView style={{ maxHeight: 460 }} showsVerticalScrollIndicator={false}>
          {options.map((o) => {
            const active = o.id === selectedId;
            return (
              <TouchableOpacity
                key={o.id}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={o.label}
                activeOpacity={0.7}
                onPress={() => { feedback.select(); onSelect(o.id); setOpen(false); }}
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: t.spacing[3], minHeight: 56,
                  paddingHorizontal: t.spacing[3], marginBottom: t.spacing[2], borderRadius: t.borderRadius.md,
                  borderWidth: 1,
                  borderColor: active ? t.colors.primary[500] : t.colors.border.light,
                  backgroundColor: active ? t.colors.primary[50] : t.colors.background.secondary,
                }}
              >
                {o.icon}
                <View style={{ flex: 1 }}>
                  <Text style={{ color: active ? t.colors.primary[500] : t.colors.text.primary, fontWeight: '600' }}>{o.label}</Text>
                  {!!o.description && (
                    <Text style={{ color: t.colors.text.tertiary, fontSize: t.typography.fontSize.xs, marginTop: 2 }}>{o.description}</Text>
                  )}
                </View>
                {active && <Ionicons name="checkmark" size={18} color={t.colors.primary[500]} />}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </Sheet>
    </View>
  );
}
