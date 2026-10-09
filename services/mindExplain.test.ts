import { acceptExplanation, explain, explainTemplate, subjectFacts, type ExplainSubject } from './mindExplain';
import type { ActivityItem } from './ActivityService';
import type { LocalTextModel } from './mindIntents/model';

const item = (over: Partial<ActivityItem> = {}): ActivityItem => ({
  id: '1', type: 'send', source: 'payment', asset: 'BTC', assetTicker: 'BTC', assetPrecision: 8, amount: '',
  rawSats: 21_000, status: 'confirmed', txid: 'abc', layer: 'LN', timestamp: 1, fee: 3, preimage: 'secret', ...over,
});

const sentences = (t: string) => t.match(/[^.!?]+[.!?]+/g)?.length ?? 0;

describe('explain templates (no model)', () => {
  test.each<[string, ExplainSubject, RegExp]>([
    ['lightning send', { type: 'activity', item: item() }, /sent 21,000 sats over Lightning/],
    ['on-chain pending', { type: 'activity', item: item({ layer: 'L1', status: 'pending', type: 'receive' }) }, /waiting for a miner/],
    ['failed lightning', { type: 'activity', item: item({ status: 'failed' }) }, /failed, so it was not delivered/],
    ['unknown outcome', { type: 'activity', item: item({ status: 'unknown' }) }, /check its status before sending again/],
    ['swap', { type: 'activity', item: item({ type: 'swap', layer: 'Swap' }) }, /exchanged one asset for another/],
    ['channel open', { type: 'activity', item: item({ type: 'channel_open', layer: 'L1' }) }, /Lightning channel/],
    ['on-chain fee', { type: 'fee', item: item({ layer: 'L1', fee: 420 }) }, /420 sats fee went to the bitcoin miner/],
    ['lightning fee', { type: 'fee', item: item() }, /Lightning nodes that carried/],
    ['missing fee', { type: 'fee', item: item({ fee: undefined }) }, /does not include a fee/],
    ['rgb transfer', { type: 'rgb-transfer', item: item({ layer: 'RGB-L1', rawSats: undefined, amount: '10', assetTicker: 'USDT', status: 'pending', rgbTransfer: { status: 'waiting-counterparty', direction: 'outgoing' } as any }) }, /“Waiting for the other side”: Sent to the recipient/],
    ['swap error', { type: 'error', context: 'swap', message: 'QUOTE_EXPIRED' }, /quote ran out/],
    ['send no route', { type: 'error', context: 'send', message: 'No route found to destination' }, /no Lightning path/],
    ['send balance', { type: 'error', context: 'send', message: 'Insufficient balance' }, /does not hold enough/],
    ['generic', { type: 'error', context: 'general', message: 'boom' }, /Check Activity/],
  ])('%s', (_name, subject, re) => {
    const text = explainTemplate(subject);
    expect(text).toMatch(re);
    expect(sentences(text)).toBeGreaterThanOrEqual(2);
    expect(sentences(text)).toBeLessThanOrEqual(4);
  });

  test('facts never carry proofs or ids', () => {
    const facts = JSON.stringify(subjectFacts({ type: 'activity', item: item() }));
    expect(facts).not.toMatch(/secret|abc/);
    expect(facts).toMatch(/21000/);
  });
});

describe('explain with the on-device model', () => {
  const model = (reply: string, ready = true): LocalTextModel & { complete: jest.Mock } => ({ ready: () => ready, complete: jest.fn(async () => reply) });

  test('uses the model when its answer stays within the facts', async () => {
    const m = model('You paid 21,000 sats over Lightning. It arrived in seconds and the fee was 3 sats.');
    const r = await explain({ type: 'activity', item: item() }, m);
    expect(r).toMatchObject({ source: 'model', text: 'You paid 21,000 sats over Lightning. It arrived in seconds and the fee was 3 sats.' });
    expect(m.complete.mock.calls[0][1]).toContain('"amount_sats":21000');
  });

  test('falls back when the model invents a number', async () => {
    const r = await explain({ type: 'activity', item: item() }, model('You paid 50,000 sats. The fee was 3 sats.'));
    expect(r.source).toBe('template');
  });

  test('falls back when the model is off, errors, or rambles', async () => {
    expect((await explain({ type: 'fee', item: item() }, model('x', false))).source).toBe('template');
    expect((await explain({ type: 'fee', item: item() }, { ready: () => true, complete: async () => { throw new Error('t'); } })).source).toBe('template');
    expect((await explain({ type: 'fee', item: item() }, model('ok'))).source).toBe('template');
    expect((await explain({ type: 'fee', item: item() }, null)).source).toBe('template');
  });

  test('trims to four sentences and strips reasoning and markdown', () => {
    const reply = '<think>hmm 999</think>**One.** Two. Three. Four. Five.';
    expect(acceptExplanation(reply, {})).toBe('One. Two. Three. Four.');
  });
});
