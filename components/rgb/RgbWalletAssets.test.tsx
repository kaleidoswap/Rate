import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { RgbWalletAssets } from './RgbWalletAssets';

const mockListAssets = jest.fn();
const mockMetadata = jest.fn();
let mockHideBalances = false;
jest.mock('../../store/hooks', () => ({
  useAppSelector: (select: (state: unknown) => unknown) =>
    select({ settings: { language: 'en', hideBalances: mockHideBalances } }),
}));
const mockAdapter = { isConnected: () => true, listAssets: mockListAssets };
jest.mock('../../services/protocols', () => ({
  protocolManager: { getAdapterIfAvailable: () => mockAdapter },
}));
jest.mock('../../services/rgbWallet', () => ({
  getRgbAssetMetadata: (...args: unknown[]) => mockMetadata(...args),
}));

const coin = {
  id: 'rgb:example',
  layer: 'RGB_L1',
  name: 'Example',
  ticker: 'EX',
  precision: 2,
  balance: { availableDisplay: '1.23', totalDisplay: '4.56' },
  metadata: { asset_schema: 'NIA', issued_supply: 1250, unlisted: 'private-field' },
};
beforeEach(() => {
  jest.clearAllMocks();
  mockHideBalances = false;
  mockListAssets.mockResolvedValue([coin, { ...coin, id: 'BTC', layer: 'BTC_L1', name: 'Bitcoin' }]);
  mockMetadata.mockResolvedValue(null);
});

test('shows balances on entry, reads metadata on opening an asset and keeps wallet balances out of the payload', async () => {
  const screen = render(<RgbWalletAssets protocol="RGB_L1" walletId={1} network="signet" />);
  expect(mockListAssets).toHaveBeenCalledTimes(1);
  expect(await screen.findByText(/1.23 EX/)).toBeTruthy();
  expect(mockMetadata).not.toHaveBeenCalled();
  fireEvent.press(await screen.findByText(/Example · EX/));
  expect(mockMetadata).toHaveBeenCalledWith(mockAdapter, coin.id);
  expect(screen.queryByText(/Bitcoin/)).toBeNull();
  expect(await screen.findByText('Token (NIA)')).toBeTruthy();
  expect(screen.getByText('12.5')).toBeTruthy();
  expect(screen.getByText('1.23')).toBeTruthy();
  fireEvent.press(screen.getByText(/Asset metadata \(JSON\)/));
  const payload = JSON.parse(screen.getByText(/"contractId":/).props.children);
  expect(payload).toMatchObject({ contractId: coin.id, issuedSupply: 1250, schema: 'NIA' });
  expect(payload).not.toHaveProperty('balance');
  expect(payload).not.toHaveProperty('unlisted');
});

test('clears the inventory when switching wallets and ignores a late response', async () => {
  let finish!: (values: unknown[]) => void;
  mockListAssets.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const screen = render(<RgbWalletAssets protocol="RGB_L1" walletId={1} />);
  mockListAssets.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([]);
  screen.rerender(<RgbWalletAssets protocol="RGB_LN" walletId={2} />);
  await act(async () => finish([coin]));
  expect(screen.queryByText(/Example · EX/)).toBeNull();
  fireEvent.press(await screen.findByText('Try again'));
  expect(await screen.findByText('No RGB assets in this wallet')).toBeTruthy();
});

test('respects hidden balances and leaves base contract data available if the metadata read fails', async () => {
  mockHideBalances = true;
  mockMetadata.mockRejectedValueOnce(new Error('unavailable'));
  const screen = render(<RgbWalletAssets protocol="RGB_LN" walletId={1} />);
  fireEvent.press(await screen.findByText(/Example · EX/));
  expect(await screen.findByText(/Reopen the asset to retry/)).toBeTruthy();
  expect(screen.getAllByText('••••')).toHaveLength(2);
  expect(screen.getByText(/•••• EX/)).toBeTruthy();
  expect(screen.queryByText(/1.23/)).toBeNull();
  expect(screen.getByLabelText('Copy contract ID')).toBeTruthy();
});

test('keeps a large node-reported supply exact in both the detail and payload', async () => {
  mockListAssets.mockResolvedValueOnce([
    { ...coin, precision: 0, metadata: { issued_supply: '18446744073709551615' } },
  ]);
  const screen = render(<RgbWalletAssets protocol="RGB_LN" walletId={1} />);
  fireEvent.press(await screen.findByText(/Example · EX/));
  expect(await screen.findByText('18,446,744,073,709,551,615')).toBeTruthy();
  fireEvent.press(screen.getByText(/Asset metadata \(JSON\)/));
  expect(JSON.parse(screen.getByText(/"contractId":/).props.children).issuedSupply).toBe(
    '18446744073709551615',
  );
});
