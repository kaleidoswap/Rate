import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { AccountSettings } from './AccountSettings';
jest.mock('../services/DatabaseService', () => ({ __esModule: true, default: { getInstance: () => ({ getWalletNetworks: async () => [{ type: 'arkade', config: JSON.stringify({ arkServerUrl: 'https://existing.example', esploraUrl: 'https://explorer.example/api' }) }] }) } }));
jest.mock('../services/protocols/barkPreferences', () => ({ currentBarkHost: () => null }));
test('loads persisted endpoints and saves validated changes; reset is only a draft until saved', async () => {
  const onSave = jest.fn();
  const screen = render(<AccountSettings account="ARKADE" walletId={1} network="signet" connected busy={false} onNetwork={jest.fn()} onReconnect={jest.fn()} onSave={onSave} />);
  await act(async () => {});
  expect(screen.getByLabelText('Ark server URL').props.value).toBe('https://existing.example');
  fireEvent.changeText(screen.getByLabelText('Ark server URL'), ' https://new.example/ ');
  fireEvent.press(screen.getByText('Save and reconnect'));
  expect(onSave).toHaveBeenLastCalledWith({ arkServerUrl: 'https://new.example', esploraUrl: 'https://explorer.example/api' });
  onSave.mockClear();
  fireEvent.press(screen.getByText('Use network defaults'));
  expect(onSave).not.toHaveBeenCalled();
  fireEvent.press(screen.getByText('Save and reconnect'));
  expect(onSave).toHaveBeenCalledWith({ arkServerUrl: 'https://mutinynet.arkade.sh', esploraUrl: undefined });
});
