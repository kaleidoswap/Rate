#!/usr/bin/env node
// Run the app's real network choice + folder logic with an isolated settings
// store. Native capabilities reflect the simulator framework used by run.sh.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const babel = require('@babel/core');
const root = path.resolve(__dirname, '../..');
const state = process.argv[2];
assert(state && path.isAbsolute(state), 'Pass the absolute test state directory');
require.extensions['.ts'] = (module, filename) => module._compile(babel.transformSync(fs.readFileSync(filename, 'utf8'), {
  filename, babelrc: false, configFile: false,
  presets: [require.resolve('@babel/preset-typescript')], plugins: [require.resolve('@babel/plugin-transform-modules-commonjs')],
}).code, filename);
const settingFile = path.join(state, 'app-test-settings.json');
const settings = fs.existsSync(settingFile) ? JSON.parse(fs.readFileSync(settingFile, 'utf8')) : {};
const db = { getSetting: async k => settings[k] ?? null, setSetting: async (k, v) => {
  settings[k] = v;
  fs.writeFileSync(settingFile, JSON.stringify(settings), { mode: 0o600 });
} };
const bind = (filename, exports) => { require.cache[filename] = { id: filename, filename, loaded: true, exports }; };
bind(path.join(root, 'services/DatabaseService.ts'), { __esModule: true, default: { getInstance: () => db } });
bind(path.join(root, 'modules/kaleido-rgb/index.ts'), { isAvailable: () => true, supportsSubdir: () => true });
const rgb = require(path.join(root, 'services/protocols/rgbL1.ts'));
const seed = fs.readFileSync(path.join(state, 'alice-test-only-mnemonic'), 'utf8');
(async () => {
  const folders = {};
  const hosts = {};
  for (const network of ['mutinynet', 'mainnet', 'signet', 'testnet', 'mutinynet']) {
    await rgb.saveRgbL1Network(seed, network);
    assert.equal(await rgb.loadRgbL1Network(seed), network);
    const folder = await rgb.claimRgbL1DataFolder(seed, network);
    hosts[network] = await rgb.loadRgbL1Host(seed, network);
    folders[network] = folder ?? '.';
    await rgb.markRgbL1Ready(seed, network);
    console.log(JSON.stringify({ event: 'app-network-config', network, folder, dataId: rgb.rgbL1DataId(network) }));
  }
  assert.equal(new Set(Object.values(folders)).size, 4);
  assert.deepEqual(new Set(await rgb.readyRgbL1Networks(seed)), new Set(rgb.RGB_L1_NETWORKS));
  fs.writeFileSync(path.join(state, 'network-hosts.json'), JSON.stringify(hosts), { mode: 0o600 });
  fs.writeFileSync(path.join(state, 'network-config.json'), JSON.stringify(folders), { mode: 0o600 });
})().catch(error => { console.error(error.message); process.exitCode = 1; });
