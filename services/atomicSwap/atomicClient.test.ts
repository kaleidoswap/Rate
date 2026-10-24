import {
  ATOMIC_BTC_TO_USDT_RGB, ATOMIC_USDT_RGB_TO_BTC, AtomicSwapClient, AtomicSwapError, atomicBitcoinNetwork, atomicMakerBase,
  type AtomicOutpoint, type AtomicQuoteExpectations, type AtomicQuoteRequest,
} from './atomicClient';
import { JsonNumber, field, losslessEqual, parseLossless, stringifyLossless, type LosslessValue } from './losslessJson';

// Every HTTP body of two real regtest swaps (swap-sdk tests/fixtures/atomic-v1), as they crossed the wire.
const capture: { swaps: Record<string, Record<string, string | number>> } = require('./__fixtures__/atomic-v1-wire-capture.json');

const ASSET = 'rgb:test-usdt-contract';
const NOW = 1_800_000_000n;
const TXID = 'aa'.repeat(32);
const TAKER_TXID = 'bb'.repeat(32);
const MAKER_TXID = 'cc'.repeat(32);
// Above 2^53: a seal blinding as rgb-lib writes it. A JS number cannot hold it.
const BLINDING = '18446744073709551557';

const OFFER = `{"swap_id":"rgbswap1","maker_gives":{"kind":"Rgb","asset_id":"${ASSET}","amount":95000000},"maker_receives":{"kind":"Btc","asset_id":null,"amount":"100000"},"bitcoin_network":"Regtest","network_fee_sat":1200,"rgb_output_sat":1000,"expiration_timestamp":${NOW + 300n},"maker_btc_address":"bcrt1qmaker","proxy_url":"rpcs://proxy.example/json-rpc","platform_fee_sat":0,"fee_recipient_script_pubkey_hex":null}`;
const REQUEST = `{"offer":${OFFER},"taker_inputs":[{"outpoint":{"txid":"${TAKER_TXID}","vout":1}}],"taker_rgb_blinding":${BLINDING}}`;
const PROPOSAL = (request = REQUEST, makerInputs = `[{"outpoint":{"txid":"${MAKER_TXID}","vout":0}}]`) =>
  `{"request":${request},"maker_inputs":${makerInputs},"psbt":"cHNidP8="}`;
const COMPLETION = `{"proposal":${PROPOSAL()},"txid":"${TXID}","psbt":"cHNidP8="}`;
const WALLET: AtomicOutpoint[] = [{ txid: TAKER_TXID, vout: 1 }, { txid: TAKER_TXID, vout: 2 }];

const quoteBody = (offer: string = OFFER, over: Record<string, string> = {}) => {
  const fields: Record<string, string> = {
    id: '"01JATOMICSWAP"', pair: '"BTC/USDT-RGB"', direction: '"from"', fromAmount: '100000', toAmount: '95000000',
    assetId: `"${ASSET}"`, networkFeeSat: '1200', serviceFee: '500000', expiresAt: `${NOW + 60n}`, offerExpiresAt: `${NOW + 300n}`,
    offer, ...over,
  };
  return `{${Object.entries(fields).map(([k, v]) => `"${k}":${v}`).join(',')}}`;
};
const statusBody = (status: string) =>
  `{"id":"01JATOMICSWAP","pair":"BTC/USDT-RGB","status":"${status}","state":"x","fromAmount":100000,"toAmount":95000000,"assetId":"${ASSET}","networkFeeSat":1200,"txid":"${TXID}","confirmations":0,"expiresAt":${NOW + 60n},"offerExpiresAt":${NOW + 300n},"createdAt":${NOW}}`;
const EXPECT: AtomicQuoteExpectations = { assetId: ASSET, bitcoinNetwork: 'Regtest' };
const ASK: AtomicQuoteRequest = { pair: ATOMIC_BTC_TO_USDT_RGB, amount: 100_000n };

