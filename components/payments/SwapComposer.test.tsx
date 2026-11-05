import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';
import { SwapComposer } from './SwapComposer';
const market: any = { base_asset: { id: 'btc' }, quote_asset: { id: 'btc' }, quote_corridor: 'lightning', fee_bps: 50, min_base_amount: '10000', max_base_amount: '1000000', min_quote_amount: '10000', max_quote_amount: '1000000' };
const send: any = { id: 's', kind: 'submarine', fromAsset: 'ARKD', toAsset: 'BTC', action: 'send-arkade', min: 10000, max: 1000000, intentsMarket: market };
const receive: any = { ...send, id: 'r', kind: 'reverse', fromAsset: 'BTC', toAsset: 'ARKD', action: 'receive-arkade' };
const props = { catalog: { routes: [send, receive] } as any, amount: '10000', onAmount: jest.fn(), onRoute: jest.fn(), onReview: jest.fn(), busy: false, connected: true };
beforeEach(() => jest.clearAllMocks());
test('review requires an invoice for Arkade to Lightning and never runs while editing', () => {
  const v = render(<SwapComposer {...props} />);
  expect(v.getByText('Estimated fee 51 sats')).toBeTruthy();
  fireEvent.press(v.getByText('Review swap')); expect(props.onReview).not.toHaveBeenCalled();
  fireEvent.changeText(v.getByLabelText('Swap Lightning invoice'), 'lntbs-test');
  expect(props.onReview).not.toHaveBeenCalled();
  fireEvent.press(v.getByText('Review swap')); expect(props.onReview).toHaveBeenCalledWith(send, 'lntbs-test');
});
test('direction reversal selects receive and removes stale invoice data', () => {
  const v = render(<SwapComposer {...props} />);
  fireEvent.changeText(v.getByLabelText('Swap Lightning invoice'), 'old');
  fireEvent.press(v.getByLabelText('Reverse swap direction'));
  expect(v.queryByLabelText('Swap Lightning invoice')).toBeNull();
  fireEvent.press(v.getByText('Review swap')); expect(props.onReview).toHaveBeenCalledWith(receive, '');
});
test('a pending request or offline wallet cannot create another swap', () => {
  const v = render(<SwapComposer {...props} savedRequest />);fireEvent.press(v.getByLabelText('Reverse swap direction'));fireEvent.press(v.getByText('Review swap'));expect(props.onReview).not.toHaveBeenCalled();
  v.rerender(<SwapComposer {...props} connected={false} />);fireEvent.press(v.getByText('Review swap'));expect(props.onReview).not.toHaveBeenCalled();
});
test('asset and network selections do not enable unsupported combinations', () => {
  const v = render(<SwapComposer {...props} />);
  fireEvent.press(v.getByLabelText('From asset: Bitcoin'));
  fireEvent.press(v.getByLabelText('Select from asset USDT'));
  expect(v.getByLabelText('From network: Liquid')).toBeTruthy();
  expect(v.getByText('This asset and network combination is not available.')).toBeTruthy();
  fireEvent.press(v.getByText('Review swap'));expect(props.onReview).not.toHaveBeenCalled();
});
