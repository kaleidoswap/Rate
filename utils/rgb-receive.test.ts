import {
  ANY_RGB_ASSET_ID, DEFAULT_RGB_RECEIVE_OPTIONS, NO_RGB_RECEIVE_SUPPORT, RGB_COLLECTIBLE_RECEIVE_AMOUNT_ERROR, listRgbUtxos, normalizeUnspents,
  rgbInvoiceParams, rgbReceiveErrorMessage, rgbReceiveSupport, rgbReceiveUsesProxyV1, utxoCounts, classifyUtxo, summarizeUtxos,
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
    expect(rgbReceiveSupport(nwcNode)).toEqual({ invoiceKind: true, expiry: true, minConfirmations: true, listUtxos: false, createUtxos: false });
  });
  it('the node over NWC lists and creates UTXOs only when its connection advertises those methods', () => {
    const advertised = { ...nwcNode, hasRlnMethod: (m: string) => m === 'rln_list_unspents' };
    expect(rgbReceiveSupport(advertised)).toMatchObject({ invoiceKind: true, listUtxos: true, createUtxos: false });
  });
  it('no adapter, no options', () => {
    expect(rgbReceiveSupport(null)).toEqual(NO_RGB_RECEIVE_SUPPORT);
  });
  it('uses proxy v1 only for an active native bridge with BFA support', () => {
    const nativeSupportsBfa = jest.fn(() => true);
    expect(rgbReceiveUsesProxyV1(nwcNode, nativeSupportsBfa)).toBe(false);
    expect(rgbReceiveUsesProxyV1(null, nativeSupportsBfa)).toBe(false);
    expect(nativeSupportsBfa).not.toHaveBeenCalled();
    expect(rgbReceiveUsesProxyV1(onDevice, nativeSupportsBfa)).toBe(true);
    expect(rgbReceiveUsesProxyV1(onDevice, () => false)).toBe(false);
    expect(rgbReceiveUsesProxyV1(onDevice, () => { throw new Error('Missing native module'); })).toBe(false);
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
  it('includes exact base units only for a specific asset', () => {
    const invoice = { amount: 1_250_000, expirySeconds: 3600 };
    expect(rgbInvoiceParams({ ...invoice, assetId: 'rgb:abc' })).toMatchObject({ asset_id: 'rgb:abc', amount: 1_250_000 });
    expect(rgbInvoiceParams({ ...invoice, assetId: ANY_RGB_ASSET_ID })).toEqual({ min_confirmations: 1, duration_seconds: 3600 });
  });
  it('rejects invalid fixed amounts before creating the invoice', () => {
    expect(() => rgbInvoiceParams({ assetId: 'rgb:abc', amount: 1.25, expirySeconds: 3600 })).toThrow('positive integer');
  });
  it('drops what the account does not support', () => {
    const options = { kind: 'blinded' as const, durationSeconds: 600, minConfirmations: 6 };
    expect(rgbInvoiceParams({ assetId: ANY_RGB_ASSET_ID, expirySeconds: 3600, options, support: rgbReceiveSupport(nwcNode) }))
      .toEqual({ min_confirmations: 6, duration_seconds: 600, witness: false });
    expect(rgbInvoiceParams({ assetId: ANY_RGB_ASSET_ID, expirySeconds: 3600, options }))
      .toEqual({ min_confirmations: 1, duration_seconds: 3600 });
  });
  it('raises both remembered and explicit short proxy v1 expiries to a usable duration', () => {
    const request = { assetId: ANY_RGB_ASSET_ID, expirySeconds: 600, support: ALL };
    const options = { kind: 'blinded' as const, durationSeconds: 600, minConfirmations: 3 };
    expect(rgbInvoiceParams({ ...request, proxyV1: true })).toMatchObject({ duration_seconds: 1800 });
    expect(rgbInvoiceParams({ ...request, options, proxyV1: true })).toEqual({
      duration_seconds: 1800, min_confirmations: 3, witness: false,
    });
    expect(rgbInvoiceParams({ ...request, options })).toMatchObject({ duration_seconds: 600 });
  });
});

