#!/usr/bin/env node
// Native encrypted backup -> local restore and real VSS -> clean native restore.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const babel = require('@babel/core');
const state = process.argv[2];
assert(state && path.isAbsolute(state));
const root = path.resolve(__dirname, '../..');
require.extensions['.ts'] = (module, filename) => module._compile(babel.transformSync(fs.readFileSync(filename, 'utf8'), {
  filename, babelrc: false, configFile: false, presets: [require.resolve('@babel/preset-typescript')], plugins: [require.resolve('@babel/plugin-transform-modules-commonjs')],
}).code, filename);
const bind = (filename, exports) => { require.cache[filename] = { id: filename, filename, loaded: true, exports }; };
bind(path.join(root, 'services/DatabaseService.ts'), { __esModule: true, default: { getInstance: () => ({}) } });
bind(path.join(root, 'modules/kaleido-rgb/index.ts'), { isAvailable: () => true, supportsSubdir: () => true });
const rgb = require(path.join(root, 'services/protocols/rgbL1.ts'));
const vss = require(path.join(root, 'services/protocols/rgbVss.ts'));
const seed = fs.readFileSync(path.join(state, 'bob-test-only-mnemonic'), 'utf8');
const password = rgb.rgbBackupPassword(seed);
const stamp = Date.now();
const file = path.join(state, `bob-${stamp}.rgbbackup`);
const requestFile = path.join(state, 'backup-request.json');
function native(mode, request) {
  fs.writeFileSync(requestFile, JSON.stringify(request), { mode: 0o600 });
  try { return execFileSync('bash', [path.join(__dirname, 'run.sh'), state, mode], { encoding: 'utf8', timeout: 180000 }); }
  finally { fs.rmSync(requestFile, { force: true }); }
}
function target(name) {
  const dir = path.join(state, `restore-${name}-${stamp}`);
  fs.mkdirSync(dir, { mode: 0o700 });
  fs.writeFileSync(path.join(dir, 'bob-test-only-mnemonic'), seed, { mode: 0o600 });
  return dir;
}
(async () => {
  process.stdout.write(native('backup-export', { path: file, password }));
  try {
    native('backup-restore', { path: file, password: 'deliberately-wrong-test-password', target: target('wrong-password') });
    throw new Error('Wrong backup password was accepted');
  } catch (error) {
    assert.match(String(error.stdout), /password/i);
    console.log(JSON.stringify({ event: 'wrong-backup-password-rejected' }));
  }
  process.stdout.write(native('backup-restore', { path: file, password, target: target('local') }));
  const store = `rgb-l1-file-${rgb.rgbL1WalletKey(seed)}-${rgb.rgbL1DataId('mutinynet')}`;
  const client = vss.createVssClient('https://vss.kaleidoswap.com/vss', store, vss.vssSigningKey(seed));
  const bytes = new Uint8Array(fs.readFileSync(file));
  const manifest = await vss.uploadBackupFile(client, 'rgb-backup-file', bytes);
  const downloaded = await vss.downloadBackupFile(client, 'rgb-backup-file');
  assert.deepEqual(downloaded.data, bytes);
  const cloud = path.join(state, `bob-cloud-${stamp}.rgbbackup`);
  fs.writeFileSync(cloud, downloaded.data, { mode: 0o600 });
  console.log(JSON.stringify({ event: 'vss-roundtrip-pass', bytes: bytes.length, sha256: manifest.sha256 }));
  process.stdout.write(native('backup-restore', { path: cloud, password, target: target('cloud') }));
  const other = vss.createVssClient('https://vss.kaleidoswap.com/vss', `rgb-l1-file-${rgb.rgbL1WalletKey(seed)}-signet`, vss.vssSigningKey(seed));
  assert.equal(await vss.readBackupManifest(other, 'rgb-backup-file'), undefined);
  console.log(JSON.stringify({ event: 'cloud-network-isolation-pass' }));
})().catch(error => { console.error(error.stdout || error.message); process.exitCode = 1; });
