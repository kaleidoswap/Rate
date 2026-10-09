import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { MindCharacter, MindCharacterBadge } from './MindCharacter';
import { MIND_MOODS } from './mindMood';

describe('MindCharacter', () => {
  it.each(MIND_MOODS)('renders the %s mood', (mood) => {
    const screen = render(<MindCharacter mood={mood} />);
    expect(screen.getByLabelText(new RegExp('^Prismo, '))).toBeTruthy();
    screen.unmount();
  });

  it.each(MIND_MOODS)('renders the %s mood statically and small', (mood) => {
    const screen = render(<MindCharacter mood={mood} size={24} animated={false} level={0.5} />);
    expect(screen.toJSON()).toBeTruthy();
  });

  it('accepts a shared value level and moves between moods', () => {
    const level = { value: 0.4 } as any;
    const screen = render(<MindCharacter mood="listening" level={level} />);
    screen.rerender(<MindCharacter mood="speaking" level={level} />);
    screen.rerender(<MindCharacter mood="happy" level={level} paused />);
    expect(screen.getByLabelText('Prismo, happy')).toBeTruthy();
  });

  it('is a button when pressable', () => {
    const onPress = jest.fn();
    const screen = render(<MindCharacter mood="idle" onPress={onPress} accessibilityLabel="Talk to Prismo" />);
    fireEvent.press(screen.getByLabelText('Talk to Prismo'));
    expect(onPress).toHaveBeenCalled();
  });
});

describe('MindCharacterBadge', () => {
  it('renders full color and monochrome tab variants', () => {
    expect(render(<MindCharacterBadge accessibilityLabel="Prismo" />).getByLabelText('Prismo')).toBeTruthy();
    expect(render(<MindCharacterBadge color="#fff" focused accessibilityLabel="Mind" />).getByLabelText('Mind')).toBeTruthy();
    expect(render(<MindCharacterBadge color="#fff" mood="sleeping" size={60} />).toJSON()).toBeTruthy();
  });
});
