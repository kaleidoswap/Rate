#!/usr/bin/env node
// Runs Rate's actual RGB status resolver with live simulator transfer states.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');
const babel = require('@babel/core');
const root = path.resolve(__dirname, '../..');
const state = process.argv[2];
assert(state && path.isAbsolute(state), 'Pass the absolute test state directory');
require.extensions['.ts'] = (module, filename) => module._compile(babel.transformSync(fs.readFileSync(filename, 'utf8'), {
  filename, babelrc: false, configFile: false,
  presets: [require.resolve('@babel/preset-typescript')], plugins: [require.resolve('@babel/plugin-transform-modules-commonjs')],
}).code, filename);
// Registration and fee services aren't used by the status function under test.
// Stop accidental calls rather than returning simulated results.
for (const relative of ['services/kaleidoPay/rgbPay.ts', 'services/rgbWallet.ts']) {
  const filename = path.join(root, relative);
  require.cache[filename] = { id: filename, filename, loaded: true, exports: {} };
}
const { rgbL1TransferStatus } = require(path.join(root, 'services/kaleidoPay/rgbL1Pay.ts'));
const receipt = JSON.parse(fs.readFileSync(path.join(state, 'app-transfer.json'), 'utf8'));
let transfers;
const adapter = {
  account: {
    async refreshTransfers() {
      const output = execFileSync('bash', [path.join(__dirname, 'run.sh'), state, 'app-status'], { encoding: 'utf8', timeout: 180000 });
      process.stdout.write(output);
      transfers = output.trim().split('\n').map(line => JSON.parse(line)).find(event => event.event === 'app-transfers');
      assert(transfers && transfers.txid === receipt.txid, 'No matching live transfer result');
    },
    async listTransfers(assetId) {
      assert.equal(assetId, transfers.assetId);
      return transfers.alice.map(status => ({ txid: transfers.txid, status }));
    },
  },
  async listAssets() { return [{ id: transfers.assetId }]; },
};
rgbL1TransferStatus(adapter, receipt.txid).then(result => {
  console.log(JSON.stringify({ event: 'rate-status-result', ...result }));
  fs.writeFileSync(path.join(state, 'rate-status-result.json'), JSON.stringify(result, null, 2), { mode: 0o600 });
}).catch(error => { console.error(error.message); process.exitCode = 1; });
