// services/NWCService.test.ts
import NWCService, {
  DEFAULT_NWC_BUDGET_SATS,
  DEFAULT_NWC_MAX_PAYMENT_SATS,
  NWCConnection,
  NWC_ERROR_CODES,
  NWC_APPROVAL_TIMEOUT_MS,
} from './NWCService';
import { decodeBolt11 } from '../utils/decodeInvoice';

jest.mock('@nostr-dev-kit/ndk', () => ({
  __esModule: true,
  default: jest.fn(),
  NDKPrivateKeySigner: jest.fn(),
}));
jest.mock('./protocols', () => ({ protocolManager: { getAdapterIfAvailable: jest.fn() } }));
jest.mock('../utils/decodeInvoice', () => ({ decodeBolt11: jest.fn() }));

const decode = decodeBolt11 as jest.Mock;

const makeConnection = (overrides: Partial<NWCConnection> = {}): NWCConnection => ({
  walletPubkey: 'wallet',
  clientSecret: 'secret',
  relayUrls: [],
  permissions: ['pay_invoice'],
  maxPaymentSats: DEFAULT_NWC_MAX_PAYMENT_SATS,
  budgetSats: DEFAULT_NWC_BUDGET_SATS,
  spentSats: 0,
  ...overrides,
});

describe('NWCService pay_invoice spending limits', () => {
  const svc = NWCService.getInstance() as any;
  const sendPayment = jest.fn();
  const approver = jest.fn();
  const pay = (connection: NWCConnection, invoice = 'lnbc1invoice') =>
    svc.handlePayInvoice({ invoice }, connection);

  beforeEach(() => {
    jest.clearAllMocks();
    svc.rgbApiService = { sendPayment };
    svc.setPaymentApprover(approver);
    approver.mockResolvedValue(true);
    sendPayment.mockResolvedValue({ paymentHash: 'hash', preimage: 'preimage' });
  });

  it('pays within limits and returns the real preimage, not the hash', async () => {
    decode.mockReturnValue({ amountSats: 1_000 });
    const connection = makeConnection();

    const res = await pay(connection);

    expect(res.result).toEqual({ preimage: 'preimage' });
    expect(connection.spentSats).toBe(1_000);
  });

  it('refuses amountless invoices', async () => {
    decode.mockReturnValue({ amountSats: undefined });

    const res = await pay(makeConnection());

    expect(res.error.code).toBe(NWC_ERROR_CODES.RESTRICTED);
    expect(sendPayment).not.toHaveBeenCalled();
  });

  it('refuses payments over the per-payment cap', async () => {
    decode.mockReturnValue({ amountSats: 10_001 });

    const res = await pay(makeConnection({ maxPaymentSats: 10_000 }));

    expect(res.error.code).toBe(NWC_ERROR_CODES.QUOTA_EXCEEDED);
    expect(sendPayment).not.toHaveBeenCalled();
  });

  it('refuses payments that would exceed the budget', async () => {
    decode.mockReturnValue({ amountSats: 600 });
    const connection = makeConnection({ budgetSats: 1_000, spentSats: 500 });

    const res = await pay(connection);

    expect(res.error.code).toBe(NWC_ERROR_CODES.QUOTA_EXCEEDED);
    expect(connection.spentSats).toBe(500);
  });

  it('reserves budget for concurrent payments', async () => {
    decode.mockReturnValue({ amountSats: 600 });
    const connection = makeConnection({ budgetSats: 1_000 });

    const [a, b] = await Promise.all([pay(connection), pay(connection)]);

    expect([a, b].filter((r) => r.error).length).toBe(1);
    expect(sendPayment).toHaveBeenCalledTimes(1);
    expect(connection.spentSats).toBe(600);
  });

  it('releases the reservation when the payment fails', async () => {
    decode.mockReturnValue({ amountSats: 600 });
    sendPayment.mockRejectedValue(new Error('no route'));
    const connection = makeConnection();

    const res = await pay(connection);

    expect(res.error.code).toBe(NWC_ERROR_CODES.PAYMENT_FAILED);
    expect(connection.spentSats).toBe(0);
  });

  it('keeps the reservation when the node returns no preimage', async () => {
    decode.mockReturnValue({ amountSats: 600 });
    sendPayment.mockResolvedValue({ paymentHash: 'hash' });
    const connection = makeConnection();

    const res = await pay(connection);

    expect(res.error).toBeDefined();
    expect(res.result).toBeUndefined();
    expect(connection.spentSats).toBe(600);
  });

  describe('in-app approval', () => {
    it('asks the user with the amount and description before paying', async () => {
      decode.mockReturnValue({ amountSats: 1_000, description: 'coffee' });

      await pay(makeConnection());

      expect(approver).toHaveBeenCalledWith({ amountSats: 1_000, description: 'coffee', invoice: 'lnbc1invoice' });
      expect(approver.mock.invocationCallOrder[0]).toBeLessThan(sendPayment.mock.invocationCallOrder[0]);
    });

    it('refuses and releases the budget when the user declines', async () => {
      decode.mockReturnValue({ amountSats: 1_000 });
      approver.mockResolvedValue(false);
      const connection = makeConnection();

      const res = await pay(connection);

      expect(res.error.code).toBe(NWC_ERROR_CODES.RESTRICTED);
      expect(sendPayment).not.toHaveBeenCalled();
      expect(connection.spentSats).toBe(0);
    });

    it('fails closed when no approver is registered', async () => {
      decode.mockReturnValue({ amountSats: 1_000 });
      svc.setPaymentApprover(null);

      const res = await pay(makeConnection());

      expect(res.error).toBeDefined();
      expect(sendPayment).not.toHaveBeenCalled();
    });

    it('treats an approver error as a refusal', async () => {
      decode.mockReturnValue({ amountSats: 1_000 });
      approver.mockRejectedValue(new Error('ui gone'));

      const res = await pay(makeConnection());

      expect(res.error).toBeDefined();
      expect(sendPayment).not.toHaveBeenCalled();
    });

    it('refuses when the prompt is not answered in time', async () => {
      jest.useFakeTimers();
      try {
        decode.mockReturnValue({ amountSats: 1_000 });
        approver.mockReturnValue(new Promise(() => {}));
        const connection = makeConnection();

        const pending = pay(connection);
        await jest.advanceTimersByTimeAsync(NWC_APPROVAL_TIMEOUT_MS);
        const res = await pending;

        expect(res.error).toBeDefined();
        expect(sendPayment).not.toHaveBeenCalled();
        expect(connection.spentSats).toBe(0);
      } finally {
        jest.useRealTimers();
      }
    });
  });
});
