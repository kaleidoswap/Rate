import { buildActionCard, type CardDeps } from './card';
import { extractIntent } from './extract';
import { answerBalance, answerSpending, summarizeActivity } from './questions';
import type { LocalTextModel } from './model';
import type { ActivityItem } from '../ActivityService';

function deps(over: Partial<CardDeps> = {}): CardDeps {
  return {
    fiat: 'EUR',
    btcPrice: (c) => ({ EUR: 50_000, USD: 60_000 } as Record<string, number>)[c],
    balance: (a) => (a === 'BTC' ? 1_000_000 : a === 'USDT' ? 200 : undefined),
    findContacts: (name) => [{ name: 'Mario Rossi', lightning_address: 'mario@ln.example' }, { name: 'Maria', pubkey: 'ab' }]
      .filter((c) => c.name.toLowerCase().split(' ').includes(name.toLowerCase()) || c.name.toLowerCase() === name.toLowerCase()),
    contactDestination: async (c) => c.lightning_address,
    quoteSend: jest.fn(async () => ({ feeSat: 12, totalSat: 20_012, route: 'Spark · Lightning' })),
    quoteSwap: jest.fn(async () => ({ receiveAmount: 299.5, receiveUnit: 'USDT', fee: 0.5, feeUnit: 'USDT', venue: 'KaleidoSwap' })),
    ...over,
  };
}

