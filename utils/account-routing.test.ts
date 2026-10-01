import {
  getNetworkTypesForAccount,
  getReceiveMethodsForAccount,
  resolveReceiveAccounts,
} from './account-routing';

describe('receive account routing', () => {
  it('offers every supported Bitcoin receive rail for Spark', () => {
    expect(getReceiveMethodsForAccount('SPARK', 'BTC')).toEqual([
      'spark',
      'lightning',
      'bitcoin_l1',
    ]);
    expect(getNetworkTypesForAccount('SPARK', 'BTC')).toEqual([
      'spark',
      'lightning',
      'onchain',
    ]);
  });

  it('does not offer another account for a protocol-native asset', () => {
    expect(resolveReceiveAccounts({
      assetFamily: 'SPARK',
      accounts: { RGB: true, SPARK: true, ARKADE: true },
    })).toEqual(['SPARK']);
  });

  it('offers all connected accounts for Bitcoin', () => {
    expect(resolveReceiveAccounts({
      assetFamily: 'BTC',
      accounts: { RGB: true, SPARK: true, ARKADE: false },
    })).toEqual(['RGB', 'SPARK']);
  });
});
