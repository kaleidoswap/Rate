import { DEFAULT_ACCOUNTS, saveAccountPreferences, SETUP_ACCOUNTS, walletNetworksFor } from './accountChoices';

const mockSaveRgb = jest.fn();
jest.mock('./bark', () => ({ BARK_ENABLED: false }));
jest.mock('./rgbL1', () => ({
  RGB_L1_ENABLED: true,
  RGB_L1_DEFAULT_NETWORK: 'mainnet',
  saveRgbL1Network: (...args: unknown[]) => mockSaveRgb(...args),
}));
jest.mock('../features', () => {
  const actual = jest.requireActual<typeof import('../features')>('../features');
  return {
    ...actual,
    isAvailable: (feature: Parameters<typeof actual.isAvailable>[0]) => actual.isAvailable(feature, 'beta'),
    isFeatureOn: (feature: Parameters<typeof actual.isFeatureOn>[0]) => actual.isFeatureOn(feature, undefined, 'beta'),
  };
});

test('TestFlight onboarding keeps the Spark default and preserves any saved phone RGB network', async () => {
  expect(DEFAULT_ACCOUNTS).toEqual({ spark: true, arkade: false, bark: false, rgbOnDevice: false });
  expect(SETUP_ACCOUNTS.some(account => account.key === 'rgbOnDevice')).toBe(false);
  expect(walletNetworksFor(DEFAULT_ACCOUNTS).map(network => network.type)).toEqual(['spark']);
  await saveAccountPreferences('wallet-fixture', DEFAULT_ACCOUNTS);
  expect(mockSaveRgb).not.toHaveBeenCalled();
});
