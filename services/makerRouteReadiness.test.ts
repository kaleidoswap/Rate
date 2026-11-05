import { makerRouteReadiness } from './makerRouteReadiness';
test.each([
  ['BTC', 'BTC', 'Bitcoin on-chain'], ['L-BTC', 'BTC', 'Liquid'], ['L-USDT', 'BTC', 'Liquid'],
  ['USDT-RGB', 'BTC', 'RGB'], ['BTC', 'L-BTC', 'Liquid'], ['BTC', 'L-USDT', 'Liquid'],
  ['BTC', 'USDT-RGB', 'RGB'],
])('%s to %s requires native recovery, not just a published pair', (from, to, summary) => {
  const r = makerRouteReadiness(from, to);
  expect(r.summary).toContain(summary);
  expect(r.requirements).toContain('Persist recovery before funding');
  expect(r.requirements).toContain('Resume after restart without funding twice');
});
test('unknown assets cannot inherit Bitcoin or Liquid capabilities', () => {
  expect(makerRouteReadiness('NEW', 'BTC').requirements).toContain('Validate asset identity, units and network');
});
test('Arkade requires the matching Intents direction', () => {
  expect(makerRouteReadiness('ARKD', 'BTC').requirements).toEqual(['Matching Arkade Intents market']);
});
