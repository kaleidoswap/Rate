import AsyncStorage from '@react-native-async-storage/async-storage';
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
import { maintainArkade, readArkadeHealth } from './arkadeMaintenance';
import { arkadeLifecycleConfig } from './arkadeLifecycleConfig';
const mockDelegate = { getDelegateInfo: jest.fn(), delegate: jest.fn() };
const mockManager = { getExpiringVtxos: jest.fn(), getRecoverableBalance: jest.fn(), renewVtxos: jest.fn(), recoverVtxos: jest.fn() };
let mockWallet: any;
jest.mock('./index', () => ({ protocolManager: { getAdapterIfAvailable: () => ({ isConnected: () => true, rawWallet: mockWallet, delegationEnabled: true, storagePersistent: true }) } }));
jest.mock('@arkade-os/sdk', () => ({
  hasTerminalSpend: (v: any) => !!(v.isSpent || v.spentBy || v.settledBy),
  ArkAddress: { decode: () => ({ hrp: 'ark', serverPubKey: new Uint8Array([1]) }) },
  toXOnlySignerHex: (s: string) => s, classifyContractSigner: () => ({ status: 'CURRENT' }),
  DelegateContractHandler: { deserializeParams: (p: any) => p },
}));
const coin = { txid: 'coin', vout: 0, value: 2000, virtualStatus: { state: 'settled', batchExpiry: Date.now() + 10000 } };
beforeEach(() => {
  jest.clearAllMocks();
  void AsyncStorage.clear();
  mockManager.getExpiringVtxos.mockResolvedValue([coin]);
  mockManager.getRecoverableBalance.mockResolvedValue({ recoverable: 20n, subdust: 1n });
  mockDelegate.getDelegateInfo.mockResolvedValue({ pubkey: '01', fee: '0', delegateAddress: 'ark1' });
  mockDelegate.delegate.mockResolvedValue({ delegated: [coin], failed: [] });
  mockWallet = { identity: { xOnlyPublicKey: async () => new Uint8Array([1]) }, getBalance: async () => ({ available: 2000, total: 2020 }), getVtxoManager: async () => mockManager, getVtxos: async () => [coin, { ...coin, settledBy: 'spent' }], getDelegateManager: async () => mockDelegate, arkProvider: { serverUrl: 'https://ark.example', getInfo: async () => ({ network: 'bitcoin' }) }, getAddress: async () => 'own-address', getContractManager: async () => ({ getContractsWithVtxos: async () => [
    { contract: { params: { delegatePubKey: new Uint8Array([1]) } }, vtxos: [coin, { ...coin, isSpent: true }] },
    { contract: { params: { delegatePubKey: new Uint8Array([2]) } }, vtxos: [{ ...coin, txid: 'other' }] },
  ] }) };
});
test('official defaults are isolated by operator and preserve explicit opt-out', () => {
  expect(arkadeLifecycleConfig('mainnet', 'https://arkade.computer').delegationEnabled).toBe(true);
  expect(arkadeLifecycleConfig('signet', 'https://arkade.computer').delegationEnabled).toBe(false);
  expect(arkadeLifecycleConfig('mainnet', 'https://custom.example').delegatorUrl).toBeUndefined();
  expect(arkadeLifecycleConfig('mainnet', 'https://arkade.computer', { arkadeConfig: { delegationEnabled: false } }).delegationEnabled).toBe(false);
});
test('health excludes spent coins and only explicit acknowledgements count as verified', async () => {
  expect(await readArkadeHealth()).toMatchObject({ count: 1, eligible: 1, verified: 0, recoverable: '20' });
  await maintainArkade('delegate', jest.fn());
  expect(mockDelegate.delegate).toHaveBeenCalledWith([coin], 'own-address');
  expect((await readArkadeHealth()).verified).toBe(1);
});
test('changed fee never silently submits manual delegation', async () => {
  mockDelegate.getDelegateInfo.mockResolvedValue({ pubkey: '01', fee: '10', delegateAddress: 'ark1' });
  await expect(maintainArkade('delegate', jest.fn())).rejects.toThrow('charges a fee');
  expect(mockDelegate.delegate).not.toHaveBeenCalled();
});
test('partial delegation preserves acknowledged coverage and reports failure', async () => {
  mockDelegate.delegate.mockResolvedValue({ delegated: [coin], failed: [{ outpoints: [], error: 'offline' }] });
  await expect(maintainArkade('delegate', jest.fn())).rejects.toThrow('Some VTXOs');
  expect((await readArkadeHealth()).verified).toBe(1);
});
test('concurrent mutations are blocked until settlement finishes', async () => {
  let finish!: (id: string) => void; let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  mockManager.renewVtxos.mockImplementation(() => new Promise(resolve => { finish = resolve; started(); }));
  const first = maintainArkade('renew', jest.fn());
  await expect(maintainArkade('recover', jest.fn())).rejects.toThrow('already in progress');
  await ready; finish('tx'); await expect(first).resolves.toBe('tx');
});
test('read failures are not presented as an empty wallet', async () => {
  mockManager.getRecoverableBalance.mockRejectedValueOnce(new Error('offline'));
  await expect(readArkadeHealth()).rejects.toThrow('offline');
});

test('delegation receipts survive restart, stay scoped to identity and exclude replaced VTXOs', async () => {
  await maintainArkade('delegate', jest.fn());
  mockWallet = { ...mockWallet };
  expect((await readArkadeHealth()).verified).toBe(1);
  mockWallet = { ...mockWallet, identity: { xOnlyPublicKey: async () => new Uint8Array([2]) } };
  expect((await readArkadeHealth()).verified).toBe(0);
  mockWallet = { ...mockWallet, identity: { xOnlyPublicKey: async () => new Uint8Array([1]) }, getContractManager: async () => ({ getContractsWithVtxos: async () => [] }) };
  expect((await readArkadeHealth()).verified).toBe(0);
});
