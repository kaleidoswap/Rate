jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { OrchestraOrder, OrchestraQuote, OrchestraRoute } from '../services/orchestra/client';
import {
  BRIDGE_SESSION_KEY,
  BRIDGE_SESSION_MAX_AGE_MS,
  bridgeReducer,
  clearBridgeSession,
  defaultRoute,
  destAssetsFor,
  findRoute,
  formatCountdown,
  initialBridgeState,
  loadBridgeSession,
  orchestraErrorMessage,
  quoteMsLeft,
  resolveDecimals,
  restoreSession,
  sanitizeAmountInput,
  saveBridgeSession,
  sessionToPersist,
  sourceAssetsFor,
  sourceChains,
  sparkRoutes,
  validateBridgeAmount,
  type BridgeState,
} from './bridge-session';

const NOW = 1_800_000_000_000;

const route = (sourceChain: string, sourceAsset: string, destinationAsset: string, decimals = 6): OrchestraRoute => ({
  sourceChain,
  sourceAsset,
  destinationChain: 'spark',
  destinationAsset,
  source: { chain: sourceChain, asset: sourceAsset, decimals },
  destination: { chain: 'spark', asset: destinationAsset, decimals: destinationAsset === 'BTC' ? 8 : 6 },
});

const ROUTES: OrchestraRoute[] = [
  route('solana', 'SOL', 'BTC', 9),
  route('polygon', 'USDT', 'BTC'),
  route('ethereum', 'USDC', 'BTC'),
  route('ethereum', 'USDT', 'BTC'),
  route('ethereum', 'USDT', 'USDB'),
  route('tron', 'USDT', 'BTC'),
  { sourceChain: 'ethereum', sourceAsset: 'USDT', destinationChain: 'base', destinationAsset: 'USDC' },
  { sourceChain: 'spark', sourceAsset: 'BTC', destinationChain: 'spark', destinationAsset: 'USDB' },
];

const quote = (expiresInMs = 60_000): OrchestraQuote => ({
  quoteId: 'q1',
  depositAddress: '0xabc',
  amountIn: '10000000',
  estimatedOut: '15000',
  feeAmount: '1',
  feeBps: 10,
  totalFeeAmount: '1',
  feeAsset: 'USDC',
  route: ['USDT', 'BTC'],
  expiresAt: new Date(NOW + expiresInMs).toISOString(),
});

const order = (status: OrchestraOrder['status'] = 'processing'): OrchestraOrder => ({
  id: 'o1',
  quoteId: 'q1',
  status,
  readToken: 'rt',
});

const selecting: BridgeState = { ...initialBridgeState, sourceChain: 'ethereum', sourceAsset: 'USDT', amount: '10' };
const depositing: BridgeState = { ...selecting, step: 'deposit', quote: quote(), sourceDecimals: 6, destDecimals: 8 };
const tracking: BridgeState = { ...depositing, step: 'tracking', order: order() };

describe('routes', () => {
  const spark = sparkRoutes(ROUTES);

  it('keeps only external routes that deliver BTC or USDB to Spark', () => {
    expect(spark).toHaveLength(6);
    expect(spark.every((r) => r.destinationChain === 'spark' && r.sourceChain !== 'spark')).toBe(true);
  });

  it('orders chains and assets with the familiar ones first', () => {
    expect(sourceChains(spark)).toEqual(['ethereum', 'tron', 'solana', 'polygon']);
    expect(sourceAssetsFor(spark, 'ethereum')).toEqual(['USDT', 'USDC']);
  });

  it('lists the destinations a source offers', () => {
    expect(destAssetsFor(spark, 'ethereum', 'USDT')).toEqual(['BTC', 'USDB']);
    expect(destAssetsFor(spark, 'tron', 'USDT')).toEqual(['BTC']);
    expect(findRoute(spark, 'tron', 'USDT', 'USDB')).toBeUndefined();
  });

  it('defaults to USDT on Ethereum', () => {
    expect(defaultRoute(spark)).toMatchObject({ sourceChain: 'ethereum', sourceAsset: 'USDT' });
    expect(defaultRoute([route('solana', 'SOL', 'BTC')])).toMatchObject({ sourceChain: 'solana' });
    expect(defaultRoute([])).toBeUndefined();
  });
});

describe('resolveDecimals', () => {
  it('prefers the snapshot saved with the quote over the live route', () => {
    expect(resolveDecimals({ sourceDecimals: 18, destDecimals: 8 }, route('ethereum', 'ETH', 'BTC', 6))).toEqual({
      source: 18,
      dest: 8,
    });
  });

  it('falls back to the route and never guesses from a ticker', () => {
    expect(resolveDecimals({}, route('ethereum', 'USDT', 'BTC'))).toEqual({ source: 6, dest: 8 });
    expect(resolveDecimals({}, undefined)).toEqual({ source: undefined, dest: undefined });
  });
});

