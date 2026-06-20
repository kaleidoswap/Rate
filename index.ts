// Polyfills - must be imported first
import 'react-native-get-random-values';
import { Buffer } from 'buffer';
// @ts-ignore — no types for this polyfill
import { EventSourcePolyfill } from 'event-source-polyfill';
// Wrap EventSource with longer heartbeat timeout to avoid noisy reconnect errors
(global as any).EventSource = class extends EventSourcePolyfill {
  constructor(url: string, opts?: any) {
    super(url, { ...opts, heartbeatTimeout: 300000 }); // 5 min instead of 45s
  }
};

// Make Buffer available globally
if (typeof global !== 'undefined') {
  global.Buffer = Buffer;
}

// Polyfill crypto.getRandomValues
import * as Crypto from 'expo-crypto';
if (typeof crypto === 'undefined') {
  global.crypto = {} as any;
}
if (!global.crypto.getRandomValues) {
  global.crypto.getRandomValues = Crypto.getRandomValues as any;
}

// Global unhandled-promise-rejection guard.
// Defense-in-depth so a stray rejection (e.g. from the on-device AI / QVAC
// pipeline) is logged instead of bubbling up as a red-screen crash. NOTE: a
// Bare worklet that aborts natively (AddonError) runs in a separate runtime and
// CANNOT be caught here — that's why on-device AI is opt-in (off by default).
const globalAny = global as any;
if (globalAny?.HermesInternal?.hasPromise?.() && globalAny.HermesInternal.enablePromiseRejectionTracker) {
  globalAny.HermesInternal.enablePromiseRejectionTracker({
    allRejections: true,
    onUnhandled: (id: number, error: unknown) => {
      console.warn('[unhandledRejection]', id, error);
    },
    onHandled: () => {},
  });
}

// Silence the Arkade ContractWatcher's recoverable reconnect noise. The watcher
// (in @arkade-os/sdk) logs `ContractWatcher connection failed: …` (often
// "subscription not found" — the indexer expired the SSE subscription) on every
// failed re-subscribe, then immediately schedules a reconnect AND runs failsafe
// polling, so Arkade funds are still detected. The per-attempt error is therefore
// non-actionable churn that floods the console. We drop only that exact line and
// pass everything else (including the watcher's terminal "Max reconnection
// attempts reached" error) straight through.
{
  const originalConsoleError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    const first = args[0];
    if (typeof first === 'string' && first.startsWith('ContractWatcher connection failed')) {
      return;
    }
    originalConsoleError(...args);
  };
}

import { registerRootComponent } from 'expo';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
