// Learn more https://docs.expo.io/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// Add polyfill resolver
config.resolver.alias = {
  crypto: 'react-native-get-random-values',
  stream: 'readable-stream',
  buffer: 'buffer',
};

module.exports = config;