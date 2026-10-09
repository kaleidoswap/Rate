import {
  NO_RGB_WALLET_SUPPORT, canCancelRgbTransfer, findRgbTransfer, hasPendingRgbTransfers, isExpiredRgbInvoice,
  normalizeRgbTransfers, rgbTransferDirection, rgbTransferStatus, rgbTransfersSignature, rgbWalletErrorMessage,
  rgbWalletSupport, startPolling, toBaseUnits, validateRgbIssue, type RgbIssueInput, rgbReceiveStage, createUtxosEstimate,
  canDeleteRgbTransfer, rgbInvoiceWatch, validateRgbInflate, validateDrainAddress, normalizeRgbAssetMetadata,
} from './rgb-wallet';

const fn = () => jest.fn();

describe('rgbWalletSupport', () => {
  it('RGB on this phone does everything its bridge offers', () => {
    const device = {
      protocolName: 'RGB_L1', isConnected: () => true, listUnspents: fn(), createRgbUtxos: fn(), issueAssetNia: fn(), listTransfers: fn(),
      account: { issueAssetCfa: fn(), failTransfer: fn(), refreshTransfers: fn() },
    };
    expect(rgbWalletSupport(device)).toEqual({
      kind: 'device', listUtxos: true, createUtxos: true, issue: ['NIA', 'CFA'], issueMedia: true, inflate: false,
      listTransfers: true, refreshTransfers: true, cancelTransfer: true, deleteTransfer: false, metadata: false, drain: false,
    });
    expect(rgbWalletSupport({ ...device, account: null }).issue).toEqual(['NIA']);
    const full = { ...device, account: { ...device.account, capabilities: () => ({ metadata: true, issueUda: true, issueIfa: true, inflate: true, drain: true, deleteTransfers: true }) } };
    expect(rgbWalletSupport(full)).toMatchObject({ issue: ['NIA', 'CFA', 'UDA', 'IFA'], inflate: true, deleteTransfer: true, metadata: true, drain: true });
  });
  it('the node over NWC does what its connection advertises and never issues', () => {
    const nwc = { protocolName: 'RGB_LN', isConnected: () => true, walletType: () => 'rln', hasRlnMethod: (m: string) => m !== 'rln_create_utxos' };
    expect(rgbWalletSupport(nwc)).toEqual({
      ...NO_RGB_WALLET_SUPPORT, kind: 'nwc-node', listUtxos: true, listTransfers: true, refreshTransfers: true,
    });
    expect(rgbWalletSupport({ ...nwc, walletType: () => 'ln' })).toEqual(NO_RGB_WALLET_SUPPORT);
  });
  it('the node through the engine creates UTXOs only with privileged ops', () => {
    const node = { protocolName: 'RGB_LN', isConnected: () => true, executeProtocolOperation: fn(), createRgbUtxos: fn(), listTransfers: fn(), refreshBalances: fn() };
    expect(rgbWalletSupport(node)).toMatchObject({ kind: 'engine-node', listUtxos: true, createUtxos: false, issue: [], cancelTransfer: true, metadata: true, drain: false, deleteTransfer: false });
    expect(rgbWalletSupport({ ...node, allowPrivilegedOps: true }).createUtxos).toBe(true);
  });
  it('nothing when disconnected or missing', () => {
    expect(rgbWalletSupport(null)).toEqual(NO_RGB_WALLET_SUPPORT);
    expect(rgbWalletSupport({ protocolName: 'RGB_L1', isConnected: () => false })).toEqual(NO_RGB_WALLET_SUPPORT);
  });
});

