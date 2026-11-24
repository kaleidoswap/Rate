const loadChoices = (channel: string | undefined) => {
  let mod: typeof import('./accountChoices') | undefined;
  jest.isolateModules(() => {
    if (channel) process.env.EXPO_PUBLIC_CHANNEL = channel;
    else delete process.env.EXPO_PUBLIC_CHANNEL;
    mod = jest.requireActual<typeof import('./accountChoices')>('./accountChoices');
  });
  return mod!;
};

const mockHasBarkPreference = jest.fn(async () => false);
const mockSetBarkOff = jest.fn(async () => undefined);
const mockSaveRgbL1Network = jest.fn(async () => undefined);
jest.mock('../DatabaseService', () => ({ __esModule: true, default: { getInstance: () => ({}) } }));
jest.mock('./bark', () => ({ BARK_ENABLED: true }));
jest.mock('./barkPreferences', () => ({
  hasBarkPreference: mockHasBarkPreference,
  saveBarkNetwork: jest.fn(),
  setBarkOff: mockSetBarkOff,
}));
jest.mock('./rgbL1', () => ({
  RGB_L1_ENABLED: true,
  RGB_L1_DEFAULT_NETWORK: 'mainnet',
  pinnedRgbL1Network: jest.fn(),
  saveRgbL1Network: mockSaveRgbL1Network,
}));

afterEach(() => {
  delete process.env.EXPO_PUBLIC_CHANNEL;
  jest.clearAllMocks();
});

test.each(['beta', 'store'])('a %s build offers Arkade as opt-in alongside Spark during onboarding', channel => {
  const { DEFAULT_ACCOUNTS, SETUP_ACCOUNTS } = loadChoices(channel);
  expect(DEFAULT_ACCOUNTS).toEqual({ spark: true, arkade: false, bark: false, rgbOnDevice: false });
  expect(SETUP_ACCOUNTS.map(account => account.key)).toEqual(['spark', 'arkade']);
});

test('a development build offers choices with Spark and RGB initially selected', () => {
  const { DEFAULT_ACCOUNTS, SETUP_ACCOUNTS } = loadChoices(undefined);
  expect(DEFAULT_ACCOUNTS).toEqual({ spark: true, arkade: false, bark: false, rgbOnDevice: true });
  expect(SETUP_ACCOUNTS.map(account => account.key)).toEqual(['spark', 'rgbOnDevice', 'arkade', 'bark']);
});

test('beta onboarding leaves saved on-device account preferences intact', async () => {
  mockHasBarkPreference.mockResolvedValueOnce(true);
  const { DEFAULT_ACCOUNTS, saveAccountPreferences } = loadChoices('beta');
  await saveAccountPreferences('test seed', DEFAULT_ACCOUNTS);
  expect(mockSaveRgbL1Network).not.toHaveBeenCalled();
  expect(mockSetBarkOff).not.toHaveBeenCalled();
});

test('beta onboarding turns off the Bark default for a new seed', async () => {
  const { DEFAULT_ACCOUNTS, saveAccountPreferences } = loadChoices('beta');
  await saveAccountPreferences('test seed', DEFAULT_ACCOUNTS);
  expect(mockSetBarkOff).toHaveBeenCalledWith('test seed');
  expect(mockSaveRgbL1Network).not.toHaveBeenCalled();
});
