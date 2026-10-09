// The Spark client Flashnet shares must only ever hold the main wallet.
import path from 'path';
import { AgentSparkAdapter } from './account';
import { sparkIdentityPubkey } from './derivation';

jest.mock('@buildonspark/spark-sdk', () => ({ SparkWallet: {}, SparkReadonlyClient: {} }), { virtual: true });

const { sparkClientManager } = require(path.join(__dirname, '../../node_modules/@kaleidorg/wallet-engine/dist/lib/spark-client-manager.js'));
const PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const tick = () => new Promise((r) => setTimeout(r, 0));

function loaders(agentWallet: object) {
  class WalletManagerSpark {
    async getAccount(index: number) {
      for (let i = 0; i < 5; i++) { await Promise.resolve(); await tick(); }
      return {
        _wallet: agentWallet,
        getIdentityKey: async () => { await tick(); return sparkIdentityPubkey(PHRASE, 'mainnet', index); },
        dispose: () => {},
        cleanupConnections: async () => {},
      };
    }
  }
  return { walletModule: () => ({ default: WalletManagerSpark }), sparkSdk: () => ({}) };
}

test('a Flashnet operation running while the agent account connects uses the main wallet', async () => {
  const mainWallet = { name: 'main' };
  const agentWallet = { name: 'agent' };
  sparkClientManager.adoptExternalWallet(mainWallet, 'mainnet');
  const adapter = new AgentSparkAdapter(loaders(agentWallet));

  const seen: unknown[] = [];
  let done = false;
  const flashnet = (async () => {
    while (!done) {
      seen.push(sparkClientManager.getWallet());
      await Promise.resolve();
      seen.push(sparkClientManager.getWallet());
      await tick();
    }
  })();
  await adapter.connect({ mnemonic: PHRASE, network: 'mainnet' });
  seen.push(sparkClientManager.getWallet());
  await adapter.disconnect();
  seen.push(sparkClientManager.getWallet());
  done = true;
  await flashnet;

  expect(adapter.isConnected()).toBe(false);
  expect(seen.length).toBeGreaterThan(10);
  expect(seen.every((w) => w === mainWallet)).toBe(true);
});
