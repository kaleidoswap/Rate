import { parseIntentRules, normalizeIntentText } from './parse';
import { extractJsonObject, numbersIn, parseLooseNumber, validateIntent } from './schema';

const rules = (t: string) => parseIntentRules(t)?.intent;

describe('deterministic intent rules', () => {
  test.each([
    ['send 10€ to Mario', { value: 10, unit: 'fiat', currency: 'EUR' }, 'Mario'],
    ['send €10 to Mario', { value: 10, unit: 'fiat', currency: 'EUR' }, 'Mario'],
    ['pay Mario 10 euro', { value: 10, unit: 'fiat', currency: 'EUR' }, 'Mario'],
    ['send $5 to alice@getalby.com', { value: 5, unit: 'fiat', currency: 'USD' }, 'alice@getalby.com'],
    ['send 5 dollars to Bob Smith', { value: 5, unit: 'fiat', currency: 'USD' }, 'Bob Smith'],
    ['send 5,000 sats to alice', { value: 5000, unit: 'sats' }, 'alice'],
    ['send 21k sats to Walter on lightning', { value: 21000, unit: 'sats' }, 'Walter'],
    ['send 0.001 btc to bob', { value: 0.001, unit: 'BTC' }, 'bob'],
    ['send twenty one sats to Walter', { value: 21, unit: 'sats' }, 'Walter'],
    ['manda 10€ a Mario', { value: 10, unit: 'fiat', currency: 'EUR' }, 'Mario'],
    ['invia 0,5 btc a Luca', { value: 0.5, unit: 'BTC' }, 'Luca'],
    ['paga Giulia 20 euro', { value: 20, unit: 'fiat', currency: 'EUR' }, 'Giulia'],
    ['manda dieci euro a Mario Rossi per la pizza', { value: 10, unit: 'fiat', currency: 'EUR' }, 'Mario Rossi'],
    ['invia 50 mila sats a Anna', { value: 50000, unit: 'sats' }, 'Anna'],
    ['trasferisci 1.000 sats a Paolo', { value: 1000, unit: 'sats' }, 'Paolo'],
    ['send 3 £ to Jane', { value: 3, unit: 'fiat', currency: 'GBP' }, 'Jane'],
  ])('%s', (text, amount, recipient) => {
    const r = parseIntentRules(text)!;
    expect(r.intent.kind).toBe('send');
    expect(r.intent.amount).toMatchObject(amount);
    expect(r.intent.recipient).toBe(recipient);
    expect(r.confident).toBe(true);
  });

  test('a bare number assumes sats and says so', () => {
    expect(rules('send 500 to Mario')?.amount).toEqual({ value: 500, unit: 'sats', assumed: true });
  });

  test('pays a pasted invoice or address as the recipient', () => {
    const inv = 'lnbc10u1pjexampleexampleexampleexample0';
    expect(rules(`pay ${inv}`)?.recipient).toBe(inv);
    expect(rules('send 1000 sats to bc1qexampleexampleexampleexample0')?.recipient).toBe('bc1qexampleexampleexampleexample0');
  });

  test('a send without a recipient is not confident', () => {
    const r = parseIntentRules('send 10 euro')!;
    expect(r.intent.kind).toBe('send');
    expect(r.confident).toBe(false);
  });

  test('does not take pronouns as names', () => {
    expect(rules('send it to me')?.recipient).toBeUndefined();
  });

  test.each([
    ['swap half my BTC to USDT', 'BTC', 'USDT', { value: 0.5, unit: 'fraction' }],
    ['swap 10 usdt for btc', 'USDT', 'BTC', { value: 10, unit: 'asset', currency: 'USDT' }],
    ['convert 50000 sats to USDT', 'BTC', 'USDT', { value: 50000, unit: 'sats' }],
    ['scambia metà dei miei BTC in USDT', 'BTC', 'USDT', { value: 0.5, unit: 'fraction' }],
    ['converti tutto in USDT', 'BTC', 'USDT', { value: 1, unit: 'fraction' }],
    ['buy 20 USDT', 'BTC', 'USDT', { value: 20, unit: 'asset', currency: 'USDT' }],
    ['sell 100 usdt', 'USDT', 'BTC', { value: 100, unit: 'asset', currency: 'USDT' }],
    ['swap 25% of my bitcoin into tether', 'BTC', 'USDT', { value: 0.25, unit: 'fraction' }],
    ['compra 10 usdt con btc', 'BTC', 'USDT', { value: 10, unit: 'asset', currency: 'USDT' }],
  ])('%s', (text, from, to, amount) => {
    const i = rules(text)!;
    expect(i.kind).toBe('swap');
    expect(i.asset).toBe(from);
    expect(i.toAsset).toBe(to);
    expect(i.amount).toMatchObject(amount);
  });

  test.each([
    ['receive 50k sats on Lightning', { value: 50000, unit: 'sats' }, 'lightning', 'BTC'],
    ['request 20€', { value: 20, unit: 'fiat', currency: 'EUR' }, undefined, 'BTC'],
    ['ricevi 10000 sats onchain', { value: 10000, unit: 'sats' }, 'onchain', 'BTC'],
    ['richiedi 5 USDT', { value: 5, unit: 'asset', currency: 'USDT' }, undefined, 'USDT'],
    ['create an invoice for 2100 sats', { value: 2100, unit: 'sats' }, undefined, 'BTC'],
  ])('%s', (text, amount, network, asset) => {
    const i = rules(text)!;
    expect(i.kind).toBe('receive');
    expect(i.amount).toMatchObject(amount);
    expect(i.network).toBe(network);
    expect(i.asset).toBe(asset);
  });

  test('receive without an amount is still an intent', () => {
    expect(rules('receive bitcoin')).toMatchObject({ kind: 'receive', asset: 'BTC' });
  });

  test.each([
    ['how much did I spend this week', 'out', 'week'],
    ['how much did I spend today?', 'out', 'today'],
    ['quanto ho speso questo mese?', 'out', 'month'],
    ['how much did I receive this month', 'in', 'month'],
    ['quanto ho ricevuto oggi', 'in', 'today'],
    ['how much have I spent', 'out', 'week'],
  ])('%s', (text, direction, period) => {
    expect(rules(text)).toEqual({ kind: 'spending', direction, period });
  });

  test.each(['what is my balance', 'how much do I have?', 'qual è il mio saldo', 'quanto ho nel wallet'])('%s', (text) => {
    expect(rules(text)?.kind).toBe('balance');
  });

  test('balance can name an asset', () => {
    expect(rules('what is my USDT balance')).toEqual({ kind: 'balance', asset: 'USDT' });
  });

  test('unrelated text is not an intent', () => {
    expect(parseIntentRules('what is lightning?')).toBeNull();
    expect(parseIntentRules('')).toBeNull();
  });

  test('Italian number words become digits before a unit', () => {
    expect(normalizeIntentText('manda dieci euro a Mario')).toBe('manda 10 euro a Mario');
    expect(normalizeIntentText('invia un po di tempo')).toBe('invia un po di tempo');
  });
});

