import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { RgbAssetSheet } from './RgbAssetSheet';

const held = [{ asset_id: 'rgb:CJkb4YZw-jRiz2sk-~PARPio-wtVYI1c-XAEYCqO-wTfvRZ8', ticker: 'USDT', name: 'Tether' }];

function setup() {
  const props = { onClose: jest.fn(), onPickAny: jest.fn(), onPickAsset: jest.fn() };
  const screen = render(<RgbAssetSheet visible accountLabel="RGB on this phone" held={held} {...props} />);
  return { screen, ...props };
}

test('any RGB asset is one plain tap', () => {
  const { screen, onPickAny, onClose } = setup();
  expect(screen.getByText('Received on-chain into RGB on this phone')).toBeTruthy();
  fireEvent.press(screen.getByText('Any RGB asset'));
  expect(onPickAny).toHaveBeenCalled();
  expect(onClose).toHaveBeenCalled();
});


test('assets the wallet holds are listed', () => {
  const { screen, onPickAsset } = setup();
  fireEvent.press(screen.getByText('USDT'));
  expect(onPickAsset).toHaveBeenCalledWith(held[0]);
});
