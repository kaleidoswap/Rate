import {
  PROTOCOL_DEFAULT_NETWORK,
  PROTOCOL_SUPPORTED_NETWORKS,
  buildNetworkConfig,
  resolveSparkNetwork,
} from '../services/protocols/networkConfig';

describe('protocol network config', () => {
  it('defaults new wallets to mainnet; Spark regtest is the single test environment', () => {
    expect(PROTOCOL_DEFAULT_NETWORK.spark).toBe('mainnet');
    expect(PROTOCOL_DEFAULT_NETWORK.arkade).toBe('mainnet');
    expect(JSON.parse(buildNetworkConfig('arkade')).arkServerUrl).toBe('https://arkade.computer');
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

test('changing an Arkade account’s network starts from that network’s servers', () => {
  const custom = { network: 'signet', arkServerUrl: 'https://my-ark.example', esploraUrl: 'https://my-explorer.example' };
  const sameNetwork = JSON.parse(buildNetworkConfig('arkade', 'signet', custom));
  expect(sameNetwork).toEqual(expect.objectContaining({ arkServerUrl: 'https://my-ark.example', esploraUrl: 'https://my-explorer.example' }));
  const moved = JSON.parse(buildNetworkConfig('arkade', 'mainnet', custom));
  expect(moved.arkServerUrl).toBe('https://arkade.computer');
  expect(moved.esploraUrl).toBeUndefined();
});