describe('amounts', () => {
  it('sanitizes typed input', () => {
    expect(sanitizeAmountInput('1,5')).toBe('1.5');
    expect(sanitizeAmountInput('1.2.3')).toBe('1.23');
    expect(sanitizeAmountInput('$ 12a')).toBe('12');
  });

  it('converts a valid amount to smallest units', () => {
    expect(validateBridgeAmount('10', 6)).toEqual({ ok: true, raw: '10000000' });
    expect(validateBridgeAmount('.5', 6)).toEqual({ ok: true, raw: '500000' });
    expect(validateBridgeAmount('2.', 6)).toEqual({ ok: true, raw: '2000000' });
    expect(validateBridgeAmount('0.000000000000000001', 18)).toEqual({ ok: true, raw: '1' });
  });

  it('rejects empty, zero, malformed and over-precise amounts', () => {
    expect(validateBridgeAmount('', 6)).toMatchObject({ ok: false, reason: 'empty' });
    expect(validateBridgeAmount('0.000', 6)).toMatchObject({ ok: false, reason: 'zero' });
    expect(validateBridgeAmount('.', 6)).toMatchObject({ ok: false, reason: 'invalid' });
    expect(validateBridgeAmount('1e5', 6)).toMatchObject({ ok: false, reason: 'invalid' });
    expect(validateBridgeAmount('1.1234567', 6, 'USDT')).toMatchObject({
      ok: false,
      reason: 'precision',
      message: 'USDT allows up to 6 decimals',
    });
    expect(validateBridgeAmount('1', undefined)).toMatchObject({ ok: false, reason: 'unknown-precision' });
  });
});

describe('quote expiry', () => {
  it('counts down to zero', () => {
    expect(quoteMsLeft(quote(90_000), NOW)).toBe(90_000);
    expect(quoteMsLeft(null, NOW)).toBe(0);
    expect(quoteMsLeft({ expiresAt: 'nope' }, NOW)).toBe(0);
    expect(formatCountdown(90_500)).toBe('1:30');
    expect(formatCountdown(-5)).toBe('0:00');
  });
});

describe('bridgeReducer', () => {
  it('edits the selection only on the select step', () => {
    let s = bridgeReducer(initialBridgeState, { type: 'selectSource', chain: 'tron', asset: 'USDT' });
    s = bridgeReducer(s, { type: 'selectDest', asset: 'USDB' });
    s = bridgeReducer(s, { type: 'setAmount', amount: '12,5' });
    expect(s).toMatchObject({ sourceChain: 'tron', sourceAsset: 'USDT', destAsset: 'USDB', amount: '12.5' });
    expect(bridgeReducer(depositing, { type: 'setAmount', amount: '99' })).toBe(depositing);
    expect(bridgeReducer(tracking, { type: 'selectSource', chain: 'tron', asset: 'USDT' })).toBe(tracking);
  });

  it('moves to deposit on a quote and swaps in a fresh one on re-quote', () => {
    const s = bridgeReducer(selecting, { type: 'quoteCreated', quote: quote(), sourceDecimals: 6, destDecimals: 8 });
    expect(s).toMatchObject({ step: 'deposit', sourceDecimals: 6, destDecimals: 8 });
    const fresh = { ...quote(1_800_000), quoteId: 'q2' };
    expect(bridgeReducer(s, { type: 'quoteCreated', quote: fresh, sourceDecimals: 6, destDecimals: 8 }).quote).toBe(fresh);
  });

  it('never lets a late quote replace a detected order', () => {
    expect(bridgeReducer(tracking, { type: 'quoteCreated', quote: quote(), sourceDecimals: 6, destDecimals: 8 })).toBe(tracking);
  });

  it('moves to tracking on the first detected order only', () => {
    const s = bridgeReducer(depositing, { type: 'orderDetected', order: { ...order(), status: 'Confirming' as never } });
    expect(s.step).toBe('tracking');
    expect(s.order?.status).toBe('confirming');
    expect(bridgeReducer(s, { type: 'orderDetected', order: { ...order(), id: 'o2' } })).toBe(s);
    expect(bridgeReducer(selecting, { type: 'orderDetected', order: order() })).toBe(selecting);
  });

  it('merges status updates, keeping the id and read token', () => {
    const s = bridgeReducer(tracking, {
      type: 'orderUpdated',
      update: { id: 'other', status: 'Bridging' as never, amountOut: '14000', readToken: undefined },
    });
    expect(s.order).toMatchObject({ id: 'o1', readToken: 'rt', status: 'bridging', amountOut: '14000' });
  });

  it('keeps the last status when an update omits it, and freezes a finished order', () => {
    const s = bridgeReducer(tracking, { type: 'orderUpdated', update: { amountOut: '1' } });
    expect(s.order?.status).toBe('processing');
    const done = bridgeReducer(tracking, { type: 'orderUpdated', update: { status: 'completed' } });
    expect(bridgeReducer(done, { type: 'orderUpdated', update: { status: 'processing' } })).toBe(done);
  });

  it('goes back from deposit and starts over keeping the chosen route', () => {
    expect(bridgeReducer(depositing, { type: 'backToSelect' })).toMatchObject({ step: 'select', quote: null, amount: '10' });
    expect(bridgeReducer(tracking, { type: 'backToSelect' })).toBe(tracking);
    expect(bridgeReducer(tracking, { type: 'startOver' })).toEqual({
      ...initialBridgeState,
      sourceChain: 'ethereum',
      sourceAsset: 'USDT',
    });
  });
});

