import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { Clipboard } from 'react-native';
import { ReceiveRequestActions } from './ReceiveRequestActions';
jest.mock('../../utils/feedback', () => ({ feedback: { select: jest.fn() } }));
const share = jest.fn();
beforeEach(() => {
  jest.useFakeTimers(); jest.clearAllMocks();
  (require('react-native') as any).Share = { share };
  share.mockResolvedValue({ action: 'sharedAction' });
  (Clipboard.setString as jest.Mock).mockResolvedValue(undefined);
});
afterEach(() => jest.useRealTimers());
test('copies and shares exactly the current request, resetting feedback on method changes', async () => {
  const screen = render(<ReceiveRequestActions value="bitcoin:first" />);
  await act(async () => { fireEvent.press(screen.getByLabelText('Copy Payment request')); });
  expect(Clipboard.setString).toHaveBeenCalledWith('bitcoin:first');
  expect(screen.getByText('Copied')).toBeTruthy();
  screen.rerender(<ReceiveRequestActions value="spark:second" label="Spark" />);
  expect(screen.queryByText('Copied')).toBeNull();
  await act(async () => { fireEvent.press(screen.getByLabelText('Share Spark')); });
  expect(share).toHaveBeenCalledWith({ message: 'spark:second', title: 'Spark' });
});
test('copy failure leaves a recoverable error and does not claim success', async () => {
  (Clipboard.setString as jest.Mock).mockRejectedValueOnce(new Error('clipboard unavailable'));
  const screen = render(<ReceiveRequestActions value="request" />);
  await act(async () => { fireEvent.press(screen.getByLabelText('Copy Payment request')); });
  expect(screen.getByText(/Could not copy/)).toBeTruthy();
  expect(screen.queryByText('Copied')).toBeNull();
  await act(async () => { fireEvent.press(screen.getByLabelText('Copy Payment request')); });
  expect(screen.queryByText(/Could not copy/)).toBeNull();
  expect(screen.getByText('Copied')).toBeTruthy();
});
test('late copy completion cannot label a different request as copied', async () => {
  let complete!: () => void;
  (Clipboard.setString as jest.Mock).mockReturnValueOnce(new Promise<void>(resolve => { complete = resolve; }));
  const screen = render(<ReceiveRequestActions value="old" />);
  fireEvent.press(screen.getByLabelText('Copy Payment request'));
  screen.rerender(<ReceiveRequestActions value="new" />);
  await act(async () => { complete(); });
  expect(screen.queryByText('Copied')).toBeNull();
});
test('share failure is visible and full addresses are available on demand', async () => {
  share.mockRejectedValueOnce(new Error('sharing unavailable'));
  const value = 'spark:' + 'a'.repeat(80);
  const screen = render(<ReceiveRequestActions value={value} label="Spark" showValue />);
  expect(screen.queryByText(value)).toBeNull();
  fireEvent.press(screen.getByLabelText('Show full Spark'));
  expect(screen.getByText(value)).toBeTruthy();
  await act(async () => { fireEvent.press(screen.getByLabelText('Share Spark')); });
  expect(screen.getByText(/Could not share/)).toBeTruthy();
});
