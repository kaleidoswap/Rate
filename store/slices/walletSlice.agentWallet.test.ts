const mockOrder: string[] = [];
jest.mock('../../services/agentWallet/lifecycle', () => ({ closeAgentWallet: jest.fn(async () => { mockOrder.push('close-agent'); }) }));
jest.mock('../../services/protocols', () => ({ protocolManager: { disconnectAll: jest.fn(async () => {}) }, rgbAccountAdapter: jest.fn(), initializeProtocols: jest.fn(async () => new Map()) }));
jest.mock('../../services/balanceSnapshot', () => ({
  ...jest.requireActual('../../services/balanceSnapshot'), clearBalanceSnapshots: jest.fn(async () => {}),
}));
jest.mock('../../services/DatabaseService', () => ({
  __esModule: true,
  default: { getInstance: () => ({
    setActiveWallet: async () => { mockOrder.push('set-active'); },
    getActiveWallet: async () => null,
    deleteWallet: async () => { mockOrder.push('delete'); },
  }) },
}));

import walletReducer, { deleteWallet, loadBtcBalance, setActiveWallet, setBtcBalance, setWalletPortfolio, switchWallet } from './walletSlice';
import type { WalletRecord } from '../../services/DatabaseService';

const run = (thunk: any) => thunk(jest.fn(), () => ({}), undefined);

beforeEach(() => { mockOrder.length = 0; });

test('switching wallets closes the Agent wallet account first', async () => {
  await run(switchWallet(2));
  expect(mockOrder).toEqual(['close-agent', 'set-active']);
});

test('removing a wallet closes the Agent wallet account first', async () => {
  await run(deleteWallet(2));
  expect(mockOrder).toEqual(['close-agent', 'delete']);
});

test('balances clear when a wallet changes, and late results for the old identity are discarded', () => {
  const balance = { vanilla: { settled: 20, future: 20, spendable: 20 }, colored: { settled: 0, future: 0, spendable: 0 } };
  const wallet: WalletRecord = { id: 1, created_at: 1, name: 'First', is_active: true };
  let state = walletReducer(undefined, setActiveWallet(wallet));
  state = walletReducer(state, setBtcBalance({ walletKey: '1:1', balance }));
  state = walletReducer(state, setWalletPortfolio({ walletKey: '1:1', btcBalance: balance, assets: [], btcPriceUSD: 0, status: 'current' }));
  state = walletReducer(state, setActiveWallet({ ...wallet, name: 'Renamed' }));
  expect(state.btcBalance).toEqual(balance);
  state = walletReducer(state, setActiveWallet({ ...wallet, created_at: 2 }));
  expect(state.btcBalance).toBeNull();
  expect(state.portfolio).toBeNull();
  state = walletReducer(state, loadBtcBalance.fulfilled({ walletKey: '1:1', balance }, '_', undefined));
  expect(state.btcBalance).toBeNull();
});
