import {
  AGENT_SPARK_ACCOUNT_INDEX,
  MAIN_SPARK_ACCOUNT_INDEX,
  sparkIdentityPath,
  sparkIdentityPubkey,
} from './derivation';

const PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

// Produced by @tetherto/wdk-wallet-spark's own Bip44HDKeysGenerator for PHRASE.
const WDK_VECTORS = {
  main: '03d2c2e1c71b64779b0ce10bb0fc22e14564c25b8aa74dab901a2c7b867f131e48',
  agent: '022fde836615fc9128442bfe14bd34b4f253e53754591f2cd86580f35ffd5951bd',
  agentRegtest: '0347a2b269f2500c9690424a9825b5ae4904d4adf616aded794c22bb0aefe06103',
};

describe('agent wallet derivation', () => {
  it('uses the next Spark account index under the same account number', () => {
    expect(sparkIdentityPath('mainnet', MAIN_SPARK_ACCOUNT_INDEX)).toBe("m/44'/998'/1'/0/0");
    expect(sparkIdentityPath('mainnet', AGENT_SPARK_ACCOUNT_INDEX)).toBe("m/44'/998'/1'/0/1");
    expect(sparkIdentityPath('regtest', AGENT_SPARK_ACCOUNT_INDEX)).toBe("m/44'/998'/0'/0/1");
  });

  it('matches the keys the WDK Spark signer derives', () => {
    expect(sparkIdentityPubkey(PHRASE, 'mainnet', MAIN_SPARK_ACCOUNT_INDEX)).toBe(WDK_VECTORS.main);
    expect(sparkIdentityPubkey(PHRASE, 'mainnet', AGENT_SPARK_ACCOUNT_INDEX)).toBe(WDK_VECTORS.agent);
    expect(sparkIdentityPubkey(PHRASE, 'regtest', AGENT_SPARK_ACCOUNT_INDEX)).toBe(WDK_VECTORS.agentRegtest);
  });

  it('is deterministic and separate from the main wallet', () => {
    const a = sparkIdentityPubkey(PHRASE, 'mainnet', AGENT_SPARK_ACCOUNT_INDEX);
    expect(sparkIdentityPubkey(`  ${PHRASE.replace(/ /g, '  ')} `, 'mainnet', AGENT_SPARK_ACCOUNT_INDEX)).toBe(a);
    expect(a).not.toBe(sparkIdentityPubkey(PHRASE, 'mainnet', MAIN_SPARK_ACCOUNT_INDEX));
  });

  it('accepts hex-rooted wallets and rejects anything else', () => {
    const hex = '11'.repeat(32);
    expect(sparkIdentityPubkey(hex, 'mainnet', 1)).toBe(sparkIdentityPubkey(hex.toUpperCase(), 'mainnet', 1));
    expect(() => sparkIdentityPubkey('not a phrase at all', 'mainnet', 1)).toThrow('Invalid wallet secret');
    expect(() => sparkIdentityPath('mainnet', -1)).toThrow();
  });
});
