/* eslint-disable no-console */
// Restores the QVAC mobile worker bundle into @qvac/sdk after every install.
//
// Why: the Expo prebuild (via @qvac/sdk/expo-plugin) generates
// `qvac/worker.bundle.js` and copies it to
// `node_modules/@qvac/sdk/dist/worker.mobile.bundle.js`. Any subsequent
// `pnpm install` / `pnpm add` reinstalls @qvac/sdk from the content-addressed
// store, wiping that generated file — and the app then crashes at runtime with
// "Cannot find module '@qvac/sdk/worker.mobile.bundle'".
//
// We keep the verified bundle committed at `qvac/worker.bundle.js` and copy it
// back into the SDK on postinstall so installs are self-healing. If the bundle
// was never generated (fresh clone without prebuild), this is a no-op — run
// `npx expo prebuild` to generate it.
const fs = require('fs');
const path = require('path');

const projectRoot = path.join(__dirname, '..');

try {
  const src = path.join(projectRoot, 'qvac', 'worker.bundle.js');
  if (!fs.existsSync(src)) {
    console.log('[qvac] qvac/worker.bundle.js not found — run `expo prebuild` to generate it. Skipping.');
    process.exit(0);
  }

  // Resolve the SDK package dir via its exported expo-plugin entry
  // (we cannot require.resolve package.json — it is not in "exports").
  let sdkDir;
  try {
    const pluginEntry = require.resolve('@qvac/sdk/expo-plugin', { paths: [projectRoot] });
    // .../@qvac/sdk/dist/expo/plugins/index.js -> .../@qvac/sdk
    sdkDir = path.resolve(path.dirname(pluginEntry), '..', '..', '..');
  } catch {
    console.log('[qvac] @qvac/sdk not installed — skipping bundle restore.');
    process.exit(0);
  }

  const dest = path.join(sdkDir, 'dist', 'worker.mobile.bundle.js');
  if (fs.existsSync(dest)) {
    const current = fs.readFileSync(dest);
    const expected = fs.readFileSync(src);
    if (current.equals(expected)) {
      process.exit(0); // already current, nothing to do
    }
  }

  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  console.log('[qvac] restored mobile worker bundle ->', path.relative(projectRoot, dest));
} catch (err) {
  // Never fail the install over this — just warn.
  console.warn('[qvac] bundle restore skipped:', err && err.message ? err.message : err);
}
