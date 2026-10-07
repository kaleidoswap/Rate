module.exports = {
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/__tests__/setup/jest-env-setup.js'],
  setupFilesAfterEnv: ['<rootDir>/__tests__/setup/jest.setup.ts'],
  transform: {
    '^.+\\.(js|jsx|ts|tsx)$': 'babel-jest',
  },
  transformIgnorePatterns: [
    // @kaleidorg/mind and @scure ship ESM-only — babel must transform them for Jest.
    // expo(-.*)? / react-native(-.*)? cover the whole expo-* and react-native-* families
    // (expo-font, react-native-reanimated, …), not just the bare packages — the
    // hyphenated ones ship ESM too and need the same transform.
    'node_modules/(?!(react-native(-.*)?|@react-native|@react-navigation|expo(-.*)?|@expo|@react-native-community|@nostr-dev-kit|nostr-tools|react-redux|@reduxjs|@testing-library|@kaleidorg|@scure|@noble|micro-packed|@arkade-os|@bitcoinerlab|@marcbachmann)/)'
  ],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  testMatch: ['**/__tests__/**/*.test.[jt]s?(x)', '**/?(*.)+(spec|test).[jt]s?(x)'],
  collectCoverageFrom: [
    'services/**/*.{ts,tsx}',
    'components/**/*.{ts,tsx}',
    'screens/**/*.{ts,tsx}',
    'store/**/*.{ts,tsx}',
    '!**/*.d.ts',
    '!**/node_modules/**',
    '!**/__tests__/**'
  ],
  // A floor at today's coverage, enforced in CI (jest --coverage): it can only
  // go up. Raise these as tests are added; the old 70/60 targets were never met
  // and never checked.
  coverageThreshold: {
    global: {
      statements: 36,
      branches: 34,
      functions: 35,
      lines: 36
    }
  },
  // Sibling packages (universal-bolt12) fall back to this app's node_modules for babel helpers.
  modulePaths: ['<rootDir>/node_modules'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
    '^@universal-bolt12/(swap-market|universal-code)$': '<rootDir>/../universal-bolt12/packages/$1/src/index.ts',
    '^react-native$': '<rootDir>/node_modules/react-native',
    // @kaleidorg/mind's exports map is import-only; point Jest's CJS resolver
    // straight at the dist files (babel transforms the ESM — see
    // transformIgnorePatterns above).
    '^@kaleidorg/mind$': '<rootDir>/node_modules/@kaleidorg/mind/dist/index.js',
    '^@kaleidorg/mind/skills$': '<rootDir>/node_modules/@kaleidorg/mind/dist/skills/loader.js',
    '^@kaleidorg/mind/logger$': '<rootDir>/node_modules/@kaleidorg/mind/dist/logger.js',
    '^@kaleidorg/mind/(kaleidoswap|knowledge)$': '<rootDir>/node_modules/@kaleidorg/mind/dist/$1/index.js',
    // @kaleidorg/mind/qvac — the QVAC adapter subpath; same import-only exports
    // map, so point Jest's CJS resolver straight at its dist.
    '^@kaleidorg/mind/qvac$': '<rootDir>/node_modules/@kaleidorg/mind/dist/qvac/index.js',
    '\\.(jpg|jpeg|png|gif|svg|wav)$': '<rootDir>/__mocks__/fileMock.js',
  },
  globals: {
    __DEV__: true,
  },
};

