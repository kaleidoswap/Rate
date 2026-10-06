import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { MyAddressPanel } from './MyAddressPanel';

const mockHandle = jest.fn();
jest.mock('@react-navigation/native', () => ({ useFocusEffect: (f: any) => require('react').useEffect(f, [f]) }));
jest.mock('../../services/kaleidoswapMe', () => ({ getStoredHandle: (...a: any[]) => mockHandle(...a) }));
jest.mock('./ReceiveQr', () => ({ ReceiveQr: ({ value }: any) => { const { Text } = require('react-native'); return <Text>{`qr:${value}`}</Text>; } }));
jest.mock('./ReceiveRequestActions', () => ({ ReceiveRequestActions: ({ value }: any) => { const { Text } = require('react-native'); return <Text>{`actions:${value}`}</Text>; } }));
jest.mock('../NetworkIcon', () => ({ NetworkIcon: () => null }));

const props = () => ({ walletId: 1, qrSize: 200, showLightningAddress: true, showOffer: true, onManageAddress: jest.fn(), onOpenOffer: jest.fn() });

test('shows the Lightning address as a reusable QR, with the shop code below', async () => {
  mockHandle.mockResolvedValue({ lightningAddress: 'satoshi@kaleidoswap.me' });
  const p = props();
  const screen = render(<MyAddressPanel {...p} />);
  await act(async () => {});
  expect(screen.getByText('qr:lightning:satoshi@kaleidoswap.me')).toBeTruthy();
  expect(screen.getByText('actions:satoshi@kaleidoswap.me')).toBeTruthy();
  fireEvent.press(screen.getByText('Manage address'));
  expect(p.onManageAddress).toHaveBeenCalled();
  fireEvent.press(screen.getByLabelText('Create a reusable payment QR'));
  expect(p.onOpenOffer).toHaveBeenCalled();
});

test('without a claimed address it invites you to get one', async () => {
  mockHandle.mockResolvedValue(null);
  const p = { ...props(), showOffer: false };
  const screen = render(<MyAddressPanel {...p} />);
  await act(async () => {});
  fireEvent.press(screen.getByLabelText('Get a Lightning address'));
  expect(p.onManageAddress).toHaveBeenCalled();
  expect(screen.queryByLabelText('Create a reusable payment QR')).toBeNull();
});
