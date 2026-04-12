// Learn more https://docs.expo.io/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// Allow Metro to resolve local packages (symlinked via file:)
const kaleidoUiRoot = path.resolve(__dirname, '../kaleido-ui');
const walletProtocolsRoot = path.resolve(__dirname, '../wallet-protocols');
config.watchFolders = [kaleidoUiRoot, walletProtocolsRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(__dirname, 'node_modules'),
  path.resolve(kaleidoUiRoot, 'node_modules'),
];

// Force all shared deps to resolve from rate's node_modules (single copy, correct platform entries)
config.resolver.extraNodeModules = {
  react: path.resolve(__dirname, 'node_modules/react'),
  'react-native': path.resolve(__dirname, 'node_modules/react-native'),
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
};

// Add Node.js polyfills to resolver platforms
config.resolver.platforms = ['ios', 'android', 'native', 'web'];

module.exports = config;
