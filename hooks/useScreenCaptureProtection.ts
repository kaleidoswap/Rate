// hooks/useScreenCaptureProtection.ts
//
// While `active`, block screenshots and screen recording (Android FLAG_SECURE,
// iOS capture blanking) and blur the iOS app-switcher snapshot. Used wherever a
// recovery phrase is on screen. Keyed per hook instance so overlapping screens
// don't re-enable capture for each other.
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import * as ScreenCapture from 'expo-screen-capture';

let nextKey = 0;

export function useScreenCaptureProtection(active: boolean): void {
  const key = useRef(`seed-${nextKey++}`).current;

  useEffect(() => {
    if (!active) return;
    // Best effort: a failure here must never block showing the backup.
    ScreenCapture.preventScreenCaptureAsync(key).catch(() => {});
    if (Platform.OS === 'ios') {
      ScreenCapture.enableAppSwitcherProtectionAsync().catch(() => {});
    }
    return () => {
      ScreenCapture.allowScreenCaptureAsync(key).catch(() => {});
      if (Platform.OS === 'ios') {
        ScreenCapture.disableAppSwitcherProtectionAsync().catch(() => {});
      }
    };
  }, [active, key]);
}
