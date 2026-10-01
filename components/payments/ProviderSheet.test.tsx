import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';
import { ProviderSheet } from './ProviderSheet';
jest.mock('../../theme/ThemeProvider', () => ({ useAppTheme: () => require('../../theme').theme }));
test('selects explicitly and disables unavailable or expired offers', () => {
  const select = jest.fn(), close = jest.fn();
  const options = ['live', 'expired', 'offline'].map(id => ({ id, name: id, amount: '101 sats', amountLabel: 'Total', detail: 'Fee 1 sat', expiresAt: id === 'expired' ? 1 : Date.now() + 10000, unavailable: id === 'offline' ? 'No liquidity' : undefined }));
  const screen = render(<ProviderSheet visible options={options} onSelect={select} onClose={close} />);
  fireEvent.press(screen.getByLabelText(/expired\. Total/)); fireEvent.press(screen.getByLabelText(/offline\. Total/));
  expect(select).not.toHaveBeenCalled(); fireEvent.press(screen.getByLabelText(/live\. Total/));
  expect(select).toHaveBeenCalledWith('live'); expect(close).toHaveBeenCalledTimes(1);
});
test('expires while the sheet remains open', () => {
  jest.useFakeTimers(); const select = jest.fn();
  const screen = render(<ProviderSheet visible options={[{ id: 'a', name: 'A', amount: '1', amountLabel: 'Total', detail: '', expiresAt: Date.now() + 1000 }]} onSelect={select} onClose={() => {}} />);
  act(() => { jest.advanceTimersByTime(2000); });
  fireEvent.press(screen.getByLabelText(/A\. Total/)); expect(select).not.toHaveBeenCalled();
  screen.unmount(); jest.useRealTimers();
});
