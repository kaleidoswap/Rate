import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { PersistenceLoading } from './PersistenceLoading';
import { recoverPersistence } from '../store/persistenceRecovery';
jest.mock('./brand/BrandLoading', () => ({ BrandLoading: () => null }));

it('shows a recoverable storage error and retries from the button', async () => {
  const operation = jest.fn().mockRejectedValueOnce(new Error('unavailable')).mockResolvedValueOnce('saved');
  const screen = render(<PersistenceLoading />);
  let result!: Promise<string>;
  await act(async () => { result = recoverPersistence(operation); });
  await waitFor(() => expect(screen.getByText('Secure storage unavailable')).toBeTruthy());
  fireEvent.press(screen.getByLabelText('Retry security update'));
  await act(async () => { await expect(result).resolves.toBe('saved'); });
  expect(operation).toHaveBeenCalledTimes(2);
  expect(screen.toJSON()).toBeNull();
});
