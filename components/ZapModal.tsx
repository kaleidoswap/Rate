// components/ZapModal.tsx
//
// Fast "send via zap" sheet for a contact. For a Nostr contact (with a hex
// pubkey) it sends a real NIP-57 zap — a signed kind-9734 zap request goes to
// the recipient's LNURL callback, the wallet pays the returned invoice, and the
// recipient's provider publishes a public kind-9735 zap receipt. For a contact
// with only a Lightning address it falls back to a private LNURL-pay.
//
// Amount entry uses the WDK UIKit AmountInput (token/fiat toggle, Use Max),
// which is themed by the KaleidoThemeProvider already mounted in App.tsx.
import React, { useMemo, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Image,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AmountInput } from '@kaleidorg/kaleido-ui/native';
import { theme } from '../theme';
import { useBitcoinConversion } from '../utils/bitcoinUnits';
import { feedback } from '../utils/feedback';
import NostrService from '../services/NostrService';
import { protocolManager } from '../services/protocols';

export interface ZapRecipient {
  name: string;
  pubkey?: string; // hex Nostr pubkey (enables a real NIP-57 zap)
  lightningAddress?: string;
  npub?: string;
  avatarUrl?: string;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  recipient: ZapRecipient | null;
  /** Spendable balance hint (sats), shown for context. Not hard-enforced —
   *  Lightning routing uses channel capacity, so the send surfaces real errors. */
  availableSats?: number;
  onSuccess?: (info: { amountSats: number; isZap: boolean }) => void;
}

const PRESETS = [21, 100, 500, 1000, 5000, 21000];

const formatSats = (n: number) =>
  n.toLocaleString(undefined, { maximumFractionDigits: 0 });

