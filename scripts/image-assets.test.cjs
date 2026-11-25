const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const assets = path.resolve(__dirname, '../assets');
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

// Metro detects formats from the contents, but Android AAPT uses the extension.
// An AVIF named .png can pass a JS bundle export and still break the APK build.
test('every bundled .png asset contains PNG data', () => {
  const files = fs.readdirSync(assets, { recursive: true })
    .filter(file => file.toLowerCase().endsWith('.png'));
  assert.ok(files.length > 0, 'Expected bundled PNG assets');
  const invalid = files.filter(file => {
    const data = fs.readFileSync(path.join(assets, file));
    return !data.subarray(0, 8).equals(pngSignature);
  });
  assert.deepEqual(invalid, [], 'Convert these assets to PNG before building Android');
});

test('bundled Prismo poses have a lossless WebP image chunk', () => {
  const poses = path.join(assets, 'prismo');
  const files = fs.readdirSync(poses).filter(file => file.endsWith('.webp'));
  assert.ok(files.length > 0, 'Expected bundled Prismo poses');
  for (const file of files) {
    const data = fs.readFileSync(path.join(poses, file));
    assert.equal(data.toString('ascii', 0, 4), 'RIFF', file);
    assert.equal(data.toString('ascii', 8, 12), 'WEBP', file);
    // VP8L can follow an extended header. Walk the actual RIFF chunks.
    let lossless = false;
    for (let offset = 12; offset + 8 <= data.length;) {
      const length = data.readUInt32LE(offset + 4);
      if (data.toString('ascii', offset, offset + 4) === 'VP8L') lossless = true;
      offset += 8 + length + (length % 2);
    }
    assert.ok(lossless, file);
  }
});
