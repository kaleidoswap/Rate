#!/usr/bin/env node
/**
 * Keep Bark's UniFFI 0.31 JSI bridge private to Bark, so another UniFFI-based
 * native module (Liquid's lwk-rn used 0.28) can't clash with it. A Pod version
 * override alone either fails compilation or mixes weak C++ bridge symbols.
 *
 * Both runtimes are header-only. Copy Bark's exact headers under unique names,
 * isolate their C++ namespaces/FFI struct names, and include them by relative
 * path. Rust C exports and JS bindings stay unchanged. Keep MPL notices intact.
 * Reapplied after every install; reject unreviewed dependency upgrades.
 */
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { spawnSync } = require('node:child_process');
const ROOT = path.resolve(__dirname, '..');
const MARKER = '# Rate: Bark uses its private, namespaced UniFFI headers.';
const identifiers = { uniffi_jsi: 'bark_uniffi_jsi', uniffi_runtime: 'bark_uniffi_runtime', RustBuffer: 'BarkRustBuffer', RustCallStatus: 'BarkRustCallStatus', ForeignBytes: 'BarkForeignBytes' };
function isolate(text) {
  return text.replace(/\b(uniffi_jsi|uniffi_runtime|RustBuffer|RustCallStatus|ForeignBytes)\b/g, word => identifiers[word]);
}
function writeChanged(file, text) {
  if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== text) fs.writeFileSync(file, text);
}
function patchBarkRuntime(root = ROOT) {
  const bark = path.join(root, 'node_modules/@secondts/bark-react-native');
  if (!fs.existsSync(bark)) return null;
  const version = JSON.parse(fs.readFileSync(path.join(bark, 'package.json'), 'utf8')).version;
  const requireBark = createRequire(path.join(bark, 'package.json'));
  const runtime = path.dirname(requireBark.resolve('uniffi-bindgen-react-native/package.json'));
  const runtimeVersion = JSON.parse(fs.readFileSync(path.join(runtime, 'package.json'), 'utf8')).version;
  if (version !== '0.25.0' || runtimeVersion !== '0.31.0-5') {
    throw new Error(`Review Bark's native isolation before upgrading: found Bark ${version}, UniFFI ${runtimeVersion}.`);
  }
  const source = path.join(runtime, 'cpp/includes');
  const dest = path.join(bark, 'cpp/bark-runtime');
  const headers = fs.readdirSync(source).filter(name => name.endsWith('.h'));
  if (!headers.includes('UniffiJsiTypes.h') || !headers.includes('UniffiString.h')) throw new Error('Bark runtime headers are missing.');
  fs.mkdirSync(dest, { recursive: true });
  const rewriteIncludes = (text, from) => text.replace(/#include "([^"]+)"/g, (line, name) => {
    if (!headers.includes(name)) return line;
    const relative = path.relative(path.dirname(from), path.join(dest, `BarkRuntime_${name}`)).split(path.sep).join('/');
    return `#include "${relative}"`;
  });
  for (const name of headers) {
    const output = path.join(dest, `BarkRuntime_${name}`);
    writeChanged(output, isolate(rewriteIncludes(fs.readFileSync(path.join(source, name), 'utf8'), output)));
  }
  const visit = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (file === dest) continue;
      if (entry.isDirectory()) visit(file);
      else if (/\.(cpp|hpp|h)$/.test(file)) writeChanged(file, isolate(rewriteIncludes(fs.readFileSync(file, 'utf8'), file)));
    }
  };
  visit(path.join(bark, 'cpp'));
  const podspec = path.join(bark, 'BarkReactNative.podspec');
  let spec = fs.readFileSync(podspec, 'utf8');
  if (!spec.includes(MARKER)) {
    const dependency = /  s\.dependency\s+"uniffi-bindgen-react-native", "0\.31\.0-5"/;
    if (!dependency.test(spec)) throw new Error('Bark podspec changed; review the runtime isolation patch.');
    spec = spec.replace(dependency, `  ${MARKER}\n  s.private_header_files = "cpp/bark-runtime/*.h"`);
    writeChanged(podspec, spec);
  }
  return bark;
}
if (require.main === module) {
  const bark = patchBarkRuntime();
  if (bark) {
    console.log('[prepare-bark-native] Isolated Bark UniFFI 0.31.');
    const iosMissing = process.platform === 'darwin' && !fs.existsSync(path.join(bark, 'build/RnBark.xcframework'));
    const androidMissing = !fs.existsSync(path.join(bark, 'android/src/main/jniLibs'));
    if (!process.argv.includes('--patch-only') && (iosMissing || androidMissing)) {
      const result = spawnSync(process.execPath, [path.join(bark, 'scripts/postinstall.js')], { stdio: 'inherit' });
      if (result.error || result.status !== 0) throw new Error('Bark artifacts could not be installed. Run pnpm run setup:native again.');
    }
  }
}
module.exports = { isolate, patchBarkRuntime };
