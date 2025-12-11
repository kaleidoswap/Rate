module.exports = function (api) {
    api.cache(true);
    return {
      presets: [
        'babel-preset-expo',
        ['@babel/preset-typescript', { allowDeclareFields: true }]
      ],
      plugins: [
        ['@babel/plugin-transform-runtime', { helpers: true }],
        'react-native-reanimated/plugin',
      ],
    };
  };