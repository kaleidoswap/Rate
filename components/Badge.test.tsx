import React from 'react';
import { render } from '@testing-library/react-native';
import { Badge } from './Badge';

describe('Badge', () => {
  it('renders its label', () => {
    const { getByText } = render(<Badge label="RGB" />);
    expect(getByText('RGB')).toBeTruthy();
  });

  it('accepts an explicit accent color (protocol tag)', () => {
    const { getByText } = render(<Badge label="SPARK" color="#60A5FA" />);
    expect(getByText('SPARK')).toBeTruthy();
  });

  it('exposes its label for accessibility', () => {
    const { getByLabelText } = render(<Badge label="Public" tone="primary" />);
    expect(getByLabelText('Public')).toBeTruthy();
  });
});
