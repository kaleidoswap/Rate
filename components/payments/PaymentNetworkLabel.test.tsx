import React from 'react';
import { render } from '@testing-library/react-native';
import { PaymentNetworkLabel } from './PaymentNetworkLabel';
it('uses the known receive-account network instead of guessing from tb1', () => {
  const view = render(<PaymentNetworkLabel request="tb1qexample" network="mutinynet" />);
  expect(view.getByLabelText('Payment network: Mutinynet')).toBeTruthy();
  expect(view.queryByText(/Testnet \/ Signet/)).toBeNull();
});
it('keeps ambiguous external addresses ambiguous', () => {
  const view = render(<PaymentNetworkLabel request="tb1qexample" />);
  expect(view.getByLabelText('Payment network: Testnet / Signet')).toBeTruthy();
});
