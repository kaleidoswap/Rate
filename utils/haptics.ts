// utils/haptics.ts
import * as Haptics from 'expo-haptics';

export const haptic = {
  /** Light tap — button press, toggle, selection change */
  light: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),

  /** Medium tap — confirming an action, completing a step */
  medium: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium),

  /** Heavy tap — destructive action, significant event */
  heavy: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy),

  /** Success — payment sent, invoice created, swap completed */
  success: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),

  /** Error — failed payment, validation error */
  error: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error),

  /** Warning — quote expiring, low balance */
  warning: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning),

  /** Selection tick — scrolling through a picker */
  selection: () => Haptics.selectionAsync(),
};
