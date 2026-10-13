import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Wallet, ExitPackage, ExitQuote, NetworkName, ExecutorEvent } from '@arkade-os/sdk';
import { arkadeScope } from './arkadeJournal';

export interface ExitRecord { package: ExitPackage; started: boolean; completed: boolean; updatedAt: number; event?: Pick<ExecutorEvent, 'stepIndex' | 'status' | 'maturesAtHeight' | 'maturesAtTime'> }
export interface ExitPreview { quote: ExitQuote; destination: string; excludedAssets: number }
const approvals = new WeakMap<ExitPreview, { wallet: Wallet; options: any; at: number }>();
const running = new WeakSet<Wallet>();
const pausedRenewal = new WeakSet<Wallet>();
export const arkadeRenewalPaused = (wallet: Wallet) => pausedRenewal.has(wallet);
const key = async (wallet: Wallet) => `${await arkadeScope(wallet)}:exit`;
export async function readArkadeExit(wallet: Wallet): Promise<ExitRecord | undefined> {
  const json = await AsyncStorage.getItem(await key(wallet));
  if (!json) return undefined;
  const record = JSON.parse(json);
  const sdk = require('@arkade-os/sdk') as typeof import('@arkade-os/sdk');
  record.package = sdk.deserializeExitPackage(JSON.stringify(record.package));
  if (typeof record.started !== 'boolean' || typeof record.completed !== 'boolean') throw new Error('Unreadable Arkade exit record.');
  return record;
}
async function save(wallet: Wallet, record: ExitRecord) { await AsyncStorage.setItem(await key(wallet), JSON.stringify(record)); }
export async function assertNoArkadeExit(wallet: Wallet) {
  const record = await readArkadeExit(wallet);
  if (record?.started && !record.completed) throw new Error('An emergency exit is in progress. Resume it in Arkade settings before spending these funds.');
}
export async function prepareArkadeExitPreview(wallet: Wallet, network: NetworkName, destination: string): Promise<ExitPreview> {
  const sdk = require('@arkade-os/sdk') as typeof import('@arkade-os/sdk');
  await assertNoArkadeExit(wallet);
  const { Address, NETWORK, TEST_NETWORK } = require('@scure/btc-signer') as typeof import('@scure/btc-signer');
  destination = destination.trim();
  try { Address(network === 'bitcoin' ? NETWORK : network === 'regtest' ? { ...TEST_NETWORK, bech32: 'bcrt' } : TEST_NETWORK).decode(destination); }
  catch { throw new Error('Enter a valid Bitcoin destination for this network.'); }
  const onchainWallet = await sdk.OnchainWallet.create(wallet.identity, network, wallet.onchainProvider);
  const all = await wallet.getVtxos();
  // The SDK exit transport carries BTC only; never destroy an asset-bearing VTXO.
  const coins = all.filter(v => !v.isUnrolled && !sdk.hasTerminalSpend(v) && !(v.assets?.length));
  if (!coins.length) throw new Error('No BTC-only VTXOs available for an emergency exit.');
  const options = { wallet, onchainWallet, sweepAddress: destination, mode: 'graph' as const, networkName: network, vtxos: coins.map(({ txid, vout }) => ({ txid, vout })) };
  const estimate = await sdk.UnilateralExit.estimate(options);
  const fundingBalance = await onchainWallet.getBalance();
  const quote = { ...estimate, fundingAddress: onchainWallet.address, currentBalanceSats: fundingBalance, shortfallSats: Math.max(0, estimate.totals.fundingRequiredSats - fundingBalance) };
  if (!quote.vtxos.some(v => !v.skipped)) throw new Error('No eligible VTXOs. Inspect expiry and recovery first.');
  const preview = { quote, destination, excludedAssets: all.filter(v => !!v.assets?.length).length };
  approvals.set(preview, { wallet, options: { ...options, feeRate: quote.feeRate }, at: Date.now() });
  return preview;
}
/** Graph mode signs a recovery package; unlike funded mode it broadcasts nothing. */
export async function saveArkadeExitPackage(wallet: Wallet, preview: ExitPreview): Promise<ExitRecord> {
  if (running.has(wallet)) throw new Error('An exit operation is already running.');
  running.add(wallet);
  try {
  const approval = approvals.get(preview);
  if (!approval || approval.wallet !== wallet || Date.now() - approval.at > 120000) throw new Error('Refresh the exit estimate before continuing.');
  await assertNoArkadeExit(wallet);
  approvals.delete(preview);
  const sdk = require('@arkade-os/sdk') as typeof import('@arkade-os/sdk');
  const pkg = await sdk.UnilateralExit.prepare(approval.options);
  if (pkg.sweepAddress !== preview.destination) throw new Error('The exit destination changed.');
  if (pkg.totals.totalFeeSats > preview.quote.totals.totalFeeSats || pkg.totals.recoveredSats < preview.quote.totals.recoveredSats) throw new Error('Exit costs changed. Refresh the estimate.');
  if (pkg.mode !== 'graph') throw new Error('Unexpected exit package mode.');
  const record = { package: pkg, started: false, completed: false, updatedAt: Date.now() };
  await save(wallet, record); return record;
  } finally { running.delete(wallet); }
}
export async function resumeArkadeExit(wallet: Wallet, signal: AbortSignal, onEvent: (record: ExitRecord) => void): Promise<void> {
  if (running.has(wallet)) throw new Error('Exit already running.');
  running.add(wallet);
  try {
    if (signal.aborted) throw new Error('Exit paused.');
    let record = await readArkadeExit(wallet);
    if (!record || record.completed) throw new Error('No pending exit package.');
    const sdk = require('@arkade-os/sdk') as typeof import('@arkade-os/sdk');
    if (!record.started) {
      const current = await wallet.getVtxos();
      const included = record.package.vtxos.filter(v => !v.skipped);
      if (!included.length || included.some(v => !current.some(c => `${c.txid}:${c.vout}` === v.outpoint && !c.assets?.length && !c.isUnrolled && !sdk.hasTerminalSpend(c)))) throw new Error('VTXOs changed. Regenerate the exit backup before starting.');
    }
    const feeWallet = await sdk.OnchainWallet.create(wallet.identity, record.package.network, wallet.onchainProvider);
    const confirmedFunding = (await feeWallet.getCoins()).filter(c => c.status.confirmed).reduce((sum, c) => sum + c.value, 0);
    if (!record.started && confirmedFunding < record.package.totals.fundingRequiredSats) throw new Error(`Insufficient confirmed BTC for fees. Fund this address and wait for confirmation: ${feeWallet.address}`);
    // Stop local renewal before broadcasting; resumption after reconnect also stops it.
    await (await wallet.getVtxoManager()).dispose();
    pausedRenewal.add(wallet);
    if (signal.aborted) throw new Error('Exit paused.');
    record = { ...record, started: true, updatedAt: Date.now() }; await save(wallet, record);
    const executor = await sdk.UnilateralExit.execute(wallet, record.package, { feeWallet, signal });
    let failed = false;
    for await (const event of executor) {
      if (event.status === 'failed') failed = true;
      record = { ...record, updatedAt: Date.now(), event: { stepIndex: event.stepIndex, status: event.status, maturesAtHeight: event.maturesAtHeight, maturesAtTime: event.maturesAtTime } };
      await save(wallet, record); onEvent(record);
    }
    if (signal.aborted || failed) throw new Error('Exit paused or incomplete. Resume to check the blockchain again.');
    record = { ...record, completed: true, updatedAt: Date.now() }; await save(wallet, record); onEvent(record);
  } finally { running.delete(wallet); }
}
/** Install before connecting. Prevent ordinary spends while a persisted exit is in progress. */
export function withArkadeExitGuard<T>(adapter: T): T {
  const a = adapter as any;
  for (const name of ['sendPayment', 'sendAsset', 'sendBtcOnchain', 'offboard', 'onboard', 'runVtxoLifecycle']) {
    if (typeof a[name] !== 'function') continue;
    const original = a[name].bind(a);
    a[name] = async (...args: any[]) => { await assertNoArkadeExit(a.rawWallet); return original(...args); };
  }
  const connect = a.connect?.bind(a);
  if (connect) a.connect = async (...args: any[]) => {
    const result = await connect(...args);
    const record = await readArkadeExit(a.rawWallet);
    if (record?.started && !record.completed) { await (await a.rawWallet.getVtxoManager()).dispose(); pausedRenewal.add(a.rawWallet); }
    return result;
  };
  return adapter;
}

export async function shareArkadeExitPackage(record: ExitRecord): Promise<void> {
  const FileSystem = require('expo-file-system/legacy') as typeof import('expo-file-system/legacy');
  const Sharing = require('expo-sharing') as typeof import('expo-sharing');
  if (!FileSystem.cacheDirectory || !await Sharing.isAvailableAsync()) throw new Error('File sharing is unavailable.');
  const path = `${FileSystem.cacheDirectory}arkade-exit-${Date.now()}.json`;
  await FileSystem.writeAsStringAsync(path, JSON.stringify(record.package, null, 2));
  try { await Sharing.shareAsync(path, { mimeType: 'application/json', dialogTitle: 'Arkade recovery package' }); }
  finally { await FileSystem.deleteAsync(path, { idempotent: true }); }
}
