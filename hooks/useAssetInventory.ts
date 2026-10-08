import { useSelector } from 'react-redux';
import { selectAssetInventory, type InventoryAsset } from '../utils/asset-inventory';
import type { RootState } from '../store';

/** Bitcoin plus every account's assets: the one list balance screens read. */
export function useAssetInventory(): InventoryAsset[] {
  return useSelector((state: RootState) => selectAssetInventory(state));
}
