const { transformSync } = require('@babel/core');
const { runInNewContext } = require('node:vm');
const path = require('node:path');

describe('native startup scripts', () => {
  test.each(['ios', 'android'])('%s polyfills run before Metro require exists', platform => {
    const { code } = transformSync(
      'class Startup { value = 42; } globalThis.startupValue = new Startup().value;',
      {
        filename: path.join(__dirname, 'startup-polyfill.js'),
        configFile: path.join(__dirname, '..', 'babel.config.js'),
        sourceType: 'script',
        caller: { name: 'metro', bundler: 'metro', platform, metroSourceType: 'script', isDev: true },
      },
    );
    const runtime = {};
    runInNewContext(code, runtime);
    expect(runtime.startupValue).toBe(42);
  });
});
