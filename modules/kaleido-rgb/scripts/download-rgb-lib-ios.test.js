const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { RGB_LIB_VERSION, XCFRAMEWORK_SHA256, isInstalled, verifyBinding } = require('./download-rgb-lib-ios');

test('the vendored RgbLib.swift is the pinned rgb-lib-swift binding', () => {
  expect(RGB_LIB_VERSION).toBe('0.3.0-beta.7');
  expect(() => verifyBinding()).not.toThrow();
});

test('a changed binding is refused', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kaleido-rgb-'));
  fs.writeFileSync(path.join(dir, 'RgbLib.swift'), '// not the binding');
  expect(() => verifyBinding(dir)).toThrow(/not rgb-lib-swift/);
});

test('the framework counts as installed only with the pinned version marker', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kaleido-rgb-'));
  expect(isInstalled(dir)).toBe(false);
  const fw = path.join(dir, 'rgb_libFFI.xcframework');
  fs.mkdirSync(fw);
  fs.writeFileSync(path.join(fw, 'Info.plist'), '');
  fs.writeFileSync(path.join(fw, '.rgb-lib-version'), '0.3.0-beta.4 old\n');
  expect(isInstalled(dir)).toBe(false);
  fs.writeFileSync(path.join(fw, '.rgb-lib-version'), `${RGB_LIB_VERSION} ${XCFRAMEWORK_SHA256}\n`);
  expect(isInstalled(dir)).toBe(true);
});
