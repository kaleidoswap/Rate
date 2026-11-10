import { normalizeMakerPairs, getQuoteLayers, validateSwapString, swapInputRaw, capSwapBalance } from './swap-model';

const nested = { id: 'btc-token', base: { ticker: 'BTC', name: 'Bitcoin', precision: 8, protocol_ids: { BTC: 'btc' } }, quote: { ticker: 'TOK', name: 'Integer token', precision: 0, protocol_ids: { RGB: 'rgb:token' }, endpoints: [{ layer: 'RGB_LN', min_amount: 1, max_amount: 100, is_active: true }] }, routes: [{ from_layer: 'BTC_LN', to_layer: 'RGB_LN' }, { from_layer: 'RGB_LN', to_layer: 'BTC_LN' }] };
test('reads the SDK nested pair metadata, including zero precision and per-asset limits', () => {
  const [p] = normalizeMakerPairs([nested]);
  expect(p.base).toMatchObject(nested.base);
  expect(p.quote).toMatchObject(nested.quote);
  expect(getQuoteLayers(p, 'btc', 'rgb:token')).toEqual({ fromLayer: 'BTC_LN', toLayer: 'RGB_LN' });
  expect(getQuoteLayers(p, 'rgb:token', 'btc')).toEqual({ fromLayer: 'RGB_LN', toLayer: 'BTC_LN' });
});
test.each(['BTC_L1', 'RGB_L1', 'BTC_ARKADE', 'BTC_LIQUID', 'SPARK_SPARK'])('does not silently substitute Lightning for %s', layer => {
  const [p] = normalizeMakerPairs([{ ...nested, routes: [{ from_layer: layer, to_layer: 'RGB_LN' }] }]);
  expect(() => getQuoteLayers(p, 'btc', 'rgb:token')).toThrow(/not available/);
});
test('missing, empty and reverse-only routes do not invent a supported direction', () => {
  for (const routes of [undefined, [], [{ from_layer: 'RGB_LN', to_layer: 'BTC_LN' }]]) {
    const [p] = normalizeMakerPairs([{ ...nested, routes }]);
    expect(() => getQuoteLayers(p, 'btc', 'rgb:token')).toThrow();
  }
  expect(normalizeMakerPairs([{ ...nested, is_active: false }])).toEqual([]);
  expect(normalizeMakerPairs({} as any)).toEqual([]);
});
test('legacy metadata preserves zero decimals', () => {
  expect(normalizeMakerPairs([{ base_asset: 'BTC', quote_asset: 'TOK', quote_precision: 0 }])[0].quote.precision).toBe(0);
});
test.each(['100oops', '100.9', '1e2', '-100'])('rejects a malformed swapstring amount: %s', amount => {
  expect(validateSwapString(`${amount}/btc/2/rgb:token/expiry/hash`, 100, 'btc', 2, 'rgb:token', 'hash')).toBe(false);
});
test('requires a nonempty payment hash and accepts exact integer terms', () => {
  expect(validateSwapString('100/btc/2/rgb:token/expiry/', 100, 'btc', 2, 'rgb:token', '')).toBe(false);
  expect(validateSwapString('100/btc/2/rgb:token/expiry/hash', 100, 'BTC', 2, 'rgb:token', 'hash')).toBe(true);
});
test('MAX respects a known zero capacity, but not missing capacity', () => {
  expect(capSwapBalance(100, 0)).toBe(0);
  expect(capSwapBalance(100, 30)).toBe(30);
  expect(capSwapBalance(100, undefined)).toBe(100);
});
test('keeps BTC/sat/msat units exact and rejects fractional base units', () => {
  const [p] = normalizeMakerPairs([nested]);
  expect(swapInputRaw(1000, p.base, 'sats', false)).toBe(1000000);
  expect(swapInputRaw(0.00001, p.base, 'BTC', false)).toBe(1000000);
  expect(swapInputRaw(1000, p.base, 'sats', true)).toBe(1000);
  expect(() => swapInputRaw(0.1, p.base, 'sats', false)).toThrow();
  expect(() => swapInputRaw(1.1, p.quote, 'sats', false)).toThrow();
  expect(swapInputRaw(0.29, { ...p.quote, precision: 2 }, 'sats', false)).toBe(29);
});
