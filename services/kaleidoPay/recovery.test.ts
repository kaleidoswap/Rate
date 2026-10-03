const mockResume = jest.fn();
jest.mock('./electrumSwapAccount', () => ({ resumeKaleidoPaySwaps: (...a: any[]) => mockResume(...a) }));
jest.mock('./storage', () => ({ createAttemptStore: () => ({ tag: 'store' }), secureSecretStore: { tag: 'secrets' } }));
import { recoverKaleidoPaySwaps, kaleidoPayStores } from './recovery';

test('recovery uses the shared stores and never overlaps', async () => {
  let finish: (v: any[]) => void = () => {};
  mockResume.mockImplementationOnce(() => new Promise(res => { finish = res; }));
  const a = recoverKaleidoPaySwaps();
  const b = recoverKaleidoPaySwaps();
  expect(a).toBe(b);
  expect(mockResume).toHaveBeenCalledTimes(1);
  expect(mockResume).toHaveBeenCalledWith(kaleidoPayStores);
  finish([{ id: 's1', stage: 'claimed' }]);
  await expect(a).resolves.toHaveLength(1);
  mockResume.mockResolvedValueOnce([]);
  await recoverKaleidoPaySwaps();
  expect(mockResume).toHaveBeenCalledTimes(2);
});
