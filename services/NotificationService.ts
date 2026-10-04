// services/NotificationService.ts
//
// Local (on-device) OS notifications for incoming chat messages and payments.
// These fire while the app is running or briefly backgrounded. With the app
// closed, payments to a kaleidoswap.me Lightning address arrive as real pushes:
// the app registers its Expo push token with the registry (see
// services/paymentNotifications.ts), which pushes on the `payments` channel.
// In-app toasts (ToastService) cover the foreground case.
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

export const PAYMENTS_CHANNEL = 'payments';

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
        // Remote pushes from kaleidoswap.me name this channel; local ones use it too.
        await Notifications.setNotificationChannelAsync(PAYMENTS_CHANNEL, {
          name: 'Payments received',
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

  /** Whether notifications are allowed (asks once when they aren't decided yet). */
  async ensurePermission(): Promise<boolean> {
    if (!this.initialized) await this.init();
    return this.permissionGranted;
  }

  /**
   * This device's Expo push token, for kaleidoswap.me payment pushes. Null on a
   * simulator, without permission, or when the build has no push credentials.
   */
  async getPushToken(): Promise<string | null> {
    try {
      if (!(await this.ensurePermission())) return null;
      const Notifications = getNotifications();
      if (!Notifications) return null;
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Constants = require('expo-constants').default;
      const projectId = Constants?.expoConfig?.extra?.eas?.projectId ?? Constants?.easConfig?.projectId;
      const { data } = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
      return typeof data === 'string' ? data : null;
    } catch (error) {
      console.warn('NotificationService: no push token', error);
      return null;
    }
  }

  /** Fire a local notification immediately. No-op without permission. */
  private async notify(title: string, body: string, data?: Record<string, any>, channelId?: string): Promise<void> {
    try {
      if (!this.initialized) await this.init();
      if (!this.permissionGranted) return;
      const Notifications = getNotifications();
      if (!Notifications) return;
      await Notifications.scheduleNotificationAsync({
        content: { title, body, data: data ?? {}, sound: true },
        // Android: deliver now on the given channel; iOS: deliver now.
        trigger: channelId && Platform.OS === 'android' ? { channelId } as any : null,
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

  /** Money arrived: "You received 21,000 sats in Spark". */
  async notifyPaymentReceived(body: string, data?: Record<string, any>): Promise<void> {
    await this.notify('Payment received', body, { type: 'payment-received', ...data }, PAYMENTS_CHANNEL);
  }

  /** A payment-related event in the chat (e.g. a payment you sent succeeded). */
  async notifyPayment(title: string, body: string, pubkey?: string): Promise<void> {
    await this.notify(title, body, { type: 'payment', pubkey });
  }
}

export default NotificationService;