describe('transfers', () => {
  it('maps every way a status is spelled', () => {
    expect(rgbTransferStatus('WaitingCounterparty')).toBe('waiting-counterparty');
    expect(rgbTransferStatus('WAITING_CONFIRMATIONS')).toBe('waiting-confirmations');
    expect(rgbTransferStatus('settled')).toBe('settled');
    expect(rgbTransferStatus('Failed')).toBe('failed');
    expect(rgbTransferStatus('Mystery')).toBeNull();
    expect(rgbTransferDirection('ReceiveWitness')).toBe('incoming');
    expect(rgbTransferDirection('RECEIVE_BLIND')).toBe('incoming');
    expect(rgbTransferDirection('Issuance')).toBe('issuance');
    expect(rgbTransferDirection('Send')).toBe('outgoing');
  });
  it('reads the bridge’s and the node’s transfer shapes', () => {
    const [device] = normalizeRgbTransfers([{ idx: 2, batch_transfer_idx: 7, kind: 'ReceiveWitness', status: 'WaitingConfirmations',
      requested_assignment: { type: 'FUNGIBLE', amount: 5, value: 5 }, assignments: [{ amount: 5 }], txid: 'tx', recipient_id: 'rid', created_at: 100 }]);
    expect(device).toEqual(expect.objectContaining({ idx: 2, batchTransferIdx: 7, status: 'waiting-confirmations', direction: 'incoming', amount: 5, txid: 'tx', recipientId: 'rid', createdAt: 100 }));
    const node = normalizeRgbTransfers({ transfers: [
      { idx: 1, kind: 'Send', status: 'Settled', assignments: [{ type: 'Fungible', value: 40 }, { type: 'Fungible', value: 2 }] },
      { idx: 3, kind: 'Send', status: '???' },
    ] });
    expect(node).toHaveLength(1);
    expect(node[0]).toEqual(expect.objectContaining({ amount: 42, direction: 'outgoing', batchTransferIdx: undefined }));
  });
  it('finds an invoice’s transfer and tells pending from done', () => {
    const list = normalizeRgbTransfers([
      { idx: 1, kind: 'ReceiveWitness', status: 'WaitingCounterparty', recipient_id: 'a' },
      { idx: 2, kind: 'Send', status: 'Settled', recipient_id: 'b' },
    ]);
    expect(findRgbTransfer(list, 'b')?.idx).toBe(2);
    expect(findRgbTransfer(list, undefined)).toBeUndefined();
    expect(hasPendingRgbTransfers(list)).toBe(true);
    expect(hasPendingRgbTransfers(list.slice(1))).toBe(false);
  });
  it('the signature changes when a status does', () => {
    const before = normalizeRgbTransfers([{ idx: 1, kind: 'Send', status: 'WaitingCounterparty' }]);
    const after = normalizeRgbTransfers([{ idx: 1, kind: 'Send', status: 'WaitingConfirmations', txid: 't' }]);
    expect(rgbTransfersSignature(before)).not.toBe(rgbTransfersSignature(after));
    expect(rgbTransfersSignature(before)).toBe(rgbTransfersSignature([...before]));
  });
  it('only a transfer waiting for its counterparty can be cancelled, where supported', () => {
    expect(canCancelRgbTransfer({ status: 'waiting-counterparty', batchTransferIdx: 3 }, { cancelTransfer: true })).toBe(true);
    expect(canCancelRgbTransfer({ status: 'waiting-confirmations', batchTransferIdx: 3 }, { cancelTransfer: true })).toBe(false);
    expect(canCancelRgbTransfer({ status: 'waiting-counterparty', batchTransferIdx: undefined }, { cancelTransfer: true })).toBe(false);
    expect(canCancelRgbTransfer({ status: 'waiting-counterparty', batchTransferIdx: 3 }, { cancelTransfer: false })).toBe(false);
  });
  it('an unused expired invoice is noise; a failed send is not', () => {
    expect(isExpiredRgbInvoice({ status: 'failed', direction: 'incoming', txid: undefined })).toBe(true);
    expect(isExpiredRgbInvoice({ status: 'failed', direction: 'outgoing', txid: undefined })).toBe(false);
    expect(isExpiredRgbInvoice({ status: 'failed', direction: 'incoming', txid: 'tx' })).toBe(false);
  });
});

describe('issuance', () => {
  const base: RgbIssueInput = { schema: 'NIA', ticker: 'test', name: 'Test Token', details: '', precision: '2', amount: '1,000.5' };

  it('converts amounts to base units at the asset’s precision', () => {
    expect(toBaseUnits('1,000.5', 2)).toBe(100050);
    expect(toBaseUnits('0.01', 2)).toBe(1);
    expect(toBaseUnits('.5', 1)).toBe(5);
    expect(toBaseUnits('21000000', 0)).toBe(21000000);
    expect(toBaseUnits('1.234', 2)).toBeNull();
    expect(toBaseUnits('0', 2)).toBeNull();
    expect(toBaseUnits('abc', 0)).toBeNull();
    expect(toBaseUnits('99999999999', 8)).toBeNull(); // beyond a safe integer
  });
  it('a valid NIA becomes a request with an uppercased ticker', () => {
    expect(validateRgbIssue(base)).toEqual({ errors: {}, request: { schema: 'NIA', ticker: 'TEST', name: 'Test Token', precision: 2, amounts: [100050] } });
  });
  it('a CFA needs no ticker and keeps its details', () => {
    const { request } = validateRgbIssue({ ...base, schema: 'CFA', ticker: '', details: ' Limited run ' });
    expect(request).toEqual({ schema: 'CFA', name: 'Test Token', details: 'Limited run', precision: 2, amounts: [100050] });
  });
  it('says what is wrong with each field', () => {
    const { errors, request } = validateRgbIssue({ schema: 'NIA', ticker: '1BAD', name: '', details: 'x'.repeat(256), precision: '19', amount: '' });
    expect(request).toBeUndefined();
    expect(Object.keys(errors).sort()).toEqual(['amount', 'details', 'name', 'precision', 'ticker']);
    expect(validateRgbIssue({ ...base, ticker: 'TOOLONGTICKER' }).errors.ticker).toMatch(/8 letters/);
    expect(validateRgbIssue({ ...base, amount: '1.234' }).errors.amount).toMatch(/At most 2 decimals/);
    expect(validateRgbIssue({ ...base, amount: '0' }).errors.amount).toMatch(/above zero/);
    expect(validateRgbIssue({ ...base, name: 'Ünïcode' }).errors.name).toMatch(/plain/);
  });
});

