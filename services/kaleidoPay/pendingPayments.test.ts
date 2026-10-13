import { reconcileOtherPayments } from './pendingPayments';
import { loadPaymentAttempts, updatePaymentAttempt } from './attempts';
import { checkPaymentStatus } from './index';
jest.mock('./attempts', () => ({ loadPaymentAttempts: jest.fn(), updatePaymentAttempt: jest.fn(async () => true), unresolvedAttempt: (a: any) => a.status === 'pending' }));
jest.mock('./index', () => ({ prepareKaleidoPay: jest.fn(), paymentAccountNetwork: () => 'mutinynet', checkPaymentStatus: jest.fn(async () => ({ status: 'completed' })) }));
jest.mock('./onchainConfirmation', () => ({ checkOnchainConfirmation: async (a: any) => a }));
it('continues checking earlier payments without re-executing them', async () => {
  (loadPaymentAttempts as jest.Mock).mockResolvedValue([
    { id: 'older', sourceId: 'rgb-btc', status: 'pending', network: 'mutinynet' },
    { id: 'newer', sourceId: 'rgb-asset', status: 'pending', network: 'mutinynet' },
    { id: 'other-network', sourceId: 'rgb-btc', status: 'pending', network: 'mainnet' },
  ]);
  expect(await reconcileOtherPayments(1, () => true)).toBe(true);
  expect(checkPaymentStatus).toHaveBeenCalledWith('rgb-btc', 'older');
  expect(checkPaymentStatus).toHaveBeenCalledWith('rgb-asset', 'newer');
  expect(checkPaymentStatus).toHaveBeenCalledTimes(2);
  expect(updatePaymentAttempt).toHaveBeenCalledTimes(2);
});
