import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { ReceiveRoutePicker } from './ReceiveRoutePicker';
import { lightningDestinations, universalChains, type ReceiveAccountInfo } from '../../utils/receive-routes';

const accounts: ReceiveAccountInfo[] = [
  { account: 'SPARK', chain: 'regtest' },
  { account: 'ARKADE', chain: 'mutinynet' },
  { account: 'BARK', chain: 'mutinynet' },
];

test('Lightning lets the user choose the account it lands in', () => {
  const onDestination = jest.fn();
  const screen = render(<ReceiveRoutePicker
    methods={['universal', 'lightning', 'onchain']} method="lightning" onMethod={jest.fn()}
    destinations={lightningDestinations(accounts, {})} destination="SPARK" onDestination={onDestination} amountSats={0} />);
  fireEvent.press(screen.getByLabelText('Deposit to: Spark · Regtest. Change'));
  expect(screen.getByText('Where should this Lightning payment land?')).toBeTruthy();
  expect(screen.getByText('Lands in your Bark balance · needs an amount. Add an amount first.')).toBeTruthy();
  fireEvent.press(screen.getByLabelText(/^Arkade, Mutinynet/));
  expect(onDestination).toHaveBeenCalledWith('ARKADE');
});

test('switching method goes through the tabs', () => {
  const onMethod = jest.fn();
  const screen = render(<ReceiveRoutePicker
    methods={['universal', 'lightning', 'onchain']} method="universal" onMethod={onMethod}
    destinations={[]} destination={null} onDestination={jest.fn()} amountSats={0} />);
  fireEvent.press(screen.getByText('On-chain'));
  expect(onMethod).toHaveBeenCalledWith('onchain');
});

test('the universal code shows its network when accounts span several, and its Lightning account', () => {
  const onChain = jest.fn();
  const onLn = jest.fn();
  const screen = render(<ReceiveRoutePicker
    methods={['universal', 'lightning']} method="universal" onMethod={jest.fn()}
    destinations={[]} destination={null} onDestination={jest.fn()} amountSats={1000}
    chains={universalChains(accounts)} chain="mutinynet" onChain={onChain}
    lightningDestinations={lightningDestinations(accounts.filter(a => a.chain === 'mutinynet'), {})}
    lightningDestination="BARK" onLightningDestination={onLn} />);
  fireEvent.press(screen.getByLabelText('Network: Mutinynet · 2 accounts. Change'));
  fireEvent.press(screen.getByLabelText(/^Regtest/));
  expect(onChain).toHaveBeenCalledWith('regtest');
  fireEvent.press(screen.getByLabelText('Lightning to: Bark. Change'));
  fireEvent.press(screen.getByLabelText(/^Arkade/));
  expect(onLn).toHaveBeenCalledWith('ARKADE');
});

test('account rows use the account icon resolver and the Ark tab can carry both Ark icons', () => {
  const iconFor = jest.fn((account: string) => account.toLowerCase());
  const screen = render(<ReceiveRoutePicker
    methods={['universal', 'ark']} method="ark" onMethod={jest.fn()}
    destinations={lightningDestinations(accounts, {}).filter(d => d.account !== 'SPARK')} destination="ARKADE" onDestination={jest.fn()} amountSats={0}
    iconFor={iconFor} methodIcons={{ ark: ['arkade', 'bark'] }} />);
  expect(screen.getByText('Ark')).toBeTruthy();
  expect(iconFor).toHaveBeenCalledWith('ARKADE');
});
