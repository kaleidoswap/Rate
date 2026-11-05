import { composerRoute, composerEstimate, legNetworks } from './swapComposer';
const market: any = { base_asset: { id: 'btc' }, quote_asset: { id: 'btc' }, quote_corridor: 'lightning', fee_bps: 50, min_base_amount: '10000', max_base_amount: '1000000', min_quote_amount: '10000', max_quote_amount: '1000000' };
const send: any = { id: 'send', kind: 'submarine', fromAsset: 'ARKD', toAsset: 'BTC', action: 'send-arkade', min: 10000, max: 1000000, intentsMarket: market };
const receive: any = { ...send, id: 'receive', kind: 'reverse', fromAsset: 'BTC', toAsset: 'ARKD', action: 'receive-arkade' };
const catalog: any = { routes: [send, receive] };
test('same asset on distinct networks maps to the correct executor', () => {
  expect(composerRoute(catalog, { asset: 'Bitcoin', network: 'Arkade' }, { asset: 'Bitcoin', network: 'Lightning' })).toBe(send);
  expect(composerRoute(catalog, { asset: 'Bitcoin', network: 'Lightning' }, { asset: 'Bitcoin', network: 'Arkade' })).toBe(receive);
  expect(composerRoute(catalog, { asset: 'Bitcoin', network: 'Arkade' }, { asset: 'Bitcoin', network: 'Arkade' })).toBeUndefined();
});
test('USDT never inherits a BTC executor or unsupported network', () => {
  expect(legNetworks('USDT')).toEqual(['Liquid', 'RGB']);
  expect(composerRoute(catalog, { asset: 'USDT', network: 'RGB' }, { asset: 'Bitcoin', network: 'Lightning' })).toBeUndefined();
});
test('estimates use the matching Intents card and never pretend to be a binding quote', () => {
  expect(composerEstimate(send, '10000')).toEqual({ sats: 10000, total: 10051, fee: 51 });
  expect(composerEstimate(receive, '10000').total).toBe(10051);
  for (const value of ['0', '-1', '1.5', '9007199254740992', '1', '1000001']) expect(composerEstimate(send, value).error).toBeTruthy();
  expect(composerEstimate(undefined, '10000').error).toBeTruthy();
});
