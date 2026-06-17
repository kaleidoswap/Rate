import {
  PROTOCOL_DEFAULT_NETWORK,
  PROTOCOL_SUPPORTED_NETWORKS,
  buildNetworkConfig,
  resolveSparkNetwork,
} from '../services/protocols/networkConfig';

describe('protocol network config', () => {
  it('uses Spark regtest as the single app-supported test environment', () => {
    expect(PROTOCOL_DEFAULT_NETWORK.spark).toBe('regtest');
    expect(PROTOCOL_SUPPORTED_NETWORKS.SPARK).toEqual(['mainnet', 'regtest']);
  });

  it('falls back legacy Spark network config to regtest', () => {
    expect(resolveSparkNetwork('mainnet')).toBe('mainnet');
    expect(resolveSparkNetwork('testnet')).toBe('regtest');
    expect(resolveSparkNetwork('signet')).toBe('regtest');
    expect(resolveSparkNetwork(undefined)).toBe('regtest');
  });

  it('builds Spark configs with a reachable network', () => {
    expect(JSON.parse(buildNetworkConfig('spark', 'mainnet')).network).toBe('mainnet');
    expect(JSON.parse(buildNetworkConfig('spark', 'testnet')).network).toBe('regtest');
  });
});
