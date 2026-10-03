import React, { useEffect, useState } from 'react';
import { Modal, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAppTheme } from '../../theme/ThemeProvider';
import { ReceiveQr } from './ReceiveQr';
import { ReceiveRequestActions } from './ReceiveRequestActions';
import { NetworkIcon } from '../NetworkIcon';
import { InvoiceExpiry } from '../payments/InvoiceExpiry';

export interface ReceiveCodeMethod { key: string; label: string; value: string; layer?: string; protocol?: string }
export function ReceiveMethodsSheet({ visible, methods, qrSize, onClose, children, onRefresh, showCountdown = false, onAdvancedOpen, additionalMethods }: {
  additionalMethods?: React.ReactNode; visible: boolean; methods: ReceiveCodeMethod[]; qrSize: number; onClose: () => void; children?: React.ReactNode; onRefresh?: () => void; showCountdown?: boolean; onAdvancedOpen?: () => void;
}) {
  const t = useAppTheme();
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const selected = methods.find(m => m.key === selectedKey);
  useEffect(() => { if (!visible) { setSelectedKey(null); setShowAdvanced(false); } }, [visible]);
  const iconButton = { minHeight: 44, minWidth: 44, alignItems: 'center' as const, justifyContent: 'center' as const };
  return <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
    <SafeAreaView style={{ flex: 1, backgroundColor: t.colors.background.primary }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', padding: t.spacing[4], gap: t.spacing[2] }}>
        {!!selected && <TouchableOpacity accessibilityRole="button" accessibilityLabel="Back to payment methods" style={iconButton} onPress={() => setSelectedKey(null)}>
          <Ionicons name="arrow-back" size={22} color={t.colors.text.primary} />
        </TouchableOpacity>}
        <Text accessibilityRole="header" style={{ flex: 1, color: t.colors.text.primary, fontSize: t.typography.fontSize.xl, fontWeight: '600' }}>{selected?.label ?? 'Payment methods'}</Text>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Close payment methods" style={iconButton} onPress={onClose}>
          <Ionicons name="close" size={24} color={t.colors.text.primary} />
        </TouchableOpacity>
      </View>
      <ScrollView contentContainerStyle={{ padding: t.spacing[5], gap: t.spacing[4] }}>
        {selected ? <>
          <Text style={{ color: t.colors.text.secondary, textAlign: 'center' }}>Ask the sender to use {selected.label}.</Text>
          <ReceiveQr value={selected.value} size={qrSize} />
          <InvoiceExpiry showCountdown={showCountdown} invoice={selected.value} onRefresh={onRefresh} />
          <ReceiveRequestActions key={selected.key} value={selected.value} label={selected.label} showValue />
        </> : <>
          {methods.map(method => <TouchableOpacity key={method.key} accessibilityRole="button" accessibilityLabel={`Show ${method.label} payment code`}
            onPress={() => setSelectedKey(method.key)} style={{ minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: t.spacing[3], borderBottomWidth: 1, borderBottomColor: t.colors.border.light }}>
            <View style={{ width: 40, height: 40, borderRadius: t.borderRadius.lg, backgroundColor: t.colors.surface.secondary, alignItems: 'center', justifyContent: 'center' }}>
              <NetworkIcon network={method.key === 'onchain' ? 'onchain' : method.layer ?? method.key} size={24} />
            </View>
            <View style={{ flex: 1, gap: t.spacing[1] }}>
              <Text style={{ color: t.colors.text.primary, fontSize: t.typography.fontSize.base }}>{method.label}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={t.colors.text.secondary} />
          </TouchableOpacity>)}
          {additionalMethods}
          {React.Children.toArray(children).length > 0 && <>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Advanced receive options" accessibilityState={{ expanded: showAdvanced }}
              onPress={() => { if (!showAdvanced) onAdvancedOpen?.(); setShowAdvanced(v => !v); }} style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: t.spacing[3] }}>
              <Ionicons name="options-outline" size={20} color={t.colors.text.secondary} />
              <Text style={{ flex: 1, color: t.colors.text.secondary }}>Advanced options</Text>
              <Ionicons name={showAdvanced ? 'chevron-up' : 'chevron-down'} size={18} color={t.colors.text.secondary} />
            </TouchableOpacity>
            {showAdvanced && children}
          </>}
        </>}
      </ScrollView>
    </SafeAreaView>
  </Modal>;
}
