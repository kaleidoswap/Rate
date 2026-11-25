import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { RgbAssetSheet } from './RgbAssetSheet';
import { ANY_RGB_ASSET_ID } from '../../utils/rgb-receive';

const held = [{ asset_id: 'rgb:CJkb4YZw-jRiz2sk-~PARPio-wtVYI1c-XAEYCqO-wTfvRZ8', ticker: 'USDT', name: 'Tether' }];

function setup() {
  const props = { onClose: jest.fn(), onPickAny: jest.fn(), onPickAsset: jest.fn() };
  const screen = render(<RgbAssetSheet visible accountLabel="RGB on this phone" held={held} selectedAssetId={ANY_RGB_ASSET_ID} {...props} />);
  return { screen, ...props };
}

test('any RGB asset is one plain tap', () => {
  const { screen, onPickAny, onClose } = setup();
  expect(screen.getByText('Received on-chain into RGB on this phone')).toBeTruthy();
  const any = screen.getByRole('radio', { name: /Any RGB asset/, checked: true });
  fireEvent.press(any);
  expect(onPickAny).toHaveBeenCalled();
  expect(onClose).toHaveBeenCalled();
});


test('only Any and the exact assets the wallet holds are listed', () => {
  const { screen, onPickAsset } = setup();
  expect(screen.getAllByRole('radio')).toHaveLength(2);
  expect(screen.queryByText('A specific asset')).toBeNull();
  expect(screen.queryByLabelText('Contract ID')).toBeNull();
  fireEvent.press(screen.getByRole('radio', { name: /USDT.*Tether/, checked: false }));
  expect(onPickAsset).toHaveBeenCalledWith(held[0]);
});
