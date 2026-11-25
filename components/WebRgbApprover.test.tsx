import React from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react-native';
import { setAppUnlocked } from '../services/appLockState';
import * as transport from '../services/webrgb/walletConnect';
import { WebRgbApprover } from './WebRgbApprover';

const mockState = { wallet: { activeWallet: { id: 7 }, isUnlocked: true } };
jest.mock('../store/hooks', () => ({ useAppSelector: (select: (state: typeof mockState) => unknown) => select(mockState) }));
jest.mock('../services/protocols/wdk', () => ({ isRgbConnecting: () => false, subscribeRgbConnecting: () => () => {} }));
jest.mock('../localization/useAppLanguage', () => ({ useAppLanguage: () => ({ t: (text: string) => text }) }));

function request(overrides: Partial<transport.WalletConnectReview> = {}): transport.WalletConnectReview {
  return { kind: 'request', name: 'Mosaik', url: 'https://mosaik.example', details: ['Create two outputs', 'Mining fee: 268 sats'],
    signal: new AbortController().signal, ...overrides };
}

// Use the promise-returning reviewer registered by the mounted component with the
// transport. Resolving that exact promise is what lets a native wallet call proceed.
function present(review: transport.WalletConnectReview) {
  const reviewer = jest.mocked(transport.setWalletConnectReviewer).mock.lastCall?.[0];
  if (!reviewer) throw new Error('The wallet has no registered reviewer.');
  let result!: Promise<boolean>;
  act(() => { result = reviewer(review); });
  return result;
}

beforeEach(() => {
  Object.defineProperty(jest.requireMock('react-native'), 'AppState', { configurable: true, value: {
    currentState: 'active', addEventListener: () => ({ remove: jest.fn() }),
  } });
  mockState.wallet.activeWallet.id = 7;
  setAppUnlocked(true);
  jest.spyOn(transport, 'setWalletConnectReviewer');
  jest.spyOn(transport, 'restoreWalletConnect').mockResolvedValue(undefined);
  jest.spyOn(transport, 'invalidateWalletConnect');
});
afterEach(() => { cleanup(); setAppUnlocked(false); jest.restoreAllMocks(); });

it('shows the unverified origin and requested permissions before approving a connection', async () => {
  const ui = render(<WebRgbApprover />);
  const decision = present(request({ kind: 'connect', verification: 'UNKNOWN', details: ['signet', 'getInfo', 'sendAsset'] }));
  expect(ui.getByText('Connect this app?')).toBeTruthy();
  expect(ui.getByText('Mosaik')).toBeTruthy();
  expect(ui.getByText('https://mosaik.example')).toBeTruthy();
  expect(ui.getByText('WalletConnect could not verify this site.')).toBeTruthy();
  expect(ui.getByText('sendAsset')).toBeTruthy();
  fireEvent.press(ui.getByLabelText('Connect'));
  await expect(decision).resolves.toBe(true);
  expect(ui.queryByText('Connect this app?')).toBeNull();
});

it('declines a request and allows a subsequent operation to be reviewed independently', async () => {
  const ui = render(<WebRgbApprover />);
  const declined = present(request());
  expect(ui.getByText('Mining fee: 268 sats')).toBeTruthy();
  fireEvent.press(ui.getByLabelText('Decline'));
  await expect(declined).resolves.toBe(false);
  const approved = present(request({ details: ['Sign this login challenge'] }));
  expect(ui.getByText('Sign this login challenge')).toBeTruthy();
  fireEvent.press(ui.getByLabelText('Approve'));
  await expect(approved).resolves.toBe(true);
});

it('closes an expired request and a late tap cannot approve its replacement', async () => {
  const ui = render(<WebRgbApprover />);
  const controller = new AbortController();
  const expiredReview = request({ signal: controller.signal });
  const decision = present(expiredReview);
  const staleApprove = ui.getByLabelText('Approve').props.onPress;
  act(() => controller.abort());
  await expect(decision).resolves.toBe(false);
  expect(ui.queryByText('Approve this request?')).toBeNull();
  await expect(present(expiredReview)).resolves.toBe(false);
  const replacement = present(request({ details: ['A different request'] }));
  act(() => { staleApprove(); });
  expect(ui.getByText('A different request')).toBeTruthy();
  fireEvent.press(ui.getByLabelText('Decline'));
  await expect(replacement).resolves.toBe(false);
});

it('refuses competing requests while preserving the first decision', async () => {
  const ui = render(<WebRgbApprover />);
  const first = present(request());
  await expect(present(request({ name: 'Other app', url: 'https://other.example' }))).resolves.toBe(false);
  expect(ui.queryByText('https://other.example')).toBeNull();
  expect(ui.getByText('https://mosaik.example')).toBeTruthy();
  fireEvent.press(ui.getByLabelText('Approve'));
  await expect(first).resolves.toBe(true);
});

it('rejects a visible request on lock and resumes review only after the wallet unlocks', async () => {
  const ui = render(<WebRgbApprover />);
  const first = present(request());
  act(() => setAppUnlocked(false));
  await expect(first).resolves.toBe(false);
  expect(transport.invalidateWalletConnect).toHaveBeenCalled();
  await expect(present(request())).resolves.toBe(false);
  expect(ui.queryByLabelText('Approve')).toBeNull();
  act(() => setAppUnlocked(true));
  expect(transport.restoreWalletConnect).toHaveBeenCalledTimes(2);
  const next = present(request());
  fireEvent.press(ui.getByLabelText('Approve'));
  await expect(next).resolves.toBe(true);
});

it('cancels pending approval when changing wallets and unregisters on unmount', async () => {
  const ui = render(<WebRgbApprover />);
  const previous = present(request());
  mockState.wallet.activeWallet.id = 8;
  ui.rerender(<WebRgbApprover />);
  await expect(previous).resolves.toBe(false);
  expect(ui.queryByLabelText('Approve')).toBeNull();
  const pending = present(request());
  ui.unmount();
  await expect(pending).resolves.toBe(false);
  expect(transport.setWalletConnectReviewer).toHaveBeenLastCalledWith(undefined);
});
