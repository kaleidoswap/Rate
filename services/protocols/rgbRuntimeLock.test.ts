const mockFiles: Record<string, { modificationTime: number | null }> = {};
const mockDeleted: string[] = [];
jest.mock('expo-file-system', () => ({
  File: class {
    mockUri: string;
    constructor(mockPath: string) { this.mockUri = mockPath; }
    get exists() { return this.mockUri in mockFiles; }
    get modificationTime() { return mockFiles[this.mockUri]?.modificationTime ?? null; }
    delete() { mockDeleted.push(this.mockUri); delete mockFiles[this.mockUri]; }
  },
}));
import { clearStaleRgbRuntimeLock, STALE_LOCK_AGE_MS } from './rgbRuntimeLock';

const lockUri = 'file:///data/files/rgb-mainnet/aa11bb22/rgb_runtime.lock';

beforeEach(() => { for (const k of Object.keys(mockFiles)) delete mockFiles[k]; mockDeleted.length = 0; });

test('removes a lock an earlier run left behind', async () => {
  mockFiles[lockUri] = { modificationTime: 1_000 };
  expect(await clearStaleRgbRuntimeLock('/data/files/rgb-mainnet/', 'aa11bb22', 1_000 + STALE_LOCK_AGE_MS + 1)).toBe(true);
  expect(mockDeleted).toEqual([lockUri]);
});

test('leaves a fresh lock (a call may still hold it), a missing one, and a bad fingerprint alone', async () => {
  mockFiles[lockUri] = { modificationTime: 1_000 };
  expect(await clearStaleRgbRuntimeLock('/data/files/rgb-mainnet', 'aa11bb22', 1_000 + 5_000)).toBe(false);
  expect(await clearStaleRgbRuntimeLock('/data/files/rgb-mutinynet', 'aa11bb22', 10 ** 9)).toBe(false);
  expect(await clearStaleRgbRuntimeLock('/data/files/rgb-mainnet', '../etc', 10 ** 9)).toBe(false);
  expect(mockDeleted).toEqual([]);
});
