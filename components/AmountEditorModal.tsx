// components/AmountEditorModal.tsx
import React, { useEffect, useMemo, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
  KeyboardAvoidingView,
  ScrollView,
  Keyboard,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AmountInput } from '@kaleidorg/kaleido-ui/native';
import { theme } from '../theme';
import { feedback } from '../utils/feedback';

const SATS_PER_BTC = 1e8;
const AMOUNT_DEBUG = typeof __DEV__ !== 'undefined' ? __DEV__ : true;
const amountLog = (event: string, details?: Record<string, unknown>) => {
  if (!AMOUNT_DEBUG) return;
  if (details) {
    console.log(`[AmountEditorModal] ${event}`, details);
  } else {
    console.log(`[AmountEditorModal] ${event}`);
  }
};

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
  bitcoinUnit = 'BTC',
  onConfirm,
}) => {
  const [inputMode, setInputMode] = useState<Mode>('token');
  const [value, setValue] = useState('');
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const usdRate = rates['usd'];
  const { height } = useWindowDimensions();
  // The "token" input is denominated per the caller's preference: sats (integer)
  // or BTC (8 decimals). The receive flow uses sats.
  const unitIsSats = bitcoinUnit === 'sats';
  // sats → the token-mode string shown in the input.
  const satsToToken = (sats: number): string =>
    unitIsSats ? String(Math.round(sats)) : (sats / SATS_PER_BTC).toString();

  const computeSats = (v: string, mode: Mode): number => {
    const n = parseFloat(v.replace(/,/g, ''));
    if (isNaN(n) || n <= 0) return 0;
    if (mode === 'token') return unitIsSats ? Math.round(n) : Math.round(n * SATS_PER_BTC);
    if (!usdRate) return 0;
    return Math.round((n / usdRate) * SATS_PER_BTC); // USD → sats
  };

  // Seed the input from the incoming sats whenever the sheet opens.
  React.useEffect(() => {
    if (!visible) return;
    amountLog('open', { initialSats, hasUsdRate: !!usdRate, height });
    setInputMode('token');
    setValue(initialSats && initialSats > 0 ? satsToToken(initialSats) : '');
  }, [visible, initialSats, usdRate]);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, (event) => {
      const nextHeight = event.endCoordinates?.height || 0;
      amountLog('keyboardShow', { height: nextHeight });
      setKeyboardHeight(nextHeight);
    });
    const hideSub = Keyboard.addListener(hideEvent, () => {
      amountLog('keyboardHide');
      setKeyboardHeight(0);
    });
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

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
    amountLog('toggleMode', { from: inputMode, value });
    feedback.select();
    const s = computeSats(value, inputMode);
    const next: Mode = inputMode === 'token' ? 'fiat' : 'token';
    if (s > 0) {
      if (next === 'token') setValue(satsToToken(s));
      else if (usdRate) setValue(((s / SATS_PER_BTC) * usdRate).toFixed(2));
    }
    setInputMode(next);
  };

  const balBtc = balanceSats && balanceSats > 0 ? balanceSats / SATS_PER_BTC : 0;
  const tokenBalance = unitIsSats
    ? String(Math.round(balanceSats || 0))
    : (balBtc ? balBtc.toFixed(8) : '0');
  const tokenBalanceUSD = usdRate ? `$${fmt(balBtc * usdRate, 2)}` : '$0.00';
  const onUseMax = () => {
    if (!balanceSats) return;
    amountLog('useMax', { balanceSats, inputMode });
    feedback.select();
    if (inputMode === 'token') setValue(satsToToken(balanceSats));
    else if (usdRate) setValue((balBtc * usdRate).toFixed(2));
  };

  const handleConfirm = () => {
    amountLog('confirm', { sats, inputMode, value });
    feedback.success();
    Keyboard.dismiss();
    onConfirm(sats);
    onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      presentationStyle="overFullScreen"
      statusBarTranslucent
    >
      <KeyboardAvoidingView style={styles.backdrop} behavior={undefined}>
        <TouchableOpacity
          style={styles.backdropTouch}
          activeOpacity={1}
          onPress={() => {
            amountLog('backdropClose');
            Keyboard.dismiss();
            onClose();
          }}
        />
        <ScrollView
          style={[
            styles.sheetScroll,
            {
              maxHeight: Math.max(260, Math.round((height - keyboardHeight) * 0.92)),
              marginBottom: keyboardHeight,
            },
          ]}
          contentContainerStyle={styles.sheetScrollContent}
          keyboardShouldPersistTaps="handled"
          bounces={false}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.sheet}>
            <View style={styles.handle} />
            <View style={styles.headerRow}>
              <Text style={styles.title}>Enter amount</Text>
              <TouchableOpacity
                onPress={() => {
                  amountLog('close');
                  Keyboard.dismiss();
                  onClose();
                }}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
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
                  amountLog('clear');
                  Keyboard.dismiss();
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
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const mono = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  backdropTouch: { ...StyleSheet.absoluteFillObject },
  sheetScroll: {
    width: '100%',
    zIndex: 2,
    elevation: 12,
  },
  sheetScrollContent: {
    flexGrow: 1,
    justifyContent: 'flex-end',
  },
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
