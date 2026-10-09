import {
  ANY_RGB_ASSET_ID, DEFAULT_RGB_RECEIVE_OPTIONS, NO_RGB_RECEIVE_SUPPORT, isDefaultRgbOptions, listRgbUtxos, normalizeUnspents,
  parseRgbContractId, rgbInvoiceParams, rgbReceiveErrorMessage, rgbReceiveSupport, utxoCounts,
} from './rgb-receive';

const onDevice = { protocolName: 'RGB_L1', listUnspents: jest.fn(), createRgbUtxos: jest.fn() };
const engineNode = { protocolName: 'RGB_LN', executeProtocolOperation: jest.fn() };
const nwcNode = { protocolName: 'RGB_LN', walletType: () => 'rln', executeProtocolOperation: jest.fn() };
const ALL = rgbReceiveSupport(onDevice);

describe('rgbReceiveSupport', () => {
  it('RGB on this phone supports every option and UTXO management', () => {
    expect(ALL).toEqual({ invoiceKind: true, expiry: true, minConfirmations: true, listUtxos: true, createUtxos: true });
  });
  it('the node through the engine lists UTXOs but creates them only with privileged ops', () => {
    expect(rgbReceiveSupport(engineNode)).toMatchObject({ invoiceKind: true, listUtxos: true, createUtxos: false });
    expect(rgbReceiveSupport({ ...engineNode, allowPrivilegedOps: true }).createUtxos).toBe(true);
  });
  it('the node over NWC exposes only expiry and confirmations', () => {
    expect(rgbReceiveSupport(nwcNode)).toEqual({ invoiceKind: false, expiry: true, minConfirmations: true, listUtxos: false, createUtxos: false });
  });
  it('no adapter, no options', () => {
    expect(rgbReceiveSupport(null)).toEqual(NO_RGB_RECEIVE_SUPPORT);
  });
});

describe('rgbInvoiceParams', () => {
  it('defaults are the invoice Receive always made', () => {
    expect(rgbInvoiceParams({ assetId: ANY_RGB_ASSET_ID, expirySeconds: 3600, support: ALL }))
      .toEqual({ min_confirmations: 1, duration_seconds: 3600 });
    expect(rgbInvoiceParams({ assetId: 'rgb:abc', expirySeconds: 3600, options: DEFAULT_RGB_RECEIVE_OPTIONS, support: ALL }))
      .toEqual({ asset_id: 'rgb:abc', min_confirmations: 1, duration_seconds: 3600 });
  });
  it('maps the chosen options', () => {
    expect(rgbInvoiceParams({
      assetId: 'rgb:abc', expirySeconds: 3600, support: ALL,
      options: { kind: 'blinded', durationSeconds: 86_400, minConfirmations: 3 },
    })).toEqual({ asset_id: 'rgb:abc', min_confirmations: 3, duration_seconds: 86_400, witness: false });
  });
  it('drops what the account does not support', () => {
    const options = { kind: 'blinded' as const, durationSeconds: 600, minConfirmations: 6 };
    expect(rgbInvoiceParams({ assetId: ANY_RGB_ASSET_ID, expirySeconds: 3600, options, support: rgbReceiveSupport(nwcNode) }))
      .toEqual({ min_confirmations: 6, duration_seconds: 600 });
    expect(rgbInvoiceParams({ assetId: ANY_RGB_ASSET_ID, expirySeconds: 3600, options }))
      .toEqual({ min_confirmations: 1, duration_seconds: 3600 });
  });
  it('knows the default options', () => {
    expect(isDefaultRgbOptions(DEFAULT_RGB_RECEIVE_OPTIONS)).toBe(true);
    expect(isDefaultRgbOptions({ ...DEFAULT_RGB_RECEIVE_OPTIONS, kind: 'blinded' })).toBe(false);
  });
});

describe('parseRgbContractId', () => {
  it('accepts contract ids, strips the mnemonic suffix and whitespace', () => {
    expect(parseRgbContractId('  rgb:CJkb4YZw-jRiz2sk-~PARPio-wtVYI1c-XAEYCqO-wTfvRZ8#ticket-alpha ')).toBe('rgb:CJkb4YZw-jRiz2sk-~PARPio-wtVYI1c-XAEYCqO-wTfvRZ8');
    expect(parseRgbContractId('RGB1QYFE883HEY6JRGJ2Q4GZQH0DHTM5F0Z3DAV9')).toBe('rgb1qyfe883hey6jrgj2q4gzqh0dhtm5f0z3dav9');
  });
  it('rejects anything else', () => {
    expect(parseRgbContractId('')).toBeNull();
    expect(parseRgbContractId('rgb:short')).toBeNull();
    expect(parseRgbContractId('bc1qxyz')).toBeNull();
  });
});

describe('UTXOs', () => {
  const rgbLib = [
    { utxo: { outpoint: { txid: 'aa', vout: 0 }, btcAmount: 1000, colorable: true }, rgbAllocations: [], pendingBlinded: 0 },
    { utxo: { outpoint: { txid: 'bb', vout: 1 }, btcAmount: 1000, colorable: true }, rgbAllocations: [{}], pendingBlinded: 0 },
    { utxo: { outpoint: { txid: 'cc', vout: 2 }, btcAmount: 50000, colorable: false }, rgbAllocations: [], pendingBlinded: 0 },
  ];
  it('reads rgb-lib and node shapes alike', () => {
    expect(normalizeUnspents(rgbLib)[0]).toEqual({ outpoint: 'aa:0', sats: 1000, colorable: true, allocations: 0, pending: 0 });
    expect(normalizeUnspents({ unspents: [{ utxo: { outpoint: 'dd:3', btc_amount: 3000, colorable: true }, rgb_allocations: [], pending_blinded: 1 }] }))
      .toEqual([{ outpoint: 'dd:3', sats: 3000, colorable: true, allocations: 0, pending: 1 }]);
    expect(normalizeUnspents(undefined)).toEqual([]);
  });
  it('counts colorable and free UTXOs', () => {
    expect(utxoCounts(normalizeUnspents(rgbLib))).toEqual({ colorable: 2, free: 1 });
  });
  it('lists through the adapter method or the node operation', async () => {
    await expect(listRgbUtxos({ listUnspents: async () => rgbLib })).resolves.toHaveLength(3);
    const exec = jest.fn(async () => ({ unspents: [] }));
    await expect(listRgbUtxos({ executeProtocolOperation: exec })).resolves.toEqual([]);
    expect(exec).toHaveBeenCalledWith('listUnspents', { skip_sync: false });
  });
});

describe('rgbReceiveErrorMessage', () => {
  it('explains a missing UTXO, pointing Advanced users at the fix', () => {
    expect(rgbReceiveErrorMessage('InsufficientAllocationSlots', { advanced: true, onDevice: true })).toMatch(/^Your RGB wallet .*Create UTXOs under Advanced, or switch the invoice type to Witness/);
    expect(rgbReceiveErrorMessage('No uncolored UTXOs are available', { advanced: false, onDevice: false })).toMatch(/^Your RGB Lightning node .*or receive over Lightning\.$/);
    expect(rgbReceiveErrorMessage('timeout', { advanced: true, onDevice: true })).toBe('timeout');
  });
});
