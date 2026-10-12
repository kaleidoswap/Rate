import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import OnboardingProfileScreen from './OnboardingProfileScreen';
const mockDispatch = jest.fn((action: any) => ({ unwrap: async () => action.type === 'restore' ? { success: true } : undefined }));
const mockClaim = jest.fn(async () => ({ name: 'alice', lightningAddress: 'alice@kaleidoswap.me' }));
jest.mock('../store/hooks', () => ({ useAppDispatch: () => mockDispatch, useAppSelector: (fn: any) => fn({ wallet: { activeWallet: { id: 1, encrypted_mnemonic: 'test mnemonic' } }, nostr: { profile: null } }) }));
jest.mock('../services/onboardingIdentity', () => ({ ensureOnboardingIdentity: async () => ({ publicKey: 'pub', npub: 'npub', fromWallet: true }) }));
jest.mock('../services/initializeServices', () => ({ initializeProtocolServices: jest.fn(async () => ({})) }));
jest.mock('../services/kaleidoswapMe', () => ({ KALEIDOSWAP_ME_DOMAIN: 'kaleidoswap.me', nameProblem: () => null, normalizeName: (s: string) => s.trim().toLowerCase(), getStoredHandle: async () => null, checkName: async () => ({ available: true }), claimHandle: (...args: any[]) => (mockClaim as any)(...args) }));
jest.mock('../store/slices/nostrSlice', () => ({ setPublicKeyData: (payload: any) => ({ type: 'keys', payload }), restoreNostrConnection: () => ({ type: 'restore' }), updateNostrProfile: (payload: any) => ({ type: 'publish', payload }) }));
const navigation = { replace: jest.fn() };
beforeEach(() => { jest.clearAllMocks(); (require('react-native') as any).KeyboardAvoidingView = 'KeyboardAvoidingView'; });
async function open() { const ui = render(<OnboardingProfileScreen navigation={navigation} />); await act(async () => {}); fireEvent.changeText(ui.getByLabelText('Username'), 'Alice'); return ui; }
test('uses one username and binds the claim to the Nostr public key', async () => {
  const ui = await open();
  await act(async () => { fireEvent.press(ui.getByText('Create profile')); });
  expect(mockClaim).toHaveBeenCalledWith(1, 'alice', { nostrPubkey: 'pub' });
  expect(mockDispatch).toHaveBeenCalledWith({ type: 'publish', payload: { name: 'alice', display_name: 'alice', lud16: 'alice@kaleidoswap.me' } });
  expect(navigation.replace).toHaveBeenCalledWith('Dashboard');
});
test('does not publish an unclaimed address when registration fails', async () => {
  mockClaim.mockRejectedValueOnce(new Error('Name taken'));
  const ui = await open();
  await act(async () => { fireEvent.press(ui.getByText('Create profile')); });
  expect(ui.getByText('Name taken')).toBeTruthy();
  expect(mockDispatch.mock.calls.some(([a]) => a.type === 'publish')).toBe(false);
  expect(navigation.replace).not.toHaveBeenCalled();
});
test('can create only the profile without a mainnet Spark account', async () => {
  const ui = await open();
  fireEvent(ui.getByLabelText('Get a Lightning address'), 'valueChange', false);
  await act(async () => { fireEvent.press(ui.getByText('Create profile')); });
  expect(mockClaim).not.toHaveBeenCalled();
  expect(mockDispatch).toHaveBeenCalledWith({ type: 'publish', payload: { name: 'alice', display_name: 'alice' } });
});
