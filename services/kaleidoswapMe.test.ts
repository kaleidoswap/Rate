const mockSettings = new Map<string, string>();
jest.mock('./DatabaseService', () => ({
  __esModule: true,
  default: { getInstance: () => ({
    getSetting: async (k: string) => mockSettings.get(k) ?? null,
    setSetting: async (k: string, v: string) => { mockSettings.set(k, v); },
  }) },
}));
jest.mock('./protocols', () => ({ protocolManager: { getAdapterIfAvailable: () => undefined } }));

import {
  checkName, claimHandle, getStoredHandle, linkExistingHandle, nameProblem, normalizeName,
  refreshTarget, registerPushDevice, releaseHandle, removePushDevice, sparkSigner, tokenHash,
} from './kaleidoswapMe';

const signed: string[] = [];
const signer = (address = 'sp1qme') => ({
  getSparkAddress: async () => address,
  getIdentityPublicKey: async () => '02abc',
  signMessageWithIdentityKey: async (m: string) => { signed.push(m); return 'sig'; },
});
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const calls: Array<{ url: string; init?: RequestInit }> = [];
const fetchWith = (...responses: Response[]) => (async (url: string, init?: RequestInit) => {
  calls.push({ url, init });
  return responses.shift() ?? json({}, 500);
}) as unknown as typeof fetch;
const body = (i: number) => JSON.parse(String(calls[i].init?.body));

beforeEach(() => { mockSettings.clear(); signed.length = 0; calls.length = 0; jest.spyOn(Date, 'now').mockReturnValue(1700000000000); });
afterEach(() => jest.restoreAllMocks());

test('names follow the registry rules', () => {
  expect(normalizeName(' Mario@kaleidoswap.me ')).toBe('mario');
  expect(nameProblem('abc')).toBe('At least 5 characters.');
  expect(nameProblem('-mario')).toMatch(/a-z, 0-9/);
  expect(nameProblem('mario.rossi')).toBeNull();
  expect(nameProblem('')).toBeNull();
});

test('availability: local rules first, then the registry', async () => {
  expect(await checkName('ab', fetchWith())).toMatchObject({ available: false, error: 'At least 5 characters.' });
  expect(calls).toHaveLength(0);
  expect(await checkName('mario', fetchWith(json({ available: true, valid: true })))).toEqual({ available: true, valid: true, error: undefined });
  expect(calls[0].url).toBe('https://kaleidoswap.me/v1/names/mario');
  expect(await checkName('admin1', fetchWith(json({ available: false, valid: false, error: 'name is reserved' }, 400)))).toMatchObject({ error: 'That name is reserved.' });
  const offline = (async () => { throw new Error('down'); }) as unknown as typeof fetch;
  expect((await checkName('mario', offline)).error).toMatch(/Can't reach/);
});

test('claim signs the canonical message and remembers the handle for this wallet', async () => {
  const handle = await claimHandle(7, 'Mario', { signer: signer(), fetchImpl: fetchWith(json({ ok: true, lightningAddress: 'mario@kaleidoswap.me' })) });
  expect(signed).toEqual(['kaleidoswap-me:register:mario:sp1qme:1700000000000']);
  expect(body(0)).toMatchObject({ name: 'mario', sparkAddress: 'sp1qme', identityPubkey: '02abc', timestamp: 1700000000000, signature: 'sig' });
  expect(handle.lightningAddress).toBe('mario@kaleidoswap.me');
  expect(await getStoredHandle(7)).toMatchObject({ name: 'mario' });
  expect(await getStoredHandle(8)).toBeNull();
});

test('a refused claim says why and stores nothing', async () => {
  await expect(claimHandle(7, 'mario', { signer: signer(), fetchImpl: fetchWith(json({ error: 'name already taken' }, 409)) })).rejects.toThrow('That name is taken.');
  expect(await getStoredHandle(7)).toBeNull();
});

test('release signs over the stored address and forgets the handle', async () => {
  await claimHandle(7, 'mario', { signer: signer(), fetchImpl: fetchWith(json({ ok: true, lightningAddress: 'mario@kaleidoswap.me' })) });
  await releaseHandle(7, { signer: signer('sp1qnew'), fetchImpl: fetchWith(json({ ok: true })) });
  expect(signed[1]).toBe('kaleidoswap-me:release:mario:sp1qme:1700000000000');
  expect(calls[1].init?.method).toBe('DELETE');
  expect(await getStoredHandle(7)).toBeNull();
});

test('refresh only updates when the Spark address changed', async () => {
  await claimHandle(7, 'mario', { signer: signer(), fetchImpl: fetchWith(json({ ok: true, lightningAddress: 'mario@kaleidoswap.me' })) });
  expect(await refreshTarget(7, { signer: signer(), fetchImpl: fetchWith() })).toBe(false);
  expect(await refreshTarget(7, { signer: signer('sp1qnew'), fetchImpl: fetchWith(json({ ok: true })) })).toBe(true);
  expect(signed[1]).toBe('kaleidoswap-me:update:mario:sp1qnew:1700000000000');
  expect((await getStoredHandle(7))?.sparkAddress).toBe('sp1qnew');
});

test('restore finds the handle by identity, then by payment address, and never throws', async () => {
  const found = await linkExistingHandle(7, { signer: signer(), fetchImpl: fetchWith(json({ error: 'none' }, 404), json({ record: { name: 'Mario', lightningAddress: 'mario@kaleidoswap.me', sparkAddress: 'sp1qme' } })) });
  expect(calls.map(c => c.url)).toEqual(['https://kaleidoswap.me/v1/identity/02abc', 'https://kaleidoswap.me/v1/target/sp1qme']);
  expect(found?.name).toBe('mario');
  const broken = (async () => { throw new Error('down'); }) as unknown as typeof fetch;
  expect(await linkExistingHandle(8, { signer: signer(), fetchImpl: broken })).toBeNull();
});

test('push registration signs the token hash, not the token', async () => {
  const handle = { name: 'mario', lightningAddress: 'mario@kaleidoswap.me', sparkAddress: 'sp1qme', claimedAt: 1 };
  const token = 'ExponentPushToken[abc123abc123abc]';
  await registerPushDevice(handle, token, 'ios', { signer: signer(), fetchImpl: fetchWith(json({ ok: true })) });
  expect(signed[0]).toBe(`kaleidoswap-me:push-register:mario:${tokenHash(token)}:1700000000000`);
  expect(tokenHash(token)).toMatch(/^[0-9a-f]{64}$/);
  expect(calls[0]).toMatchObject({ url: 'https://kaleidoswap.me/v1/names/mario/push', init: { method: 'POST' } });
  expect(body(0)).toMatchObject({ token, platform: 'ios', identityPubkey: '02abc' });
  await removePushDevice(handle, token, 'ios', { signer: signer(), fetchImpl: fetchWith(json({ ok: true })) });
  expect(signed[1]).toMatch(/^kaleidoswap-me:push-remove:mario:/);
  expect(calls[1].init?.method).toBe('DELETE');
});

test('without a connected Spark account it says so', () => {
  expect(() => sparkSigner()).toThrow('Connect your Spark account first.');
});
