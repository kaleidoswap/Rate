import {
  accountsOnChain, arkDestinations, defaultDestination, legacyRoute, lightningDestinations,
  methodsFor, onchainDestinations, routeOf, universalChains, universalLightning, type ReceiveAccountInfo, type ReceiveMethodId,
} from './receive-routes';

const all: ReceiveAccountInfo[] = [
  { account: 'RGB', chain: 'regtest' },
  { account: 'SPARK', chain: 'regtest' },
  { account: 'ARKADE', chain: 'mutinynet' },
  { account: 'BARK', chain: 'signet' },
];

describe('receive routes', () => {
  it('offers every Lightning-capable account, flagging the ones that need an amount', () => {
    const list = lightningDestinations(all, {});
    expect(list.map(d => d.account)).toEqual(['RGB', 'SPARK', 'BARK', 'ARKADE']);
    expect(list.filter(d => d.needsAmount).map(d => d.account)).toEqual(['BARK', 'ARKADE']);
    expect(list.find(d => d.account === 'ARKADE')?.chain).toBe('mutinynet');
  });

  it('marks the RGB node unavailable for Lightning without a channel or invoice permission', () => {
    expect(lightningDestinations(all, { rgbChannels: 'none' })[0]).toMatchObject({ available: false, reason: 'No open channel to receive into.' });
    expect(lightningDestinations(all, { nwcWalletType: 'ln', nwcCapabilities: [] })[0]).toMatchObject({ label: 'Lightning wallet', available: false });
    expect(lightningDestinations(all, { nwcWalletType: 'ln', nwcCapabilities: ['createInvoice'], rgbChannels: 'none' })[0].available).toBe(true);
  });

  it('lists on-chain and Ark destinations per account', () => {
    expect(onchainDestinations(all, {}).map(d => d.account)).toEqual(['RGB', 'SPARK', 'ARKADE', 'BARK']);
    expect(onchainDestinations(all, { nwcWalletType: 'ln' }).map(d => d.account)).toEqual(['SPARK', 'ARKADE', 'BARK']);
    expect(arkDestinations(all).map(d => d.account)).toEqual(['ARKADE', 'BARK']);
  });

  it('chooses the methods for each asset', () => {
    expect(methodsFor('BTC', all, {})).toEqual(['universal', 'lightning', 'onchain', 'spark', 'ark']);
    expect(methodsFor('BTC', [{ account: 'ARKADE', chain: 'mutinynet' }], {})).toEqual(['universal', 'lightning', 'onchain', 'ark']);
    expect(methodsFor('RGB', all, { rgbChannels: 'none' })).toEqual(['onchain']);
    expect(methodsFor('RGB', [{ account: 'SPARK' }], {})).toEqual([]);
    expect(methodsFor('USD', all, {})).toEqual(['universal']);
  });

  it('defaults to a destination that works without an amount, and keeps a usable remembered one', () => {
    const list = lightningDestinations(all, { rgbChannels: 'none' });
    expect(defaultDestination(list)).toBe('SPARK');
    expect(defaultDestination(list, 'ARKADE')).toBe('ARKADE');
    expect(defaultDestination(list, 'RGB')).toBe('SPARK');
    expect(defaultDestination(lightningDestinations([{ account: 'BARK' }], {}))).toBe('BARK');
  });

  it('round-trips method and account through the screen route', () => {
    const cases: Array<[ReceiveMethodId, any]> = [
      ['universal', null], ['spark', 'SPARK'], ['lightning', 'ARKADE'], ['lightning', 'BARK'],
      ['onchain', 'RGB'], ['onchain', 'SPARK'], ['onchain', 'ARKADE'], ['onchain', 'BARK'], ['ark', 'ARKADE'], ['ark', 'BARK'],
    ];
    for (const [method, account] of cases) expect(routeOf(legacyRoute(method, account))).toEqual({ method, account });
    expect(legacyRoute('onchain', 'ARKADE')).toEqual({ networkType: 'arkade', arkadeSubMode: 'boarding', selectedAccount: 'ARKADE' });
  });

  it('groups accounts by chain so a universal QR never mixes networks', () => {
    expect(universalChains(all)).toEqual([
      { chain: 'regtest', accounts: ['RGB', 'SPARK'] },
      { chain: 'signet', accounts: ['BARK'] },
      { chain: 'mutinynet', accounts: ['ARKADE'] },
    ]);
    expect(universalChains([{ account: 'SPARK', chain: 'regtest' }, { account: 'ARKADE', chain: 'mainnet' }])[0].chain).toBe('mainnet');
    expect(accountsOnChain(all, 'regtest').map(a => a.account)).toEqual(['RGB', 'SPARK']);
    expect(accountsOnChain(all, null)).toHaveLength(4);
  });

  it('picks the universal Lightning leg, never an Arkade swap on its own', () => {
    const list = lightningDestinations(all, {});
    expect(universalLightning(list, null, 0)).toBe('SPARK');
    expect(universalLightning(list, 'ARKADE', 1000)).toBe('ARKADE');
    expect(universalLightning(list, 'ARKADE', 0)).toBe('SPARK');
    const arkOnly = lightningDestinations([{ account: 'ARKADE' }], {});
    expect(universalLightning(arkOnly, null, 1000)).toBeNull();
    expect(universalLightning(lightningDestinations([{ account: 'BARK' }], {}), null, 0)).toBeNull();
    expect(universalLightning(lightningDestinations([{ account: 'BARK' }], {}), null, 500)).toBe('BARK');
  });
});
