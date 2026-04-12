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

import { registerRootComponent } from 'expo';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
