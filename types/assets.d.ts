// types/assets.d.ts
// Add this file to enable TypeScript support for JSON imports

declare module "*.json" {
    const value: any;
    export default value;
  }
  
  // Alternatively, for more specific typing of the Lugano merchants data:
  interface LuganoMerchant {
    id: number;
    name: string;
    address: string;
    icon: string;
    phone?: string;
    website?: string;
    opening_hours?: string;
  }
  
  declare module "../assets/lugano-merchants.json" {
    const merchants: LuganoMerchant[];
    export default merchants;
  }
  
  // metro.config.js - Make sure your Metro bundler can handle JSON files
  // (This should already be configured in most React Native projects)
  
  const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
  
  const defaultConfig = getDefaultConfig(__dirname);
  
  const config = {
    resolver: {
      assetExts: [...defaultConfig.resolver.assetExts, 'json'],
    },
  };
  
  module.exports = mergeConfig(defaultConfig, config);
  
  // If you're using Expo, make sure your app.json includes:
  // {
  //   "expo": {
  //     "assetBundlePatterns": [
  //       "**/*"
  //     ]
  //   }
  // }