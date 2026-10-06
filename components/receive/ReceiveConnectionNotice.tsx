import React, { useEffect, useState } from 'react';
import { AppState, Text } from 'react-native';
import { protocolManager } from '../../services/protocols';
import { useAppTheme } from '../../theme/ThemeProvider';

const connected = () => ['RGB_LN', 'RGB_L1', 'SPARK', 'ARKADE', 'BARK'].some(p => protocolManager.getAdapterIfAvailable(p as 'RGB_LN' | 'RGB_L1' | 'SPARK' | 'ARKADE' | 'BARK')?.isConnected());
/** Connection changes only update this notice, never the request identity. */
export function ReceiveConnectionNotice({ hasRequest }: { hasRequest: boolean }) {
  const t = useAppTheme();
  const [available, setAvailable] = useState(connected);
  useEffect(() => {
    const update = () => setAvailable(connected());
    const timer = setInterval(update, 10000);
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') update(); });
    return () => { clearInterval(timer); subscription.remove(); };
  }, []);
  if (available) return null;
  return <Text accessibilityLiveRegion="polite" style={{ color: t.colors.warning[500], marginBottom: t.spacing[3] }}>
    {hasRequest ? 'Wallet accounts are disconnected. Your request is unchanged; reconnect to check for payment.' : 'Connect a wallet account to create a request, then tap Try again.'}
  </Text>;
}
