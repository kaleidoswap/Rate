import { activityNetwork, activityNetworks, matchesActivityFilter } from './activity-layers';

const it_ = (layer: any, type: any = 'send', status: any = 'confirmed') => ({ layer, type, status });

describe('activity network filter', () => {
  it('groups layers into networks', () => {
    expect(activityNetwork('RGB-LN')).toBe('rgb');
    expect(activityNetwork('RGB-L1')).toBe('rgb');
    expect(activityNetwork('Bark Signet')).toBe('bark');
    expect(activityNetwork('L1')).toBe('onchain');
    expect(activityNetwork('Swap')).toBeNull();
    expect(activityNetwork('Cross-chain')).toBeNull();
  });

  it('lists only the networks present, in a fixed order', () => {
    expect(activityNetworks([it_('Spark'), it_('Swap'), it_('LN'), it_('RGB-L1'), it_('L1'), it_('LN')]))
      .toEqual(['onchain', 'lightning', 'spark', 'rgb']);
    expect(activityNetworks([])).toEqual([]);
  });

  it('combines the tab with the network', () => {
    const pendingLn = it_('LN', 'receive', 'pending');
    const unknownSpark = it_('Spark', 'send', 'unknown');
    const swap = it_('Swap', 'swap');
    expect(matchesActivityFilter(pendingLn, 'pending')).toBe(true);
    expect(matchesActivityFilter(unknownSpark, 'pending')).toBe(true);
    expect(matchesActivityFilter(pendingLn, 'pending', 'spark')).toBe(false);
    expect(matchesActivityFilter(pendingLn, 'receive', 'lightning')).toBe(true);
    expect(matchesActivityFilter(pendingLn, 'send', 'lightning')).toBe(false);
    expect(matchesActivityFilter(swap, 'swap')).toBe(true);
    expect(matchesActivityFilter(swap, 'all', 'onchain')).toBe(false);
    expect(matchesActivityFilter(swap, 'all')).toBe(true);
  });
});
