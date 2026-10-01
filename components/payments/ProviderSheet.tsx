import React, { useEffect, useState } from 'react';
import { Modal, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAppTheme } from '../../theme/ThemeProvider';

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
}

/** Shared by exact-output payments and exact-input swaps; never ranks unlike assets. */
export function ProviderSheet({ visible, options, selectedId, onSelect, onClose, now }: {
  visible: boolean; options: ProviderOption[]; selectedId?: string;
  onSelect: (id: string) => void; onClose: () => void; now?: number;
}) {
  const t = useAppTheme();
  const [clock, setClock] = useState(Date.now());
  useEffect(() => { if (!visible) return; setClock(Date.now()); const timer = setInterval(() => setClock(Date.now()), 1000); return () => clearInterval(timer); }, [visible]);
  const currentTime = now ?? clock;
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: t.colors.background.primary }}>
        <View style={{ padding: t.spacing[5], flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text accessibilityRole="header" style={{ color: t.colors.text.primary, fontSize: t.typography.fontSize.xl, fontWeight: '600' }}>Compare providers</Text>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Close providers" onPress={onClose} style={{ padding: t.spacing[3] }}><Ionicons name="close" size={24} color={t.colors.text.primary} /></TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={{ padding: t.spacing[5], gap: t.spacing[3] }}>
          <Text style={{ color: t.colors.text.secondary, marginBottom: t.spacing[2] }}>Compare the same payment. Your selection stays fixed until you change it.</Text>
          {!options.length && <Text style={{ color: t.colors.text.secondary }}>No offers yet. Request live quotes to compare providers.</Text>}
          {options.map(option => {
            const expired = option.expiresAt !== undefined && option.expiresAt <= currentTime;
            const reason = option.unavailable || (expired ? 'Quote expired. Refresh to compare again.' : '');
            return (
              <TouchableOpacity key={option.id} disabled={!!reason} accessibilityRole="radio" accessibilityState={{ selected: selectedId === option.id, disabled: !!reason }}
                accessibilityLabel={`${option.name}. ${option.amountLabel} ${option.amount}. ${reason || option.detail}`}
                onPress={() => { onSelect(option.id); onClose(); }}
                style={{ padding: t.spacing[4], gap: t.spacing[2], borderRadius: t.borderRadius.xl, backgroundColor: t.colors.surface.primary, borderWidth: 1, borderColor: selectedId === option.id ? t.colors.primary[500] : t.colors.border.light }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: t.spacing[2] }}>
                  <Text style={{ color: t.colors.text.primary, fontSize: t.typography.fontSize.base, fontWeight: '600', flex: 1 }}>{option.name}</Text>
                  {option.recommended && !reason && <Text style={{ color: t.colors.primary[500] }}>Best quote</Text>}
                </View>
                {!!option.account && <Text style={{ color: t.colors.text.secondary }}>{option.account}</Text>}
                <Text style={{ color: t.colors.text.secondary }}>{option.amountLabel}</Text>
                <Text style={{ color: t.colors.text.primary, fontSize: t.typography.fontSize.xl, fontWeight: '600' }}>{option.amount}</Text>
                <Text style={{ color: reason ? t.colors.warning[500] : t.colors.text.secondary }}>{reason || option.detail}</Text>
                {!reason && option.expiresAt !== undefined && <Text style={{ color: t.colors.text.secondary }}>Valid for {Math.max(0, Math.ceil((option.expiresAt - currentTime) / 1000))}s</Text>}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}
