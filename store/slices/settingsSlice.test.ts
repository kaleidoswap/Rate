import settings, { setAssetHiddenPreference } from './settingsSlice';

const hide = (walletId: number, assetKey: string, hidden = true) => setAssetHiddenPreference({ walletId, assetKey, hidden });

it('stores per-wallet visibility by exact asset key and tolerates settings from older builds', () => {
  const { hiddenAssetKeysByWallet: _visibility, ...olderSettings } = settings(undefined, { type: 'test' });
  const sharedId = 'token-id';
  const rgb = `asset:rgb:${sharedId}`;
  const spark = `asset:spark:${sharedId}`;
  const first = settings(olderSettings, hide(1, rgb));
  const second = settings(first, hide(2, spark));
  expect(second.hiddenAssetKeysByWallet).toEqual({ 1: [rgb], 2: [spark] });
  expect(settings(second, hide(1, rgb))).toBe(second);

  const restored = settings(second, hide(1, rgb, false));
  expect(restored.hiddenAssetKeysByWallet).toEqual({ 2: [spark] });
});