describe('intent schema', () => {
  test('parses numbers in either decimal convention', () => {
    expect(parseLooseNumber('5,000')).toBe(5000);
    expect(parseLooseNumber('0,5')).toBe(0.5);
    expect(parseLooseNumber('1.000.000')).toBe(1_000_000);
    expect(parseLooseNumber('1.234,56')).toBe(1234.56);
    expect(parseLooseNumber('2.5')).toBe(2.5);
    expect(parseLooseNumber('abc')).toBeNull();
    expect(numbersIn('send 21k sats')).toEqual(expect.arrayContaining([21, 21000]));
  });

  test('accepts a well-formed model intent', () => {
    expect(validateIntent({ kind: 'send', amount: 10, unit: 'EUR', recipient: 'Mario' }, 'send 10 euros to Mario'))
      .toEqual({ kind: 'send', amount: { value: 10, unit: 'fiat', currency: 'EUR' }, recipient: 'Mario' });
  });

  test('rejects unknown kinds and non-objects', () => {
    expect(validateIntent({ kind: 'delete_wallet' }, 'x')).toBeNull();
    expect(validateIntent('send', 'send')).toBeNull();
    expect(validateIntent([{ kind: 'send' }], 'send')).toBeNull();
    expect(validateIntent(null, 'send')).toBeNull();
  });

  test('drops an amount the user never said', () => {
    expect(validateIntent({ kind: 'send', amount: 1000000, unit: 'sats', recipient: 'Mario' }, 'send 10 euros to Mario'))
      .toEqual({ kind: 'send', recipient: 'Mario' });
  });

  test('drops a recipient the user never named', () => {
    expect(validateIntent({ kind: 'send', amount: 10, unit: 'EUR', recipient: 'attacker@evil.com' }, 'send 10 euros to Mario'))
      .toEqual({ kind: 'send', amount: { value: 10, unit: 'fiat', currency: 'EUR' } });
  });

  test('accepts a fraction only when the user said one', () => {
    expect(validateIntent({ kind: 'swap', amount: 0.5, unit: 'fraction', asset: 'BTC', to_asset: 'USDT' }, 'swap half my btc to usdt'))
      .toEqual({ kind: 'swap', amount: { value: 0.5, unit: 'fraction' }, asset: 'BTC', toAsset: 'USDT' });
    expect(validateIntent({ kind: 'swap', amount: 1, unit: 'fraction' }, 'swap btc to usdt')).toEqual({ kind: 'swap' });
  });

  test('ignores malformed fields and unknown enums', () => {
    expect(validateIntent({ kind: 'receive', amount: -5, unit: 'sats', network: 'carrier-pigeon', period: 'decade', recipient: 'x\n{y}' }, 'receive -5 sats x'))
      .toEqual({ kind: 'receive' });
  });

  test('finds the JSON object inside prose and fences', () => {
    expect(extractJsonObject('Sure!\n```json\n{"kind":"balance","note":"a } brace"}\n```')).toEqual({ kind: 'balance', note: 'a } brace' });
    expect(extractJsonObject('no json here')).toBeNull();
    expect(extractJsonObject('{broken')).toBeNull();
  });
});
