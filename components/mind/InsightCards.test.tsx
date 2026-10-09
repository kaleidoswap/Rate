import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';
import { InsightCards } from './InsightCards';
import type { Insight } from '../../services/insights';

const mockDismiss = jest.fn();
const mockBackup = jest.fn(async () => {});
let mockInsights: Insight[] = [];
jest.mock('../../hooks/useInsights', () => ({
  useInsights: () => ({ insights: mockInsights, dismiss: mockDismiss, backupNow: mockBackup }),
}));

const insight = (over: Partial<Insight>): Insight => ({
  key: 'low-fees', rule: 'low-fees', title: 'Network fees are low', message: 'Cheap now.', mood: 'happy', tone: 'info',
  action: { label: 'Send', do: { kind: 'navigate', screen: 'Send' } }, priority: 7, cooldownMs: 1, ...over,
});

beforeEach(() => jest.clearAllMocks());

test('nothing renders without insights', () => {
  mockInsights = [];
  expect(render(<InsightCards onAction={jest.fn()} />).toJSON()).toBeNull();
});

test('each card runs its single action or is dismissed', async () => {
  mockInsights = [insight({}), insight({ key: 'rgb-backup-failed', rule: 'rgb-backup-failed', title: 'RGB backup didn’t finish', action: { label: 'Back up now', do: { kind: 'backup-rgb' } } })];
  const onAction = jest.fn();
  const screen = render(<InsightCards onAction={onAction} />);
  await act(async () => { fireEvent.press(screen.getByText('Send')); });
  expect(onAction).toHaveBeenCalledWith({ kind: 'navigate', screen: 'Send' });
  await act(async () => { fireEvent.press(screen.getByText('Back up now')); });
  expect(mockBackup).toHaveBeenCalled();
  expect(onAction).toHaveBeenCalledTimes(1);
  fireEvent.press(screen.getByLabelText('Dismiss: Network fees are low'));
  expect(mockDismiss).toHaveBeenCalledWith('low-fees');
  expect(screen.getAllByLabelText(/Prismo/)).toHaveLength(2);
});
