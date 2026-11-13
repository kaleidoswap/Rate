// __tests__/setup/jest.setup.ts
// No need to import jest-native as @testing-library/react-native v12.4+ has built-in matchers

// Polyfill for React Native
global.setImmediate = global.setImmediate || ((fn: (...args: unknown[]) => void, ...args: unknown[]) => global.setTimeout(() => fn(...args), 0));

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
  // The real module's string enum, mirrored so tests can use its members.
  NetInfoStateType: {
    unknown: 'unknown', none: 'none', cellular: 'cellular', wifi: 'wifi',
    bluetooth: 'bluetooth', ethernet: 'ethernet', wimax: 'wimax', vpn: 'vpn', other: 'other',
  },
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
  const identity = <T,>(t: T): T => t;
  // Animations finish at once: the completion callback fires synchronously.
  const withHelper = (toValue: number, _config?: unknown, callback?: (finished: boolean) => void) => { callback?.(true); return toValue; };
  // Layout animations (FadeIn.delay(…).springify()…) are chainable no-ops.
  const layoutAnimation = new Proxy({}, { get: () => () => layoutAnimation });
  return {
    __esModule: true,
    default: {
      createAnimatedComponent: <T,>(Component: T): T => Component,
      View: 'Animated.View',
      Text: 'Animated.Text',
      Image: 'Animated.Image',
    },
    useSharedValue: <T,>(initial: T) => ({ value: initial }),
    useAnimatedStyle: <T,>(styleFactory: () => T): T => styleFactory(),
    withSpring: withHelper,
    withTiming: withHelper,
    withDelay: (_delay: number, animation: unknown) => animation,
    withSequence: (...animations: unknown[]) => animations[animations.length - 1],
    withRepeat: (animation: unknown) => animation,
    interpolate: (_value: number, _input: unknown[], output: unknown[]) => output[0],
    cancelAnimation: () => {},
    runOnJS: <T,>(fn: T): T => fn,
    useReducedMotion: () => false,
    FadeIn: layoutAnimation,
    FadeOut: layoutAnimation,
    FadeInDown: layoutAnimation,
    FadeInUp: layoutAnimation,
    ZoomIn: layoutAnimation,
    LinearTransition: layoutAnimation,
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

// SVG: shapes render as plain host elements (tests assert on text and labels, not paths).
jest.mock('react-native-svg', () => {
  const host = (name: string): string => name;
  return {
    __esModule: true,
    default: host('Svg'),
    Svg: host('Svg'), G: host('G'), Path: host('Path'), Rect: host('Rect'), Circle: host('Circle'),
    Polygon: host('Polygon'), Text: host('SvgText'), Defs: host('Defs'), LinearGradient: host('LinearGradient'),
    RadialGradient: host('RadialGradient'), Stop: host('Stop'), ClipPath: host('ClipPath'), Line: host('Line'),
  };
});

// Gesture handler: gestures are chainable no-ops and the detector renders its child.
jest.mock('react-native-gesture-handler', () => {
  const chain = new Proxy({}, { get: () => () => chain });
  return {
    __esModule: true,
    Gesture: { Pan: () => chain, Tap: () => chain },
    GestureDetector: ({ children }: { children?: React.ReactNode }) => children,
    GestureHandlerRootView: 'GestureHandlerRootView',
  };
});

// Mock LinearGradient
jest.mock('expo-linear-gradient', () => ({
  LinearGradient: 'LinearGradient',
}));

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
  SafeAreaProvider: ({ children }: { children?: React.ReactNode }) => children,
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
// expo-sharing's native module isn't available under Jest.
jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn(async () => false),
  shareAsync: jest.fn(async () => undefined),
}));

// expo-image-picker's native module isn't available under Jest either.
jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: jest.fn(async () => ({ canceled: true, assets: null })),
}));

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
  Dimensions: { get: () => ({ width: 393, height: 852 }) },
  useWindowDimensions: () => ({ width: 393, height: 852, scale: 3, fontScale: 1 }),
  KeyboardAvoidingView: 'KeyboardAvoidingView',
  Keyboard: { dismiss: jest.fn(), addListener: () => ({ remove: jest.fn() }), removeListener: jest.fn() },
  InteractionManager: { runAfterInteractions: (fn: any) => { fn(); return { cancel: jest.fn() }; } },
  Share: { share: jest.fn(() => Promise.resolve({ action: 'sharedAction' })) },
  AccessibilityInfo: { setAccessibilityFocus: jest.fn() },
  findNodeHandle: jest.fn(() => 1),
  StatusBar: 'StatusBar',
  RefreshControl: 'RefreshControl',
  DeviceEventEmitter: { addListener: jest.fn(() => ({ remove: jest.fn() })) },
  Platform: {
    OS: 'ios',
    select: jest.fn((obj: { ios?: unknown; default?: unknown }) => obj.ios || obj.default),
  },
  StyleSheet: {
    create: jest.fn((styles: unknown) => styles),
    flatten: jest.fn((style: unknown) => {
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
  TouchableOpacity: ({ onPress, disabled, children, ...props }: { onPress?: (...args: unknown[]) => void; disabled?: boolean; children?: React.ReactNode } & Record<string, unknown>) =>
    require('react').createElement(
      'TouchableOpacity',
      { ...props, disabled, onPress: (...args: unknown[]) => { if (!disabled) onPress?.(...args); } },
      children
    ),
  ScrollView: 'ScrollView',
  Switch: 'Switch',
  Modal: 'Modal',
  Pressable: ({ onPress, disabled, children, ...props }: { onPress?: (...args: unknown[]) => void; disabled?: boolean; children?: React.ReactNode } & Record<string, unknown>) =>
    require('react').createElement('Pressable', { ...props, disabled, onPress: (...args: unknown[]) => { if (!disabled) onPress?.(...args); } }, children),
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
      start: jest.fn((callback?: () => void) => callback && callback()),
      stop: jest.fn(),
    })),
    spring: jest.fn(() => ({
      start: jest.fn((callback?: () => void) => callback && callback()),
    })),
    parallel: jest.fn((_animations: unknown[]) => ({
      start: jest.fn((callback?: () => void) => callback && callback()),
    })),
    sequence: jest.fn((_animations: unknown[]) => ({
      start: jest.fn((callback?: () => void) => callback && callback()),
    })),
    loop: jest.fn((_animation: unknown) => ({
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

// Global test timeout
jest.setTimeout(10000);

// Suppress console warnings in tests
global.console = {
  ...console,
  warn: jest.fn(),
  error: jest.fn(),
};
