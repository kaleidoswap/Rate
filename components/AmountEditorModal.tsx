// components/AmountEditorModal.tsx
import React, { useMemo, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../theme';
import { SUPPORTED_FIATS, FIAT_SYMBOLS } from '../hooks/useFiatRates';
import { feedback } from '../utils/feedback';

const SATS_PER_BTC = 1e8;

export type AmountUnit = 'BTC' | 'sats' | string; // string = fiat code (USD, EUR…)

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Current value in satoshis (0 / undefined = empty). */
  initialSats?: number;
  /** BTC→fiat rates, lowercase-keyed (e.g. { usd: 65000 }). */
  rates: Record<string, number>;
  /** Preferred crypto unit from settings ('BTC' | 'sats'). */
  bitcoinUnit?: 'BTC' | 'sats';
  /** Called with the resolved satoshi amount (0 to clear). */
  onConfirm: (sats: number) => void;
}

function toSats(value: string, unit: AmountUnit, rates: Record<string, number>): number {
  const n = parseFloat(value.replace(/,/g, ''));
  if (isNaN(n) || n <= 0) return 0;
  if (unit === 'sats') return Math.round(n);
  if (unit === 'BTC') return Math.round(n * SATS_PER_BTC);
  const rate = rates[unit.toLowerCase()];
  if (!rate) return 0;
  return Math.round((n / rate) * SATS_PER_BTC);
}

function fmt(n: number, decimals = 0): string {
  return n.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export const AmountEditorModal: React.FC<Props> = ({
  visible,
  onClose,
  initialSats,
  rates,
  bitcoinUnit = 'sats',
  onConfirm,
}) => {
  const [unit, setUnit] = useState<AmountUnit>(bitcoinUnit);
  const [value, setValue] = useState('');

  // Seed the input from the incoming sats whenever the sheet opens.
  React.useEffect(() => {
    if (!visible) return;
    setUnit(bitcoinUnit);
    if (initialSats && initialSats > 0) {
      setValue(
        bitcoinUnit === 'BTC'
          ? (initialSats / SATS_PER_BTC).toString()
          : String(Math.round(initialSats))
      );
    } else {
      setValue('');
    }
  }, [visible]);

  const units: AmountUnit[] = useMemo(
    () => ['BTC', 'sats', ...SUPPORTED_FIATS.filter((f) => rates[f.toLowerCase()])],
    [rates]
  );

  const sats = toSats(value, unit, rates);

  const unitLabel = (u: AmountUnit) =>
    u === 'BTC' || u === 'sats' ? u : FIAT_SYMBOLS[u] || u;

  // Secondary line: show the value in the "other" domains.
  const secondary = useMemo(() => {
    if (!sats) return null;
    const btc = sats / SATS_PER_BTC;
    const parts: string[] = [];
    if (unit !== 'BTC') parts.push(`${btc.toFixed(8)} BTC`);
    if (unit !== 'sats') parts.push(`${fmt(sats)} sats`);
    const usd = rates['usd'];
    if (usd && unit !== 'USD') parts.push(`$${fmt(btc * usd, 2)}`);
    return parts.join('  ·  ');
  }, [sats, unit, rates]);

  const handleConfirm = () => {
    feedback.success();
    onConfirm(sats);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <TouchableOpacity style={styles.backdropTouch} activeOpacity={1} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.headerRow}>
            <Text style={styles.title}>Enter amount</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Ionicons name="close" size={22} color={theme.colors.text.tertiary} />
            </TouchableOpacity>
          </View>

          {/* Value + active unit */}
          <View style={styles.inputRow}>
            <TextInput
              style={styles.input}
              value={value}
              onChangeText={(t) => setValue(t.replace(/[^\d.,]/g, ''))}
              placeholder="0"
              placeholderTextColor={theme.colors.text.muted}
              keyboardType="decimal-pad"
              autoFocus
            />
            <View style={styles.activeUnit}>
              <Text style={styles.activeUnitText}>{unitLabel(unit)}</Text>
            </View>
          </View>

          {/* Live conversion */}
          <Text style={styles.secondary} numberOfLines={1}>
            {secondary || 'Enter an amount to see conversions'}
          </Text>

          {/* Currency selector */}
          <Text style={styles.pickLabel}>Currency</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chips}
          >
            {units.map((u) => {
              const active = unit === u;
              return (
                <TouchableOpacity
                  key={u}
                  onPress={() => {
                    feedback.select();
                    setUnit(u);
                  }}
                  style={[styles.chip, active && styles.chipActive]}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>{u}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {/* Actions */}
          <View style={styles.actions}>
            <TouchableOpacity
              style={styles.clearBtn}
              onPress={() => {
                onConfirm(0);
                onClose();
              }}
              activeOpacity={0.7}
            >
              <Text style={styles.clearText}>Clear</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.confirmBtn} onPress={handleConfirm} activeOpacity={0.8}>
              <Text style={styles.confirmText}>Set amount</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const mono = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  backdropTouch: { ...StyleSheet.absoluteFillObject },
  sheet: {
    backgroundColor: theme.colors.surface.primary,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 32,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: theme.colors.border.medium,
    marginBottom: 14,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  title: { fontSize: 18, fontWeight: '700', color: theme.colors.text.primary },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: theme.colors.primary[500],
    paddingBottom: 8,
  },
  input: {
    flex: 1,
    fontSize: 32,
    fontWeight: '700',
    color: theme.colors.text.primary,
    padding: 0,
  },
  activeUnit: {
    backgroundColor: theme.colors.primary[50],
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
    marginLeft: 10,
  },
  activeUnitText: { fontSize: 16, fontWeight: '700', color: theme.colors.primary[600] },
  secondary: {
    marginTop: 10,
    fontSize: 13,
    color: theme.colors.text.secondary,
    fontFamily: mono,
  },
  pickLabel: {
    marginTop: 22,
    marginBottom: 10,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: theme.colors.text.tertiary,
  },
  chips: { gap: 8, paddingRight: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: theme.colors.border.medium,
    backgroundColor: theme.colors.background.secondary,
  },
  chipActive: {
    borderColor: theme.colors.primary[500],
    backgroundColor: theme.colors.primary[50],
  },
  chipText: { fontSize: 14, fontWeight: '600', color: theme.colors.text.secondary },
  chipTextActive: { color: theme.colors.primary[600], fontWeight: '700' },
  actions: { flexDirection: 'row', gap: 12, marginTop: 26 },
  clearBtn: {
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: theme.colors.border.medium,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clearText: { fontSize: 15, fontWeight: '600', color: theme.colors.text.secondary },
  confirmBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: theme.colors.primary[500],
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmText: { fontSize: 15, fontWeight: '700', color: theme.colors.text.inverse },
});

export default AmountEditorModal;
