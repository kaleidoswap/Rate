import React from 'react';
import { Text } from 'react-native';
import { useAppTheme } from '../../theme/ThemeProvider';
import { paymentNetworks } from '../../utils/payment-network';

/** Warns when a request is for a test network; says nothing on mainnet. */
export function PaymentNetworkLabel({ request }: { request: string }) {
  const t = useAppTheme();
  const networks = paymentNetworks(request);
  // Mainnet is the normal case and goes unsaid; only a test network is called out.
  if (!networks.length || networks.includes('Mainnet')) return null;
  return <Text accessibilityLabel={`Payment network: ${networks.join(', ')}`} style={{ color: t.colors.text.secondary, fontSize: t.typography.fontSize.sm, textAlign: 'center' }}>
    {networks.join(' · ')} · Test funds
  </Text>;
}