/** A maker answering each request with the next raw body; records what was sent. */
function mockMaker(...bodies: Array<string | { status: number; body: string }>) {
  const sent: { url: string; method: string; body?: string }[] = [];
  const fetchImpl = jest.fn(async (url: string, init: RequestInit) => {
    sent.push({ url, method: init.method ?? 'GET', body: init.body as string | undefined });
    const next = bodies.shift();
    if (next === undefined) throw new Error('no more answers');
    const { status, body } = typeof next === 'string' ? { status: 200, body: next } : next;
    return { ok: status >= 200 && status < 300, status, text: async () => body } as Response;
  });
  return { client: new AtomicSwapClient('https://maker.example/v2/', { fetchImpl: fetchImpl as unknown as typeof fetch }), sent };
}

async function refusal(promise: Promise<unknown>): Promise<AtomicSwapError> {
  const error = await promise.then(() => undefined, (e) => e);
  expect(error).toBeInstanceOf(AtomicSwapError);
  return error as AtomicSwapError;
}

describe('losslessJson', () => {
  it('keeps 64-bit integers digit for digit', () => {
    const text = `{"a":${BLINDING},"b":[1.5,-2,1e3,"x\\"y"],"c":null,"d":true}`;
    const value = parseLossless(text);
    expect((field(value, 'a') as JsonNumber).toBigInt()).toBe(BigInt(BLINDING));
    expect(stringifyLossless(value)).toBe(text);
  });

  it('compares by value, ignoring key order, never a number with a string', () => {
    expect(losslessEqual(parseLossless('{"a":1,"b":[2]}'), parseLossless('{"b":[2],"a":1}'))).toBe(true);
    expect(losslessEqual(parseLossless(`{"a":${BLINDING}}`), parseLossless('{"a":18446744073709551556}'))).toBe(false);
    expect(losslessEqual(parseLossless('{"a":1}'), parseLossless('{"a":"1"}'))).toBe(false);
    expect(losslessEqual(parseLossless('{"a":1}'), parseLossless('{"a":1,"b":null}'))).toBe(false);
  });

  it.each(['{"a":1,}', '{"a":01}', '[1 2]', '{"a":1}x', '{"a":1,"a":2}', '"\u0001"', '{'])('refuses %s', (text) => {
    expect(() => parseLossless(text)).toThrow(SyntaxError);
  });

  it('does not let a key reach the prototype', () => {
    const value = parseLossless('{"__proto__":{"polluted":true}}') as Record<string, LosslessValue>;
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.keys(value)).toEqual(['__proto__']);
  });
});

describe('helpers', () => {
  it('maps app networks to rgb-lib names: Mutinynet is the custom signet', () => {
    expect(atomicBitcoinNetwork('mutinynet')).toBe('SignetCustom');
    expect(atomicBitcoinNetwork('regtest')).toBe('Regtest');
  });

  it('finds the /v2 base from a root or /v2 URL', () => {
    expect(atomicMakerBase('https://maker.signet.kaleidoswap.com')).toBe('https://maker.signet.kaleidoswap.com/v2');
    expect(atomicMakerBase('https://maker.signet.kaleidoswap.com/v2/')).toBe('https://maker.signet.kaleidoswap.com/v2');
  });
});

