const mockInit = jest.fn();
const mockClose = jest.fn(async () => true);
const mockCapture = jest.fn();
jest.mock('@sentry/react-native', () => ({ init: mockInit, close: mockClose, captureException: mockCapture }));

import type { ErrorEvent } from '@sentry/react-native';

const MNEMONIC = 'abandon ability able about above absent absorb abstract absurd abuse access accident';

const load = (dsn?: string) => {
  let mod: typeof import('./crashReporting') | undefined;
  jest.isolateModules(() => {
    if (dsn) process.env.EXPO_PUBLIC_SENTRY_DSN = dsn;
    else delete process.env.EXPO_PUBLIC_SENTRY_DSN;
    mod = jest.requireActual<typeof import('./crashReporting')>('./crashReporting');
  });
  return mod!;
};

afterEach(() => { delete process.env.EXPO_PUBLIC_SENTRY_DSN; jest.clearAllMocks(); });

test('scrubs seeds, keys, addresses, invoices and contacts', () => {
  const { scrub } = load();
  const secrets = [
    MNEMONIC,
    'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq',
    'tb1pqqqqp399et2xygdj5xreqhjjvcmzhxw4aywxecjdzew6hylgvsesf3hn0c',
    '3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy',
    'lnbc2500u1pvjluezsp5zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zygspp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypq',
    'npub10elfcs4fr0l0r8af98jlmgdh9c8tcxjvz9qkw038js35mp4dma8qzvjptg',
    'nsec1vl029mgpspedva04g90vltkh6fvh240zqtv9k0t9af8935ke9laqsnlfe5',
    'xprv9s21ZrQH143K3QTDL4LXw2F7HEK3wJUD2nW2nRk4stbPy6cq3jPPqjiChkVvvNKmPGJxWUtg6LnF5kejMRNNU3TGtRBeJgk33yuGBxrMPHi',
    'a3f1c9e0b2d4f6a8c0e2f4a6b8d0f2e4c6a8b0d2f4e6a8c0b2d4f6e8a0c2e4f6',
    'nostr+walletconnect://abc?relay=wss://relay.example&secret=123',
    'rgb:2wFj9u4K-abc/RGB20/1000+utxob:xyz',
    'alice@getalby.com',
  ];
  for (const secret of secrets) {
    const out = scrub(`Payment failed for ${secret} after retry`);
    expect(out).toBe('Payment failed for [redacted] after retry');
  }
});

