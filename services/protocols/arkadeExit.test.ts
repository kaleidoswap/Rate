import AsyncStorage from '@react-native-async-storage/async-storage';
import { assertNoArkadeExit, prepareArkadeExitPreview, saveArkadeExitPackage, resumeArkadeExit, readArkadeExit } from './arkadeExit';
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
const mockFunding = jest.fn();
const mockEstimate = jest.fn(); const mockPrepare = jest.fn(); const mockExecute = jest.fn();
jest.mock('@arkade-os/sdk', () => ({
  hasTerminalSpend: (v: any) => !!v.isSpent,
  OnchainWallet: { create: async () => ({ address: 'bc1-own-wallet', getBalance: async () => 1000, getCoins: () => mockFunding() }) },
  deserializeExitPackage: (json: string) => JSON.parse(json),
  UnilateralExit: { estimate: (...args: any[]) => mockEstimate(...args), prepare: (...args: any[]) => mockPrepare(...args), execute: (...args: any[]) => mockExecute(...args) },
}));
const mockDispose = jest.fn();
const coin = { txid: 'coin', vout: 0, value: 1000 };
let wallet: any;
const totals = { totalFeeSats: 100, recoveredSats: 900, fundingRequiredSats: 100, txCount: 2 };
const pkg: any = { version: 1, mode: 'graph', network: 'bitcoin', sweepAddress: '1BoatSLRHtKNngkdXEeobR76b53LETtpyT', totals, vtxos: [{ outpoint: 'coin:0' }], steps: [] };
beforeEach(async () => {
  await AsyncStorage.clear(); jest.clearAllMocks();
  mockFunding.mockResolvedValue([{ value: 1000, status: { confirmed: true } }]);
  wallet = { identity: { xOnlyPublicKey: async () => new Uint8Array([1]) }, arkProvider: { serverUrl: 'https://ark.example' }, getVtxoManager: async () => ({ dispose: mockDispose }), getVtxos: async () => [coin, { ...coin, txid: 'token', assets: [{}] }] };
  mockEstimate.mockResolvedValue({ totals, vtxos: pkg.vtxos, feeRate: 1 }); mockPrepare.mockResolvedValue(pkg);
  mockExecute.mockResolvedValue((async function* () { yield { stepIndex: 0, status: 'confirmed' }; })());
});
test('quote excludes asset VTXOs and backup prepares graph mode without execution', async () => {
  const preview = await prepareArkadeExitPreview(wallet, 'bitcoin', '1BoatSLRHtKNngkdXEeobR76b53LETtpyT');
  expect(preview.excludedAssets).toBe(1);
  expect(mockEstimate).toHaveBeenCalledWith(expect.objectContaining({ mode: 'graph', vtxos: [{ txid: 'coin', vout: 0 }] }));
  await saveArkadeExitPackage(wallet, preview); expect(mockExecute).not.toHaveBeenCalled();
  await expect(assertNoArkadeExit(wallet)).resolves.toBeUndefined();
});
test('refuses changed inputs before broadcasting', async () => {
  await saveArkadeExitPackage(wallet, await prepareArkadeExitPreview(wallet, 'bitcoin', '1BoatSLRHtKNngkdXEeobR76b53LETtpyT'));
  wallet.getVtxos = async () => [];
  await expect(resumeArkadeExit(wallet, new AbortController().signal, jest.fn())).rejects.toThrow('VTXOs changed');
  expect(mockExecute).not.toHaveBeenCalled();
});
test('pauses renewal, persists exit and marks completed only after executor completion', async () => {
  await saveArkadeExitPackage(wallet, await prepareArkadeExitPreview(wallet, 'bitcoin', '1BoatSLRHtKNngkdXEeobR76b53LETtpyT'));
  await resumeArkadeExit(wallet, new AbortController().signal, jest.fn());
  expect(mockDispose).toHaveBeenCalled(); expect((await readArkadeExit(wallet))?.completed).toBe(true);
});
test('failed execution retains the lock and can be resumed, never reports success', async () => {
  await saveArkadeExitPackage(wallet, await prepareArkadeExitPreview(wallet, 'bitcoin', '1BoatSLRHtKNngkdXEeobR76b53LETtpyT'));
  mockExecute.mockResolvedValue((async function* () { yield { stepIndex: 0, status: 'failed' }; })());
  await expect(resumeArkadeExit(wallet, new AbortController().signal, jest.fn())).rejects.toThrow('incomplete');
  await expect(assertNoArkadeExit(wallet)).rejects.toThrow('in progress');
  expect((await readArkadeExit(wallet))?.completed).toBe(false);
});
test('a quote cannot authorize a different wallet', async () => {
  const preview = await prepareArkadeExitPreview(wallet, 'bitcoin', '1BoatSLRHtKNngkdXEeobR76b53LETtpyT');
  await expect(saveArkadeExitPackage({ ...wallet }, preview)).rejects.toThrow('Refresh');
  expect(mockPrepare).not.toHaveBeenCalled();
});

test('unconfirmed fee funding does not start or lock an exit', async () => {
  await saveArkadeExitPackage(wallet, await prepareArkadeExitPreview(wallet, 'bitcoin', '1BoatSLRHtKNngkdXEeobR76b53LETtpyT'));
  mockFunding.mockResolvedValue([{ value: 1000, status: { confirmed: false } }]);
  await expect(resumeArkadeExit(wallet, new AbortController().signal, jest.fn())).rejects.toThrow('Insufficient confirmed BTC');
  expect(mockExecute).not.toHaveBeenCalled();
  await expect(assertNoArkadeExit(wallet)).resolves.toBeUndefined();
});