describe('AtomicSwapClient', () => {
  it('runs quote, request, complete and track with rgb-lib JSON intact', async () => {
    const { client, sent } = mockMaker(
      quoteBody(),
      `{"id":"01JATOMICSWAP","status":"transaction.proposed","proposal":${PROPOSAL()}}`,
      `{"id":"01JATOMICSWAP","status":"transaction.mempool","txid":"${TXID}","completion":${COMPLETION}}`,
      statusBody('transaction.mempool'),
      statusBody('transaction.claimed'),
    );
    const quote = await client.quote(ASK, { ...EXPECT, maxNetworkFeeSat: 5_000n, minToAmount: 90_000_000n, maxRgbOutputSat: 2_000n }, NOW);
    expect(sent[0]).toEqual({ url: 'https://maker.example/v2/swap/atomic/quote', method: 'POST', body: '{"pair":"BTC/USDT-RGB","amount":100000,"direction":"from"}' });
    expect(quote).toMatchObject({ id: '01JATOMICSWAP', fromAmount: 100_000n, toAmount: 95_000_000n, networkFeeSat: 1200n });
    expect(quote.offer).toBe(OFFER);

    const proposal = await client.request(quote.id, REQUEST, WALLET);
    expect(sent[1].body).toBe(`{"request":${REQUEST}}`);
    expect(proposal.proposal).toContain(BLINDING);
    expect(proposal.makerInputs).toEqual([{ txid: MAKER_TXID, vout: 0 }]);

    const done = await client.complete(quote.id, COMPLETION);
    expect(sent[2].body).toBe(`{"completion":${COMPLETION}}`);
    expect(done).toMatchObject({ txid: TXID, completion: COMPLETION });

    const seen: string[] = [];
    const final = await client.track(quote.id, { intervalMs: 1, onStatus: (s) => seen.push(s.status) });
    expect(seen).toEqual(['transaction.mempool', 'transaction.claimed']);
    expect(final.status).toBe('transaction.claimed');
    expect(sent[3].url).toBe('https://maker.example/v2/swap/atomic/01JATOMICSWAP');
  });

  it.each(Object.keys(capture.swaps))('replays a real %s swap with every digit intact', async (pair) => {
    const swap = capture.swaps[pair];
    const asked = JSON.parse(swap.quoteSent as string);
    const quoted = parseLossless(swap.quote as string);
    const requestSent = parseLossless(swap.requestSent as string);
    const completeSent = parseLossless(swap.completeSent as string);
    const request = field(requestSent, 'request')!;
    const wallet = (field(request, 'taker_inputs') as LosslessValue[]).map((input) => {
      const outpoint = field(input, 'outpoint');
      return { txid: field(outpoint, 'txid') as string, vout: Number((field(outpoint, 'vout') as JsonNumber).raw) };
    });
    const { client, sent } = mockMaker(swap.quote as string, swap.request as string, swap.complete as string, swap.status as string);

    const quote = await client.quote(
      { pair: asked.pair, amount: BigInt(asked.amount) },
      { assetId: field(quoted, 'assetId') as string, bitcoinNetwork: 'Regtest' },
      BigInt(swap.now),
    );
    expect(losslessEqual(parseLossless(sent[0].body!), parseLossless(swap.quoteSent as string))).toBe(true);
    expect(losslessEqual(parseLossless(quote.offer), field(quoted, 'offer'))).toBe(true);

    const proposal = await client.request(quote.id, stringifyLossless(request), wallet);
    expect(sent[1].body).toBe(stringifyLossless(requestSent));
    expect(losslessEqual(parseLossless(proposal.proposal), field(parseLossless(swap.request as string), 'proposal'))).toBe(true);
    const blinding = field(request, 'taker_rgb_blinding');
    if (blinding instanceof JsonNumber) expect(proposal.proposal).toContain(`"taker_rgb_blinding":${blinding.raw}`);

    const done = await client.complete(quote.id, stringifyLossless(field(completeSent, 'completion')));
    expect(losslessEqual(parseLossless(sent[2].body!), completeSent)).toBe(true);
    expect(losslessEqual(parseLossless(done.completion), field(parseLossless(swap.complete as string), 'completion'))).toBe(true);
    expect((await client.status(quote.id)).status).toBe('transaction.claimed');
  });

  it('keeps blindings above 2^53 in the captured request', () => {
    const request = field(parseLossless(capture.swaps[ATOMIC_BTC_TO_USDT_RGB].requestSent as string), 'request');
    const blinding = field(request, 'taker_rgb_blinding') as JsonNumber;
    expect(blinding.toBigInt() > 2n ** 53n).toBe(true);
  });

  describe('refuses a quote', () => {
    const refusedQuote = async (body: string, expect: AtomicQuoteExpectations = EXPECT, ask = ASK) =>
      (await refusal(mockMaker(body).client.quote(ask, expect, NOW))).message;

    it('whose offer gives less than the quote', async () => {
      expect(await refusedQuote(quoteBody(OFFER.replace('"amount":95000000', '"amount":94000000')))).toMatch(/offer gives 94000000 units/);
    });
    it('whose offer takes more than the quote', async () => {
      expect(await refusedQuote(quoteBody(OFFER.replace('"amount":"100000"', '"amount":"100001"')))).toMatch(/offer takes 100001 sat/);
    });
    it('whose offer adds a platform fee', async () => {
      expect(await refusedQuote(quoteBody(OFFER.replace('"platform_fee_sat":0', '"platform_fee_sat":10')))).toMatch(/platform fee/);
    });
    it('whose offer is for another network', async () => {
      expect(await refusedQuote(quoteBody(), { ...EXPECT, bitcoinNetwork: 'SignetCustom' })).toMatch(/offer is for Regtest/);
    });
    it('whose offer reserves another miner fee', async () => {
      expect(await refusedQuote(quoteBody(OFFER.replace('"network_fee_sat":1200', '"network_fee_sat":1300')))).toMatch(/miner fee/);
    });
    it('whose offer outlives the quote', async () => {
      expect(await refusedQuote(quoteBody(OFFER.replace(`${NOW + 300n}`, `${NOW + 900n}`)))).toMatch(/offer expires at/);
    });
    it('whose offer names no maker destination', async () => {
      expect(await refusedQuote(quoteBody(OFFER.replace('"bcrt1qmaker"', 'null')))).toMatch(/no maker receive destination/);
    });
    it('for another asset', async () => {
      expect(await refusedQuote(quoteBody(), { ...EXPECT, assetId: 'rgb:other' })).toMatch(/is for asset/);
    });
    it('past its deadline', async () => {
      expect(await refusedQuote(quoteBody(undefined, { expiresAt: `${NOW}` }))).toMatch(/expired/);
    });
    it('under the minimum the user accepts', async () => {
      expect(await refusedQuote(quoteBody(), { ...EXPECT, minToAmount: 96_000_000n })).toMatch(/under the 96000000 minimum/);
    });
    it('over the miner fee ceiling', async () => {
      expect(await refusedQuote(quoteBody(), { ...EXPECT, maxNetworkFeeSat: 1_000n })).toMatch(/over the 1000 sat ceiling/);
    });
    it('whose RGB output exceeds the ceiling', async () => {
      expect(await refusedQuote(quoteBody(), { ...EXPECT, maxRgbOutputSat: 500n })).toMatch(/1000 sat in each RGB output/);
    });
    it('for another amount or pair', async () => {
      expect(await refusedQuote(quoteBody(), EXPECT, { ...ASK, amount: 99_999n })).toMatch(/request asked 99999/);
      expect(await refusedQuote(quoteBody(), EXPECT, { ...ASK, pair: ATOMIC_USDT_RGB_TO_BTC })).toMatch(/not USDT-RGB\/BTC/);
    });
    it('with an amount written as a string or a fraction', async () => {
      expect(await refusedQuote(quoteBody(undefined, { fromAmount: '"100000"' }))).toMatch(/fromAmount/);
      expect(await refusedQuote(quoteBody(undefined, { toAmount: '95000000.5' }))).toMatch(/toAmount/);
    });
  });

  it('mirrors the offer legs for USDT-RGB/BTC', async () => {
    const offer = `{"swap_id":"s","maker_gives":{"kind":"Btc","asset_id":null,"amount":99003},"maker_receives":{"kind":"Rgb","asset_id":"${ASSET}","amount":99500000},"bitcoin_network":"Regtest","network_fee_sat":700,"expiration_timestamp":${NOW + 300n},"maker_rgb_recipient_id":"bcrt:wvout:x"}`;
    const body = quoteBody(offer, { pair: '"USDT-RGB/BTC"', fromAmount: '99500000', toAmount: '99003', networkFeeSat: '700', serviceFee: '497' });
    const quote = await mockMaker(body).client.quote({ pair: ATOMIC_USDT_RGB_TO_BTC, amount: 99_500_000n }, EXPECT, NOW);
    expect(quote.toAmount).toBe(99_003n);
  });

  describe('refuses a proposal', () => {
    const proposed = (proposal: string, id = '01JATOMICSWAP') => `{"id":"${id}","status":"transaction.proposed","proposal":${proposal}}`;

    it("listing the taker's own coin as the maker's, in any hex case", async () => {
      const makerInputs = `[{"outpoint":{"txid":"${TAKER_TXID.toUpperCase()}","vout":2}}]`;
      const error = await refusal(mockMaker(proposed(PROPOSAL(REQUEST, makerInputs))).client.request('01JATOMICSWAP', REQUEST, WALLET));
      expect(error.message).toMatch(/taker's own coin/);
    });
    it('listing a maker input twice', async () => {
      const input = `{"outpoint":{"txid":"${MAKER_TXID}","vout":0}}`;
      const error = await refusal(mockMaker(proposed(PROPOSAL(REQUEST, `[${input},${input}]`))).client.request('01JATOMICSWAP', REQUEST, WALLET));
      expect(error.message).toMatch(/twice/);
    });
    it('for another request, even one blinding digit off', async () => {
      const other = REQUEST.replace(BLINDING, '18446744073709551556');
      const error = await refusal(mockMaker(proposed(PROPOSAL(other))).client.request('01JATOMICSWAP', REQUEST, WALLET));
      expect(error.message).toMatch(/not for the request that was sent/);
    });
    it('for another swap', async () => {
      const error = await refusal(mockMaker(proposed(PROPOSAL(), 'OTHER')).client.request('01JATOMICSWAP', REQUEST, WALLET));
      expect(error.message).toMatch(/answers swap OTHER/);
    });
  });

  it('refuses a wallet list without the request inputs before sending anything', async () => {
    const { client, sent } = mockMaker();
    const error = await refusal(client.request('01JATOMICSWAP', REQUEST, [{ txid: TAKER_TXID, vout: 2 }]));
    expect(error.code).toBe('Generic');
    expect(sent).toHaveLength(0);
  });

  it('refuses rgb-lib messages that are not JSON objects', async () => {
    const { client } = mockMaker();
    expect((await refusal(client.request('01JATOMICSWAP', 'not json', WALLET))).code).toBe('Generic');
    expect((await refusal(client.complete('01JATOMICSWAP', '[1]'))).code).toBe('Generic');
  });

  it('refuses a broadcast of another transaction or proposal', async () => {
    const otherTx = `{"id":"01JATOMICSWAP","status":"transaction.mempool","txid":"${'dd'.repeat(32)}","completion":${COMPLETION}}`;
    expect((await refusal(mockMaker(otherTx).client.complete('01JATOMICSWAP', COMPLETION))).message).toMatch(/maker broadcast/);
    const otherProposal = COMPLETION.replace(MAKER_TXID, 'ee'.repeat(32));
    const answer = `{"id":"01JATOMICSWAP","status":"transaction.mempool","txid":"${TXID}","completion":${otherProposal}}`;
    expect((await refusal(mockMaker(answer).client.complete('01JATOMICSWAP', COMPLETION))).message).toMatch(/another proposal/);
  });

  it("reports the maker's error and status", async () => {
    const error = await refusal(mockMaker({ status: 400, body: '{"error":"pair disabled"}' }).client.quote(ASK, EXPECT, NOW));
    expect(error).toMatchObject({ code: 'Http', status: 400, message: 'maker answered 400: pair disabled' });
  });

  it('reads the pair cards, empty while the maker serves none', async () => {
    expect(await mockMaker('{"BTC":{},"L-BTC":{}}').client.pairs()).toEqual({ BTC: {}, 'L-BTC': {} });
    const card = '{"BTC":{"USDT-RGB":{"hash":"h","rate":0.00123,"limits":{"minimal":10000,"maximal":1000000},"fees":{"percentage":0.5,"minerFees":1000}}}}';
    expect((await mockMaker(card).client.pairs()).BTC['USDT-RGB']).toEqual({
      hash: 'h', rate: 0.00123, limits: { minimal: 10_000n, maximal: 1_000_000n }, fees: { percentage: 0.5, minerFees: 1000n },
    });
  });

  it('stops tracking when aborted', async () => {
    const controller = new AbortController();
    const { client } = mockMaker(statusBody('transaction.mempool'));
    const tracking = client.track('01JATOMICSWAP', { intervalMs: 60_000, signal: controller.signal, onStatus: () => controller.abort(new Error('stop')) });
    await expect(tracking).rejects.toThrow('stop');
  });
});
