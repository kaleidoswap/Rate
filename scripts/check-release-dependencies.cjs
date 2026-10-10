// Inspect Metro source maps, not package.json scopes: Expo CLI dependencies are
// tagged runtime by Dependabot even when they are absent from the mobile bundle.
const fs = require('node:fs');
const path = require('node:path');
const blocked = ['node-forge', 'braces', 'sprintf-js'];
function sourcesOf(map) {
  return [...(map.sources || []), ...(map.sections || []).flatMap(section => sourcesOf(section.map))];
}
function auditMaps(maps) {
  const sources = maps.flatMap(sourcesOf);
  if (!sources.length) throw new Error('No sources found; export the production bundle with --source-maps.');
  const found = sources.filter(source => blocked.some(pkg => new RegExp(`(?:^|/)node_modules/${pkg}/`).test(source.replace(/\\/g, '/'))));
  if (found.length) throw new Error(`Unpatched dependency included in mobile bundle:\n${found.join('\n')}`);
  return sources.length;
}
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(file) : file.endsWith('.map') ? [file] : [];
  });
}
if (require.main === module) {
  if (!process.argv[2]) throw new Error('Usage: node scripts/check-release-dependencies.cjs <export-directory>');
  const count = auditMaps(walk(process.argv[2]).map(file => JSON.parse(fs.readFileSync(file, 'utf8'))));
  console.log(`Checked ${count} source entries: node-forge, braces and sprintf-js are absent from the mobile bundle.`);
}
module.exports = { auditMaps };