describe('rgbWalletErrorMessage', () => {
  it('never shows the raw error', () => {
    expect(rgbWalletErrorMessage(new Error('rgb-lib: InsufficientAllocationSlots'), 'issue')).toMatch(/free colorable UTXO/);
    expect(rgbWalletErrorMessage(new Error('InsufficientBitcoins { needed: 3000, available: 10 }'), 'utxos')).toMatch(/Not enough bitcoin/);
    expect(rgbWalletErrorMessage(new Error('CannotFailBatchTransfer'), 'cancel')).toMatch(/no longer be cancelled/);
    expect(rgbWalletErrorMessage(new Error('weird internal panic at 0x1'), 'issue')).toBe('The asset couldn’t be issued. Try again.');
  });
});

describe('startPolling', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());
  const flush = async () => { for (let i = 0; i < 5; i += 1) await Promise.resolve(); };

  it('runs after the delay, then every interval, until a tick says stop', async () => {
    let n = 0;
    const tick = jest.fn(async () => { n += 1; return n < 3; });
    startPolling({ tick, intervalMs: 1000, initialDelayMs: 500 });
    jest.advanceTimersByTime(499);
    expect(tick).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1); await flush();
    expect(tick).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(1000); await flush();
    jest.advanceTimersByTime(1000); await flush();
    expect(tick).toHaveBeenCalledTimes(3);
    jest.advanceTimersByTime(10_000); await flush();
    expect(tick).toHaveBeenCalledTimes(3);
  });
  it('never overlaps a slow tick and stops when told', async () => {
    let release: () => void = () => undefined;
    const tick = jest.fn(() => new Promise<boolean>((resolve) => { release = () => resolve(true); }));
    const stop = startPolling({ tick, intervalMs: 100 });
    jest.advanceTimersByTime(0); await flush();
    jest.advanceTimersByTime(1000); await flush();
    expect(tick).toHaveBeenCalledTimes(1);
    release(); await flush();
    jest.advanceTimersByTime(100); await flush();
    expect(tick).toHaveBeenCalledTimes(2);
    stop();
    release(); await flush();
    jest.advanceTimersByTime(1000); await flush();
    expect(tick).toHaveBeenCalledTimes(2);
  });
  it('keeps going after a failed tick', async () => {
    const tick = jest.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(false);
    startPolling({ tick, intervalMs: 100 });
    jest.advanceTimersByTime(0); await flush();
    jest.advanceTimersByTime(100); await flush();
    expect(tick).toHaveBeenCalledTimes(2);
  });
});

describe('rgbReceiveStage', () => {
  it('maps the invoice’s transfer to Receive’s stages', () => {
    expect(rgbReceiveStage(undefined).stage).toBe('watching');
    expect(rgbReceiveStage({ status: 'waiting-counterparty' }).stage).toBe('watching');
    expect(rgbReceiveStage({ status: 'waiting-confirmations' }).stage).toBe('pending');
    expect(rgbReceiveStage({ status: 'settled' }).stage).toBe('confirmed');
    expect(rgbReceiveStage({ status: 'failed', expiration: 100 }, 200).stage).toBe('expired');
    expect(rgbReceiveStage({ status: 'failed', expiration: 300 }, 200).stage).toBe('failed');
  });
});

describe('createUtxosEstimate', () => {
  it('adds the outputs and a fee, and checks the plain bitcoin covers it', () => {
    expect(createUtxosEstimate({ num: 3, size: 3000, feeRate: 2 })).toEqual({ feeSats: 478, totalSats: 9478, enough: true });
    expect(createUtxosEstimate({ num: 3, size: 3000, feeRate: 2, bitcoinSats: 9000 }).enough).toBe(false);
    expect(createUtxosEstimate({ num: 1, size: 1000, feeRate: 1.5, bitcoinSats: 5000 })).toEqual({ feeSats: 230, totalSats: 1230, enough: true });
  });
});

