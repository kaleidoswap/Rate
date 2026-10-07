jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('./kaleidoPay/index', () => ({ registerKaleidoPayAccount: () => () => {} }));
jest.mock('./paymentReview', () => ({ estimatePaymentFee: jest.fn() }));
let mockWallet: any = null;
jest.mock('./kaleidoPay/connect', () => ({ connectedSparkWallet: () => mockWallet }));
jest.mock('./orchestra/client', () => ({ createQuote: jest.fn(), submitOrder: jest.fn(), getStatus: jest.fn() }));

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createQuote, getStatus, submitOrder } from './orchestra/client';
import {
  CrossChainNotSentError, QuoteChangedError, loadCrossChainSession, readSparkSource, refreshOrder, sendCrossChain, submitPaid,
} from './crosschainSend';
import type { CrossChainForm } from '../utils/crosschain-send';

const USDB_ID = 'btkn1xgrvjwey5ngcagvap2dzzvsy4uk8ua9x69k82dwvt5e7ef9drm9qztux87';
const form = (over: Partial<CrossChainForm> = {}): CrossChainForm => ({
  source: 'USDB', destChain: 'base', destToken: 'USDC', recipient: '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed', family: 'evm',
  mode: 'exact_in', amountRaw: '5000000', ...over,
});
const quote = { quoteId: 'q1', depositAddress: 'spark1deposit', amountIn: '5000000', estimatedOut: '4990000' };
const reviewed = { estimatedOut: '4990000' };

function adapter() {
  return {
    getReceiveAddress: jest.fn(async () => ({ address: 'spark1me' })),
    getBtcBalance: jest.fn(async () => ({ confirmed: 100_000 })),
    listAssets: jest.fn(async () => [{ id: USDB_ID, ticker: 'USDB', precision: 6, balance: { available: 10_000_000 } }]),
    sendAsset: jest.fn(async () => ({ txId: 'tok-tx' })),
    sendPayment: jest.fn(async () => ({ paymentHash: 'sats-tx', status: 'pending' })),
  };
}

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  mockWallet = { adapter: adapter(), network: 'mainnet' };
  (createQuote as jest.Mock).mockResolvedValue(quote);
  (submitOrder as jest.Mock).mockResolvedValue({ orderId: 'o1', status: 'processing', readToken: 'rt' });
});

test('USDB: the paying record is saved before the token leaves Spark, then the order is submitted', async () => {
  mockWallet.adapter.sendAsset.mockImplementation(async () => {
    expect((await loadCrossChainSession(1))?.phase).toBe('paying');
    return { txId: 'tok-tx' };
  });
  const s = await sendCrossChain({ walletId: 1, form: form(), reviewed, destDecimals: 6, id: 's1' });
  expect(mockWallet.adapter.sendAsset).toHaveBeenCalledWith({ assetId: USDB_ID, amount: 5_000_000, recipientId: 'spark1deposit' });
  expect(submitOrder).toHaveBeenCalledWith({ quoteId: 'q1', sparkTxHash: 'tok-tx', sourceSparkAddress: 'spark1me' });
  expect(s).toMatchObject({ phase: 'submitted', order: { id: 'o1', readToken: 'rt' } });
  expect(await loadCrossChainSession(1)).toEqual(s);
});

test('BTC is paid as a Spark transfer to the deposit address', async () => {
  (createQuote as jest.Mock).mockResolvedValue({ ...quote, amountIn: '50000' });
  await sendCrossChain({ walletId: 1, form: form({ source: 'BTC', amountRaw: '50000' }), reviewed, destDecimals: 6, id: 's1' });
  expect(mockWallet.adapter.sendPayment).toHaveBeenCalledWith({ invoice: 'spark1deposit', amount: 50_000 });
  expect(submitOrder).toHaveBeenCalledWith(expect.objectContaining({ sparkTxHash: 'sats-tx' }));
});

