import React from 'react';
import { render } from '@testing-library/react-native';
import { Callout } from './Callout';

describe('Callout (kaleido-ui AlertBanner)', () => {
  it('renders title, message and children with the alert role', () => {
    const screen = render(<Callout tone="error" title="Failed" message="Try again.">{null}</Callout>);
    expect(screen.getByText('Failed')).toBeTruthy();
    expect(screen.getByText('Try again.')).toBeTruthy();
    expect(screen.UNSAFE_root.findAll((n) => n.props.accessibilityRole === 'alert').length).toBeGreaterThan(0);
  });
});
