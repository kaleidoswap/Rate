import { useEffect, useState } from 'react';
import { availableAssetFilters, buildAssetListItems, filterAssetItems, type AssetFilter, type BuildAssetListArgs } from '../utils/asset-list-model';
import { useAssetVisibility } from './useAssetVisibility';

export function useAssetListView(options: BuildAssetListArgs, walletKey: string | null) {
  const { hiddenAssetKeys, setAssetHidden } = useAssetVisibility();
  const [visible, setVisible] = useState(false);
  const [network, setNetwork] = useState<AssetFilter>('all');
  const [query, setQuery] = useState('');
  const openSettings = () => setVisible(true);

  useEffect(() => {
    setVisible(false);
    setNetwork('all');
    setQuery('');
  }, [walletKey]);

  const items = buildAssetListItems({ ...options, hiddenAssetKeys });
  const controlItems = hiddenAssetKeys.size > 0 || options.liteUsdAssetIds?.size
    ? buildAssetListItems({ ...options, liteUsdAssetIds: undefined })
    : items;
  const activeNetwork = network === 'all' || availableAssetFilters(controlItems).includes(network) ? network : 'all';
  const shown = filterAssetItems(items, activeNetwork, query);
  const queryActive = query.trim().length > 0;
  const networkActive = activeNetwork !== 'all';
  let emptyReason: 'search' | 'network' | 'hidden' | undefined;
  if (shown.length === 0) {
    if (queryActive) emptyReason = 'search';
    else if (networkActive) emptyReason = 'network';
    else if (hiddenAssetKeys.size && buildAssetListItems(options).length) emptyReason = 'hidden';
  }

  return {
    openSettings,
    filtered: queryActive || networkActive,
    listProps: { items: shown, showNetworks: true, emptyReason, onOpenSettings: openSettings },
    settingsProps: {
      visible,
      onClose: () => setVisible(false),
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
