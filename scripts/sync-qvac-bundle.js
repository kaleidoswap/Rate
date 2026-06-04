#!/usr/bin/env node
/**
 * Restore the QVAC mobile worker bundle into the SDK package.
 *
 * The `@qvac/sdk/expo-plugin` (withMobileBundle) generates `qvac/worker.bundle.js`
 * during `expo prebuild` and copies it to
 * `node_modules/@qvac/sdk/dist/worker.mobile.bundle.js` — which the SDK then
 * `require()`s at runtime. That copy lives inside node_modules, so any
 * `npm/pnpm install` wipes it and the app crashes with:
 *   "Cannot find module '@qvac/sdk/worker.mobile.bundle'".
 *
 * This script re-copies the already-generated, verified bundle after install.
 * It no-ops (exit 0) when the source bundle hasn't been generated yet — run
 * `expo prebuild` once to produce it.
 */
const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const src = path.join(projectRoot, 'qvac', 'worker.bundle.js');

function resolveSdkDistDir() {
  try {
    // Resolve the SDK package.json, then its dist dir.
    const pkgJson = require.resolve('@qvac/sdk/package.json', { paths: [projectRoot] });
    return path.join(path.dirname(pkgJson), 'dist');
  } catch {
    return path.join(projectRoot, 'node_modules', '@qvac', 'sdk', 'dist');
  }
}

const dest = path.join(resolveSdkDistDir(), 'worker.mobile.bundle.js');

if (!fs.existsSync(src)) {
  console.log('[sync-qvac-bundle] qvac/worker.bundle.js not generated yet — run `expo prebuild`. Skipping.');
  process.exit(0);
}
if (fs.existsSync(dest) && fs.statSync(dest).size === fs.statSync(src).size) {
  process.exit(0); // already in place
}
try {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  console.log(`[sync-qvac-bundle] restored worker.mobile.bundle.js (${fs.statSync(dest).size} bytes)`);
} catch (e) {
  console.warn('[sync-qvac-bundle] could not restore bundle:', e.message);
  // Don't fail the install — the plugin / prebuild can still produce it.
}
