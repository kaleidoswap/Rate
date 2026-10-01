module.exports = function (api) {
    // Cache per NODE_ENV so dev and release bundles get the right plugin set.
    const isProduction = api.cache.using(() => process.env.NODE_ENV) === 'production';
    return {
      presets: [
        'babel-preset-expo',
        ['@babel/preset-typescript', { allowDeclareFields: true }]
      ],
      plugins: [
        ['@babel/plugin-transform-runtime', { helpers: true }],
        // Release bundles must not log wallet/payment details (keeps warn/error).
        ...(isProduction ? ['./scripts/babel-plugin-strip-console'] : []),
        'react-native-reanimated/plugin',
      ],
    };
  };
