import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { ReceiveAccountPicker } from './ReceiveAccountPicker';
import { accountMethods, type ReceiveAccountInfo } from '../../utils/receive-routes';

const accounts: ReceiveAccountInfo[] = [
  { account: 'SPARK', chain: 'mainnet' },
  { account: 'ARKADE', chain: 'mutinynet' },
];

const setup = (method: 'ark' | 'lightning', amountSats = 0) => {
  const onAccount = jest.fn();
  const onMethod = jest.fn();
  const screen = render(<ReceiveAccountPicker
    accounts={[
      { account: 'SPARK', label: 'Spark', chain: 'mainnet', balanceSats: 12300 },
      { account: 'ARKADE', label: 'Arkade', chain: 'mutinynet' },
    ]}
    showChain
    account="ARKADE" onAccount={onAccount}
    methods={accountMethods('ARKADE', accounts, {})} method={method} onMethod={onMethod}
    amountSats={amountSats} />);
  return { screen, onAccount, onMethod };
};

test('picking an account and a way in reports each choice', () => {
  const { screen, onAccount, onMethod } = setup('ark');
  expect(screen.getByText('12,300 sats')).toBeTruthy();
  fireEvent.press(screen.getByLabelText('Spark, 12,300 sats, Mainnet'));
  expect(onAccount).toHaveBeenCalledWith('SPARK');
  fireEvent.press(screen.getByLabelText('Lightning, needs an amount'));
  expect(onMethod).toHaveBeenCalledWith('lightning');
  // The chosen ones don't fire again.
  fireEvent.press(screen.getByLabelText('Arkade, Mutinynet'));
  fireEvent.press(screen.getByLabelText('Ark'));
  expect(onAccount).toHaveBeenCalledTimes(1);
  expect(onMethod).toHaveBeenCalledTimes(1);
});

test('says when the chosen way needs an amount', () => {
  expect(setup('lightning').screen.getByText(/needs an amount · the sender pays the swap fee\. Add an amount first\./)).toBeTruthy();
  expect(setup('lightning', 5000).screen.queryByText(/Add an amount first/)).toBeNull();
});
