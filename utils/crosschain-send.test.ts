import {
  applyOrderStatus, beginPaying, canStartTransfer, depositAmountRaw, destChainsFor, destTokensFor, dismissSession, findRoute,
  formProblem, hintChains, isUnresolved, markPaid, markSubmitted, orchestraParams, parseAmountRaw, parseSession, pickSparkTxHash,
  quoteWorseThanReviewed, resumeAction, sourceInputDecimals, sourceSpendRaw, toSparkAmount, unwrapCrossChainUri, withError,
  type CrossChainForm,
} from './crosschain-send';
import type { OrchestraRoute } from '../services/orchestra/client';

const EVM = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed';
const SOL = 'So11111111111111111111111111111111111111112';
const r = (destinationChain: string, destinationAsset: string, sourceAsset = 'USDB', extra: Partial<OrchestraRoute> = {}): OrchestraRoute =>
  ({ sourceChain: 'spark', sourceAsset, destinationChain, destinationAsset, ...extra });
const form = (over: Partial<CrossChainForm> = {}): CrossChainForm => ({
  source: 'USDB', destChain: 'base', destToken: 'USDC', recipient: EVM, family: 'evm', mode: 'exact_in', amountRaw: '5000000', ...over,
});
const quote = { quoteId: 'q1', depositAddress: 'spark1deposit', estimatedOut: '4990000' };
const paying = () => beginPaying({ id: 's1', form: form(), quote, sourceSparkAddress: 'spark1me', sourceAmountRaw: '5000000', destDecimals: 6, now: 1 });

describe('amounts', () => {
  it('parses typed amounts exactly, never rounding', () => {
    expect(parseAmountRaw('1.5', 6)).toBe('1500000');
    expect(parseAmountRaw('0,25', 6)).toBe('250000');
    expect(parseAmountRaw('.5', 2)).toBe('50');
    expect(parseAmountRaw('1500', 0)).toBe('1500');
    expect(parseAmountRaw('1.5', 0)).toBeNull();
    expect(parseAmountRaw('1.0000001', 6)).toBeNull();
    expect(parseAmountRaw('0', 6)).toBeNull();
    expect(parseAmountRaw('abc', 6)).toBeNull();
    expect(parseAmountRaw('', 6)).toBeNull();
  });

  it('takes bitcoin in the wallet unit', () => {
    expect(sourceInputDecimals('BTC', 'sats')).toBe(0);
    expect(sourceInputDecimals('BTC', 'BTC')).toBe(8);
    expect(sourceInputDecimals('USDB', 'sats')).toBe(6);
  });

  it('uses only the quote source amount for exact-out, never the destination amount', () => {
    expect(depositAmountRaw({ amountIn: '100', requiredAmountIn: '120' }, form({ mode: 'exact_out', amountRaw: '100000000' }))).toBe('120');
    expect(() => depositAmountRaw({ amountIn: '' }, form({ mode: 'exact_out', amountRaw: '100000000' }))).toThrow(/Nothing was sent/);
    expect(depositAmountRaw({ amountIn: '4999999' }, form())).toBe('4999999');
    expect(depositAmountRaw({ amountIn: '' }, form())).toBe('5000000');
  });

  it('refuses amounts Spark cannot take as a number', () => {
    expect(toSparkAmount('42')).toBe(42);
    expect(() => toSparkAmount('0')).toThrow();
    expect(() => toSparkAmount('9007199254740993')).toThrow(/too large/);
  });

  it('builds exact-in and exact-out requests', () => {
    expect(orchestraParams(form())).toEqual({ sourceChain: 'spark', sourceAsset: 'USDB', destinationChain: 'base', destinationAsset: 'USDC', amount: '5000000' });
    expect(orchestraParams(form({ mode: 'exact_out', amountRaw: '7' }))).toMatchObject({ amountMode: 'exact_out', targetAmountOut: '7' });
    expect(sourceSpendRaw(form({ mode: 'exact_out' }), { requiredAmountIn: '123' })).toBe('123');
    expect(sourceSpendRaw(form({ mode: 'exact_out' }), null)).toBeNull();
  });

  it('flags a quote worse than what was reviewed', () => {
    expect(quoteWorseThanReviewed({ estimatedOut: '1000000' }, { estimatedOut: '995000' }, 'exact_in')).toBe(false);
    expect(quoteWorseThanReviewed({ estimatedOut: '1000000' }, { estimatedOut: '980000' }, 'exact_in')).toBe(true);
    expect(quoteWorseThanReviewed({ estimatedOut: '1', requiredAmountIn: '1000' }, { estimatedOut: '1', requiredAmountIn: '1005' }, 'exact_out')).toBe(false);
    expect(quoteWorseThanReviewed({ estimatedOut: '1', requiredAmountIn: '1000' }, { estimatedOut: '1', requiredAmountIn: '1020' }, 'exact_out')).toBe(true);
    expect(quoteWorseThanReviewed({ estimatedOut: '1', requiredAmountIn: '1000' }, { estimatedOut: '1' }, 'exact_out')).toBe(true);
  });

  it('reads the Spark transfer id from either send result', () => {
    expect(pickSparkTxHash({ txId: 'tok' })).toBe('tok');
    expect(pickSparkTxHash({ paymentHash: 'sats' })).toBe('sats');
    expect(pickSparkTxHash(null)).toBe('');
  });
});

