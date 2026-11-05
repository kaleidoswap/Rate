import { loadMakerCatalog, parseMakerCatalog, makerNetworkMatches, makerRoot, makerSendOffers, parseMakerReceiveReceipt } from './makerRoutes';
const url = 'https://maker.signet.kaleidoswap.com';
const pair = { pairId: 'BTC@ARKD/BTC@LN', hash: 'h', rate: 1, fees: { percentage: 0.5 }, limits: { minimal: 10000, maximal: 100000 } };
const market = { base_asset: { id: 'btc' }, quote_asset: { id: 'btc' }, quote_corridor: 'lightning', fee_bps: 50, min_base_amount: '10000', max_base_amount: '100000', min_quote_amount: '10000', max_quote_amount: '100000' };
const info = { network: 'signet', halted: false };
const books = () => ({ submarine: { ARKD: { BTC: pair }, BTC: { BTC: pair } }, reverse: { BTC: { ARKD: { ...pair, pairId: 'BTC@LN/BTC@ARKD' } } }, chain: {} });
test('enables only published routes with a matching Intents direction; native onchain stays unavailable', () => {
  const c = parseMakerCatalog(url, 'mutinynet', info, books(), { markets: [market] });
  expect(c.routes).toHaveLength(3);
  expect(c.routes[0].action).toBe('send-arkade');
  expect(c.routes[1].action).toBeUndefined();
  expect(c.routes[1].reason).toMatch(/Bitcoin on-chain/);
  expect(parseMakerCatalog(url, 'mutinynet', info, books(), null).routes.every(r => !r.action)).toBe(true);
});
test.each(['signet', 'testnet', 'mainnet'] as const)('never treats %s as Mutinynet', network => {
  expect(makerNetworkMatches(url, 'signet', network)).toBe(false);
  expect(() => parseMakerCatalog(url, network, info, books(), null)).toThrow('different networks');
});
test('halted or invalid maker data fails closed', () => {
  expect(parseMakerCatalog(url, 'mutinynet', { ...info, halted: true }, books(), { markets: [market] }).routes.every(r => !r.action)).toBe(true);
  expect(() => parseMakerCatalog(url, 'mutinynet', { network: 'signet' }, books(), null)).toThrow('availability');
  const invalid = books(); invalid.submarine.ARKD.BTC = { ...pair, limits: { minimal: 1, maximal: NaN } };
  expect(() => parseMakerCatalog(url, 'mutinynet', info, invalid, null)).toThrow('limits');
});
test('normalizes /v2 and refuses embedded credentials or query parameters', () => {
  expect(makerRoot(url + '/v2/')).toBe(url);
  for (const x of ['http://maker.test', 'https://user:secret@maker.test', url + '?token=x']) expect(() => makerRoot(x)).toThrow();
});
test('fetches v2 catalogue without creating swaps and treats a missing card as unavailable', async () => {
  const calls: string[] = [];
  const fetcher = jest.fn(async (u: string) => {
    calls.push(u); const path = u.slice(url.length);
    const data: any = { '/v2/info': info, '/v2/swap/submarine': books().submarine, '/v2/swap/reverse': {}, '/v2/swap/chain': {} };
    return { ok: path !== '/v1/card', status: path === '/v1/card' ? 404 : 200, json: async () => data[path] };
  });
  const catalog = await loadMakerCatalog(url, 'mutinynet', fetcher as any);
  expect(catalog.routes.every(r => !r.action)).toBe(true);
  expect(calls).toHaveLength(5);
  expect(fetcher.mock.calls.every(c => c[0].startsWith(url))).toBe(true);
});
test('maker-only handoff excludes other sources, networks, providers and direct payments', () => {
  const offer: any = { id: 'right', providerChoiceId: 'kaleidoswap', route: { sourceId: 'arkade', kind: 'swap', providerId: 'arkade-intents', to: 'ln:mutinynet' } };
  expect(makerSendOffers([offer, { ...offer, providerChoiceId: 'solver:x' }, { ...offer, route: { ...offer.route, to: 'ln:mainnet' } }, { ...offer, route: { ...offer.route, kind: 'direct' } }], 'mutinynet')).toEqual([offer]);
});

test('rejects corrupt restored receipts instead of crashing or creating a replacement', () => {
  for (const raw of ['{', '{}', JSON.stringify({ rfqId: 'x', invoice: 'ln', provider: 'KaleidoSwap', amountSats: 1, payAmountSats: 0, expiresAt: 42 })]) expect(() => parseMakerReceiveReceipt(raw)).toThrow();
});


test('a mismatched published pair never enables an Intents executor', () => {
  const b = books(); b.submarine.ARKD.BTC = { ...pair, pairId: 'BTC@L1/BTC@LN' };
  expect(parseMakerCatalog(url, 'mutinynet', info, b, { markets: [market] }).routes[0].action).toBeUndefined();
});
test('Liquid and RGB routes retain their asset identity and atomic amount units', () => {
  const b = { submarine: { 'L-USDT': { BTC: pair }, 'USDT-RGB': { BTC: pair } }, reverse: { BTC: { 'L-BTC': pair } }, chain: {} };
  const c = parseMakerCatalog(url, 'mutinynet', info, b, null);
  expect(c.routes[0]).toMatchObject({ from: 'USDT · Liquid', fromAsset: 'L-USDT', limitUnit: 'L-USDT atomic units', action: undefined });
  expect(c.routes[0].requirements).toContain('Native Liquid confidential transaction signing');
  expect(c.routes[1].requirements).toContain('Validate RGB contract, precision and consignment');
  expect(c.routes[2].to).toBe('Bitcoin · Liquid');
});
