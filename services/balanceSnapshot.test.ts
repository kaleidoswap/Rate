jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  clearBalanceSnapshots, hasBalanceSnapshot, loadBalanceSnapshot, parseSnapshot, saveBalanceSnapshot, snapshotWalletKey,
} from './balanceSnapshot';

const walletA = { id: 1, created_at: 100 };
const walletB = { id: 2, created_at: 200 };
const data = {
  byProtocol: { SPARK: { confirmed: 1000, unconfirmed: 0, total: 1000 } },
  assets: [{ asset_id: 'usdt', ticker: 'USDT', name: 'Tether', precision: 6, balance: { spendable: 5_000_000 }, protocol: 'RGB' }],
  channels: [{ local_balance_sat: 300, outbound_balance_msat: 300_000, ready: true, is_usable: true, peer_pubkey: 'x' } as any],
  btcPriceUSD: 100_000,
};

beforeEach(async () => { await AsyncStorage.clear(); });

test('a wallet gets back its own last balances', async () => {
  await saveBalanceSnapshot(walletA, data);
  const snap = await loadBalanceSnapshot(walletA);
  expect(snap?.byProtocol.SPARK.total).toBe(1000);
  expect(snap?.assets[0].ticker).toBe('USDT');
  expect(snap?.btcPriceUSD).toBe(100_000);
  // Channels keep only the balance fields.
  expect(snap?.channels[0]).toEqual({ local_balance_sat: 300, outbound_balance_msat: 300_000, ready: true, is_usable: true });
});

test('never shows another wallet\'s balances', async () => {
  await saveBalanceSnapshot(walletA, data);
  expect(await loadBalanceSnapshot(walletB)).toBeNull();
  // A new wallet that reuses a deleted wallet's id has a different creation time.
  expect(await loadBalanceSnapshot({ id: 1, created_at: 999 })).toBeNull();
  expect(await hasBalanceSnapshot(walletA)).toBe(true);
});

test('no wallet id, no snapshot', async () => {
  expect(snapshotWalletKey(null)).toBeNull();
  await saveBalanceSnapshot({}, data);
  expect(await loadBalanceSnapshot({})).toBeNull();
});

test('a damaged snapshot reads as none, and bad rows are dropped', () => {
  expect(parseSnapshot('{oops', '1:100')).toBeNull();
  expect(parseSnapshot(JSON.stringify({ walletKey: '2:200', savedAt: 1 }), '1:100')).toBeNull();
  const snap = parseSnapshot(JSON.stringify({
    walletKey: '1:100', savedAt: 1,
    byProtocol: { SPARK: { confirmed: 'x' }, ARKADE: { confirmed: 1, unconfirmed: 0, total: 1 } },
    assets: [null, { asset_id: 'a', ticker: 'A' }], channels: 'nope',
  }), '1:100');
  expect(Object.keys(snap!.byProtocol)).toEqual(['ARKADE']);
  expect(snap!.assets).toHaveLength(1);
  expect(snap!.channels).toEqual([]);
  expect(snap!.btcPriceUSD).toBe(0);
});

test('deleting a wallet forgets its snapshots only', async () => {
  await saveBalanceSnapshot(walletA, data);
  await saveBalanceSnapshot(walletB, data);
  await clearBalanceSnapshots(1);
  expect(await loadBalanceSnapshot(walletA)).toBeNull();
  expect(await loadBalanceSnapshot(walletB)).not.toBeNull();
});
