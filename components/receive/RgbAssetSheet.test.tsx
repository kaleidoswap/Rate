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

test('a specific asset by contract ID, validated', () => {
  const { screen, onPickAsset } = setup();
  fireEvent.press(screen.getByText('A specific asset'));
  fireEvent.changeText(screen.getByLabelText('Contract ID'), 'nope');
  expect(screen.getByText('This isn’t an RGB contract ID. It starts with rgb:')).toBeTruthy();
  fireEvent.changeText(screen.getByLabelText('Contract ID'), ' rgb:2bFVTT9e-xUBBnkF-Pqnxb6Q-ZuDGdNd-iC5l8cC-dgPFjn8 ');
  fireEvent.press(screen.getByText('Receive this asset'));
  expect(onPickAsset).toHaveBeenCalledWith({ asset_id: 'rgb:2bFVTT9e-xUBBnkF-Pqnxb6Q-ZuDGdNd-iC5l8cC-dgPFjn8', ticker: 'RGB', name: 'rgb:2bFVTT9e…gPFjn8' });
});

test('assets the wallet holds are listed', () => {
  const { screen, onPickAsset } = setup();
  fireEvent.press(screen.getByText('USDT'));
  expect(onPickAsset).toHaveBeenCalledWith(held[0]);
});