export default function ZapModal({
  visible,
  onClose,
  recipient,
  availableSats,
  onSuccess,
}: Props) {
  const { bitcoinPrice, formatSatoshisToUSD } = useBitcoinConversion();

  const [value, setValue] = useState('');
  const [inputMode, setInputMode] = useState<'token' | 'fiat'>('token');
  const [comment, setComment] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // In token mode the value is sats; in fiat mode it is USD.
  const amountSats = useMemo(() => {
    const n = parseFloat(value);
    if (!Number.isFinite(n) || n <= 0) return 0;
    if (inputMode === 'fiat') {
      return bitcoinPrice > 0 ? Math.round((n / bitcoinPrice) * 1e8) : 0;
    }
    return Math.round(n);
  }, [value, inputMode, bitcoinPrice]);

  const reset = useCallback(() => {
    setValue('');
    setComment('');
    setInputMode('token');
    setError(null);
    setSending(false);
  }, []);

  const close = useCallback(() => {
    if (sending) return;
    reset();
    onClose();
  }, [sending, reset, onClose]);

  const applyPreset = useCallback((sats: number) => {
    feedback.select();
    setInputMode('token');
    setValue(String(sats));
    setError(null);
  }, []);

  const toggleInputMode = useCallback(() => {
    feedback.select();
    setInputMode((prev) => {
      const next = prev === 'token' ? 'fiat' : 'token';
      // Convert the currently entered value so the amount stays equivalent.
      const n = parseFloat(value);
      if (Number.isFinite(n) && n > 0 && bitcoinPrice > 0) {
        if (next === 'fiat') {
          const usd = (n / 1e8) * bitcoinPrice; // n is sats
          setValue(usd.toFixed(2));
        } else {
          const sats = Math.round((n / bitcoinPrice) * 1e8); // n is usd
          setValue(String(sats));
        }
      }
      return next;
    });
  }, [value, bitcoinPrice]);

  const useMax = useCallback(() => {
    if (!availableSats || availableSats <= 0) return;
    feedback.select();
    setInputMode('token');
    setValue(String(availableSats));
    setError(null);
  }, [availableSats]);

  const handleZap = useCallback(async () => {
    if (!recipient) return;
    if (amountSats <= 0) {
      setError('Enter an amount greater than zero.');
      return;
    }

    setSending(true);
    setError(null);
    try {
      // 1) Build the invoice — a zap-tagged one for Nostr contacts, else LNURL-pay.
      const result = recipient.pubkey
        ? await NostrService.getInstance().requestZapInvoice({
            pubkey: recipient.pubkey,
            amountSats,
            comment: comment.trim() || undefined,
          })
        : recipient.lightningAddress
          ? await NostrService.getInstance().requestLnurlPayInvoice({
              lightningAddress: recipient.lightningAddress,
              amountSats,
              comment: comment.trim() || undefined,
            })
          : { error: 'This contact has no Lightning address.' };

      if ('error' in result) {
        feedback.error();
        setError(result.error);
        return;
      }

      // 2) Pay the invoice with the active wallet protocol's Lightning adapter.
      await protocolManager.sendPayment({ invoice: result.invoice });

      const isZap = 'isZap' in result ? Boolean(result.isZap) : false;
      feedback.send();
      onSuccess?.({ amountSats, isZap });
      reset();
      onClose();
    } catch (e: any) {
      feedback.error();
      setError(e?.message || 'The payment failed. Please try again.');
    } finally {
      setSending(false);
    }
  }, [recipient, amountSats, comment, onSuccess, onClose, reset]);

  if (!recipient) return null;

  const avatarUri =
    recipient.avatarUrl ||
    `https://robohash.org/${recipient.pubkey || recipient.name}?set=set3&size=120x120`;
  const tokenBalance = availableSats != null ? formatSats(availableSats) : '—';
  const tokenBalanceUSD =
    availableSats != null ? `$${formatSatoshisToUSD(availableSats)}` : '—';
  const isZapCapable = !!recipient.pubkey;
  const ctaLabel = isZapCapable ? 'Zap' : 'Send';

  // Secondary live conversion under the amount.
  const secondary =
    amountSats > 0
      ? inputMode === 'token'
        ? `$${formatSatoshisToUSD(amountSats)} USD`
        : `${formatSats(amountSats)} sats`
      : '';

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <View style={styles.backdrop}>
        <TouchableOpacity style={styles.backdropTouch} activeOpacity={1} onPress={close} />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.sheetWrap}
        >
          <View style={styles.sheet}>
            <View style={styles.handle} />

            {/* Recipient */}
            <View style={styles.header}>
              <View style={styles.avatar}>
                <Image source={{ uri: avatarUri }} style={styles.avatarImg} />
                <View style={styles.zapBadge}>
                  <Ionicons name="flash" size={12} color="#0B0B0B" />
                </View>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.title} numberOfLines={1}>
                  {isZapCapable ? 'Zap' : 'Send to'} {recipient.name}
                </Text>
                {recipient.lightningAddress ? (
                  <Text style={styles.subtitle} numberOfLines={1}>
                    <Ionicons name="flash" size={11} color={theme.colors.warning[500]} />{' '}
                    {recipient.lightningAddress}
                  </Text>
                ) : recipient.npub ? (
                  <Text style={styles.subtitle} numberOfLines={1}>
                    {recipient.npub.slice(0, 14)}…{recipient.npub.slice(-6)}
                  </Text>
                ) : null}
              </View>
              <TouchableOpacity onPress={close} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Ionicons name="close" size={24} color={theme.colors.text.secondary} />
              </TouchableOpacity>
            </View>

            {/* Amount (WDK) */}
            <AmountInput
              label="Amount"
              value={value}
              onChangeText={(t) => {
                setValue(t);
                setError(null);
              }}
              tokenSymbol="sats"
              tokenBalance={tokenBalance}
              tokenBalanceUSD={tokenBalanceUSD}
              inputMode={inputMode}
              onToggleInputMode={toggleInputMode}
              onUseMax={useMax}
              error={error || undefined}
              editable={!sending}
            />

            {secondary ? <Text style={styles.secondary}>≈ {secondary}</Text> : null}

            {/* Presets */}
            <View style={styles.presets}>
              {PRESETS.map((p) => {
                const active = inputMode === 'token' && parseInt(value, 10) === p;
                return (
                  <TouchableOpacity
                    key={p}
                    style={[styles.preset, active && styles.presetActive]}
                    onPress={() => applyPreset(p)}
                    disabled={sending}
                    activeOpacity={0.8}
                  >
                    <Ionicons
                      name="flash"
                      size={11}
                      color={active ? '#0B0B0B' : theme.colors.warning[500]}
                    />
                    <Text style={[styles.presetText, active && styles.presetTextActive]}>
                      {p >= 1000 ? `${p / 1000}k` : p}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Comment */}
            <TextInput
              style={styles.comment}
              value={comment}
              onChangeText={setComment}
              placeholder={isZapCapable ? 'Add a public zap message (optional)' : 'Note (optional)'}
              placeholderTextColor={theme.colors.text.tertiary}
              editable={!sending}
              maxLength={255}
            />

            {/* CTA */}
            <TouchableOpacity
              style={[styles.cta, (sending || amountSats <= 0) && styles.ctaDisabled]}
              onPress={handleZap}
              disabled={sending || amountSats <= 0}
              activeOpacity={0.85}
            >
              {sending ? (
                <ActivityIndicator color="#0B0B0B" />
              ) : (
                <>
                  <Ionicons name="flash" size={18} color="#0B0B0B" />
                  <Text style={styles.ctaText}>
                    {ctaLabel}
                    {amountSats > 0 ? ` ${formatSats(amountSats)} sats` : ''}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  backdropTouch: {
    ...StyleSheet.absoluteFillObject,
  },
  sheetWrap: {
    width: '100%',
  },
  sheet: {
    backgroundColor: theme.colors.background.secondary,
    borderTopLeftRadius: theme.borderRadius['2xl'],
    borderTopRightRadius: theme.borderRadius['2xl'],
    paddingHorizontal: theme.spacing[5],
    paddingTop: theme.spacing[3],
    paddingBottom: theme.spacing[8],
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: theme.colors.border.medium,
    marginBottom: theme.spacing[4],
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[3],
    marginBottom: theme.spacing[5],
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: theme.colors.surface.tertiary,
    overflow: 'visible',
  },
  avatarImg: {
    width: 48,
    height: 48,
    borderRadius: 24,
  },
  zapBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: theme.colors.warning[500],
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: theme.colors.background.secondary,
  },
  title: {
    fontSize: theme.typography.fontSize.lg,
    fontWeight: '700',
    color: theme.colors.text.primary,
  },
  subtitle: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.text.secondary,
    marginTop: 2,
  },
  secondary: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.text.tertiary,
    marginTop: -theme.spacing[2],
    marginBottom: theme.spacing[3],
    marginLeft: theme.spacing[1],
  },
  presets: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing[2],
    marginBottom: theme.spacing[4],
  },
  preset: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surface.primary,
    borderWidth: 1,
    borderColor: theme.colors.border.light,
  },
  presetActive: {
    backgroundColor: theme.colors.warning[500],
    borderColor: theme.colors.warning[500],
  },
  presetText: {
    fontSize: theme.typography.fontSize.sm,
    fontWeight: '600',
    color: theme.colors.text.secondary,
  },
  presetTextActive: {
    color: '#0B0B0B',
  },
  comment: {
    backgroundColor: theme.colors.surface.primary,
    borderWidth: 1,
    borderColor: theme.colors.border.light,
    borderRadius: theme.borderRadius.lg,
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    fontSize: theme.typography.fontSize.base,
    color: theme.colors.text.primary,
    marginBottom: theme.spacing[5],
  },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing[2],
    backgroundColor: theme.colors.warning[500],
    borderRadius: theme.borderRadius.lg,
    paddingVertical: theme.spacing[4],
  },
  ctaDisabled: {
    opacity: 0.5,
  },
  ctaText: {
    fontSize: theme.typography.fontSize.base,
    fontWeight: '700',
    color: '#0B0B0B',
  },
});
