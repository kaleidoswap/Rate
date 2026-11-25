import { useCallback, useMemo } from 'react';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { setAssetHiddenPreference } from '../store/slices/settingsSlice';

const EMPTY_KEYS: readonly string[] = [];

/** A list preference scoped to the active wallet. */
export function useAssetVisibility() {
  const dispatch = useAppDispatch();
  const walletId = useAppSelector(state => state.wallet.activeWallet?.id);
  const savedKeys = useAppSelector(state => walletId == null
    ? EMPTY_KEYS : state.settings.hiddenAssetKeysByWallet?.[walletId] ?? EMPTY_KEYS);
  const hiddenAssetKeys: ReadonlySet<string> = useMemo(() => new Set(savedKeys), [savedKeys]);
  const setAssetHidden = useCallback((assetKey: string, hidden: boolean) => {
    if (walletId != null) dispatch(setAssetHiddenPreference({ walletId, assetKey, hidden }));
  }, [dispatch, walletId]);
  return { hiddenAssetKeys, setAssetHidden };
}
