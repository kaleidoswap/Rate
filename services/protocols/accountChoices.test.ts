const mockSaveBark = jest.fn(async () => undefined);
const mockBarkOff = jest.fn(async () => undefined);
const mockSaveRgb = jest.fn(async () => undefined);
jest.mock('./bark', () => ({ BARK_ENABLED: true }));
jest.mock('./barkPreferences', () => ({ saveBarkNetwork: (...a: any[]) => (mockSaveBark as any)(...a), setBarkOff: (...a: any[]) => (mockBarkOff as any)(...a) }));
let mockPinned: string | null = null;
jest.mock('./rgbL1', () => ({ RGB_L1_ENABLED: true, RGB_L1_DEFAULT_NETWORK: 'mainnet', pinnedRgbL1Network: async () => mockPinned, saveRgbL1Network: (...a: any[]) => (mockSaveRgb as any)(...a) }));
import { DEFAULT_ACCOUNTS, hasAnyAccount, saveAccountPreferences, walletNetworksFor } from './accountChoices';

beforeEach(() => { jest.clearAllMocks(); mockPinned = null; });

test('a new wallet starts with every account, RGB on this phone included', async () => {
  expect(DEFAULT_ACCOUNTS).toEqual({ spark: true, arkade: true, bark: true, rgbOnDevice: true });
  expect(walletNetworksFor(DEFAULT_ACCOUNTS).map((n) => n.type)).toEqual(['spark', 'arkade']);
  await saveAccountPreferences('seed', DEFAULT_ACCOUNTS);
  expect(mockSaveBark).toHaveBeenCalledWith('seed', 'mainnet');
  expect(mockSaveRgb).toHaveBeenCalledWith('seed', 'mainnet');
});

test('an account left out never starts', async () => {
  await saveAccountPreferences('seed', { ...DEFAULT_ACCOUNTS, bark: false });
  expect(mockBarkOff).toHaveBeenCalledWith('seed');
});

test('a seed whose RGB data on this phone is on Mutinynet stays there', async () => {
  mockPinned = 'mutinynet';
  await saveAccountPreferences('seed', DEFAULT_ACCOUNTS);
  expect(mockSaveRgb).toHaveBeenCalledWith('seed', 'mutinynet');
});

test('setup keeps what the user picked', async () => {
  await saveAccountPreferences('seed', { spark: false, arkade: true, bark: true, rgbOnDevice: false });
  expect(mockSaveBark).toHaveBeenCalledWith('seed', 'mainnet');
  expect(mockSaveRgb).toHaveBeenCalledWith('seed', null);
  expect(hasAnyAccount({ spark: false, arkade: false, bark: false, rgbOnDevice: false })).toBe(false);
  expect(hasAnyAccount({ spark: false, arkade: false, bark: false, rgbOnDevice: false }, true)).toBe(true);
});
