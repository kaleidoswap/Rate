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

import { registerRootComponent } from 'expo';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
