import React from 'react';
import { View } from 'react-native';

/** Decorative waveform; the containing button supplies its accessible name. */
export function VoiceModeIcon({ color }: { color: string }) {
  return <View accessible={false} style={{ flexDirection: 'row', alignItems: 'center', gap: 2, height: 20 }}>
    {[8, 14, 20, 14, 8].map((height, i) => <View key={i} style={{ width: 3, height, borderRadius: 2, backgroundColor: color }} />)}
  </View>;
}