describe('routes', () => {
  const routes = [r('base', 'USDC'), r('base', 'USDT', 'BTC'), r('solana', 'USDC'), r('tron', 'USDT'), { ...r('ethereum', 'USDC'), sourceChain: 'ethereum' }];

  it('offers only chains of the address family that route from Spark', () => {
    expect(destChainsFor(routes, 'evm').map(c => c.chain)).toEqual(['base']);
    expect(destChainsFor(routes, 'solana').map(c => c.chain)).toEqual(['solana']);
    expect(destChainsFor([], 'evm').map(c => c.chain)).toEqual(['ethereum', 'base', 'arbitrum', 'optimism', 'polygon']);
  });

  it('offers the tokens a chain can receive and finds the exact route', () => {
    expect(destTokensFor(routes, 'base')).toEqual(['USDC', 'USDT']);
    expect(destTokensFor(routes, 'solana')).toEqual(['USDC']);
    expect(findRoute(routes, 'base', 'USDT', 'BTC')).toBeTruthy();
    expect(findRoute(routes, 'base', 'USDT', 'USDB')).toBeNull();
  });

  it('lists curated chains in the hint, falling back when there are no live routes', () => {
    expect(hintChains(routes).map(c => c.chain)).toEqual(['base', 'solana']);
    expect(hintChains([]).length).toBe(6);
  });
});

describe('form', () => {
  const base = { sparkConnected: true, mainnet: true, spendableRaw: '10000000', form: form(), typedAmount: '5', inputDecimals: 6, routeKnown: true };
  it('is reviewable only when everything checks out', () => {
    expect(formProblem(base)).toBeNull();
    expect(formProblem({ ...base, sparkConnected: false })).toBe('spark-disconnected');
    expect(formProblem({ ...base, mainnet: false })).toBe('not-mainnet');
    expect(formProblem({ ...base, spendableRaw: '0' })).toBe('no-balance');
    expect(formProblem({ ...base, form: form({ recipient: SOL }) })).toBe('invalid-recipient');
    expect(formProblem({ ...base, typedAmount: '' })).toBe('no-amount');
    expect(formProblem({ ...base, typedAmount: '1.1234567' })).toBe('too-many-decimals');
    expect(formProblem({ ...base, routeKnown: false })).toBe('no-route');
    expect(formProblem({ ...base, form: form({ amountRaw: '20000000' }) })).toBe('exceeds-balance');
    expect(formProblem({ ...base, form: form({ mode: 'exact_out' }), estimate: { requiredAmountIn: '10000001' } })).toBe('exceeds-balance');
  });
});

