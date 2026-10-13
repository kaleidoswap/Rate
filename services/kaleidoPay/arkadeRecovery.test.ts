import { reconcileArkadePayment } from './arkadeRecovery';
import { checkPaymentStatus } from './index';
import { loadPaymentAttempt, updatePaymentAttempt } from './attempts';
const mockWallet = { finalizePendingTxs: jest.fn(async () => ({ finalized: ['different-tx'], pending: [] })) };
const mockAdapter = { isConnected: () => true, rawWallet: mockWallet, arkInfo: { network: 'bitcoin' } };
jest.mock('../protocols', () => ({ protocolManager: { getAdapterIfAvailable: () => mockAdapter } }));
jest.mock('./index', () => ({ checkPaymentStatus: jest.fn() }));
jest.mock('./attempts', () => ({ loadPaymentAttempt: jest.fn(), updatePaymentAttempt: jest.fn(async () => true) }));
jest.mock('./onchainConfirmation', () => ({ checkOnchainConfirmation: async (a: any) => a }));
const attempt = { id: 'a', sourceId: 'arkade', status: 'unknown', network: 'mainnet', createdAt: 1 };
beforeEach(() => { jest.clearAllMocks(); (loadPaymentAttempt as jest.Mock).mockResolvedValue(attempt); (checkPaymentStatus as jest.Mock).mockResolvedValue({ status: 'unknown' }); });
test('recovers submitted transfers without attributing unrelated recovered txids to a lost receipt', async () => {
  expect(await reconcileArkadePayment(1)).toBe(false);
  expect(mockWallet.finalizePendingTxs).toHaveBeenCalledTimes(1);
  expect(updatePaymentAttempt).toHaveBeenCalledWith(1, expect.objectContaining({ status: 'unknown', lastCheckedAt: expect.any(Number), checkFailed: false }));
  expect((updatePaymentAttempt as jest.Mock).mock.calls[0][1].reference).toBeUndefined();
});
test('does not query payments through a different network', async () => {
  (loadPaymentAttempt as jest.Mock).mockResolvedValue({ ...attempt, network: 'signet' });
  await reconcileArkadePayment(1); expect(checkPaymentStatus).not.toHaveBeenCalled();
});
test('drops results after the user switches wallet', async () => {
  let current = true;
  (checkPaymentStatus as jest.Mock).mockImplementation(async () => { current = false; return { status: 'completed' }; });
  await reconcileArkadePayment(1, () => current); expect(updatePaymentAttempt).not.toHaveBeenCalled();
});
test('checks completed on-chain sends for block inclusion', async () => {
  (loadPaymentAttempt as jest.Mock).mockResolvedValue({ ...attempt, sourceId: 'arkade-onchain', status: 'completed' });
  await reconcileArkadePayment(1); expect(mockWallet.finalizePendingTxs).not.toHaveBeenCalled();
  expect(updatePaymentAttempt).toHaveBeenCalled();
});
