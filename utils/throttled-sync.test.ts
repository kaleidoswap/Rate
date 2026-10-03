import { throttledSync } from './throttled-sync';

test('shares a running sync, skips one that just finished, and retries after a failure', async () => {
  let t = 0;
  const sync = jest.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
  const run = throttledSync(sync, 5000, () => t);
  await Promise.all([run(), run()]);
  expect(sync).toHaveBeenCalledTimes(1);
  t = 1000; await run();
  expect(sync).toHaveBeenCalledTimes(1);
  t = 6000; await expect(run()).rejects.toThrow('offline');
  await run();
  expect(sync).toHaveBeenCalledTimes(3);
});
