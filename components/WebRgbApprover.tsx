import React, { useEffect, useRef, useState } from 'react';
import { AppState, ScrollView, Text, View } from 'react-native';
import { useAppSelector } from '../store/hooks';
import { isAppUnlocked, subscribeAppLockState } from '../services/appLockState';
import { isRgbConnecting, subscribeRgbConnecting } from '../services/protocols/wdk';
import {
  invalidateWalletConnect, restoreWalletConnect, setWalletConnectReviewer, type WalletConnectReview,
} from '../services/webrgb/walletConnect';
import { useAppLanguage } from '../localization/useAppLanguage';
import { useAppTheme } from '../theme/ThemeProvider';
import { Button } from './Button';
import { Sheet } from './Sheet';

export function WebRgbApprover() {
  const walletId = useAppSelector(state => state.wallet.activeWallet?.id);
  const unlocked = useAppSelector(state => state.wallet.isUnlocked);
  const [review, setReview] = useState<WalletConnectReview | null>(null);
  const pending = useRef<((answer: boolean) => void) | null>(null);
  const { t } = useAppLanguage();
  const theme = useAppTheme();

  useEffect(() => {
    const ready = () => Boolean(walletId && unlocked && isAppUnlocked() && AppState.currentState === 'active' && !isRgbConnecting());
    const refresh = () => {
      if (ready()) void restoreWalletConnect().catch(() => {});
      else {
        pending.current?.(false);
        invalidateWalletConnect();
      }
    };

    setWalletConnectReviewer(request => new Promise<boolean>(resolve => {
      if (pending.current || request.signal.aborted || !ready()) { resolve(false); return; }
      const finish = (accepted: boolean) => {
        if (pending.current !== finish) return;
        pending.current = null;
        request.signal.removeEventListener('abort', abort);
        setReview(null);
        resolve(accepted && ready() && !request.signal.aborted);
      };
      const abort = () => finish(false);
      pending.current = finish;
      request.signal.addEventListener('abort', abort);
      setReview(request);
    }));
    const lock = subscribeAppLockState(refresh);
    const network = subscribeRgbConnecting(refresh);
    const app = AppState.addEventListener('change', refresh);
    refresh();
    return () => {
      lock(); network(); app.remove();
      setWalletConnectReviewer(undefined);
      pending.current?.(false);
      invalidateWalletConnect();
    };
  }, [walletId, unlocked]);

  if (!review) return null;
  const answer = pending.current;
  const connecting = review.kind === 'connect';
  return <Sheet visible title={t(connecting ? 'Connect this app?' : 'Approve this request?')} onClose={() => answer?.(false)}
    footer={<View style={{ flexDirection: 'row', gap: theme.spacing[3] }}>
      <Button title={t('Decline')} variant="secondary" style={{ flex: 1 }} onPress={() => answer?.(false)} />
      <Button title={t(connecting ? 'Connect' : 'Approve')} style={{ flex: 1 }} onPress={() => answer?.(true)} />
    </View>}>
    <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ gap: theme.spacing[2], paddingBottom: theme.spacing[4] }}>
      <Text style={{ color: theme.colors.text.primary, fontWeight: 'bold' }}>{review.url}</Text>
      <Text style={{ color: theme.colors.text.secondary }}>{review.name}</Text>
      {review.verification === 'UNKNOWN' && <Text style={{ color: theme.colors.text.secondary }}>{t('WalletConnect could not verify this site.')}</Text>}
      {review.details.map((detail, index) => <Text key={index} selectable style={{ color: theme.colors.text.primary }}>{detail}</Text>)}
    </ScrollView>
  </Sheet>;
}
