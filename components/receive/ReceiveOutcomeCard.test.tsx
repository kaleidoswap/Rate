import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { ReceiveOutcomeCard } from './ReceiveOutcomeCard';
test('expired requests offer regeneration, not copy or share', () => {
  const fresh = jest.fn();
  const ui = render(<ReceiveOutcomeCard status="expired" onRefresh={fresh} />);
  fireEvent.press(ui.getByText('Create a fresh request'));
  expect(fresh).toHaveBeenCalledTimes(1);
  expect(ui.queryByText('Copy request')).toBeNull();
  expect(ui.queryByText('Share')).toBeNull();
});
test('a detected payment waits without offering another request', () => {
  const ui = render(<ReceiveOutcomeCard status="pending" onRefresh={jest.fn()} onActivity={jest.fn()} hint="Keep the app open" />);
  expect(ui.getByText(/sender does not need/)).toBeTruthy();
  expect(ui.queryByText('New request')).toBeNull();
  expect(ui.queryByText('Create a fresh request')).toBeNull();
  expect(ui.getByText('Keep the app open')).toBeTruthy();
});
test('confirmed payments offer activity and a new request', () => {
  const activity = jest.fn();
  const ui = render(<ReceiveOutcomeCard status="confirmed" onActivity={activity} onRefresh={jest.fn()} />);
  fireEvent.press(ui.getByText('View in Activity'));
  expect(activity).toHaveBeenCalledTimes(1);
  expect(ui.getByText('New request')).toBeTruthy();
});
