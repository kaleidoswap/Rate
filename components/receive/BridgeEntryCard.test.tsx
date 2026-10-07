import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { BridgeEntryCard } from './BridgeEntryCard';

let mockConfigured = true;
jest.mock('../../services/orchestra/client', () => ({ isOrchestraConfigured: () => mockConfigured }));
jest.mock('../../utils/feedback', () => ({ feedback: { select: () => {} } }));

test('opens the bridge from Receive', () => {
  mockConfigured = true;
  const onPress = jest.fn();
  const screen = render(<BridgeEntryCard onPress={onPress} />);
  expect(screen.getByText('Deposit from another chain')).toBeTruthy();
  fireEvent.press(screen.getByText('Deposit from another chain'));
  expect(onPress).toHaveBeenCalled();
});

test('is hidden when the bridge is not configured', () => {
  mockConfigured = false;
  const screen = render(<BridgeEntryCard onPress={jest.fn()} />);
  expect(screen.queryByText('Deposit from another chain')).toBeNull();
});
