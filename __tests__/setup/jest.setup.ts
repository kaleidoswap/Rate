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
  getEnrolledLevelAsync: jest.fn(() => Promise.resolve(3)),
  supportedAuthenticationTypesAsync: jest.fn(() => Promise.resolve([1])),
  authenticateAsync: jest.fn(() => Promise.resolve({ success: true })),
  AuthenticationType: {
    FINGERPRINT: 1,
    FACIAL_RECOGNITION: 2,
    IRIS: 3,
  },
  SecurityLevel: {
    NONE: 0,
    SECRET: 1,
    BIOMETRIC_WEAK: 2,
    BIOMETRIC_STRONG: 3,
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

// Mock react-native-reanimated. Its own shipped mock.js still pulls in the
// real react-native-worklets (a JSI-backed native module with no jest mock
// of its own) in v4, so we hand-roll the subset this codebase actually uses:
// shared values behave synchronously (no reactivity, no animation), which is
// enough since these tests only assert on rendering/interaction, not motion.
jest.mock('react-native-reanimated', () => {
  const identity = (t) => t;
  const withHelper = (toValue) => toValue;
  return {
    __esModule: true,
    default: {
      createAnimatedComponent: (Component) => Component,
      View: 'Animated.View',
      Text: 'Animated.Text',
      Image: 'Animated.Image',
    },
    useSharedValue: (initial) => ({ value: initial }),
    useAnimatedStyle: (styleFactory) => styleFactory(),
    withSpring: withHelper,
    withTiming: withHelper,
    withDelay: (_delay, animation) => animation,
    withSequence: (...animations) => animations[animations.length - 1],
    withRepeat: (animation) => animation,
    interpolate: (_value, _input, output) => output[0],
    cancelAnimation: () => {},
    runOnJS: (fn) => fn,
    Easing: {
      linear: identity,
      ease: identity,
      quad: identity,
      cubic: identity,
      bezier: () => identity,
      in: identity,
      out: identity,
      inOut: identity,
    },
  };
});

// Mock LinearGradient
jest.mock('expo-linear-gradient', () => ({
  LinearGradient: 'LinearGradient',
}));

// Mock Lottie
jest.mock('lottie-react-native', () => 'LottieView');

// Mock QRCode
jest.mock('react-native-qrcode-svg', () => 'QRCode');

// Mock @expo/vector-icons — the real package pulls in expo-font ->
// expo-modules-core, which needs the native `globalThis.expo` binding that
// only exists on-device (or under jest-expo's preset, which this project
// doesn't use).
jest.mock('@expo/vector-icons', () => ({
  Ionicons: 'Ionicons',
  MaterialCommunityIcons: 'MaterialCommunityIcons',
}));

// Mock react-native-safe-area-context — the real package requires native
// react-native internals (TurboModuleRegistry) not present under this
// project's lightweight react-native mock.
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }) => children,
  SafeAreaView: 'SafeAreaView',
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

// Mock expo-audio — same expo-modules-core native-binding issue as
// @expo/vector-icons above.
jest.mock('expo-audio', () => ({
  createAudioPlayer: jest.fn(() => ({
    play: jest.fn(),
    pause: jest.fn(),
    remove: jest.fn(),
    seekTo: jest.fn(),
  })),
  setAudioModeAsync: jest.fn(() => Promise.resolve()),
}));

// Mock expo-file-system — same expo-modules-core native-binding issue as
// @expo/vector-icons above. services/sounds.ts wraps all File/Directory use
// in try/catch (audio is a nice-to-have), so a minimal non-throwing shape
// is enough.
jest.mock('expo-file-system', () => ({
  File: class {
    exists = true;
    uri = '';
    write() {}
  },
  Directory: class {},
  Paths: { cache: {} },
}));

// Mock expo-haptics — same expo-modules-core native-binding issue as
// @expo/vector-icons above.
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(() => Promise.resolve()),
  notificationAsync: jest.fn(() => Promise.resolve()),
  selectionAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));

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
    flatten: jest.fn((style) => {
      const flat = Array.isArray(style) ? style.flat(Infinity) : [style];
      return Object.assign({}, ...flat.filter(Boolean));
    }),
  },
  View: 'View',
  Text: 'Text',
  TextInput: 'TextInput',
  // A real component, not a bare string: fireEvent.press() doesn't check
  // `disabled` itself, and walks up to any ancestor's onPress if this node's
  // is missing — so onPress must stay a function that checks disabled at
  // call time (mirroring how the real TouchableOpacity/Pressability works),
  // rather than being conditionally omitted.
  TouchableOpacity: ({ onPress, disabled, children, ...props }) =>
    require('react').createElement(
      'TouchableOpacity',
      { ...props, disabled, onPress: (...args) => { if (!disabled) onPress?.(...args); } },
      children
    ),
  ScrollView: 'ScrollView',
  Switch: 'Switch',
  Modal: 'Modal',
  Pressable: 'Pressable',
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