describe('wallet tools', () => {
  it('only a failed transfer with a batch can be removed, where supported', () => {
    expect(canDeleteRgbTransfer({ status: 'failed', batchTransferIdx: 2 }, { deleteTransfer: true })).toBe(true);
    expect(canDeleteRgbTransfer({ status: 'settled', batchTransferIdx: 2 }, { deleteTransfer: true })).toBe(false);
    expect(canDeleteRgbTransfer({ status: 'failed', batchTransferIdx: 2 }, { deleteTransfer: false })).toBe(false);
  });
  it('an invoice is followed by its transfer where transfers are listed, else by balance', () => {
    expect(rgbInvoiceWatch({ recipient_id: 'rid' }, { listTransfers: true })).toEqual({ monitor: 'rgb-transfer', recipientId: 'rid' });
    expect(rgbInvoiceWatch({ recipientId: 'rid' }, { listTransfers: false })).toEqual({ monitor: 'balance' });
    expect(rgbInvoiceWatch({}, { listTransfers: true }, 'none')).toEqual({ monitor: 'none' });
  });
  it('inflation stays within the rights', () => {
    expect(validateRgbInflate('1.5', 2, 1000)).toEqual({ amount: 150 });
    expect(validateRgbInflate('20', 2, 1000).error).toMatch(/inflation rights/);
    expect(validateRgbInflate('0.001', 2, 1000).error).toMatch(/2 decimals/);
  });
  it('a drain goes to a bitcoin address on the account’s network', () => {
    expect(validateDrainAddress('', null, 'mainnet')).toMatch(/Enter/);
    expect(validateDrainAddress('nope', null, 'mainnet')).toMatch(/isn’t a bitcoin address/);
    expect(validateDrainAddress('tb1q', ['signet', 'mutinynet'], 'mainnet')).toMatch(/mainnet/);
    expect(validateDrainAddress('tb1q', ['signet', 'mutinynet'], 'mutinynet')).toBeNull();
  });
  it('metadata from the node or the bridge reads the same; IFA keeps its maximum', () => {
    expect(normalizeRgbAssetMetadata({ asset_schema: 'Ifa', ticker: 'INF', precision: 2, initial_supply: 10, known_circulating_supply: 15, max_supply: 100, timestamp: 9 }))
      .toEqual({ schema: 'IFA', ticker: 'INF', name: undefined, precision: 2, issuedSupply: 15, maxSupply: 100, details: undefined, timestamp: 9 });
    expect(normalizeRgbAssetMetadata({ assetSchema: 'UDA', media: { filePath: 'file:///x', mime: 'video/mp4' } }).media).toEqual({ uri: 'file:///x', mime: 'video/mp4', isImage: false });
    expect(normalizeRgbAssetMetadata(null)).toEqual({});
  });
});

describe('UDA and IFA issuance', () => {
  const base = { ticker: 'NFT', name: 'One', details: '', precision: '4', amount: '' };
  it('a UDA is one unit, needs a ticker, and may carry an image', () => {
    expect(validateRgbIssue({ schema: 'UDA', ...base, mediaPath: 'file:///a.png' }).request)
      .toEqual({ schema: 'UDA', ticker: 'NFT', name: 'One', precision: 0, amounts: [1], mediaPath: 'file:///a.png' });
    expect(validateRgbIssue({ schema: 'UDA', ...base, ticker: '' }).errors.ticker).toBeDefined();
  });
  it('an IFA needs how much more may be issued later', () => {
    const ifa = { schema: 'IFA' as const, ticker: 'INF', name: 'Inf', details: '', precision: '2', amount: '10' };
    expect(validateRgbIssue(ifa).errors.inflation).toMatch(/more may be issued/);
    expect(validateRgbIssue({ ...ifa, inflation: '5.5' }).request).toEqual({ schema: 'IFA', ticker: 'INF', name: 'Inf', precision: 2, amounts: [1000], inflationAmounts: [550] });
    expect(validateRgbIssue({ ...ifa, inflation: '0.001' }).errors.inflation).toMatch(/2 decimals/);
  });
  it('NIA ignores an image', () => {
    expect(validateRgbIssue({ schema: 'NIA', ticker: 'T', name: 'T', details: '', precision: '0', amount: '1', mediaPath: '/a.png' }).request).not.toHaveProperty('mediaPath');
  });
});