describe('session', () => {
  it('is saved as paying before funds move, then paid, submitted and done', () => {
    let s = paying();
    expect(s.phase).toBe('paying');
    expect(resumeAction(s)).toBe('verify');
    expect(canStartTransfer(s)).toBe(false);

    s = markPaid(s, 'tx1', 2);
    expect(s).toMatchObject({ phase: 'paid', sparkTxHash: 'tx1' });
    expect(resumeAction(s)).toBe('submit');
    expect(() => markPaid(s, 'tx2', 3)).toThrow();

    s = markSubmitted(withError(s, 'busy', 3), { orderId: 'o1', status: 'processing', readToken: 'rt' }, 4);
    expect(s).toMatchObject({ phase: 'submitted', order: { id: 'o1', status: 'processing', readToken: 'rt' } });
    expect(s.lastError).toBeUndefined();
    expect(resumeAction(s)).toBe('track');
    expect(canStartTransfer(s)).toBe(false);

    s = applyOrderStatus(s, { status: 'BRIDGING' }, 5);
    expect(s.order?.status).toBe('bridging');
    s = applyOrderStatus(s, { status: 'nonsense' }, 6);
    expect(s.order?.status).toBe('bridging');
    s = applyOrderStatus(s, { status: 'completed', amountOut: '4990000' }, 7);
    expect(s).toMatchObject({ phase: 'done', order: { status: 'completed', amountOut: '4990000' } });
    expect(isUnresolved(s)).toBe(false);
    expect(resumeAction(s)).toBe('none');
    expect(canStartTransfer(s)).toBe(true);
  });

  it('a paying record can be verified by submitting the quote alone', () => {
    const s = markSubmitted(paying(), { orderId: 'o1', status: 'processing' }, 2);
    expect(s.phase).toBe('submitted');
  });

  it('only an explicit dismissal releases an unknown transfer', () => {
    const s = dismissSession(withError(paying(), 'timeout', 2), 3);
    expect(canStartTransfer(s)).toBe(true);
    expect(resumeAction(s)).toBe('none');
  });

  it('never starts paying without a deposit address or the sender address', () => {
    expect(() => beginPaying({ id: 's', form: form(), quote: { ...quote, depositAddress: '' }, sourceSparkAddress: 'x', sourceAmountRaw: '1', destDecimals: 6, now: 1 })).toThrow();
    expect(() => beginPaying({ id: 's', form: form(), quote, sourceSparkAddress: '', sourceAmountRaw: '1', destDecimals: 6, now: 1 })).toThrow();
  });

  it('round-trips through storage and rejects a damaged record', () => {
    const s = markPaid(paying(), 'tx1', 2);
    expect(parseSession(JSON.stringify(s))).toEqual(s);
    expect(parseSession(null)).toBeNull();
    expect(() => parseSession('{')).toThrow(/unreadable/);
    expect(() => parseSession(JSON.stringify({ ...s, phase: 'submitted' }))).toThrow(/unreadable/);
    expect(() => parseSession(JSON.stringify({ ...s, sourceAmountRaw: '1.5' }))).toThrow(/unreadable/);
  });
});

it('unwraps wallet URIs around a scanned address', () => {
  expect(unwrapCrossChainUri(`ethereum:${EVM}@8453`)).toBe(EVM);
  expect(unwrapCrossChainUri(`ethereum:pay-${EVM}@1`)).toBe(EVM);
  expect(unwrapCrossChainUri(`ethereum:${EVM}@1/transfer?address=0xabc`)).toBe('');
  expect(unwrapCrossChainUri(`solana:${SOL}?amount=1`)).toBe(SOL);
  expect(unwrapCrossChainUri(` ${EVM} `)).toBe(EVM);
});
