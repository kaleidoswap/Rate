import { useCallback, useEffect, useMemo, useState } from 'react';
import { buildAssetListItems, filterAssetItems, type AssetFilter, type BuildAssetListArgs } from '../utils/asset-list-model';
import { useAssetVisibility } from './useAssetVisibility';

export function useAssetListView(options: Omit<BuildAssetListArgs, 'hiddenAssetKeys'>, walletKey: string | null) {
  const { assets, btcAvailable, btcMainnetNetworks, btcNetworkChains, btcNetworks, btcPriceUSD, liteUsdAssetIds, showBtc, testProtocols } = options;
  const { hiddenAssetKeys, setAssetHidden } = useAssetVisibility();
  const [visible, setVisible] = useState(false);
  const [network, setNetwork] = useState<AssetFilter>('all');
  const [query, setQuery] = useState('');
  const openSettings = useCallback(() => setVisible(true), []);
  const closeSettings = useCallback(() => setVisible(false), []);

  useEffect(() => {
    closeSettings();
    setNetwork('all');
    setQuery('');
  }, [walletKey, closeSettings]);

  const listOptions = useMemo(() => ({
    assets, btcAvailable, btcMainnetNetworks, btcNetworkChains, btcNetworks, btcPriceUSD, liteUsdAssetIds, showBtc, testProtocols,
  }), [assets, btcAvailable, btcMainnetNetworks, btcNetworkChains, btcNetworks, btcPriceUSD, liteUsdAssetIds, showBtc, testProtocols]);
  const items = useMemo(() => buildAssetListItems({ ...listOptions, hiddenAssetKeys }), [listOptions, hiddenAssetKeys]);
  // Settings need the unfolded, unhidden inventory only when opened, or when a
  // selected network no longer appears in the visible list.
  const controlItems = useCallback(() => hiddenAssetKeys.size > 0 || liteUsdAssetIds?.size
    ? buildAssetListItems({ ...listOptions, liteUsdAssetIds: undefined })
    : items, [hiddenAssetKeys, items, listOptions, liteUsdAssetIds]);
  const activeNetwork = useMemo(() => {
    if (network === 'all') return network;
    const hasNetwork = (source: typeof items) => source.some(item => item.holdings.some(holding => holding.network === network));
    return hasNetwork(items) || hasNetwork(controlItems()) ? network : 'all';
  }, [controlItems, items, network]);
  const queryActive = query.trim().length > 0;
  const networkActive = activeNetwork !== 'all';
  const shown = useMemo(() => queryActive || networkActive ? filterAssetItems(items, activeNetwork, query) : items,
    [items, activeNetwork, networkActive, query, queryActive]);
  const emptyReason = useMemo<'search' | 'network' | 'hidden' | undefined>(() => {
    if (shown.length > 0) return undefined;
    if (queryActive) return 'search';
    if (networkActive) return 'network';
    return hiddenAssetKeys.size && buildAssetListItems(listOptions).length ? 'hidden' : undefined;
  }, [hiddenAssetKeys, listOptions, networkActive, queryActive, shown.length]);

  return {
    openSettings,
    filtered: queryActive || networkActive,
    listProps: { items: shown, walletKey, showNetworks: true, emptyReason, onOpenSettings: openSettings },
    settingsProps: {
      visible,
      onClose: closeSettings,
      assets: controlItems,
      showNetworks: true,
      query,
      onChangeQuery: setQuery,
      network: activeNetwork,
      onChangeNetwork: setNetwork,
      hiddenAssetKeys,
      onToggleAsset: setAssetHidden,
    },
  };
}
