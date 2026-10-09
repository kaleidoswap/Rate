jest.mock('../protocols/MobileSparkAdapter', () => {
  class MobileSparkAdapter {
    account: any = null;
    network = 'mainnet';
    connected = false;
    static lastConfig: any;
    static identity: (cfg: any) => string;
    async connect(cfg: any) {
      MobileSparkAdapter.lastConfig = cfg;
      this.network = cfg.network;
      this.account = { _wallet: { id: 'agent-wallet' }, getIdentityKey: async () => MobileSparkAdapter.identity(cfg) };
      this.connected = true;
    }
    async disconnect() { this.connected = false; }
    isConnected() { return this.connected; }
    assertConnected() { if (!this.connected) throw new Error('not connected'); }
  }
  return { MobileSparkAdapter };
});
import { MobileSparkAdapter } from '../protocols/MobileSparkAdapter';
import { AgentSparkAdapter, sparkAccount } from './account';
import { sparkIdentityPubkey } from './derivation';

const PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const Mock = MobileSparkAdapter as any;

describe('AgentSparkAdapter', () => {
  const glue = () => ({ adoptExternalWallet: jest.fn(), releaseExternalWallet: jest.fn() });

  it('opens account index 1 and hands the shared Spark glue back to the main wallet', async () => {
    Mock.identity = (cfg: any) => sparkIdentityPubkey(cfg.mnemonic, cfg.network, cfg.accountIndex);
    const g = glue();
    const main = { id: 'main-wallet' };
    const adapter = new AgentSparkAdapter(g, () => main);
    await adapter.connect({ mnemonic: PHRASE, network: 'mainnet' });
    expect(Mock.lastConfig.accountIndex).toBe(1);
    expect(g.releaseExternalWallet).toHaveBeenCalledWith({ id: 'agent-wallet' });
    expect(g.adoptExternalWallet).toHaveBeenCalledWith(main, 'mainnet');
    expect(adapter.isConnected()).toBe(true);
  });

  it('refuses to run when the opened account is not the derived agent account', async () => {
    Mock.identity = (cfg: any) => sparkIdentityPubkey(cfg.mnemonic, cfg.network, 0);
    const adapter = new AgentSparkAdapter(glue(), () => null);
    await expect(adapter.connect({ mnemonic: PHRASE, network: 'mainnet' })).rejects.toThrow(/own account/);
    expect(adapter.isConnected()).toBe(false);
  });

  it('reads the spendable balance and fails on nonsense', async () => {
    Mock.identity = (cfg: any) => sparkIdentityPubkey(cfg.mnemonic, cfg.network, cfg.accountIndex);
    const adapter = new AgentSparkAdapter(glue(), () => null);
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
