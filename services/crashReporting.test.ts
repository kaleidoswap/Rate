const mockInit = jest.fn();
const mockClose = jest.fn(async () => true);
const mockCapture = jest.fn();
jest.mock('@sentry/react-native', () => ({ init: mockInit, close: mockClose, captureException: mockCapture }));

import type { ErrorEvent } from '@sentry/react-native';

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

test('allowlists diagnostic fields and strips amounts, names and unrelated payload data', () => {
  const { setCrashReporting } = load('https://key@o0.ingest.sentry.io/1');
  setCrashReporting(true);

  const sensitive = 'Paid 12300 sats to Example Contact';
  const secret = 'abandon ability able about above absent absorb abstract absurd abuse access accident';
  const bundle = 'app:///main.jsbundle';
  const debugId = 'abcdabcd-abcd-abcd-abcd-abcdabcdabcd';
  const event: ErrorEvent = {
    type: undefined,
    event_id: 'f'.repeat(32),
    timestamp: 1700000000,
    release: 'com.kaleidoswap.wallet@0.17.0+101',
    dist: '101',
    user: { username: sensitive },
    request: { url: 'https://example.invalid', data: secret },
    extra: { seed: secret },
    message: sensitive,
    logentry: { message: secret, params: [sensitive] },
    fingerprint: [sensitive],
    transaction: sensitive,
    contexts: { os: { name: 'iOS', version: '18.0', build: sensitive }, device: { model: sensitive, name: secret } },
    tags: { where: 'error-boundary', [secret]: sensitive },
    exception: {
      values: [{
        type: 'TypeError',
        value: sensitive,
        mechanism: { type: 'onerror', handled: false, data: { sensitive } },
        stacktrace: {
          frames: [
            { filename: `https://example.invalid/${secret}`, lineno: 2, colno: 4 },
            { filename: bundle, lineno: 1, colno: 345, function: sensitive, vars: { secret }, context_line: secret },
          ],
        },
      }, { type: secret, value: secret }],
    },
    debug_meta: {
      images: [
        { type: 'sourcemap', code_file: bundle, debug_id: debugId },
        { type: 'sourcemap', code_file: sensitive, debug_id: debugId },
      ],
    },
    breadcrumbs: [
      { category: 'navigation', message: sensitive, data: { screen: secret }, timestamp: 1699999999 },
      { category: 'console', message: secret },
    ],
  };
  const hint = { attachments: [{ filename: secret, data: sensitive }] };
  const output = JSON.parse(JSON.stringify(mockInit.mock.calls[0][0].beforeSend(event, hint)));

  expect(hint.attachments).toEqual([]);
  expect(output).toEqual({
    event_id: 'f'.repeat(32),
    timestamp: 1700000000,
    platform: 'javascript',
    level: 'error',
    environment: expect.stringMatching(/^(dev|beta|store)$/),
    release: 'com.kaleidoswap.wallet@0.17.0+101',
    dist: '101',
    tags: { where: 'error-boundary' },
    contexts: { os: { name: 'iOS', version: '18.0' } },
    exception: {
      values: [{
        type: 'TypeError',
        value: 'JavaScript exception',
        mechanism: { type: 'generic', handled: false },
        stacktrace: { frames: [{ filename: bundle, lineno: 1, colno: 345 }] },
      }, { type: 'Error', value: 'JavaScript exception' }],
    },
    debug_meta: { images: [{ type: 'sourcemap', code_file: bundle, debug_id: debugId }] },
    breadcrumbs: [{ category: 'navigation', timestamp: 1699999999 }],
  });
});

test('uses a fixed label for a message event and drops unrecognized metadata', () => {
  const { scrubEvent } = load();
  const event: ErrorEvent = {
    type: undefined,
    message: 'Network error with a payment payload',
    release: 'unexpected release',
    dist: 'unexpected distribution',
    contexts: { os: { name: 'Android', version: 'unrecognized version' } },
    tags: { where: 'unknown route' },
  };
  expect(JSON.parse(JSON.stringify(scrubEvent(event)))).toEqual({
    platform: 'javascript',
    level: 'error',
    environment: expect.stringMatching(/^(dev|beta|store)$/),
    message: 'JavaScript exception',
    contexts: { os: { name: 'Android' } },
  });
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
  const options = mockInit.mock.calls[0][0];
  expect(options).toMatchObject({
    sendDefaultPii: false,
    attachScreenshot: false,
    attachViewHierarchy: false,
    tracesSampleRate: 0,
    enableNativeCrashHandling: false,
    enableWatchdogTerminationTracking: false,
    enableAppHangTracking: false,
  });
  reportError(new Error('after'), 'test');
  expect(mockCapture).toHaveBeenCalledTimes(1);
  setCrashReporting(false);
  expect(mockClose).toHaveBeenCalledTimes(1);
  expect(options.beforeSend({ message: 'queued error' }, {})).toBeNull();
  reportError(new Error('off'), 'test');
  expect(mockCapture).toHaveBeenCalledTimes(1);
});
