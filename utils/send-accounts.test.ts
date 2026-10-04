import { groupOffersByAccount, offerAccount } from './send-accounts';

const later = Math.floor(Date.now() / 1000) + 60;
const offer = (id: string, sourceId: string, total?: number, extra: Record<string, unknown> = {}) => ({
  id, provider: id, accountName: id, executable: true,
  route: { kind: 'direct', sourceId, from: 'ln:mainnet', to: 'ln:mainnet' },
  quote: total === undefined ? undefined : { recipientSat: 1000, totalSat: total, feeSat: total - 1000, expiresAt: later },
  ...extra,
}) as any;

test('each offer belongs to the account it spends from', () => {
  expect(offerAccount(offer('a', 'spark-ln'))).toBe('SPARK');
  expect(offerAccount(offer('b', 'spark-wallet-3'))).toBe('SPARK');
  expect(offerAccount(offer('c', 'arkade-onchain'))).toBe('ARKADE');
  expect(offerAccount(offer('d', 'bark'))).toBe('BARK');
  expect(offerAccount(offer('e', 'rgb-ln'))).toBe('RGB');
  expect(offerAccount(offer('f', 'electrum'))).toBeNull();
});

test('accounts that can pay come first, cheapest first; each picks its cheapest payable offer', () => {
  const groups = groupOffersByAccount([
    offer('rgb', 'rgb-ln', 1034),
    offer('spark-ln', 'spark-ln', 1021),
    offer('spark-swap', 'spark-wallet-1', 1300),
    offer('arkade', 'arkade', undefined, { unavailable: 'Not enough balance' }),
  ], { advanced: true });
  expect(groups.map(g => g.account)).toEqual(['SPARK', 'RGB', 'ARKADE']);
  expect(groups[0].best?.id).toBe('spark-ln');
  expect(groups[0].offers.map(o => o.id)).toEqual(['spark-ln', 'spark-swap']);
  expect(groups[2]).toMatchObject({ best: undefined, reason: 'Not enough balance' });
});

test('Bark is advanced: hidden in Lite unless it holds funds', () => {
  const offers = [offer('spark', 'spark-ln', 1021), offer('bark', 'bark', 1010)];
  expect(groupOffersByAccount(offers, { advanced: false }).map(g => g.account)).toEqual(['SPARK']);
  expect(groupOffersByAccount(offers, { advanced: false, balances: { BARK: 5000 } }).map(g => g.account)).toEqual(['BARK', 'SPARK']);
  expect(groupOffersByAccount(offers, { advanced: true }).map(g => g.account)).toEqual(['BARK', 'SPARK']);
});

test('an expired quote does not count as payable', () => {
  const stale = offer('rgb', 'rgb-ln', 900);
  stale.quote.expiresAt = Math.floor(Date.now() / 1000) - 1;
  const groups = groupOffersByAccount([stale, offer('spark', 'spark-ln', 1021)], { advanced: true });
  expect(groups[0].account).toBe('SPARK');
  expect(groups[1].best).toBeUndefined();
});
