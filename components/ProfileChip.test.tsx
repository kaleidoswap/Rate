import React from 'react';
import { Text } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import { ProfileChip } from './ProfileChip';

function textOrder(root: ReturnType<typeof render>) {
  return root.UNSAFE_getAllByType(Text).map((t) => String(t.props.children));
}

describe('ProfileChip', () => {
  it('shows the greeting above the name', () => {
    const view = render(
      <ProfileChip
        profile={{ display_name: 'Alice', name: 'alice' } as any}
        hasIdentity
        greeting="Good morning"
        onPress={jest.fn()}
      />,
    );
    const order = textOrder(view);
    expect(order.indexOf('Good morning')).toBeGreaterThanOrEqual(0);
    expect(order.indexOf('Good morning')).toBeLessThan(order.indexOf('Alice'));
  });

  it('falls back to the profile name, then to a prompt', () => {
    expect(render(<ProfileChip profile={{ name: 'bob' } as any} hasIdentity onPress={jest.fn()} />).getByText('bob')).toBeTruthy();
    expect(render(<ProfileChip hasIdentity onPress={jest.fn()} />).getByText('Add your name')).toBeTruthy();
    expect(render(<ProfileChip hasIdentity={false} onPress={jest.fn()} />).getByText('Set up profile')).toBeTruthy();
  });

  it('opens on press', () => {
    const onPress = jest.fn();
    const { getByLabelText } = render(<ProfileChip hasIdentity={false} onPress={onPress} />);
    fireEvent.press(getByLabelText('Set up your profile'));
    expect(onPress).toHaveBeenCalled();
  });
});
