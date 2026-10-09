/**
 * Checks that every native addon version the QVAC worker bundle loads is one
 * the bare-kit linker will put in the app.
 *
 * The bundle requests addons by exact version (`linked:libbare-ffmpeg.1.2.3.so`),
 * while the manifest-aware linker resolves each manifest addon by name from the
 * project root and walks dependencies from there. A version that only exists
 * nested under a non-addon package is never linked, and the worker then aborts
 * the whole app with ADDON_NOT_FOUND as soon as KaleidoMind starts it.
 */
const fs = require('fs');
const path = require('path');
const { fileURLToPath } = require('url');

/** `name.version` ids (bare-link naming) of the addons a worker bundle loads. */
function requiredAddons(bundleSource) {
  const ids = new Set();
  const re = /linked:lib([A-Za-z0-9_.-]+?)\.(\d+\.\d+\.\d+(?:-[A-Za-z0-9.]+)?)\.so/g;
  let m;
  while ((m = re.exec(bundleSource)) !== null) ids.add(`${m[1]}.${m[2]}`);
  return [...ids].sort();
}

/** `name.version` ids of the addons the linker reaches from the manifest. */
async function linkableAddons(projectRoot, addonNames, platform = 'android') {
  const bareLinkDir = path.dirname(require.resolve('bare-link/package', { paths: [projectRoot] }));
  const dependencies = require(path.join(bareLinkDir, 'lib', 'dependencies.js'));
  const ids = new Set();
  const visited = new Set();

  async function walk(base, pkg) {
    base = path.resolve(base);
    if (visited.has(base)) return;
    visited.add(base);
    for await (const dep of dependencies(base, pkg)) {
      await walk(fileURLToPath(dep.url), dep.pkg);
    }
    if (pkg.addon === true) ids.add(`${pkg.name.replace(/\//g, '__').replace(/^@/, '')}.${pkg.version}`);
  }

  await walk(projectRoot, {
    name: 'qvac-addon-linker',
    version: '0.0.0',
    dependencies: Object.fromEntries(addonNames.map((n) => [n, '*'])),
  });

  for (const addon of splitAddonRoots(projectRoot, addonNames, platform)) {
    await walk(addon.dir, addon.pkg);
  }
  return [...ids].sort();
}

/**
 * Split addons (@qvac/fabric, …) keep their binaries in a per-platform package
 * named by the meta package's `#host-addon` import map, which the linker links
 * separately (mirrors @qvac/sdk's qvac-platform-addons resolver).
 */
function splitAddonRoots(projectRoot, addonNames, platform) {
  const readJson = (p) => {
    try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
  };
  const pkgDir = (name) => path.join(projectRoot, 'node_modules', ...name.split('/'));
  const roots = [];
  for (const name of addonNames) {
    const branch = readJson(path.join(pkgDir(name), 'package.json'))?.imports?.['#host-addon']?.[platform];
    const pick = Array.isArray(branch) ? branch : Array.isArray(branch?.arm64) ? branch.arm64 : null;
    const platformPkg = pick?.[0];
    if (typeof platformPkg !== 'string' || !platformPkg.startsWith(`${name}-`)) continue;
    const dir = path.join(pkgDir(platformPkg), 'addon');
    const pkg = readJson(path.join(dir, 'package.json'));
    if (pkg?.addon === true && fs.existsSync(path.join(dir, 'prebuilds'))) roots.push({ dir, pkg });
  }
  return roots;
}

async function missingAddons(projectRoot, bundlePath, manifestPath) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const linkable = new Set(await linkableAddons(projectRoot, manifest.addons || []));
  return requiredAddons(fs.readFileSync(bundlePath, 'utf8')).filter((id) => !linkable.has(id));
}

module.exports = { requiredAddons, linkableAddons, missingAddons };
