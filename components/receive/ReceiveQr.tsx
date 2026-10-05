import React, { useEffect, useState } from 'react';
import { ActivityIndicator, InteractionManager, Modal, Pressable, Text, View, useWindowDimensions } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { useAppTheme } from '../../theme/ThemeProvider';
import { feedback } from '../../utils/feedback';

/** Square, unobstructed modules and a white quiet zone for dense payment requests. Tap to enlarge. */
export const ReceiveQr = React.memo(function ReceiveQr({ value, size }: { value: string; size: number }) {
  const theme = useAppTheme();
  const { width, height } = useWindowDimensions();
  const [readyValue, setReadyValue] = useState('');
  const [enlarged, setEnlarged] = useState(false);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const work = InteractionManager.runAfterInteractions(() => {
      timer = setTimeout(() => setReadyValue(value), 0);
    });
    return () => { work.cancel(); if (timer) clearTimeout(timer); };
  }, [value]);
  // Never show the previous amount/destination while a replacement is queued.
  const ready = !!value && readyValue === value;
  const bigSize = Math.min(width, height) - theme.spacing[8] * 2;
  return <>
    <Pressable disabled={!ready} onPress={() => { feedback.select(); setEnlarged(true); }}
      accessibilityRole="button" accessibilityLabel="Enlarge payment code" accessibilityHint="Shows the code full screen for easier scanning"
      style={{ alignSelf: 'center', backgroundColor: '#FFFFFF', padding: theme.spacing[4], borderRadius: theme.borderRadius.xl }}>
      {ready ? <QRCode value={value} size={size} color="#000000" backgroundColor="#FFFFFF" ecl="M" />
        : <View accessibilityLabel="Preparing payment code" style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={theme.colors.primary[500]} />
        </View>}
    </Pressable>
    {ready && <Text style={{ alignSelf: 'center', marginTop: theme.spacing[1.5], color: theme.colors.text.tertiary, fontSize: theme.typography.fontSize.xs }}>
      Tap the code to enlarge
    </Text>}
    {/* Full screen on white: the largest, highest-contrast code for a scanner further away. */}
    <Modal visible={enlarged && ready} animationType="fade" statusBarTranslucent onRequestClose={() => setEnlarged(false)}>
      <Pressable onPress={() => setEnlarged(false)} accessibilityRole="button" accessibilityLabel="Close enlarged code"
        style={{ flex: 1, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', gap: theme.spacing[6] }}>
        {enlarged && ready && <QRCode value={value} size={bigSize} color="#000000" backgroundColor="#FFFFFF" ecl="M" />}
        <Text style={{ color: '#5F6368', fontSize: theme.typography.fontSize.sm }}>Tap anywhere to close</Text>
      </Pressable>
    </Modal>
  </>;
});
