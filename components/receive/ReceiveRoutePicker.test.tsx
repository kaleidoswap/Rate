import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { ReceiveRoutePicker } from './ReceiveRoutePicker';
import { lightningDestinations, universalChains, type ReceiveAccountInfo } from '../../utils/receive-routes';

const accounts: ReceiveAccountInfo[] = [
  { account: 'SPARK', chain: 'regtest' },
  { account: 'ARKADE', chain: 'mutinynet' },
  { account: 'BARK', chain: 'mutinynet' },
];

test('one sheet lists where the payment lands, and picking an account closes it', () => {
  const onDestination = jest.fn();
  const screen = render(<ReceiveRoutePicker
    methods={['universal', 'lightning', 'onchain']} method="lightning" onMethod={jest.fn()}
    destinations={lightningDestinations(accounts, {})} destination="SPARK" onDestination={onDestination} amountSats={0} />);
  fireEvent.press(screen.getByLabelText('How they pay: Lightning · Spark. Change'));
  expect(screen.getByText('Lightning lands in')).toBeTruthy();
  expect(screen.getByText('Lands in your Bark balance · needs an amount. Add an amount first.')).toBeTruthy();
  fireEvent.press(screen.getByLabelText(/^Arkade, Mutinynet/));
  expect(onDestination).toHaveBeenCalledWith('ARKADE');
});

test('the methods sit in the same sheet as the accounts', () => {
  const onMethod = jest.fn();
  const screen = render(<ReceiveRoutePicker
    methods={['universal', 'lightning', 'onchain']} method="universal" onMethod={onMethod}
    destinations={lightningDestinations(accounts, {})} destination="SPARK" onDestination={jest.fn()} amountSats={0} />);
  fireEvent.press(screen.getByLabelText('How they pay: Any wallet. Change'));
  // Methods and accounts are visible together: no second sheet to open.
  expect(screen.getByText('On-chain')).toBeTruthy();
  expect(screen.getByText('Method')).toBeTruthy();
  fireEvent.press(screen.getByText('On-chain'));
  expect(onMethod).toHaveBeenCalledWith('onchain');
});

test('the universal code shows its network and its Lightning account in the same sheet', () => {
  const onChain = jest.fn();
  const onLn = jest.fn();
  const screen = render(<ReceiveRoutePicker
    methods={['universal', 'lightning']} method="universal" onMethod={jest.fn()}
    destinations={[]} destination={null} onDestination={jest.fn()} amountSats={1000}
    chains={universalChains(accounts)} chain="mutinynet" onChain={onChain}
    lightningDestinations={lightningDestinations(accounts.filter(a => a.chain === 'mutinynet'), {})}
    lightningDestination="BARK" onLightningDestination={onLn} />);
  fireEvent.press(screen.getByLabelText('How they pay: Any wallet · Bark. Change'));
  fireEvent.press(screen.getByLabelText(/^Regtest/));
  expect(onChain).toHaveBeenCalledWith('regtest');
  fireEvent.press(screen.getByLabelText(/^Arkade/));
  expect(onLn).toHaveBeenCalledWith('ARKADE');
});

test('account rows use the account icon resolver and the Ark tab can carry both Ark icons', () => {
  const iconFor = jest.fn((account: string) => account.toLowerCase());
  const screen = render(<ReceiveRoutePicker
    methods={['universal', 'ark']} method="ark" onMethod={jest.fn()}
    destinations={lightningDestinations(accounts, {}).filter(d => d.account !== 'SPARK')} destination="ARKADE" onDestination={jest.fn()} amountSats={0}
    iconFor={iconFor} methodIcons={{ ark: ['arkade', 'bark'] } as any} />);
  fireEvent.press(screen.getByLabelText('How they pay: Ark · Arkade. Change'));
  expect(screen.getByText('Ark')).toBeTruthy();
  expect(iconFor).toHaveBeenCalledWith('ARKADE');
});
