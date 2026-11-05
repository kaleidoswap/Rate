import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { SwapRouteSummary } from './SwapRouteSummary';
const props = { provider: 'KaleidoSwap', route: 'Lightning → RGB Lightning', fee: '0.15 USDT', rate: '1 BTC ≈ 62,000 USDT', secondsLeft: 20, offerCount: 1, onCompare: jest.fn() };
test('keeps route and fee visible without a redundant single-provider picker', () => {
  const view = render(<SwapRouteSummary {...props} />);
  expect(view.getByText(props.route)).toBeTruthy();
  expect(view.getByText(props.fee)).toBeTruthy();
  expect(view.queryByLabelText('Compare swap providers')).toBeNull();
  expect(view.queryByText(props.rate)).toBeNull();
  fireEvent.press(view.getByText('Quote details'));
  expect(view.getByText(props.rate)).toBeTruthy();
  view.rerender(<SwapRouteSummary {...props} secondsLeft={0} offerCount={2} />);
  expect(view.getByText('Quote expired — refresh before confirming')).toBeTruthy();
  fireEvent.press(view.getByLabelText('Compare swap providers'));
  expect(props.onCompare).toHaveBeenCalledTimes(1);
});