describe('session persistence', () => {
  const stored = (state: BridgeState, savedAt = NOW) => ({ ...state, savedAt });

  it('persists only an in-flight session', () => {
    expect(sessionToPersist(selecting, NOW)).toBeNull();
    expect(sessionToPersist(depositing, NOW)).toEqual({ ...depositing, savedAt: NOW });
  });

  it('restores a live deposit or order', () => {
    expect(restoreSession(stored(depositing), NOW + 1000)).toEqual(depositing);
    expect(restoreSession(stored(tracking), NOW + 1000)).toEqual(tracking);
  });

  it('drops old, finished, malformed or empty sessions', () => {
    expect(restoreSession(stored(tracking, NOW - BRIDGE_SESSION_MAX_AGE_MS - 1), NOW)).toBeNull();
    expect(restoreSession(stored({ ...tracking, order: order('completed') }), NOW)).toBeNull();
    expect(restoreSession(stored({ ...tracking, order: order('Refunded' as never) }), NOW)).toBeNull();
    expect(restoreSession(stored({ ...tracking, order: null }), NOW)).toBeNull();
    expect(restoreSession({ ...stored(depositing), destAsset: 'ETH' }, NOW)).toBeNull();
    expect(restoreSession({ step: 'deposit' }, NOW)).toBeNull();
    expect(restoreSession('junk', NOW)).toBeNull();
    expect(restoreSession(null, NOW)).toBeNull();
  });

  it('turns an expired deposit into a filled-in selection', () => {
    const restored = restoreSession(stored({ ...depositing, quote: quote(-1) }), NOW);
    expect(restored).toMatchObject({ step: 'select', quote: null, sourceChain: 'ethereum', amount: '10' });
  });

  it('round-trips through storage', async () => {
    await saveBridgeSession(depositing, NOW);
    expect(await loadBridgeSession(NOW + 1000)).toEqual(depositing);
    await saveBridgeSession(selecting, NOW);
    expect(await AsyncStorage.getItem(BRIDGE_SESSION_KEY)).toBeNull();
  });

  it('clears storage that is not worth resuming', async () => {
    await AsyncStorage.setItem(BRIDGE_SESSION_KEY, '{not json');
    expect(await loadBridgeSession(NOW)).toBeNull();
    await saveBridgeSession({ ...depositing, quote: quote(-1) }, NOW);
    expect(await loadBridgeSession(NOW)).toMatchObject({ step: 'select' });
    expect(await AsyncStorage.getItem(BRIDGE_SESSION_KEY)).toBeNull();
    await saveBridgeSession(tracking, NOW);
    await clearBridgeSession();
    expect(await loadBridgeSession(NOW)).toBeNull();
  });
});

describe('orchestraErrorMessage', () => {
  const fallback = 'Could not create a deposit address';

  it('reads the reason from the response body', () => {
    expect(orchestraErrorMessage(new Error('Orchestra POST /v1/orchestration/quote failed (400): {"message":"Amount below minimum"}'), fallback)).toBe('Amount below minimum');
    expect(orchestraErrorMessage(new Error('Orchestra POST /x failed (422): {"error":{"message":"Unsupported route"}}'), fallback)).toBe('Unsupported route');
    expect(orchestraErrorMessage(new Error('Orchestra POST /x failed (400): amount too small'), fallback)).toBe('amount too small');
  });

  it('explains auth and connection failures', () => {
    expect(orchestraErrorMessage(new Error('ORCHESTRA_AUTH_FAILED: nope'), fallback)).toMatch(/aren't available/);
    expect(orchestraErrorMessage(new TypeError('Network request failed'), fallback)).toMatch(/No connection/);
  });

  it('falls back on anything unreadable', () => {
    expect(orchestraErrorMessage(new Error('Orchestra POST /x failed (500): <html>oops</html>'), fallback)).toBe(fallback);
    expect(orchestraErrorMessage(new Error('Orchestra POST /x failed (500): {}'), fallback)).toBe(fallback);
    expect(orchestraErrorMessage('weird', fallback)).toBe(fallback);
  });
});