describe('action cards use wallet numbers', () => {
  test('a fiat send converts with the wallet price and the fee comes from the Send quote', async () => {
    const d = deps();
    const card = (await buildActionCard({ kind: 'send', amount: { value: 10, unit: 'fiat', currency: 'EUR' }, recipient: 'Mario' }, d))!;
    expect(card.amountSat).toBe(20_000);
    expect(card.fiat).toEqual({ value: 10, currency: 'EUR', typed: true });
    expect(card.recipient).toEqual({ name: 'Mario Rossi', destination: 'mario@ln.example' });
    expect(card.fee).toEqual({ status: 'quoted', sat: 12 });
    expect(card.route).toBe('Spark · Lightning');
    expect(d.quoteSend).toHaveBeenCalledWith('mario@ln.example', 20_000);
    expect(card.review).toEqual({ screen: 'Send', params: { prefilledAddress: 'mario@ln.example', contactName: 'Mario Rossi', prefilledAmountSat: 20_000 } });
    expect(card.warnings).toEqual([]);
  });

  test('sats show their fiat value in the display currency', async () => {
    const card = (await buildActionCard({ kind: 'send', amount: { value: 100_000, unit: 'sats' }, recipient: 'bob@ln.example' }, deps()))!;
    expect(card.fiat).toEqual({ value: 50, currency: 'EUR', typed: false });
    expect(card.recipient).toEqual({ destination: 'bob@ln.example' });
  });

  test('no price: no amount, and the card says why', async () => {
    const card = (await buildActionCard({ kind: 'send', amount: { value: 10, unit: 'fiat', currency: 'EUR' }, recipient: 'Mario' }, deps({ btcPrice: () => 0 })))!;
    expect(card.amountSat).toBeUndefined();
    expect(card.warnings.join(' ')).toMatch(/No EUR price/);
    expect(card.review.params).not.toHaveProperty('prefilledAmountSat');
  });

  test('unknown and ambiguous contacts are warnings, never guesses', async () => {
    const none = (await buildActionCard({ kind: 'send', amount: { value: 1000, unit: 'sats' }, recipient: 'Zed' }, deps()))!;
    expect(none.warnings.join(' ')).toMatch(/No contact named “Zed”/);
    expect(none.review.params).not.toHaveProperty('prefilledAddress');
    const many = (await buildActionCard({ kind: 'send', amount: { value: 1000, unit: 'sats' }, recipient: 'Mari' }, deps({
      findContacts: () => [{ name: 'Mario' }, { name: 'Maria' }],
    })))!;
    expect(many.warnings.join(' ')).toMatch(/Several contacts/);
  });

  test('a failed fee quote keeps the card reviewable', async () => {
    const card = (await buildActionCard({ kind: 'send', amount: { value: 1000, unit: 'sats' }, recipient: 'Mario' }, deps({
      quoteSend: async () => { throw new Error('No route found'); },
    })))!;
    expect(card.fee).toEqual({ status: 'unavailable', note: 'No route found' });
    expect(card.review.screen).toBe('Send');
  });

  test('more than the balance is flagged', async () => {
    const card = (await buildActionCard({ kind: 'send', amount: { value: 0.5, unit: 'BTC' }, recipient: 'Mario' }, deps()))!;
    expect(card.warnings).toContain('That is more than your balance.');
  });

  test('half my BTC swaps half the wallet balance, priced by the venue quote', async () => {
    const d = deps();
    const card = (await buildActionCard({ kind: 'swap', amount: { value: 0.5, unit: 'fraction' }, asset: 'BTC', toAsset: 'USDT' }, d))!;
    expect(card.amountSat).toBe(500_000);
    expect(d.quoteSwap).toHaveBeenCalledWith('BTC', 'USDT', 500_000);
    expect(card.receive).toEqual({ amount: 299.5, unit: 'USDT', venue: 'KaleidoSwap' });
    expect(card.fee).toEqual({ status: 'quoted', units: 0.5, unit: 'USDT' });
    expect(card.review).toEqual({ screen: 'Swap', params: { fromAsset: 'BTC', toAsset: 'USDT', fromAmountSat: 500_000 } });
  });

  test('a token swap passes units', async () => {
    const card = (await buildActionCard({ kind: 'swap', amount: { value: 10, unit: 'asset', currency: 'USDT' }, asset: 'USDT', toAsset: 'BTC' }, deps({
      quoteSwap: async () => ({ receiveAmount: 16_000, receiveUnit: 'sats', fee: 30, feeUnit: 'sats' }),
    })))!;
    expect(card.amountUnits).toBe(10);
    expect(card.fee).toEqual({ status: 'quoted', sat: 30 });
    expect(card.review.params).toEqual({ fromAsset: 'USDT', toAsset: 'BTC', fromAmountUnits: 10 });
  });

  test('buying a dollar amount of USDT estimates the BTC side from the price', async () => {
    const card = (await buildActionCard({ kind: 'swap', amount: { value: 30, unit: 'asset', currency: 'USDT' }, asset: 'BTC', toAsset: 'USDT' }, deps()))!;
    expect(card.amountSat).toBe(50_000);
    expect(card.warnings.join(' ')).toMatch(/quote shows the exact amount/);
  });

  test('receive on Lightning prefills the amount and network', async () => {
    const card = (await buildActionCard({ kind: 'receive', amount: { value: 50_000, unit: 'sats' }, network: 'lightning', asset: 'BTC' }, deps()))!;
    expect(card.route).toBe('Lightning');
    expect(card.fee?.status).toBe('none');
    expect(card.review).toEqual({ screen: 'Receive', params: { prefilledAmountSat: 50_000, prefilledNetwork: 'lightning' } });
  });

  test('receiving a token names the asset', async () => {
    const card = (await buildActionCard({ kind: 'receive', amount: { value: 5, unit: 'asset', currency: 'USDT' }, asset: 'USDT' }, deps()))!;
    expect(card.amountUnits).toBe(5);
    expect(card.review).toEqual({ screen: 'Receive', params: { prefilledAssetTicker: 'USDT' } });
  });

  test('questions have no action card', async () => {
    expect(await buildActionCard({ kind: 'balance' }, deps())).toBeNull();
  });
});

describe('extractIntent', () => {
  const model = (reply: string, ready = true): LocalTextModel & { complete: jest.Mock } => ({
    ready: () => ready,
    complete: jest.fn(async () => reply),
  });

  test('confident rules never wait for the model', async () => {
    const m = model('{"kind":"balance"}');
    const r = await extractIntent('send 10€ to Mario', m);
    expect(r?.intent.kind).toBe('send');
    expect(m.complete).not.toHaveBeenCalled();
  });

  test('works with no model at all', async () => {
    expect((await extractIntent('receive 50k sats on Lightning', null))?.intent).toMatchObject({ kind: 'receive', network: 'lightning' });
  });

  test('the model fills a gap but its numbers must be in the text', async () => {
    const m = model('Here: {"kind":"send","amount":999999,"unit":"sats","recipient":"Mario"}');
    const r = await extractIntent('could you get some sats over to Mario', m);
    expect(r?.source).toBe('model');
    expect(r?.intent).toEqual({ kind: 'send', recipient: 'Mario' });
  });

  test('invalid model output falls back to the rules', async () => {
    const m = model('I cannot help with that');
    const r = await extractIntent('send 10 euro', m);
    expect(r).toMatchObject({ source: 'rules', intent: { kind: 'send' } });
  });

  test('a model error falls back to the rules', async () => {
    const m: LocalTextModel = { ready: () => true, complete: async () => { throw new Error('timeout'); } };
    expect((await extractIntent('send 10 euro', m))?.intent.kind).toBe('send');
  });

  test('a model that is not ready is never called', async () => {
    const m = model('{"kind":"send"}', false);
    await extractIntent('please move money', m);
    expect(m.complete).not.toHaveBeenCalled();
  });
});

