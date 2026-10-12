import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { BackupWordCheck, backupWordsMatch } from './BackupWordCheck';
const phrase = 'one two three four five six seven eight nine ten eleven twelve';
test('requires all three correct saved words and tolerates case and surrounding whitespace', () => {
  expect(backupWordsMatch(phrase, ['', '', ''])).toBe(false);
  expect(backupWordsMatch(phrase, ['three', 'seven', 'wrong'])).toBe(false);
  expect(backupWordsMatch(phrase, [' THREE ', 'seven', 'eleven'])).toBe(true);
  expect(backupWordsMatch('', ['', '', ''])).toBe(false);
});
test('answers are private inputs and changing a word preserves the other answers', () => {
  const onChange = jest.fn();
  const ui = render(<BackupWordCheck answers={['', 'seven', 'eleven']} onChange={onChange} />);
  expect(ui.getByLabelText('Word 3').props.secureTextEntry).toBe(true);
  fireEvent.changeText(ui.getByLabelText('Word 3'), 'three');
  expect(onChange).toHaveBeenCalledWith(['three', 'seven', 'eleven']);
});
