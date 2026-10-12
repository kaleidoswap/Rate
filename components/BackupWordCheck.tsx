import React from 'react';
import { View, Text } from 'react-native';
import { Input } from './Input';
import { useAppTheme } from '../theme/ThemeProvider';

export const BACKUP_WORD_POSITIONS = [2, 6, 10] as const;
export const backupWordsMatch = (phrase: string, answers: string[]) => {
  const words = phrase.trim().toLowerCase().split(/\s+/);
  return words.length >= 12 && BACKUP_WORD_POSITIONS.every((position, i) =>
    answers[i]?.trim().toLowerCase() === words[position]);
};

/** Answers stay in screen memory only: never persist, log or include them in analytics. */
export function BackupWordCheck({ answers, onChange }: { answers: string[]; onChange: (answers: string[]) => void }) {
  const t = useAppTheme();
  return <View style={{ gap: t.spacing[3] }}>
    <Text style={{ color: t.colors.text.secondary, fontSize: t.typography.fontSize.base }}>
      Check your saved copy and enter these three words. Keep your recovery phrase private.
    </Text>
    {BACKUP_WORD_POSITIONS.map((position, index) => <Input key={position}
      label={`Word ${position + 1}`} value={answers[index] ?? ''}
      onChangeText={value => onChange(answers.map((answer, i) => i === index ? value : answer))}
      autoCapitalize="none" autoCorrect={false} spellCheck={false} secureTextEntry
      textContentType="none" autoComplete="off" placeholder="Enter the saved word" />)}
  </View>;
}
