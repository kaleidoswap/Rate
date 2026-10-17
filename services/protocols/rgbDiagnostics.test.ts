import {
  clearRgbConnectionError, describeRgbError, lastRgbConnectionError, onRgbConnectionError, recordRgbConnectionError,
  recordRgbDiagnostic, redactRgbDetail, resetRgbDiagnostics, rgbDiagnosticEvents, rgbDiagnosticReport,
} from './rgbDiagnostics';

beforeEach(() => { resetRgbDiagnostics(); jest.spyOn(console, 'warn').mockImplementation(() => undefined); });
afterEach(() => jest.restoreAllMocks());

test('an rgb-lib error reads with its ERR_RGB_* code', () => {
  expect(describeRgbError(Object.assign(new Error('Internal: unreleased lock file'), { code: 'ERR_RGB_INTERNAL' }))).toBe('ERR_RGB_INTERNAL: Internal: unreleased lock file');
  expect(describeRgbError(Object.assign(new Error('ERR_RGB_X: already coded'), { code: 'ERR_RGB_X' }))).toBe('ERR_RGB_X: already coded');
  expect(describeRgbError(new Error('plain'))).toBe('plain');
  expect(describeRgbError('text')).toBe('text');
});

test('the last connection error is kept for Settings until a connection works', () => {
  const seen: Array<string | null> = [];
  const off = onRgbConnectionError((e) => seen.push(e?.code ?? null));
  recordRgbConnectionError('mainnet', Object.assign(new Error('Indexer: timeout'), { code: 'ERR_RGB_INDEXER' }));
  expect(lastRgbConnectionError()).toMatchObject({ network: 'mainnet', code: 'ERR_RGB_INDEXER', message: 'ERR_RGB_INDEXER: Indexer: timeout' });
  clearRgbConnectionError();
  expect(lastRgbConnectionError()).toBeNull();
  off();
  expect(seen).toEqual(['ERR_RGB_INDEXER', null]);
});

test('the report holds the steps without long identifiers or file paths', () => {
  recordRgbDiagnostic('open_start', 'mainnet, xpub tpubDC8msFGeGuwnKG9Upg7DM2b4DaRqg3CUZa5g8v2SRQ6K4NSkxUgd7HsL2XVWbVm39yBA4LAxysQAm397zwQSQoQgewGiYZqrA9DsP4zbQ1M');
  recordRgbDiagnostic('go_online_failed', 'Io: /data/user/0/com.kaleidoswap/files/aa11bb22/rgb_runtime.lock');
  expect(rgbDiagnosticEvents().map((e) => e.detail)).toEqual(['mainnet, xpub [id]', 'Io: [path]']);
  expect(JSON.parse(rgbDiagnosticReport({ platform: 'android' }))).toMatchObject({ platform: 'android', lastError: null, events: expect.any(Array) });
  expect(redactRgbDetail('x'.repeat(500))).toBe('[id]');
});
