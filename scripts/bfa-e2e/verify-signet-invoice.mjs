import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [fixturePath, currentDir, previousDir] = process.argv.slice(2);
assert.ok(fixturePath && currentDir && previousDir, 'Pass the native invoice JSON and the beta.4 and beta.3 WASM package directories.');
const native = JSON.parse(await readFile(fixturePath, 'utf8'));
assert.equal(native.network, 'SIGNET');
assert.equal(native.encryption, 'REQUIRED');

async function decode(directory) {
  const binding = pathToFileURL(resolve(directory, 'rgb_lib_wasm_bindings.js'));
  const { initSync, WasmInvoice } = await import(binding.href);
  initSync({ module: await readFile(new URL('rgb_lib_wasm_bindings_bg.wasm', binding)) });
  const invoice = new WasmInvoice(native.invoice);
  try {
    return invoice.invoiceData();
  } finally {
    invoice.free();
  }
}

const current = await decode(currentDir);
assert.equal(current.network, 'Signet');
assert.equal(current.encryption, 'Required');
assert.equal(current.publicKey, native.publicKey);
assert.equal(current.recipientId, native.recipientId);
assert.equal(current.assetId, undefined);
assert.equal(String(current.assignment.Fungible), String(native.assignment.amount));
assert.equal(String(current.expirationTimestamp), String(native.expirationTimestamp));
assert.deepEqual(current.transportEndpoints, native.transportEndpoints);
console.log('PASS WASM beta.4 preserved the Signet invoice network, amount, expiry, proxy, and required encryption.');

const previous = await decode(previousDir);
assert.equal(previous.recipientId, native.recipientId);
assert.equal(previous.encryption, undefined);
assert.equal(previous.publicKey, undefined);
console.log('PASS reproduced WASM beta.3 dropping the encryption and public key fields.');
