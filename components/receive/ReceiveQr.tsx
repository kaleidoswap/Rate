import React, { useEffect, useState } from 'react';
import { ActivityIndicator, InteractionManager, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { useAppTheme } from '../../theme/ThemeProvider';

/** Square, unobstructed modules and a white quiet zone for dense payment requests. */
export const ReceiveQr = React.memo(function ReceiveQr({ value, size }: { value: string; size: number }) {
  const theme = useAppTheme();
  const [readyValue, setReadyValue] = useState('');
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const work = InteractionManager.runAfterInteractions(() => {
      timer = setTimeout(() => setReadyValue(value), 0);
    });
    return () => { work.cancel(); if (timer) clearTimeout(timer); };
  }, [value]);
  // Never show the previous amount/destination while a replacement is queued.
  const ready = !!value && readyValue === value;
  return <View style={{ alignSelf: 'center', backgroundColor: '#FFFFFF', padding: theme.spacing[4], borderRadius: theme.borderRadius.xl }}>
    {ready ? <QRCode value={value} size={size} color="#000000" backgroundColor="#FFFFFF" ecl="M" />
      : <View accessibilityLabel="Preparing payment code" style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={theme.colors.primary[500]} />
      </View>}
  </View>;
});
