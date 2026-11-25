import { getReceivedMint, supportsReceivedMint } from './mint';

const invoice = 'rgb:asset/test-invoice';
const proof = {
  invoice, recipientId: 'sbc:wvout:id', assetId: 'rgb:asset', network: 'signet', opid: 'a'.repeat(64),
  lockId: 'b'.repeat(64), amount: '18446744073709551615', beforeBlock: '875', evmChainId: '11155111', bridgeContract: '0x' + 'c'.repeat(40),
};
const account = () => ({ network: 'signet', supportsReceivedMint: () => true, getReceivedMintForInvoice: jest.fn() });

test('returns the pre-deposit commitment without a witness txid, preserving full precision and omitting native fields', async () => {
  const wallet = account();
  wallet.getReceivedMintForInvoice.mockResolvedValue({ ...proof, consignmentPath: '/private/proof' });
  const guard = jest.fn();
  await expect(getReceivedMint(wallet, invoice, guard)).resolves.toEqual(proof);
  expect(wallet.getReceivedMintForInvoice).toHaveBeenCalledWith(invoice, guard);
  expect(guard).toHaveBeenCalledTimes(2);
});

test('returns the canonical lowercase bridge address when rgb-lib formats it with an EVM checksum', async () => {
  const wallet = account();
  const bridgeContract = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed';
  wallet.getReceivedMintForInvoice.mockResolvedValue({ ...proof, bridgeContract });
  await expect(getReceivedMint(wallet, invoice, () => {})).resolves.toMatchObject({ bridgeContract: bridgeContract.toLowerCase() });
});

test.each([{ invoice: 'rgb:other/dest' }, { assetId: '' }, { network: 'mainnet' }, { amount: '18446744073709551616' },
  { amount: 4 }, { beforeBlock: '01' }, { evmChainId: '0' }, { bridgeContract: 'unknown' }, { txid: '' }, { lockId: 'ABC' }])(
  'refuses malformed or mismatched native commitments %p', async patch => {
    const wallet = account(); wallet.getReceivedMintForInvoice.mockResolvedValue({ ...proof, ...patch });
    await expect(getReceivedMint(wallet, invoice, () => {})).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
  },
);

test('reports pending after authorization and suppresses a pending result on revocation', async () => {
  const wallet = account(); wallet.getReceivedMintForInvoice.mockResolvedValue(null);
  await expect(getReceivedMint(wallet, invoice, () => {})).resolves.toBeNull();
  await expect(getReceivedMint(wallet, invoice, jest.fn().mockImplementationOnce(() => {}).mockImplementationOnce(() => { throw Error('revoked'); }))).rejects.toThrow('revoked');
  const oldWallet = { ...wallet, supportsReceivedMint: () => false };
  expect(supportsReceivedMint(oldWallet)).toBe(false);
  await expect(getReceivedMint(oldWallet, invoice, () => {})).rejects.toMatchObject({ code: 'METHOD_NOT_SUPPORTED' });
});
