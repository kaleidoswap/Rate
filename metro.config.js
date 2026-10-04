// Learn more https://docs.expo.io/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');
const exclusionList = require('metro-config/private/defaults/exclusionList').default;
const path = require('path');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// Allow Metro to resolve local packages still linked from siblings:
// @kaleidorg/wallet-engine is a local sibling when present; fall back to
// the npm version in node_modules when the sibling doesn't exist (CI / fresh clone).
const fs = require('fs');
const localWalletEngine = path.resolve(__dirname, '../wallet-engine');
const walletEngineRoot = fs.existsSync(localWalletEngine)
  ? localWalletEngine
  : path.resolve(__dirname, 'node_modules/@kaleidorg/wallet-engine');
const kaleidoUiRoot = path.resolve(__dirname, '../kaleido-ui');
// @kaleidorg/mind — the shared agentic engine, also published to npm as
// @kaleidorg/mind. Linked from a sibling for fast local dev (pure JS dist/, no
// native deps). To consume the published version instead, set its dep to
// `^0.0.1` and drop this watchFolder.
const kaleidoMindRoot = path.resolve(__dirname, '../kaleido-mind/packages/core');
// The QVAC adapter ships as the @kaleidorg/mind/qvac subpath inside core, so
// watching core covers it too — no separate watchFolder needed.
// KaleidoPay (bitcoin++ hackathon): packages from the sibling kaleidoswap/universal-bolt12
// checkout, imported from source. Run `npm install` there so their own dependencies resolve.
const universalBolt12Dir = path.resolve(__dirname, process.env.UNIVERSAL_BOLT12_DIR || '../universal-bolt12');
// Metro watches real paths, so resolve a symlinked checkout.
const universalBolt12Root = fs.existsSync(universalBolt12Dir) ? fs.realpathSync(universalBolt12Dir) : universalBolt12Dir;
const watchFolders = [walletEngineRoot, kaleidoUiRoot, kaleidoMindRoot, universalBolt12Root]
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
// @kaleidorg/wallet-engine's adapters/wdk barrel re-exports RgbLibWdkAdapter /
// RgbLibWasmAdapter alongside the adapters this app actually registers
// (Spark/Rln/Arkade — RGB goes over NWC to a remote node instead, see
// services/nwc/NwcRgbAdapter.ts), so Metro still needs to resolve their
// dynamic import()s even though this app never instantiates those two
// adapters. pnpm's hoisted node-linker installs their optional peers
// (@utexo/wdk-wallet-rgb, @utexo/rgb-lib-wasm) since they're resolvable —
// but the real @utexo/wdk-wallet-rgb pulls in @utexo/rgb-sdk -> @utexo/rgb-lib,
// which imports Node's fs/path and isn't Metro-bundleable. Block them so
// resolution falls through to the empty stub in extraNodeModules below.
const blockedUtexoRgbModules = ['@utexo/wdk-wallet-rgb', '@utexo/rgb-lib-wasm'].map(
  (name) =>
    new RegExp(
      `node_modules\\/(?:\\.pnpm\\/[^/]+\\/node_modules\\/)?${escapePath(name)}\\/.*`
    )
);
config.resolver.blockList = exclusionList([...blockedLinkedModules, ...blockedUtexoRgbModules]);

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
  // Unused optional peers of @kaleidorg/wallet-engine's adapters/wdk barrel —
  // this app only registers Spark/Rln/Arkade (RGB goes over NWC to a
  // remote node instead — see services/nwc/NwcRgbAdapter.ts), but Metro
  // still needs to resolve every export the barrel re-exports, including
  // RgbLibWdkAdapter/RgbLibWasmAdapter's dynamic import()s. The real
  // @utexo/wdk-wallet-rgb pulls in @utexo/rgb-sdk -> @utexo/rgb-lib, which
  // imports Node's fs/path — not Metro-bundleable, and never actually
  // invoked at runtime since this app never instantiates those adapters.
  '@utexo/wdk-wallet-rgb': path.resolve(__dirname, 'metro-stubs/unavailable-wdk-module.js'),
  '@utexo/rgb-lib-wasm': path.resolve(__dirname, 'metro-stubs/unavailable-wdk-module.js'),
  // Liquid isn't part of the app (its native lwk library dominated the APK size), but
  // the barrel's LiquidWdkAdapter still has a dynamic import() of its WDK module.
  '@kaleidorg/wdk-wallet-liquid': path.resolve(__dirname, 'metro-stubs/unavailable-wdk-module.js'),
};

