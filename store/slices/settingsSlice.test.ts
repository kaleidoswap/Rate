import type { RootState } from '../index';
import settingsReducer, { selectHiddenHomeAssets, setHomeAssetHidden } from './settingsSlice';

const hide = (walletKey: string, assetKey: string, hidden = true) =>
  setHomeAssetHidden({ walletKey, assetKey, hidden });

test('home asset visibility is per wallet and reversible from persisted settings', () => {
  const initial = settingsReducer(undefined, { type: 'init' });
  const { hiddenHomeAssets, ...oldSettings } = initial;
  expect(selectHiddenHomeAssets({ settings: oldSettings } as RootState, '1:10')).toEqual([]);

  let settings = settingsReducer(oldSettings, hide('1:10', 'RGB:token'));
  settings = settingsReducer(settings, hide('1:10', 'RGB:token'));
  settings = settingsReducer(settings, hide('2:20', 'SPARK:token'));
  settings = JSON.parse(JSON.stringify(settings));
  expect(selectHiddenHomeAssets({ settings } as RootState, '1:10')).toEqual(['RGB:token']);
  expect(selectHiddenHomeAssets({ settings } as RootState, '2:20')).toEqual(['SPARK:token']);

  settings = settingsReducer(settings, hide('1:10', 'RGB:token', false));
  expect(selectHiddenHomeAssets({ settings } as RootState, '1:10')).toEqual([]);
  expect(selectHiddenHomeAssets({ settings } as RootState, '2:20')).toEqual(['SPARK:token']);
});
