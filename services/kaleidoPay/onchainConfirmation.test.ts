const mockStatus = jest.fn();
jest.mock('../mempool/MempoolClient', () => ({ isMempoolNetwork: (n: string) => n === 'mainnet', MempoolClient: class { getTxStatus = mockStatus; } }));
import { checkOnchainConfirmation } from './onchainConfirmation';
import { paymentPresentation, awaitingOnchainConfirmation } from '../../utils/payment-presentation';
import type { PaymentAttempt } from './attempts';
const sent: PaymentAttempt = { id: '1', sourceId: 'bark-onchain', provider: 'Bark', total: '100 sats', recipient: '90 sats', createdAt: 1, status: 'completed', reference: 'a'.repeat(64), network: 'mainnet', destinationRail: 'btc:mainnet' };
beforeEach(() => mockStatus.mockReset());
it('does not equate broadcast or an unavailable explorer with block confirmation', async () => {
  expect(paymentPresentation(sent).title).toBe('Sent to the network');
  expect(awaitingOnchainConfirmation(sent)).toBe(true);
  mockStatus.mockResolvedValueOnce({ confirmed: false }).mockRejectedValueOnce(new Error('offline'));
  expect(await checkOnchainConfirmation(sent)).toEqual(sent);
  expect(await checkOnchainConfirmation(sent)).toEqual(sent);
});
it('shows confirmed only after evidence of inclusion in a block', async () => {
  mockStatus.mockResolvedValue({ confirmed: true });
  const confirmed = await checkOnchainConfirmation(sent);
  expect(paymentPresentation(confirmed).title).toBe('Confirmed on-chain');
  expect(awaitingOnchainConfirmation(confirmed)).toBe(false);
  await checkOnchainConfirmation(confirmed);
  expect(mockStatus).toHaveBeenCalledTimes(1);
});
it('does not mistake a withdrawal request ID or a pending swap lockup for a paid recipient', async () => {
  await checkOnchainConfirmation({ ...sent, reference: 'provider-request-id' });
  await checkOnchainConfirmation({ ...sent, sourceId: 'swap-account', status: 'pending' });
  await checkOnchainConfirmation({ ...sent, network: undefined });
  expect(mockStatus).not.toHaveBeenCalled();
});
it('keeps Lightning completion and legacy on-chain receipts distinct', () => {
  expect(paymentPresentation({ ...sent, sourceId: 'spark-ln', destinationRail: 'ln:mainnet' }).title).toBe('Payment completed');
  expect(paymentPresentation({ ...sent, destinationRail: undefined, network: undefined }).title).toBe('Sent to the network');
  expect(paymentPresentation({ ...sent, sourceId: 'rgb-btc', status: 'pending' }).title).toBe('Sent to the network');
  expect(paymentPresentation({ ...sent, status: 'unknown' }).title).toBe('Payment outcome unknown');
});
