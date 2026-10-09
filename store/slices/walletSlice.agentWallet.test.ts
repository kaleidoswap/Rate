const mockOrder: string[] = [];
jest.mock('../../services/agentWallet/lifecycle', () => ({ closeAgentWallet: jest.fn(async () => { mockOrder.push('close-agent'); }) }));
jest.mock('../../services/protocols', () => ({ protocolManager: {}, rgbAccountAdapter: jest.fn() }));
jest.mock('../../services/balanceSnapshot', () => ({ clearBalanceSnapshots: jest.fn(async () => {}) }));
jest.mock('../../services/DatabaseService', () => ({
  __esModule: true,
  default: { getInstance: () => ({
    setActiveWallet: async () => { mockOrder.push('set-active'); },
    getActiveWallet: async () => null,
    deleteWallet: async () => { mockOrder.push('delete'); },
  }) },
}));
jest.mock('../../services/WalletManager', () => ({ __esModule: true, default: { getInstance: () => ({}) } }));

import { deleteWallet, switchWallet } from './walletSlice';

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
