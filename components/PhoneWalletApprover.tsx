import React, { useEffect, useRef, useState } from 'react';
import { AppState, Modal, Platform, ScrollView, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from './Button';
import { useAppSelector, useAppDispatch } from '../store/hooks';
import { loadBtcBalance } from '../store/slices/walletSlice';
import { syncAssets } from '../store/slices/assetsSlice';
import { useAppLanguage } from '../localization/useAppLanguage';
import { useAppTheme } from '../theme/ThemeProvider';
import { onAppLock } from '../services/appLockState';
import {
  invalidatePhoneApprovals,
  onPhoneBackground,
  setPhonePaymentListener,
  onPhonePairChanged,
  selectPhoneWallet,
  setPhoneReviewHandler,
} from '../services/nwc/phoneWalletHost';
import { PhoneWalletError, type PaymentReview } from '../services/nwc/phoneWalletProtocol';
import { formatAssetAmount } from '../utils/assetAmount';
import { utexoUsdtContract } from '../services/protocols/utexoUsdt';

export function PhoneWalletApprover() {
  const theme = useAppTheme();
  const { t } = useAppLanguage();
  const dispatch = useAppDispatch();
  const walletId = useAppSelector((state) => state.wallet.activeWallet?.id);
  const [review, setReview] = useState<PaymentReview>();
  const pending = useRef<{ finish: (yes: boolean) => void } | null>(null);
  const dismissed = useRef<((yes: boolean) => void) | null>(null);

  function answer(yes: boolean) {
    const current = pending.current;
    pending.current = null;
    setReview(undefined);
    if (!current) {
      if (!yes && dismissed.current) {
        const finish = dismissed.current;
        dismissed.current = null;
        finish(false);
      }
      return;
    }
    if (yes && Platform.OS === 'ios') dismissed.current = current.finish;
    else current.finish(yes);
  }

  useEffect(() => {
    setPhonePaymentListener((id) => {
      if (id !== walletId) return;
      void dispatch(loadBtcBalance());
      // Activity reloads native RGB transfers when its asset inventory changes.
      void dispatch(syncAssets(id));
    });
    void selectPhoneWallet(walletId).catch(() => undefined);
    setPhoneReviewHandler(
      (intent) =>
        new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => answer(false), Math.max(0, intent.expires * 1000 - Date.now()));
          pending.current = {
            finish: (approved) => {
              clearTimeout(timer);
              if (approved) resolve();
              else
                reject(new PhoneWalletError('RESTRICTED', 'Payment declined or expired on the phone.'));
            },
          };
          setReview(intent);
        }),
    );
    const invalidate = () => {
      invalidatePhoneApprovals();
      answer(false);
    };
    const unsubscribe = onAppLock(invalidate);
    const cancelOnPairChange = onPhonePairChanged(() => answer(false));
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'background') {
        onPhoneBackground();
        answer(false);
      }
    });
    return () => {
      invalidate();
      subscription.remove();
      unsubscribe();
      cancelOnPairChange();
      setPhoneReviewHandler(undefined);
      setPhonePaymentListener(undefined);
      void selectPhoneWallet(undefined);
    };
  }, [walletId, dispatch]);

  const label = { color: theme.colors.text.secondary };
  const value = { color: theme.colors.text.primary, fontSize: 17 };
  return (
    <Modal
      visible={!!review}
      animationType="slide"
      onRequestClose={() => answer(false)}
      onDismiss={() => {
        const done = dismissed.current;
        dismissed.current = null;
        done?.(true);
      }}
    >
      {review && (
        <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background.primary }}>
          <ScrollView contentContainerStyle={{ padding: theme.spacing[5], gap: theme.spacing[3] }}>
            <Text accessibilityRole="header" style={{ ...value, fontSize: 24 }}>
              {t('Approve RGB payment')}
            </Text>
            <Text style={label}>
              {t(review.origin ? 'Site reported by your paired browser' : 'Requested by')}
            </Text>
            <Text selectable style={value}>
              {review.origin ?? t('KaleidoSwap browser extension')}
            </Text>
            <Text style={label}>{t('Amount')}</Text>
            <Text style={value}>
              {formatAssetAmount(review.amount, review.precision)} {review.ticker} ({review.amount}{' '}
              {t('base units')})
            </Text>
            <Text style={label}>{t('Asset contract')}</Text>
            {review.asset === utexoUsdtContract(review.network) && <Text style={value}>Utexo USDT</Text>}
            <Text selectable style={value}>
              {review.asset}
            </Text>
            <Text style={label}>{t('Recipient')}</Text>
            <Text selectable style={value}>
              {review.recipient}
            </Text>
            <Text style={label}>{t('Network')}</Text>
            <Text style={value}>{review.network}</Text>
            <Text style={label}>{t('Bitcoin miner fee rate')}</Text>
            <Text style={value}>{review.feeRate} sat/vB</Text>
            {review.witnessSats > 0 && (
              <Text style={value}>
                {t('Bitcoin sent with the asset')} · {review.witnessSats} sats
              </Text>
            )}
            <Button title={t('Confirm with passkey')} onPress={() => answer(true)} />
            <Button title={t('Decline payment')} variant="secondary" onPress={() => answer(false)} />
          </ScrollView>
        </SafeAreaView>
      )}
    </Modal>
  );
}
