import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { EmptyState } from './EmptyState';

describe('EmptyState (kaleido-ui)', () => {
  it('renders title, message and a working action', () => {
    const onAction = jest.fn();
    const screen = render(<EmptyState icon="receipt-outline" title="Nothing yet" message="Payments show up here." actionLabel="Reset filters" onAction={onAction} />);
    expect(screen.getByText('Nothing yet')).toBeTruthy();
    expect(screen.getByText('Payments show up here.')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Reset filters'));
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('hides the action without a handler', () => {
    const screen = render(<EmptyState title="Empty" actionLabel="Do it" />);
    expect(screen.queryByLabelText('Do it')).toBeNull();
    expect(screen.queryByText('Do it')).toBeNull();
  });
});
