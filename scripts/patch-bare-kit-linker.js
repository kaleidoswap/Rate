#!/usr/bin/env node
/**
 * Re-apply QVAC's manifest-aware Android addon linker after install.
 *
 * `react-native-bare-kit/android/build.gradle` runs `node link.mjs` on every
 * Gradle build (`preBuild.dependsOn link`) and packages whatever addons it
 * emits into `src/main/addons`. The STOCK `link.mjs` links EVERY installed
 * bare/QVAC native addon — so a build that hasn't run `expo prebuild` ships all
 * `@qvac/*` modality libs (diffusion / translation / ocr / onnx / vla / … —
 * ~125 MB of `.so` the app never loads, since only the modalities in
 * `qvac.config.json` are in the worker bundle).
 *
 * The QVAC SDK ships a manifest-aware replacement
 * (`@qvac/sdk/expo/plugins/patches/android-link.mjs`) that links only the addons
 * allowlisted in `qvac/addons.manifest.json` (generated from `qvac.config.json`).
 * `expo prebuild` copies it over `link.mjs` locally via `withMobileBundle` — but
 * `pnpm/npm install` restores the stock file, and CI builds the APK without
 * prebuilding, so CI never gets the filtered linker and ships everything.
 *
 * This script re-applies the patch after every install — the same pattern as
 * `sync-qvac-bundle.js`, which restores the worker bundle that install wipes.
 *
 * It no-ops (exit 0) when either file is missing or already in sync, and never
 * throws — a failure here must not break `install`.
 */
const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');

function resolveDir(pkgSpec, fallback) {
  try {
    return path.dirname(require.resolve(pkgSpec, { paths: [projectRoot] }));
  } catch {
    return path.join(projectRoot, 'node_modules', ...fallback);
  }
}

// The manifest-aware linker shipped by the SDK (location varies by SDK build).
const sdkDir = resolveDir('@qvac/sdk/package.json', ['@qvac', 'sdk']);
const src = [
  path.join(sdkDir, 'expo', 'plugins', 'patches', 'android-link.mjs'),
  path.join(sdkDir, 'dist', 'expo', 'plugins', 'patches', 'android-link.mjs'),
].find((p) => fs.existsSync(p));

// The stock linker that install (re)writes.
const bareKitDir = resolveDir('react-native-bare-kit/package.json', ['react-native-bare-kit']);
const dest = path.join(bareKitDir, 'android', 'link.mjs');

if (!src) {
  console.log('[patch-bare-kit-linker] @qvac/sdk android-link patch not found — skipping.');
  process.exit(0);
}
if (!fs.existsSync(dest)) {
  console.log('[patch-bare-kit-linker] react-native-bare-kit/android/link.mjs not found — skipping.');
  process.exit(0);
}

try {
  const want = fs.readFileSync(src);
  const have = fs.readFileSync(dest);
  if (want.equals(have)) {
    process.exit(0); // already manifest-aware
  }
  fs.copyFileSync(src, dest);
  console.log('[patch-bare-kit-linker] applied manifest-aware Android addon linker (link.mjs).');
} catch (e) {
  console.warn('[patch-bare-kit-linker] could not apply patch:', e.message);
  // Don't fail install — `expo prebuild` can still apply it.
}
