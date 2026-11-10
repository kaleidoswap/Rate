#!/usr/bin/env node
// Executes Rate's real transfer preparation and JS Wallet.send against the live
// simulator probe. Only the Expo transport is replaced by a file/CLI transport.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');
const babel = require('@babel/core');
const root = path.resolve(__dirname, '../..');
const state = path.resolve(process.argv[2] || '');
assert(process.argv[2] && path.isAbsolute(process.argv[2]), 'Pass the absolute test state directory');
require.extensions['.ts'] = (module, filename) => {
  const transformed = babel.transformSync(fs.readFileSync(filename, 'utf8'), {
    filename, babelrc: false, configFile: false,
    presets: [require.resolve('@babel/preset-typescript')],
    plugins: [require.resolve('@babel/plugin-transform-modules-commonjs')],
  });
  module._compile(transformed.code, filename);
};
// Expo isn't running in Node. Fail closed if anything bypasses the explicit live
// send transport below; do not emulate wallets, invoices, funds or send results.
const nativeFile = path.join(root, 'modules/kaleido-rgb/src/native.ts');
require.cache[nativeFile] = { id: nativeFile, filename: nativeFile, loaded: true, exports: {
  getNativeModule: () => { throw new Error('Use the live simulator transport'); },
} };
const { Wallet } = require(path.join(root, 'modules/kaleido-rgb/src/index.ts'));
const { RgbLibRnAccount } = require(path.join(root, 'services/protocols/rgbLibRn.ts'));

const fixtures = JSON.parse(fs.readFileSync(path.join(state, 'invalid-invoices.json'), 'utf8'));
(async () => {
  for (const [index, request] of fixtures.entries()) {
    let sends = 0;
    const account = new RgbLibRnAccount({ decodeInvoice: async () => request.decoded }, { send: async () => { sends++; throw new Error('Unexpected send'); } }, '', () => {}, 'mutinynet');
    await assert.rejects(account.transfer({ token: request.decoded.assetId || 'rgb:unused', recipient: request.invoice, amount: 25 }), index === 0 ? /expired/ : /different network/);
    assert.equal(sends, 0);
    console.log(JSON.stringify({ event: index === 0 ? 'live-expired-invoice-blocked' : 'live-signet-invoice-blocked-on-mutinynet' }));
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
