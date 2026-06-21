#!/usr/bin/env node
/**
 * Generate and sync the QVAC mobile worker bundle.
 *
 * The worker bundle embeds native addon identifiers such as bare-url.2.4.5.
 * If node_modules changes and we only copy an old bundle back into @qvac/sdk,
 * the worker can request addon versions that are no longer present in the iOS
 * app and crash with ADDON_NOT_FOUND. Regenerating here keeps the JS worker
 * bundle and native linked addons in lockstep after installs.
 */
const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const hosts = ['android-arm64', 'ios-arm64', 'ios-arm64-simulator', 'ios-x64-simulator'];

function resolveSdkDir() {
  try {
    const pluginEntry = require.resolve('@qvac/sdk/expo-plugin', { paths: [projectRoot] });
    return path.resolve(path.dirname(pluginEntry), '..', '..', '..');
  } catch {
    return null;
  }
}

async function main() {
  const sdkPath = resolveSdkDir();
  if (!sdkPath) {
    console.log('[sync-qvac-bundle] @qvac/sdk not installed. Skipping.');
    return;
  }

  const sdkPackagePath = path.join(sdkPath, 'package.json');
  const sdkPackage = JSON.parse(fs.readFileSync(sdkPackagePath, 'utf8'));
  const configPath = path.join(projectRoot, 'qvac.config.json');
  const bundleOptions = {
    projectRoot,
    sdkPath,
    hosts,
    defer: ['expo-file-system', 'react-native-bare-kit', `${sdkPackage.name}/worker.mobile.bundle`],
    quiet: false,
  };

  if (fs.existsSync(configPath)) {
    bundleOptions.configPath = configPath;
  }

  const {
    bundleSdk,
    verifyBundle,
    hasErrors,
    formatVerifyBundleResult,
  } = await import('@qvac/sdk/commands');

  const result = await bundleSdk(bundleOptions);
  const verification = await verifyBundle({
    projectRoot,
    addonsSource: result.bundlePath,
    hosts,
    ...(bundleOptions.configPath ? { configPath: bundleOptions.configPath } : {}),
  });

  if (hasErrors(verification)) {
    console.error(formatVerifyBundleResult(verification));
    throw new Error('QVAC worker bundle verification failed');
  }

  const dest = path.join(sdkPath, 'dist', 'worker.mobile.bundle.js');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(result.bundlePath, dest);
  console.log(`[sync-qvac-bundle] generated and synced ${path.relative(projectRoot, dest)}`);
}

main().catch((error) => {
  console.error('[sync-qvac-bundle] failed:', error && error.stack ? error.stack : error);
  process.exit(1);
});
