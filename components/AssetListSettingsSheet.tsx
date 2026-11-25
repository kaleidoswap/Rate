import React, { useMemo } from 'react';
import { FlatList, StyleSheet, Switch, Text, View } from 'react-native';
import { useAppLanguage } from '../localization/useAppLanguage';
import { useAppTheme } from '../theme/ThemeProvider';
import {
  ASSET_FILTERS, availableAssetFilters, filterAssetItems, networkLabel,
  type AssetFilter, type AssetListItem,
} from '../utils/asset-list-model';
import { AssetIcon } from './AssetIcon';
import { Button } from './Button';
import { FilterChipGroup } from './FilterChips';
import { NetworkIcon } from './NetworkIcon';
import { SearchField } from './SearchField';
import { Sheet } from './Sheet';

interface Props {
  visible: boolean;
  onClose: () => void;
  assets: readonly AssetListItem[] | (() => readonly AssetListItem[]);
  query: string;
  onChangeQuery: (query: string) => void;
  network: AssetFilter;
  onChangeNetwork: (network: AssetFilter) => void;
  showNetworks: boolean;
  hiddenAssetKeys: ReadonlySet<string>;
  onToggleAsset: (assetKey: string, hidden: boolean) => void;
}

export function AssetListSettingsSheet({ visible, onClose, ...controls }: Props) {
  const { t } = useAppLanguage();
  return (
    <Sheet visible={visible} onClose={onClose} title={t('Asset list settings')}
      footer={<Button title={t('Done')} fullWidth onPress={onClose} />}>
      <AssetListSettingsContent {...controls} />
    </Sheet>
  );
}

// Sheet mounts its children only to present or dismiss the modal. Nothing in
// this list is derived or rendered while its owning portfolio is at rest.
function AssetListSettingsContent({
  assets, query, onChangeQuery, network, onChangeNetwork, showNetworks, hiddenAssetKeys, onToggleAsset,
}: Omit<Props, 'visible' | 'onClose'>) {
  const theme = useAppTheme();
  const { t } = useAppLanguage();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const inventory = useMemo(() => typeof assets === 'function' ? assets() : assets, [assets]);
  const filters = useMemo(() => showNetworks ? availableAssetFilters(inventory) : ['all'], [inventory, showNetworks]);
  const activeNetwork = filters.includes(network) ? network : 'all';
  const matchingAssets = useMemo(() => activeNetwork === 'all' && !query.trim()
    ? inventory : filterAssetItems(inventory, activeNetwork, query), [inventory, activeNetwork, query]);
  const options = ASSET_FILTERS.filter(option => filters.includes(option.key)).map(option => ({
    ...option,
    label: option.key === 'all' ? t('All networks') : option.label,
    renderIcon: option.key === 'all' ? undefined : (_color: string, size: number) => <NetworkIcon network={option.key} size={size} />,
  }));

  return (
    <FlatList
      data={matchingAssets}
      keyExtractor={item => item.key}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      contentContainerStyle={styles.content}
      ListHeaderComponent={(
        <View style={styles.header}>
          <SearchField value={query} onChangeText={onChangeQuery} placeholder={t('Search assets')} />
          {options.length > 1 &&
            <FilterChipGroup label={t('Network')} options={options} value={activeNetwork} onChange={onChangeNetwork} />}
          <Text accessibilityRole="header" style={styles.heading}>{t('Visible assets')}</Text>
        </View>
      )}
      ListEmptyComponent={<Text style={styles.detail}>{t(inventory.length ? 'No matching assets' : 'No assets yet')}</Text>}
      renderItem={({ item, index }) => {
        const enabled = !hiddenAssetKeys.has(item.key);
        const networkNames = item.networks.map(networkLabel).join(', ');
        const detail = [item.ticker !== item.name ? item.ticker : '', networkNames, item.assetIdLabel].filter(Boolean).join(' · ');
        const assetId = item.holdings[0]?.token?.asset_id;
        const accessibleName = [`${t('Show asset')} ${item.name}`, networkNames, item.assetIdLabel ? assetId : undefined]
          .filter(Boolean).join(', ');
        return (
          <View style={[styles.row, index === 0 && styles.firstRow, index === matchingAssets.length - 1 && styles.lastRow]}>
            <AssetIcon ticker={item.ticker} logoUri={item.icon} size={36} showBadge={false} />
            <View style={styles.identity}>
              <Text style={styles.name}>{item.name}</Text>
              {!!detail && <Text style={styles.detail}>{detail}</Text>}
            </View>
            <Switch accessibilityRole="switch" accessibilityLabel={accessibleName} accessibilityState={{ checked: enabled }}
              value={enabled} onValueChange={value => onToggleAsset(item.key, !value)}
              trackColor={{ true: theme.colors.primary[500], false: theme.colors.gray[300] }} />
          </View>
        );
      }}
    />
  );
}

const makeStyles = (theme: ReturnType<typeof useAppTheme>) => StyleSheet.create({
  content: { paddingBottom: theme.spacing[4] },
  header: { gap: theme.spacing[4], marginBottom: theme.spacing[2] },
  heading: {
    color: theme.colors.text.primary, fontSize: theme.typography.fontSize.sm,
    fontWeight: theme.typography.fontWeight.semibold,
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: theme.spacing[3], minHeight: 56,
    paddingHorizontal: theme.spacing[3], paddingVertical: theme.spacing[2],
    borderWidth: StyleSheet.hairlineWidth, borderTopWidth: 0, borderColor: theme.colors.border.light,
    backgroundColor: theme.colors.surface.secondary,
  },
  firstRow: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopLeftRadius: theme.borderRadius.lg, borderTopRightRadius: theme.borderRadius.lg,
  },
  lastRow: { borderBottomLeftRadius: theme.borderRadius.lg, borderBottomRightRadius: theme.borderRadius.lg },
  identity: { flex: 1, minWidth: 0, gap: theme.spacing[0.5] },
  name: { color: theme.colors.text.primary, fontSize: theme.typography.fontSize.base },
  detail: { color: theme.colors.text.secondary, fontSize: theme.typography.fontSize.sm },
});
