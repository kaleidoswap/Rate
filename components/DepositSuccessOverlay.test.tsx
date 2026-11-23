import React from 'react';
import { Animated } from 'react-native';
beforeEach(() => { jest.spyOn(Animated, 'timing').mockReturnValue({ start: jest.fn(), stop: jest.fn(), reset: jest.fn() }); });
import { render, fireEvent } from '@testing-library/react-native';
import DepositSuccessOverlay from './DepositSuccessOverlay';
jest.mock('../localization/useAppLanguage', () => ({ useAppLanguage: () => ({ language: 'en' }) }));
test('shows asset, amount and destination separately with working actions', () => {
  const done = jest.fn(); const activity = jest.fn();
  const ui = render(<DepositSuccessOverlay visible ticker="BTC" amountLabel="5,000 sats" amountIsBalanceChange account="Arkade" network="Ark" onDone={done} onActivity={activity} />);
  for (const text of ['+5,000 sats', 'BTC', 'Arkade', 'Ark', 'Detected balance increase']) expect(ui.getByText(text)).toBeTruthy();
  fireEvent.press(ui.getByText('Done')); fireEvent.press(ui.getByText('View in Activity'));
  expect(done).toHaveBeenCalledTimes(1); expect(activity).toHaveBeenCalledTimes(1);
});
test('missing actual amount is explicit', () => {
  const ui = render(<DepositSuccessOverlay visible ticker="BTC" account="Spark" network="Bitcoin L1" onDone={jest.fn()} />);
  expect(ui.getByText('See Activity for the amount')).toBeTruthy();
  expect(ui.queryByText('Detected balance increase')).toBeNull();
});
test('offers the first RGB backup and restores the activity action after success', () => {
  const actions = { onBackup: jest.fn(), onActivity: jest.fn(), onDone: jest.fn() };
  const ui = render(<DepositSuccessOverlay visible ticker="USDT" backup={{ state: 'idle' }} {...actions} />);
  fireEvent.press(ui.getByText('Back up RGB data'));
  expect(actions.onBackup).toHaveBeenCalledTimes(1);
  ui.rerender(<DepositSuccessOverlay visible ticker="USDT" backup={{ state: 'done', lastBackupAt: 123 }} {...actions} />);
  expect(ui.queryByText('Back up RGB data')).toBeNull();
  expect(ui.getByText('View in Activity')).toBeTruthy();
});