describe('answers from wallet data', () => {
  const now = new Date('2026-10-09T12:00:00Z').getTime();
  const item = (over: Partial<ActivityItem>): ActivityItem => ({
    id: Math.random().toString(), type: 'send', source: 'payment', asset: 'BTC', assetTicker: 'BTC', assetPrecision: 8,
    amount: '', status: 'confirmed', txid: '', layer: 'LN', timestamp: now - 3_600_000, ...over,
  });

  test('spending sums sends in the period, with fees, skipping failed and old ones', () => {
    const items = [
      item({ rawSats: 10_000, fee: 5 }),
      item({ rawSats: 2_000, fee: 1, status: 'pending' }),
      item({ rawSats: 99_000, status: 'failed' }),
      item({ rawSats: 50_000, timestamp: now - 10 * 86_400_000 }),
      item({ type: 'receive', rawSats: 7_000 }),
      item({ type: 'swap', rawSats: 1_000 }),
      item({ asset: 'rgb:usdt', assetTicker: 'USDT', amount: '12.5' }),
    ];
    expect(summarizeActivity(items, 'week', 'out', now)).toEqual({ totalSat: 12_000, feeSat: 6, count: 3, assets: { USDT: 12.5 }, largestSat: 10_000 });
    const card = answerSpending({ kind: 'spending', period: 'week', direction: 'out' }, items, now);
    expect(card.title).toBe('Spent in the last 7 days');
    expect(card.totalSat).toBe(12_000);
    expect(card.rows).toEqual(expect.arrayContaining([{ label: 'USDT', units: 12.5, unit: 'USDT' }, { label: 'Fees', sat: 6 }]));
  });

  test('received this month', () => {
    const card = answerSpending({ kind: 'spending', period: 'month', direction: 'in' }, [item({ type: 'receive', rawSats: 7_000 })], now);
    expect(card).toMatchObject({ title: 'Received in the last 30 days', totalSat: 7_000, note: '1 payment' });
  });

  test('empty periods say so', () => {
    expect(answerSpending({ kind: 'spending', period: 'today', direction: 'out' }, [], now).note).toMatch(/No payments sent today/);
  });

  test('balance: Lite shows one total, Advanced names accounts', () => {
    const input = { totalSat: 30_000, byAccount: { SPARK: 20_000, RGB: 10_000, ARKADE: 0 }, assets: [{ ticker: 'USDT', amount: 5 }], advanced: false };
    expect(answerBalance({ kind: 'balance' }, input).rows).toEqual([{ label: 'USDT', units: 5, unit: 'USDT' }]);
    expect(answerBalance({ kind: 'balance' }, { ...input, advanced: true }).rows.map((r) => r.label)).toEqual(['Spark', 'RGB', 'USDT']);
    expect(answerBalance({ kind: 'balance', asset: 'USDT' }, input)).toMatchObject({ title: 'Your USDT', rows: [{ units: 5 }] });
  });
});

describe('runIntent', () => {
  const { runIntent } = require('./run') as typeof import('./run');
  const run = (text: string, activity: ActivityItem[] = []) => runIntent(text, {
    model: null,
    card: deps(),
    balance: () => ({ totalSat: 5000, byAccount: {}, assets: [], advanced: false }),
    activity: async () => activity,
  });

  test('actions become cards, questions become answers', async () => {
    expect((await run('send 10€ to Mario')).type).toBe('action');
    expect(await run('what is my balance')).toMatchObject({ type: 'answer', answer: { kind: 'balance', totalSat: 5000 } });
    expect(await run('how much did I spend this week')).toMatchObject({ type: 'answer', answer: { kind: 'spending', totalSat: 0 } });
  });

  test('anything else gets examples and a hint to turn on KaleidoMind', async () => {
    const r = await run('tell me a joke');
    expect(r.type).toBe('none');
    expect((r as any).message).toMatch(/Turn on KaleidoMind/);
  });
});