test('a failed send is kept as unknown and blocks a second payment', async () => {
  mockWallet.adapter.sendAsset.mockRejectedValue(new Error('timeout'));
  const s = await sendCrossChain({ walletId: 1, form: form(), reviewed, destDecimals: 6, id: 's1' });
  expect(s).toMatchObject({ phase: 'paying', lastError: 'timeout' });
  expect(submitOrder).not.toHaveBeenCalled();

  (createQuote as jest.Mock).mockClear();
  await expect(sendCrossChain({ walletId: 1, form: form(), reviewed, destDecimals: 6, id: 's2' })).rejects.toBeInstanceOf(CrossChainNotSentError);
  expect(createQuote).not.toHaveBeenCalled();
  expect(mockWallet.adapter.sendAsset).toHaveBeenCalledTimes(1);

  // Checking moves no funds: the quote alone is submitted, and accepted once the deposit is seen.
  const checked = await submitPaid(1, s, 1);
  expect(submitOrder).toHaveBeenCalledWith({ quoteId: 'q1', sourceSparkAddress: 'spark1me' });
  expect(checked.phase).toBe('submitted');
});

test('a worse quote than reviewed is not paid', async () => {
  (createQuote as jest.Mock).mockResolvedValue({ ...quote, estimatedOut: '4000000' });
  await expect(sendCrossChain({ walletId: 1, form: form(), reviewed, destDecimals: 6, id: 's1' })).rejects.toBeInstanceOf(QuoteChangedError);
  expect(mockWallet.adapter.sendAsset).not.toHaveBeenCalled();
  expect(await loadCrossChainSession(1)).toBeNull();
});

test('a quote above the balance is not paid', async () => {
  (createQuote as jest.Mock).mockResolvedValue({ ...quote, amountIn: '20000000' });
  await expect(sendCrossChain({ walletId: 1, form: form(), reviewed, destDecimals: 6, id: 's1' })).rejects.toThrow(/Not enough USDB/);
  expect(mockWallet.adapter.sendAsset).not.toHaveBeenCalled();
});

test('Spark must be connected and on mainnet', async () => {
  mockWallet = null;
  await expect(sendCrossChain({ walletId: 1, form: form(), reviewed, destDecimals: 6, id: 's1' })).rejects.toThrow(/Connect your Spark/);
  mockWallet = { adapter: adapter(), network: 'signet' };
  await expect(sendCrossChain({ walletId: 1, form: form(), reviewed, destDecimals: 6, id: 's1' })).rejects.toThrow(/mainnet only/);
  expect(createQuote).not.toHaveBeenCalled();
  expect(await readSparkSource()).toMatchObject({ connected: true, mainnet: false, btcSat: 100_000, usdb: { id: USDB_ID, available: 10_000_000 } });
});

test('a paid transfer whose submit failed is resubmitted with the same transfer id, then tracked', async () => {
  const paid = await paidSession();
  (submitOrder as jest.Mock).mockRejectedValueOnce(new Error('deposit not found'));
  const first = await submitPaid(1, paid, 1);
  expect(first).toMatchObject({ phase: 'paid', lastError: 'deposit not found' });
  const second = await submitPaid(1, first, 1);
  expect(submitOrder).toHaveBeenLastCalledWith({ quoteId: 'q1', sparkTxHash: 'tok-tx', sourceSparkAddress: 'spark1me' });
  expect(second.phase).toBe('submitted');

  (getStatus as jest.Mock).mockResolvedValue({ id: 'o1', status: 'completed', amountOut: '4990000' });
  const done = await refreshOrder(1, second);
  expect(getStatus).toHaveBeenCalledWith({ id: 'o1', readToken: 'rt' });
  expect(done).toMatchObject({ phase: 'done', order: { status: 'completed', amountOut: '4990000' } });
});

async function paidSession() {
  (submitOrder as jest.Mock).mockRejectedValueOnce(new Error('x')).mockRejectedValueOnce(new Error('x')).mockRejectedValueOnce(new Error('x'));
  jest.useFakeTimers();
  const pending = sendCrossChain({ walletId: 1, form: form(), reviewed, destDecimals: 6, id: 's1' });
  await jest.runAllTimersAsync();
  const s = await pending;
  jest.useRealTimers();
  expect(s.phase).toBe('paid');
  return s;
}
