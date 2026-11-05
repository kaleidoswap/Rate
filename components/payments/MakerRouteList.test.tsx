import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { MakerRouteList } from './MakerRouteList';
import type { MakerCatalog } from '../../services/makerRoutes';
const catalog: MakerCatalog = { url: 'https://maker.test', network: 'mutinynet', checkedAt: 1, halted: false, routes: [
  { id: 'ark', kind: 'submarine', from: 'Bitcoin · Arkade', to: 'Bitcoin · Lightning', pairId: 'ark', min: 10000, max: 100000, feePercent: 0.5, action: 'send-arkade' },
  { id: 'rgb', kind: 'reverse', from: 'Bitcoin · Lightning', to: 'USDT · RGB', pairId: 'rgb', min: 10000, max: 100000, feePercent: 1, reason: 'Native signing unavailable' },
] };
test('only executable routes have actions; other routes expand with a reason', () => {
  const choose = jest.fn(); const v = render(<MakerRouteList catalog={catalog} connected onChoose={choose} />);
  expect(v.queryByText('Native signing unavailable')).toBeNull();
  fireEvent.press(v.getByText('Show other routes (1)'));
  expect(v.getByText('Native signing unavailable')).toBeTruthy();
  fireEvent.press(v.getByText('Pay a Lightning invoice'));
  expect(choose).toHaveBeenCalledWith(catalog.routes[0]);
});
test('a disconnected wallet cannot enter execution', () => {
  const choose = jest.fn(); const v = render(<MakerRouteList catalog={catalog} connected={false} onChoose={choose} />);
  fireEvent.press(v.getByText('Connect Arkade on mutinynet'));
  expect(choose).not.toHaveBeenCalled();
});

test('fees stay available without opening or executing a route', () => {
  const choose = jest.fn(); const v = render(<MakerRouteList catalog={catalog} connected onChoose={choose} />);
  expect(v.queryByText(/Published range/)).toBeNull();
  fireEvent.press(v.getByLabelText('Fees and limits: Bitcoin · Arkade to Bitcoin · Lightning'));
  expect(v.getByText('Published range: 10,000–100,000 sats')).toBeTruthy();
  expect(choose).not.toHaveBeenCalled();
  fireEvent.press(v.getByText('Hide fees and limits −'));
  expect(v.queryByText(/Published range/)).toBeNull();
});

test('a saved request takes precedence over starting another swap, including offline', () => {
  const choose = jest.fn(), resume = jest.fn();
  const v = render(<MakerRouteList catalog={catalog} connected={false} onChoose={choose} onSavedRequest={resume} />);
  fireEvent.press(v.getByText('View saved request'));
  expect(resume).toHaveBeenCalledTimes(1);
  expect(choose).not.toHaveBeenCalled();
});
