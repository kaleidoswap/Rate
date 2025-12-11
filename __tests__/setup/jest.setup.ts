// __tests__/setup/jest.setup.ts
// No need to import jest-native as @testing-library/react-native v12.4+ has built-in matchers

// Polyfill for React Native
global.setImmediate = global.setImmediate || ((fn, ...args) => global.setTimeout(fn, 0, ...args));

// Mock Expo SecureStore
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

// Mock Expo SQLite
const mockDatabase = {
  execAsync: jest.fn(),
  runAsync: jest.fn(),
  getFirstAsync: jest.fn(),
  getAllAsync: jest.fn(),
  closeAsync: jest.fn(),
};

jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: jest.fn(() => Promise.resolve(mockDatabase)),
}));

// Mock Expo LocalAuthentication
jest.mock('expo-local-authentication', () => ({
  hasHardwareAsync: jest.fn(() => Promise.resolve(true)),
  isEnrolledAsync: jest.fn(() => Promise.resolve(true)),
  supportedAuthenticationTypesAsync: jest.fn(() => Promise.resolve([1])),
  authenticateAsync: jest.fn(() => Promise.resolve({ success: true })),
  AuthenticationType: {
    FINGERPRINT: 1,
    FACIAL_RECOGNITION: 2,
    IRIS: 3,
  },
}));

// Mock @react-native-community/netinfo
jest.mock('@react-native-community/netinfo', () => ({
  fetch: jest.fn(() =>
    Promise.resolve({
      isConnected: true,
      isInternetReachable: true,
      type: 'wifi',
      details: {},
    })
  ),
  addEventListener: jest.fn(() => jest.fn()),
}));

// Mock React Native modules
jest.mock('react-native/Libraries/Animated/NativeAnimatedHelper', () => ({}), { virtual: true });
jest.mock('react-native/Libraries/EventEmitter/NativeEventEmitter', () => {
  return class MockEventEmitter {
    addListener = jest.fn();
    removeListener = jest.fn();
  };
}, { virtual: true });

// Mock LinearGradient
jest.mock('expo-linear-gradient', () => ({
  LinearGradient: 'LinearGradient',
}));

// Mock Lottie
jest.mock('lottie-react-native', () => 'LottieView');

// Mock QRCode
jest.mock('react-native-qrcode-svg', () => 'QRCode');

// Mock Clipboard
jest.mock('@react-native-clipboard/clipboard', () => ({
  setString: jest.fn(),
  getString: jest.fn(() => Promise.resolve('')),
}), { virtual: true });

// Mock react-native modules
jest.mock('react-native', () => ({
  Platform: {
    OS: 'ios',
    select: jest.fn((obj) => obj.ios || obj.default),
  },
  StyleSheet: {
    create: jest.fn((styles) => styles),
  },
  View: 'View',
  Text: 'Text',
  TextInput: 'TextInput',
  TouchableOpacity: 'TouchableOpacity',
  ScrollView: 'ScrollView',
  FlatList: 'FlatList',
  Image: 'Image',
  ActivityIndicator: 'ActivityIndicator',
  Animated: {
    View: 'Animated.View',
    Text: 'Animated.Text',
    Value: jest.fn(() => ({
      setValue: jest.fn(),
      interpolate: jest.fn(() => ({
        setValue: jest.fn(),
      })),
    })),
    timing: jest.fn(() => ({
      start: jest.fn((callback) => callback && callback()),
    })),
    spring: jest.fn(() => ({
      start: jest.fn((callback) => callback && callback()),
    })),
    parallel: jest.fn((animations) => ({
      start: jest.fn((callback) => callback && callback()),
    })),
    sequence: jest.fn((animations) => ({
      start: jest.fn((callback) => callback && callback()),
    })),
    loop: jest.fn((animation) => ({
      start: jest.fn(),
      stop: jest.fn(),
    })),
  },
  Alert: {
    alert: jest.fn(),
  },
  Clipboard: {
    setString: jest.fn(),
    getString: jest.fn(() => Promise.resolve('')),
  },
}));

// Mock bip39
jest.mock('bip39', () => ({
  generateMnemonic: jest.fn(() => 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'),
  validateMnemonic: jest.fn((mnemonic: string) => {
    const words = mnemonic.split(' ');
    return words.length === 12 || words.length === 24;
  }),
}), { virtual: true });

// Mock axios
jest.mock('axios', () => ({
  create: jest.fn(() => ({
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
    interceptors: {
      request: { use: jest.fn(), eject: jest.fn() },
      response: { use: jest.fn(), eject: jest.fn() },
    },
  })),
  get: jest.fn(),
  post: jest.fn(),
}));

// Global test timeout
jest.setTimeout(10000);

// Suppress console warnings in tests
global.console = {
  ...console,
  warn: jest.fn(),
  error: jest.fn(),
};

