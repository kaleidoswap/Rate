// services/paymentNotifications.ts
//
// "Payment received" notifications, three ways:
//  1. kaleidoswap.me push — with a claimed Lightning address, the registry
//     pushes to this device when a payment to it lands, even with the app closed.
//  2. Balance watch — while the app runs in the background, a balance that went
//     up raises a local notification.
//  3. Background check — every so often (the OS decides; often 15 minutes or
//     more) the app wakes, reads its Spark (and any connected) balances and does
//     the same. Best-effort: the OS may run it late or not at all.
//
// All three honour the "Payment notifications" setting. Native modules are
// loaded lazily so a build without them degrades to no notifications, never a crash.
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NotificationService from './NotificationService';
import DatabaseService from './DatabaseService';
import { protocolManager, initializeProtocols } from './protocols';
import { getStoredHandle, registerPushDevice, removePushDevice, type StoredHandle } from './kaleidoswapMe';
import { describeIncoming, incomingPayments, mergeBalances, type Balances, type WatchedAccount } from '../utils/paymentWatch';

const ENABLED_KEY = 'payment-notifications-enabled-v1';
const BASELINE_KEY = 'payment-watch-baseline-v1';
const pushKey = (walletId: number) => `kaleidoswap-me-push-v1-${walletId}`;
export const BACKGROUND_TASK = 'kaleidoswap-payment-check';

const platform = (): 'ios' | 'android' => (Platform.OS === 'ios' ? 'ios' : 'android');

/** Mirrors the setting where the background task (no Redux there) can read it. */
export async function setPaymentNotificationsEnabled(enabled: boolean): Promise<void> {
  try { await AsyncStorage.setItem(ENABLED_KEY, enabled ? '1' : '0'); } catch { /* best-effort */ }
}
async function enabled(): Promise<boolean> {
  try { return (await AsyncStorage.getItem(ENABLED_KEY)) !== '0'; } catch { return true; }
}

// ---- 1. kaleidoswap.me push ------------------------------------------------

interface PushRegistration { token: string; name: string }

async function savedRegistration(walletId: number): Promise<PushRegistration | null> {
  try {
    const raw = await DatabaseService.getInstance().getSetting(pushKey(walletId));
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

/**
 * Brings this device's registration in line with the setting: registered for the
 * wallet's handle when on, removed when off or when the handle changed. Safe to
 * call often; returns what happened for the settings screen.
 */
export async function syncPaymentPush(walletId: number, on: boolean): Promise<'registered' | 'removed' | 'no-handle' | 'no-permission' | 'unchanged'> {
  const handle: StoredHandle | null = await getStoredHandle(walletId);
  const saved = await savedRegistration(walletId);
  const db = DatabaseService.getInstance();

  // Off, or the handle was released/changed: drop the old registration first.
  if (saved && (!on || !handle || saved.name !== handle.name)) {
    try {
      if (handle && saved.name === handle.name) await removePushDevice(handle, saved.token, platform());
    } catch (e) { console.warn('[push] remove failed', e); }
    await db.setSetting(pushKey(walletId), '');
    if (!on || !handle) return 'removed';
  }
  if (!on) return 'unchanged';
  if (!handle) return 'no-handle';

  const token = await NotificationService.getInstance().getPushToken();
  if (!token) return 'no-permission';
  // Re-register every launch: it refreshes the server's "newest devices" order and picks up a rotated token.
  await registerPushDevice(handle, token, platform());
  await db.setSetting(pushKey(walletId), JSON.stringify({ token, name: handle.name } satisfies PushRegistration));
  return 'registered';
}

// ---- 2. balance watch -------------------------------------------------------

interface Baseline { walletId: number; balances: Balances }

async function loadBaseline(): Promise<Baseline | null> {
  try { const raw = await AsyncStorage.getItem(BASELINE_KEY); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
async function saveBaseline(b: Baseline): Promise<void> {
  try { await AsyncStorage.setItem(BASELINE_KEY, JSON.stringify(b)); } catch { /* best-effort */ }
}

/**
 * Compares the new balances with the last ones seen for this wallet and, when
 * `notify` is set and something arrived, raises a "Payment received" notification.
 * Always moves the baseline forward, so a payment is announced at most once.
 */
export async function recordBalances(walletId: number, balances: Balances, notify: boolean): Promise<void> {
  const base = await loadBaseline();
  const prev = base?.walletId === walletId ? base.balances : null;
  const incoming = incomingPayments(prev, balances);
  await saveBaseline({ walletId, balances: mergeBalances(prev, balances) });
  if (notify && incoming.length && (await enabled())) {
    await NotificationService.getInstance().notifyPaymentReceived(describeIncoming(incoming), { accounts: incoming.map(i => i.account) });
  }
}

// ---- 3. background check ----------------------------------------------------

const ADAPTERS: Array<[WatchedAccount, string]> = [['SPARK', 'SPARK'], ['ARKADE', 'ARKADE'], ['BARK', 'BARK'], ['RGB', 'RGB_LN']];

async function connectedBalances(): Promise<Balances> {
  const out: Balances = {};
  for (const [account, protocol] of ADAPTERS) {
    let adapter: any;
    try { adapter = protocolManager.getAdapterIfAvailable(protocol as any); } catch { adapter = undefined; }
    if (!adapter?.isConnected?.()) continue;
    try { out[account] = (await adapter.getBtcBalance()).total; } catch { /* skip this account */ }
  }
  return out;
}

/**
 * One background pass. With the app killed nothing is connected, so it connects
 * Spark alone (the lightest account, and where Lightning-address payments land),
 * reads balances and notifies. Never throws.
 */
export async function runBackgroundPaymentCheck(): Promise<boolean> {
  try {
    if (!(await enabled())) return true;
    const wallet = await DatabaseService.getInstance().getActiveWallet();
    if (!wallet?.id) return true;
    let balances = await connectedBalances();
    if (!Object.keys(balances).length && wallet.encrypted_mnemonic) {
      const spark = (wallet.networks ?? []).filter(n => n.type === 'spark' && n.enabled);
      if (!spark.length) return true;
      await initializeProtocols(wallet.encrypted_mnemonic, spark);
      balances = await connectedBalances();
    }
    if (!Object.keys(balances).length) return true;
    await recordBalances(wallet.id, balances, true);
    return true;
  } catch (e) {
    console.warn('[payments] background check failed', e);
    return false;
  }
}

let taskDefined = false;

/** Defines the task. Must run at startup (index.ts), before React mounts, so the OS can call it when the app is closed. */
export function defineBackgroundPaymentCheck(): void {
  if (taskDefined) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const TaskManager = require('expo-task-manager');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { BackgroundTaskResult } = require('expo-background-task');
    TaskManager.defineTask(BACKGROUND_TASK, async () =>
      (await runBackgroundPaymentCheck()) ? BackgroundTaskResult.Success : BackgroundTaskResult.Failed);
    taskDefined = true;
  } catch (e) {
    console.warn('[payments] background tasks unavailable in this build', e);
  }
}

/** Turns the periodic check on or off with the setting. */
export async function scheduleBackgroundPaymentCheck(on: boolean): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const BackgroundTask = require('expo-background-task');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const TaskManager = require('expo-task-manager');
    const registered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_TASK);
    if (on && !registered) await BackgroundTask.registerTaskAsync(BACKGROUND_TASK, { minimumInterval: 15 });
    if (!on && registered) await BackgroundTask.unregisterTaskAsync(BACKGROUND_TASK);
  } catch (e) {
    console.warn('[payments] could not schedule the background check', e);
  }
}
