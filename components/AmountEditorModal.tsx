// components/AmountEditorModal.tsx
import React, { useMemo, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AmountInput } from '@kaleidorg/kaleido-ui/native';
import { theme } from '../theme';
import { feedback } from '../utils/feedback';

const SATS_PER_BTC = 1e8;

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Current value in satoshis (0 / undefined = empty). */
  initialSats?: number;
  /** BTC→fiat rates, lowercase-keyed (e.g. { usd: 65000 }). */
  rates: Record<string, number>;
  /** Preferred crypto unit from settings ('BTC' | 'sats'). Kept for API compat. */
  bitcoinUnit?: 'BTC' | 'sats';
  /** Optional spendable balance (sats) used by the WDK input's balance row. */
  balanceSats?: number;
  /** Called with the resolved satoshi amount (0 to clear). */
  onConfirm: (sats: number) => void;
}

function fmt(n: number, decimals = 0): string {
  return n.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

// WDK AmountInput toggles token ↔ fiat; token = BTC, fiat = USD.
type Mode = 'token' | 'fiat';

export const AmountEditorModal: React.FC<Props> = ({
  visible,
  onClose,
  initialSats,
  rates,
  balanceSats,
  onConfirm,
}) => {
  const [inputMode, setInputMode] = useState<Mode>('token');
  const [value, setValue] = useState('');
  const usdRate = rates['usd'];

  const computeSats = (v: string, mode: Mode): number => {
    const n = parseFloat(v.replace(/,/g, ''));
    if (isNaN(n) || n <= 0) return 0;
    if (mode === 'token') return Math.round(n * SATS_PER_BTC); // BTC
    if (!usdRate) return 0;
    return Math.round((n / usdRate) * SATS_PER_BTC); // USD → sats
  };

  // Seed the input from the incoming sats whenever the sheet opens.
  React.useEffect(() => {
    if (!visible) return;
    setInputMode('token');
    setValue(initialSats && initialSats > 0 ? (initialSats / SATS_PER_BTC).toString() : '');
  }, [visible]);

  const sats = computeSats(value, inputMode);

  // Secondary line: the value in the other domains (BTC · sats · $).
  const secondary = useMemo(() => {
    if (!sats) return null;
    const btc = sats / SATS_PER_BTC;
    const parts: string[] = [`${btc.toFixed(8)} BTC`, `${fmt(sats)} sats`];
    if (usdRate) parts.push(`$${fmt(btc * usdRate, 2)}`);
    return parts.join('  ·  ');
  }, [sats, usdRate]);

  // Toggle BTC ↔ USD, carrying the entered value across for continuity.
  const toggleMode = () => {
    feedback.select();
    const s = computeSats(value, inputMode);
    const next: Mode = inputMode === 'token' ? 'fiat' : 'token';
    if (s > 0) {
      if (next === 'token') setValue((s / SATS_PER_BTC).toString());
      else if (usdRate) setValue(((s / SATS_PER_BTC) * usdRate).toFixed(2));
    }
    setInputMode(next);
  };

  const balBtc = balanceSats && balanceSats > 0 ? balanceSats / SATS_PER_BTC : 0;
  const tokenBalance = balBtc ? balBtc.toFixed(8) : '0';
  const tokenBalanceUSD = usdRate ? `$${fmt(balBtc * usdRate, 2)}` : '$0.00';
  const onUseMax = () => {
    if (!balanceSats) return;
    feedback.select();
    if (inputMode === 'token') setValue(balBtc.toString());
    else if (usdRate) setValue((balBtc * usdRate).toFixed(2));
  };

  const handleConfirm = () => {
    feedback.success();
    onConfirm(sats);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <TouchableOpacity style={styles.backdropTouch} activeOpacity={1} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.headerRow}>
            <Text style={styles.title}>Enter amount</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Ionicons name="close" size={22} color={theme.colors.text.tertiary} />
            </TouchableOpacity>
          </View>

          {/* WDK amount input (BTC ↔ USD toggle) */}
          <AmountInput
            label="Amount to receive"
            value={value}
            onChangeText={(t) => setValue(t.replace(/[^\d.,]/g, ''))}
            tokenSymbol="BTC"
            tokenBalance={tokenBalance}
            tokenBalanceUSD={tokenBalanceUSD}
            inputMode={inputMode}
            onToggleInputMode={toggleMode}
            onUseMax={onUseMax}
          />

          {/* Live conversion across all domains */}
          <Text style={styles.secondary} numberOfLines={1}>
            {secondary || 'Enter an amount to see conversions'}
          </Text>

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
      </KeyboardAvoidingView>
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
  secondary: {
    marginTop: 2,
    fontSize: 13,
    color: theme.colors.text.secondary,
    fontFamily: mono,
  },
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
