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
assert(!fs.existsSync(path.join(state, 'reverse-transfer.json')), 'Already attempted; use app-status, never resend');
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
const request = JSON.parse(fs.readFileSync(path.join(state, 'reverse-invoice.json'), 'utf8'));
const transport = {
  async op(name, args) {
    assert.equal(name, 'send');
    const recipient = args.recipientMap[request.assetId][0];
    assert.equal(recipient.recipientId, request.decoded.recipientId);
    assert.equal(recipient.witnessData.amountSat, 1000);
    assert.equal(args.donation, false);
    assert.equal(args.minConfirmations, 1);
    fs.writeFileSync(path.join(state, 'reverse-params.json'), JSON.stringify(args, null, 2), { mode: 0o600 });
    const output = execFileSync('bash', [path.join(__dirname, 'run.sh'), state, 'extended-send'], { encoding: 'utf8', timeout: 180000 });
    process.stdout.write(output);
    return JSON.parse(fs.readFileSync(path.join(state, 'reverse-transfer.json'), 'utf8'));
  },
};
const wallet = { send: (...args) => Wallet.prototype.send.apply(transport, args) };
const lib = { decodeInvoice: async invoice => {
  assert.equal(invoice, request.invoice);
  return request.decoded; // Decoded by the native library + actual Swift Mappers.
} };
const account = new RgbLibRnAccount(lib, wallet, 'rpcs://proxy.iriswallet.com/0.2/json-rpc', () => {}, 'mutinynet');
account.transfer({ token: request.assetId, recipient: request.invoice, amount: request.amount, feeRate: 1 })
  .then(result => console.log(JSON.stringify({ event: 'rate-transfer-returned', txid: result.txid, batchTransferIdx: result.batchTransferIdx })))
  .catch(error => { console.error(error.message); process.exitCode = 1; });
