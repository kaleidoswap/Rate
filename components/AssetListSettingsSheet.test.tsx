import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { FlatList } from 'react-native';
import { buildAssetListItems } from '../utils/asset-list-model';
import { AssetListSettingsSheet } from './AssetListSettingsSheet';

jest.mock('../localization/useAppLanguage', () => ({
  useAppLanguage: () => ({ t: (text: string) => text }),
}));

const assets = buildAssetListItems({
  btcAvailable: 0, showBtc: false, btcPriceUSD: 0,
  assets: [
    { asset_id: 'rgb:asset-one', ticker: 'USD', name: 'USD token', protocol: 'RGB', balance: 50 },
    { asset_id: 'btkn1asset-two', ticker: 'USD', name: 'USD token', protocol: 'SPARK', balance: 100 },
  ],
});

const setup = () => ({
  visible: true,
  onClose: jest.fn(),
  assets,
  query: '',
  onChangeQuery: jest.fn(),
  network: 'all' as const,
  onChangeNetwork: jest.fn(),
  showNetworks: true,
  hiddenAssetKeys: new Set<string>(),
  onToggleAsset: jest.fn(),
});

it('keeps controls offscreen until opened and lets the user limit the list by search or network', () => {
  const getAssets = jest.fn(() => assets);
  const props = { ...setup(), assets: getAssets };
  const ui = render(<AssetListSettingsSheet {...props} visible={false} />);
  expect(ui.queryByLabelText('Search assets')).toBeNull();
  expect(getAssets).not.toHaveBeenCalled();
  ui.rerender(<AssetListSettingsSheet {...props} />);
  expect(getAssets).toHaveBeenCalledTimes(1);
  fireEvent.changeText(ui.getByLabelText('Search assets'), 'USD');
  expect(props.onChangeQuery).toHaveBeenCalledWith('USD');
  fireEvent.press(ui.getByLabelText('Spark'));
  expect(props.onChangeNetwork).toHaveBeenCalledWith('spark');

  ui.rerender(<AssetListSettingsSheet {...props} network="spark" query="USD" />);
  expect(ui.queryByLabelText(/Show asset USD token, RGB/)).toBeNull();
  expect(ui.getByLabelText(/Show asset USD token, Spark/)).toBeTruthy();
  expect(getAssets).toHaveBeenCalledTimes(1);
});

it('toggles only the chosen asset even when two contracts share a ticker', () => {
  const props = setup();
  const ui = render(<AssetListSettingsSheet {...props} />);
  const rgbLabel = /Show asset USD token, RGB, rgb:asset-one/;
  const sparkLabel = /Show asset USD token, Spark, btkn1asset-two/;
  fireEvent(ui.getByLabelText(rgbLabel), 'valueChange', false);
  expect(props.onToggleAsset).toHaveBeenCalledWith('asset:rgb:rgb:asset-one', true);

  ui.rerender(<AssetListSettingsSheet {...props} hiddenAssetKeys={new Set(['asset:rgb:rgb:asset-one'])} />);
  expect(ui.getByLabelText(rgbLabel).props.value).toBe(false);
  expect(ui.getByLabelText(sparkLabel).props.value).toBe(true);
  fireEvent(ui.getByLabelText(rgbLabel), 'valueChange', true);
  expect(props.onToggleAsset).toHaveBeenLastCalledWith('asset:rgb:rgb:asset-one', false);
});

it('passes the full inventory to the virtualized list and can search every holding', () => {
  const inventory = buildAssetListItems({
    showBtc: false, btcAvailable: 0, btcPriceUSD: 0,
    assets: Array.from({ length: 200 }, (_, index) => ({
      asset_id: `rgb:contract-${index}`, ticker: `T${index}`, name: `Holding ${index}`, protocol: 'RGB', balance: index,
    })),
  });
  const props = { ...setup(), assets: inventory };
  const ui = render(<AssetListSettingsSheet {...props} />);
  expect(ui.UNSAFE_getByType(FlatList).props.data).toHaveLength(200);
  expect(ui.getByLabelText('Show asset Holding 0, RGB')).toBeTruthy();
  expect(ui.queryByLabelText('Show asset Holding 199, RGB')).toBeNull();
  expect(ui.getAllByRole('switch').length).toBeLessThan(25);

  ui.rerender(<AssetListSettingsSheet {...props} query="rgb:contract-199" />);
  expect(ui.getByLabelText('Show asset Holding 199, RGB')).toBeTruthy();
  expect(ui.getAllByRole('switch')).toHaveLength(1);
});
