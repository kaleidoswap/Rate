// Learn more https://docs.expo.io/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// Allow Metro to resolve the local kaleido-ui package (symlinked via file:)
const kaleidoUiRoot = path.resolve(__dirname, '../kaleido-ui');
config.watchFolders = [kaleidoUiRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(__dirname, 'node_modules'),
  path.resolve(kaleidoUiRoot, 'node_modules'),
];

// Ensure react/react-native always resolve from rate's node_modules (single copy)
config.resolver.extraNodeModules = {
  react: path.resolve(__dirname, 'node_modules/react'),
  'react-native': path.resolve(__dirname, 'node_modules/react-native'),
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
