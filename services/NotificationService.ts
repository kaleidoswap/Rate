// services/NotificationService.ts
//
// Local (on-device) OS notifications for incoming chat messages and payments.
// These fire while the app is running or briefly backgrounded — true push
// (app fully killed) would need a relay-watching server with APNs/FCM, which is
// out of scope here. In-app toasts (ToastService) cover the foreground case;
// this adds the system banner.
//
// IMPORTANT: `expo-notifications` is imported LAZILY (not at module top level).
// Its `PushTokenManager` does `requireNativeModule('ExpoPushTokenManager')` at
// import time, which THROWS on a dev client / binary that wasn't built with the
// expo-notifications native module ("Cannot find native module
// 'ExpoPushTokenManager'"). A static `import` would crash the whole app at boot
// before any try/catch could run. Notifications are best-effort, so instead we
// require the module on first use and degrade to a no-op when it's unavailable.
// (To actually receive notifications, rebuild the dev client: `expo run:ios` /
// `expo run:android` so the native module is included.)
import { Platform } from 'react-native';

// Minimal shape we use from expo-notifications (kept loose; module is `any`).
type NotificationsModule = typeof import('expo-notifications');

let cachedModule: NotificationsModule | null | undefined;

/**
 * Lazily load expo-notifications, returning null if its native module isn't
 * present in this build. Result is cached (including the null/unavailable case)
 * so we only pay the require + warn once.
 */
function getNotifications(): NotificationsModule | null {
  if (cachedModule !== undefined) return cachedModule;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cachedModule = require('expo-notifications') as NotificationsModule;
  } catch (error) {
    cachedModule = null;
    console.warn(
      'NotificationService: expo-notifications native module unavailable — ' +
        'local notifications disabled. Rebuild the dev client to enable them.',
      error
    );
  }
  return cachedModule;
}

class NotificationService {
  private static instance: NotificationService;
  private initialized = false;
  private permissionGranted = false;

  static getInstance(): NotificationService {
    if (!NotificationService.instance) {
      NotificationService.instance = new NotificationService();
    }
    return NotificationService.instance;
  }

  /**
   * Set the foreground presentation behaviour, request permission, and create
   * the Android channel. Safe to call multiple times; only runs once. Never
   * throws — notifications are best-effort and a no-op when the native module
   * isn't available.
   */
  async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    const Notifications = getNotifications();
    if (!Notifications) return;
    try {
      Notifications.setNotificationHandler({
        handleNotification: async () => ({
          shouldShowBanner: true,
          shouldShowList: true,
          shouldPlaySound: true,
          shouldSetBadge: true,
        }),
      });

      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('messages', {
          name: 'Messages & Payments',
          importance: Notifications.AndroidImportance.HIGH,
          vibrationPattern: [0, 120, 80, 120],
          lightColor: '#2BEE79',
        });
      }

      const settings = await Notifications.getPermissionsAsync();
      let status = settings.status;
      if (status !== 'granted') {
        status = (await Notifications.requestPermissionsAsync()).status;
      }
      this.permissionGranted = status === 'granted';
    } catch (error) {
      console.warn('NotificationService: init failed', error);
    }
  }

  /** Fire a local notification immediately. No-op without permission. */
  private async notify(title: string, body: string, data?: Record<string, any>): Promise<void> {
    try {
      if (!this.initialized) await this.init();
      if (!this.permissionGranted) return;
      const Notifications = getNotifications();
      if (!Notifications) return;
      await Notifications.scheduleNotificationAsync({
        content: { title, body, data: data ?? {}, sound: true },
        trigger: null, // deliver now
      });
    } catch (error) {
      console.warn('NotificationService: notify failed', error);
    }
  }

  /** An incoming chat message from `sender`. `pubkey` lets a tap deep-link later. */
  async notifyMessage(sender: string, preview: string, pubkey: string): Promise<void> {
    const body = preview.length > 140 ? `${preview.slice(0, 137)}…` : preview;
    await this.notify(sender || 'New message', body, { type: 'chat', pubkey });
  }

  /** A payment-related event in the chat (e.g. a payment you sent succeeded). */
  async notifyPayment(title: string, body: string, pubkey?: string): Promise<void> {
    await this.notify(title, body, { type: 'payment', pubkey });
  }
}

export default NotificationService;
