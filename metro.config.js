// Learn more https://docs.expo.io/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');
const exclusionList = require('metro-config/private/defaults/exclusionList').default;
const path = require('path');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// Allow Metro to resolve local packages still linked via file:
// @kaleidorg/wallet-engine is a local file: sibling when present; fall back to
// the npm version in node_modules when the sibling doesn't exist (CI / fresh clone).
const fs = require('fs');
const localWalletEngine = path.resolve(__dirname, '../wallet-engine');
const walletEngineRoot = fs.existsSync(localWalletEngine)
  ? localWalletEngine
  : path.resolve(__dirname, 'node_modules/@kaleidorg/wallet-engine');
const kaleidoUiRoot = path.resolve(__dirname, '../kaleido-ui');
// @kaleidorg/mind — the shared agentic engine, also published to npm as
// @kaleidorg/mind. Linked via file: for fast local dev (pure JS dist/, no
// native deps). To consume the published version instead, set its dep to
// `^0.0.1` and drop this watchFolder.
const kaleidoMindRoot = path.resolve(__dirname, '../kaleido-mind/packages/core');
const watchFolders = [walletEngineRoot, kaleidoUiRoot, kaleidoMindRoot]
  .filter(p => fs.existsSync(p));
config.watchFolders = watchFolders;
config.resolver.nodeModulesPaths = [
  path.resolve(__dirname, 'node_modules'),
  path.resolve(kaleidoUiRoot, 'node_modules'),
];

const escapePath = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const singleCopyNativeModules = [
  'react',
  'react-native',
  'react-native-svg',
  'react-native-safe-area-context',
  'react-native-gesture-handler',
  'react-native-reanimated',
  'react-native-screens',
];
const blockedLinkedModules = singleCopyNativeModules.map(
  (name) =>
    new RegExp(
      `${escapePath(kaleidoUiRoot)}\\/node_modules\\/(?:\\.pnpm\\/[^/]+\\/node_modules\\/)?${name}\\/.*`
    )
);
config.resolver.blockList = exclusionList(blockedLinkedModules);

// Force all shared deps to resolve from rate's node_modules (single copy, correct platform entries)
config.resolver.extraNodeModules = {
  '@kaleidorg/wallet-engine': walletEngineRoot,
  // Babel's transform-runtime rewrites helper calls (createClass, inherits, …) to
  // `require('@babel/runtime/helpers/*')` in EVERY transpiled file. The sibling
  // watchFolders (wallet-engine, kaleido-ui) don't carry their own @babel/runtime,
  // so without this mapping their modules can't resolve the helpers and the bundle
  // fails at index.ts. Pin it to rate's single hoisted copy.
  '@babel/runtime': path.resolve(__dirname, 'node_modules/@babel/runtime'),
  react: path.resolve(__dirname, 'node_modules/react'),
  'react-native': path.resolve(__dirname, 'node_modules/react-native'),
  'react-native-svg': path.resolve(__dirname, 'node_modules/react-native-svg'),
  'react-native-safe-area-context': path.resolve(__dirname, 'node_modules/react-native-safe-area-context'),
  'react-native-gesture-handler': path.resolve(__dirname, 'node_modules/react-native-gesture-handler'),
  'react-native-reanimated': path.resolve(__dirname, 'node_modules/react-native-reanimated'),
  'react-native-screens': path.resolve(__dirname, 'node_modules/react-native-screens'),
  'kaleido-sdk': path.resolve(__dirname, 'node_modules/kaleido-sdk'),
  '@buildonspark/spark-sdk': path.resolve(__dirname, 'node_modules/@buildonspark/spark-sdk'),
  '@arkade-os/sdk': path.resolve(__dirname, 'node_modules/@arkade-os/sdk'),
  '@scure/bip39': path.resolve(__dirname, 'node_modules/@scure/bip39'),
  '@scure/bip32': path.resolve(__dirname, 'node_modules/@scure/bip32'),
};

// Add polyfill resolver
config.resolver.alias = {
  crypto: 'react-native-get-random-values',
  stream: 'readable-stream',
  buffer: 'buffer',
  // Spark's WDK module pulls `sodium-universal` → `sodium-native` (a native addon
  // with no React Native support). Map it to the pure-JS implementation. This is the
  // same substitution `sodium-universal`'s own `browser` field makes (confirmed via
  // the MV3 bundle spike); the explicit alias makes it deterministic under Metro/Hermes.
  'sodium-native': 'sodium-javascript',
};

// --- WDK engine resolution -----------------------------------------------------
// The WDK wallet modules now come from npm (published versions) / a github dep, so
// they resolve from node_modules normally — no sibling watchFolders needed. Keep the
// shared @tetherto/wdk-wallet base as a single copy to avoid duplicate instances
// (only @kaleidorg/wallet-engine remains a file: sibling, watched above).
config.resolver.extraNodeModules['@tetherto/wdk-wallet'] = path.resolve(
  __dirname,
  'node_modules/@tetherto/wdk-wallet'
);

// Resolve the `react-native` export/imports condition deterministically. This is what
// makes (a) @kaleidorg/wdk-wallet-liquid's `#lwk` map pick the native `lwk-rn` binding
// (src/lwk-native.js) instead of the wasm `default`, and (b) @buildonspark/spark-sdk
// resolve its React Native build.
//
// IMPORTANT: do NOT include 'import' here. @babel/runtime's exports map has an `import`
// condition that returns the ESM helper (`export default _inherits`); RN core require()s
// those helpers as CJS and calls them directly, so an ESM `{default: fn}` breaks with
// "_inherits is not a function (it is Object)". Dropping 'import' makes helpers fall back
// to 'default' (CJS function). ESM-only packages still resolve via their own 'default'.
config.resolver.unstable_conditionNames = ['react-native', 'require'];

// Liquid now uses the native `lwk-rn` (UniFFI→JSI) binding — no WASM. The .wasm assetExt
// below is retained only for the browser/lwk_wasm path used by other targets; harmless on RN.
if (!config.resolver.assetExts.includes('wasm')) {
  config.resolver.assetExts.push('wasm');
}

// Add Node.js polyfills to resolver platforms
config.resolver.platforms = ['ios', 'android', 'native', 'web'];

module.exports = config;
