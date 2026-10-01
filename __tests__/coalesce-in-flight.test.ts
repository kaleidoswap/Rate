import { coalesceInFlight } from '../utils/coalesce-in-flight';
it('joins simultaneous startup calls, then allows a fresh retry', async () => {
  const task = jest.fn(async (_wallet: string, _config: object) => true);
  const run = coalesceInFlight(task);
  const first = run('wallet-a', { network: 'testnet' });
  expect(run('wallet-a', { network: 'testnet' })).toBe(first);
  await first;
  await run('wallet-a', { network: 'testnet' });
  expect(task).toHaveBeenCalledTimes(2);
});
it('does not share initialization between wallets or networks', async () => {
  const task = jest.fn(async (_wallet: string, _network: string) => true);
  const run = coalesceInFlight(task);
  await Promise.all([run('a', 'mainnet'), run('b', 'mainnet'), run('a', 'testnet')]);
  expect(task).toHaveBeenCalledTimes(3);
});
it('releases failed work for retry', async () => {
  const task = jest.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(true);
  const run = coalesceInFlight(task);
  await expect(run('a')).rejects.toThrow('offline');
  await expect(run('a')).resolves.toBe(true);
});
