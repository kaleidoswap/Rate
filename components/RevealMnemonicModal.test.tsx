import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { RevealMnemonicModal } from './RevealMnemonicModal';

jest.mock('../hooks/useScreenCaptureProtection', () => ({ useScreenCaptureProtection: jest.fn() }));

it('only mounts recovery words after tapping reveal on each opening', () => {
  const mnemonic = 'test-word-one test-word-two';
  const onClose = jest.fn();
  const modal = (visible: boolean) => <RevealMnemonicModal visible={visible} mnemonic={mnemonic} onClose={onClose} />;
  const screen = render(modal(true));

  expect(screen.queryByText('test-word-one', { includeHiddenElements: true })).toBeNull();
  expect(screen.queryByText('Copy to clipboard')).toBeNull();

  fireEvent.press(screen.getByLabelText('Tap to reveal recovery phrase'));
  expect(screen.getByText('test-word-one')).toBeTruthy();
  expect(screen.getByText('test-word-two')).toBeTruthy();
  expect(screen.getByText('Copy to clipboard')).toBeTruthy();

  screen.rerender(modal(false));
  screen.rerender(modal(true));
  expect(screen.queryByText('test-word-one', { includeHiddenElements: true })).toBeNull();
  fireEvent.press(screen.getByLabelText('Tap to reveal recovery phrase'));
  expect(screen.getByText('test-word-one')).toBeTruthy();

  fireEvent.press(screen.getByText('Done'));
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(screen.queryByText('test-word-one', { includeHiddenElements: true })).toBeNull();
});
