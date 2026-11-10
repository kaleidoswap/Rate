// Read-only smoke test of the SAME catalogue parser used by the mobile screen.
// No account, invoice, RFQ, transaction or storage write is created.
const fs = require('node:fs');
const path = require('node:path');
const babel = require('@babel/core');
require.extensions['.ts'] = (module, filename) => module._compile(babel.transformSync(fs.readFileSync(filename, 'utf8'), {
  filename, babelrc: false, configFile: false,
  presets: [require.resolve('@babel/preset-typescript')], plugins: [require.resolve('@babel/plugin-transform-modules-commonjs')],
}).code, filename);
const storage = require.resolve('@react-native-async-storage/async-storage');
require.cache[storage] = { id: storage, filename: storage, loaded: true, exports: new Proxy({}, { get: () => () => { throw Error('Storage must not be used by catalogue discovery'); } }) };
const { loadMakerCatalog } = require('../services/makerRoutes.ts');
loadMakerCatalog(process.argv[2] || 'https://maker.signet.kaleidoswap.com', process.argv[3] || 'mutinynet')
  .then(catalog => console.log(JSON.stringify(catalog, null, 2)))
  .catch(error => { console.error(error.message); process.exitCode = 1; });
