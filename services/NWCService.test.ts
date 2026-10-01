// services/NWCService.test.ts
import NWCService, {
  DEFAULT_NWC_BUDGET_SATS,
  DEFAULT_NWC_MAX_PAYMENT_SATS,
  NWCConnection,
  NWC_ERROR_CODES,
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
  const pay = (connection: NWCConnection, invoice = 'lnbc1invoice') =>
    svc.handlePayInvoice({ invoice }, connection);

  beforeEach(() => {
    jest.clearAllMocks();
    svc.rgbApiService = { sendPayment };
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
});
