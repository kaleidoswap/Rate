const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { createRequire } = require('node:module');
const path = require('node:path');
const test = require('node:test');

const cwd = path.resolve(__dirname, '..');
const appRequire = createRequire(path.join(cwd, 'package.json'));

test('query-string can call the patched decoder from CommonJS', () => {
  const queryString = appRequire('query-string');
  assert.deepEqual({ ...queryString.parse('name=caf%C3%A9&memo=hello+world&symbol=%F0%9F%94%91') }, {
    name: 'café', memo: 'hello world', symbol: '🔑',
  });
  assert.equal(queryString.parse('memo=%FF%41%C3%A9').memo, '%FFAé');
});

// Run hostile inputs in a child: a synchronous infinite loop cannot be stopped
// by the test runner's ordinary async timeout.
test('malformed percent-encoded links do not exhaust the stack or hang', () => {
  execFileSync(process.execPath, ['-e', `
    const assert = require('node:assert/strict');
    const queryString = require('query-string');
    const input = '%FF'.repeat(20000);
    assert.equal(queryString.parse('memo=' + input).memo, input);
  `], { cwd, timeout: 5000, stdio: 'pipe' });
});

test('Expo Metro still reads PNG dimensions with image-size 2', () => {
  const expoRequire = createRequire(appRequire.resolve('@expo/metro/package.json'));
  const { getAssetSize } = expoRequire('metro/private/Assets');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5S8AAAAASUVORK5CYII=', 'base64');
  assert.deepEqual(getAssetSize('png', png, 'pixel.png'), { width: 1, height: 1 });
});

test('Expo Metro builds image asset metadata from a file path', async () => {
  const expoRequire = createRequire(appRequire.resolve('@expo/metro/package.json'));
  const { getAssetData } = expoRequire('metro/private/Assets');
  const assetPath = path.join(cwd, 'assets/icons/protocols/btc.png');
  const data = await getAssetData(assetPath, 'assets/icons/protocols/btc.png', [], 'ios', '/assets');
  assert.ok(data.width > 0);
  assert.ok(data.height > 0);
  assert.ok(data.files.includes(assetPath));
});

test('image-size rejects an ICNS entry whose zero length used to hang the parser', () => {
  execFileSync(process.execPath, ['-e', `
    const assert = require('node:assert/strict');
    const { imageSize } = require('image-size');
    const input = Buffer.alloc(16);
    input.write('icns');
    input.writeUInt32BE(input.length, 4);
    input.write('ic07', 8);
    assert.throws(() => imageSize(input));
  `], { cwd, timeout: 5000, stdio: 'pipe' });
});