// @kaleidorg/swap-sdk: the ROOT entry is a Rust->wasm package (Boltz swaps), and
// wasm is exactly what the mobile build avoids, so it goes to the empty stub —
// Metro bundles a single file and doesn't tree-shake wallet-engine's barrels, so
// it still has to resolve. The '@kaleidorg/swap-sdk/arkade' subpath is pure JS
// (the Arkade Intents venue over @arkade-os/swap) and is used by KaleidoPay's
// Arkade -> Lightning swaps (services/kaleidoPay/arkadeIntents.ts), so it resolves
// normally. A subpath can't go through extraNodeModules (that maps a package root
// and then appends the remainder), hence resolveRequest.
const swapSdkStub = path.resolve(__dirname, 'metro-stubs/unavailable-wdk-module.js');
// One @arkade-os/sdk. @arkade-os/swap hard-pins (and so nests) its own SDK copy
// (0.4.71) while the app's wallet is built from the root copy (0.4.72); the venue
// hands that wallet, and VHTLC/ArkAddress/Transaction objects, across the
// boundary, so two copies would mean two class identities and two contract
// registries. extraNodeModules can't fix that (it is only a fallback for imports
// that fail to resolve), so every '@arkade-os/sdk' import — and its subpaths — is
// resolved as if it came from the app root. Exception: @arkade-os/boltz-swap
// (Arkade's Boltz Lightning path in wallet-engine) pins 0.4.35 and keeps its own
// copy, as before, since its API predates the root SDK; so does @arkade-os/wdk
// (it pins its own SDK too), so the app's existing Arkade wallet code is unchanged.
const appOrigin = path.join(__dirname, 'package.json');
const arkadeSdkRequest = /^@arkade-os\/sdk(\/.*)?$/;
const keepsOwnArkadeSdk = /[\\/]node_modules[\\/]@arkade-os[\\/](boltz-swap|wdk)[\\/]/;
const previousResolveRequest = config.resolver.resolveRequest;
const resolveNext = (context, moduleName, platform) =>
  previousResolveRequest
    ? previousResolveRequest(context, moduleName, platform)
    : context.resolveRequest(context, moduleName, platform);
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === '@kaleidorg/swap-sdk'
    || (moduleName.startsWith('@kaleidorg/swap-sdk/') && moduleName !== '@kaleidorg/swap-sdk/arkade')) {
    return { type: 'sourceFile', filePath: swapSdkStub };
  }
  if (arkadeSdkRequest.test(moduleName) && !keepsOwnArkadeSdk.test(context.originModulePath)) {
    return resolveNext({ ...context, originModulePath: appOrigin }, moduleName, platform);
  }
  const ub12 = /^@universal-bolt12\/(swap-market|universal-code)$/.exec(moduleName);
  if (ub12) {
    return { type: 'sourceFile', filePath: path.join(universalBolt12Root, 'packages', ub12[1], 'src/index.ts') };
  }
  return resolveNext(context, moduleName, platform);
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
// (only @kaleidorg/wallet-engine remains a linked sibling, watched above).
config.resolver.extraNodeModules['@tetherto/wdk-wallet'] = path.resolve(
  __dirname,
  'node_modules/@tetherto/wdk-wallet'
);

// Resolve the `react-native` export/imports condition deterministically. This is what
// makes @buildonspark/spark-sdk resolve its React Native build.
//
// IMPORTANT: do NOT include 'import' here. @babel/runtime's exports map has an `import`
// condition that returns the ESM helper (`export default _inherits`); RN core require()s
// those helpers as CJS and calls them directly, so an ESM `{default: fn}` breaks with
// "_inherits is not a function (it is Object)". Dropping 'import' makes helpers fall back
// to 'default' (CJS function). ESM-only packages still resolve via their own 'default'.
config.resolver.unstable_conditionNames = ['react-native', 'require'];

// .wasm stays a known asset extension so a stray wasm import resolves instead of failing.
if (!config.resolver.assetExts.includes('wasm')) {
  config.resolver.assetExts.push('wasm');
}

// Add Node.js polyfills to resolver platforms
config.resolver.platforms = ['ios', 'android', 'native', 'web'];

module.exports = config;
