import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { SegmentedTabs } from './SegmentedTabs';

const OPTIONS = [
  { key: 'all', label: 'All' },
  { key: 'send', label: 'Sent' },
] as const;

describe('SegmentedTabs', () => {
  it('renders every option label', () => {
    const { getByText } = render(
      <SegmentedTabs options={OPTIONS as any} value="all" onChange={jest.fn()} />
    );
    expect(getByText('All')).toBeTruthy();
    expect(getByText('Sent')).toBeTruthy();
  });

  it('marks the active option as selected for accessibility', () => {
    const { getByLabelText } = render(
      <SegmentedTabs options={OPTIONS as any} value="all" onChange={jest.fn()} />
    );
    expect(getByLabelText('All').props.accessibilityState).toEqual({ selected: true });
    expect(getByLabelText('Sent').props.accessibilityState).toEqual({ selected: false });
  });

  it('fires onChange with the tapped option key', () => {
    const onChange = jest.fn();
    const { getByLabelText } = render(
      <SegmentedTabs options={OPTIONS as any} value="all" onChange={onChange} />
    );
    fireEvent.press(getByLabelText('Sent'));
    expect(onChange).toHaveBeenCalledWith('send');
  });
});
