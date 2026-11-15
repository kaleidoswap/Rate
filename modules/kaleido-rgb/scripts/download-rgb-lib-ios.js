#!/usr/bin/env node
/**
 * Fetches rgb-lib's iOS binary (rgb_libFFI.xcframework) from RGB-Tools'
 * rgb-lib-swift release and checks it against the pinned SHA-256 (the checksum
 * rgb-lib-swift's Package.swift pins for the same tag). Also checks that the
 * vendored ios/RgbLib.swift is the generated binding from that tag. Run on
 * install; macOS only (Android takes rgb-lib from Maven Central).
 *
 * Set KALEIDO_RGB_SKIP_IOS_DOWNLOAD=1 to skip the ~1.1 GB download when not
 * building for iOS.
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const https = require('node:https');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const RGB_LIB_VERSION = '0.3.0-beta.7';
const XCFRAMEWORK_URL = `https://github.com/RGB-Tools/rgb-lib-swift/releases/download/${RGB_LIB_VERSION}/rgb_libFFI.xcframework.zip`;
const XCFRAMEWORK_SHA256 = 'd3da4d3e24cd3ea2c88ba15a092d6e29b13f96fd116bf7b5a50cb3595eaa8f0e';
// Sources/RgbLib/RgbLib.swift at rgb-lib-swift tag 0.3.0-beta.7.
const BINDING_SHA256 = '50a9c605b6ae44cefce9c73ba4c6d273fb9ddd7036939795d0fe1f3c51508c57';

const IOS_DIR = path.join(__dirname, '..', 'ios');
const FRAMEWORK = 'rgb_libFFI.xcframework';
const MARKER = '.rgb-lib-version';

const sha256File = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

/** Throws unless ios/RgbLib.swift is the pinned generated binding. */
function verifyBinding(iosDir = IOS_DIR) {
  const actual = sha256File(path.join(iosDir, 'RgbLib.swift'));
  if (actual !== BINDING_SHA256) {
    throw new Error(`ios/RgbLib.swift is not rgb-lib-swift ${RGB_LIB_VERSION}'s binding (sha256 ${actual}).`);
  }
}

/** Whether the pinned framework is already in place. */
function isInstalled(iosDir = IOS_DIR) {
  const marker = path.join(iosDir, FRAMEWORK, MARKER);
  return fs.existsSync(path.join(iosDir, FRAMEWORK, 'Info.plist')) && fs.existsSync(marker)
    && fs.readFileSync(marker, 'utf8').trim() === `${RGB_LIB_VERSION} ${XCFRAMEWORK_SHA256} ios-only`;
}

function download(url, dest, redirects = 5) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'kaleido-rgb-install' } }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects > 0) {
        res.resume();
        resolve(download(new URL(res.headers.location, url).toString(), dest, redirects - 1));
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`Download failed: HTTP ${res.statusCode}`));
        return;
      }
      const hash = crypto.createHash('sha256');
      const out = fs.createWriteStream(dest);
      res.on('data', (chunk) => hash.update(chunk));
      res.pipe(out);
      out.on('finish', () => out.close(() => resolve(hash.digest('hex'))));
      out.on('error', reject);
      res.on('error', reject);
    }).on('error', reject);
  });
}

// The release ships macOS and fat simulator slices over 2 GiB, more than
// CocoaPods can read. Keep the device slice as published; drop macOS and thin
// the simulator slice to arm64.
function trimSlices(target) {
  const plist = path.join(target, 'Info.plist');
  const info = JSON.parse(execFileSync('plutil', ['-convert', 'json', '-o', '-', plist], { encoding: 'utf8' }));
  const kept = [];
  for (const lib of info.AvailableLibraries) {
    const slice = path.join(target, lib.LibraryIdentifier);
    if (lib.SupportedPlatform !== 'ios') {
      fs.rmSync(slice, { recursive: true, force: true });
      continue;
    }
    if (lib.SupportedPlatformVariant === 'simulator' && lib.SupportedArchitectures.length > 1) {
      const binary = path.join(slice, lib.LibraryPath, 'rgb_libFFI');
      execFileSync('lipo', [binary, '-thin', 'arm64', '-output', `${binary}.arm64`], { stdio: 'inherit' });
      fs.renameSync(`${binary}.arm64`, binary);
      lib.SupportedArchitectures = ['arm64'];
    }
    kept.push(lib);
  }
  info.AvailableLibraries = kept;
  fs.writeFileSync(plist, JSON.stringify(info));
  execFileSync('plutil', ['-convert', 'xml1', plist], { stdio: 'inherit' });
}

async function install(iosDir = IOS_DIR) {
  verifyBinding(iosDir);
  if (process.platform !== 'darwin') return 'skipped: not macOS';
  if (process.env.KALEIDO_RGB_SKIP_IOS_DOWNLOAD === '1') return 'skipped: KALEIDO_RGB_SKIP_IOS_DOWNLOAD=1';
  if (isInstalled(iosDir)) return 'already installed';
  const zip = path.join(iosDir, `${FRAMEWORK}.zip`);
  const target = path.join(iosDir, FRAMEWORK);
  try {
    console.log(`[kaleido-rgb] Downloading rgb-lib ${RGB_LIB_VERSION} for iOS (~1.1 GB)…`);
    const digest = await download(XCFRAMEWORK_URL, zip);
    if (digest !== XCFRAMEWORK_SHA256) throw new Error(`Checksum mismatch for ${FRAMEWORK}.zip: ${digest}`);
    fs.rmSync(target, { recursive: true, force: true });
    execFileSync('unzip', ['-q', '-o', zip, '-d', iosDir], { stdio: 'inherit' });
    if (!fs.existsSync(path.join(target, 'Info.plist'))) throw new Error(`${FRAMEWORK} missing after extraction`);
    trimSlices(target);
    fs.writeFileSync(path.join(target, MARKER), `${RGB_LIB_VERSION} ${XCFRAMEWORK_SHA256} ios-only\n`);
    return 'installed';
  } finally {
    fs.rmSync(zip, { force: true });
  }
}

if (require.main === module) {
  install().then(
    (result) => console.log(`[kaleido-rgb] rgb-lib iOS framework: ${result}`),
    (error) => {
      console.error(`[kaleido-rgb] ${error.message}`);
      process.exit(1);
    },
  );
}

module.exports = { RGB_LIB_VERSION, XCFRAMEWORK_SHA256, BINDING_SHA256, verifyBinding, isInstalled, install, trimSlices };
