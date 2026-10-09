jest.mock('../protocols/MobileSparkAdapter', () => {
  class MobileSparkAdapter {
    account: any = null;
    manager: any = null;
    network = 'mainnet';
    connected = false;
    async releasePreviousConnection() { if (this.connected) await this.disconnect(); }
    async disconnect() { this.connected = false; this.account = null; this.manager = null; }
    isConnected() { return this.connected; }
    assertConnected() { if (!this.connected) throw new Error('not connected'); }
  }
  return { MobileSparkAdapter };
});
import { AgentSparkAdapter, sparkAccount } from './account';
import { sparkIdentityPubkey } from './derivation';

const PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

function loaders(identity: (index: number) => string) {
  const calls: any[] = [];
  class WalletManagerSpark {
    constructor(seed: Uint8Array, cfg: any) { calls.push({ seed, cfg }); }
    async getAccount(index: number) {
      calls.push({ index });
      return { _wallet: { id: 'agent-wallet' }, getIdentityKey: async () => identity(index) };
    }
  }
  return { calls, loaders: { walletModule: () => ({ default: WalletManagerSpark }), sparkSdk: () => ({ isValidSparkAddress: () => true }) } };
}

describe('AgentSparkAdapter', () => {
  it('opens account index 1 of the phrase on the right Spark network', async () => {
    const { calls, loaders: l } = loaders((i) => sparkIdentityPubkey(PHRASE, 'mainnet', i));
    const adapter = new AgentSparkAdapter(l);
    await adapter.connect({ mnemonic: PHRASE, network: 'mainnet' });
    expect(calls[0].cfg).toEqual({ network: 'MAINNET' });
    expect(calls[0].seed).toBeInstanceOf(Uint8Array);
    expect(calls[1]).toEqual({ index: 1 });
    expect(adapter.isConnected()).toBe(true);
    expect(adapter.sparkNetwork).toBe('mainnet');
  });

  it('refuses to run when the opened account is not the derived agent account', async () => {
    const { loaders: l } = loaders(() => sparkIdentityPubkey(PHRASE, 'mainnet', 0));
    const adapter = new AgentSparkAdapter(l);
    await expect(adapter.connect({ mnemonic: PHRASE, network: 'mainnet' })).rejects.toThrow(/own account/);
    expect(adapter.isConnected()).toBe(false);
    expect((adapter as any).account).toBeNull();
  });

  it('reads the spendable balance and fails on nonsense', async () => {
    const { loaders: l } = loaders((i) => sparkIdentityPubkey(PHRASE, 'mainnet', i));
    const adapter = new AgentSparkAdapter(l);
    await adapter.connect({ mnemonic: PHRASE, network: 'mainnet' });
    (adapter as any).account._wallet.getBalance = async () => ({ balance: 9n, satsBalance: { available: 7n, owned: 9n } });
    expect(await adapter.spendableSats()).toBe(7);
    (adapter as any).account._wallet.getBalance = async () => ({});
    await expect(adapter.spendableSats()).rejects.toThrow();
  });
});

describe('sparkAccount', () => {
  it('wraps a Spark adapter for transfers', async () => {
    const adapter = {
      network: 'mainnet',
      getReceiveAddress: jest.fn(async () => ({ address: 'spark1x' })),
      getBtcBalance: jest.fn(async () => ({ confirmed: 42 })),
      sendPayment: jest.fn(async () => ({ paymentHash: 'id1', status: 'confirmed' })),
    };
    const a = sparkAccount(adapter);
    expect(await a.sparkAddress()).toBe('spark1x');
    expect(adapter.getReceiveAddress).toHaveBeenCalledWith('SPARK');
    expect(await a.balanceSats()).toBe(42);
    expect(await a.sendToSpark('spark1y', 5)).toEqual({ id: 'id1', status: 'confirmed' });
    expect(adapter.sendPayment).toHaveBeenCalledWith({ invoice: 'spark1y', amount: 5 });
  });
});
