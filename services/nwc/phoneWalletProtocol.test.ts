import {
  parsePhoneInvitation,
  PHONE_RELAY,
  payPhoneInvoice,
  type PaymentReview,
} from './phoneWalletProtocol';

const now = 1_800_000_000;
const client = 'a'.repeat(64);
const payment = '4'.repeat(32);
const txid = 'b'.repeat(64);
const qr = `kaleidoswap://pair?version=1&client=${client}&relay=${encodeURIComponent(PHONE_RELAY)}&nonce=${payment}&expires=${now + 300}`;
const event = { id: 'e'.repeat(64), expiry: now + 300 };
const params = {
  invoice: 'rgb:invoice',
  payment_id: payment,
  expires_at: event.expiry,
  origin: 'https://shop.example',
};

beforeEach(() => jest.spyOn(Date, 'now').mockReturnValue(now * 1000));
afterEach(() => jest.restoreAllMocks());

function setup() {
  const decoded = {
    asset_id: 'rgb:asset',
    recipient_id: 'sbc:wvout:abc',
    network: 'SIGNET',
    assignment: { type: 'Fungible', value: 7000 },
    expiration_timestamp: now + 900,
  };
  const account = {
    network: 'signet',
    decodeRgbInvoice: jest.fn(async () => decoded),
    listAssets: jest.fn(async () => ({
      nia: [{ assetId: 'rgb:asset', ticker: 'USD', precision: 2, balance: { spendable: 9999 } }],
    })),
    transfer: jest.fn(async (_params, guard) => {
      guard();
      return { txid };
    }),
  };
  const entries = new Map<
    string,
    { state: string; recipient_hash: string; invoice_hash: string; txid: string | null }
  >();
  const ledger = {
    browserPayment: jest.fn(async (_w, _c, id) => entries.get(id) ?? null),
    claimBrowserPayment: jest.fn(async (_w, _c, id, recipient, invoice) => {
      if (
        entries.has(id) ||
        [...entries.values()].some((v) => v.recipient_hash === recipient && v.state !== 'failed')
      )
        return false;
      entries.set(id, {
        state: 'reviewing',
        recipient_hash: recipient,
        invoice_hash: invoice,
        txid: null,
      });
      return true;
    }),
    beginBrowserSubmission: jest.fn(async (_w, _c, id) => {
      entries.get(id)!.state = 'pending';
    }),
    finishBrowserPayment: jest.fn(async (_w, _c, id, state, tx) => {
      Object.assign(entries.get(id)!, { state, txid: tx });
    }),
  };
  const deps = {
    account,
    ledger,
    walletId: 2,
    client,
    wallet: 'f'.repeat(64),
    guard: jest.fn(),
    approve: jest.fn(async (_r: PaymentReview) => {}),
  };
  const pay = (p = params) =>
    payPhoneInvoice(p, event, deps as unknown as Parameters<typeof payPhoneInvoice>[2]);
  return { deps, pay, decoded, account, entries };
}

test('QR pins relay, expiry, and unique keys', () => {
  expect(parsePhoneInvitation(qr, now)).toEqual({ client, nonce: payment, expires: now + 300 });
  expect(() => parsePhoneInvitation(qr, now + 300)).toThrow();
  expect(() => parsePhoneInvitation(qr + '&version=2', now)).toThrow();
  expect(() =>
    parsePhoneInvitation(qr.replace(encodeURIComponent(PHONE_RELAY), 'wss://relay.example'), now),
  ).toThrow();
});
test('fixed invoice uses phone values and persists the txid before returning', async () => {
  const { pay, deps, entries, account } = setup();
  await expect(pay()).resolves.toEqual({ txid });
  expect(deps.approve).toHaveBeenCalledWith(
    expect.objectContaining({
      request: event.id,
      network: 'signet',
      origin: params.origin,
      asset: 'rgb:asset',
      amount: 7000,
      recipient: 'sbc:wvout:abc',
      witnessSats: 1000,
      feeRate: 2,
    }),
  );
  expect(account.transfer).toHaveBeenCalledWith(
    {
      token: 'rgb:asset',
      recipient: params.invoice,
      amount: 7000,
      feeRate: 2,
      minConfirmations: 1,
      witnessData: { amountSat: 1000 },
    },
    expect.any(Function),
  );
  expect(entries.get(payment)).toMatchObject({ state: 'succeeded', txid });
  await expect(pay()).resolves.toEqual({ txid });
  expect(account.transfer).toHaveBeenCalledTimes(1);
  await expect(pay({ ...params, invoice: 'different' })).rejects.toMatchObject({
    code: 'INVALID_PARAMS',
  });
  await expect(pay({ ...params, payment_id: '5'.repeat(32) })).rejects.toThrow(/already requested/);
});
test.each(['network', 'open amount', 'negative', 'origin', 'cost override', 'expiry'])(
  'reject invalid %s before approval',
  async (kind) => {
    const { pay, deps, decoded, account } = setup();
    const p = { ...params };
    if (kind === 'network') decoded.network = 'MAINNET';
    if (kind === 'open amount') decoded.assignment.type = 'Any';
    if (kind === 'negative') decoded.assignment.value = -1;
    if (kind === 'origin') p.origin = 'https://x.example/path';
    if (kind === 'cost override') Object.assign(p, { feeRate: 99 });
    if (kind === 'expiry') p.expires_at--;
    await expect(pay(p)).rejects.toThrow();
    expect(deps.approve).not.toHaveBeenCalled();
    expect(account.transfer).not.toHaveBeenCalled();
  },
);
test('expiry or lock between approval and native call fails closed', async () => {
  const { pay, deps, entries, account } = setup();
  account.transfer.mockImplementationOnce(async (_params, guard) => {
    deps.guard.mockImplementationOnce(() => {
      throw new Error('locked');
    });
    guard();
    return { txid };
  });
  await expect(pay()).rejects.toMatchObject({ code: 'RESTRICTED' });
  expect(entries.get(payment)?.state).toBe('failed');
});
test('native uncertainty remains reserved and prevents retries', async () => {
  const { pay, entries, account } = setup();
  account.transfer.mockImplementationOnce(async (_p, guard) => {
    guard();
    throw new Error('lost reply');
  });
  await expect(pay()).rejects.toMatchObject({ code: 'OTHER' });
  expect(entries.get(payment)?.state).toBe('unknown');
  await expect(pay()).rejects.toThrow(/already requested/);
  expect(account.transfer).toHaveBeenCalledTimes(1);
});
test('decline is recorded and does not call the wallet', async () => {
  const { pay, deps, entries, account } = setup();
  deps.approve.mockRejectedValueOnce(new Error('declined'));
  await expect(pay()).rejects.toMatchObject({ code: 'RESTRICTED' });
  expect(entries.get(payment)?.state).toBe('failed');
  expect(deps.ledger.beginBrowserSubmission).not.toHaveBeenCalled();
  expect(account.transfer).not.toHaveBeenCalled();
});