describe('UTXOs', () => {
  const rgbLib = [
    { utxo: { outpoint: { txid: 'aa', vout: 0 }, btcAmount: 1000, colorable: true }, rgbAllocations: [], pendingBlinded: 0 },
    { utxo: { outpoint: { txid: 'bb', vout: 1 }, btcAmount: 1000, colorable: true }, rgbAllocations: [{}], pendingBlinded: 0 },
    { utxo: { outpoint: { txid: 'cc', vout: 2 }, btcAmount: 50000, colorable: false }, rgbAllocations: [], pendingBlinded: 0 },
  ];
  it('reads rgb-lib and node shapes alike', () => {
    expect(normalizeUnspents(rgbLib)[0]).toEqual({ outpoint: 'aa:0', sats: 1000, colorable: true, allocations: 0, pending: 0, assets: [] });
    expect(normalizeUnspents({ unspents: [{ utxo: { outpoint: 'dd:3', btc_amount: 3000, colorable: true }, rgb_allocations: [], pending_blinded: 1 }] }))
      .toEqual([{ outpoint: 'dd:3', sats: 3000, colorable: true, allocations: 0, pending: 1, assets: [] }]);
    expect(normalizeUnspents(undefined)).toEqual([]);
  });
  it('counts colorable and free UTXOs', () => {
    expect(utxoCounts(normalizeUnspents(rgbLib))).toEqual({ colorable: 2, free: 1 });
  });
  it('reads each allocation’s asset and amount from rgb-lib and the node', () => {
    const [u] = normalizeUnspents([{ utxo: { outpoint: 'ee:0', btcAmount: 1000, colorable: true },
      rgbAllocations: [{ assetId: 'rgb:usdt', assignment: { type: 'FUNGIBLE', amount: 250 }, settled: false }] }]);
    expect(u.assets).toEqual([{ assetId: 'rgb:usdt', amount: 250, settled: false }]);
    const [n] = normalizeUnspents({ unspents: [{ utxo: { outpoint: 'ff:0', btc_amount: 3000, colorable: true },
      rgb_allocations: [{ asset_id: 'rgb:usdt', assignment: { type: 'Fungible', value: 9 }, settled: true }] }] });
    expect(n.assets).toEqual([{ assetId: 'rgb:usdt', amount: 9, settled: true }]);
  });
  it('classifies UTXOs: holding assets, free to receive, or plain bitcoin', () => {
    expect(classifyUtxo({ colorable: true, allocations: 1, pending: 0 })).toBe('colored');
    expect(classifyUtxo({ colorable: true, allocations: 0, pending: 1 })).toBe('colored');
    expect(classifyUtxo({ colorable: true, allocations: 0, pending: 0 })).toBe('free');
    expect(classifyUtxo({ colorable: false, allocations: 0, pending: 0 })).toBe('bitcoin');
    const summary = summarizeUtxos(normalizeUnspents(rgbLib));
    expect([summary.colored.length, summary.free.length, summary.bitcoin.length, summary.bitcoinSats]).toEqual([1, 1, 1, 50000]);
  });
  it('lists through the adapter method or the node operation', async () => {
    await expect(listRgbUtxos({ listUnspents: async () => rgbLib })).resolves.toHaveLength(3);
    const exec = jest.fn(async () => ({ unspents: [] }));
    await expect(listRgbUtxos({ executeProtocolOperation: exec })).resolves.toEqual([]);
    expect(exec).toHaveBeenCalledWith('listUnspents', { skip_sync: false });
  });
});

describe('rgbReceiveErrorMessage', () => {
  it('explains a missing receive slot and how to receive with a blinded invoice', () => {
    expect(rgbReceiveErrorMessage('InsufficientAllocationSlots', { advanced: true, onDevice: true })).toMatch(/^Your RGB wallet .*Create receive slots, or switch to a Standard invoice/);
    expect(rgbReceiveErrorMessage('No uncolored UTXOs are available', { advanced: false, onDevice: false })).toMatch(/^Your RGB Lightning node .*or receive over Lightning\.$/);
    expect(rgbReceiveErrorMessage('timeout', { advanced: true, onDevice: true })).toMatch(/network|timeout/i);
  });
  it('preserves the amount correction for a collectible', () => {
    expect(rgbReceiveErrorMessage(RGB_COLLECTIBLE_RECEIVE_AMOUNT_ERROR, { advanced: false, onDevice: true }))
      .toBe(RGB_COLLECTIBLE_RECEIVE_AMOUNT_ERROR);
  });
});
