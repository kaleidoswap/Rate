import type { NetworkType } from '../DatabaseService';

export type ProtocolNetwork = 'mainnet' | 'testnet' | 'regtest' | 'signet';
export type SparkProtocolNetwork = Extract<ProtocolNetwork, 'mainnet' | 'regtest'>;
export const SPARK_TEST_NETWORK: SparkProtocolNetwork = 'regtest';

export const PROTOCOL_SUPPORTED_NETWORKS: Record<'RGB' | 'SPARK' | 'ARKADE', ProtocolNetwork[]> = {
  // Spark uses one hosted test environment in this app: REGTEST.
  // Arkade's signet/Mutinynet setting is a different protocol/network.
  SPARK: ['mainnet', SPARK_TEST_NETWORK],
  ARKADE: ['mainnet', 'signet'],
  RGB: ['regtest', 'testnet', 'signet'],
};

export const PROTOCOL_TO_NETWORK_TYPE: Record<'RGB' | 'SPARK' | 'ARKADE', NetworkType> = {
  RGB: 'rln',
  SPARK: 'spark',
  ARKADE: 'arkade',
};

export const PROTOCOL_DEFAULT_NETWORK: Record<NetworkType, ProtocolNetwork> = {
  spark: 'regtest',
  arkade: 'signet',
  rln: 'regtest',
  liquid: 'testnet',
};

export const NETWORK_LABEL: Record<ProtocolNetwork, string> = {
  mainnet: 'Mainnet',
  testnet: 'Testnet',
  regtest: 'Regtest',
  signet: 'Mutinynet',
};

export function getDefaultArkadeServerUrl(network: ProtocolNetwork): string {
  return network === 'mainnet' ? 'https://arkade.computer' : 'https://mutinynet.arkade.sh';
}

export function isSupportedSparkNetwork(network?: string | null): network is SparkProtocolNetwork {
  return network === 'mainnet' || network === SPARK_TEST_NETWORK;
}

export function resolveSparkNetwork(network?: string | null): SparkProtocolNetwork {
  // Older wallet records may contain Spark "testnet" or "signet" values from
  // broader protocol UI choices. Spark only has one app-supported test network,
  // so those legacy values fall back to REGTEST instead of hitting broken SDK
  // LOCAL endpoints during authentication.
  return isSupportedSparkNetwork(network) ? network : SPARK_TEST_NETWORK;
}

export function buildNetworkConfig(
  type: NetworkType,
  network: ProtocolNetwork = PROTOCOL_DEFAULT_NETWORK[type],
  previous: Record<string, unknown> = {},
): string {
  const config: Record<string, unknown> = {
    ...previous,
    network: PROTOCOL_DEFAULT_NETWORK[type],
  };
  config.network = type === 'spark' ? resolveSparkNetwork(network) : network;

  if (type === 'arkade') {
    const previousUrl = typeof previous.arkServerUrl === 'string' ? previous.arkServerUrl : undefined;
    const knownDefault = !previousUrl
      || previousUrl === getDefaultArkadeServerUrl('mainnet')
      || previousUrl === getDefaultArkadeServerUrl('signet');
    if (knownDefault) {
      config.arkServerUrl = getDefaultArkadeServerUrl(network);
    }
  }

  return JSON.stringify(config);
}

export function buildDefaultNetworkConfig(type: NetworkType): string {
  return buildNetworkConfig(type);
}
