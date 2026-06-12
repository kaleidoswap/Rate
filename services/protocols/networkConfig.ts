import type { NetworkType } from '../DatabaseService';

export type ProtocolNetwork = 'mainnet' | 'testnet' | 'regtest' | 'signet';

export const PROTOCOL_SUPPORTED_NETWORKS: Record<'RGB' | 'SPARK' | 'ARKADE', ProtocolNetwork[]> = {
  SPARK: ['mainnet', 'testnet', 'regtest', 'signet'],
  ARKADE: ['mainnet', 'signet'],
  RGB: ['regtest', 'testnet', 'signet'],
};

export const PROTOCOL_TO_NETWORK_TYPE: Record<'RGB' | 'SPARK' | 'ARKADE', NetworkType> = {
  RGB: 'rln',
  SPARK: 'spark',
  ARKADE: 'arkade',
};

export const PROTOCOL_DEFAULT_NETWORK: Record<NetworkType, ProtocolNetwork> = {
  spark: 'testnet',
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

export function buildNetworkConfig(
  type: NetworkType,
  network: ProtocolNetwork = PROTOCOL_DEFAULT_NETWORK[type],
  previous: Record<string, unknown> = {},
): string {
  const config: Record<string, unknown> = {
    ...previous,
    network: PROTOCOL_DEFAULT_NETWORK[type],
  };
  config.network = network;

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
