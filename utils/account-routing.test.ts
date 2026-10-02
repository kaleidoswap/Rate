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

describe('Bark as a receive layer', () => {
  it('receives on its own Bark method (not Arkade), routed by account', () => {
    expect(getReceiveMethodsForAccount('BARK', 'BTC')).toEqual(['bark', 'lightning']);
    expect(getNetworkTypesForAccount('BARK', 'BTC')).toEqual(['bark', 'lightning']);
  });

  it('is offered as a BTC receive account when connected', () => {
    const accounts = resolveReceiveAccounts({
      assetFamily: 'BTC',
      accounts: { RGB: false, SPARK: false, ARKADE: true, BARK: true },
    });
    expect(accounts).toEqual(['ARKADE', 'BARK']);
  });
});
