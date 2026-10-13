jest.mock('./ArkadeExitSettings', () => ({ ArkadeExitSettings: () => null }));
jest.mock('../services/protocols/arkadeDiagnostics', () => ({ shareArkadeDiagnostics: jest.fn() }));
import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { ArkadeMaintenanceSettings } from './ArkadeMaintenanceSettings';
import { readArkadeHealth } from '../services/protocols/arkadeMaintenance';
jest.mock('../localization/useAppLanguage', () => ({ useAppLanguage: () => ({ language: 'en' }) }));
jest.mock('../services/protocols/arkadeMaintenance', () => ({ readArkadeHealth: jest.fn(), maintainArkade: jest.fn() }));
const props = { connected: true, busy: false, onSave: jest.fn(), onBusyChange: jest.fn() };
test('shows actual coverage and exposes details only on demand', async () => {
  (readArkadeHealth as jest.Mock).mockResolvedValue({ count: 2, expiring: 1, recoverable: '2000', subdust: '0', enabled: true, endpoint: 'https://delegate.arkade.money', eligible: 1, verified: 0, delegateFee: '0', persistent: true, coins: [] });
  const ui = render(<ArkadeMaintenanceSettings {...props} />);
  await act(async () => {});
  expect(ui.getByText('1 compatible · 0 with confirmed registration')).toBeTruthy();
  expect(ui.getByText('Recover funds')).toBeTruthy();
  expect(ui.queryByText('https://delegate.arkade.money')).toBeNull();
  fireEvent.press(ui.getByText('VTXO details'));
  expect(ui.getByText('https://delegate.arkade.money')).toBeTruthy();
  fireEvent(ui.getByLabelText('Offline delegation'), 'valueChange', false);
  expect(props.onSave).toHaveBeenCalledWith({ delegationEnabled: false });
});
test('read failure does not claim funds are safe or empty', async () => {
  (readArkadeHealth as jest.Mock).mockRejectedValue(new Error('Connection unavailable'));
  const ui = render(<ArkadeMaintenanceSettings {...props} />); await act(async () => {});
  expect(ui.getByText('Connection unavailable')).toBeTruthy();
  expect(ui.queryByText('Recoverable: 0 sats')).toBeNull();
});
