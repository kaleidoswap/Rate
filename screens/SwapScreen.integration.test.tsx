import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import SwapScreen from './SwapScreen';
jest.mock('./MakerRoutesScreen', () => ({ unified, onOtherAssets }: any) => {
  const { Text, TouchableOpacity } = require('react-native');return <TouchableOpacity onPress={onOtherAssets}><Text>{unified ? 'Unified composer' : 'Old routes'}</Text></TouchableOpacity>;
});
jest.mock('./AssetSwapScreen', () => ({ navigation }: any) => {
  const { Text, TouchableOpacity } = require('react-native');return <TouchableOpacity onPress={navigation.goBack}><Text>Existing token executor</Text></TouchableOpacity>;
});
test('Swap opens the unified composer and preserves existing token flows in the same entry', () => {
  const v = render(<SwapScreen navigation={{}} />);fireEvent.press(v.getByText('Unified composer'));expect(v.getByText('Existing token executor')).toBeTruthy();fireEvent.press(v.getByText('Existing token executor'));expect(v.getByText('Unified composer')).toBeTruthy();
});
test('existing token prefill deep links retain their executor', () => {
  const v = render(<SwapScreen navigation={{}} route={{ params: { fromAsset: 'BTC', toAsset: 'TOK' } }} />);expect(v.getByText('Existing token executor')).toBeTruthy();
});