test('scrubs partial, quoted, comma-separated and JSON recovery phrases', () => {
  const { scrub } = load();
  const words = MNEMONIC.split(' ');
  for (const phrase of [
    words.slice(0, 5).join(' '),
    words.map(w => `"${w}"`).join(','),
    JSON.stringify(words),
    words.join(', '),
    words.join('-'),
  ]) {
    const out = scrub(`restore failed: ${phrase} (#7)`);
    expect(out).toContain('[redacted]');
    expect(out).not.toMatch(/abandon|ability|absorb|accident/);
    expect(out).toMatch(/^restore failed: .*\(#7\)$/);
  }
});

test('scrubs numbered and underscore-joined recovery phrases', () => {
  const { scrub } = load();
  const words = MNEMONIC.split(' ');
  for (const phrase of [
    words.map((w, i) => `${i + 1}. ${w}`).join(' '),
    words.map((w, i) => `${i + 1}:${w}`).join(' '),
    words.map((w, i) => `#${i + 1}=${w}`).join('\n'),
    words.join('_'),
    words.join('/'),
  ]) {
    const out = scrub(`restore failed: ${phrase}`);
    expect(out).toMatch(/^restore failed: (1\. |1:|#1=)?\[redacted\]$/);
  }
});

test('leaves prose with a few BIP39 words alone', () => {
  const { scrub } = load();
  for (const message of [
    'Swap failed: unable to find a route for this amount. Please try again in a minute.',
    'Step 2. Open the wallet, then tap Send to pay the invoice.',
    'Network error: request timed out after 30 seconds (attempt 3/5)',
  ]) expect(scrub(message)).toBe(message);
});

test('scrubs WIF keys and addresses of any bech32 prefix', () => {
  const { scrub } = load();
  for (const secret of [
    '5HueCGU8rMjxEXxiPuD5BDku4MkFqeZyd4dZ1jvhTVqvbTLvyTJ',
    'KwdMAjGmerYanjeui5SHS7JkmpZvVipYvB2LJGU1ZxJwYvP98617',
    'tex1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq',
  ]) expect(scrub(`key ${secret} bad`)).toBe('key [redacted] bad');
});

test('keeps only device and runtime contexts and scrubs tags', () => {
  const { scrubEvent } = load();
  const out = scrubEvent({
    contexts: { device: { model: 'iPhone' }, os: { name: 'iOS' }, wallet: { address: 'bc1q' }, state: { redux: {} } },
    tags: { where: 'send', address: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq' },
  } as unknown as ErrorEvent);
  expect(Object.keys(out.contexts!)).toEqual(['device', 'os']);
  expect(out.tags).toEqual({ where: 'send', address: '[redacted]' });
});

test('keeps ordinary error text readable', () => {
  const { scrub } = load();
  const message = 'TypeError: Cannot read property balance of undefined in SendScreen';
  expect(scrub(message)).toBe(message);
});

test('drops user, request, extras, network and console breadcrumbs', () => {
  const { scrubEvent } = load();
  const event = {
    user: { id: 'u' }, request: { url: 'https://x' }, extra: { seed: MNEMONIC }, server_name: 'phone',
    message: `mnemonic: ${MNEMONIC}`,
    exception: { values: [{ value: 'bad address bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq', stacktrace: { frames: [{ vars: { k: 1 } }] } }] },
    breadcrumbs: [
      { category: 'console', message: 'log' },
      { category: 'xhr', data: { url: 'https://esplora/address/bc1q' } },
      { category: 'navigation', message: 'Send', data: { to: 'Send' } },
    ],
  };
  const out = scrubEvent(event as unknown as ErrorEvent);
  expect(out.user).toBeUndefined();
  expect(out.request).toBeUndefined();
  expect(out.extra).toBeUndefined();
  expect(out.server_name).toBeUndefined();
  expect(out.message).toBe('mnemonic: [redacted]');
  expect(out.exception!.values![0].value).toBe('bad address [redacted]');
  expect(out.exception!.values![0].stacktrace!.frames![0].vars).toBeUndefined();
  expect(out.breadcrumbs).toEqual([{ category: 'navigation', message: 'Send', data: undefined }]);
});

test('without a DSN nothing starts, even when the user opts in', () => {
  const { setCrashReporting, reportError, CRASH_REPORTING_AVAILABLE } = load();
  expect(CRASH_REPORTING_AVAILABLE).toBe(false);
  setCrashReporting(true);
  reportError(new Error('x'), 'test');
  expect(mockInit).not.toHaveBeenCalled();
  expect(mockCapture).not.toHaveBeenCalled();
});

test('with a DSN it starts only on opt-in and stops on opt-out', () => {
  const { setCrashReporting, reportError } = load('https://key@o0.ingest.sentry.io/1');
  reportError(new Error('before'), 'test');
  expect(mockCapture).not.toHaveBeenCalled();
  setCrashReporting(true);
  setCrashReporting(true);
  expect(mockInit).toHaveBeenCalledTimes(1);
  expect(mockInit.mock.calls[0][0]).toMatchObject({ sendDefaultPii: false, attachScreenshot: false, attachViewHierarchy: false, tracesSampleRate: 0, enableNativeCrashHandling: false });
  reportError(new Error('after'), 'test');
  expect(mockCapture).toHaveBeenCalledTimes(1);
  setCrashReporting(false);
  expect(mockClose).toHaveBeenCalledTimes(1);
  reportError(new Error('off'), 'test');
  expect(mockCapture).toHaveBeenCalledTimes(1);
});
