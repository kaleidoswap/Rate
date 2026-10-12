const mockRead = jest.fn();
const mockWrite = jest.fn();
const derived = { privateKey: 'wallet-private', nsec: 'wallet-nsec', publicKey: 'wallet-public', npub: 'wallet-npub' };
const existing = { privateKey: 'imported-private', nsec: 'imported-nsec', publicKey: 'imported-public', npub: 'imported-npub' };
const mockDerive = jest.fn(() => derived);
jest.mock('expo-secure-store', () => ({ getItemAsync: (...args: any[]) => mockRead(...args), setItemAsync: (...args: any[]) => mockWrite(...args) }));
jest.mock('./NostrService', () => ({ __esModule: true, default: { getInstance: () => ({ deriveKeysFromMnemonic: (...args: any[]) => (mockDerive as any)(...args), importPrivateKey: () => existing }) } }));
import { ensureOnboardingIdentity } from './onboardingIdentity';
beforeEach(() => { jest.clearAllMocks(); mockRead.mockResolvedValue(null); });
test('uses the wallet mnemonic and only returns public identity data', async () => {
  expect(await ensureOnboardingIdentity('sample mnemonic')).toEqual({ publicKey: 'wallet-public', npub: 'wallet-npub', fromWallet: true });
  expect(mockDerive).toHaveBeenCalledWith('sample mnemonic');
  expect(mockWrite).toHaveBeenCalledTimes(2);
});
test('preserves an existing imported Nostr identity', async () => {
  mockRead.mockResolvedValue('imported-private');
  expect(await ensureOnboardingIdentity('sample mnemonic')).toMatchObject({ publicKey: 'imported-public', fromWallet: false });
  expect(mockWrite).not.toHaveBeenCalled();
});
