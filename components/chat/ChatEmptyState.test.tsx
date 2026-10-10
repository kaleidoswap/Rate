import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import ChatEmptyState from './ChatEmptyState';

it('offers one setup action instead of unusable chat suggestions', () => {
  const setup = jest.fn();
  const screen = render(<ChatEmptyState needsSetup onSetup={setup} onSuggestion={jest.fn()} onContacts={jest.fn()} />);
  expect(screen.queryByText('Check my balance')).toBeNull();
  fireEvent.press(screen.getByLabelText('Set up Prismo'));
  expect(setup).toHaveBeenCalledTimes(1);
});
it('offers three relevant suggestions after setup', () => {
  const suggestion = jest.fn();
  const contacts = jest.fn();
  const screen = render(<ChatEmptyState onSuggestion={suggestion} onContacts={contacts} />);
  expect(screen.queryByLabelText('Set up Prismo')).toBeNull();
  expect(screen.queryByText('Create invoice')).toBeNull();
  fireEvent.press(screen.getByText('Check my balance'));
  expect(suggestion).toHaveBeenCalledWith("What's my balance?");
  fireEvent.press(screen.getByText('Pay a contact'));
  expect(contacts).toHaveBeenCalledTimes(1);
  fireEvent.press(screen.getByText('Receive bitcoin'));
  expect(suggestion).toHaveBeenCalledWith('Show my receive address');
});
