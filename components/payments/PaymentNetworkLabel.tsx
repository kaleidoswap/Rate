import React from 'react';
import { Text } from 'react-native';
import { useAppTheme } from '../../theme/ThemeProvider';
import { paymentNetworks } from '../../utils/payment-network';

export function PaymentNetworkLabel({ request }: { request: string }) {
  const t = useAppTheme();
  const networks = paymentNetworks(request);
  if (!networks.length) return null;
  return <Text accessibilityLabel={`Payment network: ${networks.join(', ')}`} style={{ color: t.colors.text.secondary, fontSize: t.typography.fontSize.sm, textAlign: 'center' }}>
    {networks.join(' · ')}{networks.every(n => n !== 'Mainnet') ? ' · Test funds' : ''}
  </Text>;
}
