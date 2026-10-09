const mockWallet: { current: any } = { current: { id: 1, encrypted_mnemonic: 'phrase one' } };
const mockMain = { isConnected: () => true, network: 'mainnet' };
const mockAdapters: any[] = [];
let mockConnectGate: Promise<void> | null = null;

jest.mock('../DatabaseService', () => ({ __esModule: true, default: { getInstance: () => ({ getActiveWallet: async () => mockWallet.current }) } }));
jest.mock('../protocols', () => ({ protocolManager: { getAdapterIfAvailable: () => mockMain } }));
jest.mock('@react-native-async-storage/async-storage', () => ({ __esModule: true, default: {} }));
jest.mock('./account', () => ({
  AgentSparkAdapter: class {
    connected = false;
    config: any;
    disconnect = jest.fn(async () => { this.connected = false; });
    constructor() { mockAdapters.push(this); }
    async connect(config: any) { this.config = config; if (mockConnectGate) await mockConnectGate; this.connected = true; }
    isConnected() { return this.connected; }
  },
  agentPayWallet: jest.fn(),
  sparkAccount: jest.fn(),
}));

import { closeAgentAccount, openAgentAccount } from './live';

beforeEach(async () => {
  await closeAgentAccount();
  mockAdapters.length = 0;
  mockConnectGate = null;
  mockWallet.current = { id: 1, encrypted_mnemonic: 'phrase one' };
});

describe('agent account session', () => {
  it('reuses the open account for the same wallet', async () => {
    const a = await openAgentAccount();
    expect(await openAgentAccount()).toBe(a);
    expect(mockAdapters).toHaveLength(1);
  });

  it('a new wallet never reuses the previous wallet\'s account', async () => {
    const a: any = await openAgentAccount();
    mockWallet.current = { id: 2, encrypted_mnemonic: 'phrase two' };
    const b: any = await openAgentAccount();
    expect(b).not.toBe(a);
    expect(a.disconnect).toHaveBeenCalled();
    expect(b.config.mnemonic).toBe('phrase two');
  });

  it('closing disconnects and forgets the account', async () => {
    const a: any = await openAgentAccount();
    await closeAgentAccount();
    expect(a.disconnect).toHaveBeenCalled();
    const b = await openAgentAccount();
    expect(b).not.toBe(a);
  });

  it('an open still running when the account is closed is thrown away', async () => {
    const early = openAgentAccount();
    await closeAgentAccount();
    await expect(early).rejects.toThrow(/wallet changed/);

    let release!: () => void;
    mockConnectGate = new Promise((r) => { release = r; });
    const opening = openAgentAccount();
    while (mockAdapters.length < 1) await new Promise((r) => setTimeout(r, 0));
    const closing = closeAgentAccount();
    release();
    await closing;
    await expect(opening).rejects.toThrow(/wallet changed/);
    expect(mockAdapters[0].disconnect).toHaveBeenCalled();
  });

  it('needs an unlocked wallet', async () => {
    mockWallet.current = null;
    await expect(openAgentAccount()).rejects.toThrow(/Unlock/);
  });
});
