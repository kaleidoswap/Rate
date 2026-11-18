const loadChoices = (channel: string | undefined) => {
  let mod: typeof import('./accountChoices') | undefined;
  jest.isolateModules(() => {
    if (channel) process.env.EXPO_PUBLIC_CHANNEL = channel;
    else delete process.env.EXPO_PUBLIC_CHANNEL;
    mod = require('./accountChoices');
  });
  return mod!;
};

jest.mock('../DatabaseService', () => ({ __esModule: true, default: { getInstance: () => ({}) } }));
jest.mock('./barkPreferences', () => ({ saveBarkNetwork: jest.fn(), setBarkOff: jest.fn() }));

afterEach(() => { delete process.env.EXPO_PUBLIC_CHANNEL; });

test('a beta build sets up Spark only and offers no held or Labs account', () => {
  const { LITE_ACCOUNTS, ADVANCED_ACCOUNTS, SETUP_OFFERS } = loadChoices('beta');
  expect(LITE_ACCOUNTS).toEqual({ spark: true, arkade: false, bark: false, rgbOnDevice: false });
  expect(SETUP_OFFERS).toEqual({ arkade: false, bark: false, rgbOnDevice: false });
  expect(ADVANCED_ACCOUNTS).toEqual(LITE_ACCOUNTS);
});

test('a development build keeps today’s setup', () => {
  const { LITE_ACCOUNTS, ADVANCED_ACCOUNTS } = loadChoices(undefined);
  expect(LITE_ACCOUNTS).toMatchObject({ spark: true, rgbOnDevice: true });
  expect(ADVANCED_ACCOUNTS).toMatchObject({ spark: true, arkade: true });
});
