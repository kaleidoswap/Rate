const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { patchBarkRuntime } = require('./prepare-bark-native');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rate-uniffi-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bark = path.join(root, 'node_modules/@secondts/bark-react-native');
  const runtime = path.join(bark, 'node_modules/uniffi-bindgen-react-native');
  const put = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
  put(path.join(bark, 'package.json'), JSON.stringify({ version: '0.25.0' }));
  put(path.join(runtime, 'package.json'), JSON.stringify({ version: '0.31.0-5' }));
  put(path.join(runtime, 'cpp/includes/UniffiJsiTypes.h'), '#include "UniffiString.h"\nnamespace uniffi_jsi { struct RustBuffer {}; }');
  put(path.join(runtime, 'cpp/includes/UniffiString.h'), '/* MPL notice */\nnamespace uniffi_runtime {}');
  put(path.join(bark, 'cpp/generated/bark.cpp'), '#include "UniffiJsiTypes.h"\nuniffi_jsi::RustBuffer bridge;\nRustCallStatus status;\nForeignBytes bytes;');
  put(path.join(bark, 'BarkReactNative.podspec'), '  s.dependency    "uniffi-bindgen-react-native", "0.31.0-5"');
  return { root, bark, runtime };
}
function snapshot(dir) {
  return Object.fromEntries(fs.readdirSync(dir, { recursive: true }).sort().filter(name => fs.statSync(path.join(dir, name)).isFile()).map(name => [name, fs.readFileSync(path.join(dir, name), 'utf8')]));
}
test('isolates headers, C++ symbols and the pod dependency without altering the shared runtime', t => {
  const { root, bark, runtime } = fixture(t);
  const original = snapshot(runtime);
  patchBarkRuntime(root);
  const cpp = fs.readFileSync(path.join(bark, 'cpp/generated/bark.cpp'), 'utf8');
  assert.match(cpp, /#include "\.\.\/bark-runtime\/BarkRuntime_UniffiJsiTypes.h"/);
  assert.match(cpp, /bark_uniffi_jsi::BarkRustBuffer/);
  assert.match(cpp, /BarkRustCallStatus/);
  assert.match(cpp, /BarkForeignBytes/);
  const types = fs.readFileSync(path.join(bark, 'cpp/bark-runtime/BarkRuntime_UniffiJsiTypes.h'), 'utf8');
  assert.match(types, /#include "BarkRuntime_UniffiString.h"/);
  assert.match(fs.readFileSync(path.join(bark, 'cpp/bark-runtime/BarkRuntime_UniffiString.h'), 'utf8'), /MPL notice/);
  assert.doesNotMatch(fs.readFileSync(path.join(bark, 'BarkReactNative.podspec'), 'utf8'), /s\.dependency/);
  assert.deepEqual(snapshot(runtime), original);
  const once = snapshot(bark);
  patchBarkRuntime(root);
  assert.deepEqual(snapshot(bark), once, 'repeated setup must be a no-op');
});
test('rejects unreviewed runtime upgrades before changing generated bindings', t => {
  const { root, bark, runtime } = fixture(t);
  fs.writeFileSync(path.join(runtime, 'package.json'), JSON.stringify({ version: '0.32.0' }));
  const before = snapshot(bark);
  assert.throws(() => patchBarkRuntime(root), /Review Bark/);
  assert.deepEqual(snapshot(bark), before);
});
