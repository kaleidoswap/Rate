// Polyfills - must be imported first
import 'react-native-get-random-values';
import { Buffer } from 'buffer';

// Make Buffer available globally
if (typeof global !== 'undefined') {
  global.Buffer = Buffer;
}

// Polyfill crypto.getRandomValues if not available
if (typeof crypto !== 'undefined' && !crypto.getRandomValues) {
  const { getRandomValues } = require('react-native-get-random-values');
  crypto.getRandomValues = getRandomValues;
}

import {registerRootComponent} from 'expo';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
