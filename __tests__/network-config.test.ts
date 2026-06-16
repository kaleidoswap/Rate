import {
  PROTOCOL_DEFAULT_NETWORK,
  PROTOCOL_SUPPORTED_NETWORKS,
  buildNetworkConfig,
  normalizeSparkNetwork,
} from '../services/protocols/networkConfig';

describe('protocol network config', () => {
  it('limits Spark to hosted SDK networks', () => {
    expect(PROTOCOL_DEFAULT_NETWORK.spark).toBe('regtest');
    expect(PROTOCOL_SUPPORTED_NETWORKS.SPARK).toEqual(['mainnet', 'regtest']);
  });

  it('normalizes unsupported Spark networks to regtest', () => {
    expect(normalizeSparkNetwork('mainnet')).toBe('mainnet');
    expect(normalizeSparkNetwork('testnet')).toBe('regtest');
    expect(normalizeSparkNetwork('signet')).toBe('regtest');
    expect(normalizeSparkNetwork(undefined)).toBe('regtest');
  });

  it('builds Spark configs with a reachable network', () => {
    expect(JSON.parse(buildNetworkConfig('spark', 'mainnet')).network).toBe('mainnet');
    expect(JSON.parse(buildNetworkConfig('spark', 'testnet')).network).toBe('regtest');
  });
});
