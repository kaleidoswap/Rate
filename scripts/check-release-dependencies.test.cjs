const { test } = require('node:test');
const assert = require('node:assert/strict');
const { auditMaps } = require('./check-release-dependencies.cjs');
test('fails closed without source maps', () => assert.throws(() => auditMaps([]), /No sources/));
test('checks nested maps and nested packages', () => {
  for (const name of ['node-forge','braces','sprintf-js']) {
    assert.throws(() => auditMaps([{ sections: [{ map: { sources: [`node_modules/expo/node_modules/${name}/index.js`] } }] }]), /Unpatched/);
  }
});
test('allows application code and unrelated similarly named packages', () => assert.equal(auditMaps([{ sources: ['screens/Home.tsx','node_modules/brace-expansion/index.js'] }]), 2));
